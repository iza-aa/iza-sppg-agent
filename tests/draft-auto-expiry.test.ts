import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  scheduleDraftAutoExpiry,
  cancelDraftAutoExpiry,
  executeDraftAutoExpiry,
  sweepExpiredDrafts,
} from "../src/core/telegram/handlers/draft.handler.js";
import { PendingActionRepository } from "../src/core/db/repositories/pending-action.repository.js";
import { getSupabaseClient } from "../src/core/db/supabase.js";
import type { BotContext } from "../src/core/telegram/types/bot-context.js";

describe("Real-time Draft Auto Expiry Unit Tests", () => {
  const supabase = getSupabaseClient();
  let pendingRepo: PendingActionRepository;
  let mockBotApi: any;
  let mockStateMap: Map<number, any>;
  let mockBCtx: BotContext;

  beforeEach(() => {
    pendingRepo = new PendingActionRepository(supabase);
    mockStateMap = new Map();
    mockBotApi = {
      editMessageText: vi.fn().mockResolvedValue({}),
      editMessageCaption: vi.fn().mockResolvedValue({}),
      editMessageReplyMarkup: vi.fn().mockResolvedValue({}),
      deleteMessage: vi.fn().mockResolvedValue({}),
    };

    mockBCtx = {
      bot: { api: mockBotApi } as any,
      pendingRepo,
      unitConfig: { id: "sppg_patila", name: "SPPG Patila" } as any,
      getState: (userId: number) => {
        if (!mockStateMap.has(userId)) {
          mockStateMap.set(userId, {
            activeDraftId: undefined,
            activeDraftMsgId: undefined,
            editingField: null,
          });
        }
        return mockStateMap.get(userId);
      },
      updateActivityStatus: vi.fn().mockResolvedValue(true),
      logActivity: vi.fn().mockResolvedValue(true),
    } as unknown as BotContext;
  });

  it("should auto-expire a pending draft and update Telegram message with no buttons", async () => {
    const draftId = `test-auto-expire-${Date.now()}`;
    const userState = mockBCtx.getState(112233);
    userState.activeDraftId = draftId;
    userState.activeDraftMsgId = 555;

    await pendingRepo.create({
      id: draftId,
      sppg_id: "sppg_patila",
      telegram_user_id: 112233,
      telegram_chat_id: 998877,
      action_type: "SUPPLIER_EXPENSE",
      payload: {
        supplier_name: "Toko Sembako Barokah",
        total_amount: 500000,
        payment_method: "Tunai",
        items: [{ item_name: "Beras", qty: 50, unit: "kg", price: 10000, total_price: 500000 }],
        message_id: 555,
      },
      ttlMinutes: 10,
    });

    // Execute auto-expiry
    await executeDraftAutoExpiry(mockBCtx, draftId, 998877, 555);

    // Verify draft status in repository
    const updatedDraft = await pendingRepo.getById(draftId);
    expect(updatedDraft?.status).toBe("EXPIRED");

    // Verify Telegram bot API called to edit message text and strip reply_markup
    expect(mockBotApi.editMessageText).toHaveBeenCalledWith(
      998877,
      555,
      expect.stringContaining("STATUS: DRAF KEDALUWARSA"),
      expect.objectContaining({
        reply_markup: { inline_keyboard: [] },
      })
    );

    // Verify user state cleared
    expect(userState.activeDraftId).toBeUndefined();
    expect(userState.activeDraftMsgId).toBeUndefined();
  });

  it("should not overwrite status or edit message if draft was already SAVED", async () => {
    const draftId = `test-saved-${Date.now()}`;
    await pendingRepo.create({
      id: draftId,
      sppg_id: "sppg_patila",
      telegram_user_id: 112233,
      telegram_chat_id: 998877,
      action_type: "SUPPLIER_EXPENSE",
      payload: { supplier_name: "Toko Sembako", total_amount: 200000 },
      ttlMinutes: 10,
    });

    await pendingRepo.updateStatus(draftId, "SAVED");

    await executeDraftAutoExpiry(mockBCtx, draftId, 998877, 666);

    const checkDraft = await pendingRepo.getById(draftId);
    expect(checkDraft?.status).toBe("SAVED");
    expect(mockBotApi.editMessageText).not.toHaveBeenCalled();
  });

  it("should cancel auto-expiry timer when requested", () => {
    const draftId = `timer-${Date.now()}`;
    scheduleDraftAutoExpiry(mockBCtx, draftId, 12345, 67890, 10);
    expect(() => cancelDraftAutoExpiry(draftId)).not.toThrow();
  });

  it("should sweep expired drafts and update their Telegram messages", async () => {
    const expiredDraftId = `sweep-test-${Date.now()}`;
    const fullRecord = {
      id: expiredDraftId,
      sppg_id: "sppg_patila",
      telegram_user_id: 112233,
      telegram_chat_id: 998877,
      action_type: "SPPG_ORDER" as const,
      payload: {
        order_no: "PO-SWEEP-01",
        sppg_unit: "SPPG Patila",
        total_amount: 1000000,
        items: [],
        message_id: 777,
      },
      ttlMinutes: -1,
    };

    await pendingRepo.create(fullRecord);

    await sweepExpiredDrafts(mockBCtx);

    const swept = await pendingRepo.getById(expiredDraftId);
    expect(swept?.status).toBe("EXPIRED");
    expect(mockBotApi.editMessageText).toHaveBeenCalledWith(
      998877,
      777,
      expect.stringContaining("STATUS: DRAF KEDALUWARSA"),
      expect.any(Object)
    );
  });
});

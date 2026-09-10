import { Context } from "grammy";
import { BotContext } from "../types/bot-context.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { logger } from "../../utils/logger.js";
import {
  renderSppgOrderDraftCard,
  renderSppgOrderItemsDetail,
  renderSupplierExpenseDraftCard,
  safeEditMessageText,
} from "../formatter.js";
import {
  buildDraftConfirmationKeyboard,
  buildBackToDraftKeyboard,
  buildEditSubmenuKeyboard,
  buildPaguSelectorKeyboard,
  buildPaguPromptKeyboard,
  buildCancelInputKeyboard,
} from "../keyboards.js";

// Helper to determine the appropriate confirmation keyboard:
export function getDraftConfirmationReplyMarkup(
  draftId: string,
  actionType: "SPPG_ORDER" | "SUPPLIER_EXPENSE",
  payload: any,
  itemsCount?: number,
  hasMultiplePagu?: boolean
) {
  if (
    actionType === "SUPPLIER_EXPENSE" &&
    payload?.paguSelectionRequired === true &&
    Array.isArray(payload?.paguCandidates) &&
    payload.paguCandidates.length > 1
  ) {
    return buildPaguPromptKeyboard(draftId, payload.paguCandidates);
  }
  return buildDraftConfirmationKeyboard(draftId, actionType, itemsCount, hasMultiplePagu);
}

// Helper to match and enrich receipt with active unfulfilled Pagu candidates
export async function enrichReceiptWithPaguContext(
  spreadsheetId: string,
  receipt: any
): Promise<boolean> {
  const firstItem = receipt?.items?.[0];
  if (!firstItem?.item_name) return false;
  try {
    // 1. If explicitly marked as Non-Pagu / Belanja Tambahan
    if (receipt.sppg_ref_no === "-") {
      receipt.paguSelectionRequired = false;
      receipt.paguContext = {
        sppg_ref_no: "-",
        order_date: "-",
        pagu_supplier: "-",
        item_name: firstItem.item_name,
        target_qty: 0,
        unit: firstItem.unit || "",
        fulfilled_qty: 0,
        current_qty: firstItem.qty,
        remaining_qty: 0,
        candidates_count: 0,
      };
      return false;
    }

    const candidates = await googleSheetsService.getPaguCandidatesForCommodity(
      spreadsheetId,
      firstItem.item_name
    );

    // 2. No active unfulfilled candidates found in 06_PERBANDINGAN_MARGIN
    if (candidates.length === 0) {
      receipt.sppg_ref_no = "-";
      receipt.paguSelectionRequired = false;
      receipt.paguContext = {
        sppg_ref_no: "-",
        order_date: "-",
        pagu_supplier: "-",
        item_name: firstItem.item_name,
        target_qty: 0,
        unit: firstItem.unit || "",
        fulfilled_qty: 0,
        current_qty: firstItem.qty,
        remaining_qty: 0,
        candidates_count: 0,
      };
      return false;
    }

    // 3. If receipt already specifies an explicit PO number (from caption, OCR, or user button tap)
    if (receipt.sppg_ref_no && receipt.sppg_ref_no !== "-") {
      const matched = candidates.find((c) => c.sppg_ref_no === receipt.sppg_ref_no) || candidates[0];
      receipt.paguSelectionRequired = false;
      receipt.paguContext = {
        sppg_ref_no: matched.sppg_ref_no,
        order_date: matched.order_date,
        pagu_supplier: matched.supplier_name,
        item_name: matched.item_name,
        target_qty: matched.target_qty,
        unit: matched.unit,
        fulfilled_qty: matched.fulfilled_qty,
        current_qty: firstItem.qty,
        remaining_qty: matched.remaining_qty,
        candidates_count: candidates.length,
      };
      return candidates.length > 1;
    }

    // 4. Receipt does NOT specify an SPPG Ref:
    if (candidates.length === 1) {
      // Unambiguous: exactly 1 unfulfilled candidate
      receipt.sppg_ref_no = candidates[0].sppg_ref_no;
      receipt.paguSelectionRequired = false;
      receipt.paguContext = {
        sppg_ref_no: candidates[0].sppg_ref_no,
        order_date: candidates[0].order_date,
        pagu_supplier: candidates[0].supplier_name,
        item_name: candidates[0].item_name,
        target_qty: candidates[0].target_qty,
        unit: candidates[0].unit,
        fulfilled_qty: candidates[0].fulfilled_qty,
        current_qty: firstItem.qty,
        remaining_qty: candidates[0].remaining_qty,
        candidates_count: 1,
      };
      return false;
    }

    // 5. Ambiguous: Multiple unfulfilled candidates found! DO NOT GUESS!
    receipt.paguSelectionRequired = true;
    receipt.paguCandidates = candidates;
    receipt.sppg_ref_no = ""; // Keep empty until user chooses
    return true;
  } catch (err) {
    logger.warn({ err }, "Could not enrich receipt with Pagu context");
  }
  return false;
}

export function registerDraftHandlers(bCtx: BotContext) {
  // [✅ Ya, Simpan]
  bCtx.bot.callbackQuery(/^v:save:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);

    if (!draft || draft.status !== "PENDING") {
      return ctx.answerCallbackQuery({
        text: "⚠️ Draf ini sudah diproses atau kedaluwarsa.",
        show_alert: true,
      });
    }

    if (draft.action_type === "SPPG_ORDER" && (await bCtx.isCallerMember(ctx.from?.id))) {
      await bCtx.pendingRepo.updateStatus(draftId, "CANCELLED");
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Member hanya memiliki hak akses untuk input Pengeluaran Belanja Supplier.",
        show_alert: true,
      });
    }

    if (
      draft.action_type === "SUPPLIER_EXPENSE" &&
      draft.payload?.paguSelectionRequired === true &&
      Array.isArray(draft.payload?.paguCandidates) &&
      draft.payload.paguCandidates.length > 1
    ) {
      return ctx.answerCallbackQuery({
        text: "⚠️ Mohon sentuh salah satu pilihan anggaran menu terlebih dahulu!",
        show_alert: true,
      });
    }

    const locked = await bCtx.pendingRepo.acquireLock(draftId);
    if (!locked) {
      return ctx.answerCallbackQuery({
        text: "⏳ Sedang diproses, mohon tunggu...",
        show_alert: false,
      });
    }

    await ctx.answerCallbackQuery({
      text: "⚡ Sedang menulis ke Google Sheets...",
      show_alert: false,
    });

    await safeEditMessageText(ctx, ctx.callbackQuery.message?.text || "Menyimpan...", {
      reply_markup: undefined,
    });

    try {
      const callingUser = ctx.from ? await bCtx.userRepo.getUser(ctx.from.id) : null;
      const recorderName = callingUser?.first_name || ctx.from?.first_name || (ctx.from?.id === 7546537134 ? "Heizaaa" : "Petugas SPPG");

      if (draft.action_type === "SPPG_ORDER") {
        await googleSheetsService.recordSppgOrder(
          bCtx.unitConfig.spreadsheetId,
          draft.payload,
          draft.media_url || "",
          draft.payload?.notes || "",
          recorderName
        );
      } else {
        const items = draft.payload?.items || [];
        const supplierGroups = new Map<string, any[]>();
        for (const it of items) {
          const sName = it.supplier_name?.trim() || it.supplier_target?.trim();
          if (sName) {
            if (!supplierGroups.has(sName)) {
              supplierGroups.set(sName, []);
            }
            supplierGroups.get(sName)!.push(it);
          }
        }

        if (supplierGroups.size > 1) {
          // Multi-supplier detected: split into individual transactions per supplier
          const batchTransactions: any[] = [];
          for (const [suppName, groupItems] of supplierGroups.entries()) {
            const groupTotal = groupItems.reduce(
              (acc: number, it: any) => acc + (Number(it.total_price) || (Number(it.qty) * Number(it.price))),
              0
            );
            batchTransactions.push({
              ...draft.payload,
              supplier_name: suppName,
              items: groupItems,
              total_amount: groupTotal,
              subtotal: groupTotal,
            });
          }
          await googleSheetsService.recordSupplierExpenseBatch(
            bCtx.unitConfig.spreadsheetId,
            batchTransactions,
            recorderName
          );
        } else {
          await googleSheetsService.recordSupplierExpense(
            bCtx.unitConfig.spreadsheetId,
            draft.payload,
            draft.media_url || "",
            recorderName,
            draft.payload?.notes || ""
          );
        }
      }

      await bCtx.pendingRepo.updateStatus(draftId, "SAVED");

      if (ctx.from) {
        const state = bCtx.getState(ctx.from.id);
        state.activeDraftId = undefined;
        state.activeDraftMsgId = undefined;
      }

      const successCard =
        draft.action_type === "SPPG_ORDER"
          ? renderSppgOrderDraftCard(draft.payload, draftId, "SAVED")
          : renderSupplierExpenseDraftCard(draft.payload, draftId, "SAVED", draft.media_url);

      await safeEditMessageText(ctx, successCard, { parse_mode: "HTML" });
    } catch (saveErr: any) {
      logger.error({ saveErr }, "Failed saving to Google Sheets, restoring draft status to PENDING");
      await bCtx.pendingRepo.updateStatus(draftId, "PENDING");
      const itemsCount = draft.action_type === "SPPG_ORDER" ? draft.payload?.items?.length || 0 : undefined;
      await safeEditMessageText(
        ctx,
        `❌ Gagal menyimpan ke Spreadsheet: ${saveErr?.message || saveErr}\n\nSilakan coba tekan tombol <b>Simpan</b> kembali.`,
        {
          parse_mode: "HTML",
          reply_markup: buildDraftConfirmationKeyboard(draftId, draft.action_type, itemsCount),
        }
      );
    }
  });

  // [🔍 Lihat Rincian Bahan]
  bCtx.bot.callbackQuery(/^v:viewitems:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.action_type !== "SPPG_ORDER") {
      return ctx.answerCallbackQuery({ text: "⚠️ Rincian bahan tidak ditemukan.", show_alert: true });
    }

    await ctx.answerCallbackQuery();
    const detailText = renderSppgOrderItemsDetail(draft.payload);
    await safeEditMessageText(ctx, detailText, {
      parse_mode: "HTML",
      reply_markup: buildBackToDraftKeyboard(draftId),
    });
  });

  // [✏️ Koreksi Draf]
  bCtx.bot.callbackQuery(/^v:edit:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildEditSubmenuKeyboard(draftId),
    });
  });

  // [🔙 Kembali ke Draf]
  bCtx.bot.callbackQuery(/^v:sub:back:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft) return ctx.answerCallbackQuery();

    const state = bCtx.getState(ctx.from.id);
    if (state.promptMsgId && ctx.chat) {
      await ctx.api.deleteMessage(ctx.chat.id, state.promptMsgId).catch(() => { });
      state.promptMsgId = undefined;
    }
    state.editingField = null;

    const itemsCount = draft.action_type === "SPPG_ORDER" ? draft.payload?.items?.length || 0 : undefined;
    const draftCard =
      draft.action_type === "SPPG_ORDER"
        ? renderSppgOrderDraftCard(draft.payload, draftId, draft.status)
        : renderSupplierExpenseDraftCard(draft.payload, draftId, draft.status, draft.media_url);

    await ctx.answerCallbackQuery();
    await safeEditMessageText(ctx, draftCard, {
      parse_mode: "HTML",
      reply_markup: getDraftConfirmationReplyMarkup(draftId, draft.action_type, draft.payload, itemsCount),
    });
  });

  // [❌ Batalkan Draf]
  bCtx.bot.callbackQuery(/^v:cancel:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft) return ctx.answerCallbackQuery();

    await bCtx.pendingRepo.updateStatus(draftId, "CANCELLED");
    await ctx.answerCallbackQuery({ text: "❌ Draf berhasil dibatalkan." });

    if (ctx.from) {
      const state = bCtx.getState(ctx.from.id);
      state.activeDraftId = undefined;
      state.activeDraftMsgId = undefined;
    }

    const cancelCard =
      draft.action_type === "SPPG_ORDER"
        ? renderSppgOrderDraftCard(draft.payload, draftId, "CANCELLED")
        : renderSupplierExpenseDraftCard(draft.payload, draftId, "CANCELLED", draft.media_url);

    await safeEditMessageText(ctx, cancelCard, { parse_mode: "HTML" });
  });

  // [💰 Ganti Total Nominal]
  bCtx.bot.callbackQuery(/^v:sub:nominal:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const state = bCtx.getState(ctx.from.id);
    state.activeDraftId = draftId;
    state.editingField = "nominal";

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildCancelInputKeyboard(draftId),
    });

    const prompt = await ctx.reply(
      "Ketik <b>nominal baru</b> (contoh: <code>8900000</code> atau <code>8.900.000</code>):",
      { parse_mode: "HTML" }
    );
    state.promptMsgId = prompt.message_id;
  });

  // [🏪 Ganti Nama Toko/Unit]
  bCtx.bot.callbackQuery(/^v:sub:name:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const state = bCtx.getState(ctx.from.id);
    state.activeDraftId = draftId;
    state.editingField = "name";

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildCancelInputKeyboard(draftId),
    });

    const prompt = await ctx.reply("Ketik <b>nama supplier atau unit baru</b> (contoh: <i>Hj Muliadi</i>):", {
      parse_mode: "HTML",
    });
    state.promptMsgId = prompt.message_id;
  });

  // [🔄 Pilih Alokasi Anggaran]
  bCtx.bot.callbackQuery(/^v:pagu_pick:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return ctx.answerCallbackQuery({ text: "⚠️ Draf sudah tidak aktif.", show_alert: true });
    }

    const firstItem = draft.payload?.items?.[0];
    const candidates = firstItem?.item_name
      ? await googleSheetsService.getPaguCandidatesForCommodity(bCtx.unitConfig.spreadsheetId, firstItem.item_name)
      : [];

    await ctx.answerCallbackQuery();
    if (candidates.length === 0) {
      return ctx.reply("ℹ️ Tidak ditemukan anggaran Pagu lain yang aktif untuk bahan ini.", { parse_mode: "HTML" });
    }

    await ctx.editMessageReplyMarkup({
      reply_markup: buildPaguSelectorKeyboard(draftId, candidates),
    });
  });

  // [📅 Set Alokasi Pagu Anggaran]
  bCtx.bot.callbackQuery(/^v:pagu_set:(.+):(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const targetPagu = ctx.match[2];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return ctx.answerCallbackQuery({ text: "⚠️ Draf sudah tidak aktif.", show_alert: true });
    }

    draft.payload.sppg_ref_no = targetPagu;
    draft.payload.paguSelectionRequired = false;
    await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, draft.payload);

    await bCtx.pendingRepo.updatePayload(draftId, draft.payload);
    await ctx.answerCallbackQuery({
      text: targetPagu === "-" ? "Alokasi diset ke Belanja Tambahan (Non-Pagu)" : `Alokasi diset ke PO ${targetPagu}`
    });

    const cardText = renderSupplierExpenseDraftCard(draft.payload, draftId, "PENDING", draft.media_url);
    const hasMultiple = (draft.payload as any)?.paguContext?.candidates_count > 1;
    await safeEditMessageText(ctx, cardText, {
      parse_mode: "HTML",
      reply_markup: buildDraftConfirmationKeyboard(draftId, draft.action_type, undefined, hasMultiple),
    });
  });

  // [📄 Ganti No Pagu dari Submenu Koreksi]
  bCtx.bot.callbackQuery(/^v:sub:pagu:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await bCtx.pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return ctx.answerCallbackQuery({ text: "⚠️ Draf sudah tidak aktif.", show_alert: true });
    }

    const firstItem = draft.payload?.items?.[0];
    const candidates = firstItem?.item_name
      ? await googleSheetsService.getPaguCandidatesForCommodity(bCtx.unitConfig.spreadsheetId, firstItem.item_name)
      : [];

    await ctx.answerCallbackQuery();
    if (candidates.length > 0) {
      await ctx.editMessageReplyMarkup({
        reply_markup: buildPaguSelectorKeyboard(draftId, candidates),
      });
    } else {
      const state = bCtx.getState(ctx.from.id);
      state.activeDraftId = draftId;
      state.editingField = "pagu";

      await ctx.editMessageReplyMarkup({
        reply_markup: buildCancelInputKeyboard(draftId),
      });

      const prompt = await ctx.reply(
        "Ketik <b>No SPPG Anggaran</b> (contoh: <code>03/31/08/26</code> atau ketik <code>-</code> untuk belanja mandiri):",
        { parse_mode: "HTML" }
      );
      state.promptMsgId = prompt.message_id;
    }
  });
}

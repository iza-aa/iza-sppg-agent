import { describe, it, expect, vi } from "vitest";
import type { Context } from "grammy";
import { withTyping } from "../src/core/telegram/bot-handler.js";

describe("Telegram Instant Status Feedback with Auto-Delete (withTyping)", () => {
  function createMockContext(chatId = 12345) {
    const mockReply = vi.fn().mockImplementation(async (text: string, options?: any) => {
      return { message_id: 999, text, chat: { id: chatId } };
    });
    const mockReplyWithChatAction = vi.fn().mockResolvedValue(true);
    const mockDeleteMessage = vi.fn().mockResolvedValue(true);

    const ctx = {
      chat: { id: chatId },
      from: { id: 67890 },
      reply: mockReply,
      replyWithChatAction: mockReplyWithChatAction,
      api: {
        deleteMessage: mockDeleteMessage,
      },
    } as unknown as Context;

    return { ctx, mockReply, mockReplyWithChatAction, mockDeleteMessage };
  }

  it("should send status chat bubble immediately and auto-delete it after action finishes", async () => {
    const { ctx, mockReply, mockReplyWithChatAction, mockDeleteMessage } = createMockContext(12345);
    const statusText = "📸 <i>Foto nota diterima! Sedang membaca rincian nota...</i>";

    let actionExecuted = false;
    const result = await withTyping(
      ctx,
      async () => {
        expect(mockReply).toHaveBeenCalledTimes(1);
        expect(mockReply).toHaveBeenCalledWith(statusText, { parse_mode: "HTML" });
        expect(mockReplyWithChatAction).toHaveBeenCalledWith("typing");
        // Status message should not be deleted yet while action is running
        expect(mockDeleteMessage).not.toHaveBeenCalled();
        actionExecuted = true;
        return "SUCCESS_RESULT";
      },
      statusText
    );

    expect(actionExecuted).toBe(true);
    expect(result).toBe("SUCCESS_RESULT");

    // After action finishes, the status bubble must be deleted automatically
    expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
    expect(mockDeleteMessage).toHaveBeenCalledWith(12345, 999);
  });

  it("should auto-delete status chat bubble even if action throws an error", async () => {
    const { ctx, mockReply, mockDeleteMessage } = createMockContext(12345);
    const statusText = "🎙️ <i>Pesan suara diterima! Sedang mendengarkan & mencatat rincian...</i>";

    await expect(
      withTyping(
        ctx,
        async () => {
          throw new Error("AI parsing timeout");
        },
        statusText
      )
    ).rejects.toThrow("AI parsing timeout");

    // The status message must STILL be deleted to prevent stuck messages
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(mockDeleteMessage).toHaveBeenCalledTimes(1);
    expect(mockDeleteMessage).toHaveBeenCalledWith(12345, 999);
  });

  it("should work normally without statusText (backward compatibility)", async () => {
    const { ctx, mockReply, mockReplyWithChatAction, mockDeleteMessage } = createMockContext(12345);

    const result = await withTyping(ctx, async () => {
      return 42;
    });

    expect(result).toBe(42);
    expect(mockReply).not.toHaveBeenCalled();
    expect(mockReplyWithChatAction).toHaveBeenCalledWith("typing");
    expect(mockDeleteMessage).not.toHaveBeenCalled();
  });
});

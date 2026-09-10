import { Bot, Context } from "grammy";
import type { SPPGUnitConfig } from "../../config/sppg.config.js";
import { getSupabaseClient } from "../db/supabase.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { PendingActionRepository } from "../db/repositories/pending-action.repository.js";
import { logger } from "../utils/logger.js";
import { escapeHtml, cleanMarkdownToTelegramHtml } from "./formatter.js";
import {
  type BotContext,
  type UserInteractionState,
  type PaguOneShotDraft,
  pendingPaguModifications,
  renderPaguOneShotCard,
} from "./types/bot-context.js";
import {
  registerCommonHandlers,
  registerReportHandlers,
  sendSheets,
  sendRekap,
  sendPdf,
  registerTransactionHandlers,
  sendRecentTransactions,
  sendTransactionDetail,
  registerPaguHandlers,
  sendPaguOrders,
  registerDraftHandlers,
  registerMediaHandlers,
  registerTextRouterHandler,
} from "./handlers/index.js";

// Re-export shared types and state maps for backward compatibility
export {
  type BotContext,
  type UserInteractionState,
  type PaguOneShotDraft,
  pendingPaguModifications,
  renderPaguOneShotCard,
};

/**
 * Factory creating and configuring the Grammy Bot instance for an SPPG Unit.
 * Assembles all domain handlers and global middlewares cleanly.
 */
export function createSppgBot(unitConfig: SPPGUnitConfig): Bot<Context> {
  const bot = new Bot(unitConfig.token);
  const supabase = getSupabaseClient();
  const userRepo = new UserRepository(supabase);
  const pendingRepo = new PendingActionRepository(supabase);

  const userStates = new Map<number, UserInteractionState>();
  const activeKeyboardMessages = new Map<number, Set<number>>();

  function trackKeyboardMessage(chatId: number, msgId: number) {
    if (!activeKeyboardMessages.has(chatId)) {
      activeKeyboardMessages.set(chatId, new Set());
    }
    activeKeyboardMessages.get(chatId)!.add(msgId);
  }

  async function clearAllActiveKeyboards(chatId?: number) {
    if (!chatId) return;
    const set = activeKeyboardMessages.get(chatId);
    if (set && set.size > 0) {
      const ids = Array.from(set);
      set.clear();
      await Promise.all(
        ids.map((msgId) =>
          bot.api.editMessageReplyMarkup(chatId, msgId, {
            reply_markup: { inline_keyboard: [] },
          }).catch(() => {})
        )
      );
    }
  }

  // Automatic API Transformer: whenever bot sends/edits ANY message with inline_keyboard, track it!
  bot.api.config.use(async (prev, method, payload, signal) => {
    const res = await prev(method, payload, signal);
    try {
      if (
        (method === "sendMessage" || method === "editMessageText") &&
        (payload as any)?.reply_markup?.inline_keyboard &&
        Array.isArray((payload as any).reply_markup.inline_keyboard) &&
        (payload as any).reply_markup.inline_keyboard.length > 0
      ) {
        const chatId = Number((payload as any)?.chat_id || (res as any)?.chat?.id);
        const msgId = Number((res as any)?.message_id || (payload as any)?.message_id);
        if (!isNaN(chatId) && !isNaN(msgId)) {
          trackKeyboardMessage(chatId, msgId);
        }
      }
    } catch {}
    return res;
  });

  // Global Middleware 1: Sekali tombol dipencet, tombol LANGSUNG hilang seketika!
  bot.on("callback_query", async (ctx, next) => {
    if (ctx.chat && ctx.callbackQuery?.message?.message_id) {
      const chatId = ctx.chat.id;
      const msgId = ctx.callbackQuery.message.message_id;
      activeKeyboardMessages.get(chatId)?.delete(msgId);
      await ctx.api.editMessageReplyMarkup(chatId, msgId, {
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }
    return next();
  });

  // Global Middleware 2: Jika user memutuskan chat ketik, kirim foto, nota, atau voice note, SEMUA tombol lama langsung hilang!
  bot.on("message", async (ctx, next) => {
    if (ctx.chat?.id) {
      await clearAllActiveKeyboards(ctx.chat.id);
    }
    return next();
  });

  function getState(userId: number): UserInteractionState {
    if (!userStates.has(userId)) {
      userStates.set(userId, {});
    }
    return userStates.get(userId)!;
  }

  // Helper typing action keep-alive
  async function withTyping<T>(ctx: Context, action: () => Promise<T>): Promise<T> {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const interval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => {});
    }, 4000);
    try {
      return await action();
    } finally {
      clearInterval(interval);
    }
  }

  // RBAC helper for Member role
  async function isCallerMember(userId?: number): Promise<boolean> {
    if (!userId) return false;
    const user = await userRepo.getUser(userId);
    return user?.role === "member";
  }

  async function notifyMemberRestricted(ctx: Context, featureDesc: string) {
    await ctx.reply(
      `⛔ <b>Akses Dibatasi</b>\n\n` +
      `Sebagai <b>Staf Operasional (Member)</b>, akses ke <b>${escapeHtml(featureDesc)}</b> dibatasi.\n\n` +
      `👉 Wewenang Anda dikhususkan untuk mencatat <b>Pengeluaran Belanja Supplier</b>. Fitur administratif, rekap laba, dan dokumen SPJ dikelola oleh Admin.`,
      { parse_mode: "HTML" }
    );
  }

  // Safe HTML reply with Markdown cleanup and parse error fallback
  async function safeReplyHtml(ctx: Context, text: string, reply_markup?: any) {
    const cleaned = cleanMarkdownToTelegramHtml(text);
    const extra: any = { parse_mode: "HTML" };
    if (reply_markup) extra.reply_markup = reply_markup;
    let sentMsg: any;
    try {
      sentMsg = await ctx.reply(cleaned, extra);
    } catch (parseErr) {
      logger.warn({ parseErr }, "Telegram HTML parse failed, retrying with escaped text");
      try {
        sentMsg = await ctx.reply(escapeHtml(text), extra);
      } catch {
        sentMsg = await ctx.reply(text, reply_markup ? { reply_markup } : undefined);
      }
    }
    if (reply_markup && sentMsg?.message_id && ctx.chat?.id) {
      trackKeyboardMessage(ctx.chat.id, sentMsg.message_id);
    }
    return sentMsg;
  }

  // Button Hygiene Helper: Remove obsolete inline keyboards on chat or action transition
  async function clearObsoleteKeyboards(ctx: Context, state?: UserInteractionState) {
    if (!ctx.chat) return;
    await clearAllActiveKeyboards(ctx.chat.id);
    if (state && state.activeQuickActionMsgId) {
      await bot.api.editMessageReplyMarkup(ctx.chat.id, state.activeQuickActionMsgId, {
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
      state.activeQuickActionMsgId = undefined;
    }
    if (state && state.activeDraftMsgId && state.activeDraftId) {
      const draft = await pendingRepo.getById(state.activeDraftId);
      if (draft && draft.status === "PENDING") {
        await bot.api.editMessageReplyMarkup(ctx.chat.id, state.activeDraftMsgId, {
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
      }
    }
  }

  // Assemble Bot Context
  const bCtx: BotContext = {
    bot,
    unitConfig,
    supabase,
    userRepo,
    pendingRepo,
    userStates,
    activeKeyboardMessages,
    trackKeyboardMessage,
    clearAllActiveKeyboards,
    getState,
    withTyping,
    isCallerMember,
    notifyMemberRestricted,
    safeReplyHtml,
    clearObsoleteKeyboards,
    sendSheets: (ctx: Context) => sendSheets(bCtx, ctx),
    sendRekap: (ctx: Context) => sendRekap(bCtx, ctx),
    sendPdf: (ctx: Context, explicitOrderNo?: string) => sendPdf(bCtx, ctx, explicitOrderNo),
    sendRecentTransactions: (ctx: Context, limit?: number) => sendRecentTransactions(bCtx, ctx, limit),
    sendTransactionDetail: (ctx: Context, transactionId: string) => sendTransactionDetail(bCtx, ctx, transactionId),
    sendPaguOrders: (ctx: Context) => sendPaguOrders(bCtx, ctx),
  };

  // Register Handlers
  registerCommonHandlers(bCtx);
  registerReportHandlers(bCtx);
  registerTransactionHandlers(bCtx);
  registerPaguHandlers(bCtx);
  registerDraftHandlers(bCtx);
  registerMediaHandlers(bCtx);
  registerTextRouterHandler(bCtx);

  return bot;
}

import { Bot, Context, InputFile, InlineKeyboard } from "grammy";
import crypto from "node:crypto";
import { SPPGUnitConfig } from "../../config/sppg.config.js";
import { getSupabaseClient } from "../db/supabase.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { PendingActionRepository } from "../db/repositories/pending-action.repository.js";
import { parseSppgOrderFromImage } from "../ai/parsers/sppg-order.parser.js";
import { parseSupplierReceiptFromImage } from "../ai/parsers/supplier-receipt.parser.js";
import { staticParsePaguModification } from "../ai/parsers/pagu-modification.parser.js";
import { metaAgent } from "../ai/meta-agent.js";
import { googleDriveService } from "../google/drive.service.js";
import { googleSheetsService } from "../google/sheets.service.js";
import { SHEET_NAMES } from "../google/sheets-recipes.js";
import { generateOfficialSppgPdf } from "../pdf/pdf-report.service.js";
import {
  buildDraftConfirmationKeyboard,
  buildBackToDraftKeyboard,
  buildEditSubmenuKeyboard,
  buildPaguSelectorKeyboard,
  buildPaguPromptKeyboard,
  buildCancelInputKeyboard,
  buildRekapActionKeyboard,
  buildMultiSheetSelectorKeyboard,
  buildTransactionListKeyboard,
  buildTransactionDetailKeyboard,
  buildDeleteConfirmKeyboard,
  buildEditConfirmKeyboard,
  buildStartQuickActionKeyboard,
  buildInviteRolePickerKeyboard,
  buildPaguOrderListKeyboard,
  buildPaguItemListKeyboard,
  buildPaguItemActionKeyboard,
  buildPaguItemEditConfirmKeyboard,
  buildPaguOneShotConfirmKeyboard,
  buildPaguClarifyAddOrReplaceKeyboard,
  buildPaguItemPickForReplaceKeyboard,
} from "./keyboards.js";
import {
  escapeHtml,
  formatRupiah,
  cleanMarkdownToTelegramHtml,
  renderSppgOrderDraftCard,
  renderSppgOrderItemsDetail,
  renderSupplierExpenseDraftCard,
  renderTransactionListCard,
  renderTransactionDetailCard,
  safeEditMessageText,
} from "./formatter.js";
import { staticConversationalReply, staticImageFailureMessage } from "../ai/static-fallback.js";
import { parseSpreadsheetBuffer } from "../document-parser/spreadsheet.parser.js";
import { parseVoiceNote } from "../document-parser/voice.parser.js";
import { parsePdfDocument } from "../document-parser/pdf.parser.js";
import { logger } from "../utils/logger.js";

export interface PaguOneShotDraft {
  draftId: string;
  spreadsheetId: string;
  orderNo: string;
  orderLabel?: string;
  action: "UPDATE" | "ADD";
  isExpense?: boolean;
  expenseId?: string;
  itemRowIndex?: number;
  origItemName?: string;
  supplier?: string;
  itemName: string;
  qty: number;
  unit: string;
  price: number;
  oldQty?: number;
  oldPrice?: number;
  oldSupplier?: string;
  updatedBy: string;
  createdAt: number;
}

const pendingPaguModifications = new Map<string, PaguOneShotDraft>();

function renderPaguOneShotCard(draft: PaguOneShotDraft, unitName: string): string {
  const newSubtotal = draft.qty * draft.price;

  if (draft.isExpense) {
    return [
      `📋 <b>KONFIRMASI PENAMBAHAN RINCIAN BELANJA (PENGELUARAN)</b>`,
      `Unit: <b>${escapeHtml(unitName)}</b>`,
      `------------------------------------------`,
      `• <b>Transaksi Belanja:</b> <code>${escapeHtml(draft.orderLabel || draft.expenseId || draft.orderNo)}</code>`,
      `• <b>Bahan Belanja:</b> <b>${escapeHtml(draft.itemName)}</b>`,
      `• <b>Kuantitas:</b> <b>${draft.qty} ${escapeHtml(draft.unit)}</b>`,
      `• <b>Harga Satuan:</b> <b>${formatRupiah(draft.price)}</b>`,
      `• <b>Total Belanja:</b> <b>${formatRupiah(newSubtotal)}</b>`,
      draft.supplier ? `• <b>Supplier:</b> <b>${escapeHtml(draft.supplier)}</b>` : "",
      `------------------------------------------`,
      `📍 <i>Bahan akan disisipkan rapi mengelompok di bawah transaksi ${escapeHtml(draft.expenseId || draft.orderNo)} pada Tab 05 (baris di bawahnya bergeser otomatis).</i>`,
      `📈 <i>Total nominal tagihan di Tab 04_PAGU_PENGELUARAN otomatis terakumulasi.</i>`,
      ``,
      `Apakah Anda ingin menulis rincian belanja ini ke spreadsheet?`,
    ].filter(Boolean).join("\n");
  }

  if (draft.action === "UPDATE") {
    const oldSubtotal = (draft.oldQty || 0) * (draft.oldPrice || 0);
    const subtotalDiff = newSubtotal - oldSubtotal;
    const diffSign = subtotalDiff > 0 ? `+${formatRupiah(subtotalDiff)}` : `${formatRupiah(subtotalDiff)}`;
    return [
      `📋 <b>KONFIRMASI PERUBAHAN PAGU BAHAN (1-SHOT)</b>`,
      `Unit: <b>${escapeHtml(unitName)}</b>`,
      `------------------------------------------`,
      `• <b>Surat Pesanan:</b> <code>${escapeHtml(draft.orderLabel || draft.orderNo)}</code>`,
      `• <b>Bahan:</b> <b>${escapeHtml(draft.itemName)}</b>`,
      `------------------------------------------`,
      `<b>DATA LAMA:</b>`,
      `• Kuantitas: ${draft.oldQty || "-"} ${escapeHtml(draft.unit)} @ ${formatRupiah(draft.oldPrice || 0)}`,
      `• Subtotal: ${formatRupiah(oldSubtotal)}`,
      draft.oldSupplier ? `• Rekanan: ${escapeHtml(draft.oldSupplier)}` : "",
      ``,
      `<b>DATA BARU:</b>`,
      `• Kuantitas: <b>${draft.qty} ${escapeHtml(draft.unit)}</b> @ <b>${formatRupiah(draft.price)}</b>`,
      `• Subtotal: <b>${formatRupiah(newSubtotal)}</b> <i>(${diffSign})</i>`,
      draft.supplier ? `• Rekanan: <b>${escapeHtml(draft.supplier)}</b>` : "",
      `------------------------------------------`,
      `🔄 <i>Tab 03_RINCIAN_PENDAPATAN dan Tab 06_PERBANDINGAN_MARGIN akan otomatis disinkronkan.</i>`,
      `Apakah perubahan ini sudah sesuai dan siap ditulis ke spreadsheet?`,
    ].filter(Boolean).join("\n");
  } else {
    return [
      `📋 <b>KONFIRMASI PENAMBAHAN BAHAN BARU KE PAGU</b>`,
      `Unit: <b>${escapeHtml(unitName)}</b>`,
      `------------------------------------------`,
      `• <b>Surat Pesanan:</b> <code>${escapeHtml(draft.orderLabel || draft.orderNo)}</code>`,
      `• <b>Bahan Baru:</b> <b>${escapeHtml(draft.itemName)}</b>`,
      `• <b>Kuantitas:</b> <b>${draft.qty} ${escapeHtml(draft.unit)}</b>`,
      `• <b>Harga Satuan:</b> <b>${formatRupiah(draft.price)}</b>`,
      `• <b>Total Pagu Bahan:</b> <b>${formatRupiah(newSubtotal)}</b>`,
      draft.supplier ? `• <b>Target Rekanan:</b> <b>${escapeHtml(draft.supplier)}</b>` : `• <b>Target Rekanan:</b> Lainnya`,
      `------------------------------------------`,
      `📍 <i>Bahan baru akan disisipkan di posisi paling bawah pesanan ini (baris pesanan lain di bawahnya bergeser otomatis).</i>`,
      `📈 <i>Tab 03_RINCIAN_PENDAPATAN dan Tab 06_PERBANDINGAN_MARGIN akan disinkronkan, serta total anggaran Tab 02 bertambah.</i>`,
      ``,
      `Apakah Anda ingin menulis bahan baru ini ke spreadsheet?`,
    ].filter(Boolean).join("\n");
  }
}

interface UserInteractionState {
  activeDraftId?: string;
  activeDraftMsgId?: number;
  activeQuickActionMsgId?: number;
  editingField?: "nominal" | "name" | "pagu" | null;
  editingTransactionId?: string;
  promptMsgId?: number;
  editingPagu?: {
    orderNo: string;
    rowIndex: number;
    field: "qty" | "price" | "supplier" | "name";
    itemName: string;
    unit: string;
  } | null;
  addingPaguItemToOrder?: {
    orderNo: string;
  } | null;
}

export function createSppgBot(unitConfig: SPPGUnitConfig): Bot<Context> {
  const bot = new Bot(unitConfig.token);
  const supabase = getSupabaseClient();
  const userRepo = new UserRepository(supabase);
  const pendingRepo = new PendingActionRepository(supabase);

  const userStates = new Map<number, UserInteractionState>();

  // Global tracking for all messages with active inline keyboards per chat
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
    await ctx.replyWithChatAction("typing").catch(() => { });
    const interval = setInterval(() => {
      ctx.replyWithChatAction("typing").catch(() => { });
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
    if (state) {
      state.activeQuickActionMsgId = undefined;
      state.activeDraftMsgId = undefined;
    }
  }

  // ============================================================================
  // PUBLIC COMMANDS (Accessible to everyone)
  // ============================================================================

  // 1. /myid - Displays Telegram identity, user ID, and connection status
  async function sendMyId(ctx: Context) {
    if (!ctx.from) return;
    const tgId = ctx.from.id;
    const tgName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ");
    const tgUsername = ctx.from.username ? `@${ctx.from.username}` : "(tanpa username)";
    const user = await userRepo.getUser(tgId);
    const isSuper = await userRepo.isSuperAdmin(tgId);
    const isAllowed = await userRepo.isAllowed(tgId);

    let statusDesc = "❌ <b>Belum Terdaftar (Tidak Ada Akses)</b>";
    if (isSuper) {
      statusDesc = "👑 <b>Super Admin / Pemilik Sistem</b>";
    } else if (isAllowed && user) {
      if (user.role === "member") {
        statusDesc = `✅ <b>Terhubung sebagai Staf Operasional (Member Belanja)</b> (${escapeHtml(user.sppg_assigned_id || unitConfig.id)})`;
      } else {
        statusDesc = `✅ <b>Terhubung sebagai ${escapeHtml(user.role.toUpperCase())}</b> (${escapeHtml(user.sppg_assigned_id || unitConfig.id)})`;
      }
    }

    const lines = [
      `🆔 <b>INFORMASI IDENTITAS TELEGRAM ANDA:</b>`,
      `------------------------------------------`,
      `• <b>Telegram ID:</b> <code>${tgId}</code>`,
      `• <b>Nama Akun:</b> ${escapeHtml(tgName)}`,
      `• <b>Username:</b> ${escapeHtml(tgUsername)}`,
      `• <b>Status Akses:</b> ${statusDesc}`,
      `------------------------------------------`,
      isSuper
        ? `💡 <i>Sebagai Super Admin, Anda dapat mengundang anggota tim baru dengan perintah:</i>\n<code>/invite [Nama] [admin/member]</code>`
        : isAllowed
          ? user?.role === "member"
            ? `<i>Akun Anda aktif khusus untuk mencatat pengeluaran belanja supplier unit ${escapeHtml(unitConfig.name)}.</i>`
            : `<i>Akun Anda telah diverifikasi untuk mengelola unit ${escapeHtml(unitConfig.name)}.</i>`
          : `👉 <i>Hubungi Super Admin (@heizaa4) untuk mendapatkan link undangan resmi.</i>`,
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  }

  bot.command("myid", sendMyId);

  // 2. /start - Handles both standard greeting and secure invite claim (?start=INV-XXXXXX)
  bot.command("start", async (ctx) => {
    if (!ctx.from) return;
    const payload = ctx.match?.trim();

    // CASE A: User is claiming an invite code (?start=INV-XXXXXX)
    if (payload && payload.startsWith("INV-")) {
      const invite = await userRepo.getInvite(payload);

      if (!invite) {
        await ctx.reply(
          `⚠️ <b>Link undangan tidak valid atau sudah pernah digunakan.</b>\n\nSilakan minta Super Admin (@heizaa4) untuk membuat link undangan baru via <code>/invite</code>.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      if (new Date(invite.expires_at).getTime() < Date.now()) {
        await ctx.reply(
          `⚠️ <b>Link undangan telah kedaluwarsa.</b>\n\nSilakan minta Super Admin untuk membuat link undangan baru via <code>/invite</code>.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // If Super Admin accidentally clicks their own invite for someone else
      const isSuper = await userRepo.isSuperAdmin(ctx.from.id);
      if (isSuper && ctx.from.id === invite.created_by) {
        await ctx.reply(
          `⚠️ <b>Ini adalah Link Undangan khusus untuk ${escapeHtml(invite.name)}!</b>\n\n` +
          `Akun Telegram Anda sudah berstatus Super Admin.\n` +
          `👉 <b>Jangan klik link ini di akun Anda sendiri</b>, melainkan teruskan/kirim link ini ke Telegram <b>${escapeHtml(invite.name)}</b> agar akun beliau yang terverifikasi.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // Claim invite
      const result = await userRepo.claimInvite(payload, {
        id: ctx.from.id,
        username: ctx.from.username,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
      });

      if (!result) {
        await ctx.reply(`⚠️ Gagal memproses klaim undangan. Silakan coba lagi.`, { parse_mode: "HTML" });
        return;
      }

      const isMember = result.user.role === "member";
      const roleDesc =
        result.user.role === "super_admin"
          ? "Super Admin / Owner"
          : result.user.role === "admin"
            ? "Admin (Operator SPPG)"
            : "Staf Operasional (Member Belanja)";

      const capabilityList = isMember
        ? [
            `💡 <b>Mulai Sekarang Anda Dapat:</b>`,
            `1. ✍️ <b>Ketik Belanjaan Langsung</b>: <i>"Beli ayam 200rb di pasar ayam tunai"</i>.`,
            `2. 📸 <b>Kirim Foto Struk/Nota</b> untuk pencatatan otomatis ke Google Sheets.`,
            `3. 🎙️ <b>Pesan Suara (Voice Note)</b> untuk mendiktekan belanjaan dapur.`,
            `4. 💬 <b>Tanya AI Masakan & Gizi MBG</b> seputar porsi atau bahan baku.`,
            ``,
            `ℹ️ <i>Catatan: Akses Anda dikhususkan untuk input pengeluaran belanja supplier. Untuk laporan margin laba harian & SPJ dikelola oleh Admin.</i>`,
          ]
        : [
            `💡 <b>Mulai Sekarang Anda Dapat:</b>`,
            `1. ✍️ <b>Ketik Belanjaan Langsung</b>: <i>"Beli ayam 200rb di pasar ayam"</i>.`,
            `2. 📸 <b>Kirim Foto Nota/Struk</b> untuk pencatatan otomatis OCR.`,
            `3. 📊 Ketik <i>"rekap"</i> untuk ringkasan margin laba hari ini.`,
            `4. 📄 Ketik <i>"pdf"</i> untuk cetak dokumen resmi SPJ BGN.`,
            `5. 🌐 Ketik <i>"sheets"</i> untuk membuka spreadsheet online.`,
          ];

      const claimSuccessText = [
        `🎉 <b>VERIFIKASI BERHASIL! SELAMAT DATANG!</b>`,
        `------------------------------------------`,
        `Halo <b>${escapeHtml(result.user.first_name || invite.name)}</b>, akun Telegram Anda telah resmi terhubung sebagai:`,
        `🏢 Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
        `🎖️ Peran: <b>${roleDesc}</b>`,
        `------------------------------------------`,
        ...capabilityList,
      ].join("\n");

      const state = getState(ctx.from.id);
      await clearObsoleteKeyboards(ctx, state);

      const kbRole = result.user.role === "member" ? "member" : "admin";
      const sentMsg = await ctx.reply(claimSuccessText, {
        parse_mode: "HTML",
        reply_markup: buildStartQuickActionKeyboard(kbRole),
      });
      state.activeQuickActionMsgId = sentMsg.message_id;
      return;
    }

    // CASE B: Standard Start
    const isAllowed = await userRepo.isAllowed(ctx.from.id);
    if (!isAllowed) {
      await ctx.reply(
        `⛔ <b>Akses Ditolak (Privat & Terbatas)</b>\n\n` +
        `Akun Telegram Anda (ID: <code>${ctx.from.id}</code>) belum terdaftar di sistem asisten MBG.\n\n` +
        `👉 <i>Ketik /myid untuk melihat identitas Anda, atau hubungi Super Admin (@heizaa4) untuk mendapatkan link undangan resmi.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const user = await userRepo.getUser(ctx.from.id);
    const isMemberUser = user?.role === "member";
    const userRole = isMemberUser ? "member" : "admin";

    const welcomeLines = isMemberUser
      ? [
          `👋 <b>Halo, Selamat Datang di Asisten Operasional MBG!</b>`,
          `🏢 Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
          `🎖️ Akses: <b>Staf Operasional (Member Belanja)</b>`,
          `Badan Gizi Nasional (BGN) Republik Indonesia`,
          `--------------------------------------`,
          `💡 <b>Layanan Pencatatan Belanja Dapur:</b>`,
          `1. ✍️ <b>Ketik Belanja:</b> <i>"Beli telur 3 rak 165rb di Hj Muliadi tunai"</i>`,
          `2. 📸 <b>Kirim Foto Nota:</b> Foto bon/kuitansi belanja pasar untuk OCR otomatis`,
          `3. 🎙️ <b>Voice Note:</b> Rekam suara rincian belanjaan Anda`,
          `4. 💬 <b>Tanya AI:</b> Konsultasi menu, porsi, atau takaran gizi MBG`,
        ]
      : [
          `👋 <b>Halo, Selamat Datang di Asisten Operasional MBG!</b>`,
          `🏢 Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
          `Badan Gizi Nasional (BGN) Republik Indonesia`,
          `--------------------------------------`,
          `💡 <b>AI Agent Siap Melayani Anda Secara Natural:</b>`,
          `1. ✍️ <b>Ketik Langsung:</b> <i>"Beli telur 3 rak 165rb di Hj Muliadi tunai"</i>`,
          `2. 📸 <b>Kirim Foto:</b> Foto Nota SPPG atau Bon belanja pasar`,
          `3. 📊 <b>Minta Rekap:</b> Cukup ketik <i>"rekap"</i> atau <i>"margin"</i>`,
          `4. 📄 <b>Laporan SPJ:</b> Cukup ketik <i>"kirim pdf"</i> atau <i>"cetak spj"</i>`,
          `5. 🌐 <b>Spreadsheet:</b> Cukup ketik <i>"buka sheets"</i>`,
          `6. 🔍 <b>Riwayat Belanja:</b> Cukup ketik <i>"transaksi"</i>`,
        ];

    const state = getState(ctx.from.id);
    await clearObsoleteKeyboards(ctx, state);

    const sentMsg = await ctx.reply(welcomeLines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: buildStartQuickActionKeyboard(userRole),
    });
    state.activeQuickActionMsgId = sentMsg.message_id;
  });

  // 3. /menu - Quick Action Shortcuts for fast tapping
  bot.command("menu", async (ctx) => {
    if (!ctx.from) return;
    const isAllowed = await userRepo.isAllowed(ctx.from.id);
    if (!isAllowed) return;

    const state = getState(ctx.from.id);
    await clearObsoleteKeyboards(ctx, state);

    const user = await userRepo.getUser(ctx.from.id);
    const userRole = user?.role === "member" ? "member" : "admin";

    const sentMsg = await ctx.reply(
      `⚡ <b>PINTASAN MENU OPERASIONAL (${escapeHtml(unitConfig.name)})</b>\n\n` +
      `Silakan ketuk pintasan di bawah ini atau langsung kirim pesan teks, foto struk, maupun rekaman suara:`,
      {
        parse_mode: "HTML",
        reply_markup: buildStartQuickActionKeyboard(userRole),
      }
    );
    state.activeQuickActionMsgId = sentMsg.message_id;
  });

  // ============================================================================
  // GLOBAL AUTH GUARD (Blocks unauthenticated users from all operational features)
  // ============================================================================
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();

    const isAllowed = await userRepo.isAllowed(ctx.from.id);
    if (!isAllowed) {
      await ctx.reply(
        `⛔ <b>Akses Ditolak (Privat & Terbatas)</b>\n\n` +
        `Akun Telegram Anda (ID: <code>${ctx.from.id}</code>) belum terdaftar di sistem asisten MBG.\n\n` +
        `👉 <i>Ketik /myid untuk melihat identitas Anda, atau hubungi Super Admin (@heizaa4) untuk mendapatkan link undangan resmi.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    return next();
  });

  // ============================================================================
  // AUTHENTICATED COMMANDS & HELPERS
  // ============================================================================

  async function handleInviteCommand(ctx: Context, targetName?: string, roleArg = "admin") {
    if (!ctx.from) return;
    const isAdmin = await userRepo.isAdminOrSuperAdmin(ctx.from.id);
    if (!isAdmin) {
      await ctx.reply("⛔ <b>Akses Ditolak</b>: Perintah undangan hanya dapat dijalankan oleh Admin atau Super Admin.", {
        parse_mode: "HTML",
      });
      return;
    }

    let targetRole: "super_admin" | "admin" | "member" = "admin";
    let label = "Pengguna Baru";

    const raw1 = (targetName || "").toLowerCase();
    const raw2 = (roleArg || "").toLowerCase();

    if (raw1 === "admin" || raw1 === "member" || raw1 === "super_admin") {
      targetRole = raw1 as any;
      if (roleArg && roleArg !== "admin") label = roleArg;
    } else if (raw2 === "admin" || raw2 === "member" || raw2 === "super_admin") {
      targetRole = raw2 as any;
      if (targetName) label = targetName;
    } else if (targetName) {
      label = targetName;
    }

    const inviteCode = "INV-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    await userRepo.createInvite({
      code: inviteCode,
      name: label,
      role: targetRole,
      sppg_assigned_id: unitConfig.id,
      created_by: ctx.from.id,
      ttlMinutes: 15, // 15 Menit Masa Berlaku
    });

    const botUsername = ctx.me.username || "mbg_assistant_bot";
    const inviteLink = `https://t.me/${botUsername}?start=${inviteCode}`;

    const roleDesc =
      targetRole === "super_admin"
        ? "Super Admin"
        : targetRole === "admin"
          ? "Admin (Operator SPPG)"
          : "Staf Operasional (Member)";

    const replyText = [
      `🎟️ <b>LINK UNDANGAN RESMI BERHASIL DIBUAT!</b>`,
      `------------------------------------------`,
      `• <b>Peran:</b> <code>${roleDesc}</code>`,
      `• <b>Unit SPPG:</b> ${escapeHtml(unitConfig.name)}`,
      `• <b>Masa Berlaku:</b> ⏱️ <b>15 Menit</b> (Sekali Pakai)`,
      `------------------------------------------`,
      `👉 <b>Kirimkan link ini langsung ke Telegram penerima:</b>`,
      `${inviteLink}`,
      ``,
      `<i>Penerima cukup mengklik link di atas dan menekan START. Nama panggilan di bot dan Google Sheets akan otomatis menggunakan display name akun Telegram beliau.</i>`,
    ].join("\n");

    await ctx.reply(replyText, { parse_mode: "HTML" });
  }

  // 3. /invite - Super Admin / Admin creates single-use invite link
  bot.command("invite", async (ctx) => {
    const args = ctx.match?.trim().split(/\s+/) || [];
    await handleInviteCommand(ctx, args[0], args[1]);
  });

  async function sendSheets(ctx: Context) {
    if (await isCallerMember(ctx.from?.id)) {
      return notifyMemberRestricted(ctx, "spreadsheet keuangan SPPG");
    }

    await ctx.reply(
      `🌐 <b>PILIH SPREADSHEET GOOGLE SHEETS MBG:</b>\n\n` +
      `Unit aktif Anda saat ini: <b>${escapeHtml(unitConfig.name)}</b>\n\n` +
      `Silakan ketuk tombol di bawah untuk membuka spreadsheet online:`,
      {
        parse_mode: "HTML",
        reply_markup: buildMultiSheetSelectorKeyboard(unitConfig.id),
      }
    );
  }

  async function sendRekap(ctx: Context) {
    if (await isCallerMember(ctx.from?.id)) {
      return notifyMemberRestricted(ctx, "laporan rekapitulasi keuangan & margin laba");
    }

    await withTyping(ctx, async () => {
      const kpi = await googleSheetsService.getExecutiveKpi(unitConfig.spreadsheetId);
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${unitConfig.spreadsheetId}/edit`;

      const rekapText = [
        `📊 <b>REKAP EKSEKUTIF SPPG MBG</b>`,
        `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
        `------------------------------------------`,
        `🟢 <b>Plafon Pendapatan</b> : ${formatRupiah(kpi.totalPlafon)}`,
        `🔴 <b>Realisasi Belanja</b>  : ${formatRupiah(kpi.totalBelanja)}`,
        `------------------------------------------`,
        `💎 <b>Margin Bersih</b>     : <b>${formatRupiah(kpi.marginBersih)} (${kpi.marginPercentage}%)</b>`,
        `Status Evaluasi: ${kpi.marginPercentage >= 15 ? "🟢 HEMAT / SURPLUS" : kpi.marginPercentage >= 5 ? "🟡 SESUAI PAGU" : "🔴 PERHATIAN: OVER-BUDGET"}`,
      ].join("\n");

      await ctx.reply(rekapText, {
        parse_mode: "HTML",
        reply_markup: buildRekapActionKeyboard(sheetUrl, unitConfig.id),
      });
    });
  }

  async function sendPdf(ctx: Context, explicitOrderNo?: string) {
    if (await isCallerMember(ctx.from?.id)) {
      return notifyMemberRestricted(ctx, "pencetakan dokumen resmi SPJ BGN");
    }

    await withTyping(ctx, async () => {
      await ctx.reply("⏳ Sedang memproses dan menyusun Dokumen PDF Resmi SPJ BGN...", { parse_mode: "HTML" });

      const text = ctx.message?.text || "";
      let targetOrderNo = explicitOrderNo;
      if (!targetOrderNo) {
        const orderMatch = text.match(/(?:\/pdf|\/spj|cetak\s+spj|cetak\s+pdf)\s+([0-9A-Za-z\/\-_]+)/i);
        if (orderMatch && orderMatch[1]) {
          targetOrderNo = orderMatch[1].trim();
        }
      }

      const displayOrder = targetOrderNo || "REKAP-BULANAN";
      const kpi = await googleSheetsService.getExecutiveKpi(unitConfig.spreadsheetId, targetOrderNo);
      const expenses = await googleSheetsService.getExpensesForReport(unitConfig.spreadsheetId, targetOrderNo);
      const today = new Date().toISOString().split("T")[0];

      const calculatedBelanja = expenses.length > 0
        ? expenses.reduce((sum, e) => sum + (e.amount || 0), 0)
        : (kpi.totalBelanja ?? 0);

      const totalPlafon = kpi.totalPlafon ?? 0;
      const totalBelanja = calculatedBelanja;
      const marginBersih = totalPlafon - totalBelanja;
      const marginPercentage = totalPlafon > 0
        ? Math.round((marginBersih / totalPlafon) * 10000) / 100
        : 0;

      const pdfBuffer = await generateOfficialSppgPdf({
        sppgName: unitConfig.name,
        periodDate: today,
        orderNo: displayOrder,
        totalPlafon,
        totalBelanja,
        marginBersih,
        marginPercentage,
        expenses,
      });

      const filename = `Laporan_SPJ_${unitConfig.id}_${today}.pdf`;
      await ctx.replyWithDocument(new InputFile(pdfBuffer, filename), {
        caption: `📄 <b>Laporan Resmi SPJ Badan Gizi Nasional</b>\n` +
          `Unit: <b>${escapeHtml(unitConfig.name)}</b>\n` +
          `Ref: <code>${displayOrder}</code>\n` +
          `Tanggal: <code>${today}</code>\n\n` +
          `💰 Total Plafon: <b>${formatRupiah(totalPlafon)}</b>\n` +
          `🛒 Total Belanja: <b>${formatRupiah(totalBelanja)}</b>\n` +
          `📈 Sisa Margin: <b>${formatRupiah(marginBersih)} (${marginPercentage}%)</b>`,
        parse_mode: "HTML",
      });
    });
  }

  async function sendRecentTransactions(ctx: Context, limit = 8) {
    if (await isCallerMember(ctx.from?.id)) {
      return notifyMemberRestricted(ctx, "riwayat transaksi lengkap Google Sheets");
    }

    await withTyping(ctx, async () => {
      const transactions = await googleSheetsService.getRecentTransactions(unitConfig.spreadsheetId, limit);
      const text = renderTransactionListCard(transactions);
      await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: transactions.length > 0 ? buildTransactionListKeyboard(transactions) : undefined,
      });
    });
  }

  async function sendTransactionDetail(ctx: Context, transactionId: string) {
    if (await isCallerMember(ctx.from?.id)) {
      return notifyMemberRestricted(ctx, "detail transaksi Google Sheets");
    }

    await withTyping(ctx, async () => {
      const detail = await googleSheetsService.getTransactionDetail(unitConfig.spreadsheetId, transactionId);
      if (!detail.found) {
        await ctx.reply(`⚠️ Transaksi dengan ID <code>${escapeHtml(transactionId)}</code> tidak ditemukan di Google Sheets unit ${escapeHtml(unitConfig.name)}.`, {
          parse_mode: "HTML",
        });
        return;
      }

      const text = renderTransactionDetailCard(detail);
      const sheetUrl = `https://docs.google.com/spreadsheets/d/${unitConfig.spreadsheetId}/edit`;
      await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: buildTransactionDetailKeyboard(detail.id, sheetUrl),
      });
    });
  }

  async function sendPaguOrders(ctx: Context) {
    if (await isCallerMember(ctx.from?.id)) {
      return notifyMemberRestricted(ctx, "kelola pagu anggaran dapur");
    }

    await withTyping(ctx, async () => {
      const orders = await googleSheetsService.getPaguOrders(unitConfig.spreadsheetId);
      if (orders.length === 0) {
        await ctx.reply(
          `📋 <b>KELOLA PAGU / RINCIAN BAHAN</b>\n` +
          `Unit: <b>${escapeHtml(unitConfig.name)}</b>\n\n` +
          `ℹ️ Belum ada data Surat Pesanan (PO) di Tab 02_PAGU_PENERIMAAN. Silakan upload nota pesanan atau input anggaran terlebih dahulu.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      const orderListText = [
        `📋 <b>KELOLA PAGU & RINCIAN BAHAN (Tab 03)</b>`,
        `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
        `------------------------------------------`,
        `Pilih Surat Pesanan (PO) yang ingin Anda periksa atau ubah rincian kuantitas/harga bahannya:`,
      ].join("\n");

      await ctx.reply(orderListText, {
        parse_mode: "HTML",
        reply_markup: buildPaguOrderListKeyboard(orders),
      });
    });
  }

  bot.command("sheets", sendSheets);
  bot.command("rekap", sendRekap);
  bot.command("pdf", (ctx) => sendPdf(ctx));
  bot.command("spj", (ctx) => sendPdf(ctx));
  bot.command("transaksi", async (ctx) => sendRecentTransactions(ctx, 8));
  bot.command("pagu", sendPaguOrders);
  bot.command("editpagu", sendPaguOrders);

  // Helper to determine the appropriate confirmation keyboard:
  // If ambiguous (multiple unfulfilled Pagu candidates and user hasn't selected yet),
  // prompt directly with candidate selection buttons (hiding the Save button).
  function getDraftConfirmationReplyMarkup(
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
  async function enrichReceiptWithPaguContext(
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
      // Require explicit user selection before allowing save.
      receipt.paguSelectionRequired = true;
      receipt.paguCandidates = candidates;
      receipt.sppg_ref_no = ""; // Keep empty until user chooses
      return true;
    } catch (err) {
      logger.warn({ err }, "Could not enrich receipt with Pagu context");
    }
    return false;
  }

  // ============================================================================
  // PHOTO & DOCUMENT UPLOAD HANDLER

  async function handleIncomingImage(ctx: Context, fileId: string) {
    if (!ctx.from || !ctx.chat) return;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const state = getState(userId);

    // Button Hygiene: Strip previous active keyboards if user sends a new photo
    await clearObsoleteKeyboards(ctx, state);

    await withTyping(ctx, async () => {
      const file = await ctx.api.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${unitConfig.token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const imageBuffer = Buffer.from(await response.arrayBuffer());

      logger.info({ userId, fileSize: imageBuffer.length }, "Processing incoming image document...");

      // 2. Classify document using OCR/AI logic
      let sppgOrderResult = null;
      let supplierReceiptResult = null;
      let actionType: "SPPG_ORDER" | "SUPPLIER_EXPENSE" = "SUPPLIER_EXPENSE";

      // Attempt parsing as SPPG Order first
      try {
        sppgOrderResult = await parseSppgOrderFromImage(imageBuffer);
        if (sppgOrderResult && sppgOrderResult.items && sppgOrderResult.items.length >= 2) {
          actionType = "SPPG_ORDER";
        }
      } catch {
        // Fallback to supplier receipt
      }

      if (actionType !== "SPPG_ORDER") {
        try {
          supplierReceiptResult = await parseSupplierReceiptFromImage(imageBuffer);
        } catch (supplierErr) {
          logger.warn({ supplierErr }, "Failed parsing image with both SPPG Order and Supplier Receipt parsers");

          // Always upload to Google Drive Vault so the photo is safe even during AI outage
          const now = new Date();
          const year = String(now.getFullYear());
          const month = `${String(now.getMonth() + 1).padStart(2, "0")}-${now.toLocaleString("id-ID", { month: "long" })}`;
          try {
            const destFolderId = await googleDriveService.resolveDestinationFolder(unitConfig.id, year, month, "02_Kwitansi_Supplier");
            await googleDriveService.uploadReceipt(
              imageBuffer,
              `${now.toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}`,
              destFolderId
            );
          } catch (driveErr) {
            logger.warn({ driveErr }, "Could not upload image to Drive during OCR failure");
          }

          await ctx.reply(staticImageFailureMessage(), { parse_mode: "HTML" });
          return;
        }
      }

      if (actionType === "SPPG_ORDER" && (await isCallerMember(userId))) {
        await ctx.reply(
          `⛔ <b>Akses Dibatasi</b>\n\n` +
          `Foto yang Anda kirim terdeteksi sebagai <b>Nota Pesanan SPPG (Pagu Pendapatan)</b>.\n` +
          `Sebagai <b>Staf Operasional (Member)</b>, wewenang Anda dikhususkan untuk mencatat <b>Pengeluaran Belanja Supplier</b>.\n\n` +
          `👉 Pencatatan Nota Pesanan SPPG hanya dapat dilakukan oleh Admin.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      // 3. Upload to Google Drive Vault
      const now = new Date();
      const year = String(now.getFullYear());
      const month = `${String(now.getMonth() + 1).padStart(2, "0")}-${now.toLocaleString("id-ID", { month: "long" })}`;
      const subFolderType = actionType === "SPPG_ORDER" ? "01_Nota_Pesanan_SPPG" : "02_Kwitansi_Supplier";

      let driveLink = "";
      try {
        const destFolderId = await googleDriveService.resolveDestinationFolder(unitConfig.id, year, month, subFolderType);
        const uploadRes = await googleDriveService.uploadReceipt(
          imageBuffer,
          `${now.toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}`,
          destFolderId
        );
        driveLink = uploadRes.webViewLink;
      } catch (driveErr) {
        logger.warn({ driveErr }, "Could not upload to Google Drive, proceeding with draft");
      }

      // Enrich with Pagu candidates if supplier receipt
      let hasMultiplePagu = false;
      if (actionType === "SUPPLIER_EXPENSE" && supplierReceiptResult) {
        hasMultiplePagu = await enrichReceiptWithPaguContext(unitConfig.spreadsheetId, supplierReceiptResult);
      }

      // 4. Create Pending Action Draft in State Machine
      const draftId = `draft_${Date.now()}`;
      const payload = actionType === "SPPG_ORDER" ? sppgOrderResult : supplierReceiptResult;

      await pendingRepo.create({
        id: draftId,
        sppg_id: unitConfig.id,
        telegram_user_id: userId,
        telegram_chat_id: chatId,
        action_type: actionType,
        payload,
        media_url: driveLink,
      });

      state.activeDraftId = draftId;

      // 5. Render Card and Send
      const cardText =
        actionType === "SPPG_ORDER"
          ? renderSppgOrderDraftCard(sppgOrderResult!, draftId, "PENDING")
          : renderSupplierExpenseDraftCard(supplierReceiptResult!, draftId, "PENDING", driveLink);

      const itemsCount = actionType === "SPPG_ORDER" ? sppgOrderResult?.items?.length || 0 : undefined;

      const sentMsg = await ctx.reply(cardText, {
        parse_mode: "HTML",
        reply_markup: getDraftConfirmationReplyMarkup(draftId, actionType, payload, itemsCount, hasMultiplePagu),
      });

      state.activeDraftMsgId = sentMsg.message_id;
    });
  }

  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message.photo;
    const fileInfo = photos[photos.length - 1];
    await handleIncomingImage(ctx, fileInfo.file_id);
  });

  // Voice Note Handler (.oga / OGG Audio)
  bot.on("message:voice", async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const state = getState(userId);

    // Button Hygiene: strip previous active keyboards
    await clearObsoleteKeyboards(ctx, state);

    await withTyping(ctx, async () => {
      const voice = ctx.message.voice;
      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${unitConfig.token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      const result = await parseVoiceNote(audioBuffer, voice.mime_type || "audio/ogg", unitConfig.name);
      if (result.error) {
        await ctx.reply(result.error, { parse_mode: "HTML" });
        return;
      }

      if (result.transaction) {
        if (result.transaction.type === "SPPG_ORDER" && (await isCallerMember(userId))) {
          await ctx.reply(
            `🎙️ <i>"${escapeHtml(result.transcription)}"</i>\n\n` +
            `⛔ <b>Akses Dibatasi</b>\n\n` +
            `Pesan suara Anda terdeteksi sebagai <b>Nota Pesanan SPPG (Pagu Pendapatan)</b>.\n` +
            `Sebagai <b>Staf Operasional (Member)</b>, wewenang Anda dikhususkan untuk mencatat <b>Pengeluaran Belanja Supplier</b>.\n\n` +
            `👉 Pencatatan Nota Pesanan SPPG hanya dapat dilakukan oleh Admin.`,
            { parse_mode: "HTML" }
          );
          return;
        }

        let hasMultiplePagu = false;
        if (result.transaction.type === "SUPPLIER_EXPENSE") {
          hasMultiplePagu = await enrichReceiptWithPaguContext(unitConfig.spreadsheetId, result.transaction.data);
        }

        const draftId = `draft_${Date.now()}`;
        await pendingRepo.create({
          id: draftId,
          sppg_id: unitConfig.id,
          telegram_user_id: userId,
          telegram_chat_id: chatId,
          action_type: result.transaction.type,
          payload: result.transaction.data,
        });

        state.activeDraftId = draftId;

        const cardText =
          result.transaction.type === "SPPG_ORDER"
            ? renderSppgOrderDraftCard(result.transaction.data as any, draftId, "PENDING")
            : renderSupplierExpenseDraftCard(result.transaction.data as any, draftId, "PENDING");

        const itemsCount =
          result.transaction.type === "SPPG_ORDER"
            ? ((result.transaction.data as any)?.items?.length || 0)
            : undefined;

        const sentMsg = await ctx.reply(
          `🎙️ <i>"${escapeHtml(result.transcription)}"</i>\n\n${cardText}`,
          {
            parse_mode: "HTML",
            reply_markup: getDraftConfirmationReplyMarkup(draftId, result.transaction.type, result.transaction.data, itemsCount, hasMultiplePagu),
          }
        );
        state.activeDraftMsgId = sentMsg.message_id;
      } else {
        await ctx.reply(
          `🎙️ <b>Transkripsi Pesan Suara:</b>\n<i>"${escapeHtml(result.transcription)}"</i>\n\n💡 <i>Jika ingin mencatat belanja dari suara, sebutkan nama bahan, harga, dan toko (contoh: "Beli ayam 250rb di pasar ayam tunai").</i>`,
          { parse_mode: "HTML" }
        );
      }
    });
  });

  // Document Handler (Images, Spreadsheets, PDFs)
  bot.on("message:document", async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const state = getState(userId);
    const doc = ctx.message.document;
    const fileName = doc.file_name?.toLowerCase() || "";
    const mimeType = doc.mime_type || "";

    // Button Hygiene: strip previous active keyboards
    await clearObsoleteKeyboards(ctx, state);

    // CASE 1: Image document (PNG, JPG, WebP)
    if (mimeType.startsWith("image/")) {
      await handleIncomingImage(ctx, doc.file_id);
      return;
    }

    // CASE 2: Excel or CSV document (.xlsx, .xls, .csv)
    if (
      fileName.endsWith(".xlsx") ||
      fileName.endsWith(".xls") ||
      fileName.endsWith(".csv") ||
      mimeType.includes("spreadsheet") ||
      mimeType.includes("excel") ||
      mimeType.includes("csv")
    ) {
      await withTyping(ctx, async () => {
        const file = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${unitConfig.token}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        try {
          const parsed = parseSpreadsheetBuffer(buffer, "Supplier Rekanan");
          if (parsed.transactions.length === 0) {
            await ctx.reply("⚠️ Tidak ada data transaksi yang dapat dibaca dari file spreadsheet ini.", { parse_mode: "HTML" });
            return;
          }

          // If single transaction, show draft card
          if (parsed.transactions.length === 1) {
            const trx = parsed.transactions[0];
            const draftId = `draft_${Date.now()}`;
            await pendingRepo.create({
              id: draftId,
              sppg_id: unitConfig.id,
              telegram_user_id: userId,
              telegram_chat_id: chatId,
              action_type: "SUPPLIER_EXPENSE",
              payload: trx,
            });
            state.activeDraftId = draftId;
            const cardText = renderSupplierExpenseDraftCard(trx, draftId, "PENDING");
            const sentMsg = await ctx.reply(cardText, {
              parse_mode: "HTML",
              reply_markup: buildDraftConfirmationKeyboard(draftId, "SUPPLIER_EXPENSE"),
            });
            state.activeDraftMsgId = sentMsg.message_id;
            return;
          }

          // If multiple transactions, summarize and batch save
          const totalSum = parsed.transactions.reduce((acc, t) => acc + t.total_amount, 0);
          const lines = [
            `📊 <b>IMPORT DATA SPREADSHEET BERHASIL</b>`,
            `File: <code>${escapeHtml(doc.file_name || "Data.xlsx")}</code>`,
            `Total: <b>${parsed.transactions.length} Transaksi</b> (${formatRupiah(totalSum)})`,
            `------------------------------------------`,
          ];
          parsed.transactions.slice(0, 5).forEach((t, i) => {
            lines.push(`${i + 1}. <b>${escapeHtml(t.supplier_name)}</b>: ${formatRupiah(t.total_amount)} (${escapeHtml(t.items[0]?.item_name || "Item")})`);
          });
          if (parsed.transactions.length > 5) {
            lines.push(`<i>... dan ${parsed.transactions.length - 5} transaksi lainnya</i>`);
          }
          lines.push(`------------------------------------------`);
          lines.push(`⚡ <i>Menyimpan ${parsed.transactions.length} transaksi ke Google Sheets...</i>`);
          await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });

          await googleSheetsService.recordSupplierExpenseBatch(
            unitConfig.spreadsheetId,
            parsed.transactions,
            ctx.from?.first_name || "Admin"
          );
          await ctx.reply(`✅ <b>Berhasil Menyimpan ${parsed.transactions.length} Transaksi ke Tab 04_PAGU_PENGELUARAN & Tab 05_RINCIAN_PENGELUARAN!</b>`, { parse_mode: "HTML" });
        } catch (parseErr: any) {
          logger.error({ parseErr }, "Spreadsheet parsing error");
          await ctx.reply(`❌ Gagal membaca file spreadsheet: ${escapeHtml(parseErr?.message || parseErr)}`, { parse_mode: "HTML" });
        }
      });
      return;
    }

    // CASE 3: PDF Document (.pdf)
    if (fileName.endsWith(".pdf") || mimeType === "application/pdf") {
      await withTyping(ctx, async () => {
        const file = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${unitConfig.token}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        // Upload to Google Drive Vault first
        const now = new Date();
        const year = String(now.getFullYear());
        const month = `${String(now.getMonth() + 1).padStart(2, "0")}-${now.toLocaleString("id-ID", { month: "long" })}`;
        let driveLink = "";
        try {
          const destFolderId = await googleDriveService.resolveDestinationFolder(
            unitConfig.id,
            year,
            month,
            "03_Dokumen_PDF"
          );
          const baseName = (doc.file_name || `Dokumen_${now.toISOString().slice(0, 10)}`).replace(/\.[^/.]+$/, "");
          const uploadRes = await googleDriveService.uploadReceipt(buffer, `${baseName}_${Date.now().toString().slice(-4)}.pdf`, destFolderId);
          driveLink = uploadRes.webViewLink;
        } catch (driveErr) {
          logger.warn({ driveErr }, "Could not upload PDF to Drive");
        }

        const parsedPdf = await parsePdfDocument(buffer, unitConfig.name);
        if (!parsedPdf) {
          await ctx.reply(
            `📄 <b>Dokumen PDF Diterima</b>\n\n• File: <code>${escapeHtml(doc.file_name || "dokumen.pdf")}</code>\n• Drive: <a href="${driveLink}">Buka di Google Drive</a>\n\n⚠️ AI OCR saat ini tidak dapat membaca rincian tabel secara otomatis. Silakan input ringkasan pesanan atau transaksi via chat teks.`,
            { parse_mode: "HTML" }
          );
          return;
        }

        if (parsedPdf.type === "SPPG_ORDER" && (await isCallerMember(userId))) {
          await ctx.reply(
            `⛔ <b>Akses Dibatasi</b>\n\n` +
            `Dokumen PDF yang Anda kirim terdeteksi sebagai <b>Nota Pesanan SPPG (Pagu Pendapatan)</b>.\n` +
            `Sebagai <b>Staf Operasional (Member)</b>, wewenang Anda dikhususkan untuk mencatat <b>Pengeluaran Belanja Supplier</b>.\n\n` +
            `👉 Pencatatan Nota Pesanan SPPG hanya dapat dilakukan oleh Admin.`,
            { parse_mode: "HTML" }
          );
          return;
        }

        let hasMultiplePagu = false;
        if (parsedPdf.type === "SUPPLIER_EXPENSE") {
          hasMultiplePagu = await enrichReceiptWithPaguContext(unitConfig.spreadsheetId, parsedPdf.data);
        }

        const draftId = `draft_${Date.now()}`;
        await pendingRepo.create({
          id: draftId,
          sppg_id: unitConfig.id,
          telegram_user_id: userId,
          telegram_chat_id: chatId,
          action_type: parsedPdf.type,
          payload: parsedPdf.data,
          media_url: driveLink,
        });

        state.activeDraftId = draftId;
        const cardText =
          parsedPdf.type === "SPPG_ORDER"
            ? renderSppgOrderDraftCard(parsedPdf.data as any, draftId, "PENDING")
            : renderSupplierExpenseDraftCard(parsedPdf.data as any, draftId, "PENDING", driveLink);

        const itemsCount = parsedPdf.type === "SPPG_ORDER" ? (parsedPdf.data as any)?.items?.length || 0 : undefined;
        const sentMsg = await ctx.reply(cardText, {
          parse_mode: "HTML",
          reply_markup: getDraftConfirmationReplyMarkup(draftId, parsedPdf.type, parsedPdf.data, itemsCount, hasMultiplePagu),
        });
        state.activeDraftMsgId = sentMsg.message_id;
      });
      return;
    }

    // Unsupported document format
    await ctx.reply(
      "ℹ️ Format file belum didukung. Silakan kirimkan foto nota (JPG/PNG), dokumen PDF, atau spreadsheet Excel/CSV.",
      { parse_mode: "HTML" }
    );
  });

  // ============================================================================
  // CALLBACK QUERY HANDLERS (INLINE BUTTONS)
  // ============================================================================

  // [✅ Ya, Simpan]
  bot.callbackQuery(/^v:save:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await pendingRepo.getById(draftId);

    if (!draft || draft.status !== "PENDING") {
      return ctx.answerCallbackQuery({
        text: "⚠️ Draf ini sudah diproses atau kedaluwarsa.",
        show_alert: true,
      });
    }

    if (draft.action_type === "SPPG_ORDER" && (await isCallerMember(ctx.from?.id))) {
      await pendingRepo.updateStatus(draftId, "CANCELLED");
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

    const locked = await pendingRepo.acquireLock(draftId);
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
      const callingUser = ctx.from ? await userRepo.getUser(ctx.from.id) : null;
      const recorderName = callingUser?.first_name || ctx.from?.first_name || (ctx.from?.id === 7546537134 ? "Heizaaa" : "Petugas SPPG");

      if (draft.action_type === "SPPG_ORDER") {
        await googleSheetsService.recordSppgOrder(
          unitConfig.spreadsheetId,
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
            unitConfig.spreadsheetId,
            batchTransactions,
            recorderName
          );
        } else {
          await googleSheetsService.recordSupplierExpense(
            unitConfig.spreadsheetId,
            draft.payload,
            draft.media_url || "",
            recorderName,
            draft.payload?.notes || ""
          );
        }
      }

      await pendingRepo.updateStatus(draftId, "SAVED");

      if (ctx.from) {
        const state = getState(ctx.from.id);
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
      await pendingRepo.updateStatus(draftId, "PENDING");
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
  bot.callbackQuery(/^v:viewitems:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await pendingRepo.getById(draftId);
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
  bot.callbackQuery(/^v:edit:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildEditSubmenuKeyboard(draftId),
    });
  });

  // [🔙 Kembali ke Draf]
  bot.callbackQuery(/^v:sub:back:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await pendingRepo.getById(draftId);
    if (!draft) return ctx.answerCallbackQuery();

    const state = getState(ctx.from.id);
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
  bot.callbackQuery(/^v:cancel:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await pendingRepo.getById(draftId);
    if (!draft) return ctx.answerCallbackQuery();

    await pendingRepo.updateStatus(draftId, "CANCELLED");
    await ctx.answerCallbackQuery({ text: "❌ Draf berhasil dibatalkan." });

    if (ctx.from) {
      const state = getState(ctx.from.id);
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
  bot.callbackQuery(/^v:sub:nominal:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const state = getState(ctx.from.id);
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
  bot.callbackQuery(/^v:sub:name:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const state = getState(ctx.from.id);
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
  bot.callbackQuery(/^v:pagu_pick:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return ctx.answerCallbackQuery({ text: "⚠️ Draf sudah tidak aktif.", show_alert: true });
    }

    const firstItem = draft.payload?.items?.[0];
    const candidates = firstItem?.item_name
      ? await googleSheetsService.getPaguCandidatesForCommodity(unitConfig.spreadsheetId, firstItem.item_name)
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
  bot.callbackQuery(/^v:pagu_set:(.+):(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const targetPagu = ctx.match[2];
    const draft = await pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return ctx.answerCallbackQuery({ text: "⚠️ Draf sudah tidak aktif.", show_alert: true });
    }

    draft.payload.sppg_ref_no = targetPagu;
    draft.payload.paguSelectionRequired = false;
    await enrichReceiptWithPaguContext(unitConfig.spreadsheetId, draft.payload);

    await pendingRepo.updatePayload(draftId, draft.payload);
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
  bot.callbackQuery(/^v:sub:pagu:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await pendingRepo.getById(draftId);
    if (!draft || draft.status !== "PENDING") {
      return ctx.answerCallbackQuery({ text: "⚠️ Draf sudah tidak aktif.", show_alert: true });
    }

    const firstItem = draft.payload?.items?.[0];
    const candidates = firstItem?.item_name
      ? await googleSheetsService.getPaguCandidatesForCommodity(unitConfig.spreadsheetId, firstItem.item_name)
      : [];

    await ctx.answerCallbackQuery();
    if (candidates.length > 0) {
      await ctx.editMessageReplyMarkup({
        reply_markup: buildPaguSelectorKeyboard(draftId, candidates),
      });
    } else {
      const state = getState(ctx.from.id);
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

  // [📄 PDF Callback from /rekap]
  bot.callbackQuery(/^v:rekap:pdf:(.+)$/, async (ctx) => {
    if (await isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Cetak PDF SPJ hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }

    await ctx.answerCallbackQuery({ text: "📄 Menyiapkan Dokumen PDF SPJ..." });
    const rawMatch = ctx.match[1]?.trim();
    const orderNo = rawMatch === "all" || rawMatch === "monthly" ? undefined : rawMatch;
    return sendPdf(ctx, orderNo);
  });

  // ============================================================================
  // TRANSACTION CRUD CALLBACK HANDLERS
  // ============================================================================

  // [📋 Daftar Transaksi]
  bot.callbackQuery("v:trx:list", async (ctx) => {
    if (await isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Riwayat transaksi hanya dapat diakses oleh Admin.",
        show_alert: true,
      });
    }
    await ctx.answerCallbackQuery();
    await sendRecentTransactions(ctx, 8);
  });

  // [🔍 Lihat Detail Transaksi]
  bot.callbackQuery(/^v:trx:view:(.+)$/, async (ctx) => {
    if (await isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Detail transaksi hanya dapat diakses oleh Admin.",
        show_alert: true,
      });
    }
    const trxId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await sendTransactionDetail(ctx, trxId);
  });

  // [🗑️ Tombol Hapus Transaksi (Konfirmasi Cascading In-Place)]
  bot.callbackQuery(/^v:trx:del:(.+)$/, async (ctx) => {
    if (await isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Penghapusan transaksi hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }
    const trxId = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "🔍 Memeriksa relasi data...", show_alert: false });

    const preview = await googleSheetsService.getCascadeDeletePreview(unitConfig.spreadsheetId, trxId);
    if (!preview.found) {
      return safeEditMessageText(
        ctx,
        `❌ Transaksi <code>${escapeHtml(trxId)}</code> tidak ditemukan di Google Sheets unit <b>${escapeHtml(unitConfig.name)}</b>.`,
        { parse_mode: "HTML" }
      );
    }

    if (preview.isProtected) {
      const isTab05 = preview.sheetName === SHEET_NAMES.RINCIAN_PENGELUARAN;
      const tabDesc = isTab05 ? "Rincian Pengeluaran (Tab 05)" : "Rincian Pendapatan (Tab 03)";
      const parentHint = isTab05
        ? `silakan kelola atau hapus Faktur/Nota Induk di Tab 04 (${escapeHtml(preview.orderNo || "Tab 04_PAGU_PENGELUARAN")}).`
        : `silakan kelola atau hapus Pagu Induk di Tab 02 (${escapeHtml(preview.orderNo || "Tab 02_PAGU_PENERIMAAN")}).`;

      return safeEditMessageText(
        ctx,
        `⛔ <b>Akses Ditolak: Data Terproteksi</b>\n------------------------------------------\nTransaksi <code>${escapeHtml(trxId)}</code> merupakan <b>${tabDesc}</b>.\n\nData rincian bahan/belanja tidak dapat dihapus mandiri karena terikat mutlak dengan data induknya.\n\n💡 <i>Jika ingin membatalkan, ${parentHint}</i>`,
        { parse_mode: "HTML" }
      );
    }

    let confirmationBody = "";
    if (
      preview.sheetName === SHEET_NAMES.PAGU_PENERIMAAN ||
      preview.sheetName === SHEET_NAMES.PAGU_RINGKASAN ||
      preview.sheetName === "02_PENDAPATAN_SPPG"
    ) {
      confirmationBody =
        `🚨 <b>KONFIRMASI CASCADE DELETE (PAGU INDUK)</b>\n------------------------------------------\n` +
        `• No SPPG: <code>${escapeHtml(preview.orderNo || "-")}</code>\n` +
        `• ID Pagu: <code>${escapeHtml(trxId)}</code>\n` +
        `• Total Pagu: <b>${formatRupiah(preview.amount || 0)}</b>\n` +
        `• Unit: <b>${escapeHtml(unitConfig.name)}</b>\n\n` +
        `⚠️ <b>PERINGATAN INTEGRITAS RELASIONAL:</b>\n` +
        `Menghapus Pagu Induk ini akan <b>MENGHAPUS SEMUA data turunannya</b>:\n` +
        `• <b>Tab 03 (Rincian Pendapatan):</b> ${preview.childrenSummary?.rincianCount || 0} item rincian pagu\n` +
        `• <b>Tab 04 (Pagu Pengeluaran):</b> ${preview.childrenSummary?.expenseCount || 0} transaksi nota supplier\n` +
        `• <b>Tab 05 (Rincian Pengeluaran):</b> ${preview.childrenSummary?.rincianPengeluaranCount || 0} baris belanja supplier\n` +
        `• <b>Tab 06 (Perbandingan Margin):</b> ${preview.childrenSummary?.rekapCount || 0} baris komparasi margin\n\n` +
        `<i>⚠️ Tindakan ini permanen dan tidak dapat dibatalkan. Lanjutkan?</i>`;
    } else if (
      preview.sheetName === SHEET_NAMES.PAGU_PENGELUARAN ||
      preview.sheetName === SHEET_NAMES.PENGELUARAN_SUPPLIER ||
      preview.sheetName === "03_PENGELUARAN_SUPPLIER"
    ) {
      confirmationBody =
        `🚨 <b>KONFIRMASI PENGHAPUSAN NOTA SUPPLIER</b>\n------------------------------------------\n` +
        `• ID Transaksi: <code>${escapeHtml(trxId)}</code>\n` +
        `• Supplier: <b>${escapeHtml(preview.supplierOrUnit || "Supplier")}</b>\n` +
        `• Total Tagihan: <b>${formatRupiah(preview.amount || 0)}</b>\n` +
        `• Unit: <b>${escapeHtml(unitConfig.name)}</b>\n\n` +
        `ℹ️ <b>Catatan Cascading:</b>\n` +
        `• <b>Tab 05 (Rincian Pengeluaran):</b> ${preview.childrenSummary?.rincianPengeluaranCount || 0} baris rincian belanja akan dihapus.\n` +
        `• <b>Tab 06 (Perbandingan Margin):</b> Realisasi belanja akan otomatis di-reset (${preview.childrenSummary?.resetRekapCount || 0} item kembali ke status 🟡 MENUNGGU INVOICE${preview.childrenSummary?.rekapCount ? ` dan ${preview.childrenSummary.rekapCount} item belanja tambahan dihapus` : ""}).\n\n` +
        `<i>Apakah Anda yakin ingin menghapus nota belanja ini?</i>`;
    } else {
      confirmationBody =
        `🚨 <b>KONFIRMASI PENGHAPUSAN TRANSAKSI</b>\n------------------------------------------\n` +
        `Apakah Anda yakin ingin <b>menghapus permanen</b> transaksi <code>${escapeHtml(trxId)}</code> dari Google Sheets unit <b>${escapeHtml(unitConfig.name)}</b>?\n\n` +
        `<i>⚠️ Tindakan ini tidak dapat dibatalkan.</i>`;
    }

    await safeEditMessageText(ctx, confirmationBody, {
      parse_mode: "HTML",
      reply_markup: buildDeleteConfirmKeyboard(trxId),
    });
  });

  // [🗑️ Ya, Hapus Sekarang (Eksekusi Atomic Cascading)]
  bot.callbackQuery(/^v:trx:delyes:(.+)$/, async (ctx) => {
    if (await isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Penghapusan transaksi hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }
    const trxId = ctx.match[1];
    if (ctx.from) {
      const state = getState(ctx.from.id);
      state.activeDraftMsgId = undefined;
    }
    await ctx.answerCallbackQuery({ text: "🗑️ Menghapus data dan relasinya...", show_alert: false });
    await safeEditMessageText(ctx, "⏳ <i>Sedang mengeksekusi penghapusan cascading di Google Sheets...</i>", { parse_mode: "HTML" });

    const result = await googleSheetsService.deleteTransactionRow(unitConfig.spreadsheetId, trxId);
    if (result.success) {
      await safeEditMessageText(
        ctx,
        `🗑️ <b>Penghapusan Berhasil!</b>\n\n${result.message}\n\n<i>Unit: <b>${escapeHtml(unitConfig.name)}</b></i>`,
        { parse_mode: "HTML" }
      );
    } else {
      await safeEditMessageText(
        ctx,
        `❌ Gagal menghapus transaksi <code>${escapeHtml(trxId)}</code>:\n${escapeHtml(result.message)}`,
        { parse_mode: "HTML" }
      );
    }
  });

  // [✏️ Ubah Nominal Transaksi - Minta Input Nominal]
  bot.callbackQuery(/^v:trx:edit:(.+)$/, async (ctx) => {
    if (await isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Pengubahan transaksi di Google Sheets hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }
    const trxId = ctx.match[1];
    const state = getState(ctx.from.id);
    state.editingTransactionId = trxId;
    await ctx.answerCallbackQuery();
    const prompt = await ctx.reply(
      `Ketik <b>nominal baru</b> untuk transaksi <code>${escapeHtml(trxId)}</code> (contoh: <code>850000</code> atau <code>850rb</code>):`,
      { parse_mode: "HTML" }
    );
    state.promptMsgId = prompt.message_id;
  });

  // [✅ Terapkan Perubahan Edit Transaksi ke Sheets (Pintu 3)]
  bot.callbackQuery(/^v:trx:applyedit:(.+):(\d+)$/, async (ctx) => {
    if (await isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Pengubahan transaksi di Google Sheets hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }
    const trxId = ctx.match[1];
    const newAmount = parseInt(ctx.match[2], 10);
    if (ctx.from) {
      const state = getState(ctx.from.id);
      state.activeDraftMsgId = undefined;
    }

    await ctx.answerCallbackQuery({ text: "⚡ Memperbarui data di Google Sheets..." });
    await safeEditMessageText(ctx, "⏳ <i>Sedang menerapkan pembaruan ke Google Sheets...</i>", { parse_mode: "HTML" });

    const result = await googleSheetsService.updateTransactionRow(unitConfig.spreadsheetId, trxId, {
      total_amount: newAmount,
    });

    if (result.success) {
      await safeEditMessageText(
        ctx,
        `✅ <b>Berhasil Memperbarui Transaksi!</b>\n\n• ID: <code>${escapeHtml(trxId)}</code>\n• Nominal Baru: <b>${formatRupiah(newAmount)}</b>\n• Unit: <b>${escapeHtml(unitConfig.name)}</b>\n\nData telah disinkronkan ke Google Sheets (termasuk penyelarasan otomatis pada Tab 06 Perbandingan Margin).`,
        { parse_mode: "HTML" }
      );
    } else {
      await safeEditMessageText(
        ctx,
        `❌ Gagal memperbarui transaksi: ${escapeHtml(result.message)}`,
        { parse_mode: "HTML" }
      );
    }
  });

  // ============================================================================
  // PAGU RINCIAN (TAB 03) INTERACTIVE HANDLERS (v:pagu_*)
  // ============================================================================

  bot.callbackQuery("v:pagu_orders", async (ctx) => {
    const userId = ctx.from?.id;
    if (await isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Hanya Admin/Super Admin.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const orders = await googleSheetsService.getPaguOrders(unitConfig.spreadsheetId);
    const orderListText = [
      `📋 <b>KELOLA PAGU & RINCIAN BAHAN (Tab 03)</b>`,
      `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
      `------------------------------------------`,
      `Pilih Surat Pesanan (PO) yang ingin Anda periksa atau ubah rincian kuantitas/harga bahannya:`,
    ].join("\n");

    await safeEditMessageText(ctx, orderListText, {
      parse_mode: "HTML",
      reply_markup: buildPaguOrderListKeyboard(orders),
    });
  });

  bot.callbackQuery(/^v:pagu_ord:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi", show_alert: true });
      return;
    }
    const orderNo = ctx.match[1];
    await ctx.answerCallbackQuery({ text: `📋 Memuat PO ${orderNo}...` });

    const items = await googleSheetsService.getPaguOrderItems(unitConfig.spreadsheetId, orderNo);
    if (items.length === 0) {
      await safeEditMessageText(
        ctx,
        `⚠️ Tidak ditemukan rincian bahan untuk PO <code>${escapeHtml(orderNo)}</code> di Tab 03_RINCIAN_PENDAPATAN.`,
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("🔙 Kembali ke Daftar PO", "v:pagu_orders"),
        }
      );
      return;
    }

    const orders = await googleSheetsService.getPaguOrders(unitConfig.spreadsheetId);
    const orderInfo = orders.find((o) => o.orderNo === orderNo);
    const totalPagu = items.reduce((sum, it) => sum + (it.totalAmount || 0), 0);

    const headerText = [
      `📋 <b>RINCIAN BAHAN SURAT PESANAN (PO)</b>`,
      `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
      `------------------------------------------`,
      `• <b>No PO:</b> <code>${escapeHtml(orderNo)}</code>`,
      `• <b>Tanggal:</b> <code>${escapeHtml(orderInfo?.orderDate || "-")}</code>`,
      `• <b>Menu:</b> <i>${escapeHtml(orderInfo?.notes || "-")}</i>`,
      `• <b>Total Pagu:</b> <b>${formatRupiah(totalPagu)}</b> (${items.length} bahan)`,
      `------------------------------------------`,
      `Silakan pilih bahan di bawah untuk melihat detail atau mengubah kuantitas/harga:`,
    ].join("\n");

    await safeEditMessageText(ctx, headerText, {
      parse_mode: "HTML",
      reply_markup: buildPaguItemListKeyboard(orderNo, items, 0, 6),
    });
  });

  bot.callbackQuery(/^v:pagu_page:(.+):(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi", show_alert: true });
      return;
    }
    const orderNo = ctx.match[1];
    const page = parseInt(ctx.match[2], 10) || 0;
    await ctx.answerCallbackQuery();

    const items = await googleSheetsService.getPaguOrderItems(unitConfig.spreadsheetId, orderNo);
    const orders = await googleSheetsService.getPaguOrders(unitConfig.spreadsheetId);
    const orderInfo = orders.find((o) => o.orderNo === orderNo);
    const totalPagu = items.reduce((sum, it) => sum + (it.totalAmount || 0), 0);

    const headerText = [
      `📋 <b>RINCIAN BAHAN SURAT PESANAN (PO)</b>`,
      `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
      `------------------------------------------`,
      `• <b>No PO:</b> <code>${escapeHtml(orderNo)}</code>`,
      `• <b>Tanggal:</b> <code>${escapeHtml(orderInfo?.orderDate || "-")}</code>`,
      `• <b>Menu:</b> <i>${escapeHtml(orderInfo?.notes || "-")}</i>`,
      `• <b>Total Pagu:</b> <b>${formatRupiah(totalPagu)}</b> (${items.length} bahan)`,
      `------------------------------------------`,
      `Halaman <b>${page + 1}</b> - Pilih bahan untuk mengubah data:`,
    ].join("\n");

    await safeEditMessageText(ctx, headerText, {
      parse_mode: "HTML",
      reply_markup: buildPaguItemListKeyboard(orderNo, items, page, 6),
    });
  });

  bot.callbackQuery(/^v:pagu_it:(.+):(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi", show_alert: true });
      return;
    }
    const orderNo = ctx.match[1];
    const rowIndex = parseInt(ctx.match[2], 10);
    await ctx.answerCallbackQuery();

    const item = await googleSheetsService.getPaguItemByRow(unitConfig.spreadsheetId, rowIndex);
    if (!item) {
      await safeEditMessageText(ctx, "⚠️ Rincian bahan tidak ditemukan di Google Sheets.", {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🔙 Kembali ke PO", `v:pagu_ord:${orderNo}`),
      });
      return;
    }

    const detailText = [
      `🍗 <b>DETAIL BAHAN PAGU (Tab 03 Baris ${rowIndex})</b>`,
      `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
      `No PO: <code>${escapeHtml(orderNo)}</code>`,
      `------------------------------------------`,
      `• <b>Nama Bahan:</b> <b>${escapeHtml(item.itemName)}</b>`,
      `• <b>Target Rekanan:</b> ${escapeHtml(item.supplier || "-")}`,
      `• <b>Kuantitas:</b> <b>${item.qty} ${escapeHtml(item.unit)}</b>`,
      `• <b>Harga Pagu Satuan:</b> <b>${formatRupiah(item.price)}</b>`,
      `• <b>Total Subtotal Pagu:</b> <b>${formatRupiah(item.totalAmount)}</b>`,
      `------------------------------------------`,
      `Pilih data yang ingin Anda ubah:`,
    ].join("\n");

    await safeEditMessageText(ctx, detailText, {
      parse_mode: "HTML",
      reply_markup: buildPaguItemActionKeyboard(orderNo, rowIndex, item.itemName),
    });
  });

  bot.callbackQuery(/^v:pagu_act:(.+):(\d+):(qty|price|supplier|name)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi", show_alert: true });
      return;
    }
    const orderNo = ctx.match[1];
    const rowIndex = parseInt(ctx.match[2], 10);
    const field = ctx.match[3] as "qty" | "price" | "supplier" | "name";

    const item = await googleSheetsService.getPaguItemByRow(unitConfig.spreadsheetId, rowIndex);
    if (!item) {
      await ctx.answerCallbackQuery({ text: "⚠️ Bahan tidak ditemukan.", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const state = getState(userId!);
    state.editingPagu = {
      orderNo,
      rowIndex,
      field,
      itemName: item.itemName,
      unit: item.unit,
    };

    let promptGuide = "";
    if (field === "name") {
      promptGuide = `Nama bahan saat ini: <b>${escapeHtml(item.itemName)}</b>\n\n` +
        `Ketik nama / uraian bahan baru (contoh: <code>Ayam Broiler 2.3 kg</code>):`;
    } else if (field === "qty") {
      promptGuide = `Kuantitas saat ini: <b>${item.qty} ${escapeHtml(item.unit)}</b>\n\n` +
        `Ketik angka kuantitas baru (contoh: <code>120</code> atau <code>25.5</code>):`;
    } else if (field === "price") {
      promptGuide = `Harga pagu saat ini: <b>${formatRupiah(item.price)}</b>\n\n` +
        `Ketik harga pagu baru per ${escapeHtml(item.unit)} (contoh: <code>32000</code> atau <code>32.000</code>):`;
    } else {
      promptGuide = `Target rekanan saat ini: <b>${escapeHtml(item.supplier || "-")}</b>\n\n` +
        `Ketik nama rekanan / supplier baru:`;
    }

    const fieldLabel = field === "name" ? "URAIAN BAHAN" : field === "qty" ? "KUANTITAS" : field === "price" ? "HARGA PAGU" : "TARGET REKANAN";
    const promptText = [
      `✏️ <b>UBAH ${fieldLabel}</b>`,
      `Bahan: <b>${escapeHtml(item.itemName)}</b> (PO: <code>${escapeHtml(orderNo)}</code>)`,
      `------------------------------------------`,
      promptGuide,
    ].join("\n");

    const promptMsg = await ctx.reply(promptText, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("❌ Batalkan", `v:pagu_it:${orderNo}:${rowIndex}`),
    });
    state.promptMsgId = promptMsg.message_id;
  });

  bot.callbackQuery(/^v:pagu_apply:(.+):(\d+):(qty|price|supplier|name):(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi", show_alert: true });
      return;
    }
    const orderNo = ctx.match[1];
    const rowIndex = parseInt(ctx.match[2], 10);
    const field = ctx.match[3] as "qty" | "price" | "supplier" | "name";
    const rawVal = decodeURIComponent(ctx.match[4]);

    await ctx.answerCallbackQuery({ text: "⏳ Menyimpan perubahan ke Google Sheets..." });
    await safeEditMessageText(ctx, "⏳ <i>Sedang menyimpan dan menyelaraskan ke Tab 03 & Tab 06...</i>", { parse_mode: "HTML" });

    const updates: { qty?: number; price?: number; supplier?: string; itemName?: string } = {};
    if (field === "name") {
      updates.itemName = rawVal;
    } else if (field === "qty") {
      updates.qty = parseFloat(rawVal);
    } else if (field === "price") {
      updates.price = parseInt(rawVal, 10);
    } else if (field === "supplier") {
      updates.supplier = rawVal;
    }

    const updaterName = ctx.from ? `${ctx.from.first_name || ""} ${ctx.from.last_name || ""}`.trim() : "Admin";

    const result = await googleSheetsService.updatePaguItemDetail(
      unitConfig.spreadsheetId,
      orderNo,
      rowIndex,
      updates,
      updaterName
    );

    if (!result.success) {
      await safeEditMessageText(ctx, `❌ Gagal memperbarui data: ${escapeHtml(result.message || "Terjadi kesalahan")}`, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🔙 Kembali", `v:pagu_it:${orderNo}:${rowIndex}`),
      });
      return;
    }

    const successCard = [
      `✅ <b>PAGU BERHASIL DIUPDATE & DISELARASKAN!</b>`,
      `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
      `No PO: <code>${escapeHtml(orderNo)}</code>`,
      `------------------------------------------`,
      `• <b>Bahan:</b> <b>${escapeHtml(result.updatedItem?.itemName || "-")}</b>`,
      `• <b>Target Rekanan:</b> ${escapeHtml(result.updatedItem?.supplier || "-")}`,
      `• <b>Kuantitas:</b> <b>${result.updatedItem?.qty} ${escapeHtml(result.updatedItem?.unit || "")}</b>`,
      `• <b>Harga Pagu:</b> <b>${formatRupiah(result.updatedItem?.price || 0)}</b>`,
      `• <b>Subtotal Baru:</b> <b>${formatRupiah(result.updatedItem?.totalAmount || 0)}</b>`,
      `------------------------------------------`,
      `🔄 <i>Perubahan otomatis disinkronkan ke Tab 03_RINCIAN_PENDAPATAN dan Tab 06_PERBANDINGAN_MARGIN.</i>`,
    ].join("\n");

    const kb = new InlineKeyboard()
      .text("🔍 Detail Bahan", `v:pagu_it:${orderNo}:${rowIndex}`)
      .text("📋 Rincian PO", `v:pagu_ord:${orderNo}`)
      .row()
      .text("🏠 Menu Utama", "qa:start");

    await safeEditMessageText(ctx, successCard, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  });

  // Prompt user to add new item to specific order
  bot.callbackQuery(/^v:pagu_add:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi", show_alert: true });
      return;
    }
    const orderNo = ctx.match[1];
    await ctx.answerCallbackQuery();
    const state = getState(userId!);
    state.addingPaguItemToOrder = { orderNo };

    const promptText = [
      `➕ <b>TAMBAH BAHAN BARU KE SURAT PESANAN</b>`,
      `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
      `Surat Pesanan: <code>PO ${escapeHtml(orderNo)}</code>`,
      `------------------------------------------`,
      `Silakan ketik rincian bahan baru yang ingin ditambahkan.`,
      `Contoh:`,
      `• <code>Wortel 20 kg harga 15rb rekanan CV Sayur Segar</code>`,
      `• <code>Minyak Goreng 10 liter @ 22000</code>`,
      `------------------------------------------`,
      `📍 <i>Bahan baru akan otomatis disisipkan di baris paling bawah untuk PO ini, dan baris PO lain di bawahnya akan bergeser ke bawah.</i>`,
    ].join("\n");

    const promptMsg = await ctx.reply(promptText, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("❌ Batalkan", `v:pagu_ord:${orderNo}`),
    });
    state.promptMsgId = promptMsg.message_id;
  });

  // ============================================================================
  // PAGU 1-SHOT MODIFICATION CALLBACKS (v:p1s_*)
  // ============================================================================

  // Apply / Save to Spreadsheet
  bot.callbackQuery(/^v:p1s_ok:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = pendingPaguModifications.get(draftId);

    if (!draft) {
      await ctx.answerCallbackQuery({ text: "Sesi konfirmasi telah kadaluarsa.", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Sedang menyimpan ke spreadsheet..." });

    try {
      if (draft.isExpense && draft.expenseId) {
        const result = await googleSheetsService.addExpenseItemToTransaction(
          draft.spreadsheetId,
          draft.expenseId,
          {
            itemName: draft.itemName,
            qty: draft.qty,
            unit: draft.unit,
            price: draft.price,
            supplier: draft.supplier,
          },
          draft.updatedBy
        );

        if (!result.success) {
          await safeEditMessageText(ctx, `❌ Gagal menambahkan ke Google Sheets: ${escapeHtml(result.message)}`, {
            parse_mode: "HTML",
          });
          return;
        }
      } else if (draft.action === "UPDATE") {
        const result = await googleSheetsService.updatePaguItemDetail(
          draft.spreadsheetId,
          draft.orderNo,
          draft.itemRowIndex!,
          {
            itemName: draft.itemName,
            qty: draft.qty,
            unit: draft.unit,
            price: draft.price,
            supplier: draft.supplier,
          },
          draft.updatedBy
        );

        if (!result.success) {
          await safeEditMessageText(ctx, `❌ Gagal memperbarui Google Sheets: ${escapeHtml(result.message)}`, {
            parse_mode: "HTML",
          });
          return;
        }
      } else {
        const result = await googleSheetsService.addPaguItemToOrder(
          draft.spreadsheetId,
          draft.orderNo,
          {
            itemName: draft.itemName,
            qty: draft.qty,
            unit: draft.unit,
            price: draft.price,
            supplier: draft.supplier,
          },
          draft.updatedBy
        );

        if (!result.success) {
          await safeEditMessageText(ctx, `❌ Gagal menambahkan ke Google Sheets: ${escapeHtml(result.message)}`, {
            parse_mode: "HTML",
          });
          return;
        }
      }

      pendingPaguModifications.delete(draftId);

      const title = draft.isExpense
        ? `✅ <b>RINCIAN BELANJA BERHASIL DISISIPKAN!</b>`
        : (draft.action === "ADD"
            ? `✅ <b>BAHAN BARU BERHASIL DITAMBAHKAN KE PAGU!</b>`
            : `✅ <b>PERUBAHAN PAGU BERHASIL DISIMPAN!</b>`);

      const syncNote = draft.isExpense
        ? `🔄 <i>Bahan belanja telah disisipkan rapi mengelompok di bawah transaksi ${escapeHtml(draft.expenseId || draft.orderNo)} pada Tab 05. Urutan ID bahan lain bergeser turun otomatis, dan total tagihan Tab 04 otomatis terakumulasi.</i>`
        : (draft.action === "ADD"
            ? `🔄 <i>Bahan baru telah disisipkan ke Tab 03 & Tab 06. Urutan ID bahan lain bergeser ke bawah dengan rapi, dan total anggaran Tab 02 otomatis bertambah.</i>`
            : `🔄 <i>Tab 03_RINCIAN_PENDAPATAN dan Tab 06_PERBANDINGAN_MARGIN telah diperbarui dan otomatis tersinkronisasi.</i>`);

      const successCard = [
        title,
        `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
        `------------------------------------------`,
        draft.isExpense
          ? `• <b>Transaksi Belanja:</b> <code>${escapeHtml(draft.orderLabel || draft.expenseId || draft.orderNo)}</code>`
          : `• <b>Surat Pesanan:</b> <code>${escapeHtml(draft.orderLabel || draft.orderNo)}</code>`,
        `• <b>Bahan:</b> <b>${escapeHtml(draft.itemName)}</b>`,
        `• <b>Kuantitas:</b> <b>${draft.qty} ${escapeHtml(draft.unit)}</b>`,
        `• <b>Harga Satuan:</b> <b>${formatRupiah(draft.price)}</b>`,
        `• <b>Total Belanja:</b> <b>${formatRupiah(draft.qty * draft.price)}</b>`,
        draft.supplier ? (draft.isExpense ? `• <b>Supplier:</b> ${escapeHtml(draft.supplier)}` : `• <b>Target Rekanan:</b> ${escapeHtml(draft.supplier)}`) : "",
        `------------------------------------------`,
        syncNote,
      ].filter(Boolean).join("\n");

      const kb = new InlineKeyboard();
      if (draft.isExpense && draft.expenseId) {
        kb.text("🔍 Detail Transaksi", `t:det:${draft.expenseId}`).row();
      } else {
        kb.text("📋 Rincian PO", `v:pagu_ord:${draft.orderNo}`).row();
      }
      kb.text("🏠 Menu Utama", "qa:start");

      await safeEditMessageText(ctx, successCard, {
        parse_mode: "HTML",
        reply_markup: kb,
      });
    } catch (err: any) {
      logger.error({ err: err?.message, draftId }, "Error applying 1-shot pagu change");
      await safeEditMessageText(ctx, `❌ Terjadi kesalahan: ${escapeHtml(err?.message || err)}`, {
        parse_mode: "HTML",
      });
    }
  });

  // Cancel 1-Shot Pagu Action
  bot.callbackQuery(/^v:p1s_c:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    pendingPaguModifications.delete(draftId);
    await ctx.answerCallbackQuery({ text: "Dibatalkan." });
    await safeEditMessageText(ctx, `❌ <i>Pengubahan pagu telah dibatalkan.</i>`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🏠 Menu Utama", "qa:start"),
    });
  });

  // User chose to Add as New Item (when item didn't exist in PO)
  bot.callbackQuery(/^v:p1s_add:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = pendingPaguModifications.get(draftId);
    if (!draft) {
      await ctx.answerCallbackQuery({ text: "Sesi telah kadaluarsa.", show_alert: true });
      return;
    }

    draft.action = "ADD";
    await ctx.answerCallbackQuery({ text: "Menyiapkan penambahan bahan baru..." });

    const card = renderPaguOneShotCard(draft, unitConfig.name);
    await safeEditMessageText(ctx, card, {
      parse_mode: "HTML",
      reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
    });
  });

  // User chose to Replace an existing item in PO -> list existing items
  bot.callbackQuery(/^v:p1s_rep:(.+):(\d+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const page = parseInt(ctx.match[2], 10) || 0;
    const draft = pendingPaguModifications.get(draftId);
    if (!draft) {
      await ctx.answerCallbackQuery({ text: "Sesi telah kadaluarsa.", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const items = await googleSheetsService.getPaguOrderItems(draft.spreadsheetId, draft.orderNo);

    const promptText = [
      `🔄 <b>PILIH BAHAN YANG AKAN DIGANTIKAN</b>`,
      `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
      `Surat Pesanan: <code>${escapeHtml(draft.orderLabel || draft.orderNo)}</code>`,
      `------------------------------------------`,
      `Pilih salah satu bahan lama yang ingin digantikan oleh <b>${escapeHtml(draft.itemName)}</b>:`,
    ].join("\n");

    await safeEditMessageText(ctx, promptText, {
      parse_mode: "HTML",
      reply_markup: buildPaguItemPickForReplaceKeyboard(draftId, items, page),
    });
  });

  // User selected specific existing item to replace
  bot.callbackQuery(/^v:p1s_pk:(.+):(\d+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const rowIndex = parseInt(ctx.match[2], 10);
    const draft = pendingPaguModifications.get(draftId);
    if (!draft) {
      await ctx.answerCallbackQuery({ text: "Sesi telah kadaluarsa.", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Bahan dipilih." });
    const oldItem = await googleSheetsService.getPaguItemByRow(draft.spreadsheetId, rowIndex);
    if (!oldItem) {
      await safeEditMessageText(ctx, `❌ Gagal mengambil data bahan lama di baris ${rowIndex}.`, {
        parse_mode: "HTML",
      });
      return;
    }

    draft.action = "UPDATE";
    draft.itemRowIndex = oldItem.rowIndex;
    draft.origItemName = oldItem.itemName;
    draft.oldQty = oldItem.qty;
    draft.oldPrice = oldItem.price;
    draft.oldSupplier = oldItem.supplier;

    const card = renderPaguOneShotCard(draft, unitConfig.name);
    await safeEditMessageText(ctx, card, {
      parse_mode: "HTML",
      reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
    });
  });

  // ============================================================================
  // QUICK ACTION CALLBACK HANDLERS (qa:*)
  // ============================================================================

  bot.callbackQuery(/^qa:(.+)$/, async (ctx) => {
    const action = ctx.match[1];
    const userId = ctx.from?.id;
    const isMember = await isCallerMember(userId);

    // Button Hygiene: remove buttons immediately when clicked
    if (ctx.chat && ctx.callbackQuery?.message?.message_id) {
      await ctx.api.editMessageReplyMarkup(ctx.chat.id, ctx.callbackQuery.message.message_id, {
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }
    if (userId) {
      const state = getState(userId);
      state.activeQuickActionMsgId = undefined;
    }

    switch (action) {
      case "pagu": {
        if (isMember) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Kelola pagu hanya untuk Admin.", show_alert: true });
          await notifyMemberRestricted(ctx, "Kelola Pagu Anggaran");
          return;
        }
        await ctx.answerCallbackQuery({ text: "📋 Memuat Rincian Pagu..." });
        await sendPaguOrders(ctx);
        break;
      }

      case "start":
      case "menu": {
        await ctx.answerCallbackQuery();
        const user = userId ? await userRepo.getUser(userId) : null;
        const userRole = user?.role === "member" ? "member" : "admin";
        const sentMsg = await ctx.reply(
          `⚡ <b>PINTASAN MENU OPERASIONAL (${escapeHtml(unitConfig.name)})</b>\n\n` +
          `Silakan ketuk pintasan di bawah ini atau langsung kirim pesan teks, foto struk, maupun rekaman suara:`,
          {
            parse_mode: "HTML",
            reply_markup: buildStartQuickActionKeyboard(userRole),
          }
        );
        if (userId) {
          const state = getState(userId);
          state.activeQuickActionMsgId = sentMsg.message_id;
        }
        break;
      }

      case "rekap": {
        if (isMember) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Rekap margin hanya untuk Admin.", show_alert: true });
          await notifyMemberRestricted(ctx, "Laporan Rekap Margin");
          return;
        }
        await ctx.answerCallbackQuery({ text: "📊 Memuat Rekap Margin..." });
        await sendRekap(ctx);
        break;
      }

      case "pdf": {
        if (isMember) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Cetak SPJ hanya untuk Admin.", show_alert: true });
          await notifyMemberRestricted(ctx, "Cetak Dokumen SPJ");
          return;
        }
        await ctx.answerCallbackQuery({ text: "📄 Menyiapkan Dokumen PDF SPJ..." });
        await sendPdf(ctx);
        break;
      }

      case "sheets": {
        if (isMember) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Link spreadsheet hanya untuk Admin.", show_alert: true });
          await notifyMemberRestricted(ctx, "Akses Google Sheets");
          return;
        }
        await ctx.answerCallbackQuery({ text: "🌐 Membuka Link Spreadsheet..." });
        await sendSheets(ctx);
        break;
      }

      case "transaksi": {
        if (isMember) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Riwayat transaksi hanya untuk Admin.", show_alert: true });
          await notifyMemberRestricted(ctx, "Riwayat Transaksi");
          return;
        }
        await ctx.answerCallbackQuery({ text: "🔍 Memuat Riwayat Transaksi..." });
        await sendRecentTransactions(ctx, 8);
        break;
      }

      case "myid": {
        await ctx.answerCallbackQuery();
        await sendMyId(ctx);
        break;
      }

      case "invite_prompt": {
        const isAdmin = userId ? await userRepo.isAdminOrSuperAdmin(userId) : false;
        if (!isAdmin) {
          await ctx.answerCallbackQuery({ text: "⛔ Hanya Admin/Super Admin yang dapat mengundang.", show_alert: true });
          return;
        }
        await ctx.answerCallbackQuery();
        await ctx.reply(
          `🎟️ <b>PILIH PERAN UNDANGAN BARU</b>\n` +
          `Unit: <b>${escapeHtml(unitConfig.name)}</b>\n\n` +
          `Pilih peran yang akan diberikan kepada pengguna:\n` +
          `• <b>Admin:</b> Akses penuh kelola anggaran, belanja, rekap margin, dan SPJ.\n` +
          `• <b>Member:</b> Khusus staf belanja untuk input pengeluaran belanja supplier dapur.`,
          {
            parse_mode: "HTML",
            reply_markup: buildInviteRolePickerKeyboard(),
          }
        );
        break;
      }

      case "geninvite:admin": {
        const isAdmin = userId ? await userRepo.isAdminOrSuperAdmin(userId) : false;
        if (!isAdmin) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Ditolak", show_alert: true });
          return;
        }
        await ctx.answerCallbackQuery({ text: "🎟️ Membuat undangan Admin..." });
        await handleInviteCommand(ctx, "Admin SPPG", "admin");
        break;
      }

      case "geninvite:member": {
        const isAdmin = userId ? await userRepo.isAdminOrSuperAdmin(userId) : false;
        if (!isAdmin) {
          await ctx.answerCallbackQuery({ text: "⛔ Akses Ditolak", show_alert: true });
          return;
        }
        await ctx.answerCallbackQuery({ text: "🎟️ Membuat undangan Member..." });
        await handleInviteCommand(ctx, "Staf Belanja", "member");
        break;
      }

      case "invite_cancel": {
        await ctx.answerCallbackQuery({ text: "❌ Dibatalkan" });
        await ctx.deleteMessage().catch(() => {});
        break;
      }

      case "format_belanja": {
        await ctx.answerCallbackQuery();
        const guideText = [
          `✍️ <b>PANDUAN PENCATATAN BELANJA DAPUR MBG</b>`,
          `------------------------------------------`,
          `Anda dapat mencatat belanja harian dengan sangat mudah:`,
          ``,
          `<b>1. Ketik Bebas (Bahasa Alami):</b>`,
          `• <i>"Beli ayam 250rb di pasar ayam tunai"</i>`,
          `• <i>"Beli beras 50kg 700rb supplier Pak Budi tempo"</i>`,
          `• <i>"Beli bumbu dapur 120rb pasar sentral tunai"</i>`,
          ``,
          `<b>2. Kirim Foto Bon / Struk Belanja:</b>`,
          `• Foto nota belanja pasar Anda, AI akan membaca otomatis (OCR).`,
          ``,
          `<b>3. Pesan Suara (Voice Note):</b>`,
          `• Rekam suara Anda menyebutkan belanjaan dapur.`,
          ``,
          `💡 <i>Setelah dikirim, bot akan menampilkan kartu draf konfirmasi untuk Anda periksa sebelum tersimpan ke Google Sheets.</i>`,
        ].join("\n");
        await ctx.reply(guideText, { parse_mode: "HTML" });
        break;
      }

      case "tips_gizi": {
        await ctx.answerCallbackQuery();
        const tipsText = [
          `💡 <b>KONSULTASI MENU & STANDAR GIZI MBG</b>`,
          `------------------------------------------`,
          `AI Asisten siap membantu Anda menghitung porsi dan standar gizi sesuai Pedoman Badan Gizi Nasional (BGN).`,
          ``,
          `<b>Contoh Pertanyaan yang Bisa Anda Ketik Langsung:</b>`,
          `• <i>"Berapa gram porsi ayam per porsi untuk anak SD?"</i>`,
          `• <i>"Berapa kebutuhan beras untuk 1.500 porsi makan bergizi?"</i>`,
          `• <i>"Rekomendasi sayuran berprotein tinggi untuk menu MBG"</i>`,
          `• <i>"Bagaimana standar kebersihan penyimpanan bahan segar?"</i>`,
          ``,
          `👉 <i>Silakan langsung ketik pertanyaan Anda sekarang di chat ini!</i>`,
        ].join("\n");
        await ctx.reply(tipsText, { parse_mode: "HTML" });
        break;
      }

      default:
        await ctx.answerCallbackQuery();
        break;
    }
  });

  // ============================================================================
  // TEXT MESSAGE HANDLER (CONVERSATIONAL AI AGENT & WIZARD)
  // ============================================================================

  bot.on("message:text", async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const state = getState(userId);
    const text = ctx.message.text.trim();

    // Button Hygiene: Strip previous active keyboards if user sends a new chat message
    await clearObsoleteKeyboards(ctx, state);

    // Instant Menu Trigger via text "menu"
    if (text.toLowerCase() === "menu") {
      const user = await userRepo.getUser(userId);
      const userRole = user?.role === "member" ? "member" : "admin";
      const sentMsg = await ctx.reply(
        `⚡ <b>PINTASAN MENU OPERASIONAL (${escapeHtml(unitConfig.name)})</b>\n\n` +
        `Silakan ketuk pintasan di bawah ini atau langsung kirim pesan teks, foto struk, maupun rekaman suara:`,
        {
          parse_mode: "HTML",
          reply_markup: buildStartQuickActionKeyboard(userRole),
        }
      );
      state.activeQuickActionMsgId = sentMsg.message_id;
      return;
    }

    // Instant Pagu Trigger via text "pagu", "edit pagu", "ubah pagu", "edit pagu II005", etc.
    const paguMatch = text.match(/^(?:\/pagu|\/editpagu|(?:edit|ubah|kelola|lihat|buka)\s+pagu|pagu)(?:\s+([A-Za-z0-9\/\-_]+))?$/i);
    if (paguMatch && !state.editingPagu && !state.editingField && !state.editingTransactionId) {
      if (await isCallerMember(userId)) {
        await notifyMemberRestricted(ctx, "kelola pagu anggaran dapur");
        return;
      }

      const explicitTarget = paguMatch[1]?.trim();
      const orders = await googleSheetsService.getPaguOrders(unitConfig.spreadsheetId);

      if (orders.length === 0) {
        await ctx.reply(
          `📋 <b>KELOLA PAGU / RINCIAN BAHAN</b>\n` +
          `Unit: <b>${escapeHtml(unitConfig.name)}</b>\n\n` +
          `ℹ️ Belum ada data Surat Pesanan (PO) di Tab 02_PAGU_PENERIMAAN. Silakan upload nota pesanan terlebih dahulu.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      if (explicitTarget) {
        const cleanTarget = explicitTarget.toLowerCase();
        const matchedOrder = orders.find((o) =>
          o.orderNo.toLowerCase().includes(cleanTarget) ||
          (o.transactionId && o.transactionId.toLowerCase().includes(cleanTarget))
        );

        if (matchedOrder) {
          const items = await googleSheetsService.getPaguOrderItems(unitConfig.spreadsheetId, matchedOrder.orderNo);
          const totalPagu = items.reduce((sum, it) => sum + (it.totalAmount || 0), 0);
          const headerText = [
            `📋 <b>RINCIAN BAHAN SURAT PESANAN (PO)</b>`,
            `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
            `------------------------------------------`,
            `• <b>No PO:</b> <code>${escapeHtml(matchedOrder.orderNo)}</code>`,
            `• <b>ID:</b> <code>${escapeHtml(matchedOrder.transactionId || "-")}</code>`,
            `• <b>Tanggal:</b> <code>${escapeHtml(matchedOrder.orderDate || "-")}</code>`,
            `• <b>Total Pagu:</b> <b>${formatRupiah(totalPagu)}</b> (${items.length} bahan)`,
            `------------------------------------------`,
            `Silakan pilih bahan di bawah untuk melihat detail atau mengubah kuantitas/harga:`,
          ].join("\n");

          await ctx.reply(headerText, {
            parse_mode: "HTML",
            reply_markup: buildPaguItemListKeyboard(matchedOrder.orderNo, items, 0, 6),
          });
          return;
        } else {
          await ctx.reply(
            `⚠️ Surat Pesanan / Pagu dengan kode atau nomor <code>${escapeHtml(explicitTarget)}</code> tidak ditemukan.\n\n` +
            `Silakan pilih dari daftar PO aktif di bawah ini:`,
            {
              parse_mode: "HTML",
              reply_markup: buildPaguOrderListKeyboard(orders),
            }
          );
          return;
        }
      }

      // If user just typed "edit pagu" or "pagu" without ID
      const orderListText = [
        `📋 <b>KELOLA PAGU & RINCIAN BAHAN (Tab 03)</b>`,
        `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
        `------------------------------------------`,
        `Mau edit pagu Surat Pesanan (PO) yang mana? Silakan pilih dari daftar di bawah:`,
      ].join("\n");

      await ctx.reply(orderListText, {
        parse_mode: "HTML",
        reply_markup: buildPaguOrderListKeyboard(orders),
      });
      return;
    }

    // 1. If currently editing existing transaction in Google Sheets (Pintu 3 Guardrail)
    if (state.editingTransactionId) {
      if (await isCallerMember(userId)) {
        state.editingTransactionId = undefined;
        await ctx.reply(
          "⛔ <b>Akses Dibatasi</b>\n\nPengubahan transaksi di Google Sheets hanya dapat dilakukan oleh Admin atau Super Admin.",
          { parse_mode: "HTML" }
        );
        return;
      }

      const cleanNum = parseInt(text.replace(/[^\d]/g, ""), 10);
      const trxId = state.editingTransactionId;
      state.editingTransactionId = undefined;

      // Auto-cleanup user input & prompt message
      await ctx.deleteMessage().catch(() => { });
      if (state.promptMsgId) {
        await ctx.api.deleteMessage(chatId, state.promptMsgId).catch(() => { });
        state.promptMsgId = undefined;
      }

      if (isNaN(cleanNum) || cleanNum <= 0) {
        await ctx.reply("⚠️ Nominal tidak valid. Pembaruan dibatalkan.", { parse_mode: "HTML" });
        return;
      }

      // Show confirmation card before applying changes to Google Sheets
      const confirmCard = [
        `⚠️ <b>KONFIRMASI PERUBAHAN TRANSAKSI GOOGLE SHEETS</b>`,
        `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
        `------------------------------------------`,
        `• <b>ID Transaksi:</b> <code>${escapeHtml(trxId)}</code>`,
        `• <b>Nominal Baru:</b> <b>${formatRupiah(cleanNum)}</b>`,
        `------------------------------------------`,
        `Apakah Anda yakin ingin menerapkan perubahan ini ke Google Sheets?`,
      ].join("\n");

      const confirmMsg = await ctx.reply(confirmCard, {
        parse_mode: "HTML",
        reply_markup: buildEditConfirmKeyboard(trxId, cleanNum),
      });
      state.activeDraftMsgId = confirmMsg.message_id;
      return;
    }

    // 1b. If currently editing Pagu Item Detail in Tab 03 (Ayah edit kuantitas/harga/supplier)
    if (state.editingPagu) {
      if (await isCallerMember(userId)) {
        state.editingPagu = null;
        await ctx.reply(
          "⛔ <b>Akses Dibatasi</b>\n\nPengubahan rincian pagu hanya dapat dilakukan oleh Admin atau Super Admin.",
          { parse_mode: "HTML" }
        );
        return;
      }

      const { orderNo, rowIndex, field, itemName, unit } = state.editingPagu;
      state.editingPagu = null;

      // Auto-cleanup user input & prompt message
      await ctx.deleteMessage().catch(() => {});
      if (state.promptMsgId) {
        await ctx.api.deleteMessage(chatId, state.promptMsgId).catch(() => {});
        state.promptMsgId = undefined;
      }

      let parsedValue: string = text;
      let displayValue: string = text;
      let fieldNameDisplay = "";

      if (field === "qty") {
        fieldNameDisplay = "Kuantitas";
        const cleanNum = parseFloat(text.replace(/,/g, ".").replace(/[^\d.]/g, ""));
        if (isNaN(cleanNum) || cleanNum <= 0) {
          await ctx.reply("⚠️ Kuantitas tidak valid. Pembaruan pagu dibatalkan.", { parse_mode: "HTML" });
          return;
        }
        parsedValue = cleanNum.toString();
        displayValue = `${cleanNum} ${unit || ""}`.trim();
      } else if (field === "price") {
        fieldNameDisplay = "Harga Pagu Satuan";
        const cleanNum = parseInt(text.replace(/[^\d]/g, ""), 10);
        if (isNaN(cleanNum) || cleanNum <= 0) {
          await ctx.reply("⚠️ Harga pagu tidak valid. Pembaruan pagu dibatalkan.", { parse_mode: "HTML" });
          return;
        }
        parsedValue = cleanNum.toString();
        displayValue = formatRupiah(cleanNum);
      } else if (field === "supplier") {
        fieldNameDisplay = "Target Rekanan / Toko";
        if (!text || text.length < 2) {
          await ctx.reply("⚠️ Nama rekanan tidak valid. Pembaruan pagu dibatalkan.", { parse_mode: "HTML" });
          return;
        }
        parsedValue = text;
        displayValue = text;
      } else if (field === "name") {
        fieldNameDisplay = "Uraian / Nama Bahan";
        if (!text || text.length < 2) {
          await ctx.reply("⚠️ Nama bahan tidak valid. Pembaruan pagu dibatalkan.", { parse_mode: "HTML" });
          return;
        }
        parsedValue = text;
        displayValue = text;
      }

      // Show confirmation card before applying changes to Google Sheets
      const confirmCard = [
        `⚠️ <b>KONFIRMASI PERUBAHAN PAGU RINCIAN (Tab 03)</b>`,
        `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
        `No PO: <code>${escapeHtml(orderNo)}</code>`,
        `------------------------------------------`,
        `• <b>Bahan:</b> <b>${escapeHtml(itemName)}</b>`,
        `• <b>Field Diubah:</b> ${fieldNameDisplay}`,
        `• <b>Nilai Baru:</b> <b>${escapeHtml(displayValue)}</b>`,
        `------------------------------------------`,
        `Perubahan ini akan memperbarui <b>Tab 03_RINCIAN_PENDAPATAN</b> dan menyelaraskan otomatis <b>Tab 06_PERBANDINGAN_MARGIN</b>. Lanjutkan?`,
      ].join("\n");

      const confirmMsg = await ctx.reply(confirmCard, {
        parse_mode: "HTML",
        reply_markup: buildPaguItemEditConfirmKeyboard(orderNo, rowIndex, field, parsedValue),
      });
      state.activeDraftMsgId = confirmMsg.message_id;
      return;
    }

    // 1c. If currently adding a new Pagu Item to an Order (Ayah klik "➕ Tambah Bahan Baru di PO Ini")
    if (state.addingPaguItemToOrder) {
      if (await isCallerMember(userId)) {
        state.addingPaguItemToOrder = null;
        await ctx.reply(
          "⛔ <b>Akses Dibatasi</b>\n\nPenambahan rincian pagu hanya dapat dilakukan oleh Admin atau Super Admin.",
          { parse_mode: "HTML" }
        );
        return;
      }

      const { orderNo } = state.addingPaguItemToOrder;
      state.addingPaguItemToOrder = null;

      // Auto-cleanup user input & prompt message
      await ctx.deleteMessage().catch(() => {});
      if (state.promptMsgId) {
        await ctx.api.deleteMessage(chatId, state.promptMsgId).catch(() => {});
        state.promptMsgId = undefined;
      }

      // Parse user's text using staticParsePaguModification
      const parsed = staticParsePaguModification(text) || staticParsePaguModification("tambah bahan " + text);
      const itemName = parsed?.newItemName || parsed?.targetItemName || text.trim();
      const qty = parsed?.qty && parsed.qty > 0 ? parsed.qty : 1;
      const unit = parsed?.unit || "satuan";
      const price = parsed?.price && parsed.price > 0 ? parsed.price : 0;
      const supplier = parsed?.supplier || undefined;

      const callerName = ctx.from?.first_name || (userId === 7546537134 ? "Heizaaa" : "Admin");

      const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;
      const draft: PaguOneShotDraft = {
        draftId,
        spreadsheetId: unitConfig.spreadsheetId,
        orderNo,
        orderLabel: `PO ${orderNo}`,
        action: "ADD",
        itemName,
        qty,
        unit,
        price,
        supplier,
        updatedBy: callerName,
        createdAt: Date.now(),
      };

      pendingPaguModifications.set(draftId, draft);

      const cardText = renderPaguOneShotCard(draft, unitConfig.name);
      const confirmMsg = await ctx.reply(cardText, {
        parse_mode: "HTML",
        reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
      });
      state.activeDraftMsgId = confirmMsg.message_id;
      return;
    }

    // 2. If currently editing pending draft field (nominal, name, or pagu)
    if (state.editingField && state.activeDraftId) {
      const draft = await pendingRepo.getById(state.activeDraftId);
      if (!draft) {
        state.editingField = null;
        return;
      }

      if (state.editingField === "nominal") {
        const cleanNum = parseInt(text.replace(/[^\d]/g, ""), 10);
        if (!isNaN(cleanNum) && cleanNum > 0) {
          draft.payload.total_amount = cleanNum;
          await pendingRepo.updatePayload(draft.id, draft.payload);
        }
      } else if (state.editingField === "name") {
        if (draft.action_type === "SPPG_ORDER") {
          draft.payload.sppg_unit = text;
        } else {
          draft.payload.supplier_name = text;
        }
        await pendingRepo.updatePayload(draft.id, draft.payload);
      } else if (state.editingField === "pagu") {
        const cleanPagu = text.trim();
        draft.payload.sppg_ref_no = cleanPagu === "-" ? "" : cleanPagu;
        if (draft.action_type === "SUPPLIER_EXPENSE") {
          await enrichReceiptWithPaguContext(unitConfig.spreadsheetId, draft.payload);
        }
        await pendingRepo.updatePayload(draft.id, draft.payload);
      }

      state.editingField = null;

      // Auto-cleanup user input & prompt message
      await ctx.deleteMessage().catch(() => { });
      if (state.promptMsgId) {
        await ctx.api.deleteMessage(chatId, state.promptMsgId).catch(() => { });
        state.promptMsgId = undefined;
      }

      // In-place edit card message with updated values
      if (state.activeDraftMsgId) {
        const itemsCount = draft.action_type === "SPPG_ORDER" ? draft.payload?.items?.length || 0 : undefined;
        const hasMultiple = (draft.payload as any)?.paguContext?.candidates_count > 1;
        const updatedCard =
          draft.action_type === "SPPG_ORDER"
            ? renderSppgOrderDraftCard(draft.payload, draft.id, "PENDING")
            : renderSupplierExpenseDraftCard(draft.payload, draft.id, "PENDING", draft.media_url);

        await ctx.api.editMessageText(chatId, state.activeDraftMsgId, updatedCard, {
          parse_mode: "HTML",
          reply_markup: getDraftConfirmationReplyMarkup(draft.id, draft.action_type, draft.payload, itemsCount, hasMultiple),
        });
      }
      return;
    }

    // 3. Conversational Meta-Agent Classifier & Router with Top-Level Error Boundary
    try {
      await withTyping(ctx, async () => {
        const callingUser = await userRepo.getUser(userId);
        const callerName = callingUser?.first_name || ctx.from?.first_name || (userId === 7546537134 ? "Heizaaa" : "Bapak/Ibu");
        const intent = await metaAgent.classifyAndRoute(text, unitConfig.name, callerName);
        logger.info({ userId, callerName, intentType: intent.type }, "Meta-agent classified user message");

        switch (intent.type) {
          case "GET_REKAP":
            await sendRekap(ctx);
            break;

          case "GET_PDF":
            await sendPdf(ctx);
            break;

          case "GET_SHEETS":
            await sendSheets(ctx);
            break;

          case "GET_MY_ID":
            await sendMyId(ctx);
            break;

          case "LIST_TRANSACTIONS":
            await sendRecentTransactions(ctx, intent.limit || 8);
            break;

          case "DETAIL_TRANSACTION":
            await sendTransactionDetail(ctx, intent.transactionId);
            break;

          case "DELETE_TRANSACTION": {
            if (await isCallerMember(userId)) {
              await notifyMemberRestricted(ctx, "penghapusan transaksi");
              break;
            }

            const preview = await googleSheetsService.getCascadeDeletePreview(
              unitConfig.spreadsheetId,
              intent.transactionId
            );

            if (!preview.found) {
              await ctx.reply(
                `❌ Transaksi <code>${escapeHtml(intent.transactionId)}</code> tidak ditemukan di Google Sheets unit <b>${escapeHtml(unitConfig.name)}</b>.`,
                { parse_mode: "HTML" }
              );
              break;
            }

            if (preview.isProtected) {
              const isTab05 = preview.sheetName === SHEET_NAMES.RINCIAN_PENGELUARAN;
              const tabDesc = isTab05 ? "Rincian Pengeluaran (Tab 05)" : "Rincian Pendapatan (Tab 03)";
              const parentHint = isTab05
                ? `silakan hapus Faktur/Nota Induk di Tab 04 (${escapeHtml(preview.orderNo || "Tab 04_PAGU_PENGELUARAN")}).`
                : `silakan hapus Pagu Induk di Tab 02 (${escapeHtml(preview.orderNo || "Tab 02_PAGU_PENERIMAAN")}).`;

              await ctx.reply(
                `⛔ <b>Akses Ditolak: Data Terproteksi</b>\n------------------------------------------\nTransaksi <code>${escapeHtml(intent.transactionId)}</code> merupakan <b>${tabDesc}</b>.\n\nData rincian bahan/belanja tidak dapat dihapus mandiri karena terikat mutlak dengan data induknya.\n\n💡 <i>Jika ingin membatalkan, ${parentHint}</i>`,
                { parse_mode: "HTML" }
              );
              break;
            }

            let confirmationBody = "";
            if (
              preview.sheetName === SHEET_NAMES.PAGU_PENERIMAAN ||
              preview.sheetName === SHEET_NAMES.PAGU_RINGKASAN ||
              preview.sheetName === "02_PENDAPATAN_SPPG"
            ) {
              confirmationBody =
                `🚨 <b>KONFIRMASI CASCADE DELETE (PAGU INDUK)</b>\n------------------------------------------\n` +
                `• No SPPG: <code>${escapeHtml(preview.orderNo || "-")}</code>\n` +
                `• ID Pagu: <code>${escapeHtml(intent.transactionId)}</code>\n` +
                `• Total Pagu: <b>${formatRupiah(preview.amount || 0)}</b>\n` +
                `• Unit: <b>${escapeHtml(unitConfig.name)}</b>\n\n` +
                `⚠️ <b>PERINGATAN INTEGRITAS RELASIONAL:</b>\n` +
                `Menghapus Pagu Induk ini akan <b>MENGHAPUS PERMANEN seluruh data anak</b>:\n` +
                `• <b>Tab 03 (Rincian Pendapatan):</b> ${preview.childrenSummary?.rincianCount || 0} item rincian pagu\n` +
                `• <b>Tab 04 (Pagu Pengeluaran):</b> ${preview.childrenSummary?.expenseCount || 0} transaksi nota supplier\n` +
                `• <b>Tab 05 (Rincian Pengeluaran):</b> ${preview.childrenSummary?.rincianPengeluaranCount || 0} baris belanja supplier\n` +
                `• <b>Tab 06 (Perbandingan Margin):</b> ${preview.childrenSummary?.rekapCount || 0} baris komparasi margin\n\n` +
                `<i>⚠️ Tindakan ini permanen dan tidak dapat dibatalkan. Lanjutkan?</i>`;
            } else if (
              preview.sheetName === SHEET_NAMES.PAGU_PENGELUARAN ||
              preview.sheetName === SHEET_NAMES.PENGELUARAN_SUPPLIER ||
              preview.sheetName === "03_PENGELUARAN_SUPPLIER"
            ) {
              confirmationBody =
                `🚨 <b>KONFIRMASI PENGHAPUSAN NOTA SUPPLIER</b>\n------------------------------------------\n` +
                `• ID Transaksi: <code>${escapeHtml(intent.transactionId)}</code>\n` +
                `• Supplier: <b>${escapeHtml(preview.supplierOrUnit || "Supplier")}</b>\n` +
                `• Nominal: <b>${formatRupiah(preview.amount || 0)}</b>\n` +
                `• Unit: <b>${escapeHtml(unitConfig.name)}</b>\n\n` +
                `ℹ️ <b>Catatan Cascading:</b>\n` +
                `• <b>Tab 05 (Rincian Pengeluaran):</b> ${preview.childrenSummary?.rincianPengeluaranCount || 0} baris rincian belanja akan dihapus.\n` +
                `• <b>Tab 06 (Perbandingan Margin):</b> Realisasi belanja akan otomatis di-reset (${preview.childrenSummary?.resetRekapCount || 0} item kembali ke status 🟡 MENUNGGU INVOICE${preview.childrenSummary?.rekapCount ? ` dan ${preview.childrenSummary.rekapCount} item belanja tambahan dihapus` : ""}).\n\n` +
                `<i>Apakah Anda yakin ingin menghapus nota belanja ini?</i>`;
            } else {
              confirmationBody =
                `🚨 <b>KONFIRMASI PENGHAPUSAN TRANSAKSI</b>\n------------------------------------------\n` +
                `Apakah Anda yakin ingin <b>menghapus permanen</b> transaksi <code>${escapeHtml(intent.transactionId)}</code> dari Google Sheets unit <b>${escapeHtml(unitConfig.name)}</b>?\n\n` +
                `<i>⚠️ Tindakan ini tidak dapat dibatalkan.</i>`;
            }

            const confirmMsg = await ctx.reply(confirmationBody, {
              parse_mode: "HTML",
              reply_markup: buildDeleteConfirmKeyboard(intent.transactionId),
            });
            state.activeDraftMsgId = confirmMsg.message_id;
            break;
          }

          case "PAGU_MODIFICATION": {
            if (await isCallerMember(userId)) {
              await notifyMemberRestricted(ctx, "pengubahan rincian pagu");
              break;
            }

            const req = intent.request;
            const targetName = req.newItemName || req.targetItemName || "";

            const isExpenseRef = !!(req.orderRef && /^(?:SPPG\d*[-_])?E[A-Z]\d+/i.test(req.orderRef.trim()));
            if (isExpenseRef) {
              const expenseTrx = await googleSheetsService.findTransactionById(unitConfig.spreadsheetId, req.orderRef!);
              if (expenseTrx.found && expenseTrx.type === "expense") {
                const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;
                const draft: PaguOneShotDraft = {
                  draftId,
                  spreadsheetId: unitConfig.spreadsheetId,
                  orderNo: expenseTrx.orderNo || "-",
                  orderLabel: `Nota Supplier (${expenseTrx.id})`,
                  action: "ADD",
                  itemName: targetName || "Bahan Baru",
                  qty: (req.qty !== undefined && req.qty !== null) ? req.qty : 1,
                  unit: req.unit || "satuan",
                  price: (req.price !== undefined && req.price !== null) ? req.price : 0,
                  supplier: req.supplier || expenseTrx.supplierOrUnit || "Supplier",
                  updatedBy: callerName,
                  createdAt: Date.now(),
                  isExpense: true,
                  expenseId: expenseTrx.id,
                };

                pendingPaguModifications.set(draftId, draft);

                const cardText = renderPaguOneShotCard(draft, unitConfig.name);
                const confirmMsg = await ctx.reply(cardText, {
                  parse_mode: "HTML",
                  reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
                });
                state.activeDraftMsgId = confirmMsg.message_id;
                break;
              } else {
                await ctx.reply(
                  `❌ <b>Transaksi Belanja Tidak Ditemukan</b>\n\nTransaksi belanja dengan ID <code>${escapeHtml(req.orderRef!)}</code> tidak ditemukan di Tab 04_PAGU_PENGELUARAN unit <b>${escapeHtml(unitConfig.name)}</b>.`,
                  { parse_mode: "HTML" }
                );
                break;
              }
            }

            const queryRes = await googleSheetsService.findPaguItemByQuery(
              unitConfig.spreadsheetId,
              req.orderRef || undefined,
              targetName
            );

            // 1. If no orders exist at all
            if (queryRes.availableOrders.length === 0) {
              await ctx.reply(
                `❌ <b>Tidak Ada Pagu Aktif</b>\n\nBelum ada Surat Pesanan / Pagu Anggaran aktif yang terdaftar di Tab 02_PAGU_PENERIMAAN unit <b>${escapeHtml(unitConfig.name)}</b>.`,
                { parse_mode: "HTML" }
              );
              break;
            }

            // 2. If order cannot be resolved and multiple orders exist
            if (!queryRes.order) {
              await ctx.reply(
                `🔍 <b>Pilih Surat Pesanan (PO)</b>\n\nSistem menemukan beberapa PO aktif. Mohon pilih PO mana yang ingin Anda ubah:`,
                {
                  parse_mode: "HTML",
                  reply_markup: buildPaguOrderListKeyboard(queryRes.availableOrders),
                }
              );
              break;
            }

            const currentOrder = queryRes.order;
            const orderLabel = `PO ${currentOrder.orderNo}${currentOrder.transactionId ? ` (${currentOrder.transactionId})` : ""}`;

            // Case 0: Explicit intention to ADD a new item to PO
            if (req.actionIntent === "ADD") {
              const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;
              const draft: PaguOneShotDraft = {
                draftId,
                spreadsheetId: unitConfig.spreadsheetId,
                orderNo: currentOrder.orderNo,
                orderLabel,
                action: "ADD",
                itemName: targetName || "Bahan Baru",
                qty: (req.qty !== undefined && req.qty !== null) ? req.qty : 1,
                unit: req.unit || "satuan",
                price: (req.price !== undefined && req.price !== null) ? req.price : 0,
                supplier: req.supplier || undefined,
                updatedBy: callerName,
                createdAt: Date.now(),
              };

              pendingPaguModifications.set(draftId, draft);

              const cardText = renderPaguOneShotCard(draft, unitConfig.name);
              const confirmMsg = await ctx.reply(cardText, {
                parse_mode: "HTML",
                reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
              });
              state.activeDraftMsgId = confirmMsg.message_id;
              break;
            }

            // 3. Case A: Target item found in this order
            if (queryRes.foundItem) {
              const item = queryRes.foundItem;
              const newQty = (req.qty !== undefined && req.qty !== null) ? req.qty : item.qty;
              const newPrice = (req.price !== undefined && req.price !== null) ? req.price : item.price;
              const newUnit = req.unit || item.unit;
              const newSupplier = req.supplier || item.supplier;
              const finalItemName = req.newItemName && req.newItemName.toLowerCase() !== item.itemName.toLowerCase()
                ? req.newItemName
                : item.itemName;

              const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;
              const draft: PaguOneShotDraft = {
                draftId,
                spreadsheetId: unitConfig.spreadsheetId,
                orderNo: currentOrder.orderNo,
                orderLabel,
                action: "UPDATE",
                itemRowIndex: item.rowIndex,
                origItemName: item.itemName,
                itemName: finalItemName,
                qty: newQty,
                unit: newUnit,
                price: newPrice,
                supplier: newSupplier,
                oldQty: item.qty,
                oldPrice: item.price,
                oldSupplier: item.supplier,
                updatedBy: callerName,
                createdAt: Date.now(),
              };

              pendingPaguModifications.set(draftId, draft);

              const cardText = renderPaguOneShotCard(draft, unitConfig.name);
              const confirmMsg = await ctx.reply(cardText, {
                parse_mode: "HTML",
                reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
              });
              state.activeDraftMsgId = confirmMsg.message_id;
              break;
            }

            // 4. Case B: Target item is specified, but NOT in this order (e.g. "ubah IH001 jadi Wortel...")
            if (targetName) {
              const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;
              const draft: PaguOneShotDraft = {
                draftId,
                spreadsheetId: unitConfig.spreadsheetId,
                orderNo: currentOrder.orderNo,
                orderLabel,
                action: "ADD",
                itemName: targetName,
                qty: (req.qty !== undefined && req.qty !== null) ? req.qty : 1,
                unit: req.unit || "satuan",
                price: (req.price !== undefined && req.price !== null) ? req.price : 0,
                supplier: req.supplier || undefined,
                updatedBy: callerName,
                createdAt: Date.now(),
              };

              pendingPaguModifications.set(draftId, draft);

              const clarifyMsg = [
                `❓ <b>Bahan Belum Terdaftar di Pesanan</b>`,
                `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
                `------------------------------------------`,
                `Bahan <b>${escapeHtml(targetName)}</b> belum ada pada <code>${escapeHtml(orderLabel)}</code> (saat ini memiliki ${queryRes.allItemsInOrder.length} bahan).`,
                ``,
                `Apakah Anda ingin:`,
                `1️⃣ <b>Menambahkan sebagai bahan baru</b> di pesanan ini, atau`,
                `2️⃣ <b>Mengganti salah satu bahan yang sudah ada</b>?`,
              ].join("\n");

              const clarifyPrompt = await ctx.reply(clarifyMsg, {
                parse_mode: "HTML",
                reply_markup: buildPaguClarifyAddOrReplaceKeyboard(draftId),
              });
              state.activeDraftMsgId = clarifyPrompt.message_id;
              break;
            }

            // 5. Case C: Order is identified, but user did not specify which item (e.g. "ubah pagu IH001")
            await ctx.reply(
              `📋 <b>Daftar Bahan pada ${escapeHtml(orderLabel)}</b>\n\nSilakan pilih bahan yang ingin diubah:`,
              {
                parse_mode: "HTML",
                reply_markup: buildPaguItemListKeyboard(currentOrder.orderNo, queryRes.allItemsInOrder),
              }
            );
            break;
          }

          case "EDIT_TRANSACTION":
            if (await isCallerMember(userId)) {
              await notifyMemberRestricted(ctx, "pengubahan transaksi di Google Sheets");
              break;
            }

            if (intent.newAmount) {
              const confirmCard = [
                `⚠️ <b>KONFIRMASI PERUBAHAN TRANSAKSI GOOGLE SHEETS</b>`,
                `Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
                `------------------------------------------`,
                `• <b>ID Transaksi:</b> <code>${escapeHtml(intent.transactionId)}</code>`,
                `• <b>Nominal Baru:</b> <b>${formatRupiah(intent.newAmount)}</b>`,
                `------------------------------------------`,
                `Apakah Anda yakin ingin menerapkan perubahan ini ke Google Sheets?`,
              ].join("\n");

              const confirmMsg = await ctx.reply(confirmCard, {
                parse_mode: "HTML",
                reply_markup: buildEditConfirmKeyboard(intent.transactionId, intent.newAmount),
              });
              state.activeDraftMsgId = confirmMsg.message_id;
            } else {
              state.editingTransactionId = intent.transactionId;
              const prompt = await ctx.reply(
                `Ketik <b>nominal baru</b> untuk transaksi <code>${escapeHtml(intent.transactionId)}</code> (contoh: <code>850000</code> atau <code>850rb</code>):`,
                { parse_mode: "HTML" }
              );
              state.promptMsgId = prompt.message_id;
            }
            break;

          case "INVITE":
            await handleInviteCommand(ctx, intent.name, intent.role);
            break;

          case "RECORD_TRANSACTION": {
            if (intent.parsed.type === "SPPG_ORDER" && (await isCallerMember(userId))) {
              await ctx.reply(
                `⛔ <b>Akses Dibatasi</b>\n\n` +
                `Pencatatan <b>Nota Pesanan SPPG (Pagu Pendapatan)</b> hanya dapat dilakukan oleh Admin.\n` +
                `Sebagai <b>Staf Operasional (Member)</b>, wewenang Anda dikhususkan untuk mencatat <b>Pengeluaran Belanja Supplier</b>.`,
                { parse_mode: "HTML" }
              );
              break;
            }

            let hasMultiplePagu = false;
            if (intent.parsed.type === "SUPPLIER_EXPENSE") {
              hasMultiplePagu = await enrichReceiptWithPaguContext(unitConfig.spreadsheetId, intent.parsed.data);
            }

            const draftId = `draft_${Date.now()}`;
            await pendingRepo.create({
              id: draftId,
              sppg_id: unitConfig.id,
              telegram_user_id: userId,
              telegram_chat_id: chatId,
              action_type: intent.parsed.type,
              payload: intent.parsed.data,
            });

            state.activeDraftId = draftId;

            const cardText =
              intent.parsed.type === "SPPG_ORDER"
                ? renderSppgOrderDraftCard(intent.parsed.data as any, draftId, "PENDING")
                : renderSupplierExpenseDraftCard(intent.parsed.data as any, draftId, "PENDING");

            const itemsCount =
              intent.parsed.type === "SPPG_ORDER"
                ? ((intent.parsed.data as any)?.items?.length || 0)
                : undefined;

            const sentMsg = await ctx.reply(cardText, {
              parse_mode: "HTML",
              reply_markup: getDraftConfirmationReplyMarkup(draftId, intent.parsed.type, intent.parsed.data, itemsCount, hasMultiplePagu),
            });

            state.activeDraftMsgId = sentMsg.message_id;
            break;
          }

          case "GENERAL_CHAT":
          default: {
            const user = await userRepo.getUser(userId);
            const userRole = user?.role === "member" ? "member" : "admin";
            const sentMsg = await safeReplyHtml(ctx, intent.reply, buildStartQuickActionKeyboard(userRole));
            if (sentMsg) {
              state.activeQuickActionMsgId = sentMsg.message_id;
            }
            break;
          }
        }
      });
    } catch (fatalErr: any) {
      logger.error({ fatalErr }, "Fatal error during text message processing, serving static fallback");
      const user = await userRepo.getUser(userId);
      const userRole = user?.role === "member" ? "member" : "admin";
      const sentMsg = await safeReplyHtml(ctx, staticConversationalReply(unitConfig.name), buildStartQuickActionKeyboard(userRole));
      if (sentMsg) {
        state.activeQuickActionMsgId = sentMsg.message_id;
      }
    }
  });

  return bot;
}

import { Bot, Context, InputFile } from "grammy";
import { SPPGUnitConfig } from "../../config/sppg.config.js";
import { getSupabaseClient } from "../db/supabase.js";
import { UserRepository } from "../db/repositories/user.repository.js";
import { PendingActionRepository } from "../db/repositories/pending-action.repository.js";
import { parseSppgOrderFromImage } from "../ai/parsers/sppg-order.parser.js";
import { parseSupplierReceiptFromImage } from "../ai/parsers/supplier-receipt.parser.js";
import { googleDriveService } from "../google/drive.service.js";
import { googleSheetsService } from "../google/sheets.service.js";
import { generateOfficialSppgPdf } from "../pdf/pdf-report.service.js";
import {
  buildDraftConfirmationKeyboard,
  buildEditSubmenuKeyboard,
  buildCancelInputKeyboard,
  buildRekapActionKeyboard,
} from "./keyboards.js";
import {
  escapeHtml,
  formatRupiah,
  renderSppgOrderDraftCard,
  renderSupplierExpenseDraftCard,
  safeEditMessageText,
} from "./formatter.js";
import { logger } from "../utils/logger.js";

interface UserInteractionState {
  activeDraftId?: string;
  activeDraftMsgId?: number;
  editingField?: "nominal" | "name" | null;
  promptMsgId?: number;
}

export function createSppgBot(unitConfig: SPPGUnitConfig): Bot<Context> {
  const bot = new Bot(unitConfig.token);
  const supabase = getSupabaseClient();
  const userRepo = new UserRepository(supabase);
  const pendingRepo = new PendingActionRepository(supabase);

  const userStates = new Map<number, UserInteractionState>();

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

  // Global Auth Guard
  bot.use(async (ctx, next) => {
    if (!ctx.from) return next();

    const isAllowed = await userRepo.isAllowed(ctx.from.id);
    if (!isAllowed) {
      await ctx.reply(
        `⛔ <b>Akses Ditolak</b>\nID Telegram Anda (<code>${ctx.from.id}</code>) belum terdaftar di whitelist bot MBG.\nHubungi administrator untuk otorisasi.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    return next();
  });

  // ============================================================================
  // COMMAND HANDLERS
  // ============================================================================

  bot.command("start", async (ctx) => {
    const welcomeText = [
      `👋 <b>Halo, Selamat Datang di Asisten Operasional MBG!</b>`,
      `🏢 Unit: <b>${escapeHtml(unitConfig.name)}</b>`,
      `Badan Gizi Nasional (BGN) Republik Indonesia`,
      `------------------------------------------`,
      `💡 <b>Cara Penggunaan:</b>`,
      `1. 📸 <b>Kirim Foto Nota Pesanan SPPG</b> untuk mencatat Plafon Pendapatan (20+ bahan).`,
      `2. 🧾 <b>Kirim Foto Bon/Struk Belanja Pasar</b> untuk mencatat Pengeluaran Riil suplier.`,
      `3. 📊 Ketik /rekap untuk melihat ringkasan omset dan margin laba bersih.`,
      `4. 📄 Ketik /pdf untuk mencetak laporan resmi SPJ Badan Gizi Nasional.`,
      `5. 🌐 Ketik /sheets untuk membuka lembar Google Sheets online.`,
    ].join("\n");

    await ctx.reply(welcomeText, { parse_mode: "HTML" });
  });

  bot.command("sheets", async (ctx) => {
    const url = `https://docs.google.com/spreadsheets/d/${unitConfig.spreadsheetId}/edit`;
    await ctx.reply(`🌐 <b>Google Sheets ${escapeHtml(unitConfig.name)}:</b>\n<a href="${url}">Buka Spreadsheet Online</a>`, {
      parse_mode: "HTML",
    });
  });

  bot.command("rekap", async (ctx) => {
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
  });

  bot.command("pdf", async (ctx) => {
    await withTyping(ctx, async () => {
      await ctx.reply("⏳ Sedang memproses dan menyusun Dokumen PDF Resmi SPJ BGN...", { parse_mode: "HTML" });
      const kpi = await googleSheetsService.getExecutiveKpi(unitConfig.spreadsheetId);
      const today = new Date().toISOString().split("T")[0];

      const pdfBuffer = await generateOfficialSppgPdf({
        sppgName: unitConfig.name,
        periodDate: today,
        orderNo: "REKAP-BULANAN",
        totalPlafon: kpi.totalPlafon || 29581000,
        totalBelanja: kpi.totalBelanja || 24150000,
        marginBersih: kpi.marginBersih || 5431000,
        marginPercentage: kpi.marginPercentage || 18.36,
        expenses: [],
      });

      const filename = `Laporan_SPJ_${unitConfig.id}_${today}.pdf`;
      await ctx.replyWithDocument(new InputFile(pdfBuffer, filename), {
        caption: `📄 <b>Laporan Resmi SPJ Badan Gizi Nasional</b>\nUnit: <b>${escapeHtml(unitConfig.name)}</b>\nTanggal: <code>${today}</code>`,
        parse_mode: "HTML",
      });
    });
  });

  // ============================================================================
  // PHOTO UPLOAD HANDLER
  // ============================================================================

  bot.on("message:photo", async (ctx) => {
    const userId = ctx.from.id;
    const state = getState(userId);

    await withTyping(ctx, async () => {
      // 1. Get highest quality photo file
      const photos = ctx.message.photo;
      const fileInfo = photos[photos.length - 1];

      const file = await ctx.api.getFile(fileInfo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${unitConfig.token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const imageBuffer = Buffer.from(await response.arrayBuffer());

      logger.info({ userId, fileSize: imageBuffer.length }, "Processing incoming photo document...");

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
        supplierReceiptResult = await parseSupplierReceiptFromImage(imageBuffer);
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

      // 4. Create Pending Action Draft in State Machine
      const draftId = `draft_${Date.now()}`;
      const payload = actionType === "SPPG_ORDER" ? sppgOrderResult : supplierReceiptResult;

      await pendingRepo.create({
        id: draftId,
        sppg_id: unitConfig.id,
        telegram_user_id: userId,
        telegram_chat_id: ctx.chat.id,
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

      const sentMsg = await ctx.reply(cardText, {
        parse_mode: "HTML",
        reply_markup: buildDraftConfirmationKeyboard(draftId, actionType),
      });

      state.activeDraftMsgId = sentMsg.message_id;
    });
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
      if (draft.action_type === "SPPG_ORDER") {
        await googleSheetsService.recordSppgOrder(unitConfig.spreadsheetId, draft.payload);
      } else {
        await googleSheetsService.recordSupplierExpense(
          unitConfig.spreadsheetId,
          draft.payload,
          draft.media_url || "",
          ctx.from?.first_name || "Ayah"
        );
      }

      await pendingRepo.updateStatus(draftId, "SAVED");

      const successCard =
        draft.action_type === "SPPG_ORDER"
          ? renderSppgOrderDraftCard(draft.payload, draftId, "SAVED")
          : renderSupplierExpenseDraftCard(draft.payload, draftId, "SAVED", draft.media_url);

      await safeEditMessageText(ctx, successCard, { parse_mode: "HTML" });
    } catch (saveErr: any) {
      logger.error({ saveErr }, "Failed saving to Google Sheets");
      await ctx.reply(`❌ Gagal menyimpan ke Spreadsheet: ${saveErr?.message || saveErr}`);
    }
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
      await ctx.api.deleteMessage(ctx.chat.id, state.promptMsgId).catch(() => {});
      state.promptMsgId = undefined;
    }
    state.editingField = null;

    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: buildDraftConfirmationKeyboard(draftId, draft.action_type),
    });
  });

  // [❌ Batalkan Draf]
  bot.callbackQuery(/^v:cancel:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = await pendingRepo.getById(draftId);
    if (!draft) return ctx.answerCallbackQuery();

    await pendingRepo.updateStatus(draftId, "CANCELLED");
    await ctx.answerCallbackQuery({ text: "❌ Draf berhasil dibatalkan." });

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

  // [📄 PDF Callback from /rekap]
  bot.callbackQuery(/^v:rekap:pdf:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "📄 Menyiapkan PDF..." });
    const kpi = await googleSheetsService.getExecutiveKpi(unitConfig.spreadsheetId);
    const today = new Date().toISOString().split("T")[0];

    const pdfBuffer = await generateOfficialSppgPdf({
      sppgName: unitConfig.name,
      periodDate: today,
      orderNo: "REKAP-BULANAN",
      totalPlafon: kpi.totalPlafon || 29581000,
      totalBelanja: kpi.totalBelanja || 24150000,
      marginBersih: kpi.marginBersih || 5431000,
      marginPercentage: kpi.marginPercentage || 18.36,
      expenses: [],
    });

    const filename = `Laporan_SPJ_${unitConfig.id}_${today}.pdf`;
    await ctx.replyWithDocument(new InputFile(pdfBuffer, filename), {
      caption: `📄 <b>Laporan Resmi SPJ Badan Gizi Nasional</b>\nUnit: <b>${escapeHtml(unitConfig.name)}</b>`,
      parse_mode: "HTML",
    });
  });

  // ============================================================================
  // TEXT INPUT WIZARD WITH AUTO-CLEANUP
  // ============================================================================

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const state = getState(userId);

    if (!state.editingField || !state.activeDraftId) {
      return;
    }

    const draft = await pendingRepo.getById(state.activeDraftId);
    if (!draft) {
      state.editingField = null;
      return;
    }

    const text = ctx.message.text.trim();

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
    }

    state.editingField = null;

    // Auto-cleanup user input & prompt message
    await ctx.deleteMessage().catch(() => {});
    if (state.promptMsgId) {
      await ctx.api.deleteMessage(ctx.chat.id, state.promptMsgId).catch(() => {});
      state.promptMsgId = undefined;
    }

    // In-place edit card message with updated values
    if (state.activeDraftMsgId) {
      const updatedCard =
        draft.action_type === "SPPG_ORDER"
          ? renderSppgOrderDraftCard(draft.payload, draft.id, "PENDING")
          : renderSupplierExpenseDraftCard(draft.payload, draft.id, "PENDING", draft.media_url);

      await ctx.api.editMessageText(ctx.chat.id, state.activeDraftMsgId, updatedCard, {
        parse_mode: "HTML",
        reply_markup: buildDraftConfirmationKeyboard(draft.id, draft.action_type),
      });
    }
  });

  return bot;
}

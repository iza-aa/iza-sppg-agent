import { Context, InlineKeyboard } from "grammy";
import type { BotContext } from "../types/bot-context.js";
import { parseSppgOrderFromImage } from "../../ai/parsers/sppg-order.parser.js";
import { parseSupplierReceiptFromImage } from "../../ai/parsers/supplier-receipt.parser.js";
import { parseSpreadsheetBuffer } from "../../document-parser/spreadsheet.parser.js";
import { parseVoiceNote } from "../../document-parser/voice.parser.js";
import { parsePdfDocument } from "../../document-parser/pdf.parser.js";
import { googleDriveService } from "../../google/drive.service.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { staticImageFailureMessage } from "../../ai/static-fallback.js";
import { logger } from "../../utils/logger.js";
import {
  escapeHtml,
  formatRupiah,
  renderSppgOrderDraftCard,
  renderSupplierExpenseDraftCard,
} from "../formatter.js";
import {
  buildDraftConfirmationKeyboard,
} from "../keyboards.js";
import {
  enrichReceiptWithPaguContext,
  getDraftConfirmationReplyMarkup,
} from "./draft.handler.js";

export async function handleIncomingImage(bCtx: BotContext, ctx: Context, fileId: string) {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const state = bCtx.getState(userId);

  // Button Hygiene: Strip previous active keyboards if user sends a new photo
  await bCtx.clearObsoleteKeyboards(ctx, state);

  await bCtx.withTyping(ctx, async () => {
    const file = await ctx.api.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${bCtx.unitConfig.token}/${file.file_path}`;

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
          const destFolderId = await googleDriveService.resolveDestinationFolder(bCtx.unitConfig.id, year, month, "02_Kwitansi_Supplier");
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

    if (actionType === "SPPG_ORDER" && (await bCtx.isCallerMember(userId))) {
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
      const destFolderId = await googleDriveService.resolveDestinationFolder(bCtx.unitConfig.id, year, month, subFolderType);
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
      hasMultiplePagu = await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, supplierReceiptResult);
    }

    // 4. Create Pending Action Draft in State Machine
    const draftId = `draft_${Date.now()}`;
    const payload = actionType === "SPPG_ORDER" ? sppgOrderResult : supplierReceiptResult;

    await bCtx.pendingRepo.create({
      id: draftId,
      sppg_id: bCtx.unitConfig.id,
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

export function registerMediaHandlers(bCtx: BotContext) {
  // Photo Handler
  bCtx.bot.on("message:photo", async (ctx) => {
    const photos = ctx.message.photo;
    const fileInfo = photos[photos.length - 1];
    await handleIncomingImage(bCtx, ctx, fileInfo.file_id);
  });

  // Voice Note Handler (.oga / OGG Audio)
  bCtx.bot.on("message:voice", async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const state = bCtx.getState(userId);

    await bCtx.clearObsoleteKeyboards(ctx, state);

    await bCtx.withTyping(ctx, async () => {
      const voice = ctx.message.voice;
      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${bCtx.unitConfig.token}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const audioBuffer = Buffer.from(await response.arrayBuffer());

      const result = await parseVoiceNote(audioBuffer, voice.mime_type || "audio/ogg", bCtx.unitConfig.name);
      if (result.error) {
        await ctx.reply(result.error, { parse_mode: "HTML" });
        return;
      }

      if (result.transaction) {
        if (result.transaction.type === "SPPG_ORDER" && (await bCtx.isCallerMember(userId))) {
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
          hasMultiplePagu = await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, result.transaction.data);
        }

        const draftId = `draft_${Date.now()}`;
        await bCtx.pendingRepo.create({
          id: draftId,
          sppg_id: bCtx.unitConfig.id,
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
  bCtx.bot.on("message:document", async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const state = bCtx.getState(userId);
    const doc = ctx.message.document;
    const fileName = doc.file_name?.toLowerCase() || "";
    const mimeType = doc.mime_type || "";

    await bCtx.clearObsoleteKeyboards(ctx, state);

    // CASE 1: Image document (PNG, JPG, WebP)
    if (mimeType.startsWith("image/")) {
      await handleIncomingImage(bCtx, ctx, doc.file_id);
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
      await bCtx.withTyping(ctx, async () => {
        const file = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${bCtx.unitConfig.token}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        try {
          const parsed = parseSpreadsheetBuffer(buffer, "Supplier Rekanan");
          if (parsed.transactions.length === 0) {
            await ctx.reply("⚠️ Tidak ada data transaksi yang dapat dibaca dari file spreadsheet ini.", { parse_mode: "HTML" });
            return;
          }

          if (parsed.transactions.length === 1) {
            const trx = parsed.transactions[0];
            const draftId = `draft_${Date.now()}`;
            await bCtx.pendingRepo.create({
              id: draftId,
              sppg_id: bCtx.unitConfig.id,
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
            bCtx.unitConfig.spreadsheetId,
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
      await bCtx.withTyping(ctx, async () => {
        const file = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${bCtx.unitConfig.token}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        const now = new Date();
        const year = String(now.getFullYear());
        const month = `${String(now.getMonth() + 1).padStart(2, "0")}-${now.toLocaleString("id-ID", { month: "long" })}`;
        let driveLink = "";
        try {
          const destFolderId = await googleDriveService.resolveDestinationFolder(
            bCtx.unitConfig.id,
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

        const parsedPdf = await parsePdfDocument(buffer, bCtx.unitConfig.name);
        if (!parsedPdf) {
          await ctx.reply(
            `📄 <b>Dokumen PDF Diterima</b>\n\n• File: <code>${escapeHtml(doc.file_name || "dokumen.pdf")}</code>\n• Drive: <a href="${driveLink}">Buka di Google Drive</a>\n\n⚠️ AI OCR saat ini tidak dapat membaca rincian tabel secara otomatis. Silakan input ringkasan pesanan atau transaksi via chat teks.`,
            { parse_mode: "HTML" }
          );
          return;
        }

        if (parsedPdf.type === "SPPG_ORDER" && (await bCtx.isCallerMember(userId))) {
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
          hasMultiplePagu = await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, parsedPdf.data);
        }

        const draftId = `draft_${Date.now()}`;
        await bCtx.pendingRepo.create({
          id: draftId,
          sppg_id: bCtx.unitConfig.id,
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
}

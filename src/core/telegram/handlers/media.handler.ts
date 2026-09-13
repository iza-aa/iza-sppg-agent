import { Context, InlineKeyboard } from "grammy";
import type { BotContext } from "../types/bot-context.js";
import { parseSppgOrderFromImage } from "../../ai/parsers/sppg-order.parser.js";
import { parseSupplierReceiptFromImage } from "../../ai/parsers/supplier-receipt.parser.js";
import { parseImageDocument } from "../../document-parser/image.parser.js";
import { parseSpreadsheetBuffer } from "../../document-parser/spreadsheet.parser.js";
import { parseVoiceNote } from "../../document-parser/voice.parser.js";
import { parsePdfDocument } from "../../document-parser/pdf.parser.js";
import { mediaVaultService, mediaBufferCache } from "../../storage/media-vault.service.js";
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
  cancelPreviousActiveDraftIfAny,
  scheduleDraftAutoExpiry,
} from "./draft.handler.js";
import { getWibTimeOnly } from "../../utils/date-time.js";

export async function handleIncomingImage(bCtx: BotContext, ctx: Context, fileId: string) {
  if (!ctx.from || !ctx.chat) return;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const caption = ctx.message?.caption?.trim() || "";
  const state = bCtx.getState(userId);

  // Button Hygiene: Strip previous active keyboards if user sends a new photo
  await bCtx.clearObsoleteKeyboards(ctx, state);

  await bCtx.withTyping(ctx, async () => {
    const file = await ctx.api.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${bCtx.unitConfig.token}/${file.file_path}`;

    const response = await fetch(fileUrl);
    const imageBuffer = Buffer.from(await response.arrayBuffer());

    logger.info({ userId, fileSize: imageBuffer.length }, "Processing incoming image document...");

    // 2. Classify and parse document using Unified AI Vision Parser
    let sppgOrderResult = null;
    let supplierReceiptResult = null;
    let actionType: "SPPG_ORDER" | "SUPPLIER_EXPENSE" = "SUPPLIER_EXPENSE";

    const parsedDoc = await parseImageDocument(imageBuffer, "image/jpeg", bCtx.unitConfig.name, caption);

    if (parsedDoc) {
      if (parsedDoc.type === "SPPG_ORDER") {
        actionType = "SPPG_ORDER";
        sppgOrderResult = parsedDoc.data;
      } else {
        actionType = "SUPPLIER_EXPENSE";
        supplierReceiptResult = parsedDoc.data;
      }
    } else {
      // Fallback to supplier receipt parser
      try {
        supplierReceiptResult = await parseSupplierReceiptFromImage(imageBuffer);
      } catch (supplierErr) {
        logger.warn({ supplierErr }, "Failed parsing image with both image parser and supplier receipt parser");

        // Always upload to Media Vault so the photo is safe even during AI outage
        const now = new Date();
        try {
          await mediaVaultService.uploadReceipt(
            imageBuffer,
            `${now.toISOString().slice(0, 10)}_${Date.now().toString().slice(-4)}`,
            bCtx.unitConfig.id,
            "02_Kwitansi_Supplier"
          );
        } catch (vaultErr) {
          logger.warn({ vaultErr }, "Could not upload image to Media Vault during OCR failure");
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

    // Enrich with Pagu candidates if supplier receipt
    let hasMultiplePagu = false;
    if (actionType === "SUPPLIER_EXPENSE" && supplierReceiptResult) {
      hasMultiplePagu = await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, supplierReceiptResult);
    }

    // 4. Create Pending Action Draft in State Machine (Lazy Upload: store telegram_file_id, upload only upon confirmation)
    const draftId = `draft_${Date.now()}`;
    const payload = actionType === "SPPG_ORDER" ? sppgOrderResult : supplierReceiptResult;
    if (payload) {
      (payload as any).notes = caption;
      (payload as any).raw_user_input = caption;
      (payload as any).telegram_file_id = fileId;
    }

    await cancelPreviousActiveDraftIfAny(bCtx, ctx, chatId, state);

    await bCtx.pendingRepo.create({
      id: draftId,
      sppg_id: bCtx.unitConfig.id,
      telegram_user_id: userId,
      telegram_chat_id: chatId,
      action_type: actionType,
      payload,
      media_url: undefined,
    });

    mediaBufferCache.set(draftId, {
      buffer: imageBuffer,
      fileName: "foto_nota.png",
      mimeType: "image/jpeg",
    });

    state.activeDraftId = draftId;

    // 5. Render Card and Send (No external preview URL, preventing desktop bubble squishing)
    const cardText =
      actionType === "SPPG_ORDER"
        ? renderSppgOrderDraftCard(sppgOrderResult!, draftId, "PENDING")
        : renderSupplierExpenseDraftCard(supplierReceiptResult!, draftId, "PENDING", undefined);

    const itemsCount = actionType === "SPPG_ORDER" ? sppgOrderResult?.items?.length || 0 : undefined;

    const sentMsg = await ctx.reply(cardText, {
      parse_mode: "HTML",
      reply_markup: getDraftConfirmationReplyMarkup(draftId, actionType, payload, itemsCount, hasMultiplePagu),
      link_preview_options: { is_disabled: true },
    });

    state.activeDraftMsgId = sentMsg.message_id;
    (payload as any).message_id = sentMsg.message_id;
    await bCtx.pendingRepo.updatePayload(draftId, payload);
    scheduleDraftAutoExpiry(bCtx, draftId, chatId, sentMsg.message_id);

    const timeOnly = getWibTimeOnly();
    await bCtx.logActivity(ctx, {
      mediaType: "Foto Nota",
      userMessage: `[${timeOnly}] ${caption ? `Kirim Foto Nota (Keterangan: "${caption}")` : "Kirim Foto Nota"}`,
      systemAction: `[${timeOnly}] ${actionType === "SPPG_ORDER"
        ? `OCR Berhasil: Draf Pendapatan PO ${(payload as any)?.order_no || ""}`
        : `OCR Berhasil: Draf Belanja ${(payload as any)?.supplier_name || "Supplier"} (Rp ${Number((payload as any)?.total_amount || 0).toLocaleString("id-ID")})`}`,
      refId: draftId,
      status: "PENDING",
    });
  }, "📸 <i>Foto nota diterima! Sedang membaca rincian nota...</i>");
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

        await cancelPreviousActiveDraftIfAny(bCtx, ctx, chatId, state);

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
        (result.transaction.data as any).message_id = sentMsg.message_id;
        await bCtx.pendingRepo.updatePayload(draftId, result.transaction.data);
        scheduleDraftAutoExpiry(bCtx, draftId, chatId, sentMsg.message_id);

        const timeOnly = getWibTimeOnly();
        await bCtx.logActivity(ctx, {
          mediaType: "Voice Note",
          userMessage: `[${timeOnly}] ${result.transcription ? `Pesan Suara ("${result.transcription}")` : "Pesan Suara"}`,
          systemAction: `[${timeOnly}] ${result.transaction.type === "SPPG_ORDER"
            ? `Transkripsi Suara: Draf Pendapatan PO ${(result.transaction.data as any)?.order_no || ""}`
            : `Transkripsi Suara: Draf Belanja ${(result.transaction.data as any)?.supplier_name || "Supplier"} (Rp ${Number((result.transaction.data as any)?.total_amount || 0).toLocaleString("id-ID")})`}`,
          refId: draftId,
          status: "PENDING",
        });
      } else {
        await ctx.reply(
          `🎙️ <b>Transkripsi Pesan Suara:</b>\n<i>"${escapeHtml(result.transcription)}"</i>\n\n💡 <i>Jika ingin mencatat belanja dari suara, sebutkan nama bahan, harga, dan toko (contoh: "Beli ayam 250rb di pasar ayam tunai").</i>`,
          { parse_mode: "HTML" }
        );
      }
    }, "🎙️ <i>Pesan suara diterima! Sedang mendengarkan & mencatat rincian belanja...</i>");
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

        // Upload spreadsheet file to Media Vault so transactions have Link Bukti Dokumen
        let driveLink = "";
        try {
          const uploadRes = await mediaVaultService.uploadReceipt(
            buffer,
            doc.file_name || `Data_${Date.now()}.${fileName.endsWith(".csv") ? "csv" : "xlsx"}`,
            bCtx.unitConfig.id,
            "04_Spreadsheet_Excel"
          );
          driveLink = uploadRes.webViewLink;
        } catch (vaultErr) {
          logger.warn({ vaultErr }, "Could not upload spreadsheet to Media Vault");
        }

        try {
          const parsed = parseSpreadsheetBuffer(buffer, "Supplier Rekanan");
          if (parsed.transactions.length === 0) {
            await ctx.reply("⚠️ Tidak ada data transaksi yang dapat dibaca dari file spreadsheet ini.", { parse_mode: "HTML" });
            return;
          }

          if (parsed.transactions.length === 1) {
            const trx = parsed.transactions[0];
            (trx as any).driveLink = driveLink;
            await cancelPreviousActiveDraftIfAny(bCtx, ctx, chatId, state);

            const draftId = `draft_${Date.now()}`;
            await bCtx.pendingRepo.create({
              id: draftId,
              sppg_id: bCtx.unitConfig.id,
              telegram_user_id: userId,
              telegram_chat_id: chatId,
              action_type: "SUPPLIER_EXPENSE",
              payload: trx,
              media_url: driveLink || undefined,
            });
            state.activeDraftId = draftId;
            const cardText = renderSupplierExpenseDraftCard(trx, draftId, "PENDING");
            const sentMsg = await ctx.reply(cardText, {
              parse_mode: "HTML",
              reply_markup: buildDraftConfirmationKeyboard(draftId, "SUPPLIER_EXPENSE"),
            });
            state.activeDraftMsgId = sentMsg.message_id;
            (trx as any).message_id = sentMsg.message_id;
            await bCtx.pendingRepo.updatePayload(draftId, trx);
            scheduleDraftAutoExpiry(bCtx, draftId, chatId, sentMsg.message_id);
            return;
          }

          // Attach driveLink to each batch transaction
          parsed.transactions.forEach((t) => {
            (t as any).driveLink = driveLink;
          });

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
          await ctx.reply(`✅ <b>Berhasil Menyimpan ${parsed.transactions.length} Transaksi ke Tab 04 (Pengeluaran) & Tab 05 (Rincian Pengeluaran)!</b>`, { parse_mode: "HTML" });
        } catch (parseErr: any) {
          logger.error({ parseErr }, "Spreadsheet parsing error");
          await ctx.reply(`❌ Gagal membaca file spreadsheet: ${escapeHtml(parseErr?.message || parseErr)}`, { parse_mode: "HTML" });
        }
      }, "📊 <i>Dokumen Excel diterima! Sedang memproses data transaksi...</i>");
      return;
    }

    // CASE 3: PDF Document (.pdf)
    if (fileName.endsWith(".pdf") || mimeType === "application/pdf") {
      await bCtx.withTyping(ctx, async () => {
        const file = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${bCtx.unitConfig.token}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        const parsedPdf = await parsePdfDocument(buffer, bCtx.unitConfig.name, ctx.message?.caption?.trim());
        if (!parsedPdf) {
          await ctx.reply(
            `📄 <b>Dokumen PDF Diterima</b>\n\n• File: <code>${escapeHtml(doc.file_name || "dokumen.pdf")}</code>\n\n⚠️ AI OCR saat ini tidak dapat membaca rincian tabel secara otomatis. Silakan input ringkasan pesanan atau transaksi via chat teks.`,
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

        await cancelPreviousActiveDraftIfAny(bCtx, ctx, chatId, state);

        const draftId = `draft_${Date.now()}`;
        if (parsedPdf.data) {
          (parsedPdf.data as any).telegram_file_id = doc.file_id;
          (parsedPdf.data as any).file_name = doc.file_name;
          (parsedPdf.data as any).mime_type = "application/pdf";
        }

        await bCtx.pendingRepo.create({
          id: draftId,
          sppg_id: bCtx.unitConfig.id,
          telegram_user_id: userId,
          telegram_chat_id: chatId,
          action_type: parsedPdf.type,
          payload: parsedPdf.data,
          media_url: undefined,
        });

        mediaBufferCache.set(draftId, {
          buffer,
          fileName: doc.file_name || "dokumen.pdf",
          mimeType: "application/pdf",
        });

        state.activeDraftId = draftId;
        const cardText =
          parsedPdf.type === "SPPG_ORDER"
            ? renderSppgOrderDraftCard(parsedPdf.data as any, draftId, "PENDING")
            : renderSupplierExpenseDraftCard(parsedPdf.data as any, draftId, "PENDING", undefined);

        const itemsCount = parsedPdf.type === "SPPG_ORDER" ? (parsedPdf.data as any)?.items?.length || 0 : undefined;
        const sentMsg = await ctx.reply(cardText, {
          parse_mode: "HTML",
          reply_markup: getDraftConfirmationReplyMarkup(draftId, parsedPdf.type, parsedPdf.data, itemsCount, hasMultiplePagu),
          link_preview_options: { is_disabled: true },
        });
        state.activeDraftMsgId = sentMsg.message_id;
        (parsedPdf.data as any).message_id = sentMsg.message_id;
        await bCtx.pendingRepo.updatePayload(draftId, parsedPdf.data);
        scheduleDraftAutoExpiry(bCtx, draftId, chatId, sentMsg.message_id);

        const timeOnly = getWibTimeOnly();
        await bCtx.logActivity(ctx, {
          mediaType: "Dokumen",
          userMessage: `[${timeOnly}] ${doc.file_name ? `Kirim Dokumen PDF (${doc.file_name})` : "Kirim Dokumen PDF"}`,
          systemAction: `[${timeOnly}] ${parsedPdf.type === "SPPG_ORDER"
            ? `OCR PDF: Draf Pendapatan PO ${(parsedPdf.data as any)?.order_no || ""}`
            : `OCR PDF: Draf Belanja ${(parsedPdf.data as any)?.supplier_name || "Supplier"} (Rp ${Number((parsedPdf.data as any)?.total_amount || 0).toLocaleString("id-ID")})`}`,
          refId: draftId,
          status: "PENDING",
        });
      }, "📄 <i>Dokumen PDF diterima! Sedang membaca berkas transaksi...</i>");
      return;
    }

    // Unsupported document format
    await ctx.reply(
      "ℹ️ Format file belum didukung. Silakan kirimkan foto nota (JPG/PNG), dokumen PDF, atau spreadsheet Excel/CSV.",
      { parse_mode: "HTML" }
    );
  });
}

import { Context, InlineKeyboard } from "grammy";
import { BotContext, PaguOneShotDraft, pendingPaguModifications, renderPaguOneShotCard } from "../types/bot-context.js";
import { metaAgent } from "../../ai/meta-agent.js";
import { staticParsePaguModification } from "../../ai/parsers/pagu-modification.parser.js";
import { staticConversationalReply } from "../../ai/static-fallback.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { SHEET_NAMES } from "../../google/sheets-recipes.js";
import { logger } from "../../utils/logger.js";
import {
  escapeHtml,
  formatRupiah,
  renderSppgOrderDraftCard,
  renderSupplierExpenseDraftCard,
} from "../formatter.js";
import {
  buildStartQuickActionKeyboard,
  buildPaguOrderListKeyboard,
  buildPaguItemListKeyboard,
  buildPaguItemEditConfirmKeyboard,
  buildPaguOneShotConfirmKeyboard,
  buildPaguClarifyAddOrReplaceKeyboard,
  buildEditConfirmKeyboard,
  buildDeleteConfirmKeyboard,
} from "../keyboards.js";
import { enrichReceiptWithPaguContext, getDraftConfirmationReplyMarkup } from "./draft.handler.js";
import { sendSheets, sendRekap, sendPdf } from "./report.handler.js";
import { sendRecentTransactions, sendTransactionDetail } from "./transaction.handler.js";
import { sendMyId, handleInviteCommand } from "./common.handler.js";

export function registerTextRouterHandler(bCtx: BotContext) {
  bCtx.bot.on("message:text", async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const state = bCtx.getState(userId);
    const text = ctx.message.text.trim();

    // Button Hygiene: Strip previous active keyboards if user sends a new chat message
    await bCtx.clearObsoleteKeyboards(ctx, state);

    // Instant Menu Trigger via text "menu"
    if (text.toLowerCase() === "menu") {
      const user = await bCtx.userRepo.getUser(userId);
      const userRole = user?.role === "member" ? "member" : "admin";
      const sentMsg = await ctx.reply(
        `⚡ <b>PINTASAN MENU OPERASIONAL (${escapeHtml(bCtx.unitConfig.name)})</b>\n\n` +
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
      if (await bCtx.isCallerMember(userId)) {
        await bCtx.notifyMemberRestricted(ctx, "kelola pagu anggaran dapur");
        return;
      }

      const explicitTarget = paguMatch[1]?.trim();
      const orders = await googleSheetsService.getPaguOrders(bCtx.unitConfig.spreadsheetId);

      if (orders.length === 0) {
        await ctx.reply(
          `📋 <b>KELOLA PAGU / RINCIAN BAHAN</b>\n` +
          `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n\n` +
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
          const items = await googleSheetsService.getPaguOrderItems(bCtx.unitConfig.spreadsheetId, matchedOrder.orderNo);
          const totalPagu = items.reduce((sum, it) => sum + (it.totalAmount || 0), 0);
          const headerText = [
            `📋 <b>RINCIAN BAHAN SURAT PESANAN (PO)</b>`,
            `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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

      const orderListText = [
        `📋 <b>KELOLA PAGU & RINCIAN BAHAN (Tab 03)</b>`,
        `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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
      if (await bCtx.isCallerMember(userId)) {
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

      await ctx.deleteMessage().catch(() => { });
      if (state.promptMsgId) {
        await ctx.api.deleteMessage(chatId, state.promptMsgId).catch(() => { });
        state.promptMsgId = undefined;
      }

      if (isNaN(cleanNum) || cleanNum <= 0) {
        await ctx.reply("⚠️ Nominal tidak valid. Pembaruan dibatalkan.", { parse_mode: "HTML" });
        return;
      }

      const confirmCard = [
        `⚠️ <b>KONFIRMASI PERUBAHAN TRANSAKSI GOOGLE SHEETS</b>`,
        `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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

    // 1b. If currently editing Pagu Item Detail in Tab 03
    if (state.editingPagu) {
      if (await bCtx.isCallerMember(userId)) {
        state.editingPagu = null;
        await ctx.reply(
          "⛔ <b>Akses Dibatasi</b>\n\nPengubahan rincian pagu hanya dapat dilakukan oleh Admin atau Super Admin.",
          { parse_mode: "HTML" }
        );
        return;
      }

      const { orderNo, rowIndex, field, itemName, unit } = state.editingPagu;
      state.editingPagu = null;

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

      const confirmCard = [
        `⚠️ <b>KONFIRMASI PERUBAHAN PAGU RINCIAN (Tab 03)</b>`,
        `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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

    // 1c. If currently adding a new Pagu Item to an Order
    if (state.addingPaguItemToOrder) {
      if (await bCtx.isCallerMember(userId)) {
        state.addingPaguItemToOrder = null;
        await ctx.reply(
          "⛔ <b>Akses Dibatasi</b>\n\nPenambahan rincian pagu hanya dapat dilakukan oleh Admin atau Super Admin.",
          { parse_mode: "HTML" }
        );
        return;
      }

      const { orderNo } = state.addingPaguItemToOrder;
      state.addingPaguItemToOrder = null;

      await ctx.deleteMessage().catch(() => {});
      if (state.promptMsgId) {
        await ctx.api.deleteMessage(chatId, state.promptMsgId).catch(() => {});
        state.promptMsgId = undefined;
      }

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
        spreadsheetId: bCtx.unitConfig.spreadsheetId,
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

      const cardText = renderPaguOneShotCard(draft, bCtx.unitConfig.name);
      const confirmMsg = await ctx.reply(cardText, {
        parse_mode: "HTML",
        reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
      });
      state.activeDraftMsgId = confirmMsg.message_id;
      return;
    }

    // 2. If currently editing pending draft field (nominal, name, or pagu)
    if (state.editingField && state.activeDraftId) {
      const draft = await bCtx.pendingRepo.getById(state.activeDraftId);
      if (!draft) {
        state.editingField = null;
        return;
      }

      if (state.editingField === "nominal") {
        const cleanNum = parseInt(text.replace(/[^\d]/g, ""), 10);
        if (!isNaN(cleanNum) && cleanNum > 0) {
          draft.payload.total_amount = cleanNum;
          await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
        }
      } else if (state.editingField === "name") {
        if (draft.action_type === "SPPG_ORDER") {
          draft.payload.sppg_unit = text;
        } else {
          draft.payload.supplier_name = text;
        }
        await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
      } else if (state.editingField === "pagu") {
        const cleanPagu = text.trim();
        draft.payload.sppg_ref_no = cleanPagu === "-" ? "" : cleanPagu;
        if (draft.action_type === "SUPPLIER_EXPENSE") {
          await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, draft.payload);
        }
        await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
      }

      state.editingField = null;

      await ctx.deleteMessage().catch(() => { });
      if (state.promptMsgId) {
        await ctx.api.deleteMessage(chatId, state.promptMsgId).catch(() => { });
        state.promptMsgId = undefined;
      }

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
      await bCtx.withTyping(ctx, async () => {
        const callingUser = await bCtx.userRepo.getUser(userId);
        const callerName = callingUser?.first_name || ctx.from?.first_name || (userId === 7546537134 ? "Heizaaa" : "Bapak/Ibu");
        const intent = await metaAgent.classifyAndRoute(text, bCtx.unitConfig.name, callerName);
        logger.info({ userId, callerName, intentType: intent.type }, "Meta-agent classified user message");

        switch (intent.type) {
          case "GET_REKAP":
            await sendRekap(bCtx, ctx);
            break;

          case "GET_PDF":
            await sendPdf(bCtx, ctx);
            break;

          case "GET_SHEETS":
            await sendSheets(bCtx, ctx);
            break;

          case "GET_MY_ID":
            await sendMyId(bCtx, ctx);
            break;

          case "LIST_TRANSACTIONS":
            await sendRecentTransactions(bCtx, ctx, intent.limit || 8);
            break;

          case "DETAIL_TRANSACTION":
            await sendTransactionDetail(bCtx, ctx, intent.transactionId);
            break;

          case "DELETE_TRANSACTION": {
            if (await bCtx.isCallerMember(userId)) {
              await bCtx.notifyMemberRestricted(ctx, "penghapusan transaksi");
              break;
            }

            const preview = await googleSheetsService.getCascadeDeletePreview(
              bCtx.unitConfig.spreadsheetId,
              intent.transactionId
            );

            if (!preview.found) {
              await ctx.reply(
                `❌ Transaksi <code>${escapeHtml(intent.transactionId)}</code> tidak ditemukan di Google Sheets unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
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
                `• Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n\n` +
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
                `• Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n\n` +
                `ℹ️ <b>Catatan Cascading:</b>\n` +
                `• <b>Tab 05 (Rincian Pengeluaran):</b> ${preview.childrenSummary?.rincianPengeluaranCount || 0} baris rincian belanja akan dihapus.\n` +
                `• <b>Tab 06 (Perbandingan Margin):</b> Realisasi belanja akan otomatis di-reset (${preview.childrenSummary?.resetRekapCount || 0} item kembali ke status 🟡 MENUNGGU INVOICE${preview.childrenSummary?.rekapCount ? ` dan ${preview.childrenSummary.rekapCount} item belanja tambahan dihapus` : ""}).\n\n` +
                `<i>Apakah Anda yakin ingin menghapus nota belanja ini?</i>`;
            } else {
              confirmationBody =
                `🚨 <b>KONFIRMASI PENGHAPUSAN TRANSAKSI</b>\n------------------------------------------\n` +
                `Apakah Anda yakin ingin <b>menghapus permanen</b> transaksi <code>${escapeHtml(intent.transactionId)}</code> dari Google Sheets unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>?\n\n` +
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
            if (await bCtx.isCallerMember(userId)) {
              await bCtx.notifyMemberRestricted(ctx, "pengubahan rincian pagu");
              break;
            }

            const req = intent.request;
            const targetName = req.newItemName || req.targetItemName || "";

            const isExpenseRef = !!(req.orderRef && /^(?:SPPG\d*[-_])?E[A-Z]\d+/i.test(req.orderRef.trim()));
            if (isExpenseRef) {
              const expenseTrx = await googleSheetsService.findTransactionById(bCtx.unitConfig.spreadsheetId, req.orderRef!);
              if (expenseTrx.found && expenseTrx.type === "expense") {
                const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;
                const draft: PaguOneShotDraft = {
                  draftId,
                  spreadsheetId: bCtx.unitConfig.spreadsheetId,
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

                const cardText = renderPaguOneShotCard(draft, bCtx.unitConfig.name);
                const confirmMsg = await ctx.reply(cardText, {
                  parse_mode: "HTML",
                  reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
                });
                state.activeDraftMsgId = confirmMsg.message_id;
                break;
              } else {
                await ctx.reply(
                  `❌ <b>Transaksi Belanja Tidak Ditemukan</b>\n\nTransaksi belanja dengan ID <code>${escapeHtml(req.orderRef!)}</code> tidak ditemukan di Tab 04_PAGU_PENGELUARAN unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
                  { parse_mode: "HTML" }
                );
                break;
              }
            }

            const queryRes = await googleSheetsService.findPaguItemByQuery(
              bCtx.unitConfig.spreadsheetId,
              req.orderRef || undefined,
              targetName
            );

            if (queryRes.availableOrders.length === 0) {
              await ctx.reply(
                `❌ <b>Tidak Ada Pagu Aktif</b>\n\nBelum ada Surat Pesanan / Pagu Anggaran aktif yang terdaftar di Tab 02_PAGU_PENERIMAAN unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
                { parse_mode: "HTML" }
              );
              break;
            }

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

            if (req.actionIntent === "ADD") {
              const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;
              const draft: PaguOneShotDraft = {
                draftId,
                spreadsheetId: bCtx.unitConfig.spreadsheetId,
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

              const cardText = renderPaguOneShotCard(draft, bCtx.unitConfig.name);
              const confirmMsg = await ctx.reply(cardText, {
                parse_mode: "HTML",
                reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
              });
              state.activeDraftMsgId = confirmMsg.message_id;
              break;
            }

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
                spreadsheetId: bCtx.unitConfig.spreadsheetId,
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

              const cardText = renderPaguOneShotCard(draft, bCtx.unitConfig.name);
              const confirmMsg = await ctx.reply(cardText, {
                parse_mode: "HTML",
                reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
              });
              state.activeDraftMsgId = confirmMsg.message_id;
              break;
            }

            if (targetName) {
              const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;
              const draft: PaguOneShotDraft = {
                draftId,
                spreadsheetId: bCtx.unitConfig.spreadsheetId,
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
                `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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
            if (await bCtx.isCallerMember(userId)) {
              await bCtx.notifyMemberRestricted(ctx, "pengubahan transaksi di Google Sheets");
              break;
            }

            if (intent.newAmount) {
              const confirmCard = [
                `⚠️ <b>KONFIRMASI PERUBAHAN TRANSAKSI GOOGLE SHEETS</b>`,
                `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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
            await handleInviteCommand(bCtx, ctx, intent.name, intent.role);
            break;

          case "RECORD_TRANSACTION": {
            if (intent.parsed.type === "SPPG_ORDER" && (await bCtx.isCallerMember(userId))) {
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
              hasMultiplePagu = await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, intent.parsed.data);
            }

            const draftId = `draft_${Date.now()}`;
            await bCtx.pendingRepo.create({
              id: draftId,
              sppg_id: bCtx.unitConfig.id,
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
            const user = await bCtx.userRepo.getUser(userId);
            const userRole = user?.role === "member" ? "member" : "admin";
            const sentMsg = await bCtx.safeReplyHtml(ctx, intent.reply, buildStartQuickActionKeyboard(userRole));
            if (sentMsg) {
              state.activeQuickActionMsgId = sentMsg.message_id;
            }
            break;
          }
        }
      });
    } catch (fatalErr: any) {
      logger.error({ fatalErr }, "Fatal error during text message processing, serving static fallback");
      const user = await bCtx.userRepo.getUser(userId);
      const userRole = user?.role === "member" ? "member" : "admin";
      const sentMsg = await bCtx.safeReplyHtml(ctx, staticConversationalReply(bCtx.unitConfig.name), buildStartQuickActionKeyboard(userRole));
      if (sentMsg) {
        state.activeQuickActionMsgId = sentMsg.message_id;
      }
    }
  });
}

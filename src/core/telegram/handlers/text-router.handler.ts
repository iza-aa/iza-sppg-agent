import { Context, InlineKeyboard } from "grammy";
import {
  type BotContext,
  type PaguOneShotDraft,
  type PendingItemAdditionState,
  pendingPaguModifications,
  pendingLinkRequests,
  renderPaguOneShotCard,
} from "../types/bot-context.js";
import { metaAgent } from "../../ai/meta-agent.js";
import { staticParsePaguModification } from "../../ai/parsers/pagu-modification.parser.js";
import { staticConversationalReply, parseIndonesianCurrency, parseItemAndQtyFromText } from "../../ai/static-fallback.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { SHEET_NAMES } from "../../google/sheets-recipes.js";
import { logger } from "../../utils/logger.js";
import {
  escapeHtml,
  formatRupiah,
  renderSppgOrderDraftCard,
  renderSupplierExpenseDraftCard,
  renderLinkExpenseConfirmationCard,
} from "../formatter.js";
import {
  buildStartQuickActionKeyboard,
  buildPaguOrderListKeyboard,
  buildPaguItemListKeyboard,
  buildPaguItemEditConfirmKeyboard,
  buildPaguOneShotConfirmKeyboard,
  buildUnbudgetedExpenseKeyboard,
  buildPaguClarifyAddOrReplaceKeyboard,
  buildEditConfirmKeyboard,
  buildDeleteConfirmKeyboard,
  buildDeleteBatchTransactionsKeyboard,
  buildDeleteChildItemKeyboard,
  buildDeletePaguItemKeyboard,
  buildCancelItemAdditionKeyboard,
} from "../keyboards.js";
import {
  enrichReceiptWithPaguContext,
  getDraftConfirmationReplyMarkup,
  cancelPreviousActiveDraftIfAny,
  scheduleDraftAutoExpiry,
  cancelDraftAutoExpiry,
} from "./draft.handler.js";
import { sendSheets, sendRekap, sendPdf } from "./report.handler.js";
import { sendRecentTransactions, sendTransactionDetail, sendTransactionHistoryPicker } from "./transaction.handler.js";
import { sendMyId, handleInviteCommand, sendPanduan } from "./common.handler.js";

async function sendMissingFieldsPrompt(
  ctx: Context,
  unitName: string,
  pending: PendingItemAdditionState
): Promise<any> {
  const isExpense = pending.isExpense;
  const unitLabel = escapeHtml(unitName);
  const title = isExpense
    ? "⚠️ <b>INFORMASI BELANJA BELUM LENGKAP</b>"
    : "⚠️ <b>INFORMASI BAHAN BELUM LENGKAP</b>";
  const refHeader = isExpense
    ? `ID Transaksi Belanja: <code>${escapeHtml(pending.orderLabel || pending.expenseId || pending.orderNo)}</code>`
    : `No SPPG Ref: <code>${escapeHtml(pending.orderLabel || pending.orderNo)}</code>`;
  const itemLabel = isExpense ? "Uraian Bahan Belanja" : "Uraian Bahan";
  const priceLabel = isExpense ? "Harga Satuan Invoice" : "Harga Pagu Satuan";
  const totalLabel = isExpense ? "Total Belanja" : "Total Pagu";
  const supplierLabel = isExpense ? "Nama Supplier" : "Target Supplier";

  const lines: string[] = [
    title,
    `Unit: <b>${unitLabel}</b>`,
    refHeader,
    `------------------------------------------`,
    `• <b>${itemLabel}:</b> ${pending.itemName ? `<b>${escapeHtml(pending.itemName)}</b>` : `❓ <i>Belum diisi</i>`}`,
    `• <b>Kuantitas:</b> ${pending.qty && pending.unit ? `<b>${pending.qty} ${escapeHtml(pending.unit)}</b>` : (pending.qty ? `<b>${pending.qty}</b> (<i>Satuan belum diisi</i>)` : `❓ <i>Belum diisi</i>`)}`,
    `• <b>${priceLabel}:</b> ${pending.price ? `<b>${formatRupiah(pending.price)}</b>` : `❓ <i>Belum diisi</i>`}`,
    pending.qty && pending.price ? `• <b>${totalLabel}:</b> <b>${formatRupiah(pending.qty * pending.price)}</b>` : ``,
    `• <b>${supplierLabel}:</b> ${pending.supplier ? `<b>${escapeHtml(pending.supplier)}</b>` : `❓ <i>Belum diisi</i>`}`,
    `------------------------------------------`,
  ].filter(Boolean);

  let instruction = "";
  if (!pending.supplier && pending.itemName && pending.qty && pending.price) {
    instruction = `👉 Mohon sebutkan <b>${supplierLabel}</b> untuk bahan ini:\n(Contoh: <i>Toko Berkah</i> atau <i>Hj Muliadi</i>)`;
  } else if (!pending.price && pending.itemName && pending.qty) {
    instruction = `👉 Mohon sebutkan <b>${priceLabel}</b> untuk bahan ini:\n(Contoh: <code>55.000</code> atau <code>55rb</code>)`;
  } else if (!pending.qty || !pending.unit) {
    instruction = `👉 Mohon sebutkan <b>Kuantitas dan Satuan</b> untuk bahan ini:\n(Contoh: <code>20 rak</code> atau <code>100 kg</code>)`;
  } else if (!pending.itemName) {
    instruction = `👉 Mohon sebutkan <b>${itemLabel}</b> yang ingin ditambahkan:\n(Contoh: <i>Telur Ayam</i> atau <i>Daging Sapi</i>)`;
  } else {
    instruction = `👉 Mohon lengkapi rincian bahan ini:\n(Contoh ketik: <code>20 rak @ 55.000 supplier Toko Berkah</code>)`;
  }

  lines.push(instruction);

  return await ctx.reply(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: buildCancelItemAdditionKeyboard(),
  });
}

async function sendEditTransactionConfirmCard(
  bCtx: BotContext,
  ctx: Context,
  state: any,
  transactionId: string,
  newAmount: number
) {
  const detail = await googleSheetsService.getTransactionDetail(bCtx.unitConfig.spreadsheetId, transactionId);
  const cleanTrxId = detail.found ? detail.id : transactionId;
  const childItems = await googleSheetsService.getExpenseItems(bCtx.unitConfig.spreadsheetId, cleanTrxId).catch(() => []);
  const isExpense = detail.type === "expense" || /^(?:SPPG\d*[-_])?E[A-Z]\d+/i.test(cleanTrxId);

  const lines = [
    isExpense
      ? `⚠️ <b>KONFIRMASI PERUBAHAN TRANSAKSI BELANJA</b>`
      : `⚠️ <b>KONFIRMASI PERUBAHAN TRANSAKSI GOOGLE SHEETS</b>`,
    `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
    `------------------------------------------`,
    `• <b>ID Transaksi:</b> <code>${escapeHtml(cleanTrxId)}</code>`,
  ];

  if (detail.supplierOrUnit && detail.supplierOrUnit !== "-") {
    lines.push(`• <b>Nama Rekanan:</b> ${escapeHtml(detail.supplierOrUnit)}`);
  }

  if (childItems.length === 1) {
    const item = childItems[0];
    const newUnitPrice = Math.round(newAmount / (item.qty || 1));
    lines.push(`• <b>Rincian Bahan:</b> ${escapeHtml(item.itemName)} (${item.qty} ${escapeHtml(item.unit)})`);
    lines.push(`• <b>Total Belanja Semula:</b> ${formatRupiah(detail.amount || item.total)} (@ ${formatRupiah(item.price)})`);
    lines.push(`• <b>Total Belanja Baru:</b> <b>${formatRupiah(newAmount)}</b> (@ ${formatRupiah(newUnitPrice)})`);
  } else {
    if (detail.amount) {
      lines.push(`• <b>Nominal Semula:</b> ${formatRupiah(detail.amount)}`);
    }
    lines.push(`• <b>Nominal Baru:</b> <b>${formatRupiah(newAmount)}</b>`);
  }

  lines.push(`------------------------------------------`);
  if (isExpense) {
    lines.push(`Data pada <b>Tab 05 Rincian Pengeluaran</b>, <b>Tab 04</b>, dan <b>Tab 06 Perbandingan Margin</b> akan otomatis diselaraskan.`);
  }
  lines.push(`Apakah Anda yakin ingin menerapkan perubahan ini ke Google Sheets?`);

  const confirmMsg = await ctx.reply(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: buildEditConfirmKeyboard(cleanTrxId, newAmount),
  });
  state.activeDraftMsgId = confirmMsg.message_id;
  return confirmMsg;
}

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
          `ℹ️ Belum ada data Surat Pesanan (PO) di Tab 02 (Pendapatan). Silakan upload nota pesanan terlebih dahulu.`,
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

      await sendEditTransactionConfirmCard(bCtx, ctx, state, trxId, cleanNum);
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
        fieldNameDisplay = "Target Supplier";
        if (!text || text.length < 2) {
          await ctx.reply("⚠️ Nama supplier tidak valid. Pembaruan pagu dibatalkan.", { parse_mode: "HTML" });
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
        `Perubahan ini akan memperbarui <b>Tab 03 (Rincian Pendapatan)</b> dan menyelaraskan otomatis <b>Tab 06 (Margin)</b>. Lanjutkan?`,
      ].join("\n");

      const confirmMsg = await ctx.reply(confirmCard, {
        parse_mode: "HTML",
        reply_markup: buildPaguItemEditConfirmKeyboard(orderNo, rowIndex, field, parsedValue),
      });
      state.activeDraftMsgId = confirmMsg.message_id;
      return;
    }

    // 1b. If currently completing a pending item addition (missing fields)
    if (state.pendingItemAddition) {
      const pending = state.pendingItemAddition;

      if (/^(batal|cancel|batalkan)$/i.test(text.trim())) {
        state.pendingItemAddition = null;
        if (pending.promptMsgId) {
          await ctx.api.deleteMessage(chatId, pending.promptMsgId).catch(() => {});
        }
        await ctx.reply("❌ Penambahan bahan dibatalkan.", { parse_mode: "HTML" });
        return;
      }

      await ctx.deleteMessage().catch(() => {});
      if (pending.promptMsgId) {
        await ctx.api.deleteMessage(chatId, pending.promptMsgId).catch(() => {});
        pending.promptMsgId = undefined;
      }

      // Try composite parse first (e.g. user typed "20 rak @ 55rb supplier Toko Berkah" or "55rb Toko Berkah")
      const compositeParsed = staticParsePaguModification("tambah bahan " + text);
      if (compositeParsed) {
        if (!pending.itemName && compositeParsed.targetItemName && compositeParsed.targetItemName.toLowerCase() !== "bahan") {
          pending.itemName = compositeParsed.targetItemName;
        }
        if (!pending.qty && compositeParsed.qty && compositeParsed.qty > 0) {
          pending.qty = compositeParsed.qty;
        }
        if (!pending.unit && compositeParsed.unit && compositeParsed.unit.toLowerCase() !== "satuan") {
          pending.unit = compositeParsed.unit;
        }
        if (!pending.price && compositeParsed.price && compositeParsed.price > 0) {
          pending.price = compositeParsed.price;
        }
        if (!pending.supplier && compositeParsed.supplier) {
          pending.supplier = compositeParsed.supplier;
        }
      }

      // Direct field extraction based on what is still missing:
      if (!pending.supplier) {
        const cleanSupplier = text
          .replace(/^(?:target\s*)?supplier\s*[:=]?\s*/i, "")
          .trim();
        if (cleanSupplier && !/^\d+$/.test(cleanSupplier) && cleanSupplier.length >= 2) {
          pending.supplier = cleanSupplier;
        }
      }

      if (!pending.price) {
        const priceMatch = text.match(/(?:@|rp\.?\s*)?(\d+(?:[.,]\d+)?\s*(?:rb|ribu|k\b)?|\d{3,})/i);
        if (priceMatch) {
          const rawP = priceMatch[1].toLowerCase().trim();
          if (/(?:jt|juta)/i.test(rawP)) {
            pending.price = Math.round(parseFloat(rawP.replace(/,/g, ".").replace(/[^\d.]/g, "")) * 1000000);
          } else if (/(?:rb|ribu|k\b)/i.test(rawP)) {
            pending.price = Math.round(parseFloat(rawP.replace(/,/g, ".").replace(/[^\d.]/g, "")) * 1000);
          } else {
            pending.price = parseInt(rawP.replace(/[^\d]/g, ""), 10);
          }
        }
      }

      if (!pending.qty || !pending.unit) {
        const qtyUnitMatch = text.match(/(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)/i);
        if (qtyUnitMatch) {
          pending.qty = parseFloat(qtyUnitMatch[1].replace(/,/g, "."));
          pending.unit = qtyUnitMatch[2].toLowerCase().trim();
        }
      }

      if (!pending.itemName) {
        if (!/^\d+$/.test(text.trim())) {
          pending.itemName = text.trim();
        }
      }

      // Check if all fields are now satisfied:
      if (
        pending.itemName &&
        pending.qty && pending.qty > 0 &&
        pending.unit &&
        pending.price && pending.price > 0 &&
        pending.supplier
      ) {
        const callerName = ctx.from?.first_name || (userId === 7546537134 ? "Heizaaa" : "Admin");
        const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;
        const draft: PaguOneShotDraft = {
          draftId,
          spreadsheetId: bCtx.unitConfig.spreadsheetId,
          orderNo: pending.orderNo,
          orderLabel: pending.orderLabel || `PO ${pending.orderNo}`,
          action: "ADD",
          itemName: pending.itemName,
          qty: pending.qty,
          unit: pending.unit,
          price: pending.price,
          supplier: pending.supplier,
          updatedBy: callerName,
          createdAt: Date.now(),
          isExpense: pending.isExpense,
          expenseId: pending.expenseId,
        };

        pendingPaguModifications.set(draftId, draft);
        state.pendingItemAddition = null;

        const cardText = renderPaguOneShotCard(draft, bCtx.unitConfig.name);
        const confirmMsg = await ctx.reply(cardText, {
          parse_mode: "HTML",
          reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
        });
        state.activeDraftMsgId = confirmMsg.message_id;
        return;
      }

      const promptMsg = await sendMissingFieldsPrompt(ctx, bCtx.unitConfig.name, pending);
      pending.promptMsgId = promptMsg?.message_id;
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
      const itemName = parsed?.newItemName || parsed?.targetItemName || (text.trim().length < 30 ? text.trim() : undefined);
      const qty = parsed?.qty && parsed.qty > 0 ? parsed.qty : undefined;
      const unit = parsed?.unit && parsed.unit.toLowerCase() !== "satuan" ? parsed.unit : undefined;
      const price = parsed?.price && parsed.price > 0 ? parsed.price : undefined;
      const supplier = (parsed?.supplier && parsed.supplier.toLowerCase() !== "lainnya") ? parsed.supplier : undefined;

      const orderLabel = `PO ${orderNo}`;

      if (itemName && qty && unit && price && supplier) {
        const callerName = ctx.from?.first_name || (userId === 7546537134 ? "Heizaaa" : "Admin");
        const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;
        const draft: PaguOneShotDraft = {
          draftId,
          spreadsheetId: bCtx.unitConfig.spreadsheetId,
          orderNo,
          orderLabel,
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

      // One or more fields missing -> guide user
      state.pendingItemAddition = {
        action: "ADD",
        orderNo,
        orderLabel,
        itemName,
        qty,
        unit,
        price,
        supplier,
      };

      const promptMsg = await sendMissingFieldsPrompt(ctx, bCtx.unitConfig.name, state.pendingItemAddition);
      state.pendingItemAddition.promptMsgId = promptMsg?.message_id;
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
        if (draft.action_type === "SPPG_ORDER") {
          if (draft.payload?.items && Array.isArray(draft.payload.items)) {
            draft.payload.total_amount = draft.payload.items.reduce(
              (acc: number, it: any) => acc + (Number(it.qty) * Number(it.price) || Number(it.total_price) || 0),
              0
            );
            await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
          }
        } else {
          const cleanNum = parseIndonesianCurrency(text) || parseInt(text.replace(/[^\d]/g, ""), 10);
          if (!isNaN(cleanNum) && cleanNum > 0) {
            draft.payload.total_amount = cleanNum;
            if (draft.payload?.items?.length === 1) {
              draft.payload.items[0].price = Math.round(cleanNum / (draft.payload.items[0].qty || 1));
              draft.payload.items[0].total_price = cleanNum;
            }
            await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
          }
        }
      } else if (state.editingField === "name") {
        if (draft.action_type === "SPPG_ORDER") {
          draft.payload.sppg_unit = text.trim();
        } else {
          draft.payload.supplier_name = text.trim();
        }
        await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
      } else if (state.editingField === "pagu") {
        const cleanPagu = text.trim();
        draft.payload.sppg_ref_no = cleanPagu === "-" ? "" : cleanPagu;
        if (draft.action_type === "SUPPLIER_EXPENSE") {
          await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, draft.payload);
        }
        await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
      } else if (state.editingField === "orderno") {
        const cleanNo = text.trim();
        if (cleanNo) {
          draft.payload.order_no = cleanNo;
          await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
        }
      } else if (state.editingField === "date") {
        const cleanDate = text.trim();
        if (cleanDate) {
          if (draft.action_type === "SPPG_ORDER") {
            draft.payload.order_date = cleanDate;
            draft.payload.arrival_date = cleanDate;
          } else {
            draft.payload.expense_date = cleanDate;
          }
          await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
        }
      } else if (state.editingField === "signer") {
        const cleanSigner = text.trim();
        if (cleanSigner) {
          draft.payload.signed_by = cleanSigner;
          await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
        }
      } else if (state.editingField === "method") {
        const rawChoice = text.trim().toLowerCase();
        let methodName = "Tunai";
        if (/^(?:transfer|tf|bca|bri|mandiri|bni)$/i.test(rawChoice)) {
          methodName = "Transfer";
        } else if (rawChoice === "qris") {
          methodName = "QRIS";
        } else if (/^(?:tempo|bon|utang|hutang)$/i.test(rawChoice)) {
          methodName = "Tempo / Bon";
        }
        draft.payload.payment_method = methodName;
        await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
      } else if (state.editingField === "item") {
        const parsedItem = parseItemAndQtyFromText(text);
        if (parsedItem) {
          draft.payload.items = [
            {
              item_name: parsedItem.itemName,
              qty: parsedItem.qty,
              unit: parsedItem.unit,
              price: parsedItem.price || 0,
              total_price: parsedItem.totalAmount || (parsedItem.price ? parsedItem.price * parsedItem.qty : 0),
            },
          ];
          if (parsedItem.totalAmount && parsedItem.totalAmount > 0) {
            draft.payload.total_amount = parsedItem.totalAmount;
          } else if (draft.payload.total_amount && draft.payload.total_amount > 0 && !parsedItem.price) {
            draft.payload.items[0].price = Math.round(draft.payload.total_amount / parsedItem.qty);
            draft.payload.items[0].total_price = draft.payload.total_amount;
          }
          await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);
        }
      }

      const fieldEdited = state.editingField;
      state.editingField = null;

      (ctx as any)._activityLogged = true;
      await bCtx.updateActivityStatus(
        draft.id,
        "PENDING",
        `Koreksi field ${fieldEdited} berhasil`,
        `Koreksi ${fieldEdited}: ${text.trim()}`
      ).catch(() => {});

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

    // 2b. Conversational Modification / Correction / Cancellation of Active Pending Draft
    if (state.activeDraftId && !state.editingField) {
      const isBypassDraftCommand =
        /^(?:beli|belanja|pesan|catat|order)\b/i.test(text.trim()) ||
        /\b(?:kaitkan|tautkan|hubungkan|sambungkan)\b/i.test(text.trim());
      if (isBypassDraftCommand) {
        await cancelPreviousActiveDraftIfAny(bCtx, ctx, chatId, state);
        state.activeDraftId = undefined;
        state.activeDraftMsgId = undefined;
      } else {
        const draft = await bCtx.pendingRepo.getById(state.activeDraftId).catch(() => null);
        if (draft && draft.status === "PENDING") {
          // A. Conversational Cancellation
          if (/^\s*(?:batal|batalkan|cancel|gak\s+jadi|nggak\s+jadi|tidak\s+jadi|hapus\s+draf)\s*$/i.test(text.trim())) {
            await bCtx.pendingRepo.updateStatus(draft.id, "CANCELLED").catch(() => {});
            cancelDraftAutoExpiry(draft.id);
            if (state.activeDraftMsgId) {
            const cancelledCard = draft.action_type === "SPPG_ORDER"
              ? renderSppgOrderDraftCard(draft.payload, draft.id, "CANCELLED")
              : renderSupplierExpenseDraftCard(draft.payload, draft.id, "CANCELLED", draft.media_url);
            await ctx.api.editMessageText(chatId, state.activeDraftMsgId, cancelledCard, {
              parse_mode: "HTML",
              reply_markup: { inline_keyboard: [] },
            }).catch(() => {});
          }
          state.activeDraftId = undefined;
          state.activeDraftMsgId = undefined;
          await ctx.reply(`❌ <b>Draf Transaksi Dibatalkan</b>\n\nPencatatan transaksi telah dibatalkan. Tidak ada data yang ditulis ke spreadsheet.`, { parse_mode: "HTML" });
          return;
        }

        // B. Conversational Pagu Correction / Change
        // e.g. "salah di pagu ii002 harusnya", "harusnya di pagu ii001", "pagu ii001", "ganti pagu ke ii001", "pagu non-pagu"
        const paguCorrectionMatch =
          text.match(/\b(?:salah\s+(?:di\s+)?pagu|ganti\s+pagu|ubah\s+pagu|pindah\s+pagu|pagu(?:nya)?|ke\s+pagu|di\s+pagu|pada\s+pagu|harusnya\s+(?:di\s+)?pagu)\s*[:=]?\s*([A-Za-z0-9_/-]+)/i) ||
          text.match(/\b(?:salah|keliru|bukan|harusnya)\b.*?\b(?:pagu|po)\s*[:=]?\s*([A-Za-z0-9_/-]+)/i) ||
          text.match(/\b(?:pagu|po)\s*[:=]?\s*([A-Za-z0-9_/-]+)\b.*?\b(?:salah|keliru|bukan|harusnya)\b/i) ||
          text.match(/^(?:di\s+|ke\s+|pada\s+)?pagu\s*[:=]?\s*([A-Za-z0-9_/-]+)\s*(?:saja|aja|ya|deh|dong)?$/i);

        const isNonPaguDirect = /\b(?:non[\s-]?pagu|bukan\s+pagu|belanja\s+tambahan)\b/i.test(text);

        if (paguCorrectionMatch || isNonPaguDirect) {
          const rawTargetRef = isNonPaguDirect ? "-" : paguCorrectionMatch![1].trim();

          if (rawTargetRef === "-" || /^(?:non|non-pagu|nonpagu)$/i.test(rawTargetRef)) {
            draft.payload.sppg_ref_no = "-";
            if (draft.action_type === "SUPPLIER_EXPENSE") {
              await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, draft.payload);
            }
            await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);

            if (state.activeDraftMsgId) {
              const itemsCount = draft.action_type === "SPPG_ORDER" ? draft.payload?.items?.length || 0 : undefined;
              const updatedCard = draft.action_type === "SPPG_ORDER"
                ? renderSppgOrderDraftCard(draft.payload, draft.id, "PENDING")
                : renderSupplierExpenseDraftCard(draft.payload, draft.id, "PENDING", draft.media_url);
              await ctx.api.editMessageText(chatId, state.activeDraftMsgId, updatedCard, {
                parse_mode: "HTML",
                reply_markup: getDraftConfirmationReplyMarkup(draft.id, draft.action_type, draft.payload, itemsCount, false),
              }).catch(() => {});
            }
            await ctx.reply(`✅ Alokasi transaksi berhasil diubah menjadi <b>Non-Pagu / Belanja Tambahan</b>.`, { parse_mode: "HTML" });
            return;
          }

          // Query Google Sheets for target Pagu code
          const paguCheck = await googleSheetsService.findPaguItemByQuery(
            bCtx.unitConfig.spreadsheetId,
            rawTargetRef
          );

          if (paguCheck.order) {
            const matchedOrder = paguCheck.order;
            draft.payload.sppg_ref_no = matchedOrder.orderNo;
            if (draft.action_type === "SUPPLIER_EXPENSE") {
              await enrichReceiptWithPaguContext(bCtx.unitConfig.spreadsheetId, draft.payload);
            }
            await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);

            if (state.activeDraftMsgId) {
              const itemsCount = draft.action_type === "SPPG_ORDER" ? draft.payload?.items?.length || 0 : undefined;
              const hasMultiple = (draft.payload as any)?.paguContext?.candidates_count > 1;
              const updatedCard = draft.action_type === "SPPG_ORDER"
                ? renderSppgOrderDraftCard(draft.payload, draft.id, "PENDING")
                : renderSupplierExpenseDraftCard(draft.payload, draft.id, "PENDING", draft.media_url);
              await ctx.api.editMessageText(chatId, state.activeDraftMsgId, updatedCard, {
                parse_mode: "HTML",
                reply_markup: getDraftConfirmationReplyMarkup(draft.id, draft.action_type, draft.payload, itemsCount, hasMultiple),
              }).catch(() => {});
            }
            await ctx.reply(
              `✅ Alokasi Pagu draf berhasil diubah ke <b>PO ${escapeHtml(matchedOrder.orderNo)}</b>${matchedOrder.transactionId ? ` (<code>${escapeHtml(matchedOrder.transactionId)}</code>)` : ""}.`,
              { parse_mode: "HTML" }
            );
            return;
          } else {
            // Target Pagu NOT found (e.g. ii002 doesn't exist)
            // CRITICAL: The active draft card retains its buttons!
            const available = paguCheck.availableOrders;
            const availableText = available.length > 0
              ? available.map((o, idx) => `${idx + 1}. <b>PO ${escapeHtml(o.orderNo)}</b>${o.transactionId ? ` (<code>${escapeHtml(o.transactionId)}</code>)` : ""}`).join("\n")
              : "<i>(Belum ada Surat Pesanan aktif terdaftar di Tab 02)</i>";

            await ctx.reply(
              `⚠️ <b>Surat Pesanan / Pagu Tidak Ditemukan</b>\n\n` +
              `Pagu dengan kode/nomor <code>${escapeHtml(rawTargetRef)}</code> tidak terdaftar di Tab 02 (Pendapatan) unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.\n\n` +
              `📋 <b>Pagu Aktif yang Tersedia:</b>\n${availableText}\n\n` +
              `<i>💡 Draf transaksi di atas tetap aktif menunggu konfirmasi Anda. Silakan pilih PO yang valid pada tombol di bawah atau gunakan draf di atas:</i>`,
              {
                parse_mode: "HTML",
                reply_markup: available.length > 0 ? buildPaguOrderListKeyboard(available) : undefined,
              }
            );
            return;
          }
        }

        // C. Conversational Nominal Correction
        // e.g. "salah nominal harusnya 600rb", "ganti nominal jadi 650.000", "harganya 600rb", or standalone "600rb", "600.000" if draft is missing amount
        const isDraftMissingAmount = !draft.payload?.total_amount || Number(draft.payload.total_amount) <= 0;
        const isStandaloneAmount = /^(?:rp\.?\s*)?(\d+(?:[.,]\d+)?\s*(?:rb|ribu|jt|juta|k)?|\d{3,})$/i.test(text.trim());
        const nominalCorrectionMatch = text.match(
          /\b(?:salah\s+(?:di\s+)?(?:nominal|harga|total)|ganti\s+(?:nominal|harga|total)|ubah\s+(?:nominal|harga|total)|(?:nominal|harga|total)(?:nya)?\s*[:=]?\s*)(\d+(?:[.,]\d+)?\s*(?:rb|ribu|jt|juta|k\b)?|\d{3,})/i
        );
        if (nominalCorrectionMatch || (isDraftMissingAmount && isStandaloneAmount)) {
          const rawAmount = nominalCorrectionMatch ? nominalCorrectionMatch[1] : text.trim();
          const newAmount = parseIndonesianCurrency(rawAmount);
          if (newAmount && newAmount > 0) {
            draft.payload.total_amount = newAmount;
            if (draft.payload?.items?.length === 1) {
              draft.payload.items[0].price = Math.round(newAmount / (draft.payload.items[0].qty || 1));
              draft.payload.items[0].total_price = newAmount;
            }
            await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);

            if (state.activeDraftMsgId) {
              const itemsCount = draft.action_type === "SPPG_ORDER" ? draft.payload?.items?.length || 0 : undefined;
              const hasMultiple = (draft.payload as any)?.paguContext?.candidates_count > 1;
              const updatedCard = draft.action_type === "SPPG_ORDER"
                ? renderSppgOrderDraftCard(draft.payload, draft.id, "PENDING")
                : renderSupplierExpenseDraftCard(draft.payload, draft.id, "PENDING", draft.media_url);
              await ctx.api.editMessageText(chatId, state.activeDraftMsgId, updatedCard, {
                parse_mode: "HTML",
                reply_markup: getDraftConfirmationReplyMarkup(draft.id, draft.action_type, draft.payload, itemsCount, hasMultiple),
              }).catch(() => {});
            }
            await ctx.reply(`✅ Nominal draf berhasil diubah menjadi <b>${formatRupiah(newAmount)}</b>.`, { parse_mode: "HTML" });
            return;
          }
        }

        // D. Conversational Supplier Correction
        // e.g. "salah supplier harusnya Toko Berkah", "ganti supplier jadi Toko Barokah", "supplier: Toko Berkah"
        const supplierCorrectionMatch = text.match(
          /\b(?:(?:salah\s+(?:di\s+)?|ganti\s+|ubah\s+)(?:supplier|toko|rekanan)|(?:supplier|toko|rekanan)nya|(?:supplier|toko|rekanan)\s*[:=])\s*([a-zA-Z0-9\s]+?)(?:\s+(?:tunai|cash|transfer|di|ke|pada)|$)/i
        );
        if (supplierCorrectionMatch) {
          const newSupplier = supplierCorrectionMatch[1].trim();
          if (newSupplier && !/^(pagu|nominal|harga|total)$/i.test(newSupplier)) {
            draft.payload.supplier_name = newSupplier;
            if (draft.payload?.items?.length === 1) {
              draft.payload.items[0].supplier_name = newSupplier;
            }
            await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);

            if (state.activeDraftMsgId) {
              const itemsCount = draft.action_type === "SPPG_ORDER" ? draft.payload?.items?.length || 0 : undefined;
              const hasMultiple = (draft.payload as any)?.paguContext?.candidates_count > 1;
              const updatedCard = draft.action_type === "SPPG_ORDER"
                ? renderSppgOrderDraftCard(draft.payload, draft.id, "PENDING")
                : renderSupplierExpenseDraftCard(draft.payload, draft.id, "PENDING", draft.media_url);
              await ctx.api.editMessageText(chatId, state.activeDraftMsgId, updatedCard, {
                parse_mode: "HTML",
                reply_markup: getDraftConfirmationReplyMarkup(draft.id, draft.action_type, draft.payload, itemsCount, hasMultiple),
              }).catch(() => {});
            }
            await ctx.reply(`✅ Nama supplier draf berhasil diubah menjadi <b>${escapeHtml(newSupplier)}</b>.`, { parse_mode: "HTML" });
            return;
          }
        }

        // E. Conversational Payment Method Selection / Correction (Khusus SUPPLIER_EXPENSE)
        // e.g. "tunai", "cash", "transfer", "tf", "bayar tunai", "metode tunai", "salah metode harusnya transfer"
        const isExpenseDraft = draft.action_type === "SUPPLIER_EXPENSE";
        const isStandalonePayWord = /^(?:tunai|cash|kontan|transfer|tf|bca|bri|mandiri|bni|qris|tempo|bon|utang|hutang)$/i.test(text.trim());
        const payMatch = text.match(
          /\b(?:salah\s+(?:di\s+)?(?:metode|pembayaran)|ganti\s+(?:metode|pembayaran)|ubah\s+(?:metode|pembayaran)|(?:metode|pembayaran)(?:nya)?\s*[:=]?\s*|(?:bayar\s+))(tunai|cash|kontan|transfer|tf|bca|bri|mandiri|bni|qris|tempo|bon|utang|hutang)\b/i
        );

        if (isExpenseDraft && (isStandalonePayWord || (payMatch && !text.toLowerCase().startsWith("beli ") && !text.toLowerCase().startsWith("catat ")))) {
          const rawChoice = (isStandalonePayWord ? text.trim() : (payMatch ? payMatch[1] : "")).toLowerCase();
          let methodName = "Tunai";
          if (/^(?:transfer|tf|bca|bri|mandiri|bni)$/i.test(rawChoice)) {
            methodName = "Transfer";
          } else if (rawChoice === "qris") {
            methodName = "QRIS";
          } else if (/^(?:tempo|bon|utang|hutang)$/i.test(rawChoice)) {
            methodName = "Tempo / Bon";
          }

          draft.payload.payment_method = methodName;
          await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);

          if (state.activeDraftMsgId) {
            const itemsCount = draft.action_type === "SPPG_ORDER" ? draft.payload?.items?.length || 0 : undefined;
            const hasMultiple = (draft.payload as any)?.paguContext?.candidates_count > 1;
            const updatedCard = renderSupplierExpenseDraftCard(draft.payload, draft.id, "PENDING", draft.media_url);
            await ctx.api.editMessageText(chatId, state.activeDraftMsgId, updatedCard, {
              parse_mode: "HTML",
              reply_markup: getDraftConfirmationReplyMarkup(draft.id, draft.action_type, draft.payload, itemsCount, hasMultiple),
            }).catch(() => {});
          }
          await ctx.reply(`✅ Metode pembayaran draf berhasil diset ke <b>${methodName}</b>.`, { parse_mode: "HTML" });
          return;
        }

        // F. Conversational PO Number Setting / Correction (Khusus SPPG_ORDER)
        // e.g. "PO-2026/09/SPPG2-01", "no po PO-2026/09/SPPG2-01", "salah no po harusnya PO-..."
        const isSppgOrderDraft = draft.action_type === "SPPG_ORDER";
        const poCorrectionMatch = text.match(
          /\b(?:salah\s+(?:di\s+)?(?:no\s+po|nomor\s+po|po)|ganti\s+(?:no\s+po|nomor\s+po|po)|ubah\s+(?:no\s+po|nomor\s+po|po)|(?:no\s+po|nomor\s+po|po)(?:nya)?\s*[:=]?\s*)([A-Za-z0-9_/-]+)/i
        ) || (isSppgOrderDraft && /^(?:PO[-\s]*)?[A-Za-z0-9_/-]{4,}$/i.test(text.trim()) && !/^(batal|simpan|ubah|menu|pagu)$/i.test(text.trim()) ? [text.trim(), text.trim()] : null);

        if (isSppgOrderDraft && poCorrectionMatch) {
          const rawPo = poCorrectionMatch[1].trim();
          const cleanPo = rawPo.toUpperCase().startsWith("PO-") ? rawPo : `PO-${rawPo.replace(/^PO\s*/i, "")}`;
          draft.payload.order_no = cleanPo;
          await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);

          if (state.activeDraftMsgId) {
            const itemsCount = draft.payload?.items?.length || 0;
            const updatedCard = renderSppgOrderDraftCard(draft.payload, draft.id, "PENDING");
            await ctx.api.editMessageText(chatId, state.activeDraftMsgId, updatedCard, {
              parse_mode: "HTML",
              reply_markup: getDraftConfirmationReplyMarkup(draft.id, draft.action_type, draft.payload, itemsCount),
            }).catch(() => {});
          }
          await ctx.reply(`✅ Nomor Surat Pesanan (PO) draf berhasil diset ke <code>${escapeHtml(cleanPo)}</code>.`, { parse_mode: "HTML" });
          return;
        }

        // G. Conversational Item & Qty Setting / Correction (Khusus SUPPLIER_EXPENSE)
        // e.g. "telur ayam 20 rak", "telur ayam 20 rak 600rb", "ganti barang jadi telur ayam 20 rak", "barangnya beras 2 karung"
        const isDraftMissingItems =
          !draft.payload?.items ||
          draft.payload.items.length === 0 ||
          draft.payload.items.every((it: any) => {
            const n = (it.item_name || "").trim().toLowerCase();
            return (
              !n ||
              n === "belanja bahan pangan" ||
              n === "bahan makanan" ||
              n === "bahan pangan" ||
              n === "barang" ||
              n === "bahan" ||
              n === "-"
            );
          });

        const itemCorrectionMatch = text.match(
          /\b(?:salah\s+(?:di\s+)?(?:barang|bahan|item)|ganti\s+(?:barang|bahan|item)|ubah\s+(?:barang|bahan|item)|(?:barang|bahan|item)(?:nya)?\s*[:=]?\s*)(.+)$/i
        );
        const itemCandidateText = itemCorrectionMatch ? itemCorrectionMatch[1] : text.trim();
        const parsedItemConv =
          isExpenseDraft && (isDraftMissingItems || itemCorrectionMatch)
            ? parseItemAndQtyFromText(itemCandidateText)
            : null;

        if (parsedItemConv && !isStandaloneAmount && !isStandalonePayWord) {
          draft.payload.items = [
            {
              item_name: parsedItemConv.itemName,
              qty: parsedItemConv.qty,
              unit: parsedItemConv.unit,
              price: parsedItemConv.price || 0,
              total_price:
                parsedItemConv.totalAmount ||
                (parsedItemConv.price ? parsedItemConv.price * parsedItemConv.qty : 0),
            },
          ];
          if (parsedItemConv.totalAmount && parsedItemConv.totalAmount > 0) {
            draft.payload.total_amount = parsedItemConv.totalAmount;
          } else if (draft.payload.total_amount && draft.payload.total_amount > 0 && !parsedItemConv.price) {
            draft.payload.items[0].price = Math.round(draft.payload.total_amount / parsedItemConv.qty);
            draft.payload.items[0].total_price = draft.payload.total_amount;
          }
          await bCtx.pendingRepo.updatePayload(draft.id, draft.payload);

          if (state.activeDraftMsgId) {
            const itemsCount = draft.action_type === "SPPG_ORDER" ? draft.payload?.items?.length || 0 : undefined;
            const hasMultiple = (draft.payload as any)?.paguContext?.candidates_count > 1;
            const updatedCard = renderSupplierExpenseDraftCard(draft.payload, draft.id, "PENDING", draft.media_url);
            await ctx.api.editMessageText(chatId, state.activeDraftMsgId, updatedCard, {
              parse_mode: "HTML",
              reply_markup: getDraftConfirmationReplyMarkup(
                draft.id,
                draft.action_type,
                draft.payload,
                itemsCount,
                hasMultiple
              ),
            }).catch(() => {});
          }
          await ctx.reply(
            `✅ Barang belanja berhasil dicatat: <b>${escapeHtml(parsedItemConv.itemName)} (${parsedItemConv.qty} ${escapeHtml(parsedItemConv.unit)})</b>.`,
            { parse_mode: "HTML" }
          );
          return;
        }
      }
    }
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

          case "GET_PANDUAN":
            await sendPanduan(bCtx, ctx);
            break;

          case "LIST_TRANSACTIONS":
            if (intent.filterType === "expense" || intent.filterType === "income") {
              await sendRecentTransactions(bCtx, ctx, intent.limit || 8, intent.filterType);
            } else {
              await sendTransactionHistoryPicker(bCtx, ctx);
            }
            break;

          case "DETAIL_TRANSACTION":
            await sendTransactionDetail(bCtx, ctx, intent.transactionId);
            break;

          case "DELETE_TRANSACTION": {
            if (await bCtx.isCallerMember(userId)) {
              await bCtx.notifyMemberRestricted(ctx, "penghapusan transaksi");
              break;
            }

            const targetIds = (intent.transactionIds && intent.transactionIds.length > 0)
              ? intent.transactionIds
              : [intent.transactionId];

            // MULTI-TRANSACTION BATCH DELETION BRANCH (2+ IDs)
            if (targetIds.length > 1) {
              const previewResults = await Promise.all(
                targetIds.map(async (id) => {
                  const p = await googleSheetsService.getCascadeDeletePreview(
                    bCtx.unitConfig.spreadsheetId,
                    id
                  );
                  return { id, preview: p };
                })
              );

              const notFound = previewResults.filter((r) => !r.preview.found);
              const found = previewResults.filter((r) => r.preview.found);

              if (found.length === 0) {
                const notFoundList = notFound.map((r) => `<code>${escapeHtml(r.id)}</code>`).join(", ");
                await ctx.reply(
                  `❌ Transaksi ${notFoundList} tidak ditemukan di Google Sheets unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
                  { parse_mode: "HTML" }
                );
                break;
              }

              // Check if any found is protected
              const protectedItem = found.find((r) => r.preview.isProtected);
              if (protectedItem) {
                const isTab05 = protectedItem.preview.sheetName === SHEET_NAMES.RINCIAN_PENGELUARAN;
                const tabDesc = isTab05 ? "Rincian Pengeluaran (Tab 05)" : "Rincian Pendapatan (Tab 03)";
                const parentHint = isTab05
                  ? `silakan hapus Faktur/Nota Induk di Tab 04 (${escapeHtml(protectedItem.preview.orderNo || "Tab 04 (Pengeluaran)")}).`
                  : `silakan hapus Pagu Induk di Tab 02 (${escapeHtml(protectedItem.preview.orderNo || "Tab 02 (Pendapatan)")}).`;

                await ctx.reply(
                  `⛔ <b>Akses Ditolak: Data Terproteksi</b>\n------------------------------------------\nTransaksi <code>${escapeHtml(protectedItem.id)}</code> merupakan <b>${tabDesc}</b>.\n\nData rincian bahan/belanja tidak dapat dihapus mandiri karena terikat mutlak dengan data induknya.\n\n💡 <i>Jika ingin membatalkan, ${parentHint}</i>`,
                  { parse_mode: "HTML" }
                );
                break;
              }

              // Save to state for confirmation callback
              state.activeDeleteBatchTransactions = found.map((r) => ({
                transactionId: r.preview.transactionId || r.id,
                sheetName: r.preview.sheetName || "",
                orderNo: r.preview.orderNo,
                amount: r.preview.amount,
                supplierOrUnit: r.preview.supplierOrUnit,
                rincianCount: r.preview.childrenSummary?.rincianCount,
                expenseCount: r.preview.childrenSummary?.expenseCount,
              }));

              let totalBatchAmount = 0;
              const itemListLines = found.map((r, i) => {
                const p = r.preview;
                const amt = p.amount || 0;
                totalBatchAmount += amt;
                const label = p.orderNo && p.orderNo !== "-" ? p.orderNo : (p.supplierOrUnit || "Transaksi");
                const isPagu = p.sheetName === SHEET_NAMES.PAGU_PENERIMAAN || p.sheetName === SHEET_NAMES.PAGU_RINGKASAN || p.sheetName === "02_PENDAPATAN_SPPG";
                const typeDesc = isPagu ? "Pagu Induk" : "Nota Belanja";
                return `  ${i + 1}. <b>${typeDesc}</b> <code>${escapeHtml(p.transactionId || r.id)}</code>\n     • Ref: <i>${escapeHtml(label)}</i>\n     • Nominal: <b>${formatRupiah(amt)}</b>`;
              }).join("\n\n");

              let notFoundNote = "";
              if (notFound.length > 0) {
                notFoundNote = `\n\n⚠️ <i>Catatan: Kode ${notFound.map((r) => `<code>${escapeHtml(r.id)}</code>`).join(", ")} tidak ditemukan di Sheets dan dilewati.</i>`;
              }

              const batchConfirmationBody =
                `🚨 <b>KONFIRMASI PENGHAPUSAN ${found.length} TRANSAKSI</b>\n------------------------------------------\n` +
                `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n\n` +
                `<b>Daftar Transaksi yang Akan Dihapus:</b>\n` +
                itemListLines +
                `\n------------------------------------------\n` +
                `• <b>Total Nominal Terpilih:</b> <b>${formatRupiah(totalBatchAmount)}</b>\n\n` +
                `⚠️ <b>PERINGATAN CASCADING:</b>\n` +
                `Seluruh data rincian bahan dan evaluasi margin terkait transaksi di atas akan <b>DIHAPUS PERMANEN</b> secara cascading.${notFoundNote}\n\n` +
                `<i>Apakah Anda yakin ingin menghapus ${found.length} transaksi di atas sekaligus?</i>`;

              const confirmMsg = await ctx.reply(batchConfirmationBody, {
                parse_mode: "HTML",
                reply_markup: buildDeleteBatchTransactionsKeyboard(found.length),
              });
              state.activeDraftMsgId = confirmMsg.message_id;
              break;
            }

            // SINGLE TRANSACTION BRANCH
            const singleId = targetIds[0];
            const preview = await googleSheetsService.getCascadeDeletePreview(
              bCtx.unitConfig.spreadsheetId,
              singleId
            );

            if (!preview.found) {
              await ctx.reply(
                `❌ Transaksi <code>${escapeHtml(singleId)}</code> tidak ditemukan di Google Sheets unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
                { parse_mode: "HTML" }
              );
              break;
            }

            if (preview.isProtected) {
              const isTab05 = preview.sheetName === SHEET_NAMES.RINCIAN_PENGELUARAN;
              const tabDesc = isTab05 ? "Rincian Pengeluaran (Tab 05)" : "Rincian Pendapatan (Tab 03)";
              const parentHint = isTab05
                ? `silakan hapus Faktur/Nota Induk di Tab 04 (${escapeHtml(preview.orderNo || "Tab 04 (Pengeluaran)")}).`
                : `silakan hapus Pagu Induk di Tab 02 (${escapeHtml(preview.orderNo || "Tab 02 (Pendapatan)")}).`;

              await ctx.reply(
                `⛔ <b>Akses Ditolak: Data Terproteksi</b>\n------------------------------------------\nTransaksi <code>${escapeHtml(singleId)}</code> merupakan <b>${tabDesc}</b>.\n\nData rincian bahan/belanja tidak dapat dihapus mandiri karena terikat mutlak dengan data induknya.\n\n💡 <i>Jika ingin membatalkan, ${parentHint}</i>`,
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
                `• ID Pagu: <code>${escapeHtml(preview.transactionId || singleId)}</code>\n` +
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
                `• ID Transaksi: <code>${escapeHtml(preview.transactionId || singleId)}</code>\n` +
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
                `Apakah Anda yakin ingin <b>menghapus permanen</b> transaksi <code>${escapeHtml(preview.transactionId || singleId)}</code> dari Google Sheets unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>?\n\n` +
                `<i>⚠️ Tindakan ini tidak dapat dibatalkan.</i>`;
            }

            const confirmMsg = await ctx.reply(confirmationBody, {
              parse_mode: "HTML",
              reply_markup: buildDeleteConfirmKeyboard(preview.transactionId || singleId),
            });
            state.activeDraftMsgId = confirmMsg.message_id;
            break;
          }

          case "DELETE_ITEM": {
            if (await bCtx.isCallerMember(userId)) {
              await bCtx.notifyMemberRestricted(ctx, "penghapusan rincian bahan");
              break;
            }

            const targetRef = intent.transactionId.trim();
            const targetItemName = intent.itemName.trim();
            const targetNames = intent.itemNames && intent.itemNames.length > 1
              ? intent.itemNames
              : [targetItemName];
            const isPaguTarget =
              /\bpagu\b/i.test(text) ||
              /^PO-/i.test(targetRef) ||
              /^\d{2}\/\d{2}\/\d{2}\/\d{2}$/.test(targetRef);

            // MULTI-ITEM DELETION BRANCH (2+ Items)
            if (targetNames.length > 1) {
              if (isPaguTarget) {
                const foundItems: any[] = [];
                const notFound: string[] = [];
                for (const name of targetNames) {
                  const f = await googleSheetsService.findPaguChildItem(
                    bCtx.unitConfig.spreadsheetId,
                    targetRef,
                    name
                  );
                  if (f.found) foundItems.push(f);
                  else notFound.push(name);
                }

                if (foundItems.length === 0) {
                  await ctx.reply(
                    `❌ Tidak ada bahan dari daftar [${targetNames.map((n) => `"${escapeHtml(n)}"`).join(", ")}] yang ditemukan pada pagu <code>${escapeHtml(targetRef || "-")}</code> di unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
                    { parse_mode: "HTML" }
                  );
                  break;
                }

                const notFoundWarning = notFound.length > 0
                  ? `\n⚠️ <i>Catatan: Bahan berikut tidak ditemukan: ${notFound.map((n) => `<b>${escapeHtml(n)}</b>`).join(", ")}</i>\n`
                  : "";

                const totalPaguLoss = foundItems.reduce((acc, it) => acc + (it.total || 0), 0);
                const itemsListFormatted = foundItems
                  .map((it, idx) => `  ${idx + 1}. <b>${escapeHtml(it.itemName)}</b> (${it.qty} ${escapeHtml(it.unit)} @ ${formatRupiah(it.price)} = <b>${formatRupiah(it.total)}</b>)`)
                  .join("\n");

                state.activeDeleteItems = foundItems.map((f) => ({
                  expenseId: f.orderNo,
                  itemName: f.itemName,
                  itemIndex: f.itemIndex,
                  rowIndex: f.rowIndex,
                  qty: f.qty,
                  unit: f.unit,
                  price: f.price,
                  total: f.total,
                  supplier: f.supplier,
                }));

                const confirmMsgText = [
                  `🗑️ <b>KONFIRMASI HAPUS ${foundItems.length} BAHAN DARI PAGU RESMI</b>`,
                  `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
                  `------------------------------------------`,
                  `• <b>Surat Pesanan:</b> <code>${escapeHtml(targetRef || foundItems[0].orderNo)}</code>`,
                  `• <b>Daftar Bahan yang Dihapus:</b>`,
                  itemsListFormatted,
                  `------------------------------------------`,
                  `📉 Total alokasi pagu berkurang: <b>${formatRupiah(totalPaguLoss)}</b>`,
                  `📍 Baris bahan ini akan dihapus dari <b>Tab 03 (Rincian Pendapatan)</b>.`,
                  `🔄 Baris evaluasi di <b>Tab 06 (Margin)</b> akan dihapus.`,
                  notFoundWarning,
                  `<i>Apakah Anda yakin ingin menghapus ${foundItems.length} bahan ini dari pagu?</i>`,
                ].filter(Boolean).join("\n");

                const confirmMsg = await ctx.reply(confirmMsgText, {
                  parse_mode: "HTML",
                  reply_markup: buildDeletePaguItemKeyboard(targetRef || foundItems[0].orderNo, undefined, foundItems.length),
                });
                state.activeDraftMsgId = confirmMsg.message_id;
                break;
              } else {
                // For Expense Child Items (Tab 05)
                const foundItems: any[] = [];
                const notFound: string[] = [];
                for (const name of targetNames) {
                  const f = await googleSheetsService.findExpenseChildItem(
                    bCtx.unitConfig.spreadsheetId,
                    targetRef,
                    name
                  );
                  if (f.found) foundItems.push(f);
                  else notFound.push(name);
                }

                if (foundItems.length === 0) {
                  await ctx.reply(
                    `❌ Tidak ada bahan dari daftar [${targetNames.map((n) => `"${escapeHtml(n)}"`).join(", ")}] yang ditemukan pada transaksi <code>${escapeHtml(targetRef || "-")}</code> di unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
                    { parse_mode: "HTML" }
                  );
                  break;
                }

                const notFoundWarning = notFound.length > 0
                  ? `\n⚠️ <i>Catatan: Bahan berikut tidak ditemukan: ${notFound.map((n) => `<b>${escapeHtml(n)}</b>`).join(", ")}</i>\n`
                  : "";

                const totalExpenseDeduction = foundItems.reduce((acc, it) => acc + (it.total || 0), 0);
                const itemsListFormatted = foundItems
                  .map((it, idx) => `  ${idx + 1}. <b>${escapeHtml(it.itemName)}</b> (${it.qty} ${escapeHtml(it.unit)} @ ${formatRupiah(it.price)} = <b>${formatRupiah(it.total)}</b>)${it.isNonPagu ? " <code>[NON-PAGU]</code>" : ""}`)
                  .join("\n");

                state.activeDeleteItems = foundItems.map((f) => ({
                  expenseId: f.expenseId,
                  itemName: f.itemName,
                  itemIndex: f.itemIndex,
                  rowIndex: f.rowIndex,
                  qty: f.qty,
                  unit: f.unit,
                  price: f.price,
                  total: f.total,
                  supplier: f.supplier,
                  isNonPagu: f.isNonPagu,
                }));

                const expId = foundItems[0].expenseId;
                const confirmMsgText = [
                  `🗑️ <b>KONFIRMASI HAPUS ${foundItems.length} RINCIAN BELANJA</b>`,
                  `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
                  `------------------------------------------`,
                  `• <b>Transaksi:</b> <code>Nota Supplier (${escapeHtml(expId)})</code>`,
                  `• <b>Daftar Bahan yang Dihapus:</b>`,
                  itemsListFormatted,
                  `------------------------------------------`,
                  `📉 Total tagihan berkurang: <b>${formatRupiah(totalExpenseDeduction)}</b>`,
                  `📍 Baris rincian akan dihapus dari <b>Tab 05 (Rincian Pengeluaran)</b>.`,
                  `🔄 Evaluasi margin di <b>Tab 06 (Margin)</b> akan disesuaikan.`,
                  notFoundWarning,
                  `<i>Apakah Anda yakin ingin menghapus ${foundItems.length} bahan ini?</i>`,
                ].filter(Boolean).join("\n");

                const confirmMsg = await ctx.reply(confirmMsgText, {
                  parse_mode: "HTML",
                  reply_markup: buildDeleteChildItemKeyboard(expId, undefined, foundItems.length),
                });
                state.activeDraftMsgId = confirmMsg.message_id;
                break;
              }
            }

            if (isPaguTarget) {
              const foundPagu = await googleSheetsService.findPaguChildItem(
                bCtx.unitConfig.spreadsheetId,
                targetRef,
                targetItemName
              );

              if (!foundPagu.found) {
                const otherHint = foundPagu.otherItems && foundPagu.otherItems.length > 0
                  ? `\n\n💡 <i>Bahan yang terdaftar pada pagu ${escapeHtml(targetRef || "-")}:</i>\n` +
                    foundPagu.otherItems.map((b) => `• <b>${escapeHtml(b)}</b>`).join("\n")
                  : "";

                await ctx.reply(
                  `❌ Bahan "<b>${escapeHtml(targetItemName)}</b>" tidak ditemukan pada pagu <code>${escapeHtml(targetRef || "-")}</code> di unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.${otherHint}`,
                  { parse_mode: "HTML" }
                );
                break;
              }

              state.activeDeleteItem = {
                expenseId: foundPagu.orderNo,
                itemName: foundPagu.itemName,
                itemIndex: foundPagu.itemIndex,
                rowIndex: foundPagu.rowIndex,
                qty: foundPagu.qty,
                unit: foundPagu.unit,
                price: foundPagu.price,
                total: foundPagu.total,
                supplier: foundPagu.supplier,
              };

              const warningOnlyItem = foundPagu.isOnlyItemInOrder
                ? `\n⚠️ <b>Catatan:</b> Ini adalah satu-satunya bahan dalam pesanan pagu <code>${escapeHtml(foundPagu.orderNo)}</code>. Total alokasi pesanan ini di Tab 02 akan menjadi Rp 0. Jika ingin membatalkan seluruh pesanan pagu, gunakan: <code>hapus ${escapeHtml(foundPagu.orderNo)}</code>.\n`
                : "";

              const confirmMsgText = [
                `🗑️ <b>KONFIRMASI HAPUS BAHAN DARI PAGU RESMI</b>`,
                `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
                `------------------------------------------`,
                `• <b>Surat Pesanan:</b> <code>${escapeHtml(foundPagu.orderNo)}</code>`,
                `• <b>Bahan yang Dihapus:</b> <b>${escapeHtml(foundPagu.itemName)}</b>`,
                `• <b>Alokasi Pagu:</b> ${foundPagu.qty} ${escapeHtml(foundPagu.unit)} @ ${formatRupiah(foundPagu.price)}`,
                `• <b>Total Pagu:</b> <b>${formatRupiah(foundPagu.total)}</b>`,
                `• <b>Supplier:</b> ${escapeHtml(foundPagu.supplier || "Supplier")}`,
                `------------------------------------------`,
                `📍 Baris bahan ini akan dihapus dari <b>Tab 03 (Rincian Pendapatan)</b>.`,
                `📉 Total pagu di <b>Tab 02 (Pendapatan)</b> otomatis berkurang <b>${formatRupiah(foundPagu.total)}</b>.`,
                `🔄 Baris evaluasi di <b>Tab 06 (Margin)</b> akan dihapus.`,
                warningOnlyItem,
                `<i>Apakah Anda yakin ingin menghapus bahan ini dari pagu resmi?</i>`,
              ].filter(Boolean).join("\n");

              const confirmMsg = await ctx.reply(confirmMsgText, {
                parse_mode: "HTML",
                reply_markup: buildDeletePaguItemKeyboard(foundPagu.orderNo, foundPagu.itemIndex),
              });
              state.activeDraftMsgId = confirmMsg.message_id;
              break;
            }

            // Otherwise, Expense Child Item (Tab 05)
            const foundItem = await googleSheetsService.findExpenseChildItem(
              bCtx.unitConfig.spreadsheetId,
              targetRef,
              targetItemName
            );

            // Fallback: If not found in Tab 05, check Tab 03 just in case
            if (!foundItem.found) {
              const fallbackPagu = await googleSheetsService.findPaguChildItem(
                bCtx.unitConfig.spreadsheetId,
                targetRef,
                targetItemName
              );
              if (fallbackPagu.found) {
                state.activeDeleteItem = {
                  expenseId: fallbackPagu.orderNo,
                  itemName: fallbackPagu.itemName,
                  itemIndex: fallbackPagu.itemIndex,
                  rowIndex: fallbackPagu.rowIndex,
                  qty: fallbackPagu.qty,
                  unit: fallbackPagu.unit,
                  price: fallbackPagu.price,
                  total: fallbackPagu.total,
                  supplier: fallbackPagu.supplier,
                };
                const confirmMsgText = [
                  `🗑️ <b>KONFIRMASI HAPUS BAHAN DARI PAGU RESMI</b>`,
                  `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
                  `------------------------------------------`,
                  `• <b>Surat Pesanan:</b> <code>${escapeHtml(fallbackPagu.orderNo)}</code>`,
                  `• <b>Bahan yang Dihapus:</b> <b>${escapeHtml(fallbackPagu.itemName)}</b>`,
                  `• <b>Alokasi Pagu:</b> ${fallbackPagu.qty} ${escapeHtml(fallbackPagu.unit)} @ ${formatRupiah(fallbackPagu.price)}`,
                  `• <b>Total Pagu:</b> <b>${formatRupiah(fallbackPagu.total)}</b>`,
                  `• <b>Supplier:</b> ${escapeHtml(fallbackPagu.supplier || "Supplier")}`,
                  `------------------------------------------`,
                  `📍 Baris bahan ini akan dihapus dari <b>Tab 03 (Rincian Pendapatan)</b>.`,
                  `📉 Total pagu di <b>Tab 02 (Pendapatan)</b> otomatis berkurang <b>${formatRupiah(fallbackPagu.total)}</b>.`,
                  `🔄 Baris evaluasi di <b>Tab 06 (Margin)</b> akan dihapus.`,
                  `\n<i>Apakah Anda yakin ingin menghapus bahan ini dari pagu?</i>`,
                ].join("\n");
                const confirmMsg = await ctx.reply(confirmMsgText, {
                  parse_mode: "HTML",
                  reply_markup: buildDeletePaguItemKeyboard(fallbackPagu.orderNo, fallbackPagu.itemIndex),
                });
                state.activeDraftMsgId = confirmMsg.message_id;
                break;
              }
            }

            if (!foundItem.found) {
              const otherHint = foundItem.otherItems && foundItem.otherItems.length > 0
                ? `\n\n💡 <i>Bahan yang terdaftar pada transaksi ${escapeHtml(targetRef || "-")}:</i>\n` +
                  foundItem.otherItems.map((b) => `• <b>${escapeHtml(b)}</b>`).join("\n")
                : "";

              await ctx.reply(
                `❌ Rincian bahan "<b>${escapeHtml(targetItemName)}</b>" tidak ditemukan pada transaksi <code>${escapeHtml(targetRef || "-")}</code> di unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.${otherHint}`,
                { parse_mode: "HTML" }
              );
              break;
            }

            // Save in user state for callback reference
            state.activeDeleteItem = {
              expenseId: foundItem.expenseId,
              itemName: foundItem.itemName,
              itemIndex: foundItem.itemIndex,
              rowIndex: foundItem.rowIndex,
              qty: foundItem.qty,
              unit: foundItem.unit,
              price: foundItem.price,
              total: foundItem.total,
              supplier: foundItem.supplier,
            };

            const warningOnlyItem = foundItem.isOnlyItemInExpense
              ? `\n⚠️ <b>Catatan:</b> Ini adalah satu-satunya bahan dalam transaksi <code>${escapeHtml(foundItem.expenseId)}</code>. Total tagihan nota ini di Tab 04 akan menjadi Rp 0. Jika ingin membatalkan seluruh nota faktur, gunakan: <code>hapus ${escapeHtml(foundItem.expenseId)}</code>.\n`
              : "";

            const nonPaguBadge = foundItem.isNonPagu ? " <code>[NON-PAGU]</code>" : "";

            const confirmMsgText = [
              `🗑️ <b>KONFIRMASI HAPUS RINCIAN BELANJA</b>`,
              `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
              `------------------------------------------`,
              `• <b>Transaksi:</b> <code>Nota Supplier (${escapeHtml(foundItem.expenseId)})</code>`,
              `• <b>Bahan yang Dihapus:</b> <b>${escapeHtml(foundItem.itemName)}</b>${nonPaguBadge}`,
              `• <b>Rincian:</b> ${foundItem.qty} ${escapeHtml(foundItem.unit)} @ ${formatRupiah(foundItem.price)}`,
              `• <b>Subtotal:</b> <b>${formatRupiah(foundItem.total)}</b>`,
              `• <b>Supplier:</b> ${escapeHtml(foundItem.supplier || "Supplier")}`,
              `------------------------------------------`,
              `📍 Baris rincian ini akan dihapus dari <b>Tab 05 (Rincian Pengeluaran)</b>.`,
              `📉 Total tagihan di Tab 04 dan Dashboard otomatis berkurang <b>${formatRupiah(foundItem.total)}</b>.`,
              `🔄 Evaluasi margin di Tab 06 otomatis disesuaikan.`,
              warningOnlyItem,
              `<i>Apakah Anda yakin ingin menghapus rincian bahan ini?</i>`,
            ].filter(Boolean).join("\n");

            const confirmMsg = await ctx.reply(confirmMsgText, {
              parse_mode: "HTML",
              reply_markup: buildDeleteChildItemKeyboard(foundItem.expenseId, foundItem.itemIndex),
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
                const orderNo = expenseTrx.orderNo || "-";
                const parsedItemName = targetName && targetName.toLowerCase() !== "bahan baru" ? targetName : undefined;
                const parsedQty = (req.qty !== undefined && req.qty !== null && req.qty > 0) ? req.qty : undefined;
                const parsedUnit = (req.unit && req.unit.toLowerCase() !== "satuan") ? req.unit : undefined;
                const parsedPrice = (req.price !== undefined && req.price !== null && req.price > 0) ? req.price : undefined;
                const parsedSupplier = (req.supplier && req.supplier.trim() && req.supplier.toLowerCase() !== "lainnya")
                  ? req.supplier.trim()
                  : (expenseTrx.supplierOrUnit || undefined);

                // If user is updating transaction amount without adding a new item
                if (
                  req.actionIntent === "UPDATE" &&
                  (!parsedItemName || /^(total|total belanja|belanja|nominal)$/i.test(parsedItemName)) &&
                  parsedPrice
                ) {
                  await sendEditTransactionConfirmCard(bCtx, ctx, state, expenseTrx.id, parsedPrice);
                  break;
                }

                if (!parsedItemName || !parsedQty || !parsedUnit || !parsedPrice || !parsedSupplier) {
                  state.pendingItemAddition = {
                    action: "ADD",
                    isExpense: true,
                    expenseId: expenseTrx.id,
                    orderNo,
                    orderLabel: `Nota Belanja (${expenseTrx.id})`,
                    itemName: parsedItemName,
                    qty: parsedQty,
                    unit: parsedUnit,
                    price: parsedPrice,
                    supplier: parsedSupplier,
                  };

                  const promptMsg = await sendMissingFieldsPrompt(ctx, bCtx.unitConfig.name, state.pendingItemAddition);
                  state.pendingItemAddition.promptMsgId = promptMsg?.message_id;
                  break;
                }

                const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;

                // Cross-check against Pagu PO
                let isUnbudgeted = false;
                let matchedPaguItem: any = undefined;

                if (orderNo && orderNo !== "-") {
                  const paguCheck = await googleSheetsService.findPaguItemByQuery(
                    bCtx.unitConfig.spreadsheetId,
                    orderNo,
                    targetName
                  ).catch(() => null);

                  if (!paguCheck || paguCheck.matchingItems.length === 0) {
                    isUnbudgeted = true;
                  } else {
                    matchedPaguItem = paguCheck.foundItem || paguCheck.matchingItems[0];
                  }
                } else {
                  isUnbudgeted = true;
                }

                const draft: PaguOneShotDraft = {
                  draftId,
                  spreadsheetId: bCtx.unitConfig.spreadsheetId,
                  orderNo,
                  orderLabel: `Nota Supplier (${expenseTrx.id})`,
                  action: "ADD",
                  itemName: parsedItemName,
                  qty: parsedQty,
                  unit: parsedUnit,
                  price: parsedPrice,
                  supplier: parsedSupplier,
                  updatedBy: callerName,
                  createdAt: Date.now(),
                  isExpense: true,
                  expenseId: expenseTrx.id,
                  isUnbudgeted,
                  matchedPaguItem,
                };

                pendingPaguModifications.set(draftId, draft);

                const cardText = renderPaguOneShotCard(draft, bCtx.unitConfig.name);
                const keyboard = isUnbudgeted
                  ? buildUnbudgetedExpenseKeyboard(draftId)
                  : buildPaguOneShotConfirmKeyboard(draftId);

                const confirmMsg = await ctx.reply(cardText, {
                  parse_mode: "HTML",
                  reply_markup: keyboard,
                });
                state.activeDraftMsgId = confirmMsg.message_id;
                break;
              } else {
                await ctx.reply(
                  `❌ <b>Transaksi Belanja Tidak Ditemukan</b>\n\nTransaksi belanja dengan ID <code>${escapeHtml(req.orderRef!)}</code> tidak ditemukan di Tab 04 (Pengeluaran) unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
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
                `❌ <b>Tidak Ada Pagu Aktif</b>\n\nBelum ada Surat Pesanan / Pagu Anggaran aktif yang terdaftar di Tab 02 (Pendapatan) unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
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
              const parsedItemName = targetName && targetName.toLowerCase() !== "bahan baru" ? targetName : undefined;
              const parsedQty = (req.qty !== undefined && req.qty !== null && req.qty > 0) ? req.qty : undefined;
              const parsedUnit = (req.unit && req.unit.toLowerCase() !== "satuan") ? req.unit : undefined;
              const parsedPrice = (req.price !== undefined && req.price !== null && req.price > 0) ? req.price : undefined;
              const parsedSupplier = (req.supplier && req.supplier.trim() && req.supplier.toLowerCase() !== "lainnya") ? req.supplier.trim() : undefined;

              if (parsedItemName && parsedQty && parsedUnit && parsedPrice && parsedSupplier) {
                const draftId = `p1s_${Math.random().toString(36).slice(2, 9)}`;
                const draft: PaguOneShotDraft = {
                  draftId,
                  spreadsheetId: bCtx.unitConfig.spreadsheetId,
                  orderNo: currentOrder.orderNo,
                  orderLabel,
                  action: "ADD",
                  itemName: parsedItemName,
                  qty: parsedQty,
                  unit: parsedUnit,
                  price: parsedPrice,
                  supplier: parsedSupplier,
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

              // One or more required fields missing -> guide user
              state.pendingItemAddition = {
                action: "ADD",
                orderNo: currentOrder.orderNo,
                orderLabel,
                itemName: parsedItemName,
                qty: parsedQty,
                unit: parsedUnit,
                price: parsedPrice,
                supplier: parsedSupplier,
              };

              const promptMsg = await sendMissingFieldsPrompt(ctx, bCtx.unitConfig.name, state.pendingItemAddition);
              state.pendingItemAddition.promptMsgId = promptMsg?.message_id;
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
              await sendEditTransactionConfirmCard(bCtx, ctx, state, intent.transactionId, intent.newAmount);
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

          case "LINK_EXPENSE_TO_PAGU": {
            if (await bCtx.isCallerMember(userId)) {
              await bCtx.notifyMemberRestricted(ctx, "penautan transaksi pengeluaran ke pagu");
              break;
            }

            // 1. Locate the expense transaction
            const expCheck = await googleSheetsService.findTransactionById(
              bCtx.unitConfig.spreadsheetId,
              intent.expenseId
            );
            if (!expCheck.found || expCheck.type !== "expense") {
              await ctx.reply(
                `⚠️ Transaksi pengeluaran <code>${escapeHtml(intent.expenseId)}</code> tidak ditemukan di Google Sheets unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
                { parse_mode: "HTML" }
              );
              break;
            }

            // 2. Locate the target Pagu order
            const paguCheck = await googleSheetsService.findTransactionById(
              bCtx.unitConfig.spreadsheetId,
              intent.paguId
            );
            let orderNo = paguCheck.found ? (paguCheck.orderNo || paguCheck.id) : "";
            let paguId = paguCheck.found ? paguCheck.id : intent.paguId;

            if (!orderNo || orderNo === "-") {
              const orders = await googleSheetsService.getPaguOrders(bCtx.unitConfig.spreadsheetId);
              const cleanTarget = intent.paguId.trim().toUpperCase();
              for (const o of orders) {
                const oNo = o.orderNo.trim();
                const tId = (o.transactionId || "").trim().toUpperCase();
                if (
                  oNo.toUpperCase().includes(cleanTarget) ||
                  tId === cleanTarget ||
                  tId.endsWith(`-${cleanTarget}`) ||
                  tId.endsWith(`_${cleanTarget}`) ||
                  (cleanTarget.length >= 4 && tId.includes(cleanTarget))
                ) {
                  orderNo = oNo;
                  paguId = tId || oNo;
                  break;
                }
              }
            }

            if (!orderNo || orderNo === "-") {
              await ctx.reply(
                `⚠️ Pagu pesanan <code>${escapeHtml(intent.paguId)}</code> tidak ditemukan di unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
                { parse_mode: "HTML" }
              );
              break;
            }

            // 3. Fetch items of this expense
            const rawItems = await googleSheetsService.getExpenseItems(
              bCtx.unitConfig.spreadsheetId,
              expCheck.id
            );
            const expenseItems = (rawItems && rawItems.length > 0)
              ? rawItems.map((it) => ({
                  itemName: it.itemName,
                  qty: it.qty,
                  unit: it.unit,
                  price: it.price,
                  total: it.total,
                  supplier: it.supplier || expCheck.supplierOrUnit,
                }))
              : [{
                  itemName: "Belanja Bahan Pangan",
                  qty: 1,
                  unit: "paket",
                  price: expCheck.amount || 0,
                  total: expCheck.amount || 0,
                  supplier: expCheck.supplierOrUnit || "Supplier",
                }];

            // 4. Fetch current pagu items to compute preview counts
            let currentItemCount = 0;
            const currentSuppliers = new Set<string>();
            try {
              const currentPaguItems = await googleSheetsService.getPaguOrderItems(
                bCtx.unitConfig.spreadsheetId,
                orderNo
              );
              currentItemCount = currentPaguItems.length;
              currentPaguItems.forEach((i) => {
                if (i.supplier && i.supplier !== "-") currentSuppliers.add(i.supplier.toLowerCase());
              });
            } catch (_) {}

            expenseItems.forEach((it) => {
              if (it.supplier && it.supplier !== "-") currentSuppliers.add(it.supplier.toLowerCase());
            });
            const newItemCount = currentItemCount + expenseItems.length;
            const newSupplierCount = currentSuppliers.size;

            // 5. Register pending link
            const linkId = `link_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            pendingLinkRequests.set(linkId, {
              linkId,
              expenseId: expCheck.id,
              paguId,
              orderNo,
              unitName: bCtx.unitConfig.name,
              supplier: expCheck.supplierOrUnit || "Supplier",
              amount: expCheck.amount || 0,
              items: expenseItems,
              callerName,
              newItemCount,
              newSupplierCount,
            });

            // 6. Build confirmation card and keyboard
            const cardText = renderLinkExpenseConfirmationCard({
              unitName: bCtx.unitConfig.name,
              expenseId: expCheck.id,
              paguId,
              orderNo,
              supplier: expCheck.supplierOrUnit || "Supplier",
              amount: expCheck.amount || 0,
              items: expenseItems,
              newItemCount,
              newSupplierCount,
            });

            const kb = new InlineKeyboard()
              .text("✅ Ya, Tautkan ke Pagu", `v:link_ok:${linkId}`)
              .text("❌ Batal", `v:link_cancel:${linkId}`);

            const sentMsg = await ctx.reply(cardText, {
              parse_mode: "HTML",
              reply_markup: kb,
            });

            if (sentMsg?.message_id && ctx.chat?.id) {
              bCtx.trackKeyboardMessage(ctx.chat.id, sentMsg.message_id);
            }
            break;
          }

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

            if (intent.parsed?.data) {
              (intent.parsed.data as any).notes = text;
              (intent.parsed.data as any).raw_user_input = text;
            }

            await cancelPreviousActiveDraftIfAny(bCtx, ctx, chatId, state);

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
            (intent.parsed.data as any).message_id = sentMsg.message_id;
            await bCtx.pendingRepo.updatePayload(draftId, intent.parsed.data);
            scheduleDraftAutoExpiry(bCtx, draftId, chatId, sentMsg.message_id);
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
      }, "⏳ <i>Pesan diterima! Sedang diproses...</i>");
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

import { Context, InlineKeyboard } from "grammy";
import { BotContext, pendingPaguModifications, renderPaguOneShotCard } from "../types/bot-context.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { logger } from "../../utils/logger.js";
import {
  escapeHtml,
  formatRupiah,
  safeEditMessageText,
} from "../formatter.js";
import {
  buildPaguOrderListKeyboard,
  buildPaguItemListKeyboard,
  buildPaguItemActionKeyboard,
  buildPaguOneShotConfirmKeyboard,
  buildPaguItemPickForReplaceKeyboard,
} from "../keyboards.js";

export async function sendPaguOrders(bCtx: BotContext, ctx: Context) {
  if (await bCtx.isCallerMember(ctx.from?.id)) {
    return bCtx.notifyMemberRestricted(ctx, "kelola pagu anggaran dapur");
  }

  await bCtx.withTyping(ctx, async () => {
    const orders = await googleSheetsService.getPaguOrders(bCtx.unitConfig.spreadsheetId);
    if (orders.length === 0) {
      await ctx.reply(
        `📋 <b>KELOLA PAGU / RINCIAN BAHAN</b>\n` +
        `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n\n` +
        `ℹ️ Belum ada data Surat Pesanan (PO) di Tab 02_PAGU_PENERIMAAN. Silakan upload nota pesanan atau input anggaran terlebih dahulu.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const orderListText = [
      `📋 <b>KELOLA PAGU & RINCIAN BAHAN (Tab 03)</b>`,
      `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
      `------------------------------------------`,
      `Pilih Surat Pesanan (PO) yang ingin Anda periksa atau ubah rincian kuantitas/harga bahannya:`,
    ].join("\n");

    await ctx.reply(orderListText, {
      parse_mode: "HTML",
      reply_markup: buildPaguOrderListKeyboard(orders),
    });
  });
}

export function registerPaguHandlers(bCtx: BotContext) {
  bCtx.bot.command("pagu", (ctx) => sendPaguOrders(bCtx, ctx));
  bCtx.bot.command("editpagu", (ctx) => sendPaguOrders(bCtx, ctx));

  // [📋 Daftar PO Pagu]
  bCtx.bot.callbackQuery("v:pagu_orders", async (ctx) => {
    const userId = ctx.from?.id;
    if (await bCtx.isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi: Hanya Admin/Super Admin.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    const orders = await googleSheetsService.getPaguOrders(bCtx.unitConfig.spreadsheetId);
    const orderListText = [
      `📋 <b>KELOLA PAGU & RINCIAN BAHAN (Tab 03)</b>`,
      `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
      `------------------------------------------`,
      `Pilih Surat Pesanan (PO) yang ingin Anda periksa atau ubah rincian kuantitas/harga bahannya:`,
    ].join("\n");

    await safeEditMessageText(ctx, orderListText, {
      parse_mode: "HTML",
      reply_markup: buildPaguOrderListKeyboard(orders),
    });
  });

  // [📦 Lihat Item Dalam PO]
  bCtx.bot.callbackQuery(/^v:pagu_ord:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await bCtx.isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi", show_alert: true });
      return;
    }
    const orderNo = ctx.match[1];
    await ctx.answerCallbackQuery({ text: `📋 Memuat PO ${orderNo}...` });

    const items = await googleSheetsService.getPaguOrderItems(bCtx.unitConfig.spreadsheetId, orderNo);
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

    const orders = await googleSheetsService.getPaguOrders(bCtx.unitConfig.spreadsheetId);
    const orderInfo = orders.find((o) => o.orderNo === orderNo);
    const totalPagu = items.reduce((sum, it) => sum + (it.totalAmount || 0), 0);

    const headerText = [
      `📋 <b>RINCIAN BAHAN SURAT PESANAN (PO)</b>`,
      `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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

  // [📄 Paginasi Item PO]
  bCtx.bot.callbackQuery(/^v:pagu_page:(.+):(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await bCtx.isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi", show_alert: true });
      return;
    }
    const orderNo = ctx.match[1];
    const page = parseInt(ctx.match[2], 10) || 0;
    await ctx.answerCallbackQuery();

    const items = await googleSheetsService.getPaguOrderItems(bCtx.unitConfig.spreadsheetId, orderNo);
    const orders = await googleSheetsService.getPaguOrders(bCtx.unitConfig.spreadsheetId);
    const orderInfo = orders.find((o) => o.orderNo === orderNo);
    const totalPagu = items.reduce((sum, it) => sum + (it.totalAmount || 0), 0);

    const headerText = [
      `📋 <b>RINCIAN BAHAN SURAT PESANAN (PO)</b>`,
      `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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

  // [🍗 Detail Bahan Tertentu]
  bCtx.bot.callbackQuery(/^v:pagu_it:(.+):(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await bCtx.isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi", show_alert: true });
      return;
    }
    const orderNo = ctx.match[1];
    const rowIndex = parseInt(ctx.match[2], 10);
    await ctx.answerCallbackQuery();

    const item = await googleSheetsService.getPaguItemByRow(bCtx.unitConfig.spreadsheetId, rowIndex);
    if (!item) {
      await safeEditMessageText(ctx, "⚠️ Rincian bahan tidak ditemukan di Google Sheets.", {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text("🔙 Kembali ke PO", `v:pagu_ord:${orderNo}`),
      });
      return;
    }

    const detailText = [
      `🍗 <b>DETAIL BAHAN PAGU (Tab 03 Baris ${rowIndex})</b>`,
      `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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

  // [✏️ Trigger Pengubahan Field Bahan Pagu]
  bCtx.bot.callbackQuery(/^v:pagu_act:(.+):(\d+):(qty|price|supplier|name)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await bCtx.isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi", show_alert: true });
      return;
    }
    const orderNo = ctx.match[1];
    const rowIndex = parseInt(ctx.match[2], 10);
    const field = ctx.match[3] as "qty" | "price" | "supplier" | "name";

    const item = await googleSheetsService.getPaguItemByRow(bCtx.unitConfig.spreadsheetId, rowIndex);
    if (!item) {
      await ctx.answerCallbackQuery({ text: "⚠️ Bahan tidak ditemukan.", show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    const state = bCtx.getState(userId!);
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

  // [💾 Apply Pagu Update ke Google Sheets]
  bCtx.bot.callbackQuery(/^v:pagu_apply:(.+):(\d+):(qty|price|supplier|name):(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await bCtx.isCallerMember(userId)) {
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
      bCtx.unitConfig.spreadsheetId,
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
      `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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

  // [➕ Prompt Tambah Bahan Baru ke PO]
  bCtx.bot.callbackQuery(/^v:pagu_add:(.+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (await bCtx.isCallerMember(userId)) {
      await ctx.answerCallbackQuery({ text: "⛔ Akses Dibatasi", show_alert: true });
      return;
    }
    const orderNo = ctx.match[1];
    await ctx.answerCallbackQuery();
    const state = bCtx.getState(userId!);
    state.addingPaguItemToOrder = { orderNo };

    const promptText = [
      `➕ <b>TAMBAH BAHAN BARU KE SURAT PESANAN</b>`,
      `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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
  bCtx.bot.callbackQuery(/^v:p1s_ok:(.+)$/, async (ctx) => {
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
        `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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
  bCtx.bot.callbackQuery(/^v:p1s_c:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    pendingPaguModifications.delete(draftId);
    await ctx.answerCallbackQuery({ text: "Dibatalkan." });
    await safeEditMessageText(ctx, `❌ <i>Pengubahan pagu telah dibatalkan.</i>`, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("🏠 Menu Utama", "qa:start"),
    });
  });

  // User chose to Add as New Item (when item didn't exist in PO)
  bCtx.bot.callbackQuery(/^v:p1s_add:(.+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const draft = pendingPaguModifications.get(draftId);
    if (!draft) {
      await ctx.answerCallbackQuery({ text: "Sesi telah kadaluarsa.", show_alert: true });
      return;
    }

    draft.action = "ADD";
    await ctx.answerCallbackQuery({ text: "Menyiapkan penambahan bahan baru..." });

    const card = renderPaguOneShotCard(draft, bCtx.unitConfig.name);
    await safeEditMessageText(ctx, card, {
      parse_mode: "HTML",
      reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
    });
  });

  // User chose to Replace an existing item in PO -> list existing items
  bCtx.bot.callbackQuery(/^v:p1s_rep:(.+):(\d+)$/, async (ctx) => {
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
      `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
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
  bCtx.bot.callbackQuery(/^v:p1s_pk:(.+):(\d+)$/, async (ctx) => {
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

    const card = renderPaguOneShotCard(draft, bCtx.unitConfig.name);
    await safeEditMessageText(ctx, card, {
      parse_mode: "HTML",
      reply_markup: buildPaguOneShotConfirmKeyboard(draftId),
    });
  });
}

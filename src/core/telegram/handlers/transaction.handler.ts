import { Context, InlineKeyboard } from "grammy";
import type { BotContext } from "../types/bot-context.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { SHEET_NAMES } from "../../google/sheets-recipes.js";
import {
  escapeHtml,
  formatRupiah,
  renderTransactionListCard,
  renderTransactionDetailCard,
  safeEditMessageText,
} from "../formatter.js";
import {
  buildTransactionListKeyboard,
  buildTransactionDetailKeyboard,
  buildDeleteConfirmKeyboard,
} from "../keyboards.js";

export async function sendRecentTransactions(bCtx: BotContext, ctx: Context, limit = 8) {
  if (await bCtx.isCallerMember(ctx.from?.id)) {
    return bCtx.notifyMemberRestricted(ctx, "riwayat transaksi lengkap Google Sheets");
  }

  await bCtx.withTyping(ctx, async () => {
    const transactions = await googleSheetsService.getRecentTransactions(bCtx.unitConfig.spreadsheetId, limit);
    const text = renderTransactionListCard(transactions);
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: transactions.length > 0 ? buildTransactionListKeyboard(transactions) : undefined,
    });
  });
}

export async function sendTransactionDetail(bCtx: BotContext, ctx: Context, transactionId: string) {
  if (await bCtx.isCallerMember(ctx.from?.id)) {
    return bCtx.notifyMemberRestricted(ctx, "detail transaksi Google Sheets");
  }

  await bCtx.withTyping(ctx, async () => {
    const detail = await googleSheetsService.getTransactionDetail(bCtx.unitConfig.spreadsheetId, transactionId);
    if (!detail.found) {
      await ctx.reply(`⚠️ Transaksi dengan ID <code>${escapeHtml(transactionId)}</code> tidak ditemukan di Google Sheets unit ${escapeHtml(bCtx.unitConfig.name)}.`, {
        parse_mode: "HTML",
      });
      return;
    }

    const text = renderTransactionDetailCard(detail);
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${bCtx.unitConfig.spreadsheetId}/edit`;
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: buildTransactionDetailKeyboard(detail.id, sheetUrl),
    });
  });
}

export function registerTransactionHandlers(bCtx: BotContext) {
  bCtx.bot.command("transaksi", async (ctx) => sendRecentTransactions(bCtx, ctx, 8));

  // [📋 Daftar Transaksi]
  bCtx.bot.callbackQuery("v:trx:list", async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Riwayat transaksi hanya dapat diakses oleh Admin.",
        show_alert: true,
      });
    }
    await ctx.answerCallbackQuery();
    await sendRecentTransactions(bCtx, ctx, 8);
  });

  // [🔍 Lihat Detail Transaksi]
  bCtx.bot.callbackQuery(/^v:trx:view:(.+)$/, async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Detail transaksi hanya dapat diakses oleh Admin.",
        show_alert: true,
      });
    }
    const trxId = ctx.match[1];
    await ctx.answerCallbackQuery();
    await sendTransactionDetail(bCtx, ctx, trxId);
  });

  // [🗑️ Tombol Hapus Transaksi (Konfirmasi Cascading In-Place)]
  bCtx.bot.callbackQuery(/^v:trx:del:(.+)$/, async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Penghapusan transaksi hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }
    const trxId = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "🔍 Memeriksa relasi data...", show_alert: false });

    const preview = await googleSheetsService.getCascadeDeletePreview(bCtx.unitConfig.spreadsheetId, trxId);
    if (!preview.found) {
      return safeEditMessageText(
        ctx,
        `❌ Transaksi <code>${escapeHtml(trxId)}</code> tidak ditemukan di Google Sheets unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>.`,
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
        `• Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n\n` +
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
        `• Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n\n` +
        `ℹ️ <b>Catatan Cascading:</b>\n` +
        `• <b>Tab 05 (Rincian Pengeluaran):</b> ${preview.childrenSummary?.rincianPengeluaranCount || 0} baris rincian belanja akan dihapus.\n` +
        `• <b>Tab 06 (Perbandingan Margin):</b> Realisasi belanja akan otomatis di-reset (${preview.childrenSummary?.resetRekapCount || 0} item kembali ke status 🟡 MENUNGGU INVOICE${preview.childrenSummary?.rekapCount ? ` dan ${preview.childrenSummary.rekapCount} item belanja tambahan dihapus` : ""}).\n\n` +
        `<i>Apakah Anda yakin ingin menghapus nota belanja ini?</i>`;
    } else {
      confirmationBody =
        `🚨 <b>KONFIRMASI PENGHAPUSAN TRANSAKSI</b>\n------------------------------------------\n` +
        `Apakah Anda yakin ingin <b>menghapus permanen</b> transaksi <code>${escapeHtml(trxId)}</code> dari Google Sheets unit <b>${escapeHtml(bCtx.unitConfig.name)}</b>?\n\n` +
        `<i>⚠️ Tindakan ini tidak dapat dibatalkan.</i>`;
    }

    await safeEditMessageText(ctx, confirmationBody, {
      parse_mode: "HTML",
      reply_markup: buildDeleteConfirmKeyboard(trxId),
    });
  });

  // [🗑️ Ya, Hapus Sekarang (Eksekusi Atomic Cascading)]
  bCtx.bot.callbackQuery(/^v:trx:delyes:(.+)$/, async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Penghapusan transaksi hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }
    const trxId = ctx.match[1];
    if (ctx.from) {
      const state = bCtx.getState(ctx.from.id);
      state.activeDraftMsgId = undefined;
    }
    await ctx.answerCallbackQuery({ text: "🗑️ Menghapus data dan relasinya...", show_alert: false });
    await safeEditMessageText(ctx, "⏳ <i>Sedang mengeksekusi penghapusan cascading di Google Sheets...</i>", { parse_mode: "HTML" });

    const result = await googleSheetsService.deleteTransactionRow(bCtx.unitConfig.spreadsheetId, trxId);
    if (result.success) {
      await safeEditMessageText(
        ctx,
        `🗑️ <b>Penghapusan Berhasil!</b>\n\n${result.message}\n\n<i>Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b></i>`,
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

  // [🗑️ Ya, Hapus Bahan dari Tab 05]
  bCtx.bot.callbackQuery(/^v:delit_yes:([^:]+)(?::(\d+))?$/, async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Penghapusan rincian hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }

    const expenseId = ctx.match[1];
    const state = ctx.from ? bCtx.getState(ctx.from.id) : undefined;
    if (state) {
      state.activeDraftMsgId = undefined;
    }

    const targetItemName = state?.activeDeleteItem?.itemName || "";

    await ctx.answerCallbackQuery({ text: "🗑️ Menghapus bahan dari Google Sheets...", show_alert: false });
    await safeEditMessageText(ctx, "⏳ <i>Sedang menghapus baris bahan di Tab 05 dan memperbarui evaluasi...</i>", {
      parse_mode: "HTML",
    });

    const result = await googleSheetsService.deleteExpenseChildItem(
      bCtx.unitConfig.spreadsheetId,
      expenseId,
      targetItemName,
      ctx.from?.first_name || "Admin"
    );

    if (result.success && result.deletedItem) {
      const del = result.deletedItem;
      const successText = [
        `🗑️ <b>Rincian Bahan Berhasil Dihapus!</b>`,
        `------------------------------------------`,
        `• <b>Bahan:</b> <s>${escapeHtml(del.itemName)}</s>`,
        `• <b>Transaksi:</b> <code>${escapeHtml(del.expenseId)}</code>`,
        `• <b>Nominal Berkurang:</b> <b>${formatRupiah(del.total)}</b>`,
        `• <b>Supplier:</b> ${escapeHtml(del.supplier || "Supplier")}`,
        `------------------------------------------`,
        `✅ Baris rincian di <b>Tab 05_RINCIAN_PENGELUARAN</b> telah dihapus.`,
        `✅ Total tagihan di <b>Tab 04_PAGU_PENGELUARAN</b> otomatis berkurang ${formatRupiah(del.total)}.`,
        `✅ <b>Tab 06_PERBANDINGAN_MARGIN</b> telah direkonsiliasi.`,
        `\n<i>Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b></i>`,
      ].join("\n");

      await safeEditMessageText(ctx, successText, { parse_mode: "HTML" });
      if (state) state.activeDeleteItem = null;
    } else {
      await safeEditMessageText(
        ctx,
        `❌ <b>Gagal menghapus rincian bahan:</b>\n${escapeHtml(result.message)}`,
        { parse_mode: "HTML" }
      );
    }
  });

  // [❌ Batalkan Penghapusan Bahan]
  bCtx.bot.callbackQuery(/^v:delit_no(?::(.+))?$/, async (ctx) => {
    if (ctx.from) {
      const state = bCtx.getState(ctx.from.id);
      state.activeDraftMsgId = undefined;
      state.activeDeleteItem = null;
    }
    await ctx.answerCallbackQuery({ text: "Penghapusan dibatalkan." });
    await safeEditMessageText(
      ctx,
      `❌ <i>Penghapusan rincian bahan dibatalkan. Data di Google Sheets tetap aman.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // [🗑️ Ya, Hapus Bahan dari Tab 03 Pagu]
  bCtx.bot.callbackQuery(/^v:delpg_yes:([^:]+)(?::(\d+))?$/, async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Penghapusan pagu hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }

    const orderNo = ctx.match[1];
    const state = ctx.from ? bCtx.getState(ctx.from.id) : undefined;
    if (state) {
      state.activeDraftMsgId = undefined;
    }

    const targetItemName = state?.activeDeleteItem?.itemName || "";

    await ctx.answerCallbackQuery({ text: "🗑️ Menghapus bahan dari pagu...", show_alert: false });
    await safeEditMessageText(ctx, "⏳ <i>Sedang menghapus bahan dari Tab 03 dan memperbarui pagu...</i>", {
      parse_mode: "HTML",
    });

    const result = await googleSheetsService.deletePaguChildItem(
      bCtx.unitConfig.spreadsheetId,
      orderNo,
      targetItemName,
      ctx.from?.first_name || "Admin"
    );

    if (result.success && result.deletedItem) {
      const del = result.deletedItem;
      const successText = [
        `🗑️ <b>Bahan Pagu Berhasil Dihapus!</b>`,
        `------------------------------------------`,
        `• <b>Bahan:</b> <s>${escapeHtml(del.itemName)}</s>`,
        `• <b>Surat Pesanan:</b> <code>${escapeHtml(del.orderNo)}</code>`,
        `• <b>Pagu Berkurang:</b> <b>${formatRupiah(del.total)}</b>`,
        `• <b>Supplier:</b> ${escapeHtml(del.supplier || "Supplier")}`,
        `------------------------------------------`,
        `✅ Baris bahan di <b>Tab 03_RINCIAN_PENDAPATAN</b> telah dihapus.`,
        `✅ Total pagu di <b>Tab 02_PAGU_PENERIMAAN</b> otomatis disesuaikan.`,
        `✅ Baris evaluasi di <b>Tab 06_PERBANDINGAN_MARGIN</b> telah dihapus.`,
        `\n<i>Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b></i>`,
      ].join("\n");

      await safeEditMessageText(ctx, successText, { parse_mode: "HTML" });
      if (state) state.activeDeleteItem = null;
    } else {
      await safeEditMessageText(
        ctx,
        `❌ <b>Gagal menghapus bahan pagu:</b>\n${escapeHtml(result.message)}`,
        { parse_mode: "HTML" }
      );
    }
  });

  // [❌ Batalkan Penghapusan Bahan Pagu]
  bCtx.bot.callbackQuery(/^v:delpg_no(?::(.+))?$/, async (ctx) => {
    if (ctx.from) {
      const state = bCtx.getState(ctx.from.id);
      state.activeDraftMsgId = undefined;
      state.activeDeleteItem = null;
    }
    await ctx.answerCallbackQuery({ text: "Penghapusan pagu dibatalkan." });
    await safeEditMessageText(
      ctx,
      `❌ <i>Penghapusan bahan pagu dibatalkan. Data pagu di Google Sheets tetap aman.</i>`,
      { parse_mode: "HTML" }
    );
  });

  // [✏️ Ubah Nominal Transaksi - Minta Input Nominal]
  bCtx.bot.callbackQuery(/^v:trx:edit:(.+)$/, async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Pengubahan transaksi di Google Sheets hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }
    const trxId = ctx.match[1];
    const state = bCtx.getState(ctx.from.id);
    state.editingTransactionId = trxId;
    await ctx.answerCallbackQuery();
    const prompt = await ctx.reply(
      `Ketik <b>nominal baru</b> untuk transaksi <code>${escapeHtml(trxId)}</code> (contoh: <code>850000</code> atau <code>850rb</code>):`,
      { parse_mode: "HTML" }
    );
    state.promptMsgId = prompt.message_id;
  });

  // [✅ Terapkan Perubahan Edit Transaksi ke Sheets (Pintu 3)]
  bCtx.bot.callbackQuery(/^v:trx:applyedit:(.+):(\d+)$/, async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Pengubahan transaksi di Google Sheets hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }
    const trxId = ctx.match[1];
    const newAmount = parseInt(ctx.match[2], 10);
    if (ctx.from) {
      const state = bCtx.getState(ctx.from.id);
      state.activeDraftMsgId = undefined;
    }

    await ctx.answerCallbackQuery({ text: "⚡ Memperbarui data di Google Sheets..." });
    await safeEditMessageText(ctx, "⏳ <i>Sedang menerapkan pembaruan ke Google Sheets...</i>", { parse_mode: "HTML" });

    const result = await googleSheetsService.updateTransactionRow(bCtx.unitConfig.spreadsheetId, trxId, {
      total_amount: newAmount,
    });

    if (result.success) {
      await safeEditMessageText(
        ctx,
        `✅ <b>Berhasil Memperbarui Transaksi!</b>\n\n• ID: <code>${escapeHtml(trxId)}</code>\n• Nominal Baru: <b>${formatRupiah(newAmount)}</b>\n• Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n\nData telah disinkronkan ke Google Sheets (termasuk penyelarasan otomatis pada Tab 06 Perbandingan Margin).`,
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
}

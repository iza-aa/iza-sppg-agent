import { Context, InlineKeyboard } from "grammy";
import { type BotContext, pendingLinkRequests } from "../types/bot-context.js";
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
  buildTransactionHistoryPickerKeyboard,
} from "../keyboards.js";

export async function sendRecentTransactions(
  bCtx: BotContext,
  ctx: Context,
  limit = 8,
  filterType: "all" | "expense" | "income" = "all"
) {
  if (await bCtx.isCallerMember(ctx.from?.id)) {
    return bCtx.notifyMemberRestricted(ctx, "riwayat transaksi lengkap Google Sheets");
  }

  await bCtx.withTyping(ctx, async () => {
    const transactions = await googleSheetsService.getRecentTransactions(bCtx.unitConfig.spreadsheetId, limit, filterType);
    const text = renderTransactionListCard(transactions, filterType);
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: transactions.length > 0
        ? buildTransactionListKeyboard(transactions, filterType)
        : new InlineKeyboard().text("🔙 Pilih Riwayat Lain", "v:tx:picker").text("🏠 Menu Utama", "qa:menu"),
    });
  });
}

export async function sendTransactionHistoryPicker(bCtx: BotContext, ctx: Context) {
  if (await bCtx.isCallerMember(ctx.from?.id)) {
    return bCtx.notifyMemberRestricted(ctx, "riwayat transaksi lengkap Google Sheets");
  }

  const text = [
    `🔍 <b>PILIH KATEGORI RIWAYAT TRANSAKSI</b>`,
    `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
    `------------------------------------------`,
    `Silakan pilih kategori riwayat transaksi yang ingin Anda periksa:\n`,
    `• 📈 <b>Riwayat Pendapatan:</b> Pagu Penerimaan & SPPG (Tab 02)`,
    `• 📉 <b>Riwayat Pengeluaran:</b> Belanja Bahan & Supplier (Tab 04)`,
  ].join("\n");

  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: buildTransactionHistoryPickerKeyboard(),
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
  bCtx.bot.command(["transaksi", "riwayat"], async (ctx) => sendTransactionHistoryPicker(bCtx, ctx));
  bCtx.bot.command(["pengeluaran", "belanja"], async (ctx) => sendRecentTransactions(bCtx, ctx, 8, "expense"));
  bCtx.bot.command(["pendapatan", "pagu_list"], async (ctx) => sendRecentTransactions(bCtx, ctx, 8, "income"));

  // [🔍 Sub-Menu Pemilih Riwayat]
  bCtx.bot.callbackQuery("v:tx:picker", async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Riwayat transaksi hanya dapat diakses oleh Admin.",
        show_alert: true,
      });
    }
    await ctx.answerCallbackQuery();
    await sendTransactionHistoryPicker(bCtx, ctx);
  });

  // [📋 Daftar Transaksi Berfilter (expense, income, all)]
  bCtx.bot.callbackQuery(/^v:tx:list:(expense|income|all):(\d+)$/, async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Riwayat transaksi hanya dapat diakses oleh Admin.",
        show_alert: true,
      });
    }
    const filter = ctx.match[1] as "expense" | "income" | "all";
    const limit = parseInt(ctx.match[2], 10) || 8;
    const filterLabel = filter === "expense" ? "Pengeluaran" : (filter === "income" ? "Pendapatan" : "Transaksi");
    await ctx.answerCallbackQuery({ text: `Memuat Riwayat ${filterLabel}...` });
    await sendRecentTransactions(bCtx, ctx, limit, filter);
  });

  // [📋 Legacy Fallback Callback]
  bCtx.bot.callbackQuery(/^v:tx:list:(\d+)$/, async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Riwayat transaksi hanya dapat diakses oleh Admin.",
        show_alert: true,
      });
    }
    const limit = parseInt(ctx.match[1], 10) || 8;
    await ctx.answerCallbackQuery({ text: "Memuat Riwayat Transaksi..." });
    await sendRecentTransactions(bCtx, ctx, limit, "all");
  });

  bCtx.bot.callbackQuery("v:trx:list", async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Riwayat transaksi hanya dapat diakses oleh Admin.",
        show_alert: true,
      });
    }
    await ctx.answerCallbackQuery();
    await sendTransactionHistoryPicker(bCtx, ctx);
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
        ? `silakan kelola atau hapus Faktur/Nota Induk di Tab 04 (${escapeHtml(preview.orderNo || "Tab 04 (Pengeluaran)")}).`
        : `silakan kelola atau hapus Pagu Induk di Tab 02 (${escapeHtml(preview.orderNo || "Tab 02 (Pendapatan)")}).`;

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

  // [🗑️ Ya, Hapus Semua (Batch Cascade Delete)]
  bCtx.bot.callbackQuery("v:trx:delbatch:yes", async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Penghapusan transaksi hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }

    const state = ctx.from ? bCtx.getState(ctx.from.id) : undefined;
    const batchItems = state?.activeDeleteBatchTransactions;
    if (state) {
      state.activeDraftMsgId = undefined;
    }

    if (!batchItems || batchItems.length === 0) {
      await ctx.answerCallbackQuery({ text: "Sesi penghapusan telah kadaluarsa." });
      return safeEditMessageText(ctx, "⚠️ <i>Sesi konfirmasi telah kadaluarsa. Silakan ketik perintah hapus kembali.</i>", {
        parse_mode: "HTML",
      });
    }

    await ctx.answerCallbackQuery({ text: "🗑️ Menghapus transaksi terpilih...", show_alert: false });
    await safeEditMessageText(
      ctx,
      `⏳ <i>Sedang mengeksekusi penghapusan cascading ${batchItems.length} transaksi di Google Sheets...</i>`,
      { parse_mode: "HTML" }
    );

    const deletedResults: Array<{
      id: string;
      orderNo?: string;
      amount?: number;
      supplierOrUnit?: string;
      success: boolean;
      message: string;
    }> = [];

    for (let idx = 0; idx < batchItems.length; idx++) {
      const item = batchItems[idx];
      if (idx > 0) {
        // Safe throttle to prevent Google Sheets 429 quota exhaustion and read-after-write desync
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      const res = await googleSheetsService.deleteTransactionRow(
        bCtx.unitConfig.spreadsheetId,
        item.transactionId
      );
      deletedResults.push({
        id: item.transactionId,
        orderNo: item.orderNo,
        amount: item.amount,
        supplierOrUnit: item.supplierOrUnit,
        success: res.success,
        message: res.message,
      });
    }

    const successes = deletedResults.filter((r) => r.success);
    const failures = deletedResults.filter((r) => !r.success);

    let summaryText = "";
    if (successes.length > 0) {
      let totalAmountDeleted = 0;
      const successLines = successes
        .map((s, idx) => {
          const amt = s.amount || 0;
          totalAmountDeleted += amt;
          const ref = s.orderNo && s.orderNo !== "-" ? s.orderNo : (s.supplierOrUnit || "Transaksi");
          return `  ${idx + 1}. <s>${escapeHtml(s.id)}</s> (${escapeHtml(ref)}) - <b>${formatRupiah(amt)}</b>`;
        })
        .join("\n");

      summaryText = [
        `🗑️ <b>${successes.length} Transaksi Berhasil Dihapus!</b>`,
        `------------------------------------------`,
        successLines,
        `------------------------------------------`,
        `• <b>Total Nilai Dihapus:</b> <b>${formatRupiah(totalAmountDeleted)}</b>`,
        `✅ Seluruh baris data induk dan data anak relasional di Google Sheets telah dibersihkan secara cascading.`,
      ].join("\n");
    }

    if (failures.length > 0) {
      const failLines = failures
        .map((f, idx) => `  ${idx + 1}. <code>${escapeHtml(f.id)}</code>: ${escapeHtml(f.message)}`)
        .join("\n");

      summaryText += `\n\n⚠️ <b>Gagal Dihapus (${failures.length}):</b>\n${failLines}`;
    }

    summaryText += `\n\n<i>Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b></i>`;

    await safeEditMessageText(ctx, summaryText, { parse_mode: "HTML" });
    if (state) {
      state.activeDeleteBatchTransactions = null;
    }
  });

  // [❌ Batalkan Batch Deletion]
  bCtx.bot.callbackQuery("v:trx:delbatch:no", async (ctx) => {
    if (ctx.from) {
      const state = bCtx.getState(ctx.from.id);
      state.activeDraftMsgId = undefined;
      state.activeDeleteBatchTransactions = null;
    }
    await ctx.answerCallbackQuery({ text: "Penghapusan dibatalkan." });
    await safeEditMessageText(
      ctx,
      `❌ <i>Penghapusan multi-transaksi dibatalkan. Seluruh data di Google Sheets tetap aman.</i>`,
      { parse_mode: "HTML" }
    );
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

    // MULTI-ITEM DELETION CASE
    if (state?.activeDeleteItems && state.activeDeleteItems.length > 1) {
      const itemsToDelete = state.activeDeleteItems;
      const itemNames = itemsToDelete.map((it) => it.itemName);

      await ctx.answerCallbackQuery({ text: "🗑️ Menghapus bahan-bahan dari Google Sheets...", show_alert: false });
      await safeEditMessageText(ctx, "⏳ <i>Sedang menghapus baris bahan di Tab 05 dan memperbarui evaluasi...</i>", {
        parse_mode: "HTML",
      });

      const result = await googleSheetsService.deleteMultipleExpenseChildItems(
        bCtx.unitConfig.spreadsheetId,
        expenseId,
        itemNames,
        ctx.from?.first_name || "Admin"
      );

      if (result.success && result.deletedItems.length > 0) {
        const deletedSummary = result.deletedItems
          .map((d, i) => `  ${i + 1}. <s>${escapeHtml(d.itemName)}</s> (${formatRupiah(d.total)})`)
          .join("\n");

        const successText = [
          `🗑️ <b>${result.deletedItems.length} Rincian Bahan Berhasil Dihapus!</b>`,
          `------------------------------------------`,
          `• <b>Transaksi:</b> <code>${escapeHtml(expenseId)}</code>`,
          `• <b>Bahan yang Dihapus:</b>`,
          deletedSummary,
          `------------------------------------------`,
          `• <b>Total Tagihan Berkurang:</b> <b>${formatRupiah(result.totalDeducted)}</b>`,
          `✅ Baris rincian di <b>Tab 05 (Rincian Pengeluaran)</b> telah dihapus.`,
          result.cleanedParent
            ? `✅ Seluruh rincian telah kosong, nota induk di <b>Tab 04</b> otomatis dibersihkan.`
            : `✅ Total tagihan di <b>Tab 04 (Pengeluaran)</b> otomatis terpotong.`,
          `✅ <b>Tab 06 (Margin)</b> telah direkonsiliasi.`,
          `\n<i>Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b></i>`,
        ].join("\n");

        await safeEditMessageText(ctx, successText, { parse_mode: "HTML" });
        if (state) {
          state.activeDeleteItems = null;
          state.activeDeleteItem = null;
        }
      } else {
        await safeEditMessageText(
          ctx,
          `❌ <b>Gagal menghapus rincian bahan:</b>\n${escapeHtml(result.message)}`,
          { parse_mode: "HTML" }
        );
      }
      return;
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
        `✅ Baris rincian di <b>Tab 05 (Rincian Pengeluaran)</b> telah dihapus.`,
        `✅ Total tagihan di <b>Tab 04 (Pengeluaran)</b> otomatis berkurang ${formatRupiah(del.total)}.`,
        `✅ <b>Tab 06 (Margin)</b> telah direkonsiliasi.`,
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
      state.activeDeleteItems = null;
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

    // MULTI-ITEM PAGU DELETION
    if (state?.activeDeleteItems && state.activeDeleteItems.length > 1) {
      const itemsToDelete = state.activeDeleteItems;
      await ctx.answerCallbackQuery({ text: "🗑️ Menghapus bahan-bahan dari pagu...", show_alert: false });
      await safeEditMessageText(ctx, "⏳ <i>Sedang menghapus bahan dari Tab 03 dan memperbarui pagu...</i>", {
        parse_mode: "HTML",
      });

      const deletedPagus: any[] = [];
      let totalPaguReduced = 0;
      for (const item of itemsToDelete) {
        const res = await googleSheetsService.deletePaguChildItem(
          bCtx.unitConfig.spreadsheetId,
          orderNo,
          item.itemName,
          ctx.from?.first_name || "Admin"
        );
        if (res.success && res.deletedItem) {
          deletedPagus.push(res.deletedItem);
          totalPaguReduced += res.deletedItem.total;
        }
      }

      if (deletedPagus.length > 0) {
        const deletedSummary = deletedPagus
          .map((d, i) => `  ${i + 1}. <s>${escapeHtml(d.itemName)}</s> (${formatRupiah(d.total)})`)
          .join("\n");

        const successText = [
          `🗑️ <b>${deletedPagus.length} Bahan Pagu Berhasil Dihapus!</b>`,
          `------------------------------------------`,
          `• <b>Surat Pesanan:</b> <code>${escapeHtml(orderNo)}</code>`,
          `• <b>Daftar Bahan:</b>`,
          deletedSummary,
          `------------------------------------------`,
          `• <b>Total Pagu Berkurang:</b> <b>${formatRupiah(totalPaguReduced)}</b>`,
          `✅ Baris bahan di <b>Tab 03 (Rincian Pendapatan)</b> telah dihapus.`,
          `✅ Total pagu di <b>Tab 02 (Pendapatan)</b> otomatis disesuaikan.`,
          `✅ Baris evaluasi di <b>Tab 06 (Margin)</b> telah dihapus.`,
          `\n<i>Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b></i>`,
        ].join("\n");

        await safeEditMessageText(ctx, successText, { parse_mode: "HTML" });
        if (state) {
          state.activeDeleteItems = null;
          state.activeDeleteItem = null;
        }
      } else {
        await safeEditMessageText(
          ctx,
          `❌ <b>Gagal menghapus bahan pagu.</b>`,
          { parse_mode: "HTML" }
        );
      }
      return;
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
        `✅ Baris bahan di <b>Tab 03 (Rincian Pendapatan)</b> telah dihapus.`,
        `✅ Total pagu di <b>Tab 02 (Pendapatan)</b> otomatis disesuaikan.`,
        `✅ Baris evaluasi di <b>Tab 06 (Margin)</b> telah dihapus.`,
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
      state.activeDeleteItems = null;
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
    const callerName = ctx.from?.first_name || "Admin";
    if (ctx.from) {
      const state = bCtx.getState(ctx.from.id);
      state.activeDraftMsgId = undefined;
    }

    await ctx.answerCallbackQuery({ text: "⚡ Memperbarui data di Google Sheets..." });
    await safeEditMessageText(ctx, "⏳ <i>Sedang menerapkan pembaruan ke Google Sheets...</i>", { parse_mode: "HTML" });

    const result = await googleSheetsService.updateTransactionRow(bCtx.unitConfig.spreadsheetId, trxId, {
      total_amount: newAmount,
      updatedBy: callerName,
    });

    if (result.success) {
      await safeEditMessageText(
        ctx,
        `✅ <b>Berhasil Memperbarui Transaksi Belanja!</b>\n\n• ID: <code>${escapeHtml(trxId)}</code>\n• Nominal Baru: <b>${formatRupiah(newAmount)}</b>\n• Diperbarui Oleh: <b>${escapeHtml(callerName)}</b>\n• Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n\nSeluruh data telah disinkronkan ke Google Sheets (Tab 04 Pengeluaran, Tab 05 Rincian Pengeluaran, dan Tab 06 Perbandingan Margin).`,
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

  // [✅ Konfirmasi Tautkan Pengeluaran ke Pagu]
  bCtx.bot.callbackQuery(/^v:link_ok:(.+)$/, async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Penautan transaksi ke pagu hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }

    const linkId = ctx.match[1];
    const pending = pendingLinkRequests.get(linkId);

    if (!pending) {
      await ctx.answerCallbackQuery({ text: "Sesi penautan telah kedaluwarsa.", show_alert: true });
      await safeEditMessageText(ctx, "⚠️ <i>Sesi penautan transaksi telah kedaluwarsa atau sudah diproses.</i>", {
        parse_mode: "HTML",
      });
      return;
    }

    await ctx.answerCallbackQuery({ text: "⚡ Menautkan ke pagu..." });
    await safeEditMessageText(
      ctx,
      `⏳ <i>Sedang memproses penautan pengeluaran <code>${escapeHtml(pending.expenseId)}</code> ke pagu <code>${escapeHtml(pending.paguId)}</code>...</i>`,
      { parse_mode: "HTML" }
    );

    const callerName = pending.callerName || ctx.from?.first_name || "Admin";
    const res = await googleSheetsService.linkExpenseToPagu(
      bCtx.unitConfig.spreadsheetId,
      pending.expenseId,
      pending.paguId,
      callerName
    );

    pendingLinkRequests.delete(linkId);

    if (!res.success) {
      await safeEditMessageText(
        ctx,
        `⚠️ <b>Gagal Menautkan Transaksi:</b>\n${escapeHtml(res.error || "Terjadi kesalahan saat memperbarui Google Sheets.")}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const unitName = bCtx.unitConfig.name;
    const replyText = [
      `Baik <b>${escapeHtml(callerName)}</b>, perintah Anda untuk menautkan transaksi pengeluaran <code>${escapeHtml(pending.expenseId)}</code> ke nota pagu pesanan <code>${escapeHtml(pending.paguId)}</code> telah saya terima.\n`,
      `<b>Detail Pengaitan Transaksi:</b>`,
      `• <b>ID Pengeluaran:</b> <code>${escapeHtml(pending.expenseId)}</code>`,
      `• <b>ID Pagu Pesanan:</b> <code>${escapeHtml(pending.paguId)}</code>`,
      `• <b>Status:</b> Siap diproses untuk alokasi realisasi belanja terhadap plafon anggaran <b>${escapeHtml(unitName)}</b>.\n`,
      `<b>Catatan:</b>`,
      `Untuk memverifikasi atau melihat pembaruan relasi transaksi dan perhitungan margin secara langsung dari Google Sheets, ${escapeHtml(callerName)} dapat mengetik <code>rekap</code> atau menekan menu 🔍 Riwayat Belanja.\n`,
      `Ada hal lain yang ingin dibantu atau dicatat lagi, ${escapeHtml(callerName)}?`,
    ].join("\n");

    const kb = new InlineKeyboard()
      .text("📉 Riwayat Pengeluaran", "v:tx:list:expense:5")
      .text("📊 Cek Rekap", "v:rekap:today")
      .row()
      .url("🌐 Buka Spreadsheet", `https://docs.google.com/spreadsheets/d/${bCtx.unitConfig.spreadsheetId}/edit`);

    await safeEditMessageText(ctx, replyText, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  });

  // [❌ Batal Tautkan Pengeluaran ke Pagu]
  bCtx.bot.callbackQuery(/^v:link_cancel:(.+)$/, async (ctx) => {
    const linkId = ctx.match[1];
    pendingLinkRequests.delete(linkId);
    await ctx.answerCallbackQuery({ text: "Penautan transaksi dibatalkan." });
    await safeEditMessageText(
      ctx,
      `❌ <i>Penautan transaksi pengeluaran ke pagu pesanan telah dibatalkan. Data Google Sheets tidak diubah.</i>`,
      { parse_mode: "HTML" }
    );
  });
}

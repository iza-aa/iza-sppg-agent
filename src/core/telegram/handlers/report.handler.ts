import { Context, InputFile } from "grammy";
import { BotContext } from "../types/bot-context.js";
import { googleSheetsService } from "../../google/sheets.service.js";
import { generateOfficialSppgPdf } from "../../pdf/pdf-report.service.js";
import { escapeHtml, formatRupiah } from "../formatter.js";
import {
  buildMultiSheetSelectorKeyboard,
  buildRekapActionKeyboard,
} from "../keyboards.js";

export async function sendSheets(bCtx: BotContext, ctx: Context) {
  if (await bCtx.isCallerMember(ctx.from?.id)) {
    return bCtx.notifyMemberRestricted(ctx, "spreadsheet keuangan SPPG");
  }

  await ctx.reply(
    `🌐 <b>PILIH SPREADSHEET GOOGLE SHEETS MBG:</b>\n\n` +
    `Unit aktif Anda saat ini: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n\n` +
    `Silakan ketuk tombol di bawah untuk membuka spreadsheet online:`,
    {
      parse_mode: "HTML",
      reply_markup: buildMultiSheetSelectorKeyboard(bCtx.unitConfig.id),
    }
  );
}

export async function sendRekap(bCtx: BotContext, ctx: Context) {
  if (await bCtx.isCallerMember(ctx.from?.id)) {
    return bCtx.notifyMemberRestricted(ctx, "laporan rekapitulasi keuangan & margin laba");
  }

  await bCtx.withTyping(ctx, async () => {
    const kpi = await googleSheetsService.getExecutiveKpi(bCtx.unitConfig.spreadsheetId);
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${bCtx.unitConfig.spreadsheetId}/edit`;

    const rekapText = [
      `📊 <b>REKAP EKSEKUTIF SPPG MBG</b>`,
      `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>`,
      `------------------------------------------`,
      `🟢 <b>Plafon Pendapatan</b> : ${formatRupiah(kpi.totalPlafon)}`,
      `🔴 <b>Realisasi Belanja</b>  : ${formatRupiah(kpi.totalBelanja)}`,
      `------------------------------------------`,
      `💎 <b>Margin Bersih</b>     : <b>${formatRupiah(kpi.marginBersih)} (${kpi.marginPercentage}%)</b>`,
      `Status Evaluasi: ${kpi.marginPercentage >= 15 ? "🟢 HEMAT / SURPLUS" : kpi.marginPercentage >= 5 ? "🟡 SESUAI PAGU" : "🔴 PERHATIAN: OVER-BUDGET"}`,
    ].join("\n");

    await ctx.reply(rekapText, {
      parse_mode: "HTML",
      reply_markup: buildRekapActionKeyboard(sheetUrl, bCtx.unitConfig.id),
    });
  });
}

export async function sendPdf(bCtx: BotContext, ctx: Context, explicitOrderNo?: string) {
  if (await bCtx.isCallerMember(ctx.from?.id)) {
    return bCtx.notifyMemberRestricted(ctx, "pencetakan dokumen resmi SPJ BGN");
  }

  await bCtx.withTyping(ctx, async () => {
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
    const kpi = await googleSheetsService.getExecutiveKpi(bCtx.unitConfig.spreadsheetId, targetOrderNo);
    const expenses = await googleSheetsService.getExpensesForReport(bCtx.unitConfig.spreadsheetId, targetOrderNo);
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
      sppgName: bCtx.unitConfig.name,
      periodDate: today,
      orderNo: displayOrder,
      totalPlafon,
      totalBelanja,
      marginBersih,
      marginPercentage,
      expenses,
    });

    const filename = `Laporan_SPJ_${bCtx.unitConfig.id}_${today}.pdf`;
    await ctx.replyWithDocument(new InputFile(pdfBuffer, filename), {
      caption: `📄 <b>Laporan Resmi SPJ Badan Gizi Nasional</b>\n` +
        `Unit: <b>${escapeHtml(bCtx.unitConfig.name)}</b>\n` +
        `Ref: <code>${displayOrder}</code>\n` +
        `Tanggal: <code>${today}</code>\n\n` +
        `💰 Total Plafon: <b>${formatRupiah(totalPlafon)}</b>\n` +
        `🛒 Total Belanja: <b>${formatRupiah(totalBelanja)}</b>\n` +
        `📈 Sisa Margin: <b>${formatRupiah(marginBersih)} (${marginPercentage}%)</b>`,
      parse_mode: "HTML",
    });
  });
}

export function registerReportHandlers(bCtx: BotContext) {
  bCtx.bot.command("sheets", (ctx) => sendSheets(bCtx, ctx));
  bCtx.bot.command("rekap", (ctx) => sendRekap(bCtx, ctx));
  bCtx.bot.command("pdf", (ctx) => sendPdf(bCtx, ctx));
  bCtx.bot.command("spj", (ctx) => sendPdf(bCtx, ctx));

  bCtx.bot.callbackQuery(/^v:rekap:pdf:(.+)$/, async (ctx) => {
    if (await bCtx.isCallerMember(ctx.from?.id)) {
      return ctx.answerCallbackQuery({
        text: "⛔ Akses Ditolak: Cetak PDF SPJ hanya dapat dilakukan oleh Admin.",
        show_alert: true,
      });
    }

    await ctx.answerCallbackQuery({ text: "📄 Menyiapkan Dokumen PDF SPJ..." });
    const rawMatch = ctx.match[1]?.trim();
    const orderNo = rawMatch === "all" || rawMatch === "monthly" ? undefined : rawMatch;
    return sendPdf(bCtx, ctx, orderNo);
  });
}

import { Context } from "grammy";
import { SppgOrder } from "../ai/schemas/sppg-order.schema.js";
import { SupplierReceipt } from "../ai/schemas/supplier-receipt.schema.js";
import { PendingActionStatus } from "../db/repositories/pending-action.repository.js";

export function escapeHtml(str: string): string {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function renderSppgOrderDraftCard(
  order: SppgOrder,
  draftId: string,
  status: PendingActionStatus
): string {
  const statusBadge =
    status === "SAVED"
      ? "✅ <b>STATUS: TERSIMPAN KE TAB 02_PAGU_RINGKASAN, 03_RINCIAN & 05_REKAP</b>"
      : status === "CANCELLED"
      ? "❌ <b>STATUS: DRAF DIBATALKAN</b>"
      : "⏳ <b>STATUS: MENUNGGU KONFIRMASI</b>";

  const topItems = order.items.slice(0, 5).map((item, idx) => {
    return `${idx + 1}. <b>${escapeHtml(item.item_name)}</b>: ${item.qty} ${escapeHtml(item.unit)} @ ${formatRupiah(item.price)} = <i>${formatRupiah(item.total_price)}</i> (${escapeHtml(item.supplier_target || "-")})`;
  });

  const remainingCount = order.items.length - topItems.length;
  const itemsText = topItems.join("\n") + (remainingCount > 0 ? `\n<i>... dan ${remainingCount} bahan lainnya (klik tombol di bawah untuk lihat semua)</i>` : "");

  return [
    `📋 <b>DRAF NOTA PESANAN SPPG (PAGU ANGGARAN RESMI)</b>`,
    `Unit: <b>${escapeHtml(order.sppg_unit)}</b>`,
    `No Pesanan: <code>${escapeHtml(order.order_no)}</code>`,
    `📅 Tanggal Terbit: <b>${order.order_date}</b>`,
    `🚚 Tanggal Tiba : <b>${order.arrival_date}</b>`,
    `🍲 Total Ragam : <b>${order.items.length} Komoditas Bahan</b>`,
    `💰 <b>TOTAL PAGU : ${formatRupiah(order.total_amount)}</b>`,
    `✍️ Penandatangan: ${escapeHtml(order.signed_by || "-")}`,
    `------------------------------------------`,
    `<b>Ringkasan Bahan:</b>`,
    itemsText,
    `------------------------------------------`,
    statusBadge,
  ].join("\n");
}

export function renderSppgOrderItemsDetail(order: SppgOrder): string {
  const itemsList = order.items
    .map((item, idx) => {
      return `${idx + 1}. <b>${escapeHtml(item.item_name)}</b>: ${item.qty} ${escapeHtml(item.unit)} @ ${formatRupiah(item.price)} = <b>${formatRupiah(item.total_price)}</b>\n   🎯 <i>Supplier: ${escapeHtml(item.supplier_target || "-")}</i>`;
    })
    .join("\n");

  return [
    `📋 <b>RINCIAN LENGKAP ${order.items.length} BAHAN MAKANAN</b>`,
    `No Pesanan: <code>${escapeHtml(order.order_no)}</code>`,
    `Unit Dapur: <b>${escapeHtml(order.sppg_unit)}</b>`,
    `Tanggal: <b>${order.order_date}</b> (Tiba: <b>${order.arrival_date}</b>)`,
    `💰 <b>TOTAL PAGU: ${formatRupiah(order.total_amount)}</b>`,
    `------------------------------------------`,
    itemsList,
    `------------------------------------------`,
    `<i>💡 Data rincian ini akan dicatat ke Tab 03_PAGU_RINCIAN dan dicocokkan otomatis di Tab 05_REKAP_MARGIN.</i>`,
  ].join("\n");
}

export interface PaguDraftContext {
  sppg_ref_no?: string;
  order_date?: string;
  pagu_supplier?: string;
  item_name?: string;
  target_qty?: number;
  unit?: string;
  fulfilled_qty?: number;
  current_qty?: number;
  remaining_qty?: number;
  candidates_count?: number;
}

export function renderSupplierExpenseDraftCard(
  expense: SupplierReceipt,
  draftId: string,
  status: PendingActionStatus,
  driveLink?: string
): string {
  const statusBadge =
    status === "SAVED"
      ? "✅ <b>STATUS: TERSIMPAN KE TAB 04_PENGELUARAN_SUPPLIER & REKAP MARGIN</b>"
      : status === "CANCELLED"
      ? "❌ <b>STATUS: DRAF DIBATALKAN</b>"
      : "⏳ <b>STATUS: MENUNGGU KONFIRMASI</b>";

  const itemsText = expense.items
    .slice(0, 4)
    .map((i) => `• ${escapeHtml(i.item_name)} (${i.qty} ${escapeHtml(i.unit)} @ ${formatRupiah(i.price)})`)
    .join("\n");

  const driveSection = driveLink
    ? `📁 <b>Bukti Foto</b>: <a href="${driveLink}">📸 Lihat Nota di Google Drive</a>`
    : `📁 <b>Bukti Foto</b>: <i>Tersimpan lokal</i>`;

  const ctx = (expense as any).paguContext as PaguDraftContext | undefined;
  let allocSection = "";
  let statusPaguLine = "";

  if (ctx && ctx.sppg_ref_no && ctx.sppg_ref_no !== "-") {
    const supplierInfo = ctx.pagu_supplier ? ` (${escapeHtml(ctx.pagu_supplier)})` : "";
    allocSection = `📄 <b>Alokasi Anggaran</b>: <code>${escapeHtml(ctx.sppg_ref_no)}</code>${supplierInfo}`;
    if (ctx.target_qty && ctx.target_qty > 0) {
      const currentQty = ctx.current_qty ?? (expense.items[0]?.qty || 0);
      const totalFulfilled = (ctx.fulfilled_qty || 0) + currentQty;
      if (totalFulfilled < ctx.target_qty) {
        const remaining = ctx.target_qty - totalFulfilled;
        statusPaguLine = `\n📦 <b>Status Pesanan</b>: 🟠 Baru beli sebagian (${totalFulfilled} dari ${ctx.target_qty} ${escapeHtml(ctx.unit || "")}, masih kurang ${remaining} ${escapeHtml(ctx.unit || "")})`;
      } else {
        statusPaguLine = `\n📦 <b>Status Pesanan</b>: 🟢 Belanja lengkap (${ctx.target_qty} ${escapeHtml(ctx.unit || "")} terpenuhi)`;
      }
    }
  } else if (expense.sppg_ref_no && expense.sppg_ref_no !== "-") {
    allocSection = `📄 <b>Ref No SPPG</b>: <code>${escapeHtml(expense.sppg_ref_no)}</code>`;
  } else {
    allocSection = `📄 <b>Alokasi Anggaran</b>: <i>Belanja Tambahan / Tanpa Pagu</i>`;
  }

  return [
    `🧾 <b>DRAF BELANJA SUPPLIER</b>`,
    `🏪 <b>Nama Supplier / Toko</b>: <b>${escapeHtml(expense.supplier_name)}</b>`,
    `📅 <b>Tanggal Nota</b>: ${expense.date}`,
    allocSection + statusPaguLine,
    `💵 <b>TOTAL BELANJA: ${formatRupiah(expense.total_amount)}</b>`,
    `💳 Metode: ${escapeHtml(expense.payment_method)}`,
    driveSection,
    `------------------------------------------`,
    `<b>Barang Belanja:</b>\n${itemsText || "• Belanja Bahan Pangan"}`,
    `------------------------------------------`,
    statusBadge,
  ].join("\n");
}

export async function safeEditMessageText(ctx: Context, text: string, extra?: any): Promise<void> {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err: any) {
    if (err?.description?.includes("message is not modified")) {
      return;
    }
    throw err;
  }
}

export function renderTransactionListCard(
  transactions: Array<{
    id: string;
    date: string;
    type: "expense" | "income";
    title: string;
    amount: number;
    detail: string;
  }>
): string {
  if (transactions.length === 0) {
    return "ℹ️ <b>Belum ada transaksi tercatat di Spreadsheet unit ini.</b>";
  }

  const lines = [
    `📋 <b>RIWAYAT TRANSAKSI TERAKHIR:</b>`,
    `------------------------------------------`,
  ];

  transactions.forEach((t, i) => {
    const icon = t.type === "income" ? "🟢" : "🔴";
    const typeLabel = t.type === "income" ? "Pagu" : "Belanja";
    lines.push(
      `${i + 1}. ${icon} <b>${escapeHtml(t.title)}</b>\n` +
      `   • ID: <code>${escapeHtml(t.id)}</code>\n` +
      `   • Nominal: <b>${formatRupiah(t.amount)}</b> (${typeLabel})\n` +
      `   • Tanggal: <code>${escapeHtml(t.date)}</code>`
    );
  });

  lines.push(`------------------------------------------`);
  lines.push(`💡 <i>Ketuk tombol di bawah atau ketik "detail [ID]" untuk melihat rincian / mengedit.</i>`);
  return lines.join("\n");
}

export function renderTransactionDetailCard(detail: {
  id: string;
  type?: "expense" | "income";
  date?: string;
  supplierOrUnit?: string;
  items?: string;
  amount?: number;
  link?: string;
  notes?: string;
}): string {
  const isIncome = detail.type === "income";
  const icon = isIncome ? "📋" : "🧾";
  const title = isIncome ? "DETAIL NOTA PESANAN SPPG" : "DETAIL BELANJA SUPPLIER";
  const partnerLabel = isIncome ? "Unit SPPG" : "Nama Supplier";
  const amountLabel = isIncome ? "TOTAL PAGU" : "TOTAL BELANJA";

  const driveSection = detail.link && detail.link.startsWith("http")
    ? `📁 <b>Bukti Foto</b>: <a href="${detail.link}">📸 Buka Foto di Google Drive</a>`
    : `📁 <b>Bukti Foto</b>: <i>Tersimpan lokal / tanpa foto</i>`;

  return [
    `${icon} <b>${title}</b>`,
    `------------------------------------------`,
    `• <b>ID Transaksi:</b> <code>${escapeHtml(detail.id)}</code>`,
    `• <b>Tanggal:</b> <code>${escapeHtml(detail.date || "-")}</code>`,
    `• <b>${partnerLabel}:</b> <b>${escapeHtml(detail.supplierOrUnit || "-")}</b>`,
    `• <b>Rincian:</b> ${escapeHtml(detail.items || "-")}`,
    `• <b>${amountLabel}:</b> <b>${formatRupiah(detail.amount || 0)}</b>`,
    `• <b>Catatan:</b> ${escapeHtml(detail.notes || "-")}`,
    driveSection,
    `------------------------------------------`,
    `💡 <i>Gunakan tombol di bawah untuk mengubah nominal atau menghapus transaksi dari kas & spreadsheet.</i>`,
  ].join("\n");
}

/**
 * Converts LLM-generated markdown (### headers, **bold**, *italic*, bullets)
 * into beautiful, clean Telegram HTML formatting.
 * Strictly eliminates raw markdown headers like "###", converts to <b>Header</b>,
 * converts * or - list bullets into •, and guarantees valid Telegram HTML.
 */
export function cleanMarkdownToTelegramHtml(text: string): string {
  if (!text) return "";

  let processed = text.replace(/\r\n/g, "\n");

  // 1. Stash and protect code blocks: ```code``` and `inline`
  const codeBlocks: string[] = [];
  processed = processed.replace(/```(?:[a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g, (_, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trim())}</pre>`);
    return `__CODE_BLOCK_${idx}__`;
  });

  const inlineCodes: string[] = [];
  processed = processed.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `__INLINE_CODE_${idx}__`;
  });

  // 2. Protect existing valid Telegram HTML tags
  const validTags: string[] = [];
  const validTagRegex = /<\/?(?:b|strong|i|em|u|ins|s|strike|del|span|tg-spoiler|a|tg-emoji|code|pre|blockquote)(?:\s+[^>]*)?>/gi;
  processed = processed.replace(validTagRegex, (tag) => {
    const idx = validTags.length;
    validTags.push(tag);
    return `__VALID_TAG_${idx}__`;
  });

  // 3. Escape all remaining stray < and > to prevent Telegram parse errors
  processed = processed.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // 4. Restore protected valid tags
  processed = processed.replace(/__VALID_TAG_(\d+)__/g, (_, idx) => validTags[Number(idx)] || "");

  // 5. Convert Markdown Headings (e.g. ### Header or ## Header or # Header)
  processed = processed.replace(/^[ \t]*#{1,6}[ \t]+(.*)$/gm, (_, headingText) => {
    const cleanHeading = headingText.replace(/^\*+|\*+$/g, "").trim();
    return `\n<b>${cleanHeading}</b>`;
  });

  // 5b. Convert Markdown horizontal dividers (---, ***, ___)
  processed = processed.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "------------------------------------------");

  // 6. Convert Markdown Bold (**text** or __text__)
  processed = processed.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  processed = processed.replace(/__(.+?)__/g, "<b>$1</b>");

  // 7. Convert Markdown Bullets (* item or - item or + item) at start of line
  processed = processed.replace(/^[ \t]*[*\-+•][ \t]+/gm, "• ");

  // 7b. Automatically bold bullet point headers (e.g. • Header: Description -> • <b>Header:</b> Description)
  processed = processed.replace(/^[ \t]*•\s*([^:\n]+):/gm, "• <b>$1:</b>");

  // 8. Convert remaining single *text* or _text_ to italic (when not a bullet)
  processed = processed.replace(/(^|[^\w*])\*([^\s*][^*]*?[^\s*])\*([^\w*]|$)/g, "$1<i>$2</i>$3");
  processed = processed.replace(/(^|[^\w_])_([^\s_][^_]*?[^\s_])_([^\w_]|$)/g, "$1<i>$2</i>$3");

  // 9. Restore code blocks & inline codes
  processed = processed.replace(/__INLINE_CODE_(\d+)__/g, (_, idx) => inlineCodes[Number(idx)] || "");
  processed = processed.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[Number(idx)] || "");

  // 10. Clean up duplicate/nested bold tags if any (<b><b>text</b></b> -> <b>text</b>)
  processed = processed.replace(/<b>\s*<b>(.*?)<\/b>\s*<\/b>/gi, "<b>$1</b>");

  // 11. Normalize excessive blank lines (more than 2 consecutive newlines -> 2)
  processed = processed.replace(/\n{3,}/g, "\n\n").trim();

  return processed;
}


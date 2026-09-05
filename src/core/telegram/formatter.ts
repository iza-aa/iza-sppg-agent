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
      ? "✅ <b>STATUS: TERSIMPAN KE TAB 02_PENDAPATAN_SPPG</b>"
      : status === "CANCELLED"
      ? "❌ <b>STATUS: DRAF DIBATALKAN</b>"
      : "⏳ <b>STATUS: MENUNGGU KONFIRMASI AYAH</b>";

  const topItems = order.items.slice(0, 5).map((item, idx) => {
    return `${idx + 1}. <b>${escapeHtml(item.item_name)}</b>: ${item.qty} ${escapeHtml(item.unit)} @ ${formatRupiah(item.price)} = <i>${formatRupiah(item.total_price)}</i> (${escapeHtml(item.supplier_target || "-")})`;
  });

  const remainingCount = order.items.length - topItems.length;
  const itemsText = topItems.join("\n") + (remainingCount > 0 ? `\n<i>... dan ${remainingCount} bahan lainnya</i>` : "");

  return [
    `📋 <b>DRAF NOTA PESANAN SPPG (PENDAPATAN / PAGU)</b>`,
    `Unit: <b>${escapeHtml(order.sppg_unit)}</b>`,
    `No Pesanan: <code>${escapeHtml(order.order_no)}</code>`,
    `📅 Tanggal Tiba: <b>${order.arrival_date}</b>`,
    `🍲 Jumlah Bahan: <b>${order.items.length} Item</b>`,
    `💰 <b>TOTAL PAGU: ${formatRupiah(order.total_amount)}</b>`,
    `✍️ Pejabat: ${escapeHtml(order.signed_by || "-")}`,
    `------------------------------------------`,
    `<b>Rincian Bahan Terbesar:</b>`,
    itemsText,
    `------------------------------------------`,
    statusBadge,
  ].join("\n");
}

export function renderSupplierExpenseDraftCard(
  expense: SupplierReceipt,
  draftId: string,
  status: PendingActionStatus,
  driveLink?: string
): string {
  const statusBadge =
    status === "SAVED"
      ? "✅ <b>STATUS: TERSIMPAN KE TAB 03_PENGELUARAN_SUPPLIER</b>"
      : status === "CANCELLED"
      ? "❌ <b>STATUS: DRAF DIBATALKAN</b>"
      : "⏳ <b>STATUS: MENUNGGU KONFIRMASI AYAH</b>";

  const itemsText = expense.items
    .slice(0, 4)
    .map((i) => `• ${escapeHtml(i.item_name)} (${i.qty} ${escapeHtml(i.unit)} @ ${formatRupiah(i.price)})`)
    .join("\n");

  const driveSection = driveLink
    ? `📁 <b>Bukti Foto</b>: <a href="${driveLink}">📸 Lihat Nota di Google Drive</a>`
    : `📁 <b>Bukti Foto</b>: <i>Tersimpan lokal</i>`;

  return [
    `🧾 <b>DRAF BELANJA SUPPLIER (PENGELUARAN RIIL)</b>`,
    `🏪 <b>Nama Supplier</b>: <b>${escapeHtml(expense.supplier_name)}</b>`,
    `📅 <b>Tanggal Nota</b>: ${expense.date}`,
    `📄 <b>Ref No SPPG</b>: <code>${escapeHtml(expense.sppg_ref_no || "-")}</code>`,
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


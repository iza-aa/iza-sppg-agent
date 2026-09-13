import { Context } from "grammy";
import { SppgOrder } from "../ai/schemas/sppg-order.schema.js";
import { SupplierReceipt } from "../ai/schemas/supplier-receipt.schema.js";
import { PendingActionStatus } from "../db/repositories/pending-action.repository.js";
import { formatWibDisplay } from "../utils/date-time.js";

export function escapeHtml(str?: string | null): string {
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
  // Ensure total_amount strictly equals the sum of items
  if (order.items && order.items.length > 0) {
    const computedTotal = order.items.reduce(
      (sum, item) => sum + (Number(item.qty) * Number(item.price) || Number(item.total_price) || 0),
      0
    );
    if (computedTotal > 0) {
      order.total_amount = computedTotal;
    }
  }

  const isMissingOrderNo = !order.order_no || order.order_no === "PO-AUTO" || order.order_no === "-" || order.order_no.trim() === "";
  const orderNoDisplay = isMissingOrderNo ? "❓ <i>Belum ditentukan</i>" : `<code>${escapeHtml(order.order_no)}</code>`;

  let statusBadge = "";
  if (status === "SAVED") {
    statusBadge = "✅ <b>STATUS: TERSIMPAN KE TAB 02 (Pendapatan), TAB 03 (Rincian) & TAB 06 (Margin)</b>";
  } else if (status === "CANCELLED") {
    statusBadge = "❌ <b>STATUS: DRAF DIBATALKAN</b>";
  } else if (status === "EXPIRED") {
    statusBadge = "⌛ <b>STATUS: DRAF KEDALUWARSA</b>\n\n<i>Sesi konfirmasi telah berakhir. Silakan kirim ulang dokumen atau input transaksi baru.</i>";
  } else if (isMissingOrderNo) {
    statusBadge = "⚠️ <b>STATUS: MENUNGGU NO SURAT PESANAN (PO)</b>\n\n👉 <i>Silakan masukkan Nomor Surat Pesanan (PO) resmi pada tombol di bawah atau ketik di chat (misal: PO-2026/09/SPPG2-01):</i>";
  } else {
    statusBadge = "⏳ <b>STATUS: MENUNGGU KONFIRMASI</b>";
  }

  const topItems = order.items.slice(0, 5).map((item, idx) => {
    return `${idx + 1}. <b>${escapeHtml(item.item_name)}</b>: ${item.qty} ${escapeHtml(item.unit)} @ ${formatRupiah(item.price)} = <i>${formatRupiah(item.total_price)}</i> (${escapeHtml(item.supplier_target || "-")})`;
  });

  const remainingCount = order.items.length - topItems.length;
  const itemsText = topItems.join("\n") + (remainingCount > 0 ? `\n<i>... dan ${remainingCount} bahan lainnya (klik tombol di bawah untuk lihat semua)</i>` : "");

  return [
    `📋 <b>DRAF NOTA PESANAN SPPG (PAGU ANGGARAN RESMI)</b>`,
    `Unit: <b>${escapeHtml(order.sppg_unit)}</b>`,
    `No Pesanan: ${orderNoDisplay}`,
    `📅 Tanggal : <b>${order.order_date}</b>`,
    `🕒 Waktu Input : <b>${formatWibDisplay()}</b>`,
    `🍲 Total Ragam : <b>${order.items.length} Komoditas Bahan</b>`,
    `💰 <b>TOTAL PAGU : ${formatRupiah(order.total_amount)}</b>`,
    `✍️ Penandatangan: <b>${escapeHtml(order.signed_by || "Kepala SPPG")}</b>`,
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
    `Tanggal: <b>${order.order_date}</b>`,
    `💰 <b>TOTAL PAGU: ${formatRupiah(order.total_amount)}</b>`,
    `------------------------------------------`,
    itemsList,
    `------------------------------------------`,
    `<i>💡 Data rincian ini akan dicatat ke Tab 03 (Rincian Pendapatan) dan dicocokkan otomatis di Tab 06 (Margin).</i>`,
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
  // Multi-supplier grouping check
  const supplierGroups = new Map<string, { count: number; total: number }>();
  for (const it of expense.items || []) {
    const sName = (it as any).supplier_name?.trim() || (it as any).supplier_target?.trim();
    if (sName) {
      if (!supplierGroups.has(sName)) {
        supplierGroups.set(sName, { count: 0, total: 0 });
      }
      const g = supplierGroups.get(sName)!;
      g.count += 1;
      g.total += Number(it.total_price) || (Number(it.qty) * Number(it.price));
    }
  }
  const isMultiSupplier = supplierGroups.size > 1;

  const isSelectionRequired = (expense as any).paguSelectionRequired === true;
  const candidatesCount = (expense as any).paguCandidates?.length || 0;
  const firstItemName = expense.items?.[0]?.item_name || "Bahan";

  const isMissingPayment = !expense.payment_method || expense.payment_method.trim() === "" || expense.payment_method === "-";
  const isMissingSupplier = !expense.supplier_name || expense.supplier_name.trim() === "" || expense.supplier_name === "Supplier Pasar";
  const isMissingAmount = !expense.total_amount || Number(expense.total_amount) <= 0;
  const isMissingItems =
    !expense.items ||
    expense.items.length === 0 ||
    expense.items.every((it) => {
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

  const missingLabels: string[] = [];
  if (isMissingItems) missingLabels.push("RINCIAN BARANG");
  if (isMissingAmount) missingLabels.push("TOTAL NOMINAL");
  if (isMissingPayment) missingLabels.push("METODE PEMBAYARAN");
  if (isMissingSupplier) missingLabels.push("NAMA TOKO / SUPPLIER");

  let statusBadge = "";
  if (status === "SAVED") {
    statusBadge = isMultiSupplier
      ? `✅ <b>STATUS: TERSIMPAN KE TAB 04 (${supplierGroups.size} TOKO), TAB 05 & 06</b>`
      : "✅ <b>STATUS: TERSIMPAN KE TAB 04 (Pengeluaran), TAB 05 (Rincian) & TAB 06 (Margin)</b>";
  } else if (status === "CANCELLED") {
    statusBadge = "❌ <b>STATUS: DRAF DIBATALKAN</b>";
  } else if (status === "EXPIRED") {
    statusBadge = "⌛ <b>STATUS: DRAF KEDALUWARSA</b>\n\n<i>Sesi konfirmasi telah berakhir. Silakan kirim ulang dokumen atau input transaksi baru.</i>";
  } else if (missingLabels.length > 0) {
    let guideInstruction = "";
    if (isMissingItems && isMissingAmount) {
      guideInstruction = "Silakan sebutkan nama barang belanjaan dan total nominalnya di chat (misal: <code>telur ayam 20 rak 600rb</code>):";
    } else if (isMissingItems) {
      guideInstruction = "Silakan masukkan nama bahan belanja dan kuantitasnya pada tombol di bawah atau ketik di chat (misal: <code>telur ayam 20 rak</code>):";
    } else if (isMissingAmount && !isMissingPayment && !isMissingSupplier) {
      guideInstruction = "Silakan masukkan total nominal belanja pada tombol di bawah atau ketik langsung di chat (misal: <code>600rb</code> atau <code>600.000</code>):";
    } else if (isMissingPayment && !isMissingAmount && !isMissingSupplier) {
      guideInstruction = "Silakan tentukan metode pembayaran di bawah ini (Tunai atau Transfer):";
    } else if (isMissingSupplier && !isMissingAmount && !isMissingPayment) {
      guideInstruction = "Silakan sebutkan nama toko / supplier belanja pada tombol di bawah atau ketik di chat:";
    } else {
      guideInstruction = "Silakan lengkapi data transaksi yang belum diisi pada tombol di bawah atau ketik di chat:";
    }
    statusBadge = `⚠️ <b>STATUS: MENUNGGU ${missingLabels.join(" & ")}</b>\n\n👉 <i>${guideInstruction}</i>`;
  } else if (isSelectionRequired) {
    statusBadge =
      "⚠️ <b>STATUS: MENUNGGU ALOKASI PAGU</b>\n\n" +
      "👉 <i>Silakan pilih alokasi belanja ini pada tombol di bawah atau ketik langsung di chat (misal: <code>pagu ii001</code> atau <code>non pagu</code>):</i>";
  } else {
    statusBadge = "⏳ <b>STATUS: MENUNGGU KONFIRMASI</b>";
  }

  let supplierSection = "";
  if (isMultiSupplier) {
    const suppLines: string[] = [];
    let idx = 1;
    for (const [sName, data] of supplierGroups.entries()) {
      suppLines.push(`  ${idx++}. <b>${escapeHtml(sName)}</b>: ${formatRupiah(data.total)} (<i>${data.count} bahan</i>)`);
    }
    supplierSection = `🏪 <b>Rincian Rekanan (${supplierGroups.size} Toko Multi-Supplier):</b>\n${suppLines.join("\n")}`;
  } else if (isMissingSupplier) {
    supplierSection = `🏪 <b>Nama Supplier / Toko</b>: ❓ <i>Belum ditentukan</i>`;
  } else {
    supplierSection = `🏪 <b>Nama Supplier / Toko</b>: <b>${escapeHtml(expense.supplier_name)}</b>`;
  }

  const itemsText = isMissingItems
    ? "• ❓ <i>Belum diisi (komoditas & kuantitas)</i>"
    : expense.items
        .slice(0, 4)
        .map((i) => {
          const sTag = (i as any).supplier_name ? ` [${escapeHtml((i as any).supplier_name)}]` : "";
          const priceText = Number(i.price) > 0 ? `@ ${formatRupiah(i.price)}` : "<i>(Harga belum diisi)</i>";
          return `• ${escapeHtml(i.item_name)} (${i.qty} ${escapeHtml(i.unit)} ${priceText})${sTag}`;
        })
        .join("\n");

  const driveSection = driveLink
    ? `📁 <b>Bukti Foto</b>: <a href="${driveLink}">📸 Lihat Foto Nota</a>`
    : (status === "PENDING"
        ? `📁 <b>Bukti Foto</b>: <i>📸 Nota Terlampir (Dari Telegram)</i>`
        : `📁 <b>Bukti Foto</b>: <i>-</i>`);

  const ctx = (expense as any).paguContext as PaguDraftContext | undefined;
  let allocSection = "";
  let statusPaguLine = "";

  if (isSelectionRequired) {
    allocSection = `📄 <b>Alokasi Anggaran</b>: ❓ <i>Belum ditentukan</i>`;
  } else if (ctx && ctx.sppg_ref_no && ctx.sppg_ref_no !== "-") {
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
    isMultiSupplier ? `🧾 <b>DRAF BELANJA MULTI-SUPPLIER</b>` : `🧾 <b>DRAF BELANJA SUPPLIER</b>`,
    supplierSection,
    `📅 <b>Tanggal Nota</b>: ${expense.date}`,
    `🕒 <b>Waktu Input</b> : ${formatWibDisplay()}`,
    allocSection + statusPaguLine,
    `💵 <b>TOTAL BELANJA: ${isMissingAmount ? "❓ <i>Belum diisi</i>" : formatRupiah(expense.total_amount)}</b>`,
    `💳 <b>Metode:</b> ${isMissingPayment ? "❓ <i>Belum ditentukan</i>" : `<b>${escapeHtml(expense.payment_method)}</b>`}`,
    driveSection,
    `------------------------------------------`,
    `<b>Barang Belanja:</b>\n${itemsText}${!isMissingItems && expense.items.length > 4 ? `\n<i>... dan ${expense.items.length - 4} bahan lainnya</i>` : ""}`,
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
    if (err?.description?.includes("there is no text in the message to edit")) {
      try {
        await ctx.editMessageCaption({ caption: text, ...extra });
        return;
      } catch (captionErr: any) {
        if (captionErr?.description?.includes("message is not modified")) {
          return;
        }
      }
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
  }>,
  filterType: "all" | "expense" | "income" = "all"
): string {
  if (transactions.length === 0) {
    if (filterType === "expense") {
      return "ℹ️ <b>Belum ada data pengeluaran (belanja) tercatat di Spreadsheet unit ini.</b>";
    }
    if (filterType === "income") {
      return "ℹ️ <b>Belum ada data pendapatan (pagu) tercatat di Spreadsheet unit ini.</b>";
    }
    return "ℹ️ <b>Belum ada transaksi tercatat di Spreadsheet unit ini.</b>";
  }

  let headerTitle = "📋 <b>RIWAYAT TRANSAKSI TERAKHIR:</b>";
  if (filterType === "expense") {
    headerTitle = "📉 <b>RIWAYAT PENGELUARAN (BELANJA SUPPLIER):</b>";
  } else if (filterType === "income") {
    headerTitle = "📈 <b>RIWAYAT PENDAPATAN (PAGU PENERIMAAN):</b>";
  }

  const lines = [
    headerTitle,
    `------------------------------------------`,
  ];

  transactions.forEach((t, i) => {
    const icon = t.type === "income" ? "🟢" : "🔴";
    const typeLabel = t.type === "income" ? "Pendapatan" : "Pengeluaran";
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

export function renderLinkExpenseConfirmationCard(params: {
  unitName: string;
  expenseId: string;
  paguId: string;
  orderNo: string;
  supplier: string;
  amount: number;
  items: Array<{
    itemName: string;
    qty: number;
    unit: string;
    price: number;
    total: number;
  }>;
  newItemCount?: number;
  newSupplierCount?: number;
}): string {
  const itemsText = params.items && params.items.length > 0
    ? params.items.map((it) => `• <b>${escapeHtml(it.itemName)}</b> (${it.qty} ${escapeHtml(it.unit)} @ ${formatRupiah(it.price)})`).join("\n")
    : `• Belanja Bahan (${formatRupiah(params.amount)})`;

  const itemInfo = params.newItemCount ? ` (menjadi ${params.newItemCount} Item)` : "";
  const suppInfo = params.newSupplierCount ? ` (menjadi ${params.newSupplierCount} Supplier)` : "";

  return [
    `📋 <b>KONFIRMASI PENAUTAN BELANJA KE PAGU</b>`,
    `Unit: <b>${escapeHtml(params.unitName)}</b>`,
    `------------------------------------------`,
    `• <b>ID Pengeluaran:</b> <code>${escapeHtml(params.expenseId)}</code> (${escapeHtml(params.supplier)} - ${formatRupiah(params.amount)})`,
    `• <b>Target Pagu:</b> <code>${escapeHtml(params.orderNo)}</code> (${escapeHtml(params.paguId)})`,
    `• <b>Bahan Belanja:</b>`,
    itemsText,
    `------------------------------------------`,
    `📍 <b>Dampak Sinkronisasi:</b>`,
    `1. Bahan di atas akan disisipkan ke <b>03_RINCIAN_PENDAPATAN</b> pada pesanan <code>${escapeHtml(params.orderNo)}</code>.`,
    `2. <b>02_PENDAPATAN</b> akan diperbarui:`,
    `   • Jumlah Item Bahan bertambah${itemInfo}`,
    `   • Target Supplier disesuaikan${suppInfo}`,
    `   • Total Pagu Anggaran bertambah (+${formatRupiah(params.amount)})`,
    `   • Keterangan ditandai <b>[Edit]</b>`,
    `3. Realisasi belanja di <b>04_PENGELUARAN</b> & <b>05_RINCIAN_PENGELUARAN</b> ditautkan ke <code>${escapeHtml(params.orderNo)}</code>.`,
    `4. Perbandingan margin di <b>06_MARGIN</b> diselaraskan (Status: <b>🟢 PAS</b>).\n`,
    `<i>Apakah Anda yakin ingin menautkan transaksi pengeluaran ini ke pagu pesanan tersebut?</i>`,
  ].join("\n");
}



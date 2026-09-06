import { SupplierReceipt } from "./schemas/supplier-receipt.schema.js";
import { ParsedTextTransaction } from "./parsers/text-transaction.parser.js";
import { escapeHtml } from "../telegram/formatter.js";

/**
 * Normalizes Indonesian currency text into numeric value
 * Examples: "200rb" -> 200000, "1.5jt" -> 1500000, "50k" -> 50000, "700.000" -> 700000
 */
export function parseIndonesianCurrency(text: string): number | null {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|k)?\b/i);
  if (!match) return null;

  const rawNum = match[1].replace(/,/g, ".");
  const multiplier = match[2]?.toLowerCase();

  const baseNum = parseFloat(rawNum);
  if (isNaN(baseNum) || baseNum <= 0) return null;

  if (multiplier === "jt" || multiplier === "juta") {
    return Math.round(baseNum * 1_000_000);
  }
  if (multiplier === "rb" || multiplier === "ribu" || multiplier === "k") {
    return Math.round(baseNum * 1_000);
  }

  // Handle plain numbers like 700000 or 700.000
  const cleanInteger = parseInt(match[1].replace(/[^\d]/g, ""), 10);
  return isNaN(cleanInteger) ? null : cleanInteger;
}

/**
 * Regex-based heuristic parser for transactions when all AI engines are unavailable.
 * Supports patterns like:
 * - "beli [barang] [harga] di [supplier] [metode]"
 * - "bayar [supplier] [harga] [barang]"
 * - "belanja [harga] di [toko] [barang]"
 */
export function staticParseTransaction(
  userText: string,
  defaultUnit = "SPPG Patila"
): ParsedTextTransaction | null {
  const text = userText.trim();
  const lower = text.toLowerCase();

  // Guard: If it's a question or general inquiry, don't parse as transaction
  if (
    /\?$/.test(text) ||
    /^(apa|apakah|siapa|kenapa|mengapa|bagaimana|gimana|kapan|tolong|cerita)\b/i.test(text)
  ) {
    return null;
  }

  const todayStr = new Date().toISOString().split("T")[0];

  // Pattern 1: "beli <item> <amount> di/ke <supplier> [payment]"
  // e.g. "beli ayam 200rb di pasar ayam tunai"
  // e.g. "beli beras 2 karung 700.000 di Hj Muliadi"
  const p1 = /(?:beli|belanja|pesan)\s+(.+?)\s+(\d+(?:[.,]\d+)?\s*(?:jt|juta|rb|ribu|k)?|\d{4,})\s+(?:di|ke|dari)\s+([^,]+?)(?:\s+(tunai|cash|transfer|bca|bri|mandiri|qris))?$/i;
  const m1 = text.match(p1);
  if (m1) {
    const rawItem = m1[1].trim();
    const rawAmount = m1[2].trim();
    const rawSupplier = m1[3].trim();
    const rawPayment = m1[4]?.trim();

    const totalAmount = parseIndonesianCurrency(rawAmount);
    if (totalAmount && totalAmount > 0) {
      // Check if qty and unit are present in rawItem, e.g. "beras 2 karung" or "ayam 5 ekor"
      const qtyUnitMatch = rawItem.match(/(.*?)\s*(\d+(?:[.,]\d+)?)\s*(kg|karung|jerigen|ekor|ikat|bungkus|karton|liter|rak)?$/i);
      let itemName = rawItem;
      let qty = 1;
      let unit = "unit";

      if (qtyUnitMatch && qtyUnitMatch[2]) {
        itemName = qtyUnitMatch[1]?.trim() || rawItem;
        qty = parseFloat(qtyUnitMatch[2].replace(/,/g, ".")) || 1;
        unit = qtyUnitMatch[3]?.trim() || "unit";
      }

      const receipt: SupplierReceipt = {
        type: "expense",
        supplier_name: rawSupplier || "Supplier Pasar",
        date: todayStr,
        sppg_ref_no: "",
        items: [
          {
            item_name: itemName || "Bahan Makanan",
            qty,
            unit,
            price: Math.round(totalAmount / qty),
            total_price: totalAmount,
          },
        ],
        subtotal: totalAmount,
        discount: 0,
        tax: 0,
        total_amount: totalAmount,
        payment_method: rawPayment ? (rawPayment.toLowerCase().includes("tf") || rawPayment.toLowerCase().includes("transfer") ? "Transfer" : "Cash") : "Cash",
        notes: "Pencatatan Offline (Regex Fallback Layer 3)",
      };

      return { type: "SUPPLIER_EXPENSE", data: receipt };
    }
  }

  // Pattern 2: "bayar <supplier> <amount> [untuk/beli <item>]"
  // e.g. "bayar Hj Muliadi 1.5jt minyak goreng"
  const p2 = /(?:bayar|transfer)\s+(.+?)\s+(\d+(?:[.,]\d+)?\s*(?:jt|juta|rb|ribu|k)?|\d{4,})(?:\s+(?:untuk|beli)?\s*(.*))?$/i;
  const m2 = text.match(p2);
  if (m2) {
    const rawSupplier = m2[1].trim();
    const rawAmount = m2[2].trim();
    const rawItem = m2[3]?.trim() || "Bahan Pangan MBG";

    const totalAmount = parseIndonesianCurrency(rawAmount);
    if (totalAmount && totalAmount > 0) {
      const receipt: SupplierReceipt = {
        type: "expense",
        supplier_name: rawSupplier || "Supplier Rekanan",
        date: todayStr,
        sppg_ref_no: "",
        items: [
          {
            item_name: rawItem,
            qty: 1,
            unit: "paket",
            price: totalAmount,
            total_price: totalAmount,
          },
        ],
        subtotal: totalAmount,
        discount: 0,
        tax: 0,
        total_amount: totalAmount,
        payment_method: lower.includes("transfer") ? "Transfer" : "Cash",
        notes: "Pencatatan Offline (Regex Fallback Layer 3)",
      };

      return { type: "SUPPLIER_EXPENSE", data: receipt };
    }
  }

  return null;
}

/**
 * Returns a helpful static reply when AI reasoning is down.
 */
export function staticConversationalReply(sppgUnitName = "SPPG Patila"): string {
  return [
    `🔧 <b>Sistem AI Sedang Dalam Pemeliharaan / Offline</b>`,
    `Unit: <b>${escapeHtml(sppgUnitName)}</b>`,
    `------------------------------------------`,
    `Layanan AI reasoning sedang tidak tersedia sementara. Namun, <b>seluruh fitur operasional spreadsheet tetap aktif 100%</b>:`,
    ``,
    `📊 <b>Fitur yang Tetap Berfungsi Normal:</b>`,
    `• <b>Rekap Margin:</b> Ketik <i>"rekap"</i> atau <i>"margin"</i>`,
    `• <b>Cetak Laporan SPJ:</b> Ketik <i>"pdf"</i> atau <i>"cetak spj"</i>`,
    `• <b>Buka Spreadsheet:</b> Ketik <i>"sheets"</i>`,
    `• <b>Riwayat Belanja:</b> Ketik <i>"transaksi"</i>`,
    `• <b>Cek Identitas:</b> Ketik <i>"/myid"</i>`,
    ``,
    `✍️ <b>Catat Belanja Manual (Format Regex):</b>`,
    `Anda tetap dapat mencatat belanja dengan format:`,
    `👉 <code>beli [barang] [nominal] di [nama toko]</code>`,
    `<i>Contoh: "beli ayam 200rb di pasar ayam tunai"</i>`,
    `------------------------------------------`,
    `🙏 <i>Sistem akan otomatis beralih kembali ke True AI segera setelah koneksi server normal.</i>`,
  ].join("\n");
}

/**
 * Returns a static message when photo parsing fails due to AI outage
 */
export function staticImageFailureMessage(): string {
  return [
    `📸 <b>Foto Bukti Berhasil Diunggah ke Google Drive</b>`,
    `------------------------------------------`,
    `⚠️ <b>Mesin AI OCR Sedang Maintenance:</b>`,
    `AI saat ini tidak dapat membaca tulisan/angka pada foto nota secara otomatis.`,
    ``,
    `💡 <b>Cara Pencatatan Alternatif:</b>`,
    `Silakan ketik transaksi belanja secara manual dengan format:`,
    `👉 <code>beli [barang] [nominal] di [nama toko]</code>`,
    `<i>Contoh: "beli minyak 14 jerigen 1.75jt di Hj Muliadi"</i>`,
    ``,
    `Foto Anda sudah aman tersimpan di folder Google Drive unit ini.`,
  ].join("\n");
}

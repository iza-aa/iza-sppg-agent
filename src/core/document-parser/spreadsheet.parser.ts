import * as XLSX from "xlsx";
import { SupplierReceipt } from "../ai/schemas/supplier-receipt.schema.js";
import { logger } from "../utils/logger.js";

export interface ParsedSpreadsheetResult {
  sheetName: string;
  totalRows: number;
  transactions: SupplierReceipt[];
}

/**
 * Fuzzy column finder from header row
 */
function findColumnIndex(headers: string[], candidates: string[]): number {
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => h && h.toLowerCase().includes(cand.toLowerCase()));
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parses Excel (.xlsx, .xls) or CSV buffer into structured SupplierReceipt transactions.
 * Pure JavaScript - 100% offline, requires zero AI calls.
 */
export function parseSpreadsheetBuffer(buffer: Buffer, defaultSupplier = "Supplier Rekanan"): ParsedSpreadsheetResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  if (!worksheet) {
    throw new Error("Spreadsheet kosong atau tidak memiliki sheet valid.");
  }

  const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  if (rawData.length < 2) {
    throw new Error("File spreadsheet tidak memiliki cukup baris data.");
  }

  // Find header row (usually row 0 or 1)
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(5, rawData.length); i++) {
    const row = rawData[i];
    if (Array.isArray(row) && row.some((cell) => typeof cell === "string" && /harga|total|barang|item|tanggal/i.test(cell))) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = (rawData[headerRowIdx] || []).map((h: any) => String(h || "").trim());

  const colDate = findColumnIndex(headers, ["tanggal", "tgl", "date"]);
  const colSupplier = findColumnIndex(headers, ["supplier", "toko", "vendor", "rekanan"]);
  const colItem = findColumnIndex(headers, ["barang", "item", "bahan", "nama barang", "uraian", "komoditas"]);
  const colQty = findColumnIndex(headers, ["qty", "jumlah", "kuantitas", "banyak"]);
  const colUnit = findColumnIndex(headers, ["satuan", "unit"]);
  const colPrice = findColumnIndex(headers, ["harga satuan", "harga", "tarif", "price"]);
  const colTotal = findColumnIndex(headers, ["total", "subtotal", "jumlah harga", "total harga"]);

  const todayStr = new Date().toISOString().split("T")[0];
  const itemsMapBySupplier = new Map<string, { date: string; items: any[]; total: number }>();

  for (let r = headerRowIdx + 1; r < rawData.length; r++) {
    const row = rawData[r];
    if (!row || row.length === 0 || row.every((c) => c === undefined || c === null || c === "")) continue;

    const rawItem = colItem !== -1 ? String(row[colItem] || "").trim() : "";
    const rawTotal = colTotal !== -1 ? Number(String(row[colTotal]).replace(/[^\d.-]/g, "")) : 0;
    const rawPrice = colPrice !== -1 ? Number(String(row[colPrice]).replace(/[^\d.-]/g, "")) : 0;
    const rawQty = colQty !== -1 ? Number(String(row[colQty]).replace(/[^\d.-]/g, "")) : 1;
    const rawUnit = colUnit !== -1 ? String(row[colUnit] || "unit").trim() : "unit";
    const rawSupplier = colSupplier !== -1 ? String(row[colSupplier] || "").trim() : defaultSupplier;
    const rawDate = colDate !== -1 ? String(row[colDate] || todayStr).trim() : todayStr;

    // Skip footer / summary rows (e.g. "TOTAL", "Grand Total")
    if (/total|grand total|jumlah/i.test(rawItem) && !rawPrice) continue;

    const finalTotal = rawTotal || (rawQty * rawPrice) || 0;
    if (finalTotal <= 0 && !rawItem) continue;

    const supplierKey = rawSupplier || defaultSupplier;
    if (!itemsMapBySupplier.has(supplierKey)) {
      itemsMapBySupplier.set(supplierKey, { date: rawDate || todayStr, items: [], total: 0 });
    }

    const group = itemsMapBySupplier.get(supplierKey)!;
    group.items.push({
      item_name: rawItem || "Bahan Makanan",
      qty: rawQty || 1,
      unit: rawUnit || "unit",
      price: rawPrice || (rawQty > 0 ? Math.round(finalTotal / rawQty) : finalTotal),
      total_price: finalTotal,
    });
    group.total += finalTotal;
  }

  const transactions: SupplierReceipt[] = [];
  for (const [suppName, group] of itemsMapBySupplier.entries()) {
    transactions.push({
      type: "expense",
      supplier_name: suppName,
      date: group.date,
      sppg_ref_no: "",
      items: group.items,
      subtotal: group.total,
      discount: 0,
      tax: 0,
      total_amount: group.total,
      payment_method: "Cash",
      notes: `Import Excel (${firstSheetName})`,
    });
  }

  logger.info(
    { sheet: firstSheetName, totalRows: rawData.length, transactionsCount: transactions.length },
    "Spreadsheet parsed successfully"
  );

  return {
    sheetName: firstSheetName,
    totalRows: rawData.length,
    transactions,
  };
}

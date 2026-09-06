import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseSpreadsheetBuffer } from "../src/core/document-parser/spreadsheet.parser.js";

describe("Spreadsheet Parser Unit Tests", () => {
  it("should parse an in-memory workbook with transactions correctly", () => {
    // Create an in-memory workbook with header and rows
    const data = [
      ["Tanggal", "Supplier", "Nama Barang", "Qty", "Satuan", "Harga Satuan", "Total Harga"],
      ["2026-09-03", "Hj Muliadi", "Minyak Kelapa Sawit", 14, "Jerigen", 125000, 1750000],
      ["2026-09-03", "Ayam Pasar", "Ayam Potong", 50, "Ekor", 55000, 2750000],
      ["2026-09-03", "Hj Muliadi", "Beras Ramos", 2, "Karung", 350000, 700000],
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Belanja_Harian");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = parseSpreadsheetBuffer(buffer, "Supplier Default");
    expect(result.sheetName).toBe("Belanja_Harian");
    expect(result.totalRows).toBe(4);
    expect(result.transactions.length).toBe(2); // Grouped into Hj Muliadi and Ayam Pasar

    const hjMuliadi = result.transactions.find((t) => t.supplier_name === "Hj Muliadi");
    expect(hjMuliadi).toBeDefined();
    expect(hjMuliadi?.items.length).toBe(2); // Minyak & Beras
    expect(hjMuliadi?.total_amount).toBe(2450000); // 1.750.000 + 700.000

    const ayamPasar = result.transactions.find((t) => t.supplier_name === "Ayam Pasar");
    expect(ayamPasar).toBeDefined();
    expect(ayamPasar?.items.length).toBe(1);
    expect(ayamPasar?.total_amount).toBe(2750000);
  });
});

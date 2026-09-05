import { google, sheets_v4 } from "googleapis";
import fs from "fs";
import path from "path";
import { env } from "../../config/env.js";
import { SppgOrder } from "../ai/schemas/sppg-order.schema.js";
import { SupplierReceipt } from "../ai/schemas/supplier-receipt.schema.js";
import {
  createInit5TabsBatchRequests,
  createHeaderStylingBatchRequests,
  createDataValidationBatchRequests,
  createNumberFormattingBatchRequests,
  createConditionalFormattingBatchRequests,
} from "./sheets-recipes.js";
import { logger } from "../utils/logger.js";

export class GoogleSheetsService {
  private sheets: sheets_v4.Sheets | null = null;
  private initializedSpreadsheets = new Set<string>();

  private async getClient(): Promise<sheets_v4.Sheets> {
    if (this.sheets) return this.sheets;

    const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Google service account file not found at: ${keyPath}`);
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheets = google.sheets({ version: "v4", auth });
    return this.sheets;
  }

  /**
   * Initializes the 5-Tab BGN structure on an operational spreadsheet if not already present
   */
  async ensure5TabStructure(spreadsheetId: string): Promise<void> {
    if (this.initializedSpreadsheets.has(spreadsheetId)) {
      return;
    }

    const client = await this.getClient();

    try {
      const meta = await client.spreadsheets.get({ spreadsheetId });
      const existingTitles = (meta.data.sheets || []).map((s) => s.properties?.title || "");

      const requiredTabs = [
        "01_RINGKASAN_EKSEKUTIF",
        "02_PENDAPATAN_SPPG",
        "03_PENGELUARAN_SUPPLIER",
        "04_REKAP_MARGIN_HARIAN",
        "05_MASTER_DATA",
      ];

      const missingTabs = requiredTabs.filter((tab) => !existingTitles.includes(tab));

      if (missingTabs.length > 0) {
        logger.info({ spreadsheetId, missingTabs }, "Initializing 5-Tab BGN structure on spreadsheet...");
        const batchRequests = createInit5TabsBatchRequests();

        await client.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: batchRequests },
        });

        // Initialize Master Data default rows
        await client.spreadsheets.values.update({
          spreadsheetId,
          range: "'05_MASTER_DATA'!A2:C5",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [
              ["Ayam Pasar", "Ekor", "Protein Hewani"],
              ["Hj Muliadi", "KG", "Sayuran Segar"],
              ["Mas Pandu", "Jerigen", "Bahan Pokok"],
              ["Best Fruit", "Keranjang", "Buah Segar"],
            ],
          },
        });

        logger.info({ spreadsheetId }, "Successfully initialized 5-Tab BGN structure");
      }

      // Ensure headers and dynamic formulas are in place
      await this.ensureHeadersAndFormulas(spreadsheetId);
      this.initializedSpreadsheets.add(spreadsheetId);
    } catch (err: any) {
      logger.warn({ err: err?.message || err, spreadsheetId }, "Note during 5-tab verification");
    }
  }

  /**
   * Writes official BGN headers, interactive Year/Month filter dropdowns, and dynamic KPI summary formulas
   */
  async ensureHeadersAndFormulas(spreadsheetId: string, unitName = "SPPG Unit"): Promise<void> {
    const client = await this.getClient();

    try {
      const check = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'01_RINGKASAN_EKSEKUTIF'!A2",
      });

      if (check.data.values?.[0]?.[0] === "⚙️ FILTER:") {
        return; // Already configured with interactive filter controls
      }

      logger.info({ spreadsheetId, unitName }, "Configuring interactive Month/Year filters and BGN formulas...");

      const meta = await client.spreadsheets.get({ spreadsheetId });
      const targetSheet = (meta.data.sheets || []).find(
        (s: any) => s.properties?.title === "01_RINGKASAN_EKSEKUTIF"
      );
      const ringkasanSheetId = targetSheet?.properties?.sheetId || 0;

      const startDateExpr = `IF(C2="SEMUA TAHUN"; DATE(2020;1;1); IF(E2="SEMUA BULAN"; DATE(VALUE(C2);1;1); DATE(VALUE(C2);VALUE(LEFT(E2;2));1)))`;
      const endDateExpr = `IF(C2="SEMUA TAHUN"; DATE(2035;12;31); IF(E2="SEMUA BULAN"; DATE(VALUE(C2);12;31); DATE(VALUE(C2);VALUE(LEFT(E2;2))+1;0)))`;

      const formulaPlafon = `=IFERROR(SUMIFS('02_PENDAPATAN_SPPG'!I2:I; '02_PENDAPATAN_SPPG'!B2:B; ">=" & ${startDateExpr}; '02_PENDAPATAN_SPPG'!B2:B; "<=" & ${endDateExpr}); 0)`;
      const formulaBelanja = `=IFERROR(SUMIFS('03_PENGELUARAN_SUPPLIER'!I2:I; '03_PENGELUARAN_SUPPLIER'!B2:B; ">=" & ${startDateExpr}; '03_PENGELUARAN_SUPPLIER'!B2:B; "<=" & ${endDateExpr}); 0)`;
      const formulaMargin = `=B4-C4`;
      const formulaPct = `=IF(B4>0; D4/B4; 0)`;
      const formulaStatus = `=IF(E4>=0,15; "🟢 HEMAT / SURPLUS (>=15%)"; IF(E4>=0,05; "🟡 SESUAI PAGU (5-15%)"; "🔴 PERHATIAN: OVER-BUDGET (<5%)"))`;
      const formulaCount = `=COUNTIFS('03_PENGELUARAN_SUPPLIER'!B2:B; ">=" & ${startDateExpr}; '03_PENGELUARAN_SUPPLIER'!B2:B; "<=" & ${endDateExpr})`;

      // 1. Write Values across tabs
      await client.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: [
            {
              range: "'01_RINGKASAN_EKSEKUTIF'!A1:G4",
              values: [
                ["🏛️ EXECUTIVE SUMMARY & KPI SPPG - BADAN GIZI NASIONAL", "", "", "", "", "", ""],
                ["⚙️ FILTER:", "📅 TAHUN:", "SEMUA TAHUN", "🗓️ BULAN:", "SEMUA BULAN", "🏢 UNIT:", unitName],
                [
                  "NO",
                  "TOTAL PLAFON (PAGU)",
                  "REALISASI BELANJA RIIL",
                  "MARGIN BERSIH SPPG",
                  "% EFISIENSI MARGIN",
                  "STATUS EVALUASI BGN",
                  "TRANSAKSI BELANJA",
                ],
                ["1", formulaPlafon, formulaBelanja, formulaMargin, formulaPct, formulaStatus, formulaCount],
              ],
            },
            {
              range: "'02_PENDAPATAN_SPPG'!A1:L1",
              values: [[
                "ID Transaksi",
                "Tanggal Pesanan",
                "Tanggal Tiba",
                "No SPPG",
                "Uraian Bahan",
                "Kuantitas",
                "Satuan",
                "Harga Pagu (Rp)",
                "Total Pagu (Rp)",
                "Target Supplier",
                "Status",
                "Catatan",
              ]],
            },
            {
              range: "'03_PENGELUARAN_SUPPLIER'!A1:L1",
              values: [[
                "ID Transaksi",
                "Tanggal Transaksi",
                "No SPPG Ref",
                "Nama Supplier",
                "Uraian Barang",
                "Kuantitas",
                "Satuan",
                "Harga Satuan Riil (Rp)",
                "Total Bayar Riil (Rp)",
                "Link Bukti Nota",
                "PIC / Operator",
                "Keterangan",
              ]],
            },
            {
              range: "'04_REKAP_MARGIN_HARIAN'!A1:G1",
              values: [[
                "Tanggal",
                "No SPPG",
                "Total Pagu Pendapatan (Rp)",
                "Realisasi Belanja Riil (Rp)",
                "Margin Bersih (Rp)",
                "Persentase Margin",
                "Status Evaluasi BGN",
              ]],
            },
            {
              range: "'05_MASTER_DATA'!A1:C1",
              values: [[
                "Nama Supplier / Rekanan",
                "Satuan Baku",
                "Kategori Bahan",
              ]],
            },
          ],
        },
      });

      // 2. Format UI & Setup Dropdown Validations
      const { hexToRgbColor, BGN_PALETTE } = await import("./sheets-recipes.js");
      const navyBg = hexToRgbColor(BGN_PALETTE.DEEP_NAVY);
      const whiteTxt = hexToRgbColor(BGN_PALETTE.WHITE);
      const filterBg = hexToRgbColor("#FEF3C7");
      const slateLightBg = hexToRgbColor(BGN_PALETTE.SLATE_LIGHT);

      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            // Merge A1:G1 for Title Banner
            {
              mergeCells: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 7,
                },
                mergeType: "MERGE_ALL",
              },
            },
            // Title banner styling
            {
              repeatCell: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 7,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: navyBg,
                    textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 12 },
                    horizontalAlignment: "CENTER",
                    verticalAlignment: "MIDDLE",
                  },
                },
                fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
              },
            },
            // Filter bar row 2 styling
            {
              repeatCell: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 1,
                  endRowIndex: 2,
                  startColumnIndex: 0,
                  endColumnIndex: 7,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: slateLightBg,
                    textFormat: { bold: true, fontSize: 10 },
                    verticalAlignment: "MIDDLE",
                  },
                },
                fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment)",
              },
            },
            // Highlight dropdown cells C2 and E2
            {
              repeatCell: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 1,
                  endRowIndex: 2,
                  startColumnIndex: 2,
                  endColumnIndex: 3,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: filterBg,
                    textFormat: { bold: true, fontSize: 10, foregroundColor: hexToRgbColor("#92400E") },
                    horizontalAlignment: "CENTER",
                  },
                },
                fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 1,
                  endRowIndex: 2,
                  startColumnIndex: 4,
                  endColumnIndex: 5,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: filterBg,
                    textFormat: { bold: true, fontSize: 10, foregroundColor: hexToRgbColor("#92400E") },
                    horizontalAlignment: "CENTER",
                  },
                },
                fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
              },
            },
            // Dropdown validation C2 (Tahun)
            {
              setDataValidation: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 1,
                  endRowIndex: 2,
                  startColumnIndex: 2,
                  endColumnIndex: 3,
                },
                rule: {
                  condition: {
                    type: "ONE_OF_LIST",
                    values: [
                      { userEnteredValue: "SEMUA TAHUN" },
                      { userEnteredValue: "2026" },
                      { userEnteredValue: "2027" },
                      { userEnteredValue: "2025" },
                    ],
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            // Dropdown validation E2 (Bulan)
            {
              setDataValidation: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 1,
                  endRowIndex: 2,
                  startColumnIndex: 4,
                  endColumnIndex: 5,
                },
                rule: {
                  condition: {
                    type: "ONE_OF_LIST",
                    values: [
                      { userEnteredValue: "SEMUA BULAN" },
                      { userEnteredValue: "01 - Januari" },
                      { userEnteredValue: "02 - Februari" },
                      { userEnteredValue: "03 - Maret" },
                      { userEnteredValue: "04 - April" },
                      { userEnteredValue: "05 - Mei" },
                      { userEnteredValue: "06 - Juni" },
                      { userEnteredValue: "07 - Juli" },
                      { userEnteredValue: "08 - Agustus" },
                      { userEnteredValue: "09 - September" },
                      { userEnteredValue: "10 - Oktober" },
                      { userEnteredValue: "11 - November" },
                      { userEnteredValue: "12 - Desember" },
                    ],
                  },
                  showCustomUi: true,
                  strict: true,
                },
              },
            },
            // Header row 3 styling
            {
              repeatCell: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 2,
                  endRowIndex: 3,
                  startColumnIndex: 0,
                  endColumnIndex: 7,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: navyBg,
                    textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10 },
                    horizontalAlignment: "CENTER",
                    verticalAlignment: "MIDDLE",
                  },
                },
                fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
              },
            },
            // Values formatting row 4
            {
              repeatCell: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 3,
                  endRowIndex: 4,
                  startColumnIndex: 1,
                  endColumnIndex: 4,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
                    textFormat: { bold: true, fontSize: 13 },
                    horizontalAlignment: "RIGHT",
                    verticalAlignment: "MIDDLE",
                  },
                },
                fields: "userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment)",
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 3,
                  endRowIndex: 4,
                  startColumnIndex: 4,
                  endColumnIndex: 5,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: { type: "PERCENT", pattern: "0.00%" },
                    textFormat: { bold: true, fontSize: 13 },
                    horizontalAlignment: "CENTER",
                    verticalAlignment: "MIDDLE",
                  },
                },
                fields: "userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment)",
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 3,
                  endRowIndex: 4,
                  startColumnIndex: 5,
                  endColumnIndex: 6,
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true, fontSize: 11 },
                    horizontalAlignment: "CENTER",
                    verticalAlignment: "MIDDLE",
                  },
                },
                fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)",
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 3,
                  endRowIndex: 4,
                  startColumnIndex: 6,
                  endColumnIndex: 7,
                },
                cell: {
                  userEnteredFormat: {
                    numberFormat: { type: "NUMBER", pattern: "#,##0" },
                    textFormat: { bold: true, fontSize: 13 },
                    horizontalAlignment: "CENTER",
                    verticalAlignment: "MIDDLE",
                  },
                },
                fields: "userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment)",
              },
            },
            // Other tab batch formatters
            ...createHeaderStylingBatchRequests(),
            ...createNumberFormattingBatchRequests(),
            ...createDataValidationBatchRequests(),
            ...createConditionalFormattingBatchRequests(),
          ],
        },
      });

      logger.info({ spreadsheetId, unitName }, "Successfully established BGN interactive headers, filters, and styling");
    } catch (err: any) {
      logger.warn({ err: err?.message || err, spreadsheetId }, "Note writing headers and formulas");
    }
  }

  /**
   * Appends rows safely using exact row index lookup (eliminates row jumping bug)
   */
  private async appendRowsSafely(
    spreadsheetId: string,
    sheetName: string,
    rows: (string | number)[][]
  ): Promise<number> {
    const client = await this.getClient();

    // 1. Get exact current row count in column A
    const colA = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:A`,
    });

    const existingRows = (colA.data.values || []).length;
    // Guarantee that row 1 is preserved for headers
    const startRow = Math.max(existingRows + 1, 2);
    const endRow = startRow + rows.length - 1;

    // 2. Write exact range
    await client.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A${startRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });

    logger.info({ sheetName, startRow, endRow, count: rows.length }, "Appended rows to spreadsheet");
    return startRow;
  }

  /**
   * Records official SPPG Order (Pendapatan / Plafon) with all 20+ item lines
   */
  async recordSppgOrder(spreadsheetId: string, order: SppgOrder): Promise<void> {
    await this.ensure5TabStructure(spreadsheetId);

    const rows = order.items.map((item, idx) => {
      const orderId = `SPPG-ORD-${order.order_date.replace(/-/g, "")}-${String(idx + 1).padStart(3, "0")}`;
      return [
        orderId,                                    // A: ID Transaksi
        order.order_date,                           // B: Tanggal Pesanan
        order.arrival_date,                         // C: Tanggal Tiba
        order.order_no,                             // D: No SPPG
        item.item_name,                             // E: Uraian Bahan
        item.qty,                                   // F: Kuantitas
        item.unit,                                  // G: Satuan
        item.price,                                 // H: Harga Pagu
        item.total_price,                           // I: Total Pagu (Rp)
        item.supplier_target || "Lainnya",          // J: Target Supplier
        "LENGKAP",                                  // K: Status
        order.notes || `Penandatangan: ${order.signed_by || "-"}`, // L: Catatan
      ];
    });

    await this.appendRowsSafely(spreadsheetId, "02_PENDAPATAN_SPPG", rows);
  }

  /**
   * Records Supplier Expense Receipt (Pengeluaran Riil)
   */
  async recordSupplierExpense(
    spreadsheetId: string,
    receipt: SupplierReceipt,
    driveLink: string,
    picName: string
  ): Promise<void> {
    await this.ensure5TabStructure(spreadsheetId);

    const nowIso = new Date().toISOString().split("T")[0];
    const timestamp = Date.now().toString().slice(-4);
    const expenseId = `SUPP-EXP-${(receipt.date || nowIso).replace(/-/g, "")}-${timestamp}`;

    const itemsSummary = receipt.items.map((i) => `${i.item_name} (${i.qty} ${i.unit})`).join(", ");
    const driveHyperlinkFormula = driveLink ? `=HYPERLINK("${driveLink}", "📸 Lihat Nota")` : "-";

    const rows = [
      [
        expenseId,                                  // A: ID Transaksi
        receipt.date || nowIso,                     // B: Tanggal Transaksi
        receipt.sppg_ref_no || "-",                 // C: No SPPG Ref
        receipt.supplier_name,                      // D: Nama Supplier
        itemsSummary || "Belanja Bahan Dapur",      // E: Uraian Barang
        1,                                          // F: Qty
        "Paket",                                    // G: Satuan
        receipt.total_amount,                       // H: Harga Satuan Riil
        receipt.total_amount,                       // I: Total Bayar Riil
        driveHyperlinkFormula,                      // J: Link GDrive
        picName || "Ayah (Vendor)",                 // K: PIC
        receipt.notes || `Metode: ${receipt.payment_method}`, // L: Keterangan
      ],
    ];

    await this.appendRowsSafely(spreadsheetId, "03_PENGELUARAN_SUPPLIER", rows);
  }

  /**
   * Retrieves live executive KPI summary from Tab 01_RINGKASAN_EKSEKUTIF or calculated from tabs
   */
  async getExecutiveKpi(spreadsheetId: string): Promise<{
    totalPlafon: number;
    totalBelanja: number;
    marginBersih: number;
    marginPercentage: number;
  }> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();

    try {
      // 1. Read all Pagu from 02_PENDAPATAN_SPPG (Col I)
      const incomeRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'02_PENDAPATAN_SPPG'!I2:I",
      });
      const incomeValues = incomeRes.data.values || [];
      const totalPlafon = incomeValues.reduce((sum, row) => {
        const val = Number(String(row[0] || "").replace(/[^\d.-]/g, ""));
        return sum + (isNaN(val) ? 0 : val);
      }, 0);

      // 2. Read all Belanja from 03_PENGELUARAN_SUPPLIER (Col I)
      const expenseRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'03_PENGELUARAN_SUPPLIER'!I2:I",
      });
      const expenseValues = expenseRes.data.values || [];
      const totalBelanja = expenseValues.reduce((sum, row) => {
        const val = Number(String(row[0] || "").replace(/[^\d.-]/g, ""));
        return sum + (isNaN(val) ? 0 : val);
      }, 0);

      const marginBersih = totalPlafon - totalBelanja;
      const marginPercentage = totalPlafon > 0 ? (marginBersih / totalPlafon) * 100 : 0;

      return {
        totalPlafon,
        totalBelanja,
        marginBersih,
        marginPercentage: Math.round(marginPercentage * 100) / 100,
      };
    } catch (err) {
      logger.warn({ err }, "Could not calculate live KPI from sheets, returning fallback");
      return { totalPlafon: 0, totalBelanja: 0, marginBersih: 0, marginPercentage: 0 };
    }
  }

  /**
   * Retrieves recent transactions (expenses and income) from Google Sheets
   */
  async getRecentTransactions(
    spreadsheetId: string,
    limit = 8
  ): Promise<
    Array<{
      id: string;
      date: string;
      type: "expense" | "income";
      title: string;
      amount: number;
      detail: string;
      link?: string;
    }>
  > {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();

    const results: Array<{
      id: string;
      date: string;
      type: "expense" | "income";
      title: string;
      amount: number;
      detail: string;
      link?: string;
    }> = [];

    try {
      // 1. Fetch expenses from 03_PENGELUARAN_SUPPLIER
      const expRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'03_PENGELUARAN_SUPPLIER'!A2:L",
      });
      const expRows = expRes.data.values || [];
      for (let i = expRows.length - 1; i >= 0 && results.length < limit; i--) {
        const row = expRows[i];
        if (row && row[0]) {
          const amount = Number(String(row[8] || "0").replace(/[^\d.-]/g, "")) || 0;
          results.push({
            id: String(row[0]),
            date: String(row[1] || "-"),
            type: "expense",
            title: String(row[3] || "Supplier"),
            amount,
            detail: String(row[4] || "-"),
            link: String(row[9] || ""),
          });
        }
      }

      // 2. Fetch orders from 02_PENDAPATAN_SPPG if we need more
      const orderRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'02_PENDAPATAN_SPPG'!A2:L",
      });
      const orderRows = orderRes.data.values || [];
      for (let i = orderRows.length - 1; i >= 0 && results.length < limit * 2; i--) {
        const row = orderRows[i];
        if (row && row[0]) {
          const amount = Number(String(row[8] || "0").replace(/[^\d.-]/g, "")) || 0;
          results.push({
            id: String(row[0]),
            date: String(row[1] || "-"),
            type: "income",
            title: `Nota SPPG ${row[3] || ""}`,
            amount,
            detail: String(row[4] || "-"),
          });
        }
      }

      // Sort by date descending
      results.sort((a, b) => b.date.localeCompare(a.date));
      return results.slice(0, limit);
    } catch (err) {
      logger.error({ err, spreadsheetId }, "Failed to get recent transactions from sheets");
      return [];
    }
  }

  /**
   * Retrieves single transaction detail by transaction ID
   */
  async getTransactionDetail(
    spreadsheetId: string,
    transactionId: string
  ): Promise<{
    found: boolean;
    id: string;
    sheetName?: string;
    rowIndex?: number;
    type?: "expense" | "income";
    date?: string;
    supplierOrUnit?: string;
    items?: string;
    amount?: number;
    link?: string;
    notes?: string;
  }> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();
    const cleanId = transactionId.trim().toUpperCase();

    // 1. Search in 03_PENGELUARAN_SUPPLIER
    try {
      const expRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'03_PENGELUARAN_SUPPLIER'!A:L",
      });
      const expRows = expRes.data.values || [];
      for (let idx = 0; idx < expRows.length; idx++) {
        const row = expRows[idx];
        if (row && row[0] && String(row[0]).trim().toUpperCase() === cleanId) {
          const amount = Number(String(row[8] || "0").replace(/[^\d.-]/g, "")) || 0;
          return {
            found: true,
            id: cleanId,
            sheetName: "03_PENGELUARAN_SUPPLIER",
            rowIndex: idx + 1,
            type: "expense",
            date: String(row[1] || "-"),
            supplierOrUnit: String(row[3] || "Supplier"),
            items: String(row[4] || "-"),
            amount,
            link: String(row[9] || ""),
            notes: String(row[11] || "-"),
          };
        }
      }
    } catch (err) {
      logger.warn({ err }, "Error searching in 03_PENGELUARAN_SUPPLIER");
    }

    // 2. Search in 02_PENDAPATAN_SPPG
    try {
      const ordRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'02_PENDAPATAN_SPPG'!A:L",
      });
      const ordRows = ordRes.data.values || [];
      for (let idx = 0; idx < ordRows.length; idx++) {
        const row = ordRows[idx];
        if (row && row[0] && String(row[0]).trim().toUpperCase() === cleanId) {
          const amount = Number(String(row[8] || "0").replace(/[^\d.-]/g, "")) || 0;
          return {
            found: true,
            id: cleanId,
            sheetName: "02_PENDAPATAN_SPPG",
            rowIndex: idx + 1,
            type: "income",
            date: String(row[1] || "-"),
            supplierOrUnit: String(row[3] || "SPPG Unit"),
            items: String(row[4] || "-"),
            amount,
            notes: String(row[11] || "-"),
          };
        }
      }
    } catch (err) {
      logger.warn({ err }, "Error searching in 02_PENDAPATAN_SPPG");
    }

    return { found: false, id: cleanId };
  }

  /**
   * Deletes a transaction row from Google Sheets by ID
   */
  async deleteTransactionRow(
    spreadsheetId: string,
    transactionId: string
  ): Promise<{ success: boolean; message: string }> {
    const detail = await this.getTransactionDetail(spreadsheetId, transactionId);
    if (!detail.found || !detail.sheetName || !detail.rowIndex) {
      return { success: false, message: `Transaksi ${transactionId} tidak ditemukan di Google Sheets.` };
    }

    const client = await this.getClient();

    try {
      const meta = await client.spreadsheets.get({ spreadsheetId });
      const targetSheet = (meta.data.sheets || []).find(
        (s) => s.properties?.title === detail.sheetName
      );
      const sheetIdNum = targetSheet?.properties?.sheetId || 0;

      // rowIndex is 1-indexed, zero-indexed startIndex = rowIndex - 1
      const startIndex = detail.rowIndex - 1;
      const endIndex = detail.rowIndex;

      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: sheetIdNum,
                  dimension: "ROWS",
                  startIndex,
                  endIndex,
                },
              },
            },
          ],
        },
      });

      logger.info(
        { transactionId, sheetName: detail.sheetName, rowIndex: detail.rowIndex },
        "Deleted transaction row from Google Sheets"
      );
      return { success: true, message: `Transaksi ${transactionId} berhasil dihapus dari Google Sheets (${detail.sheetName}).` };
    } catch (err: any) {
      logger.error({ err, transactionId }, "Failed to delete row from Google Sheets");
      return { success: false, message: `Gagal menghapus baris: ${err?.message || err}` };
    }
  }

  /**
   * Updates an existing transaction row in Google Sheets (e.g. edit nominal or supplier)
   */
  async updateTransactionRow(
    spreadsheetId: string,
    transactionId: string,
    updates: {
      total_amount?: number;
      supplier_name?: string;
      notes?: string;
    }
  ): Promise<{ success: boolean; message: string }> {
    const detail = await this.getTransactionDetail(spreadsheetId, transactionId);
    if (!detail.found || !detail.sheetName || !detail.rowIndex) {
      return { success: false, message: `Transaksi ${transactionId} tidak ditemukan di Google Sheets.` };
    }

    const client = await this.getClient();

    try {
      if (detail.sheetName === "03_PENGELUARAN_SUPPLIER") {
        if (updates.supplier_name) {
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${detail.sheetName}'!D${detail.rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[updates.supplier_name]] },
          });
        }
        if (updates.total_amount !== undefined) {
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${detail.sheetName}'!H${detail.rowIndex}:I${detail.rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[updates.total_amount, updates.total_amount]] },
          });
        }
        if (updates.notes) {
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${detail.sheetName}'!L${detail.rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[updates.notes]] },
          });
        }
      } else if (detail.sheetName === "02_PENDAPATAN_SPPG") {
        if (updates.total_amount !== undefined) {
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${detail.sheetName}'!I${detail.rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[updates.total_amount]] },
          });
        }
      }

      logger.info({ transactionId, updates }, "Updated transaction row in Google Sheets");
      return { success: true, message: `Transaksi ${transactionId} berhasil diperbarui di Google Sheets.` };
    } catch (err: any) {
      logger.error({ err, transactionId }, "Failed to update row in Google Sheets");
      return { success: false, message: `Gagal memperbarui transaksi: ${err?.message || err}` };
    }
  }
}

export const googleSheetsService = new GoogleSheetsService();

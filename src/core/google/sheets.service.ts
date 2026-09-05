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
  createMasterDashboardStructureBatchRequests,
  createMasterDashboardStylingBatchRequests,
  MASTER_SHEET_NAMES,
  MASTER_SHEET_IDS,
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

    if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId === env.GOOGLE_SHEET_ID_MASTER) {
      await this.ensureMasterDashboardStructure(spreadsheetId);
      this.initializedSpreadsheets.add(spreadsheetId);
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
  async ensureHeadersAndFormulas(spreadsheetId: string, unitName = "SPPG Unit", force = false): Promise<void> {
    const client = await this.getClient();

    try {
      if (!force) {
        const check = await client.spreadsheets.values.get({
          spreadsheetId,
          range: "'01_RINGKASAN_EKSEKUTIF'!A2",
        });

        if (check.data.values?.[0]?.[0] === "FILTER") {
          return; // Already configured with professional filter controls
        }
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
      const formulaStatus = `=IF(E4>=0,15; "SURPLUS EFISIEN (>= 15%)"; IF(E4>=0,05; "SESUAI PAGU (5% - 15%)"; "PERHATIAN: OVER-BUDGET (< 5%)"))`;
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
                ["EXECUTIVE SUMMARY & KPI REALISASI SPPG - BADAN GIZI NASIONAL", "", "", "", "", "", ""],
                ["FILTER", "TAHUN ANGGARAN:", "SEMUA TAHUN", "BULAN TRANSAKSI:", "SEMUA BULAN", "UNIT KERJA:", unitName],
                [
                  "NO",
                  "TOTAL PLAFON (PAGU)",
                  "REALISASI BELANJA RIIL",
                  "MARGIN BERSIH SPPG",
                  "% EFISIENSI MARGIN",
                  "STATUS EVALUASI KEUANGAN",
                  "TOTAL TRANSAKSI",
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
      const borderGray = hexToRgbColor("#CBD5E1");

      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            // Set Row Heights on Tab 01
            {
              updateDimensionProperties: {
                range: { sheetId: ringkasanSheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
                properties: { pixelSize: 42 },
                fields: "pixelSize",
              },
            },
            {
              updateDimensionProperties: {
                range: { sheetId: ringkasanSheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 },
                properties: { pixelSize: 32 },
                fields: "pixelSize",
              },
            },
            {
              updateDimensionProperties: {
                range: { sheetId: ringkasanSheetId, dimension: "ROWS", startIndex: 2, endIndex: 3 },
                properties: { pixelSize: 38 },
                fields: "pixelSize",
              },
            },
            {
              updateDimensionProperties: {
                range: { sheetId: ringkasanSheetId, dimension: "ROWS", startIndex: 3, endIndex: 4 },
                properties: { pixelSize: 44 },
                fields: "pixelSize",
              },
            },
            // Set Column Widths on Tab 01 (Generous, zero text cutoff)
            {
              updateDimensionProperties: {
                range: { sheetId: ringkasanSheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
                properties: { pixelSize: 80 },
                fields: "pixelSize",
              },
            },
            {
              updateDimensionProperties: {
                range: { sheetId: ringkasanSheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 4 },
                properties: { pixelSize: 240 },
                fields: "pixelSize",
              },
            },
            {
              updateDimensionProperties: {
                range: { sheetId: ringkasanSheetId, dimension: "COLUMNS", startIndex: 4, endIndex: 5 },
                properties: { pixelSize: 190 },
                fields: "pixelSize",
              },
            },
            {
              updateDimensionProperties: {
                range: { sheetId: ringkasanSheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 6 },
                properties: { pixelSize: 280 },
                fields: "pixelSize",
              },
            },
            {
              updateDimensionProperties: {
                range: { sheetId: ringkasanSheetId, dimension: "COLUMNS", startIndex: 6, endIndex: 7 },
                properties: { pixelSize: 220 },
                fields: "pixelSize",
              },
            },
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
            // Header row 3 styling with WRAP strategy
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
                    wrapStrategy: "WRAP",
                  },
                },
                fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
              },
            },
            // Values formatting row 4
            {
              repeatCell: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 3,
                  endRowIndex: 4,
                  startColumnIndex: 0,
                  endColumnIndex: 1,
                },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true, fontSize: 12 },
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
            // Table Borders for Row 2 to 4
            {
              updateBorders: {
                range: {
                  sheetId: ringkasanSheetId,
                  startRowIndex: 2,
                  endRowIndex: 4,
                  startColumnIndex: 0,
                  endColumnIndex: 7,
                },
                top: { style: "SOLID", width: 1, color: navyBg },
                bottom: { style: "SOLID_MEDIUM", width: 2, color: navyBg },
                left: { style: "SOLID", width: 1, color: borderGray },
                right: { style: "SOLID", width: 1, color: borderGray },
                innerHorizontal: { style: "SOLID", width: 1, color: borderGray },
                innerVertical: { style: "SOLID", width: 1, color: borderGray },
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
   * Configures dedicated Executive Multi-Unit Aggregator structure for Master Dashboard
   */
  async ensureMasterDashboardStructure(spreadsheetId: string, force = false): Promise<void> {
    const client = await this.getClient();

    try {
      if (!force) {
        const check = await client.spreadsheets.values
          .get({
            spreadsheetId,
            range: `'${MASTER_SHEET_NAMES.KONSOLIDASI_NASIONAL}'!A1`,
          })
          .catch(() => ({ data: { values: null } }));

        if (check.data.values?.[0]?.[0]?.includes("KONSOLIDASI MULTI-UNIT")) {
          return;
        }
      }

      logger.info({ spreadsheetId }, "Configuring Executive Master Dashboard BGN (Konsolidasi Multi-Unit)...");

      const meta = await client.spreadsheets.get({ spreadsheetId });
      const existingSheets = meta.data.sheets || [];
      const sheetMap = new Map<string, number>();
      existingSheets.forEach((s) => {
        if (s.properties?.title && typeof s.properties?.sheetId === "number") {
          sheetMap.set(s.properties.title, s.properties.sheetId);
        }
      });

      const firstSheetId = typeof existingSheets[0]?.properties?.sheetId === "number" ? existingSheets[0].properties.sheetId : 0;
      const structRequests = createMasterDashboardStructureBatchRequests(sheetMap, firstSheetId);

      if (structRequests.length > 0) {
        await client.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: structRequests },
        });
      }

      const updatedMeta = await client.spreadsheets.get({ spreadsheetId });
      const konsolidasiSheetId =
        updatedMeta.data.sheets?.find((s) => s.properties?.title === MASTER_SHEET_NAMES.KONSOLIDASI_NASIONAL)
          ?.properties?.sheetId ?? 0;
      const trxSheetId =
        updatedMeta.data.sheets?.find((s) => s.properties?.title === MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL)
          ?.properties?.sheetId ?? MASTER_SHEET_IDS.SEMUA_TRANSAKSI_GLOBAL;
      const dirSheetId =
        updatedMeta.data.sheets?.find((s) => s.properties?.title === MASTER_SHEET_NAMES.DIREKTORI_SPPG)
          ?.properties?.sheetId ?? MASTER_SHEET_IDS.DIREKTORI_SPPG;

      const startDateExpr = `IF(C2="SEMUA TAHUN"; DATE(2020;1;1); IF(E2="SEMUA BULAN"; DATE(VALUE(C2);1;1); DATE(VALUE(C2);VALUE(LEFT(E2;2));1)))`;
      const endDateExpr = `IF(C2="SEMUA TAHUN"; DATE(2035;12;31); IF(E2="SEMUA BULAN"; DATE(VALUE(C2);12;31); DATE(VALUE(C2);VALUE(LEFT(E2;2))+1;0)))`;

      const valuesTab1 = [
        ["EXECUTIVE MASTER DASHBOARD - BADAN GIZI NASIONAL (KONSOLIDASI MULTI-UNIT)", "", "", "", "", "", "", "", "", ""],
        ["FILTER", "TAHUN ANGGARAN:", "SEMUA TAHUN", "BULAN TRANSAKSI:", "SEMUA BULAN", "STATUS MONITORING:", "SEMUA UNIT", "UPDATE SISTEM:", '=TEXT(NOW(); "yyyy-mm-dd hh:mm")', ""],
        [
          "NO",
          "TOTAL PLAFON NASIONAL",
          "TOTAL REALISASI BELANJA",
          "SURPLUS / DEFISIT BERSIH",
          "% EFISIENSI NASIONAL",
          "STATUS KEUANGAN BGN",
          "TOTAL TRANSAKSI",
          "TOTAL DAPUR AKTIF",
          "STATUS AUDIT",
          "KETERANGAN",
        ],
        [
          "BGN",
          "=D11",
          "=E11",
          "=B4-C4",
          "=IF(B4>0; D4/B4; 0)",
          `=IF(B4=0; "BELUM ADA TRANSAKSI"; IF(E4>=0,15; "SURPLUS EFISIEN (>= 15%)"; IF(E4>=0,05; "SESUAI PAGU (5% - 15%)"; "PERHATIAN: DEFISIT (< 5%)")))`,
          "=I11",
          "=COUNTA(B8:B10)",
          "TERVALIDASI",
          "KONSOLIDASI LIVE DARI SELURUH DAPUR",
        ],
        ["", "", "", "", "", "", "", "", "", ""],
        ["TABEL KOMPARASI KINERJA & REALISASI ANGGARAN ANTAR-UNIT SPPG", "", "", "", "", "", "", "", "", ""],
        [
          "NO",
          "NAMA UNIT SPPG",
          "WILAYAH / LOKASI",
          "TOTAL PLAFON (RP)",
          "REALISASI BELANJA (RP)",
          "MARGIN BERSIH (RP)",
          "% EFISIENSI",
          "STATUS EVALUASI",
          "TOTAL TRX",
          "LINK SPREADSHEET DAPUR",
        ],
        [
          1,
          "SPPG Patila",
          "Kab. Luwu Utara, Sulawesi Selatan",
          `=IFERROR(SUMIFS('02_SEMUA_TRANSAKSI_GLOBAL'!H:H; '02_SEMUA_TRANSAKSI_GLOBAL'!C:C; B8; '02_SEMUA_TRANSAKSI_GLOBAL'!D:D; "PENDAPATAN"; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; ">=" & ${startDateExpr}; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; "<=" & ${endDateExpr}); 0)`,
          `=IFERROR(SUMIFS('02_SEMUA_TRANSAKSI_GLOBAL'!H:H; '02_SEMUA_TRANSAKSI_GLOBAL'!C:C; B8; '02_SEMUA_TRANSAKSI_GLOBAL'!D:D; "PENGELUARAN"; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; ">=" & ${startDateExpr}; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; "<=" & ${endDateExpr}); 0)`,
          "=D8-E8",
          "=IF(D8>0; F8/D8; 0)",
          `=IF(D8=0; "BELUM ADA TRANSAKSI"; IF(G8>=0,15; "SURPLUS EFISIEN (>= 15%)"; IF(G8>=0,05; "SESUAI PAGU (5% - 15%)"; "PERHATIAN: OVER-BUDGET (< 5%)")))`,
          `=COUNTIFS('02_SEMUA_TRANSAKSI_GLOBAL'!C:C; B8; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; ">=" & ${startDateExpr}; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; "<=" & ${endDateExpr})`,
          `=HYPERLINK("https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID_PATILA}/edit"; "Buka Spreadsheet Patila")`,
        ],
        [
          2,
          "SPPG Dapur Unit 2",
          "Wilayah Operasional Unit 2",
          `=IFERROR(SUMIFS('02_SEMUA_TRANSAKSI_GLOBAL'!H:H; '02_SEMUA_TRANSAKSI_GLOBAL'!C:C; B9; '02_SEMUA_TRANSAKSI_GLOBAL'!D:D; "PENDAPATAN"; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; ">=" & ${startDateExpr}; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; "<=" & ${endDateExpr}); 0)`,
          `=IFERROR(SUMIFS('02_SEMUA_TRANSAKSI_GLOBAL'!H:H; '02_SEMUA_TRANSAKSI_GLOBAL'!C:C; B9; '02_SEMUA_TRANSAKSI_GLOBAL'!D:D; "PENGELUARAN"; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; ">=" & ${startDateExpr}; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; "<=" & ${endDateExpr}); 0)`,
          "=D9-E9",
          "=IF(D9>0; F9/D9; 0)",
          `=IF(D9=0; "BELUM ADA TRANSAKSI"; IF(G9>=0,15; "SURPLUS EFISIEN (>= 15%)"; IF(G9>=0,05; "SESUAI PAGU (5% - 15%)"; "PERHATIAN: OVER-BUDGET (< 5%)")))`,
          `=COUNTIFS('02_SEMUA_TRANSAKSI_GLOBAL'!C:C; B9; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; ">=" & ${startDateExpr}; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; "<=" & ${endDateExpr})`,
          `=HYPERLINK("https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID_UNIT2}/edit"; "Buka Spreadsheet Unit 2")`,
        ],
        [
          3,
          "SPPG Dapur Unit 3",
          "Wilayah Operasional Unit 3",
          `=IFERROR(SUMIFS('02_SEMUA_TRANSAKSI_GLOBAL'!H:H; '02_SEMUA_TRANSAKSI_GLOBAL'!C:C; B10; '02_SEMUA_TRANSAKSI_GLOBAL'!D:D; "PENDAPATAN"; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; ">=" & ${startDateExpr}; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; "<=" & ${endDateExpr}); 0)`,
          `=IFERROR(SUMIFS('02_SEMUA_TRANSAKSI_GLOBAL'!H:H; '02_SEMUA_TRANSAKSI_GLOBAL'!C:C; B10; '02_SEMUA_TRANSAKSI_GLOBAL'!D:D; "PENGELUARAN"; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; ">=" & ${startDateExpr}; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; "<=" & ${endDateExpr}); 0)`,
          "=D10-E10",
          "=IF(D10>0; F10/D10; 0)",
          `=IF(D10=0; "BELUM ADA TRANSAKSI"; IF(G10>=0,15; "SURPLUS EFISIEN (>= 15%)"; IF(G10>=0,05; "SESUAI PAGU (5% - 15%)"; "PERHATIAN: OVER-BUDGET (< 5%)")))`,
          `=COUNTIFS('02_SEMUA_TRANSAKSI_GLOBAL'!C:C; B10; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; ">=" & ${startDateExpr}; '02_SEMUA_TRANSAKSI_GLOBAL'!B:B; "<=" & ${endDateExpr})`,
          `=HYPERLINK("https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID_UNIT3}/edit"; "Buka Spreadsheet Unit 3")`,
        ],
        [
          "TOTAL",
          "TOTAL KONSOLIDASI SELURUH UNIT BGN",
          "SEMUA WILAYAH",
          "=SUM(D8:D10)",
          "=SUM(E8:E10)",
          "=D11-E11",
          "=IF(D11>0; F11/D11; 0)",
          `=IF(D11=0; "BELUM ADA TRANSAKSI"; IF(G11>=0,15; "SURPLUS EFISIEN (>= 15%)"; IF(G11>=0,05; "SESUAI PAGU (5% - 15%)"; "PERHATIAN: DEFISIT (< 5%)")))`,
          "=SUM(I8:I10)",
          "-",
        ],
      ];

      const valuesTab2 = [
        [
          "ID TRANSAKSI",
          "TANGGAL",
          "UNIT SPPG",
          "TIPE TRANSAKSI",
          "NO SPPG / REF",
          "REKANAN / SUPPLIER",
          "URAIAN BARANG / MENU",
          "TOTAL NOMINAL (RP)",
          "BUKTI / DOKUMEN",
          "PIC / PENCATAT",
          "STATUS",
        ],
      ];

      const valuesTab3 = [
        [
          "ID UNIT",
          "NAMA UNIT SPPG",
          "WILAYAH / LOKASI",
          "STATUS OPERASIONAL",
          "PENANGGUNG JAWAB (KEPALA SPPG)",
          "KONTAK TELEGRAM",
          "KAPASITAS PORSI / HARI",
          "TAUTAN SPREADSHEET OPERASIONAL",
        ],
        [
          "sppg-patila",
          "SPPG Patila",
          "Kab. Luwu Utara, Sulawesi Selatan",
          "AKTIF BEROPERASI",
          "Bapak Iza / Kepala SPPG Patila",
          "@sppg1bot",
          3000,
          `=HYPERLINK("https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID_PATILA}/edit"; "Buka Spreadsheet Patila")`,
        ],
        [
          "sppg-unit2",
          "SPPG Dapur Unit 2",
          "Wilayah Operasional Unit 2",
          "AKTIF BEROPERASI",
          "Admin Dapur Unit 2",
          "@sppg2bot",
          3000,
          `=HYPERLINK("https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID_UNIT2}/edit"; "Buka Spreadsheet Unit 2")`,
        ],
        [
          "sppg-unit3",
          "SPPG Dapur Unit 3",
          "Wilayah Operasional Unit 3",
          "AKTIF BEROPERASI",
          "Admin Dapur Unit 3",
          "@sppg3bot",
          3000,
          `=HYPERLINK("https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID_UNIT3}/edit"; "Buka Spreadsheet Unit 3")`,
        ],
      ];

      await client.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: [
            { range: `'${MASTER_SHEET_NAMES.KONSOLIDASI_NASIONAL}'!A1:J11`, values: valuesTab1 },
            { range: `'${MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL}'!A1:K1`, values: valuesTab2 },
            { range: `'${MASTER_SHEET_NAMES.DIREKTORI_SPPG}'!A1:H4`, values: valuesTab3 },
          ],
        },
      });

      const stylingRequests = createMasterDashboardStylingBatchRequests(
        konsolidasiSheetId,
        trxSheetId,
        dirSheetId
      );

      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: stylingRequests },
      });

      logger.info({ spreadsheetId }, "Successfully configured Executive Master Dashboard BGN");
    } catch (err: any) {
      logger.error({ err: err?.message || err, spreadsheetId }, "Failed ensuring Master Dashboard structure");
    }
  }

  /**
   * Helper to resolve SPPG Unit display name from spreadsheet ID
   */
  getUnitNameFromSpreadsheetId(spreadsheetId: string): string {
    if (spreadsheetId === env.GOOGLE_SHEET_ID_PATILA) return "SPPG Patila";
    if (spreadsheetId === env.GOOGLE_SHEET_ID_UNIT2) return "SPPG Dapur Unit 2";
    if (spreadsheetId === env.GOOGLE_SHEET_ID_UNIT3) return "SPPG Dapur Unit 3";
    return "SPPG Unit";
  }

  /**
   * Appends records directly to Tab 02_SEMUA_TRANSAKSI_GLOBAL on Master Dashboard
   */
  async recordToMasterConsolidated(rows: any[][]): Promise<void> {
    if (!env.GOOGLE_SHEET_ID_MASTER || rows.length === 0) return;
    await this.ensureMasterDashboardStructure(env.GOOGLE_SHEET_ID_MASTER);
    await this.appendRowsSafely(env.GOOGLE_SHEET_ID_MASTER, MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL, rows);
  }

  /**
   * Pulls existing transactions from operational sheets and synchronizes them to Master Dashboard
   */
  async syncAllUnitsToMaster(): Promise<{ syncedCount: number }> {
    if (!env.GOOGLE_SHEET_ID_MASTER) return { syncedCount: 0 };
    await this.ensureMasterDashboardStructure(env.GOOGLE_SHEET_ID_MASTER);

    const client = await this.getClient();

    // Read current transactions in Master Dashboard to prevent duplicates
    const currentMaster = await client.spreadsheets.values.get({
      spreadsheetId: env.GOOGLE_SHEET_ID_MASTER,
      range: `'${MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL}'!A2:A`,
    });
    const existingIds = new Set((currentMaster.data.values || []).map((r) => r[0]));

    const unitList = [
      { id: env.GOOGLE_SHEET_ID_PATILA, name: "SPPG Patila" },
      { id: env.GOOGLE_SHEET_ID_UNIT2, name: "SPPG Dapur Unit 2" },
      { id: env.GOOGLE_SHEET_ID_UNIT3, name: "SPPG Dapur Unit 3" },
    ];

    const newRows: any[][] = [];

    for (const unit of unitList) {
      if (!unit.id || unit.id === env.GOOGLE_SHEET_ID_MASTER) continue;

      try {
        // Read income
        const incRes = await client.spreadsheets.values.get({
          spreadsheetId: unit.id,
          range: "'02_PENDAPATAN_SPPG'!A2:L",
        });
        for (const r of incRes.data.values || []) {
          if (!r[0] || existingIds.has(r[0])) continue;
          newRows.push([
            r[0],
            r[1],
            unit.name,
            "PENDAPATAN",
            r[3] || "-",
            r[9] || "Pemerintah / BGN",
            `${r[4]} (${r[5]} ${r[6]})`,
            r[8],
            "-",
            "Admin SPPG",
            r[10] || "LENGKAP",
          ]);
          existingIds.add(r[0]);
        }

        // Read expense
        const expRes = await client.spreadsheets.values.get({
          spreadsheetId: unit.id,
          range: "'03_PENGELUARAN_SUPPLIER'!A2:L",
        });
        for (const r of expRes.data.values || []) {
          if (!r[0] || existingIds.has(r[0])) continue;
          newRows.push([
            r[0],
            r[1],
            unit.name,
            "PENGELUARAN",
            r[2] || "-",
            r[3] || "-",
            r[4] || "Belanja Bahan Dapur",
            r[8],
            r[9] || "-",
            r[10] || "PIC Dapur",
            "LUNAS",
          ]);
          existingIds.add(r[0]);
        }
      } catch (e: any) {
        logger.warn({ err: e?.message || e, unit: unit.name }, "Could not sync unit to master");
      }
    }

    if (newRows.length > 0) {
      await this.recordToMasterConsolidated(newRows);
      logger.info({ count: newRows.length }, "Synced transactions to Master Dashboard");
    }

    return { syncedCount: newRows.length };
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

    // Forward to Master Dashboard if different spreadsheet
    if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
      const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
      const masterRows = order.items.map((item, idx) => {
        const orderId = `SPPG-ORD-${order.order_date.replace(/-/g, "")}-${String(idx + 1).padStart(3, "0")}`;
        return [
          orderId,
          order.order_date,
          unitName,
          "PENDAPATAN",
          order.order_no,
          item.supplier_target || "Pemerintah / BGN",
          `${item.item_name} (${item.qty} ${item.unit})`,
          item.total_price,
          "-",
          order.signed_by || "Admin SPPG",
          "LENGKAP",
        ];
      });
      await this.recordToMasterConsolidated(masterRows).catch((err) => {
        logger.warn({ err: err?.message || err }, "Failed forwarding order to Master Dashboard");
      });
    }
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

    // Forward to Master Dashboard if different spreadsheet
    if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
      const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
      const masterRow = [
        expenseId,
        receipt.date || nowIso,
        unitName,
        "PENGELUARAN",
        receipt.sppg_ref_no || "-",
        receipt.supplier_name,
        itemsSummary || "Belanja Bahan Dapur",
        receipt.total_amount,
        driveHyperlinkFormula,
        picName || "Ayah (Vendor)",
        "LUNAS",
      ];
      await this.recordToMasterConsolidated([masterRow]).catch((err) => {
        logger.warn({ err: err?.message || err }, "Failed forwarding expense to Master Dashboard");
      });
    }
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
      // Helper to parse Indonesian currency with dot thousand separators
      const parseAmount = (val: any): number => {
        if (typeof val === "number") return val;
        const clean = String(val || "").replace(/[^\d,.-]/g, "").trim();
        const normalized = clean.replace(/\./g, "").replace(/,/g, ".");
        const num = parseFloat(normalized);
        return isNaN(num) ? 0 : num;
      };

      // 1. Read all Pagu from 02_PENDAPATAN_SPPG (Col I)
      const incomeRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'02_PENDAPATAN_SPPG'!I2:I",
      });
      const incomeValues = incomeRes.data.values || [];
      const totalPlafon = incomeValues.reduce((sum, row) => sum + parseAmount(row[0]), 0);

      // 2. Read all Belanja from 03_PENGELUARAN_SUPPLIER (Col I)
      const expenseRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'03_PENGELUARAN_SUPPLIER'!I2:I",
      });
      const expenseValues = expenseRes.data.values || [];
      const totalBelanja = expenseValues.reduce((sum, row) => sum + parseAmount(row[0]), 0);

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

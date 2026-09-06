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
  createBandingBatchRequests,
  createMasterDashboardStructureBatchRequests,
  createMasterDashboardStylingBatchRequests,
  getMasterDashboardValues,
  createMasterDashboardChartRequest,
  createOperationalDashboardStructureBatchRequests,
  createOperationalDashboardResetRequests,
  getOperationalDashboardValues,
  createOperationalDashboardStylingRequests,
  createOperationalDashboardChartRequest,
  SHEET_NAMES,
  SHEET_IDS,
  MASTER_SHEET_NAMES,
  MASTER_SHEET_IDS,
  hexToRgbColor,
  BGN_PALETTE,
} from "./sheets-recipes.js";
import { logger } from "../utils/logger.js";

export function parseCurrencyNumber(val: any): number {
  if (typeof val === "number") return val;
  const str = String(val || "").trim();
  if (!str) return 0;
  // Handle Indonesian format where dot is thousand separator and comma is decimal
  const clean = str.replace(/[^\d,.-]/g, "").trim();
  const normalized = clean.replace(/\./g, "").replace(/,/g, ".");
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}

export interface PaguCandidate {
  rowIndex: number;
  sppg_ref_no: string;
  order_date: string;
  supplier_name: string;
  item_name: string;
  target_qty: number;
  unit: string;
  pagu_price: number;
  pagu_total: number;
  fulfilled_qty: number;
  fulfilled_total: number;
  remaining_qty: number;
  status: string;
}

export interface MasterAuditLogEntry {
  timestamp?: string; // Default to current WITA
  unitName: string;
  editor: string; // e.g. "Ayah (Spreadsheet)", "Telegram Bot", "Delta Sync"
  sheetTab: string; // e.g. "03_PAGU_RINCIAN"
  refId: string; // e.g. "SPPG/2026/09/001" or transaction ID
  columnEdited: string; // e.g. "Harga Pagu Satuan (H)"
  oldValue: string | number;
  newValue: string | number;
  sourceAction: string; // e.g. "Spreadsheet Direct Edit", "Telegram Input", "Delta Reconcile"
  status?: string; // e.g. "TERCATAT", "TERVERIFIKASI"
}

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
  async ensure5TabStructure(spreadsheetId: string, forceReset = false): Promise<void> {
    if (this.initializedSpreadsheets.has(spreadsheetId) && !forceReset) {
      return;
    }

    if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId === env.GOOGLE_SHEET_ID_MASTER) {
      await this.ensureMasterDashboardStructure(spreadsheetId, forceReset);
      this.initializedSpreadsheets.add(spreadsheetId);
      return;
    }

    const client = await this.getClient();

    try {
      const meta = await client.spreadsheets.get({ spreadsheetId });
      const sheetByTitle = new Map<string, number>();
      (meta.data.sheets || []).forEach((s) => {
        if (s.properties?.title && typeof s.properties?.sheetId === "number") {
          sheetByTitle.set(s.properties.title, s.properties.sheetId);
        }
      });

      // 1. Rename existing legacy tabs if needed
      const renameRequests: sheets_v4.Schema$Request[] = [];
      if (sheetByTitle.has("02_PENDAPATAN_SPPG") && !sheetByTitle.has(SHEET_NAMES.PAGU_RINGKASAN)) {
        renameRequests.push({
          updateSheetProperties: {
            properties: { sheetId: sheetByTitle.get("02_PENDAPATAN_SPPG")!, title: SHEET_NAMES.PAGU_RINGKASAN },
            fields: "title",
          },
        });
      }
      if (sheetByTitle.has("03_PENGELUARAN_SUPPLIER") && !sheetByTitle.has(SHEET_NAMES.PENGELUARAN_SUPPLIER)) {
        renameRequests.push({
          updateSheetProperties: {
            properties: { sheetId: sheetByTitle.get("03_PENGELUARAN_SUPPLIER")!, title: SHEET_NAMES.PENGELUARAN_SUPPLIER },
            fields: "title",
          },
        });
      }
      if (sheetByTitle.has("04_REKAP_MARGIN_HARIAN") && !sheetByTitle.has(SHEET_NAMES.REKAP_MARGIN)) {
        renameRequests.push({
          updateSheetProperties: {
            properties: { sheetId: sheetByTitle.get("04_REKAP_MARGIN_HARIAN")!, title: SHEET_NAMES.REKAP_MARGIN },
            fields: "title",
          },
        });
      }
      if (sheetByTitle.has("05_MASTER_DATA") && !sheetByTitle.has(SHEET_NAMES.MASTER_DATA)) {
        renameRequests.push({
          updateSheetProperties: {
            properties: { sheetId: sheetByTitle.get("05_MASTER_DATA")!, title: SHEET_NAMES.MASTER_DATA },
            fields: "title",
          },
        });
      }

      if (renameRequests.length > 0) {
        await client.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: renameRequests },
        });
        logger.info({ spreadsheetId, renamesCount: renameRequests.length }, "Migrated legacy tab titles to new 5-Tab format");
      }

      // Re-fetch titles and IDs after renaming
      const updatedMeta = await client.spreadsheets.get({ spreadsheetId });
      const currentTitles = (updatedMeta.data.sheets || []).map((s) => s.properties?.title || "");
      const existingSheetIds = new Set(
        (updatedMeta.data.sheets || [])
          .map((s) => s.properties?.sheetId)
          .filter((id): id is number => typeof id === "number")
      );

      // Check for missing tabs
      const addRequests: sheets_v4.Schema$Request[] = [];
      if (!currentTitles.includes(SHEET_NAMES.PAGU_RINCIAN)) {
        const props: sheets_v4.Schema$SheetProperties = {
          title: SHEET_NAMES.PAGU_RINCIAN,
          index: 2,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.EMBLEM_GOLD) },
          gridProperties: { rowCount: 5000, columnCount: 10, frozenRowCount: 1 },
        };
        if (!existingSheetIds.has(SHEET_IDS.PAGU_RINCIAN)) {
          props.sheetId = SHEET_IDS.PAGU_RINCIAN;
        }
        addRequests.push({ addSheet: { properties: props } });
      }
      if (!currentTitles.includes(SHEET_NAMES.REKAP_MARGIN)) {
        const props: sheets_v4.Schema$SheetProperties = {
          title: SHEET_NAMES.REKAP_MARGIN,
          index: 4,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.FOREST_GREEN) },
          gridProperties: { rowCount: 5000, columnCount: 13, frozenRowCount: 1 },
        };
        if (!existingSheetIds.has(SHEET_IDS.REKAP_MARGIN)) {
          props.sheetId = SHEET_IDS.REKAP_MARGIN;
        }
        addRequests.push({ addSheet: { properties: props } });
      }
      if (!currentTitles.includes(SHEET_NAMES.MASTER_DATA)) {
        const props: sheets_v4.Schema$SheetProperties = {
          title: SHEET_NAMES.MASTER_DATA,
          index: 5,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SLATE_GRAY) },
          hidden: true,
          gridProperties: { rowCount: 200, columnCount: 5, frozenRowCount: 1 },
        };
        if (!existingSheetIds.has(SHEET_IDS.MASTER_DATA)) {
          props.sheetId = SHEET_IDS.MASTER_DATA;
        }
        addRequests.push({ addSheet: { properties: props } });
      }

      if (addRequests.length > 0) {
        await client.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: addRequests },
        });
        logger.info({ spreadsheetId, addedCount: addRequests.length }, "Added missing tabs in 5-Tab BGN structure");
      }

      // Initialize Master Data default rows if empty
      await client.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_NAMES.MASTER_DATA}'!A2:C5`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [
            ["Ayam Pasar", "Ekor", "Protein Hewani"],
            ["Hj Muliadi", "KG", "Sayuran Segar"],
            ["Mas Pandu", "Jerigen", "Bahan Pokok"],
            ["Best Fruit", "Keranjang", "Buah Segar"],
          ],
        },
      }).catch(() => {});

      // Ensure visual dashboard and dynamic formulas are in place
      const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
      await this.ensureHeadersAndFormulas(spreadsheetId, unitName, forceReset);
      await this.applyBandingToMissingSheets(spreadsheetId);
      this.initializedSpreadsheets.add(spreadsheetId);
    } catch (err: any) {
      logger.warn({ err: err?.message || err, spreadsheetId }, "Note during 5-tab verification");
    }
  }

  /**
   * Pre-initializes spreadsheet tabs in background on bot startup so first user interaction is instant
   */
  async warmUp(spreadsheetIds: string[]): Promise<void> {
    for (const id of spreadsheetIds) {
      if (!id || this.initializedSpreadsheets.has(id)) continue;
      this.ensure5TabStructure(id).catch((err) => {
        logger.debug({ err: err?.message, id }, "Background spreadsheet warm-up note");
      });
    }
  }

  /**
   * Writes visual 01_DASHBOARD, interactive Month/Year filters, and clean official BGN headers without (Rp)
   */
  async ensureHeadersAndFormulas(spreadsheetId: string, unitName = "SPPG Unit", force = false): Promise<void> {
    const client = await this.getClient();

    try {
      if (!force) {
        const check = await client.spreadsheets.values
          .get({
            spreadsheetId,
            range: `'${SHEET_NAMES.DASHBOARD}'!B2`,
          })
          .catch(() => ({ data: { values: null } }));

        if (check.data?.values?.[0]?.[0]?.includes("DASHBOARD KEUANGAN")) {
          return; // Already configured with professional visual dashboard layout
        }
      }

      logger.info({ spreadsheetId, unitName }, "Configuring visual 01_DASHBOARD and clean BGN headers...");

      const meta = await client.spreadsheets.get({ spreadsheetId });
      const sheetMap = new Map<string, number>();
      const existingBandedSheetIds = new Set<number>();
      (meta.data.sheets || []).forEach((s) => {
        if (s.properties?.title && typeof s.properties?.sheetId === "number") {
          sheetMap.set(s.properties.title, s.properties.sheetId);
        }
        if ((s.bandedRanges || []).length > 0 && typeof s.properties?.sheetId === "number") {
          existingBandedSheetIds.add(s.properties.sheetId);
        }
      });

      // 1. Structure updates (rename to 01_DASHBOARD, hide 06_MASTER_DATA, unmerge old cells, delete old charts)
      const firstSheet = (meta.data.sheets || [])[0];
      const firstId = sheetMap.get(SHEET_NAMES.DASHBOARD) ?? sheetMap.get("01_RINGKASAN_EKSEKUTIF") ?? firstSheet?.properties?.sheetId ?? 0;
      const targetSheetObj = (meta.data.sheets || []).find((s) => s.properties?.sheetId === firstId);
      const existingCharts = targetSheetObj?.charts || [];
      const existingChartIds = existingCharts.map((c) => c.chartId!).filter(Boolean);

      const structureReqs = createOperationalDashboardStructureBatchRequests(sheetMap, firstId, existingChartIds);
      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: structureReqs },
      });

      // 2. Clear old residual values in 01_DASHBOARD and residual header columns in tabs
      await Promise.all([
        client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.DASHBOARD}'!A1:Z50` }).catch(() => {}),
        client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A1:Z1` }).catch(() => {}),
        client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.PAGU_RINCIAN}'!A1:Z1` }).catch(() => {}),
        client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A1:Z1` }).catch(() => {}),
        client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.REKAP_MARGIN}'!A1:Z1` }).catch(() => {}),
      ]);

      // 3. Write Values & Formulas across all tabs
      const {
        valuesDashboard,
        valuesHelper,
        tabPaguRingkasanHeaders,
        tabPaguRincianHeaders,
        tabPengeluaranHeaders,
        tabRekapMarginHeaders,
        tabMasterDataHeaders,
      } = getOperationalDashboardValues(unitName);

      await client.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: [
            {
              range: `'${SHEET_NAMES.DASHBOARD}'!A1:K28`,
              values: valuesDashboard,
            },
            {
              range: `'${SHEET_NAMES.DASHBOARD}'!M1:M4`,
              values: valuesHelper,
            },
            {
              range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A1:J1`,
              values: tabPaguRingkasanHeaders,
            },
            {
              range: `'${SHEET_NAMES.PAGU_RINCIAN}'!A1:J1`,
              values: tabPaguRincianHeaders,
            },
            {
              range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A1:J1`,
              values: tabPengeluaranHeaders,
            },
            {
              range: `'${SHEET_NAMES.REKAP_MARGIN}'!A1:M1`,
              values: tabRekapMarginHeaders,
            },
            {
              range: `'${SHEET_NAMES.MASTER_DATA}'!A1:C1`,
              values: tabMasterDataHeaders,
            },
          ],
        },
      });

      // 4. Apply complete visual styling, borders, colors, column widths, date & currency formats, and Pie Chart
      const chartRequest = createOperationalDashboardChartRequest(firstId);
      const stylingRequests = [
        ...createOperationalDashboardStylingRequests(firstId),
        ...createHeaderStylingBatchRequests(sheetMap),
        ...createNumberFormattingBatchRequests(sheetMap),
        ...createDataValidationBatchRequests(sheetMap),
        ...createConditionalFormattingBatchRequests(sheetMap),
        ...createBandingBatchRequests(sheetMap, existingBandedSheetIds),
        chartRequest,
      ];

      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: stylingRequests },
      });

      logger.info({ spreadsheetId, unitName }, "Successfully established BGN visual dashboard and clean headers");
    } catch (err: any) {
      logger.warn({ err: err?.message || err, spreadsheetId }, "Note writing dashboard headers and formulas");
    }
  }

  /**
   * Applies alternating zebra banding to any operational sheets that lack it
   */
  async applyBandingToMissingSheets(spreadsheetId: string): Promise<void> {
    const client = await this.getClient();
    const meta = await client.spreadsheets.get({ spreadsheetId });
    const sheetMap = new Map<string, number>();
    const existingBandedSheetIds = new Set<number>();
    (meta.data.sheets || []).forEach((s) => {
      if (s.properties?.title && typeof s.properties?.sheetId === "number") {
        sheetMap.set(s.properties.title, s.properties.sheetId);
      }
      if ((s.bandedRanges || []).length > 0 && typeof s.properties?.sheetId === "number") {
        existingBandedSheetIds.add(s.properties.sheetId);
      }
    });

    const requests = createBandingBatchRequests(sheetMap, existingBandedSheetIds);
    if (requests.length > 0) {
      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });
      logger.info({ spreadsheetId, addedCount: requests.length }, "Applied zebra banding to unbanded sheets");
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
            range: `'${MASTER_SHEET_NAMES.DASHBOARD}'!B2`,
          })
          .catch(() => ({ data: { values: null } }));

        const checkTab4 = await client.spreadsheets.values
          .get({
            spreadsheetId,
            range: `'${MASTER_SHEET_NAMES.LOG_AKTIVITAS}'!A1`,
          })
          .catch(() => ({ data: { values: null } }));

        if (check.data.values?.[0]?.[0]?.includes("DASHBOARD PUSAT") && checkTab4.data.values?.[0]?.[0]) {
          return;
        }
      }

      logger.info({ spreadsheetId }, "Configuring clean Executive Master Dashboard SPPG...");

      const meta = await client.spreadsheets.get({ spreadsheetId });
      const existingSheets = meta.data.sheets || [];
      const sheetMap = new Map<string, number>();
      existingSheets.forEach((s) => {
        if (s.properties?.title && typeof s.properties?.sheetId === "number") {
          sheetMap.set(s.properties.title, s.properties.sheetId);
        }
      });

      const firstSheetId = typeof existingSheets[0]?.properties?.sheetId === "number" ? existingSheets[0].properties.sheetId : 0;
      const targetSheetObj = existingSheets.find(
        (s) =>
          s.properties?.sheetId === firstSheetId ||
          s.properties?.title === MASTER_SHEET_NAMES.DASHBOARD ||
          s.properties?.title === "01_KONSOLIDASI_NASIONAL"
      );
      const existingCharts = targetSheetObj?.charts || [];
      const existingChartIds = existingCharts.map((c) => c.chartId!).filter(Boolean);

      const structRequests = createMasterDashboardStructureBatchRequests(sheetMap, firstSheetId, existingChartIds);

      if (structRequests.length > 0) {
        await client.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: structRequests },
        });
      }

      const updatedMeta = await client.spreadsheets.get({ spreadsheetId });
      const konsolidasiSheetId =
        updatedMeta.data.sheets?.find((s) => s.properties?.title === MASTER_SHEET_NAMES.DASHBOARD)
          ?.properties?.sheetId ?? 0;
      const trxSheetId =
        updatedMeta.data.sheets?.find((s) => s.properties?.title === MASTER_SHEET_NAMES.SEMUA_TRANSAKSI)
          ?.properties?.sheetId ?? MASTER_SHEET_IDS.SEMUA_TRANSAKSI;
      const dirSheetId =
        updatedMeta.data.sheets?.find((s) => s.properties?.title === MASTER_SHEET_NAMES.DAFTAR_DAPUR)
          ?.properties?.sheetId ?? MASTER_SHEET_IDS.DAFTAR_DAPUR;
      const logAktivitasSheetId =
        updatedMeta.data.sheets?.find((s) => s.properties?.title === MASTER_SHEET_NAMES.LOG_AKTIVITAS)
          ?.properties?.sheetId ?? MASTER_SHEET_IDS.LOG_AKTIVITAS;

      // Clear old residual values and reset formatting in 01_DASHBOARD to ensure pure clean canvas
      await client.spreadsheets.values
        .clear({
          spreadsheetId,
          range: `'${MASTER_SHEET_NAMES.DASHBOARD}'!A1:Z50`,
        })
        .catch(() => {});

      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              unmergeCells: {
                range: {
                  sheetId: konsolidasiSheetId,
                  startRowIndex: 0,
                  endRowIndex: 35,
                  startColumnIndex: 0,
                  endColumnIndex: 13,
                },
              },
            },
            {
              repeatCell: {
                range: {
                  sheetId: konsolidasiSheetId,
                  startRowIndex: 0,
                  endRowIndex: 35,
                  startColumnIndex: 0,
                  endColumnIndex: 13,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 1, green: 1, blue: 1 },
                  },
                },
                fields: "userEnteredFormat",
              },
            },
          ],
        },
      }).catch(() => {});

      const { valuesDashboard, valuesHelper, tab2Headers, tab3Headers, tab4Headers } = getMasterDashboardValues();

      const valuesTab3 = [
        tab3Headers[0],
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
            { range: `'${MASTER_SHEET_NAMES.DASHBOARD}'!A1:K28`, values: valuesDashboard },
            { range: `'${MASTER_SHEET_NAMES.DASHBOARD}'!M1:M4`, values: valuesHelper },
            { range: `'${MASTER_SHEET_NAMES.SEMUA_TRANSAKSI}'!A1:K1`, values: tab2Headers },
            { range: `'${MASTER_SHEET_NAMES.DAFTAR_DAPUR}'!A1:H4`, values: valuesTab3 },
            { range: `'${MASTER_SHEET_NAMES.LOG_AKTIVITAS}'!A1:J1`, values: tab4Headers },
          ],
        },
      });

      const chartRequest = createMasterDashboardChartRequest(konsolidasiSheetId);
      const stylingRequests = [
        ...createMasterDashboardStylingBatchRequests(
          konsolidasiSheetId,
          trxSheetId,
          dirSheetId,
          logAktivitasSheetId
        ),
        chartRequest,
      ];

      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: stylingRequests },
      });

      logger.info({ spreadsheetId }, "Successfully configured clean Executive Master Dashboard SPPG");
    } catch (err: any) {
      logger.error({ err: err?.message || err, spreadsheetId }, "Failed ensuring Master Dashboard structure");
    }
  }

  /**
   * Appends an audit trail entry directly into Master Dashboard 04_LOG_AKTIVITAS
   */
  async appendMasterAuditLog(entry: MasterAuditLogEntry): Promise<void> {
    const masterId = env.GOOGLE_SHEET_ID_MASTER;
    if (!masterId) return;

    try {
      await this.ensureMasterDashboardStructure(masterId);

      const now = new Date();
      // Format WITA (UTC+8)
      const witaStr = entry.timestamp || new Intl.DateTimeFormat("id-ID", {
        timeZone: "Asia/Makassar",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now).replace(/\./g, ":");

      const row = [
        witaStr,
        entry.unitName,
        entry.editor || "Editor",
        entry.sheetTab,
        entry.refId || "-",
        entry.columnEdited,
        String(entry.oldValue ?? "-"),
        String(entry.newValue ?? "-"),
        entry.sourceAction || "Spreadsheet Edit",
        entry.status || "TERCATAT",
      ];

      await this.appendRowsSafely(masterId, MASTER_SHEET_NAMES.LOG_AKTIVITAS, [row]);
      logger.info({ unit: entry.unitName, tab: entry.sheetTab, col: entry.columnEdited }, "Master Audit Log recorded");
    } catch (err: any) {
      logger.warn({ err: err?.message || err }, "Failed appending to Master Audit Log");
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
   * Helper to resolve SPPG Unit 2-digit code from spreadsheet ID
   */
  getUnitCodeFromSpreadsheetId(spreadsheetId: string): string {
    if (spreadsheetId === env.GOOGLE_SHEET_ID_PATILA) return "01";
    if (spreadsheetId === env.GOOGLE_SHEET_ID_UNIT2) return "02";
    if (spreadsheetId === env.GOOGLE_SHEET_ID_UNIT3) return "03";
    return "01";
  }

  /**
   * Generates standardized ID: SPPG[Kode Unit][Tahun]-[I/E][Huruf Bulan][Nomor Urut 001]
   * Contoh:
   * - Income Januari: SPPG0126-IA001
   * - Expense Januari: SPPG0126-EA001
   * - Income September: SPPG0126-II001
   * - Expense September: SPPG0126-EI001
   */
  generateTransactionId(
    unitCode: string,
    dateIso: string,
    counter: number,
    type: "income" | "expense"
  ): string {
    const d = new Date(dateIso || new Date());
    const year = String(d.getFullYear() || new Date().getFullYear()).slice(-2);
    const monthLetters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
    const monthLetter = monthLetters[d.getMonth()] || "A";
    const typePrefix = type === "income" ? "I" : "E";
    const padCounter = String(counter).padStart(3, "0");
    return `SPPG${unitCode}${year}-${typePrefix}${monthLetter}${padCounter}`;
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
   * Deletes matching transaction rows from Master Dashboard (02_SEMUA_TRANSAKSI)
   */
  async deleteMasterTransactionRow(transactionId: string, orderNo?: string): Promise<void> {
    if (!env.GOOGLE_SHEET_ID_MASTER) return;
    try {
      const client = await this.getClient();
      const meta = await client.spreadsheets.get({ spreadsheetId: env.GOOGLE_SHEET_ID_MASTER });
      const sheet = (meta.data.sheets || []).find(
        (s) => s.properties?.title === MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL
      );
      if (!sheet || typeof sheet.properties?.sheetId !== "number") return;
      const sheetId = sheet.properties.sheetId;

      const res = await client.spreadsheets.values.get({
        spreadsheetId: env.GOOGLE_SHEET_ID_MASTER,
        range: `'${MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL}'!A:E`,
      }).catch(() => ({ data: { values: null } }));
      const rows = res.data?.values || [];
      const cleanTxId = transactionId.trim().toLowerCase();
      const cleanOrderNo = (orderNo || "").trim().toLowerCase();

      const indicesToDelete: number[] = [];
      for (let i = 1; i < rows.length; i++) {
        const rowId = String(rows[i]?.[0] || "").trim().toLowerCase();
        const rowRef = String(rows[i]?.[4] || "").trim().toLowerCase();
        if (
          rowId === cleanTxId ||
          rowId.includes(cleanTxId) ||
          cleanTxId.includes(rowId) ||
          (cleanOrderNo && (rowRef === cleanOrderNo || rowId === cleanOrderNo))
        ) {
          indicesToDelete.push(i);
        }
      }

      if (indicesToDelete.length > 0) {
        indicesToDelete.sort((a, b) => b - a);
        const requests = indicesToDelete.map((idx) => ({
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS" as const,
              startIndex: idx,
              endIndex: idx + 1,
            },
          },
        }));
        await client.spreadsheets.batchUpdate({
          spreadsheetId: env.GOOGLE_SHEET_ID_MASTER,
          requestBody: { requests },
        });
        logger.info(
          { transactionId, deletedCount: indicesToDelete.length },
          "Deleted transaction from Master Dashboard"
        );
      }
    } catch (err: any) {
      logger.warn({ err: err?.message || err }, "Failed deleting transaction from Master Dashboard");
    }
  }

  /**
   * Updates matching transaction row in Master Dashboard (02_SEMUA_TRANSAKSI)
   */
  async updateMasterTransactionRow(
    transactionId: string,
    updates: { total_amount?: number; supplier_name?: string; notes?: string }
  ): Promise<void> {
    if (!env.GOOGLE_SHEET_ID_MASTER) return;
    try {
      const client = await this.getClient();
      const res = await client.spreadsheets.values.get({
        spreadsheetId: env.GOOGLE_SHEET_ID_MASTER,
        range: `'${MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL}'!A:J`,
      }).catch(() => ({ data: { values: null } }));
      const rows = res.data?.values || [];
      const cleanTxId = transactionId.trim().toLowerCase();

      for (let i = 1; i < rows.length; i++) {
        const rowId = String(rows[i]?.[0] || "").trim().toLowerCase();
        const rowRef = String(rows[i]?.[4] || "").trim().toLowerCase();
        if (
          rowId === cleanTxId ||
          rowId.includes(cleanTxId) ||
          cleanTxId.includes(rowId) ||
          (cleanTxId && (rowRef === cleanTxId || rowRef.includes(cleanTxId)))
        ) {
          const rowNum = i + 1;
          const updateData: Array<{ range: string; values: any[][] }> = [];
          if (updates.supplier_name) {
            updateData.push({
              range: `'${MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL}'!F${rowNum}`,
              values: [[updates.supplier_name]],
            });
          }
          if (updates.notes) {
            updateData.push({
              range: `'${MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL}'!G${rowNum}`,
              values: [[updates.notes]],
            });
          }
          if (updates.total_amount !== undefined) {
            updateData.push({
              range: `'${MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL}'!H${rowNum}`,
              values: [[updates.total_amount]],
            });
          }
          if (updateData.length > 0) {
            await client.spreadsheets.values.batchUpdate({
              spreadsheetId: env.GOOGLE_SHEET_ID_MASTER,
              requestBody: {
                valueInputOption: "USER_ENTERED",
                data: updateData,
              },
            });
            logger.info({ transactionId, rowNum }, "Updated transaction in Master Dashboard");
          }
          break;
        }
      }
    } catch (err: any) {
      logger.warn({ err: err?.message || err }, "Failed updating transaction in Master Dashboard");
    }
  }

  /**
   * Pulls existing transactions from operational sheets and synchronizes them to Master Dashboard
   */
  async syncAllUnitsToMaster(forceReset = false): Promise<{ syncedCount: number }> {
    if (!env.GOOGLE_SHEET_ID_MASTER) return { syncedCount: 0 };
    await this.ensureMasterDashboardStructure(env.GOOGLE_SHEET_ID_MASTER, forceReset);

    const client = await this.getClient();

    if (forceReset) {
      await client.spreadsheets.values.clear({
        spreadsheetId: env.GOOGLE_SHEET_ID_MASTER,
        range: `'${MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL}'!A2:K`,
      }).catch(() => {});
    }

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
        // Read income (try 02_PAGU_RINGKASAN first, then legacy 02_PENDAPATAN_SPPG)
        let incRes = await client.spreadsheets.values
          .get({
            spreadsheetId: unit.id,
            range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A2:J`,
          })
          .catch(() => ({ data: { values: null } }));

        if (!incRes.data.values || incRes.data.values.length === 0) {
          incRes = await client.spreadsheets.values
            .get({
              spreadsheetId: unit.id,
              range: "'02_PENDAPATAN_SPPG'!A2:L",
            })
            .catch(() => ({ data: { values: null } }));
        }

        for (const r of incRes.data?.values || []) {
          const isModern = String(r[1] || "").startsWith("SPPG");
          const trxId = isModern ? r[1] : r[0];
          const trxDate = isModern ? r[2] : r[1];
          const noSppg = isModern ? r[0] : r[2];
          if (!trxId || existingIds.has(trxId)) continue;
          newRows.push([
            trxId,
            trxDate,
            unit.name,
            "PENDAPATAN",
            noSppg || "-",
            "Pemerintah / BGN",
            r[3] ? `Pagu Pesanan (${r[3]})` : "Pagu Anggaran SPPG",
            r[5] || r[8] || 0,
            r[6] || "-",
            r[8] || r[10] || "Admin SPPG",
            "LENGKAP",
          ]);
          existingIds.add(trxId);
        }

        // Read expense (try 04_PENGELUARAN_SUPPLIER first, then legacy 03_PENGELUARAN_SUPPLIER)
        let expRes = await client.spreadsheets.values
          .get({
            spreadsheetId: unit.id,
            range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A2:J`,
          })
          .catch(() => ({ data: { values: null } }));

        if (!expRes.data.values || expRes.data.values.length === 0) {
          expRes = await client.spreadsheets.values
            .get({
              spreadsheetId: unit.id,
              range: "'03_PENGELUARAN_SUPPLIER'!A2:L",
            })
            .catch(() => ({ data: { values: null } }));
        }

        for (const r of expRes.data?.values || []) {
          const isModern = String(r[1] || "").startsWith("SPPG");
          const trxId = isModern ? r[1] : r[0];
          const trxDate = isModern ? r[2] : r[1];
          const sppgRef = isModern ? r[0] : r[2];
          if (!trxId || existingIds.has(trxId)) continue;
          newRows.push([
            trxId,
            trxDate,
            unit.name,
            "PENGELUARAN",
            sppgRef || "-",
            r[3] || "-",
            r[9] || r[4] || "Belanja Bahan Dapur",
            r[5] || r[8] || 0,
            r[7] || r[9] || "-",
            r[8] || r[10] || "PIC Dapur",
            "LUNAS",
          ]);
          existingIds.add(trxId);
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
   * Records official SPPG Order (Pagu Anggaran) across 02_PAGU_RINGKASAN, 03_PAGU_RINCIAN, and 05_REKAP_MARGIN
   */
  async recordSppgOrder(
    spreadsheetId: string,
    order: SppgOrder,
    driveLink?: string,
    rawCaption?: string,
    picName?: string
  ): Promise<void> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();

    const unitCode = this.getUnitCodeFromSpreadsheetId(spreadsheetId);

    // Count existing rows in 02_PAGU_RINGKASAN for ID generation
    const colA = await client.spreadsheets.values
      .get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A:A`,
      })
      .catch(() => ({ data: { values: null } }));
    const existingCount = (colA.data?.values || []).length;
    const counter = Math.max(existingCount, 1);
    const orderId = this.generateTransactionId(unitCode, order.order_date, counter, "income");

    const uniqueSuppliers = new Set(order.items.map((i) => i.supplier_target).filter(Boolean));
    const supplierCountStr = `${uniqueSuppliers.size || 1} Supplier`;
    const driveLinkFormula = driveLink ? `=HYPERLINK("${driveLink}"; "Lihat Dokumen")` : "-";
    const ringkasanRowIdx = Math.max(existingCount + 1, 2);

    // 1. Row for 02_PAGU_RINGKASAN (formula-driven for instant reactivity)
    const ringkasanRow = [
      order.order_no,                                             // A: No SPPG
      orderId,                                                    // B: ID Transaksi
      order.order_date,                                           // C: Tanggal Pesanan
      `=COUNTIF('03_PAGU_RINCIAN'!$A:$A; A${ringkasanRowIdx}) & " Item"`, // D: Jumlah Item Bahan
      supplierCountStr,                                           // E: Jumlah Target Supplier
      `=SUMIF('03_PAGU_RINCIAN'!$A:$A; A${ringkasanRowIdx}; '03_PAGU_RINCIAN'!$I:$I)`, // F: Total Pagu Anggaran
      driveLinkFormula,                                           // G: Link Bukti Dokumen
      rawCaption || order.notes || "-",                           // H: Pesan Asli Telegram
      order.signed_by || picName || "Kepala SPPG",               // I: PIC / Penanggung Jawab
      "-",                                                        // J: Riwayat Edit
    ];

    // Query 03_PAGU_RINCIAN count for row index calculation
    const rincianColA = await client.spreadsheets.values
      .get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_RINCIAN}'!A:A`,
      })
      .catch(() => ({ data: { values: null } }));
    const rincianExistingCount = (rincianColA.data?.values || []).length;
    const rincianStartRow = Math.max(rincianExistingCount + 1, 2);

    // 2. Rows for 03_PAGU_RINCIAN (all items with formula on Col I)
    const rincianRows = order.items.map((item, idx) => {
      const r = rincianStartRow + idx;
      return [
        order.order_no,                                           // A: No SPPG Ref
        orderId,                                                  // B: ID Ref
        idx + 1,                                                  // C: No Urut
        item.supplier_target || "Lainnya",                        // D: Target Supplier
        item.item_name,                                           // E: Uraian Bahan
        item.qty,                                                 // F: Kuantitas
        item.unit,                                                // G: Satuan
        item.price,                                               // H: Harga Pagu Satuan
        `=IF(OR(F${r}=""; H${r}=""); ""; F${r} * H${r})`,        // I: Total Pagu
        (item as any).specifications || item.category || "-",     // J: Keterangan / Spesifikasi
      ];
    });

    // 3. Rows for 05_REKAP_MARGIN (Template awal pencocokan dengan status MENUNGGU INVOICE)
    const rekapColA = await client.spreadsheets.values
      .get({
        spreadsheetId,
        range: `'${SHEET_NAMES.REKAP_MARGIN}'!A:A`,
      })
      .catch(() => ({ data: { values: null } }));
    const rekapExistingCount = (rekapColA.data?.values || []).length;
    const rekapStartRow = Math.max(rekapExistingCount + 1, 2);

    const rekapRows = order.items.map((item, idx) => {
      const r = rekapStartRow + idx;
      return [
        order.order_no,                                           // A: No SPPG Ref
        order.order_date,                                         // B: Tanggal
        item.supplier_target || "Lainnya",                        // C: Nama Supplier
        item.item_name,                                           // D: Uraian Bahan
        item.qty,                                                 // E: Kuantitas
        item.unit,                                                // F: Satuan
        item.price,                                               // G: Harga Pagu
        `=IF(OR(E${r}=""; G${r}=""); ""; E${r} * G${r})`,         // H: Total Pagu
        "",                                                       // I: Harga Invoice
        "",                                                       // J: Total Realisasi
        `=IF(J${r}=""; ""; H${r}-J${r})`,                         // K: Margin Bersih (Rp)
        `=IF(OR(H${r}=""; J${r}=""); ""; IFERROR(K${r}/H${r}; 0))`, // L: % Margin
        `=IF(J${r}=""; "🟡 MENUNGGU INVOICE"; IF(K${r}>0; "🟢 HEMAT"; IF(K${r}=0; "🟢 PAS"; "🔴 OVER BUDGET")))`, // M: Status
      ];
    });

    // Write to all 3 tabs
    await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PAGU_RINGKASAN, [ringkasanRow]);
    await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PAGU_RINCIAN, rincianRows);
    await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.REKAP_MARGIN, rekapRows);

    // Forward to Master Dashboard if different spreadsheet
    if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
      const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
      const masterRow = [
        orderId,
        order.order_date,
        unitName,
        "PENDAPATAN",
        order.order_no,
        "Pemerintah / BGN",
        `Pagu Anggaran (${order.items.length} Item Bahan)`,
        order.total_amount,
        driveLinkFormula,
        order.signed_by || picName || "Admin SPPG",
        "LENGKAP",
      ];
      await this.recordToMasterConsolidated([masterRow]).catch((err) => {
        logger.warn({ err: err?.message || err }, "Failed forwarding order to Master Dashboard");
      });
    }
  }

  /**
   * Records Supplier Expense Receipt (Pengeluaran Riil) in 04_PENGELUARAN_SUPPLIER
   * and automatically matches item prices in 05_REKAP_MARGIN
   */
  async recordSupplierExpense(
    spreadsheetId: string,
    receipt: SupplierReceipt,
    driveLink: string,
    picName: string,
    rawCaption?: string
  ): Promise<void> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();

    const unitCode = this.getUnitCodeFromSpreadsheetId(spreadsheetId);
    const nowIso = new Date().toISOString().split("T")[0];
    const dateStr = receipt.date || nowIso;

    // Count existing rows in 04_PENGELUARAN_SUPPLIER for ID generation
    const colA = await client.spreadsheets.values
      .get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A:A`,
      })
      .catch(() => ({ data: { values: null } }));
    const existingCount = (colA.data?.values || []).length;
    const counter = Math.max(existingCount, 1);
    const expenseId = this.generateTransactionId(unitCode, dateStr, counter, "expense");

    const itemsSummary =
      receipt.items && receipt.items.length > 0
        ? receipt.items.map((i) => `${i.item_name} (${i.qty} ${i.unit})`).join(", ")
        : "Belanja Bahan Dapur";
    const driveLinkFormula = driveLink ? `=HYPERLINK("${driveLink}"; "Lihat Nota")` : "-";

    // 1. Write to 04_PENGELUARAN_SUPPLIER
    const expenseRow = [
      receipt.sppg_ref_no || "-",                                 // A: No SPPG Ref
      expenseId,                                                  // B: ID Transaksi
      dateStr,                                                    // C: Tanggal Transaksi
      receipt.supplier_name,                                      // D: Nama Supplier
      (receipt as any).receipt_no || "-",                         // E: No Invoice Supplier
      receipt.total_amount,                                       // F: Total Nominal Tagihan
      receipt.payment_method || "Tunai",                          // G: Metode Pembayaran
      driveLinkFormula,                                           // H: Link Bukti Nota
      picName || "PIC Dapur",                                     // I: PIC / Operator
      receipt.notes || rawCaption || itemsSummary,                // J: Catatan / Keterangan
    ];

    await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PENGELUARAN_SUPPLIER, [expenseRow]);

    // 2. Automated Granular Matching & Partial Fulfillment Tracking in 05_REKAP_MARGIN
    try {
      const rekapRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.REKAP_MARGIN}'!A2:M`,
      });
      const rekapRows = rekapRes.data.values || [];
      const matchedRowIndices = new Set<number>();
      const batchUpdates: { range: string; values: any[][] }[] = [];
      const unmatchedReceiptItems: typeof receipt.items = [];

      if (receipt.items && receipt.items.length > 0) {
        for (const item of receipt.items) {
          const itemCleanName = item.item_name.toLowerCase().trim();
          let matched = false;

          for (let rIdx = 0; rIdx < rekapRows.length; rIdx++) {
            if (matchedRowIndices.has(rIdx)) continue;
            const row = rekapRows[rIdx];
            const rowSppgRef = String(row[0] || "").trim();
            const rowSupplier = String(row[2] || "").trim();
            const rowItemName = String(row[3] || "").toLowerCase().trim();
            const targetQty = parseCurrencyNumber(row[4]);
            const unit = String(row[5] || "").trim();
            const prevRealisasi = parseCurrencyNumber(row[9]);
            const statusStr = String(row[12] || "").trim();

            // Match condition: item names must be compatible
            const nameMatches =
              rowItemName.includes(itemCleanName) ||
              itemCleanName.includes(rowItemName);

            if (!nameMatches) continue;

            // SPPG Ref filter: if receipt specifies ref, it must match
            const sppgMatches =
              !receipt.sppg_ref_no ||
              receipt.sppg_ref_no === "-" ||
              rowSppgRef === receipt.sppg_ref_no;

            if (!sppgMatches) continue;

            // Check previous fulfillment
            let prevFulfilledQty = 0;
            const belumMatch = statusStr.match(/BELUM LENGKAP \((\d+(?:\.\d+)?)\//i);
            if (belumMatch) {
              prevFulfilledQty = parseFloat(belumMatch[1]) || 0;
            } else if (prevRealisasi > 0 && parseCurrencyNumber(row[8]) > 0) {
              prevFulfilledQty = Math.round(prevRealisasi / parseCurrencyNumber(row[8]));
            }

            // If already complete and targetQty > 0, don't overwrite unless user explicitly targeted this SPPG
            const isComplete =
              !belumMatch &&
              (statusStr.includes("HEMAT") || statusStr.includes("PAS") || statusStr.includes("OVER BUDGET")) &&
              targetQty > 0 &&
              prevFulfilledQty >= targetQty;

            if (isComplete && (!receipt.sppg_ref_no || receipt.sppg_ref_no === "-")) {
              continue;
            }

            const actualRow = rIdx + 2; // header is row 1
            const itemTotal = item.total_price || (item.qty * item.price);
            const newAccumulatedQty = prevFulfilledQty + (item.qty || 1);
            const newAccumulatedRealisasi = prevRealisasi + itemTotal;

            // Evaluate partial vs full fulfillment
            if (targetQty > 0 && newAccumulatedQty < targetQty) {
              const statusText = `🟠 BELUM LENGKAP (${newAccumulatedQty}/${targetQty} ${unit})`;
              batchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!I${actualRow}:J${actualRow}`,
                values: [[item.price, newAccumulatedRealisasi]],
              });
              batchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!M${actualRow}`,
                values: [[statusText]],
              });
            } else {
              const formulaStatus = `=IF(K${actualRow}>0; "🟢 HEMAT"; IF(K${actualRow}=0; "🟢 PAS"; "🔴 OVER BUDGET"))`;
              batchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!I${actualRow}:J${actualRow}`,
                values: [[item.price, newAccumulatedRealisasi]],
              });
              batchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!M${actualRow}`,
                values: [[formulaStatus]],
              });
            }

            // Track actual shop if different from contracted supplier
            if (receipt.supplier_name && receipt.supplier_name !== "-") {
              if (rowSupplier && !rowSupplier.toLowerCase().includes(receipt.supplier_name.toLowerCase())) {
                const combinedSupplier = `${rowSupplier} (${receipt.supplier_name})`;
                batchUpdates.push({
                  range: `'${SHEET_NAMES.REKAP_MARGIN}'!C${actualRow}`,
                  values: [[combinedSupplier]],
                });
              }
            }

            matchedRowIndices.add(rIdx);
            matched = true;
            break;
          }

          if (!matched) {
            unmatchedReceiptItems.push(item);
          }
        }
      }

      // Execute in-place cell updates for matched items
      if (batchUpdates.length > 0) {
        await client.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: batchUpdates,
          },
        });
        logger.info(
          { count: batchUpdates.length, supplier: receipt.supplier_name },
          "Matched and updated items in 05_REKAP_MARGIN"
        );
      }

      // If there are unmatched receipt items (e.g. extra items not in Pagu), append them
      if (unmatchedReceiptItems.length > 0) {
        const currentCount = rekapRows.length + 1; // row index for formulas
        const extraRows = unmatchedReceiptItems.map((item, idx) => {
          const r = currentCount + 1 + idx;
          const itemTotal = item.total_price || item.qty * item.price;
          return [
            receipt.sppg_ref_no || "-",
            dateStr,
            receipt.supplier_name,
            item.item_name,
            item.qty,
            item.unit,
            0, // Harga Pagu
            0, // Total Pagu
            item.price,
            itemTotal,
            `=IF(J${r}=""; ""; H${r}-J${r})`,
            `=IF(OR(H${r}=""; J${r}=""); ""; IFERROR(K${r}/H${r}; 0))`,
            `=IF(J${r}=""; "🟡 MENUNGGU INVOICE"; IF(K${r}>0; "🟢 HEMAT"; IF(K${r}=0; "🟢 PAS"; "🔴 OVER BUDGET")))`,
          ];
        });
        await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.REKAP_MARGIN, extraRows);
      }
    } catch (matchErr: any) {
      logger.warn({ err: matchErr?.message || matchErr }, "Note during 05_REKAP_MARGIN matching");
    }

    // Forward to Master Dashboard if different spreadsheet
    if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
      const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
      const masterRow = [
        expenseId,
        dateStr,
        unitName,
        "PENGELUARAN",
        receipt.sppg_ref_no || "-",
        receipt.supplier_name,
        itemsSummary,
        receipt.total_amount,
        driveLinkFormula,
        picName || "PIC Dapur",
        "LUNAS",
      ];
      await this.recordToMasterConsolidated([masterRow]).catch((err) => {
        logger.warn({ err: err?.message || err }, "Failed forwarding expense to Master Dashboard");
      });
    }
  }

  /**
   * Batch records multiple supplier receipts in minimal Google Sheets API calls
   * avoiding HTTP 429 rate limit errors when importing Excel files or multi-receipt batches.
   */
  async recordSupplierExpenseBatch(
    spreadsheetId: string,
    receipts: SupplierReceipt[],
    picName: string,
    rawCaption?: string
  ): Promise<{ recordedCount: number; totalAmount: number }> {
    if (!receipts || receipts.length === 0) {
      return { recordedCount: 0, totalAmount: 0 };
    }

    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();

    const unitCode = this.getUnitCodeFromSpreadsheetId(spreadsheetId);
    const nowIso = new Date().toISOString().split("T")[0];

    // 1. Read existing rows in 04_PENGELUARAN_SUPPLIER once to determine start counter
    const colA = await client.spreadsheets.values
      .get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A:A`,
      })
      .catch(() => ({ data: { values: null } }));
    let counter = Math.max((colA.data?.values || []).length, 1);

    const expenseRows: any[][] = [];
    const masterRows: any[][] = [];
    let grandTotalAmount = 0;

    for (const receipt of receipts) {
      const dateStr = receipt.date || nowIso;
      const expenseId = this.generateTransactionId(unitCode, dateStr, counter++, "expense");
      const itemsSummary =
        receipt.items && receipt.items.length > 0
          ? receipt.items.map((i) => `${i.item_name} (${i.qty} ${i.unit})`).join(", ")
          : "Belanja Bahan Dapur";
      const driveLink = (receipt as any).driveLink || "";
      const driveLinkFormula = driveLink ? `=HYPERLINK("${driveLink}"; "Lihat Nota")` : "-";

      expenseRows.push([
        receipt.sppg_ref_no || "-",
        expenseId,
        dateStr,
        receipt.supplier_name,
        (receipt as any).receipt_no || "-",
        receipt.total_amount,
        receipt.payment_method || "Tunai",
        driveLinkFormula,
        picName || "PIC Dapur",
        receipt.notes || rawCaption || itemsSummary,
      ]);

      grandTotalAmount += receipt.total_amount || 0;

      if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
        const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
        masterRows.push([
          expenseId,
          dateStr,
          unitName,
          "PENGELUARAN",
          receipt.sppg_ref_no || "-",
          receipt.supplier_name,
          itemsSummary,
          receipt.total_amount,
          driveLinkFormula,
          picName || "PIC Dapur",
          "LUNAS",
        ]);
      }
    }

    // Append all expense rows to Tab 04 in one single API call
    await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PENGELUARAN_SUPPLIER, expenseRows);

    // 2. Batch update matching in Tab 05 (05_REKAP_MARGIN)
    try {
      const rekapRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.REKAP_MARGIN}'!A2:M`,
      });
      const rekapRows = (rekapRes.data.values || []).map((row) => [...row]);
      const matchedRowIndices = new Set<number>();
      const batchUpdates: { range: string; values: any[][] }[] = [];
      const unmatchedReceiptItems: Array<{ item: any; receipt: SupplierReceipt }> = [];

      for (const receipt of receipts) {
        if (!receipt.items || receipt.items.length === 0) continue;

        for (const item of receipt.items) {
          const itemCleanName = item.item_name.toLowerCase().trim();
          let matched = false;

          for (let rIdx = 0; rIdx < rekapRows.length; rIdx++) {
            if (matchedRowIndices.has(rIdx)) continue;
            const row = rekapRows[rIdx];
            const rowSppgRef = String(row[0] || "").trim();
            const rowSupplier = String(row[2] || "").trim();
            const rowItemName = String(row[3] || "").toLowerCase().trim();
            const targetQty = parseCurrencyNumber(row[4]);
            const unit = String(row[5] || "").trim();
            const prevRealisasi = parseCurrencyNumber(row[9]);
            const statusStr = String(row[12] || "").trim();

            const nameMatches =
              rowItemName.includes(itemCleanName) || itemCleanName.includes(rowItemName);
            if (!nameMatches) continue;

            const sppgMatches =
              !receipt.sppg_ref_no ||
              receipt.sppg_ref_no === "-" ||
              rowSppgRef === receipt.sppg_ref_no;
            if (!sppgMatches) continue;

            let prevFulfilledQty = 0;
            const belumMatch = statusStr.match(/BELUM LENGKAP \((\d+(?:\.\d+)?)\//i);
            if (belumMatch) {
              prevFulfilledQty = parseFloat(belumMatch[1]) || 0;
            } else if (prevRealisasi > 0 && parseCurrencyNumber(row[8]) > 0) {
              prevFulfilledQty = Math.round(prevRealisasi / parseCurrencyNumber(row[8]));
            }

            const isComplete =
              !belumMatch &&
              (statusStr.includes("HEMAT") || statusStr.includes("PAS") || statusStr.includes("OVER BUDGET")) &&
              targetQty > 0 &&
              prevFulfilledQty >= targetQty;

            if (isComplete && (!receipt.sppg_ref_no || receipt.sppg_ref_no === "-")) {
              continue;
            }

            const actualRow = rIdx + 2;
            const itemTotal = item.total_price || (item.qty * item.price);
            const newAccumulatedQty = prevFulfilledQty + (item.qty || 1);
            const newAccumulatedRealisasi = prevRealisasi + itemTotal;

            if (targetQty > 0 && newAccumulatedQty < targetQty) {
              const statusText = `🟠 BELUM LENGKAP (${newAccumulatedQty}/${targetQty} ${unit})`;
              batchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!I${actualRow}:J${actualRow}`,
                values: [[item.price, newAccumulatedRealisasi]],
              });
              batchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!M${actualRow}`,
                values: [[statusText]],
              });
              row[12] = statusText;
            } else {
              const formulaStatus = `=IF(K${actualRow}>0; "🟢 HEMAT"; IF(K${actualRow}=0; "🟢 PAS"; "🔴 OVER BUDGET"))`;
              batchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!I${actualRow}:J${actualRow}`,
                values: [[item.price, newAccumulatedRealisasi]],
              });
              batchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!M${actualRow}`,
                values: [[formulaStatus]],
              });
              row[12] = "PAS";
            }

            row[8] = item.price;
            row[9] = newAccumulatedRealisasi;

            if (receipt.supplier_name && receipt.supplier_name !== "-") {
              if (rowSupplier && !rowSupplier.toLowerCase().includes(receipt.supplier_name.toLowerCase())) {
                const combinedSupplier = `${rowSupplier} (${receipt.supplier_name})`;
                batchUpdates.push({
                  range: `'${SHEET_NAMES.REKAP_MARGIN}'!C${actualRow}`,
                  values: [[combinedSupplier]],
                });
                row[2] = combinedSupplier;
              }
            }

            matchedRowIndices.add(rIdx);
            matched = true;
            break;
          }

          if (!matched) {
            unmatchedReceiptItems.push({ item, receipt });
          }
        }
      }

      if (batchUpdates.length > 0) {
        await client.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: batchUpdates,
          },
        });
        logger.info(
          { count: batchUpdates.length, receiptsCount: receipts.length },
          "Batch matched and updated items in 05_REKAP_MARGIN"
        );
      }

      if (unmatchedReceiptItems.length > 0) {
        const currentCount = rekapRows.length + 1;
        const extraRows = unmatchedReceiptItems.map(({ item, receipt }, idx) => {
          const r = currentCount + 1 + idx;
          const itemTotal = item.total_price || item.qty * item.price;
          const dateStr = receipt.date || nowIso;
          return [
            receipt.sppg_ref_no || "-",
            dateStr,
            receipt.supplier_name,
            item.item_name,
            item.qty,
            item.unit,
            0,
            0,
            item.price,
            itemTotal,
            `=IF(J${r}=""; ""; H${r}-J${r})`,
            `=IF(OR(H${r}=""; J${r}=""); ""; IFERROR(K${r}/H${r}; 0))`,
            `=IF(J${r}=""; "🟡 MENUNGGU INVOICE"; IF(K${r}>0; "🟢 HEMAT"; IF(K${r}=0; "🟢 PAS"; "🔴 OVER BUDGET")))`,
          ];
        });
        await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.REKAP_MARGIN, extraRows);
      }
    } catch (matchErr: any) {
      logger.warn({ err: matchErr?.message || matchErr }, "Note during batch 05_REKAP_MARGIN matching");
    }

    // 3. Forward all to Master Dashboard in one batch
    if (masterRows.length > 0) {
      await this.recordToMasterConsolidated(masterRows).catch((err) => {
        logger.warn({ err: err?.message || err }, "Failed batch forwarding expenses to Master Dashboard");
      });
    }

    return {
      recordedCount: receipts.length,
      totalAmount: grandTotalAmount,
    };
  }

  /**
   * Finds unfulfilled Pagu candidates for a given commodity/item name in 05_REKAP_MARGIN
   */
  async getPaguCandidatesForCommodity(
    spreadsheetId: string,
    itemName: string
  ): Promise<PaguCandidate[]> {
    if (!itemName) return [];
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();

    try {
      const res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.REKAP_MARGIN}'!A2:M`,
      });
      const rows = res.data?.values || [];
      const cleanItem = itemName.toLowerCase().replace(/[^a-z0-9]/g, "");
      const candidates: PaguCandidate[] = [];

      for (let rIdx = 0; rIdx < rows.length; rIdx++) {
        const row = rows[rIdx];
        if (!row || !row[3]) continue;
        const rowItem = String(row[3]).toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!rowItem.includes(cleanItem) && !cleanItem.includes(rowItem)) continue;

        const targetQty = parseCurrencyNumber(row[4]);
        const unit = String(row[5] || "").trim();
        const paguPrice = parseCurrencyNumber(row[6]);
        const paguTotal = parseCurrencyNumber(row[7]);
        const fulfilledTotal = parseCurrencyNumber(row[9]);
        const status = String(row[12] || "").trim();

        // Extract already fulfilled quantity
        let fulfilledQty = 0;
        const m = status.match(/BELUM LENGKAP \((\d+(?:\.\d+)?)\//i);
        if (m) {
          fulfilledQty = parseFloat(m[1]) || 0;
        } else if (status.includes("MENUNGGU INVOICE") || !fulfilledTotal) {
          fulfilledQty = 0;
        } else if (row[8] && parseCurrencyNumber(row[8]) > 0) {
          fulfilledQty = Math.round(fulfilledTotal / parseCurrencyNumber(row[8]));
        }

        const remainingQty = targetQty > 0 ? Math.max(0, targetQty - fulfilledQty) : 0;
        const isAlreadyComplete =
          (status.includes("HEMAT") || status.includes("PAS") || status.includes("OVER BUDGET")) &&
          !m &&
          targetQty > 0 &&
          fulfilledQty >= targetQty;

        if (!isAlreadyComplete) {
          candidates.push({
            rowIndex: rIdx + 2,
            sppg_ref_no: String(row[0] || "").trim(),
            order_date: String(row[1] || "").trim(),
            supplier_name: String(row[2] || "").trim(),
            item_name: String(row[3] || "").trim(),
            target_qty: targetQty,
            unit,
            pagu_price: paguPrice,
            pagu_total: paguTotal,
            fulfilled_qty: fulfilledQty,
            fulfilled_total: fulfilledTotal,
            remaining_qty: remainingQty,
            status,
          });
        }
      }

      return candidates;
    } catch (err: any) {
      logger.warn({ err: err?.message || err }, "Error searching Pagu candidates in 05_REKAP_MARGIN");
      return [];
    }
  }

  /**
   * Retrieves live executive KPI summary calculated from operational tabs
   */
  async getExecutiveKpi(spreadsheetId: string, orderNo?: string): Promise<{
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

      const isFilterByOrder = !!(orderNo && orderNo !== "REKAP-BULANAN");
      const targetOrder = isFilterByOrder ? orderNo!.trim().toLowerCase() : "";

      // 1. Read Pagu from 02_PAGU_RINGKASAN (Col A to F) or fallback 02_PENDAPATAN_SPPG
      let incomeRes = await client.spreadsheets.values
        .get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A2:F`,
        })
        .catch(() => ({ data: { values: null } }));

      let isLegacyIncome = false;
      if (!incomeRes.data.values || incomeRes.data.values.length === 0) {
        isLegacyIncome = true;
        incomeRes = await client.spreadsheets.values
          .get({
            spreadsheetId,
            range: "'02_PENDAPATAN_SPPG'!A2:I",
          })
          .catch(() => ({ data: { values: null } }));
      }
      const incomeValues = incomeRes.data?.values || [];
      const totalPlafon = incomeValues.reduce((sum, row) => {
        if (!row || !row[0]) return sum;
        if (isFilterByOrder) {
          const rowOrder = String(row[0] || "").trim().toLowerCase();
          if (rowOrder !== targetOrder) return sum;
        }
        const val = isLegacyIncome ? row[8] : row[5];
        return sum + parseAmount(val);
      }, 0);

      // 2. Read Belanja from 04_PENGELUARAN_SUPPLIER (Col A to F) or fallback 03_PENGELUARAN_SUPPLIER
      let expenseRes = await client.spreadsheets.values
        .get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A2:F`,
        })
        .catch(() => ({ data: { values: null } }));

      let isLegacyExpense = false;
      if (!expenseRes.data.values || expenseRes.data.values.length === 0) {
        isLegacyExpense = true;
        expenseRes = await client.spreadsheets.values
          .get({
            spreadsheetId,
            range: "'03_PENGELUARAN_SUPPLIER'!A2:I",
          })
          .catch(() => ({ data: { values: null } }));
      }
      const expenseValues = expenseRes.data?.values || [];
      const totalBelanja = expenseValues.reduce((sum, row) => {
        if (!row || !row[0]) return sum;
        if (isFilterByOrder) {
          const rowOrder = String(row[0] || "").trim().toLowerCase();
          if (rowOrder !== targetOrder) return sum;
        }
        const val = isLegacyExpense ? row[8] : row[5];
        return sum + parseAmount(val);
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
   * Retrieves all expense items formatted for official SPJ PDF report
   */
  async getExpensesForReport(
    spreadsheetId: string,
    orderNo?: string
  ): Promise<Array<{ date: string; supplier: string; items: string; amount: number }>> {
    const client = await this.getClient();
    const results: Array<{ date: string; supplier: string; items: string; amount: number }> = [];

    const parseAmount = (val: any): number => {
      if (typeof val === "number") return val;
      const clean = String(val || "").replace(/[^\d,.-]/g, "").trim();
      const normalized = clean.replace(/\./g, "").replace(/,/g, ".");
      const num = parseFloat(normalized);
      return isNaN(num) ? 0 : num;
    };

    const isFilterByOrder = !!(orderNo && orderNo !== "REKAP-BULANAN");
    const targetOrder = isFilterByOrder ? orderNo!.trim().toLowerCase() : "";

    try {
      // 1. Fetch from 04_PENGELUARAN_SUPPLIER
      let expRes = await client.spreadsheets.values
        .get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A2:J`,
        })
        .catch(() => ({ data: { values: null } }));

      let isModern = true;
      if (!expRes.data.values || expRes.data.values.length === 0) {
        isModern = false;
        expRes = await client.spreadsheets.values
          .get({
            spreadsheetId,
            range: "'03_PENGELUARAN_SUPPLIER'!A2:L",
          })
          .catch(() => ({ data: { values: null } }));
      }

      const rows = expRes.data?.values || [];
      for (const row of rows) {
        if (!row || (!row[0] && !row[1])) continue;

        if (isModern) {
          // Tab 04:
          // Col A: No SPPG Ref (0)
          // Col B: ID Transaksi (1)
          // Col C: Tanggal Transaksi (2)
          // Col D: Nama Supplier (3)
          // Col E: No Invoice Supplier (4)
          // Col F: Total Nominal Tagihan (5)
          // Col G: Metode Pembayaran (6)
          // Col H: Link Bukti Nota (7)
          // Col I: PIC / Operator (8)
          // Col J: Catatan / Keterangan (9)
          if (isFilterByOrder) {
            const rowOrder = String(row[0] || "").trim().toLowerCase();
            if (rowOrder !== targetOrder) continue;
          }

          const date = String(row[2] || "-").trim();
          const supplier = String(row[3] || "Supplier").trim();
          const items = String(row[9] || row[4] || "Belanja Bahan Makanan").trim();
          const amount = parseAmount(row[5]);

          if (amount > 0 || supplier) {
            results.push({ date, supplier, items, amount });
          }
        } else {
          // Legacy Tab 03:
          // Col A: ID (0), Col B: Tanggal (1), Col D: Supplier (3), Col E: Detail (4), Col I: Nominal (8)
          const date = String(row[1] || "-").trim();
          const supplier = String(row[3] || "Supplier").trim();
          const items = String(row[4] || "Belanja Bahan Makanan").trim();
          const amount = parseAmount(row[8]);

          if (amount > 0 || supplier) {
            results.push({ date, supplier, items, amount });
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, "Error fetching expenses for report");
    }

    return results;
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
      // 1. Fetch expenses from 04_PENGELUARAN_SUPPLIER or fallback 03_PENGELUARAN_SUPPLIER
      let expRes = await client.spreadsheets.values
        .get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A2:J`,
        })
        .catch(() => ({ data: { values: null } }));

      let isNewExpenseTab = true;
      if (!expRes.data.values || expRes.data.values.length === 0) {
        isNewExpenseTab = false;
        expRes = await client.spreadsheets.values
          .get({
            spreadsheetId,
            range: "'03_PENGELUARAN_SUPPLIER'!A2:L",
          })
          .catch(() => ({ data: { values: null } }));
      }

      const expRows = expRes.data?.values || [];
      for (let i = expRows.length - 1; i >= 0 && results.length < limit; i--) {
        const row = expRows[i];
        if (row && (row[0] || row[1])) {
          const isModern = isNewExpenseTab && String(row[1] || "").startsWith("SPPG");
          const trxId = isModern ? String(row[1]) : String(row[0]);
          const trxDate = isModern ? String(row[2] || "-") : String(row[1] || "-");
          const amount = isNewExpenseTab
            ? parseCurrencyNumber(row[5])
            : parseCurrencyNumber(row[8]);
          results.push({
            id: trxId,
            date: trxDate,
            type: "expense",
            title: String(row[3] || "Supplier"),
            amount,
            detail: isNewExpenseTab ? String(row[9] || (isModern ? row[0] : row[2]) || "-") : String(row[4] || "-"),
            link: isNewExpenseTab ? String(row[7] || "") : String(row[9] || ""),
          });
        }
      }

      // 2. Fetch orders from 02_PAGU_RINGKASAN or fallback 02_PENDAPATAN_SPPG
      let orderRes = await client.spreadsheets.values
        .get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A2:J`,
        })
        .catch(() => ({ data: { values: null } }));

      let isNewOrderTab = true;
      if (!orderRes.data.values || orderRes.data.values.length === 0) {
        isNewOrderTab = false;
        orderRes = await client.spreadsheets.values
          .get({
            spreadsheetId,
            range: "'02_PENDAPATAN_SPPG'!A2:L",
          })
          .catch(() => ({ data: { values: null } }));
      }

      const orderRows = orderRes.data?.values || [];
      for (let i = orderRows.length - 1; i >= 0 && results.length < limit * 2; i--) {
        const row = orderRows[i];
        if (row && (row[0] || row[1])) {
          const isModern = isNewOrderTab && String(row[1] || "").startsWith("SPPG");
          const trxId = isModern ? String(row[1]) : String(row[0]);
          const trxDate = isModern ? String(row[2] || "-") : String(row[1] || "-");
          const noSppg = isModern ? String(row[0] || "") : String(row[2] || "");
          const amount = isNewOrderTab
            ? parseCurrencyNumber(row[5])
            : parseCurrencyNumber(row[8]);
          results.push({
            id: trxId,
            date: trxDate,
            type: "income",
            title: isNewOrderTab ? `Nota SPPG ${noSppg}` : `Nota SPPG ${row[3] || ""}`,
            amount,
            detail: isNewOrderTab ? String(row[3] || "Pagu Anggaran") : String(row[4] || "-"),
            link: isNewOrderTab ? String(row[6] || "") : undefined,
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
    orderNo?: string;
    isProtected?: boolean;
  }> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();
    const cleanId = transactionId.trim().toUpperCase();

    // Helper: matches full ID, suffix ID (e.g. EI002 -> SPPG0126-EI002), or clean ID
    const matchesId = (candidate: string): boolean => {
      const c = candidate.trim().toUpperCase();
      if (!c) return false;
      return (
        c === cleanId ||
        c.endsWith(`-${cleanId}`) ||
        c.endsWith(`_${cleanId}`) ||
        (cleanId.length >= 4 && c.includes(cleanId))
      );
    };

    // 1. Search in 04_PENGELUARAN_SUPPLIER (new)
    try {
      const expRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A:J`,
      });
      const expRows = expRes.data.values || [];
      for (let idx = 0; idx < expRows.length; idx++) {
        const row = expRows[idx];
        const col0 = String(row?.[0] || "");
        const col1 = String(row?.[1] || "");
        if (matchesId(col0) || matchesId(col1)) {
          const isModern = col1.toUpperCase().startsWith("SPPG");
          const trxId = isModern ? (col1 || cleanId) : (col0 || cleanId);
          const trxDate = isModern ? String(row[2] || "-") : String(row[1] || "-");
          const amount = parseCurrencyNumber(row[5]);
          return {
            found: true,
            id: trxId,
            sheetName: SHEET_NAMES.PENGELUARAN_SUPPLIER,
            rowIndex: idx + 1,
            type: "expense",
            date: trxDate,
            supplierOrUnit: String(row[3] || "Supplier"),
            items: String(row[9] || "Belanja Bahan Dapur"),
            amount,
            orderNo: col0.trim(),
            isProtected: false,
            link: String(row[7] || ""),
            notes: String(row[9] || "-"),
          };
        }
      }
    } catch (err) {
      // continue to legacy search
    }

    // 2. Search in legacy 03_PENGELUARAN_SUPPLIER
    try {
      const expRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'03_PENGELUARAN_SUPPLIER'!A:L",
      });
      const expRows = expRes.data.values || [];
      for (let idx = 0; idx < expRows.length; idx++) {
        const row = expRows[idx];
        if (row && row[0] && matchesId(String(row[0]))) {
          const amount = parseCurrencyNumber(row[8]);
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
            orderNo: String(row[0] || "").trim(),
            isProtected: false,
            link: String(row[9] || ""),
            notes: String(row[11] || "-"),
          };
        }
      }
    } catch (err) {
      logger.warn({ err }, "Error searching in 03_PENGELUARAN_SUPPLIER");
    }

    // 3. Search in 02_PAGU_RINGKASAN (new)
    try {
      const ordRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A:J`,
      });
      const ordRows = ordRes.data.values || [];
      for (let idx = 0; idx < ordRows.length; idx++) {
        const row = ordRows[idx];
        const col0 = String(row?.[0] || "");
        const col1 = String(row?.[1] || "");
        if (matchesId(col0) || matchesId(col1)) {
          const isModern = col1.toUpperCase().startsWith("SPPG");
          const trxId = isModern ? (col1 || cleanId) : (col0 || cleanId);
          const trxDate = isModern ? String(row[2] || "-") : String(row[1] || "-");
          const amount = parseCurrencyNumber(row[5]);
          return {
            found: true,
            id: trxId,
            sheetName: SHEET_NAMES.PAGU_RINGKASAN,
            rowIndex: idx + 1,
            type: "income",
            date: trxDate,
            supplierOrUnit: "Badan Gizi Nasional",
            items: String(row[3] || "Pagu Anggaran"),
            amount,
            orderNo: col0.trim(),
            isProtected: false,
            link: String(row[6] || ""),
            notes: String(row[7] || "-"),
          };
        }
      }
    } catch (err) {
      // continue to legacy search
    }

    // 4. Search in 03_PAGU_RINCIAN (protected child items)
    try {
      const rincianRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_RINCIAN}'!A:J`,
      });
      const rincianRows = rincianRes.data.values || [];
      for (let idx = 0; idx < rincianRows.length; idx++) {
        const row = rincianRows[idx];
        const col0 = String(row?.[0] || "");
        const col1 = String(row?.[1] || "");
        if (matchesId(col1) || (cleanId.length >= 4 && matchesId(col0))) {
          return {
            found: true,
            id: col1 || cleanId,
            sheetName: SHEET_NAMES.PAGU_RINCIAN,
            rowIndex: idx + 1,
            type: "income",
            date: "-",
            supplierOrUnit: String(row[3] || "Target Supplier"),
            items: String(row[4] || "Rincian Bahan"),
            amount: parseCurrencyNumber(row[8]),
            orderNo: col0.trim(),
            isProtected: true,
            notes: `Rincian Pagu Item #${row[2] || idx + 1}`,
          };
        }
      }
    } catch (err) {
      // continue
    }

    // 5. Search in legacy 02_PENDAPATAN_SPPG
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
            orderNo: String(row[0] || "").trim(),
            isProtected: false,
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
   * Generates a preview of what will be affected if a transaction is deleted (Cascading Check)
   */
  async getCascadeDeletePreview(
    spreadsheetId: string,
    transactionId: string
  ): Promise<{
    found: boolean;
    canDelete: boolean;
    sheetName?: string;
    isProtected?: boolean;
    orderNo?: string;
    transactionId?: string;
    amount?: number;
    supplierOrUnit?: string;
    items?: string;
    childrenSummary?: {
      rincianCount: number;
      expenseCount: number;
      rekapCount: number;
      resetRekapCount: number;
    };
    warningMessage?: string;
  }> {
    const detail = await this.getTransactionDetail(spreadsheetId, transactionId);
    if (!detail.found || !detail.sheetName || !detail.rowIndex) {
      return { found: false, canDelete: false };
    }

    if (detail.sheetName === SHEET_NAMES.PAGU_RINCIAN || detail.isProtected) {
      return {
        found: true,
        canDelete: false,
        isProtected: true,
        sheetName: detail.sheetName,
        orderNo: detail.orderNo,
        transactionId: detail.id,
        amount: detail.amount,
        items: detail.items,
        warningMessage: `⛔ Data Terproteksi: Rincian Pagu (Tab 03) adalah data turunan dan terikat langsung dengan Pagu Induk di Tab 02. Rincian tidak dapat dihapus mandiri. Silakan kelola melalui Pagu Induk (${detail.orderNo || "Tab 02"}).`,
      };
    }

    const client = await this.getClient();

    // 1. Pagu Induk (Tab 02) -> Cascade delete children in 03, 04, 05
    if (detail.sheetName === SHEET_NAMES.PAGU_RINGKASAN || detail.sheetName === "02_PENDAPATAN_SPPG") {
      const orderNo = detail.orderNo || "";
      const orderId = detail.id;

      let rincianCount = 0;
      let expenseCount = 0;
      let rekapCount = 0;

      // Check Tab 03
      try {
        const rRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PAGU_RINCIAN}'!A:B`,
        });
        const rows = rRes.data.values || [];
        rincianCount = rows.filter((r) => {
          const c0 = String(r[0] || "").trim();
          const c1 = String(r[1] || "").trim();
          return (orderNo && c0 === orderNo) || (orderId && c1 === orderId);
        }).length;
      } catch {}

      // Check Tab 04
      try {
        const eRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A:B`,
        });
        const rows = eRes.data.values || [];
        expenseCount = rows.filter((r) => {
          const c0 = String(r[0] || "").trim();
          const c1 = String(r[1] || "").trim();
          return (orderNo && c0 === orderNo) || (orderId && c1 === orderId);
        }).length;
      } catch {}

      // Check Tab 05
      try {
        const mRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.REKAP_MARGIN}'!A:A`,
        });
        const rows = mRes.data.values || [];
        rekapCount = rows.filter((r) => {
          const c0 = String(r[0] || "").trim();
          return orderNo && c0 === orderNo;
        }).length;
      } catch {}

      return {
        found: true,
        canDelete: true,
        isProtected: false,
        sheetName: detail.sheetName,
        orderNo,
        transactionId: detail.id,
        amount: detail.amount,
        items: detail.items,
        childrenSummary: {
          rincianCount,
          expenseCount,
          rekapCount,
          resetRekapCount: 0,
        },
        warningMessage: `⚠️ Menghapus Pagu Induk ini akan MENGHAPUS SEMUA data turunannya:\n• Tab 03 (Rincian Bahan): ${rincianCount} item\n• Tab 04 (Pengeluaran Supplier): ${expenseCount} transaksi nota\n• Tab 05 (Rekap Margin): ${rekapCount} baris komparasi`,
      };
    }

    // 2. Pengeluaran Supplier (Tab 04) -> Cascade reset in 05
    if (
      detail.sheetName === SHEET_NAMES.PENGELUARAN_SUPPLIER ||
      detail.sheetName === "03_PENGELUARAN_SUPPLIER"
    ) {
      const orderNo = detail.orderNo || "";
      const supplierName = detail.supplierOrUnit || "";

      let resetRekapCount = 0;
      let deletedRekapCount = 0;

      try {
        const mRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.REKAP_MARGIN}'!A:J`,
        });
        const rows = mRes.data.values || [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const rowSppg = String(r[0] || "").trim();
          const rowSupplier = String(r[2] || "").trim().toLowerCase();
          const sName = supplierName.toLowerCase();
          const matches =
            (!orderNo || orderNo === "-" || rowSppg === orderNo) &&
            (sName && (rowSupplier.includes(sName) || sName.includes(rowSupplier)));

          if (matches) {
            const paguTotal = parseCurrencyNumber(r[7]);
            if (paguTotal > 0) {
              resetRekapCount++;
            } else {
              deletedRekapCount++;
            }
          }
        }
      } catch {}

      return {
        found: true,
        canDelete: true,
        isProtected: false,
        sheetName: detail.sheetName,
        orderNo,
        transactionId: detail.id,
        amount: detail.amount,
        supplierOrUnit: supplierName,
        items: detail.items,
        childrenSummary: {
          rincianCount: 0,
          expenseCount: 0,
          rekapCount: deletedRekapCount,
          resetRekapCount,
        },
        warningMessage: `ℹ️ Menghapus nota ini akan mengosongkan/mereset realisasi di Tab 05 (Rekap Margin) sebanyak ${resetRekapCount} item kembali ke status 'Menunggu Invoice'${deletedRekapCount > 0 ? ` dan menghapus ${deletedRekapCount} item belanja tambahan` : ""}.`,
      };
    }

    return {
      found: true,
      canDelete: true,
      isProtected: false,
      sheetName: detail.sheetName,
      transactionId: detail.id,
      amount: detail.amount,
      supplierOrUnit: detail.supplierOrUnit,
      items: detail.items,
    };
  }

  /**
   * Deletes a transaction row from Google Sheets with strict cascading integrity rules:
   * 1. 02_PAGU_RINGKASAN: Cascade delete in 03, 04, and 05 (Order No match).
   * 2. 03_PAGU_RINCIAN: Protected! Cannot be deleted independently.
   * 3. 04_PENGELUARAN_SUPPLIER: Deletes row in 04, and resets/clears realization cells in 05.
   * 4. 05_REKAP_MARGIN: Deletes row independently.
   */
  async deleteTransactionRow(
    spreadsheetId: string,
    transactionId: string
  ): Promise<{
    success: boolean;
    message: string;
    isProtected?: boolean;
    deletedSummary?: {
      paguRows: number;
      rincianRows: number;
      expenseRows: number;
      rekapRows: number;
      resetRekapRows: number;
    };
  }> {
    const detail = await this.getTransactionDetail(spreadsheetId, transactionId);
    if (!detail.found || !detail.sheetName || !detail.rowIndex) {
      return { success: false, message: `Transaksi ${transactionId} tidak ditemukan di Google Sheets.` };
    }

    // Guard: 03_PAGU_RINCIAN is protected from standalone deletion
    if (detail.sheetName === SHEET_NAMES.PAGU_RINCIAN || detail.isProtected) {
      return {
        success: false,
        isProtected: true,
        message: `⛔ Rincian Pagu (Tab 03) adalah data turunan dan terproteksi. Data ini tidak dapat dihapus mandiri karena terikat langsung dengan Pagu Induk. Jika ingin membatalkan pesanan anggaran, silakan hapus Pagu Induk (${detail.orderNo || "Tab 02"}).`,
      };
    }

    const client = await this.getClient();

    try {
      const meta = await client.spreadsheets.get({ spreadsheetId });
      const sheetMap = new Map<string, number>();
      (meta.data.sheets || []).forEach((s) => {
        if (s.properties?.title && typeof s.properties?.sheetId === "number") {
          sheetMap.set(s.properties.title, s.properties.sheetId);
        }
      });

      // =========================================================================
      // CASE 1: 02_PAGU_RINGKASAN (Cascade Delete 02 -> 03, 04, 05)
      // =========================================================================
      if (detail.sheetName === SHEET_NAMES.PAGU_RINGKASAN || detail.sheetName === "02_PENDAPATAN_SPPG") {
        const orderNo = (detail.orderNo || "").trim();
        const orderId = detail.id;
        const deleteRequests: sheets_v4.Schema$Request[] = [];

        let deletedRincian = 0;
        let deletedExpense = 0;
        let deletedRekap = 0;

        // 1. Tab 03 (PAGU_RINCIAN)
        const rincianSheetId = sheetMap.get(SHEET_NAMES.PAGU_RINCIAN);
        if (typeof rincianSheetId === "number") {
          const rRes = await client.spreadsheets.values.get({
            spreadsheetId,
            range: `'${SHEET_NAMES.PAGU_RINCIAN}'!A:B`,
          }).catch(() => ({ data: { values: null } }));
          const rows = rRes.data?.values || [];
          const indicesToDelete: number[] = [];
          for (let i = 0; i < rows.length; i++) {
            const c0 = String(rows[i]?.[0] || "").trim();
            const c1 = String(rows[i]?.[1] || "").trim();
            if ((orderNo && c0 === orderNo) || (orderId && c1 === orderId)) {
              indicesToDelete.push(i);
            }
          }
          // Sort descending to prevent index shifting
          indicesToDelete.sort((a, b) => b - a).forEach((idx) => {
            deleteRequests.push({
              deleteDimension: {
                range: {
                  sheetId: rincianSheetId,
                  dimension: "ROWS",
                  startIndex: idx,
                  endIndex: idx + 1,
                },
              },
            });
          });
          deletedRincian = indicesToDelete.length;
        }

        // 2. Tab 04 (PENGELUARAN_SUPPLIER)
        const expenseSheetName = sheetMap.has(SHEET_NAMES.PENGELUARAN_SUPPLIER)
          ? SHEET_NAMES.PENGELUARAN_SUPPLIER
          : "03_PENGELUARAN_SUPPLIER";
        const expenseSheetId = sheetMap.get(expenseSheetName);
        if (typeof expenseSheetId === "number") {
          const eRes = await client.spreadsheets.values.get({
            spreadsheetId,
            range: `'${expenseSheetName}'!A:B`,
          }).catch(() => ({ data: { values: null } }));
          const rows = eRes.data?.values || [];
          const indicesToDelete: number[] = [];
          for (let i = 0; i < rows.length; i++) {
            const c0 = String(rows[i]?.[0] || "").trim();
            const c1 = String(rows[i]?.[1] || "").trim();
            if ((orderNo && c0 === orderNo) || (orderId && c1 === orderId)) {
              indicesToDelete.push(i);
            }
          }
          indicesToDelete.sort((a, b) => b - a).forEach((idx) => {
            deleteRequests.push({
              deleteDimension: {
                range: {
                  sheetId: expenseSheetId,
                  dimension: "ROWS",
                  startIndex: idx,
                  endIndex: idx + 1,
                },
              },
            });
          });
          deletedExpense = indicesToDelete.length;
        }

        // 3. Tab 05 (REKAP_MARGIN)
        const rekapSheetName = sheetMap.has(SHEET_NAMES.REKAP_MARGIN)
          ? SHEET_NAMES.REKAP_MARGIN
          : "04_REKAP_MARGIN_HARIAN";
        const rekapSheetId = sheetMap.get(rekapSheetName);
        if (typeof rekapSheetId === "number") {
          const mRes = await client.spreadsheets.values.get({
            spreadsheetId,
            range: `'${rekapSheetName}'!A:A`,
          }).catch(() => ({ data: { values: null } }));
          const rows = mRes.data?.values || [];
          const indicesToDelete: number[] = [];
          for (let i = 0; i < rows.length; i++) {
            const c0 = String(rows[i]?.[0] || "").trim();
            if (orderNo && c0 === orderNo) {
              indicesToDelete.push(i);
            }
          }
          indicesToDelete.sort((a, b) => b - a).forEach((idx) => {
            deleteRequests.push({
              deleteDimension: {
                range: {
                  sheetId: rekapSheetId,
                  dimension: "ROWS",
                  startIndex: idx,
                  endIndex: idx + 1,
                },
              },
            });
          });
          deletedRekap = indicesToDelete.length;
        }

        // 4. Tab 02 (PAGU_RINGKASAN) - The Parent Row
        const paguSheetId = sheetMap.get(detail.sheetName);
        if (typeof paguSheetId === "number") {
          const paguIndex = detail.rowIndex - 1;
          deleteRequests.push({
            deleteDimension: {
              range: {
                sheetId: paguSheetId,
                dimension: "ROWS",
                startIndex: paguIndex,
                endIndex: paguIndex + 1,
              },
            },
          });
        }

        // Execute all cascade deletions in one atomic batch
        if (deleteRequests.length > 0) {
          await client.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: deleteRequests },
          });
        }

        logger.info(
          { orderNo, orderId, deletedRincian, deletedExpense, deletedRekap },
          "Executed atomic Cascade Delete for Pagu Induk"
        );

        if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
          await this.deleteMasterTransactionRow(orderId || transactionId, orderNo);
        }

        return {
          success: true,
          message: `✅ Pagu Induk <b>${orderNo || transactionId}</b> berhasil dihapus beserta seluruh data anak:\n• Tab 03 (Pagu Rincian): ${deletedRincian} item bahan\n• Tab 04 (Pengeluaran Supplier): ${deletedExpense} transaksi nota\n• Tab 05 (Rekap Margin): ${deletedRekap} baris komparasi`,
          deletedSummary: {
            paguRows: 1,
            rincianRows: deletedRincian,
            expenseRows: deletedExpense,
            rekapRows: deletedRekap,
            resetRekapRows: 0,
          },
        };
      }

      // =========================================================================
      // CASE 2: 04_PENGELUARAN_SUPPLIER (Cascade Reset/Delete in 05)
      // =========================================================================
      if (
        detail.sheetName === SHEET_NAMES.PENGELUARAN_SUPPLIER ||
        detail.sheetName === "03_PENGELUARAN_SUPPLIER"
      ) {
        const orderNo = (detail.orderNo || "").trim();
        const supplierName = (detail.supplierOrUnit || "").trim().toLowerCase();
        const deleteRequests: sheets_v4.Schema$Request[] = [];
        const cellResets: Array<{ rowNum: number; originalSupplier: string }> = [];
        const rekapIndicesToDelete: number[] = [];

        const rekapSheetName = sheetMap.has(SHEET_NAMES.REKAP_MARGIN)
          ? SHEET_NAMES.REKAP_MARGIN
          : "04_REKAP_MARGIN_HARIAN";
        const rekapSheetId = sheetMap.get(rekapSheetName);

        if (typeof rekapSheetId === "number") {
          const mRes = await client.spreadsheets.values.get({
            spreadsheetId,
            range: `'${rekapSheetName}'!A:J`,
          }).catch(() => ({ data: { values: null } }));
          const rows = mRes.data?.values || [];

          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const rowSppg = String(r[0] || "").trim();
            const rowSupplier = String(r[2] || "").trim().toLowerCase();
            const matches =
              (!orderNo || orderNo === "-" || rowSppg === orderNo) &&
              (supplierName && (rowSupplier.includes(supplierName) || supplierName.includes(rowSupplier)));

            if (matches) {
              const paguTotal = parseCurrencyNumber(r[7]);
              if (paguTotal > 0) {
                // Original pagu row: reset invoice amount (Col I) and realization (Col J)
                cellResets.push({ rowNum: i + 1, originalSupplier: String(r[2] || "") });
              } else {
                // Extra unmatched item: delete row
                rekapIndicesToDelete.push(i); // 0-indexed row in sheet
              }
            }
          }
        }

        // 1. Reset cells in Tab 05 FIRST (before any rows shift)
        if (cellResets.length > 0) {
          const resetData = cellResets.flatMap((item) => {
            const rowNum = item.rowNum;
            const updates = [
              {
                range: `'${rekapSheetName}'!I${rowNum}:J${rowNum}`,
                values: [["", ""]],
              },
              {
                range: `'${rekapSheetName}'!M${rowNum}`,
                values: [[`=IF(J${rowNum}=""; "🟡 MENUNGGU INVOICE"; IF(K${rowNum}>0; "🟢 HEMAT"; IF(K${rowNum}=0; "🟢 PAS"; "🔴 OVER BUDGET")))`]],
              },
            ];
            const cleanSupplier = String(item.originalSupplier || "").replace(/\s*\([^)]*\)/g, "").trim();
            if (cleanSupplier && cleanSupplier !== item.originalSupplier) {
              updates.push({
                range: `'${rekapSheetName}'!C${rowNum}`,
                values: [[cleanSupplier]],
              });
            }
            return updates;
          });
          await client.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: "USER_ENTERED",
              data: resetData,
            },
          });
        }

        // 2. Add delete requests for extra rows in Tab 05 (sorted descending)
        if (typeof rekapSheetId === "number" && rekapIndicesToDelete.length > 0) {
          rekapIndicesToDelete.sort((a, b) => b - a).forEach((idx) => {
            deleteRequests.push({
              deleteDimension: {
                range: {
                  sheetId: rekapSheetId,
                  dimension: "ROWS",
                  startIndex: idx,
                  endIndex: idx + 1,
                },
              },
            });
          });
        }

        // 3. Add delete request for the Tab 04 expense row
        const expenseSheetId = sheetMap.get(detail.sheetName);
        if (typeof expenseSheetId === "number") {
          const expIndex = detail.rowIndex - 1;
          deleteRequests.push({
            deleteDimension: {
              range: {
                sheetId: expenseSheetId,
                dimension: "ROWS",
                startIndex: expIndex,
                endIndex: expIndex + 1,
              },
            },
          });
        }

        if (deleteRequests.length > 0) {
          await client.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests: deleteRequests },
          });
        }

        logger.info(
          { transactionId, supplierName, cellResets: cellResets.length, deletedRekap: rekapIndicesToDelete.length },
          "Deleted expense and cascade-reset 05_REKAP_MARGIN"
        );

        if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
          await this.deleteMasterTransactionRow(transactionId);
        }

        return {
          success: true,
          message: `✅ Transaksi supplier <code>${transactionId}</code> berhasil dihapus dari Google Sheets. Realisasi di Tab 05 (Rekap Margin) telah di-reset (${cellResets.length} item kembali ke status Menunggu Invoice${rekapIndicesToDelete.length > 0 ? `, ${rekapIndicesToDelete.length} item tambahan dihapus` : ""}).`,
          deletedSummary: {
            paguRows: 0,
            rincianRows: 0,
            expenseRows: 1,
            rekapRows: rekapIndicesToDelete.length,
            resetRekapRows: cellResets.length,
          },
        };
      }

      // =========================================================================
      // CASE 3: 05_REKAP_MARGIN or Other Standalone
      // =========================================================================
      const targetSheet = (meta.data.sheets || []).find(
        (s) => s.properties?.title === detail.sheetName
      );
      const sheetIdNum = targetSheet?.properties?.sheetId || 0;
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
        "Deleted standalone transaction row from Google Sheets"
      );

      if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
        await this.deleteMasterTransactionRow(transactionId);
      }

      return {
        success: true,
        message: `Transaksi <code>${transactionId}</code> berhasil dihapus dari Google Sheets (${detail.sheetName}).`,
        deletedSummary: {
          paguRows: 0,
          rincianRows: 0,
          expenseRows: 0,
          rekapRows: 1,
          resetRekapRows: 0,
        },
      };
    } catch (err: any) {
      logger.error({ err, transactionId }, "Failed to delete row from Google Sheets");
      return { success: false, message: `Gagal menghapus baris: ${err?.message || err}` };
    }
  }

  /**
   * Updates an existing transaction row in Google Sheets (e.g. edit nominal or supplier)
   * and cascades updates to linked sheets (e.g. 05_REKAP_MARGIN)
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
      if (
        detail.sheetName === SHEET_NAMES.PENGELUARAN_SUPPLIER ||
        detail.sheetName === "03_PENGELUARAN_SUPPLIER"
      ) {
        const isModern = detail.sheetName === SHEET_NAMES.PENGELUARAN_SUPPLIER;
        const supplierCol = "D";
        const amountCol = isModern ? "F" : "H";
        const notesCol = isModern ? "J" : "L";

        if (updates.supplier_name) {
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${detail.sheetName}'!${supplierCol}${detail.rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[updates.supplier_name]] },
          });
        }
        if (updates.total_amount !== undefined) {
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${detail.sheetName}'!${amountCol}${detail.rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[updates.total_amount]] },
          });
        }
        if (updates.notes) {
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${detail.sheetName}'!${notesCol}${detail.rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[updates.notes]] },
          });
        }

        // Cascade update to 05_REKAP_MARGIN
        try {
          const orderNo = (detail.orderNo || "").trim();
          const origSupplier = (detail.supplierOrUnit || "").trim().toLowerCase();
          const rekapRes = await client.spreadsheets.values.get({
            spreadsheetId,
            range: `'${SHEET_NAMES.REKAP_MARGIN}'!A:J`,
          }).catch(() => ({ data: { values: null } }));
          const rows = rekapRes.data?.values || [];

          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const rowSppg = String(r[0] || "").trim();
            const rowSupplier = String(r[2] || "").trim().toLowerCase();
            const matches =
              (!orderNo || orderNo === "-" || rowSppg === orderNo) &&
              (origSupplier && (rowSupplier.includes(origSupplier) || origSupplier.includes(rowSupplier)));

            if (matches) {
              const rowNum = i + 1;
              if (updates.supplier_name) {
                await client.spreadsheets.values.update({
                  spreadsheetId,
                  range: `'${SHEET_NAMES.REKAP_MARGIN}'!C${rowNum}`,
                  valueInputOption: "USER_ENTERED",
                  requestBody: { values: [[updates.supplier_name]] },
                });
              }
              if (updates.total_amount !== undefined) {
                const qty = Number(r[4]) || 1;
                const unitPrice = Math.round(updates.total_amount / qty);
                await client.spreadsheets.values.update({
                  spreadsheetId,
                  range: `'${SHEET_NAMES.REKAP_MARGIN}'!I${rowNum}:J${rowNum}`,
                  valueInputOption: "USER_ENTERED",
                  requestBody: { values: [[unitPrice, updates.total_amount]] },
                });
              }
              break;
            }
          }
        } catch (cascadeErr) {
          logger.warn({ cascadeErr }, "Cascade update to 05_REKAP_MARGIN had a minor error");
        }
      } else if (
        detail.sheetName === SHEET_NAMES.PAGU_RINGKASAN ||
        detail.sheetName === "02_PENDAPATAN_SPPG"
      ) {
        const isModern = detail.sheetName === SHEET_NAMES.PAGU_RINGKASAN;
        const amountCol = isModern ? "F" : "I";
        if (updates.total_amount !== undefined) {
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${detail.sheetName}'!${amountCol}${detail.rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[updates.total_amount]] },
          });
        }
      }

      if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
        await this.updateMasterTransactionRow(transactionId, updates);
      }

      logger.info({ transactionId, updates }, "Updated transaction row in Google Sheets with cascading");
      return { success: true, message: `Transaksi ${transactionId} berhasil diperbarui di Google Sheets.` };
    } catch (err: any) {
      logger.error({ err, transactionId }, "Failed to update row in Google Sheets");
      return { success: false, message: `Gagal memperbarui transaksi: ${err?.message || err}` };
    }
  }
}

export const googleSheetsService = new GoogleSheetsService();

import { google, sheets_v4 } from "googleapis";
import fs from "fs";
import path from "path";
import { env } from "../../../config/env.js";
import { logger } from "../../utils/logger.js";
import {
  createHeaderStylingBatchRequests,
  createDataValidationBatchRequests,
  createNumberFormattingBatchRequests,
  createConditionalFormattingBatchRequests,
  createBandingBatchRequests,
  createOperationalDashboardStructureBatchRequests,
  getOperationalDashboardValues,
  createOperationalDashboardStylingRequests,
  createOperationalDashboardChartRequest,
  SHEET_NAMES,
  SHEET_IDS,
  hexToRgbColor,
  BGN_PALETTE,
} from "../recipes/index.js";

export function parseCurrencyNumber(val: any): number {
  if (typeof val === "number") return val;
  const str = String(val || "").trim();
  if (!str) return 0;
  const clean = str.replace(/[^\d,.-]/g, "").trim();
  const normalized = clean.replace(/\./g, "").replace(/,/g, ".");
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}

export class SheetsClientProvider {
  private sheets: sheets_v4.Sheets | null = null;
  private initializedSpreadsheets = new Set<string>();

  async getClient(): Promise<sheets_v4.Sheets> {
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

  isInitialized(spreadsheetId: string): boolean {
    return this.initializedSpreadsheets.has(spreadsheetId);
  }

  markInitialized(spreadsheetId: string): void {
    this.initializedSpreadsheets.add(spreadsheetId);
  }

  getUnitNameFromSpreadsheetId(spreadsheetId: string): string {
    if (spreadsheetId === env.GOOGLE_SHEET_ID_PATILA) return "SPPG Patila";
    if (spreadsheetId === env.GOOGLE_SHEET_ID_UNIT2) return "SPPG Dapur Unit 2";
    if (spreadsheetId === env.GOOGLE_SHEET_ID_UNIT3) return "SPPG Dapur Unit 3";
    return "SPPG Unit";
  }

  getUnitCodeFromSpreadsheetId(spreadsheetId: string): string {
    if (spreadsheetId === env.GOOGLE_SHEET_ID_PATILA) return "01";
    if (spreadsheetId === env.GOOGLE_SHEET_ID_UNIT2) return "02";
    if (spreadsheetId === env.GOOGLE_SHEET_ID_UNIT3) return "03";
    return "01";
  }

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

  async appendRowsSafely(
    spreadsheetId: string,
    sheetName: string,
    rows: (string | number)[][]
  ): Promise<number> {
    const client = await this.getClient();

    const colA = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:A`,
    });

    const existingRows = (colA.data.values || []).length;
    const startRow = Math.max(existingRows + 1, 2);
    const endRow = startRow + rows.length - 1;

    await client.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A${startRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });

    logger.info({ sheetName, startRow, endRow, count: rows.length }, "Appended rows to spreadsheet");
    return startRow;
  }

  async updateCellSafely(spreadsheetId: string, range: string, value: any): Promise<void> {
    const client = await this.getClient();
    await client.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[value]] },
    });
  }

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
          return;
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

      await Promise.all([
        client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.DASHBOARD}'!A1:Z50` }).catch(() => {}),
        client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.PAGU_PENERIMAAN}'!A1:Z1` }).catch(() => {}),
        client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.RINCIAN_PENDAPATAN}'!A1:Z1` }).catch(() => {}),
        client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.PAGU_PENGELUARAN}'!A1:Z1` }).catch(() => {}),
        client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A1:Z1` }).catch(() => {}),
        client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A1:Z1` }).catch(() => {}),
      ]);

      const {
        valuesDashboard,
        valuesHelper,
        tabPaguPenerimaanHeaders,
        tabRincianPendapatanHeaders,
        tabPaguPengeluaranHeaders,
        tabRincianPengeluaranHeaders,
        tabPerbandinganMarginHeaders,
        tabMasterDataHeaders,
      } = getOperationalDashboardValues(unitName);

      await client.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: [
            { range: `'${SHEET_NAMES.DASHBOARD}'!A1:K29`, values: valuesDashboard },
            { range: `'${SHEET_NAMES.DASHBOARD}'!M1:M4`, values: valuesHelper },
            { range: `'${SHEET_NAMES.PAGU_PENERIMAAN}'!A1:J1`, values: tabPaguPenerimaanHeaders },
            { range: `'${SHEET_NAMES.RINCIAN_PENDAPATAN}'!A1:J1`, values: tabRincianPendapatanHeaders },
            { range: `'${SHEET_NAMES.PAGU_PENGELUARAN}'!A1:J1`, values: tabPaguPengeluaranHeaders },
            { range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A1:J1`, values: tabRincianPengeluaranHeaders },
            { range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A1:M1`, values: tabPerbandinganMarginHeaders },
            { range: `'${SHEET_NAMES.MASTER_DATA}'!A1:C1`, values: tabMasterDataHeaders },
          ],
        },
      });

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

  async warmUp(spreadsheetIds: string[], ensureStructureFn: (id: string) => Promise<void>): Promise<void> {
    for (const id of spreadsheetIds) {
      if (!id || this.initializedSpreadsheets.has(id)) continue;
      ensureStructureFn(id).catch((err) => {
        logger.debug({ err: err?.message, id }, "Background spreadsheet warm-up note");
      });
    }
  }
}

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
      await this.ensureHeadersAndFormulas(spreadsheetId);
      await this.applyBandingToMissingSheets(spreadsheetId);
      this.initializedSpreadsheets.add(spreadsheetId);
    } catch (err: any) {
      logger.warn({ err: err?.message || err, spreadsheetId }, "Note during 5-tab verification");
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

        if (check.data.values?.[0]?.[0]?.includes("DASHBOARD PUSAT")) {
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

      const { valuesDashboard, valuesHelper, tab2Headers, tab3Headers } = getMasterDashboardValues();

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
          ],
        },
      });

      const chartRequest = createMasterDashboardChartRequest(konsolidasiSheetId);
      const stylingRequests = [
        ...createMasterDashboardStylingBatchRequests(
          konsolidasiSheetId,
          trxSheetId,
          dirSheetId
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
   * Generates standardized ID: SPPG[Kode Unit][Tahun]-[Huruf Bulan/E][Nomor Urut 001]
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
    const prefixLetter = type === "income" ? monthLetter : "E";
    const padCounter = String(counter).padStart(3, "0");
    return `SPPG${unitCode}${year}-${prefixLetter}${padCounter}`;
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
          if (!r[0] || existingIds.has(r[0])) continue;
          newRows.push([
            r[0],
            r[1],
            unit.name,
            "PENDAPATAN",
            r[2] || "-",
            "Pemerintah / BGN",
            r[3] ? `Pagu Pesanan (${r[3]})` : "Pagu Anggaran SPPG",
            r[5] || r[8] || 0,
            r[6] || "-",
            r[8] || r[10] || "Admin SPPG",
            "LENGKAP",
          ]);
          existingIds.add(r[0]);
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
          if (!r[0] || existingIds.has(r[0])) continue;
          newRows.push([
            r[0],
            r[1],
            unit.name,
            "PENGELUARAN",
            r[2] || "-",
            r[3] || "-",
            r[9] || r[4] || "Belanja Bahan Dapur",
            r[5] || r[8] || 0,
            r[7] || r[9] || "-",
            r[8] || r[10] || "PIC Dapur",
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
    const itemCountStr = `${order.items.length} Item`;
    const driveLinkFormula = driveLink ? `=HYPERLINK("${driveLink}"; "Lihat Dokumen")` : "-";

    // 1. Row for 02_PAGU_RINGKASAN
    const ringkasanRow = [
      orderId,                                                    // A: ID Transaksi
      order.order_date,                                           // B: Tanggal Pesanan
      order.order_no,                                             // C: No SPPG
      itemCountStr,                                               // D: Jumlah Item Bahan
      supplierCountStr,                                           // E: Jumlah Target Supplier
      order.total_amount,                                         // F: Total Pagu Anggaran
      driveLinkFormula,                                           // G: Link Bukti Dokumen
      rawCaption || order.notes || "-",                           // H: Pesan Asli Telegram
      order.signed_by || picName || "Kepala SPPG",               // I: PIC / Penanggung Jawab
      "-",                                                        // J: Riwayat Edit
    ];

    // 2. Rows for 03_PAGU_RINCIAN (all items)
    const rincianRows = order.items.map((item, idx) => [
      order.order_no,                                             // A: No SPPG Ref
      orderId,                                                    // B: ID Ref
      idx + 1,                                                    // C: No Urut
      item.supplier_target || "Lainnya",                          // D: Target Supplier
      item.item_name,                                             // E: Uraian Bahan
      item.qty,                                                   // F: Kuantitas
      item.unit,                                                  // G: Satuan
      item.price,                                                 // H: Harga Pagu Satuan
      item.total_price,                                           // I: Total Pagu
      (item as any).specifications || item.category || "-",       // J: Keterangan / Spesifikasi
    ]);

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
        item.total_price,                                         // H: Total Pagu
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
      expenseId,                                                  // A: ID Transaksi
      dateStr,                                                    // B: Tanggal Transaksi
      receipt.sppg_ref_no || "-",                                 // C: No SPPG Ref
      receipt.supplier_name,                                      // D: Nama Supplier
      (receipt as any).receipt_no || "-",                         // E: No Invoice Supplier
      receipt.total_amount,                                       // F: Total Nominal Tagihan
      receipt.payment_method || "Tunai",                          // G: Metode Pembayaran
      driveLinkFormula,                                           // H: Link Bukti Nota
      picName || "PIC Dapur",                                     // I: PIC / Operator
      receipt.notes || rawCaption || itemsSummary,                // J: Catatan / Keterangan
    ];

    await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PENGELUARAN_SUPPLIER, [expenseRow]);

    // 2. Automated Granular Matching in 05_REKAP_MARGIN
    try {
      const rekapRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.REKAP_MARGIN}'!A2:J`,
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
            const rowSupplier = String(row[2] || "").toLowerCase().trim();
            const rowItemName = String(row[3] || "").toLowerCase().trim();
            const rowHasInvoice = !!row[8] || !!row[9];

            // Match condition: No invoice yet, and either same SPPG ref or matching supplier/item name
            const sppgMatches =
              !receipt.sppg_ref_no ||
              receipt.sppg_ref_no === "-" ||
              rowSppgRef === receipt.sppg_ref_no;

            const nameMatches =
              rowItemName.includes(itemCleanName) ||
              itemCleanName.includes(rowItemName) ||
              (rowSupplier && receipt.supplier_name.toLowerCase().includes(rowSupplier));

            if (!rowHasInvoice && sppgMatches && nameMatches) {
              const actualRow = rIdx + 2; // header is row 1
              const itemTotal = item.total_price || item.qty * item.price;
              batchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!I${actualRow}:J${actualRow}`,
                values: [[item.price, itemTotal]],
              });
              matchedRowIndices.add(rIdx);
              matched = true;
              break;
            }
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
   * Retrieves live executive KPI summary calculated from operational tabs
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

      // 1. Read all Pagu from 02_PAGU_RINGKASAN (Col F) or fallback 02_PENDAPATAN_SPPG (Col I)
      let incomeRes = await client.spreadsheets.values
        .get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!F2:F`,
        })
        .catch(() => ({ data: { values: null } }));

      if (!incomeRes.data.values || incomeRes.data.values.length === 0) {
        incomeRes = await client.spreadsheets.values
          .get({
            spreadsheetId,
            range: "'02_PENDAPATAN_SPPG'!I2:I",
          })
          .catch(() => ({ data: { values: null } }));
      }
      const incomeValues = incomeRes.data?.values || [];
      const totalPlafon = incomeValues.reduce((sum, row) => sum + parseAmount(row[0]), 0);

      // 2. Read all Belanja from 04_PENGELUARAN_SUPPLIER (Col F) or fallback 03_PENGELUARAN_SUPPLIER (Col I)
      let expenseRes = await client.spreadsheets.values
        .get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!F2:F`,
        })
        .catch(() => ({ data: { values: null } }));

      if (!expenseRes.data.values || expenseRes.data.values.length === 0) {
        expenseRes = await client.spreadsheets.values
          .get({
            spreadsheetId,
            range: "'03_PENGELUARAN_SUPPLIER'!I2:I",
          })
          .catch(() => ({ data: { values: null } }));
      }
      const expenseValues = expenseRes.data?.values || [];
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
        if (row && row[0]) {
          const amount = isNewExpenseTab
            ? Number(String(row[5] || "0").replace(/[^\d.-]/g, "")) || 0
            : Number(String(row[8] || "0").replace(/[^\d.-]/g, "")) || 0;
          results.push({
            id: String(row[0]),
            date: String(row[1] || "-"),
            type: "expense",
            title: String(row[3] || "Supplier"),
            amount,
            detail: isNewExpenseTab ? String(row[9] || row[2] || "-") : String(row[4] || "-"),
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
        if (row && row[0]) {
          const amount = isNewOrderTab
            ? Number(String(row[5] || "0").replace(/[^\d.-]/g, "")) || 0
            : Number(String(row[8] || "0").replace(/[^\d.-]/g, "")) || 0;
          results.push({
            id: String(row[0]),
            date: String(row[1] || "-"),
            type: "income",
            title: isNewOrderTab ? `Nota SPPG ${row[2] || ""}` : `Nota SPPG ${row[3] || ""}`,
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
  }> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();
    const cleanId = transactionId.trim().toUpperCase();

    // 1. Search in 04_PENGELUARAN_SUPPLIER (new)
    try {
      const expRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A:J`,
      });
      const expRows = expRes.data.values || [];
      for (let idx = 0; idx < expRows.length; idx++) {
        const row = expRows[idx];
        if (row && row[0] && String(row[0]).trim().toUpperCase() === cleanId) {
          const amount = Number(String(row[5] || "0").replace(/[^\d.-]/g, "")) || 0;
          return {
            found: true,
            id: cleanId,
            sheetName: SHEET_NAMES.PENGELUARAN_SUPPLIER,
            rowIndex: idx + 1,
            type: "expense",
            date: String(row[1] || "-"),
            supplierOrUnit: String(row[3] || "Supplier"),
            items: String(row[9] || "Belanja Bahan Dapur"),
            amount,
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

    // 3. Search in 02_PAGU_RINGKASAN (new)
    try {
      const ordRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A:J`,
      });
      const ordRows = ordRes.data.values || [];
      for (let idx = 0; idx < ordRows.length; idx++) {
        const row = ordRows[idx];
        if (row && row[0] && String(row[0]).trim().toUpperCase() === cleanId) {
          const amount = Number(String(row[5] || "0").replace(/[^\d.-]/g, "")) || 0;
          return {
            found: true,
            id: cleanId,
            sheetName: SHEET_NAMES.PAGU_RINGKASAN,
            rowIndex: idx + 1,
            type: "income",
            date: String(row[1] || "-"),
            supplierOrUnit: "Badan Gizi Nasional",
            items: String(row[3] || "Pagu Anggaran"),
            amount,
            link: String(row[6] || ""),
            notes: String(row[7] || "-"),
          };
        }
      }
    } catch (err) {
      // continue to legacy search
    }

    // 4. Search in legacy 02_PENDAPATAN_SPPG
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
      if (detail.sheetName === SHEET_NAMES.PENGELUARAN_SUPPLIER) {
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
            range: `'${detail.sheetName}'!F${detail.rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[updates.total_amount]] },
          });
        }
        if (updates.notes) {
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${detail.sheetName}'!J${detail.rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[updates.notes]] },
          });
        }
      } else if (detail.sheetName === SHEET_NAMES.PAGU_RINGKASAN) {
        if (updates.total_amount !== undefined) {
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${detail.sheetName}'!F${detail.rowIndex}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[updates.total_amount]] },
          });
        }
      } else if (detail.sheetName === "03_PENGELUARAN_SUPPLIER") {
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

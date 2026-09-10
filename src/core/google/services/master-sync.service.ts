import { sheets_v4 } from "googleapis";
import { env } from "../../../config/env.js";
import { logger } from "../../utils/logger.js";
import { getSupabaseClient } from "../../db/supabase.js";
import {
  createMasterDashboardStructureBatchRequests,
  createMasterDashboardStylingBatchRequests,
  getMasterDashboardValues,
  createMasterDashboardChartRequest,
  MASTER_SHEET_NAMES,
  MASTER_SHEET_IDS,
  SHEET_NAMES,
} from "../recipes/index.js";
import { SheetsClientProvider, parseCurrencyNumber } from "./sheets-client.provider.js";

export interface MasterAuditLogEntry {
  timestamp?: string;
  unitName: string;
  editor: string;
  sheetTab: string;
  refId: string;
  columnEdited: string;
  oldValue: string | number;
  newValue: string | number;
  sourceAction: string;
  status?: string;
}

export class MasterSyncService {
  constructor(private clientProvider: SheetsClientProvider) {}

  private async getClient(): Promise<sheets_v4.Sheets> {
    return this.clientProvider.getClient();
  }

  private async appendRowsSafely(spreadsheetId: string, sheetName: string, rows: (string | number)[][]): Promise<number> {
    return this.clientProvider.appendRowsSafely(spreadsheetId, sheetName, rows);
  }

  /**
   * Configures dedicated Executive Multi-Unit Aggregator structure for Master Dashboard
   */
  async ensureMasterDashboardStructure(spreadsheetId: string, force = false): Promise<void> {
    if (this.clientProvider.isInitialized(spreadsheetId) && !force) {
      return;
    }

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
          this.clientProvider.markInitialized(spreadsheetId);
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

      this.clientProvider.markInitialized(spreadsheetId);
      logger.info({ spreadsheetId }, "Successfully configured clean Executive Master Dashboard SPPG");
    } catch (err: any) {
      logger.error({ err: err?.message || err, spreadsheetId }, "Failed ensuring Master Dashboard structure");
    }
  }

  /**
   * Appends an audit trail entry directly into Master Dashboard 04_LOG_AKTIVITAS
   */
  async appendMasterAuditLog(entry: MasterAuditLogEntry): Promise<void> {
    await this.appendMasterAuditLogsBatch([entry]);
  }

  /**
   * Appends multiple audit trail entries in ONE single batch call to avoid rate limits
   */
  async appendMasterAuditLogsBatch(entries: MasterAuditLogEntry[]): Promise<void> {
    if (!entries || entries.length === 0) return;
    const masterId = env.GOOGLE_SHEET_ID_MASTER;
    if (!masterId) return;

    try {
      await this.ensureMasterDashboardStructure(masterId);

      const rows = entries.map((entry) => {
        const now = new Date();
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

        return [
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
      });

      await this.appendRowsSafely(masterId, MASTER_SHEET_NAMES.LOG_AKTIVITAS, rows);
      logger.info({ count: rows.length }, "Batch Master Audit Logs recorded");
    } catch (err: any) {
      logger.warn({ err: err?.message || err }, "Failed appending batch to Master Audit Log");
    }
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
        if (cleanTxId) {
          if (rowId === cleanTxId) {
            indicesToDelete.push(i);
          }
        } else if (cleanOrderNo && (rowRef === cleanOrderNo || rowId === cleanOrderNo)) {
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

}

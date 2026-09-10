import { getEnabledSppgUnits, SPPGUnitConfig } from "../../config/sppg.config.js";
import { env } from "../../config/env.js";
import { getSupabaseClient } from "../db/supabase.js";
import { GoogleSheetsService } from "../google/sheets.service.js";
import { SHEET_NAMES } from "../google/sheets-recipes.js";
import { logger } from "../utils/logger.js";

export interface SheetsWebhookPayload {
  spreadsheetId: string;
  sheetName: string;
  range?: string;
  row?: number;
  col?: number;
  oldValue?: any;
  value?: any;
  user?: string;
  action?: string;
  timestamp?: string;
}

const TAB_COLUMN_MAP: Record<string, string[]> = {
  [SHEET_NAMES.PAGU_RINCIAN]: [
    "No SPPG Ref (A)",
    "ID Ref (B)",
    "No Urut (C)",
    "Target Supplier (D)",
    "Uraian Bahan (E)",
    "Kuantitas (F)",
    "Satuan (G)",
    "Harga Pagu Satuan (H)",
    "Total Pagu (I)",
    "Keterangan / Spesifikasi (J)",
  ],
  [SHEET_NAMES.PENGELUARAN_SUPPLIER]: [
    "No SPPG Ref (A)",
    "ID Transaksi (B)",
    "Tanggal Transaksi (C)",
    "Nama Supplier (D)",
    "No Invoice Supplier (E)",
    "Total Nominal Tagihan (F)",
    "Metode Pembayaran (G)",
    "Link Bukti Nota (H)",
    "PIC / Operator (I)",
    "Catatan / Keterangan (J)",
  ],
  [SHEET_NAMES.RINCIAN_PENGELUARAN]: [
    "No SPPG Ref (A)",
    "ID Transaksi Belanja (B)",
    "No Urut (C)",
    "Nama Supplier (D)",
    "Uraian Bahan / Barang Belanja (E)",
    "Kuantitas (F)",
    "Satuan (G)",
    "Harga Satuan Invoice (H)",
    "Total Belanja (I)",
    "Keterangan / No Nota (J)",
  ],
  [SHEET_NAMES.PAGU_RINGKASAN]: [
    "No SPPG (A)",
    "ID Transaksi (B)",
    "Tanggal Pesanan (C)",
    "Jumlah Item Bahan (D)",
    "Jumlah Target Supplier (E)",
    "Total Pagu Anggaran (F)",
    "Link Bukti Dokumen (G)",
    "Pesan Asli Telegram (H)",
    "PIC / Penanggung Jawab (I)",
    "Riwayat Edit (J)",
  ],
  [SHEET_NAMES.REKAP_MARGIN]: [
    "No SPPG Ref (A)",
    "Tanggal (B)",
    "Nama Supplier (C)",
    "Uraian Bahan (D)",
    "Kuantitas (E)",
    "Satuan (F)",
    "Harga Pagu (G)",
    "Total Pagu (H)",
    "Harga Invoice (I)",
    "Total Realisasi (J)",
    "Margin Bersih (K)",
    "% Margin (L)",
    "Status (M)",
  ],
};

function parseNum(val: any): number {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const clean = String(val).replace(/[^\d,.-]/g, "").trim();
  const norm = clean.replace(/\./g, "").replace(/,/g, ".");
  const n = parseFloat(norm);
  return isNaN(n) ? 0 : n;
}

export class DeltaSyncDaemon {
  private sheetsService: GoogleSheetsService;
  private isPolling = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private pollIntervalMs: number;
  private isInitialBaselineDone = false;

  // Snapshot cache: spreadsheetId -> sheetName -> 2D values (matrix of strings)
  private snapshots: Map<string, Map<string, string[][]>> = new Map();

  constructor(sheetsService?: GoogleSheetsService, pollIntervalMs = 45000) {
    this.sheetsService = sheetsService || new GoogleSheetsService();
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Starts autonomous delta sync background worker
   */
  async start(): Promise<void> {
    logger.info("⚡ [Delta Sync Daemon] Starting autonomous sheet synchronization service...");

    // 1. Establish initial baseline snapshot without sending alert logs
    try {
      await this.captureBaselineSnapshots();
      this.isInitialBaselineDone = true;
      logger.info("⚡ [Delta Sync Daemon] Initial baseline snapshots established for all SPPG units");
    } catch (err: any) {
      logger.warn({ err: err?.message || err }, "[Delta Sync Daemon] Warning establishing baseline snapshot");
      this.isInitialBaselineDone = true;
    }

    // 2. Start polling interval
    this.intervalTimer = setInterval(() => {
      this.pollAllUnits().catch((err) => {
        logger.error({ err: err?.message || err }, "[Delta Sync Daemon] Error during delta polling run");
      });
    }, this.pollIntervalMs);
  }

  /**
   * Stops background polling worker cleanly
   */
  stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
      logger.info("[Delta Sync Daemon] Polling timer stopped cleanly");
    }
  }

  /**
   * Captures initial state of all registered units without generating diff logs
   */
  private async captureBaselineSnapshots(): Promise<void> {
    const units = getEnabledSppgUnits().filter((u) => !!u.spreadsheetId);
    for (const unit of units) {
      await this.fetchAndSnapshotUnit(unit, true);
    }
  }

  /**
   * Polls all registered units, detects diffs, records audit logs, and reconciles to Master & Supabase
   */
  async pollAllUnits(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const units = getEnabledSppgUnits().filter((u) => !!u.spreadsheetId);
      for (const unit of units) {
        await this.syncUnit(unit);
      }
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Synchronizes a single SPPG Unit spreadsheet
   */
  async syncUnit(unit: SPPGUnitConfig, targetSheetName?: string): Promise<void> {
    const spreadsheetId = unit.spreadsheetId;
    if (!spreadsheetId) return;

    const tabsToScan = targetSheetName
      ? [targetSheetName]
      : [
          SHEET_NAMES.RINCIAN_PENDAPATAN,
          SHEET_NAMES.PAGU_PENGELUARAN,
          SHEET_NAMES.RINCIAN_PENGELUARAN,
          SHEET_NAMES.PAGU_PENERIMAAN,
          SHEET_NAMES.PERBANDINGAN_MARGIN,
        ];

    let unitSnapshots = this.snapshots.get(spreadsheetId);
    if (!unitSnapshots) {
      unitSnapshots = new Map();
      this.snapshots.set(spreadsheetId, unitSnapshots);
    }

    const client = await (this.sheetsService as any).getClient();

    for (const sheetName of tabsToScan) {
      try {
        const res = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetName}'!A2:M1000`,
        });
        const currentRows: string[][] = (res.data?.values || []).map((row: any[]) =>
          row.map((c) => (c !== null && c !== undefined ? String(c).trim() : ""))
        );

        const prevRows = unitSnapshots.get(sheetName);

        if (!prevRows) {
          // If no previous snapshot exists, save baseline and continue
          unitSnapshots.set(sheetName, currentRows);
          continue;
        }

        // Compare row-by-row and cell-by-cell
        await this.diffAndReconcileSheet(unit, sheetName, prevRows, currentRows);

        // Update snapshot with latest state
        unitSnapshots.set(sheetName, currentRows);
      } catch (err: any) {
        // Tab might not exist or network timeout
        logger.debug(
          { unit: unit.name, sheetName, err: err?.message || err },
          "[Delta Sync Daemon] Could not read tab during sync"
        );
      }
    }
  }

  /**
   * Diffs previous rows against current rows and processes detected cell edits
   */
  private async diffAndReconcileSheet(
    unit: SPPGUnitConfig,
    sheetName: string,
    prevRows: string[][],
    currentRows: string[][],
    editorName = "Ayah / Operator Spreadsheet"
  ): Promise<void> {
    const colLabels = TAB_COLUMN_MAP[sheetName] || [];
    const supabase = getSupabaseClient();
    const pendingMasterLogs: any[] = [];
    const pendingDbLogs: any[] = [];

    const getRowKey = (row: string[]): string => {
      if (!row || row.length === 0) return "";
      if (sheetName === SHEET_NAMES.RINCIAN_PENGELUARAN) {
        return `${(row[1] || "").trim()}_${(row[4] || "").trim().toLowerCase()}`;
      }
      if (sheetName === SHEET_NAMES.PAGU_PENGELUARAN) {
        return (row[1] || row[0] || "").trim();
      }
      if (sheetName === SHEET_NAMES.RINCIAN_PENDAPATAN) {
        return `${(row[0] || "").trim()}_${(row[4] || "").trim().toLowerCase()}`;
      }
      if (sheetName === SHEET_NAMES.PAGU_PENERIMAAN) {
        return (row[0] || "").trim();
      }
      if (sheetName === SHEET_NAMES.PERBANDINGAN_MARGIN) {
        return `${(row[0] || "").trim()}_${(row[3] || "").trim().toLowerCase()}`;
      }
      return row.slice(0, 3).join("_").trim();
    };

    // Build key-indexed maps for previous and current rows
    const prevMap = new Map<string, { row: string[]; index: number }>();
    for (let i = 0; i < prevRows.length; i++) {
      const row = prevRows[i];
      if (!row || row.every((c) => !c)) continue;
      const key = getRowKey(row) || `__idx_${i}`;
      prevMap.set(key, { row, index: i });
    }

    const currMap = new Map<string, { row: string[]; index: number }>();
    for (let i = 0; i < currentRows.length; i++) {
      const row = currentRows[i];
      if (!row || row.every((c) => !c)) continue;
      const key = getRowKey(row) || `__idx_${i}`;
      currMap.set(key, { row, index: i });
    }

    // 1. Detect Deleted Rows (present in prevMap but missing in currMap)
    for (const [key, { row: delRow, index: pIdx }] of prevMap.entries()) {
      if (!currMap.has(key)) {
        const rowSummary = delRow.filter(Boolean).slice(0, 5).join(" | ");
        const refId = delRow[0] || delRow[1] || `Baris ${pIdx + 2}`;
        logger.info(
          { unit: unit.name, sheetName, row: pIdx + 2, rowSummary },
          "⚡ [Delta Sync Daemon] Row deletion detected!"
        );

        pendingMasterLogs.push({
          unitName: unit.name,
          editor: editorName,
          sheetTab: sheetName,
          refId: String(refId),
          columnEdited: "Hapus Baris",
          oldValue: rowSummary || "(data dihapus)",
          newValue: "[DIHAPUS]",
          sourceAction: "Spreadsheet Direct Edit",
          status: "TERVERIFIKASI",
        });

        pendingDbLogs.push({
          unit_name: unit.name,
          editor: editorName,
          sheet_tab: sheetName,
          ref_id: String(refId),
          column_edited: "Hapus Baris",
          old_value: rowSummary || "(data dihapus)",
          new_value: "[DIHAPUS]",
          source_action: "Spreadsheet Direct Edit",
          status: "TERVERIFIKASI",
        });
      }
    }

    // 2. Detect Inserted Rows (present in currMap but missing in prevMap)
    for (const [key, { row: insRow, index: cIdx }] of currMap.entries()) {
      if (!prevMap.has(key)) {
        const rowSummary = insRow.filter(Boolean).slice(0, 5).join(" | ");
        const refId = insRow[0] || insRow[1] || `Baris ${cIdx + 2}`;
        logger.info(
          { unit: unit.name, sheetName, row: cIdx + 2, rowSummary },
          "⚡ [Delta Sync Daemon] New row insertion detected!"
        );

        pendingMasterLogs.push({
          unitName: unit.name,
          editor: editorName,
          sheetTab: sheetName,
          refId: String(refId),
          columnEdited: "Tambah Baris Baru",
          oldValue: "(kosong)",
          newValue: rowSummary || "(data baru)",
          sourceAction: "Spreadsheet Direct Edit",
          status: "TERVERIFIKASI",
        });

        pendingDbLogs.push({
          unit_name: unit.name,
          editor: editorName,
          sheet_tab: sheetName,
          ref_id: String(refId),
          column_edited: "Tambah Baris Baru",
          old_value: "(kosong)",
          new_value: rowSummary || "(data baru)",
          source_action: "Spreadsheet Direct Edit",
          status: "TERVERIFIKASI",
        });

        // Trigger cascading reconciliations for new row if applicable
        if (sheetName === SHEET_NAMES.PAGU_PENGELUARAN && insRow[5]) {
          const newAmount = parseNum(insRow[5]);
          const expenseId = insRow[1] || insRow[0];
          if (expenseId && newAmount >= 0) {
            await this.sheetsService.updateMasterTransactionRow(expenseId, {
              total_amount: newAmount,
            });
          }
        }
      }
    }

    // 3. Detect Cell-by-Cell Edits on Matching Rows
    for (const [key, { row: currRow, index: rIdx }] of currMap.entries()) {
      const prevEntry = prevMap.get(key);
      if (!prevEntry) continue; // New row handled above
      const prevRow = prevEntry.row;
      const refId = currRow[0] || currRow[1] || prevRow[0] || prevRow[1] || `Baris ${rIdx + 2}`;

      const maxCols = Math.max(prevRow.length, currRow.length);
      for (let cIdx = 0; cIdx < maxCols; cIdx++) {
        const oldVal = prevRow[cIdx] ?? "";
        const newVal = currRow[cIdx] ?? "";

        // Value changed!
        if (oldVal !== newVal) {
          if (oldVal === "" && newVal === "") continue;

          const colName = colLabels[cIdx] || `Kolom ${String.fromCharCode(65 + cIdx)}`;

          logger.info(
            {
              unit: unit.name,
              sheetName,
              row: rIdx + 2,
              col: colName,
              oldVal,
              newVal,
            },
            "⚡ [Delta Sync Daemon] Spreadsheet edit detected!"
          );

          pendingMasterLogs.push({
            unitName: unit.name,
            editor: editorName,
            sheetTab: sheetName,
            refId: String(refId),
            columnEdited: colName,
            oldValue: oldVal || "(kosong)",
            newValue: newVal || "(kosong)",
            sourceAction: "Spreadsheet Direct Edit",
            status: "TERVERIFIKASI",
          });

          pendingDbLogs.push({
            unit_name: unit.name,
            editor: editorName,
            sheet_tab: sheetName,
            ref_id: String(refId),
            column_edited: colName,
            old_value: String(oldVal),
            new_value: String(newVal),
            source_action: "Spreadsheet Direct Edit",
            status: "TERVERIFIKASI",
          });

          // Automated Cascading Reconciliations
          // CASE A: Total Nominal Tagihan in 04_PAGU_PENGELUARAN (Col F / index 5) changed
          if (sheetName === SHEET_NAMES.PAGU_PENGELUARAN && cIdx === 5) {
            const newAmount = parseNum(newVal);
            const expenseId = currRow[1] || currRow[0];
            if (expenseId && newAmount >= 0) {
              await this.sheetsService.updateMasterTransactionRow(expenseId, {
                total_amount: newAmount,
              });

              try {
                await supabase
                  .from("sppg_supplier_expenses")
                  .update({ total_amount: newAmount })
                  .or(`sppg_id.eq.${unit.id},sppg_ref_no.eq.${expenseId}`);
              } catch (_) {}
            }
          }

          // CASE B: Total Pagu Anggaran in 02_PAGU_PENERIMAAN (Col F / index 5) changed
          if (sheetName === SHEET_NAMES.PAGU_PENERIMAAN && cIdx === 5) {
            const newPaguAmount = parseNum(newVal);
            const orderNo = currRow[0];
            if (orderNo && newPaguAmount >= 0) {
              await this.sheetsService.updateMasterTransactionRow(orderNo, {
                total_amount: newPaguAmount,
              });

              try {
                await supabase
                  .from("sppg_orders")
                  .update({ total_amount: newPaguAmount })
                  .eq("order_no", orderNo);
              } catch (_) {}
            }
          }

          // CASE C: Item in 03_RINCIAN_PENDAPATAN changed (Supplier, Item Name, Qty, Unit, Price)
          if (sheetName === SHEET_NAMES.RINCIAN_PENDAPATAN && [3, 4, 5, 6, 7].includes(cIdx)) {
            const orderNo = String(currRow[0] || "").trim();
            const prevItemName = String(prevRow[4] || "").trim();
            const currItemName = String(currRow[4] || "").trim();
            const itemNameForSearch = prevItemName || currItemName;

            if (orderNo && itemNameForSearch) {
              // 1. Cascade update to Tab 06_PERBANDINGAN_MARGIN
              await this.sheetsService.cascadePaguRincianChangeToRekapMargin(
                unit.spreadsheetId,
                orderNo,
                itemNameForSearch,
                cIdx,
                currRow[cIdx]
              ).catch((err: any) => {
                logger.warn({ err: err?.message }, "[Delta Sync] Error cascading Tab 03 change to Tab 06");
              });

              // 2. Update Supabase sppg_order_items if price, qty, or name changed
              try {
                const qty = parseNum(currRow[5]);
                const price = parseNum(currRow[7]);
                const total = qty * price;
                await supabase
                  .from("sppg_order_items")
                  .update({
                    item_name: currItemName,
                    qty,
                    price,
                    total_price: total,
                  })
                  .eq("item_name", itemNameForSearch);
              } catch (_) {}
            }
          }

          // CASE D: Item in 05_RINCIAN_PENGELUARAN changed (Price or Total only - never overwrite Pagu item/supplier)
          if (sheetName === SHEET_NAMES.RINCIAN_PENGELUARAN && [7, 8].includes(cIdx)) {
            const orderNo = String(currRow[0] || "").trim();
            const prevItemName = String(prevRow[4] || "").trim();
            const currItemName = String(currRow[4] || "").trim();
            const itemNameForSearch = prevItemName || currItemName;

            if (itemNameForSearch) {
              // Cascade update to Tab 06_PERBANDINGAN_MARGIN
              await this.sheetsService.cascadeRincianPengeluaranChangeToRekapMargin(
                unit.spreadsheetId,
                orderNo,
                itemNameForSearch,
                cIdx,
                currRow[cIdx]
              ).catch((err: any) => {
                logger.warn({ err: err?.message }, "[Delta Sync] Error cascading Tab 05 change to Tab 06");
              });
            }
          }
        }
      }
    }

    // Flush batch logs in 1 call to prevent Google Sheets 429 quota exhaustion
    if (pendingMasterLogs.length > 0) {
      await this.sheetsService.appendMasterAuditLogsBatch(pendingMasterLogs);
    }
    if (pendingDbLogs.length > 0) {
      try {
        await supabase.from("sppg_audit_logs").insert(pendingDbLogs);
      } catch (dbErr: any) {
        logger.debug({ err: dbErr?.message }, "[Delta Sync] Non-critical DB log note");
      }
    }
  }

  /**
   * Helper to fetch baseline snapshot for a unit
   */
  private async fetchAndSnapshotUnit(unit: SPPGUnitConfig, isInitial = false): Promise<void> {
    const spreadsheetId = unit.spreadsheetId;
    if (!spreadsheetId) return;

    let unitSnapshots = this.snapshots.get(spreadsheetId);
    if (!unitSnapshots) {
      unitSnapshots = new Map();
      this.snapshots.set(spreadsheetId, unitSnapshots);
    }

    const client = await (this.sheetsService as any).getClient();
    const tabsToScan = [
      SHEET_NAMES.PAGU_RINCIAN,
      SHEET_NAMES.PENGELUARAN_SUPPLIER,
      SHEET_NAMES.PAGU_RINGKASAN,
      SHEET_NAMES.REKAP_MARGIN,
    ];

    for (const sheetName of tabsToScan) {
      try {
        const res = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetName}'!A2:M1000`,
        });
        const rows: string[][] = (res.data?.values || []).map((row: any[]) =>
          row.map((c) => (c !== null && c !== undefined ? String(c).trim() : ""))
        );
        unitSnapshots.set(sheetName, rows);
      } catch (err: any) {
        // Tab may not exist yet
      }
    }
  }

  /**
   * Webhook handler called when Google Apps Script sends an onEdit trigger
   */
  async handleWebhookEdit(payload: SheetsWebhookPayload): Promise<void> {
    logger.info(
      {
        spreadsheetId: payload.spreadsheetId,
        sheet: payload.sheetName,
        row: payload.row,
        col: payload.col,
        user: payload.user,
      },
      "⚡ [Delta Sync Daemon] Received onEdit webhook trigger from Google Apps Script!"
    );

    const units = getEnabledSppgUnits();
    const matchedUnit = units.find((u) => u.spreadsheetId === payload.spreadsheetId) || {
      id: "unknown",
      name: "SPPG Dapur",
      token: "",
      spreadsheetId: payload.spreadsheetId,
      driveFolderId: "",
      enabled: true,
    };

    const editorName = payload.user || "Ayah / Operator Spreadsheet";

    // If specific row & col are provided in payload, record directly
    if (payload.sheetName && payload.row && payload.col !== undefined) {
      const colLabels = TAB_COLUMN_MAP[payload.sheetName] || [];
      const colName = colLabels[payload.col - 1] || `Kolom ${String.fromCharCode(64 + payload.col)}`;

      await this.sheetsService.appendMasterAuditLog({
        unitName: matchedUnit.name,
        editor: `${editorName} (Instan)`,
        sheetTab: payload.sheetName,
        refId: `Baris ${payload.row}`,
        columnEdited: colName,
        oldValue: payload.oldValue !== undefined ? String(payload.oldValue) : "-",
        newValue: payload.value !== undefined ? String(payload.value) : "-",
        sourceAction: "Google Apps Script Webhook (Instan)",
        status: "TERVERIFIKASI",
      });

      // Also record to Supabase
      try {
        const supabase = getSupabaseClient();
        await supabase.from("sppg_audit_logs").insert({
          unit_name: matchedUnit.name,
          editor: `${editorName} (Instan)`,
          sheet_tab: payload.sheetName,
          ref_id: `Baris ${payload.row}`,
          column_edited: colName,
          old_value: payload.oldValue !== undefined ? String(payload.oldValue) : "-",
          new_value: payload.value !== undefined ? String(payload.value) : "-",
          source_action: "Google Apps Script Webhook (Instan)",
          status: "TERVERIFIKASI",
        });
      } catch (_) {}
    }

    // Immediately trigger a targeted sync for this unit to update internal snapshots and formulas
    if (matchedUnit.spreadsheetId) {
      await this.syncUnit(matchedUnit, payload.sheetName);
    }
  }

  /**
   * Directly updates in-memory snapshot for a sheet tab (e.g. after bot API write/delete)
   */
  updateSnapshot(spreadsheetId: string, sheetName: string, rows: string[][]): void {
    let unitSnapshots = this.snapshots.get(spreadsheetId);
    if (!unitSnapshots) {
      unitSnapshots = new Map();
      this.snapshots.set(spreadsheetId, unitSnapshots);
    }
    unitSnapshots.set(
      sheetName,
      rows.map((r) => r.map((c) => (c !== null && c !== undefined ? String(c).trim() : "")))
    );
  }
}

// Singleton instance
let deltaSyncInstance: DeltaSyncDaemon | null = null;

export function getDeltaSyncDaemon(sheetsService?: GoogleSheetsService): DeltaSyncDaemon {
  if (!deltaSyncInstance) {
    deltaSyncInstance = new DeltaSyncDaemon(sheetsService);
  }
  return deltaSyncInstance;
}

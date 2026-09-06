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
          SHEET_NAMES.PAGU_RINCIAN,
          SHEET_NAMES.PENGELUARAN_SUPPLIER,
          SHEET_NAMES.PAGU_RINGKASAN,
          SHEET_NAMES.REKAP_MARGIN,
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
    const maxRows = Math.max(prevRows.length, currentRows.length);
    const supabase = getSupabaseClient();

    for (let rIdx = 0; rIdx < maxRows; rIdx++) {
      const prevRow = prevRows[rIdx] || [];
      const currRow = currentRows[rIdx] || [];

      // If both rows are completely empty, skip
      if (prevRow.length === 0 && currRow.length === 0) continue;

      const refId = currRow[0] || currRow[1] || prevRow[0] || prevRow[1] || `Baris ${rIdx + 2}`;
      const maxCols = Math.max(prevRow.length, currRow.length);

      for (let cIdx = 0; cIdx < maxCols; cIdx++) {
        const oldVal = prevRow[cIdx] ?? "";
        const newVal = currRow[cIdx] ?? "";

        // Value changed!
        if (oldVal !== newVal) {
          // Skip trivial blank-to-empty diffs
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

          // 1. Record to Master Dashboard 04_LOG_AKTIVITAS
          await this.sheetsService.appendMasterAuditLog({
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

          // 2. Record to Supabase sppg_audit_logs table (safe insert)
          try {
            await supabase.from("sppg_audit_logs").insert({
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
          } catch (dbErr: any) {
            logger.debug({ err: dbErr?.message }, "[Delta Sync] Non-critical DB log note");
          }

          // 3. Automated Cascading Reconciliations
          // CASE A: Total Nominal Tagihan in 04_PENGELUARAN_SUPPLIER (Col F / index 5) changed
          if (sheetName === SHEET_NAMES.PENGELUARAN_SUPPLIER && cIdx === 5) {
            const newAmount = parseNum(newVal);
            const expenseId = currRow[1] || currRow[0];
            if (expenseId && newAmount >= 0) {
              await this.sheetsService.updateMasterTransactionRow(expenseId, {
                total_amount: newAmount,
              });

              // Update Supabase supplier expenses if exists
              try {
                await supabase
                  .from("sppg_supplier_expenses")
                  .update({ total_amount: newAmount })
                  .or(`sppg_id.eq.${unit.id},sppg_ref_no.eq.${expenseId}`);
              } catch (_) {}
            }
          }

          // CASE B: Total Pagu Anggaran in 02_PAGU_RINGKASAN (Col F / index 5) changed
          if (sheetName === SHEET_NAMES.PAGU_RINGKASAN && cIdx === 5) {
            const newPaguAmount = parseNum(newVal);
            const orderNo = currRow[0];
            if (orderNo && newPaguAmount >= 0) {
              await this.sheetsService.updateMasterTransactionRow(orderNo, {
                total_amount: newPaguAmount,
              });

              // Update Supabase order total
              try {
                await supabase
                  .from("sppg_orders")
                  .update({ total_amount: newPaguAmount })
                  .eq("order_no", orderNo);
              } catch (_) {}
            }
          }

          // CASE C: Item price or qty in 03_PAGU_RINCIAN changed
          if (sheetName === SHEET_NAMES.PAGU_RINCIAN && (cIdx === 5 || cIdx === 7)) {
            const orderNo = currRow[0];
            const itemName = currRow[4];
            if (orderNo && itemName) {
              try {
                const qty = parseNum(currRow[5]);
                const price = parseNum(currRow[7]);
                const total = qty * price;
                await supabase
                  .from("sppg_order_items")
                  .update({ qty, price, total_price: total })
                  .eq("item_name", itemName);
              } catch (_) {}
            }
          }
        }
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
}

// Singleton instance
let deltaSyncInstance: DeltaSyncDaemon | null = null;

export function getDeltaSyncDaemon(sheetsService?: GoogleSheetsService): DeltaSyncDaemon {
  if (!deltaSyncInstance) {
    deltaSyncInstance = new DeltaSyncDaemon(sheetsService);
  }
  return deltaSyncInstance;
}

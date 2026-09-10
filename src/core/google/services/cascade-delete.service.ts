import { sheets_v4 } from "googleapis";
import { env } from "../../../config/env.js";
import { logger } from "../../utils/logger.js";
import { SHEET_NAMES } from "../recipes/index.js";
import { SheetsClientProvider, parseCurrencyNumber } from "./sheets-client.provider.js";
import { ReportingService } from "./reporting.service.js";
import { MasterSyncService } from "./master-sync.service.js";

export class CascadeDeleteService {
  constructor(
    private clientProvider: SheetsClientProvider,
    private reportingService: ReportingService,
    private masterSyncService: MasterSyncService,
    private ensureStructureFn: (spreadsheetId: string) => Promise<void>
  ) {}

  private async getClient(): Promise<sheets_v4.Sheets> {
    return this.clientProvider.getClient();
  }

  private async ensure5TabStructure(spreadsheetId: string): Promise<void> {
    return this.ensureStructureFn(spreadsheetId);
  }

  private async getTransactionDetail(spreadsheetId: string, transactionId: string) {
    return this.reportingService.getTransactionDetail(spreadsheetId, transactionId);
  }

  private async deleteMasterTransactionRow(transactionId: string, orderNo?: string) {
    return this.masterSyncService.deleteMasterTransactionRow(transactionId, orderNo);
  }

  private async updateMasterTransactionRow(transactionId: string, updates: any) {
    return this.masterSyncService.updateMasterTransactionRow(transactionId, updates);
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
      rincianPengeluaranCount?: number;
      rekapCount: number;
      resetRekapCount: number;
    };
    warningMessage?: string;
  }> {
    const detail = await this.getTransactionDetail(spreadsheetId, transactionId);
    if (!detail.found || !detail.sheetName || !detail.rowIndex) {
      return { found: false, canDelete: false };
    }

    if (detail.sheetName === SHEET_NAMES.RINCIAN_PENGELUARAN) {
      return {
        found: true,
        canDelete: false,
        isProtected: true,
        sheetName: detail.sheetName,
        orderNo: detail.orderNo,
        transactionId: detail.id,
        amount: detail.amount,
        items: detail.items,
        warningMessage: `⛔ Data Terproteksi: Rincian Pengeluaran (Tab 05) adalah data turunan dan terikat langsung dengan Pagu Pengeluaran di Tab 04. Rincian tidak dapat dihapus mandiri. Silakan kelola melalui Pagu Pengeluaran di Tab 04 (${detail.orderNo || "Tab 04"}).`,
      };
    }

    if (detail.sheetName === SHEET_NAMES.RINCIAN_PENDAPATAN || detail.sheetName === SHEET_NAMES.PAGU_RINCIAN || detail.isProtected) {
      return {
        found: true,
        canDelete: false,
        isProtected: true,
        sheetName: detail.sheetName,
        orderNo: detail.orderNo,
        transactionId: detail.id,
        amount: detail.amount,
        items: detail.items,
        warningMessage: `⛔ Data Terproteksi: Rincian Pendapatan (Tab 03) adalah data turunan dan terikat langsung dengan Pagu Penerimaan di Tab 02. Rincian tidak dapat dihapus mandiri. Silakan kelola melalui Pagu Penerimaan (${detail.orderNo || "Tab 02"}).`,
      };
    }

    const client = await this.getClient();

    // 1. Pagu Induk (Tab 02) -> Cascade delete children in 03, 04, 05, 06
    if (detail.sheetName === SHEET_NAMES.PAGU_PENERIMAAN || detail.sheetName === SHEET_NAMES.PAGU_RINGKASAN || detail.sheetName === "02_PENDAPATAN_SPPG") {
      const orderNo = detail.orderNo || "";
      const orderId = detail.id;

      let rincianCount = 0;
      let expenseCount = 0;
      let rincianExpenseCount = 0;
      let rekapCount = 0;

      // Check Tab 03
      try {
        const rRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.RINCIAN_PENDAPATAN}'!A:B`,
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
          range: `'${SHEET_NAMES.PAGU_PENGELUARAN}'!A:B`,
        });
        const rows = eRes.data.values || [];
        expenseCount = rows.filter((r) => {
          const c0 = String(r[0] || "").trim();
          const c1 = String(r[1] || "").trim();
          return (orderNo && c0 === orderNo) || (orderId && c1 === orderId);
        }).length;
      } catch {}

      // Check Tab 05 (Rincian Pengeluaran)
      try {
        const reRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A:B`,
        });
        const rows = reRes.data.values || [];
        rincianExpenseCount = rows.filter((r) => {
          const c0 = String(r[0] || "").trim();
          return (orderNo && c0 === orderNo) || (orderId && c0 === orderId);
        }).length;
      } catch {}

      // Check Tab 06 (Perbandingan Margin)
      try {
        const mRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A:A`,
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
          rincianPengeluaranCount: rincianExpenseCount,
          rekapCount,
          resetRekapCount: 0,
        },
        warningMessage: `⚠️ Menghapus Pagu Induk ini akan MENGHAPUS SEMUA data turunannya:\n• Tab 03 (Rincian Pendapatan): ${rincianCount} item\n• Tab 04 (Pagu Pengeluaran): ${expenseCount} transaksi nota\n• Tab 05 (Rincian Pengeluaran): ${rincianExpenseCount} baris belanja\n• Tab 06 (Perbandingan Margin): ${rekapCount} baris komparasi`,
      };
    }

    // 2. Pengeluaran Supplier (Tab 04) -> Cascade delete in 05 & reset in 06
    if (
      detail.sheetName === SHEET_NAMES.PAGU_PENGELUARAN ||
      detail.sheetName === SHEET_NAMES.PENGELUARAN_SUPPLIER ||
      detail.sheetName === "03_PENGELUARAN_SUPPLIER"
    ) {
      const orderNo = detail.orderNo || "";
      const supplierName = detail.supplierOrUnit || "";

      let rincianExpenseCount = 0;
      let resetRekapCount = 0;
      let deletedRekapCount = 0;

      // Check Tab 05 child items
      try {
        const reRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A:B`,
        });
        const rows = reRes.data.values || [];
        rincianExpenseCount = rows.filter((r) => {
          const c1 = String(r[1] || "").trim();
          return detail.id && c1 === detail.id;
        }).length;
      } catch {}

      // Check Tab 06
      try {
        const mRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A:J`,
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
          rincianPengeluaranCount: rincianExpenseCount,
          rekapCount: deletedRekapCount,
          resetRekapCount,
        },
        warningMessage: `ℹ️ Menghapus nota ini akan menghapus ${rincianExpenseCount} baris rincian di Tab 05, serta mengosongkan/mereset realisasi di Tab 06 (Perbandingan Margin) sebanyak ${resetRekapCount} item kembali ke status 'Menunggu Invoice'${deletedRekapCount > 0 ? ` dan menghapus ${deletedRekapCount} item belanja tambahan` : ""}.`,
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

    // Guard: Child rincian sheets are protected from standalone deletion
    if (
      detail.sheetName === SHEET_NAMES.RINCIAN_PENGELUARAN ||
      detail.sheetName === SHEET_NAMES.RINCIAN_PENDAPATAN ||
      detail.sheetName === SHEET_NAMES.PAGU_RINCIAN ||
      detail.isProtected
    ) {
      const tabName = detail.sheetName === SHEET_NAMES.RINCIAN_PENGELUARAN ? "Rincian Pengeluaran (Tab 05)" : "Rincian Pendapatan (Tab 03)";
      const parentTab = detail.sheetName === SHEET_NAMES.RINCIAN_PENGELUARAN ? "Pagu Pengeluaran di Tab 04" : `Pagu Penerimaan (${detail.orderNo || "Tab 02"})`;
      return {
        success: false,
        isProtected: true,
        message: `⛔ ${tabName} adalah data turunan dan terproteksi. Data ini tidak dapat dihapus mandiri karena terikat langsung dengan data induknya. Silakan kelola melalui ${parentTab}.`,
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
      // CASE 1: 02_PAGU_PENERIMAAN (Cascade Delete 02 -> 03, 04, 05, 06)
      // =========================================================================
      if (
        detail.sheetName === SHEET_NAMES.PAGU_PENERIMAAN ||
        detail.sheetName === SHEET_NAMES.PAGU_RINGKASAN ||
        detail.sheetName === "02_PENDAPATAN_SPPG"
      ) {
        const orderNo = (detail.orderNo || "").trim();
        const orderId = detail.id;
        const deleteRequests: sheets_v4.Schema$Request[] = [];

        let deletedRincian = 0;
        let deletedExpense = 0;
        let deletedRincianExpense = 0;
        let deletedRekap = 0;

        // 1. Tab 03 (RINCIAN_PENDAPATAN)
        const rincianSheetId = sheetMap.get(SHEET_NAMES.RINCIAN_PENDAPATAN) ?? sheetMap.get("03_PAGU_RINCIAN");
        const deletedItemNames = new Set<string>();
        if (typeof rincianSheetId === "number") {
          const rRes = await client.spreadsheets.values.get({
            spreadsheetId,
            range: `'${SHEET_NAMES.RINCIAN_PENDAPATAN}'!A:E`,
          }).catch(() => ({ data: { values: null } }));
          const rows = rRes.data?.values || [];
          const indicesToDelete: number[] = [];
          for (let i = 0; i < rows.length; i++) {
            const c0 = String(rows[i]?.[0] || "").trim();
            const c1 = String(rows[i]?.[1] || "").trim();
            const itemName = String(rows[i]?.[4] || "").trim().toLowerCase();
            if (orderId ? c1 === orderId : (orderNo && c0 === orderNo)) {
              indicesToDelete.push(i);
              if (itemName) deletedItemNames.add(itemName);
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

        // 2. Tab 04 (PAGU_PENGELUARAN)
        const expenseSheetName = sheetMap.has(SHEET_NAMES.PAGU_PENGELUARAN)
          ? SHEET_NAMES.PAGU_PENGELUARAN
          : "04_PENGELUARAN_SUPPLIER";
        const expenseSheetId = sheetMap.get(expenseSheetName) ?? sheetMap.get("03_PENGELUARAN_SUPPLIER");
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
            if (orderId ? c1 === orderId : (orderNo && c0 === orderNo)) {
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

        // 3. Tab 05 (RINCIAN_PENGELUARAN)
        const rincianExpSheetId = sheetMap.get(SHEET_NAMES.RINCIAN_PENGELUARAN);
        if (typeof rincianExpSheetId === "number") {
          const reRes = await client.spreadsheets.values.get({
            spreadsheetId,
            range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A:B`,
          }).catch(() => ({ data: { values: null } }));
          const rows = reRes.data?.values || [];
          const indicesToDelete: number[] = [];
          for (let i = 0; i < rows.length; i++) {
            const c0 = String(rows[i]?.[0] || "").trim();
            const c1 = String(rows[i]?.[1] || "").trim();
            if (orderId ? c1 === orderId : (orderNo && c0 === orderNo)) {
              indicesToDelete.push(i);
            }
          }
          indicesToDelete.sort((a, b) => b - a).forEach((idx) => {
            deleteRequests.push({
              deleteDimension: {
                range: {
                  sheetId: rincianExpSheetId,
                  dimension: "ROWS",
                  startIndex: idx,
                  endIndex: idx + 1,
                },
              },
            });
          });
          deletedRincianExpense = indicesToDelete.length;
        }

        // 4. Tab 06 (PERBANDINGAN_MARGIN)
        const rekapSheetName = sheetMap.has(SHEET_NAMES.PERBANDINGAN_MARGIN)
          ? SHEET_NAMES.PERBANDINGAN_MARGIN
          : "05_REKAP_MARGIN";
        const rekapSheetId = sheetMap.get(rekapSheetName) ?? sheetMap.get("04_REKAP_MARGIN_HARIAN");
        if (typeof rekapSheetId === "number") {
          const mRes = await client.spreadsheets.values.get({
            spreadsheetId,
            range: `'${rekapSheetName}'!A:D`,
          }).catch(() => ({ data: { values: null } }));
          const rows = mRes.data?.values || [];
          const indicesToDelete: number[] = [];
          for (let i = 0; i < rows.length; i++) {
            const c0 = String(rows[i]?.[0] || "").trim();
            const rekapItemName = String(rows[i]?.[3] || "").trim().toLowerCase();
            if (orderNo && c0 === orderNo) {
              if (orderId && deletedItemNames.size > 0) {
                if (deletedItemNames.has(rekapItemName)) {
                  indicesToDelete.push(i);
                }
              } else {
                indicesToDelete.push(i);
              }
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

        // 5. Tab 02 (PAGU_PENERIMAAN) - The Parent Row
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
          { orderNo, orderId, deletedRincian, deletedExpense, deletedRincianExpense, deletedRekap },
          "Executed atomic Cascade Delete for Pagu Induk"
        );

        if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
          await this.deleteMasterTransactionRow(orderId || transactionId, orderNo);
        }

        return {
          success: true,
          message: `✅ Pagu Induk <b>${orderNo || transactionId}</b> berhasil dihapus beserta seluruh data anak:\n• Tab 03 (Rincian Pendapatan): ${deletedRincian} item bahan\n• Tab 04 (Pagu Pengeluaran): ${deletedExpense} transaksi nota\n• Tab 05 (Rincian Pengeluaran): ${deletedRincianExpense} baris belanja\n• Tab 06 (Perbandingan Margin): ${deletedRekap} baris komparasi`,
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
      // CASE 2: 04_PAGU_PENGELUARAN (Cascade Delete in 05 & Reset in 06)
      // =========================================================================
      if (
        detail.sheetName === SHEET_NAMES.PAGU_PENGELUARAN ||
        detail.sheetName === SHEET_NAMES.PENGELUARAN_SUPPLIER ||
        detail.sheetName === "03_PENGELUARAN_SUPPLIER"
      ) {
        const orderNo = (detail.orderNo || "").trim();
        const expenseId = (detail.id || "").trim();
        const supplierName = (detail.supplierOrUnit || "").trim().toLowerCase();
        const deleteRequests: sheets_v4.Schema$Request[] = [];
        const cellResets: Array<{ rowNum: number; originalSupplier: string }> = [];
        const rekapIndicesToDelete: number[] = [];

        // 1. Delete child items in Tab 05 (RINCIAN_PENGELUARAN) matching expenseId (Col B)
        let deletedRincianExpense = 0;
        const rincianExpSheetId = sheetMap.get(SHEET_NAMES.RINCIAN_PENGELUARAN);
        if (typeof rincianExpSheetId === "number" && expenseId) {
          const reRes = await client.spreadsheets.values.get({
            spreadsheetId,
            range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A:B`,
          }).catch(() => ({ data: { values: null } }));
          const rows = reRes.data?.values || [];
          const indicesToDelete: number[] = [];
          for (let i = 0; i < rows.length; i++) {
            const c1 = String(rows[i]?.[1] || "").trim();
            if (c1 === expenseId) {
              indicesToDelete.push(i);
            }
          }
          indicesToDelete.sort((a, b) => b - a).forEach((idx) => {
            deleteRequests.push({
              deleteDimension: {
                range: {
                  sheetId: rincianExpSheetId,
                  dimension: "ROWS",
                  startIndex: idx,
                  endIndex: idx + 1,
                },
              },
            });
          });
          deletedRincianExpense = indicesToDelete.length;
        }

        // 2. Reset or delete rows in Tab 06 (PERBANDINGAN_MARGIN)
        const rekapSheetName = sheetMap.has(SHEET_NAMES.PERBANDINGAN_MARGIN)
          ? SHEET_NAMES.PERBANDINGAN_MARGIN
          : "05_REKAP_MARGIN";
        const rekapSheetId = sheetMap.get(rekapSheetName) ?? sheetMap.get("04_REKAP_MARGIN_HARIAN");

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

        // Reset cells in Tab 06 FIRST (before any rows shift)
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

        // Add delete requests for extra rows in Tab 06 (sorted descending)
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
          { transactionId, supplierName, deletedRincianExpense, cellResets: cellResets.length, deletedRekap: rekapIndicesToDelete.length },
          "Deleted expense and cascade-reset 06_PERBANDINGAN_MARGIN"
        );

        if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
          await this.deleteMasterTransactionRow(transactionId);
        }

        return {
          success: true,
          message: `✅ Nota Pengeluaran <code>${transactionId}</code> berhasil dihapus dari Google Sheets. Rincian di Tab 05 (${deletedRincianExpense} baris) telah dihapus, dan Tab 06 (Perbandingan Margin) telah di-reset (${cellResets.length} item kembali ke status Menunggu Invoice${rekapIndicesToDelete.length > 0 ? `, ${rekapIndicesToDelete.length} item tambahan dihapus` : ""}).`,
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

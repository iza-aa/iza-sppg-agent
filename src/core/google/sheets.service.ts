import { sheets_v4 } from "googleapis";
import { env } from "../../config/env.js";
import { logger } from "../utils/logger.js";
import { SppgOrder } from "../ai/schemas/sppg-order.schema.js";
import { SupplierReceipt } from "../ai/schemas/supplier-receipt.schema.js";
import {
  SHEET_NAMES,
  SHEET_IDS,
  hexToRgbColor,
  BGN_PALETTE,
} from "./recipes/index.js";
import {
  SheetsClientProvider,
  parseCurrencyNumber,
  MasterSyncService,
  type MasterAuditLogEntry,
  ReportingService,
  CascadeDeleteService,
  MarginSheetsService,
  type PaguCandidate,
  PaguSheetsService,
  type PaguOrderSummary,
  type PaguRincianItem,
  type FindPaguItemResult,
  ExpenseSheetsService,
  type ExpenseInsertionTarget,
  calculateExpenseInsertionTarget,
} from "./services/index.js";

// Re-export all domain types and utilities for backward compatibility
export {
  parseCurrencyNumber,
  type PaguCandidate,
  type PaguOrderSummary,
  type PaguRincianItem,
  type FindPaguItemResult,
  type ExpenseInsertionTarget,
  calculateExpenseInsertionTarget,
  type MasterAuditLogEntry,
};

/**
 * High-Level Unified Google Sheets Facade for MBG Assistant.
 * Delegates domain tasks to focused subservices while preserving
 * 100% backward compatibility for all callers and unit tests.
 */
export class GoogleSheetsService {
  private clientProvider = new SheetsClientProvider();
  private masterSync = new MasterSyncService(this.clientProvider);
  private reporting = new ReportingService(
    this.clientProvider,
    (id) => this.ensure5TabStructure(id)
  );
  private cascadeDelete = new CascadeDeleteService(
    this.clientProvider,
    this.reporting,
    this.masterSync,
    (id) => this.ensure5TabStructure(id)
  );
  private margin = new MarginSheetsService(
    this.clientProvider,
    (id) => this.ensure5TabStructure(id)
  );
  private pagu = new PaguSheetsService(
    this.clientProvider,
    this.masterSync,
    (id) => this.ensure5TabStructure(id),
    (id) => this.getPaguOrders(id),
    (id, orderNo) => this.getPaguOrderItems(id, orderNo)
  );
  private expense = new ExpenseSheetsService(
    this.clientProvider,
    this.masterSync,
    this.reporting,
    (id) => this.ensure5TabStructure(id)
  );

  /**
   * Returns an authenticated Google Sheets client instance.
   */
  async getClient(): Promise<sheets_v4.Sheets> {
    return this.clientProvider.getClient();
  }

  /**
   * Initializes the 5-Tab BGN structure on an operational spreadsheet if not already present
   */
  async ensure5TabStructure(spreadsheetId: string, forceReset = false): Promise<void> {
    if (this.clientProvider.isInitialized(spreadsheetId) && !forceReset) {
      return;
    }

    if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId === env.GOOGLE_SHEET_ID_MASTER) {
      await this.masterSync.ensureMasterDashboardStructure(spreadsheetId, forceReset);
      this.clientProvider.markInitialized(spreadsheetId);
      return;
    }

    const client = await this.clientProvider.getClient();

    try {
      const meta = await client.spreadsheets.get({ spreadsheetId });
      const sheetByTitle = new Map<string, number>();
      (meta.data.sheets || []).forEach((s) => {
        if (s.properties?.title && typeof s.properties?.sheetId === "number") {
          sheetByTitle.set(s.properties.title, s.properties.sheetId);
        }
      });

      // 1. Rename existing legacy tabs if needed (highest to lowest to avoid collision)
      const renameRequests: sheets_v4.Schema$Request[] = [];
      if ((sheetByTitle.has("06_MASTER_DATA") || sheetByTitle.has("05_MASTER_DATA")) && !sheetByTitle.has(SHEET_NAMES.MASTER_DATA)) {
        const id = sheetByTitle.get("06_MASTER_DATA") ?? sheetByTitle.get("05_MASTER_DATA")!;
        renameRequests.push({
          updateSheetProperties: {
            properties: { sheetId: id, title: SHEET_NAMES.MASTER_DATA },
            fields: "title",
          },
        });
      }
      if ((sheetByTitle.has("05_REKAP_MARGIN") || sheetByTitle.has("04_REKAP_MARGIN_HARIAN")) && !sheetByTitle.has(SHEET_NAMES.PERBANDINGAN_MARGIN)) {
        const id = sheetByTitle.get("05_REKAP_MARGIN") ?? sheetByTitle.get("04_REKAP_MARGIN_HARIAN")!;
        renameRequests.push({
          updateSheetProperties: {
            properties: { sheetId: id, title: SHEET_NAMES.PERBANDINGAN_MARGIN },
            fields: "title",
          },
        });
      }
      if ((sheetByTitle.has("04_PENGELUARAN_SUPPLIER") || sheetByTitle.has("03_PENGELUARAN_SUPPLIER")) && !sheetByTitle.has(SHEET_NAMES.PAGU_PENGELUARAN)) {
        const id = sheetByTitle.get("04_PENGELUARAN_SUPPLIER") ?? sheetByTitle.get("03_PENGELUARAN_SUPPLIER")!;
        renameRequests.push({
          updateSheetProperties: {
            properties: { sheetId: id, title: SHEET_NAMES.PAGU_PENGELUARAN },
            fields: "title",
          },
        });
      }
      if (sheetByTitle.has("03_PAGU_RINCIAN") && !sheetByTitle.has(SHEET_NAMES.RINCIAN_PENDAPATAN)) {
        renameRequests.push({
          updateSheetProperties: {
            properties: { sheetId: sheetByTitle.get("03_PAGU_RINCIAN")!, title: SHEET_NAMES.RINCIAN_PENDAPATAN },
            fields: "title",
          },
        });
      }
      if ((sheetByTitle.has("02_PAGU_RINGKASAN") || sheetByTitle.has("02_PENDAPATAN_SPPG")) && !sheetByTitle.has(SHEET_NAMES.PAGU_PENERIMAAN)) {
        const id = sheetByTitle.get("02_PAGU_RINGKASAN") ?? sheetByTitle.get("02_PENDAPATAN_SPPG")!;
        renameRequests.push({
          updateSheetProperties: {
            properties: { sheetId: id, title: SHEET_NAMES.PAGU_PENERIMAAN },
            fields: "title",
          },
        });
      }

      if (renameRequests.length > 0) {
        await client.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: renameRequests },
        });
        logger.info({ spreadsheetId, renamesCount: renameRequests.length }, "Migrated legacy tab titles to new 6-Tab format");
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
      if (!currentTitles.includes(SHEET_NAMES.RINCIAN_PENDAPATAN)) {
        const props: sheets_v4.Schema$SheetProperties = {
          title: SHEET_NAMES.RINCIAN_PENDAPATAN,
          index: 2,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.EMBLEM_GOLD) },
          gridProperties: { rowCount: 5000, columnCount: 10, frozenRowCount: 1 },
        };
        if (!existingSheetIds.has(SHEET_IDS.RINCIAN_PENDAPATAN)) {
          props.sheetId = SHEET_IDS.RINCIAN_PENDAPATAN;
        }
        addRequests.push({ addSheet: { properties: props } });
      }
      if (!currentTitles.includes(SHEET_NAMES.RINCIAN_PENGELUARAN)) {
        const props: sheets_v4.Schema$SheetProperties = {
          title: SHEET_NAMES.RINCIAN_PENGELUARAN,
          index: 4,
          tabColorStyle: { rgbColor: hexToRgbColor("#E65100") },
          gridProperties: { rowCount: 5000, columnCount: 10, frozenRowCount: 1 },
        };
        if (!existingSheetIds.has(SHEET_IDS.RINCIAN_PENGELUARAN)) {
          props.sheetId = SHEET_IDS.RINCIAN_PENGELUARAN;
        }
        addRequests.push({ addSheet: { properties: props } });
      }
      if (!currentTitles.includes(SHEET_NAMES.PERBANDINGAN_MARGIN)) {
        const props: sheets_v4.Schema$SheetProperties = {
          title: SHEET_NAMES.PERBANDINGAN_MARGIN,
          index: 5,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.FOREST_GREEN) },
          gridProperties: { rowCount: 5000, columnCount: 13, frozenRowCount: 1 },
        };
        if (!existingSheetIds.has(SHEET_IDS.PERBANDINGAN_MARGIN)) {
          props.sheetId = SHEET_IDS.PERBANDINGAN_MARGIN;
        }
        addRequests.push({ addSheet: { properties: props } });
      }
      if (!currentTitles.includes(SHEET_NAMES.MASTER_DATA)) {
        const props: sheets_v4.Schema$SheetProperties = {
          title: SHEET_NAMES.MASTER_DATA,
          index: 6,
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
      const unitName = this.clientProvider.getUnitNameFromSpreadsheetId(spreadsheetId);
      await this.clientProvider.ensureHeadersAndFormulas(spreadsheetId, unitName, forceReset);
      await this.clientProvider.applyBandingToMissingSheets(spreadsheetId);
      await this.expense.backfillRincianPengeluaranIfEmpty(spreadsheetId);
      this.clientProvider.markInitialized(spreadsheetId);
    } catch (err: any) {
      logger.warn({ err: err?.message || err, spreadsheetId }, "Note during 5-tab verification");
    }
  }

  async warmUp(spreadsheetIds: string[]): Promise<void> {
    return this.clientProvider.warmUp(spreadsheetIds, (id) => this.ensure5TabStructure(id));
  }

  async ensureHeadersAndFormulas(spreadsheetId: string, unitName = "SPPG Unit", force = false): Promise<void> {
    return this.clientProvider.ensureHeadersAndFormulas(spreadsheetId, unitName, force);
  }

  async applyBandingToMissingSheets(spreadsheetId: string): Promise<void> {
    return this.clientProvider.applyBandingToMissingSheets(spreadsheetId);
  }

  async backfillRincianPengeluaranIfEmpty(spreadsheetId: string): Promise<void> {
    return this.expense.backfillRincianPengeluaranIfEmpty(spreadsheetId);
  }

  async ensureMasterDashboardStructure(spreadsheetId: string, force = false): Promise<void> {
    return this.masterSync.ensureMasterDashboardStructure(spreadsheetId, force);
  }

  async ensureGuidelineTab(spreadsheetId: string, unitName?: string, force = false): Promise<void> {
    return this.clientProvider.ensureGuidelineTab(spreadsheetId, unitName, force);
  }

  async appendMasterAuditLog(entry: MasterAuditLogEntry): Promise<void> {
    return this.masterSync.appendMasterAuditLog(entry);
  }

  async appendMasterAuditLogsBatch(entries: MasterAuditLogEntry[]): Promise<void> {
    return this.masterSync.appendMasterAuditLogsBatch(entries);
  }

  getUnitNameFromSpreadsheetId(spreadsheetId: string): string {
    return this.clientProvider.getUnitNameFromSpreadsheetId(spreadsheetId);
  }

  getUnitCodeFromSpreadsheetId(spreadsheetId: string): string {
    return this.clientProvider.getUnitCodeFromSpreadsheetId(spreadsheetId);
  }

  generateTransactionId(
    unitCode: string,
    dateIso: string,
    counter: number,
    type: "income" | "expense"
  ): string {
    return this.clientProvider.generateTransactionId(unitCode, dateIso, counter, type);
  }

  async recordToMasterConsolidated(rows: any[][]): Promise<void> {
    return this.masterSync.recordToMasterConsolidated(rows);
  }

  async deleteMasterTransactionRow(transactionId: string, orderNo?: string): Promise<void> {
    return this.masterSync.deleteMasterTransactionRow(transactionId, orderNo);
  }

  async updateMasterTransactionRow(transactionId: string, updates: any): Promise<void> {
    return this.masterSync.updateMasterTransactionRow(transactionId, updates);
  }

  async syncAllUnitsToMaster(forceReset = false): Promise<{ syncedCount: number }> {
    return this.masterSync.syncAllUnitsToMaster(forceReset);
  }

  async recordSppgOrder(
    spreadsheetId: string,
    order: SppgOrder,
    driveLink?: string,
    rawCaption?: string,
    picName?: string
  ): Promise<void> {
    return this.pagu.recordSppgOrder(spreadsheetId, order, driveLink, rawCaption, picName);
  }

  async recordSupplierExpense(
    spreadsheetId: string,
    receipt: SupplierReceipt,
    driveLink: string = "",
    picName: string = "Staff",
    rawCaption?: string
  ): Promise<void> {
    return this.expense.recordSupplierExpense(spreadsheetId, receipt, driveLink, picName, rawCaption);
  }

  async recordSupplierExpenseBatch(
    spreadsheetId: string,
    receipts: SupplierReceipt[],
    picName: string,
    rawCaption?: string
  ): Promise<{ recordedCount: number; totalAmount: number }> {
    return this.expense.recordSupplierExpenseBatch(spreadsheetId, receipts, picName, rawCaption);
  }

  async getPaguCandidatesForCommodity(spreadsheetId: string, itemName: string): Promise<PaguCandidate[]> {
    return this.margin.getPaguCandidatesForCommodity(spreadsheetId, itemName);
  }

  async getExecutiveKpi(spreadsheetId: string, orderNo?: string) {
    return this.reporting.getExecutiveKpi(spreadsheetId, orderNo);
  }

  async getExpensesForReport(spreadsheetId: string, datePrefix?: string) {
    return this.reporting.getExpensesForReport(spreadsheetId, datePrefix);
  }

  async getRecentTransactions(spreadsheetId: string, limit = 10) {
    return this.reporting.getRecentTransactions(spreadsheetId, limit);
  }

  getTransactionDetail = async (spreadsheetId: string, transactionId: string) => {
    return this.reporting.getTransactionDetail(spreadsheetId, transactionId);
  };

  findTransactionById = this.getTransactionDetail;

  async getCascadeDeletePreview(spreadsheetId: string, transactionId: string) {
    return this.cascadeDelete.getCascadeDeletePreview(spreadsheetId, transactionId);
  }

  async deleteTransactionRow(spreadsheetId: string, transactionId: string) {
    return this.cascadeDelete.deleteTransactionRow(spreadsheetId, transactionId);
  }

  async updateTransactionRow(
    spreadsheetId: string,
    transactionId: string,
    updates: {
      total_amount?: number;
      supplier_name?: string;
      notes?: string;
    }
  ) {
    return this.cascadeDelete.updateTransactionRow(spreadsheetId, transactionId, updates);
  }

  async getPaguOrders(spreadsheetId: string): Promise<PaguOrderSummary[]> {
    return this.pagu.getPaguOrders(spreadsheetId);
  }

  async getPaguOrderItems(spreadsheetId: string, orderNo: string): Promise<PaguRincianItem[]> {
    return this.pagu.getPaguOrderItems(spreadsheetId, orderNo);
  }

  async getPaguItemByRow(spreadsheetId: string, itemRowIndex: number): Promise<PaguRincianItem | null> {
    return this.pagu.getPaguItemByRow(spreadsheetId, itemRowIndex);
  }

  async updatePaguItemDetail(
    spreadsheetId: string,
    orderNo: string,
    itemRowIndex: number,
    updates: { itemName?: string; qty?: number; unit?: string; price?: number; supplier?: string },
    updatedBy = "Telegram User"
  ) {
    return this.pagu.updatePaguItemDetail(spreadsheetId, orderNo, itemRowIndex, updates, updatedBy);
  }

  async cascadePaguRincianChangeToRekapMargin(
    spreadsheetId: string,
    orderNo: string,
    origItemName: string,
    colIndex: number,
    newValue: any
  ): Promise<boolean> {
    return this.margin.cascadePaguRincianChangeToRekapMargin(spreadsheetId, orderNo, origItemName, colIndex, newValue);
  }

  async cascadeRincianPengeluaranChangeToRekapMargin(
    spreadsheetId: string,
    orderNo: string,
    origItemName: string,
    colIndex: number,
    newValue: any
  ): Promise<boolean> {
    return this.margin.cascadeRincianPengeluaranChangeToRekapMargin(spreadsheetId, orderNo, origItemName, colIndex, newValue);
  }

  async findPaguItemByQuery(spreadsheetId: string, orderRef?: string, itemName?: string): Promise<FindPaguItemResult> {
    return this.pagu.findPaguItemByQuery(spreadsheetId, orderRef, itemName);
  }

  async addPaguItemToOrder(
    spreadsheetId: string,
    orderNo: string,
    newItem: { itemName: string; qty: number; unit?: string; price: number; supplier?: string },
    addedBy = "Telegram User"
  ) {
    return this.pagu.addPaguItemToOrder(spreadsheetId, orderNo, newItem, addedBy);
  }

  insertPaguItemToOrder = this.addPaguItemToOrder;

  async appendOrInsertRincianPengeluaranRows(
    spreadsheetId: string,
    expenseId: string,
    items: Array<{
      itemName: string;
      qty: number;
      unit?: string;
      price: number;
      supplier?: string;
      notes?: string;
      sppgRefNo?: string;
      receiptNo?: string;
    }>
  ) {
    return this.expense.appendOrInsertRincianPengeluaranRows(spreadsheetId, expenseId, items);
  }

  async addExpenseItemToTransaction(
    spreadsheetId: string,
    expenseId: string,
    item: {
      itemName: string;
      qty: number;
      unit?: string;
      price: number;
      supplier?: string;
      notes?: string;
    },
    addedBy = "Telegram User",
    options?: {
      isNonPagu?: boolean;
    }
  ) {
    return this.expense.addExpenseItemToTransaction(spreadsheetId, expenseId, item, addedBy, options);
  }

  async findExpenseChildItem(spreadsheetId: string, expenseId: string, itemName: string) {
    return this.expense.findExpenseChildItem(spreadsheetId, expenseId, itemName);
  }

  async getExpenseChildItems(spreadsheetId: string, expenseId: string) {
    return this.expense.getExpenseChildItems(spreadsheetId, expenseId);
  }

  async deleteExpenseChildItem(
    spreadsheetId: string,
    expenseId: string,
    itemName: string,
    deletedBy = "Telegram User"
  ) {
    return this.expense.deleteExpenseChildItem(spreadsheetId, expenseId, itemName, deletedBy);
  }

  async deleteMultipleExpenseChildItems(
    spreadsheetId: string,
    expenseId: string,
    itemNames: string[],
    deletedBy = "Telegram User"
  ) {
    return this.expense.deleteMultipleExpenseChildItems(spreadsheetId, expenseId, itemNames, deletedBy);
  }

  async findPaguChildItem(spreadsheetId: string, orderNo: string, itemName: string) {
    return this.pagu.findPaguChildItem(spreadsheetId, orderNo, itemName);
  }

  async deletePaguChildItem(
    spreadsheetId: string,
    orderNo: string,
    itemName: string,
    deletedBy = "Telegram User"
  ) {
    return this.pagu.deletePaguChildItem(spreadsheetId, orderNo, itemName, deletedBy);
  }
}

export const googleSheetsService = new GoogleSheetsService();

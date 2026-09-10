import { sheets_v4 } from "googleapis";
import { env } from "../../../config/env.js";
import { logger } from "../../utils/logger.js";
import { SppgOrder } from "../../ai/schemas/sppg-order.schema.js";
import { SHEET_NAMES, SHEET_IDS } from "../recipes/index.js";
import { getSupabaseClient } from "../../db/supabase.js";
import { SheetsClientProvider, parseCurrencyNumber } from "./sheets-client.provider.js";
import { MasterSyncService, MasterAuditLogEntry } from "./master-sync.service.js";

export interface PaguOrderSummary {
  orderNo: string;
  transactionId?: string;
  orderDate: string;
  itemCount: string;
  totalAmount: number;
  link?: string;
  notes?: string;
}

export interface PaguRincianItem {
  orderNo: string;
  transactionId: string;
  itemIndex: number;
  rowIndex: number;
  supplier: string;
  itemName: string;
  qty: number;
  unit: string;
  price: number;
  totalAmount: number;
  notes?: string;
}

export interface FindPaguItemResult {
  order: PaguOrderSummary | null;
  foundItem: PaguRincianItem | null;
  allItemsInOrder: PaguRincianItem[];
  matchingItems: PaguRincianItem[];
  availableOrders: PaguOrderSummary[];
}

export class PaguSheetsService {
  constructor(
    private clientProvider: SheetsClientProvider,
    private masterSyncService: MasterSyncService,
    private ensureStructureFn: (spreadsheetId: string) => Promise<void>,
    private fetchOrders?: (spreadsheetId: string) => Promise<PaguOrderSummary[]>,
    private fetchOrderItems?: (spreadsheetId: string, orderNo: string) => Promise<PaguRincianItem[]>
  ) {}

  private async getClient(): Promise<sheets_v4.Sheets> {
    return this.clientProvider.getClient();
  }

  private async ensure5TabStructure(spreadsheetId: string): Promise<void> {
    return this.ensureStructureFn(spreadsheetId);
  }

  private getUnitCodeFromSpreadsheetId(spreadsheetId: string): string {
    return this.clientProvider.getUnitCodeFromSpreadsheetId(spreadsheetId);
  }

  private getUnitNameFromSpreadsheetId(spreadsheetId: string): string {
    return this.clientProvider.getUnitNameFromSpreadsheetId(spreadsheetId);
  }

  private generateTransactionId(unitCode: string, dateIso: string, counter: number, type: "income" | "expense"): string {
    return this.clientProvider.generateTransactionId(unitCode, dateIso, counter, type);
  }

  private async appendRowsSafely(spreadsheetId: string, sheetName: string, rows: (string | number)[][]): Promise<number> {
    return this.clientProvider.appendRowsSafely(spreadsheetId, sheetName, rows);
  }

  private async updateCellSafely(spreadsheetId: string, range: string, value: any): Promise<void> {
    return this.clientProvider.updateCellSafely(spreadsheetId, range, value);
  }

  private async recordToMasterConsolidated(rows: any[][]): Promise<void> {
    return this.masterSyncService.recordToMasterConsolidated(rows);
  }

  private async appendMasterAuditLogsBatch(entries: any[]): Promise<void> {
    return this.masterSyncService.appendMasterAuditLogsBatch(entries);
  }

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

    // Count existing rows in 02_PAGU_PENERIMAAN for ID generation
    const colA = await client.spreadsheets.values
      .get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_PENERIMAAN}'!A:A`,
      })
      .catch(() => ({ data: { values: null } }));
    const existingCount = (colA.data?.values || []).length;
    const counter = Math.max(existingCount, 1);
    const orderId = this.generateTransactionId(unitCode, order.order_date, counter, "income");

    const uniqueSuppliers = new Set(order.items.map((i) => i.supplier_target).filter(Boolean));
    const supplierCountStr = `${uniqueSuppliers.size || 1} Supplier`;
    const driveLinkFormula = driveLink ? `=HYPERLINK("${driveLink}"; "Lihat Dokumen")` : "-";
    const ringkasanRowIdx = Math.max(existingCount + 1, 2);

    // 1. Row for 02_PAGU_PENERIMAAN (formula-driven for instant reactivity)
    const ringkasanRow = [
      order.order_no,                                             // A: No SPPG
      orderId,                                                    // B: ID Transaksi
      order.order_date,                                           // C: Tanggal Pesanan
      `=COUNTIF('${SHEET_NAMES.RINCIAN_PENDAPATAN}'!$A:$A; A${ringkasanRowIdx}) & " Item"`, // D: Jumlah Item Bahan
      supplierCountStr,                                           // E: Jumlah Target Supplier
      `=SUMIF('${SHEET_NAMES.RINCIAN_PENDAPATAN}'!$A:$A; A${ringkasanRowIdx}; '${SHEET_NAMES.RINCIAN_PENDAPATAN}'!$I:$I)`, // F: Total Pagu Anggaran
      driveLinkFormula,                                           // G: Link Bukti Dokumen
      rawCaption || order.notes || "-",                           // H: Pesan Asli Telegram
      order.signed_by || picName || "Kepala SPPG",               // I: PIC / Penanggung Jawab
      "-",                                                        // J: Riwayat Edit
    ];

    // Query 03_RINCIAN_PENDAPATAN count for row index calculation
    const rincianColA = await client.spreadsheets.values
      .get({
        spreadsheetId,
        range: `'${SHEET_NAMES.RINCIAN_PENDAPATAN}'!A:A`,
      })
      .catch(() => ({ data: { values: null } }));
    const rincianExistingCount = (rincianColA.data?.values || []).length;
    const rincianStartRow = Math.max(rincianExistingCount + 1, 2);

    // 2. Rows for 03_RINCIAN_PENDAPATAN (all items with formula on Col I)
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

    // 3. Rows for 06_PERBANDINGAN_MARGIN (Template awal pencocokan dengan status MENUNGGU INVOICE)
    const rekapColA = await client.spreadsheets.values
      .get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A:A`,
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
    await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PAGU_PENERIMAAN, [ringkasanRow]);
    await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.RINCIAN_PENDAPATAN, rincianRows);
    await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PERBANDINGAN_MARGIN, rekapRows);

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

  async getPaguOrders(spreadsheetId: string): Promise<PaguOrderSummary[]> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();
    try {
      const res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A2:H`,
      });
      const rows = res.data.values || [];
      const orders: PaguOrderSummary[] = [];
      for (const row of rows) {
        const orderNo = String(row[0] || "").trim();
        if (!orderNo || orderNo.startsWith("#") || orderNo.toLowerCase().includes("total")) continue;
        orders.push({
          orderNo,
          transactionId: String(row[1] || "").trim(),
          orderDate: String(row[2] || "").trim() || String(row[1] || "").trim(),
          itemCount: String(row[3] || "").trim() || "-",
          totalAmount: parseCurrencyNumber(row[5]),
          link: String(row[6] || "").trim(),
          notes: String(row[8] || "").trim() || String(row[7] || "").trim(),
        });
      }
      return orders;
    } catch (err: any) {
      logger.error({ err: err?.message, spreadsheetId }, "Failed to get Pagu orders list");
      return [];
    }
  }

  /**
   * Retrieves all detail ingredient items for a specific Pagu Order from 03_PAGU_RINCIAN
   */
  async getPaguOrderItems(spreadsheetId: string, orderNo: string): Promise<PaguRincianItem[]> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();
    try {
      const res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_RINCIAN}'!A2:J`,
      });
      const rows = res.data.values || [];
      const items: PaguRincianItem[] = [];
      const cleanOrderNo = orderNo.trim();

      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const rowOrderNo = String(row[0] || "").trim();
        if (rowOrderNo === cleanOrderNo) {
          const qty = parseCurrencyNumber(row[5]);
          const price = parseCurrencyNumber(row[7]);
          const totalAmount = parseCurrencyNumber(row[8]) || qty * price;
          items.push({
            orderNo: rowOrderNo,
            transactionId: String(row[1] || "").trim(),
            itemIndex: parseInt(String(row[2] || "0"), 10) || items.length + 1,
            rowIndex: idx + 2, // header is row 1
            supplier: String(row[3] || "").trim(),
            itemName: String(row[4] || "").trim(),
            qty,
            unit: String(row[6] || "").trim(),
            price,
            totalAmount,
            notes: String(row[9] || "").trim(),
          });
        }
      }
      return items;
    } catch (err: any) {
      logger.error({ err: err?.message, spreadsheetId, orderNo }, "Failed to get Pagu order items");
      return [];
    }
  }

  /**
   * Retrieves a single Pagu item by row index from 03_PAGU_RINCIAN
   */
  async getPaguItemByRow(spreadsheetId: string, itemRowIndex: number): Promise<PaguRincianItem | null> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();
    try {
      const res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_RINCIAN}'!A${itemRowIndex}:J${itemRowIndex}`,
      });
      const row = res.data.values?.[0];
      if (!row || !row[0]) return null;

      const qty = parseCurrencyNumber(row[5]);
      const price = parseCurrencyNumber(row[7]);
      const totalAmount = parseCurrencyNumber(row[8]) || qty * price;

      return {
        orderNo: String(row[0] || "").trim(),
        transactionId: String(row[1] || "").trim(),
        itemIndex: parseInt(String(row[2] || "0"), 10) || 1,
        rowIndex: itemRowIndex,
        supplier: String(row[3] || "").trim(),
        itemName: String(row[4] || "").trim(),
        qty,
        unit: String(row[6] || "").trim(),
        price,
        totalAmount,
        notes: String(row[9] || "").trim(),
      };
    } catch (err: any) {
      logger.error({ err: err?.message, spreadsheetId, itemRowIndex }, "Failed to get Pagu item by row");
      return null;
    }
  }

  /**
   * Updates an item's details in 03_PAGU_RINCIAN and cascades the update to 05_REKAP_MARGIN
   */
  async updatePaguItemDetail(
    spreadsheetId: string,
    orderNo: string,
    itemRowIndex: number,
    updates: {
      qty?: number;
      price?: number;
      supplier?: string;
      itemName?: string;
      unit?: string;
    },
    updatedBy = "Admin"
  ): Promise<{ success: boolean; message: string; updatedItem?: PaguRincianItem }> {
    const currentItem = await this.getPaguItemByRow(spreadsheetId, itemRowIndex);
    if (!currentItem) {
      return { success: false, message: `Baris rincian bahan #${itemRowIndex} tidak ditemukan di Tab 03.` };
    }

    if (currentItem.orderNo !== orderNo.trim()) {
      return { success: false, message: `Nomor PO tidak cocok dengan data di baris #${itemRowIndex}.` };
    }

    const client = await this.getClient();

    try {
      const batchUpdates: { range: string; values: any[][] }[] = [];
      const origItemName = currentItem.itemName;

      // 1. Prepare updates for 03_PAGU_RINCIAN
      if (updates.supplier !== undefined) {
        batchUpdates.push({
          range: `'${SHEET_NAMES.PAGU_RINCIAN}'!D${itemRowIndex}`,
          values: [[updates.supplier]],
        });
      }
      if (updates.itemName !== undefined) {
        batchUpdates.push({
          range: `'${SHEET_NAMES.PAGU_RINCIAN}'!E${itemRowIndex}`,
          values: [[updates.itemName]],
        });
      }
      if (updates.qty !== undefined) {
        batchUpdates.push({
          range: `'${SHEET_NAMES.PAGU_RINCIAN}'!F${itemRowIndex}`,
          values: [[updates.qty]],
        });
      }
      if (updates.unit !== undefined) {
        batchUpdates.push({
          range: `'${SHEET_NAMES.PAGU_RINCIAN}'!G${itemRowIndex}`,
          values: [[updates.unit]],
        });
      }
      if (updates.price !== undefined) {
        batchUpdates.push({
          range: `'${SHEET_NAMES.PAGU_RINCIAN}'!H${itemRowIndex}`,
          values: [[updates.price]],
        });
      }

      // Execute Tab 03 updates
      if (batchUpdates.length > 0) {
        await client.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: batchUpdates,
          },
        });
      }

      // 2. Cascade updates to 05_REKAP_MARGIN
      try {
        const rekapRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.REKAP_MARGIN}'!A2:G`,
        });
        const rekapRows = rekapRes.data.values || [];
        const cleanOrder = orderNo.trim();
        const cleanOrigName = origItemName.toLowerCase().trim();
        const rekapBatchUpdates: { range: string; values: any[][] }[] = [];

        for (let idx = 0; idx < rekapRows.length; idx++) {
          const r = rekapRows[idx];
          const rOrder = String(r[0] || "").trim();
          const rItem = String(r[3] || "").toLowerCase().trim();

          if (rOrder === cleanOrder && (rItem === cleanOrigName || (updates.itemName && rItem === updates.itemName.toLowerCase().trim()))) {
            const rekapRowNum = idx + 2; // header is row 1
            if (updates.supplier !== undefined) {
              rekapBatchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!C${rekapRowNum}`,
                values: [[updates.supplier]],
              });
            }
            if (updates.itemName !== undefined) {
              rekapBatchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!D${rekapRowNum}`,
                values: [[updates.itemName]],
              });
            }
            if (updates.qty !== undefined) {
              rekapBatchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!E${rekapRowNum}`,
                values: [[updates.qty]],
              });
            }
            if (updates.unit !== undefined) {
              rekapBatchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!F${rekapRowNum}`,
                values: [[updates.unit]],
              });
            }
            if (updates.price !== undefined) {
              rekapBatchUpdates.push({
                range: `'${SHEET_NAMES.REKAP_MARGIN}'!G${rekapRowNum}`,
                values: [[updates.price]],
              });
            }
            break;
          }
        }

        if (rekapBatchUpdates.length > 0) {
          await client.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: "USER_ENTERED",
              data: rekapBatchUpdates,
            },
          });
          logger.info({ orderNo, itemName: origItemName }, "Cascaded Pagu item update to 05_REKAP_MARGIN");
        }
      } catch (rekapErr: any) {
        logger.warn({ err: rekapErr?.message }, "Non-critical error cascading to 05_REKAP_MARGIN");
      }

      // 3. Update Supabase if available
      try {
        const supabase = getSupabaseClient();
        const newQty = updates.qty !== undefined ? updates.qty : currentItem.qty;
        const newPrice = updates.price !== undefined ? updates.price : currentItem.price;
        const newName = updates.itemName !== undefined ? updates.itemName : currentItem.itemName;
        await supabase
          .from("sppg_order_items")
          .update({
            item_name: newName,
            qty: newQty,
            price: newPrice,
            total_price: newQty * newPrice,
          })
          .eq("item_name", origItemName);
      } catch (_) {}

      // 4. Record audit log
      const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
      const auditEntries: MasterAuditLogEntry[] = [];
      if (updates.qty !== undefined) {
        auditEntries.push({
          unitName,
          editor: `${updatedBy} (Pagu Editor)`,
          sheetTab: SHEET_NAMES.PAGU_RINCIAN,
          refId: orderNo,
          columnEdited: `Kuantitas (F) - ${origItemName}`,
          oldValue: currentItem.qty,
          newValue: updates.qty,
          sourceAction: "Pagu Detail Update",
        });
      }
      if (updates.price !== undefined) {
        auditEntries.push({
          unitName,
          editor: `${updatedBy} (Pagu Editor)`,
          sheetTab: SHEET_NAMES.PAGU_RINCIAN,
          refId: orderNo,
          columnEdited: `Harga Pagu (H) - ${origItemName}`,
          oldValue: currentItem.price,
          newValue: updates.price,
          sourceAction: "Pagu Detail Update",
        });
      }
      if (updates.supplier !== undefined) {
        auditEntries.push({
          unitName,
          editor: `${updatedBy} (Pagu Editor)`,
          sheetTab: SHEET_NAMES.PAGU_RINCIAN,
          refId: orderNo,
          columnEdited: `Target Rekanan (D) - ${origItemName}`,
          oldValue: currentItem.supplier,
          newValue: updates.supplier,
          sourceAction: "Pagu Detail Update",
        });
      }
      if (auditEntries.length > 0) {
        await this.appendMasterAuditLogsBatch(auditEntries).catch(() => {});
      }

      const updatedItem: PaguRincianItem = {
        ...currentItem,
        supplier: updates.supplier !== undefined ? updates.supplier : currentItem.supplier,
        itemName: updates.itemName !== undefined ? updates.itemName : currentItem.itemName,
        qty: updates.qty !== undefined ? updates.qty : currentItem.qty,
        unit: updates.unit !== undefined ? updates.unit : currentItem.unit,
        price: updates.price !== undefined ? updates.price : currentItem.price,
        totalAmount:
          (updates.qty !== undefined ? updates.qty : currentItem.qty) *
          (updates.price !== undefined ? updates.price : currentItem.price),
      };

      return {
        success: true,
        message: `Rincian bahan "${updatedItem.itemName}" berhasil diperbarui di Tab 03 & Tab 05.`,
        updatedItem,
      };
    } catch (err: any) {
      logger.error({ err: err?.message, spreadsheetId, orderNo, itemRowIndex }, "Failed to update Pagu item detail");
      return { success: false, message: `Gagal memperbarui rincian bahan: ${err?.message || err}` };
    }
  }

  /**
   * Intelligently queries Pagu items by orderRef (IH001, 03/31/08/26) and itemName
   */
  async findPaguItemByQuery(
    spreadsheetId: string,
    orderRef?: string,
    itemName?: string
  ): Promise<FindPaguItemResult> {
    await this.ensure5TabStructure(spreadsheetId);
    const availableOrders = this.fetchOrders
      ? await this.fetchOrders(spreadsheetId)
      : await this.getPaguOrders(spreadsheetId);

    let matchedOrder: PaguOrderSummary | null = null;
    if (orderRef) {
      const cleanRef = orderRef.trim().toLowerCase();
      matchedOrder =
        availableOrders.find((o) => {
          const tId = (o.transactionId || "").toLowerCase();
          const oNo = o.orderNo.toLowerCase();
          return tId.includes(cleanRef) || oNo === cleanRef || cleanRef.includes(oNo);
        }) || null;
    }

    // If orderRef was not specified or matched, but only 1 order exists
    if (!matchedOrder && !orderRef && availableOrders.length === 1) {
      matchedOrder = availableOrders[0];
    }

    if (matchedOrder) {
      const allItemsInOrder = this.fetchOrderItems
        ? await this.fetchOrderItems(spreadsheetId, matchedOrder.orderNo)
        : await this.getPaguOrderItems(spreadsheetId, matchedOrder.orderNo);

      if (itemName) {
        const cleanItem = itemName.toLowerCase().trim();
        // 1. Exact match
        let matchingItems = allItemsInOrder.filter(
          (it) => it.itemName.toLowerCase().trim() === cleanItem
        );
        // 2. Substring match
        if (matchingItems.length === 0) {
          matchingItems = allItemsInOrder.filter((it) => {
            const itName = it.itemName.toLowerCase().trim();
            return itName.includes(cleanItem) || cleanItem.includes(itName);
          });
        }
        const foundItem = matchingItems.length === 1 ? matchingItems[0] : null;

        return {
          order: matchedOrder,
          foundItem,
          allItemsInOrder,
          matchingItems,
          availableOrders,
        };
      }

      return {
        order: matchedOrder,
        foundItem: null,
        allItemsInOrder,
        matchingItems: [],
        availableOrders,
      };
    }

    // If order is not identified but itemName is provided, search across all items in Tab 03
    if (itemName) {
      const client = await this.getClient();
      const res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_RINCIAN}'!A2:J`,
      });
      const rows = res.data.values || [];
      const cleanItem = itemName.toLowerCase().trim();
      const matches: PaguRincianItem[] = [];

      for (let idx = 0; idx < rows.length; idx++) {
        const row = rows[idx];
        const rItem = String(row[4] || "").toLowerCase().trim();
        if (rItem === cleanItem || rItem.includes(cleanItem) || cleanItem.includes(rItem)) {
          const qty = parseCurrencyNumber(row[5]);
          const price = parseCurrencyNumber(row[7]);
          matches.push({
            orderNo: String(row[0] || "").trim(),
            transactionId: String(row[1] || "").trim(),
            itemIndex: parseInt(String(row[2] || "0"), 10) || matches.length + 1,
            rowIndex: idx + 2,
            supplier: String(row[3] || "").trim(),
            itemName: String(row[4] || "").trim(),
            qty,
            unit: String(row[6] || "").trim(),
            price,
            totalAmount: parseCurrencyNumber(row[8]) || qty * price,
            notes: String(row[9] || "").trim(),
          });
        }
      }

      if (matches.length === 1) {
        const single = matches[0];
        const order = availableOrders.find((o) => o.orderNo === single.orderNo) || null;
        const allItemsInOrder = await this.getPaguOrderItems(spreadsheetId, single.orderNo);
        return {
          order,
          foundItem: single,
          allItemsInOrder,
          matchingItems: [single],
          availableOrders,
        };
      }

      return {
        order: null,
        foundItem: null,
        allItemsInOrder: [],
        matchingItems: matches,
        availableOrders,
      };
    }

    return {
      order: null,
      foundItem: null,
      allItemsInOrder: [],
      matchingItems: [],
      availableOrders,
    };
  }

  /**
   * Adds a new Pagu item to an existing PO by inserting a row right after the last item of that PO
   * in Tab 03_PAGU_RINCIAN and Tab 05_REKAP_MARGIN, shifting any rows below down.
   */
  async addPaguItemToOrder(
    spreadsheetId: string,
    orderNo: string,
    item: {
      supplier?: string;
      itemName: string;
      qty: number;
      unit?: string;
      price: number;
      notes?: string;
    },
    addedBy = "Telegram User"
  ): Promise<{ success: boolean; message: string; addedItem?: PaguRincianItem }> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();
    try {
      const orders = await this.getPaguOrders(spreadsheetId);
      const cleanOrderNo = orderNo.trim();
      const order = orders.find(
        (o) => o.orderNo.toLowerCase() === cleanOrderNo.toLowerCase()
      );
      const transactionId = order?.transactionId || `PO-${cleanOrderNo}`;
      const orderDate = order?.orderDate || new Date().toISOString().split("T")[0];

      // 1. Get numeric sheetIds for Tab 03 and Tab 06
      const meta = await client.spreadsheets.get({ spreadsheetId });
      const sheetMap = new Map<string, number>();
      meta.data.sheets?.forEach((s) => {
        if (s.properties?.title && typeof s.properties?.sheetId === "number") {
          sheetMap.set(s.properties.title, s.properties.sheetId);
        }
      });
      const rincianSheetId = sheetMap.get(SHEET_NAMES.RINCIAN_PENDAPATAN) ?? SHEET_IDS.RINCIAN_PENDAPATAN;
      const rekapSheetId = sheetMap.get(SHEET_NAMES.PERBANDINGAN_MARGIN) ?? SHEET_IDS.PERBANDINGAN_MARGIN;

      // 2. Find the last row of cleanOrderNo in 03_RINCIAN_PENDAPATAN
      const rincianRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.RINCIAN_PENDAPATAN}'!A:C`,
      });
      const rincianRows = rincianRes.data.values || [];
      let lastRincianRowIndex = -1;
      let lastItemIndex = 0;

      for (let i = 0; i < rincianRows.length; i++) {
        const row = rincianRows[i];
        if (String(row[0] || "").trim().toLowerCase() === cleanOrderNo.toLowerCase()) {
          lastRincianRowIndex = i + 1; // 1-based
          const parsedIdx = parseInt(String(row[2] || "0"), 10);
          if (!isNaN(parsedIdx) && parsedIdx > lastItemIndex) {
            lastItemIndex = parsedIdx;
          }
        }
      }

      const nextItemIndex = lastItemIndex + 1;
      const unit = item.unit || "satuan";
      const supplier = item.supplier || "Lainnya";
      const notes = item.notes || "-";

      let targetRincianRowIdx: number;

      if (lastRincianRowIndex > 0) {
        // Insert dimension right after the last item of this PO (0-based startIndex = lastRincianRowIndex)
        targetRincianRowIdx = lastRincianRowIndex + 1;
        await client.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                insertDimension: {
                  range: {
                    sheetId: rincianSheetId,
                    dimension: "ROWS",
                    startIndex: lastRincianRowIndex,
                    endIndex: lastRincianRowIndex + 1,
                  },
                  inheritFromBefore: true,
                },
              },
            ],
          },
        });

        // Write values to the newly inserted row in Tab 03
        await client.spreadsheets.values.update({
          spreadsheetId,
          range: `'${SHEET_NAMES.RINCIAN_PENDAPATAN}'!A${targetRincianRowIdx}:J${targetRincianRowIdx}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [
              [
                cleanOrderNo,
                transactionId,
                nextItemIndex,
                supplier,
                item.itemName,
                item.qty,
                unit,
                item.price,
                `=IF(OR(F${targetRincianRowIdx}=""; H${targetRincianRowIdx}=""); ""; F${targetRincianRowIdx} * H${targetRincianRowIdx})`,
                notes,
              ],
            ],
          },
        });
      } else {
        // Fallback: append at the end if order had no existing rows
        const fallbackCount = rincianRows.length;
        targetRincianRowIdx = Math.max(fallbackCount + 1, 2);
        const rincianRow = [
          cleanOrderNo,
          transactionId,
          nextItemIndex,
          supplier,
          item.itemName,
          item.qty,
          unit,
          item.price,
          `=IF(OR(F${targetRincianRowIdx}=""; H${targetRincianRowIdx}=""); ""; F${targetRincianRowIdx} * H${targetRincianRowIdx})`,
          notes,
        ];
        await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.RINCIAN_PENDAPATAN, [rincianRow]);
      }

      // 3. Find the last row of cleanOrderNo in 06_PERBANDINGAN_MARGIN and insert row similarly
      const rekapRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A:A`,
      });
      const rekapRows = rekapRes.data.values || [];
      let lastRekapRowIndex = -1;

      for (let i = 0; i < rekapRows.length; i++) {
        const row = rekapRows[i];
        if (String(row[0] || "").trim().toLowerCase() === cleanOrderNo.toLowerCase()) {
          lastRekapRowIndex = i + 1; // 1-based
        }
      }

      let targetRekapRowIdx: number;

      if (lastRekapRowIndex > 0) {
        targetRekapRowIdx = lastRekapRowIndex + 1;
        await client.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                insertDimension: {
                  range: {
                    sheetId: rekapSheetId,
                    dimension: "ROWS",
                    startIndex: lastRekapRowIndex,
                    endIndex: lastRekapRowIndex + 1,
                  },
                  inheritFromBefore: true,
                },
              },
            ],
          },
        });

        await client.spreadsheets.values.update({
          spreadsheetId,
          range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A${targetRekapRowIdx}:M${targetRekapRowIdx}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [
              [
                cleanOrderNo,
                orderDate,
                supplier,
                item.itemName,
                item.qty,
                unit,
                item.price,
                `=IF(OR(E${targetRekapRowIdx}=""; G${targetRekapRowIdx}=""); ""; E${targetRekapRowIdx} * G${targetRekapRowIdx})`,
                "",
                "",
                `=IF(J${targetRekapRowIdx}=""; ""; H${targetRekapRowIdx}-J${targetRekapRowIdx})`,
                `=IF(OR(H${targetRekapRowIdx}=""; J${targetRekapRowIdx}=""); ""; IFERROR(K${targetRekapRowIdx}/H${targetRekapRowIdx}; 0))`,
                `=IF(J${targetRekapRowIdx}=""; "🟡 MENUNGGU INVOICE"; IF(K${targetRekapRowIdx}>0; "🟢 HEMAT"; IF(K${targetRekapRowIdx}=0; "🟢 PAS"; "🔴 OVER BUDGET")))`,
              ],
            ],
          },
        });
      } else {
        const fallbackRekapCount = rekapRows.length;
        targetRekapRowIdx = Math.max(fallbackRekapCount + 1, 2);
        const rekapRow = [
          cleanOrderNo,
          orderDate,
          supplier,
          item.itemName,
          item.qty,
          unit,
          item.price,
          `=IF(OR(E${targetRekapRowIdx}=""; G${targetRekapRowIdx}=""); ""; E${targetRekapRowIdx} * G${targetRekapRowIdx})`,
          "",
          "",
          `=IF(J${targetRekapRowIdx}=""; ""; H${targetRekapRowIdx}-J${targetRekapRowIdx})`,
          `=IF(OR(H${targetRekapRowIdx}=""; J${targetRekapRowIdx}=""); ""; IFERROR(K${targetRekapRowIdx}/H${targetRekapRowIdx}; 0))`,
          `=IF(J${targetRekapRowIdx}=""; "🟡 MENUNGGU INVOICE"; IF(K${targetRekapRowIdx}>0; "🟢 HEMAT"; IF(K${targetRekapRowIdx}=0; "🟢 PAS"; "🔴 OVER BUDGET")))`,
        ];
        await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PERBANDINGAN_MARGIN, [rekapRow]);
      }

      // 4. Record Master Audit Log
      const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
      await this.appendMasterAuditLogsBatch([
        {
          unitName,
          editor: `${addedBy} (Pagu Adder)`,
          sheetTab: SHEET_NAMES.RINCIAN_PENDAPATAN,
          refId: cleanOrderNo,
          columnEdited: `Sisip Bahan Baru di PO ${cleanOrderNo} (Baris ${targetRincianRowIdx}) - ${item.itemName}`,
          oldValue: "-",
          newValue: `${item.qty} ${unit} @ Rp ${item.price}`,
          sourceAction: "Pagu Detail Add (Insert Row)",
        },
      ]).catch(() => {});

      // 5. Update Master Dashboard Total if available
      if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
        try {
          const itemsInOrder = await this.getPaguOrderItems(spreadsheetId, cleanOrderNo);
          const newTotal = itemsInOrder.reduce((acc, it) => acc + it.totalAmount, 0);
          await this.masterSyncService.updateMasterTransactionRow(cleanOrderNo, { total_amount: newTotal });
        } catch (_) {}
      }

      const addedItem: PaguRincianItem = {
        orderNo: cleanOrderNo,
        transactionId,
        itemIndex: nextItemIndex,
        rowIndex: targetRincianRowIdx,
        supplier,
        itemName: item.itemName,
        qty: item.qty,
        unit,
        price: item.price,
        totalAmount: item.qty * item.price,
        notes,
      };

      return {
        success: true,
        message: `Bahan "${item.itemName}" berhasil disisipkan di baris ke-${targetRincianRowIdx} (Tab 03) dan baris ke-${targetRekapRowIdx} (Tab 06). Baris di bawahnya telah bergeser turun secara otomatis.`,
        addedItem,
      };
    } catch (err: any) {
      logger.error({ err: err?.message, spreadsheetId, orderNo, item }, "Failed to insert Pagu item to order");
      return { success: false, message: `Gagal menambahkan bahan baru: ${err?.message || err}` };
    }
  }

  insertPaguItemToOrder = this.addPaguItemToOrder;
}

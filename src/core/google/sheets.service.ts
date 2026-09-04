import { google, sheets_v4 } from "googleapis";
import fs from "fs";
import path from "path";
import { env } from "../../config/env.js";
import { SppgOrder } from "../ai/schemas/sppg-order.schema.js";
import { SupplierReceipt } from "../ai/schemas/supplier-receipt.schema.js";
import { createInit5TabsBatchRequests } from "./sheets-recipes.js";
import { logger } from "../utils/logger.js";

export class GoogleSheetsService {
  private sheets: sheets_v4.Sheets | null = null;

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
    } catch (err: any) {
      logger.warn({ err: err?.message || err, spreadsheetId }, "Note during 5-tab verification");
    }
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
    const startRow = existingRows + 1;
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
    const client = await this.getClient();

    try {
      // 1. Read all Pagu from 02_PENDAPATAN_SPPG (Col I)
      const incomeRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'02_PENDAPATAN_SPPG'!I2:I",
      });
      const incomeValues = incomeRes.data.values || [];
      const totalPlafon = incomeValues.reduce((sum, row) => {
        const val = Number(String(row[0] || "").replace(/[^\d.-]/g, ""));
        return sum + (isNaN(val) ? 0 : val);
      }, 0);

      // 2. Read all Belanja from 03_PENGELUARAN_SUPPLIER (Col I)
      const expenseRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: "'03_PENGELUARAN_SUPPLIER'!I2:I",
      });
      const expenseValues = expenseRes.data.values || [];
      const totalBelanja = expenseValues.reduce((sum, row) => {
        const val = Number(String(row[0] || "").replace(/[^\d.-]/g, ""));
        return sum + (isNaN(val) ? 0 : val);
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
}

export const googleSheetsService = new GoogleSheetsService();

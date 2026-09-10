import { sheets_v4 } from "googleapis";
import { logger } from "../../utils/logger.js";
import { SHEET_NAMES } from "../recipes/index.js";
import { SheetsClientProvider, parseCurrencyNumber } from "./sheets-client.provider.js";

export class ReportingService {
  constructor(
    private clientProvider: SheetsClientProvider,
    private ensureStructureFn: (spreadsheetId: string) => Promise<void>
  ) {}

  private async getClient(): Promise<sheets_v4.Sheets> {
    return this.clientProvider.getClient();
  }

  private async ensure5TabStructure(spreadsheetId: string): Promise<void> {
    return this.ensureStructureFn(spreadsheetId);
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

    // 5. Search in 05_RINCIAN_PENGELUARAN (protected child items for expenses)
    try {
      const rincianExpRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A:J`,
      });
      const rincianExpRows = rincianExpRes.data.values || [];
      for (let idx = 0; idx < rincianExpRows.length; idx++) {
        const row = rincianExpRows[idx];
        const col0 = String(row?.[0] || "");
        const col1 = String(row?.[1] || "");
        if (matchesId(col1) || (cleanId.length >= 4 && matchesId(col0))) {
          return {
            found: true,
            id: col1 || cleanId,
            sheetName: SHEET_NAMES.RINCIAN_PENGELUARAN,
            rowIndex: idx + 1,
            type: "expense",
            date: "-",
            supplierOrUnit: String(row[3] || "Supplier"),
            items: String(row[4] || "Rincian Belanja"),
            amount: parseCurrencyNumber(row[8]),
            orderNo: col0.trim(),
            isProtected: true,
            notes: `Rincian Pengeluaran Item #${row[2] || idx + 1}`,
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

  findTransactionById = this.getTransactionDetail;
}

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

      // 1. Read Pagu from 02_PAGU_RINGKASAN (Col A to K) or fallback 02_PENDAPATAN_SPPG
      let incomeRes = await client.spreadsheets.values
        .get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A2:K`,
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
        const val = isLegacyIncome ? row[8] : (row[6] || row[5]);
        return sum + parseAmount(val);
      }, 0);

      // 2. Read Belanja from 04_PENGELUARAN_SUPPLIER (Col A to L) or fallback 03_PENGELUARAN_SUPPLIER
      let expenseRes = await client.spreadsheets.values
        .get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A2:L`,
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
        const isMazhabEksekutif = /^\d{4}-\d{2}-\d{2}$/.test(String(row[3] || "").trim());
        const val = isLegacyExpense ? row[8] : (isMazhabEksekutif ? row[6] : (row[7] ?? row[6] ?? row[5]));
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
          range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A2:L`,
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
          if (isFilterByOrder) {
            const rowOrder = String(row[0] || "").trim().toLowerCase();
            if (rowOrder !== targetOrder) continue;
          }

          const is12Col = row.length >= 12;
          const isMazhabEksekutif = is12Col && /^\d{4}-\d{2}-\d{2}$/.test(String(row[3] || "").trim());
          const date = String((isMazhabEksekutif ? row[3] : (is12Col ? row[4] : (row[3] || row[2]))) || "-").trim();
          const supplier = String((isMazhabEksekutif ? row[4] : (is12Col ? row[5] : (row[4] || row[3]))) || "Supplier").trim();
          const items = String((is12Col ? row[11] : (row[10] || row[9] || row[4])) || "Belanja Bahan Makanan").trim();
          const amount = parseAmount(isMazhabEksekutif ? row[6] : (is12Col ? row[7] : (row[6] ?? row[5])));

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
          range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A2:L`,
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
          const is12Col = isNewExpenseTab && row.length >= 12;
          const isMazhabEksekutif = is12Col && /^\d{4}-\d{2}-\d{2}$/.test(String(row[3] || "").trim());
          const isModern = isNewExpenseTab && (String(row[2] || "").startsWith("SPPG") || String(row[1] || "").startsWith("SPPG"));
          const trxId = is12Col ? String(row[2]) : (isModern ? String(row[1]) : String(row[0]));
          const trxDate = isMazhabEksekutif
            ? String(row[3] || "-")
            : (is12Col ? String(row[4] || "-") : (isModern ? String(row[3] || row[2] || "-") : String(row[1] || "-")));
          const amount = isMazhabEksekutif
            ? parseCurrencyNumber(row[6])
            : (is12Col
                ? parseCurrencyNumber(row[7])
                : (isNewExpenseTab ? (parseCurrencyNumber(row[6]) || parseCurrencyNumber(row[5])) : parseCurrencyNumber(row[8])));
          results.push({
            id: trxId,
            date: trxDate,
            type: "expense",
            title: isMazhabEksekutif
              ? String(row[4] || "Supplier")
              : (is12Col ? String(row[5] || "Supplier") : (isModern ? String(row[4] || "Supplier") : String(row[3] || "Supplier"))),
            amount,
            detail: is12Col ? String(row[11] || row[0] || "-") : (isNewExpenseTab ? String(row[10] || row[0] || "-") : String(row[4] || "-")),
            link: isMazhabEksekutif
              ? String(row[8] || "")
              : (is12Col ? String(row[9] || "") : (isNewExpenseTab ? String(row[8] || "") : String(row[9] || ""))),
          });
        }
      }

      // 2. Fetch orders from 02_PAGU_RINGKASAN or fallback 02_PENDAPATAN_SPPG
      let orderRes = await client.spreadsheets.values
        .get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A2:K`,
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
          const isMazhabEksekutifOrd = isNewOrderTab && /^\d{4}-\d{2}-\d{2}$/.test(String(row[2] || "").trim());
          const trxDate = isMazhabEksekutifOrd
            ? String(row[2] || "-")
            : (isModern ? String(row[3] || row[2] || "-") : String(row[1] || "-"));
          const noSppg = isModern ? String(row[0] || "") : String(row[2] || "");
          const amount = isMazhabEksekutifOrd
            ? parseCurrencyNumber(row[5])
            : (isNewOrderTab
                ? (parseCurrencyNumber(row[6]) || parseCurrencyNumber(row[5]))
                : parseCurrencyNumber(row[8]));
          results.push({
            id: trxId,
            date: trxDate,
            type: "income",
            title: isNewOrderTab ? `Nota SPPG ${noSppg}` : `Nota SPPG ${row[3] || ""}`,
            amount,
            detail: isMazhabEksekutifOrd
              ? String(row[9] || "Pagu Anggaran")
              : (isNewOrderTab ? String(row[9] || row[4] || "Pagu Anggaran") : String(row[4] || "-")),
            link: isMazhabEksekutifOrd
              ? String(row[6] || "")
              : (isNewOrderTab ? String(row[7] || row[6] || "") : undefined),
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

    // 1. Search in 04_PENGELUARAN (Pagu Pengeluaran)
    try {
      const expRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A:L`,
      });
      const expRows = expRes.data.values || [];
      for (let idx = 0; idx < expRows.length; idx++) {
        const row = expRows[idx];
        const col0 = String(row?.[0] || "");
        const col1 = String(row?.[1] || "");
        const col2 = String(row?.[2] || "");
        const is12Col = row.length >= 12 || col2.toUpperCase().includes("EI") || col2.toUpperCase().includes("SPPG");
        const expenseId = is12Col ? col2 : col1;

        if (matchesId(expenseId) || (!is12Col && matchesId(col1)) || (cleanId.length >= 4 && matchesId(col0))) {
          const isMazhabEksekutif = is12Col && /^\d{4}-\d{2}-\d{2}$/.test(String(row[3] || "").trim());
          const trxDate = String((isMazhabEksekutif ? row[3] : (is12Col ? row[4] : row[3])) || "-");
          const supplier = String((isMazhabEksekutif ? row[4] : (is12Col ? row[5] : row[4])) || "Supplier");
          const amount = parseCurrencyNumber(isMazhabEksekutif ? row[6] : (is12Col ? row[7] : row[6]));
          const link = String((isMazhabEksekutif ? row[8] : (is12Col ? row[9] : row[8])) || "");
          const notes = String((is12Col ? row[11] : row[10]) || "-");
          return {
            found: true,
            id: expenseId || cleanId,
            sheetName: SHEET_NAMES.PENGELUARAN_SUPPLIER,
            rowIndex: idx + 1,
            type: "expense",
            date: trxDate,
            supplierOrUnit: supplier,
            items: notes !== "-" ? notes : "Belanja Bahan Dapur",
            amount,
            orderNo: col0.trim(),
            isProtected: false,
            link,
            notes,
          };
        }
      }
    } catch (err) {
      // continue
    }

    // 2. Search in 02_PENDAPATAN (Pagu Ringkasan / Penerimaan)
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
          const isMazhabEksekutif = /^\d{4}-\d{2}-\d{2}$/.test(String(row[2] || "").trim());
          const trxDate = String((isMazhabEksekutif ? row[2] : (isModern ? row[3] : row[1])) || "-");
          const itemCount = String((isMazhabEksekutif ? row[3] : row[4]) || "Pagu Anggaran");
          const supplier = String((isMazhabEksekutif ? row[4] : row[5]) || "Badan Gizi Nasional");
          const amount = parseCurrencyNumber(isMazhabEksekutif ? row[5] : row[6]);
          const rawLink = String((isMazhabEksekutif ? row[6] : row[7]) || "");
          const link = rawLink.startsWith("http") || rawLink.startsWith("=HYPERLINK") ? rawLink : "";
          const notes = String(row[9] || "-");
          return {
            found: true,
            id: trxId,
            sheetName: SHEET_NAMES.PAGU_RINGKASAN,
            rowIndex: idx + 1,
            type: "income",
            date: trxDate,
            supplierOrUnit: supplier,
            items: itemCount,
            amount,
            orderNo: col0.trim(),
            isProtected: false,
            link,
            notes,
          };
        }
      }
    } catch (err: any) {
      logger.warn({ err: err?.message || err, transactionId }, "Transient error reading Tab 02 in getTransactionDetail, retrying...");
      try {
        await new Promise((r) => setTimeout(r, 350));
        const retryRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A:J`,
        });
        const ordRows = retryRes.data?.values || [];
        for (let idx = 0; idx < ordRows.length; idx++) {
          const row = ordRows[idx];
          const col0 = String(row?.[0] || "");
          const col1 = String(row?.[1] || "");
          if (matchesId(col0) || matchesId(col1)) {
            const isModern = col1.toUpperCase().startsWith("SPPG");
            const trxId = isModern ? (col1 || cleanId) : (col0 || cleanId);
            const isMazhabEksekutif = /^\d{4}-\d{2}-\d{2}$/.test(String(row[2] || "").trim());
            const trxDate = String((isMazhabEksekutif ? row[2] : (isModern ? row[3] : row[1])) || "-");
            const itemCount = String((isMazhabEksekutif ? row[3] : row[4]) || "Pagu Anggaran");
            const supplier = String((isMazhabEksekutif ? row[4] : row[5]) || "Badan Gizi Nasional");
            const amount = parseCurrencyNumber(isMazhabEksekutif ? row[5] : row[6]);
            const rawLink = String((isMazhabEksekutif ? row[6] : row[7]) || "");
            const link = rawLink.startsWith("http") || rawLink.startsWith("=HYPERLINK") ? rawLink : "";
            const notes = String(row[9] || "-");
            return {
              found: true,
              id: trxId,
              sheetName: SHEET_NAMES.PAGU_RINGKASAN,
              rowIndex: idx + 1,
              type: "income",
              date: trxDate,
              supplierOrUnit: supplier,
              items: itemCount,
              amount,
              orderNo: col0.trim(),
              isProtected: false,
              link,
              notes,
            };
          }
        }
      } catch (retryErr) {
        logger.error({ retryErr }, "Retry reading Tab 02 also failed in getTransactionDetail");
      }
    }

    // 3. Search in 03_RINCIAN_PENDAPATAN (protected child items)
    // Note: If cleanId is explicitly an income transaction ID (II...), it is a Pagu Induk ID,
    // not an individual child ingredient. Do not treat it as a protected child item.
    const isExplicitIncomeTrx = cleanId.startsWith("II") || cleanId.includes("-II") || cleanId.includes("_II");
    if (!isExplicitIncomeTrx) {
      try {
        const rincianRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PAGU_RINCIAN}'!A:K`,
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
              supplierOrUnit: String(row[4] || "Target Supplier"),
              items: String(row[3] || "Rincian Bahan"),
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
    }

    // 4. Search in 05_RINCIAN_PENGELUARAN (protected child items for expenses)
    try {
      const rincianExpRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A:L`,
      });
      const rincianExpRows = rincianExpRes.data.values || [];
      for (let idx = 0; idx < rincianExpRows.length; idx++) {
        const row = rincianExpRows[idx];
        const col0 = String(row?.[0] || "");
        const col1 = String(row?.[1] || "");
        const col2 = String(row?.[2] || "");
        const is12Col = row.length >= 12 || col2.toUpperCase().includes("EI") || col2.toUpperCase().includes("SPPG");
        const expenseId = is12Col ? col2 : col1;

        if (matchesId(expenseId) || (!is12Col && matchesId(col1)) || (cleanId.length >= 4 && matchesId(col0))) {
          const supplier = String((is12Col ? row[4] : row[3]) || "Supplier");
          const items = String((is12Col ? row[5] : row[4]) || "Rincian Belanja");
          const amount = parseCurrencyNumber(is12Col ? row[9] : row[8]);
          const itemNum = String((is12Col ? row[3] : row[2]) || idx + 1);
          return {
            found: true,
            id: expenseId || cleanId,
            sheetName: SHEET_NAMES.RINCIAN_PENGELUARAN,
            rowIndex: idx + 1,
            type: "expense",
            date: "-",
            supplierOrUnit: supplier,
            items,
            amount,
            orderNo: col0.trim(),
            isProtected: true,
            notes: `Rincian Pengeluaran Item #${itemNum}`,
          };
        }
      }
    } catch (err) {
      // continue
    }

    return { found: false, id: cleanId };
  }

  findTransactionById = this.getTransactionDetail;
}

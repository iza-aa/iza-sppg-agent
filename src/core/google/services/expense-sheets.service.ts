import { sheets_v4 } from "googleapis";
import { env } from "../../../config/env.js";
import { logger } from "../../utils/logger.js";
import { SupplierReceipt } from "../../ai/schemas/supplier-receipt.schema.js";
import { SHEET_NAMES, SHEET_IDS, createHeaderStylingBatchRequests, createNumberFormattingBatchRequests } from "../recipes/index.js";
import { SheetsClientProvider, parseCurrencyNumber } from "./sheets-client.provider.js";
import { MasterSyncService } from "./master-sync.service.js";
import { ReportingService } from "./reporting.service.js";

export interface ExpenseInsertionTarget {
  mode: "INSERT" | "APPEND";
  targetRowIdx: number;       // 1-based row index in Google Sheet where new row is located
  insertStartIndex: number;   // 0-based index for insertDimension
  nextItemIndex: number;      // Next No Urut (1, 2, 3...)
  matchedExpenseId: string;   // The canonical expense ID matched in the sheet
  sppgRefNo: string;          // SPPG reference if available
  supplierName: string;       // Supplier name if available
}

/**
 * Calculates the exact insertion target for child rows in 05_RINCIAN_PENGELUARAN.
 * If targetExpenseId already exists in Tab 05, it groups the new items right below
 * the last item of that expenseId. Otherwise, it targets appending at the end.
 */
export function calculateExpenseInsertionTarget(
  tab05Rows: (string | number)[][],
  targetExpenseId: string
): ExpenseInsertionTarget {
  const cleanTarget = String(targetExpenseId || "").trim().toUpperCase();

  const matchesExpenseId = (candidate: string): boolean => {
    const c = String(candidate || "").trim().toUpperCase();
    if (!c || !cleanTarget) return false;
    return (
      c === cleanTarget ||
      c.endsWith(`-${cleanTarget}`) ||
      c.endsWith(`_${cleanTarget}`) ||
      cleanTarget.endsWith(`-${c}`) ||
      cleanTarget.endsWith(`_${c}`) ||
      (cleanTarget.length >= 4 && c.includes(cleanTarget))
    );
  };

  let lastRowIndex = -1; // 1-based row index
  let maxItemIndex = 0;
  let matchedExpenseId = cleanTarget;
  let sppgRefNo = "-";
  let supplierName = "Supplier";

  for (let i = 0; i < tab05Rows.length; i++) {
    const row = tab05Rows[i];
    const colB = String(row[1] || "");
    if (matchesExpenseId(colB)) {
      lastRowIndex = i + 1; // 1-based
      matchedExpenseId = colB;
      const parsedIdx = parseInt(String(row[2] || "0"), 10);
      if (!isNaN(parsedIdx) && parsedIdx > maxItemIndex) {
        maxItemIndex = parsedIdx;
      }
      if (row[0] && String(row[0]).trim() !== "-") {
        sppgRefNo = String(row[0]).trim();
      }
      if (row[3] && String(row[3]).trim()) {
        supplierName = String(row[3]).trim();
      }
    }
  }

  if (lastRowIndex > 0) {
    return {
      mode: "INSERT",
      targetRowIdx: lastRowIndex + 1,
      insertStartIndex: lastRowIndex, // 0-based
      nextItemIndex: maxItemIndex + 1,
      matchedExpenseId,
      sppgRefNo,
      supplierName,
    };
  } else {
    const fallbackCount = tab05Rows.length;
    const targetStartRow = Math.max(fallbackCount + 1, 2);
    return {
      mode: "APPEND",
      targetRowIdx: targetStartRow,
      insertStartIndex: targetStartRow - 1,
      nextItemIndex: 1,
      matchedExpenseId: cleanTarget,
      sppgRefNo: "-",
      supplierName: "Supplier",
    };
  }
}

export class ExpenseSheetsService {
  constructor(
    private clientProvider: SheetsClientProvider,
    private masterSyncService: MasterSyncService,
    private reportingService: ReportingService,
    private ensureStructureFn: (spreadsheetId: string) => Promise<void>
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

  private async recordToMasterConsolidated(rows: any[][]): Promise<void> {
    return this.masterSyncService.recordToMasterConsolidated(rows);
  }

  private async appendMasterAuditLogsBatch(entries: any[]): Promise<void> {
    return this.masterSyncService.appendMasterAuditLogsBatch(entries);
  }

  private async findTransactionById(spreadsheetId: string, transactionId: string) {
    return this.reportingService.getTransactionDetail(spreadsheetId, transactionId);
  }

  async backfillRincianPengeluaranIfEmpty(spreadsheetId: string): Promise<void> {
    const client = await this.getClient();
    try {
      // 1. Check if Tab 05 exists and already has data rows
      const tab05Res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A2:B`,
      }).catch(() => ({ data: { values: null } }));

      if (tab05Res.data.values && tab05Res.data.values.length > 0) {
        return; // Already has data rows, do not overwrite
      }

      // 2. Read existing Tab 04 rows
      const tab04Res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_PENGELUARAN}'!A2:J`,
      }).catch(() => ({ data: { values: null } }));

      const tab04Rows = tab04Res.data.values || [];
      if (tab04Rows.length === 0) return;

      // 3. Read Tab 06 (Perbandingan Margin) to see if item-level realizations already exist
      const tab06Res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A2:K`,
      }).catch(() => ({ data: { values: null } }));
      const tab06Rows = tab06Res.data.values || [];

      const tab05NewRows: any[][] = [];
      const updatedTab04Formulas: { range: string; values: any[][] }[] = [];

      for (let rIdx = 0; rIdx < tab04Rows.length; rIdx++) {
        const row = tab04Rows[rIdx];
        const rowNo = rIdx + 2;
        const sppgRef = String(row[0] || "").trim();
        const trxId = String(row[1] || "").trim();
        const supplierName = String(row[3] || "Supplier Pasar").trim();
        const totalAmount = parseCurrencyNumber(row[5]);
        const notes = String(row[9] || "Pencatatan Belanja").trim();

        if (!trxId) continue;

        // Check if there are realisasi items in Tab 06 matching this sppgRef
        const matchedItems = sppgRef && sppgRef !== "-"
          ? tab06Rows.filter((r) => {
              const rSppg = String(r[0] || "").trim();
              const realPrice = parseCurrencyNumber(r[8]);
              const realTotal = parseCurrencyNumber(r[9]);
              return rSppg === sppgRef && (realPrice > 0 || realTotal > 0);
            })
          : [];

        if (matchedItems.length > 0) {
          let matchedSum = 0;
          matchedItems.forEach((m, idx) => {
            const itemName = String(m[3] || "Bahan Makanan").trim();
            const qty = parseCurrencyNumber(m[4]) || 1;
            const unit = String(m[5] || "Satuan").trim();
            const realPrice = parseCurrencyNumber(m[8]) || (parseCurrencyNumber(m[9]) / qty);
            const targetRowIdx = tab05NewRows.length + 2;
            const subtotalFormula = `=F${targetRowIdx}*H${targetRowIdx}`;
            matchedSum += qty * realPrice;

            tab05NewRows.push([
              sppgRef,
              trxId,
              idx + 1,
              supplierName,
              itemName,
              qty,
              unit,
              realPrice,
              subtotalFormula,
            ]);
          });

          // If there is an unitemized remainder between matched items and the total invoice
          if (totalAmount > matchedSum) {
            const diff = totalAmount - matchedSum;
            const targetRowIdx = tab05NewRows.length + 2;
            tab05NewRows.push([
              sppgRef,
              trxId,
              matchedItems.length + 1,
              supplierName,
              "Belanja Bahan Tambahan Pasar / Lain-lain",
              1,
              "Paket",
              diff,
              `=F${targetRowIdx}*H${targetRowIdx}`,
            ]);
          }
        } else {
          // Unitemized fallback entry
          const targetRowIdx = tab05NewRows.length + 2;
          tab05NewRows.push([
            sppgRef,
            trxId,
            1,
            supplierName,
            notes.includes("item") ? notes : `Belanja Bahan (${notes})`,
            1,
            "Paket",
            totalAmount,
            `=F${targetRowIdx}*H${targetRowIdx}`,
          ]);
        }

        // Prepare dynamic formula for Tab 04 Col F
        updatedTab04Formulas.push({
          range: `'${SHEET_NAMES.PAGU_PENGELUARAN}'!F${rowNo}`,
          values: [[`=IF(COUNTIF('05_RINCIAN_PENGELUARAN'!$B:$B; B${rowNo})>0; SUMIF('05_RINCIAN_PENGELUARAN'!$B:$B; B${rowNo}; '05_RINCIAN_PENGELUARAN'!$I:$I); ${totalAmount})`]],
        });
      }

      if (tab05NewRows.length > 0) {
        await client.spreadsheets.values.append({
          spreadsheetId,
          range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A2`,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "OVERWRITE",
          requestBody: { values: tab05NewRows },
        });

        // Update Tab 04 formulas
        if (updatedTab04Formulas.length > 0) {
          await client.spreadsheets.values.batchUpdate({
            spreadsheetId,
            requestBody: {
              valueInputOption: "USER_ENTERED",
              data: updatedTab04Formulas,
            },
          });
        }

        // Re-apply clean text, currency formatting, and standard row heights
        const updatedMeta = await client.spreadsheets.get({ spreadsheetId });
        const sheetMap = new Map<string, number>();
        (updatedMeta.data.sheets || []).forEach((s) => {
          if (s.properties?.title && typeof s.properties?.sheetId === "number") {
            sheetMap.set(s.properties.title, s.properties.sheetId);
          }
        });
        const stylingReqs = [
          ...createHeaderStylingBatchRequests(sheetMap),
          ...createNumberFormattingBatchRequests(sheetMap),
        ];
        await client.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: stylingReqs },
        }).catch(() => {});

        logger.info(
          { spreadsheetId, backfilledItems: tab05NewRows.length },
          "Successfully auto-backfilled Tab 05 Rincian Pengeluaran from existing Tab 04 transactions"
        );
      }
    } catch (err: any) {
      logger.warn({ err: err?.message, spreadsheetId }, "Note during backfill of Tab 05");
    }
  }


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

    // 1. Check if receipt specifies an existing transaction/expense ID
    const explicitExpenseId = (receipt as any).expenseId || (receipt as any).expense_id || (receipt as any).transaction_id;
    let expenseId: string | undefined;
    let isExistingExpense = false;

    if (explicitExpenseId) {
      const existingCheck = await this.findTransactionById(spreadsheetId, explicitExpenseId);
      if (existingCheck.found && existingCheck.type === "expense") {
        expenseId = existingCheck.id;
        isExistingExpense = true;
      }
    }

    const itemsSummary =
      receipt.items && receipt.items.length > 0
        ? receipt.items.map((i) => `${i.item_name} (${i.qty} ${i.unit})`).join(", ")
        : "Belanja Bahan Dapur";
    const driveLinkFormula = driveLink ? `=HYPERLINK("${driveLink}"; "Lihat Nota")` : "-";

    if (!isExistingExpense) {
      // Count existing rows in 04_PAGU_PENGELUARAN for ID generation
      const colA = await client.spreadsheets.values
        .get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PAGU_PENGELUARAN}'!A:A`,
        })
        .catch(() => ({ data: { values: null } }));
      const existingCount = (colA.data?.values || []).length;
      const counter = Math.max(existingCount, 1);
      expenseId = this.generateTransactionId(unitCode, dateStr, counter, "expense");
      const targetExpenseRow = Math.max(existingCount + 1, 2);

      // 1. Write Parent Row to 04_PAGU_PENGELUARAN (Formula-driven Col F linked to Tab 05)
      const expenseRow = [
        receipt.sppg_ref_no || "-",                                 // A: No SPPG Ref
        expenseId,                                                  // B: ID Transaksi
        dateStr,                                                    // C: Tanggal Transaksi
        receipt.supplier_name,                                      // D: Nama Supplier
        (receipt as any).receipt_no || "-",                         // E: No Invoice Supplier
        `=IF(COUNTIF('${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$B:$B; B${targetExpenseRow})>0; SUMIF('${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$B:$B; B${targetExpenseRow}; '${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$I:$I); ${receipt.total_amount})`, // F: Total Nominal Tagihan
        receipt.payment_method || "Tunai",                          // G: Metode Pembayaran
        driveLinkFormula,                                           // H: Link Bukti Nota
        picName || "PIC Dapur",                                     // I: PIC / Operator
        receipt.notes || rawCaption || itemsSummary,                // J: Catatan / Keterangan
      ];

      await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PAGU_PENGELUARAN, [expenseRow]);
    }

    // 2. Write Child Item Rows to 05_RINCIAN_PENGELUARAN using auto-grouping by expenseId
    const itemsToRecord = (receipt.items && receipt.items.length > 0)
      ? receipt.items.map((it) => ({
          itemName: it.item_name,
          qty: it.qty,
          unit: it.unit,
          price: it.price,
          supplier: it.supplier_name || receipt.supplier_name,
          notes: (receipt as any).receipt_no || receipt.notes || "-",
          sppgRefNo: receipt.sppg_ref_no || "-",
          receiptNo: (receipt as any).receipt_no,
        }))
      : [{
          itemName: receipt.notes || rawCaption || "Belanja Bahan Dapur (Unitemized)",
          qty: 1,
          unit: "Paket",
          price: receipt.total_amount,
          supplier: receipt.supplier_name,
          notes: (receipt as any).receipt_no || receipt.notes || "-",
          sppgRefNo: receipt.sppg_ref_no || "-",
          receiptNo: (receipt as any).receipt_no,
        }];

    await this.appendOrInsertRincianPengeluaranRows(spreadsheetId, expenseId!, itemsToRecord);

    // 3. Automated Granular Matching & Partial Fulfillment Tracking in 06_PERBANDINGAN_MARGIN
    if (receipt.sppg_ref_no === "-") {
      logger.info({ expenseId }, "Expense is Belanja Tambahan (Non-Pagu, '-'). Skipping 06_PERBANDINGAN_MARGIN reconciliation.");
    } else {
      try {
        const rekapRes = await client.spreadsheets.values.get({
          spreadsheetId,
          range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A2:M`,
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
            const rowSupplier = String(row[2] || "").trim();
            const rowItemName = String(row[3] || "").toLowerCase().trim();
            const targetQty = parseCurrencyNumber(row[4]);
            const unit = String(row[5] || "").trim();
            const prevRealisasi = parseCurrencyNumber(row[9]);
            const statusStr = String(row[12] || "").trim();

            // Match condition: item names must be compatible
            const nameMatches =
              rowItemName.includes(itemCleanName) ||
              itemCleanName.includes(rowItemName);

            if (!nameMatches) continue;

            // SPPG Ref filter: if receipt specifies ref, it must match
            const sppgMatches =
              !receipt.sppg_ref_no ||
              rowSppgRef === receipt.sppg_ref_no;

            if (!sppgMatches) continue;

            // Check previous fulfillment
            let prevFulfilledQty = 0;
            const belumMatch = statusStr.match(/BELUM LENGKAP \((\d+(?:\.\d+)?)\//i);
            if (belumMatch) {
              prevFulfilledQty = parseFloat(belumMatch[1]) || 0;
            } else if (prevRealisasi > 0 && parseCurrencyNumber(row[8]) > 0) {
              prevFulfilledQty = Math.round(prevRealisasi / parseCurrencyNumber(row[8]));
            }

            // If already complete and targetQty > 0, don't overwrite unless user explicitly targeted this SPPG
            const isComplete =
              !belumMatch &&
              (statusStr.includes("HEMAT") || statusStr.includes("PAS") || statusStr.includes("OVER BUDGET")) &&
              targetQty > 0 &&
              prevFulfilledQty >= targetQty;

            if (isComplete && (!receipt.sppg_ref_no || receipt.sppg_ref_no === "-")) {
              continue;
            }

            const actualRow = rIdx + 2; // header is row 1
            const itemTotal = item.total_price || (item.qty * item.price);
            const newAccumulatedQty = prevFulfilledQty + (item.qty || 1);
            const newAccumulatedRealisasi = prevRealisasi + itemTotal;

            // Evaluate partial vs full fulfillment
            if (targetQty > 0 && newAccumulatedQty < targetQty) {
              const statusText = `🟠 BELUM LENGKAP (${newAccumulatedQty}/${targetQty} ${unit})`;
              batchUpdates.push({
                range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!I${actualRow}:J${actualRow}`,
                values: [[item.price, newAccumulatedRealisasi]],
              });
              batchUpdates.push({
                range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!M${actualRow}`,
                values: [[statusText]],
              });
            } else {
              const formulaStatus = `=IF(K${actualRow}>0; "🟢 HEMAT"; IF(K${actualRow}=0; "🟢 PAS"; "🔴 OVER BUDGET"))`;
              batchUpdates.push({
                range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!I${actualRow}:J${actualRow}`,
                values: [[item.price, newAccumulatedRealisasi]],
              });
              batchUpdates.push({
                range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!M${actualRow}`,
                values: [[formulaStatus]],
              });
            }

            // Track actual shop if different from contracted supplier
            if (receipt.supplier_name && receipt.supplier_name !== "-") {
              if (rowSupplier && !rowSupplier.toLowerCase().includes(receipt.supplier_name.toLowerCase())) {
                const combinedSupplier = `${rowSupplier} (${receipt.supplier_name})`;
                batchUpdates.push({
                  range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!C${actualRow}`,
                  values: [[combinedSupplier]],
                });
              }
            }

            matchedRowIndices.add(rIdx);
            matched = true;
            break;
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
          "Matched and updated items in 06_PERBANDINGAN_MARGIN"
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
        await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PERBANDINGAN_MARGIN, extraRows);
      }
    } catch (matchErr: any) {
      logger.warn({ err: matchErr?.message || matchErr }, "Note during 06_PERBANDINGAN_MARGIN matching");
    }
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
      this.recordToMasterConsolidated([masterRow]).catch((err) => {
        logger.warn({ err: err?.message || err }, "Failed forwarding expense to Master Dashboard");
      });
    }
  }

  /**
   * Batch records multiple supplier receipts in minimal Google Sheets API calls
   * avoiding HTTP 429 rate limit errors when importing Excel files or multi-receipt batches.
   */
  async recordSupplierExpenseBatch(
    spreadsheetId: string,
    receipts: SupplierReceipt[],
    picName: string,
    rawCaption?: string
  ): Promise<{ recordedCount: number; totalAmount: number }> {
    if (!receipts || receipts.length === 0) {
      return { recordedCount: 0, totalAmount: 0 };
    }

    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();

    const unitCode = this.getUnitCodeFromSpreadsheetId(spreadsheetId);
    const nowIso = new Date().toISOString().split("T")[0];

    // 1. Read existing rows in 04_PAGU_PENGELUARAN once to determine start counter
    const colA = await client.spreadsheets.values
      .get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_PENGELUARAN}'!A:A`,
      })
      .catch(() => ({ data: { values: null } }));
    let counter = Math.max((colA.data?.values || []).length, 1);
    let targetExpenseRow = Math.max((colA.data?.values || []).length + 1, 2);

    const expenseRows: any[][] = [];
    const masterRows: any[][] = [];
    let grandTotalAmount = 0;

    // Read existing count for 05_RINCIAN_PENGELUARAN
    const rincianExpColA = await client.spreadsheets.values
      .get({
        spreadsheetId,
        range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A:A`,
      })
      .catch(() => ({ data: { values: null } }));
    let rincianExpCounter = Math.max((rincianExpColA.data?.values || []).length + 1, 2);
    const rincianPengeluaranRows: any[][] = [];

    for (const receipt of receipts) {
      const dateStr = receipt.date || nowIso;
      const expenseId = this.generateTransactionId(unitCode, dateStr, counter++, "expense");
      const currentExpRow = targetExpenseRow++;
      const itemsSummary =
        receipt.items && receipt.items.length > 0
          ? receipt.items.map((i) => `${i.item_name} (${i.qty} ${i.unit})`).join(", ")
          : "Belanja Bahan Dapur";
      const driveLink = (receipt as any).driveLink || "";
      const driveLinkFormula = driveLink ? `=HYPERLINK("${driveLink}"; "Lihat Nota")` : "-";

      expenseRows.push([
        receipt.sppg_ref_no || "-",
        expenseId,
        dateStr,
        receipt.supplier_name,
        (receipt as any).receipt_no || "-",
        `=IF(COUNTIF('${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$B:$B; B${currentExpRow})>0; SUMIF('${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$B:$B; B${currentExpRow}; '${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$I:$I); ${receipt.total_amount})`,
        receipt.payment_method || "Tunai",
        driveLinkFormula,
        picName || "PIC Dapur",
        receipt.notes || rawCaption || itemsSummary,
      ]);

      const itemsToRecord = (receipt.items && receipt.items.length > 0)
        ? receipt.items
        : [{
            item_name: receipt.notes || rawCaption || itemsSummary || "Belanja Bahan Dapur (Unitemized)",
            qty: 1,
            unit: "Paket",
            price: receipt.total_amount,
            total_price: receipt.total_amount
          }];

      for (let idx = 0; idx < itemsToRecord.length; idx++) {
        const item = itemsToRecord[idx];
        const r = rincianExpCounter++;
        rincianPengeluaranRows.push([
          receipt.sppg_ref_no || "-",
          expenseId,
          idx + 1,
          receipt.supplier_name,
          item.item_name,
          item.qty,
          item.unit,
          item.price,
          `=IF(OR(F${r}=""; H${r}=""); ""; F${r} * H${r})`,
          (receipt as any).receipt_no || receipt.notes || "-",
        ]);
      }

      grandTotalAmount += receipt.total_amount || 0;

      if (env.GOOGLE_SHEET_ID_MASTER && spreadsheetId !== env.GOOGLE_SHEET_ID_MASTER) {
        const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
        masterRows.push([
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
        ]);
      }
    }

    // Append all expense rows to Tab 04 in one single API call
    await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PAGU_PENGELUARAN, expenseRows);

    // Append all itemized rows to Tab 05 in one single API call
    if (rincianPengeluaranRows.length > 0) {
      await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.RINCIAN_PENGELUARAN, rincianPengeluaranRows);
    }

    // 2. Batch update matching in Tab 06 (06_PERBANDINGAN_MARGIN)
    try {
      const rekapRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A2:M`,
      });
      const rekapRows = (rekapRes.data.values || []).map((row) => [...row]);
      const matchedRowIndices = new Set<number>();
      const batchUpdates: { range: string; values: any[][] }[] = [];
      const unmatchedReceiptItems: Array<{ item: any; receipt: SupplierReceipt }> = [];

      for (const receipt of receipts) {
        if (!receipt.items || receipt.items.length === 0) continue;

        for (const item of receipt.items) {
          const itemCleanName = item.item_name.toLowerCase().trim();
          let matched = false;

          for (let rIdx = 0; rIdx < rekapRows.length; rIdx++) {
            if (matchedRowIndices.has(rIdx)) continue;
            const row = rekapRows[rIdx];
            const rowSppgRef = String(row[0] || "").trim();
            const rowSupplier = String(row[2] || "").trim();
            const rowItemName = String(row[3] || "").toLowerCase().trim();
            const targetQty = parseCurrencyNumber(row[4]);
            const unit = String(row[5] || "").trim();
            const prevRealisasi = parseCurrencyNumber(row[9]);
            const statusStr = String(row[12] || "").trim();

            const nameMatches =
              rowItemName.includes(itemCleanName) || itemCleanName.includes(rowItemName);
            if (!nameMatches) continue;

            const sppgMatches =
              !receipt.sppg_ref_no ||
              receipt.sppg_ref_no === "-" ||
              rowSppgRef === receipt.sppg_ref_no;
            if (!sppgMatches) continue;

            let prevFulfilledQty = 0;
            const belumMatch = statusStr.match(/BELUM LENGKAP \((\d+(?:\.\d+)?)\//i);
            if (belumMatch) {
              prevFulfilledQty = parseFloat(belumMatch[1]) || 0;
            } else if (prevRealisasi > 0 && parseCurrencyNumber(row[8]) > 0) {
              prevFulfilledQty = Math.round(prevRealisasi / parseCurrencyNumber(row[8]));
            }

            const isComplete =
              !belumMatch &&
              (statusStr.includes("HEMAT") || statusStr.includes("PAS") || statusStr.includes("OVER BUDGET")) &&
              targetQty > 0 &&
              prevFulfilledQty >= targetQty;

            if (isComplete && (!receipt.sppg_ref_no || receipt.sppg_ref_no === "-")) {
              continue;
            }

            const actualRow = rIdx + 2;
            const itemTotal = item.total_price || (item.qty * item.price);
            const newAccumulatedQty = prevFulfilledQty + (item.qty || 1);
            const newAccumulatedRealisasi = prevRealisasi + itemTotal;

            if (targetQty > 0 && newAccumulatedQty < targetQty) {
              const statusText = `🟠 BELUM LENGKAP (${newAccumulatedQty}/${targetQty} ${unit})`;
              batchUpdates.push({
                range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!I${actualRow}:J${actualRow}`,
                values: [[item.price, newAccumulatedRealisasi]],
              });
              batchUpdates.push({
                range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!M${actualRow}`,
                values: [[statusText]],
              });
              row[12] = statusText;
            } else {
              const formulaStatus = `=IF(K${actualRow}>0; "🟢 HEMAT"; IF(K${actualRow}=0; "🟢 PAS"; "🔴 OVER BUDGET"))`;
              batchUpdates.push({
                range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!I${actualRow}:J${actualRow}`,
                values: [[item.price, newAccumulatedRealisasi]],
              });
              batchUpdates.push({
                range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!M${actualRow}`,
                values: [[formulaStatus]],
              });
              row[12] = "PAS";
            }

            row[8] = item.price;
            row[9] = newAccumulatedRealisasi;

            if (receipt.supplier_name && receipt.supplier_name !== "-") {
              if (rowSupplier && !rowSupplier.toLowerCase().includes(receipt.supplier_name.toLowerCase())) {
                const combinedSupplier = `${rowSupplier} (${receipt.supplier_name})`;
                batchUpdates.push({
                  range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!C${actualRow}`,
                  values: [[combinedSupplier]],
                });
                row[2] = combinedSupplier;
              }
            }

            matchedRowIndices.add(rIdx);
            matched = true;
            break;
          }

          if (!matched) {
            unmatchedReceiptItems.push({ item, receipt });
          }
        }
      }

      if (batchUpdates.length > 0) {
        await client.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: batchUpdates,
          },
        });
        logger.info(
          { count: batchUpdates.length, receiptsCount: receipts.length },
          "Batch matched and updated items in 06_PERBANDINGAN_MARGIN"
        );
      }

      if (unmatchedReceiptItems.length > 0) {
        const currentCount = rekapRows.length + 1;
        const extraRows = unmatchedReceiptItems.map(({ item, receipt }, idx) => {
          const r = currentCount + 1 + idx;
          const itemTotal = item.total_price || item.qty * item.price;
          const dateStr = receipt.date || nowIso;
          return [
            receipt.sppg_ref_no || "-",
            dateStr,
            receipt.supplier_name,
            item.item_name,
            item.qty,
            item.unit,
            0,
            0,
            item.price,
            itemTotal,
            `=IF(J${r}=""; ""; H${r}-J${r})`,
            `=IF(OR(H${r}=""; J${r}=""); ""; IFERROR(K${r}/H${r}; 0))`,
            `=IF(J${r}=""; "🟡 MENUNGGU INVOICE"; IF(K${r}>0; "🟢 HEMAT"; IF(K${r}=0; "🟢 PAS"; "🔴 OVER BUDGET")))`,
          ];
        });
        await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PERBANDINGAN_MARGIN, extraRows);
      }
    } catch (matchErr: any) {
      logger.warn({ err: matchErr?.message || matchErr }, "Note during batch 06_PERBANDINGAN_MARGIN matching");
    }

    // 3. Forward all to Master Dashboard in one batch
    if (masterRows.length > 0) {
      this.recordToMasterConsolidated(masterRows).catch((err) => {
        logger.warn({ err: err?.message || err }, "Failed batch forwarding expenses to Master Dashboard");
      });
    }

    return {
      recordedCount: receipts.length,
      totalAmount: grandTotalAmount,
    };
  }

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
  ): Promise<{
    mode: "INSERT" | "APPEND";
    startRow: number;
    count: number;
    matchedExpenseId: string;
  }> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();

    // 1. Read existing rows in 05_RINCIAN_PENGELUARAN (Cols A to D)
    const tab05Res = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A:D`,
    });
    const tab05Rows = tab05Res.data.values || [];

    const target = calculateExpenseInsertionTarget(tab05Rows, expenseId);

    // 2. Get sheetId for 05_RINCIAN_PENGELUARAN
    const meta = await client.spreadsheets.get({ spreadsheetId });
    const sheetMap = new Map<string, number>();
    meta.data.sheets?.forEach((s) => {
      if (s.properties?.title && typeof s.properties?.sheetId === "number") {
        sheetMap.set(s.properties.title, s.properties.sheetId);
      }
    });
    const rincianSheetId = sheetMap.get(SHEET_NAMES.RINCIAN_PENGELUARAN) ?? SHEET_IDS.RINCIAN_PENGELUARAN;

    if (target.mode === "INSERT") {
      // MODE INSERT: Insert dimension right after the last item of this expenseId
      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              insertDimension: {
                range: {
                  sheetId: rincianSheetId,
                  dimension: "ROWS",
                  startIndex: target.insertStartIndex,
                  endIndex: target.insertStartIndex + items.length,
                },
                inheritFromBefore: true,
              },
            },
          ],
        },
      });

      // Prepare rows for the newly inserted space
      let currentItemNo = target.nextItemIndex;
      const newRows: any[][] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const r = target.targetRowIdx + i;
        const refNo = item.sppgRefNo || target.sppgRefNo || "-";
        const supp = item.supplier || target.supplierName || "Supplier";
        const notes = item.receiptNo || item.notes || "-";

        newRows.push([
          refNo,
          target.matchedExpenseId,
          currentItemNo++,
          supp,
          item.itemName,
          item.qty,
          item.unit || "unit",
          item.price,
          `=IF(OR(F${r}=""; H${r}=""); ""; F${r} * H${r})`,
          notes,
        ]);
      }

      await client.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A${target.targetRowIdx}:J${target.targetRowIdx + items.length - 1}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: newRows },
      });

      logger.info(
        { expenseId, targetRowIdx: target.targetRowIdx, count: items.length },
        "Inserted child rows directly under existing expense in 05_RINCIAN_PENGELUARAN"
      );

      return {
        mode: "INSERT",
        startRow: target.targetRowIdx,
        count: items.length,
        matchedExpenseId: target.matchedExpenseId,
      };
    } else {
      // MODE APPEND: Expense has no prior rows in Tab 05, append at the end
      let currentItemNo = 1;
      const newRows: any[][] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const r = target.targetRowIdx + i;
        newRows.push([
          item.sppgRefNo || "-",
          target.matchedExpenseId,
          currentItemNo++,
          item.supplier || "Supplier",
          item.itemName,
          item.qty,
          item.unit || "unit",
          item.price,
          `=IF(OR(F${r}=""; H${r}=""); ""; F${r} * H${r})`,
          item.receiptNo || item.notes || "-",
        ]);
      }

      await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.RINCIAN_PENGELUARAN, newRows);

      return {
        mode: "APPEND",
        startRow: target.targetRowIdx,
        count: items.length,
        matchedExpenseId: target.matchedExpenseId,
      };
    }
  }

  /**
   * Adds a single expense item directly to an existing expense transaction in 05_RINCIAN_PENGELUARAN
   * (Auto-groups under the last item of that transaction via insertDimension).
   * Automatically updates Tab 06 reconciliation if the expense is tied to an SPPG PO.
   */
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
    addedBy = "Telegram User"
  ): Promise<{
    success: boolean;
    message: string;
    targetRow?: number;
    matchedExpenseId?: string;
  }> {
    try {
      const result = await this.appendOrInsertRincianPengeluaranRows(spreadsheetId, expenseId, [item]);

      const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
      await this.appendMasterAuditLogsBatch([
        {
          unitName,
          editor: `${addedBy} (Expense Item Adder)`,
          sheetTab: SHEET_NAMES.RINCIAN_PENGELUARAN,
          refId: result.matchedExpenseId,
          columnEdited: `Sisip Rincian Belanja di ${result.matchedExpenseId} (Baris ${result.startRow}) - ${item.itemName}`,
          oldValue: "-",
          newValue: `${item.qty} ${item.unit || "unit"} @ Rp ${item.price}`,
          sourceAction: "Expense Item Add (Auto Grouping Insert)",
        },
      ]).catch(() => {});

      const modeMsg = result.mode === "INSERT"
        ? `disisipkan rapi di bawah ${result.matchedExpenseId} (Baris ke-${result.startRow})`
        : `ditambahkan di baris ke-${result.startRow}`;

      return {
        success: true,
        message: `Bahan "${item.itemName}" berhasil ${modeMsg} pada Tab 05_RINCIAN_PENGELUARAN. Total tagihan di Tab 04 otomatis diperbarui.`,
        targetRow: result.startRow,
        matchedExpenseId: result.matchedExpenseId,
      };
    } catch (err: any) {
      logger.error({ err: err?.message, spreadsheetId, expenseId, item }, "Failed to add expense item to transaction");
      return { success: false, message: `Gagal menyisipkan rincian belanja: ${err?.message || err}` };
    }
  }
}

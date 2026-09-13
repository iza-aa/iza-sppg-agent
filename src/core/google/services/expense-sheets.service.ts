import { sheets_v4 } from "googleapis";
import { env } from "../../../config/env.js";
import { logger } from "../../utils/logger.js";
import { SupplierReceipt } from "../../ai/schemas/supplier-receipt.schema.js";
import { SHEET_NAMES, SHEET_IDS, createHeaderStylingBatchRequests, createNumberFormattingBatchRequests } from "../recipes/index.js";
import { SheetsClientProvider, parseCurrencyNumber } from "./sheets-client.provider.js";
import { MasterSyncService, MasterAuditLogEntry } from "./master-sync.service.js";
import { ReportingService } from "./reporting.service.js";
import { getWibTimestamp, getWibShortTimestamp, formatWibDisplay } from "../../utils/date-time.js";
import { formatRupiah } from "../../telegram/formatter.js";

export interface ExpenseInsertionTarget {
  mode: "INSERT" | "APPEND";
  targetRowIdx: number;       // 1-based row index in Google Sheet where new row is located
  insertStartIndex: number;   // 0-based index for insertDimension
  nextItemIndex: number;      // Next No Urut (1, 2, 3...)
  matchedExpenseId: string;   // The canonical expense ID matched in the sheet
  sppgRefNo: string;          // SPPG reference if available
  paguId: string;             // ID Pendapatan if available
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
  let paguId = "-";
  let supplierName = "Supplier";

  for (let i = 0; i < tab05Rows.length; i++) {
    const row = tab05Rows[i];
    // In new 12-col layout: Col B is ID Pendapatan, Col C is ID Pengeluaran
    const colC = String(row[2] || "");
    const colB = String(row[1] || "");
    const isNewLayout = matchesExpenseId(colC);
    const isOldLayout = !isNewLayout && matchesExpenseId(colB);

    if (isNewLayout || isOldLayout) {
      lastRowIndex = i + 1; // 1-based
      matchedExpenseId = isNewLayout ? colC : colB;
      const parsedIdx = parseInt(String(isNewLayout ? (row[3] || "0") : (row[2] || "0")), 10);
      if (!isNaN(parsedIdx) && parsedIdx > maxItemIndex) {
        maxItemIndex = parsedIdx;
      }
      if (row[0] && String(row[0]).trim() !== "-") {
        sppgRefNo = String(row[0]).trim();
      }
      if (isNewLayout && row[1] && String(row[1]).trim() !== "-") {
        paguId = String(row[1]).trim();
      }
      const supp = isNewLayout ? row[4] : row[3];
      if (supp && String(supp).trim()) {
        supplierName = String(supp).trim();
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
      paguId,
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
      paguId: "-",
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

  async findPaguIdByOrderNo(spreadsheetId: string, orderQuery: string): Promise<string> {
    try {
      const client = await this.getClient();
      const res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A2:B`,
      });
      const rows = res.data?.values || [];
      const clean = orderQuery.trim().toUpperCase();
      for (const r of rows) {
        const oNo = String(r[0] || "").trim().toUpperCase();
        const pId = String(r[1] || "").trim();
        if (oNo === clean || oNo.includes(clean) || clean.includes(oNo) || pId.toUpperCase() === clean) {
          return pId || oNo;
        }
      }
    } catch {}
    return "-";
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
        range: `'${SHEET_NAMES.PAGU_PENGELUARAN}'!A2:L`,
      }).catch(() => ({ data: { values: null } }));

      const tab04Rows = tab04Res.data.values || [];
      if (tab04Rows.length === 0) return;

      // 3. Read Tab 06 (Perbandingan Margin) to see if item-level realizations already exist
      const tab06Res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A2:O`,
      }).catch(() => ({ data: { values: null } }));
      const tab06Rows = tab06Res.data.values || [];

      const tab05NewRows: any[][] = [];
      const updatedTab04Formulas: { range: string; values: any[][] }[] = [];

      for (let rIdx = 0; rIdx < tab04Rows.length; rIdx++) {
        const row = tab04Rows[rIdx];
        const rowNo = rIdx + 2;
        const is12Col = row.length >= 12;
        const sppgRef = String(row[0] || "").trim();
        const paguId = is12Col ? String(row[1] || "-").trim() : "-";
        const trxId = is12Col ? String(row[2] || "").trim() : String(row[1] || "").trim();
        const isMazhabEksekutif = is12Col && /^\d{4}-\d{2}-\d{2}$/.test(String(row[3] || "").trim());
        const supplierName = isMazhabEksekutif
          ? String(row[4] || "Supplier Pasar").trim()
          : (is12Col ? String(row[5] || "Supplier Pasar").trim() : String(row[4] || "Supplier Pasar").trim());
        const totalAmount = isMazhabEksekutif
          ? parseCurrencyNumber(row[6])
          : (is12Col ? parseCurrencyNumber(row[7]) : parseCurrencyNumber(row[6]));
        const notes = is12Col ? String(row[11] || "Pencatatan Belanja").trim() : String(row[10] || "Pencatatan Belanja").trim();

        if (!trxId) continue;

        // Check if there are realisasi items in Tab 06 matching this sppgRef
        const matchedItems = sppgRef && sppgRef !== "-"
          ? tab06Rows.filter((r) => {
              const rSppg = String(r[0] || "").trim();
              const realPrice = parseCurrencyNumber(r[10] ?? r[8]);
              const realTotal = parseCurrencyNumber(r[11] ?? r[9]);
              return rSppg === sppgRef && (realPrice > 0 || realTotal > 0);
            })
          : [];

        if (matchedItems.length > 0) {
          let matchedSum = 0;
          matchedItems.forEach((m, idx) => {
            const itemName = String(m[5] || m[3] || "Bahan Makanan").trim();
            const qty = parseCurrencyNumber(m[6] ?? m[4]) || 1;
            const unit = String(m[7] || m[5] || "Satuan").trim();
            const realPrice = parseCurrencyNumber(m[10] ?? m[8]) || (parseCurrencyNumber(m[11] ?? m[9]) / qty);
            const targetRowIdx = tab05NewRows.length + 2;
            const subtotalFormula = `=IF(OR(G${targetRowIdx}=""; I${targetRowIdx}=""); ""; G${targetRowIdx} * I${targetRowIdx})`;
            matchedSum += qty * realPrice;

            tab05NewRows.push([
              sppgRef,
              paguId,
              trxId,
              idx + 1,
              supplierName,
              itemName,
              qty,
              unit,
              realPrice,
              subtotalFormula,
              "Pengguna",
              getWibTimestamp(),
              "-",
            ]);
          });

          // If there is an unitemized remainder between matched items and the total invoice
          if (totalAmount > matchedSum) {
            const diff = totalAmount - matchedSum;
            const targetRowIdx = tab05NewRows.length + 2;
            tab05NewRows.push([
              sppgRef,
              paguId,
              trxId,
              matchedItems.length + 1,
              supplierName,
              "Belanja Bahan Tambahan Pasar / Lain-lain",
              1,
              "Paket",
              diff,
              `=IF(OR(G${targetRowIdx}=""; I${targetRowIdx}=""); ""; G${targetRowIdx} * I${targetRowIdx})`,
              "Pengguna",
              getWibTimestamp(),
              "-",
            ]);
          }
        } else {
          // Unitemized fallback entry
          const targetRowIdx = tab05NewRows.length + 2;
          tab05NewRows.push([
            sppgRef,
            paguId,
            trxId,
            1,
            supplierName,
            notes.includes("item") ? notes : `Belanja Bahan (${notes})`,
            1,
            "Paket",
            totalAmount,
            `=IF(OR(G${targetRowIdx}=""; I${targetRowIdx}=""); ""; G${targetRowIdx} * I${targetRowIdx})`,
            "Pengguna",
            getWibTimestamp(),
            notes,
          ]);
        }

        // Prepare dynamic formula for Tab 04 Col G (Total Tagihan in Mazhab Eksekutif)
        updatedTab04Formulas.push({
          range: `'${SHEET_NAMES.PAGU_PENGELUARAN}'!G${rowNo}`,
          values: [[`=IF(COUNTIF('${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$C:$C; C${rowNo})>0; SUMIF('${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$C:$C; C${rowNo}; '${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$J:$J); ${totalAmount})`]],
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

      const wibTimestamp = getWibTimestamp();
      let tab04Keterangan = "-";
      const isPdf = Boolean(
        (receipt as any).mime_type === "application/pdf" ||
        (receipt as any).file_name?.toLowerCase?.().endsWith(".pdf") ||
        (driveLink && driveLink.toLowerCase().includes(".pdf"))
      );
      const isPhoto = Boolean(driveLink && driveLink !== "-" && driveLink.trim() !== "");
      let userText = (rawCaption || receipt.notes || "").trim();
      if (userText === "Pencatatan teks via Telegram" || userText === "Pencatatan Offline (Regex Fallback Layer 3)") {
        userText = "";
      }

      if (isPdf) {
        const fName = (receipt as any).file_name || "";
        tab04Keterangan = fName ? `[Dokumen PDF] ${fName}` : "[Dokumen PDF]";
      } else if (isPhoto) {
        if (userText && !userText.startsWith("Nota INV-") && !userText.startsWith("http")) {
          tab04Keterangan = `[Foto Nota] "${userText}"`;
        } else {
          tab04Keterangan = "[Foto Nota]";
        }
      } else if (userText) {
        if (userText.startsWith("[Chat]") || userText.startsWith("[Foto Nota]") || userText.startsWith("[Dokumen PDF]")) {
          tab04Keterangan = userText;
        } else if (userText.startsWith("http")) {
          tab04Keterangan = "[Foto Nota]";
        } else {
          tab04Keterangan = `[Chat] ${userText}`;
        }
      } else if (itemsSummary) {
        tab04Keterangan = `[Chat] ${itemsSummary}`;
      }

      let paguId = (receipt as any).pagu_id || "-";
      if ((!paguId || paguId === "-") && receipt.sppg_ref_no && receipt.sppg_ref_no !== "-") {
        paguId = await this.findPaguIdByOrderNo(spreadsheetId, receipt.sppg_ref_no);
      }

      // 1. Write Parent Row to 04_PENGELUARAN (12 columns: Mazhab Eksekutif)
      const expenseRow = [
        receipt.sppg_ref_no || "-",                                 // A: No SPPG Ref
        paguId || "-",                                              // B: ID Pendapatan
        expenseId,                                                  // C: ID Pengeluaran
        dateStr,                                                    // D: Tanggal
        receipt.supplier_name,                                      // E: Nama Supplier
        (receipt as any).receipt_no || "-",                         // F: No Invoice Supplier
        `=IF(COUNTIF('${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$C:$C; C${targetExpenseRow})>0; SUMIF('${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$C:$C; C${targetExpenseRow}; '${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$J:$J); ${receipt.total_amount})`, // G: Total Tagihan
        receipt.payment_method || "Tunai",                          // H: Metode
        driveLinkFormula,                                           // I: Link Bukti Nota
        picName || "Pengguna",                                      // J: Pengguna
        wibTimestamp,                                               // K: Waktu Input
        tab04Keterangan,                                            // L: Keterangan
      ];

      await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PAGU_PENGELUARAN, [expenseRow]);
    }

    let paguIdForItems = (receipt as any).pagu_id || "-";
    if ((!paguIdForItems || paguIdForItems === "-") && receipt.sppg_ref_no && receipt.sppg_ref_no !== "-") {
      paguIdForItems = await this.findPaguIdByOrderNo(spreadsheetId, receipt.sppg_ref_no);
    }

    // 2. Write Child Item Rows to 05_RINCIAN_PENGELUARAN using auto-grouping by expenseId
    const cleanItemNotes = (receipt as any).receipt_no || "-";
    const itemsToRecord = (receipt.items && receipt.items.length > 0)
      ? receipt.items.map((it) => {
          const itemRawNote = (it as any).notes;
          const safeItemNote = (itemRawNote && !itemRawNote.includes("Pencatatan teks") && !itemRawNote.includes("Regex Fallback")) ? itemRawNote : cleanItemNotes;
          return {
            itemName: it.item_name,
            qty: it.qty,
            unit: it.unit,
            price: it.price,
            supplier: it.supplier_name || receipt.supplier_name,
            notes: (receipt as any).receipt_no || safeItemNote,
            sppgRefNo: receipt.sppg_ref_no || "-",
            paguId: paguIdForItems,
            receiptNo: (receipt as any).receipt_no,
            pic: picName || "Pengguna",
          };
        })
      : [{
          itemName: (receipt.notes && !receipt.notes.startsWith("Nota INV-") ? receipt.notes : "") || rawCaption || "Belanja Bahan Dapur (Unitemized)",
          qty: 1,
          unit: "Paket",
          price: receipt.total_amount,
          supplier: receipt.supplier_name,
          notes: cleanItemNotes,
          sppgRefNo: receipt.sppg_ref_no || "-",
          paguId: paguIdForItems,
          receiptNo: (receipt as any).receipt_no,
          pic: picName || "Pengguna",
        }];

    await this.appendOrInsertRincianPengeluaranRows(spreadsheetId, expenseId!, itemsToRecord, picName);

    // 3. Automated Linking and Allocation to Pagu
    if (receipt.sppg_ref_no && receipt.sppg_ref_no !== "-") {
      try {
        await this.linkExpenseToPagu(spreadsheetId, expenseId!, receipt.sppg_ref_no, picName || "Admin");
      } catch (linkErr: any) {
        logger.warn({ err: linkErr?.message || linkErr, expenseId, sppgRef: receipt.sppg_ref_no }, "Error during auto-linking expense to pagu");
      }
    } else {
      logger.info({ expenseId }, "Expense is Belanja Tambahan (Non-Pagu, '-'). Skipping Pagu allocation.");
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
    const linkedExpenses: Array<{ expenseId: string; sppgRefNo: string }> = [];

    for (const receipt of receipts) {
      const dateStr = receipt.date || nowIso;
      const expenseId = this.generateTransactionId(unitCode, dateStr, counter++, "expense");
      if (receipt.sppg_ref_no && receipt.sppg_ref_no !== "-") {
        linkedExpenses.push({ expenseId, sppgRefNo: receipt.sppg_ref_no });
      }
      const currentExpRow = targetExpenseRow++;
      const itemsSummary =
        receipt.items && receipt.items.length > 0
          ? receipt.items.map((i) => `${i.item_name} (${i.qty} ${i.unit})`).join(", ")
          : "Belanja Bahan Dapur";
      const driveLink = (receipt as any).driveLink || "";
      const driveLinkFormula = driveLink ? `=HYPERLINK("${driveLink}"; "Lihat Nota")` : "-";

      const wibTimestamp = getWibTimestamp();
      let tab04Keterangan = "-";
      const isPhoto = Boolean(driveLink && driveLink !== "-" && driveLink.trim() !== "");
      let userText = (rawCaption || (receipt as any).rawCaption || receipt.notes || "").trim();
      if (userText === "Pencatatan teks via Telegram" || userText === "Pencatatan Offline (Regex Fallback Layer 3)") {
        userText = "";
      }

      if (isPhoto) {
        if (userText && !userText.startsWith("Nota INV-") && !userText.startsWith("http")) {
          tab04Keterangan = `[Foto Nota] "${userText}"`;
        } else {
          tab04Keterangan = "[Foto Nota]";
        }
      } else if (userText) {
        if (userText.startsWith("[Chat]") || userText.startsWith("[Foto Nota]")) {
          tab04Keterangan = userText;
        } else if (userText.startsWith("http")) {
          tab04Keterangan = "[Foto Nota]";
        } else {
          tab04Keterangan = `[Chat] ${userText}`;
        }
      } else if (itemsSummary) {
        tab04Keterangan = itemsSummary;
      }

      let paguId = (receipt as any).pagu_id || "-";
      if ((!paguId || paguId === "-") && receipt.sppg_ref_no && receipt.sppg_ref_no !== "-") {
        paguId = await this.findPaguIdByOrderNo(spreadsheetId, receipt.sppg_ref_no);
      }

      expenseRows.push([
        receipt.sppg_ref_no || "-",                                 // A: No SPPG Ref
        paguId || "-",                                              // B: ID Pendapatan
        expenseId,                                                  // C: ID Pengeluaran
        dateStr,                                                    // D: Tanggal
        receipt.supplier_name,                                      // E: Nama Supplier
        (receipt as any).receipt_no || "-",                         // F: No Invoice Supplier
        `=IF(COUNTIF('${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$C:$C; C${currentExpRow})>0; SUMIF('${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$C:$C; C${currentExpRow}; '${SHEET_NAMES.RINCIAN_PENGELUARAN}'!$J:$J); ${receipt.total_amount})`, // G: Total Tagihan
        receipt.payment_method || "Tunai",                          // H: Metode
        driveLinkFormula,                                           // I: Link Bukti Nota
        picName || "Pengguna",                                      // J: Pengguna
        wibTimestamp,                                               // K: Waktu Input
        tab04Keterangan,                                            // L: Keterangan
      ]);

      const cleanItemNotes = (receipt as any).receipt_no || (receipt.notes && !receipt.notes.startsWith("Nota INV-") ? receipt.notes : "-");
      const itemsToRecord = (receipt.items && receipt.items.length > 0)
        ? receipt.items
        : [{
            item_name: (receipt.notes && !receipt.notes.startsWith("Nota INV-") ? receipt.notes : "") || rawCaption || itemsSummary || "Belanja Bahan Dapur (Unitemized)",
            qty: 1,
            unit: "Paket",
            price: receipt.total_amount,
            total_price: receipt.total_amount
          }];

      for (let idx = 0; idx < itemsToRecord.length; idx++) {
        const item = itemsToRecord[idx];
        const r = rincianExpCounter++;
        const rawItemNotes = (item as any).notes;
        const safeItemNotes = (rawItemNotes && !rawItemNotes.includes("Pencatatan teks") && !rawItemNotes.includes("Regex Fallback"))
          ? rawItemNotes
          : cleanItemNotes;
        rincianPengeluaranRows.push([
          receipt.sppg_ref_no || "-",                              // A: No SPPG Ref
          paguId || "-",                                           // B: ID Pendapatan
          expenseId,                                               // C: ID Pengeluaran
          idx + 1,                                                 // D: No Urut
          receipt.supplier_name,                                   // E: Nama Supplier
          item.item_name,                                          // F: Uraian Bahan Belanja
          item.qty,                                                // G: Kuantitas
          item.unit,                                               // H: Satuan
          item.price,                                              // I: Harga Satuan
          `=IF(OR(G${r}=""; I${r}=""); ""; G${r} * I${r})`,        // J: Total Belanja
          picName || "Pengguna",                                   // K: Pengguna
          wibTimestamp,                                            // L: Waktu Input
          (receipt as any).receipt_no || safeItemNotes,            // M: Keterangan
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

    // 2. Batch auto-linking and allocation to Pagu
    for (const item of linkedExpenses) {
      try {
        await this.linkExpenseToPagu(spreadsheetId, item.expenseId, item.sppgRefNo, picName || "Admin");
      } catch (linkErr: any) {
        logger.warn({ err: linkErr?.message || linkErr, expenseId: item.expenseId, sppgRefNo: item.sppgRefNo }, "Error during batch auto-linking expense to pagu");
      }
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
      paguId?: string;
      receiptNo?: string;
      pic?: string;
    }>,
    picName?: string
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
      const wibTimestamp = getWibTimestamp();
      let currentItemNo = target.nextItemIndex;
      const newRows: any[][] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const r = target.targetRowIdx + i;
        const refNo = item.sppgRefNo || target.sppgRefNo || "-";
        const paguId = item.paguId || target.paguId || "-";
        const supp = item.supplier || target.supplierName || "Supplier";
        const notes = item.receiptNo || item.notes || "-";

        newRows.push([
          refNo,
          paguId,
          target.matchedExpenseId,
          currentItemNo++,
          supp,
          item.itemName,
          item.qty,
          item.unit || "unit",
          item.price,
          `=IF(OR(G${r}=""; I${r}=""); ""; G${r} * I${r})`,
          item.pic || picName || "Pengguna",
          wibTimestamp,
          notes,
        ]);
      }

      await client.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A${target.targetRowIdx}:M${target.targetRowIdx + items.length - 1}`,
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
      const wibTimestamp = getWibTimestamp();
      let currentItemNo = 1;
      const newRows: any[][] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const r = target.targetRowIdx + i;
        const paguId = item.paguId || target.paguId || "-";
        newRows.push([
          item.sppgRefNo || "-",
          paguId,
          target.matchedExpenseId,
          currentItemNo++,
          item.supplier || "Supplier",
          item.itemName,
          item.qty,
          item.unit || "unit",
          item.price,
          `=IF(OR(G${r}=""; I${r}=""); ""; G${r} * I${r})`,
          item.pic || picName || "Pengguna",
          wibTimestamp,
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
  /**
   * Reconciles Tab 06 after adding an expense item to an existing transaction.
   */
  private async reconcileTab06AfterItemAdd(
    spreadsheetId: string,
    expenseId: string,
    sppgRefNo: string,
    supplierName: string,
    item: {
      itemName: string;
      qty: number;
      unit?: string;
      price: number;
      supplier?: string;
      notes?: string;
    },
    isNonPagu?: boolean
  ): Promise<void> {
    const client = await this.getClient();
    const cleanRefNo = (sppgRefNo || "-").trim();
    const dateStr = new Date().toISOString().slice(0, 10);
    const itemCleanName = item.itemName.toLowerCase().trim();
    const supplier = item.supplier || supplierName || "Supplier";
    const unit = item.unit || "satuan";
    const itemTotal = item.qty * item.price;

    const rekapRes = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A:O`,
    });
    const rekapRows = rekapRes.data.values || [];

    if (isNonPagu) {
      // Find where to insert in Tab 06 (either after last row of cleanRefNo, or append at end)
      let lastRekapRowIndex = -1;
      if (cleanRefNo !== "-") {
        for (let i = 0; i < rekapRows.length; i++) {
          const row = rekapRows[i];
          if (String(row[0] || "").trim().toLowerCase() === cleanRefNo.toLowerCase()) {
            lastRekapRowIndex = i + 1; // 1-based
          }
        }
      }

      const meta = await client.spreadsheets.get({ spreadsheetId });
      const sheetMap = new Map<string, number>();
      meta.data.sheets?.forEach((s) => {
        if (s.properties?.title && typeof s.properties?.sheetId === "number") {
          sheetMap.set(s.properties.title, s.properties.sheetId);
        }
      });
      const rekapSheetId = sheetMap.get(SHEET_NAMES.PERBANDINGAN_MARGIN) ?? SHEET_IDS.PERBANDINGAN_MARGIN;

      if (lastRekapRowIndex > 0) {
        const targetRow = lastRekapRowIndex + 1;
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

        const newRow = [
          cleanRefNo,
          "-",
          expenseId,
          dateStr,
          supplier,
          `${item.itemName} [Non-Pagu]`,
          item.qty,
          unit,
          0,
          0,
          item.price,
          itemTotal,
          `=IF(L${targetRow}=""; ""; J${targetRow}-L${targetRow})`,
          `=IF(OR(J${targetRow}=""; L${targetRow}=""); ""; IFERROR(M${targetRow}/J${targetRow}; 0))`,
          "🔴 NON-PAGU",
        ];

        await client.spreadsheets.values.update({
          spreadsheetId,
          range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A${targetRow}:O${targetRow}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [newRow] },
        });
      } else {
        const targetRow = rekapRows.length + 1;
        const newRow = [
          cleanRefNo,
          "-",
          expenseId,
          dateStr,
          supplier,
          `${item.itemName} [Non-Pagu]`,
          item.qty,
          unit,
          0,
          0,
          item.price,
          itemTotal,
          `=IF(L${targetRow}=""; ""; J${targetRow}-L${targetRow})`,
          `=IF(OR(J${targetRow}=""; L${targetRow}=""); ""; IFERROR(M${targetRow}/J${targetRow}; 0))`,
          "🔴 NON-PAGU",
        ];
        await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PERBANDINGAN_MARGIN, [newRow]);
      }
      return;
    }

    // Normal In-Pagu reconciliation
    for (let rIdx = 1; rIdx < rekapRows.length; rIdx++) {
      const row = rekapRows[rIdx];
      const rowSppgRef = String(row[0] || "").trim();
      const isNewLayout = row.length >= 14 || (row[1] && String(row[1]).startsWith("SPPG"));
      const rowItemName = String((isNewLayout ? row[5] : row[3]) || "").toLowerCase().trim();

      const nameMatches = rowItemName.includes(itemCleanName) || itemCleanName.includes(rowItemName);
      const refMatches = cleanRefNo === "-" || !rowSppgRef || rowSppgRef.toLowerCase() === cleanRefNo.toLowerCase();

      if (nameMatches && refMatches) {
        const actualRow = rIdx + 1; // 1-based
        const targetQty = parseCurrencyNumber(isNewLayout ? row[6] : row[4]);
        const prevRealisasi = parseCurrencyNumber(isNewLayout ? row[11] : row[9]);
        const statusStr = String((isNewLayout ? row[14] : row[12]) || "").trim();
        const invoicePriceCol = isNewLayout ? row[10] : row[8];

        let prevFulfilledQty = 0;
        const belumMatch = statusStr.match(/BELUM LENGKAP \((\d+(?:\.\d+)?)\//i);
        if (belumMatch) {
          prevFulfilledQty = parseFloat(belumMatch[1]) || 0;
        } else if (prevRealisasi > 0 && parseCurrencyNumber(invoicePriceCol) > 0) {
          prevFulfilledQty = Math.round(prevRealisasi / parseCurrencyNumber(invoicePriceCol));
        }

        const newAccumulatedQty = prevFulfilledQty + (item.qty || 1);
        const newAccumulatedRealisasi = prevRealisasi + itemTotal;

        const batchUpdates: { range: string; values: any[][] }[] = [];
        if (isNewLayout) {
          const currentExpId = String(row[2] || "").trim();
          if (!currentExpId || currentExpId === "-") {
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!C${actualRow}`,
              values: [[expenseId]],
            });
          }

          if (targetQty > 0 && newAccumulatedQty < targetQty) {
            const statusText = `🟠 BELUM LENGKAP (${newAccumulatedQty}/${targetQty} ${unit})`;
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!K${actualRow}:L${actualRow}`,
              values: [[item.price, newAccumulatedRealisasi]],
            });
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!O${actualRow}`,
              values: [[statusText]],
            });
          } else {
            const formulaStatus = `=IF(M${actualRow}>0; "🟢 HEMAT"; IF(M${actualRow}=0; "🟢 PAS"; "🔴 OVER BUDGET"))`;
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!K${actualRow}:L${actualRow}`,
              values: [[item.price, newAccumulatedRealisasi]],
            });
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!O${actualRow}`,
              values: [[formulaStatus]],
            });
          }
        } else {
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
        }

        await client.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: batchUpdates,
          },
        });
        break;
      }
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
    addedBy = "Telegram User",
    options?: {
      isNonPagu?: boolean;
    }
  ): Promise<{
    success: boolean;
    message: string;
    targetRow?: number;
    matchedExpenseId?: string;
  }> {
    try {
      const itemToInsert = { ...item };
      if (options?.isNonPagu && !itemToInsert.notes?.includes("NON-PAGU")) {
        itemToInsert.notes = itemToInsert.notes && itemToInsert.notes !== "-"
          ? `[NON-PAGU] ${itemToInsert.notes}`
          : "[NON-PAGU]";
      }

      const result = await this.appendOrInsertRincianPengeluaranRows(spreadsheetId, expenseId, [itemToInsert], addedBy);

      const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
      await this.appendMasterAuditLogsBatch([
        {
          unitName,
          editor: `${addedBy} (Expense Item Adder)`,
          sheetTab: SHEET_NAMES.RINCIAN_PENGELUARAN,
          refId: result.matchedExpenseId,
          columnEdited: `Sisip Rincian Belanja di ${result.matchedExpenseId} (Baris ${result.startRow}) - ${item.itemName}${options?.isNonPagu ? " [Non-Pagu]" : ""}`,
          oldValue: "-",
          newValue: `${item.qty} ${item.unit || "unit"} @ Rp ${item.price}`,
          sourceAction: options?.isNonPagu ? "Expense Item Add (Non-Pagu)" : "Expense Item Add (Auto Grouping Insert)",
        },
      ]).catch(() => {});

      // Reconcile Tab 06
      const trxInfo = await this.findTransactionById(spreadsheetId, expenseId).catch(() => null);
      const sppgRef = (trxInfo && trxInfo.found && trxInfo.orderNo) ? trxInfo.orderNo : "-";
      const suppName = (trxInfo && trxInfo.found && trxInfo.supplierOrUnit) ? trxInfo.supplierOrUnit : (item.supplier || "Supplier");

      await this.reconcileTab06AfterItemAdd(
        spreadsheetId,
        expenseId,
        sppgRef,
        suppName,
        item,
        options?.isNonPagu
      ).catch((err) => {
        logger.warn({ err: err?.message || err }, "Note during Tab 06 reconciliation after item add");
      });

      const modeMsg = result.mode === "INSERT"
        ? `disisipkan rapi di bawah ${result.matchedExpenseId} (Baris ke-${result.startRow})`
        : `ditambahkan di baris ke-${result.startRow}`;

      const nonPaguNote = options?.isNonPagu ? " [Non-Pagu dicatat ke Tab 06]" : "";

      return {
        success: true,
        message: `Bahan "${item.itemName}" berhasil ${modeMsg} pada Tab 05_RINCIAN_PENGELUARAN${nonPaguNote}. Total tagihan di Tab 04 dan evaluasi Tab 06 otomatis diperbarui.`,
        targetRow: result.startRow,
        matchedExpenseId: result.matchedExpenseId,
      };
    } catch (err: any) {
      logger.error({ err: err?.message, spreadsheetId, expenseId, item }, "Failed to add expense item to transaction");
      return { success: false, message: `Gagal menyisipkan rincian belanja: ${err?.message || err}` };
    }
  }

  /**
   * Searches for a specific child item in 05_RINCIAN_PENGELUARAN by expenseId and itemName
   */
  async findExpenseChildItem(
    spreadsheetId: string,
    expenseId: string,
    itemName: string
  ): Promise<ExpenseChildItemFound> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();

    const cleanTargetId = (expenseId || "").trim().toUpperCase();
    const cleanTargetName = (itemName || "").trim().toLowerCase();

    const matchesExpenseId = (candidate: string): boolean => {
      const c = String(candidate || "").trim().toUpperCase();
      if (!c || !cleanTargetId) return false;
      return (
        c === cleanTargetId ||
        c.endsWith(`-${cleanTargetId}`) ||
        c.endsWith(`_${cleanTargetId}`) ||
        cleanTargetId.endsWith(`-${c}`) ||
        cleanTargetId.endsWith(`_${c}`) ||
        (cleanTargetId.length >= 4 && c.includes(cleanTargetId))
      );
    };

    const tab05Res = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A:M`,
    });
    const tab05Rows = tab05Res.data.values || [];

    const expenseRows: Array<{
      rowIndex: number;
      itemIndex: number;
      sppgRefNo: string;
      expenseId: string;
      supplier: string;
      itemName: string;
      qty: number;
      unit: string;
      price: number;
      total: number;
      notes: string;
    }> = [];

    for (let i = 1; i < tab05Rows.length; i++) {
      const row = tab05Rows[i];
      const isNewLayout = row.length >= 12 || (row[1] && row[2] && String(row[2]).startsWith("SPPG"));
      const rowExpId = String((isNewLayout ? row[2] : row[1]) || "");
      const rowSppgRef = String(row[0] || "");
      if (!cleanTargetId || matchesExpenseId(rowExpId) || matchesExpenseId(rowSppgRef)) {
        const itemIdx = parseInt(String((isNewLayout ? row[3] : row[2]) || "1"), 10) || 1;
        const qtyVal = parseCurrencyNumber(isNewLayout ? row[6] : row[5]) || 0;
        const priceVal = parseCurrencyNumber(isNewLayout ? row[8] : row[7]) || 0;
        const totalVal = parseCurrencyNumber(isNewLayout ? row[9] : row[8]) || (qtyVal * priceVal);
        expenseRows.push({
          rowIndex: i + 1, // 1-based row index in sheet
          itemIndex: itemIdx,
          sppgRefNo: rowSppgRef,
          expenseId: rowExpId,
          supplier: String((isNewLayout ? row[4] : row[3]) || ""),
          itemName: String((isNewLayout ? row[5] : row[4]) || ""),
          qty: qtyVal,
          unit: String((isNewLayout ? row[7] : row[6]) || "satuan"),
          price: priceVal,
          total: totalVal,
          notes: String((isNewLayout ? row[10] : row[9]) || ""),
        });
      }
    }

    if (expenseRows.length === 0) {
      return {
        found: false,
        rowIndex: 0,
        itemIndex: 0,
        sppgRefNo: "-",
        expenseId: cleanTargetId,
        supplier: "Supplier",
        itemName,
        qty: 0,
        unit: "unit",
        price: 0,
        total: 0,
        notes: "-",
        isNonPagu: false,
        isOnlyItemInExpense: false,
        siblingCount: 0,
      };
    }

    let matched = expenseRows.find((r) => {
      const cleanRowName = r.itemName.toLowerCase().trim();
      const strippedRow = cleanRowName.replace(/\[.*?\]/g, "").trim();
      const strippedTarget = cleanTargetName.replace(/\[.*?\]/g, "").trim();
      return (
        cleanRowName === cleanTargetName ||
        strippedRow === strippedTarget ||
        cleanRowName.includes(cleanTargetName) ||
        cleanTargetName.includes(cleanRowName) ||
        (strippedTarget.length >= 3 && strippedRow.includes(strippedTarget)) ||
        (strippedRow.length >= 3 && strippedTarget.includes(strippedRow))
      );
    });

    if (!matched && (!cleanTargetName || cleanTargetName === "") && expenseRows.length === 1) {
      matched = expenseRows[0];
    }

    if (!matched) {
      return {
        found: false,
        rowIndex: 0,
        itemIndex: 0,
        sppgRefNo: expenseRows[0]?.sppgRefNo || "-",
        expenseId: expenseRows[0]?.expenseId || cleanTargetId,
        supplier: expenseRows[0]?.supplier || "Supplier",
        itemName,
        qty: 0,
        unit: "unit",
        price: 0,
        total: 0,
        notes: "-",
        isNonPagu: false,
        isOnlyItemInExpense: expenseRows.length === 1,
        siblingCount: expenseRows.length,
        otherItems: expenseRows.map((r) => r.itemName),
      };
    }

    const isNonPagu =
      matched.notes.toUpperCase().includes("NON-PAGU") ||
      matched.itemName.toUpperCase().includes("[NON-PAGU]");

    const otherItems = expenseRows
      .filter((r) => r.rowIndex !== matched!.rowIndex)
      .map((r) => r.itemName);

    return {
      found: true,
      rowIndex: matched.rowIndex,
      itemIndex: matched.itemIndex,
      sppgRefNo: matched.sppgRefNo,
      expenseId: matched.expenseId,
      supplier: matched.supplier,
      itemName: matched.itemName,
      qty: matched.qty,
      unit: matched.unit,
      price: matched.price,
      total: matched.total,
      notes: matched.notes,
      isNonPagu,
      isOnlyItemInExpense: expenseRows.length === 1,
      siblingCount: expenseRows.length,
      otherItems,
    };
  }

  /**
   * Retrieves all child items under an expense transaction in Tab 05
   */
  async getExpenseChildItems(
    spreadsheetId: string,
    expenseId: string
  ): Promise<ExpenseChildItemFound[]> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();
    const cleanTargetId = (expenseId || "").trim().toUpperCase();

    const matchesExpenseId = (candidate: string): boolean => {
      const c = String(candidate || "").trim().toUpperCase();
      if (!c || !cleanTargetId) return false;
      return (
        c === cleanTargetId ||
        c.endsWith(`-${cleanTargetId}`) ||
        c.endsWith(`_${cleanTargetId}`) ||
        cleanTargetId.endsWith(`-${c}`) ||
        cleanTargetId.endsWith(`_${c}`) ||
        (cleanTargetId.length >= 4 && c.includes(cleanTargetId))
      );
    };

    const tab05Res = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A:M`,
    });
    const tab05Rows = tab05Res.data.values || [];
    const items: ExpenseChildItemFound[] = [];

    for (let i = 1; i < tab05Rows.length; i++) {
      const row = tab05Rows[i];
      const isNewLayout = row.length >= 12 || (row[1] && row[2] && String(row[2]).startsWith("SPPG"));
      const rowExpId = String((isNewLayout ? row[2] : row[1]) || "");
      const rowSppgRef = String(row[0] || "");
      if (matchesExpenseId(rowExpId) || matchesExpenseId(rowSppgRef)) {
        const itemIdx = parseInt(String((isNewLayout ? row[3] : row[2]) || "1"), 10) || 1;
        const qtyVal = parseCurrencyNumber(isNewLayout ? row[6] : row[5]) || 0;
        const priceVal = parseCurrencyNumber(isNewLayout ? row[8] : row[7]) || 0;
        const totalVal = parseCurrencyNumber(isNewLayout ? row[9] : row[8]) || (qtyVal * priceVal);
        const notesStr = String((isNewLayout ? row[10] : row[9]) || "");
        const itemNam = String((isNewLayout ? row[5] : row[4]) || "");
        const isNonPagu = notesStr.toUpperCase().includes("NON-PAGU") || itemNam.toUpperCase().includes("[NON-PAGU]");

        items.push({
          found: true,
          rowIndex: i + 1,
          itemIndex: itemIdx,
          sppgRefNo: rowSppgRef,
          expenseId: rowExpId,
          supplier: String((isNewLayout ? row[4] : row[3]) || ""),
          itemName: itemNam,
          qty: qtyVal,
          unit: String((isNewLayout ? row[7] : row[6]) || "satuan"),
          price: priceVal,
          total: totalVal,
          notes: notesStr,
          isNonPagu,
          isOnlyItemInExpense: false,
          siblingCount: 0,
        });
      }
    }

    const totalCount = items.length;
    return items.map((it) => ({
      ...it,
      isOnlyItemInExpense: totalCount === 1,
      siblingCount: totalCount,
      otherItems: items.filter((x) => x.rowIndex !== it.rowIndex).map((x) => x.itemName),
    }));
  }

  /**
   * Deletes a specific child item row from 05_RINCIAN_PENGELUARAN and reconciles Tab 06 & Audit logs
   */
  async deleteExpenseChildItem(
    spreadsheetId: string,
    expenseId: string,
    itemName: string,
    deletedBy = "Telegram User"
  ): Promise<{
    success: boolean;
    message: string;
    deletedItem?: ExpenseChildItemFound;
  }> {
    try {
      const client = await this.getClient();
      const foundItem = await this.findExpenseChildItem(spreadsheetId, expenseId, itemName);

      if (!foundItem.found) {
        const otherHint = foundItem.otherItems && foundItem.otherItems.length > 0
          ? `\n\nBahan yang terdaftar pada transaksi ${expenseId}: ${foundItem.otherItems.map(b => `"${b}"`).join(", ")}`
          : "";
        return {
          success: false,
          message: `Rincian bahan "${itemName}" tidak ditemukan pada transaksi ${expenseId}.${otherHint}`,
        };
      }

      // 1. Get sheetId for 05_RINCIAN_PENGELUARAN
      const meta = await client.spreadsheets.get({ spreadsheetId });
      const sheetMap = new Map<string, number>();
      meta.data.sheets?.forEach((s) => {
        if (s.properties?.title && typeof s.properties?.sheetId === "number") {
          sheetMap.set(s.properties.title, s.properties.sheetId);
        }
      });
      const rincianSheetId = sheetMap.get(SHEET_NAMES.RINCIAN_PENGELUARAN) ?? SHEET_IDS.RINCIAN_PENGELUARAN;

      // 2. Delete row from 05_RINCIAN_PENGELUARAN
      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: rincianSheetId,
                  dimension: "ROWS",
                  startIndex: foundItem.rowIndex - 1, // 0-based
                  endIndex: foundItem.rowIndex,
                },
              },
            },
          ],
        },
      });

      // 3. Renumber remaining items under foundItem.expenseId in Tab 05 (if any)
      const tab05PostRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A:D`,
      });
      const postRows = tab05PostRes.data.values || [];
      const cleanMatchedId = foundItem.expenseId.trim().toUpperCase();

      const matchesExp = (cand: string) => {
        const c = String(cand || "").trim().toUpperCase();
        return c === cleanMatchedId || (cleanMatchedId.length >= 4 && c.includes(cleanMatchedId));
      };

      const renumberUpdates: { range: string; values: any[][] }[] = [];
      let nextNo = 1;
      for (let r = 1; r < postRows.length; r++) {
        const isNew = postRows[r].length >= 4;
        const rowExp = String((isNew ? postRows[r][2] : postRows[r][1]) || "");
        if (matchesExp(rowExp)) {
          const sheetRow = r + 1;
          const targetCol = isNew ? "D" : "C";
          renumberUpdates.push({
            range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!${targetCol}${sheetRow}`,
            values: [[nextNo++]],
          });
        }
      }
      if (renumberUpdates.length > 0) {
        await client.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: renumberUpdates,
          },
        });
      }

      // 4. If all items under this transaction are deleted, clean up Tab 04 row as well
      let cleanedParent = false;
      if (nextNo === 1) {
        try {
          const tab04Res = await client.spreadsheets.values.get({
            spreadsheetId,
            range: `'${SHEET_NAMES.PAGU_PENGELUARAN}'!A:C`,
          });
          const tab04Rows = tab04Res.data.values || [];
          const tab04SheetId = sheetMap.get(SHEET_NAMES.PAGU_PENGELUARAN) ?? SHEET_IDS.PAGU_PENGELUARAN;
          for (let r = 1; r < tab04Rows.length; r++) {
            if (matchesExp(tab04Rows[r][2]) || matchesExp(tab04Rows[r][1])) {
              await client.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                  requests: [
                    {
                      deleteDimension: {
                        range: {
                          sheetId: tab04SheetId,
                          dimension: "ROWS",
                          startIndex: r,
                          endIndex: r + 1,
                        },
                      },
                    },
                  ],
                },
              });
              cleanedParent = true;
              logger.info({ expenseId: foundItem.expenseId }, "Deleted empty parent transaction in 04_PAGU_PENGELUARAN");
              break;
            }
          }
        } catch (tab04DelErr: any) {
          logger.warn({ err: tab04DelErr?.message }, "Note deleting parent transaction from Tab 04");
        }
      }

      // 5. Reconcile Tab 06
      await this.reconcileTab06AfterItemDelete(spreadsheetId, foundItem).catch((err) => {
        logger.warn({ err: err?.message || err }, "Note during Tab 06 reconciliation after child item delete");
      });

      // 6. Record Master Audit Log
      const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
      await this.appendMasterAuditLogsBatch([
        {
          unitName,
          editor: `${deletedBy} (Child Item Deletion)`,
          sheetTab: SHEET_NAMES.RINCIAN_PENGELUARAN,
          refId: foundItem.expenseId,
          columnEdited: `Hapus Rincian Belanja di ${foundItem.expenseId} (Baris ${foundItem.rowIndex}) - ${foundItem.itemName}`,
          oldValue: `${foundItem.qty} ${foundItem.unit} @ Rp ${foundItem.price} (Total: Rp ${foundItem.total})`,
          newValue: "[DIHAPUS]",
          sourceAction: "Expense Child Item Delete",
        },
      ]).catch(() => {});

      const statusMsg = cleanedParent
        ? `Rincian bahan "${foundItem.itemName}" berhasil dihapus dari transaksi ${foundItem.expenseId}. Karena seluruh rincian telah kosong, nota induk di Tab 04 otomatis dibersihkan.`
        : `Rincian bahan "${foundItem.itemName}" berhasil dihapus dari transaksi ${foundItem.expenseId}. Total tagihan di Tab 04 berkurang Rp ${foundItem.total.toLocaleString("id-ID")}.`;

      return {
        success: true,
        message: statusMsg,
        deletedItem: foundItem,
      };
    } catch (err: any) {
      logger.error({ err: err?.message, spreadsheetId, expenseId, itemName }, "Failed to delete expense child item");
      return {
        success: false,
        message: `Gagal menghapus rincian bahan: ${err?.message || err}`,
      };
    }
  }

  /**
   * Deletes multiple child items under an expense transaction in Tab 05 atomically
   */
  async deleteMultipleExpenseChildItems(
    spreadsheetId: string,
    expenseId: string,
    itemNames: string[],
    deletedBy = "Telegram User"
  ): Promise<{
    success: boolean;
    message: string;
    deletedItems: ExpenseChildItemFound[];
    totalDeducted: number;
    cleanedParent: boolean;
  }> {
    try {
      const client = await this.getClient();
      const cleanMatchedId = expenseId.trim().toUpperCase();

      // 1. Locate all requested items
      const foundItems: ExpenseChildItemFound[] = [];
      const notFoundNames: string[] = [];

      for (const name of itemNames) {
        const found = await this.findExpenseChildItem(spreadsheetId, expenseId, name);
        if (found.found) {
          // Avoid duplicate entries if user specified same item twice
          if (!foundItems.some((f) => f.rowIndex === found.rowIndex)) {
            foundItems.push(found);
          }
        } else {
          notFoundNames.push(name);
        }
      }

      if (foundItems.length === 0) {
        return {
          success: false,
          message: `Tidak ada bahan yang ditemukan pada transaksi ${expenseId}.`,
          deletedItems: [],
          totalDeducted: 0,
          cleanedParent: false,
        };
      }

      // 2. Get sheetId for 05_RINCIAN_PENGELUARAN
      const meta = await client.spreadsheets.get({ spreadsheetId });
      const sheetMap = new Map<string, number>();
      meta.data.sheets?.forEach((s) => {
        if (s.properties?.title && typeof s.properties?.sheetId === "number") {
          sheetMap.set(s.properties.title, s.properties.sheetId);
        }
      });
      const rincianSheetId = sheetMap.get(SHEET_NAMES.RINCIAN_PENGELUARAN) ?? SHEET_IDS.RINCIAN_PENGELUARAN;

      // 3. Sort found items by rowIndex DESCENDING to prevent shift during deletion
      foundItems.sort((a, b) => b.rowIndex - a.rowIndex);

      const deleteRequests = foundItems.map((item) => ({
        deleteDimension: {
          range: {
            sheetId: rincianSheetId,
            dimension: "ROWS",
            startIndex: item.rowIndex - 1, // 0-based
            endIndex: item.rowIndex,
          },
        },
      }));

      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: deleteRequests },
      });

      // 4. Renumber remaining items under foundItems[0].expenseId in Tab 05 (if any)
      const tab05PostRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!B:C`,
      });
      const postRows = tab05PostRes.data.values || [];
      const matchesExp = (cand: string) => {
        const c = String(cand || "").trim().toUpperCase();
        return c === cleanMatchedId || (cleanMatchedId.length >= 4 && c.includes(cleanMatchedId));
      };

      const renumberUpdates: { range: string; values: any[][] }[] = [];
      let nextNo = 1;
      for (let r = 1; r < postRows.length; r++) {
        if (matchesExp(postRows[r][0])) {
          const sheetRow = r + 1;
          renumberUpdates.push({
            range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!C${sheetRow}`,
            values: [[nextNo++]],
          });
        }
      }
      if (renumberUpdates.length > 0) {
        await client.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: renumberUpdates,
          },
        });
      }

      // 5. If all items under this transaction are deleted, clean up Tab 04 row
      let cleanedParent = false;
      if (nextNo === 1) {
        try {
          const tab04Res = await client.spreadsheets.values.get({
            spreadsheetId,
            range: `'${SHEET_NAMES.PAGU_PENGELUARAN}'!A:B`,
          });
          const tab04Rows = tab04Res.data.values || [];
          const tab04SheetId = sheetMap.get(SHEET_NAMES.PAGU_PENGELUARAN) ?? SHEET_IDS.PAGU_PENGELUARAN;
          for (let r = 1; r < tab04Rows.length; r++) {
            if (matchesExp(tab04Rows[r][1])) {
              await client.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                  requests: [
                    {
                      deleteDimension: {
                        range: {
                          sheetId: tab04SheetId,
                          dimension: "ROWS",
                          startIndex: r,
                          endIndex: r + 1,
                        },
                      },
                    },
                  ],
                },
              });
              cleanedParent = true;
              logger.info({ expenseId }, "Deleted empty parent transaction in 04_PAGU_PENGELUARAN");
              break;
            }
          }
        } catch (tab04DelErr: any) {
          logger.warn({ err: tab04DelErr?.message }, "Note deleting parent transaction from Tab 04");
        }
      }

      // 6. Reconcile Tab 06 for each deleted item
      for (const item of foundItems) {
        await this.reconcileTab06AfterItemDelete(spreadsheetId, item).catch((err) => {
          logger.warn({ err: err?.message || err, item: item.itemName }, "Note during Tab 06 reconciliation after child item delete");
        });
      }

      // 7. Record Master Audit Log
      const totalDeducted = foundItems.reduce((sum, it) => sum + (it.total || 0), 0);
      const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);
      const auditEntries = foundItems.map((item) => ({
        unitName,
        editor: `${deletedBy} (Batch Child Item Deletion)`,
        sheetTab: SHEET_NAMES.RINCIAN_PENGELUARAN,
        refId: item.expenseId,
        columnEdited: `Hapus Rincian Belanja di ${item.expenseId} (Baris ${item.rowIndex}) - ${item.itemName}`,
        oldValue: `${item.qty} ${item.unit} @ Rp ${item.price} (Total: Rp ${item.total})`,
        newValue: "[DIHAPUS]",
        sourceAction: "Batch Expense Child Item Delete",
      }));
      await this.appendMasterAuditLogsBatch(auditEntries).catch(() => {});

      const itemNamesList = foundItems.map((it) => `"${it.itemName}"`).join(", ");
      const statusMsg = cleanedParent
        ? `Sebanyak ${foundItems.length} bahan (${itemNamesList}) berhasil dihapus dari transaksi ${expenseId}. Seluruh rincian nota telah kosong sehingga nota induk di Tab 04 otomatis dibersihkan.`
        : `Sebanyak ${foundItems.length} bahan (${itemNamesList}) berhasil dihapus dari transaksi ${expenseId}. Total tagihan di Tab 04 otomatis berkurang Rp ${totalDeducted.toLocaleString("id-ID")}.`;

      return {
        success: true,
        message: statusMsg,
        deletedItems: foundItems,
        totalDeducted,
        cleanedParent,
      };
    } catch (err: any) {
      logger.error({ err: err?.message, spreadsheetId, expenseId, itemNames }, "Failed to batch delete expense child items");
      return {
        success: false,
        message: `Gagal menghapus rincian bahan: ${err?.message || err}`,
        deletedItems: [],
        totalDeducted: 0,
        cleanedParent: false,
      };
    }
  }

  /**
   * Reconciles Tab 06 after a child item is deleted from Tab 05
   */
  private async reconcileTab06AfterItemDelete(
    spreadsheetId: string,
    deletedItem: ExpenseChildItemFound
  ): Promise<void> {
    const client = await this.getClient();
    const cleanRefNo = (deletedItem.sppgRefNo || "-").trim();
    const itemCleanName = deletedItem.itemName.toLowerCase().trim();

    const rekapRes = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A:O`,
    });
    const rekapRows = rekapRes.data.values || [];

    const meta = await client.spreadsheets.get({ spreadsheetId });
    const sheetMap = new Map<string, number>();
    meta.data.sheets?.forEach((s) => {
      if (s.properties?.title && typeof s.properties?.sheetId === "number") {
        sheetMap.set(s.properties.title, s.properties.sheetId);
      }
    });
    const rekapSheetId = sheetMap.get(SHEET_NAMES.PERBANDINGAN_MARGIN) ?? SHEET_IDS.PERBANDINGAN_MARGIN;

    // A. If Non-Pagu: Delete the row from Tab 06 using deleteDimension
    if (deletedItem.isNonPagu || deletedItem.notes.toUpperCase().includes("NON-PAGU")) {
      for (let r = 1; r < rekapRows.length; r++) {
        const row = rekapRows[r];
        const rowRef = String(row[0] || "").trim();
        const isNew = row.length >= 14 || (row[1] && String(row[1]).startsWith("SPPG"));
        const rowName = String((isNew ? row[5] : row[3]) || "").toLowerCase().trim();
        const rowStatus = String((isNew ? row[14] : row[12]) || "").trim();

        const isRefMatch = cleanRefNo === "-" || !rowRef || rowRef.toLowerCase() === cleanRefNo.toLowerCase();
        const isNameMatch =
          rowName.includes(itemCleanName) ||
          itemCleanName.includes(rowName) ||
          rowName.includes(itemCleanName.replace(/\[.*?\]/g, "").trim());
        const isNonPaguRow = rowStatus.includes("NON-PAGU") || rowName.includes("[non-pagu]");

        if (isRefMatch && isNameMatch && isNonPaguRow) {
          await client.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  deleteDimension: {
                    range: {
                      sheetId: rekapSheetId,
                      dimension: "ROWS",
                      startIndex: r, // 0-based
                      endIndex: r + 1,
                    },
                  },
                },
              ],
            },
          });
          return;
        }
      }
      return;
    }

    // B. If Normal In-Pagu Item: Deduct realization and restore status
    for (let rIdx = 1; rIdx < rekapRows.length; rIdx++) {
      const row = rekapRows[rIdx];
      const rowSppgRef = String(row[0] || "").trim();
      const isNewLayout = row.length >= 14 || (row[1] && String(row[1]).startsWith("SPPG"));
      const rowItemName = String((isNewLayout ? row[5] : row[3]) || "").toLowerCase().trim();

      const nameMatches = rowItemName.includes(itemCleanName) || itemCleanName.includes(rowItemName);
      const refMatches = cleanRefNo === "-" || !rowSppgRef || rowSppgRef.toLowerCase() === cleanRefNo.toLowerCase();

      if (nameMatches && refMatches) {
        const actualRow = rIdx + 1; // 1-based
        const targetQty = parseCurrencyNumber(isNewLayout ? row[6] : row[4]);
        const prevRealisasi = parseCurrencyNumber(isNewLayout ? row[11] : row[9]);
        const statusStr = String((isNewLayout ? row[14] : row[12]) || "").trim();
        const invoicePriceCol = isNewLayout ? row[10] : row[8];

        let prevFulfilledQty = 0;
        const belumMatch = statusStr.match(/BELUM LENGKAP \((\d+(?:\.\d+)?)\//i);
        if (belumMatch) {
          prevFulfilledQty = parseFloat(belumMatch[1]) || 0;
        } else if (prevRealisasi > 0 && parseCurrencyNumber(invoicePriceCol) > 0) {
          prevFulfilledQty = Math.round(prevRealisasi / parseCurrencyNumber(invoicePriceCol));
        }

        const newAccumulatedQty = Math.max(0, prevFulfilledQty - (deletedItem.qty || 1));
        const newAccumulatedRealisasi = Math.max(0, prevRealisasi - deletedItem.total);

        const batchUpdates: { range: string; values: any[][] }[] = [];
        if (isNewLayout) {
          if (newAccumulatedRealisasi <= 0 || newAccumulatedQty <= 0) {
            // Reset to waiting invoice
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!C${actualRow}`,
              values: [["-"]],
            });
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!K${actualRow}:L${actualRow}`,
              values: [["", ""]],
            });
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!O${actualRow}`,
              values: [["🟡 MENUNGGU INVOICE"]],
            });
          } else if (targetQty > 0 && newAccumulatedQty < targetQty) {
            const statusText = `🟠 BELUM LENGKAP (${newAccumulatedQty}/${targetQty} ${deletedItem.unit || "unit"})`;
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!K${actualRow}:L${actualRow}`,
              values: [[deletedItem.price, newAccumulatedRealisasi]],
            });
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!O${actualRow}`,
              values: [[statusText]],
            });
          } else {
            const formulaStatus = `=IF(M${actualRow}>0; "🟢 HEMAT"; IF(M${actualRow}=0; "🟢 PAS"; "🔴 OVER BUDGET"))`;
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!K${actualRow}:L${actualRow}`,
              values: [[deletedItem.price, newAccumulatedRealisasi]],
            });
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!O${actualRow}`,
              values: [[formulaStatus]],
            });
          }
        } else {
          if (newAccumulatedRealisasi <= 0 || newAccumulatedQty <= 0) {
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!I${actualRow}:J${actualRow}`,
              values: [["", ""]],
            });
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!M${actualRow}`,
              values: [["🟡 MENUNGGU INVOICE"]],
            });
          } else if (targetQty > 0 && newAccumulatedQty < targetQty) {
            const statusText = `🟠 BELUM LENGKAP (${newAccumulatedQty}/${targetQty} ${deletedItem.unit || "unit"})`;
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!I${actualRow}:J${actualRow}`,
              values: [[deletedItem.price, newAccumulatedRealisasi]],
            });
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!M${actualRow}`,
              values: [[statusText]],
            });
          } else {
            const formulaStatus = `=IF(K${actualRow}>0; "🟢 HEMAT"; IF(K${actualRow}=0; "🟢 PAS"; "🔴 OVER BUDGET"))`;
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!I${actualRow}:J${actualRow}`,
              values: [[deletedItem.price, newAccumulatedRealisasi]],
            });
            batchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!M${actualRow}`,
              values: [[formulaStatus]],
            });
          }
        }

        await client.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: batchUpdates,
          },
        });
        break;
      }
    }
  }

  /**
   * Retrieves all child items belonging to a specific expense transaction in 05_RINCIAN_PENGELUARAN.
   */
  async getExpenseItems(
    spreadsheetId: string,
    expenseId: string
  ): Promise<
    Array<{
      supplier: string;
      itemName: string;
      qty: number;
      unit: string;
      price: number;
      total: number;
      notes: string;
    }>
  > {
    const client = await this.getClient();
    const tab05Res = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A2:M`,
    });
    const rows = tab05Res.data.values || [];
    const cleanTarget = expenseId.trim().toUpperCase();
    const items: Array<{
      supplier: string;
      itemName: string;
      qty: number;
      unit: string;
      price: number;
      total: number;
      notes: string;
    }> = [];

    for (const row of rows) {
      const isNewLayout = row.length >= 12 || (row[1] && row[2] && String(row[2]).startsWith("SPPG"));
      const rowExpenseId = String((isNewLayout ? row[2] : row[1]) || "").trim().toUpperCase();
      const matches =
        rowExpenseId === cleanTarget ||
        rowExpenseId.endsWith(`-${cleanTarget}`) ||
        cleanTarget.endsWith(`-${rowExpenseId}`) ||
        (cleanTarget.length >= 4 && rowExpenseId.includes(cleanTarget));

      if (matches) {
        const qty = parseCurrencyNumber(isNewLayout ? row[6] : row[5]) || 1;
        const price = parseCurrencyNumber(isNewLayout ? row[8] : row[7]) || 0;
        const total = parseCurrencyNumber(isNewLayout ? row[9] : row[8]) || (qty * price);
        items.push({
          supplier: String((isNewLayout ? row[4] : row[3]) || "Supplier"),
          itemName: String((isNewLayout ? row[5] : row[4]) || "Bahan Belanja"),
          qty,
          unit: String((isNewLayout ? row[7] : row[6]) || "unit"),
          price,
          total,
          notes: String((isNewLayout ? row[10] : row[9]) || "-"),
        });
      }
    }
    return items;
  }

  /**
   * Links an existing recorded expense transaction (e.g. EI001 / SPPG0226-EI001)
   * to a specific Pagu order (e.g. II001 / PO-2026/09/SPPG2-01).
   * Synchronizes:
   * 1. Tab 03 (03_RINCIAN_PENDAPATAN): Inserts expense items into the target PO.
   * 2. Tab 02 (02_PENDAPATAN): Updates item count, supplier count, total pagu, and [Edit] in notes.
   * 3. Tab 04 (04_PENGELUARAN): Updates Col A to orderNo.
   * 4. Tab 05 (05_RINCIAN_PENGELUARAN): Updates Col A of child items to orderNo.
   * 5. Tab 06 (06_MARGIN): Reconciles margin so Pagu and Realisasi are balanced (🟢 PAS).
   * 6. Master Dashboard and consolidated audit trail.
   */
  async linkExpenseToPagu(
    spreadsheetId: string,
    expenseQuery: string,
    paguQuery: string,
    callerName = "Admin"
  ): Promise<{
    success: boolean;
    expenseId: string;
    paguId: string;
    orderNo: string;
    unitName: string;
    supplier?: string;
    amount?: number;
    items?: Array<{
      itemName: string;
      qty: number;
      unit: string;
      price: number;
      total: number;
      supplier?: string;
    }>;
    error?: string;
  }> {
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();
    const unitName = this.getUnitNameFromSpreadsheetId(spreadsheetId);

    // 1. Locate the expense transaction
    const expCheck = await this.findTransactionById(spreadsheetId, expenseQuery);
    if (!expCheck.found || expCheck.type !== "expense") {
      return {
        success: false,
        expenseId: expenseQuery,
        paguId: paguQuery,
        orderNo: "-",
        unitName,
        error: `Transaksi pengeluaran ${expenseQuery} tidak ditemukan di buku kas.`,
      };
    }
    const cleanExpenseId = expCheck.id;
    const expRowIndex = expCheck.rowIndex!;

    // 2. Locate the target Pagu order directly from Tab 02 (02_PENDAPATAN)
    let orderNo = "";
    let paguId = "";

    const ordersRes = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A2:K`,
    });
    const rows = ordersRes.data.values || [];
    const cleanTarget = paguQuery.trim().toUpperCase();

    for (const r of rows) {
      const oNo = String(r[0] || "").trim();
      const tId = String(r[1] || "").trim().toUpperCase();
      if (
        oNo.toUpperCase() === cleanTarget ||
        oNo.toUpperCase().includes(cleanTarget) ||
        tId === cleanTarget ||
        tId.endsWith(`-${cleanTarget}`) ||
        tId.endsWith(`_${cleanTarget}`) ||
        (cleanTarget.length >= 4 && tId.includes(cleanTarget))
      ) {
        orderNo = oNo;
        paguId = String(r[1] || "").trim() || oNo;
        break;
      }
    }

    if (!orderNo || orderNo === "-") {
      const paguCheck = await this.findTransactionById(spreadsheetId, paguQuery);
      if (paguCheck.found && paguCheck.type === "income") {
        orderNo = paguCheck.orderNo || paguCheck.id;
        paguId = paguCheck.id;
      }
    }

    if (!orderNo || orderNo === "-") {
      return {
        success: false,
        expenseId: cleanExpenseId,
        paguId: paguQuery,
        orderNo: "-",
        unitName,
        error: `Pagu pesanan ${paguQuery} tidak ditemukan di unit ini.`,
      };
    }

    // 3. Update Tab 04 (04_PENGELUARAN) Column A & B (No SPPG Ref, ID Pendapatan)
    await client.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A${expRowIndex}:B${expRowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[orderNo, paguId]] },
    });

    // 4. Update Tab 05 (05_RINCIAN_PENGELUARAN) Column A & B for all child rows of this expense
    const tab05Res = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A2:M`,
    });
    const tab05Rows = tab05Res.data.values || [];
    const cleanTargetExp = cleanExpenseId.trim().toUpperCase();
    const tab05BatchUpdates: { range: string; values: any[][] }[] = [];
    const expenseItems: Array<{
      itemName: string;
      qty: number;
      unit: string;
      price: number;
      total: number;
      supplier: string;
      notes: string;
    }> = [];

    for (let i = 0; i < tab05Rows.length; i++) {
      const row = tab05Rows[i];
      const isNewLayout = row.length >= 12 || (row[1] && row[2] && String(row[2]).startsWith("SPPG"));
      const rowExpenseId = String((isNewLayout ? row[2] : row[1]) || "").trim().toUpperCase();
      const matches =
        rowExpenseId === cleanTargetExp ||
        rowExpenseId.endsWith(`-${cleanTargetExp}`) ||
        cleanTargetExp.endsWith(`-${rowExpenseId}`) ||
        (cleanTargetExp.length >= 4 && rowExpenseId.includes(cleanTargetExp));

      if (matches) {
        const actualRow = i + 2;
        tab05BatchUpdates.push({
          range: `'${SHEET_NAMES.RINCIAN_PENGELUARAN}'!A${actualRow}:B${actualRow}`,
          values: [[orderNo, paguId]],
        });

        const qty = parseCurrencyNumber(isNewLayout ? row[6] : row[5]) || 1;
        const price = parseCurrencyNumber(isNewLayout ? row[8] : row[7]) || 0;
        const total = parseCurrencyNumber(isNewLayout ? row[9] : row[8]) || (qty * price);

        expenseItems.push({
          supplier: String((isNewLayout ? row[4] : row[3]) || expCheck.supplierOrUnit || "Supplier"),
          itemName: String((isNewLayout ? row[5] : row[4]) || "Bahan Belanja"),
          qty,
          unit: String((isNewLayout ? row[7] : row[6]) || "unit"),
          price,
          total,
          notes: String((isNewLayout ? row[10] : row[9]) || "-"),
        });
      }
    }

    if (tab05BatchUpdates.length > 0) {
      await client.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: tab05BatchUpdates,
        },
      });
    }

    // Fallback if expense had no child items in Tab 05
    if (expenseItems.length === 0) {
      expenseItems.push({
        supplier: expCheck.supplierOrUnit || "Supplier",
        itemName: "Belanja Bahan Pangan",
        qty: 1,
        unit: "paket",
        price: expCheck.amount || 0,
        total: expCheck.amount || 0,
        notes: `Belanja ${cleanExpenseId}`,
      });
    }

    // Get numeric sheet IDs for Tab 03 and Tab 06
    const meta = await client.spreadsheets.get({ spreadsheetId });
    const sheetMap = new Map<string, number>();
    meta.data.sheets?.forEach((s) => {
      if (s.properties?.title && typeof s.properties?.sheetId === "number") {
        sheetMap.set(s.properties.title, s.properties.sheetId);
      }
    });
    const rincianSheetId = sheetMap.get(SHEET_NAMES.RINCIAN_PENDAPATAN) ?? SHEET_IDS.RINCIAN_PENDAPATAN;
    const rekapSheetId = sheetMap.get(SHEET_NAMES.PERBANDINGAN_MARGIN) ?? SHEET_IDS.PERBANDINGAN_MARGIN;

    // 5. Insert Items to Tab 03 (03_RINCIAN_PENDAPATAN)
    const tab03Res = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.RINCIAN_PENDAPATAN}'!A:K`,
    });
    const tab03Rows = tab03Res.data.values || [];
    let lastTab03OrderRow = -1; // 1-based row index in sheet
    let maxNoUrut = 0;
    const existingPOItems: Array<{ name: string; supplier: string }> = [];

    for (let i = 0; i < tab03Rows.length; i++) {
      const row = tab03Rows[i];
      const rowOrderNo = String(row[0] || "").trim();
      const rowTrxId = String(row[1] || "").trim();
      if (
        rowOrderNo.toLowerCase() === orderNo.toLowerCase() ||
        rowTrxId.toLowerCase() === paguId.toLowerCase()
      ) {
        lastTab03OrderRow = i + 1; // 1-based
        const noUrut = parseInt(String(row[2] || "0"), 10);
        if (!isNaN(noUrut) && noUrut > maxNoUrut) {
          maxNoUrut = noUrut;
        }
        existingPOItems.push({
          name: String(row[3] || "").trim().toLowerCase(),
          supplier: String(row[4] || "").trim(),
        });
      }
    }

    for (const it of expenseItems) {
      const cleanItName = it.itemName.trim().toLowerCase();
      const alreadyInTab03 = existingPOItems.some(
        (ex) => ex.name === cleanItName || cleanItName.includes(ex.name) || ex.name.includes(cleanItName)
      );

      if (!alreadyInTab03) {
        maxNoUrut += 1;
        let insertRowIdx: number;

        if (lastTab03OrderRow > 0) {
          insertRowIdx = lastTab03OrderRow + 1;
          await client.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  insertDimension: {
                    range: {
                      sheetId: rincianSheetId,
                      dimension: "ROWS",
                      startIndex: lastTab03OrderRow,
                      endIndex: lastTab03OrderRow + 1,
                    },
                    inheritFromBefore: true,
                  },
                },
              ],
            },
          });

          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${SHEET_NAMES.RINCIAN_PENDAPATAN}'!A${insertRowIdx}:L${insertRowIdx}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: [
                [
                  orderNo,
                  paguId,
                  maxNoUrut,
                  it.itemName,
                  it.supplier || "Lainnya",
                  it.qty,
                  it.unit || "unit",
                  it.price,
                  `=IF(OR(F${insertRowIdx}=""; H${insertRowIdx}=""); ""; F${insertRowIdx} * H${insertRowIdx})`,
                  callerName || "Petugas SPPG",
                  getWibTimestamp(),
                  `Ditautkan dari belanja ${cleanExpenseId}`,
                ],
              ],
            },
          });
          lastTab03OrderRow = insertRowIdx;
        } else {
          insertRowIdx = Math.max(tab03Rows.length + 1, 2);
          const newRow = [
            orderNo,
            paguId,
            maxNoUrut,
            it.itemName,
            it.supplier || "Lainnya",
            it.qty,
            it.unit || "unit",
            it.price,
            `=IF(OR(F${insertRowIdx}=""; H${insertRowIdx}=""); ""; F${insertRowIdx} * H${insertRowIdx})`,
            callerName || "Petugas SPPG",
            getWibTimestamp(),
            `Ditautkan dari belanja ${cleanExpenseId}`,
          ];
          await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.RINCIAN_PENDAPATAN, [newRow]);
          lastTab03OrderRow = insertRowIdx;
        }

        existingPOItems.push({
          name: cleanItName,
          supplier: it.supplier || "Lainnya",
        });
      }
    }

    // 6. Update Tab 02 (02_PENDAPATAN)
    const tab02Res = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A:J`,
    });
    const tab02Rows = tab02Res.data.values || [];
    let tab02RowIdx = -1;

    for (let i = 1; i < tab02Rows.length; i++) {
      const r = tab02Rows[i];
      const oNo = String(r[0] || "").trim();
      const tId = String(r[1] || "").trim();
      if (
        oNo.toLowerCase() === orderNo.toLowerCase() ||
        tId.toLowerCase() === paguId.toLowerCase()
      ) {
        tab02RowIdx = i + 1; // 1-based
        break;
      }
    }

    if (tab02RowIdx > 0) {
      const updatedTab03Res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.RINCIAN_PENDAPATAN}'!A:E`,
      });
      const upRows = updatedTab03Res.data.values || [];
      const distinctSuppliers = new Set<string>();

      for (let i = 1; i < upRows.length; i++) {
        const r = upRows[i];
        if (
          String(r[0] || "").trim().toLowerCase() === orderNo.toLowerCase() ||
          String(r[1] || "").trim().toLowerCase() === paguId.toLowerCase()
        ) {
          const sup = String(r[4] || "").trim();
          if (sup && sup !== "-") {
            distinctSuppliers.add(sup.toLowerCase());
          }
        }
      }

      const existingNotes = String(tab02Rows[tab02RowIdx - 1][9] || "").trim();
      const itemsSummary = expenseItems
        .map((it) => `${it.itemName} ${it.qty} ${it.unit} @ ${formatRupiah(it.price)} (${it.supplier || expCheck.supplierOrUnit || "Supplier"})`)
        .join(", ");
      const editLine = `[Edit ${formatWibDisplay()}] Ditautkan dari pengeluaran ${cleanExpenseId}: ${itemsSummary} (oleh ${callerName})`;
      const updatedNotes = (existingNotes && existingNotes !== "-")
        ? `${existingNotes}\n${editLine}`
        : editLine;

      await client.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: [
            {
              range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!D${tab02RowIdx}:F${tab02RowIdx}`,
              values: [
                [
                  `=COUNTIF('03_RINCIAN_PENDAPATAN'!$B:$B; B${tab02RowIdx}) & " Item"`,
                  `${distinctSuppliers.size} Supplier`,
                  `=SUMIF('03_RINCIAN_PENDAPATAN'!$B:$B; B${tab02RowIdx}; '03_RINCIAN_PENDAPATAN'!$I:$I)`,
                ],
              ],
            },
            {
              range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!J${tab02RowIdx}`,
              values: [[updatedNotes]],
            },
          ],
        },
      });
    }

    // 7. Reconcile Tab 06 (06_MARGIN)
    const tab06Res = await client.spreadsheets.values.get({
      spreadsheetId,
      range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A2:O`,
    });
    const tab06Rows = tab06Res.data.values || [];
    const tab06BatchUpdates: { range: string; values: any[][] }[] = [];
    const tab06RowsToDelete: number[] = [];

    for (const it of expenseItems) {
      const cleanItem = it.itemName.toLowerCase().replace(/[^a-z0-9]/g, "");
      let matchingRowIdx = -1;
      let standaloneRowIdx = -1;

      for (let r = 0; r < tab06Rows.length; r++) {
        const row = tab06Rows[r];
        const isNew = row.length >= 14 || (row[1] && String(row[1]).startsWith("SPPG"));
        const rowRef = String(row[0] || "").trim();
        const rowItem = String((isNew ? row[5] : row[3]) || "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const isItemMatch = rowItem.includes(cleanItem) || cleanItem.includes(rowItem);

        if (!isItemMatch) continue;

        if (rowRef.toLowerCase() === orderNo.toLowerCase()) {
          matchingRowIdx = r + 2;
        } else if (rowRef === "-" || rowRef === "") {
          standaloneRowIdx = r + 2;
        }
      }

      if (matchingRowIdx > 0) {
        const r = matchingRowIdx;
        const rowInTab06 = tab06Rows[matchingRowIdx - 2];
        const isNew = rowInTab06 ? (rowInTab06.length >= 14 || (rowInTab06[1] && String(rowInTab06[1]).startsWith("SPPG"))) : true;
        const existingPaguPrice = rowInTab06 ? parseCurrencyNumber(isNew ? rowInTab06[8] : rowInTab06[6]) : 0;
        const targetQty = rowInTab06 ? parseCurrencyNumber(isNew ? rowInTab06[6] : rowInTab06[4]) : 0;
        const unit = rowInTab06 ? String((isNew ? rowInTab06[7] : rowInTab06[5]) || "unit").trim() : (it.unit || "unit");
        const prevRealisasi = rowInTab06 ? parseCurrencyNumber(isNew ? rowInTab06[11] : rowInTab06[9]) : 0;
        const rowSupplier = rowInTab06 ? String((isNew ? rowInTab06[4] : rowInTab06[2]) || "").trim() : "";
        const invoicePriceCol = isNew ? rowInTab06?.[10] : rowInTab06?.[8];

        // Check previous fulfilled qty
        const statusStr = rowInTab06 ? String((isNew ? rowInTab06[14] : rowInTab06[12]) || "").trim() : "";
        let prevFulfilledQty = 0;
        const belumMatch = statusStr.match(/BELUM LENGKAP \((\d+(?:\.\d+)?)\//i);
        if (belumMatch) {
          prevFulfilledQty = parseFloat(belumMatch[1]) || 0;
        } else if (prevRealisasi > 0 && rowInTab06 && parseCurrencyNumber(invoicePriceCol) > 0) {
          prevFulfilledQty = Math.round(prevRealisasi / parseCurrencyNumber(invoicePriceCol));
        }

        const finalPaguPrice = existingPaguPrice > 0 ? existingPaguPrice : it.price;
        const newAccumulatedRealisasi = existingPaguPrice > 0 ? (prevRealisasi + it.total) : it.total;
        const newAccumulatedQty = existingPaguPrice > 0 ? (prevFulfilledQty + (it.qty || 1)) : (it.qty || 1);

        if (isNew) {
          let statusFormulaOrText: string;
          if (targetQty > 0 && newAccumulatedQty < targetQty && existingPaguPrice > 0) {
            statusFormulaOrText = `🟠 BELUM LENGKAP (${newAccumulatedQty}/${targetQty} ${unit})`;
          } else {
            statusFormulaOrText = `=IF(M${r}>0; "🟢 HEMAT"; IF(M${r}=0; "🟢 PAS"; "🔴 OVER BUDGET"))`;
          }

          tab06BatchUpdates.push({
            range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!B${r}:C${r}`,
            values: [[paguId, cleanExpenseId]],
          });

          tab06BatchUpdates.push({
            range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!I${r}:O${r}`,
            values: [
              [
                finalPaguPrice,
                `=IF(OR(G${r}=""; I${r}=""); ""; G${r} * I${r})`,
                it.price,
                newAccumulatedRealisasi,
                `=IF(L${r}=""; ""; J${r}-L${r})`,
                `=IF(OR(J${r}=""; L${r}=""); ""; IFERROR(M${r}/J${r}; 0))`,
                statusFormulaOrText,
              ],
            ],
          });

          if (it.supplier && it.supplier !== "-" && rowSupplier && !rowSupplier.toLowerCase().includes(it.supplier.toLowerCase())) {
            tab06BatchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!E${r}`,
              values: [[`${rowSupplier} (${it.supplier})`]],
            });
          }
        } else {
          let statusFormulaOrText: string;
          if (targetQty > 0 && newAccumulatedQty < targetQty && existingPaguPrice > 0) {
            statusFormulaOrText = `🟠 BELUM LENGKAP (${newAccumulatedQty}/${targetQty} ${unit})`;
          } else {
            statusFormulaOrText = `=IF(K${r}>0; "🟢 HEMAT"; IF(K${r}=0; "🟢 PAS"; "🔴 OVER BUDGET"))`;
          }

          tab06BatchUpdates.push({
            range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!G${r}:M${r}`,
            values: [
              [
                finalPaguPrice,
                `=IF(OR(E${r}=""; G${r}=""); ""; E${r} * G${r})`,
                it.price,
                newAccumulatedRealisasi,
                `=IF(J${r}=""; ""; H${r}-J${r})`,
                `=IF(OR(H${r}=""; J${r}=""); ""; IFERROR(K${r}/H${r}; 0))`,
                statusFormulaOrText,
              ],
            ],
          });

          if (it.supplier && it.supplier !== "-" && rowSupplier && !rowSupplier.toLowerCase().includes(it.supplier.toLowerCase())) {
            tab06BatchUpdates.push({
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!C${r}`,
              values: [[`${rowSupplier} (${it.supplier})`]],
            });
          }
        }

        if (standaloneRowIdx > 0 && standaloneRowIdx !== matchingRowIdx) {
          tab06RowsToDelete.push(standaloneRowIdx - 1);
        }
      } else if (standaloneRowIdx > 0) {
        const r = standaloneRowIdx;
        tab06BatchUpdates.push({
          range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A${r}:O${r}`,
          values: [
            [
              orderNo,
              paguId || "-",
              cleanExpenseId,
              new Date().toISOString().slice(0, 10),
              it.supplier || expCheck.supplierOrUnit || "Supplier",
              it.itemName,
              it.qty,
              it.unit || "unit",
              it.price,
              `=IF(OR(G${r}=""; I${r}=""); ""; G${r} * I${r})`,
              it.price,
              it.total,
              `=IF(L${r}=""; ""; J${r}-L${r})`,
              `=IF(OR(J${r}=""; L${r}=""); ""; IFERROR(M${r}/J${r}; 0))`,
              `=IF(L${r}=""; "🟡 MENUNGGU INVOICE"; IF(M${r}>0; "🟢 HEMAT"; IF(M${r}=0; "🟢 PAS"; "🔴 OVER BUDGET")))`,
            ],
          ],
        });
      } else {
        const targetRow = tab06Rows.length + 2;
        const dateStr = new Date().toISOString().slice(0, 10);
        const newRow = [
          orderNo,
          paguId || "-",
          cleanExpenseId,
          dateStr,
          it.supplier || expCheck.supplierOrUnit || "Supplier",
          it.itemName,
          it.qty,
          it.unit || "unit",
          it.price,
          `=IF(OR(G${targetRow}=""; I${targetRow}=""); ""; G${targetRow} * I${targetRow})`,
          it.price,
          it.total,
          `=IF(L${targetRow}=""; ""; J${targetRow}-L${targetRow})`,
          `=IF(OR(J${targetRow}=""; L${targetRow}=""); ""; IFERROR(M${targetRow}/J${targetRow}; 0))`,
          `=IF(L${targetRow}=""; "🟡 MENUNGGU INVOICE"; IF(M${targetRow}>0; "🟢 HEMAT"; IF(M${targetRow}=0; "🟢 PAS"; "🔴 OVER BUDGET")))`,
        ];
        await this.appendRowsSafely(spreadsheetId, SHEET_NAMES.PERBANDINGAN_MARGIN, [newRow]);
      }
    }

    if (tab06BatchUpdates.length > 0) {
      await client.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: tab06BatchUpdates,
        },
      });
    }

    if (tab06RowsToDelete.length > 0) {
      const sorted = Array.from(new Set(tab06RowsToDelete)).sort((a, b) => b - a);
      const deleteRequests = sorted.map((r) => ({
        deleteDimension: {
          range: {
            sheetId: rekapSheetId,
            dimension: "ROWS",
            startIndex: r,
            endIndex: r + 1,
          },
        },
      }));

      await client.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: deleteRequests },
      }).catch((err) => {
        logger.warn({ err }, "Could not delete merged standalone row in Tab 06");
      });
    }

    // 8. Master Consolidated Audit Log
    const auditEntry: MasterAuditLogEntry = {
      timestamp: getWibTimestamp(),
      unitName,
      editor: `${callerName} (Pagu Linker)`,
      sheetTab: SHEET_NAMES.PENGELUARAN_SUPPLIER,
      refId: cleanExpenseId,
      columnEdited: "No SPPG Ref (Kolom A) & Tab 03 Sync",
      oldValue: "-",
      newValue: orderNo,
      sourceAction: "LINK_EXPENSE_TO_PAGU",
      status: "SUCCESS",
    };
    this.appendMasterAuditLogsBatch([auditEntry]).catch(() => {});

    return {
      success: true,
      expenseId: cleanExpenseId,
      paguId,
      orderNo,
      unitName,
      supplier: expCheck.supplierOrUnit || "Supplier",
      amount: expCheck.amount,
      items: expenseItems,
    };
  }
}

export interface ExpenseChildItemFound {
  found: boolean;
  rowIndex: number;            // 1-based row index in Tab 05
  itemIndex: number;           // Col C (No Urut Item)
  sppgRefNo: string;           // Col A
  expenseId: string;           // Col B (matched canonical ID)
  supplier: string;            // Col D
  itemName: string;            // Col E
  qty: number;                 // Col F
  unit: string;                // Col G
  price: number;               // Col H
  total: number;               // Col I
  notes: string;               // Col J
  isNonPagu: boolean;
  isOnlyItemInExpense: boolean;
  siblingCount: number;        // Total items under this expenseId
  otherItems?: string[];       // Other item names under this expenseId
}


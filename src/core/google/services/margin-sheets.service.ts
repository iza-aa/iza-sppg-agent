import { sheets_v4 } from "googleapis";
import { logger } from "../../utils/logger.js";
import { SHEET_NAMES } from "../recipes/index.js";
import { SheetsClientProvider, parseCurrencyNumber } from "./sheets-client.provider.js";

export interface PaguCandidate {
  rowIndex: number;
  sppg_ref_no: string;
  order_date: string;
  supplier_name: string;
  item_name: string;
  target_qty: number;
  unit: string;
  pagu_price: number;
  pagu_total: number;
  fulfilled_qty: number;
  fulfilled_total: number;
  remaining_qty: number;
  status: string;
}

export class MarginSheetsService {
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

  async getPaguCandidatesForCommodity(
    spreadsheetId: string,
    itemName: string
  ): Promise<PaguCandidate[]> {
    if (!itemName) return [];
    await this.ensure5TabStructure(spreadsheetId);
    const client = await this.getClient();

    try {
      const res = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A2:O`,
      });
      const rows = res.data?.values || [];
      const cleanItem = itemName.toLowerCase().replace(/[^a-z0-9]/g, "");
      const candidates: PaguCandidate[] = [];

      for (let rIdx = 0; rIdx < rows.length; rIdx++) {
        const row = rows[rIdx];
        if (!row) continue;
        const rawItem = String(row[5] || row[3] || "");
        if (!rawItem) continue;
        const rowItem = rawItem.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!rowItem.includes(cleanItem) && !cleanItem.includes(rowItem)) continue;

        const is15Col = row.length >= 15 || row[14] !== undefined;
        const targetQty = parseCurrencyNumber(is15Col ? row[6] : row[4]);
        const unit = String((is15Col ? row[7] : row[5]) || "").trim();
        const paguPrice = parseCurrencyNumber(is15Col ? row[8] : row[6]);
        const paguTotal = parseCurrencyNumber(is15Col ? row[9] : row[7]);
        const invoicePrice = parseCurrencyNumber(is15Col ? row[10] : row[8]);
        const fulfilledTotal = parseCurrencyNumber(is15Col ? row[11] : row[9]);
        const status = String((is15Col ? row[14] : row[12]) || "").trim();

        // Extract already fulfilled quantity
        let fulfilledQty = 0;
        const m = status.match(/BELUM LENGKAP \((\d+(?:\.\d+)?)\//i);
        if (m) {
          fulfilledQty = parseFloat(m[1]) || 0;
        } else if (status.includes("MENUNGGU INVOICE") || !fulfilledTotal) {
          fulfilledQty = 0;
        } else if (invoicePrice > 0) {
          fulfilledQty = Math.round(fulfilledTotal / invoicePrice);
        }

        const remainingQty = targetQty > 0 ? Math.max(0, targetQty - fulfilledQty) : 0;
        const isAlreadyComplete =
          (status.includes("HEMAT") || status.includes("PAS") || status.includes("OVER BUDGET")) &&
          !m &&
          targetQty > 0 &&
          fulfilledQty >= targetQty;

        if (!isAlreadyComplete) {
          candidates.push({
            rowIndex: rIdx + 2,
            sppg_ref_no: String(row[0] || "").trim(),
            order_date: String((is15Col ? row[3] : row[1]) || "").trim(),
            supplier_name: String((is15Col ? row[4] : row[2]) || "").trim(),
            item_name: rawItem.trim(),
            target_qty: targetQty,
            unit,
            pagu_price: paguPrice,
            pagu_total: paguTotal,
            fulfilled_qty: fulfilledQty,
            fulfilled_total: fulfilledTotal,
            remaining_qty: remainingQty,
            status,
          });
        }
      }

      return candidates;
    } catch (err: any) {
      logger.warn({ err: err?.message || err }, "Error searching Pagu candidates in 06_PERBANDINGAN_MARGIN");
      return [];
    }
  }

  /**
   * Cascades direct Google Sheets cell edit from 03_RINCIAN_PENDAPATAN to 06_PERBANDINGAN_MARGIN
   * Used by DeltaSyncDaemon when someone edits directly in Google Sheets.
   */
  async cascadePaguRincianChangeToRekapMargin(
    spreadsheetId: string,
    orderNo: string,
    origItemName: string,
    colIndex: number,
    newValue: any
  ): Promise<boolean> {
    const client = await this.getClient();
    try {
      const rekapRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A2:I`,
      });
      const rekapRows = rekapRes.data.values || [];
      const cleanOrder = orderNo.trim();
      const cleanOrigName = origItemName.toLowerCase().trim();

      // Column mapping from Tab 03 (colIndex 0-based) to Tab 06 (letter)
      // Tab 03:
      // colIndex 3 (Col D Tab 03: Uraian Bahan)    -> Col F Tab 06
      // colIndex 4 (Col E Tab 03: Target Supplier) -> Col E Tab 06
      // colIndex 5 (Col F Tab 03: Kuantitas)       -> Col G Tab 06
      // colIndex 6 (Col G Tab 03: Satuan)          -> Col H Tab 06
      // colIndex 7 (Col H Tab 03: Harga Pagu)      -> Col I Tab 06
      let targetColLetter = "";
      if (colIndex === 3) targetColLetter = "F";
      else if (colIndex === 4) targetColLetter = "E";
      else if (colIndex === 5) targetColLetter = "G";
      else if (colIndex === 6) targetColLetter = "H";
      else if (colIndex === 7) targetColLetter = "I";
      else return false;

      for (let idx = 0; idx < rekapRows.length; idx++) {
        const r = rekapRows[idx];
        const rOrder = String(r[0] || "").trim();
        const rItem = String(r[5] || r[3] || "").toLowerCase().trim();

        if (rOrder === cleanOrder && (rItem === cleanOrigName || cleanOrigName.includes(rItem) || rItem.includes(cleanOrigName))) {
          const rekapRowNum = idx + 2;
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!${targetColLetter}${rekapRowNum}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[newValue]] },
          });
          logger.info(
            { orderNo, origItemName, targetColLetter, rekapRowNum, newValue },
            "Cascade-synced direct edit from Tab 03 to Tab 06"
          );
          return true;
        }
      }
      return false;
    } catch (err: any) {
      logger.warn({ err: err?.message, orderNo, origItemName }, "Error in cascadePaguRincianChangeToRekapMargin");
      return false;
    }
  }

  /**
   * Cascades direct Google Sheets cell edit from 05_RINCIAN_PENGELUARAN to 06_PERBANDINGAN_MARGIN
   * Used by DeltaSyncDaemon when someone edits directly in Google Sheets.
   */
  async cascadeRincianPengeluaranChangeToRekapMargin(
    spreadsheetId: string,
    orderNo: string,
    origItemName: string,
    colIndex: number,
    newValue: any
  ): Promise<boolean> {
    // Column mapping from Tab 05 (colIndex 0-based) to Tab 06 (letter)
    // Tab 05:
    // colIndex 8 (Col I Tab 05: Harga Satuan Invoice)        -> Col K Tab 06
    // colIndex 9 (Col J Tab 05: Total Belanja)               -> Col L Tab 06
    // NOTE: We NEVER overwrite Col E (Supplier) or Col F (Uraian Bahan) in Tab 06
    // because they are strictly Pagu definitions from Tab 03, not expense items.
    let targetColLetter = "";
    if (colIndex === 8) targetColLetter = "K";
    else if (colIndex === 9) targetColLetter = "L";
    else return false;

    const client = await this.getClient();
    try {
      const rekapRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A2:L`,
      });
      const rekapRows = rekapRes.data.values || [];
      const cleanOrder = orderNo.trim();
      const cleanOrigName = origItemName.toLowerCase().trim();

      for (let idx = 0; idx < rekapRows.length; idx++) {
        const r = rekapRows[idx];
        const rOrder = String(r[0] || "").trim();
        const rItem = String(r[5] || r[3] || "").toLowerCase().trim();

        if (
          (!cleanOrder || cleanOrder === "-" || rOrder === cleanOrder) &&
          (rItem === cleanOrigName || cleanOrigName.includes(rItem) || rItem.includes(cleanOrigName))
        ) {
          const rekapRowNum = idx + 2;
          await client.spreadsheets.values.update({
            spreadsheetId,
            range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!${targetColLetter}${rekapRowNum}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[newValue]] },
          });

          // Also update status formula if Total Belanja (Col L) changed
          if (targetColLetter === "L") {
            const numVal = parseCurrencyNumber(newValue);
            const statusFormula =
              numVal <= 0
                ? "🟡 MENUNGGU INVOICE"
                : `=IF(L${rekapRowNum}=""; "🟡 MENUNGGU INVOICE"; IF(M${rekapRowNum}>0; "🟢 HEMAT"; IF(M${rekapRowNum}=0; "🟢 PAS"; "🔴 OVER BUDGET")))`;
            await client.spreadsheets.values.update({
              spreadsheetId,
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!O${rekapRowNum}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[statusFormula]] },
            });
          }
          logger.info(
            { orderNo, origItemName, targetColLetter, rekapRowNum, newValue },
            "Cascade-synced direct edit from Tab 05 to Tab 06"
          );
          return true;
        }
      }
      return false;
    } catch (err: any) {
      logger.warn({ err: err?.message, orderNo, origItemName }, "Error in cascadeRincianPengeluaranChangeToRekapMargin");
      return false;
    }
  }

}

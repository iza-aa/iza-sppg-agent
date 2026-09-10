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
        range: `'${SHEET_NAMES.REKAP_MARGIN}'!A2:M`,
      });
      const rows = res.data?.values || [];
      const cleanItem = itemName.toLowerCase().replace(/[^a-z0-9]/g, "");
      const candidates: PaguCandidate[] = [];

      for (let rIdx = 0; rIdx < rows.length; rIdx++) {
        const row = rows[rIdx];
        if (!row || !row[3]) continue;
        const rowItem = String(row[3]).toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!rowItem.includes(cleanItem) && !cleanItem.includes(rowItem)) continue;

        const targetQty = parseCurrencyNumber(row[4]);
        const unit = String(row[5] || "").trim();
        const paguPrice = parseCurrencyNumber(row[6]);
        const paguTotal = parseCurrencyNumber(row[7]);
        const fulfilledTotal = parseCurrencyNumber(row[9]);
        const status = String(row[12] || "").trim();

        // Extract already fulfilled quantity
        let fulfilledQty = 0;
        const m = status.match(/BELUM LENGKAP \((\d+(?:\.\d+)?)\//i);
        if (m) {
          fulfilledQty = parseFloat(m[1]) || 0;
        } else if (status.includes("MENUNGGU INVOICE") || !fulfilledTotal) {
          fulfilledQty = 0;
        } else if (row[8] && parseCurrencyNumber(row[8]) > 0) {
          fulfilledQty = Math.round(fulfilledTotal / parseCurrencyNumber(row[8]));
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
            order_date: String(row[1] || "").trim(),
            supplier_name: String(row[2] || "").trim(),
            item_name: String(row[3] || "").trim(),
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
      logger.warn({ err: err?.message || err }, "Error searching Pagu candidates in 05_REKAP_MARGIN");
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
        range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A2:G`,
      });
      const rekapRows = rekapRes.data.values || [];
      const cleanOrder = orderNo.trim();
      const cleanOrigName = origItemName.toLowerCase().trim();

      // Column mapping from Tab 03 (colIndex 0-based) to Tab 06 (letter)
      // colIndex 3 (Col D Tab 03: Target Supplier) -> Col C Tab 06
      // colIndex 4 (Col E Tab 03: Uraian Bahan)    -> Col D Tab 06
      // colIndex 5 (Col F Tab 03: Kuantitas)       -> Col E Tab 06
      // colIndex 6 (Col G Tab 03: Satuan)          -> Col F Tab 06
      // colIndex 7 (Col H Tab 03: Harga Pagu)      -> Col G Tab 06
      let targetColLetter = "";
      if (colIndex === 3) targetColLetter = "C";
      else if (colIndex === 4) targetColLetter = "D";
      else if (colIndex === 5) targetColLetter = "E";
      else if (colIndex === 6) targetColLetter = "F";
      else if (colIndex === 7) targetColLetter = "G";
      else return false;

      for (let idx = 0; idx < rekapRows.length; idx++) {
        const r = rekapRows[idx];
        const rOrder = String(r[0] || "").trim();
        const rItem = String(r[3] || "").toLowerCase().trim();

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
    // colIndex 7 (Col H Tab 05: Harga Satuan Invoice)        -> Col I Tab 06
    // colIndex 8 (Col I Tab 05: Total Belanja)               -> Col J Tab 06
    // NOTE: We NEVER overwrite Col C (Supplier) or Col D (Uraian Bahan) in Tab 06
    // because they are strictly Pagu definitions from Tab 03, not expense items.
    let targetColLetter = "";
    if (colIndex === 7) targetColLetter = "I";
    else if (colIndex === 8) targetColLetter = "J";
    else return false;

    const client = await this.getClient();
    try {
      const rekapRes = await client.spreadsheets.values.get({
        spreadsheetId,
        range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A2:J`,
      });
      const rekapRows = rekapRes.data.values || [];
      const cleanOrder = orderNo.trim();
      const cleanOrigName = origItemName.toLowerCase().trim();

      for (let idx = 0; idx < rekapRows.length; idx++) {
        const r = rekapRows[idx];
        const rOrder = String(r[0] || "").trim();
        const rItem = String(r[3] || "").toLowerCase().trim();

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

          // Also update status formula if Total Belanja (Col J) changed
          if (targetColLetter === "J") {
            const numVal = parseCurrencyNumber(newValue);
            const statusFormula =
              numVal <= 0
                ? "🟡 MENUNGGU INVOICE"
                : `=IF(K${rekapRowNum}>0; "🟢 HEMAT"; IF(K${rekapRowNum}=0; "🟢 PAS"; "🔴 OVER BUDGET"))`;
            await client.spreadsheets.values.update({
              spreadsheetId,
              range: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!M${rekapRowNum}`,
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

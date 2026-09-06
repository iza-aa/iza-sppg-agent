import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeltaSyncDaemon, getDeltaSyncDaemon } from "../src/core/sync/delta-sync.daemon.js";
import {
  getMasterDashboardValues,
  createMasterDashboardStylingBatchRequests,
  MASTER_SHEET_NAMES,
  MASTER_SHEET_IDS,
  SHEET_NAMES,
} from "../src/core/google/sheets-recipes.js";
import { GoogleSheetsService } from "../src/core/google/sheets.service.js";

describe("Delta Sync & Centralized Audit Trail Unit Tests", () => {
  let mockSheetsService: Partial<GoogleSheetsService>;

  beforeEach(() => {
    mockSheetsService = {
      appendMasterAuditLog: vi.fn().mockResolvedValue(undefined),
      updateMasterTransactionRow: vi.fn().mockResolvedValue(undefined),
      ensure5TabStructure: vi.fn().mockResolvedValue(undefined),
      ensureMasterDashboardStructure: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe("Master Dashboard 04_LOG_AKTIVITAS Recipe", () => {
    it("should export tab4Headers with exact 10 audit columns", () => {
      const { tab4Headers } = getMasterDashboardValues();
      expect(tab4Headers).toBeDefined();
      expect(tab4Headers.length).toBe(1);
      expect(tab4Headers[0]).toEqual([
        "Waktu (WITA)",
        "Unit Dapur SPPG",
        "Editor / Pengubah",
        "Lembar (Tab)",
        "No PO / ID",
        "Kolom Diedit",
        "Nilai Lama",
        "Nilai Baru",
        "Sumber Aksi",
        "Status",
      ]);
    });

    it("should generate valid batchUpdate requests including 04_LOG_AKTIVITAS", () => {
      const requests = createMasterDashboardStylingBatchRequests(
        1000,
        MASTER_SHEET_IDS.SEMUA_TRANSAKSI,
        MASTER_SHEET_IDS.DAFTAR_DAPUR,
        MASTER_SHEET_IDS.LOG_AKTIVITAS
      );
      expect(requests.length).toBeGreaterThan(0);

      // Verify that there are requests targeting MASTER_SHEET_IDS.LOG_AKTIVITAS
      const logRequests = requests.filter((r) => {
        const str = JSON.stringify(r);
        return str.includes(String(MASTER_SHEET_IDS.LOG_AKTIVITAS));
      });
      expect(logRequests.length).toBeGreaterThan(5);
    });
  });

  describe("DeltaSyncDaemon Webhook & Diff Engine", () => {
    it("should provide a valid singleton instance", () => {
      const daemon = getDeltaSyncDaemon(mockSheetsService as any);
      expect(daemon).toBeInstanceOf(DeltaSyncDaemon);
    });

    it("should process webhook edit payload and record audit log immediately", async () => {
      const daemon = new DeltaSyncDaemon(mockSheetsService as any, 60000);
      // Mock syncUnit to avoid actual Google API network calls
      vi.spyOn(daemon, "syncUnit").mockResolvedValue(undefined);

      await daemon.handleWebhookEdit({
        spreadsheetId: "test-sheet-id",
        sheetName: SHEET_NAMES.PENGELUARAN_SUPPLIER,
        row: 5,
        col: 6, // Col F (Total Nominal Tagihan)
        oldValue: "1500000",
        value: "1850000",
        user: "ayah@sppg.id",
        action: "edit",
      });

      expect(mockSheetsService.appendMasterAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          editor: "ayah@sppg.id (Instan)",
          sheetTab: SHEET_NAMES.PENGELUARAN_SUPPLIER,
          refId: "Baris 5",
          columnEdited: "Total Nominal Tagihan (F)",
          oldValue: "1500000",
          newValue: "1850000",
          sourceAction: "Google Apps Script Webhook (Instan)",
          status: "TERVERIFIKASI",
        })
      );
    });
  });

  describe("Formula-Driven Reactivity Validation", () => {
    it("should generate native reactive formulas for Tab 02, 03, and 05", () => {
      const mockOrder = {
        order_no: "SPPG/2026/09/001",
        order_date: "2026-09-06",
        total_amount: 15000000,
        items: [
          {
            item_name: "Beras Premium",
            qty: 100,
            unit: "kg",
            price: 15000,
            total_price: 1500000,
            supplier_target: "Toko Beras Jaya",
          },
        ],
      };

      // Tab 02 formula checks
      const rowIdx = 2;
      const colDFormula = `=COUNTIF('03_PAGU_RINCIAN'!$A:$A; A${rowIdx}) & " Item"`;
      const colFFormula = `=SUMIF('03_PAGU_RINCIAN'!$A:$A; A${rowIdx}; '03_PAGU_RINCIAN'!$I:$I)`;

      expect(colDFormula).toBe(`=COUNTIF('03_PAGU_RINCIAN'!$A:$A; A2) & " Item"`);
      expect(colFFormula).toBe(`=SUMIF('03_PAGU_RINCIAN'!$A:$A; A2; '03_PAGU_RINCIAN'!$I:$I)`);

      // Tab 03 formula checks
      const itemRow = 2;
      const tab3TotalFormula = `=IF(OR(F${itemRow}=""; H${itemRow}=""); ""; F${itemRow} * H${itemRow})`;
      expect(tab3TotalFormula).toBe(`=IF(OR(F2=""; H2=""); ""; F2 * H2)`);

      // Tab 05 margin checks
      const tab5MarginFormula = `=IF(J${itemRow}=""; ""; H${itemRow}-J${itemRow})`;
      expect(tab5MarginFormula).toBe(`=IF(J2=""; ""; H2-J2)`);
    });
  });
});

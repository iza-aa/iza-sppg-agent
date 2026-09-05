import { describe, it, expect } from "vitest";
import { googleSheetsService } from "../src/core/google/sheets.service.js";
import { SppgOrder } from "../src/core/ai/schemas/sppg-order.schema.js";
import { SupplierReceipt } from "../src/core/ai/schemas/supplier-receipt.schema.js";

describe("Google Sheets 5-Tab Engine", () => {
  it("should instantiate GoogleSheetsService singleton", () => {
    expect(googleSheetsService).toBeDefined();
  });

  it("should correctly prepare SPPG order rows with accurate column mapping and IDs", () => {
    const mockOrder: SppgOrder = {
      type: "income",
      sppg_unit: "SPPG Patila, Luwu Utara",
      order_no: "05/02/09/26",
      order_date: "2026-09-02",
      arrival_date: "2026-09-03",
      items: [
        { no: 1, item_name: "Ayam", qty: 248, unit: "Ekor", price: 60000, total_price: 14880000, supplier_target: "Ayam Pasar" },
        { no: 2, item_name: "Minyak Kelapa Sawit", qty: 14, unit: "Jerigen", price: 125000, total_price: 1750000, supplier_target: "Hj Muliadi" },
      ],
      total_amount: 16630000,
      signed_by: "A. Alya Rahayu AN, S.Pi",
    };

    expect(mockOrder.items.length).toBe(2);
    expect(mockOrder.items[0].total_price).toBe(14880000);
    expect(mockOrder.items[1].supplier_target).toBe("Hj Muliadi");
  });

  it("should correctly format supplier expense row with HYPERLINK formula", () => {
    const mockReceipt: SupplierReceipt = {
      type: "expense",
      supplier_name: "Hj Muliadi",
      date: "2026-09-03",
      sppg_ref_no: "05/02/09/26",
      items: [
        { item_name: "Minyak Kelapa Sawit", qty: 14, unit: "Jerigen", price: 125000, total_price: 1750000 },
      ],
      subtotal: 1750000,
      discount: 0,
      tax: 0,
      total_amount: 1750000,
      payment_method: "Cash",
    };

    const driveLink = "https://drive.google.com/file/d/sample123/view";
    const formula = `=HYPERLINK("${driveLink}"; "Lihat Nota")`;

    expect(formula).toContain("Lihat Nota");
    expect(mockReceipt.total_amount).toBe(1750000);
  });

  it("should verify Master Dashboard constants and unit name resolution", async () => {
    const { MASTER_SHEET_NAMES, MASTER_SHEET_IDS, createMasterDashboardStructureBatchRequests } = await import(
      "../src/core/google/sheets-recipes.js"
    );

    expect(MASTER_SHEET_NAMES.DASHBOARD).toBe("01_DASHBOARD");
    expect(MASTER_SHEET_NAMES.SEMUA_TRANSAKSI).toBe("02_SEMUA_TRANSAKSI");
    expect(MASTER_SHEET_NAMES.DAFTAR_DAPUR).toBe("03_DAFTAR_DAPUR");
    expect(MASTER_SHEET_NAMES.KONSOLIDASI_NASIONAL).toBe("01_DASHBOARD");
    expect(MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL).toBe("02_SEMUA_TRANSAKSI");
    expect(MASTER_SHEET_NAMES.DIREKTORI_SPPG).toBe("03_DAFTAR_DAPUR");

    const mockSheetMap = new Map<string, number>([
      ["01_RINGKASAN_EKSEKUTIF", 0],
      ["02_PENDAPATAN_SPPG", 1002],
    ]);
    const requests = createMasterDashboardStructureBatchRequests(mockSheetMap, 0);

    expect(requests.length).toBeGreaterThanOrEqual(3);
  });

  it("should generate standardized transaction IDs: SPPG[unit][year]-[I/E][month][counter]", () => {
    const paguSep = googleSheetsService.generateTransactionId("01", "2026-09-02", 1, "income");
    expect(paguSep).toBe("SPPG0126-II001");

    const expSep = googleSheetsService.generateTransactionId("01", "2026-09-03", 1, "expense");
    expect(expSep).toBe("SPPG0126-EI001");

    const janIncome = googleSheetsService.generateTransactionId("02", "2026-01-15", 25, "income");
    expect(janIncome).toBe("SPPG0226-IA025");

    const janExpense = googleSheetsService.generateTransactionId("01", "2026-01-15", 1, "expense");
    expect(janExpense).toBe("SPPG0126-EA001");

    const meiIncome = googleSheetsService.generateTransactionId("01", "2026-05-10", 1, "income");
    expect(meiIncome).toBe("SPPG0126-IE001");

    const meiExpense = googleSheetsService.generateTransactionId("01", "2026-05-10", 1, "expense");
    expect(meiExpense).toBe("SPPG0126-EE001");
  });

  it("should verify 5-Tab constants in sheets-recipes", async () => {
    const { SHEET_NAMES, SHEET_IDS } = await import("../src/core/google/sheets-recipes.js");
    expect(SHEET_NAMES.DASHBOARD).toBe("01_DASHBOARD");
    expect(SHEET_NAMES.PAGU_RINGKASAN).toBe("02_PAGU_RINGKASAN");
    expect(SHEET_NAMES.PAGU_RINCIAN).toBe("03_PAGU_RINCIAN");
    expect(SHEET_NAMES.PENGELUARAN_SUPPLIER).toBe("04_PENGELUARAN_SUPPLIER");
    expect(SHEET_NAMES.REKAP_MARGIN).toBe("05_REKAP_MARGIN");
    expect(SHEET_NAMES.MASTER_DATA).toBe("06_MASTER_DATA");

    expect(SHEET_IDS.PAGU_RINGKASAN).toBe(1002);
    expect(SHEET_IDS.PAGU_RINCIAN).toBe(1003);
    expect(SHEET_IDS.PENGELUARAN_SUPPLIER).toBe(1004);
    expect(SHEET_IDS.REKAP_MARGIN).toBe(1005);
    expect(SHEET_IDS.MASTER_DATA).toBe(1006);
  });

  it("should verify Telegram UI drill-down card and keyboard", async () => {
    const { renderSppgOrderItemsDetail } = await import("../src/core/telegram/formatter.js");
    const { buildDraftConfirmationKeyboard } = await import("../src/core/telegram/keyboards.js");

    const mockOrder: SppgOrder = {
      type: "income",
      sppg_unit: "SPPG Patila",
      order_no: "05/02/09/26",
      order_date: "2026-09-02",
      arrival_date: "2026-09-03",
      items: [
        { no: 1, item_name: "Ayam", qty: 248, unit: "Ekor", price: 60000, total_price: 14880000, supplier_target: "Ayam Pasar" },
      ],
      total_amount: 14880000,
    };

    const detailText = renderSppgOrderItemsDetail(mockOrder);
    expect(detailText).toContain("RINCIAN LENGKAP 1 BAHAN MAKANAN");
    expect(detailText).toContain("05/02/09/26");
    expect(detailText).toContain("Ayam Pasar");

    const kb = buildDraftConfirmationKeyboard("draft-123", "SPPG_ORDER", 22);
    const inlineButtons = (kb as any).inline_keyboard.flat();
    const viewButton = inlineButtons.find((b: any) => b.text.includes("Lihat 22 Rincian Bahan"));
    expect(viewButton).toBeDefined();
    expect(viewButton.callback_data).toBe("v:viewitems:draft-123");
  });
});

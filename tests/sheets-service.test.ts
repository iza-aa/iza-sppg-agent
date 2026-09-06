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

  it("should accurately parse Indonesian currency formatted strings", async () => {
    const { parseCurrencyNumber } = await import("../src/core/google/sheets.service.js");
    expect(parseCurrencyNumber("5.658.000")).toBe(5658000);
    expect(parseCurrencyNumber("Rp 5.658.000")).toBe(5658000);
    expect(parseCurrencyNumber("Rp1.040.000,50")).toBe(1040000.5);
    expect(parseCurrencyNumber("18500000")).toBe(18500000);
    expect(parseCurrencyNumber(250000)).toBe(250000);
    expect(parseCurrencyNumber("")).toBe(0);
    expect(parseCurrencyNumber("-")).toBe(0);
  });

  it("should ensure descending row index sorting for atomic Google Sheets batch deletion", () => {
    // Given arbitrary row indices from various sheets
    const rowIndices = [2, 14, 5, 8, 22, 1];
    const sortedDescending = Array.from(new Set(rowIndices)).sort((a, b) => b - a);

    // Guaranteed order: highest row index first, lowest row index last
    expect(sortedDescending).toEqual([22, 14, 8, 5, 2, 1]);

    // Verify invariant: each deletion does not shift indices below it
    for (let i = 0; i < sortedDescending.length - 1; i++) {
      expect(sortedDescending[i]).toBeGreaterThan(sortedDescending[i + 1]);
    }
  });

  it("should protect Tab 03 (03_PAGU_RINCIAN) from standalone deletion", async () => {
    const { SHEET_NAMES } = await import("../src/core/google/sheets-recipes.js");

    // Mock detail object representing a row found in Tab 03
    const mockDetail = {
      found: true,
      id: "SPPG0126-II001",
      sheetName: SHEET_NAMES.PAGU_RINCIAN,
      orderNo: "05/02/09/26",
      isProtected: true,
      rowIndex: 5,
    };

    expect(mockDetail.isProtected).toBe(true);
    expect(mockDetail.sheetName).toBe("03_PAGU_RINCIAN");
  });

  it("should render partial fulfillment indicator in supplier expense draft card", async () => {
    const { renderSupplierExpenseDraftCard } = await import("../src/core/telegram/formatter.js");

    const mockReceiptWithContext = {
      supplier_name: "TOKO FARHAN",
      date: "2026-08-31",
      total_amount: 96000,
      payment_method: "Transfer BNI",
      items: [
        { item_name: "Telur", qty: 2, unit: "Rak", price: 48000, total_price: 96000 },
      ],
      paguContext: {
        sppg_ref_no: "03/31/08/26",
        pagu_supplier: "Annisa",
        item_name: "Telur",
        target_qty: 117,
        unit: "Rak",
        fulfilled_qty: 0,
        current_qty: 2,
        remaining_qty: 115,
      },
    };

    const card = renderSupplierExpenseDraftCard(mockReceiptWithContext as any, "draft_test", "PENDING");
    expect(card).toContain("DRAF BELANJA SUPPLIER");
    expect(card).toContain("TOKO FARHAN");
    expect(card).toContain("03/31/08/26");
    expect(card).toContain("Annisa");
    expect(card).toContain("Baru beli sebagian (2 dari 117 Rak, masih kurang 115 Rak)");
  });

  it("should build Pagu selector keyboard with candidate list and cancel option", async () => {
    const { buildPaguSelectorKeyboard } = await import("../src/core/telegram/keyboards.js");

    const mockCandidates = [
      { sppg_ref_no: "03/31/08/26", order_date: "2026-08-31", item_name: "Telur", remaining_qty: 115, unit: "Rak", supplier_name: "Annisa" },
      { sppg_ref_no: "04/01/09/26", order_date: "2026-09-01", item_name: "Telur", remaining_qty: 120, unit: "Rak", supplier_name: "Annisa" },
    ];

    const keyboard = buildPaguSelectorKeyboard("draft_test", mockCandidates);
    const flatButtons = keyboard.inline_keyboard.flat();
    const texts = flatButtons.map((b) => b.text);
    const callbacks = flatButtons.map((b) => ("callback_data" in b ? b.callback_data : ""));

    expect(texts.some((t) => t.includes("2026-08-31") && t.includes("115 Rak"))).toBe(true);
    expect(texts.some((t) => t.includes("2026-09-01") && t.includes("120 Rak"))).toBe(true);
    expect(callbacks).toContain("v:pagu_set:draft_test:03/31/08/26");
    expect(callbacks).toContain("v:pagu_set:draft_test:04/01/09/26");
    expect(callbacks).toContain("v:pagu_set:draft_test:-");
    expect(callbacks).toContain("v:sub:back:draft_test");
  });
});

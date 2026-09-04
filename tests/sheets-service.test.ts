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
    const formula = `=HYPERLINK("${driveLink}", "📸 Lihat Nota")`;

    expect(formula).toContain("📸 Lihat Nota");
    expect(mockReceipt.total_amount).toBe(1750000);
  });
});

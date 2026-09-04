import { describe, it, expect } from "vitest";
import { SppgOrderSchema } from "../src/core/ai/schemas/sppg-order.schema.js";
import { SupplierReceiptSchema } from "../src/core/ai/schemas/supplier-receipt.schema.js";
import { agyConnector } from "../src/core/ai/agy-connector.js";

describe("AI Dual Parsers & Schema Integrity (MBG SPPG Domain)", () => {
  it("should successfully parse and validate the exact 22 items SPPG Patila order sheet", () => {
    // Exact data from Ayah's photo: SPPG Patila No. 05/02/09/26
    const realPatilaData = {
      type: "income",
      sppg_unit: "SPPG Patila, Luwu Utara",
      order_no: "05/02/09/26",
      order_date: "2026-09-02",
      arrival_date: "2026-09-03",
      items: [
        { no: 1, item_name: "Ayam", qty: 248, unit: "Ekor", price: 60000, total_price: 14880000, supplier_target: "Ayam Pasar" },
        { no: 2, item_name: "Minyak Kelapa Sawit", qty: 14, unit: "Jerigen", price: 125000, total_price: 1750000, supplier_target: "Hj Muliadi" },
        { no: 3, item_name: "Tempe", qty: 105, unit: "KG", price: 15000, total_price: 1575000, supplier_target: "Mas Pandu" },
        { no: 4, item_name: "Wortel", qty: 75, unit: "KG", price: 18000, total_price: 1350000, supplier_target: "Hj Muliadi" },
        { no: 5, item_name: "Kentang", qty: 80, unit: "KG", price: 18000, total_price: 1440000, supplier_target: "Hj Muliadi" },
        { no: 6, item_name: "Kelengkeng", qty: 15, unit: "Keranjang", price: 380000, total_price: 5700000, supplier_target: "Best Fruit" },
        { no: 7, item_name: "Bawang Merah", qty: 10, unit: "KG", price: 42000, total_price: 420000, supplier_target: "Hj Muliadi" },
        { no: 8, item_name: "Bawang Putih", qty: 10, unit: "KG", price: 40000, total_price: 400000, supplier_target: "Hj Muliadi" },
        { no: 9, item_name: "Kaldu Jamur", qty: 3, unit: "KG", price: 150000, total_price: 450000, supplier_target: "Hj Muliadi" },
        { no: 10, item_name: "Kunyit", qty: 1, unit: "KG", price: 50000, total_price: 50000, supplier_target: "Hj Muliadi" },
        { no: 11, item_name: "Lengkuas", qty: 2, unit: "KG", price: 10000, total_price: 20000, supplier_target: "Hj Muliadi" },
        { no: 12, item_name: "Tepung Maizena", qty: 3, unit: "KG", price: 30000, total_price: 90000, supplier_target: "Hj Muliadi" },
        { no: 13, item_name: "Kecap Manis", qty: 5, unit: "KG", price: 30000, total_price: 150000, supplier_target: "Hj Muliadi" },
        { no: 14, item_name: "Cabai Keriting", qty: 8, unit: "KG", price: 50000, total_price: 400000, supplier_target: "Hj Muliadi" },
        { no: 15, item_name: "Gula Putih", qty: 7, unit: "KG", price: 18000, total_price: 126000, supplier_target: "Hj Muliadi" },
        { no: 16, item_name: "Gula Merah", qty: 2, unit: "KG", price: 30000, total_price: 60000, supplier_target: "Hj Muliadi" },
        { no: 17, item_name: "Kemiri", qty: 1, unit: "KG", price: 60000, total_price: 60000, supplier_target: "Hj Muliadi" },
        { no: 18, item_name: "Serai", qty: 3, unit: "Ikat", price: 5000, total_price: 15000, supplier_target: "Hj Muliadi" },
        { no: 19, item_name: "Daun Salam", qty: 1, unit: "Bungkus", price: 10000, total_price: 10000, supplier_target: "Hj Muliadi" },
        { no: 20, item_name: "Daun Jeruk", qty: 1, unit: "Bungkus", price: 10000, total_price: 10000, supplier_target: "Hj Muliadi" },
        { no: 21, item_name: "Susu UHT", qty: 25, unit: "Liter", price: 22000, total_price: 550000, supplier_target: "Hj Muliadi" },
        { no: 22, item_name: "Jinten", qty: 0.5, unit: "KG", price: 150000, total_price: 75000, supplier_target: "Hj Muliadi" },
      ],
      total_amount: 29581000,
      signed_by: "A. Alya Rahayu AN, S.Pi",
    };

    const validated = SppgOrderSchema.parse(realPatilaData);
    expect(validated.order_no).toBe("05/02/09/26");
    expect(validated.items.length).toBe(22);
    expect(validated.total_amount).toBe(29581000);

    // CPU Sum Check verification
    const computedSum = validated.items.reduce((acc, item) => acc + item.qty * item.price, 0);
    expect(computedSum).toBe(29581000);
  });

  it("should validate supplier expense receipt schema accurately", () => {
    const sampleReceipt = {
      type: "expense",
      supplier_name: "Hj Muliadi",
      date: "2026-09-03",
      sppg_ref_no: "05/02/09/26",
      items: [
        { item_name: "Minyak Kelapa Sawit", qty: 14, unit: "Jerigen", price: 120000, total_price: 1680000 },
        { item_name: "Wortel", qty: 75, unit: "KG", price: 17000, total_price: 1275000 },
        { item_name: "Kentang", qty: 80, unit: "KG", price: 17500, total_price: 1400000 },
      ],
      subtotal: 4355000,
      total_amount: 4355000,
      payment_method: "Cash",
    };

    const validated = SupplierReceiptSchema.parse(sampleReceipt);
    expect(validated.supplier_name).toBe("Hj Muliadi");
    expect(validated.type).toBe("expense");
    expect(validated.total_amount).toBe(4355000);
  });

  it("should safely sanitize and parse JSON with markdown fences in agy connector", () => {
    const markdownJson = "```json\n{\"reply_text\": \"Draf berhasil diekstrak!\", \"status\": \"OK\"}\n```";
    const parsed = agyConnector.safeParseJson(markdownJson);
    expect(parsed.reply_text).toBe("Draf berhasil diekstrak!");
    expect(parsed.status).toBe("OK");
  });
});

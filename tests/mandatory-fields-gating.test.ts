import { describe, it, expect } from "vitest";
import { SupplierReceiptSchema } from "../src/core/ai/schemas/supplier-receipt.schema.js";
import { SppgOrderSchema } from "../src/core/ai/schemas/sppg-order.schema.js";
import { getDraftConfirmationReplyMarkup } from "../src/core/telegram/handlers/draft.handler.js";
import {
  renderSupplierExpenseDraftCard,
  renderSppgOrderDraftCard,
} from "../src/core/telegram/formatter.js";

describe("Mandatory Fields & Interactive Guidance Unit Tests (Induk & Anakan)", () => {
  describe("1. Schema Validations (No Silent Defaulting)", () => {
    it("SupplierReceiptSchema should not silently default payment_method to Cash", () => {
      const parsed = SupplierReceiptSchema.parse({
        supplier_name: "Toko Unggas Barokah",
        date: "2026-09-11",
        items: [
          {
            item_name: "Telur Ayam",
            qty: 20,
            unit: "Rak",
            price: 30000,
            total_price: 600000,
          },
        ],
        total_amount: 600000,
      });

      expect(parsed.payment_method).toBeUndefined();
    });

    it("SppgOrderSchema should not silently default order_no to PO-AUTO", () => {
      const parsed = SppgOrderSchema.parse({
        sppg_unit: "SPPG Dapur Unit 2",
        items: [
          {
            item_name: "Beras",
            qty: 100,
            price: 15000,
            total_price: 1500000,
          },
        ],
        total_amount: 1500000,
      });

      expect(parsed.order_no).toBe("");
    });
  });

  describe("2. Keyboard Gating (No Ya, Simpan When Fields Are Missing)", () => {
    it("should return payment method prompt keyboard when payment_method is missing on expense draft", () => {
      const markup = getDraftConfirmationReplyMarkup(
        "draft_test_1",
        "SUPPLIER_EXPENSE",
        {
          supplier_name: "Toko Unggas Barokah",
          total_amount: 600000,
          payment_method: undefined,
          items: [{ item_name: "Telur", qty: 20, unit: "Rak", price: 30000, total_price: 600000 }],
        }
      );

      const buttons = (markup as any).inline_keyboard.flat();
      const hasSaveBtn = buttons.some((b: any) => b.callback_data?.startsWith("v:save:"));
      const hasPayCash = buttons.some((b: any) => b.callback_data?.includes("v:draft:pay:cash:"));
      const hasPayTf = buttons.some((b: any) => b.callback_data?.includes("v:draft:pay:transfer:"));

      expect(hasSaveBtn).toBe(false);
      expect(hasPayCash).toBe(true);
      expect(hasPayTf).toBe(true);
    });

    it("should return supplier prompt keyboard when supplier_name is missing on expense draft", () => {
      const markup = getDraftConfirmationReplyMarkup(
        "draft_test_2",
        "SUPPLIER_EXPENSE",
        {
          supplier_name: "",
          total_amount: 600000,
          payment_method: "Tunai",
          items: [{ item_name: "Telur", qty: 20, unit: "Rak", price: 30000, total_price: 600000 }],
        }
      );

      const buttons = (markup as any).inline_keyboard.flat();
      const hasSaveBtn = buttons.some((b: any) => b.callback_data?.startsWith("v:save:"));
      const hasSupplierBtn = buttons.some((b: any) => b.callback_data?.includes("v:sub:name:"));

      expect(hasSaveBtn).toBe(false);
      expect(hasSupplierBtn).toBe(true);
    });

    it("should return order_no prompt keyboard when order_no is missing on SPPG_ORDER draft", () => {
      const markup = getDraftConfirmationReplyMarkup(
        "draft_test_3",
        "SPPG_ORDER",
        {
          order_no: "",
          total_amount: 1500000,
          items: [{ item_name: "Beras", qty: 100, price: 15000, total_price: 1500000 }],
        }
      );

      const buttons = (markup as any).inline_keyboard.flat();
      const hasSaveBtn = buttons.some((b: any) => b.callback_data?.startsWith("v:save:"));
      const hasOrderNoBtn = buttons.some((b: any) => b.callback_data?.includes("v:sub:orderno:"));

      expect(hasSaveBtn).toBe(false);
      expect(hasOrderNoBtn).toBe(true);
    });

    it("should return nominal prompt keyboard when total_amount is 0 or missing on expense draft", () => {
      const markup = getDraftConfirmationReplyMarkup(
        "draft_test_missing_amount",
        "SUPPLIER_EXPENSE",
        {
          supplier_name: "Toko Unggas Barokah",
          total_amount: 0,
          payment_method: "Cash",
          items: [{ item_name: "Telur ayam", qty: 20, unit: "Rak", price: 0, total_price: 0 }],
        }
      );

      const buttons = (markup as any).inline_keyboard.flat();
      const hasSaveBtn = buttons.some((b: any) => b.callback_data?.startsWith("v:save:"));
      const hasNominalBtn = buttons.some((b: any) => b.callback_data?.includes("v:sub:nominal:"));

      expect(hasSaveBtn).toBe(false);
      expect(hasNominalBtn).toBe(true);
    });

    it("should return item prompt keyboard when items are missing or generic on expense draft", () => {
      const markup = getDraftConfirmationReplyMarkup(
        "draft_test_missing_items",
        "SUPPLIER_EXPENSE",
        {
          supplier_name: "Toko Unggas Barokah",
          total_amount: 600000,
          payment_method: "Cash",
          items: [],
        }
      );

      const buttons = (markup as any).inline_keyboard.flat();
      const hasSaveBtn = buttons.some((b: any) => b.callback_data?.startsWith("v:save:"));
      const hasItemBtn = buttons.some((b: any) => b.callback_data?.includes("v:sub:item:"));

      expect(hasSaveBtn).toBe(false);
      expect(hasItemBtn).toBe(true);
    });

    it("should allow Ya, Simpan when all mandatory fields are present", () => {
      const markup = getDraftConfirmationReplyMarkup(
        "draft_test_4",
        "SUPPLIER_EXPENSE",
        {
          supplier_name: "Toko Unggas Barokah",
          total_amount: 600000,
          payment_method: "Tunai",
          items: [{ item_name: "Telur", qty: 20, unit: "Rak", price: 30000, total_price: 600000 }],
        }
      );

      const buttons = (markup as any).inline_keyboard.flat();
      const hasSaveBtn = buttons.some((b: any) => b.callback_data?.startsWith("v:save:"));

      expect(hasSaveBtn).toBe(true);
    });
  });

  describe("3. Card Rendering Displays Clear Guidance", () => {
    it("should display 'STATUS: MENUNGGU TOTAL NOMINAL' and 'TOTAL BELANJA: Belum diisi' when amount is 0", () => {
      const card = renderSupplierExpenseDraftCard(
        {
          type: "expense",
          supplier_name: "Toko Unggas Barokah",
          date: "2026-09-11",
          items: [{ item_name: "Telur ayam", qty: 20, unit: "Rak", price: 0, total_price: 0 }],
          subtotal: 0,
          discount: 0,
          tax: 0,
          total_amount: 0,
          payment_method: "Cash",
        },
        "draft_zero_amount",
        "PENDING"
      );

      expect(card).toContain("MENUNGGU TOTAL NOMINAL");
      expect(card).toContain("TOTAL BELANJA: ❓ <i>Belum diisi</i>");
      expect(card).toContain("Harga belum diisi");
      expect(card).not.toContain("STATUS: MENUNGGU KONFIRMASI");
    });

    it("should display 'STATUS: MENUNGGU METODE PEMBAYARAN' and 'Metode: Belum ditentukan' when payment is missing", () => {
      const card = renderSupplierExpenseDraftCard(
        {
          type: "expense",
          supplier_name: "Toko Unggas Barokah",
          date: "2026-09-11",
          items: [{ item_name: "Telur Ayam", qty: 20, unit: "Rak", price: 30000, total_price: 600000 }],
          subtotal: 600000,
          discount: 0,
          tax: 0,
          total_amount: 600000,
          payment_method: undefined as any,
        },
        "draft_1",
        "PENDING"
      );

      expect(card).toContain("MENUNGGU METODE PEMBAYARAN");
      expect(card).toContain("Metode:</b> ❓ <i>Belum ditentukan</i>");
      expect(card).not.toContain("STATUS: MENUNGGU KONFIRMASI");
    });

    it("should display 'STATUS: MENUNGGU NO SURAT PESANAN (PO)' when order_no is empty", () => {
      const card = renderSppgOrderDraftCard(
        {
          type: "income",
          sppg_unit: "SPPG Dapur Unit 2",
          order_no: "",
          order_date: "2026-09-11",
          arrival_date: "2026-09-11",
          items: [{ item_name: "Beras", qty: 100, unit: "KG", price: 15000, total_price: 1500000 }],
          total_amount: 1500000,
        },
        "draft_2",
        "PENDING"
      );

      expect(card).toContain("MENUNGGU NO SURAT PESANAN (PO)");
      expect(card).toContain("No Pesanan: ❓ <i>Belum ditentukan</i>");
      expect(card).not.toContain("STATUS: MENUNGGU KONFIRMASI");
    });

    it("should display 'STATUS: MENUNGGU RINCIAN BARANG' and '❓ Belum diisi (komoditas & kuantitas)' when items are missing or generic", () => {
      const card = renderSupplierExpenseDraftCard(
        {
          type: "expense",
          supplier_name: "Toko Unggas Barokah",
          date: "2026-09-11",
          items: [],
          subtotal: 0,
          discount: 0,
          tax: 0,
          total_amount: 0,
          payment_method: "Cash",
        },
        "draft_no_items",
        "PENDING"
      );

      expect(card).toContain("MENUNGGU RINCIAN BARANG & TOTAL NOMINAL");
      expect(card).toContain("• ❓ <i>Belum diisi (komoditas & kuantitas)</i>");
      expect(card).not.toContain("• Belanja Bahan Pangan");
      expect(card).not.toContain("STATUS: MENUNGGU KONFIRMASI");
    });
  });

  describe("4. Item & Quantity Parser (parseItemAndQtyFromText)", () => {
    it("should parse item name, qty, and unit correctly", async () => {
      const { parseItemAndQtyFromText } = await import("../src/core/ai/static-fallback.js");

      const res1 = parseItemAndQtyFromText("telur ayam 20 rak");
      expect(res1).toEqual({
        itemName: "Telur Ayam",
        qty: 20,
        unit: "Rak",
        price: 0,
        totalAmount: undefined,
      });

      const res2 = parseItemAndQtyFromText("telur ayam 20 rak 600rb");
      expect(res2).toEqual({
        itemName: "Telur Ayam",
        qty: 20,
        unit: "Rak",
        price: 30000,
        totalAmount: 600000,
      });

      const res3 = parseItemAndQtyFromText("20 rak telur ayam");
      expect(res3).toEqual({
        itemName: "Telur Ayam",
        qty: 20,
        unit: "Rak",
        price: 0,
        totalAmount: undefined,
      });

      const res4 = parseItemAndQtyFromText("beras 2 karung 700.000");
      expect(res4).toEqual({
        itemName: "Beras",
        qty: 2,
        unit: "Karung",
        price: 350000,
        totalAmount: 700000,
      });

      // Should return null for standalone amounts or methods
      expect(parseItemAndQtyFromText("600rb")).toBeNull();
      expect(parseItemAndQtyFromText("tunai")).toBeNull();
      expect(parseItemAndQtyFromText("cash")).toBeNull();
    });
  });
});

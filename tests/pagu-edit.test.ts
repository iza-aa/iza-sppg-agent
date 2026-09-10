import { describe, it, expect } from "vitest";
import {
  buildPaguOrderListKeyboard,
  buildPaguItemListKeyboard,
  buildPaguItemActionKeyboard,
  buildPaguItemEditConfirmKeyboard,
} from "../src/core/telegram/keyboards.js";
import type { PaguOrderSummary, PaguRincianItem } from "../src/core/google/sheets.service.js";

describe("Pagu Edit & Cascade Update Unit Tests", () => {
  const dummyOrders: PaguOrderSummary[] = [
    {
      orderNo: "01/05/09/26",
      orderDate: "2026-09-05",
      itemCount: "4 bahan",
      totalAmount: 3824000,
      notes: "Menu Nasi Ayam Gulai",
    },
    {
      orderNo: "02/09/09/26",
      orderDate: "2026-09-09",
      itemCount: "4 bahan",
      totalAmount: 4200000,
      notes: "Menu Nasi Telur Balado",
    },
  ];

  const dummyItems: PaguRincianItem[] = [
    {
      orderNo: "01/05/09/26",
      transactionId: "TRX-PAGU-01",
      itemIndex: 1,
      rowIndex: 2,
      supplier: "UD Barokah",
      itemName: "Ayam 2,3",
      qty: 100,
      unit: "kg",
      price: 30000,
      totalAmount: 3000000,
      notes: "Segar potong 8",
    },
    {
      orderNo: "01/05/09/26",
      transactionId: "TRX-PAGU-02",
      itemIndex: 2,
      rowIndex: 3,
      supplier: "Toko Beras Subur",
      itemName: "Beras Premium",
      qty: 50,
      unit: "kg",
      price: 14000,
      totalAmount: 700000,
      notes: "Kemasan 25kg",
    },
    {
      orderNo: "01/05/09/26",
      transactionId: "TRX-PAGU-03",
      itemIndex: 3,
      rowIndex: 4,
      supplier: "Pasar Sentral",
      itemName: "Bumbu Gulai Lengkap",
      qty: 4,
      unit: "paket",
      price: 31000,
      totalAmount: 124000,
    },
  ];

  describe("Interactive Keyboards for Pagu Management", () => {
    it("should build proper PO list keyboard with date and formatted amount", () => {
      const kb = buildPaguOrderListKeyboard(dummyOrders);
      const buttons = kb.inline_keyboard.flat();

      expect(buttons.length).toBe(3); // 2 POs + 1 Back button
      expect(buttons[0].callback_data).toBe("v:pagu_ord:01/05/09/26");
      expect(buttons[0].text).toContain("01/05/09/26");
      expect(buttons[0].text).toContain("3.824.000");

      expect(buttons[1].callback_data).toBe("v:pagu_ord:02/09/09/26");
      expect(buttons[2].callback_data).toBe("qa:start");
    });

    it("should build paginated ingredient list keyboard with row index in callback data", () => {
      const kb = buildPaguItemListKeyboard("01/05/09/26", dummyItems, 0, 2);
      const buttons = kb.inline_keyboard.flat();

      // Page size 2: 2 item buttons + 1 next page button + 1 back to PO list button
      expect(buttons[0].callback_data).toBe("v:pagu_it:01/05/09/26:2");
      expect(buttons[0].text).toContain("Ayam 2,3");
      expect(buttons[0].text).toContain("100 kg");

      expect(buttons[1].callback_data).toBe("v:pagu_it:01/05/09/26:3");
      expect(buttons[1].text).toContain("Beras Premium");

      const nextBtn = buttons.find((b) => b.callback_data === "v:pagu_page:01/05/09/26:1");
      expect(nextBtn).toBeDefined();

      const backBtn = buttons.find((b) => b.callback_data === "v:pagu_orders");
      expect(backBtn).toBeDefined();
    });

    it("should build item action keyboard with Name, Qty, Price, Supplier, and Back buttons", () => {
      const kb = buildPaguItemActionKeyboard("01/05/09/26", 2, "Ayam 2,3");
      const buttons = kb.inline_keyboard.flat();

      expect(buttons.length).toBe(5);
      expect(buttons[0].callback_data).toBe("v:pagu_act:01/05/09/26:2:name");
      expect(buttons[1].callback_data).toBe("v:pagu_act:01/05/09/26:2:qty");
      expect(buttons[2].callback_data).toBe("v:pagu_act:01/05/09/26:2:price");
      expect(buttons[3].callback_data).toBe("v:pagu_act:01/05/09/26:2:supplier");
      expect(buttons[4].callback_data).toBe("v:pagu_ord:01/05/09/26");
    });

    it("should build edit confirmation keyboard with encoded value and cancel button", () => {
      const kb = buildPaguItemEditConfirmKeyboard("01/05/09/26", 2, "qty", "120");
      const buttons = kb.inline_keyboard.flat();

      expect(buttons.length).toBe(2);
      expect(buttons[0].callback_data).toBe("v:pagu_apply:01/05/09/26:2:qty:120");
      expect(buttons[0].text).toContain("Terapkan Perubahan");
      expect(buttons[1].callback_data).toBe("v:pagu_it:01/05/09/26:2");
      expect(buttons[1].text).toContain("Batalkan");
    });
  });

  describe("Pagu Service & Delta Sync Rules", () => {
    it("should reject invalid row index when updating pagu item detail", async () => {
      const { googleSheetsService } = await import("../src/core/google/sheets.service.js");
      const res = await googleSheetsService.updatePaguItemDetail("dummy-sheet-id", "01/05/09/26", 1, { qty: 100 }, "Ayah");
      expect(res.success).toBe(false);
      expect(res.message).toContain("tidak ditemukan di Tab 03");
    });

    it("should correctly map Tab 03 Pagu Rincian columns to Tab 05 Rekap Margin columns", () => {
      // Tab 03 Col 3 (D - Rekanan) -> Tab 05 Col 2 (C)
      // Tab 03 Col 4 (E - Bahan)   -> Tab 05 Col 3 (D)
      // Tab 03 Col 5 (F - Qty)     -> Tab 05 Col 4 (E)
      // Tab 03 Col 6 (G - Satuan)  -> Tab 05 Col 5 (F)
      // Tab 03 Col 7 (H - Harga)   -> Tab 05 Col 6 (G)
      const tab3ToTab5Map: Record<number, number> = {
        3: 2, // Col D -> Col C (Supplier)
        4: 3, // Col E -> Col D (Bahan)
        5: 4, // Col F -> Col E (Kuantitas)
        6: 5, // Col G -> Col F (Satuan)
        7: 6, // Col H -> Col G (Harga Satuan)
      };

      expect(tab3ToTab5Map[3]).toBe(2);
      expect(tab3ToTab5Map[4]).toBe(3);
      expect(tab3ToTab5Map[5]).toBe(4);
      expect(tab3ToTab5Map[6]).toBe(5);
      expect(tab3ToTab5Map[7]).toBe(6);
    });
  });
});

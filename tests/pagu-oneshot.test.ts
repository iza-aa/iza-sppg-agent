import { describe, it, expect, vi } from "vitest";
import { staticParsePaguModification } from "../src/core/ai/parsers/pagu-modification.parser.js";
import { metaAgent } from "../src/core/ai/meta-agent.js";
import {
  buildPaguOneShotConfirmKeyboard,
  buildPaguClarifyAddOrReplaceKeyboard,
  buildPaguItemPickForReplaceKeyboard,
  buildPaguItemListKeyboard,
} from "../src/core/telegram/keyboards.js";
import { googleSheetsService, PaguOrderSummary, PaguRincianItem } from "../src/core/google/sheets.service.js";

describe("1-Shot Conversational Pagu Modification", () => {
  describe("staticParsePaguModification Parser", () => {
    it("should parse full prompt with PO code, item name, qty, unit, and price", () => {
      const text = "saya mau ngubah IH001 jadi Wortel kuantitas 20 satuan biji harga satuannya 5rb";
      const result = staticParsePaguModification(text);

      expect(result).not.toBeNull();
      expect(result?.orderRef).toBe("IH001");
      expect(result?.newItemName?.toLowerCase()).toBe("wortel");
      expect(result?.qty).toBe(20);
      expect(result?.unit).toBe("biji");
      expect(result?.price).toBe(5000);
    });

    it("should parse item change with existing item name, qty unit, and price", () => {
      const text = "ubah telur di IH001 jadi 150 rak harga 45rb";
      const result = staticParsePaguModification(text);

      expect(result).not.toBeNull();
      expect(result?.orderRef).toBe("IH001");
      expect(result?.targetItemName?.toLowerCase()).toBe("telur");
      expect(result?.qty).toBe(150);
      expect(result?.unit).toBe("rak");
      expect(result?.price).toBe(45000);
    });

    it("should parse change with supplier name and dot-separated thousands", () => {
      const text = "ganti pagu ayam pada II005 kuantitas 100 kg harga 32.000 supplier toko berkah";
      const result = staticParsePaguModification(text);

      expect(result).not.toBeNull();
      expect(result?.orderRef).toBe("II005");
      expect(result?.targetItemName?.toLowerCase()).toBe("ayam");
      expect(result?.qty).toBe(100);
      expect(result?.unit).toBe("kg");
      expect(result?.price).toBe(32000);
      expect(result?.supplier?.toLowerCase()).toBe("toko berkah");
    });

    it("should parse short instruction with bahan keyword", () => {
      const text = "ubah IH001 bahan wortel qty 20 harga 5000";
      const result = staticParsePaguModification(text);

      expect(result).not.toBeNull();
      expect(result?.orderRef).toBe("IH001");
      expect(result?.targetItemName?.toLowerCase()).toBe("wortel");
      expect(result?.qty).toBe(20);
      expect(result?.price).toBe(5000);
    });

    it("should parse explicit addition prompt with ADD action intent", () => {
      const text = "tambah di IH001 bahan Wortel 20 kg harga 15rb rekanan CV Sayur Segar";
      const result = staticParsePaguModification(text);

      expect(result).not.toBeNull();
      expect(result?.orderRef).toBe("IH001");
      expect(result?.actionIntent).toBe("ADD");
      expect(result?.newItemName?.toLowerCase()).toBe("wortel");
      expect(result?.qty).toBe(20);
      expect(result?.unit).toBe("kg");
      expect(result?.price).toBe(15000);
      expect(result?.supplier).toBe("CV Sayur Segar");
    });

    it("should return null for non-pagu or non-modification text", () => {
      expect(staticParsePaguModification("rekap")).toBeNull();
      expect(staticParsePaguModification("halo apa kabar?")).toBeNull();
      expect(staticParsePaguModification("beli ayam 100rb di pasar")).toBeNull();
    });
  });

  describe("MetaAgent Routing for Pagu Modification", () => {
    it("should classify 1-shot modification prompt as PAGU_MODIFICATION intent", async () => {
      const prompt = "saya mau ngubah IH001 jadi Wortel kuantitas 20 satuan biji harga satuannya 5rb";
      const intent = await metaAgent.classifyAndRoute(prompt, "SPPG Patila", "Ayah");

      expect(intent.type).toBe("PAGU_MODIFICATION");
      if (intent.type === "PAGU_MODIFICATION") {
        expect(intent.request.orderRef).toBe("IH001");
        expect(intent.request.qty).toBe(20);
        expect(intent.request.price).toBe(5000);
      }
    });

    it("should not misclassify purchase logs as pagu modification", async () => {
      const prompt = "beli telur 50000 di toko berkah";
      const intent = await metaAgent.classifyAndRoute(prompt, "SPPG Patila", "Ayah");

      expect(intent.type).toBe("RECORD_TRANSACTION");
    });
  });

  describe("1-Shot Keyboards & Callbacks", () => {
    it("should create compact confirm keyboard (< 64 bytes callback data)", () => {
      const draftId = "p1s_abc123";
      const kb = buildPaguOneShotConfirmKeyboard(draftId);
      const json = kb.inline_keyboard;

      expect(json.length).toBe(2);
      expect(json[0][0].callback_data).toBe("v:p1s_ok:p1s_abc123");
      expect(json[1][0].callback_data).toBe("v:p1s_c:p1s_abc123");
      expect(json[0][0].callback_data.length).toBeLessThan(64);
    });

    it("should create clarify keyboard with add and replace options", () => {
      const draftId = "p1s_abc123";
      const kb = buildPaguClarifyAddOrReplaceKeyboard(draftId);
      const json = kb.inline_keyboard;

      expect(json.length).toBe(3);
      expect(json[0][0].callback_data).toBe("v:p1s_add:p1s_abc123");
      expect(json[1][0].callback_data).toBe("v:p1s_rep:p1s_abc123:0");
      expect(json[2][0].callback_data).toBe("v:p1s_c:p1s_abc123");
    });

    it("should create replace picker keyboard with ingredient list", () => {
      const draftId = "p1s_abc123";
      const mockItems: PaguRincianItem[] = [
        {
          orderNo: "03/31/08/26",
          transactionId: "SPPG0126-IH001",
          itemIndex: 1,
          rowIndex: 5,
          supplier: "Toko Berkah",
          itemName: "Ayam Broiler",
          qty: 100,
          unit: "kg",
          price: 32000,
          totalAmount: 3200000,
        },
        {
          orderNo: "03/31/08/26",
          transactionId: "SPPG0126-IH001",
          itemIndex: 2,
          rowIndex: 6,
          supplier: "Toko Berkah",
          itemName: "Telur Ayam",
          qty: 50,
          unit: "rak",
          price: 45000,
          totalAmount: 2250000,
        },
      ];

      const kb = buildPaguItemPickForReplaceKeyboard(draftId, mockItems, 0, 5);
      const json = kb.inline_keyboard;

      expect(json.length).toBe(3); // 2 items + 1 cancel
      expect(json[0][0].callback_data).toBe("v:p1s_pk:p1s_abc123:5");
      expect(json[1][0].callback_data).toBe("v:p1s_pk:p1s_abc123:6");
    });

    it("should include button to add new item in buildPaguItemListKeyboard", () => {
      const orderNo = "03/31/08/26";
      const mockItems: PaguRincianItem[] = [
        {
          orderNo,
          itemIndex: 1,
          rowIndex: 5,
          supplier: "Toko Berkah",
          itemName: "Ayam Broiler",
          qty: 100,
          unit: "kg",
          price: 32000,
          totalAmount: 3200000,
        },
      ];

      const kb = buildPaguItemListKeyboard(orderNo, mockItems, 0, 6);
      const json = kb.inline_keyboard;
      const addBtn = json.flat().find((btn) => btn.callback_data === `v:pagu_add:${orderNo}`);

      expect(addBtn).toBeDefined();
      expect(addBtn?.text).toContain("Tambah Bahan Baru");
    });
  });

  describe("GoogleSheetsService findPaguItemByQuery Mocked Unit Test", () => {
    it("should locate item matching orderRef and itemName", async () => {
      const mockOrders: PaguOrderSummary[] = [
        {
          orderNo: "03/31/08/26",
          transactionId: "SPPG0126-IH001",
          orderDate: "31/08/2026",
          itemCount: "28 Item",
          totalAmount: 15000000,
        },
      ];

      const mockItems: PaguRincianItem[] = [
        {
          orderNo: "03/31/08/26",
          transactionId: "SPPG0126-IH001",
          itemIndex: 1,
          rowIndex: 4,
          supplier: "Toko Berkah",
          itemName: "Telur Ayam",
          qty: 100,
          unit: "rak",
          price: 40000,
          totalAmount: 4000000,
        },
      ];

      vi.spyOn(googleSheetsService, "ensure5TabStructure").mockResolvedValue(undefined as any);
      vi.spyOn(googleSheetsService, "getPaguOrders").mockResolvedValue(mockOrders);
      vi.spyOn(googleSheetsService, "getPaguOrderItems").mockResolvedValue(mockItems);

      const result = await googleSheetsService.findPaguItemByQuery(
        "test-sheet-id",
        "IH001",
        "Telur Ayam"
      );

      expect(result.order).not.toBeNull();
      expect(result.order?.orderNo).toBe("03/31/08/26");
      expect(result.foundItem).not.toBeNull();
      expect(result.foundItem?.itemName).toBe("Telur Ayam");
    });
  });
});

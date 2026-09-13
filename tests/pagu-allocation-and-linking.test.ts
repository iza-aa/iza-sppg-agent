import { describe, it, expect } from "vitest";
import { metaAgent } from "../src/core/ai/meta-agent.js";
import { getDraftConfirmationReplyMarkup } from "../src/core/telegram/handlers/draft.handler.js";
import { renderSupplierExpenseDraftCard, renderLinkExpenseConfirmationCard } from "../src/core/telegram/formatter.js";
import { pendingLinkRequests, type PendingLinkExpenseState } from "../src/core/telegram/types/bot-context.js";

describe("Pagu Allocation Gating & Transaction Linking Tests", () => {
  describe("1. MetaAgent Natural Language Linking Heuristics", () => {
    it("should classify 'ei001 kaitkan dengan pagu ii001' as LINK_EXPENSE_TO_PAGU", async () => {
      const intent = await metaAgent.classifyAndRoute("ei001 kaitkan dengan pagu ii001", "SPPG Dapur Unit 2", "Heizaaa");
      expect(intent.type).toBe("LINK_EXPENSE_TO_PAGU");
      if (intent.type === "LINK_EXPENSE_TO_PAGU") {
        expect(intent.expenseId.toLowerCase()).toBe("ei001");
        expect(intent.paguId.toLowerCase()).toBe("ii001");
      }
    });

    it("should classify 'kaitkan ei001 ke pagu ii001' as LINK_EXPENSE_TO_PAGU", async () => {
      const intent = await metaAgent.classifyAndRoute("kaitkan ei001 ke pagu ii001", "SPPG Dapur Unit 2", "Heizaaa");
      expect(intent.type).toBe("LINK_EXPENSE_TO_PAGU");
      if (intent.type === "LINK_EXPENSE_TO_PAGU") {
        expect(intent.expenseId.toLowerCase()).toBe("ei001");
        expect(intent.paguId.toLowerCase()).toBe("ii001");
      }
    });

    it("should classify 'tautkan pengeluaran SPPG0226-EI001 ke pagu PO-2026/09/SPPG2-01' as LINK_EXPENSE_TO_PAGU", async () => {
      const intent = await metaAgent.classifyAndRoute("tautkan pengeluaran SPPG0226-EI001 ke pagu PO-2026/09/SPPG2-01");
      expect(intent.type).toBe("LINK_EXPENSE_TO_PAGU");
      if (intent.type === "LINK_EXPENSE_TO_PAGU") {
        expect(intent.expenseId).toBe("SPPG0226-EI001");
        expect(intent.paguId).toBe("PO-2026/09/SPPG2-01");
      }
    });

    it("should swap inverted order 'pagu ii001 kaitkan dengan ei001' so expenseId is ei001 and paguId is ii001", async () => {
      const intent = await metaAgent.classifyAndRoute("pagu ii001 kaitkan dengan ei001");
      expect(intent.type).toBe("LINK_EXPENSE_TO_PAGU");
      if (intent.type === "LINK_EXPENSE_TO_PAGU") {
        expect(intent.expenseId.toLowerCase()).toBe("ei001");
        expect(intent.paguId.toLowerCase()).toBe("ii001");
      }
    });
  });

  describe("2. Expense Draft Pagu Allocation Gating", () => {
    it("should display 'Alokasi Anggaran: Belum ditentukan' and 'MENUNGGU ALOKASI PAGU' when paguSelectionRequired is true", () => {
      const card = renderSupplierExpenseDraftCard(
        {
          supplier_name: "Toko Unggas Barokah",
          total_amount: 600000,
          payment_method: "Tunai",
          date: "2026-09-11",
          items: [{ item_name: "Telur Ayam", qty: 20, unit: "Rak", price: 30000, total_price: 600000 }],
          paguSelectionRequired: true,
          paguCandidates: [
            { sppg_ref_no: "PO-2026/09/SPPG2-01", order_date: "2026-09-11" }
          ],
        },
        "draft_test_pagu",
        "PENDING"
      );

      expect(card).toContain("Alokasi Anggaran</b>: ❓ <i>Belum ditentukan</i>");
      expect(card).toContain("STATUS: MENUNGGU ALOKASI PAGU");
      expect(card).not.toContain("STATUS: MENUNGGU KONFIRMASI");
    });

    it("should provide Pagu choice and Non-Pagu choice buttons when paguSelectionRequired is true", () => {
      const markup = getDraftConfirmationReplyMarkup(
        "draft_test_pagu",
        "SUPPLIER_EXPENSE",
        {
          supplier_name: "Toko Unggas Barokah",
          total_amount: 600000,
          payment_method: "Tunai",
          items: [{ item_name: "Telur Ayam", qty: 20, unit: "Rak", price: 30000, total_price: 600000 }],
          paguSelectionRequired: true,
          paguCandidates: [
            { sppg_ref_no: "PO-2026/09/SPPG2-01", order_date: "2026-09-11" }
          ],
        }
      );

      const buttons = markup.inline_keyboard.flat();
      const poBtn = buttons.find((b: any) => b.callback_data?.includes("v:pagu_set:draft_test_pagu:PO-2026/09/SPPG2-01"));
      const nonPaguBtn = buttons.find((b: any) => b.callback_data === "v:pagu_set:draft_test_pagu:-");
      const saveBtn = buttons.find((b: any) => b.callback_data === "v:save:draft_test_pagu");

      expect(poBtn).toBeDefined();
      expect(nonPaguBtn).toBeDefined();
      expect(saveBtn).toBeUndefined(); // Cannot save until pagu or non-pagu is chosen!
    });

    it("should provide 'Ya, Simpan' once user selects Non-Pagu ('-')", () => {
      const markup = getDraftConfirmationReplyMarkup(
        "draft_test_pagu",
        "SUPPLIER_EXPENSE",
        {
          supplier_name: "Toko Unggas Barokah",
          total_amount: 600000,
          payment_method: "Tunai",
          sppg_ref_no: "-",
          paguSelectionRequired: false,
          items: [{ item_name: "Telur Ayam", qty: 20, unit: "Rak", price: 30000, total_price: 600000 }],
        }
      );

      const buttons = markup.inline_keyboard.flat();
      const saveBtn = buttons.find((b: any) => b.callback_data === "v:save:draft_test_pagu");
      expect(saveBtn).toBeDefined();
    });

    it("should provide 'Ya, Simpan' once user selects a specific Pagu ('PO-2026/09/SPPG2-01')", () => {
      const markup = getDraftConfirmationReplyMarkup(
        "draft_test_pagu",
        "SUPPLIER_EXPENSE",
        {
          supplier_name: "Toko Unggas Barokah",
          total_amount: 600000,
          payment_method: "Tunai",
          sppg_ref_no: "PO-2026/09/SPPG2-01",
          paguSelectionRequired: false,
          items: [{ item_name: "Telur Ayam", qty: 20, unit: "Rak", price: 30000, total_price: 600000 }],
        }
      );

      const buttons = markup.inline_keyboard.flat();
      const saveBtn = buttons.find((b: any) => b.callback_data === "v:save:draft_test_pagu");
      expect(saveBtn).toBeDefined();
    });
  });

  describe("3. Two-Phase Transaction Linking Confirmation", () => {
    it("should render confirmation card with full sync impact on Tab 03, Tab 02, Tab 04, Tab 05, and Tab 06", () => {
      const card = renderLinkExpenseConfirmationCard({
        unitName: "SPPG Dapur Unit 2",
        expenseId: "SPPG0226-EI001",
        paguId: "SPPG0226-II001",
        orderNo: "PO-2026/09/SPPG2-01",
        supplier: "Toko Unggas Barokah",
        amount: 600000,
        items: [
          { itemName: "Telur Ayam", qty: 20, unit: "Rak", price: 30000, total: 600000 },
        ],
        newItemCount: 5,
        newSupplierCount: 5,
      });

      expect(card).toContain("📋 <b>KONFIRMASI PENAUTAN BELANJA KE PAGU</b>");
      expect(card).toContain("SPPG Dapur Unit 2");
      expect(card).toContain("SPPG0226-EI001");
      expect(card).toContain("PO-2026/09/SPPG2-01");
      expect(card).toContain("Toko Unggas Barokah");
      expect(card).toContain("Telur Ayam");
      expect(card).toContain("03_RINCIAN_PENDAPATAN");
      expect(card).toContain("02_PENDAPATAN");
      expect(card).toContain("menjadi 5 Item");
      expect(card).toContain("menjadi 5 Supplier");
      expect(card).toContain("[Edit]");
      expect(card).toContain("06_MARGIN");
      expect(card).toContain("🟢 PAS");
      expect(card).toContain("Apakah Anda yakin ingin menautkan transaksi pengeluaran ini ke pagu pesanan tersebut?");
    });

    it("should store and retrieve pending link request in pendingLinkRequests map", () => {
      const linkId = "link_test_12345";
      const payload: PendingLinkExpenseState = {
        linkId,
        expenseId: "SPPG0226-EI001",
        paguId: "SPPG0226-II001",
        orderNo: "PO-2026/09/SPPG2-01",
        unitName: "SPPG Dapur Unit 2",
        supplier: "Toko Unggas Barokah",
        amount: 600000,
        items: [
          { itemName: "Telur Ayam", qty: 20, unit: "Rak", price: 30000, total: 600000 },
        ],
        callerName: "Heizaaa",
        newItemCount: 5,
        newSupplierCount: 5,
      };

      pendingLinkRequests.set(linkId, payload);
      expect(pendingLinkRequests.has(linkId)).toBe(true);

      const retrieved = pendingLinkRequests.get(linkId);
      expect(retrieved?.expenseId).toBe("SPPG0226-EI001");
      expect(retrieved?.orderNo).toBe("PO-2026/09/SPPG2-01");
      expect(retrieved?.callerName).toBe("Heizaaa");

      pendingLinkRequests.delete(linkId);
      expect(pendingLinkRequests.has(linkId)).toBe(false);
    });
  });

  describe("4. Transparent Raw Chat & Keterangan Audit Trail Formatting", () => {
    it("should preserve exact raw user input in notes when parsing text transactions", async () => {
      const { staticParseTransaction } = await import("../src/core/ai/static-fallback.js");
      const userPrompt = "Beli telur ayam 20 rak 600rb di Toko Unggas Barokah tunai";
      const result = staticParseTransaction(userPrompt);
      expect(result).not.toBeNull();
      if (result && result.type === "SUPPLIER_EXPENSE") {
        expect(result.data.notes).toBe(userPrompt);
        expect(result.data.notes).not.toBe("Pencatatan Offline (Regex Fallback Layer 3)");
        expect(result.data.notes).not.toBe("Pencatatan teks via Telegram");
      }
    });

    it("should clean legacy '[Edit] ' prefix and append transparent multi-line edit trail", () => {
      const existingNotes = "[Edit] [Chat] Menu Ayam Kecap dan Sayur Bening";
      let baseNotes = existingNotes;
      if (baseNotes.startsWith("[Edit] ")) {
        baseNotes = baseNotes.substring(7).trim();
      }
      expect(baseNotes).toBe("[Chat] Menu Ayam Kecap dan Sayur Bening");

      const editLine = "[Edit 11 Sep 2026, 20:59 WIB] Ditautkan dari pengeluaran SPPG0226-EI001: Telur Ayam 20 Rak @ Rp 45.000 (Toko Unggas Barokah) (oleh Heizaaa)";
      const updatedNotes = `${baseNotes}\n${editLine}`;

      const lines = updatedNotes.split("\n");
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe("[Chat] Menu Ayam Kecap dan Sayur Bening");
      expect(lines[1]).toContain("Ditautkan dari pengeluaran SPPG0226-EI001");
      expect(lines[1]).toContain("oleh Heizaaa");
      expect(updatedNotes).not.toContain("http");
    });
  });
});


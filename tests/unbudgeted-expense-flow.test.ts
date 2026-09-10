import { describe, it, expect } from "vitest";
import { renderPaguOneShotCard, type PaguOneShotDraft } from "../src/core/telegram/types/bot-context.js";
import { buildUnbudgetedExpenseKeyboard, buildPaguPricePickerKeyboard } from "../src/core/telegram/keyboards.js";

describe("Unbudgeted Expense Flow (Smart Warning & Dual Flow)", () => {
  it("should render unbudgeted warning card when draft is an expense without matching pagu", () => {
    const draft: PaguOneShotDraft = {
      draftId: "p1s_test123",
      spreadsheetId: "sheet-abc",
      orderNo: "PO-2026/09/SPPG2-01",
      orderLabel: "Nota Supplier (SPPG0226-EI001)",
      action: "ADD",
      itemName: "ati ampela",
      qty: 10,
      unit: "kg",
      price: 25000,
      supplier: "Ayam Pasar",
      updatedBy: "Heizaaa",
      createdAt: Date.now(),
      isExpense: true,
      expenseId: "SPPG0226-EI001",
      isUnbudgeted: true,
    };

    const card = renderPaguOneShotCard(draft, "SPPG Dapur Unit 2");

    expect(card).toContain("⚠️ <b>BAHAN BELUM TERDAFTAR DI PAGU RESMI BGN</b>");
    expect(card).toContain("ati ampela");
    expect(card).toContain("PO-2026/09/SPPG2-01");
    expect(card).toContain("SPPG0226-EI001");
    expect(card).toContain("25.000");
    expect(card).toContain("250.000");
    expect(card).toContain("Non-Pagu");
  });

  it("should build unbudgeted expense keyboard with Dual Actions", () => {
    const kb = buildUnbudgetedExpenseKeyboard("p1s_test123");
    const json = kb.inline_keyboard;

    expect(json.length).toBe(3);
    // Button 1: Simpan Non-Pagu
    expect(json[0][0].text).toContain("Non-Pagu");
    expect(json[0][0].callback_data).toBe("v:p1s_np:p1s_test123");
    // Button 2: Daftarkan ke Pagu
    expect(json[1][0].text).toContain("Daftarkan ke Pagu");
    expect(json[1][0].callback_data).toBe("v:p1s_regp:p1s_test123");
    // Button 3: Batalkan
    expect(json[2][0].text).toContain("Batalkan");
    expect(json[2][0].callback_data).toBe("v:p1s_c:p1s_test123");
  });

  it("should build pagu price picker keyboard with reasonable options", () => {
    const kb = buildPaguPricePickerKeyboard("p1s_test123", 25000);
    const json = kb.inline_keyboard;

    expect(json.length).toBe(4);
    // Same as buying price: 25000
    expect(json[0][0].callback_data).toBe("v:p1s_sp:p1s_test123:25000");
    // +10%: 27500
    expect(json[1][0].callback_data).toBe("v:p1s_sp:p1s_test123:27500");
    // +15%: 28750
    expect(json[2][0].callback_data).toBe("v:p1s_sp:p1s_test123:28750");
    // Cancel
    expect(json[3][0].callback_data).toBe("v:p1s_c:p1s_test123");
  });
});

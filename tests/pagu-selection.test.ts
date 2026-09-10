import { describe, it, expect } from "vitest";
import { buildPaguPromptKeyboard, buildDraftConfirmationKeyboard } from "../src/core/telegram/keyboards.js";
import { renderSupplierExpenseDraftCard } from "../src/core/telegram/formatter.js";
import type { SupplierReceipt } from "../src/core/ai/schemas/supplier-receipt.schema.js";

describe("Interactive Pagu Selection Logic", () => {
  const dummyCandidates = [
    {
      rowIndex: 2,
      sppg_ref_no: "01/05/09/26",
      order_date: "2026-09-05",
      supplier_name: "UD Barokah",
      item_name: "Ayam 2,3",
      target_qty: 100,
      unit: "kg",
      pagu_price: 30000,
      pagu_total: 3000000,
      fulfilled_qty: 50,
      fulfilled_total: 1500000,
      remaining_qty: 50,
      status: "🟠 BELUM LENGKAP (50/100 kg)",
    },
    {
      rowIndex: 10,
      sppg_ref_no: "02/09/09/26",
      order_date: "2026-09-09",
      supplier_name: "UD Berkah Jaya",
      item_name: "Ayam 2,3",
      target_qty: 150,
      unit: "kg",
      pagu_price: 30000,
      pagu_total: 4500000,
      fulfilled_qty: 0,
      fulfilled_total: 0,
      remaining_qty: 150,
      status: "🟡 MENUNGGU INVOICE",
    },
  ];

  it("should generate buildPaguPromptKeyboard with candidates, non-pagu, and cancel button (no save button)", () => {
    const kb = buildPaguPromptKeyboard("draft_test_123", dummyCandidates);
    const buttons = kb.inline_keyboard.flat();

    // Check candidate buttons
    const poButtons = buttons.filter((b) => b.callback_data?.startsWith("v:pagu_set:draft_test_123:0"));
    expect(poButtons.length).toBe(2);
    expect(poButtons[0].text).toContain("01/05/09/26");
    expect(poButtons[0].text).toContain("Menu");
    expect(poButtons[1].text).toContain("02/09/09/26");
    expect(poButtons[1].text).toContain("Menu");

    // Check non-pagu option
    const nonPaguBtn = buttons.find((b) => b.callback_data === "v:pagu_set:draft_test_123:-");
    expect(nonPaguBtn).toBeDefined();

    // Check cancel button
    const cancelBtn = buttons.find((b) => b.callback_data === "v:cancel:draft_test_123");
    expect(cancelBtn).toBeDefined();

    // Save button MUST NOT exist
    const saveBtn = buttons.find((b) => b.callback_data?.startsWith("v:save:"));
    expect(saveBtn).toBeUndefined();
  });

  it("should render card with warning and waiting selection status when paguSelectionRequired is true", () => {
    const expense: SupplierReceipt = {
      sppg_ref_no: "",
      supplier_name: "UD Barokah",
      date: "2026-09-09",
      total_amount: 1500000,
      payment_method: "Tunai",
      items: [
        {
          item_name: "Ayam 2,3",
          qty: 50,
          unit: "kg",
          price: 30000,
          total_price: 1500000,
        },
      ],
    };

    (expense as any).paguSelectionRequired = true;
    (expense as any).paguCandidates = dummyCandidates;

    const card = renderSupplierExpenseDraftCard(expense, "draft_test_123", "PENDING");

    expect(card).toContain("Alokasi Anggaran: ⚠️ BELUM DIPILIH");
    expect(card).toContain("Ditemukan 2 rencana menu aktif");
    expect(card).toContain("STATUS: MENUNGGU PILIHAN ANGGARAN MENU");
  });

  it("should render card normally with save button once pagu is selected", () => {
    const expense: SupplierReceipt = {
      sppg_ref_no: "01/05/09/26",
      supplier_name: "UD Barokah",
      date: "2026-09-09",
      total_amount: 1500000,
      payment_method: "Tunai",
      items: [
        {
          item_name: "Ayam 2,3",
          qty: 50,
          unit: "kg",
          price: 30000,
          total_price: 1500000,
        },
      ],
    };

    (expense as any).paguSelectionRequired = false;
    (expense as any).paguContext = {
      sppg_ref_no: "01/05/09/26",
      order_date: "2026-09-05",
      pagu_supplier: "UD Barokah",
      item_name: "Ayam 2,3",
      target_qty: 100,
      unit: "kg",
      fulfilled_qty: 50,
      current_qty: 50,
      remaining_qty: 50,
      candidates_count: 2,
    };

    const card = renderSupplierExpenseDraftCard(expense, "draft_test_123", "PENDING");

    expect(card).toContain("<b>Alokasi Anggaran</b>: <code>01/05/09/26</code>");
    expect(card).toContain("Belanja lengkap (100 kg terpenuhi)");
    expect(card).toContain("STATUS: MENUNGGU KONFIRMASI");

    const kb = buildDraftConfirmationKeyboard("draft_test_123", "SUPPLIER_EXPENSE", 1, true);
    const buttons = kb.inline_keyboard.flat();
    const saveBtn = buttons.find((b) => b.callback_data === "v:save:draft_test_123");
    expect(saveBtn).toBeDefined();
    expect(saveBtn?.text).toBe("✅ Ya, Simpan");
  });
});

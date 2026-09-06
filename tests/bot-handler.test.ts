import { describe, it, expect } from "vitest";
import {
  buildDraftConfirmationKeyboard,
  buildEditSubmenuKeyboard,
} from "../src/core/telegram/keyboards.js";
import {
  escapeHtml,
  formatRupiah,
  renderSppgOrderDraftCard,
  renderSupplierExpenseDraftCard,
} from "../src/core/telegram/formatter.js";
import { createSppgBot } from "../src/core/telegram/bot-handler.js";
import { SPPGUnitConfig } from "../src/config/sppg.config.js";

describe("Telegram Bot Handler & Formatting Module", () => {
  const dummyUnit: SPPGUnitConfig = {
    id: "sppg_test",
    name: "SPPG Test Unit",
    token: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    spreadsheetId: "test_spreadsheet_id",
    driveFolderId: "test_folder_id",
    enabled: true,
  };

  it("should create Grammy bot instance with valid configuration", () => {
    const bot = createSppgBot(dummyUnit);
    expect(bot).toBeDefined();
    expect(bot.token).toBe(dummyUnit.token);
  });

  it("should build proper draft confirmation inline keyboards", () => {
    const draftId = "draft_xyz_123";
    const keyboard = buildDraftConfirmationKeyboard(draftId, "SPPG_ORDER");
    expect(keyboard).toBeDefined();
    expect(keyboard.inline_keyboard).toHaveLength(2); // row 1: save, row 2: edit & cancel

    const flatButtons = keyboard.inline_keyboard.flat();
    const callbacks = flatButtons.map((btn) => ("callback_data" in btn ? btn.callback_data : ""));

    expect(callbacks).toContain(`v:save:${draftId}`);
    expect(callbacks).toContain(`v:edit:${draftId}`);
    expect(callbacks).toContain(`v:cancel:${draftId}`);
  });

  it("should build edit submenu inline keyboard with back button", () => {
    const draftId = "draft_456";
    const keyboard = buildEditSubmenuKeyboard(draftId);
    const flatButtons = keyboard.inline_keyboard.flat();
    const callbacks = flatButtons.map((btn) => ("callback_data" in btn ? btn.callback_data : ""));

    expect(callbacks).toContain(`v:sub:nominal:${draftId}`);
    expect(callbacks).toContain(`v:sub:name:${draftId}`);
    expect(callbacks).toContain(`v:sub:back:${draftId}`);
  });

  it("should correctly escape HTML special characters for safe Telegram parsing", () => {
    const raw = `Bahan <Sayur & Buah>`;
    const escaped = escapeHtml(raw);
    expect(escaped).toBe("Bahan &lt;Sayur &amp; Buah&gt;");
  });

  it("should format number into Indonesian Rupiah (Rp)", () => {
    const cleanRp = (str: string) => str.replace(/\s+/g, " ");
    expect(cleanRp(formatRupiah(29581000))).toBe("Rp 29.581.000");
    expect(cleanRp(formatRupiah(0))).toBe("Rp 0");
    expect(cleanRp(formatRupiah(50000))).toBe("Rp 50.000");
  });

  it("should render SPPG order card cleanly with item details", () => {
    const card = renderSppgOrderDraftCard(
      {
        order_no: "05/02/09/26",
        arrival_date: "2026-09-02",
        sppg_unit: "SPPG Patila",
        total_amount: 29581000,
        items: [
          { item_name: "Beras Medium", qty: 150, unit: "kg", price: 13500, total_price: 2025000, supplier_target: "Hj Muliadi" },
          { item_name: "Daging Ayam", qty: 80, unit: "kg", price: 38000, total_price: 3040000, supplier_target: "Ayam Pasar" },
        ],
        signed_by: "Manajer SPPG",
      },
      "draft_order_1",
      "PENDING"
    );

    expect(card).toContain("DRAF NOTA PESANAN SPPG");
    expect(card).toContain("SPPG Patila");
    expect(card).toContain("05/02/09/26");
    expect(card).toContain("Beras Medium");
  });

  it("should render Supplier expense draft card cleanly", () => {
    const card = renderSupplierExpenseDraftCard(
      {
        supplier_name: "Hj. Muliadi (Beras)",
        date: "2026-09-02",
        total_amount: 15000000,
        payment_method: "TRANSFER",
        sppg_ref_no: "05/02/09/26",
        items: [
          { item_name: "Beras Medium 50kg", qty: 20, unit: "karung", price: 750000 },
        ],
        notes: "Lunas transfer BCA",
      },
      "draft_exp_1",
      "PENDING",
      "https://drive.google.com/file/d/dummy/view"
    );

    expect(card).toContain("DRAF BELANJA SUPPLIER");
    expect(card).toContain("Hj. Muliadi (Beras)");
    expect(card).toContain("Beras Medium 50kg");
    expect(card).toContain("Lihat Nota di Google Drive");
  });

  it("should build multi-sheet selector keyboard with all unit links", async () => {
    const { buildMultiSheetSelectorKeyboard } = await import("../src/core/telegram/keyboards.js");
    const keyboard = buildMultiSheetSelectorKeyboard("sppg_patila");
    expect(keyboard).toBeDefined();
    const flatButtons = keyboard.inline_keyboard.flat();
    const texts = flatButtons.map((btn) => btn.text);
    expect(texts.some((t) => t.includes("Patila"))).toBe(true);
    expect(texts.some((t) => t.includes("Master"))).toBe(true);
  });

  it("should render transaction list and detail cards cleanly", async () => {
    const { renderTransactionListCard, renderTransactionDetailCard } = await import("../src/core/telegram/formatter.js");
    const listCard = renderTransactionListCard([
      { id: "SUPP-EXP-001", date: "2026-09-05", title: "Ayam Potong", amount: 200000, type: "expense" },
    ]);
    expect(listCard).toContain("RIWAYAT TRANSAKSI TERAKHIR");
    expect(listCard).toContain("SUPP-EXP-001");
    expect(listCard).toContain("Ayam Potong");

    const detailCard = renderTransactionDetailCard({
      found: true,
      id: "SUPP-EXP-001",
      sheetName: "03_PENGELUARAN_SUPPLIER",
      type: "expense",
      date: "2026-09-05",
      supplierOrUnit: "Pasar Ayam",
      items: "Ayam Potong",
      amount: 200000,
      notes: "Cash",
    });
    expect(detailCard).toContain("DETAIL BELANJA SUPPLIER");
    expect(detailCard).toContain("Pasar Ayam");
    expect(detailCard).toContain("200.000");
  });

  it("should convert LLM markdown headers (###) and bullets (*) to Telegram HTML", async () => {
    const { cleanMarkdownToTelegramHtml } = await import("../src/core/telegram/formatter.js");

    const rawLlmOutput = [
      "### 🥗 1. Manajemen Operasional & Keuangan SPPG MBG",
      "Saya terintegrasi penuh untuk membantu efisiensi harian dapur dan pembukuan SPPG Anda:",
      "* Pencatatan Belanja Cepat: Cukup ketik transaksi harian secara natural, contoh:",
      "  Beli ayam 250rb di pasar ayam tunai atau Beli beras 50kg 700rb supplier Pak Budi.",
      "* Analisis Margin & Keuntungan: Ketik rekap atau margin untuk melihat rincian pagu/plafon pesanan.",
      "**Catatan Penting:** Dokumen resmi SPJ BGN.",
    ].join("\n");

    const cleaned = cleanMarkdownToTelegramHtml(rawLlmOutput);

    // MUST NOT contain markdown ###
    expect(cleaned).not.toContain("###");
    // MUST contain Telegram HTML bold
    expect(cleaned).toContain("<b>🥗 1. Manajemen Operasional & Keuangan SPPG MBG</b>");
    // MUST convert asterisks bullets to bullet symbol • with bold title
    expect(cleaned).toContain("• <b>Pencatatan Belanja Cepat:</b>");
    expect(cleaned).toContain("• <b>Analisis Margin & Keuntungan:</b>");
    // MUST convert **Catatan Penting:** to <b>Catatan Penting:</b>
    expect(cleaned).toContain("<b>Catatan Penting:</b>");
  });

  it("should build proper role-aware start quick action keyboards and invite role picker", async () => {
    const { buildStartQuickActionKeyboard, buildInviteRolePickerKeyboard } = await import("../src/core/telegram/keyboards.js");

    const adminKb = buildStartQuickActionKeyboard("admin");
    expect(adminKb.inline_keyboard.length).toBeGreaterThanOrEqual(3);
    const adminButtons = adminKb.inline_keyboard.flat().map((b: any) => b.text);
    expect(adminButtons).toContain("📊 Rekap Margin");
    expect(adminButtons).toContain("📄 Cetak SPJ");
    expect(adminButtons).toContain("🌐 Buka Sheets");
    expect(adminButtons).toContain("🔍 Riwayat Belanja");
    expect(adminButtons).toContain("🎟️ Undang Staf");
    expect(adminButtons).toContain("🆔 Cek Akun");

    const memberKb = buildStartQuickActionKeyboard("member");
    const memberButtons = memberKb.inline_keyboard.flat().map((b: any) => b.text);
    expect(memberButtons).toContain("✍️ Format Belanja");
    expect(memberButtons).toContain("🆔 Cek Akun");
    expect(memberButtons).toContain("💡 Tanya Menu & Gizi MBG");
    // Member keyboard MUST NOT contain admin-only buttons
    expect(memberButtons).not.toContain("📊 Rekap Margin");
    expect(memberButtons).not.toContain("📄 Cetak SPJ");
    expect(memberButtons).not.toContain("🌐 Buka Sheets");

    const inviteKb = buildInviteRolePickerKeyboard();
    const inviteButtons = inviteKb.inline_keyboard.flat().map((b: any) => b.text);
    expect(inviteButtons).toContain("👨‍💼 Undang Admin (Operator SPPG)");
    expect(inviteButtons).toContain("🧑‍🍳 Undang Member (Staf Belanja)");
    expect(inviteButtons).toContain("❌ Batalkan");
  });
});


import { InlineKeyboard } from "grammy";
import { env } from "../../config/env.js";
import type { PaguOrderSummary, PaguRincianItem } from "../google/sheets.service.js";

export function buildDraftConfirmationKeyboard(
  draftId: string,
  actionType: "SPPG_ORDER" | "SUPPLIER_EXPENSE",
  itemsCount?: number,
  hasMultiplePagu?: boolean
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (actionType === "SPPG_ORDER") {
    if (itemsCount && itemsCount > 0) {
      kb.text(`🔍 Lihat ${itemsCount} Rincian Bahan`, `v:viewitems:${draftId}`).row();
    }
    kb.text("✅ Ya, Simpan", `v:save:${draftId}`)
      .row()
      .text("✏️ Ubah", `v:edit:${draftId}`)
      .text("❌ Batal", `v:cancel:${draftId}`);
  } else {
    if (hasMultiplePagu) {
      kb.text("🔄 Pilih Alokasi Anggaran", `v:pagu_pick:${draftId}`).row();
    }
    kb.text("✅ Ya, Simpan", `v:save:${draftId}`)
      .row()
      .text("✏️ Ubah", `v:edit:${draftId}`)
      .text("❌ Batal", `v:cancel:${draftId}`);
  }
  return kb;
}

export function buildBackToDraftKeyboard(draftId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔙 Kembali ke Draf Ringkasan", `v:sub:back:${draftId}`)
    .row()
    .text("✅ Ya, Simpan", `v:save:${draftId}`);
}

export function buildEditSubmenuKeyboard(draftId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("💰 Ganti Total Nominal", `v:sub:nominal:${draftId}`)
    .text("🏪 Ganti Nama Toko/Unit", `v:sub:name:${draftId}`)
    .row()
    .text("📄 Ganti No Pagu", `v:sub:pagu:${draftId}`)
    .row()
    .text("🔙 Kembali ke Draf", `v:sub:back:${draftId}`);
}

export function buildPaguSelectorKeyboard(
  draftId: string,
  candidates: Array<{ sppg_ref_no: string; order_date: string; item_name: string; remaining_qty: number; unit: string; supplier_name: string }>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  candidates.slice(0, 5).forEach((c) => {
    const label = `📅 ${c.order_date || "Menu"} - Kurang ${c.remaining_qty} ${c.unit}`;
    kb.text(label, `v:pagu_set:${draftId}:${c.sppg_ref_no}`).row();
  });
  kb.text("🚫 Belanja Tambahan (Tanpa Pagu)", `v:pagu_set:${draftId}:-`).row();
  kb.text("🔙 Kembali ke Draf", `v:sub:back:${draftId}`);
  return kb;
}

export function buildPaguPromptKeyboard(
  draftId: string,
  candidates: Array<{ sppg_ref_no: string; order_date: string; item_name: string; remaining_qty: number; unit: string; supplier_name: string }>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  candidates.slice(0, 5).forEach((c) => {
    const dateLabel = c.order_date ? c.order_date.replace(/^\d{4}-/, "") : "Menu";
    const label = `📅 PO ${c.sppg_ref_no} (${dateLabel} - Sisa ${c.remaining_qty} ${c.unit})`;
    kb.text(label, `v:pagu_set:${draftId}:${c.sppg_ref_no}`).row();
  });
  kb.text("🚫 Belanja Tambahan (Non-Pagu)", `v:pagu_set:${draftId}:-`).row();
  kb.text("❌ Batalkan Draf", `v:cancel:${draftId}`);
  return kb;
}

export function buildCancelInputKeyboard(draftId: string): InlineKeyboard {
  return new InlineKeyboard().text("❌ Batalkan Koreksi", `v:sub:back:${draftId}`);
}

export function buildRekapActionKeyboard(sheetUrl: string, sppgId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("📄 Cetak PDF Resmi SPJ", `v:rekap:pdf:${sppgId}`)
    .url("🌐 Buka Google Sheets", sheetUrl);
}

/**
 * Multi-Unit Sheet Selector: Direct links to all spreadsheets
 */
export function buildMultiSheetSelectorKeyboard(currentUnitId?: string): InlineKeyboard {
  const patilaUrl = `https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID_PATILA}/edit`;
  const unit2Url = env.GOOGLE_SHEET_ID_UNIT2
    ? `https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID_UNIT2}/edit`
    : "";
  const unit3Url = env.GOOGLE_SHEET_ID_UNIT3
    ? `https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID_UNIT3}/edit`
    : "";
  const masterUrl = `https://docs.google.com/spreadsheets/d/${env.GOOGLE_SHEET_ID_MASTER}/edit`;

  const kb = new InlineKeyboard();

  kb.url("📊 SPPG Patila (Unit 1)", patilaUrl);
  if (unit2Url) {
    kb.row().url("🏢 SPPG Dapur Unit 2", unit2Url);
  }
  if (unit3Url) {
    kb.row().url("🏢 SPPG Dapur Unit 3", unit3Url);
  }
  kb.row().url("👑 Master Dashboard BGN", masterUrl);

  return kb;
}

/**
 * Keyboard for listing recent transactions with detail drill-down
 */
export function buildTransactionListKeyboard(
  transactions: Array<{ id: string; title: string; amount: number }>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const trx of transactions.slice(0, 5)) {
    const formattedAmt = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(trx.amount);
    kb.text(`🔍 ${trx.title.slice(0, 16)} (${formattedAmt})`, `v:trx:view:${trx.id}`).row();
  }
  return kb;
}

/**
 * Actions available on a specific transaction (Edit nominal, Delete, Back)
 */
export function buildTransactionDetailKeyboard(transactionId: string, sheetUrl?: string): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("✏️ Ubah Nominal", `v:trx:edit:${transactionId}`)
    .text("🗑️ Hapus Transaksi", `v:trx:del:${transactionId}`);

  if (sheetUrl) {
    kb.row().url("🌐 Lihat di Spreadsheet", sheetUrl);
  }
  kb.row().text("🔙 Kembali ke Daftar", "v:trx:list");
  return kb;
}

/**
 * Confirmation keyboard before permanent deletion
 */
export function buildDeleteConfirmKeyboard(transactionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑️ Ya, Hapus Sekarang", `v:trx:delyes:${transactionId}`)
    .text("❌ Batalkan", `v:trx:view:${transactionId}`);
}

/**
 * Confirmation keyboard before deleting a specific child item from Tab 05
 */
export function buildDeleteChildItemKeyboard(expenseId: string, itemIndex: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑️ Ya, Hapus Bahan", `v:delit_yes:${expenseId}:${itemIndex}`)
    .text("❌ Batalkan", `v:delit_no:${expenseId}`);
}

/**
 * Confirmation keyboard before applying an edit to Google Sheets
 */
export function buildEditConfirmKeyboard(transactionId: string, newAmount: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Terapkan Perubahan", `v:trx:applyedit:${transactionId}:${newAmount}`)
    .text("❌ Batalkan", `v:trx:view:${transactionId}`);
}

/**
 * Role-aware Start Quick Action Keyboard
 * Displayed on /start or welcome message for instant 1-tap operation
 */
export function buildStartQuickActionKeyboard(role: "super_admin" | "admin" | "member" = "admin"): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (role === "member") {
    kb.text("✍️ Format Belanja", "qa:format_belanja")
      .text("🆔 Cek Akun", "qa:myid")
      .row()
      .text("💡 Tanya Menu & Gizi MBG", "qa:tips_gizi");
  } else {
    kb.text("📊 Rekap Margin", "qa:rekap")
      .text("📄 Cetak SPJ", "qa:pdf")
      .row()
      .text("📋 Kelola Pagu / Rincian", "qa:pagu")
      .text("🔍 Riwayat Belanja", "qa:transaksi")
      .row()
      .text("🌐 Buka Sheets", "qa:sheets")
      .text("🎟️ Undang Staf", "qa:invite_prompt")
      .row()
      .text("🆔 Cek Akun", "qa:myid");
  }

  return kb;
}

/**
 * 1-Tap Invite Role Picker (Admin vs Member)
 */
export function buildInviteRolePickerKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("👨‍💼 Undang Admin (Operator SPPG)", "qa:geninvite:admin")
    .row()
    .text("🧑‍🍳 Undang Member (Staf Belanja)", "qa:geninvite:member")
    .row()
    .text("❌ Batalkan", "qa:invite_cancel");
}

/**
 * Lists active Pagu Orders for selection
 */
export function buildPaguOrderListKeyboard(orders: PaguOrderSummary[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const o of orders.slice(0, 8)) {
    const formattedAmt = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(o.totalAmount);
    const dateLabel = o.orderDate ? o.orderDate.replace(/^\d{4}-/, "") : "Menu";
    const idShort = o.transactionId ? o.transactionId.replace(/^SPPG\d+-/i, "") : "";
    const tag = idShort ? `[${idShort}] ` : "";
    kb.text(`📅 ${tag}PO ${o.orderNo} (${dateLabel} - ${formattedAmt})`, `v:pagu_ord:${o.orderNo}`).row();
  }
  kb.text("🔙 Kembali ke Menu Utama", "qa:start");
  return kb;
}

/**
 * Lists paginated ingredients in a Pagu Order
 */
export function buildPaguItemListKeyboard(
  orderNo: string,
  items: PaguRincianItem[],
  page = 0,
  pageSize = 6
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const startIdx = page * pageSize;
  const pageItems = items.slice(startIdx, startIdx + pageSize);

  for (const it of pageItems) {
    const formattedPrice = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(it.price);
    const label = `${it.itemIndex}. ${it.itemName} (${it.qty} ${it.unit} @ ${formattedPrice})`;
    kb.text(label.slice(0, 38), `v:pagu_it:${orderNo}:${it.rowIndex}`).row();
  }

  // Pagination navigation row
  const navRow: { text: string; data: string }[] = [];
  if (page > 0) {
    navRow.push({ text: "⬅️ Sebelumnya", data: `v:pagu_page:${orderNo}:${page - 1}` });
  }
  if (startIdx + pageSize < items.length) {
    navRow.push({ text: "Berikutnya ➡️", data: `v:pagu_page:${orderNo}:${page + 1}` });
  }

  if (navRow.length > 0) {
    navRow.forEach((btn) => kb.text(btn.text, btn.data));
    kb.row();
  }

  kb.text("➕ Tambah Bahan Baru di PO Ini", `v:pagu_add:${orderNo}`).row();
  kb.text("🔙 Kembali ke Daftar PO", "v:pagu_orders");
  return kb;
}

/**
 * Action choices for a specific Pagu item (Qty, Price, Supplier)
 */
export function buildPaguItemActionKeyboard(
  orderNo: string,
  rowIndex: number,
  itemName: string
): InlineKeyboard {
  return new InlineKeyboard()
    .text("📝 Ubah Uraian Bahan", `v:pagu_act:${orderNo}:${rowIndex}:name`)
    .row()
    .text("✏️ Ubah Kuantitas", `v:pagu_act:${orderNo}:${rowIndex}:qty`)
    .text("💰 Ubah Harga Pagu", `v:pagu_act:${orderNo}:${rowIndex}:price`)
    .row()
    .text("🏪 Ubah Target Rekanan", `v:pagu_act:${orderNo}:${rowIndex}:supplier`)
    .row()
    .text("🔙 Kembali ke Rincian Bahan", `v:pagu_ord:${orderNo}`);
}

/**
 * Confirmation keyboard before executing Pagu item update
 */
export function buildPaguItemEditConfirmKeyboard(
  orderNo: string,
  rowIndex: number,
  field: string,
  newValue: string
): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Terapkan Perubahan", `v:pagu_apply:${orderNo}:${rowIndex}:${field}:${encodeURIComponent(newValue)}`)
    .row()
    .text("❌ Batalkan", `v:pagu_it:${orderNo}:${rowIndex}`);
}

/**
 * 1-Shot Conversational Pagu Modification: Immediate confirm keyboard
 */
export function buildPaguOneShotConfirmKeyboard(draftId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Ya, Terapkan ke Spreadsheet", `v:p1s_ok:${draftId}`)
    .row()
    .text("❌ Batalkan", `v:p1s_c:${draftId}`);
}

/**
 * 1-Shot Conversational: Smart clarification when item is not in order
 */
export function buildPaguClarifyAddOrReplaceKeyboard(draftId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Tambah Sebagai Bahan Baru", `v:p1s_add:${draftId}`)
    .row()
    .text("🔄 Ganti Bahan yang Sudah Ada", `v:p1s_rep:${draftId}:0`)
    .row()
    .text("❌ Batalkan", `v:p1s_c:${draftId}`);
}

/**
 * 1-Shot Conversational: List existing items for user to choose which one to replace
 */
export function buildPaguItemPickForReplaceKeyboard(
  draftId: string,
  items: PaguRincianItem[],
  page = 0,
  pageSize = 5
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const startIdx = page * pageSize;
  const pageItems = items.slice(startIdx, startIdx + pageSize);

  for (const it of pageItems) {
    const formattedPrice = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(it.price);
    const label = `${it.itemIndex}. ${it.itemName} (${it.qty} ${it.unit} @ ${formattedPrice})`;
    kb.text(label.slice(0, 38), `v:p1s_pk:${draftId}:${it.rowIndex}`).row();
  }

  // Navigation row if pagination needed
  const navRow: { text: string; data: string }[] = [];
  if (page > 0) {
    navRow.push({ text: "⬅️ Sebelumnya", data: `v:p1s_rep:${draftId}:${page - 1}` });
  }
  if (startIdx + pageSize < items.length) {
    navRow.push({ text: "Berikutnya ➡️", data: `v:p1s_rep:${draftId}:${page + 1}` });
  }
  if (navRow.length > 0) {
    navRow.forEach((btn) => kb.text(btn.text, btn.data));
    kb.row();
  }

  kb.text("❌ Batalkan", `v:p1s_c:${draftId}`);
  return kb;
}

/**
 * 1-Shot Conversational: Unbudgeted expense item options (Non-Pagu vs Register to Pagu First)
 */
export function buildUnbudgetedExpenseKeyboard(draftId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("📦 Simpan sbg Belanja Non-Pagu", `v:p1s_np:${draftId}`)
    .row()
    .text("➕ Daftarkan ke Pagu Anggaran Dulu", `v:p1s_regp:${draftId}`)
    .row()
    .text("❌ Batalkan", `v:p1s_c:${draftId}`);
}

/**
 * 1-Shot Conversational: Quick pagu ceiling price picker
 */
export function buildPaguPricePickerKeyboard(draftId: string, basePrice: number): InlineKeyboard {
  const p10 = Math.round(basePrice * 1.1);
  const p15 = Math.round(basePrice * 1.15);
  const fmt = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

  return new InlineKeyboard()
    .text(`💡 Sama dg Beli (${fmt(basePrice)})`, `v:p1s_sp:${draftId}:${basePrice}`)
    .row()
    .text(`📈 Plafon +10% (${fmt(p10)})`, `v:p1s_sp:${draftId}:${p10}`)
    .row()
    .text(`📈 Plafon +15% (${fmt(p15)})`, `v:p1s_sp:${draftId}:${p15}`)
    .row()
    .text("❌ Batalkan", `v:p1s_c:${draftId}`);
}



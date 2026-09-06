import { InlineKeyboard } from "grammy";
import { env } from "../../config/env.js";

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
      .text("🌐 Buka Sheets", "qa:sheets")
      .text("🔍 Riwayat Belanja", "qa:transaksi")
      .row()
      .text("🎟️ Undang Staf", "qa:invite_prompt")
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


import { InlineKeyboard } from "grammy";
import { env } from "../../config/env.js";

export function buildDraftConfirmationKeyboard(draftId: string, actionType: "SPPG_ORDER" | "SUPPLIER_EXPENSE"): InlineKeyboard {
  const saveLabel = actionType === "SPPG_ORDER" ? "✅ Simpan Pendapatan" : "✅ Simpan Pengeluaran";
  return new InlineKeyboard()
    .text(saveLabel, `v:save:${draftId}`)
    .text("✏️ Koreksi Draf", `v:edit:${draftId}`)
    .row()
    .text("❌ Batalkan Draf", `v:cancel:${draftId}`);
}

export function buildEditSubmenuKeyboard(draftId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("💰 Ganti Total Nominal", `v:sub:nominal:${draftId}`)
    .text("🏪 Ganti Nama Toko/Unit", `v:sub:name:${draftId}`)
    .row()
    .text("🔙 Kembali ke Draf", `v:sub:back:${draftId}`);
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


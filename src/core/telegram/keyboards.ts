import { InlineKeyboard } from "grammy";

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

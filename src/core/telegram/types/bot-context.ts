import { Bot, Context } from "grammy";
import { SPPGUnitConfig } from "../../../config/sppg.config.js";
import { SupabaseClient } from "@supabase/supabase-js";
import { UserRepository } from "../../db/repositories/user.repository.js";
import { PendingActionRepository } from "../../db/repositories/pending-action.repository.js";
import { escapeHtml, formatRupiah } from "../formatter.js";

export interface PaguOneShotDraft {
  draftId: string;
  spreadsheetId: string;
  orderNo: string;
  orderLabel?: string;
  action: "UPDATE" | "ADD";
  isExpense?: boolean;
  expenseId?: string;
  isUnbudgeted?: boolean;
  isNonPagu?: boolean;
  matchedPaguItem?: any;
  paguPrice?: number;
  itemRowIndex?: number;
  origItemName?: string;
  supplier?: string;
  itemName: string;
  qty: number;
  unit: string;
  price: number;
  oldQty?: number;
  oldPrice?: number;
  oldSupplier?: string;
  updatedBy: string;
  createdAt: number;
}

export const pendingPaguModifications = new Map<string, PaguOneShotDraft>();

export function renderPaguOneShotCard(draft: PaguOneShotDraft, unitName: string): string {
  const newSubtotal = draft.qty * draft.price;

  if (draft.isExpense) {
    if (draft.isUnbudgeted) {
      return [
        `⚠️ <b>BAHAN BELUM TERDAFTAR DI PAGU RESMI BGN</b>`,
        `Unit: <b>${escapeHtml(unitName)}</b>`,
        draft.orderNo && draft.orderNo !== "-" ? `PO Terkait: <code>${escapeHtml(draft.orderNo)}</code>` : "",
        `------------------------------------------`,
        `• <b>Transaksi Belanja:</b> <code>${escapeHtml(draft.orderLabel || draft.expenseId || draft.orderNo)}</code>`,
        `• <b>Bahan Belanja:</b> <b>${escapeHtml(draft.itemName)}</b>`,
        `• <b>Kuantitas:</b> <b>${draft.qty} ${escapeHtml(draft.unit)}</b>`,
        `• <b>Harga Satuan:</b> <b>${formatRupiah(draft.price)}</b>`,
        `• <b>Total Belanja:</b> <b>${formatRupiah(newSubtotal)}</b>`,
        draft.supplier ? `• <b>Supplier:</b> <b>${escapeHtml(draft.supplier)}</b>` : "",
        `------------------------------------------`,
        `⚠️ <b>PERHATIAN:</b> Bahan "<b>${escapeHtml(draft.itemName)}</b>" <u>TIDAK DITEMUKAN</u> dalam daftar pagu resmi PO <code>${escapeHtml(draft.orderNo)}</code>.`,
        ``,
        `💡 <i>Jika disimpan sebagai <b>Non-Pagu</b>, biaya ini memotong margin keuntungan dapur SPPG karena tidak dapat ditagihkan resmi ke BGN.</i>`,
        `💡 <i>Atau Anda dapat <b>mendaftarkannya ke Pagu</b> terlebih dahulu agar memiliki plafon resmi BGN dan dapat di-SPJ-kan.</i>`,
        ``,
        `Pilih perlakuan untuk bahan ini:`,
      ].filter(Boolean).join("\n");
    }

    return [
      `📋 <b>KONFIRMASI PENAMBAHAN RINCIAN BELANJA (PENGELUARAN)</b>`,
      `Unit: <b>${escapeHtml(unitName)}</b>`,
      draft.orderNo && draft.orderNo !== "-" ? `PO Terkait: <code>${escapeHtml(draft.orderNo)}</code>` : "",
      `------------------------------------------`,
      `• <b>Transaksi Belanja:</b> <code>${escapeHtml(draft.orderLabel || draft.expenseId || draft.orderNo)}</code>`,
      `• <b>Bahan Belanja:</b> <b>${escapeHtml(draft.itemName)}</b>`,
      `• <b>Kuantitas:</b> <b>${draft.qty} ${escapeHtml(draft.unit)}</b>`,
      `• <b>Harga Satuan:</b> <b>${formatRupiah(draft.price)}</b>`,
      `• <b>Total Belanja:</b> <b>${formatRupiah(newSubtotal)}</b>`,
      draft.supplier ? `• <b>Supplier:</b> <b>${escapeHtml(draft.supplier)}</b>` : "",
      `------------------------------------------`,
      `📍 <i>Bahan akan disisipkan rapi mengelompok di bawah transaksi ${escapeHtml(draft.expenseId || draft.orderNo)} pada Tab 05 (baris di bawahnya bergeser otomatis).</i>`,
      `📈 <i>Total nominal tagihan di Tab 04_PAGU_PENGELUARAN otomatis terakumulasi.</i>`,
      ``,
      `Apakah Anda ingin menulis rincian belanja ini ke spreadsheet?`,
    ].filter(Boolean).join("\n");
  }

  if (draft.action === "UPDATE") {
    const oldSubtotal = (draft.oldQty || 0) * (draft.oldPrice || 0);
    const subtotalDiff = newSubtotal - oldSubtotal;
    const diffSign = subtotalDiff > 0 ? `+${formatRupiah(subtotalDiff)}` : `${formatRupiah(subtotalDiff)}`;
    return [
      `📋 <b>KONFIRMASI PERUBAHAN PAGU BAHAN (1-SHOT)</b>`,
      `Unit: <b>${escapeHtml(unitName)}</b>`,
      `------------------------------------------`,
      `• <b>Surat Pesanan:</b> <code>${escapeHtml(draft.orderLabel || draft.orderNo)}</code>`,
      `• <b>Bahan:</b> <b>${escapeHtml(draft.itemName)}</b>`,
      `------------------------------------------`,
      `<b>DATA LAMA:</b>`,
      `• Kuantitas: ${draft.oldQty || "-"} ${escapeHtml(draft.unit)} @ ${formatRupiah(draft.oldPrice || 0)}`,
      `• Subtotal: ${formatRupiah(oldSubtotal)}`,
      draft.oldSupplier ? `• Rekanan: ${escapeHtml(draft.oldSupplier)}` : "",
      ``,
      `<b>DATA BARU:</b>`,
      `• Kuantitas: <b>${draft.qty} ${escapeHtml(draft.unit)}</b> @ <b>${formatRupiah(draft.price)}</b>`,
      `• Subtotal: <b>${formatRupiah(newSubtotal)}</b> <i>(${diffSign})</i>`,
      draft.supplier ? `• Rekanan: <b>${escapeHtml(draft.supplier)}</b>` : "",
      `------------------------------------------`,
      `🔄 <i>Tab 03_RINCIAN_PENDAPATAN dan Tab 06_PERBANDINGAN_MARGIN akan otomatis disinkronkan.</i>`,
      `Apakah perubahan ini sudah sesuai dan siap ditulis ke spreadsheet?`,
    ].filter(Boolean).join("\n");
  } else {
    return [
      `📋 <b>KONFIRMASI PENAMBAHAN BAHAN BARU KE PAGU</b>`,
      `Unit: <b>${escapeHtml(unitName)}</b>`,
      `------------------------------------------`,
      `• <b>Surat Pesanan:</b> <code>${escapeHtml(draft.orderLabel || draft.orderNo)}</code>`,
      `• <b>Bahan Baru:</b> <b>${escapeHtml(draft.itemName)}</b>`,
      `• <b>Kuantitas:</b> <b>${draft.qty} ${escapeHtml(draft.unit)}</b>`,
      `• <b>Harga Satuan:</b> <b>${formatRupiah(draft.price)}</b>`,
      `• <b>Total Pagu Bahan:</b> <b>${formatRupiah(newSubtotal)}</b>`,
      draft.supplier ? `• <b>Target Rekanan:</b> <b>${escapeHtml(draft.supplier)}</b>` : `• <b>Target Rekanan:</b> Lainnya`,
      `------------------------------------------`,
      `📍 <i>Bahan baru akan disisipkan di posisi paling bawah pesanan ini (baris pesanan lain di bawahnya bergeser otomatis).</i>`,
      `📈 <i>Tab 03_RINCIAN_PENDAPATAN dan Tab 06_PERBANDINGAN_MARGIN akan disinkronkan, serta total anggaran Tab 02 bertambah.</i>`,
      ``,
      `Apakah Anda ingin menulis bahan baru ini ke spreadsheet?`,
    ].filter(Boolean).join("\n");
  }
}

export interface UserInteractionState {
  activeDraftId?: string;
  activeDraftMsgId?: number;
  activeQuickActionMsgId?: number;
  editingField?: "nominal" | "name" | "pagu" | null;
  editingTransactionId?: string;
  promptMsgId?: number;
  editingPagu?: {
    orderNo: string;
    rowIndex: number;
    field: "qty" | "price" | "supplier" | "name";
    itemName: string;
    unit: string;
  } | null;
  addingPaguItemToOrder?: {
    orderNo: string;
  } | null;
}

export interface BotContext {
  bot: Bot<Context>;
  unitConfig: SPPGUnitConfig;
  supabase: SupabaseClient;
  userRepo: UserRepository;
  pendingRepo: PendingActionRepository;
  userStates: Map<number, UserInteractionState>;
  activeKeyboardMessages: Map<number, Set<number>>;
  trackKeyboardMessage: (chatId: number, msgId: number) => void;
  clearAllActiveKeyboards: (chatId?: number) => Promise<void>;
  getState: (userId: number) => UserInteractionState;
  withTyping: <T>(ctx: Context, action: () => Promise<T>) => Promise<T>;
  isCallerMember: (userId?: number) => Promise<boolean>;
  notifyMemberRestricted: (ctx: Context, featureDesc: string) => Promise<void>;
  safeReplyHtml: (ctx: Context, text: string, reply_markup?: any) => Promise<any>;
  clearObsoleteKeyboards: (ctx: Context, state?: UserInteractionState) => Promise<void>;
  sendSheets: (ctx: Context) => Promise<void>;
  sendRekap: (ctx: Context) => Promise<void>;
  sendPdf: (ctx: Context, explicitOrderNo?: string) => Promise<void>;
  sendRecentTransactions: (ctx: Context, limit?: number) => Promise<void>;
  sendTransactionDetail: (ctx: Context, transactionId: string) => Promise<void>;
  sendPaguOrders: (ctx: Context) => Promise<void>;
}

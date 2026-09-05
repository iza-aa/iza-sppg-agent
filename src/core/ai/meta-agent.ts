import { geminiKeyManager } from "./gemini-client.js";
import { parseTransactionFromText, ParsedTextTransaction } from "./parsers/text-transaction.parser.js";
import { logger } from "../utils/logger.js";

export type MetaAgentIntent =
  | { type: "GET_REKAP" }
  | { type: "GET_PDF" }
  | { type: "GET_SHEETS" }
  | { type: "GET_MY_ID" }
  | { type: "LIST_TRANSACTIONS"; limit?: number }
  | { type: "DETAIL_TRANSACTION"; transactionId: string }
  | { type: "DELETE_TRANSACTION"; transactionId: string }
  | { type: "EDIT_TRANSACTION"; transactionId: string; newAmount?: number; newSupplier?: string }
  | { type: "INVITE"; name: string; role: "super_admin" | "admin" | "member" }
  | { type: "RECORD_TRANSACTION"; parsed: ParsedTextTransaction }
  | { type: "GENERAL_CHAT"; reply: string };

export class MetaAgent {
  /**
   * Classifies user intent from natural language message
   */
  async classifyAndRoute(
    userText: string,
    sppgUnitName = "SPPG Patila"
  ): Promise<MetaAgentIntent> {
    const text = userText.trim();
    const lower = text.toLowerCase();

    // =========================================================================
    // 1. FAST-PATH HEURISTICS (Sub-millisecond instant matching)
    // =========================================================================

    // Rekap / Margin / KPI
    if (
      lower === "rekap" ||
      lower === "rekap harian" ||
      lower === "rekap hari ini" ||
      lower === "margin" ||
      lower === "keuangan" ||
      lower.includes("rekap hari ini") ||
      lower.includes("margin hari ini") ||
      lower.includes("sisa margin")
    ) {
      return { type: "GET_REKAP" };
    }

    // PDF / Cetak SPJ
    if (
      lower === "pdf" ||
      lower === "cetak pdf" ||
      lower === "unduh pdf" ||
      lower === "cetak spj" ||
      lower === "laporan spj" ||
      lower.includes("kirim pdf") ||
      lower.includes("cetak laporan") ||
      lower.includes("dokumen spj")
    ) {
      return { type: "GET_PDF" };
    }

    // Google Sheets
    if (
      lower === "sheets" ||
      lower === "sheet" ||
      lower === "spreadsheet" ||
      lower === "link sheet" ||
      lower === "buka sheet" ||
      lower === "excel" ||
      lower.includes("buka spreadsheet") ||
      lower.includes("link spreadsheet") ||
      lower.includes("lihat tabel")
    ) {
      return { type: "GET_SHEETS" };
    }

    // User ID / My ID
    if (
      lower === "myid" ||
      lower === "id saya" ||
      lower === "siapa saya" ||
      lower === "status akun" ||
      lower === "cek id" ||
      lower === "cek akses"
    ) {
      return { type: "GET_MY_ID" };
    }

    // Detail Transaction: e.g. "detail SUPP-EXP-..." or "lihat SUPP-EXP-..."
    const detailMatch = text.match(/\b(?:detail|lihat|cek)\s+([A-Z0-9_-]{8,35})\b/i);
    if (detailMatch) {
      return { type: "DETAIL_TRANSACTION", transactionId: detailMatch[1] };
    }

    // Delete Transaction: e.g. "hapus SUPP-EXP-..." or "batalkan SUPP-EXP-..."
    const deleteMatch = text.match(/\b(?:hapus|delete|batal(?:kan)?)\s+([A-Z0-9_-]{8,35})\b/i);
    if (deleteMatch) {
      return { type: "DELETE_TRANSACTION", transactionId: deleteMatch[1] };
    }

    // Edit Transaction: e.g. "edit SUPP-EXP-... nominal 500000" or "ubah SUPP-EXP-... jadi 500rb"
    const editMatch = text.match(/\b(?:edit|ubah|ganti)\s+([A-Z0-9_-]{8,35})(.*)/i);
    if (editMatch) {
      const transactionId = editMatch[1];
      const rest = editMatch[2] || "";
      const nominalMatch = rest.match(/(\d+(?:[.,]\d+)?\s*(?:rb|k|ribu|jt|juta)?|\d{5,})/i);
      let newAmount: number | undefined;
      if (nominalMatch) {
        const raw = nominalMatch[1].toLowerCase().trim();
        if (raw.includes("jt") || raw.includes("juta")) {
          const cleanFloat = parseFloat(raw.replace(/,/g, ".").replace(/[^\d.]/g, ""));
          newAmount = Math.round(cleanFloat * 1000000);
        } else if (raw.includes("rb") || raw.includes("ribu") || raw.includes("k")) {
          const cleanFloat = parseFloat(raw.replace(/,/g, ".").replace(/[^\d.]/g, ""));
          newAmount = Math.round(cleanFloat * 1000);
        } else {
          newAmount = parseInt(raw.replace(/[^\d]/g, ""), 10);
        }
      }

      return { type: "EDIT_TRANSACTION", transactionId, newAmount };
    }

    // List Transactions
    if (
      lower === "transaksi" ||
      lower === "riwayat" ||
      lower === "daftar belanja" ||
      lower.includes("transaksi terakhir") ||
      lower.includes("daftar transaksi") ||
      lower.includes("riwayat belanja") ||
      /\b\d+\s+transaksi\b/i.test(lower)
    ) {
      const matchLimit = text.match(/(\d+)\s+transaksi/i);
      const limit = matchLimit ? parseInt(matchLimit[1], 10) : 8;
      return { type: "LIST_TRANSACTIONS", limit };
    }

    // Invite: e.g. "undang Ayah admin" or "buat link untuk Budi"
    const inviteMatch = text.match(/\b(?:undang|invite|tambah\s+operator)\s+([a-zA-Z0-9_]+)(?:\s+(admin|member|super_admin))?/i);
    if (inviteMatch) {
      const name = inviteMatch[1];
      const role = (inviteMatch[2]?.toLowerCase() || "admin") as "super_admin" | "admin" | "member";
      return { type: "INVITE", name, role };
    }

    // =========================================================================
    // 2. CHECK FOR NATURAL FINANCIAL LOGGING ("beli ayam 200rb", "catat pesanan")
    // =========================================================================
    const hasFinancialKeywords = /\b(beli|belanja|bayar|pesan(?:an)?|nota|pagu|plafon|supplier|struk|bon|kg|ekor|jerigen|rb|ribu|jt|juta|rp|\d{4,})\b/i.test(
      text
    );

    if (hasFinancialKeywords) {
      try {
        const parsed = await parseTransactionFromText(text, sppgUnitName);
        if (parsed) {
          return { type: "RECORD_TRANSACTION", parsed };
        }
      } catch (err) {
        logger.warn({ err }, "Could not parse text as transaction");
      }
    }

    // =========================================================================
    // 3. FALLBACK: GENERAL CONVERSATIONAL AI PERSONA (BGN SPPG Specialist)
    // =========================================================================
    return await this.generateConversationalReply(text, sppgUnitName);
  }

  private async generateConversationalReply(
    userText: string,
    sppgUnitName: string
  ): Promise<MetaAgentIntent> {
    try {
      const reply = await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: `Anda adalah Asisten Cerdas Operasional SPPG MBG Badan Gizi Nasional (BGN) untuk ${sppgUnitName}.
Sikap Anda ramah, sigap, solutif, dan profesional.
Bantu pengguna mengoperasikan sistem pencatatan keuangan SPPG:
1. Bisa mencatat pengeluaran belanja pasar cukup dengan mengetik (contoh: "Tadi beli ayam 200rb di pasar ayam tunai").
2. Bisa mencatat nota pesanan SPPG (plafon pendapatan).
3. Bisa meminta "rekap", "cetak pdf", "buka spreadsheet", atau "10 transaksi terakhir".
Jawab dengan singkat, padat, dan gunakan format teks tebal/miring rapi.`,
        });

        const res = await model.generateContent(userText);
        return res.response.text();
      });

      return { type: "GENERAL_CHAT", reply };
    } catch {
      return {
        type: "GENERAL_CHAT",
        reply: `Halo! Saya Asisten MBG untuk <b>${sppgUnitName}</b>.\n\nAnda dapat:\n• ✍️ <b>Ketik belanjaan</b>: <i>"Beli beras 2 karung 700rb di Hj Muliadi tunai"</i>\n• 📸 <b>Kirim foto nota</b> pesanan SPPG atau struk pasar.\n• 📊 Ketik <i>"rekap"</i> untuk ringkasan margin laba.\n• 📄 Ketik <i>"cetak pdf"</i> untuk laporan resmi SPJ BGN.\n• 🌐 Ketik <i>"buka sheets"</i> untuk membuka spreadsheet online.`,
      };
    }
  }
}

export const metaAgent = new MetaAgent();

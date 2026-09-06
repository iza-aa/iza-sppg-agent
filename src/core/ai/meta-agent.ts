import { agyConnector } from "./agy-connector.js";
import { staticConversationalReply } from "./static-fallback.js";
import { parseTransactionFromText, ParsedTextTransaction } from "./parsers/text-transaction.parser.js";
import { cleanMarkdownToTelegramHtml } from "../telegram/formatter.js";
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
    sppgUnitName = "SPPG BGN",
    userName = "Bapak/Ibu"
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

    // Detail Transaction: e.g. "detail EI002", "cek EI002", "lihat SPPG0126-EI002", "rincian EI002", or standalone code "EI002"
    const detailPrefixMatch = text.match(/\b(?:detail|lihat|cek|rincian|buka|info)\s+(?:data\s+)?(?:untuk\s+)?(?:kode\s+)?(?:transaksi\s+|nota\s+)?([A-Za-z0-9_-]{3,35})\b/i);
    const standaloneCodeMatch = text.trim().match(/^(?:SPPG\d*[-_])?(?:[EI][A-Z]|TRX)\d+$/i);
    const specificIdInText = text.match(/\b((?:SPPG\d*[-_])?(?:[EI][A-Z]|TRX)\d+)\b/i);

    if (detailPrefixMatch) {
      return { type: "DETAIL_TRANSACTION", transactionId: detailPrefixMatch[1] };
    }
    if (standaloneCodeMatch) {
      return { type: "DETAIL_TRANSACTION", transactionId: standaloneCodeMatch[0] };
    }
    const isExplicitRecord = /\b(catat|simpan|input|masukkan|rekam|tulis)\b/i.test(text);
    if (specificIdInText && !isExplicitRecord) {
      return { type: "DETAIL_TRANSACTION", transactionId: specificIdInText[1] };
    }

    // Delete Transaction: e.g. "hapus EI002" or "batalkan EI002"
    const deleteMatch = text.match(/\b(?:hapus|delete|batal(?:kan)?)\s+(?:transaksi\s+|nota\s+)?([A-Za-z0-9_-]{3,35})\b/i);
    if (deleteMatch) {
      return { type: "DELETE_TRANSACTION", transactionId: deleteMatch[1] };
    }

    // Edit Transaction: e.g. "edit EI002 nominal 500000" or "ubah EI002 jadi 500rb"
    const editMatch = text.match(/\b(?:edit|ubah|ganti)\s+(?:transaksi\s+|nota\s+)?([A-Za-z0-9_-]{3,35})(.*)/i);
    if (editMatch) {
      const transactionId = editMatch[1];
      const rest = editMatch[2] || "";
      const nominalMatch = rest.match(/(\d+(?:[.,]\d+)?\s*(?:rb|k|ribu|jt|juta)?|\d{4,})/i);
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

    // Invite: e.g. "undang admin", "invite admin", "buat link undangan", "undang Budi admin"
    const inviteMatch = text.match(/\b(?:undang|invite|tambah\s+operator)\b(?:\s+([a-zA-Z0-9_]+))?(?:\s+(admin|member|super_admin))?/i);
    if (inviteMatch) {
      let role: "super_admin" | "admin" | "member" = "admin";
      let name = "";
      const p1 = (inviteMatch[1] || "").toLowerCase();
      const p2 = (inviteMatch[2] || "").toLowerCase();

      if (p1 === "admin" || p1 === "member" || p1 === "super_admin") {
        role = p1 as any;
      } else if (p2 === "admin" || p2 === "member" || p2 === "super_admin") {
        role = p2 as any;
        name = inviteMatch[1];
      } else if (inviteMatch[1]) {
        name = inviteMatch[1];
      }
      return { type: "INVITE", name, role };
    }

    // =========================================================================
    // 2. CHECK FOR NATURAL FINANCIAL LOGGING ("beli ayam 200rb", "catat pesanan")
    // =========================================================================
    const isQuestionOrInquiry =
      /\?$/.test(text) ||
      /^(apa|apakah|siapa|kenapa|mengapa|bagaimana|gimana|kapan|resep|tips|menu|cerita(?:kan)?|tolong jelaskan|jelaskan|hitung(?:kan)?|bisa\s+(?:jelaskan|bantu|jawab))\b/i.test(
        text
      );

    const isExplicitRecordCommand = /\b(catat|simpan|input|masukkan|rekam|tulis)\b/i.test(text);

    // Only attempt transaction parsing if it is NOT an inquisitive question, OR user explicitly says "catat..."
    const hasFinancialKeywords =
      (!isQuestionOrInquiry || isExplicitRecordCommand) &&
      /\b(beli|belanja|bayar|pesan(?:an)?|nota|pagu|plafon|supplier|struk|bon|kg|ekor|jerigen|rb|ribu|jt|juta|rp|\d{4,})\b/i.test(
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
    // 3. TRUE AI CONVERSATIONAL ENGINE (Universal Intelligence & BGN Specialist)
    // =========================================================================
    return await this.generateConversationalReply(text, sppgUnitName, userName);
  }

  private async generateConversationalReply(
    userText: string,
    sppgUnitName: string,
    userName = "Bapak/Ibu"
  ): Promise<MetaAgentIntent> {
    const systemInstruction = `Anda adalah True AI Assistant yang sangat cerdas, berwawasan luas, ramah, santun, dan solutif untuk unit operasional ${sppgUnitName} (Program Makanan Bergizi Gratis - Badan Gizi Nasional).
Pengguna yang sedang berbicara dengan Anda adalah: ${userName}.
Sapa dan panggil beliau secara santun dan akrab dengan sebutan "${userName}" (misalnya: "Halo ${userName}", "Baik ${userName}", atau gunakan sapaan yang sesuai).

Prinsip Utama:
1. Anda adalah TRUE AI: Anda mampu dan bersedia menjawab APAPUN yang dikatakan, ditanyakan, atau didiskusikan oleh pengguna dengan tuntas, cerdas, dan memuaskan.
2. Cakupan Pengetahuan:
   - Menjawab pertanyaan umum, sains, resep masakan MBG bergizi, porsi makan anak sekolah, tips bahan pangan, matematika/hitungan, obrolan santai, hingga saran operasional.
   - Paham menyeluruh tentang operasional SPPG MBG Badan Gizi Nasional: plafon/pagu pesanan, belanja riil pasar, rekanan supplier, margin keuntungan, dan SPJ.
3. Fitur Sistem:
   - Jika pengguna ingin mencatat belanja, mereka cukup mengetik (misal: "Beli ayam 250rb di pasar ayam tunai").
   - Jika ingin melihat ringkasan keuntungan, ketik "rekap" atau "margin".
   - Jika ingin dokumen SPJ resmi, ketik "cetak pdf".
   - Jika ingin membuka spreadsheet, ketik "buka sheets".
4. ATURAN FORMATTING TELEGRAM (SANGAT PENTING):
   - DILARANG KERAS menggunakan markdown header ("###", "##", "#"). Telegram tidak mendukung header markdown dan akan terlihat kotor/rusak di chat!
   - Gunakan format HTML Telegram resmi:
     • Gunakan <b>teks tebal</b> untuk judul atau penekanan (JANGAN gunakan ### atau **).
     • Gunakan simbol bullet "• " untuk poin-poin daftar (JANGAN gunakan tanda bintang * atau -).
     • Gunakan <code>kode/perintah</code> untuk contoh format belanjaan atau teks yang bisa disalin.
     • Gunakan <i>miring</i> untuk istilah teknis atau catatan tambahan.
   - JANGAN PERNAH menolak pertanyaan pengguna atau mengatakan "saya hanya bot keuangan". Jawablah segala hal yang ditanyakan pengguna dengan bijak dan tuntas!
5. INTEGRITAS DATA KEUANGAN (ANTI-HALUSINASI SANGAT KETAT):
   - DILARANG KERAS mengarang, mereka-reka, atau berhalusinasi rincian transaksi, nomor nota, nominal belanja, maupun nama supplier jika Anda tidak memegang data aslinya dari Google Sheets!
   - Jika pengguna menanyakan status atau rincian transaksi tertentu, jangan mengarang data fiktif! Arahkan pengguna dengan sopan untuk mengetik "transaksi" atau menekan tombol [🔍 Riwayat Belanja] agar data asli ditarik langsung dari Google Sheets.`;

    try {
      const reply = await agyConnector.executeConversation(systemInstruction, userText, sppgUnitName);
      return { type: "GENERAL_CHAT", reply: cleanMarkdownToTelegramHtml(reply) };
    } catch {
      return {
        type: "GENERAL_CHAT",
        reply: cleanMarkdownToTelegramHtml(staticConversationalReply(sppgUnitName)),
      };
    }
  }
}

export const metaAgent = new MetaAgent();

import { geminiKeyManager } from "../ai/gemini-client.js";
import { aiCircuitBreaker } from "../ai/circuit-breaker.js";
import { SppgOrder, SppgOrderSchema } from "../ai/schemas/sppg-order.schema.js";
import { SupplierReceipt, SupplierReceiptSchema } from "../ai/schemas/supplier-receipt.schema.js";
import { logger } from "../utils/logger.js";

export type ParsedImageDocument =
  | { type: "SPPG_ORDER"; data: SppgOrder }
  | { type: "SUPPLIER_EXPENSE"; data: SupplierReceipt };

/**
 * Sanitizes messy numeric inputs (e.g. "Rp 11.450.000,00", "11.450.000", "55000") into valid number.
 */
export function cleanNumeric(val: any, fallback = 0): number {
  if (typeof val === "number" && !isNaN(val)) return val;
  if (!val) return fallback;
  if (typeof val === "string") {
    let s = val.replace(/[^0-9,\.-]/g, "").trim();
    if (!s) return fallback;
    if (/\.\d{3}/.test(s) && !s.includes(",")) {
      s = s.replace(/\./g, "");
    } else if (/,\d{3}/.test(s) && !s.includes(".")) {
      s = s.replace(/,/g, "");
    } else if (s.includes(".") && s.includes(",")) {
      s = s.replace(/\./g, "").replace(",", ".");
    }
    const n = parseFloat(s);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

/**
 * Normalizes any Indonesian date string (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD) into standard YYYY-MM-DD.
 */
export function cleanDateString(val: any): string {
  const today = new Date().toISOString().slice(0, 10);
  if (!val || typeof val !== "string") return today;
  const trimmed = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const dmy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    let year = dmy[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }
  return today;
}

export function detectUserCaptionIntent(caption?: string): "EXPENSE" | "INCOME" | null {
  if (!caption || !caption.trim()) return null;
  const c = caption.trim().toLowerCase();
  if (/\b(?:belanja|pengeluaran|supplier|suplier|beli|nota|bon|biaya|faktur|struk|kwitansi)\b/i.test(c)) {
    return "EXPENSE";
  }
  if (/\b(?:pendapatan|pagu|pesanan|sppg\s*order|order\s*sppg)\b/i.test(c)) {
    return "INCOME";
  }
  return null;
}

export const UNIVERSAL_DOCUMENT_PARSER_PROMPT = `
Anda adalah AI Auditor Spesialis Dokumen Pengadaan Program Makanan Bergizi Gratis (MBG) di bawah Badan Gizi Nasional (BGN) Republik Indonesia.
Tugas Anda: Menganalisis dokumen yang diunggah (gambar/foto/PDF), mengenali jenis transaksi secara komprehensif, dan mengekstrak seluruh datanya secara presisi.

ATURAN MUTLAK KETERANGAN PENGGUNA (USER CAPTION OVERRIDE):
- JIKA ada instruksi bahwa pengguna menetapkan dokumen sebagai PENGELUARAN BELANJA (SUPPLIER_EXPENSE):
  WAJIB klasifikasikan dokumen sebagai SUPPLIER_EXPENSE dan ekstrak seluruh item belanja serta total belanja aktualnya, MESKIPUN tabel dokumen memiliki judul bertuliskan "PO" atau format Surat Pesanan!
- JIKA ada instruksi bahwa pengguna menetapkan dokumen sebagai PENDAPATAN (SPPG_ORDER):
  WAJIB klasifikasikan dokumen sebagai SPPG_ORDER.

PANDUAN KLASIFIKASI DOKUMEN:

1. [INCOME / PENDAPATAN] NOTA PESANAN BAHAN MAKANAN (SPPG_ORDER):
   - Karakteristik: DITERBITKAN OLEH BADAN GIZI NASIONAL (BGN) atau SATUAN PELAYANAN PROGRAM GIZI (SPPG).
   - Bentuk Dokumen:
     * Kop resmi Badan Gizi Nasional / SPPG.
     * Judul: "NOTA PESANAN BAHAN MAKANAN", "SURAT PESANAN (PO)", atau "REKAPITULASI KEBUTUHAN BAHAN".
     * SPPG bertindak sebagai PIHAK PEMESAN yang mengalokasikan plafon pagu anggaran belanja.
     * Memuat daftar pesanan berbagai bahan makanan harian kepada rekanan vendor.
     * Ditandatangani pejabat resmi: Kepala SPPG, Pejabat Pembuat Komitmen (PPK), atau PJ Operasional.
   - Kembalikan JSON:
   {
     "document_type": "SPPG_ORDER",
     "payload": {
       "type": "income",
       "sppg_unit": "Nama Unit SPPG",
       "order_no": "Nomor Surat/Nota Pesanan (contoh: PO-10/12/09/26)",
       "order_date": "YYYY-MM-DD",
       "items": [
         {
           "no": 1,
           "item_name": "Nama Bahan Makanan",
           "qty": 100,
           "unit": "KG/Ekor/Liter/Rak/Ikat",
           "price": 15000,
           "total_price": 1500000,
           "supplier_target": "Nama Supplier Target (jika ada)"
         }
       ],
       "total_amount": 1500000,
       "signed_by": "Nama Pejabat Penandatangan (contoh: M. Risal, S.STP)"
     }
   }

2. [EXPENSE / PENGELUARAN] BUKTI BELANJA SUPPLIER (SUPPLIER_EXPENSE):
   - Karakteristik: DITERBITKAN OLEH PIHAK PENJUAL / TOKO / SUPPLIER / BANK KEPADA SPPG.
   - Meliputi seluruh ragam bukti transaksi pengeluaran riil berikut:
     * a. Bon Pasar Tradisional / Nota Kontan Tulisan Tangan (kertas nota toko, cap basah, tulisan tangan pensil/pulpen).
     * b. Struk Kasir Komputer / POS / Printer Termal (Minimarket, Supermarket, Toko Swalayan, Grosir).
     * c. Faktur Tagihan / Invoice Komersial Resmi (Lembar invoice cetakan komputer dari CV/PT pemasok bahan pangan).
     * d. Bukti Transfer Bank / Screenshot m-Banking / QRIS (BCA, BRI, Mandiri, BNI, dll.) status berhasil.
     * e. Kwitansi Resmi Pembayaran Tunai.
   - ATURAN KHUSUS EXPENSE:
     * "supplier_name": Nama toko, kios pasar, agen, distributor, atau penerima transfer.
     * "receipt_no": Nomor nota, faktur, atau invoice jika tertera di dokumen (misal "INV-DPS/2026/09/088").
     * "sppg_ref_no": Jika pada bukti belanja terdapat catatan nomor PO (misal "Ref SPPG: PO-10/12/09/26", "Ref PO-10", dll.), WAJIB cantumkan nomor PO tersebut.
     * "payment_method": "Cash", "Transfer BCA", "BRI", "Mandiri", "QRIS", atau metode yang tertera.
     * "items": Rincian seluruh barang yang dibeli beserta kuantitas, satuan, harga, dan total per baris.
   - Kembalikan JSON:
   {
     "document_type": "SUPPLIER_EXPENSE",
     "payload": {
       "type": "expense",
       "supplier_name": "Nama Toko / Supplier / Rekanan",
       "receipt_no": "Nomor faktur/invoice/nota jika ada, atau kosongkan",
       "date": "YYYY-MM-DD",
       "sppg_ref_no": "Nomor PO referensi jika ada, atau kosongkan",
       "items": [
         {
           "item_name": "Nama Barang Belanja",
           "qty": 1,
           "unit": "KG/Ekor/Rak/Liter/Bungkus/unit",
           "price": 50000,
           "total_price": 50000,
           "supplier_name": "Nama Toko Spesifik jika multi-supplier"
         }
       ],
       "subtotal": 50000,
       "discount": 0,
       "tax": 0,
       "total_amount": 50000,
       "payment_method": "Cash"
     }
   }

KEMBALIKAN HANYA FORMAT JSON VALID. DILARANG MENAMBAHKAN MARKDOWN WRAPPER (\`\`\`json).
`;

/**
 * Parses any incoming image (photo or image document) into structured SPPG Order or Supplier Expense.
 */
export async function parseImageDocument(
  imageBuffer: Buffer,
  mimeType = "image/jpeg",
  defaultUnit = "SPPG Patila, Luwu Utara",
  userCaption?: string
): Promise<ParsedImageDocument | null> {
  if (aiCircuitBreaker.isOpen()) {
    logger.warn("Circuit breaker is OPEN. Image AI parsing skipped.");
    return null;
  }

  try {
    const userIntent = detectUserCaptionIntent(userCaption);
    const parsed = await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: UNIVERSAL_DOCUMENT_PARSER_PROMPT,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      const imagePart = {
        inlineData: {
          data: imageBuffer.toString("base64"),
          mimeType,
        },
      };

      let captionPrompt = "";
      if (userIntent === "EXPENSE") {
        captionPrompt = `\nPENTING: Pengguna memberikan keterangan "${userCaption?.trim()}". Pengguna SECARA MUTLAK menetapkan dokumen ini sebagai PENGELUARAN BELANJA SUPPLIER (SUPPLIER_EXPENSE). Klasifikasikan dokumen ini WAJIB sebagai SUPPLIER_EXPENSE. Jangan jadikan SPPG_ORDER meskipun tabel ada tulisan 'PO'.`;
      } else if (userIntent === "INCOME") {
        captionPrompt = `\nPENTING: Pengguna memberikan keterangan "${userCaption?.trim()}". Pengguna SECARA MUTLAK menetapkan dokumen ini sebagai PENDAPATAN (SPPG_ORDER). Klasifikasikan dokumen ini WAJIB sebagai SPPG_ORDER.`;
      } else if (userCaption?.trim()) {
        captionPrompt = `\nPesan/Keterangan dari pengguna: "${userCaption.trim()}". Pertimbangkan keterangan ini dalam mengklasifikasikan dokumen dan mengekstrak data.`;
      }

      const prompt = `Analisis, klasifikasikan (SPPG_ORDER vs SUPPLIER_EXPENSE), dan ekstrak data dokumen pengadaan MBG ini untuk unit ${defaultUnit}.${captionPrompt}`;
      const result = await model.generateContent([prompt, imagePart]);
      const rawText = result.response.text();
      const cleanJson = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
      return JSON.parse(cleanJson);
    });

    aiCircuitBreaker.recordSuccess();

    // HARD DETERMINISTIC OVERRIDE BASED ON USER INTENT
    if (userIntent === "EXPENSE" && parsed.document_type === "SPPG_ORDER" && parsed.payload) {
      logger.info({ userCaption }, "Overriding SPPG_ORDER to SUPPLIER_EXPENSE based on user caption intent");
      const p = parsed.payload;
      parsed.document_type = "SUPPLIER_EXPENSE";
      parsed.payload = {
        type: "expense",
        supplier_name: p.items?.find((it: any) => it.supplier_target && it.supplier_target !== "Lainnya")?.supplier_target || "Supplier Rekanan",
        receipt_no: p.order_no || "",
        date: p.order_date || cleanDateString(""),
        sppg_ref_no: "", // Do not auto-fill sppg_ref_no so user is prompted to pick PO
        items: (p.items || []).map((it: any) => ({
          item_name: it.item_name || "Bahan Belanja",
          qty: cleanNumeric(it.qty, 1),
          unit: it.unit || "unit",
          price: cleanNumeric(it.price, 0),
          total_price: cleanNumeric(it.total_price) || (cleanNumeric(it.qty, 1) * cleanNumeric(it.price, 0)),
          supplier_name: it.supplier_target || "Supplier Rekanan",
        })),
        subtotal: cleanNumeric(p.total_amount),
        discount: 0,
        tax: 0,
        total_amount: cleanNumeric(p.total_amount),
        payment_method: "Cash",
      };
    } else if (userIntent === "INCOME" && parsed.document_type === "SUPPLIER_EXPENSE" && parsed.payload) {
      logger.info({ userCaption }, "Overriding SUPPLIER_EXPENSE to SPPG_ORDER based on user caption intent");
      const p = parsed.payload;
      parsed.document_type = "SPPG_ORDER";
      parsed.payload = {
        type: "income",
        sppg_unit: defaultUnit,
        order_no: p.receipt_no || p.sppg_ref_no || "PO-AUTO",
        order_date: p.date || cleanDateString(""),
        items: (p.items || []).map((it: any, idx: number) => ({
          no: idx + 1,
          item_name: it.item_name || "Bahan Makanan",
          qty: cleanNumeric(it.qty, 1),
          unit: it.unit || "KG",
          price: cleanNumeric(it.price, 0),
          total_price: cleanNumeric(it.total_price) || (cleanNumeric(it.qty, 1) * cleanNumeric(it.price, 0)),
          supplier_target: it.supplier_name || "Lainnya",
        })),
        total_amount: cleanNumeric(p.total_amount),
        signed_by: "Kepala SPPG",
      };
    }

    // CASE 1: SPPG ORDER (INCOME)
    if (parsed.document_type === "SPPG_ORDER" && parsed.payload) {
      const p = parsed.payload;
      p.order_date = cleanDateString(p.order_date);
      p.arrival_date = p.order_date;
      p.total_amount = cleanNumeric(p.total_amount);
      p.signed_by = (p.signed_by || "").trim() || "Kepala SPPG";

      if (Array.isArray(p.items)) {
        p.items = p.items.map((it: any, idx: number) => ({
          no: it.no || idx + 1,
          item_name: String(it.item_name || "Bahan Makanan").trim(),
          qty: cleanNumeric(it.qty, 1),
          unit: String(it.unit || "KG").trim(),
          price: cleanNumeric(it.price, 0),
          total_price: cleanNumeric(it.total_price) || (cleanNumeric(it.qty, 1) * cleanNumeric(it.price, 0)),
          supplier_target: it.supplier_target ? String(it.supplier_target).trim() : "Lainnya",
        }));
      }

      const validated = SppgOrderSchema.parse(p);
      return { type: "SPPG_ORDER", data: validated };
    }

    // CASE 2: SUPPLIER EXPENSE (EXPENSE)
    if (parsed.document_type === "SUPPLIER_EXPENSE" && parsed.payload) {
      const p = parsed.payload;
      p.date = cleanDateString(p.date);
      p.supplier_name = String(p.supplier_name || "Supplier Rekanan").trim();
      if (!p.supplier_name || /tidak\s+diketahui|unknown/i.test(p.supplier_name)) {
        p.supplier_name = "Supplier Rekanan";
      }
      p.payment_method = p.payment_method && !/tidak\s+diketahui|unknown/i.test(p.payment_method) ? p.payment_method : "Cash";
      p.receipt_no = p.receipt_no ? String(p.receipt_no).trim() : (p.invoice_no ? String(p.invoice_no).trim() : "");
      p.total_amount = cleanNumeric(p.total_amount);
      p.subtotal = cleanNumeric(p.subtotal, p.total_amount);
      p.discount = cleanNumeric(p.discount, 0);
      p.tax = cleanNumeric(p.tax, 0);
      p.sppg_ref_no = ""; // Always empty on initial upload so user is prompted to pick PO

      if (Array.isArray(p.items) && p.items.length > 0) {
        p.items = p.items.map((it: any) => ({
          item_name: String(it.item_name || "Bahan").trim(),
          qty: cleanNumeric(it.qty, 1),
          unit: String(it.unit || "unit").trim(),
          price: cleanNumeric(it.price, 0),
          total_price: cleanNumeric(it.total_price) || (cleanNumeric(it.qty, 1) * cleanNumeric(it.price, 0)),
          supplier_name: it.supplier_name ? String(it.supplier_name).trim() : p.supplier_name,
        }));
      } else {
        // Synthesize single item fallback if items array was empty
        p.items = [
          {
            item_name: "Belanja Bahan Pangan",
            qty: 1,
            unit: "paket",
            price: p.total_amount,
            total_price: p.total_amount,
            supplier_name: p.supplier_name,
          },
        ];
      }

      const validated = SupplierReceiptSchema.parse(p);
      return { type: "SUPPLIER_EXPENSE", data: validated };
    }

    return null;
  } catch (err: any) {
    logger.error({ err: err?.message || err }, "Image parsing via Gemini Vision failed");
    aiCircuitBreaker.recordFailure();
    return null;
  }
}

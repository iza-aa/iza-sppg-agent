import { geminiKeyManager } from "../gemini-client.js";
import { SppgOrder, SppgOrderSchema } from "../schemas/sppg-order.schema.js";
import { logger } from "../../utils/logger.js";

const SPPG_ORDER_SYSTEM_PROMPT = `
Anda adalah sistem AI Auditor Spesialis Pengadaan Bahan Makanan Program Makanan Bergizi Gratis (MBG) di bawah Badan Gizi Nasional (BGN) Republik Indonesia.

TUGAS UTAMA:
Menganalisis dan mengekstrak dokumen "NOTA PESANAN BAHAN MAKANAN" (lembar surat berkop Badan Gizi Nasional / SPPG, ataupun lembar cetak tabel daftar pesanan bahan makanan SPPG).
Dokumen ini mewakili PENDAPATAN / PLAFON ANGGARAN (Bukan Pengeluaran).

ATURAN EKSTRAKSI DOKUMEN:
1. Identifikasi Kop / Info Dokumen:
   - Nama Unit SPPG (contoh: "SPPG PATILA, LUWU UTARA", default "SPPG Patila, Luwu Utara")
   - Nomor Pesanan (contoh: "No. 05/02/09/26", jika tidak ada buat "PO-AUTO")
   - Tanggal Pesanan (Format YYYY-MM-DD, jika tidak tertera gunakan tanggal hari ini 2026-09-09)
   - Tanggal Tiba/Waktu (Format YYYY-MM-DD)
2. Format Tabel / Lembar Pesanan:
   - Jika dokumen berupa lembaran tabel (Uraian Jenis Bahan Makanan, Kuantitas, Harga, Jumlah, Supplier), ini adalah NOTA PESANAN SPPG multi-supplier.
   - Ekstraksi SELURUH baris bahan makanan tanpa terlewat.
   - "no": Nomor urut
   - "item_name": Uraian nama bahan makanan lengkap
   - "qty": Kuantitas angka
   - "unit": Satuan bahan (KG, Jerigen, Rak, Ember, Biji, Keranjang, Bungkus, Ikat, Botol)
   - "price": Harga satuan dalam Rupiah
   - "total_price": Total harga baris (qty * price)
   - "supplier_target": Kolom Supplier jika tercantum (contoh: Toko Farhan, Annisa, Mas Pandu, Best Fruit, Hj Muliadi)
3. Total Anggaran:
   - "total_amount": Angka nominal total di baris Total paling bawah
4. Penandatangan:
   - "signed_by": Nama pejabat penandatangan jika ada, atau "-"
5. Jenis Transaksi:
   - "type": "income" (Selalu 'income' karena ini pagu pemesanan bahan SPPG).

KEMBALIKAN HANYA JSON VALID SESUAI SKEMA BERIKUT:
{
  "type": "income",
  "sppg_unit": "SPPG Patila, Luwu Utara",
  "order_no": "05/02/09/26",
  "order_date": "2026-09-09",
  "arrival_date": "2026-09-09",
  "items": [
    {
      "no": 1,
      "item_name": "Beras",
      "qty": 245,
      "unit": "KG",
      "price": 16000,
      "total_price": 3920000,
      "supplier_target": "Toko Farhan"
    }
  ],
  "total_amount": 29206000,
  "signed_by": "-"
}
`;

export async function parseSppgOrderFromImage(
  imageBuffer: Buffer,
  mimeType = "image/jpeg"
): Promise<SppgOrder> {
  return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
    logger.info({ modelName }, "Parsing SPPG order document via Gemini Vision...");

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SPPG_ORDER_SYSTEM_PROMPT,
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

    const prompt = "Ekstrak seluruh informasi Nota Pesanan Bahan Makanan SPPG ini secara lengkap dan akurat.";
    const result = await model.generateContent([prompt, imagePart]);
    const rawText = result.response.text();
    const cleanJson = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();

    const parsed = JSON.parse(cleanJson);

    // Fallback date & order_no handling
    const todayStr = new Date().toISOString().slice(0, 10);
    if (!parsed.order_date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.order_date) || parsed.order_date === "2026-01-01") {
      parsed.order_date = todayStr;
    }
    if (!parsed.arrival_date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.arrival_date)) {
      parsed.arrival_date = parsed.order_date;
    }
    if (!parsed.order_no || parsed.order_no === "PO-AUTO") {
      parsed.order_no = `PO-${todayStr.replace(/-/g, "")}-${Date.now().toString().slice(-4)}`;
    }
    if (!parsed.sppg_unit) {
      parsed.sppg_unit = "SPPG Patila, Luwu Utara";
    }

    // Deterministic CPU Sum Check & Validation
    if (Array.isArray(parsed.items) && parsed.items.length > 0) {
      let calculatedSum = 0;
      parsed.items = parsed.items.map((item: any) => {
        const qty = Number(item.qty) || 1;
        const price = Number(item.price) || 0;
        const expectedTotal = qty * price;
        const lineTotal = Number(item.total_price) || expectedTotal;
        calculatedSum += lineTotal;
        return {
          ...item,
          qty,
          price,
          total_price: lineTotal,
        };
      });

      if (Math.abs(calculatedSum - parsed.total_amount) > 1000) {
        logger.warn(
          { calculatedSum, totalInDoc: parsed.total_amount },
          "Difference detected between item sum and total_amount, correcting total_amount"
        );
        parsed.total_amount = calculatedSum;
      }
    }

    return SppgOrderSchema.parse(parsed);
  });
}

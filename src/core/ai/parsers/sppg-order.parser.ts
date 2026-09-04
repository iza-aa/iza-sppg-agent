import { geminiKeyManager } from "../gemini-client.js";
import { SppgOrder, SppgOrderSchema } from "../schemas/sppg-order.schema.js";
import { logger } from "../../utils/logger.js";

const SPPG_ORDER_SYSTEM_PROMPT = `
Anda adalah sistem AI Auditor Spesialis Pengadaan Bahan Makanan Program Makanan Bergizi Gratis (MBG) di bawah Badan Gizi Nasional (BGN) Republik Indonesia.

TUGAS UTAMA:
Menganalisis dan mengekstrak dokumen resmi "NOTA PESANAN BAHAN MAKANAN" (lembar surat berkop Badan Gizi Nasional / SPPG).
Dokumen ini mewakili PENDAPATAN / PLAFON ANGGARAN (Bukan Pengeluaran).

ATURAN EKSTRAKSI DOKUMEN:
1. Identifikasi Kop Surat:
   - Nama Unit SPPG (contoh: "SPPG PATILA, LUWU UTARA")
   - Nomor Pesanan (contoh: "No. 05/02/09/26")
   - Tanggal Pesanan (Format YYYY-MM-DD)
   - Tanggal Tiba/Waktu (Format YYYY-MM-DD)
2. Ekstraksi Seluruh Baris Tabel Bahan Makanan:
   - "no": Nomor urut
   - "item_name": Uraian nama bahan makanan lengkap (contoh: Ayam, Minyak Kelapa Sawit, Wortel, Tempe, Kentang, Kelengkeng, Susu UHT, Kaldu Jamur)
   - "qty": Kuantitas angka (gunakan titik untuk desimal, contoh 0.5)
   - "unit": Satuan bahan (Ekor, Jerigen, KG, Keranjang, Liter, Bungkus, Ikat)
   - "price": Harga pagu satuan dalam Rupiah
   - "total_price": Total harga baris (qty * price)
   - "supplier_target": Kolom Supplier jika tercantum (contoh: Ayam Pasar, Hj Muliadi, Mas Pandu, Best Fruit)
3. Total Anggaran:
   - "total_amount": Angka nominal total di baris Total / paling bawah
4. Penandatangan:
   - "signed_by": Nama pejabat Ka. SPPG di bawah tanda tangan
5. Jenis Transaksi:
   - "type": "income" (Selalu 'income' karena ini pagu tagihan pendapatan vendor).

KEMBALIKAN HANYA JSON VALID SESUAI SKEMA BERIKUT:
{
  "type": "income",
  "sppg_unit": "SPPG Patila, Luwu Utara",
  "order_no": "05/02/09/26",
  "order_date": "2026-09-02",
  "arrival_date": "2026-09-03",
  "items": [
    {
      "no": 1,
      "item_name": "Ayam",
      "qty": 248,
      "unit": "Ekor",
      "price": 60000,
      "total_price": 14880000,
      "supplier_target": "Ayam Pasar"
    }
  ],
  "total_amount": 29581000,
  "signed_by": "A. Alya Rahayu AN, S.Pi"
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

    const parsed = JSON.parse(rawText);

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

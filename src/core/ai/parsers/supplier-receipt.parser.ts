import { geminiKeyManager } from "../gemini-client.js";
import { SupplierReceipt, SupplierReceiptSchema } from "../schemas/supplier-receipt.schema.js";
import { logger } from "../../utils/logger.js";

const SUPPLIER_RECEIPT_SYSTEM_PROMPT = `
Anda adalah sistem AI Auditor Spesialis Pengeluaran Belanja Bahan Pangan Program Makanan Bergizi Gratis (MBG).

TUGAS UTAMA:
Menganalisis foto struk, nota kontan, bon belanja pasar, faktur supplier, atau bukti transfer pengeluaran.
Dokumen ini mewakili PENGELUARAN BELANJA RIIL VENDOR (Biaya Aktual).

ATURAN EKSTRAKSI DOKUMEN:
1. Nama Toko / Supplier:
   - "supplier_name": Nama toko atau supplier rekanan (contoh: Hj Muliadi, Ayam Pasar, Mas Pandu, Best Fruit, Toko Barokah)
2. Tanggal Transaksi:
   - "date": Tanggal transaksi dalam format ISO YYYY-MM-DD (Gunakan tahun terkini 2026 jika tidak tertera tahun).
3. Rincian Item Barang Belanja:
   - "item_name": Nama barang (Ayam, Sayur Wortel, Minyak Jerigen, Beras, Bumbu)
   - "qty": Kuantitas angka
   - "unit": Satuan (KG, Jerigen, Ekor, Ikat, Bungkus, Karton, Liter)
   - "price": Harga satuan
   - "total_price": Total harga baris (qty * price)
4. Total Belanja:
   - "subtotal": Subtotal sebelum diskon/pajak
   - "discount": Nilai potongan jika ada
   - "tax": Pajak jika ada
   - "total_amount": Total akhir yang dibayar dalam Rupiah
5. Metode Pembayaran:
   - "payment_method": "Cash", "Transfer BCA", "BRI", "Mandiri", atau "QRIS"
6. Jenis Transaksi:
   - "type": "expense" (Selalu 'expense' karena ini pengeluaran riil).

KEMBALIKAN HANYA FORMAT JSON VALID:
{
  "type": "expense",
  "supplier_name": "Hj Muliadi",
  "date": "2026-09-03",
  "items": [
    {
      "item_name": "Minyak Kelapa Sawit",
      "qty": 14,
      "unit": "Jerigen",
      "price": 125000,
      "total_price": 1750000
    }
  ],
  "subtotal": 1750000,
  "discount": 0,
  "tax": 0,
  "total_amount": 1750000,
  "payment_method": "Cash"
}
`;

export async function parseSupplierReceiptFromImage(
  imageBuffer: Buffer,
  mimeType = "image/jpeg"
): Promise<SupplierReceipt> {
  return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
    logger.info({ modelName }, "Parsing supplier receipt document via Gemini Vision...");

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SUPPLIER_RECEIPT_SYSTEM_PROMPT,
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

    const prompt = "Ekstrak seluruh informasi nota belanja supplier ini secara detail dan akurat.";
    const result = await model.generateContent([prompt, imagePart]);
    const rawText = result.response.text();
    const cleanJson = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();

    const parsed = JSON.parse(cleanJson);

    // Deterministic CPU Sum Check
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

      if (!parsed.total_amount || Math.abs(calculatedSum - parsed.total_amount) > 1000) {
        parsed.total_amount = calculatedSum - (Number(parsed.discount) || 0) + (Number(parsed.tax) || 0);
      }
    }

    return SupplierReceiptSchema.parse(parsed);
  });
}

import { geminiKeyManager } from "../gemini-client.js";
import { SupplierReceipt, SupplierReceiptSchema } from "../schemas/supplier-receipt.schema.js";
import { SppgOrder, SppgOrderSchema } from "../schemas/sppg-order.schema.js";
import { logger } from "../../utils/logger.js";

export type ParsedTextTransaction =
  | { type: "SUPPLIER_EXPENSE"; data: SupplierReceipt }
  | { type: "SPPG_ORDER"; data: SppgOrder };

const TEXT_PARSER_SYSTEM_PROMPT = `
Anda adalah AI Auditor & Pencatat Keuangan Program Makanan Bergizi Gratis (MBG) Badan Gizi Nasional (BGN).
Tugas Anda: Menganalisis pesan teks berbahasa Indonesia dari operator/Ayah untuk mencatat transaksi keuangan SPPG.

IDENTIFIKASI JENIS TRANSAKSI:
1. PENGELUARAN SUPPLIER ("type": "expense"):
   - Pesan yang menyebutkan belanja bahan, beli ayam/sayur/beras/bumbu, bayar supplier pasar, bon belanja.
   - Contoh: "Tadi beli beras 2 karung 700rb di toko Hj Muliadi lunas tunai"
   - Format output JSON:
   {
     "transaction_type": "SUPPLIER_EXPENSE",
     "payload": {
       "type": "expense",
       "supplier_name": "Hj Muliadi",
       "date": "YYYY-MM-DD",
       "items": [
         { "item_name": "Beras", "qty": 2, "unit": "Karung", "price": 350000, "total_price": 700000 }
       ],
       "subtotal": 700000,
       "discount": 0,
       "tax": 0,
       "total_amount": 700000,
       "payment_method": "Cash",
       "notes": "Pencatatan teks via Telegram"
     }
   }

2. NOTA PESANAN SPPG ("transaction_type": "SPPG_ORDER"):
   - Pesan yang menyebutkan plafon, pagu tagihan, pesanan SPPG, no surat pesanan bahan makanan dari Ka. SPPG.
   - Contoh: "Catat pesanan SPPG Patila No 05/02/09/26 total pagu 29.581.000"
   - Format output JSON:
   {
     "transaction_type": "SPPG_ORDER",
     "payload": {
       "type": "income",
       "sppg_unit": "SPPG Patila",
       "order_no": "05/02/09/26",
       "order_date": "YYYY-MM-DD",
       "arrival_date": "YYYY-MM-DD",
       "items": [
         { "no": 1, "item_name": "Bahan Pangan MBG", "qty": 1, "unit": "Paket", "price": 29581000, "total_price": 29581000, "supplier_target": "Gabungan Supplier" }
       ],
       "total_amount": 29581000,
       "signed_by": "Ka. SPPG",
       "notes": "Pencatatan nota pesanan via teks"
     }
   }

ATURAN PENTING:
- Gunakan tanggal hari ini jika pengguna tidak menyebutkan tanggal tertentu.
- Selalu normalkan nominal Rupiah: "200rb" = 200000, "1.5jt" = 1500000, "50k" = 50000.
- Pastikan total_amount adalah angka murni (integer).
- Kembalikan HANYA JSON valid.
`;

export async function parseTransactionFromText(
  userText: string,
  defaultSppgUnit = "SPPG Patila"
): Promise<ParsedTextTransaction | null> {
  return await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
    logger.info({ modelName }, "Parsing natural language transaction text via Gemini...");

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: TEXT_PARSER_SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });

    const todayStr = new Date().toISOString().split("T")[0];
    const prompt = `Tanggal hari ini: ${todayStr}.\nUnit default: ${defaultSppgUnit}.\nPesan teks pengguna:\n"${userText}"\n\nEkstrak transaksi ke dalam format JSON yang ditentukan:`;

    const result = await model.generateContent(prompt);
    const rawText = result.response.text();
    const cleanJson = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();

    try {
      const parsed = JSON.parse(cleanJson);

      if (parsed.transaction_type === "SPPG_ORDER" && parsed.payload) {
        const orderData = parsed.payload;
        if (!orderData.order_date) orderData.order_date = todayStr;
        if (!orderData.arrival_date) orderData.arrival_date = todayStr;
        if (!orderData.sppg_unit) orderData.sppg_unit = defaultSppgUnit;

        const validated = SppgOrderSchema.parse(orderData);
        return { type: "SPPG_ORDER", data: validated };
      }

      if ((parsed.transaction_type === "SUPPLIER_EXPENSE" || parsed.payload?.type === "expense") && parsed.payload) {
        const expData = parsed.payload;
        if (!expData.date) expData.date = todayStr;
        if (!expData.supplier_name) expData.supplier_name = "Supplier Pasar";
        if (!expData.payment_method) expData.payment_method = "Cash";

        // Deterministic sum check
        if (Array.isArray(expData.items) && expData.items.length > 0) {
          let sum = 0;
          expData.items = expData.items.map((it: any) => {
            const qty = Number(it.qty) || 1;
            const price = Number(it.price) || 0;
            const total = Number(it.total_price) || qty * price;
            sum += total;
            return {
              item_name: it.item_name || "Bahan Makanan",
              qty,
              unit: it.unit || "unit",
              price: price || (qty > 0 ? Math.round(total / qty) : total),
              total_price: total,
            };
          });

          if (!expData.total_amount || Math.abs(sum - expData.total_amount) > 1000) {
            expData.total_amount = sum;
          }
          expData.subtotal = sum;
        }

        const validated = SupplierReceiptSchema.parse(expData);
        return { type: "SUPPLIER_EXPENSE", data: validated };
      }

      return null;
    } catch (parseErr) {
      logger.warn({ parseErr, rawText }, "Failed to parse text transaction output into valid schema");
      return null;
    }
  });
}

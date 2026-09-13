import { agyConnector } from "../agy-connector.js";
import { SupplierReceipt, SupplierReceiptSchema } from "../schemas/supplier-receipt.schema.js";
import { SppgOrder, SppgOrderSchema } from "../schemas/sppg-order.schema.js";
import { staticParseTransaction } from "../static-fallback.js";
import { logger } from "../../utils/logger.js";

export type ParsedTextTransaction =
  | { type: "SUPPLIER_EXPENSE"; data: SupplierReceipt }
  | { type: "SPPG_ORDER"; data: SppgOrder };

const TEXT_PARSER_SYSTEM_PROMPT = `
Anda adalah AI Auditor & Pencatat Keuangan Program Makanan Bergizi Gratis (MBG) Badan Gizi Nasional (BGN).
Tugas Anda: Menganalisis pesan teks berbahasa Indonesia dari operator SPPG untuk mencatat transaksi keuangan SPPG.

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
       "notes": "Tadi beli beras 2 karung 700rb di toko Hj Muliadi lunas tunai"
     }
   }

2. NOTA PESANAN SPPG ("transaction_type": "SPPG_ORDER"):
   - Pesan yang menyebutkan plafon, pagu tagihan, pesanan SPPG, no surat pesanan bahan makanan dari Ka. SPPG.
   - Contoh: "Catat pesanan SPPG Patila No PO-2026/09/SPPG2-01 total pagu 29.581.000"
   - Format output JSON:
   {
     "transaction_type": "SPPG_ORDER",
     "payload": {
       "type": "income",
       "sppg_unit": "SPPG Patila",
       "order_no": "PO-2026/09/SPPG2-01",
       "order_date": "YYYY-MM-DD",
       "arrival_date": "YYYY-MM-DD",
       "items": [
         { "no": 1, "item_name": "Bahan Pangan MBG", "qty": 1, "unit": "Paket", "price": 29581000, "total_price": 29581000, "supplier_target": "Gabungan Supplier" }
       ],
       "total_amount": 29581000,
       "signed_by": "Ka. SPPG",
       "notes": "Catat pesanan SPPG Patila No PO-2026/09/SPPG2-01 total pagu 29.581.000"
     }
   }

ATURAN PENTING (DILARANG MENGARANG DATA / NO SILENT DEFAULTS):
- Gunakan tanggal hari ini jika pengguna tidak menyebutkan tanggal tertentu.
- Selalu normalkan nominal Rupiah: "200rb" = 200000, "1.5jt" = 1500000, "50k" = 50000.
- Pastikan total_amount adalah angka murni (integer).
- METODE PEMBAYARAN: JANGAN PERNAH default ke "Cash"! Jika user tidak menyebutkan tunai/cash/transfer/tf/qris/bon/tempo, isi "payment_method": null atau jangan sertakan!
- NAMA TOKO/SUPPLIER: JANGAN mengarang nama toko jika user tidak menyebutkan "di/ke/dari [nama toko]". Jika tidak ada, isi "supplier_name": null!
- NO SURAT PESANAN (PO): JANGAN membuat nomor PO sendiri jika user tidak menyebutkan No PO secara jelas.
- RINCIAN BARANG: JANGAN MENGARANG NAMA BARANG seperti "Bahan Makanan" atau "Belanja Bahan Pangan" jika pengguna TIDAK menyebutkan nama bahan secara spesifik! Jika pengguna tidak menyebutkan bahan belanjaan, isi "items": [] !
- Kembalikan HANYA JSON valid.
`;

export async function parseTransactionFromText(
  userText: string,
  defaultSppgUnit = "SPPG Patila"
): Promise<ParsedTextTransaction | null> {
  const todayStr = new Date().toISOString().split("T")[0];
  const prompt = `Tanggal hari ini: ${todayStr}.\nUnit default: ${defaultSppgUnit}.\nPesan teks pengguna:\n"${userText}"\n\nEkstrak transaksi ke dalam format JSON yang ditentukan:`;

  // Layer 1 (agy CLI) & Layer 2 (Gemini SDK fallback via agyConnector)
  try {
    const parsed = await agyConnector.executeReasoning(TEXT_PARSER_SYSTEM_PROMPT, prompt, false);

    if (parsed) {
      if (parsed.transaction_type === "SPPG_ORDER" && parsed.payload) {
        const orderData = parsed.payload;
        if (!orderData.order_date) orderData.order_date = todayStr;
        if (!orderData.arrival_date) orderData.arrival_date = todayStr;
        if (!orderData.sppg_unit) orderData.sppg_unit = defaultSppgUnit;

        const hasExplicitOrderNo = /\b(?:no\.?|nomor|po)[-\s:]*([A-Za-z0-9_/-]+)/i.test(userText);
        if (!hasExplicitOrderNo && (!orderData.order_no || orderData.order_no === "PO-AUTO")) {
          orderData.order_no = "";
        }
        orderData.notes = userText.trim();

        const validated = SppgOrderSchema.parse(orderData);
        return { type: "SPPG_ORDER", data: validated };
      }

      if ((parsed.transaction_type === "SUPPLIER_EXPENSE" || parsed.payload?.type === "expense") && parsed.payload) {
        const expData = parsed.payload;
        if (!expData.date) expData.date = todayStr;

        // Ensure no hallucinated payment method if user never mentioned it
        const hasExplicitPayment = /\b(tunai|cash|kontan|transfer|tf|bca|bri|mandiri|bni|qris|tempo|bon|utang|hutang)\b/i.test(userText);
        if (!hasExplicitPayment) {
          delete expData.payment_method;
        } else if (expData.payment_method) {
          // Normalize payment method to Indonesian "Tunai"
          const pm = expData.payment_method.toLowerCase();
          if (pm === "cash" || pm === "tunai" || pm === "kontan") {
            expData.payment_method = "Tunai";
          } else if (pm.includes("transfer") || pm.includes("tf")) {
            expData.payment_method = "Transfer";
          }
        }

        // Ensure no hallucinated supplier if user never specified one
        const hasExplicitSupplier = /(?:di|ke|dari)\s+([A-Za-z0-9\s]+)/i.test(userText);
        if (!hasExplicitSupplier && expData.supplier_name?.toLowerCase().includes("pasar")) {
          delete expData.supplier_name;
        }

        // Restore "Toko" prefix if user wrote "Toko [supplier]" but AI stripped it
        if (
          expData.supplier_name &&
          !expData.supplier_name.toLowerCase().startsWith("toko ") &&
          new RegExp(`\\btoko\\s+${expData.supplier_name}\\b`, "i").test(userText)
        ) {
          expData.supplier_name = `Toko ${expData.supplier_name}`;
        }

        // Deterministic sum check & filter out generic placeholder items
        if (Array.isArray(expData.items) && expData.items.length > 0) {
          expData.items = expData.items.filter((it: any) => {
            const name = (it.item_name || "").toLowerCase().trim();
            return name && !/^(?:belanja\s+bahan\s+pangan|bahan\s+makanan|bahan\s+pangan|barang|bahan)$/i.test(name);
          });

          let sum = 0;
          expData.items = expData.items.map((it: any) => {
            const qty = Number(it.qty) || 1;
            const price = Number(it.price) || 0;
            const total = Number(it.total_price) || qty * price;
            sum += total;
            return {
              item_name: it.item_name,
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
        } else {
          expData.items = [];
        }
        expData.notes = userText.trim();

        const validated = SupplierReceiptSchema.parse(expData);
        return { type: "SUPPLIER_EXPENSE", data: validated };
      }
    }
  } catch (aiErr: any) {
    logger.warn(
      { err: aiErr?.message || aiErr },
      "AI parsing failed for text transaction, attempting Layer 3 static regex fallback"
    );
  }

  // Layer 3: Static Regex Fallback
  const staticResult = staticParseTransaction(userText, defaultSppgUnit);
  if (staticResult) {
    logger.info({ type: staticResult.type }, "Successfully parsed text transaction via Layer 3 static regex fallback");
    return staticResult;
  }

  return null;
}

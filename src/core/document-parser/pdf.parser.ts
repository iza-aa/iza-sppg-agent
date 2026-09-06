import { geminiKeyManager } from "../ai/gemini-client.js";
import { aiCircuitBreaker } from "../ai/circuit-breaker.js";
import { SppgOrder, SppgOrderSchema } from "../ai/schemas/sppg-order.schema.js";
import { SupplierReceipt, SupplierReceiptSchema } from "../ai/schemas/supplier-receipt.schema.js";
import { logger } from "../utils/logger.js";

export type ParsedPdfDocument =
  | { type: "SPPG_ORDER"; data: SppgOrder }
  | { type: "SUPPLIER_EXPENSE"; data: SupplierReceipt };

const PDF_PARSER_PROMPT = `
Anda adalah AI Auditor Dokumen Pengadaan MBG Badan Gizi Nasional.
Tugas Anda: Menganalisis dokumen PDF lembar Nota Pesanan BGN atau Faktur Tagihan Supplier.

Jika ini NOTA PESANAN BAHAN MAKANAN (SPPG):
Kembalikan JSON:
{
  "document_type": "SPPG_ORDER",
  "payload": {
    "type": "income",
    "sppg_unit": "Nama Unit SPPG",
    "order_no": "Nomor Surat Pesanan",
    "order_date": "YYYY-MM-DD",
    "arrival_date": "YYYY-MM-DD",
    "items": [
      { "no": 1, "item_name": "Ayam", "qty": 248, "unit": "Ekor", "price": 60000, "total_price": 14880000, "supplier_target": "Ayam Pasar" }
    ],
    "total_amount": 29581000,
    "signed_by": "Nama Pejabat"
  }
}

Jika ini FAKTUR / INVOICE BELANJA SUPPLIER:
Kembalikan JSON:
{
  "document_type": "SUPPLIER_EXPENSE",
  "payload": {
    "type": "expense",
    "supplier_name": "Nama Supplier",
    "date": "YYYY-MM-DD",
    "items": [
      { "item_name": "Nama Barang", "qty": 1, "unit": "unit", "price": 100000, "total_price": 100000 }
    ],
    "subtotal": 100000,
    "discount": 0,
    "tax": 0,
    "total_amount": 100000,
    "payment_method": "Cash"
  }
}

Kembalikan HANYA JSON valid.
`;

/**
 * Parses a PDF document into structured SPPG Order or Supplier Expense
 */
export async function parsePdfDocument(
  pdfBuffer: Buffer,
  defaultUnit = "SPPG Patila"
): Promise<ParsedPdfDocument | null> {
  if (aiCircuitBreaker.isOpen()) {
    logger.warn("Circuit breaker is OPEN. PDF AI parsing skipped.");
    return null;
  }

  try {
    const parsed = await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: PDF_PARSER_PROMPT,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      const pdfPart = {
        inlineData: {
          data: pdfBuffer.toString("base64"),
          mimeType: "application/pdf",
        },
      };

      const result = await model.generateContent(["Ekstrak seluruh informasi keuangan dari dokumen PDF ini.", pdfPart]);
      const rawText = result.response.text();
      const cleanJson = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
      return JSON.parse(cleanJson);
    });

    aiCircuitBreaker.recordSuccess();

    if (parsed.document_type === "SPPG_ORDER" && parsed.payload) {
      const validated = SppgOrderSchema.parse(parsed.payload);
      return { type: "SPPG_ORDER", data: validated };
    }

    if (parsed.document_type === "SUPPLIER_EXPENSE" && parsed.payload) {
      const validated = SupplierReceiptSchema.parse(parsed.payload);
      return { type: "SUPPLIER_EXPENSE", data: validated };
    }

    return null;
  } catch (err: any) {
    logger.error({ err: err?.message || err }, "PDF parsing via Gemini Vision failed");
    aiCircuitBreaker.recordFailure();
    return null;
  }
}

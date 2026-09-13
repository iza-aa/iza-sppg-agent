import { geminiKeyManager } from "../ai/gemini-client.js";
import { aiCircuitBreaker } from "../ai/circuit-breaker.js";
import { SppgOrder, SppgOrderSchema } from "../ai/schemas/sppg-order.schema.js";
import { SupplierReceipt, SupplierReceiptSchema } from "../ai/schemas/supplier-receipt.schema.js";
import {
  cleanNumeric,
  cleanDateString,
  UNIVERSAL_DOCUMENT_PARSER_PROMPT,
} from "./image.parser.js";
import { logger } from "../utils/logger.js";

export type ParsedPdfDocument =
  | { type: "SPPG_ORDER"; data: SppgOrder }
  | { type: "SUPPLIER_EXPENSE"; data: SupplierReceipt };

/**
 * Parses a PDF document into structured SPPG Order or Supplier Expense with universal classification.
 */
export async function parsePdfDocument(
  pdfBuffer: Buffer,
  defaultUnit = "SPPG Patila, Luwu Utara",
  userCaption?: string
): Promise<ParsedPdfDocument | null> {
  if (aiCircuitBreaker.isOpen()) {
    logger.warn("Circuit breaker is OPEN. PDF AI parsing skipped.");
    return null;
  }

  try {
    const parsed = await geminiKeyManager.executeWithFallback(async (genAI, modelName) => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: UNIVERSAL_DOCUMENT_PARSER_PROMPT,
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

      const captionPrompt = userCaption?.trim()
        ? `\nPesan/Keterangan dari pengguna: "${userCaption.trim()}". Pertimbangkan keterangan ini dalam mengklasifikasikan dokumen dan mengekstrak data.`
        : "";

      const prompt = `Analisis, klasifikasikan (SPPG_ORDER vs SUPPLIER_EXPENSE), dan ekstrak data dokumen PDF pengadaan MBG ini untuk unit ${defaultUnit}.${captionPrompt}`;
      const result = await model.generateContent([prompt, pdfPart]);
      const rawText = result.response.text();
      const cleanJson = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
      return JSON.parse(cleanJson);
    });

    aiCircuitBreaker.recordSuccess();

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
      p.receipt_no = p.receipt_no ? String(p.receipt_no).trim() : (p.invoice_no ? String(p.invoice_no).trim() : "");
      p.total_amount = cleanNumeric(p.total_amount);
      p.subtotal = cleanNumeric(p.subtotal, p.total_amount);
      p.discount = cleanNumeric(p.discount, 0);
      p.tax = cleanNumeric(p.tax, 0);
      p.sppg_ref_no = p.sppg_ref_no ? String(p.sppg_ref_no).trim() : "";

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
    logger.error({ err: err?.message || err }, "PDF parsing via Gemini Vision failed");
    aiCircuitBreaker.recordFailure();
    return null;
  }
}

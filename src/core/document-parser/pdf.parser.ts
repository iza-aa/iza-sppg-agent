import { geminiKeyManager } from "../ai/gemini-client.js";
import { aiCircuitBreaker } from "../ai/circuit-breaker.js";
import { SppgOrder, SppgOrderSchema } from "../ai/schemas/sppg-order.schema.js";
import { SupplierReceipt, SupplierReceiptSchema } from "../ai/schemas/supplier-receipt.schema.js";
import {
  cleanNumeric,
  cleanDateString,
  detectUserCaptionIntent,
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

      const pdfPart = {
        inlineData: {
          data: pdfBuffer.toString("base64"),
          mimeType: "application/pdf",
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

      const prompt = `Analisis, klasifikasikan (SPPG_ORDER vs SUPPLIER_EXPENSE), dan ekstrak data dokumen PDF pengadaan MBG ini untuk unit ${defaultUnit}.${captionPrompt}`;
      const result = await model.generateContent([prompt, pdfPart]);
      const rawText = result.response.text();
      const cleanJson = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();
      return JSON.parse(cleanJson);
    });

    aiCircuitBreaker.recordSuccess();

    // HARD DETERMINISTIC OVERRIDE BASED ON USER INTENT
    if (userIntent === "EXPENSE" && parsed.document_type === "SPPG_ORDER" && parsed.payload) {
      logger.info({ userCaption }, "Overriding PDF SPPG_ORDER to SUPPLIER_EXPENSE based on user caption intent");
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
      logger.info({ userCaption }, "Overriding PDF SUPPLIER_EXPENSE to SPPG_ORDER based on user caption intent");
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

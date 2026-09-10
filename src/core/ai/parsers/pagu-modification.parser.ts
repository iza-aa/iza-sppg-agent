import { z } from "zod";
import { agyConnector } from "../agy-connector.js";
import { logger } from "../../utils/logger.js";

export const PaguModificationSchema = z.object({
  orderRef: z.string().nullable().optional().describe("Referensi PO/Pagu, contoh: IH001, II005, 03/31/08/26, 01/05/09/26"),
  targetItemName: z.string().nullable().optional().describe("Bahan yang dicari/diubah, contoh: Telur, Wortel, Ayam"),
  newItemName: z.string().nullable().optional().describe("Nama bahan baru jika mengganti nama bahan, contoh: Wortel"),
  qty: z.number().nullable().optional().describe("Kuantitas baru"),
  unit: z.string().nullable().optional().describe("Satuan baru, contoh: biji, kg, rak, ikat, ember"),
  price: z.number().nullable().optional().describe("Harga pagu satuan baru"),
  supplier: z.string().nullable().optional().describe("Nama rekanan / supplier baru jika disebutkan"),
  notes: z.string().nullable().optional().describe("Catatan atau spesifikasi bahan baru"),
  actionIntent: z.enum(["UPDATE", "ADD", "CLARIFY"]).default("UPDATE"),
});

export type PaguModificationRequest = z.infer<typeof PaguModificationSchema>;

const PAGU_MODIFICATION_SYSTEM_PROMPT = `
Anda adalah AI Spesialis Pengelolaan Anggaran & Pagu Bahan Makanan Bergizi Gratis (MBG) Badan Gizi Nasional (BGN).
Tugas Anda: Mengekstrak instruksi pengubahan atau penambahan data rincian bahan pagu (Tab 03_RINCIAN_PENDAPATAN) dari pesan teks pengguna ke dalam format JSON.

PENGGUNA INGIN:
1. MENGUBAH / UPDATE rincian yang sudah ada (actionIntent = "UPDATE"):
   - Kata kerja: ubah, ganti, edit, revisi, koreksi.
   - Contoh: "ubah IH001 jadi Wortel kuantitas 20 satuan biji harga 5rb"
2. MENAMBAH / ADD rincian bahan baru ke PO tertentu (actionIntent = "ADD"):
   - Kata kerja: tambah, nambah, masukkan, input, sisip, sisipkan.
   - Contoh: "masukkan Cabe Merah Besar 8 Kg @50000 Ke PO 05/02/09/26 II003" -> actionIntent: "ADD", orderRef: "II003", targetItemName: "Cabe Merah Besar", qty: 8, unit: "Kg", price: 50000.

EKSTRAKSI FIELD:
- Nomor Surat Pesanan / Kode Pagu (orderRef): HANYA nomor PO (misal "05/02/09/26") ATAU kode ID Pagu (misal "II003" atau "IH001"). Utamakan kode ID jika keduanya ada. Jangan gabungkan menjadi satu teks panjang.
- Nama bahan yang dituju / ditambah (targetItemName): nama bahan makanan (misal "Telur", "Ayam", "Cabe Merah Besar").
- Nama bahan baru (newItemName): nama bahan baru jika mengganti atau menambah bahan.
- Kuantitas (qty): angka kuantitas murni (misal 8, 20).
- Satuan (unit): misal "kg", "ekor", "jerigen", "ikat", "biji", "rak", "bungkus".
- Harga satuan (price): nominal angka murni per satuan (misal "@50000" = 50000, "5rb" = 5000, "1.5jt" = 1500000). JANGAN mengalikan 1000 jika angka sudah puluhan ribu (misal 50000 tetap 50000).
- Supplier (supplier): nama toko atau rekanan jika disebutkan (misal "Hj Mulyadi").

FORMAT OUTPUT JSON:
{
  "orderRef": "II003",
  "targetItemName": "Cabe Merah Besar",
  "newItemName": "Cabe Merah Besar",
  "qty": 8,
  "unit": "Kg",
  "price": 50000,
  "supplier": null,
  "actionIntent": "ADD"
}

ATURAN PENTING:
- Normalkan harga Rupiah: "5rb" = 5000, "30k" = 30000, "1.5jt" = 1500000.
- Hilangkan kata imbuhan seperti "satuan", "kuantitas", "harga", "jadi" dari nama bahan.
- Jika nomor PO atau bahan tidak disebutkan, biarkan null/undefined agar AI dapat menanyakannya ke pengguna.
- Kembalikan HANYA JSON valid tanpa markdown tambahan.
`;

export function staticParsePaguModification(text: string): PaguModificationRequest | null {
  const lower = text.toLowerCase();

  // Must have keywords related to changing / adding / pagu
  const isPaguChange = /\b(ubah|ngubah|mengubah|ganti|mengganti|edit|revisi|koreksi|tambah|nambah|menambah|tambahkan|menambahkan|masukkan|input|sisip|sisipkan)\b/i.test(lower) &&
    /\b(pagu|rincian|kuantitas|qty|harga|satuan|bahan|item|ih\d+|ii\d+|eh\d+|ei\d+|\d{2}\/\d{2}\/\d{2}\/\d{2}|po)\b/i.test(lower);

  if (!isPaguChange) return null;

  const isAddAction = /\b(tambah|nambah|menambah|tambahkan|menambahkan|masukkan|input|sisip|sisipkan)\b/i.test(lower);
  const actionIntent: "UPDATE" | "ADD" = isAddAction ? "ADD" : "UPDATE";

  // 1. Extract Order Reference (e.g. IH001, II005, EI001, EI002, 03/31/08/26) - prefer short ID code if available
  const specificIdMatch = text.match(/\b((?:SPPG\d*[-_])?(?:IH|II|EH|EI|TRX)\d{3,})\b/i);
  const datePoMatch = text.match(/\b(\d{2}\/\d{2}\/\d{2}\/\d{2})\b/);
  const orderRef = specificIdMatch ? specificIdMatch[1].toUpperCase() : (datePoMatch ? datePoMatch[1] : undefined);

  // 2. Extract Price (e.g. 5rb, 5000, 32.000, rp 5000)
  let price: number | undefined;
  const priceMatch = text.match(/(?:harga\s*(?:satuan(?:nya)?)?|@|sebesar|rp)\s*[:=]?\s*(\d+(?:[.,]\d+)?\s*(?:rb|ribu|jt|juta|k\b)?|\d{3,})/i) ||
    text.match(/(\d+(?:[.,]\d+)?\s*(?:rb|ribu|k\b))\s*(?:per|\/|\s*$)/i);
  if (priceMatch) {
    const rawP = priceMatch[1].toLowerCase().trim();
    if (/(?:jt|juta)/i.test(rawP)) {
      price = Math.round(parseFloat(rawP.replace(/,/g, ".").replace(/[^\d.]/g, "")) * 1000000);
    } else if (/(?:rb|ribu|k\b)/i.test(rawP)) {
      price = Math.round(parseFloat(rawP.replace(/,/g, ".").replace(/[^\d.]/g, "")) * 1000);
    } else {
      price = parseInt(rawP.replace(/[^\d]/g, ""), 10);
    }
  }

  // 3. Extract Quantity & Unit
  let qty: number | undefined;
  let unit: string | undefined;

  const qtyExplicitMatch = text.match(/(?:kuantitas|qty|jumlah|sebanyak)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  if (qtyExplicitMatch) {
    qty = parseFloat(qtyExplicitMatch[1].replace(/,/g, "."));
  }

  // Unit explicit (e.g. satuan biji, satuan kg)
  const unitExplicitMatch = text.match(/(?:satuan)\s*[:=]?\s*([a-zA-Z]+)/i);
  if (unitExplicitMatch) {
    unit = unitExplicitMatch[1].toLowerCase().trim();
  }

  // Quantity with trailing unit (e.g. 20 kg, 150 rak, 20 biji)
  if (qty === undefined) {
    const qtyUnitMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilogram|rak|biji|butir|ekor|jerigen|liter|ikat|ember|karung|bungkus|paket|gram|ons)\b/i);
    if (qtyUnitMatch) {
      qty = parseFloat(qtyUnitMatch[1].replace(/,/g, "."));
      if (!unit) unit = qtyUnitMatch[2].toLowerCase().trim();
    }
  }

  // If unit is still not found, search for common unit words in text
  if (!unit) {
    const unitSearch = text.match(/\b(kg|kilogram|rak|biji|butir|ekor|jerigen|liter|ikat|ember|karung|bungkus|paket|gram|ons)\b/i);
    if (unitSearch) {
      unit = unitSearch[1].toLowerCase().trim();
    }
  }

  // Check pattern "jadi [number] [unit]" (e.g. "jadi 150 rak")
  if (qty === undefined) {
    const jadiQtyMatch = text.match(/\bjadi\s+(\d+(?:[.,]\d+)?)(?:\s+([a-zA-Z]+))?/i);
    if (jadiQtyMatch) {
      qty = parseFloat(jadiQtyMatch[1].replace(/,/g, "."));
      if (jadiQtyMatch[2] && !unit) {
        unit = jadiQtyMatch[2].toLowerCase().trim();
      }
    }
  }

  // 4. Extract Item Name (e.g. "ubah telur di IH001", "jadi Wortel", "bahan Wortel", "tambah di IH001 bahan Wortel")
  let targetItemName: string | undefined;
  let newItemName: string | undefined;

  // Pattern A: "ubah/ganti [item] di/pada [orderRef]" (e.g. "ubah telur di IH001")
  const itemBeforePreposition = text.match(/\b(?:ubah|ngubah|mengubah|ganti|mengganti|edit)\s+(?:pagu\s+)?(?:bahan\s+|item\s+)?([a-zA-Z\s]+?)\s+(?:di|pada|ke|dalam|menjadi|jadi)\s+/i);
  if (itemBeforePreposition) {
    const candidate = itemBeforePreposition[1].trim();
    if (
      !/^(pagu|rincian|anggaran|data|pesanan|po)$/i.test(candidate) &&
      !/^(?:SPPG\d*[-_])?(?:IH|II|TRX)\d+$/i.test(candidate)
    ) {
      targetItemName = candidate;
    }
  }

  // Pattern B: "jadi [newItem]" (e.g. "jadi Wortel kuantitas 20...")
  const jadiMatch = text.match(/\bjadi\s+([a-zA-Z\s]+?)(?:\s+(?:kuantitas|qty|jumlah|satuan|harga|sebanyak|nominal)|$)/i);
  if (jadiMatch) {
    const val = jadiMatch[1].trim();
    if (!/^\d/.test(val) && !/^(kuantitas|qty|harga|satuan|sebesar)$/i.test(val)) {
      newItemName = val;
      if (!targetItemName) {
        targetItemName = newItemName;
      }
    }
  }

  // Pattern C: "tambah/input di [orderRef] [bahan/item] [itemName]"
  if (!targetItemName && isAddAction) {
    const addAfterPOMatch = text.match(/\b(?:tambah|nambah|menambah|tambahkan|menambahkan|masukkan|input|sisip|sisipkan)\b.*?\b(?:di|pada|ke|dalam)?\s*(?:(?:SPPG\d*[-_])?(?:IH|II|TRX)\d+|\d{2}\/\d{2}\/\d{2}\/\d{2})\b.*?(?:bahan\s+|item\s+|rincian\s+baru\s+)?([a-zA-Z\s]+?)(?:\s+(?:kuantitas|qty|jumlah|satuan|harga|sebanyak|nominal|\d+)|$)/i);
    if (addAfterPOMatch) {
      const val = addAfterPOMatch[1].trim();
      if (!/^\d/.test(val) && !/^(pagu|rincian|bahan|item|baru|anggaran)$/i.test(val)) {
        targetItemName = val;
        newItemName = val;
      }
    }
  }

  // Pattern D: "tambah [bahan] [itemName] di [orderRef]"
  if (!targetItemName && isAddAction) {
    const addBeforePOMatch = text.match(/\b(?:tambah|nambah|menambah|tambahkan|menambahkan|masukkan|input|sisip|sisipkan)\s+(?:bahan\s+|item\s+|rincian\s+)?([a-zA-Z\s]+?)(?:\s+(?:di|pada|ke|dalam)\s+(?:(?:SPPG\d*[-_])?(?:IH|II|TRX)\d+|\d{2}\/\d{2}\/\d{2}\/\d{2}))/i);
    if (addBeforePOMatch) {
      const val = addBeforePOMatch[1].trim();
      if (!/^\d/.test(val) && !/^(pagu|rincian|bahan|item|baru|anggaran)$/i.test(val)) {
        targetItemName = val;
        newItemName = val;
      }
    }
  }

  // Pattern E: "bahan [itemName]" (e.g. "bahan wortel")
  if (!targetItemName) {
    const bahanMatch = text.match(/\b(?:bahan|item)\s+([a-zA-Z\s]+?)(?:\s+(?:jadi|kuantitas|qty|jumlah|satuan|harga|sebanyak|nominal|di|pada|\d+)|$)/i);
    if (bahanMatch) {
      const val = bahanMatch[1].trim();
      if (!/^\d/.test(val)) {
        targetItemName = val;
        newItemName = val;
      }
    }
  }

  // Pattern F: "tambah/nambah [itemName] [qty] [unit]..." (direct addition without PO or explicit "bahan")
  if (!targetItemName && isAddAction) {
    const addDirectMatch = text.match(/\b(?:tambah|nambah|menambah|tambahkan|menambahkan|masukkan|input|sisip|sisipkan)\s+(?:bahan\s+|item\s+)?([a-zA-Z\s]+?)(?:\s+(?:di|pada|ke|dalam|\d+|kuantitas|qty|harga|satuan|@)|$)/i);
    if (addDirectMatch) {
      const val = addDirectMatch[1].trim();
      if (!/^\d/.test(val) && !/^(pagu|rincian|bahan|item|baru|anggaran)$/i.test(val)) {
        targetItemName = val;
        newItemName = val;
      }
    }
  }

  if (targetItemName) {
    targetItemName = targetItemName.replace(/^(?:bahan|item|rincian\s+baru)\s+/i, "").trim();
    if (!newItemName) newItemName = targetItemName;
    else newItemName = newItemName.replace(/^(?:bahan|item|rincian\s+baru)\s+/i, "").trim();
  }

  // Supplier (optional)
  let supplier: string | undefined;
  const supplierMatch = text.match(/(?:supplier|toko|rekanan)\s*[:=]?\s*([a-zA-Z0-9\s]+?)(?:\s+(?:kuantitas|qty|harga|satuan)|$)/i);
  if (supplierMatch) {
    supplier = supplierMatch[1].trim();
  }

  if (!orderRef && !targetItemName && qty === undefined && price === undefined) {
    return null;
  }

  return {
    orderRef,
    targetItemName,
    newItemName,
    qty,
    unit,
    price,
    supplier,
    actionIntent,
  };
}

export async function parsePaguModificationFromText(userText: string): Promise<PaguModificationRequest | null> {
  const lower = userText.toLowerCase();
  const isAddAction = /\b(tambah|nambah|menambah|tambahkan|menambahkan|masukkan|input|sisip|sisipkan)\b/i.test(lower);

  // Layer 1 & 2: Agy CLI / Gemini LLM
  try {
    const parsed = await agyConnector.executeReasoning(
      PAGU_MODIFICATION_SYSTEM_PROMPT,
      `Analisis pesan berikut:\n"${userText}"\n\nEkstrak ke JSON:`,
      false
    );

    if (parsed && typeof parsed === "object") {
      if (isAddAction) {
        parsed.actionIntent = "ADD";
      }
      if (parsed.orderRef && typeof parsed.orderRef === "string") {
        const specificId = parsed.orderRef.match(/\b((?:SPPG\d*[-_])?(?:IH|II|TRX)\d{3,})\b/i);
        const datePo = parsed.orderRef.match(/\b(\d{2}\/\d{2}\/\d{2}\/\d{2})\b/);
        parsed.orderRef = specificId ? specificId[1].toUpperCase() : (datePo ? datePo[1] : parsed.orderRef.trim());
      }
      const validated = PaguModificationSchema.parse(parsed);
      return validated;
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, "AI parsing for pagu modification failed, using static fallback");
  }

  // Layer 3: Deterministic regex fallback
  return staticParsePaguModification(userText);
}

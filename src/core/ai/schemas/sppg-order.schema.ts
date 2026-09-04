import { z } from "zod";

export const SppgOrderItemSchema = z.object({
  no: z.number().optional().default(1),
  item_name: z.string().describe("Nama bahan makanan (contoh: Ayam, Minyak Kelapa Sawit, Wortel)"),
  qty: z.number().describe("Jumlah kuantitas"),
  unit: z.string().default("KG").describe("Satuan kuantitas (Ekor, Jerigen, KG, Keranjang, Liter, Ikat, Bungkus)"),
  price: z.number().describe("Harga pagu per satuan dalam Rupiah"),
  total_price: z.number().describe("Total pagu untuk bahan ini (qty * price)"),
  supplier_target: z.string().optional().default("Lainnya").describe("Target rekanan suplier (misal: Hj Muliadi, Ayam Pasar, Mas Pandu)"),
  category: z.string().optional().default("Bahan Pokok").describe("Kategori bahan pangan"),
});

export const SppgOrderSchema = z.object({
  type: z.literal("income").default("income").describe("Selalu bernilai 'income' karena ini pagu pendapatan hak tagih vendor"),
  sppg_unit: z.string().describe("Nama unit SPPG (contoh: SPPG Patila, Luwu Utara)"),
  order_no: z.string().describe("Nomor surat nota pesanan (contoh: 05/02/09/26)"),
  order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Tanggal pesanan format YYYY-MM-DD"),
  arrival_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Tanggal bahan tiba/digunakan format YYYY-MM-DD"),
  items: z.array(SppgOrderItemSchema).describe("Daftar seluruh 20+ bahan makanan yang dipesan"),
  total_amount: z.number().describe("Total plafon anggaran pesanan dalam Rupiah (contoh: 29581000)"),
  signed_by: z.string().optional().describe("Nama pejabat penandatangan / Ka. SPPG"),
  notes: z.string().optional().describe("Catatan atau ketentuan khusus dari SPPG"),
});

export type SppgOrderItem = z.infer<typeof SppgOrderItemSchema>;
export type SppgOrder = z.infer<typeof SppgOrderSchema>;

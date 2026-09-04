import { z } from "zod";

export const SupplierReceiptItemSchema = z.object({
  item_name: z.string().describe("Nama barang atau bahan yang dibeli dari supplier"),
  qty: z.number().default(1).describe("Jumlah kuantitas barang"),
  unit: z.string().default("unit").describe("Satuan (KG, Jerigen, Ekor, Ikat, Bungkus, Karton)"),
  price: z.number().describe("Harga satuan riil dari supplier"),
  total_price: z.number().describe("Total harga belanja item ini (qty * price)"),
});

export const SupplierReceiptSchema = z.object({
  type: z.literal("expense").default("expense").describe("Selalu bernilai 'expense' karena ini pengeluaran belanja riil vendor"),
  supplier_name: z.string().describe("Nama toko / supplier pasar (contoh: Hj Muliadi, Ayam Pasar, Mas Pandu)"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Tanggal transaksi faktur YYYY-MM-DD"),
  sppg_ref_no: z.string().optional().default("").describe("Nomor referensi SPPG terkait jika ada"),
  items: z.array(SupplierReceiptItemSchema).default([]).describe("Daftar rincian item barang"),
  subtotal: z.number().default(0).describe("Subtotal belanja sebelum diskon/pajak"),
  discount: z.number().default(0).describe("Diskon jika ada"),
  tax: z.number().default(0).describe("Pajak jika ada"),
  total_amount: z.number().describe("Total akhir yang dibayarkan ke supplier dalam Rupiah"),
  payment_method: z.string().default("Cash").describe("Metode pembayaran (Cash, Transfer BCA, BRI, Mandiri)"),
  notes: z.string().optional().describe("Keterangan tambahan dari nota belanja"),
});

export type SupplierReceiptItem = z.infer<typeof SupplierReceiptItemSchema>;
export type SupplierReceipt = z.infer<typeof SupplierReceiptSchema>;

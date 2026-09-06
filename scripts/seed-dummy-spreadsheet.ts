import { googleSheetsService } from "../src/core/google/sheets.service.js";
import { env } from "../src/config/env.js";
import { SHEET_NAMES } from "../src/core/google/sheets-recipes.js";
import type { SppgOrder } from "../src/core/ai/schemas/sppg-order.schema.js";
import type { SupplierReceipt } from "../src/core/ai/schemas/supplier-receipt.schema.js";

async function seedSpreadsheet() {
  const spreadsheetId = env.GOOGLE_SHEET_ID_PATILA;
  console.log(`🚀 Menginjeksi data dummy ke Google Sheets SPPG Patila (${spreadsheetId})...`);

  const client = await (googleSheetsService as any).getClient();

  // 0. Bersihkan baris data lama (baris 2 ke bawah) agar tidak terduplikasi
  console.log("🧹 Membersihkan data baris transaksi lama di Google Sheets...");
  await Promise.all([
    client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.PAGU_RINGKASAN}'!A2:Z1000` }).catch(() => {}),
    client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.PAGU_RINCIAN}'!A2:Z1000` }).catch(() => {}),
    client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.PENGELUARAN_SUPPLIER}'!A2:Z1000` }).catch(() => {}),
    client.spreadsheets.values.clear({ spreadsheetId, range: `'${SHEET_NAMES.REKAP_MARGIN}'!A2:Z1000` }).catch(() => {}),
  ]);

  // Refresh struktur 5-tab, header Kolom A (No SPPG Ref), styling, dan formula Dashboard
  console.log("🎨 Memperbarui formula dashboard dan header resmi BGN (No SPPG Ref di Kolom A)...");
  await googleSheetsService.ensure5TabStructure(spreadsheetId, true);

  // 1. Data Pesanan BGN (Pemasukan / Pagu)
  const sppgOrder: SppgOrder = {
    type: "income",
    sppg_unit: "SPPG Patila, Luwu Utara",
    order_no: "05/02/09/26",
    order_date: "2026-09-02",
    arrival_date: "2026-09-02",
    total_amount: 29581000,
    signed_by: "Heizaaa (Ka. SPPG Patila)",
    notes: "Surat Pesanan Resmi BGN No. 05/02/09/26 untuk Menu Sehat Dapur Patila",
    items: [
      { no: 1, item_name: "Beras Premium", qty: 140, unit: "KG", price: 14500, total_price: 2030000, supplier_target: "Mas Pandu", category: "Bahan Pokok" },
      { no: 2, item_name: "Daging Ayam Broiler", qty: 120, unit: "KG", price: 40000, total_price: 4800000, supplier_target: "Ayam Pasar", category: "Protein Hewani" },
      { no: 3, item_name: "Telur Ayam Ras", qty: 60, unit: "KG", price: 30000, total_price: 1800000, supplier_target: "Ayam Pasar", category: "Protein Hewani" },
      { no: 4, item_name: "Daging Sapi Segar", qty: 35, unit: "KG", price: 135000, total_price: 4725000, supplier_target: "Mas Pandu", category: "Protein Hewani" },
      { no: 5, item_name: "Ikan Tongkol Segar", qty: 50, unit: "KG", price: 32000, total_price: 1600000, supplier_target: "Mas Pandu", category: "Protein Hewani" },
      { no: 6, item_name: "Tempe Kedelai Murni", qty: 100, unit: "Papan", price: 5000, total_price: 500000, supplier_target: "Hj Muliadi", category: "Protein Nabati" },
      { no: 7, item_name: "Tahu Putih Segar", qty: 150, unit: "Potong", price: 2000, total_price: 300000, supplier_target: "Hj Muliadi", category: "Protein Nabati" },
      { no: 8, item_name: "Wortel Segar", qty: 45, unit: "KG", price: 18000, total_price: 810000, supplier_target: "Hj Muliadi", category: "Sayuran Segar" },
      { no: 9, item_name: "Sayur Bayam Hijau", qty: 60, unit: "Ikat", price: 4000, total_price: 240000, supplier_target: "Hj Muliadi", category: "Sayuran Segar" },
      { no: 10, item_name: "Buncis Segar", qty: 35, unit: "KG", price: 20000, total_price: 700000, supplier_target: "Hj Muliadi", category: "Sayuran Segar" },
      { no: 11, item_name: "Brokoli Segar", qty: 30, unit: "KG", price: 35000, total_price: 1050000, supplier_target: "Hj Muliadi", category: "Sayuran Segar" },
      { no: 12, item_name: "Buah Pisang Cavendish", qty: 80, unit: "Sisir", price: 25000, total_price: 2000000, supplier_target: "Best Fruit", category: "Buah Segar" },
      { no: 13, item_name: "Buah Jeruk Manis", qty: 75, unit: "KG", price: 24000, total_price: 1800000, supplier_target: "Best Fruit", category: "Buah Segar" },
      { no: 14, item_name: "Buah Semangka Merah", qty: 110, unit: "KG", price: 10000, total_price: 1100000, supplier_target: "Best Fruit", category: "Buah Segar" },
      { no: 15, item_name: "Minyak Goreng Sawit", qty: 40, unit: "Liter", price: 17500, total_price: 700000, supplier_target: "Mas Pandu", category: "Bahan Pokok" },
      { no: 16, item_name: "Gula Pasir Putih", qty: 25, unit: "KG", price: 18000, total_price: 450000, supplier_target: "Mas Pandu", category: "Bahan Pokok" },
      { no: 17, item_name: "Garam Beryodium", qty: 15, unit: "Bungkus", price: 6000, total_price: 90000, supplier_target: "Mas Pandu", category: "Bumbu Dapur" },
      { no: 18, item_name: "Bawang Merah Super", qty: 20, unit: "KG", price: 38000, total_price: 760000, supplier_target: "Hj Muliadi", category: "Bumbu Dapur" },
      { no: 19, item_name: "Bawang Putih Kating", qty: 18, unit: "KG", price: 42000, total_price: 756000, supplier_target: "Hj Muliadi", category: "Bumbu Dapur" },
      { no: 20, item_name: "Cabai Merah Keriting", qty: 15, unit: "KG", price: 45000, total_price: 675000, supplier_target: "Hj Muliadi", category: "Bumbu Dapur" },
      { no: 21, item_name: "Susu UHT MBG 200ml", qty: 500, unit: "Kotak", price: 5000, total_price: 2500000, supplier_target: "Mas Pandu", category: "Minuman Bergizi" },
      { no: 22, item_name: "Kotak Kemasan MBG", qty: 500, unit: "Pcs", price: 1790, total_price: 895000, supplier_target: "Mas Pandu", category: "Perlengkapan" },
    ],
  };

  console.log("\n[1/5] Menulis Pagu Pesanan BGN ke 02_PAGU_RINGKASAN, 03_PAGU_RINCIAN, & 05_REKAP_MARGIN...");
  await googleSheetsService.recordSppgOrder(
    spreadsheetId,
    sppgOrder,
    "https://drive.google.com/open?id=1_dummy_surat_pesanan_bgn_05020926",
    "Surat Pesanan BGN 05/02/09/26 - Pagu Rp 29.581.000",
    "Heizaaa (Ka. SPPG)"
  );
  console.log("✅ Pagu BGN berhasil dicatat!");

  // 2. Realisasi Pengeluaran Supplier 1: Ayam Pasar
  console.log("\n[2/5] Menulis Realisasi Pengeluaran Supplier: Ayam Pasar...");
  const receiptAyam: SupplierReceipt = {
    type: "expense",
    supplier_name: "Ayam Pasar",
    date: "2026-09-02",
    sppg_ref_no: "05/02/09/26",
    subtotal: 6390000,
    discount: 0,
    tax: 0,
    total_amount: 6390000,
    payment_method: "Cash",
    notes: "Faktur Pembelian Ayam Broiler & Telur Ayam Segar",
    items: [
      { item_name: "Daging Ayam Broiler", qty: 120, unit: "KG", price: 38500, total_price: 4620000 },
      { item_name: "Telur Ayam Ras", qty: 60, unit: "KG", price: 29500, total_price: 1770000 },
    ],
  };
  await googleSheetsService.recordSupplierExpense(
    spreadsheetId,
    receiptAyam,
    "https://drive.google.com/open?id=1_dummy_nota_ayam_pasar",
    "Ayah",
    "Nota Ayam Pasar - Realisasi Rp 6.390.000"
  );
  console.log("✅ Faktur Ayam Pasar berhasil dicatat & dicocokkan!");

  // 3. Realisasi Pengeluaran Supplier 2: Hj Muliadi (Sayur & Bumbu)
  console.log("\n[3/5] Menulis Realisasi Pengeluaran Supplier: Hj Muliadi...");
  const receiptMuliadi: SupplierReceipt = {
    type: "expense",
    supplier_name: "Hj Muliadi",
    date: "2026-09-02",
    sppg_ref_no: "05/02/09/26",
    subtotal: 5658000,
    discount: 0,
    tax: 0,
    total_amount: 5658000,
    payment_method: "Transfer BRI",
    notes: "Nota Pasar Segar Hj Muliadi untuk Sayur Mayur & Bumbu",
    items: [
      { item_name: "Tempe Kedelai Murni", qty: 100, unit: "Papan", price: 5000, total_price: 500000 },
      { item_name: "Tahu Putih Segar", qty: 150, unit: "Potong", price: 2000, total_price: 300000 },
      { item_name: "Wortel Segar", qty: 45, unit: "KG", price: 17000, total_price: 765000 },
      { item_name: "Sayur Bayam Hijau", qty: 60, unit: "Ikat", price: 4000, total_price: 240000 },
      { item_name: "Buncis Segar", qty: 35, unit: "KG", price: 19000, total_price: 665000 },
      { item_name: "Brokoli Segar", qty: 30, unit: "KG", price: 35000, total_price: 1050000 },
      { item_name: "Bawang Merah Super", qty: 20, unit: "KG", price: 37000, total_price: 740000 },
      { item_name: "Bawang Putih Kating", qty: 18, unit: "KG", price: 41000, total_price: 738000 },
      { item_name: "Cabai Merah Keriting", qty: 15, unit: "KG", price: 44000, total_price: 660000 },
    ],
  };
  await googleSheetsService.recordSupplierExpense(
    spreadsheetId,
    receiptMuliadi,
    "https://drive.google.com/open?id=1_dummy_nota_hj_muliadi",
    "Ayah",
    "Nota Hj Muliadi - Realisasi Rp 5.658.000"
  );
  console.log("✅ Faktur Hj Muliadi berhasil dicatat & dicocokkan!");

  // 4. Realisasi Pengeluaran Supplier 3: Best Fruit (Buah Segar)
  console.log("\n[4/5] Menulis Realisasi Pengeluaran Supplier: Best Fruit...");
  const receiptFruit: SupplierReceipt = {
    type: "expense",
    supplier_name: "Best Fruit",
    date: "2026-09-02",
    sppg_ref_no: "05/02/09/26",
    subtotal: 4900000,
    discount: 0,
    tax: 0,
    total_amount: 4900000,
    payment_method: "Cash",
    notes: "Faktur Toko Buah Segar Best Fruit",
    items: [
      { item_name: "Buah Pisang Cavendish", qty: 80, unit: "Sisir", price: 25000, total_price: 2000000 },
      { item_name: "Buah Jeruk Manis", qty: 75, unit: "KG", price: 24000, total_price: 1800000 },
      { item_name: "Buah Semangka Merah", qty: 110, unit: "KG", price: 10000, total_price: 1100000 },
    ],
  };
  await googleSheetsService.recordSupplierExpense(
    spreadsheetId,
    receiptFruit,
    "https://drive.google.com/open?id=1_dummy_nota_best_fruit",
    "Ayah",
    "Nota Best Fruit - Realisasi Rp 4.900.000"
  );
  console.log("✅ Faktur Best Fruit berhasil dicatat & dicocokkan!");

  // 5. Realisasi Pengeluaran Supplier 4: Mas Pandu (Sembako & Daging Sapi)
  console.log("\n[5/5] Menulis Realisasi Pengeluaran Supplier: Mas Pandu...");
  const receiptPandu: SupplierReceipt = {
    type: "expense",
    supplier_name: "Mas Pandu",
    date: "2026-09-02",
    sppg_ref_no: "05/02/09/26",
    subtotal: 13095000,
    discount: 0,
    tax: 0,
    total_amount: 13095000,
    payment_method: "Transfer BCA",
    notes: "Faktur Toko Sembako Mas Pandu (Daging Sapi sedikit naik dari Rp 135rb ke Rp 138rb)",
    items: [
      { item_name: "Beras Premium", qty: 140, unit: "KG", price: 14500, total_price: 2030000 },
      { item_name: "Daging Sapi Segar", qty: 35, unit: "KG", price: 138000, total_price: 4830000 }, // Over budget
      { item_name: "Ikan Tongkol Segar", qty: 50, unit: "KG", price: 32000, total_price: 1600000 },
      { item_name: "Minyak Goreng Sawit", qty: 40, unit: "Liter", price: 17500, total_price: 700000 },
      { item_name: "Gula Pasir Putih", qty: 25, unit: "KG", price: 18000, total_price: 450000 },
      { item_name: "Garam Beryodium", qty: 15, unit: "Bungkus", price: 6000, total_price: 90000 },
      { item_name: "Susu UHT MBG 200ml", qty: 500, unit: "Kotak", price: 5000, total_price: 2500000 },
      { item_name: "Kotak Kemasan MBG", qty: 500, unit: "Pcs", price: 1790, total_price: 895000 },
    ],
  };
  await googleSheetsService.recordSupplierExpense(
    spreadsheetId,
    receiptPandu,
    "https://drive.google.com/open?id=1_dummy_nota_mas_pandu",
    "Ayah",
    "Nota Mas Pandu - Realisasi Rp 13.095.000"
  );
  console.log("✅ Faktur Mas Pandu berhasil dicatat & dicocokkan!");

  console.log("\n🎉 SELURUH DATA DUMMY BERHASIL DIINJEKSI KE GOOGLE SHEETS SPPG PATILA!");
}

seedSpreadsheet().catch(console.error);

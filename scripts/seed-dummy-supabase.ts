import { getSupabaseClient } from "../src/core/db/supabase.js";

async function seedDummyData() {
  const supabase = getSupabaseClient();
  const sppgId = "sppg_patila";
  const userId = 7546537134; // Super Admin Heizaaa

  console.log("🚀 Memulai injeksi data dummy ke Supabase...");

  // 1. Injeksi 1 Pemasukan dari BGN (SPPG Order)
  const orderNo = "05/02/09/26";
  const orderDate = "2026-09-02";
  const arrivalDate = "2026-09-02";
  const totalAmount = 29581000;

  console.log(`\n[1/3] Menambahkan 1 Pesanan BGN: No ${orderNo} (Rp ${totalAmount.toLocaleString("id-ID")})...`);

  // Hapus data dummy lama jika sudah ada dengan orderNo ini agar bersih & idempotent
  const { data: existingOrders } = await supabase
    .from("sppg_orders")
    .select("id")
    .eq("order_no", orderNo)
    .eq("sppg_id", sppgId);

  if (existingOrders && existingOrders.length > 0) {
    const ids = existingOrders.map((o) => o.id);
    await supabase.from("sppg_order_items").delete().in("order_id", ids);
    await supabase.from("sppg_orders").delete().in("id", ids);
    console.log(`🧹 Membersihkan ${existingOrders.length} data order lama dengan No ${orderNo}`);
  }

  const { data: newOrder, error: errOrder } = await supabase
    .from("sppg_orders")
    .insert({
      sppg_id: sppgId,
      order_no: orderNo,
      order_date: orderDate,
      arrival_date: arrivalDate,
      total_amount: totalAmount,
      signed_by: "Heizaaa (Kepala SPPG Patila)",
      created_by: userId,
    })
    .select()
    .single();

  if (errOrder || !newOrder) {
    throw new Error(`Gagal insert sppg_orders: ${errOrder?.message}`);
  }

  console.log(`✅ Berhasil insert sppg_orders dengan ID: ${newOrder.id}`);

  // 2. Injeksi 22 Item Rincian Bahan Makanan ke sppg_order_items
  console.log(`\n[2/3] Menambahkan 22 Rincian Item Bahan untuk Order ID: ${newOrder.id}...`);

  const dummyItems = [
    { item_name: "Beras Premium", qty: 140, unit: "KG", price: 14500, total_price: 2030000, supplier_target: "Mas Pandu" },
    { item_name: "Daging Ayam Broiler", qty: 120, unit: "KG", price: 40000, total_price: 4800000, supplier_target: "Ayam Pasar" },
    { item_name: "Telur Ayam Ras", qty: 60, unit: "KG", price: 30000, total_price: 1800000, supplier_target: "Ayam Pasar" },
    { item_name: "Daging Sapi Segar", qty: 35, unit: "KG", price: 135000, total_price: 4725000, supplier_target: "Mas Pandu" },
    { item_name: "Ikan Tongkol Segar", qty: 50, unit: "KG", price: 32000, total_price: 1600000, supplier_target: "Mas Pandu" },
    { item_name: "Tempe Kedelai Murni", qty: 100, unit: "Papan", price: 5000, total_price: 500000, supplier_target: "Hj Muliadi" },
    { item_name: "Tahu Putih Segar", qty: 150, unit: "Potong", price: 2000, total_price: 300000, supplier_target: "Hj Muliadi" },
    { item_name: "Wortel Segar", qty: 45, unit: "KG", price: 18000, total_price: 810000, supplier_target: "Hj Muliadi" },
    { item_name: "Sayur Bayam Hijau", qty: 60, unit: "Ikat", price: 4000, total_price: 240000, supplier_target: "Hj Muliadi" },
    { item_name: "Buncis Segar", qty: 35, unit: "KG", price: 20000, total_price: 700000, supplier_target: "Hj Muliadi" },
    { item_name: "Brokoli Segar", qty: 30, unit: "KG", price: 35000, total_price: 1050000, supplier_target: "Hj Muliadi" },
    { item_name: "Buah Pisang Cavendish", qty: 80, unit: "Sisir", price: 25000, total_price: 2000000, supplier_target: "Best Fruit" },
    { item_name: "Buah Jeruk Manis", qty: 75, unit: "KG", price: 24000, total_price: 1800000, supplier_target: "Best Fruit" },
    { item_name: "Buah Semangka Merah", qty: 110, unit: "KG", price: 10000, total_price: 1100000, supplier_target: "Best Fruit" },
    { item_name: "Minyak Goreng Sawit", qty: 40, unit: "Liter", price: 17500, total_price: 700000, supplier_target: "Mas Pandu" },
    { item_name: "Gula Pasir Putih", qty: 25, unit: "KG", price: 18000, total_price: 450000, supplier_target: "Mas Pandu" },
    { item_name: "Garam Beryodium", qty: 15, unit: "Bungkus", price: 6000, total_price: 90000, supplier_target: "Mas Pandu" },
    { item_name: "Bawang Merah Super", qty: 20, unit: "KG", price: 38000, total_price: 760000, supplier_target: "Hj Muliadi" },
    { item_name: "Bawang Putih Kating", qty: 18, unit: "KG", price: 42000, total_price: 756000, supplier_target: "Hj Muliadi" },
    { item_name: "Cabai Merah Keriting", qty: 15, unit: "KG", price: 45000, total_price: 675000, supplier_target: "Hj Muliadi" },
    { item_name: "Susu UHT MBG 200ml", qty: 500, unit: "Kotak", price: 5000, total_price: 2500000, supplier_target: "Mas Pandu" },
    { item_name: "Kotak Kemasan MBG", qty: 500, unit: "Pcs", price: 1790, total_price: 895000, supplier_target: "Mas Pandu" },
  ];

  const orderItemsData = dummyItems.map((item) => ({
    order_id: newOrder.id,
    item_name: item.item_name,
    qty: item.qty,
    unit: item.unit,
    price: item.price,
    total_price: item.total_price,
    supplier_target: item.supplier_target,
  }));

  const { data: insertedItems, error: errItems } = await supabase
    .from("sppg_order_items")
    .insert(orderItemsData)
    .select();

  if (errItems) {
    throw new Error(`Gagal insert sppg_order_items: ${errItems.message}`);
  }

  console.log(`✅ Berhasil insert ${insertedItems.length} item bahan ke sppg_order_items.`);

  // 3. Injeksi Beragam Pengeluaran Supplier ke sppg_supplier_expenses
  console.log(`\n[3/3] Menambahkan 4 Pengeluaran Supplier Beragam (Ayam Pasar, Hj Muliadi, Best Fruit, Mas Pandu)...`);

  // Hapus data pengeluaran lama dengan ref ini agar idempotent
  await supabase
    .from("sppg_supplier_expenses")
    .delete()
    .eq("sppg_ref_no", orderNo)
    .eq("sppg_id", sppgId);

  const dummyExpenses = [
    {
      sppg_id: sppgId,
      sppg_ref_no: orderNo,
      supplier_name: "Ayam Pasar",
      transaction_date: orderDate,
      items_summary: "Daging Ayam Broiler 120 kg, Telur Ayam Ras 60 kg",
      total_amount: 6400000, // Pagu 6.600.000 -> Hemat Rp 200.000
      drive_url: "https://drive.google.com/open?id=1x9_dummy_nota_ayam_pasar",
      created_by: userId,
    },
    {
      sppg_id: sppgId,
      sppg_ref_no: orderNo,
      supplier_name: "Hj Muliadi",
      transaction_date: orderDate,
      items_summary: "Tempe, Tahu, Wortel, Bayam, Buncis, Brokoli, Bawang Merah/Putih, Cabai",
      total_amount: 5250000, // Pagu 5.291.000 -> Hemat Rp 41.000
      drive_url: "https://drive.google.com/open?id=1x9_dummy_nota_hj_muliadi",
      created_by: 7591684041, // Ayah
    },
    {
      sppg_id: sppgId,
      sppg_ref_no: orderNo,
      supplier_name: "Best Fruit",
      transaction_date: orderDate,
      items_summary: "Pisang Cavendish 80 sisir, Jeruk Manis 75 kg, Semangka Merah 110 kg",
      total_amount: 4900000, // Pagu 4.900.000 -> Pas (Rp 0 selisih)
      drive_url: "https://drive.google.com/open?id=1x9_dummy_nota_best_fruit",
      created_by: userId,
    },
    {
      sppg_id: sppgId,
      sppg_ref_no: orderNo,
      supplier_name: "Mas Pandu",
      transaction_date: orderDate,
      items_summary: "Beras Premium, Daging Sapi Segar, Ikan Tongkol, Sembako & Minyak, Kemasan",
      total_amount: 12850000, // Pagu 12.790.000 -> Over budget Rp 60.000 (Daging sapi sedikit naik)
      drive_url: "https://drive.google.com/open?id=1x9_dummy_nota_mas_pandu",
      created_by: 7591684041, // Ayah
    },
  ];

  const { data: insertedExpenses, error: errExpenses } = await supabase
    .from("sppg_supplier_expenses")
    .insert(dummyExpenses)
    .select();

  if (errExpenses) {
    throw new Error(`Gagal insert sppg_supplier_expenses: ${errExpenses.message}`);
  }

  console.log(`✅ Berhasil insert ${insertedExpenses.length} transaksi pengeluaran supplier.`);

  console.log(`\n🎉 SEED DATA DUMMY SUPABASE SELESAI!`);
}

seedDummyData().catch(console.error);

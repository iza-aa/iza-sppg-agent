import { getSupabaseClient } from "../src/core/db/supabase.js";

async function verifySeeded() {
  const supabase = getSupabaseClient();

  console.log("=================================================");
  console.log("         VERIFIKASI DATA DUMMY SUPABASE          ");
  console.log("=================================================\n");

  // 1. Ambil Order
  const { data: orders, error: errOrder } = await supabase
    .from("sppg_orders")
    .select(`
      id,
      sppg_id,
      order_no,
      order_date,
      total_amount,
      signed_by,
      sppg_order_items (
        id,
        item_name,
        qty,
        unit,
        price,
        total_price,
        supplier_target
      )
    `);

  if (errOrder) {
    console.error("Error fetching orders:", errOrder);
    return;
  }

  console.log(`📌 TABEL sppg_orders (${orders?.length} Data Pemasukan Pagu):`);
  for (const o of orders || []) {
    console.log(`  • ID Order    : ${o.id}`);
    console.log(`  • No SPPG     : ${o.order_no}`);
    console.log(`  • Tanggal     : ${o.order_date}`);
    console.log(`  • Total Pagu  : Rp ${Number(o.total_amount).toLocaleString("id-ID")}`);
    console.log(`  • Penanggung  : ${o.signed_by}`);
    console.log(`  • Jumlah Item : ${(o as any).sppg_order_items?.length} Bahan Makanan`);

    console.log("\n  Contoh Rincian Bahan (5 dari 22 item):");
    const sampleItems = ((o as any).sppg_order_items || []).slice(0, 5);
    for (const item of sampleItems) {
      console.log(`    - ${item.item_name}: ${item.qty} ${item.unit} @ Rp ${Number(item.price).toLocaleString("id-ID")} = Rp ${Number(item.total_price).toLocaleString("id-ID")} (Target: ${item.supplier_target})`);
    }
  }

  // 2. Ambil Pengeluaran Supplier
  const { data: expenses, error: errExpenses } = await supabase
    .from("sppg_supplier_expenses")
    .select("*")
    .order("total_amount", { ascending: false });

  if (errExpenses) {
    console.error("Error fetching expenses:", errExpenses);
    return;
  }

  console.log(`\n📌 TABEL sppg_supplier_expenses (${expenses?.length} Data Realisasi Supplier):`);
  let totalExpenses = 0;
  for (const exp of expenses || []) {
    totalExpenses += Number(exp.total_amount);
    console.log(`  • [${exp.supplier_name}] No Ref: ${exp.sppg_ref_no}`);
    console.log(`    - Nominal      : Rp ${Number(exp.total_amount).toLocaleString("id-ID")}`);
    console.log(`    - Uraian       : ${exp.items_summary}`);
    console.log(`    - Bukti Nota   : ${exp.drive_url}`);
  }

  const pagu = orders && orders.length > 0 ? Number(orders[0].total_amount) : 0;
  const marginRp = pagu - totalExpenses;
  const marginPct = pagu > 0 ? ((marginRp / pagu) * 100).toFixed(2) : "0";

  console.log("\n=================================================");
  console.log("            REKAP MARGIN SPPG PATILA             ");
  console.log("=================================================");
  console.log(`Total Pagu Anggaran BGN : Rp ${pagu.toLocaleString("id-ID")}`);
  console.log(`Total Realisasi Belanja : Rp ${totalExpenses.toLocaleString("id-ID")}`);
  console.log(`Margin Bersih           : Rp ${marginRp.toLocaleString("id-ID")} (${marginPct}%)`);
  console.log(`Status Evaluasi         : ${marginRp >= 0 ? "🟢 HEMAT / SURPLUS" : "🔴 OVER BUDGET"}`);
  console.log("=================================================\n");
}

verifySeeded().catch(console.error);

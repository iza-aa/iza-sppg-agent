import { getSupabaseClient } from "../src/core/db/supabase.js";

async function checkData() {
  const supabase = getSupabaseClient();

  console.log("Checking Supabase tables...");

  const { data: users, error: errUsers } = await supabase.from("sppg_users").select("*");
  console.log("sppg_users:", errUsers ? errUsers.message : users);

  const { data: orders, error: errOrders } = await supabase.from("sppg_orders").select("*");
  console.log("sppg_orders:", errOrders ? errOrders.message : `${orders?.length} rows`);

  const { data: items, error: errItems } = await supabase.from("sppg_order_items").select("*");
  console.log("sppg_order_items:", errItems ? errItems.message : `${items?.length} rows`);

  const { data: expenses, error: errExpenses } = await supabase.from("sppg_supplier_expenses").select("*");
  console.log("sppg_supplier_expenses:", errExpenses ? errExpenses.message : `${expenses?.length} rows`);
}

checkData().catch(console.error);

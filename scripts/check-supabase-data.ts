import { getSupabaseClient } from "../src/core/db/supabase.js";

async function checkData() {
  const supabase = getSupabaseClient();

  console.log("Checking Supabase tables...");

  const { data: users, error: errUsers } = await supabase.from("sppg_users").select("*");
  console.log("sppg_users:", errUsers ? errUsers.message : users);

  const { data: orders, error: errOrders } = await supabase.from("sppg_orders").select("*").limit(1);
  console.log("sample sppg_orders:", orders?.[0]);

  const { data: items, error: errItems } = await supabase.from("sppg_order_items").select("*").limit(1);
  console.log("sample sppg_order_items:", items?.[0]);

  const { data: expenses, error: errExpenses } = await supabase.from("sppg_supplier_expenses").select("*").limit(1);
  console.log("sample sppg_supplier_expenses:", expenses?.[0]);
}

checkData().catch(console.error);

import { getSupabaseClient } from "../src/core/db/supabase.js";

async function checkData() {
  const supabase = getSupabaseClient();

  console.log("Checking Supabase tables...");

  const { data: users, error: errUsers } = await supabase.from("sppg_users").select("*");
  console.log("sppg_users:", errUsers ? errUsers.message : users);

  const { data: pending, error: errPending } = await supabase
    .from("sppg_pending_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("Recent sppg_pending_actions:", JSON.stringify(pending, null, 2));

  const { data: expenses, error: errExpenses } = await supabase
    .from("sppg_supplier_expenses")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("Recent sppg_supplier_expenses:", JSON.stringify(expenses, null, 2));

  const { data: orders, error: errOrders } = await supabase
    .from("sppg_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("Recent sppg_orders:", JSON.stringify(orders, null, 2));
}

checkData().catch(console.error);

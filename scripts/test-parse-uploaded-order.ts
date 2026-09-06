import fs from "fs";
import { parseSppgOrderFromImage } from "../src/core/ai/parsers/sppg-order.parser.js";

async function testParse() {
  const imgPath = "/Users/heizaaa/.gemini/antigravity/brain/8afe39ef-6fb4-49ee-8b60-22f5adcb21f3/.user_uploaded/media_1788603247247.png";
  const buffer = fs.readFileSync(imgPath);
  console.log("Parsing image with Gemini Vision...");
  const result = await parseSppgOrderFromImage(buffer, "image/png", "SPPG Patila, Luwu Utara");
  console.log("\n=== PARSED SPPG ORDER RESULT ===");
  console.log(`Unit: ${result.sppg_unit}`);
  console.log(`No SPPG: ${result.order_no}`);
  console.log(`Tanggal Pesanan: ${result.order_date}`);
  console.log(`Total Pagu: Rp ${result.total_amount.toLocaleString("id-ID")}`);
  console.log(`Jumlah Item: ${result.items.length}`);
  console.log(`Penandatangan: ${result.signed_by}`);
  console.log(`\nSample 5 Items:`);
  result.items.slice(0, 5).forEach((it, idx) => {
    console.log(`  ${idx+1}. ${it.item_name} | Qty: ${it.qty} ${it.unit} | Harga: Rp ${it.price.toLocaleString("id-ID")} | Total: Rp ${it.total_price.toLocaleString("id-ID")} | Supplier: ${it.supplier_target}`);
  });
}

testParse().catch(console.error);

import { googleSheetsService } from "../src/core/google/sheets.service.js";
import { env } from "../src/config/env.js";

async function runMasterSync() {
  console.log("=================================================");
  console.log("      MENYESUAIKAN & MENYINKRONKAN MASTER DASHBOARD     ");
  console.log("=================================================\n");

  const masterId = env.GOOGLE_SHEET_ID_MASTER;
  console.log(`Master Spreadsheet ID: ${masterId}`);

  console.log("\n[1/3] Memperbarui struktur, formula visual, styling, dan filter Tab Master...");
  await googleSheetsService.ensureMasterDashboardStructure(masterId, true);
  console.log("✅ Struktur dan filter Master Dashboard berhasil diperbarui!");

  console.log("\n[2/3] Membersihkan data dummy lama dan menarik data transaksi riil dari seluruh unit...");
  const syncResult = await googleSheetsService.syncAllUnitsToMaster(true);
  console.log(`✅ Berhasil menyinkronkan ${syncResult.syncedCount} transaksi ke Master Dashboard!`);

  console.log("\n[3/3] Memverifikasi data pada Master Dashboard...");
  const client = await (googleSheetsService as any).getClient();

  const trxRes = await client.spreadsheets.values.get({
    spreadsheetId: masterId,
    range: "02_SEMUA_TRANSAKSI!A1:K10",
  });
  console.log(`\n📌 02_SEMUA_TRANSAKSI (${trxRes.data.values?.length} baris):`);
  trxRes.data.values?.forEach((r: any, idx: number) => {
    console.log(`  [Row ${idx + 1}]`, JSON.stringify(r));
  });

  const kpiRes = await client.spreadsheets.values.get({
    spreadsheetId: masterId,
    range: "01_DASHBOARD!B5:I7",
  });
  console.log(`\n📌 01_DASHBOARD KPI:`);
  kpiRes.data.values?.forEach((r: any, idx: number) => {
    console.log(`  [Row ${idx + 5}]`, JSON.stringify(r));
  });

  console.log("\n🎉 MASTER DASHBOARD SELESAI DISESUAIKAN & DISINKRONKAN!");
}

runMasterSync().catch(console.error);

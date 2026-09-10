import { googleSheetsService } from "../src/core/google/sheets.service.js";
import { env } from "../src/config/env.js";
import { google } from "googleapis";
import path from "path";

async function run() {
  console.log("=================================================");
  console.log("🚀 MEMULAI EKSEKUSI MIGRASI 6-TAB KE GOOGLE SHEETS");
  console.log("Spreadsheet ID Patila:", env.GOOGLE_SHEET_ID_PATILA);
  console.log("=================================================\n");

  const spreadsheetId = env.GOOGLE_SHEET_ID_PATILA;

  // 1. Eksekusi migrasi & penataan tab
  console.log("1. Menjalankan ensure5TabStructure (rename, insert Tab 05, backfill, formula)...");
  await googleSheetsService.ensure5TabStructure(spreadsheetId, true);
  console.log("✅ ensure5TabStructure selesai dieksekusi!\n");

  // 2. Verifikasi status lembar kerja langsung dari Google Sheets API
  console.log("2. Memverifikasi daftar tab di Google Sheets...");
  const auth = new google.auth.GoogleAuth({
    keyFile: path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId });

  console.log("\nDaftar Tab Saat Ini:");
  meta.data.sheets?.forEach((s, idx) => {
    console.log(`  [${idx}] ${s.properties?.title} (ID: ${s.properties?.sheetId})`);
  });

  // 3. Verifikasi baris di Tab 04_PAGU_PENGELUARAN
  console.log("\n3. Memeriksa Tab 04_PAGU_PENGELUARAN:");
  const tab04Res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'04_PAGU_PENGELUARAN'!A1:J10",
    valueRenderOption: "FORMATTED_VALUE",
  });
  tab04Res.data.values?.forEach((r, i) => {
    console.log(`  Row ${i + 1}: ${r[0]} | ${r[1]} | ${r[3]} | ${r[5]} | ${r[9] || "-"}`);
  });

  // 4. Verifikasi baris di Tab 05_RINCIAN_PENGELUARAN (Backfill Result)
  console.log("\n4. Memeriksa Tab 05_RINCIAN_PENGELUARAN:");
  const tab05Res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'05_RINCIAN_PENGELUARAN'!A1:I30",
    valueRenderOption: "FORMATTED_VALUE",
  });
  console.log(`  Total baris di Tab 05: ${tab05Res.data.values?.length || 0}`);
  tab05Res.data.values?.slice(0, 10).forEach((r, i) => {
    console.log(`  Item ${i}: [${r[1]}] ${r[4]} | Qty: ${r[5]} ${r[6]} | Harga: ${r[7]} | Subtotal: ${r[8]}`);
  });
  if ((tab05Res.data.values?.length || 0) > 10) {
    console.log(`  ... dan ${(tab05Res.data.values?.length || 0) - 10} baris rincian lainnya.`);
  }

  // 5. Verifikasi Tab 06_PERBANDINGAN_MARGIN
  console.log("\n5. Memeriksa Tab 06_PERBANDINGAN_MARGIN:");
  const tab06Res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'06_PERBANDINGAN_MARGIN'!A1:M5",
    valueRenderOption: "FORMATTED_VALUE",
  });
  console.log(`  Header Tab 06:`, tab06Res.data.values?.[0]?.slice(0, 7).join(" | "));

  console.log("\n=================================================");
  console.log("🎉 SELURUH PROSES MIGRASI DAN BACKFILL SUKSES 100%!");
  console.log("=================================================");
}

run().catch((err) => {
  console.error("❌ Terjadi kesalahan saat migrasi:", err);
  process.exit(1);
});

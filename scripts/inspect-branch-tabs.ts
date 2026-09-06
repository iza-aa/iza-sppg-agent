import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";

async function inspectBranch() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = env.GOOGLE_SHEET_ID_PATILA;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  console.log("=== SHEETS IN BRANCH PATILA ===");
  meta.data.sheets?.forEach(s => {
    console.log(`Sheet: ${s.properties?.title} (id: ${s.properties?.sheetId})`);
  });

  for (const tab of ["02_PAGU_RINGKASAN", "03_PAGU_RINCIAN", "04_PENGELUARAN_SUPPLIER", "05_REKAP_MARGIN", "06_MASTER_DATA"]) {
    console.log(`\n=== TAB: ${tab} ===`);
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tab}'!A1:N5`,
      });
      console.log(`Values (${res.data.values?.length || 0} rows):`);
      console.log(JSON.stringify(res.data.values?.slice(1, 4) || [], null, 2));
    } catch (e: any) {
      console.log("Error getting values:", e.message);
    }
  }

  console.log("\n=== TAB: 01_DASHBOARD B9:K16 ===");
  try {
    const dashRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'01_DASHBOARD'!B9:K16",
      valueRenderOption: "FORMATTED_VALUE",
    });
    dashRes.data.values?.forEach((row, idx) => {
      console.log(`Row ${idx + 9}:`, JSON.stringify(row));
    });
  } catch (e: any) {
    console.log("Error getting dashboard values:", e.message);
  }
}

inspectBranch().catch(console.error);

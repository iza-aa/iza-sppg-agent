import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";

async function checkValidations() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.get({
    spreadsheetId: env.GOOGLE_SHEET_ID_PATILA,
    includeGridData: true,
    ranges: ["'02_PENDAPATAN_SPPG'!A2:L2", "'03_PENGELUARAN_SUPPLIER'!A2:L2"],
  });

  for (const s of res.data.sheets || []) {
    console.log(`\nSheet: ${s.properties?.title}`);
    const row = s.data?.[0]?.rowData?.[0];
    row?.values?.forEach((cell, idx) => {
      if (cell.dataValidation) {
        console.log(`  Col ${idx + 1} has validation:`, JSON.stringify(cell.dataValidation.condition));
      }
    });
  }
}

checkValidations().catch(console.error);

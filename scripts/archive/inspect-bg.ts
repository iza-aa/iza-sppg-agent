import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";

async function inspectBg() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.get({
    spreadsheetId: env.GOOGLE_SHEET_ID_PATILA,
    includeGridData: true,
    ranges: ["'02_PENDAPATAN_SPPG'!A1:E6", "'03_PENGELUARAN_SUPPLIER'!A1:E6", "'04_REKAP_MARGIN_HARIAN'!A1:E6"],
  });

  for (const s of res.data.sheets || []) {
    console.log(`\n========================================`);
    console.log(`Sheet: ${s.properties?.title}`);
    s.data?.[0]?.rowData?.forEach((r, rowIdx) => {
      const bgs = r.values?.map((c, colIdx) => {
        const bg = c.effectiveFormat?.backgroundColor;
        const hex = bg ? `r:${Math.round((bg.red||0)*255)},g:${Math.round((bg.green||0)*255)},b:${Math.round((bg.blue||0)*255)}` : "none";
        return `C${colIdx+1}[${hex}]`;
      });
      console.log(`Row ${rowIdx+1}: ${bgs?.join(" ")}`);
    });
  }
}

inspectBg().catch(console.error);

import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";

async function checkBanding() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.get({
    spreadsheetId: env.GOOGLE_SHEET_ID_PATILA,
    fields: "sheets(properties(sheetId,title),bandedRanges,data(rowData(values(userEnteredFormat(backgroundColor)))))",
  });

  for (const s of res.data.sheets || []) {
    console.log(`Sheet: ${s.properties?.title}, BandedRanges:`, s.bandedRanges?.length || 0);
    if (s.properties?.title === "03_PAGU_RINCIAN") {
      const rows = s.data?.[0]?.rowData || [];
      console.log(`  Rows count: ${rows.length}`);
      rows.slice(0, 5).forEach((r, idx) => {
        const bg = r.values?.[0]?.userEnteredFormat?.backgroundColor;
        console.log(`  Row ${idx} col 0 bg:`, bg ? JSON.stringify(bg) : "none (inherits banded range)");
      });
    }
  }
}

checkBanding().catch(console.error);

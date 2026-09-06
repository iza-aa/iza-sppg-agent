import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";

async function inspectMaster() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = env.GOOGLE_SHEET_ID_MASTER;

  console.log(`=== MASTER DASHBOARD: ${spreadsheetId} ===`);
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  meta.data.sheets?.forEach((s) => {
    console.log(`Tab: "${s.properties?.title}" (id: ${s.properties?.sheetId}, hidden: ${s.properties?.hidden})`);
  });

  for (const s of meta.data.sheets || []) {
    const title = s.properties?.title;
    if (!title) continue;
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${title}'!A1:N25`,
      });
      console.log(`\n=== Values in "${title}" (${res.data.values?.length || 0} rows) ===`);
      res.data.values?.forEach((r, idx) => {
        console.log(`[Row ${idx + 1}]`, JSON.stringify(r));
      });
    } catch (e: any) {
      console.log(`Error reading "${title}":`, e.message);
    }
  }
}

inspectMaster().catch(console.error);

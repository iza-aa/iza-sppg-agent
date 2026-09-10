import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";

async function checkBanding() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({ keyFile: keyPath, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheets = [
    { name: "Patila", id: env.GOOGLE_SHEET_ID_PATILA },
    { name: "Unit 2", id: env.GOOGLE_SHEET_ID_UNIT2 },
    { name: "Unit 3", id: env.GOOGLE_SHEET_ID_UNIT3 },
    { name: "Master", id: env.GOOGLE_SHEET_ID_MASTER },
  ];

  for (const s of spreadsheets) {
    if (!s.id) continue;
    const meta = await sheets.spreadsheets.get({ spreadsheetId: s.id });
    console.log(`=== BANDED RANGES IN ${s.name} (${s.id}) ===`);
    meta.data.sheets?.forEach((sh) => {
      const title = sh.properties?.title;
      const sheetId = sh.properties?.sheetId;
      const bandings = sh.bandedRanges || [];
      console.log(`Sheet "${title}" (id: ${sheetId}): ${bandings.length} banded range(s)`);
      bandings.forEach((b, i) => {
        console.log(`  [Banding ${i + 1}] ID: ${b.bandedRangeId}, Range:`, JSON.stringify(b.range));
      });
    });
  }
}

checkBanding().catch(console.error);

import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";

async function checkAllUnitsBanding() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({ keyFile: keyPath, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });

  const units = [
    { name: "Patila", id: env.GOOGLE_SHEET_ID_PATILA },
    { name: "Unit 2", id: env.GOOGLE_SHEET_ID_UNIT2 },
    { name: "Unit 3", id: env.GOOGLE_SHEET_ID_UNIT3 },
  ];

  for (const u of units) {
    if (!u.id) continue;
    const meta = await sheets.spreadsheets.get({ spreadsheetId: u.id });
    console.log(`=== BANDING IN ${u.name} ===`);
    meta.data.sheets?.forEach((s) => {
      const title = s.properties?.title;
      const bandings = s.bandedRanges || [];
      console.log(`  Tab "${title}": ${bandings.length} banded range(s)`);
    });
  }
}

checkAllUnitsBanding().catch(console.error);

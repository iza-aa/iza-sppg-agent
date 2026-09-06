import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";
import { createNumberFormattingBatchRequests } from "../src/core/google/sheets-recipes.js";

async function apply() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({ keyFile: keyPath, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = env.GOOGLE_SHEET_ID_PATILA;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetMap = new Map<string, number>();
  meta.data.sheets?.forEach(s => {
    if (s.properties?.title && typeof s.properties?.sheetId === "number") {
      sheetMap.set(s.properties.title, s.properties.sheetId);
    }
  });

  const reqs = createNumberFormattingBatchRequests(sheetMap);
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: reqs } });
  console.log("Applied number formatting to Patila!");
}

apply().catch(console.error);

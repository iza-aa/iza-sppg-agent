import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";

async function main() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const targetSheetId = "1ozOTR4cRFvhCJhBmnqHVhpak4C1802Ic1C_cZhe7Hi8";
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: targetSheetId,
    includeGridData: false,
  });

  const dash2 = meta.data.sheets?.find(s => s.properties?.title === "Dashboard 2");
  console.log("GridProperties:", dash2?.properties?.gridProperties);
  console.log("Merges count:", dash2?.merges?.length);
  console.log("Merges:", JSON.stringify(dash2?.merges));

  console.log("=== ROWS 1 to 14 ===");
  const resTop = await sheets.spreadsheets.values.get({
    spreadsheetId: targetSheetId,
    range: "'Dashboard 2'!A1:L14",
    valueRenderOption: "FORMULA",
  });
  resTop.data.values?.forEach((row, i) => {
    console.log(`R${i + 1}:`, JSON.stringify(row));
  });

  console.log("=== MERGES ===");
  dash2?.merges?.forEach((m) => {
    const colStart = String.fromCharCode(65 + (m.startColumnIndex ?? 0));
    const colEnd = String.fromCharCode(65 + (m.endColumnIndex ?? 0) - 1);
    const rStart = (m.startRowIndex ?? 0) + 1;
    const rEnd = m.endRowIndex ?? 0;
    console.log(`${colStart}${rStart}:${colEnd}${rEnd}`, m);
  });
}

main().catch(console.error);

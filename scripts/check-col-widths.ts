import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";

async function checkColWidths() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.get({
    spreadsheetId: env.GOOGLE_SHEET_ID_PATILA,
    fields: "sheets(properties(sheetId,title),data(columnMetadata(pixelSize)))",
  });

  for (const s of res.data.sheets || []) {
    const title = s.properties?.title;
    if (["02_PENDAPATAN_SPPG", "03_PENGELUARAN_SUPPLIER", "04_REKAP_MARGIN_HARIAN"].includes(title || "")) {
      console.log(`\nCol widths for ${title}:`);
      const widths = s.data?.[0]?.columnMetadata?.map((c, i) => `Col ${i+1}: ${c.pixelSize}px`);
      console.log(widths?.join(", "));
    }
  }
}

checkColWidths().catch(console.error);

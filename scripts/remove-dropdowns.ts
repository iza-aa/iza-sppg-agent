import { google, sheets_v4 } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";

async function removeDropdowns() {
  const keyPath = path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_PATH);
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const branches = [
    { name: "Patila", id: env.GOOGLE_SHEET_ID_PATILA },
    { name: "Unit 2", id: env.GOOGLE_SHEET_ID_UNIT2 },
    { name: "Unit 3", id: env.GOOGLE_SHEET_ID_UNIT3 },
  ];

  for (const b of branches) {
    if (!b.id) continue;
    console.log(`Removing dropdowns for ${b.name}...`);

    const meta = await sheets.spreadsheets.get({ spreadsheetId: b.id });
    const sheetMap = new Map<string, number>();
    meta.data.sheets?.forEach((s) => {
      if (s.properties?.title && typeof s.properties?.sheetId === "number") {
        sheetMap.set(s.properties.title, s.properties.sheetId);
      }
    });

    const id02 = sheetMap.get("02_PENDAPATAN_SPPG");
    const id03 = sheetMap.get("03_PENGELUARAN_SUPPLIER");

    const requests: sheets_v4.Schema$Request[] = [];

    if (id02 !== undefined) {
      requests.push({
        setDataValidation: {
          range: {
            sheetId: id02,
            startRowIndex: 1,
            endRowIndex: 2000,
            startColumnIndex: 0,
            endColumnIndex: 12,
          },
          // omitting rule removes validation
        },
      });
    }

    if (id03 !== undefined) {
      requests.push({
        setDataValidation: {
          range: {
            sheetId: id03,
            startRowIndex: 1,
            endRowIndex: 3000,
            startColumnIndex: 0,
            endColumnIndex: 12,
          },
          // omitting rule removes validation
        },
      });
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: b.id,
        requestBody: { requests },
      });
      console.log(`✅ Dropdowns cleared on ${b.name}`);
    }
  }
}

removeDropdowns().catch(console.error);

import { google } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";

async function inspectBranches() {
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
    console.log(`\n========================================`);
    console.log(`BRANCH: ${b.name} (${b.id})`);
    console.log(`========================================`);

    const meta = await sheets.spreadsheets.get({
      spreadsheetId: b.id,
      includeGridData: true,
      ranges: [
        "'02_PENDAPATAN_SPPG'!A1:L5",
        "'03_PENGELUARAN_SUPPLIER'!A1:L5",
        "'04_REKAP_MARGIN_HARIAN'!A1:G5",
      ],
    });

    for (const s of meta.data.sheets || []) {
      const title = s.properties?.title;
      const sheetId = s.properties?.sheetId;
      const basicFilter = s.basicFilter;
      const gridProperties = s.properties?.gridProperties;
      console.log(`\n--- Tab: ${title} (id: ${sheetId}) ---`);
      console.log(`Grid: rows=${gridProperties?.rowCount}, cols=${gridProperties?.columnCount}, frozenRows=${gridProperties?.frozenRowCount}, hideGridlines=${gridProperties?.hideGridlines}`);
      console.log(`Filter: ${basicFilter ? JSON.stringify(basicFilter.range) : "NO FILTER"}`);

      const row0 = s.data?.[0]?.rowData?.[0];
      const row1 = s.data?.[0]?.rowData?.[1];

      if (row0) {
        console.log(`Header Row Height / Format:`);
        const headerBg = row0.values?.[0]?.effectiveFormat?.backgroundColor;
        const headerTxt = row0.values?.[0]?.effectiveFormat?.textFormat;
        console.log(`Header Col A: bg=${JSON.stringify(headerBg)}, font=${headerTxt?.fontFamily}, size=${headerTxt?.fontSize}, bold=${headerTxt?.bold}, color=${JSON.stringify(headerTxt?.foregroundColor)}`);
      }

      if (row1) {
        console.log(`Data Row 1:`);
        const dataBg = row1.values?.[0]?.effectiveFormat?.backgroundColor;
        const dataTxt = row1.values?.[0]?.effectiveFormat?.textFormat;
        console.log(`Data Col A: val=${row1.values?.[0]?.formattedValue}, bg=${JSON.stringify(dataBg)}, font=${dataTxt?.fontFamily}, size=${dataTxt?.fontSize}, color=${JSON.stringify(dataTxt?.foregroundColor)}`);
      }
    }
  }
}

inspectBranches().catch(console.error);

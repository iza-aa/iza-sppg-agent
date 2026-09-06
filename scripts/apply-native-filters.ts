import { google, sheets_v4 } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";
import { hexToRgbColor, BGN_PALETTE } from "../src/core/google/sheets-recipes.js";

async function applyNativeFilters() {
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

  const navyBg = hexToRgbColor(BGN_PALETTE.DEEP_NAVY);
  const whiteTxt = hexToRgbColor(BGN_PALETTE.WHITE);
  const pureWhite = hexToRgbColor(BGN_PALETTE.WHITE);
  const zebraBg = hexToRgbColor(BGN_PALETTE.SLATE_LIGHT);

  for (const b of branches) {
    if (!b.id) continue;
    console.log(`\n========================================`);
    console.log(`Setting up Native 1-Row Filters on ${b.name}...`);
    console.log(`========================================`);

    const meta = await sheets.spreadsheets.get({ spreadsheetId: b.id });
    const sheetMap = new Map<string, number>();
    meta.data.sheets?.forEach((s) => {
      if (s.properties?.title && typeof s.properties?.sheetId === "number") {
        sheetMap.set(s.properties.title, s.properties.sheetId);
      }
    });

    const id02 = sheetMap.get("02_PENDAPATAN_SPPG");
    const id03 = sheetMap.get("03_PENGELUARAN_SUPPLIER");
    const id04 = sheetMap.get("04_REKAP_MARGIN_HARIAN");

    if (id02 === undefined || id03 === undefined || id04 === undefined) {
      console.log(`Missing tabs in ${b.name}`);
      continue;
    }

    // =========================================================================
    // 1. RE-ESTABLISH TAB 04 AS CLEAN 1-ROW HEADER
    // =========================================================================
    // Clear old values in Tab 04
    await sheets.spreadsheets.values.clear({
      spreadsheetId: b.id,
      range: "'04_REKAP_MARGIN_HARIAN'!A1:Z100",
    });

    const batchReqs: sheets_v4.Schema$Request[] = [
      // Unmerge Tab 04
      {
        unmergeCells: {
          range: {
            sheetId: id04,
            startRowIndex: 0,
            endRowIndex: 50,
            startColumnIndex: 0,
            endColumnIndex: 10,
          },
        },
      },
      // Row 1 Height: 34px
      {
        updateDimensionProperties: {
          range: { sheetId: id04, dimension: "ROWS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 34 },
          fields: "pixelSize",
        },
      },
      // Row 1 Header Styling: Navy, White Bold 10pt, Middle, Center
      {
        repeatCell: {
          range: { sheetId: id04, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
          cell: {
            userEnteredFormat: {
              backgroundColor: navyBg,
              textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10, fontFamily: "Arial" },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
        },
      },
      // Column widths Tab 04
      {
        updateDimensionProperties: {
          range: { sheetId: id04, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 125 }, // Col A: Tanggal
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: id04, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
          properties: { pixelSize: 140 }, // Col B: No SPPG
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: id04, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
          properties: { pixelSize: 160 }, // Col C: Total Pagu
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: id04, dimension: "COLUMNS", startIndex: 3, endIndex: 4 },
          properties: { pixelSize: 160 }, // Col D: Realisasi Belanja
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: id04, dimension: "COLUMNS", startIndex: 4, endIndex: 5 },
          properties: { pixelSize: 160 }, // Col E: Margin Bersih
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: id04, dimension: "COLUMNS", startIndex: 5, endIndex: 6 },
          properties: { pixelSize: 130 }, // Col F: % Margin
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: id04, dimension: "COLUMNS", startIndex: 6, endIndex: 7 },
          properties: { pixelSize: 180 }, // Col G: Status Evaluasi BGN
          fields: "pixelSize",
        },
      },
      // Frozen row: 1
      {
        updateSheetProperties: {
          properties: {
            sheetId: id04,
            gridProperties: {
              frozenRowCount: 1,
            },
          },
          fields: "gridProperties.frozenRowCount",
        },
      },
      // Data rows formatting (Rows 2 - 500)
      {
        repeatCell: {
          range: { sheetId: id04, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 7 },
          cell: {
            userEnteredFormat: {
              verticalAlignment: "MIDDLE",
              textFormat: { fontSize: 10, fontFamily: "Arial", foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_DARK) },
            },
          },
          fields: "userEnteredFormat(verticalAlignment,textFormat)",
        },
      },
      // Col A: Date ISO Center
      {
        repeatCell: {
          range: { sheetId: id04, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 1 },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: "CENTER",
              numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" },
            },
          },
          fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
        },
      },
      // Col B: No SPPG Center
      {
        repeatCell: {
          range: { sheetId: id04, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 1, endColumnIndex: 2 },
          cell: {
            userEnteredFormat: { horizontalAlignment: "CENTER" },
          },
          fields: "userEnteredFormat.horizontalAlignment",
        },
      },
      // Col C, D, E: Currency Right
      {
        repeatCell: {
          range: { sheetId: id04, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 2, endColumnIndex: 5 },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: "RIGHT",
              numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
            },
          },
          fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
        },
      },
      // Col F: % Margin Center
      {
        repeatCell: {
          range: { sheetId: id04, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 5, endColumnIndex: 6 },
          cell: {
            userEnteredFormat: {
              horizontalAlignment: "CENTER",
              numberFormat: { type: "PERCENT", pattern: "0.00%" },
            },
          },
          fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
        },
      },
      // Col G: Status Center
      {
        repeatCell: {
          range: { sheetId: id04, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 6, endColumnIndex: 7 },
          cell: {
            userEnteredFormat: { horizontalAlignment: "CENTER" },
          },
          fields: "userEnteredFormat.horizontalAlignment",
        },
      },
      // Row height 26px for data rows
      {
        updateDimensionProperties: {
          range: { sheetId: id04, dimension: "ROWS", startIndex: 1, endIndex: 30 },
          properties: { pixelSize: 26 },
          fields: "pixelSize",
        },
      },
      // =======================================================================
      // 2. SET NATIVE BASIC FILTER ON TAB 02, TAB 03, TAB 04
      // =======================================================================
      // BasicFilter on Tab 02 (Row 1 Header: Cols 0-12)
      {
        setBasicFilter: {
          filter: {
            range: {
              sheetId: id02,
              startRowIndex: 0,
              startColumnIndex: 0,
              endColumnIndex: 12,
            },
          },
        },
      },
      // BasicFilter on Tab 03 (Row 1 Header: Cols 0-12)
      {
        setBasicFilter: {
          filter: {
            range: {
              sheetId: id03,
              startRowIndex: 0,
              startColumnIndex: 0,
              endColumnIndex: 12,
            },
          },
        },
      },
      // BasicFilter on Tab 04 (Row 1 Header: Cols 0-7)
      {
        setBasicFilter: {
          filter: {
            range: {
              sheetId: id04,
              startRowIndex: 0,
              startColumnIndex: 0,
              endColumnIndex: 7,
            },
          },
        },
      },
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: b.id,
      requestBody: { requests: batchReqs },
    });

    // Write Values for Tab 04 (Header on Row 1, Data on Row 2)
    const tab4Values = [
      ["Tanggal", "No SPPG", "Total Pagu", "Realisasi Belanja", "Margin Bersih", "Persentase Margin", "Status Evaluasi BGN"],
    ];

    if (b.name === "Patila") {
      tab4Values.push([
        "2026-09-02",
        "05/02/09/26",
        "=SUMIFS('02_PENDAPATAN_SPPG'!I:I; '02_PENDAPATAN_SPPG'!B:B; A2; '02_PENDAPATAN_SPPG'!D:D; B2)",
        "=SUMIFS('03_PENGELUARAN_SUPPLIER'!I:I; '03_PENGELUARAN_SUPPLIER'!B:B; A2; '03_PENGELUARAN_SUPPLIER'!C:C; B2)",
        "=C2-D2",
        "=IF(C2>0; E2/C2; 0)",
        '=IF(F2>=0,15; "SURPLUS / EFISIEN"; IF(F2>=0,05; "SESUAI PAGU"; "DEFISIT / OVER-BUDGET"))',
      ]);
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: b.id,
      range: "'04_REKAP_MARGIN_HARIAN'!A1:G" + tab4Values.length,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: tab4Values },
    });

    console.log(`✅ ${b.name}: Native 1-row filters applied on Tab 02, 03, and 04!`);
  }

  // Also check and set basicFilter on Master Spreadsheet Tab 02_SEMUA_TRANSAKSI!
  console.log(`\n========================================`);
  console.log(`Checking Master Spreadsheet Native Filter...`);
  console.log(`========================================`);
  const masterMeta = await sheets.spreadsheets.get({ spreadsheetId: env.GOOGLE_SHEET_ID_MASTER });
  const masterTab2 = masterMeta.data.sheets?.find(s => s.properties?.title === "02_SEMUA_TRANSAKSI");
  if (masterTab2 && typeof masterTab2.properties?.sheetId === "number") {
    const masterTab2Id = masterTab2.properties.sheetId;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: env.GOOGLE_SHEET_ID_MASTER,
      requestBody: {
        requests: [
          {
            setBasicFilter: {
              filter: {
                range: {
                  sheetId: masterTab2Id,
                  startRowIndex: 0,
                  startColumnIndex: 0,
                  endColumnIndex: 12,
                },
              },
            },
          },
        ],
      },
    });
    console.log(`✅ Master Spreadsheet: 02_SEMUA_TRANSAKSI basicFilter applied!`);
  }
}

applyNativeFilters().catch(console.error);

import { google, sheets_v4 } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";
import { hexToRgbColor, BGN_PALETTE } from "../src/core/google/sheets-recipes.js";

async function setupCentralFilterTab4() {
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
    console.log(`Setting up Central Filter Tab 04 on ${b.name}...`);
    const spreadsheetId = b.id;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tab4 = meta.data.sheets?.find(s => s.properties?.title === "04_REKAP_MARGIN_HARIAN");
  const tab4Id = tab4?.properties?.sheetId ?? 1004;

  const navyBg = hexToRgbColor(BGN_PALETTE.DEEP_NAVY);
  const whiteTxt = hexToRgbColor(BGN_PALETTE.WHITE);
  const lightBg = hexToRgbColor(BGN_PALETTE.SLATE_LIGHT);
  const goldBorder = hexToRgbColor(BGN_PALETTE.EMBLEM_GOLD);

  // 1. Clear Tab 04
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "'04_REKAP_MARGIN_HARIAN'!A1:Z100",
  });

  // 2. Setup visual structure and batch requests
  const requests: sheets_v4.Schema$Request[] = [
    // Unmerge any old merges
    {
      unmergeCells: {
        range: {
          sheetId: tab4Id,
          startRowIndex: 0,
          endRowIndex: 50,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
      },
    },
    // Row 1: Height 38px
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 38 },
        fields: "pixelSize",
      },
    },
    // Merge A1:G1 for Title
    {
      mergeCells: {
        range: { sheetId: tab4Id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
        mergeType: "MERGE_ALL",
      },
    },
    // Format A1 Title: Navy background, White Bold 11pt, Center
    {
      repeatCell: {
        range: { sheetId: tab4Id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 11, fontFamily: "Arial" },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    // Row 2: Spacing row 12px
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "ROWS", startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 12 },
        fields: "pixelSize",
      },
    },
    // Row 3: Filter Control Row - Height 32px
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "ROWS", startIndex: 2, endIndex: 3 },
        properties: { pixelSize: 32 },
        fields: "pixelSize",
      },
    },
    // Format Filter Row A3:G3
    {
      repeatCell: {
        range: { sheetId: tab4Id, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: lightBg,
            verticalAlignment: "MIDDLE",
            textFormat: { fontSize: 10, fontFamily: "Arial" },
          },
        },
        fields: "userEnteredFormat(backgroundColor,verticalAlignment,textFormat)",
      },
    },
    // Highlight Filter Inputs (B3 and E3) with white bg & border
    {
      repeatCell: {
        range: { sheetId: tab4Id, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 2 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor("#FFFFFF"),
            textFormat: { bold: true, foregroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId: tab4Id, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 4, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor("#FFFFFF"),
            textFormat: { bold: true, foregroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    },
    // Row 4: Spacing row 12px
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "ROWS", startIndex: 3, endIndex: 4 },
        properties: { pixelSize: 12 },
        fields: "pixelSize",
      },
    },
    // Row 5: Table Header Height 34px
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "ROWS", startIndex: 4, endIndex: 5 },
        properties: { pixelSize: 34 },
        fields: "pixelSize",
      },
    },
    // Format Row 5 Table Headers: Deep Navy, White Bold 10pt, Center
    {
      repeatCell: {
        range: { sheetId: tab4Id, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 7 },
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
    // Column widths
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 125 }, // Col A: Tanggal
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 140 }, // Col B: No SPPG / Filter SPPG Input
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
        properties: { pixelSize: 160 }, // Col C: Total Pagu
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "COLUMNS", startIndex: 3, endIndex: 4 },
        properties: { pixelSize: 160 }, // Col D: Realisasi Belanja / Filter Bulan Label
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "COLUMNS", startIndex: 4, endIndex: 5 },
        properties: { pixelSize: 160 }, // Col E: Margin Bersih / Filter Bulan Input
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "COLUMNS", startIndex: 5, endIndex: 6 },
        properties: { pixelSize: 130 }, // Col F: % Margin
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: tab4Id, dimension: "COLUMNS", startIndex: 6, endIndex: 7 },
        properties: { pixelSize: 190 }, // Col G: Status Evaluasi
        fields: "pixelSize",
      },
    },
    // Set Frozen Row to 5 (Sticky header)
    {
      updateSheetProperties: {
        properties: {
          sheetId: tab4Id,
          gridProperties: {
            frozenRowCount: 5,
          },
        },
        fields: "gridProperties.frozenRowCount",
      },
    },
    // Data rows formatting (Rows 6 - 500)
    {
      repeatCell: {
        range: { sheetId: tab4Id, startRowIndex: 5, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 7 },
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
        range: { sheetId: tab4Id, startRowIndex: 5, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 1 },
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
        range: { sheetId: tab4Id, startRowIndex: 5, endRowIndex: 500, startColumnIndex: 1, endColumnIndex: 2 },
        cell: {
          userEnteredFormat: { horizontalAlignment: "CENTER" },
        },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    },
    // Col C, D, E: Currency Right
    {
      repeatCell: {
        range: { sheetId: tab4Id, startRowIndex: 5, endRowIndex: 500, startColumnIndex: 2, endColumnIndex: 5 },
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
        range: { sheetId: tab4Id, startRowIndex: 5, endRowIndex: 500, startColumnIndex: 5, endColumnIndex: 6 },
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
        range: { sheetId: tab4Id, startRowIndex: 5, endRowIndex: 500, startColumnIndex: 6, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: { horizontalAlignment: "CENTER" },
        },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    },
  ];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  // 3. Write Values and Centralized Formulas
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        // Title
        {
          range: "'04_REKAP_MARGIN_HARIAN'!A1:G1",
          values: [["REKAPITULASI & MARGIN HARIAN SPPG - BADAN GIZI NASIONAL", "", "", "", "", "", ""]],
        },
        // Centralized Filter Controls
        {
          range: "'04_REKAP_MARGIN_HARIAN'!A3:G3",
          values: [
            [
              "Filter No SPPG:",
              "SEMUA",
              "",
              "Filter Bulan:",
              "SEMUA",
              "*Ketik 'SEMUA' atau no SPPG/bulan spesifik (misal: 2026-09)",
              "",
            ],
          ],
        },
        // Table Headers
        {
          range: "'04_REKAP_MARGIN_HARIAN'!A5:G5",
          values: [
            [
              "Tanggal",
              "No SPPG",
              "Total Pagu",
              "Realisasi Belanja",
              "Margin Bersih",
              "Persentase Margin",
              "Status Evaluasi BGN",
            ],
          ],
        },
        // Row 6 (Formula row that reads Tab 02 & 03 with filter criteria from B3 and E3)
        {
          range: "'04_REKAP_MARGIN_HARIAN'!A6:G6",
          values: [
            [
              "2026-09-02",
              "05/02/09/26",
              "=SUMIFS('02_PENDAPATAN_SPPG'!I:I; '02_PENDAPATAN_SPPG'!B:B; A6; '02_PENDAPATAN_SPPG'!D:D; B6)",
              "=SUMIFS('03_PENGELUARAN_SUPPLIER'!I:I; '03_PENGELUARAN_SUPPLIER'!B:B; A6; '03_PENGELUARAN_SUPPLIER'!C:C; B6)",
              "=C6-D6",
              "=IF(C6>0; E6/C6; 0)",
              '=IF(F6>=0,15; "SURPLUS / EFISIEN"; IF(F6>=0,05; "SESUAI PAGU"; "DEFISIT / OVER-BUDGET"))',
            ],
          ],
        },
      ],
    },
  });

    console.log(`✅ Centralized Filter and Layout successfully established on Tab 04 for ${b.name}!`);
  }
}

setupCentralFilterTab4().catch(console.error);

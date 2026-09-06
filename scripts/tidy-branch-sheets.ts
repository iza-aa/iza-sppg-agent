import { google, sheets_v4 } from "googleapis";
import path from "path";
import { env } from "../src/config/env.js";
import { hexToRgbColor, BGN_PALETTE } from "../src/core/google/sheets-recipes.js";

async function tidyBranchSheets() {
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
  const zebraBg = hexToRgbColor(BGN_PALETTE.SLATE_LIGHT); // #F8FAFC
  const pureWhite = hexToRgbColor(BGN_PALETTE.WHITE);
  const borderColor = hexToRgbColor("#CBD5E1");

  for (const b of branches) {
    if (!b.id) continue;
    console.log(`\n========================================`);
    console.log(`Tidying Branch: ${b.name} (${b.id})`);
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
      console.log(`Tabs missing in ${b.name}: id02=${id02}, id03=${id03}, id04=${id04}`);
      continue;
    }

    const requests: sheets_v4.Schema$Request[] = [];

    // =========================================================================
    // 1. TAB 02_PENDAPATAN_SPPG
    // =========================================================================
    // 1.1 Header Row 1 Height: 34px
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: id02,
          dimension: "ROWS",
          startIndex: 0,
          endIndex: 1,
        },
        properties: { pixelSize: 34 },
        fields: "pixelSize",
      },
    });

    // 1.2 Header Styling: Navy, White, Bold, 10pt, Middle, Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id02,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 12,
        },
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
    });

    // 1.3 Column Widths Tab 02
    const widths02 = [
      { start: 0, end: 1, width: 210 }, // Col A: ID Transaksi
      { start: 1, end: 2, width: 115 }, // Col B: Tanggal Pesanan
      { start: 2, end: 3, width: 115 }, // Col C: Tanggal Tiba
      { start: 3, end: 4, width: 130 }, // Col D: No SPPG
      { start: 4, end: 5, width: 240 }, // Col E: Uraian Bahan
      { start: 5, end: 6, width: 85 },  // Col F: Kuantitas
      { start: 6, end: 7, width: 75 },  // Col G: Satuan
      { start: 7, end: 8, width: 135 }, // Col H: Harga Pagu
      { start: 8, end: 9, width: 145 }, // Col I: Total Pagu
      { start: 9, end: 10, width: 160 },// Col J: Target Supplier
      { start: 10, end: 11, width: 110 },// Col K: Status
      { start: 11, end: 12, width: 220 },// Col L: Catatan
    ];

    for (const w of widths02) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId: id02,
            dimension: "COLUMNS",
            startIndex: w.start,
            endIndex: w.end,
          },
          properties: { pixelSize: w.width },
          fields: "pixelSize",
        },
      });
    }

    // 1.4 Data Rows Styling & Formats (Rows 2 - 2000)
    requests.push({
      repeatCell: {
        range: {
          sheetId: id02,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 0,
          endColumnIndex: 12,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "MIDDLE",
            textFormat: { fontSize: 10, fontFamily: "Arial", foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_DARK) },
          },
        },
        fields: "userEnteredFormat(verticalAlignment,textFormat)",
      },
    });

    // Col B & C Date format
    requests.push({
      repeatCell: {
        range: {
          sheetId: id02,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 1,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER",
            numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
      },
    });

    // Col D No SPPG Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id02,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 3,
          endColumnIndex: 4,
        },
        cell: {
          userEnteredFormat: { horizontalAlignment: "CENTER" },
        },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    });

    // Col F Qty Center & Format #,##0
    requests.push({
      repeatCell: {
        range: {
          sheetId: id02,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 5,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER",
            numberFormat: { type: "NUMBER", pattern: "#,##0" },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
      },
    });

    // Col G Satuan Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id02,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 6,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: { horizontalAlignment: "CENTER" },
        },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    });

    // Col H & I Currency Format Right
    requests.push({
      repeatCell: {
        range: {
          sheetId: id02,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 7,
          endColumnIndex: 9,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "RIGHT",
            numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
      },
    });

    // Col K Status Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id02,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 10,
          endColumnIndex: 11,
        },
        cell: {
          userEnteredFormat: { horizontalAlignment: "CENTER" },
        },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    });

    // Row Height 26px for initial data rows (rows 2 to 30)
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: id02,
          dimension: "ROWS",
          startIndex: 1,
          endIndex: 30,
        },
        properties: { pixelSize: 26 },
        fields: "pixelSize",
      },
    });

    // =========================================================================
    // 2. TAB 03_PENGELUARAN_SUPPLIER
    // =========================================================================
    // 2.1 Header Row 1 Height: 34px
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: id03,
          dimension: "ROWS",
          startIndex: 0,
          endIndex: 1,
        },
        properties: { pixelSize: 34 },
        fields: "pixelSize",
      },
    });

    // 2.2 Header Styling: Navy, White, Bold, 10pt, Middle, Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id03,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 12,
        },
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
    });

    // 2.3 Column Widths Tab 03
    const widths03 = [
      { start: 0, end: 1, width: 210 }, // Col A: ID Transaksi
      { start: 1, end: 2, width: 115 }, // Col B: Tanggal Transaksi
      { start: 2, end: 3, width: 130 }, // Col C: No SPPG Ref
      { start: 3, end: 4, width: 160 }, // Col D: Nama Supplier
      { start: 4, end: 5, width: 240 }, // Col E: Uraian Barang
      { start: 5, end: 6, width: 85 },  // Col F: Kuantitas
      { start: 6, end: 7, width: 75 },  // Col G: Satuan
      { start: 7, end: 8, width: 135 }, // Col H: Harga Satuan
      { start: 8, end: 9, width: 145 }, // Col I: Total Bayar
      { start: 9, end: 10, width: 120 },// Col J: Link Bukti Nota
      { start: 10, end: 11, width: 140 },// Col K: PIC / Operator
      { start: 11, end: 12, width: 220 },// Col L: Keterangan
    ];

    for (const w of widths03) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId: id03,
            dimension: "COLUMNS",
            startIndex: w.start,
            endIndex: w.end,
          },
          properties: { pixelSize: w.width },
          fields: "pixelSize",
        },
      });
    }

    // 2.4 Data Rows Styling & Formats Tab 03
    requests.push({
      repeatCell: {
        range: {
          sheetId: id03,
          startRowIndex: 1,
          endRowIndex: 3000,
          startColumnIndex: 0,
          endColumnIndex: 12,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "MIDDLE",
            textFormat: { fontSize: 10, fontFamily: "Arial", foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_DARK) },
          },
        },
        fields: "userEnteredFormat(verticalAlignment,textFormat)",
      },
    });

    // Col B Date format
    requests.push({
      repeatCell: {
        range: {
          sheetId: id03,
          startRowIndex: 1,
          endRowIndex: 3000,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER",
            numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
      },
    });

    // Col C No SPPG Ref Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id03,
          startRowIndex: 1,
          endRowIndex: 3000,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: { horizontalAlignment: "CENTER" },
        },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    });

    // Col F Qty Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id03,
          startRowIndex: 1,
          endRowIndex: 3000,
          startColumnIndex: 5,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER",
            numberFormat: { type: "NUMBER", pattern: "#,##0" },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
      },
    });

    // Col G Satuan Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id03,
          startRowIndex: 1,
          endRowIndex: 3000,
          startColumnIndex: 6,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: { horizontalAlignment: "CENTER" },
        },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    });

    // Col H & I Currency Format Right
    requests.push({
      repeatCell: {
        range: {
          sheetId: id03,
          startRowIndex: 1,
          endRowIndex: 3000,
          startColumnIndex: 7,
          endColumnIndex: 9,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "RIGHT",
            numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
      },
    });

    // Col J Link Nota Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id03,
          startRowIndex: 1,
          endRowIndex: 3000,
          startColumnIndex: 9,
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: { horizontalAlignment: "CENTER" },
        },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    });

    // Row Height 26px for initial data rows
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: id03,
          dimension: "ROWS",
          startIndex: 1,
          endIndex: 30,
        },
        properties: { pixelSize: 26 },
        fields: "pixelSize",
      },
    });

    // =========================================================================
    // 3. TAB 04_REKAP_MARGIN_HARIAN
    // =========================================================================
    // 3.1 Header Row 1 Height: 34px
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: id04,
          dimension: "ROWS",
          startIndex: 0,
          endIndex: 1,
        },
        properties: { pixelSize: 34 },
        fields: "pixelSize",
      },
    });

    // 3.2 Header Styling: Navy, White, Bold, 10pt, Middle, Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id04,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 7,
        },
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
    });

    // 3.3 Column Widths Tab 04
    const widths04 = [
      { start: 0, end: 1, width: 125 }, // Col A: Tanggal
      { start: 1, end: 2, width: 140 }, // Col B: No SPPG
      { start: 2, end: 3, width: 160 }, // Col C: Total Pagu
      { start: 3, end: 4, width: 160 }, // Col D: Realisasi Belanja
      { start: 4, end: 5, width: 160 }, // Col E: Margin Bersih
      { start: 5, end: 6, width: 130 }, // Col F: Persentase Margin
      { start: 6, end: 7, width: 180 }, // Col G: Status Evaluasi BGN
    ];

    for (const w of widths04) {
      requests.push({
        updateDimensionProperties: {
          range: {
            sheetId: id04,
            dimension: "COLUMNS",
            startIndex: w.start,
            endIndex: w.end,
          },
          properties: { pixelSize: w.width },
          fields: "pixelSize",
        },
      });
    }

    // 3.4 Data Rows Styling Tab 04
    requests.push({
      repeatCell: {
        range: {
          sheetId: id04,
          startRowIndex: 1,
          endRowIndex: 500,
          startColumnIndex: 0,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "MIDDLE",
            textFormat: { fontSize: 10, fontFamily: "Arial", foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_DARK) },
          },
        },
        fields: "userEnteredFormat(verticalAlignment,textFormat)",
      },
    });

    // Col A Date Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id04,
          startRowIndex: 1,
          endRowIndex: 500,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER",
            numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
      },
    });

    // Col B No SPPG Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id04,
          startRowIndex: 1,
          endRowIndex: 500,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
        cell: {
          userEnteredFormat: { horizontalAlignment: "CENTER" },
        },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    });

    // Col C, D, E Currency Right
    requests.push({
      repeatCell: {
        range: {
          sheetId: id04,
          startRowIndex: 1,
          endRowIndex: 500,
          startColumnIndex: 2,
          endColumnIndex: 5,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "RIGHT",
            numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
      },
    });

    // Col F % Margin Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id04,
          startRowIndex: 1,
          endRowIndex: 500,
          startColumnIndex: 5,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER",
            numberFormat: { type: "PERCENT", pattern: "0.00%" },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,numberFormat)",
      },
    });

    // Col G Status Center
    requests.push({
      repeatCell: {
        range: {
          sheetId: id04,
          startRowIndex: 1,
          endRowIndex: 500,
          startColumnIndex: 6,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: { horizontalAlignment: "CENTER" },
        },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    });

    // Row Height 26px for initial data rows in Tab 04
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: id04,
          dimension: "ROWS",
          startIndex: 1,
          endIndex: 30,
        },
        properties: { pixelSize: 26 },
        fields: "pixelSize",
      },
    });

    // Execute batch update
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: b.id,
      requestBody: { requests },
    });

    // Zebra striping for existing data rows in Tab 02 & Tab 03
    const data02 = await sheets.spreadsheets.values.get({
      spreadsheetId: b.id,
      range: "'02_PENDAPATAN_SPPG'!A2:A30",
    });
    const rowCount02 = data02.data.values?.length || 0;
    if (rowCount02 > 0) {
      const zebraReqs: sheets_v4.Schema$Request[] = [];
      for (let r = 0; r < rowCount02; r++) {
        const bg = r % 2 === 0 ? pureWhite : zebraBg;
        zebraReqs.push({
          repeatCell: {
            range: {
              sheetId: id02,
              startRowIndex: r + 1,
              endRowIndex: r + 2,
              startColumnIndex: 0,
              endColumnIndex: 12,
            },
            cell: {
              userEnteredFormat: { backgroundColor: bg },
            },
            fields: "userEnteredFormat.backgroundColor",
          },
        });
      }
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: b.id,
        requestBody: { requests: zebraReqs },
      });
    }

    const data03 = await sheets.spreadsheets.values.get({
      spreadsheetId: b.id,
      range: "'03_PENGELUARAN_SUPPLIER'!A2:A30",
    });
    const rowCount03 = data03.data.values?.length || 0;
    if (rowCount03 > 0) {
      const zebraReqs: sheets_v4.Schema$Request[] = [];
      for (let r = 0; r < rowCount03; r++) {
        const bg = r % 2 === 0 ? pureWhite : zebraBg;
        zebraReqs.push({
          repeatCell: {
            range: {
              sheetId: id03,
              startRowIndex: r + 1,
              endRowIndex: r + 2,
              startColumnIndex: 0,
              endColumnIndex: 12,
            },
            cell: {
              userEnteredFormat: { backgroundColor: bg },
            },
            fields: "userEnteredFormat.backgroundColor",
          },
        });
      }
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: b.id,
        requestBody: { requests: zebraReqs },
      });
    }

    // Tab 04 Dynamic Summary Calculation for Patila (sample data exists)
    if (b.name === "Patila") {
      const check04 = await sheets.spreadsheets.values.get({
        spreadsheetId: b.id,
        range: "'04_REKAP_MARGIN_HARIAN'!A2:B2",
      });
      if (!check04.data.values || check04.data.values.length === 0) {
        console.log("Populating automated sample margin row for Patila on Tab 04...");
        await sheets.spreadsheets.values.update({
          spreadsheetId: b.id,
          range: "'04_REKAP_MARGIN_HARIAN'!A2:G2",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [
              [
                "2026-09-02",
                "05/02/09/26",
                "=SUMIFS('02_PENDAPATAN_SPPG'!I:I; '02_PENDAPATAN_SPPG'!B:B; A2; '02_PENDAPATAN_SPPG'!D:D; B2)",
                "=SUMIFS('03_PENGELUARAN_SUPPLIER'!I:I; '03_PENGELUARAN_SUPPLIER'!B:B; A2; '03_PENGELUARAN_SUPPLIER'!C:C; B2)",
                "=C2-D2",
                "=IF(C2>0; E2/C2; 0)",
                '=IF(F2>=0,15; "SURPLUS / EFISIEN"; IF(F2>=0,05; "SESUAI PAGU"; "DEFISIT / OVER-BUDGET"))',
              ],
            ],
          },
        });
      }
    }

    console.log(`✅ ${b.name} successfully tidied!`);
  }
}

tidyBranchSheets().catch(console.error);

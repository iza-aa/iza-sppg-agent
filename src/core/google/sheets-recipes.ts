import { sheets_v4 } from 'googleapis';

/**
 * ============================================================================
 * GOOGLE SHEETS API V4 BATCH UPDATE RECIPES - MBG ASSISTANT (BGN)
 * ============================================================================
 */

export interface SheetsColorRgba {
  red: number;
  green: number;
  blue: number;
  alpha?: number;
}

export const BGN_PALETTE = {
  DEEP_NAVY: '#0F2042',
  EMBLEM_GOLD: '#D4A017',
  SOFT_SKY_BLUE: '#90C7DE',
  CRIMSON_RED: '#C62828',
  FOREST_GREEN: '#14532D',
  SLATE_DARK: '#1E293B',
  SLATE_GRAY: '#64748B',
  SLATE_LIGHT: '#F8FAFC',
  WHITE: '#FFFFFF',
  ALERT_GREEN_BG: '#E8F5E9',
  ALERT_GREEN_TXT: '#2E7D32',
  ALERT_YELLOW_BG: '#FEF3C7',
  ALERT_YELLOW_TXT: '#B45309',
  ALERT_RED_BG: '#FEE2E2',
  ALERT_RED_TXT: '#B91C1C'
} as const;

export const SHEET_IDS = {
  RINGKASAN_EKSEKUTIF: 1001,
  PENDAPATAN_SPPG: 1002,
  PENGELUARAN_SUPPLIER: 1003,
  REKAP_MARGIN_HARIAN: 1004,
  MASTER_DATA: 1005
} as const;

export const SHEET_NAMES = {
  RINGKASAN_EKSEKUTIF: '01_RINGKASAN_EKSEKUTIF',
  PENDAPATAN_SPPG: '02_PENDAPATAN_SPPG',
  PENGELUARAN_SUPPLIER: '03_PENGELUARAN_SUPPLIER',
  REKAP_MARGIN_HARIAN: '04_REKAP_MARGIN_HARIAN',
  MASTER_DATA: '05_MASTER_DATA'
} as const;

export const MASTER_SHEET_IDS = {
  KONSOLIDASI_NASIONAL: 0,
  SEMUA_TRANSAKSI_GLOBAL: 2002,
  DIREKTORI_SPPG: 2003,
} as const;

export const MASTER_SHEET_NAMES = {
  KONSOLIDASI_NASIONAL: '01_KONSOLIDASI_NASIONAL',
  SEMUA_TRANSAKSI_GLOBAL: '02_SEMUA_TRANSAKSI_GLOBAL',
  DIREKTORI_SPPG: '03_DIREKTORI_SPPG',
} as const;

/**
 * Mengonversi kode Hex (#RRGGBB) ke Google Sheets API RGBA format (float 0.0 - 1.0)
 */
export function hexToRgbColor(hex: string, alpha: number = 1.0): sheets_v4.Schema$Color {
  const cleanHex = hex.replace(/^#/, '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  return {
    red: Math.round(r * 10000) / 10000,
    green: Math.round(g * 10000) / 10000,
    blue: Math.round(b * 10000) / 10000,
    alpha
  };
}

/**
 * Membuat BatchUpdate Requests untuk menginisialisasi 5 Tab SPPG secara programatik
 */
export function createInit5TabsBatchRequests(defaultSheetId: number = 0): sheets_v4.Schema$Request[] {
  return [
    // 1. Rename Default Sheet (Sheet1) menjadi 01_RINGKASAN_EKSEKUTIF
    {
      updateSheetProperties: {
        properties: {
          sheetId: defaultSheetId,
          title: SHEET_NAMES.RINGKASAN_EKSEKUTIF,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) },
          gridProperties: {
            rowCount: 100,
            columnCount: 12,
            frozenRowCount: 4 // Sticky KPI Cards
          }
        },
        fields: 'title,tabColorStyle,gridProperties(rowCount,columnCount,frozenRowCount)'
      }
    },
    // 2. Tab 02_PENDAPATAN_SPPG
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.PENDAPATAN_SPPG,
          title: SHEET_NAMES.PENDAPATAN_SPPG,
          index: 1,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SOFT_SKY_BLUE) },
          gridProperties: {
            rowCount: 2000,
            columnCount: 12,
            frozenRowCount: 1
          }
        }
      }
    },
    // 3. Tab 03_PENGELUARAN_SUPPLIER
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.PENGELUARAN_SUPPLIER,
          title: SHEET_NAMES.PENGELUARAN_SUPPLIER,
          index: 2,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.CRIMSON_RED) },
          gridProperties: {
            rowCount: 3000,
            columnCount: 12,
            frozenRowCount: 1
          }
        }
      }
    },
    // 4. Tab 04_REKAP_MARGIN_HARIAN
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.REKAP_MARGIN_HARIAN,
          title: SHEET_NAMES.REKAP_MARGIN_HARIAN,
          index: 3,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.EMBLEM_GOLD) },
          gridProperties: {
            rowCount: 500,
            columnCount: 7,
            frozenRowCount: 1
          }
        }
      }
    },
    // 5. Tab 05_MASTER_DATA
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.MASTER_DATA,
          title: SHEET_NAMES.MASTER_DATA,
          index: 4,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SLATE_GRAY) },
          gridProperties: {
            rowCount: 200,
            columnCount: 5,
            frozenRowCount: 1
          }
        }
      }
    }
  ];
}

/**
 * Membuat BatchUpdate Requests untuk Data Validation Dropdown Relasional
 */
export function createDataValidationBatchRequests(): sheets_v4.Schema$Request[] {
  return [
    // Validation Dropdown Supplier pada Tab 02 (Kolom J: index 9)
    {
      setDataValidation: {
        range: {
          sheetId: SHEET_IDS.PENDAPATAN_SPPG,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 9,
          endColumnIndex: 10
        },
        rule: {
          condition: {
            type: 'ONE_OF_RANGE',
            values: [{ userEnteredValue: `='${SHEET_NAMES.MASTER_DATA}'!$A$2:$A` }]
          },
          inputMessage: 'Pilih Supplier resmi dari Master Data BGN.',
          strict: true,
          showCustomUi: true
        }
      }
    },
    // Validation Dropdown Supplier pada Tab 03 (Kolom D: index 3)
    {
      setDataValidation: {
        range: {
          sheetId: SHEET_IDS.PENGELUARAN_SUPPLIER,
          startRowIndex: 1,
          endRowIndex: 3000,
          startColumnIndex: 3,
          endColumnIndex: 4
        },
        rule: {
          condition: {
            type: 'ONE_OF_RANGE',
            values: [{ userEnteredValue: `='${SHEET_NAMES.MASTER_DATA}'!$A$2:$A` }]
          },
          inputMessage: 'Pilih Supplier terdaftar dari Master Data BGN.',
          strict: true,
          showCustomUi: true
        }
      }
    },
    // Validation Dropdown Satuan pada Tab 03 (Kolom G: index 6)
    {
      setDataValidation: {
        range: {
          sheetId: SHEET_IDS.PENGELUARAN_SUPPLIER,
          startRowIndex: 1,
          endRowIndex: 3000,
          startColumnIndex: 6,
          endColumnIndex: 7
        },
        rule: {
          condition: {
            type: 'ONE_OF_RANGE',
            values: [{ userEnteredValue: `='${SHEET_NAMES.MASTER_DATA}'!$B$2:$B` }]
          },
          inputMessage: 'Pilih Satuan baku (Ekor, KG, Jerigen, Liter, dll).',
          strict: true,
          showCustomUi: true
        }
      }
    }
  ];
}

/**
 * Membuat BatchUpdate Requests untuk Format Rupiah, Tanggal ISO, dan Persentase
 */
export function createNumberFormattingBatchRequests(): sheets_v4.Schema$Request[] {
  return [
    // Tab 02: Tanggal Pesanan & Tiba (Kolom B & C)
    {
      repeatCell: {
        range: {
          sheetId: SHEET_IDS.PENDAPATAN_SPPG,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 1,
          endColumnIndex: 3
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 02: Harga Pagu & Total Pagu (Kolom H & I)
    {
      repeatCell: {
        range: {
          sheetId: SHEET_IDS.PENDAPATAN_SPPG,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 7,
          endColumnIndex: 9
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 03: Tanggal Transaksi (Kolom B)
    {
      repeatCell: {
        range: {
          sheetId: SHEET_IDS.PENGELUARAN_SUPPLIER,
          startRowIndex: 1,
          endRowIndex: 3000,
          startColumnIndex: 1,
          endColumnIndex: 2
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 03: Harga Beli & Total Bayar (Kolom H & I)
    {
      repeatCell: {
        range: {
          sheetId: SHEET_IDS.PENGELUARAN_SUPPLIER,
          startRowIndex: 1,
          endRowIndex: 3000,
          startColumnIndex: 7,
          endColumnIndex: 9
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 04: Plafon, Belanja, Margin Rp (Kolom C, D, E)
    {
      repeatCell: {
        range: {
          sheetId: SHEET_IDS.REKAP_MARGIN_HARIAN,
          startRowIndex: 1,
          endRowIndex: 500,
          startColumnIndex: 2,
          endColumnIndex: 5
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 04: % Margin Efisiensi (Kolom F)
    {
      repeatCell: {
        range: {
          sheetId: SHEET_IDS.REKAP_MARGIN_HARIAN,
          startRowIndex: 1,
          endRowIndex: 500,
          startColumnIndex: 5,
          endColumnIndex: 6
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'PERCENT', pattern: '0.00%' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    }
  ];
}

/**
 * Membuat BatchUpdate Requests untuk 3-Tier Conditional Formatting pada Tab Margin
 */
export function createConditionalFormattingBatchRequests(): sheets_v4.Schema$Request[] {
  return [
    // 1. Hijau: Margin >= 15%
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: SHEET_IDS.REKAP_MARGIN_HARIAN,
              startRowIndex: 1,
              endRowIndex: 500,
              startColumnIndex: 5,
              endColumnIndex: 6
            }
          ],
          booleanRule: {
            condition: {
              type: 'NUMBER_GREATER_THAN_EQ',
              values: [{ userEnteredValue: '0,15' }]
            },
            format: {
              backgroundColor: hexToRgbColor(BGN_PALETTE.ALERT_GREEN_BG),
              textFormat: {
                foregroundColor: hexToRgbColor(BGN_PALETTE.ALERT_GREEN_TXT),
                bold: true
              }
            }
          }
        },
        index: 0
      }
    },
    // 2. Kuning: Margin 5% - 14.99%
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: SHEET_IDS.REKAP_MARGIN_HARIAN,
              startRowIndex: 1,
              endRowIndex: 500,
              startColumnIndex: 5,
              endColumnIndex: 6
            }
          ],
          booleanRule: {
            condition: {
              type: 'NUMBER_BETWEEN',
              values: [{ userEnteredValue: '0,05' }, { userEnteredValue: '0,1499' }]
            },
            format: {
              backgroundColor: hexToRgbColor(BGN_PALETTE.ALERT_YELLOW_BG),
              textFormat: {
                foregroundColor: hexToRgbColor(BGN_PALETTE.ALERT_YELLOW_TXT),
                bold: true
              }
            }
          }
        },
        index: 1
      }
    },
    // 3. Merah: Margin < 5%
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: SHEET_IDS.REKAP_MARGIN_HARIAN,
              startRowIndex: 1,
              endRowIndex: 500,
              startColumnIndex: 5,
              endColumnIndex: 6
            }
          ],
          booleanRule: {
            condition: {
              type: 'NUMBER_LESS',
              values: [{ userEnteredValue: '0,05' }]
            },
            format: {
              backgroundColor: hexToRgbColor(BGN_PALETTE.ALERT_RED_BG),
              textFormat: {
                foregroundColor: hexToRgbColor(BGN_PALETTE.ALERT_RED_TXT),
                bold: true
              }
            }
          }
        },
        index: 2
      }
    }
  ];
}

/**
 * BatchUpdate Requests untuk styling Header baris 1 setiap Tab (Deep Navy & Teks Putih Bold)
 */
export function createHeaderStylingBatchRequests(): sheets_v4.Schema$Request[] {
  const navyBg = hexToRgbColor(BGN_PALETTE.DEEP_NAVY);
  const whiteTxt = hexToRgbColor(BGN_PALETTE.WHITE);

  return [
    {
      repeatCell: {
        range: {
          sheetId: SHEET_IDS.PENDAPATAN_SPPG,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 12,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: SHEET_IDS.PENGELUARAN_SUPPLIER,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 12,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: SHEET_IDS.REKAP_MARGIN_HARIAN,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: SHEET_IDS.MASTER_DATA,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
  ];
}

/**
 * Membuat BatchUpdate Requests untuk struktur Master Dashboard BGN (3 Tab Eksekutif)
 */
export function createMasterDashboardStructureBatchRequests(
  existingSheetMap: Map<string, number>,
  firstSheetId: number = 0
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];

  // 1. Rename first sheet or 01_RINGKASAN_EKSEKUTIF to 01_KONSOLIDASI_NASIONAL
  const firstId = existingSheetMap.get(SHEET_NAMES.RINGKASAN_EKSEKUTIF) ?? firstSheetId;
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: firstId,
        title: MASTER_SHEET_NAMES.KONSOLIDASI_NASIONAL,
        tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) },
        gridProperties: {
          rowCount: 100,
          columnCount: 12,
          frozenRowCount: 4,
        },
      },
      fields: 'title,tabColorStyle,gridProperties(rowCount,columnCount,frozenRowCount)',
    },
  });

  // 2. Add 02_SEMUA_TRANSAKSI_GLOBAL if not present
  if (!existingSheetMap.has(MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL)) {
    requests.push({
      addSheet: {
        properties: {
          sheetId: MASTER_SHEET_IDS.SEMUA_TRANSAKSI_GLOBAL,
          title: MASTER_SHEET_NAMES.SEMUA_TRANSAKSI_GLOBAL,
          index: 1,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.FOREST_GREEN) },
          gridProperties: {
            rowCount: 5000,
            columnCount: 12,
            frozenRowCount: 1,
          },
        },
      },
    });
  }

  // 3. Add 03_DIREKTORI_SPPG if not present
  if (!existingSheetMap.has(MASTER_SHEET_NAMES.DIREKTORI_SPPG)) {
    requests.push({
      addSheet: {
        properties: {
          sheetId: MASTER_SHEET_IDS.DIREKTORI_SPPG,
          title: MASTER_SHEET_NAMES.DIREKTORI_SPPG,
          index: 2,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.EMBLEM_GOLD) },
          gridProperties: {
            rowCount: 100,
            columnCount: 10,
            frozenRowCount: 1,
          },
        },
      },
    });
  }

  // 4. Delete old operational single-unit sheets if they exist
  for (const oldTitle of [
    SHEET_NAMES.PENDAPATAN_SPPG,
    SHEET_NAMES.PENGELUARAN_SUPPLIER,
    SHEET_NAMES.REKAP_MARGIN_HARIAN,
    SHEET_NAMES.MASTER_DATA,
  ]) {
    const id = existingSheetMap.get(oldTitle);
    if (id !== undefined) {
      requests.push({
        deleteSheet: {
          sheetId: id,
        },
      });
    }
  }

  return requests;
}

/**
 * Membuat BatchUpdate Requests untuk styling BGN, format angka, dan border Master Dashboard
 */
export function createMasterDashboardStylingBatchRequests(
  konsolidasiSheetId: number,
  globalTxSheetId: number,
  direktoriSheetId: number
): sheets_v4.Schema$Request[] {
  const navyBg = hexToRgbColor(BGN_PALETTE.DEEP_NAVY);
  const slateDarkBg = hexToRgbColor(BGN_PALETTE.SLATE_DARK);
  const slateLightBg = hexToRgbColor(BGN_PALETTE.SLATE_LIGHT);
  const softBlueBg = hexToRgbColor(BGN_PALETTE.SOFT_SKY_BLUE);
  const whiteTxt = hexToRgbColor(BGN_PALETTE.WHITE);
  const darkTxt = hexToRgbColor(BGN_PALETTE.DEEP_NAVY);

  return [
    // 1. Merging
    {
      mergeCells: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
        mergeType: 'MERGE_ALL',
      },
    },
    {
      mergeCells: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 5,
          endRowIndex: 6,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
        mergeType: 'MERGE_ALL',
      },
    },
    // 2. Banner Styling (Row 1)
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 12 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // 3. Filter Bar (Row 2)
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: slateLightBg,
            textFormat: { foregroundColor: darkTxt, bold: true, fontSize: 9 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // 4. Dropdowns (Tahun & Bulan)
    {
      setDataValidation: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: 2,
          endColumnIndex: 3,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'SEMUA TAHUN' },
              { userEnteredValue: '2025' },
              { userEnteredValue: '2026' },
              { userEnteredValue: '2027' },
              { userEnteredValue: '2028' },
            ],
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 1,
          endRowIndex: 2,
          startColumnIndex: 4,
          endColumnIndex: 5,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'SEMUA BULAN' },
              { userEnteredValue: '01 - JANUARI' },
              { userEnteredValue: '02 - FEBRUARI' },
              { userEnteredValue: '03 - MARET' },
              { userEnteredValue: '04 - APRIL' },
              { userEnteredValue: '05 - MEI' },
              { userEnteredValue: '06 - JUNI' },
              { userEnteredValue: '07 - JULI' },
              { userEnteredValue: '08 - AGUSTUS' },
              { userEnteredValue: '09 - SEPTEMBER' },
              { userEnteredValue: '10 - OKTOBER' },
              { userEnteredValue: '11 - NOVEMBER' },
              { userEnteredValue: '12 - DESEMBER' },
            ],
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
    // 5. Grand KPI Header (Row 3)
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 2,
          endRowIndex: 3,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: slateDarkBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    // 6. Grand KPI Values (Row 4)
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#FCFDFD'),
            textFormat: { foregroundColor: darkTxt, bold: true, fontSize: 11 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Currency format on KPI B4:D4
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: 1,
          endColumnIndex: 4,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    // Percent format on KPI E4
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 3,
          endRowIndex: 4,
          startColumnIndex: 4,
          endColumnIndex: 5,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'PERCENT', pattern: '0.0%' },
          },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    },
    // 7. Section Title (Row 6)
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 5,
          endRowIndex: 6,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#E2E8F0'),
            textFormat: { foregroundColor: darkTxt, bold: true, fontSize: 10 },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            padding: { left: 12 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)',
      },
    },
    // 8. Benchmark Table Header (Row 7)
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 6,
          endRowIndex: 7,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    // 9. Benchmark Data Rows Alignment & Formats
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 7,
          endRowIndex: 10,
          startColumnIndex: 1,
          endColumnIndex: 3,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'LEFT',
            padding: { left: 8, right: 8 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,padding,verticalAlignment)',
      },
    },
    // Benchmark Currency (Col D:F, Row 8-11)
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 7,
          endRowIndex: 11,
          startColumnIndex: 3,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
            padding: { right: 8 },
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment,padding)',
      },
    },
    // Benchmark Percent (Col G, Row 8-11)
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 7,
          endRowIndex: 11,
          startColumnIndex: 6,
          endColumnIndex: 7,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'PERCENT', pattern: '0.0%' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Benchmark Status (Col H, Row 8-11)
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 7,
          endRowIndex: 11,
          startColumnIndex: 7,
          endColumnIndex: 8,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
      },
    },
    // Benchmark Total Row (Row 11)
    {
      repeatCell: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 10,
          endRowIndex: 11,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10 },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)',
      },
    },
    // Table Borders
    {
      updateBorders: {
        range: {
          sheetId: konsolidasiSheetId,
          startRowIndex: 6,
          endRowIndex: 11,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
        top: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
        bottom: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
        left: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
        right: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
        innerHorizontal: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        innerVertical: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
      },
    },
    // Column Widths for Tab 1
    ...[
      { col: 0, width: 60 },
      { col: 1, width: 220 },
      { col: 2, width: 220 },
      { col: 3, width: 180 },
      { col: 4, width: 180 },
      { col: 5, width: 180 },
      { col: 6, width: 130 },
      { col: 7, width: 230 },
      { col: 8, width: 110 },
      { col: 9, width: 220 },
    ].map((cw) => ({
      updateDimensionProperties: {
        range: {
          sheetId: konsolidasiSheetId,
          dimension: 'COLUMNS',
          startIndex: cw.col,
          endIndex: cw.col + 1,
        },
        properties: { pixelSize: cw.width },
        fields: 'pixelSize',
      },
    })),
    // Row Heights for Tab 1
    {
      updateDimensionProperties: {
        range: { sheetId: konsolidasiSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 45 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: konsolidasiSheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 32 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: konsolidasiSheetId, dimension: 'ROWS', startIndex: 2, endIndex: 3 },
        properties: { pixelSize: 30 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: konsolidasiSheetId, dimension: 'ROWS', startIndex: 3, endIndex: 4 },
        properties: { pixelSize: 40 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: konsolidasiSheetId, dimension: 'ROWS', startIndex: 6, endIndex: 7 },
        properties: { pixelSize: 35 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: konsolidasiSheetId, dimension: 'ROWS', startIndex: 7, endIndex: 11 },
        properties: { pixelSize: 32 },
        fields: 'pixelSize',
      },
    },
    // Styling Tab 2: 02_SEMUA_TRANSAKSI_GLOBAL Header
    {
      repeatCell: {
        range: {
          sheetId: globalTxSheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 11,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    // Column widths for Tab 2
    ...[
      { col: 0, width: 170 },
      { col: 1, width: 120 },
      { col: 2, width: 180 },
      { col: 3, width: 150 },
      { col: 4, width: 150 },
      { col: 5, width: 180 },
      { col: 6, width: 280 },
      { col: 7, width: 180 },
      { col: 8, width: 150 },
      { col: 9, width: 150 },
      { col: 10, width: 130 },
    ].map((cw) => ({
      updateDimensionProperties: {
        range: {
          sheetId: globalTxSheetId,
          dimension: 'COLUMNS',
          startIndex: cw.col,
          endIndex: cw.col + 1,
        },
        properties: { pixelSize: cw.width },
        fields: 'pixelSize',
      },
    })),
    // Number format for Tab 2 Column H (Currency)
    {
      repeatCell: {
        range: {
          sheetId: globalTxSheetId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 7,
          endColumnIndex: 8,
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'RIGHT',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    },
    // Styling Tab 3: 03_DIREKTORI_SPPG Header
    {
      repeatCell: {
        range: {
          sheetId: direktoriSheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 8,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    // Column widths for Tab 3
    ...[
      { col: 0, width: 140 },
      { col: 1, width: 200 },
      { col: 2, width: 220 },
      { col: 3, width: 170 },
      { col: 4, width: 220 },
      { col: 5, width: 150 },
      { col: 6, width: 160 },
      { col: 7, width: 240 },
    ].map((cw) => ({
      updateDimensionProperties: {
        range: {
          sheetId: direktoriSheetId,
          dimension: 'COLUMNS',
          startIndex: cw.col,
          endIndex: cw.col + 1,
        },
        properties: { pixelSize: cw.width },
        fields: 'pixelSize',
      },
    })),
  ];
}


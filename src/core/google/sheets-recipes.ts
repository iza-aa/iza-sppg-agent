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

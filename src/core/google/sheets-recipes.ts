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
  DASHBOARD: 1001,
  PAGU_RINGKASAN: 1002,
  PAGU_RINCIAN: 1003,
  PENGELUARAN_SUPPLIER: 1004,
  REKAP_MARGIN: 1005,
  MASTER_DATA: 1006,
  // Backward compat aliases
  RINGKASAN_EKSEKUTIF: 1001,
  PENDAPATAN_SPPG: 1002,
  REKAP_MARGIN_HARIAN: 1005,
} as const;

export const SHEET_NAMES = {
  DASHBOARD: '01_DASHBOARD',
  PAGU_RINGKASAN: '02_PAGU_RINGKASAN',
  PAGU_RINCIAN: '03_PAGU_RINCIAN',
  PENGELUARAN_SUPPLIER: '04_PENGELUARAN_SUPPLIER',
  REKAP_MARGIN: '05_REKAP_MARGIN',
  MASTER_DATA: '06_MASTER_DATA',
  // Backward compat aliases
  RINGKASAN_EKSEKUTIF: '01_DASHBOARD',
  PENDAPATAN_SPPG: '02_PAGU_RINGKASAN',
  REKAP_MARGIN_HARIAN: '05_REKAP_MARGIN',
} as const;

export const MASTER_SHEET_IDS = {
  DASHBOARD: 0,
  SEMUA_TRANSAKSI: 2002,
  DAFTAR_DAPUR: 2003,
  KONSOLIDASI_NASIONAL: 0,
  SEMUA_TRANSAKSI_GLOBAL: 2002,
  DIREKTORI_SPPG: 2003,
} as const;

export const MASTER_SHEET_NAMES = {
  DASHBOARD: '01_DASHBOARD',
  SEMUA_TRANSAKSI: '02_SEMUA_TRANSAKSI',
  DAFTAR_DAPUR: '03_DAFTAR_DAPUR',
  KONSOLIDASI_NASIONAL: '01_DASHBOARD',
  SEMUA_TRANSAKSI_GLOBAL: '02_SEMUA_TRANSAKSI',
  DIREKTORI_SPPG: '03_DAFTAR_DAPUR',
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
    // 1. Rename Default Sheet (Sheet1) menjadi 01_DASHBOARD
    {
      updateSheetProperties: {
        properties: {
          sheetId: defaultSheetId,
          title: SHEET_NAMES.DASHBOARD,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) },
          gridProperties: {
            rowCount: 45,
            columnCount: 16,
            hideGridlines: false
          }
        },
        fields: 'title,tabColorStyle,gridProperties(rowCount,columnCount,hideGridlines)'
      }
    },
    // 2. Tab 02_PAGU_RINGKASAN
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.PAGU_RINGKASAN,
          title: SHEET_NAMES.PAGU_RINGKASAN,
          index: 1,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SOFT_SKY_BLUE) },
          gridProperties: {
            rowCount: 2000,
            columnCount: 10,
            frozenRowCount: 1
          }
        }
      }
    },
    // 3. Tab 03_PAGU_RINCIAN
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.PAGU_RINCIAN,
          title: SHEET_NAMES.PAGU_RINCIAN,
          index: 2,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.EMBLEM_GOLD) },
          gridProperties: {
            rowCount: 5000,
            columnCount: 10,
            frozenRowCount: 1
          }
        }
      }
    },
    // 4. Tab 04_PENGELUARAN_SUPPLIER
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.PENGELUARAN_SUPPLIER,
          title: SHEET_NAMES.PENGELUARAN_SUPPLIER,
          index: 3,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.CRIMSON_RED) },
          gridProperties: {
            rowCount: 5000,
            columnCount: 10,
            frozenRowCount: 1
          }
        }
      }
    },
    // 5. Tab 05_REKAP_MARGIN
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.REKAP_MARGIN,
          title: SHEET_NAMES.REKAP_MARGIN,
          index: 4,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.FOREST_GREEN) },
          gridProperties: {
            rowCount: 5000,
            columnCount: 13,
            frozenRowCount: 1
          }
        }
      }
    },
    // 6. Tab 06_MASTER_DATA (Tersembunyi / Hidden)
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.MASTER_DATA,
          title: SHEET_NAMES.MASTER_DATA,
          index: 5,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SLATE_GRAY) },
          hidden: true,
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

function resolveSheetId(sheetMap: Map<string, number> | undefined, title: string, fallback: number): number {
  return sheetMap?.get(title) ?? fallback;
}

/**
 * Menghapus Data Validation Dropdown pada Kolom Item (bebas entri teks tanpa panah dropdown)
 */
export function createDataValidationBatchRequests(sheetMap?: Map<string, number>): sheets_v4.Schema$Request[] {
  const paguRingkasanId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_RINGKASAN, SHEET_IDS.PAGU_RINGKASAN);
  const paguRincianId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_RINCIAN, SHEET_IDS.PAGU_RINCIAN);
  const pengeluaranId = resolveSheetId(sheetMap, SHEET_NAMES.PENGELUARAN_SUPPLIER, SHEET_IDS.PENGELUARAN_SUPPLIER);
  const rekapMarginId = resolveSheetId(sheetMap, SHEET_NAMES.REKAP_MARGIN, SHEET_IDS.REKAP_MARGIN);

  return [
    {
      setDataValidation: {
        range: {
          sheetId: paguRingkasanId,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId: paguRincianId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId: pengeluaranId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 0,
          endColumnIndex: 10,
        },
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId: rekapMarginId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 0,
          endColumnIndex: 13,
        },
      },
    },
  ];
}

/**
 * Membuat BatchUpdate Requests untuk Format Rupiah, Tanggal ISO, dan Persentase
 */
export function createNumberFormattingBatchRequests(sheetMap?: Map<string, number>): sheets_v4.Schema$Request[] {
  const paguRingkasanId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_RINGKASAN, SHEET_IDS.PAGU_RINGKASAN);
  const paguRincianId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_RINCIAN, SHEET_IDS.PAGU_RINCIAN);
  const pengeluaranId = resolveSheetId(sheetMap, SHEET_NAMES.PENGELUARAN_SUPPLIER, SHEET_IDS.PENGELUARAN_SUPPLIER);
  const rekapMarginId = resolveSheetId(sheetMap, SHEET_NAMES.REKAP_MARGIN, SHEET_IDS.REKAP_MARGIN);

  return [
    // Tab 02 (PAGU_RINGKASAN): Tanggal Pesanan (Kolom C)
    {
      repeatCell: {
        range: {
          sheetId: paguRingkasanId,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 2,
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
    // Tab 02 (PAGU_RINGKASAN): Total Pagu Anggaran (Kolom F)
    {
      repeatCell: {
        range: {
          sheetId: paguRingkasanId,
          startRowIndex: 1,
          endRowIndex: 2000,
          startColumnIndex: 5,
          endColumnIndex: 6
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 03 (PAGU_RINCIAN): Kuantitas (Kolom F)
    {
      repeatCell: {
        range: {
          sheetId: paguRincianId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 5,
          endColumnIndex: 6
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'NUMBER', pattern: '#,##0' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 03 (PAGU_RINCIAN): Harga Pagu Satuan & Total Pagu (Kolom H & I)
    {
      repeatCell: {
        range: {
          sheetId: paguRincianId,
          startRowIndex: 1,
          endRowIndex: 5000,
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
    // Tab 04 (PENGELUARAN_SUPPLIER): Tanggal Transaksi (Kolom C)
    {
      repeatCell: {
        range: {
          sheetId: pengeluaranId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 2,
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
    // Tab 04 (PENGELUARAN_SUPPLIER): Total Nominal Tagihan (Kolom F)
    {
      repeatCell: {
        range: {
          sheetId: pengeluaranId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 5,
          endColumnIndex: 6
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 05 (REKAP_MARGIN): Tanggal (Kolom B)
    {
      repeatCell: {
        range: {
          sheetId: rekapMarginId,
          startRowIndex: 1,
          endRowIndex: 5000,
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
    // Tab 05 (REKAP_MARGIN): Kuantitas (Kolom E)
    {
      repeatCell: {
        range: {
          sheetId: rekapMarginId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 4,
          endColumnIndex: 5
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'NUMBER', pattern: '#,##0' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 05 (REKAP_MARGIN): Harga Pagu, Total Pagu, Harga Invoice, Total Realisasi, Margin Bersih (Kolom G..K)
    {
      repeatCell: {
        range: {
          sheetId: rekapMarginId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 6,
          endColumnIndex: 11
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 05 (REKAP_MARGIN): % Margin (Kolom L)
    {
      repeatCell: {
        range: {
          sheetId: rekapMarginId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 11,
          endColumnIndex: 12
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
 * Membuat BatchUpdate Requests untuk 4-Tier Conditional Formatting pada Tab 05_REKAP_MARGIN (Status)
 */
export function createConditionalFormattingBatchRequests(sheetMap?: Map<string, number>): sheets_v4.Schema$Request[] {
  const rekapMarginId = resolveSheetId(sheetMap, SHEET_NAMES.REKAP_MARGIN, SHEET_IDS.REKAP_MARGIN);

  return [
    // 1. Hijau: HEMAT
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: rekapMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 12,
              endColumnIndex: 13
            }
          ],
          booleanRule: {
            condition: {
              type: 'TEXT_CONTAINS',
              values: [{ userEnteredValue: 'HEMAT' }]
            },
            format: {
              backgroundColor: hexToRgbColor('#D1FAE5'),
              textFormat: {
                foregroundColor: hexToRgbColor('#065F46'),
                bold: true
              }
            }
          }
        },
        index: 0
      }
    },
    // 2. Biru / Cyan: PAS
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: rekapMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 12,
              endColumnIndex: 13
            }
          ],
          booleanRule: {
            condition: {
              type: 'TEXT_CONTAINS',
              values: [{ userEnteredValue: 'PAS' }]
            },
            format: {
              backgroundColor: hexToRgbColor('#E0F2FE'),
              textFormat: {
                foregroundColor: hexToRgbColor('#0369A1'),
                bold: true
              }
            }
          }
        },
        index: 1
      }
    },
    // 3. Merah: OVER BUDGET
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: rekapMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 12,
              endColumnIndex: 13
            }
          ],
          booleanRule: {
            condition: {
              type: 'TEXT_CONTAINS',
              values: [{ userEnteredValue: 'OVER BUDGET' }]
            },
            format: {
              backgroundColor: hexToRgbColor('#FEE2E2'),
              textFormat: {
                foregroundColor: hexToRgbColor('#991B1B'),
                bold: true
              }
            }
          }
        },
        index: 2
      }
    },
    // 4. Kuning: MENUNGGU INVOICE
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: rekapMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 12,
              endColumnIndex: 13
            }
          ],
          booleanRule: {
            condition: {
              type: 'TEXT_CONTAINS',
              values: [{ userEnteredValue: 'MENUNGGU' }]
            },
            format: {
              backgroundColor: hexToRgbColor('#FEF3C7'),
              textFormat: {
                foregroundColor: hexToRgbColor('#92400E'),
                bold: true
              }
            }
          }
        },
        index: 3
      }
    },
    // 5. Oranye: BELUM LENGKAP
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: rekapMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 12,
              endColumnIndex: 13
            }
          ],
          booleanRule: {
            condition: {
              type: 'TEXT_CONTAINS',
              values: [{ userEnteredValue: 'BELUM LENGKAP' }]
            },
            format: {
              backgroundColor: hexToRgbColor('#FFEDD5'),
              textFormat: {
                foregroundColor: hexToRgbColor('#C2410C'),
                bold: true
              }
            }
          }
        },
        index: 4
      }
    }
  ];
}

/**
 * BatchUpdate Requests untuk styling Header baris 1 setiap Tab (Deep Navy & Teks Putih Bold) + Native Filter + Column Widths
 */
export function createHeaderStylingBatchRequests(sheetMap?: Map<string, number>): sheets_v4.Schema$Request[] {
  const navyBg = hexToRgbColor(BGN_PALETTE.DEEP_NAVY);
  const whiteTxt = hexToRgbColor(BGN_PALETTE.WHITE);
  const masterDataId = resolveSheetId(sheetMap, SHEET_NAMES.MASTER_DATA, SHEET_IDS.MASTER_DATA);

  const tabWidths: { sheetId: number; widths: number[] }[] = [
    // Tab 02: PAGU_RINGKASAN (10 Kolom)
    {
      sheetId: resolveSheetId(sheetMap, SHEET_NAMES.PAGU_RINGKASAN, SHEET_IDS.PAGU_RINGKASAN),
      widths: [130, 140, 110, 110, 120, 140, 120, 220, 150, 180]
    },
    // Tab 03: PAGU_RINCIAN (10 Kolom)
    {
      sheetId: resolveSheetId(sheetMap, SHEET_NAMES.PAGU_RINCIAN, SHEET_IDS.PAGU_RINCIAN),
      widths: [120, 140, 65, 150, 200, 85, 85, 120, 140, 160]
    },
    // Tab 04: PENGELUARAN_SUPPLIER (10 Kolom)
    {
      sheetId: resolveSheetId(sheetMap, SHEET_NAMES.PENGELUARAN_SUPPLIER, SHEET_IDS.PENGELUARAN_SUPPLIER),
      widths: [130, 140, 110, 150, 130, 140, 110, 120, 130, 180]
    },
    // Tab 05: REKAP_MARGIN (13 Kolom)
    {
      sheetId: resolveSheetId(sheetMap, SHEET_NAMES.REKAP_MARGIN, SHEET_IDS.REKAP_MARGIN),
      widths: [120, 105, 140, 180, 75, 75, 115, 135, 115, 135, 135, 85, 140]
    },
    // Tab 06: MASTER_DATA (3 Kolom)
    {
      sheetId: masterDataId,
      widths: [200, 120, 160]
    }
  ];

  const requests: sheets_v4.Schema$Request[] = [];

  for (const tw of tabWidths) {
    const colCount = tw.widths.length;

    // 1. Header Cell Styling (Navy, White Bold, Center, Middle)
    requests.push({
      repeatCell: {
        range: {
          sheetId: tw.sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: colCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10, fontFamily: 'Arial' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    });

    // 2. Row 1 Height: 34px
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: tw.sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 34 },
        fields: 'pixelSize',
      },
    });

    // 3. Basic Filter on Row 1 (except Master Data)
    if (tw.sheetId !== masterDataId) {
      requests.push({
        setBasicFilter: {
          filter: {
            range: {
              sheetId: tw.sheetId,
              startRowIndex: 0,
              startColumnIndex: 0,
              endColumnIndex: colCount,
            },
          },
        },
      });
    }

    // 4. Column Widths
    tw.widths.forEach((w, colIdx) => {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: tw.sheetId, dimension: 'COLUMNS', startIndex: colIdx, endIndex: colIdx + 1 },
          properties: { pixelSize: w },
          fields: 'pixelSize',
        },
      });
    });
  }

  return requests;
}

/**
 * Membuat BatchUpdate Requests untuk Official Google Sheets Alternating Colors (Zebra Banding)
 */
export function createBandingBatchRequests(
  sheetMap?: Map<string, number>,
  existingBandedSheetIds: Set<number> = new Set()
): sheets_v4.Schema$Request[] {
  const navyBg = hexToRgbColor(BGN_PALETTE.DEEP_NAVY);
  const band1 = hexToRgbColor('#FFFFFF');
  const band2 = hexToRgbColor('#F1F5F9');

  const paguRingkasanId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_RINGKASAN, SHEET_IDS.PAGU_RINGKASAN);
  const paguRincianId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_RINCIAN, SHEET_IDS.PAGU_RINCIAN);
  const pengeluaranId = resolveSheetId(sheetMap, SHEET_NAMES.PENGELUARAN_SUPPLIER, SHEET_IDS.PENGELUARAN_SUPPLIER);
  const rekapMarginId = resolveSheetId(sheetMap, SHEET_NAMES.REKAP_MARGIN, SHEET_IDS.REKAP_MARGIN);

  const targets = [
    { sheetId: paguRingkasanId, endCol: 10, endRow: 2000 },
    { sheetId: paguRincianId, endCol: 10, endRow: 5000 },
    { sheetId: pengeluaranId, endCol: 10, endRow: 5000 },
    { sheetId: rekapMarginId, endCol: 13, endRow: 5000 },
  ];

  const requests: sheets_v4.Schema$Request[] = [];

  for (const t of targets) {
    if (existingBandedSheetIds.has(t.sheetId)) {
      continue; // Skip if this sheet already has a banded range to avoid Google API collision
    }
    requests.push({
      addBanding: {
        bandedRange: {
          range: {
            sheetId: t.sheetId,
            startRowIndex: 0,
            endRowIndex: t.endRow,
            startColumnIndex: 0,
            endColumnIndex: t.endCol,
          },
          rowProperties: {
            headerColor: navyBg,
            firstBandColor: band1,
            secondBandColor: band2,
          },
        },
      },
    });
  }

  return requests;
}

/**
 * Membuat BatchUpdate Requests untuk struktur Master Dashboard BGN (3 Tab Eksekutif)
 */
export function createMasterDashboardStructureBatchRequests(
  existingSheetMap: Map<string, number>,
  firstSheetId: number = 0,
  existingChartIds: number[] = []
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];

  // 1. Rename first sheet or 01_KONSOLIDASI_NASIONAL / 01_RINGKASAN_EKSEKUTIF to 01_DASHBOARD
  const firstId =
    existingSheetMap.get('01_DASHBOARD') ??
    existingSheetMap.get('01_KONSOLIDASI_NASIONAL') ??
    existingSheetMap.get('01_RINGKASAN_EKSEKUTIF') ??
    firstSheetId;

  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId: firstId,
        title: MASTER_SHEET_NAMES.DASHBOARD,
        tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) },
        gridProperties: {
          rowCount: 35,
          columnCount: 13,
          hideGridlines: true,
          frozenRowCount: 0,
        },
      },
      fields: 'title,tabColorStyle,gridProperties(rowCount,columnCount,hideGridlines,frozenRowCount)',
    },
  });

  // 2. Rename or Add 02_SEMUA_TRANSAKSI
  const oldTrxId = existingSheetMap.get('02_SEMUA_TRANSAKSI_GLOBAL') ?? existingSheetMap.get('02_SEMUA_TRANSAKSI');
  if (oldTrxId !== undefined) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: oldTrxId,
          title: MASTER_SHEET_NAMES.SEMUA_TRANSAKSI,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.FOREST_GREEN) },
          gridProperties: {
            rowCount: 5000,
            columnCount: 12,
            frozenRowCount: 1,
          },
        },
        fields: 'title,tabColorStyle,gridProperties(rowCount,columnCount,frozenRowCount)',
      },
    });
  } else {
    requests.push({
      addSheet: {
        properties: {
          sheetId: MASTER_SHEET_IDS.SEMUA_TRANSAKSI,
          title: MASTER_SHEET_NAMES.SEMUA_TRANSAKSI,
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

  // 3. Rename or Add 03_DAFTAR_DAPUR
  const oldDirId = existingSheetMap.get('03_DIREKTORI_SPPG') ?? existingSheetMap.get('03_DAFTAR_DAPUR');
  if (oldDirId !== undefined) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: oldDirId,
          title: MASTER_SHEET_NAMES.DAFTAR_DAPUR,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.EMBLEM_GOLD) },
          gridProperties: {
            rowCount: 100,
            columnCount: 10,
            frozenRowCount: 1,
          },
        },
        fields: 'title,tabColorStyle,gridProperties(rowCount,columnCount,frozenRowCount)',
      },
    });
  } else {
    requests.push({
      addSheet: {
        properties: {
          sheetId: MASTER_SHEET_IDS.DAFTAR_DAPUR,
          title: MASTER_SHEET_NAMES.DAFTAR_DAPUR,
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

  // 5. Delete old charts if any
  for (const chartId of existingChartIds) {
    requests.push({
      deleteEmbeddedObject: {
        objectId: chartId,
      },
    });
  }

  // 6. Unmerge any existing merges on 01_DASHBOARD
  requests.push({
    unmergeCells: {
      range: {
        sheetId: firstId,
        startRowIndex: 0,
        endRowIndex: 35,
        startColumnIndex: 0,
        endColumnIndex: 13,
      },
    },
  });

  // 7. Set Column Widths (A..M)
  const colWidths = [
    { start: 0, end: 1, px: 25 },   // A: Left margin
    { start: 1, end: 2, px: 70 },   // B
    { start: 2, end: 3, px: 170 },  // C
    { start: 3, end: 4, px: 150 },  // D: Anggaran
    { start: 4, end: 5, px: 145 },  // E: Belanja
    { start: 5, end: 6, px: 25 },   // F: Divider gap
    { start: 6, end: 7, px: 147 },  // G: Dapur
    { start: 7, end: 8, px: 204 },  // H: Belanja
    { start: 8, end: 9, px: 115 },  // I: % Share
    { start: 9, end: 10, px: 130 }, // J: Progress Bar
    { start: 10, end: 11, px: 130 },// K: Status
    { start: 11, end: 12, px: 25 }, // L: Right margin
    { start: 12, end: 13, px: 25 }, // M: Helper (hidden)
  ];
  for (const cw of colWidths) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: firstId,
          dimension: 'COLUMNS',
          startIndex: cw.start,
          endIndex: cw.end,
        },
        properties: {
          pixelSize: cw.px,
        },
        fields: 'pixelSize',
      },
    });
  }

  // 8. Row heights for key rows
  const rowHeights = [
    { row: 0, px: 21 },  // R1: Spacer
    { row: 1, px: 32 },  // R2: Header title
    { row: 2, px: 28 },  // R3: Subtitle & dropdowns
    { row: 3, px: 21 },  // R4: Spacer
    { row: 4, px: 26 },  // R5: KPI title
    { row: 5, px: 44 },  // R6: KPI value
    { row: 6, px: 24 },  // R7: KPI subtitle
    { row: 7, px: 21 },  // R8: Spacer
    { row: 8, px: 28 },  // R9: Section header
    { row: 14, px: 30 }, // R15: Total row
    { row: 15, px: 21 }, // R16: Spacer
    { row: 16, px: 28 }, // R17: Lower header
    { row: 17, px: 26 }, // R18: Subheader
  ];
  for (const rh of rowHeights) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId: firstId,
          dimension: 'ROWS',
          startIndex: rh.row,
          endIndex: rh.row + 1,
        },
        properties: {
          pixelSize: rh.px,
        },
        fields: 'pixelSize',
      },
    });
  }

  // 9. Hide column M (helper for date filters)
  requests.push({
    updateDimensionProperties: {
      range: {
        sheetId: firstId,
        dimension: 'COLUMNS',
        startIndex: 12,
        endIndex: 13,
      },
      properties: {
        hiddenByUser: true,
      },
      fields: 'hiddenByUser',
    },
  });

  return requests;
}

/**
 * Menyediakan seluruh baris nilai dan rumus visual untuk 01_DASHBOARD Master Spreadsheet
 */
export function getMasterDashboardValues() {
  const valuesDashboard: string[][] = [
    // R1: empty padding (21px)
    [],
    // R2: Header Banner Top (B2:G2 Title, H2:I2 Month Header, J2:K2 Year Header)
    ['', 'DASHBOARD PUSAT SPPG', '', '', '', '', '', 'PILIH BULAN', '', 'PILIH TAHUN', ''],
    // R3: Subtitle & Dropdowns (B3:G3 Subtitle, H3:I3 Month Dropdown, J3:K3 Year Dropdown)
    ['', 'Rekap Anggaran & Belanja Seluruh Dapur SPPG', '', '', '', '', '', 'SEMUA BULAN', '', 'SEMUA TAHUN', ''],
    // R4: empty padding (21px)
    [],
    // R5: KPI Titles (B5:C5, D5:E5, Gap F, G5:H5, I5:K5)
    ['', 'TOTAL ANGGARAN', '', 'TOTAL BELANJA', '', '', 'SISA ANGGARAN', '', 'DAPUR & TRANSAKSI', '', ''],
    // R6: KPI Values
    [
      '',
      `=IFERROR(SUMIFS('02_SEMUA_TRANSAKSI'!$H:$H; '02_SEMUA_TRANSAKSI'!$D:$D; "PENDAPATAN"; '02_SEMUA_TRANSAKSI'!$B:$B; ">="&$M$1; '02_SEMUA_TRANSAKSI'!$B:$B; "<="&$M$2); 0)`,
      '',
      '=H15',
      '',
      '',
      '=B6-D6',
      '',
      `=COUNTA('03_DAFTAR_DAPUR'!$A$2:$A) & " Dapur | " & IFERROR(COUNTIFS('02_SEMUA_TRANSAKSI'!$A$2:$A; "<>"; '02_SEMUA_TRANSAKSI'!$B$2:$B; ">="&$M$1; '02_SEMUA_TRANSAKSI'!$B$2:$B; "<="&$M$2); 0) & " Trx"`,
      '',
      ''
    ],
    // R7: KPI Subtitles
    [
      '',
      'Pagu Masuk Seluruh SPPG',
      '',
      'Realisasi Belanja Seluruh Dapur',
      '',
      '',
      'Sisa Margin Anggaran',
      '',
      'Unit Operasional & Transaksi',
      '',
      ''
    ],
    // R8: empty padding (21px)
    [],
    // R9: Section Headers (B9:E9 Left, Gap F, G9:K9 Right)
    ['', 'REALISASI ANGGARAN PER DAPUR', '', '', '', '', 'PROPORSI BELANJA KONSOLIDASI', '', '', '', ''],
    // R10: SPPG Patila
    [
      '',
      'SPPG Patila',
      '',
      '',
      `=IFERROR(SUMIFS('02_SEMUA_TRANSAKSI'!$H:$H; '02_SEMUA_TRANSAKSI'!$C:$C; "SPPG Patila"; '02_SEMUA_TRANSAKSI'!$D:$D; "PENGELUARAN"; '02_SEMUA_TRANSAKSI'!$B:$B; ">="&$M$1; '02_SEMUA_TRANSAKSI'!$B:$B; "<="&$M$2); 0)`,
      '',
      'SPPG Patila',
      '=E10',
      `=IFERROR(H10/$H$15; 0)`,
      `=REPT("█"; ROUND(I10*28)) & REPT("░"; 28-ROUND(I10*28))`,
      ''
    ],
    // R11: SPPG Dapur Unit 2
    [
      '',
      'SPPG Dapur Unit 2',
      '',
      '',
      `=IFERROR(SUMIFS('02_SEMUA_TRANSAKSI'!$H:$H; '02_SEMUA_TRANSAKSI'!$C:$C; "SPPG Dapur Unit 2"; '02_SEMUA_TRANSAKSI'!$D:$D; "PENGELUARAN"; '02_SEMUA_TRANSAKSI'!$B:$B; ">="&$M$1; '02_SEMUA_TRANSAKSI'!$B:$B; "<="&$M$2); 0)`,
      '',
      'SPPG Dapur Unit 2',
      '=E11',
      `=IFERROR(H11/$H$15; 0)`,
      `=REPT("█"; ROUND(I11*28)) & REPT("░"; 28-ROUND(I11*28))`,
      ''
    ],
    // R12: SPPG Dapur Unit 3
    [
      '',
      'SPPG Dapur Unit 3',
      '',
      '',
      `=IFERROR(SUMIFS('02_SEMUA_TRANSAKSI'!$H:$H; '02_SEMUA_TRANSAKSI'!$C:$C; "SPPG Dapur Unit 3"; '02_SEMUA_TRANSAKSI'!$D:$D; "PENGELUARAN"; '02_SEMUA_TRANSAKSI'!$B:$B; ">="&$M$1; '02_SEMUA_TRANSAKSI'!$B:$B; "<="&$M$2); 0)`,
      '',
      'SPPG Dapur Unit 3',
      '=E12',
      `=IFERROR(H12/$H$15; 0)`,
      `=REPT("█"; ROUND(I12*28)) & REPT("░"; 28-ROUND(I12*28))`,
      ''
    ],
    // R13: Cadangan 1
    [
      '',
      '-',
      '',
      '',
      '0',
      '',
      '-',
      '0',
      '0.0%',
      '',
      ''
    ],
    // R14: Cadangan 2
    [
      '',
      '-',
      '',
      '',
      '0',
      '',
      '-',
      '0',
      '0.0%',
      '',
      ''
    ],
    // R15: Totals
    [
      '',
      'TOTAL REALISASI SELURUH DAPUR',
      '',
      '',
      `=SUM(E10:E14)`,
      '',
      'TOTAL BELANJA',
      `=SUM(H10:H14)`,
      '100.0%',
      '',
      ''
    ],
    // R16: empty spacer (16px)
    [],
    // R17: Lower Titles (B17:E17 empty for Pie Chart overlay, G17:K17 Title)
    ['', '', '', '', '', '', '10 TRANSAKSI TERAKHIR (KONSOLIDASI)', '', '', '', ''],
    // R18: Subheaders
    ['', '', '', '', '', '', 'Tanggal', 'Dapur SPPG', 'Supplier', 'Nominal', 'Status'],
  ];

  // R19..R28: 10 Recent Transactions in G..K (B..E remain empty for pie chart overlay)
  for (let i = 1; i <= 10; i++) {
    valuesDashboard.push([
      '',
      '',
      '',
      '',
      '',
      '',
      `=IFERROR(INDEX(SORT(FILTER('02_SEMUA_TRANSAKSI'!$B$2:$K; '02_SEMUA_TRANSAKSI'!$A$2:$A<>""; '02_SEMUA_TRANSAKSI'!$B$2:$B>=$M$1; '02_SEMUA_TRANSAKSI'!$B$2:$B<=$M$2); 1; FALSE); ${i}; 1); "-")`,
      `=IFERROR(INDEX(SORT(FILTER('02_SEMUA_TRANSAKSI'!$B$2:$K; '02_SEMUA_TRANSAKSI'!$A$2:$A<>""; '02_SEMUA_TRANSAKSI'!$B$2:$B>=$M$1; '02_SEMUA_TRANSAKSI'!$B$2:$B<=$M$2); 1; FALSE); ${i}; 2); "-")`,
      `=IFERROR(INDEX(SORT(FILTER('02_SEMUA_TRANSAKSI'!$B$2:$K; '02_SEMUA_TRANSAKSI'!$A$2:$A<>""; '02_SEMUA_TRANSAKSI'!$B$2:$B>=$M$1; '02_SEMUA_TRANSAKSI'!$B$2:$B<=$M$2); 1; FALSE); ${i}; 5); "-")`,
      `=IFERROR(INDEX(SORT(FILTER('02_SEMUA_TRANSAKSI'!$B$2:$K; '02_SEMUA_TRANSAKSI'!$A$2:$A<>""; '02_SEMUA_TRANSAKSI'!$B$2:$B>=$M$1; '02_SEMUA_TRANSAKSI'!$B$2:$B<=$M$2); 1; FALSE); ${i}; 7); 0)`,
      `=IFERROR(INDEX(SORT(FILTER('02_SEMUA_TRANSAKSI'!$B$2:$K; '02_SEMUA_TRANSAKSI'!$A$2:$A<>""; '02_SEMUA_TRANSAKSI'!$B$2:$B>=$M$1; '02_SEMUA_TRANSAKSI'!$B$2:$B<=$M$2); 1; FALSE); ${i}; 10); "-")`
    ]);
  }

  const valuesHelper = [
    [`=IFS(AND($H$3="SEMUA BULAN"; $J$3="SEMUA TAHUN"); DATE(2020;1;1); $H$3="SEMUA BULAN"; DATE($M$4; 1; 1); $M$3>0; DATE($M$4; $M$3; 1); TRUE; DATE(2020;1;1))`],
    [`=IFS(AND($H$3="SEMUA BULAN"; $J$3="SEMUA TAHUN"); DATE(2035;12;31); $H$3="SEMUA BULAN"; DATE($M$4; 12; 31); $M$3>0; EOMONTH(DATE($M$4; $M$3; 1); 0); TRUE; DATE(2035;12;31))`],
    [`=IFERROR(MATCH(UPPER($H$3); {"JANUARI"; "FEBRUARI"; "MARET"; "APRIL"; "MEI"; "JUNI"; "JULI"; "AGUSTUS"; "SEPTEMBER"; "OKTOBER"; "NOVEMBER"; "DESEMBER"}; 0); 0)`],
    [`=IF(ISNUMBER(VALUE($J$3)); VALUE($J$3); YEAR(TODAY()))`]
  ];

  const tab2Headers = [
    ['ID Transaksi', 'Tanggal', 'Unit SPPG', 'Tipe Transaksi', 'No SPPG / Ref', 'Rekanan / Supplier', 'Uraian Barang / Menu', 'Total Nominal', 'Bukti / Dokumen', 'PIC / Pencatat', 'Status']
  ];

  const tab3Headers = [
    ['ID Unit', 'Nama Dapur SPPG', 'Wilayah / Lokasi', 'Status Operasional', 'Penanggung Jawab', 'Kontak Telegram', 'Kapasitas Porsi / Hari', 'Tautan Spreadsheet']
  ];

  return {
    valuesDashboard,
    valuesHelper,
    tab2Headers,
    tab3Headers
  };
}

/**
 * Menambahkan Diagram Pie Chart (Proporsi Belanja per Dapur) pada range B17:E28 Master Dashboard
 */
export function createMasterDashboardChartRequest(firstId: number): sheets_v4.Schema$Request {
  return {
    addChart: {
      chart: {
        spec: {
          title: 'Proporsi Belanja per Dapur',
          titleTextFormat: {
            fontFamily: 'Roboto',
            fontSize: 11,
            bold: true,
            foregroundColor: { red: 0.12, green: 0.16, blue: 0.23 },
          },
          fontName: 'Roboto',
          pieChart: {
            legendPosition: 'RIGHT_LEGEND',
            domain: {
              sourceRange: {
                sources: [
                  {
                    sheetId: firstId,
                    startRowIndex: 9,
                    endRowIndex: 12,
                    startColumnIndex: 6,
                    endColumnIndex: 7,
                  },
                ],
              },
            },
            series: {
              sourceRange: {
                sources: [
                  {
                    sheetId: firstId,
                    startRowIndex: 9,
                    endRowIndex: 12,
                    startColumnIndex: 7,
                    endColumnIndex: 8,
                  },
                ],
              },
            },
          },
        },
        position: {
          overlayPosition: {
            anchorCell: {
              sheetId: firstId,
              rowIndex: 16,
              columnIndex: 1,
            },
            widthPixels: 535,
            heightPixels: 250,
          },
        },
      },
    },
  };
}

/**
 * Membuat BatchUpdate Requests untuk styling BGN, formatting, merges, dan layout Master Dashboard
 */
export function createMasterDashboardStylingBatchRequests(
  firstId: number,
  globalTxSheetId: number = MASTER_SHEET_IDS.SEMUA_TRANSAKSI,
  direktoriSheetId: number = MASTER_SHEET_IDS.DAFTAR_DAPUR
): sheets_v4.Schema$Request[] {
  const navyBg = hexToRgbColor(BGN_PALETTE.DEEP_NAVY);
  const slateDarkBg = hexToRgbColor(BGN_PALETTE.SLATE_DARK);
  const slateLightBg = hexToRgbColor(BGN_PALETTE.SLATE_LIGHT);
  const softBlueBg = hexToRgbColor(BGN_PALETTE.SOFT_SKY_BLUE);
  const whiteTxt = hexToRgbColor(BGN_PALETTE.WHITE);
  const darkTxt = hexToRgbColor(BGN_PALETTE.DEEP_NAVY);

  return [
    // 1. Merges for Banner Title (B2:G2) & Subtitle (B3:G3)
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 7 },
        mergeType: 'MERGE_ALL',
      },
    },
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 7 },
        mergeType: 'MERGE_ALL',
      },
    },
    // Merges for Month Header (H2:I2) & Month Dropdown (H3:I3)
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 7, endColumnIndex: 9 },
        mergeType: 'MERGE_ALL',
      },
    },
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 7, endColumnIndex: 9 },
        mergeType: 'MERGE_ALL',
      },
    },
    // Merges for Year Header (J2:K2) & Year Dropdown (J3:K3)
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 9, endColumnIndex: 11 },
        mergeType: 'MERGE_ALL',
      },
    },
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 9, endColumnIndex: 11 },
        mergeType: 'MERGE_ALL',
      },
    },

    // KPI Card 1: B5:C7 (Total Anggaran)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' },
    },
    // KPI Card 2: D5:E7 (Total Belanja)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 3, endColumnIndex: 5 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 3, endColumnIndex: 5 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 3, endColumnIndex: 5 }, mergeType: 'MERGE_ALL' },
    },
    // KPI Card 3: G5:H7 (Sisa Anggaran)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 6, endColumnIndex: 8 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 6, endColumnIndex: 8 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 6, endColumnIndex: 8 }, mergeType: 'MERGE_ALL' },
    },
    // KPI Card 4: I5:K7 (Dapur & Transaksi)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 8, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 8, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 8, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },

    // Merges for Left Table Header (B9:E9)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 5 }, mergeType: 'MERGE_ALL' },
    },
    // Merges for Left Table Rows (B10:D10 to B14:D14 and Total B15:D15) -> 390px merged for Unit Name!
    ...[9, 10, 11, 12, 13, 14].map((r) => ({
      mergeCells: { range: { sheetId: firstId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 4 }, mergeType: 'MERGE_ALL' as const },
    })),

    // Merges for Right Table Header (G9:K9)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 6, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },
    // Merges for Right Table Progress Bars (J10:K10 to J14:K14 and Total J15:K15) -> 260px merged for Progress Bar!
    ...[9, 10, 11, 12, 13, 14].map((r) => ({
      mergeCells: { range: { sheetId: firstId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 9, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' as const },
    })),

    // Merges for 10 Transaksi Title (G17:K17)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 16, endRowIndex: 17, startColumnIndex: 6, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },

    // 2. Banner Styling (B2:G3)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            verticalAlignment: 'MIDDLE',
            padding: { left: 16 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,verticalAlignment,padding)',
      },
    },
    // Banner Title text (B2)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 13, fontFamily: 'Roboto' },
          },
        },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    // Banner Subtitle text (B3)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_LIGHT), bold: false, fontSize: 9, fontFamily: 'Roboto' },
          },
        },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Month Header (H2:I2)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: slateDarkBg,
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_LIGHT), bold: true, fontSize: 8, fontFamily: 'Roboto' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Month Dropdown (H3:I3)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 7, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            backgroundColor: softBlueBg,
            textFormat: { foregroundColor: darkTxt, bold: true, fontSize: 10, fontFamily: 'Roboto' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Year Header (J2:K2)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 9, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: slateDarkBg,
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_LIGHT), bold: true, fontSize: 8, fontFamily: 'Roboto' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Year Dropdown (J3:K3)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 9, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: softBlueBg,
            textFormat: { foregroundColor: darkTxt, bold: true, fontSize: 10, fontFamily: 'Roboto' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Dropdown Data Validations
    {
      setDataValidation: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 7, endColumnIndex: 9 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'SEMUA BULAN' },
              { userEnteredValue: 'JANUARI' },
              { userEnteredValue: 'FEBRUARI' },
              { userEnteredValue: 'MARET' },
              { userEnteredValue: 'APRIL' },
              { userEnteredValue: 'MEI' },
              { userEnteredValue: 'JUNI' },
              { userEnteredValue: 'JULI' },
              { userEnteredValue: 'AGUSTUS' },
              { userEnteredValue: 'SEPTEMBER' },
              { userEnteredValue: 'OKTOBER' },
              { userEnteredValue: 'NOVEMBER' },
              { userEnteredValue: 'DESEMBER' },
            ],
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
    {
      setDataValidation: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 9, endColumnIndex: 11 },
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

    // KPI Card 1: B5:C7 (Soft Green)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#E8F5E9'),
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 3 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: hexToRgbColor('#2E7D32'), bold: true, fontSize: 8, fontFamily: 'Roboto' } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: hexToRgbColor('#1B5E20'), bold: true, fontSize: 16, fontFamily: 'Roboto' },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: hexToRgbColor('#388E3C'), bold: false, fontSize: 8, fontFamily: 'Roboto' } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // KPI Card 2: D5:E7 (Soft Red)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 3, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#FFEBEE'),
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 3, endColumnIndex: 5 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: hexToRgbColor('#C62828'), bold: true, fontSize: 8, fontFamily: 'Roboto' } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 3, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: hexToRgbColor('#B71C1C'), bold: true, fontSize: 16, fontFamily: 'Roboto' },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 3, endColumnIndex: 5 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: hexToRgbColor('#D32F2F'), bold: false, fontSize: 8, fontFamily: 'Roboto' } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // KPI Card 3: G5:H7 (Soft Blue)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 6, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#E1F5FE'),
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 6, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY), bold: true, fontSize: 8, fontFamily: 'Roboto' } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 6, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY), bold: true, fontSize: 16, fontFamily: 'Roboto' },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
          },
        },
        fields: 'userEnteredFormat(textFormat,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 6, endColumnIndex: 8 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_DARK), bold: false, fontSize: 8, fontFamily: 'Roboto' } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // KPI Card 4: I5:K7 (Soft Gold / Gray)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 8, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#FFF8E1'),
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 8, endColumnIndex: 11 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.EMBLEM_GOLD), bold: true, fontSize: 8, fontFamily: 'Roboto' } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 8, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY), bold: true, fontSize: 14, fontFamily: 'Roboto' },
          },
        },
        fields: 'userEnteredFormat.textFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 8, endColumnIndex: 11 },
        cell: { userEnteredFormat: { textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_DARK), bold: false, fontSize: 8, fontFamily: 'Roboto' } } },
        fields: 'userEnteredFormat.textFormat',
      },
    },

    // Card Borders
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 },
        top: { style: 'SOLID', color: hexToRgbColor('#C8E6C9') },
        bottom: { style: 'SOLID', color: hexToRgbColor('#C8E6C9') },
        left: { style: 'SOLID', color: hexToRgbColor('#C8E6C9') },
        right: { style: 'SOLID', color: hexToRgbColor('#C8E6C9') },
      },
    },
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 3, endColumnIndex: 5 },
        top: { style: 'SOLID', color: hexToRgbColor('#FFCDD2') },
        bottom: { style: 'SOLID', color: hexToRgbColor('#FFCDD2') },
        left: { style: 'SOLID', color: hexToRgbColor('#FFCDD2') },
        right: { style: 'SOLID', color: hexToRgbColor('#FFCDD2') },
      },
    },
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 6, endColumnIndex: 8 },
        top: { style: 'SOLID', color: hexToRgbColor('#B3E5FC') },
        bottom: { style: 'SOLID', color: hexToRgbColor('#B3E5FC') },
        left: { style: 'SOLID', color: hexToRgbColor('#B3E5FC') },
        right: { style: 'SOLID', color: hexToRgbColor('#B3E5FC') },
      },
    },
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: 8, endColumnIndex: 11 },
        top: { style: 'SOLID', color: hexToRgbColor('#FFE082') },
        bottom: { style: 'SOLID', color: hexToRgbColor('#FFE082') },
        left: { style: 'SOLID', color: hexToRgbColor('#FFE082') },
        right: { style: 'SOLID', color: hexToRgbColor('#FFE082') },
      },
    },

    // Section Headers (B9:E9, G9:K9, G17:K17)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10, fontFamily: 'Roboto' },
            verticalAlignment: 'MIDDLE',
            padding: { left: 12 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 6, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10, fontFamily: 'Roboto' },
            verticalAlignment: 'MIDDLE',
            padding: { left: 12 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 16, endRowIndex: 17, startColumnIndex: 6, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: navyBg,
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10, fontFamily: 'Roboto' },
            verticalAlignment: 'MIDDLE',
            padding: { left: 12 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    },

    // Subheader for Lower Table (G18:K18)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 17, endRowIndex: 18, startColumnIndex: 6, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#F1F5F9'),
            textFormat: { foregroundColor: slateDarkBg, bold: true, fontSize: 9, fontFamily: 'Roboto' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Data Row Zebra Striping & Formats (R10..R14)
    ...[9, 10, 11, 12, 13].map((r, idx) => ({
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            backgroundColor: idx % 2 === 0 ? whiteTxt : hexToRgbColor('#F8FAFC'),
            verticalAlignment: 'MIDDLE',
            textFormat: { foregroundColor: darkTxt, fontSize: 10, fontFamily: 'Roboto' },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,verticalAlignment,textFormat)',
      },
    })),
    ...[9, 10, 11, 12, 13].map((r, idx) => ({
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 6, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: idx % 2 === 0 ? whiteTxt : hexToRgbColor('#F8FAFC'),
            verticalAlignment: 'MIDDLE',
            textFormat: { foregroundColor: darkTxt, fontSize: 10, fontFamily: 'Roboto' },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,verticalAlignment,textFormat)',
      },
    })),

    // Left Table Belanja Currency (E10:E15)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 15, startColumnIndex: 4, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'RIGHT',
            padding: { right: 8 },
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,padding)',
      },
    },
    // Right Table Belanja Currency (H10:H15)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 15, startColumnIndex: 7, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'RIGHT',
            padding: { right: 8 },
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,padding)',
      },
    },
    // Percentage Format for Right Table % Share (I10:I14)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 14, startColumnIndex: 8, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'PERCENT', pattern: '0.0%' },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    },
    // Progress Bar Monospace & Center (J10:K14)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 14, startColumnIndex: 9, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            textFormat: { fontFamily: 'Roboto Mono', fontSize: 8, foregroundColor: navyBg },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Total Row 15 Styling (B15:E15 and G15:K15)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 14, endRowIndex: 15, startColumnIndex: 1, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#F1F5F9'),
            textFormat: { bold: true, fontSize: 9, fontFamily: 'Roboto', foregroundColor: darkTxt },
            verticalAlignment: 'MIDDLE',
            padding: { left: 8 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 14, endRowIndex: 15, startColumnIndex: 6, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor('#F1F5F9'),
            textFormat: { bold: true, fontSize: 9, fontFamily: 'Roboto', foregroundColor: darkTxt },
            verticalAlignment: 'MIDDLE',
            padding: { left: 8 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    },
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 14, endRowIndex: 15, startColumnIndex: 1, endColumnIndex: 5 },
        top: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        bottom: { style: 'DOUBLE', color: hexToRgbColor('#0F2042') },
      },
    },
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 14, endRowIndex: 15, startColumnIndex: 6, endColumnIndex: 11 },
        top: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        bottom: { style: 'DOUBLE', color: hexToRgbColor('#0F2042') },
      },
    },

    // Lower Table (G19:K28) Zebra & Formats
    ...[18, 19, 20, 21, 22, 23, 24, 25, 26, 27].map((r, idx) => ({
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 6, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: idx % 2 === 0 ? whiteTxt : hexToRgbColor('#F8FAFC'),
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,verticalAlignment)',
      },
    })),
    // Lower Table Date (G19:G28)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 18, endRowIndex: 28, startColumnIndex: 6, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment)',
      },
    },
    // Lower Table Nominal (J19:J28)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 18, endRowIndex: 28, startColumnIndex: 9, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'RIGHT',
            padding: { right: 8 },
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,padding)',
      },
    },
    // Lower Table Status (K19:K28)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 18, endRowIndex: 28, startColumnIndex: 10, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment)',
      },
    },

    // Table Borders
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 8, endRowIndex: 15, startColumnIndex: 1, endColumnIndex: 5 },
        top: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        bottom: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        left: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        right: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        innerHorizontal: { style: 'SOLID', color: hexToRgbColor('#E2E8F0') },
      },
    },
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 8, endRowIndex: 15, startColumnIndex: 6, endColumnIndex: 11 },
        top: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        bottom: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        left: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        right: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        innerHorizontal: { style: 'SOLID', color: hexToRgbColor('#E2E8F0') },
      },
    },
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 16, endRowIndex: 28, startColumnIndex: 6, endColumnIndex: 11 },
        top: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        bottom: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        left: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        right: { style: 'SOLID', color: hexToRgbColor('#CBD5E1') },
        innerHorizontal: { style: 'SOLID', color: hexToRgbColor('#E2E8F0') },
      },
    },

    // =========================================================================
    // Tab 2: 02_SEMUA_TRANSAKSI Styling
    // =========================================================================
    // 1. Data rows default formatting (pure white canvas, dark navy text, 10pt)
    {
      repeatCell: {
        range: {
          sheetId: globalTxSheetId,
          startRowIndex: 1,
          endRowIndex: 500,
          startColumnIndex: 0,
          endColumnIndex: 11,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: whiteTxt,
            textFormat: { foregroundColor: darkTxt, bold: false, fontSize: 10, fontFamily: 'Roboto' },
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)',
      },
    },
    // 2. Header Row 1 Styling
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
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10, fontFamily: 'Roboto' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    // 3. Row heights for Tab 2 (R1: 34px, R2..R50: 28px)
    {
      updateDimensionProperties: {
        range: { sheetId: globalTxSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 34 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: globalTxSheetId, dimension: 'ROWS', startIndex: 1, endIndex: 50 },
        properties: { pixelSize: 28 },
        fields: 'pixelSize',
      },
    },
    // 4. Column widths for Tab 2
    ...[
      { col: 0, width: 210 }, // A: ID Transaksi
      { col: 1, width: 110 }, // B: Tanggal
      { col: 2, width: 170 }, // C: Unit SPPG
      { col: 3, width: 140 }, // D: Tipe Transaksi
      { col: 4, width: 140 }, // E: No SPPG / Ref
      { col: 5, width: 180 }, // F: Rekanan / Supplier
      { col: 6, width: 300 }, // G: Uraian Barang / Menu
      { col: 7, width: 160 }, // H: Total Nominal
      { col: 8, width: 140 }, // I: Bukti / Dokumen
      { col: 9, width: 160 }, // J: PIC / Pencatat
      { col: 10, width: 120 }, // K: Status
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
    // 5. Zebra Striping for Tab 2 (Odd index rows)
    ...Array.from({ length: 49 }, (_, idx) => 2 + idx * 2).map((r) => ({
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: 11 },
        cell: { userEnteredFormat: { backgroundColor: hexToRgbColor('#F8FAFC') } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    })),
    // 6. Alignments & Formats for Tab 2
    {
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', padding: { left: 10 } } },
        fields: 'userEnteredFormat(horizontalAlignment,padding)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 1, endColumnIndex: 2 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } },
        fields: 'userEnteredFormat(horizontalAlignment,numberFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 2, endColumnIndex: 3 },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', padding: { left: 8 } } },
        fields: 'userEnteredFormat(horizontalAlignment,padding)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 3, endColumnIndex: 4 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true } } },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 4, endColumnIndex: 5 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    {
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 5, endColumnIndex: 6 },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', padding: { left: 8 } } },
        fields: 'userEnteredFormat(horizontalAlignment,padding)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 6, endColumnIndex: 7 },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', padding: { left: 8 } } },
        fields: 'userEnteredFormat(horizontalAlignment,padding)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 7, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'RIGHT',
            padding: { right: 10 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            textFormat: { bold: true, foregroundColor: darkTxt },
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,padding,numberFormat,textFormat)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 8, endColumnIndex: 9 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    {
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 9, endColumnIndex: 10 },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', padding: { left: 8 } } },
        fields: 'userEnteredFormat(horizontalAlignment,padding)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 500, startColumnIndex: 10, endColumnIndex: 11 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true } } },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
      },
    },
    // 7. Borders for Tab 2
    {
      updateBorders: {
        range: { sheetId: globalTxSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
        bottom: { style: 'SOLID_MEDIUM', color: navyBg },
      },
    },
    {
      updateBorders: {
        range: { sheetId: globalTxSheetId, startRowIndex: 1, endRowIndex: 100, startColumnIndex: 0, endColumnIndex: 11 },
        innerHorizontal: { style: 'SOLID', color: hexToRgbColor('#E2E8F0') },
      },
    },
    // 8. Basic Filter on Tab 2 (02_SEMUA_TRANSAKSI)
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId: globalTxSheetId,
            startRowIndex: 0,
            endRowIndex: 5000,
            startColumnIndex: 0,
            endColumnIndex: 11,
          },
        },
      },
    },

    // =========================================================================
    // Tab 3: 03_DAFTAR_DAPUR Styling
    // =========================================================================
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
            textFormat: { foregroundColor: whiteTxt, bold: true, fontSize: 10, fontFamily: 'Roboto' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'WRAP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: direktoriSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 34 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: direktoriSheetId, dimension: 'ROWS', startIndex: 1, endIndex: 20 },
        properties: { pixelSize: 28 },
        fields: 'pixelSize',
      },
    },
    ...[
      { col: 0, width: 140 }, // A: ID Unit
      { col: 1, width: 200 }, // B: Nama Dapur SPPG
      { col: 2, width: 260 }, // C: Wilayah / Lokasi
      { col: 3, width: 170 }, // D: Status Operasional
      { col: 4, width: 230 }, // E: Penanggung Jawab
      { col: 5, width: 150 }, // F: Kontak Telegram
      { col: 6, width: 170 }, // G: Kapasitas Porsi / Hari
      { col: 7, width: 210 }, // H: Tautan Spreadsheet
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
    {
      repeatCell: {
        range: { sheetId: direktoriSheetId, startRowIndex: 1, endRowIndex: 20, startColumnIndex: 0, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: darkTxt, fontSize: 10, fontFamily: 'Roboto' },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: direktoriSheetId, startRowIndex: 1, endRowIndex: 20, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    {
      repeatCell: {
        range: { sheetId: direktoriSheetId, startRowIndex: 1, endRowIndex: 20, startColumnIndex: 3, endColumnIndex: 4 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', textFormat: { bold: true } } },
        fields: 'userEnteredFormat(horizontalAlignment,textFormat.bold)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: direktoriSheetId, startRowIndex: 1, endRowIndex: 20, startColumnIndex: 5, endColumnIndex: 6 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    {
      repeatCell: {
        range: { sheetId: direktoriSheetId, startRowIndex: 1, endRowIndex: 20, startColumnIndex: 6, endColumnIndex: 7 },
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT', padding: { right: 10 }, numberFormat: { type: 'NUMBER', pattern: '#,##0' } } },
        fields: 'userEnteredFormat(horizontalAlignment,padding,numberFormat)',
      },
    },
    {
      updateBorders: {
        range: { sheetId: direktoriSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 8 },
        bottom: { style: 'SOLID_MEDIUM', color: navyBg },
      },
    },
    {
      updateBorders: {
        range: { sheetId: direktoriSheetId, startRowIndex: 1, endRowIndex: 20, startColumnIndex: 0, endColumnIndex: 8 },
        innerHorizontal: { style: 'SOLID', color: hexToRgbColor('#E2E8F0') },
      },
    },
    // Basic Filter on Tab 3 (03_DAFTAR_DAPUR)
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId: direktoriSheetId,
            startRowIndex: 0,
            endRowIndex: 100,
            startColumnIndex: 0,
            endColumnIndex: 8,
          },
        },
      },
    },
  ];
}

/**
 * Membuat BatchUpdate Requests untuk reset total 01_DASHBOARD (hapus chart, unmerge, bersihkan format)
 */
export function createOperationalDashboardResetRequests(
  sheetId: number,
  existingChartIds: number[] = []
): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];

  // 1. Delete all existing charts
  for (const chartId of existingChartIds) {
    requests.push({
      deleteEmbeddedObject: { objectId: chartId },
    });
  }

  // 2. Unmerge all existing cells
  requests.push({
    unmergeCells: {
      range: { sheetId },
    },
  });

  // 3. Clear formatting on A1:Z50
  requests.push({
    updateCells: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 50, startColumnIndex: 0, endColumnIndex: 26 },
      fields: 'userEnteredFormat',
    },
  });

  // 4. Set clean grid properties: 35 rows, 13 columns, hideGridlines: true, no frozen rows
  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        title: SHEET_NAMES.DASHBOARD,
        tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) },
        gridProperties: {
          rowCount: 35,
          columnCount: 13,
          frozenRowCount: 0,
          hideGridlines: true,
        },
      },
      fields: 'title,tabColorStyle,gridProperties(rowCount,columnCount,frozenRowCount,hideGridlines)',
    },
  });

  // 5. Hide column M (index 12) so helper formulas are completely invisible
  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: 12, endIndex: 13 },
      properties: { hiddenByUser: true },
      fields: 'hiddenByUser',
    },
  });

  return requests;
}

/**
 * Membuat BatchUpdate Requests untuk struktur & penamaan Tab Operational SPPG (01_DASHBOARD & sembunyikan 05_MASTER_DATA)
 */
export function createOperationalDashboardStructureBatchRequests(
  existingSheetMap: Map<string, number>,
  firstSheetId: number = 0,
  existingChartIds: number[] = []
): sheets_v4.Schema$Request[] {
  const firstId = existingSheetMap.get('01_RINGKASAN_EKSEKUTIF') ?? existingSheetMap.get(SHEET_NAMES.DASHBOARD) ?? firstSheetId;
  const requests: sheets_v4.Schema$Request[] = [
    ...createOperationalDashboardResetRequests(firstId, existingChartIds),
  ];

  // Hide 05_MASTER_DATA
  const masterSheetId = existingSheetMap.get(SHEET_NAMES.MASTER_DATA);
  if (masterSheetId !== undefined) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: masterSheetId,
          hidden: true,
        },
        fields: 'hidden',
      },
    });
  }

  return requests;
}

/**
 * Menyediakan seluruh baris nilai dan rumus visual untuk 01_DASHBOARD & header bersih tanpa (Rp)
 */
export function getOperationalDashboardValues(unitName: string = 'SPPG Dapur') {
  const valuesDashboard: string[][] = [
    // R1: empty padding (21px)
    [],
    // R2: Header Banner Top (B2:G2 Title, H2:I2 Month Header, J2:K2 Year Header)
    ['', 'DASHBOARD KEUANGAN & OPERASIONAL SPPG', '', '', '', '', '', 'PILIH BULAN', '', 'PILIH TAHUN', ''],
    // R3: Subtitle & Dropdowns (B3:G3 Subtitle, H3:I3 Month Dropdown, J3:K3 Year Dropdown)
    ['', `Ringkasan Pagu Anggaran, Realisasi Belanja Bahan & Efisiensi Dapur - ${unitName}`, '', '', '', '', '', 'SEMUA BULAN', '', 'SEMUA TAHUN', ''],
    // R4: empty padding (21px)
    [],
    // R5: KPI Headers (B5:C5, D5:E5, Gap F, G5:H5, I5:K5)
    ['', 'TOTAL PAGU ANGGARAN', '', 'TOTAL BELANJA BAHAN', '', '', 'MARGIN OPERASIONAL', '', 'TOTAL TRANSAKSI', '', ''],
    // R6: KPI Values
    [
      '',
      `=IFERROR(SUMIFS('02_PAGU_RINGKASAN'!$F$2:$F; '02_PAGU_RINGKASAN'!$C$2:$C; ">="&$M$1; '02_PAGU_RINGKASAN'!$C$2:$C; "<="&$M$2); 0)`,
      '',
      `=IFERROR(SUMIFS('04_PENGELUARAN_SUPPLIER'!$F$2:$F; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; ">="&$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; "<="&$M$2); 0)`,
      '',
      '',
      `=B6-D6`,
      '',
      `=IFERROR(COUNTIFS('04_PENGELUARAN_SUPPLIER'!$C$2:$C; ">="&$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; "<="&$M$2; '04_PENGELUARAN_SUPPLIER'!$A$2:$A; "<>"); 0)`,
      '',
      ''
    ],
    // R7: KPI Subtitles
    [
      '',
      'Pagu Masuk SPPG',
      '',
      'Realisasi Belanja Dapur',
      '',
      '',
      'Sisa Margin Anggaran',
      '',
      'Mutasi Belanja Supplier',
      '',
      ''
    ],
    // R8: empty padding (21px)
    [],
    // R9: Section Headers (B9:E9 Supplier, Gap F, G9:K9 Category)
    ['', '5 REKANAN SUPPLIER TERBESAR', '', '', '', '', 'DISTRIBUSI BELANJA BAHAN POKOK', '', '', '', ''],
    // R10
    [
      '',
      `=IFERROR(INDEX(QUERY('04_PENGELUARAN_SUPPLIER'!$A$2:$F; "SELECT Col4, SUM(Col6) WHERE Col4 IS NOT NULL AND Col3 >= date '"&TEXT($M$1;"yyyy-mm-dd")&"' AND Col3 <= date '"&TEXT($M$2;"yyyy-mm-dd")&"' GROUP BY Col4 ORDER BY SUM(Col6) DESC LABEL Col4 '', SUM(Col6) ''"; 0); 1; 1); "-")`,
      '',
      '',
      `=IF(B10="-"; 0; IFERROR(SUMIFS('04_PENGELUARAN_SUPPLIER'!$F$2:$F; '04_PENGELUARAN_SUPPLIER'!$D$2:$D; B10; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; ">="&$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; "<="&$M$2); 0))`,
      '',
      'Protein Hewani',
      `=IFERROR(SUM(FILTER('05_REKAP_MARGIN'!$J$2:$J; '05_REKAP_MARGIN'!$B$2:$B>=$M$1; '05_REKAP_MARGIN'!$B$2:$B<=$M$2; REGEXMATCH(LOWER('05_REKAP_MARGIN'!$D$2:$D); "telur|ayam|daging|ikan|sapi|udang|bebek|susu|tongkol|lele|nugget"))); 0)`,
      `=IFERROR(H10/$H$15; 0)`,
      `=REPT("█"; ROUND(I10*28)) & REPT("░"; 28-ROUND(I10*28))`,
      ''
    ],
    // R11
    [
      '',
      `=IFERROR(INDEX(QUERY('04_PENGELUARAN_SUPPLIER'!$A$2:$F; "SELECT Col4, SUM(Col6) WHERE Col4 IS NOT NULL AND Col3 >= date '"&TEXT($M$1;"yyyy-mm-dd")&"' AND Col3 <= date '"&TEXT($M$2;"yyyy-mm-dd")&"' GROUP BY Col4 ORDER BY SUM(Col6) DESC LABEL Col4 '', SUM(Col6) ''"; 0); 2; 1); "-")`,
      '',
      '',
      `=IF(B11="-"; 0; IFERROR(SUMIFS('04_PENGELUARAN_SUPPLIER'!$F$2:$F; '04_PENGELUARAN_SUPPLIER'!$D$2:$D; B11; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; ">="&$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; "<="&$M$2); 0))`,
      '',
      'Sayuran Segar',
      `=IFERROR(SUM(FILTER('05_REKAP_MARGIN'!$J$2:$J; '05_REKAP_MARGIN'!$B$2:$B>=$M$1; '05_REKAP_MARGIN'!$B$2:$B<=$M$2; REGEXMATCH(LOWER('05_REKAP_MARGIN'!$D$2:$D); "sayur|wortel|buncis|kol|kubis|sawi|kangkung|bayam|tomat|labu|kentang|kacang|tauge|terong|timun|brokoli"))); 0)`,
      `=IFERROR(H11/$H$15; 0)`,
      `=REPT("█"; ROUND(I11*28)) & REPT("░"; 28-ROUND(I11*28))`,
      ''
    ],
    // R12
    [
      '',
      `=IFERROR(INDEX(QUERY('04_PENGELUARAN_SUPPLIER'!$A$2:$F; "SELECT Col4, SUM(Col6) WHERE Col4 IS NOT NULL AND Col3 >= date '"&TEXT($M$1;"yyyy-mm-dd")&"' AND Col3 <= date '"&TEXT($M$2;"yyyy-mm-dd")&"' GROUP BY Col4 ORDER BY SUM(Col6) DESC LABEL Col4 '', SUM(Col6) ''"; 0); 3; 1); "-")`,
      '',
      '',
      `=IF(B12="-"; 0; IFERROR(SUMIFS('04_PENGELUARAN_SUPPLIER'!$F$2:$F; '04_PENGELUARAN_SUPPLIER'!$D$2:$D; B12; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; ">="&$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; "<="&$M$2); 0))`,
      '',
      'Bahan Pokok & Beras',
      `=IFERROR(SUM(FILTER('05_REKAP_MARGIN'!$J$2:$J; '05_REKAP_MARGIN'!$B$2:$B>=$M$1; '05_REKAP_MARGIN'!$B$2:$B<=$M$2; REGEXMATCH(LOWER('05_REKAP_MARGIN'!$D$2:$D); "beras|minyak|tahu|tempe|tepung|gula|garam|mie|bihun|soun|santan"))); 0)`,
      `=IFERROR(H12/$H$15; 0)`,
      `=REPT("█"; ROUND(I12*28)) & REPT("░"; 28-ROUND(I12*28))`,
      ''
    ],
    // R13
    [
      '',
      `=IFERROR(INDEX(QUERY('04_PENGELUARAN_SUPPLIER'!$A$2:$F; "SELECT Col4, SUM(Col6) WHERE Col4 IS NOT NULL AND Col3 >= date '"&TEXT($M$1;"yyyy-mm-dd")&"' AND Col3 <= date '"&TEXT($M$2;"yyyy-mm-dd")&"' GROUP BY Col4 ORDER BY SUM(Col6) DESC LABEL Col4 '', SUM(Col6) ''"; 0); 4; 1); "-")`,
      '',
      '',
      `=IF(B13="-"; 0; IFERROR(SUMIFS('04_PENGELUARAN_SUPPLIER'!$F$2:$F; '04_PENGELUARAN_SUPPLIER'!$D$2:$D; B13; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; ">="&$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; "<="&$M$2); 0))`,
      '',
      'Buah Segar',
      `=IFERROR(SUM(FILTER('05_REKAP_MARGIN'!$J$2:$J; '05_REKAP_MARGIN'!$B$2:$B>=$M$1; '05_REKAP_MARGIN'!$B$2:$B<=$M$2; REGEXMATCH(LOWER('05_REKAP_MARGIN'!$D$2:$D); "buah|pisang|semangka|melon|jeruk|apel|pepaya|mangga|nanas|salak|anggur|kelengkeng|pir"))); 0)`,
      `=IFERROR(H13/$H$15; 0)`,
      `=REPT("█"; ROUND(I13*28)) & REPT("░"; 28-ROUND(I13*28))`,
      ''
    ],
    // R14
    [
      '',
      `=IFERROR(INDEX(QUERY('04_PENGELUARAN_SUPPLIER'!$A$2:$F; "SELECT Col4, SUM(Col6) WHERE Col4 IS NOT NULL AND Col3 >= date '"&TEXT($M$1;"yyyy-mm-dd")&"' AND Col3 <= date '"&TEXT($M$2;"yyyy-mm-dd")&"' GROUP BY Col4 ORDER BY SUM(Col6) DESC LABEL Col4 '', SUM(Col6) ''"; 0); 5; 1); "-")`,
      '',
      '',
      `=IF(B14="-"; 0; IFERROR(SUMIFS('04_PENGELUARAN_SUPPLIER'!$F$2:$F; '04_PENGELUARAN_SUPPLIER'!$D$2:$D; B14; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; ">="&$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C; "<="&$M$2); 0))`,
      '',
      'Bumbu & Operasional',
      `=IFERROR(D6 - SUM(H10:H13); 0)`,
      `=IFERROR(H14/$H$15; 0)`,
      `=REPT("█"; ROUND(I14*28)) & REPT("░"; 28-ROUND(I14*28))`,
      ''
    ],
    // R15: Totals
    [
      '',
      'TOTAL BELANJA SUPPLIER',
      '',
      '',
      `=SUM(E10:E14)`,
      '',
      'TOTAL BIAYA BAHAN',
      `=SUM(H10:H14)`,
      '100.0%',
      '',
      ''
    ],
    // R16: empty spacer (16px)
    [],
    // R17: Lower Titles (Area B17:E17 empty for pie chart overlay, G17:K17 Title)
    ['', '', '', '', '', '', '10 TRANSAKSI BELANJA TERAKHIR', '', '', '', ''],
    // R18: Subheaders
    ['', '', '', '', '', '', 'Tanggal', 'Supplier', 'Nominal', 'Metode', 'Status'],
  ];

  // R19..R28: 10 Recent Transactions in G..K (B..E remain empty for pie chart overlay)
  for (let i = 1; i <= 10; i++) {
    valuesDashboard.push([
      '',
      '',
      '',
      '',
      '',
      '',
      `=IFERROR(INDEX(SORT(FILTER('04_PENGELUARAN_SUPPLIER'!$C$2:$J; '04_PENGELUARAN_SUPPLIER'!$A$2:$A<>""; '04_PENGELUARAN_SUPPLIER'!$C$2:$C>=$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C<=$M$2); 1; FALSE); ${i}; 1); "-")`,
      `=IFERROR(INDEX(SORT(FILTER('04_PENGELUARAN_SUPPLIER'!$C$2:$J; '04_PENGELUARAN_SUPPLIER'!$A$2:$A<>""; '04_PENGELUARAN_SUPPLIER'!$C$2:$C>=$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C<=$M$2); 1; FALSE); ${i}; 2); "-")`,
      `=IFERROR(INDEX(SORT(FILTER('04_PENGELUARAN_SUPPLIER'!$C$2:$J; '04_PENGELUARAN_SUPPLIER'!$A$2:$A<>""; '04_PENGELUARAN_SUPPLIER'!$C$2:$C>=$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C<=$M$2); 1; FALSE); ${i}; 4); 0)`,
      `=IFERROR(INDEX(SORT(FILTER('04_PENGELUARAN_SUPPLIER'!$C$2:$J; '04_PENGELUARAN_SUPPLIER'!$A$2:$A<>""; '04_PENGELUARAN_SUPPLIER'!$C$2:$C>=$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C<=$M$2); 1; FALSE); ${i}; 5); "-")`,
      `=IFERROR(IF(INDEX(SORT(FILTER('04_PENGELUARAN_SUPPLIER'!$C$2:$J; '04_PENGELUARAN_SUPPLIER'!$A$2:$A<>""; '04_PENGELUARAN_SUPPLIER'!$C$2:$C>=$M$1; '04_PENGELUARAN_SUPPLIER'!$C$2:$C<=$M$2); 1; FALSE); ${i}; 1)<>"-"; "LUNAS"; "-"); "-")`
    ]);
  }

  const valuesHelper = [
    [`=IFS(AND($H$3="SEMUA BULAN"; $J$3="SEMUA TAHUN"); DATE(2020;1;1); $H$3="SEMUA BULAN"; DATE($M$4; 1; 1); $M$3>0; DATE($M$4; $M$3; 1); TRUE; DATE(2020;1;1))`],
    [`=IFS(AND($H$3="SEMUA BULAN"; $J$3="SEMUA TAHUN"); DATE(2035;12;31); $H$3="SEMUA BULAN"; DATE($M$4; 12; 31); $M$3>0; EOMONTH(DATE($M$4; $M$3; 1); 0); TRUE; DATE(2035;12;31))`],
    [`=IFERROR(MATCH(UPPER($H$3); {"JANUARI"; "FEBRUARI"; "MARET"; "APRIL"; "MEI"; "JUNI"; "JULI"; "AGUSTUS"; "SEPTEMBER"; "OKTOBER"; "NOVEMBER"; "DESEMBER"}; 0); 0)`],
    [`=IF(ISNUMBER(VALUE($J$3)); VALUE($J$3); YEAR(TODAY()))`]
  ];

  const tabPaguRingkasanHeaders = [
    ['No SPPG', 'ID Transaksi', 'Tanggal Pesanan', 'Jumlah Item Bahan', 'Jumlah Target Supplier', 'Total Pagu Anggaran', 'Link Bukti Dokumen', 'Pesan Asli Telegram', 'PIC / Penanggung Jawab', 'Riwayat Edit']
  ];

  const tabPaguRincianHeaders = [
    ['No SPPG Ref', 'ID Ref', 'No Urut', 'Target Supplier', 'Uraian Bahan', 'Kuantitas', 'Satuan', 'Harga Pagu Satuan', 'Total Pagu', 'Keterangan / Spesifikasi']
  ];

  const tabPengeluaranHeaders = [
    ['No SPPG Ref', 'ID Transaksi', 'Tanggal Transaksi', 'Nama Supplier', 'No Invoice Supplier', 'Total Nominal Tagihan', 'Metode Pembayaran', 'Link Bukti Nota', 'PIC / Operator', 'Catatan / Keterangan']
  ];

  const tabRekapMarginHeaders = [
    ['No SPPG Ref', 'Tanggal', 'Nama Supplier', 'Uraian Bahan', 'Kuantitas', 'Satuan', 'Harga Pagu', 'Total Pagu', 'Harga Invoice', 'Total Realisasi', 'Margin Bersih (Rp)', '% Margin', 'Status']
  ];

  const tabMasterDataHeaders = [
    ['Daftar Resmi Supplier', 'Daftar Satuan Baku', 'Daftar Kategori Bahan']
  ];

  return {
    valuesDashboard,
    valuesHelper,
    tabPaguRingkasanHeaders,
    tabPaguRincianHeaders,
    tabPengeluaranHeaders,
    tabRekapMarginHeaders,
    tabMasterDataHeaders,
    // Backward compatibility aliases
    tab2Headers: tabPaguRingkasanHeaders,
    tab3Headers: tabPengeluaranHeaders,
    tab4Headers: tabRekapMarginHeaders,
  };
}

/**
 * Membuat BatchUpdate Requests untuk styling BGN, formatting, merges, dan layout 01_DASHBOARD
 */
export function createOperationalDashboardStylingRequests(firstId: number): sheets_v4.Schema$Request[] {
  return [
    // Merges for Banner Title (B2:G2) & Subtitle (B3:G3)
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 7 },
        mergeType: 'MERGE_ALL',
      },
    },
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 7 },
        mergeType: 'MERGE_ALL',
      },
    },
    // Merges for Month Header (H2:I2) & Month Dropdown (H3:I3)
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 7, endColumnIndex: 9 },
        mergeType: 'MERGE_ALL',
      },
    },
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 7, endColumnIndex: 9 },
        mergeType: 'MERGE_ALL',
      },
    },
    // Merges for Year Header (J2:K2) & Year Dropdown (J3:K3)
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 9, endColumnIndex: 11 },
        mergeType: 'MERGE_ALL',
      },
    },
    {
      mergeCells: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 9, endColumnIndex: 11 },
        mergeType: 'MERGE_ALL',
      },
    },

    // KPI Card 1: B5:C7 (Pagu)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 1, endColumnIndex: 3 }, mergeType: 'MERGE_ALL' },
    },
    // KPI Card 2: D5:E7 (Belanja)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 3, endColumnIndex: 5 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 3, endColumnIndex: 5 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 3, endColumnIndex: 5 }, mergeType: 'MERGE_ALL' },
    },
    // KPI Card 3: G5:H7 (Margin Operasional)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 6, endColumnIndex: 8 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 6, endColumnIndex: 8 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 6, endColumnIndex: 8 }, mergeType: 'MERGE_ALL' },
    },
    // KPI Card 4: I5:K7 (Total Transaksi)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 8, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 8, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: 8, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },

    // Merges for Supplier Table Title (B9:E9)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 1, endColumnIndex: 5 }, mergeType: 'MERGE_ALL' },
    },
    // Merges for Supplier Rows (B10:D10 to B14:D14 and Total B15:D15)
    ...[9, 10, 11, 12, 13, 14].map((r) => ({
      mergeCells: { range: { sheetId: firstId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 4 }, mergeType: 'MERGE_ALL' as const },
    })),

    // Merges for Category Table Title (G9:K9)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 6, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },
    // Merges for Category Progress Bars (J10:K10 to J14:K14 and Total J15:K15)
    ...[9, 10, 11, 12, 13, 14].map((r) => ({
      mergeCells: { range: { sheetId: firstId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 9, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' as const },
    })),

    // Merges for 10 Transaksi Title (G17:K17)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 16, endRowIndex: 17, startColumnIndex: 6, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },

    // Banner Styling (B2:G3)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY),
            verticalAlignment: 'MIDDLE',
            padding: { left: 12 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,verticalAlignment,padding)',
      },
    },
    // Title Text Format (B2:G2)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.WHITE), bold: true, fontSize: 13 },
          },
        },
        fields: 'userEnteredFormat(textFormat)',
      },
    },
    // Subtitle Text Format (B3:G3)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: { red: 0.85, green: 0.90, blue: 0.95 }, fontSize: 9 },
          },
        },
        fields: 'userEnteredFormat(textFormat)',
      },
    },

    // Filter Month & Year Headers (H2:K2)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 7, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY),
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.WHITE), bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Filter Month & Year Dropdowns (H3:K3)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 7, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(BGN_PALETTE.WHITE),
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY), bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Validation Dropdowns
    {
      setDataValidation: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 7, endColumnIndex: 9 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'SEMUA BULAN' },
              { userEnteredValue: 'JANUARI' },
              { userEnteredValue: 'FEBRUARI' },
              { userEnteredValue: 'MARET' },
              { userEnteredValue: 'APRIL' },
              { userEnteredValue: 'MEI' },
              { userEnteredValue: 'JUNI' },
              { userEnteredValue: 'JULI' },
              { userEnteredValue: 'AGUSTUS' },
              { userEnteredValue: 'SEPTEMBER' },
              { userEnteredValue: 'OKTOBER' },
              { userEnteredValue: 'NOVEMBER' },
              { userEnteredValue: 'DESEMBER' },
            ],
          },
          strict: true,
          showCustomUi: true,
        },
      },
    },
    {
      setDataValidation: {
        range: { sheetId: firstId, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 9, endColumnIndex: 11 },
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

    // KPI Card Styling (Row 5-7)
    // KPI Headers (Row 5: B5:E5, G5:K5)
    ...[
      { start: 1, end: 5 },
      { start: 6, end: 11 },
    ].map((r) => ({
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: r.start, endColumnIndex: r.end },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(BGN_PALETTE.SLATE_LIGHT),
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY), bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    })),

    // KPI Values (Row 6)
    // KPI 1 (Green Pagu: B6:C6)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 1, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(BGN_PALETTE.WHITE),
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.ALERT_GREEN_TXT), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // KPI 2 (Red Belanja: D6:E6)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 3, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(BGN_PALETTE.WHITE),
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.ALERT_RED_TXT), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // KPI 3 (Margin Operasional: G6:H6)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 6, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(BGN_PALETTE.WHITE),
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY), bold: true, fontSize: 16 },
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // KPI 4 (Total Transaksi: I6:K6)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 8, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(BGN_PALETTE.WHITE),
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY), bold: true, fontSize: 16 },
            numberFormat: { type: 'NUMBER', pattern: '#,##0" Transaksi"' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // KPI Subtitles (Row 7: B7:E7, G7:K7)
    ...[
      { start: 1, end: 5 },
      { start: 6, end: 11 },
    ].map((r) => ({
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 6, endRowIndex: 7, startColumnIndex: r.start, endColumnIndex: r.end },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.98, green: 0.98, blue: 0.98 },
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_GRAY), fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    })),

    // Borders for KPI Cards (Row 5-7)
    ...[
      { start: 1, end: 3 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
      { start: 8, end: 11 },
    ].map((c) => ({
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 4, endRowIndex: 7, startColumnIndex: c.start, endColumnIndex: c.end },
        top: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        bottom: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        left: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        right: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
      },
    })),

    // Section Headers (Row 9: B9:E9 and G9:K9)
    ...[
      { start: 1, end: 5 },
      { start: 6, end: 11 },
    ].map((r) => ({
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: r.start, endColumnIndex: r.end },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY),
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.WHITE), bold: true, fontSize: 9 },
            verticalAlignment: 'MIDDLE',
            padding: { left: 10 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    })),

    // Currency format for Supplier Table (E10:E15)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 15, startColumnIndex: 4, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            textFormat: { bold: true },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
            padding: { right: 8 },
          },
        },
        fields: 'userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment,padding)',
      },
    },
    // Supplier Table Left Align for names (B10:D14)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 14, startColumnIndex: 1, endColumnIndex: 4 },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'MIDDLE',
            padding: { left: 8 },
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,padding)',
      },
    },
    // Supplier Table Total Label (B15:D15)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 14, endRowIndex: 15, startColumnIndex: 1, endColumnIndex: 4 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 9, foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_GRAY) },
            verticalAlignment: 'MIDDLE',
            padding: { left: 8 },
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment,padding)',
      },
    },

    // Category Table Formatting (G10:K15)
    // Category Names (G10:G14)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 14, startColumnIndex: 6, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'MIDDLE',
            padding: { left: 8 },
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,padding)',
      },
    },
    // Category Amounts (H10:H15)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 15, startColumnIndex: 7, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            textFormat: { bold: true },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
            padding: { right: 8 },
          },
        },
        fields: 'userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment,padding)',
      },
    },
    // Percent format for Category Table (I10:I15)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 15, startColumnIndex: 8, endColumnIndex: 9 },
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
    // Progress Bar format (J10:K15)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 15, startColumnIndex: 9, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: { red: 0, green: 0.54, blue: 0.48 }, fontSize: 9 },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            padding: { left: 4 },
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,padding)',
      },
    },
    // Total Category Label (G15)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 14, endRowIndex: 15, startColumnIndex: 6, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 9, foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_GRAY) },
            verticalAlignment: 'MIDDLE',
            padding: { left: 8 },
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment,padding)',
      },
    },

    // Dotted/Solid Top Border on Totals Row 15
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 14, endRowIndex: 15, startColumnIndex: 1, endColumnIndex: 5 },
        top: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
        bottom: { style: 'DOUBLE', color: { red: 0.8, green: 0.8, blue: 0.8 } },
      },
    },
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 14, endRowIndex: 15, startColumnIndex: 6, endColumnIndex: 11 },
        top: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
        bottom: { style: 'DOUBLE', color: { red: 0.8, green: 0.8, blue: 0.8 } },
      },
    },

    // Lower Section: 10 Transaksi Belanja Terakhir (G17:K28)
    // Header (Row 17: G17:K17)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 16, endRowIndex: 17, startColumnIndex: 6, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY),
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.WHITE), bold: true, fontSize: 9 },
            verticalAlignment: 'MIDDLE',
            padding: { left: 10 },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)',
      },
    },
    // Subheaders (Row 18: G18:K18)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 17, endRowIndex: 18, startColumnIndex: 6, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.91, green: 0.94, blue: 0.97 },
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY), bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Date format for Recent Transactions Tanggal (Col G: index 6, Row 19-28)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 18, endRowIndex: 28, startColumnIndex: 6, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(numberFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Uraian Bahan (Col H: index 7, Row 19-28)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 18, endRowIndex: 28, startColumnIndex: 7, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'MIDDLE',
            padding: { left: 6 },
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,padding)',
      },
    },
    // Currency format for Recent Transactions Nominal (Col I: index 8, Row 19-28)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 18, endRowIndex: 28, startColumnIndex: 8, endColumnIndex: 9 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' },
            textFormat: { bold: true },
            horizontalAlignment: 'RIGHT',
            verticalAlignment: 'MIDDLE',
            padding: { right: 6 },
          },
        },
        fields: 'userEnteredFormat(numberFormat,textFormat,horizontalAlignment,verticalAlignment,padding)',
      },
    },
    // Supplier & Status (Col J & K: index 9 & 10, Row 19-28)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 18, endRowIndex: 28, startColumnIndex: 9, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
      },
    },
    // Subtle row borders for 10 Transaksi (Row 18-28)
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 17, endRowIndex: 28, startColumnIndex: 6, endColumnIndex: 11 },
        left: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        right: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        bottom: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        innerHorizontal: { style: 'SOLID', color: { red: 0.92, green: 0.92, blue: 0.92 } },
      },
    },

    // Column Widths on 01_DASHBOARD (Exact reference geometry from wa-agent)
    ...[
      { col: 0, width: 25 },   // A: Margin
      { col: 1, width: 70 },   // B
      { col: 2, width: 170 },  // C
      { col: 3, width: 150 },  // D
      { col: 4, width: 145 },  // E (B..E = 535px)
      { col: 5, width: 25 },   // F: Spacer gap!
      { col: 6, width: 147 },  // G
      { col: 7, width: 204 },  // H
      { col: 8, width: 115 },  // I
      { col: 9, width: 130 },  // J
      { col: 10, width: 130 }, // K (G..K = 726px)
      { col: 11, width: 25 },  // L: Margin
      { col: 12, width: 25 },  // M: Hidden helper
    ].map((cw) => ({
      updateDimensionProperties: {
        range: { sheetId: firstId, dimension: 'COLUMNS', startIndex: cw.col, endIndex: cw.col + 1 },
        properties: { pixelSize: cw.width },
        fields: 'pixelSize',
      },
    })),

    // Row Heights on 01_DASHBOARD
    ...[
      { start: 0, end: 15, height: 21 },
      { start: 15, end: 16, height: 16 }, // R16: Spacer row
      { start: 16, end: 28, height: 21 }, // R17..R28
    ].map((rh) => ({
      updateDimensionProperties: {
        range: { sheetId: firstId, dimension: 'ROWS', startIndex: rh.start, endIndex: rh.end },
        properties: { pixelSize: rh.height },
        fields: 'pixelSize',
      },
    })),
  ];
}

/**
 * Menambahkan Diagram Pie Chart (Pengeluaran per Kategori) pada range B17:E28
 */
export function createOperationalDashboardChartRequest(firstId: number): sheets_v4.Schema$Request {
  return {
    addChart: {
      chart: {
        spec: {
          title: 'Pengeluaran per Kategori',
          titleTextFormat: {
            fontFamily: 'Roboto',
            fontSize: 11,
            bold: true,
            foregroundColor: { red: 0.12, green: 0.16, blue: 0.23 },
          },
          fontName: 'Roboto',
          pieChart: {
            legendPosition: 'RIGHT_LEGEND',
            domain: {
              sourceRange: {
                sources: [
                  {
                    sheetId: firstId,
                    startRowIndex: 9,
                    endRowIndex: 14,
                    startColumnIndex: 6,
                    endColumnIndex: 7,
                  },
                ],
              },
            },
            series: {
              sourceRange: {
                sources: [
                  {
                    sheetId: firstId,
                    startRowIndex: 9,
                    endRowIndex: 14,
                    startColumnIndex: 7,
                    endColumnIndex: 8,
                  },
                ],
              },
            },
          },
        },
        position: {
          overlayPosition: {
            anchorCell: {
              sheetId: firstId,
              rowIndex: 16,
              columnIndex: 1,
            },
            offsetYPixels: 8,
            widthPixels: 536,
            heightPixels: 252,
          },
        },
      },
    },
  };
}

import { sheets_v4 } from "googleapis";
import {
  BGN_PALETTE,
  SHEET_IDS,
  SHEET_NAMES,
  hexToRgbColor,
  resolveSheetId,
} from "./constants.js";

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
            rowCount: 56,
            columnCount: 14,
            hideGridlines: false
          }
        },
        fields: 'title,tabColorStyle,gridProperties(rowCount,columnCount,hideGridlines)'
      }
    },
    // 2. Tab 02_Pendapatan
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.PAGU_PENERIMAAN,
          title: SHEET_NAMES.PAGU_PENERIMAAN,
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
    // 3. Tab 03_Rincian Pendapatan
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.RINCIAN_PENDAPATAN,
          title: SHEET_NAMES.RINCIAN_PENDAPATAN,
          index: 2,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.EMBLEM_GOLD) },
          gridProperties: {
            rowCount: 5000,
            columnCount: 12,
            frozenRowCount: 1
          }
        }
      }
    },
    // 4. Tab 04_Pengeluaran
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.PAGU_PENGELUARAN,
          title: SHEET_NAMES.PAGU_PENGELUARAN,
          index: 3,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.CRIMSON_RED) },
          gridProperties: {
            rowCount: 5000,
            columnCount: 12,
            frozenRowCount: 1
          }
        }
      }
    },
    // 5. Tab 05_Rincian Pengeluaran
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.RINCIAN_PENGELUARAN,
          title: SHEET_NAMES.RINCIAN_PENGELUARAN,
          index: 4,
          tabColorStyle: { rgbColor: hexToRgbColor('#E65100') },
          gridProperties: {
            rowCount: 5000,
            columnCount: 13,
            frozenRowCount: 1
          }
        }
      }
    },
    // 6. Tab 06_PERBANDINGAN_MARGIN
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.PERBANDINGAN_MARGIN,
          title: SHEET_NAMES.PERBANDINGAN_MARGIN,
          index: 5,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.FOREST_GREEN) },
          gridProperties: {
            rowCount: 5000,
            columnCount: 16,
            frozenRowCount: 1
          }
        }
      }
    },
    // 7. Tab 07_AKTIVITAS (Log Aktivitas Bot - Terbuka / Unhidden)
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.LOG_AKTIVITAS,
          title: SHEET_NAMES.LOG_AKTIVITAS,
          index: 6,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SLATE_GRAY) },
          hidden: false,
          gridProperties: {
            rowCount: 5000,
            columnCount: 10,
            frozenRowCount: 1
          }
        }
      }
    },
    // 8. Tab 08_MASTER_DATA (Tersembunyi / Hidden)
    {
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.MASTER_DATA,
          title: SHEET_NAMES.MASTER_DATA,
          index: 7,
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

/**
 * Menghapus Data Validation Dropdown pada Kolom Item (bebas entri teks tanpa panah dropdown)
 */
export function createDataValidationBatchRequests(sheetMap?: Map<string, number>): sheets_v4.Schema$Request[] {
  const paguPenerimaanId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_PENERIMAAN, SHEET_IDS.PAGU_PENERIMAAN);
  const rincianPendapatanId = resolveSheetId(sheetMap, SHEET_NAMES.RINCIAN_PENDAPATAN, SHEET_IDS.RINCIAN_PENDAPATAN);
  const paguPengeluaranId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_PENGELUARAN, SHEET_IDS.PAGU_PENGELUARAN);
  const rincianPengeluaranId = resolveSheetId(sheetMap, SHEET_NAMES.RINCIAN_PENGELUARAN, SHEET_IDS.RINCIAN_PENGELUARAN);
  const perbandinganMarginId = resolveSheetId(sheetMap, SHEET_NAMES.PERBANDINGAN_MARGIN, SHEET_IDS.PERBANDINGAN_MARGIN);

  return [
    {
      setDataValidation: {
        range: {
          sheetId: paguPenerimaanId,
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
          sheetId: rincianPendapatanId,
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
          sheetId: paguPengeluaranId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 0,
          endColumnIndex: 12,
        },
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId: rincianPengeluaranId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 0,
          endColumnIndex: 12,
        },
      },
    },
    {
      setDataValidation: {
        range: {
          sheetId: perbandinganMarginId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 0,
          endColumnIndex: 15,
        },
      },
    },
  ];
}

/**
 * Membuat BatchUpdate Requests untuk Format Rupiah, Tanggal ISO, dan Persentase
 */
export function createNumberFormattingBatchRequests(sheetMap?: Map<string, number>): sheets_v4.Schema$Request[] {
  const paguPenerimaanId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_PENERIMAAN, SHEET_IDS.PAGU_PENERIMAAN);
  const rincianPendapatanId = resolveSheetId(sheetMap, SHEET_NAMES.RINCIAN_PENDAPATAN, SHEET_IDS.RINCIAN_PENDAPATAN);
  const paguPengeluaranId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_PENGELUARAN, SHEET_IDS.PAGU_PENGELUARAN);
  const rincianPengeluaranId = resolveSheetId(sheetMap, SHEET_NAMES.RINCIAN_PENGELUARAN, SHEET_IDS.RINCIAN_PENGELUARAN);
  const perbandinganMarginId = resolveSheetId(sheetMap, SHEET_NAMES.PERBANDINGAN_MARGIN, SHEET_IDS.PERBANDINGAN_MARGIN);

  return [
    // Tab 02 (PENDAPATAN): Tanggal (Kolom C)
    {
      repeatCell: {
        range: {
          sheetId: paguPenerimaanId,
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
    // Tab 02 (PENDAPATAN): Total Pendapatan (Kolom F)
    {
      repeatCell: {
        range: {
          sheetId: paguPenerimaanId,
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
    // Tab 03 (RINCIAN_PENDAPATAN): Kuantitas (Kolom F)
    {
      repeatCell: {
        range: {
          sheetId: rincianPendapatanId,
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
    // Tab 03 (RINCIAN_PENDAPATAN): Harga Satuan & Total Pagu (Kolom H & I)
    {
      repeatCell: {
        range: {
          sheetId: rincianPendapatanId,
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
    // Tab 04 (PENGELUARAN): Tanggal (Kolom D)
    {
      repeatCell: {
        range: {
          sheetId: paguPengeluaranId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 3,
          endColumnIndex: 4
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 04 (PENGELUARAN): Total Tagihan (Kolom G)
    {
      repeatCell: {
        range: {
          sheetId: paguPengeluaranId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 6,
          endColumnIndex: 7
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 05 (RINCIAN_PENGELUARAN): Data rows text styling (Black, Normal not bold, Arial 10)
    {
      repeatCell: {
        range: {
          sheetId: rincianPengeluaranId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 0,
          endColumnIndex: 13,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              foregroundColor: hexToRgbColor('#000000'),
              bold: false,
              fontSize: 10,
              fontFamily: 'Arial',
            },
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,verticalAlignment)',
      },
    },
    // Tab 05 (RINCIAN_PENGELUARAN): Kuantitas (Kolom G)
    {
      repeatCell: {
        range: {
          sheetId: rincianPengeluaranId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 6,
          endColumnIndex: 7
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'RIGHT',
            numberFormat: { type: 'NUMBER', pattern: '#,##0' }
          }
        },
        fields: 'userEnteredFormat(horizontalAlignment,numberFormat)'
      }
    },
    // Tab 05 (RINCIAN_PENGELUARAN): Harga Satuan Invoice & Total Belanja (Kolom I & J)
    {
      repeatCell: {
        range: {
          sheetId: rincianPengeluaranId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 8,
          endColumnIndex: 10
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'RIGHT',
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' }
          }
        },
        fields: 'userEnteredFormat(horizontalAlignment,numberFormat)'
      }
    },
    // Tab 06 (PERBANDINGAN_MARGIN): Tanggal (Kolom D)
    {
      repeatCell: {
        range: {
          sheetId: perbandinganMarginId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 3,
          endColumnIndex: 4
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 06 (PERBANDINGAN_MARGIN): Kuantitas (Kolom G)
    {
      repeatCell: {
        range: {
          sheetId: perbandinganMarginId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 6,
          endColumnIndex: 7
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'NUMBER', pattern: '#,##0' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 06 (PERBANDINGAN_MARGIN): Harga Pagu, Total Pagu, Harga Invoice, Total Realisasi, Margin Bersih (Kolom I..M)
    {
      repeatCell: {
        range: {
          sheetId: perbandinganMarginId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 8,
          endColumnIndex: 13
        },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' }
          }
        },
        fields: 'userEnteredFormat.numberFormat'
      }
    },
    // Tab 06 (PERBANDINGAN_MARGIN): % Margin (Kolom N)
    {
      repeatCell: {
        range: {
          sheetId: perbandinganMarginId,
          startRowIndex: 1,
          endRowIndex: 5000,
          startColumnIndex: 13,
          endColumnIndex: 14
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
 * Membuat BatchUpdate Requests untuk 4-Tier Conditional Formatting pada Tab 06_PERBANDINGAN_MARGIN (Status)
 */
export function createConditionalFormattingBatchRequests(sheetMap?: Map<string, number>): sheets_v4.Schema$Request[] {
  const perbandinganMarginId = resolveSheetId(sheetMap, SHEET_NAMES.PERBANDINGAN_MARGIN, SHEET_IDS.PERBANDINGAN_MARGIN);

  return [
    // 1. Hijau: HEMAT
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 14,
              endColumnIndex: 15
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
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 14,
              endColumnIndex: 15
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
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 14,
              endColumnIndex: 15
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
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 14,
              endColumnIndex: 15
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
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 14,
              endColumnIndex: 15
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
    },
    // 6. % Margin = 0%: Teks Biru Tebal
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 13,
              endColumnIndex: 14
            }
          ],
          booleanRule: {
            condition: {
              type: 'NUMBER_EQ',
              values: [{ userEnteredValue: '0' }]
            },
            format: {
              textFormat: {
                foregroundColor: hexToRgbColor('#0369A1'),
                bold: true
              }
            }
          }
        },
        index: 5
      }
    },
    // 7. % Margin >= 15%: Teks Hijau Tebal
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 13,
              endColumnIndex: 14
            }
          ],
          booleanRule: {
            condition: {
              type: 'NUMBER_GREATER_THAN_EQ',
              values: [{ userEnteredValue: '0,15' }]
            },
            format: {
              textFormat: {
                foregroundColor: hexToRgbColor('#166534'),
                bold: true
              }
            }
          }
        },
        index: 6
      }
    },
    // 8. % Margin 5%..14.99%: Teks Amber/Cokelat Tebal
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 13,
              endColumnIndex: 14
            }
          ],
          booleanRule: {
            condition: {
              type: 'NUMBER_BETWEEN',
              values: [{ userEnteredValue: '0,05' }, { userEnteredValue: '0,1499' }]
            },
            format: {
              textFormat: {
                foregroundColor: hexToRgbColor('#B45309'),
                bold: true
              }
            }
          }
        },
        index: 7
      }
    },
    // 9. % Margin < 5%: Teks Merah Tebal
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 13,
              endColumnIndex: 14
            }
          ],
          booleanRule: {
            condition: {
              type: 'NUMBER_LESS',
              values: [{ userEnteredValue: '0,05' }]
            },
            format: {
              textFormat: {
                foregroundColor: hexToRgbColor('#DC2626'),
                bold: true
              }
            }
          }
        },
        index: 8
      }
    },
    // 10. Margin Bersih (Rp) = 0: Teks Biru Tebal
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 12,
              endColumnIndex: 13
            }
          ],
          booleanRule: {
            condition: {
              type: 'NUMBER_EQ',
              values: [{ userEnteredValue: '0' }]
            },
            format: {
              textFormat: {
                foregroundColor: hexToRgbColor('#0369A1'),
                bold: true
              }
            }
          }
        },
        index: 9
      }
    },
    // 11. Margin Bersih (Rp) > 0: Teks Hijau Tebal
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 12,
              endColumnIndex: 13
            }
          ],
          booleanRule: {
            condition: {
              type: 'NUMBER_GREATER',
              values: [{ userEnteredValue: '0' }]
            },
            format: {
              textFormat: {
                foregroundColor: hexToRgbColor('#166534'),
                bold: true
              }
            }
          }
        },
        index: 10
      }
    },
    // 12. Margin Bersih (Rp) < 0: Teks Merah Tebal
    {
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: perbandinganMarginId,
              startRowIndex: 1,
              endRowIndex: 5000,
              startColumnIndex: 12,
              endColumnIndex: 13
            }
          ],
          booleanRule: {
            condition: {
              type: 'NUMBER_LESS',
              values: [{ userEnteredValue: '0' }]
            },
            format: {
              textFormat: {
                foregroundColor: hexToRgbColor('#DC2626'),
                bold: true
              }
            }
          }
        },
        index: 11
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
    // Tab 02: PENDAPATAN (10 Kolom)
    {
      sheetId: resolveSheetId(sheetMap, SHEET_NAMES.PAGU_PENERIMAAN, SHEET_IDS.PAGU_PENERIMAAN),
      widths: [190, 150, 135, 130, 130, 160, 165, 160, 170, 300]
    },
    // Tab 03: RINCIAN_PENDAPATAN (12 Kolom)
    {
      sheetId: resolveSheetId(sheetMap, SHEET_NAMES.RINCIAN_PENDAPATAN, SHEET_IDS.RINCIAN_PENDAPATAN),
      widths: [190, 150, 65, 220, 160, 90, 90, 135, 140, 140, 170, 260]
    },
    // Tab 04: PENGELUARAN (12 Kolom)
    {
      sheetId: resolveSheetId(sheetMap, SHEET_NAMES.PAGU_PENGELUARAN, SHEET_IDS.PAGU_PENGELUARAN),
      widths: [190, 150, 150, 120, 180, 165, 150, 105, 130, 140, 170, 300]
    },
    // Tab 05: RINCIAN_PENGELUARAN (13 Kolom)
    {
      sheetId: resolveSheetId(sheetMap, SHEET_NAMES.RINCIAN_PENGELUARAN, SHEET_IDS.RINCIAN_PENGELUARAN),
      widths: [190, 150, 160, 70, 180, 260, 95, 90, 135, 150, 140, 170, 260]
    },
    // Tab 06: MARGIN (15 Kolom)
    {
      sheetId: resolveSheetId(sheetMap, SHEET_NAMES.PERBANDINGAN_MARGIN, SHEET_IDS.PERBANDINGAN_MARGIN),
      widths: [190, 150, 150, 110, 160, 200, 85, 85, 125, 140, 125, 140, 140, 90, 150]
    },
    // Tab 07: AKTIVITAS (9 Kolom)
    {
      sheetId: resolveSheetId(sheetMap, SHEET_NAMES.LOG_AKTIVITAS, SHEET_IDS.LOG_AKTIVITAS),
      widths: [180, 120, 160, 100, 120, 300, 350, 150, 120]
    },
    // Tab 08: MASTER_DATA (3 Kolom)
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

    // 2. Row 1 Height: 30px, Data Rows 2..5000 Height: 21px (Standard, not enlarged)
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: tw.sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 30 },
        fields: 'pixelSize',
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: tw.sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 5000 },
        properties: { pixelSize: 21 },
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

  const paguPenerimaanId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_PENERIMAAN, SHEET_IDS.PAGU_PENERIMAAN);
  const rincianPendapatanId = resolveSheetId(sheetMap, SHEET_NAMES.RINCIAN_PENDAPATAN, SHEET_IDS.RINCIAN_PENDAPATAN);
  const paguPengeluaranId = resolveSheetId(sheetMap, SHEET_NAMES.PAGU_PENGELUARAN, SHEET_IDS.PAGU_PENGELUARAN);
  const rincianPengeluaranId = resolveSheetId(sheetMap, SHEET_NAMES.RINCIAN_PENGELUARAN, SHEET_IDS.RINCIAN_PENGELUARAN);
  const perbandinganMarginId = resolveSheetId(sheetMap, SHEET_NAMES.PERBANDINGAN_MARGIN, SHEET_IDS.PERBANDINGAN_MARGIN);
  const logAktivitasId = resolveSheetId(sheetMap, SHEET_NAMES.LOG_AKTIVITAS, SHEET_IDS.LOG_AKTIVITAS);

  const targets = [
    { sheetId: paguPenerimaanId, endCol: 10, endRow: 2000 },
    { sheetId: rincianPendapatanId, endCol: 12, endRow: 5000 },
    { sheetId: paguPengeluaranId, endCol: 12, endRow: 5000 },
    { sheetId: rincianPengeluaranId, endCol: 13, endRow: 5000 },
    { sheetId: perbandinganMarginId, endCol: 15, endRow: 5000 },
    { sheetId: logAktivitasId, endCol: 9, endRow: 5000 },
  ];

  const requests: sheets_v4.Schema$Request[] = [];
  const availableSheetIds = sheetMap ? new Set(sheetMap.values()) : null;

  for (const t of targets) {
    if (availableSheetIds && !availableSheetIds.has(t.sheetId)) {
      continue; // Skip if sheet doesn't exist in spreadsheet
    }
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
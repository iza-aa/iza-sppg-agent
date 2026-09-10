import { sheets_v4 } from "googleapis";
import {
  BGN_PALETTE,
  MASTER_SHEET_IDS,
  MASTER_SHEET_NAMES,
  SHEET_NAMES,
  hexToRgbColor,
} from "./constants.js";

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

  // 4. Rename or Add 04_LOG_AKTIVITAS
  const oldLogId = existingSheetMap.get('04_LOG_AKTIVITAS') ?? existingSheetMap.get('04_LOG_AKTIVITAS_GLOBAL');
  if (oldLogId !== undefined) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: oldLogId,
          title: MASTER_SHEET_NAMES.LOG_AKTIVITAS,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SLATE_GRAY) },
          gridProperties: {
            rowCount: 5000,
            columnCount: 11,
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
          sheetId: MASTER_SHEET_IDS.LOG_AKTIVITAS,
          title: MASTER_SHEET_NAMES.LOG_AKTIVITAS,
          index: 3,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SLATE_GRAY) },
          gridProperties: {
            rowCount: 5000,
            columnCount: 11,
            frozenRowCount: 1,
          },
        },
      },
    });
  }

  // 5. Delete old operational single-unit sheets if they exist
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

  const tab4Headers = [
    ['Waktu (WITA)', 'Unit Dapur SPPG', 'Editor / Pengubah', 'Lembar (Tab)', 'No PO / ID', 'Kolom Diedit', 'Nilai Lama', 'Nilai Baru', 'Sumber Aksi', 'Status']
  ];

  return {
    valuesDashboard,
    valuesHelper,
    tab2Headers,
    tab3Headers,
    tab4Headers
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
  direktoriSheetId: number = MASTER_SHEET_IDS.DAFTAR_DAPUR,
  logAktivitasSheetId: number = MASTER_SHEET_IDS.LOG_AKTIVITAS
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

    // =========================================================================
    // Tab 4: 04_LOG_AKTIVITAS Styling
    // =========================================================================
    // 1. Data rows default formatting
    {
      repeatCell: {
        range: {
          sheetId: logAktivitasSheetId,
          startRowIndex: 1,
          endRowIndex: 1000,
          startColumnIndex: 0,
          endColumnIndex: 10,
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
    // 2. Header Row Styling
    {
      repeatCell: {
        range: {
          sheetId: logAktivitasSheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: 10,
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
    // 3. Row heights
    {
      updateDimensionProperties: {
        range: { sheetId: logAktivitasSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 34 },
        fields: 'pixelSize',
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId: logAktivitasSheetId, dimension: 'ROWS', startIndex: 1, endIndex: 100 },
        properties: { pixelSize: 28 },
        fields: 'pixelSize',
      },
    },
    // 4. Column widths for Tab 4
    ...[
      { col: 0, width: 170 }, // A: Waktu (WITA)
      { col: 1, width: 160 }, // B: Unit Dapur SPPG
      { col: 2, width: 180 }, // C: Editor / Pengubah
      { col: 3, width: 180 }, // D: Lembar (Tab)
      { col: 4, width: 160 }, // E: No PO / ID
      { col: 5, width: 180 }, // F: Kolom Diedit
      { col: 6, width: 180 }, // G: Nilai Lama
      { col: 7, width: 180 }, // H: Nilai Baru
      { col: 8, width: 140 }, // I: Sumber Aksi
      { col: 9, width: 130 }, // J: Status
    ].map((cw) => ({
      updateDimensionProperties: {
        range: {
          sheetId: logAktivitasSheetId,
          dimension: 'COLUMNS',
          startIndex: cw.col,
          endIndex: cw.col + 1,
        },
        properties: { pixelSize: cw.width },
        fields: 'pixelSize',
      },
    })),
    // 5. Alignments & Formats for Tab 4
    {
      repeatCell: {
        range: { sheetId: logAktivitasSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    {
      repeatCell: {
        range: { sheetId: logAktivitasSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 1, endColumnIndex: 2 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    {
      repeatCell: {
        range: { sheetId: logAktivitasSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 3 },
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', padding: { left: 8 } } },
        fields: 'userEnteredFormat(horizontalAlignment,padding)',
      },
    },
    {
      repeatCell: {
        range: { sheetId: logAktivitasSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 3, endColumnIndex: 4 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    {
      repeatCell: {
        range: { sheetId: logAktivitasSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 4, endColumnIndex: 5 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    {
      repeatCell: {
        range: { sheetId: logAktivitasSheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 8, endColumnIndex: 10 },
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    // 6. Header border
    {
      updateBorders: {
        range: { sheetId: logAktivitasSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
        bottom: { style: 'SOLID_MEDIUM', color: navyBg },
      },
    },
    {
      updateBorders: {
        range: { sheetId: logAktivitasSheetId, startRowIndex: 1, endRowIndex: 200, startColumnIndex: 0, endColumnIndex: 10 },
        innerHorizontal: { style: 'SOLID', color: hexToRgbColor('#E2E8F0') },
      },
    },
    // 7. Basic Filter on Tab 4
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId: logAktivitasSheetId,
            startRowIndex: 0,
            endRowIndex: 2000,
            startColumnIndex: 0,
            endColumnIndex: 10,
          },
        },
      },
    },
  ];
}

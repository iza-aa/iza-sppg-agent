import { sheets_v4 } from "googleapis";
import {
  BGN_PALETTE,
  SHEET_IDS,
  SHEET_NAMES,
  hexToRgbColor,
} from "./constants.js";

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
          rowCount: 56,
          columnCount: 14,
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

  // 1. Hide 08_MASTER_DATA (supports legacy titles 07_MASTER_DATA, 06_MASTER_DATA, 05_MASTER_DATA)
  const masterSheetId = existingSheetMap.get(SHEET_NAMES.MASTER_DATA)
    ?? existingSheetMap.get('07_MASTER_DATA')
    ?? existingSheetMap.get('06_MASTER_DATA')
    ?? existingSheetMap.get('05_MASTER_DATA');
  if (masterSheetId !== undefined) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: masterSheetId,
          title: SHEET_NAMES.MASTER_DATA,
          hidden: true,
          index: 8,
        },
        fields: 'title,hidden,index',
      },
    });
  }

  // 2. Ensure 06_MARGIN is at index 6
  const marginSheetId = existingSheetMap.get(SHEET_NAMES.MARGIN)
    ?? existingSheetMap.get('06_MARGIN')
    ?? existingSheetMap.get('06_PERBANDINGAN_MARGIN');
  if (marginSheetId !== undefined) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: marginSheetId,
          index: 6,
        },
        fields: 'index',
      },
    });
  }

  // 3. Ensure 07_AKTIVITAS exists and is UNHIDDEN at index 7 (supports legacy 08_LOG_AKTIVITAS, 07_LOG_AKTIVITAS)
  const logSheetId = existingSheetMap.get(SHEET_NAMES.LOG_AKTIVITAS)
    ?? existingSheetMap.get('08_LOG_AKTIVITAS')
    ?? existingSheetMap.get('07_LOG_AKTIVITAS');
  if (logSheetId !== undefined) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: logSheetId,
          title: SHEET_NAMES.LOG_AKTIVITAS,
          hidden: false,
          index: 7,
        },
        fields: 'title,hidden,index',
      },
    });
  } else {
    requests.push({
      addSheet: {
        properties: {
          sheetId: SHEET_IDS.LOG_AKTIVITAS,
          title: SHEET_NAMES.LOG_AKTIVITAS,
          hidden: false,
          index: 7,
          tabColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SLATE_GRAY) },
          gridProperties: {
            rowCount: 5000,
            columnCount: 10,
            frozenRowCount: 1,
          },
        },
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
    // R1: empty spacer (16px)
    [],
    // R2: Banner Title & Filter Labels (B2:G3 merged for title, H2:I2 Bulan, J2:K2 Tahun)
    ['', 'MONITORING REALISASI ANGGARAN & BELANJA SPPG', '', '', '', '', '', 'BULAN', '', 'TAHUN', ''],
    // R3: Subtitle & Filter Dropdowns
    ['', `Ringkasan Pendapatan, Pengeluaran & Efisiensi Dapur - ${unitName}`, '', '', '', '', '', 'SEMUA BULAN', '', 'SEMUA TAHUN', ''],
    // R4: empty spacer (16px)
    [],
    // R5: KPI Headers (B5:C5, D5:E5, Gap F, G5:H5, I5:K5)
    ['', 'PENDAPATAN', '', 'PENGELUARAN', '', '', 'MARGIN OPERASIONAL', '', 'TOTAL TRANSAKSI', '', ''],
    // R6: KPI Values
    [
      '',
      `=IFERROR(SUMIFS('${SHEET_NAMES.PENDAPATAN}'!$F$2:$F; '${SHEET_NAMES.PENDAPATAN}'!$C$2:$C; ">="&$M$1; '${SHEET_NAMES.PENDAPATAN}'!$C$2:$C; "<="&$M$2); 0)`,
      '',
      `=IFERROR(SUMIFS('${SHEET_NAMES.PENGELUARAN}'!$G$2:$G; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; ">="&$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; "<="&$M$2); 0)`,
      '',
      '',
      `=B6-D6`,
      '',
      `=IFERROR(COUNTIFS('${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; ">="&$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; "<="&$M$2; '${SHEET_NAMES.PENGELUARAN}'!$A$2:$A; "<>"); 0)`,
      '',
      ''
    ],
    // R7: KPI Subtitles
    [
      '',
      'Pendapatan Masuk SPPG',
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
    ['', '6 REKANAN SUPPLIER TERBESAR', '', '', '', '', 'DISTRIBUSI BELANJA BAHAN POKOK', '', '', '', ''],
    // R10
    [
      '',
      `=IFERROR(INDEX(QUERY('${SHEET_NAMES.PENGELUARAN}'!$A$2:$G; "SELECT Col5, SUM(Col7) WHERE Col5 IS NOT NULL AND Col4 >= date '"&TEXT($M$1;"yyyy-mm-dd")&"' AND Col4 <= date '"&TEXT($M$2;"yyyy-mm-dd")&"' GROUP BY Col5 ORDER BY SUM(Col7) DESC LABEL Col5 '', SUM(Col7) ''"; 0); 1; 1); "-")`,
      '',
      '',
      `=IF(B10="-"; 0; IFERROR(SUMIFS('${SHEET_NAMES.PENGELUARAN}'!$G$2:$G; '${SHEET_NAMES.PENGELUARAN}'!$E$2:$E; B10; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; ">="&$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; "<="&$M$2); 0))`,
      '',
      'Protein Hewani',
      `=IFERROR(SUM(FILTER('${SHEET_NAMES.MARGIN}'!$L$2:$L; '${SHEET_NAMES.MARGIN}'!$D$2:$D>=$M$1; '${SHEET_NAMES.MARGIN}'!$D$2:$D<=$M$2; REGEXMATCH(LOWER('${SHEET_NAMES.MARGIN}'!$F$2:$F); "telur|ayam|daging|ikan|sapi|udang|bebek|susu|tongkol|lele|nugget"))); 0)`,
      `=IFERROR(H10/$H$16; 0)`,
      `=REPT("█"; ROUND(I10*28)) & REPT("░"; 28-ROUND(I10*28))`,
      ''
    ],
    // R11
    [
      '',
      `=IFERROR(INDEX(QUERY('${SHEET_NAMES.PENGELUARAN}'!$A$2:$G; "SELECT Col5, SUM(Col7) WHERE Col5 IS NOT NULL AND Col4 >= date '"&TEXT($M$1;"yyyy-mm-dd")&"' AND Col4 <= date '"&TEXT($M$2;"yyyy-mm-dd")&"' GROUP BY Col5 ORDER BY SUM(Col7) DESC LABEL Col5 '', SUM(Col7) ''"; 0); 2; 1); "-")`,
      '',
      '',
      `=IF(B11="-"; 0; IFERROR(SUMIFS('${SHEET_NAMES.PENGELUARAN}'!$G$2:$G; '${SHEET_NAMES.PENGELUARAN}'!$E$2:$E; B11; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; ">="&$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; "<="&$M$2); 0))`,
      '',
      'Sayuran Segar',
      `=IFERROR(SUM(FILTER('${SHEET_NAMES.MARGIN}'!$L$2:$L; '${SHEET_NAMES.MARGIN}'!$D$2:$D>=$M$1; '${SHEET_NAMES.MARGIN}'!$D$2:$D<=$M$2; REGEXMATCH(LOWER('${SHEET_NAMES.MARGIN}'!$F$2:$F); "sayur|wortel|buncis|kol|kubis|sawi|kangkung|bayam|tomat|labu|kentang|kacang|tauge|terong|timun|brokoli"))); 0)`,
      `=IFERROR(H11/$H$16; 0)`,
      `=REPT("█"; ROUND(I11*28)) & REPT("░"; 28-ROUND(I11*28))`,
      ''
    ],
    // R12
    [
      '',
      `=IFERROR(INDEX(QUERY('${SHEET_NAMES.PENGELUARAN}'!$A$2:$G; "SELECT Col5, SUM(Col7) WHERE Col5 IS NOT NULL AND Col4 >= date '"&TEXT($M$1;"yyyy-mm-dd")&"' AND Col4 <= date '"&TEXT($M$2;"yyyy-mm-dd")&"' GROUP BY Col5 ORDER BY SUM(Col7) DESC LABEL Col5 '', SUM(Col7) ''"; 0); 3; 1); "-")`,
      '',
      '',
      `=IF(B12="-"; 0; IFERROR(SUMIFS('${SHEET_NAMES.PENGELUARAN}'!$G$2:$G; '${SHEET_NAMES.PENGELUARAN}'!$E$2:$E; B12; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; ">="&$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; "<="&$M$2); 0))`,
      '',
      'Bahan Pokok & Beras',
      `=IFERROR(SUM(FILTER('${SHEET_NAMES.MARGIN}'!$L$2:$L; '${SHEET_NAMES.MARGIN}'!$D$2:$D>=$M$1; '${SHEET_NAMES.MARGIN}'!$D$2:$D<=$M$2; REGEXMATCH(LOWER('${SHEET_NAMES.MARGIN}'!$F$2:$F); "beras|minyak|tahu|tempe|tepung|gula|garam|mie|bihun|soun|santan"))); 0)`,
      `=IFERROR(H12/$H$16; 0)`,
      `=REPT("█"; ROUND(I12*28)) & REPT("░"; 28-ROUND(I12*28))`,
      ''
    ],
    // R13
    [
      '',
      `=IFERROR(INDEX(QUERY('${SHEET_NAMES.PENGELUARAN}'!$A$2:$G; "SELECT Col5, SUM(Col7) WHERE Col5 IS NOT NULL AND Col4 >= date '"&TEXT($M$1;"yyyy-mm-dd")&"' AND Col4 <= date '"&TEXT($M$2;"yyyy-mm-dd")&"' GROUP BY Col5 ORDER BY SUM(Col7) DESC LABEL Col5 '', SUM(Col7) ''"; 0); 4; 1); "-")`,
      '',
      '',
      `=IF(B13="-"; 0; IFERROR(SUMIFS('${SHEET_NAMES.PENGELUARAN}'!$G$2:$G; '${SHEET_NAMES.PENGELUARAN}'!$E$2:$E; B13; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; ">="&$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; "<="&$M$2); 0))`,
      '',
      'Buah Segar',
      `=IFERROR(SUM(FILTER('${SHEET_NAMES.MARGIN}'!$L$2:$L; '${SHEET_NAMES.MARGIN}'!$D$2:$D>=$M$1; '${SHEET_NAMES.MARGIN}'!$D$2:$D<=$M$2; REGEXMATCH(LOWER('${SHEET_NAMES.MARGIN}'!$F$2:$F); "buah|pisang|semangka|melon|jeruk|apel|pepaya|mangga|nanas|salak|anggur|kelengkeng|pir"))); 0)`,
      `=IFERROR(H13/$H$16; 0)`,
      `=REPT("█"; ROUND(I13*28)) & REPT("░"; 28-ROUND(I13*28))`,
      ''
    ],
    // R14: Bumbu Dapur
    [
      '',
      `=IFERROR(INDEX(QUERY('${SHEET_NAMES.PENGELUARAN}'!$A$2:$G; "SELECT Col5, SUM(Col7) WHERE Col5 IS NOT NULL AND Col4 >= date '"&TEXT($M$1;"yyyy-mm-dd")&"' AND Col4 <= date '"&TEXT($M$2;"yyyy-mm-dd")&"' GROUP BY Col5 ORDER BY SUM(Col7) DESC LABEL Col5 '', SUM(Col7) ''"; 0); 5; 1); "-")`,
      '',
      '',
      `=IF(B14="-"; 0; IFERROR(SUMIFS('${SHEET_NAMES.PENGELUARAN}'!$G$2:$G; '${SHEET_NAMES.PENGELUARAN}'!$E$2:$E; B14; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; ">="&$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; "<="&$M$2); 0))`,
      '',
      'Bumbu Dapur',
      `=IFERROR(SUM(FILTER('${SHEET_NAMES.MARGIN}'!$L$2:$L; '${SHEET_NAMES.MARGIN}'!$D$2:$D>=$M$1; '${SHEET_NAMES.MARGIN}'!$D$2:$D<=$M$2; REGEXMATCH(LOWER('${SHEET_NAMES.MARGIN}'!$F$2:$F); "bawang|cabai|cabe|lada|merica|kaldu|serai|lengkuas|salam|jeruk|wijen|jahe|kunyit|kemiri|jagung|saus|saos|kecap|bumbu|jinten"))); 0)`,
      `=IFERROR(H14/$H$16; 0)`,
      `=REPT("█"; ROUND(I14*28)) & REPT("░"; 28-ROUND(I14*28))`,
      ''
    ],
    // R15: Belanja Belum Dirinci
    [
      '',
      `=IFERROR(INDEX(QUERY('${SHEET_NAMES.PENGELUARAN}'!$A$2:$G; "SELECT Col5, SUM(Col7) WHERE Col5 IS NOT NULL AND Col4 >= date '"&TEXT($M$1;"yyyy-mm-dd")&"' AND Col4 <= date '"&TEXT($M$2;"yyyy-mm-dd")&"' GROUP BY Col5 ORDER BY SUM(Col7) DESC LABEL Col5 '', SUM(Col7) ''"; 0); 6; 1); "-")`,
      '',
      '',
      `=IF(B15="-"; 0; IFERROR(SUMIFS('${SHEET_NAMES.PENGELUARAN}'!$G$2:$G; '${SHEET_NAMES.PENGELUARAN}'!$E$2:$E; B15; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; ">="&$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D; "<="&$M$2); 0))`,
      '',
      'Belanja Belum Dirinci',
      `=IFERROR(D6 - SUM(H10:H14); 0)`,
      `=IFERROR(H15/$H$16; 0)`,
      `=REPT("█"; ROUND(I15*28)) & REPT("░"; 28-ROUND(I15*28))`,
      ''
    ],
    // R16: Totals
    [
      '',
      'TOTAL BELANJA SUPPLIER',
      '',
      '',
      `=SUM(E10:E15)`,
      '',
      'TOTAL BIAYA BAHAN',
      `=SUM(H10:H15)`,
      '100.0%',
      '',
      ''
    ],
    // R17: empty spacer (16px)
    [],
    // R18: Lower Titles (Area B18:E18 empty for pie chart overlay, G18:K18 Title)
    ['', '', '', '', '', '', '10 TRANSAKSI BELANJA TERAKHIR', '', '', '', ''],
    // R19: Subheaders
    ['', '', '', '', '', '', 'Tanggal', 'Supplier', 'Nominal', 'Metode', 'ID Pengeluaran'],
  ];

  // R20..R29: 10 Recent Transactions in G..K (B..E remain empty for pie chart overlay)
  for (let i = 1; i <= 10; i++) {
    valuesDashboard.push([
      '',
      '',
      '',
      '',
      '',
      '',
      `=IFERROR(INDEX(SORT(FILTER('${SHEET_NAMES.PENGELUARAN}'!$A$2:$H; '${SHEET_NAMES.PENGELUARAN}'!$A$2:$A<>""; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D>=$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D<=$M$2); 4; FALSE); ${i}; 4); "-")`,
      `=IFERROR(INDEX(SORT(FILTER('${SHEET_NAMES.PENGELUARAN}'!$A$2:$H; '${SHEET_NAMES.PENGELUARAN}'!$A$2:$A<>""; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D>=$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D<=$M$2); 4; FALSE); ${i}; 5); "-")`,
      `=IFERROR(INDEX(SORT(FILTER('${SHEET_NAMES.PENGELUARAN}'!$A$2:$H; '${SHEET_NAMES.PENGELUARAN}'!$A$2:$A<>""; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D>=$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D<=$M$2); 4; FALSE); ${i}; 7); 0)`,
      `=IFERROR(INDEX(SORT(FILTER('${SHEET_NAMES.PENGELUARAN}'!$A$2:$H; '${SHEET_NAMES.PENGELUARAN}'!$A$2:$A<>""; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D>=$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D<=$M$2); 4; FALSE); ${i}; 8); "-")`,
      `=IFERROR(INDEX(SORT(FILTER('${SHEET_NAMES.PENGELUARAN}'!$A$2:$H; '${SHEET_NAMES.PENGELUARAN}'!$A$2:$A<>""; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D>=$M$1; '${SHEET_NAMES.PENGELUARAN}'!$D$2:$D<=$M$2); 4; FALSE); ${i}; 3); "-")`
    ]);
  }

  // R30: empty spacer (16px)
  valuesDashboard.push([]);

  // R31: Activity Log Title Banner (B31:K31)
  valuesDashboard.push([
    '',
    'LOG AKTIVITAS BOT & OPERASIONAL TERAKHIR',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);

  // R32: Subheaders (B32:K32)
  valuesDashboard.push([
    '',
    'Waktu',
    'Pengguna',
    'Tipe',
    'Pesan Pengguna',
    '',
    '',
    'Aksi & Respon Sistem',
    '',
    '',
    'Status',
  ]);

  // R33..R52: 20 Recent Activities (B..K)
  for (let i = 1; i <= 20; i++) {
    valuesDashboard.push([
      '',
      `=IFERROR(INDEX(SORT(FILTER('${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$I; '${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$A<>""); 1; FALSE); ${i}; 1); "-")`,
      `=IFERROR(INDEX(SORT(FILTER('${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$I; '${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$A<>""); 1; FALSE); ${i}; 3); "-")`,
      `=IFERROR(INDEX(SORT(FILTER('${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$I; '${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$A<>""); 1; FALSE); ${i}; 5); "-")`,
      `=IFERROR(INDEX(SORT(FILTER('${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$I; '${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$A<>""); 1; FALSE); ${i}; 6); "-")`,
      '',
      '',
      `=IFERROR(INDEX(SORT(FILTER('${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$I; '${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$A<>""); 1; FALSE); ${i}; 7); "-")`,
      '',
      '',
      `=IFERROR(INDEX(SORT(FILTER('${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$I; '${SHEET_NAMES.LOG_AKTIVITAS}'!$A$2:$A<>""); 1; FALSE); ${i}; 9); "-")`,
    ]);
  }

  const valuesHelper = [
    [`=IFS(AND($H$3="SEMUA BULAN"; $J$3="SEMUA TAHUN"); DATE(2020;1;1); $H$3="SEMUA BULAN"; DATE($M$4; 1; 1); $M$3>0; DATE($M$4; $M$3; 1); TRUE; DATE(2020;1;1))`],
    [`=IFS(AND($H$3="SEMUA BULAN"; $J$3="SEMUA TAHUN"); DATE(2035;12;31); $H$3="SEMUA BULAN"; DATE($M$4; 12; 31); $M$3>0; EOMONTH(DATE($M$4; $M$3; 1); 0); TRUE; DATE(2035;12;31))`],
    [`=IFERROR(MATCH(UPPER($H$3); {"JANUARI"; "FEBRUARI"; "MARET"; "APRIL"; "MEI"; "JUNI"; "JULI"; "AGUSTUS"; "SEPTEMBER"; "OKTOBER"; "NOVEMBER"; "DESEMBER"}; 0); 0)`],
    [`=IF(ISNUMBER(VALUE($J$3)); VALUE($J$3); YEAR(TODAY()))`]
  ];

  const tabPaguPenerimaanHeaders = [
    ['No SPPG Ref', 'ID Pendapatan', 'Tanggal', 'Jumlah Bahan', 'Target Supplier', 'Total Pendapatan', 'Link Bukti Dokumen', 'Penanggung Jawab', 'Waktu Input', 'Keterangan']
  ];

  const tabRincianPendapatanHeaders = [
    ['No SPPG Ref', 'ID Pendapatan', 'No Urut', 'Uraian Bahan', 'Target Supplier', 'Kuantitas', 'Satuan', 'Harga Satuan', 'Total Pendapatan', 'Pengguna', 'Waktu Input', 'Keterangan']
  ];

  const tabPaguPengeluaranHeaders = [
    ['No SPPG Ref', 'ID Pendapatan', 'ID Pengeluaran', 'Tanggal', 'Nama Supplier', 'No Invoice Supplier', 'Total Tagihan', 'Metode', 'Link Bukti Nota', 'Pengguna', 'Waktu Input', 'Keterangan']
  ];

  const tabRincianPengeluaranHeaders = [
    ['No SPPG Ref', 'ID Pendapatan', 'ID Pengeluaran', 'No Urut', 'Nama Supplier', 'Uraian Bahan Belanja', 'Kuantitas', 'Satuan', 'Harga Satuan', 'Total Belanja', 'Pengguna', 'Waktu Input', 'Keterangan']
  ];

  const tabPerbandinganMarginHeaders = [
    ['No SPPG Ref', 'ID Pendapatan', 'ID Pengeluaran', 'Tanggal', 'Nama Supplier', 'Uraian Bahan', 'Kuantitas', 'Satuan', 'Harga Pendapatan', 'Total Pendapatan', 'Harga Invoice', 'Total Realisasi', 'Margin Bersih (Rp)', '% Margin', 'Status']
  ];

  const tabMasterDataHeaders = [
    ['Daftar Resmi Supplier', 'Daftar Satuan Baku', 'Daftar Kategori Bahan']
  ];

  const tabLogAktivitasHeaders = [
    ['Timestamp', 'User ID', 'Pengguna', 'Role', 'Tipe Media', 'Pesan Pengguna', 'Aksi Sistem', 'ID Ref', 'Status']
  ];

  return {
    valuesDashboard,
    valuesHelper,
    tabPaguPenerimaanHeaders,
    tabRincianPendapatanHeaders,
    tabPaguPengeluaranHeaders,
    tabRincianPengeluaranHeaders,
    tabPerbandinganMarginHeaders,
    tabMasterDataHeaders,
    tabLogAktivitasHeaders,
    // Backward compatibility aliases
    tabPaguRingkasanHeaders: tabPaguPenerimaanHeaders,
    tabPaguRincianHeaders: tabRincianPendapatanHeaders,
    tabPengeluaranHeaders: tabPaguPengeluaranHeaders,
    tabRekapMarginHeaders: tabPerbandinganMarginHeaders,
    tab2Headers: tabPaguPenerimaanHeaders,
    tab3Headers: tabPaguPengeluaranHeaders,
    tab4Headers: tabPerbandinganMarginHeaders,
  };
}

/**
 * Membuat BatchUpdate Requests untuk styling BGN, formatting, merges, dan layout 01_DASHBOARD
 */
export function createOperationalDashboardStylingRequests(firstId: number): sheets_v4.Schema$Request[] {
  return [
    // 0. Ensure 01_DASHBOARD grid has at least 56 rows & 14 cols so dimension styling succeeds
    {
      updateSheetProperties: {
        properties: {
          sheetId: firstId,
          gridProperties: {
            rowCount: 56,
            columnCount: 14,
          },
        },
        fields: 'gridProperties(rowCount,columnCount)',
      },
    },
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
    // Merges for Supplier Rows (B10:D10 to B15:D15 and Total B16:D16)
    ...[9, 10, 11, 12, 13, 14, 15].map((r) => ({
      mergeCells: { range: { sheetId: firstId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 1, endColumnIndex: 4 }, mergeType: 'MERGE_ALL' as const },
    })),

    // Merges for Category Table Title (G9:K9)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 8, endRowIndex: 9, startColumnIndex: 6, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },
    // Merges for Category Progress Bars (J10:K10 to J15:K15 and Total J16:K16)
    ...[9, 10, 11, 12, 13, 14, 15].map((r) => ({
      mergeCells: { range: { sheetId: firstId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 9, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' as const },
    })),

    // Merges for 10 Transaksi Title (G18:K18)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 17, endRowIndex: 18, startColumnIndex: 6, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
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

    // Currency format for Supplier Table (E10:E16)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 16, startColumnIndex: 4, endColumnIndex: 5 },
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
    // Supplier Table Left Align for names (B10:D15)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 15, startColumnIndex: 1, endColumnIndex: 4 },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'MIDDLE',
            padding: { left: 8 },
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,padding)',
      },
    },
    // Supplier Table Total Label (B16:D16)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 15, endRowIndex: 16, startColumnIndex: 1, endColumnIndex: 4 },
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

    // Category Table Formatting (G10:K16)
    // Category Names (G10:G15)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 15, startColumnIndex: 6, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'MIDDLE',
            padding: { left: 8 },
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,padding)',
      },
    },
    // Category Amounts (H10:H16)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 16, startColumnIndex: 7, endColumnIndex: 8 },
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
    // Percent format for Category Table (I10:I16)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 16, startColumnIndex: 8, endColumnIndex: 9 },
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
    // Progress Bar format (J10:K16)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 9, endRowIndex: 16, startColumnIndex: 9, endColumnIndex: 11 },
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
    // Total Category Label (G16)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 15, endRowIndex: 16, startColumnIndex: 6, endColumnIndex: 7 },
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

    // Dotted/Solid Top Border on Totals Row 16
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 15, endRowIndex: 16, startColumnIndex: 1, endColumnIndex: 5 },
        top: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
        bottom: { style: 'DOUBLE', color: { red: 0.8, green: 0.8, blue: 0.8 } },
      },
    },
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 15, endRowIndex: 16, startColumnIndex: 6, endColumnIndex: 11 },
        top: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
        bottom: { style: 'DOUBLE', color: { red: 0.8, green: 0.8, blue: 0.8 } },
      },
    },

    // Lower Section: 10 Transaksi Belanja Terakhir (G18:K29)
    // Header (Row 18: G18:K18)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 17, endRowIndex: 18, startColumnIndex: 6, endColumnIndex: 11 },
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
    // Subheaders (Row 19: G19:K19)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 18, endRowIndex: 19, startColumnIndex: 6, endColumnIndex: 11 },
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
    // Date format for Recent Transactions Tanggal (Col G: index 6, Row 20-29)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 19, endRowIndex: 29, startColumnIndex: 6, endColumnIndex: 7 },
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
    // Uraian Bahan (Col H: index 7, Row 20-29)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 19, endRowIndex: 29, startColumnIndex: 7, endColumnIndex: 8 },
        cell: {
          userEnteredFormat: {
            verticalAlignment: 'MIDDLE',
            padding: { left: 6 },
          },
        },
        fields: 'userEnteredFormat(verticalAlignment,padding)',
      },
    },
    // Currency format for Recent Transactions Nominal (Col I: index 8, Row 20-29)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 19, endRowIndex: 29, startColumnIndex: 8, endColumnIndex: 9 },
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
    // Supplier & Status (Col J & K: index 9 & 10, Row 20-29)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 19, endRowIndex: 29, startColumnIndex: 9, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)',
      },
    },
    // Subtle row borders for 10 Transaksi (Row 18-29)
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 17, endRowIndex: 29, startColumnIndex: 6, endColumnIndex: 11 },
        left: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        right: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        bottom: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        innerHorizontal: { style: 'SOLID', color: { red: 0.92, green: 0.92, blue: 0.92 } },
      },
    },

    // Merges for Activity Log Banner Title (B31:K31)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 30, endRowIndex: 31, startColumnIndex: 1, endColumnIndex: 11 }, mergeType: 'MERGE_ALL' },
    },
    // Merges for Activity Log Subheaders (Pesan E32:G32, Aksi H32:J32)
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 31, endRowIndex: 32, startColumnIndex: 4, endColumnIndex: 7 }, mergeType: 'MERGE_ALL' },
    },
    {
      mergeCells: { range: { sheetId: firstId, startRowIndex: 31, endRowIndex: 32, startColumnIndex: 7, endColumnIndex: 10 }, mergeType: 'MERGE_ALL' },
    },
    // Merges for Activity Log Data Rows (R33..R52, row index 32..51)
    ...Array.from({ length: 20 }, (_, idx) => 32 + idx).flatMap((r) => [
      {
        mergeCells: { range: { sheetId: firstId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 4, endColumnIndex: 7 }, mergeType: 'MERGE_ALL' as const },
      },
      {
        mergeCells: { range: { sheetId: firstId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 7, endColumnIndex: 10 }, mergeType: 'MERGE_ALL' as const },
      },
    ]),

    // Activity Log Banner Styling (B31:K31)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 30, endRowIndex: 31, startColumnIndex: 1, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            backgroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY),
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.WHITE), bold: true, fontSize: 10 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Activity Log Subheader Styling (B32:K32)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 31, endRowIndex: 32, startColumnIndex: 1, endColumnIndex: 11 },
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
    },

    // Activity Log Data Rows Formatting (R33..R52, index 32..52)
    // Timestamp (Col B)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 32, endRowIndex: 52, startColumnIndex: 1, endColumnIndex: 2 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.SLATE_GRAY), fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Pengguna (Col C)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 32, endRowIndex: 52, startColumnIndex: 2, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: {
            textFormat: { foregroundColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY), bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Tipe (Col D)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 32, endRowIndex: 52, startColumnIndex: 3, endColumnIndex: 4 },
        cell: {
          userEnteredFormat: {
            textFormat: { fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    // Pesan Pengguna (Col E:G)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 32, endRowIndex: 52, startColumnIndex: 4, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { fontSize: 9 },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            padding: { left: 6, right: 6 },
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,padding)',
      },
    },
    // Aksi & Respon Sistem (Col H:J)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 32, endRowIndex: 52, startColumnIndex: 7, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            textFormat: { fontSize: 9 },
            horizontalAlignment: 'LEFT',
            verticalAlignment: 'MIDDLE',
            padding: { left: 6, right: 6 },
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,padding)',
      },
    },
    // Status (Col K)
    {
      repeatCell: {
        range: { sheetId: firstId, startRowIndex: 32, endRowIndex: 52, startColumnIndex: 10, endColumnIndex: 11 },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true, fontSize: 9 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
          },
        },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
      },
    },

    // Subtle borders for Activity Log Table (Row 31..52, Col B..K)
    {
      updateBorders: {
        range: { sheetId: firstId, startRowIndex: 30, endRowIndex: 52, startColumnIndex: 1, endColumnIndex: 11 },
        left: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        right: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        bottom: { style: 'SOLID', color: { red: 0.85, green: 0.85, blue: 0.85 } },
        innerHorizontal: { style: 'SOLID', color: { red: 0.92, green: 0.92, blue: 0.92 } },
        innerVertical: { style: 'SOLID', color: { red: 0.94, green: 0.94, blue: 0.94 } },
      },
    },

    // Column Widths on 01_DASHBOARD (Exact reference geometry from wa-agent)
    ...[
      { col: 0, width: 25 },   // A: Margin
      { col: 1, width: 170 },  // B: Waktu (170px to fit YYYY-MM-DD HH:mm:ss WIB cleanly)
      { col: 2, width: 110 },  // C: Pengguna
      { col: 3, width: 110 },  // D: Tipe
      { col: 4, width: 145 },  // E (B..E = 170 + 110 + 110 + 145 = 535px)
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
      { start: 0, end: 16, height: 21 },
      { start: 16, end: 17, height: 16 }, // R17: Spacer row
      { start: 17, end: 29, height: 21 }, // R18..R29
      { start: 29, end: 30, height: 16 }, // R30: Spacer row
      { start: 30, end: 31, height: 26 }, // R31: Log banner
      { start: 31, end: 32, height: 22 }, // R32: Log subheaders
      { start: 32, end: 52, height: 21 }, // R33..R52: 20 log rows
      { start: 52, end: 56, height: 16 }, // R53..R56: bottom margin
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
 * Menambahkan Diagram Pie Chart (Pengeluaran per Kategori) pada range B18:E29
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
                    endRowIndex: 15,
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
                    endRowIndex: 15,
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
              rowIndex: 17,
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

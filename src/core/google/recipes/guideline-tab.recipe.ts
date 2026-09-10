import { sheets_v4 } from "googleapis";
import {
  BGN_PALETTE,
  SHEET_IDS,
  SHEET_NAMES,
  hexToRgbColor,
} from "./constants.js";

/**
 * Values for Tab 00_PANDUAN_OPERASIONAL
 */
export function getGuidelineTabValues(unitName = "SPPG Dapur Unit"): (string | number)[][] {
  return [
    // R1: Banner Title
    ["🏛️ BADAN GIZI NASIONAL (BGN) REPUBLIK INDONESIA - PANDUAN OPERASIONAL SISTEM SPPG", "", "", "", "", ""],
    // R2: Subtitle
    [`SOP Buku Kas 6-Tab & Asisten Telegram (${unitName})`, "", "", "", "", ""],
    // R3: Blank
    ["", "", "", "", "", ""],
    // R4: Section 1 Header
    ["1. ARSITEKTUR KEUANGAN & FUNGSI 6 TAB SPREADSHEET", "", "", "", "", ""],
    // R5: Table 1 Header
    ["Nomor Tab", "Nama Tab Spreadsheet", "Sifat Data", "Fungsi & Peruntukan Utama", "SOP / Aturan Pengisian", "Keterikatan Relasional (Cascading)"],
    // R6-R11: Tab Rows
    ["Tab 01", "01_DASHBOARD", "Otomatis (Formula)", "Menampilkan KPI eksekutif, total anggaran pagu, realisasi belanja, sisa anggaran, dan chart tren", "DILARANG EDIT: Seluruh angka dihitung otomatis oleh formula, jangan ubah isi sel", "Menghubungkan data dari Tab 02 & Tab 04"],
    ["Tab 02", "02_PAGU_PENERIMAAN", "Induk Anggaran (Input)", "Mencatat Surat Pesanan resmi BGN, nomor PO, tanggal menu, batas plafon anggaran belanja", "Dicatat oleh bot saat menerima pesanan pagu baru dari Telegram atau input resmi SPPG", "Data Induk Utama: Terhubung ke Tab 03, 04, 05, 06"],
    ["Tab 03", "03_RINCIAN_PENDAPATAN", "Rincian Pagu (Child)", "Merinci kuantitas, satuan, dan plafon harga maksimal per komoditas bahan baku resmi BGN", "DILARANG EDIT MANUAL: Disinkronkan otomatis dari Tab 02 atau via bot", "Terikat mutlak dengan No SPPG Tab 02"],
    ["Tab 04", "04_PAGU_PENGELUARAN", "Ringkasan Nota (Formula)", "Mencatat faktur/nota induk supplier, nomor nota, tanggal, supplier, dan total nominal tagihan", "FORMULA OTOMATIS: Total tagihan (Col F) otomatis menjumlahkan rincian di Tab 05", "Terikat dengan Tab 05 (Hapus nota = hapus rincian)"],
    ["Tab 05", "05_RINCIAN_PENGELUARAN", "Rincian Belanja (Input)", "Mencatat item bahan belanjaan riil dari pasar/supplier, kuantitas, harga faktur, dan bukti nota", "INPUT BOT / SHEET: Masuk otomatis saat staf kirim chat/foto struk nota ke bot", "Mengisi realisasi Tab 06 & mengakumulasi total Tab 04"],
    ["Tab 06", "06_PERBANDINGAN_MARGIN", "Evaluasi Margin (Live)", "Komparasi berdampingan antara pagu resmi vs realisasi belanja riil dan evaluasi laba/rugi", "OTOMATIS: Dihitung secara live per komoditas bahan, mendeteksi HEMAT / OVER BUDGET", "Memantau efisiensi anggaran & batas margin SPPG"],
    // R12: Blank
    ["", "", "", "", "", ""],
    // R13: Section 2 Header
    ["2. PANDUAN LENGKAP PERINTAH TELEGRAM BOT", "", "", "", "", ""],
    // R14: Table 2 Header
    ["Kategori Fitur", "Contoh Pesan / Perintah Chat", "Penjelasan Parameter", "Dampak ke Google Sheets", "Hak Akses", "Status / Tombol Terkait"],
    // R15-R27: Command Rows
    ["Belanja 1 Bahan", "Beli daging ayam 120 kg harga 36000 di Pasar tunai", "[Bahan] [Qty] [Satuan] [Harga] [Supplier] [Metode]", "Menambah 1 transaksi di Tab 04 & 1 rincian di Tab 05", "Admin & Member", "Tombol [✅ Ya, Simpan]"],
    ["Belanja Multi-Bahan", "Catat belanja pasar tunai:\n1. Daging Ayam 120 kg harga 36000\n2. Beras Medium 150 kg harga 13000\n3. Sayur Sop 50 kg harga 17000", "Daftar bernomor atau baris baru, format fleksibel", "Menambah 1 nota di Tab 04 & 3 rincian di Tab 05 berurutan", "Admin & Member", "Pilih tombol Alokasi PO jika multi-kandidat"],
    ["Belanja Non-Pagu / Darurat", "Beli gas elpiji 12kg 2 tabung harga 420000 tunai", "Belanja operasional dapur yang tidak ada di pagu menu", "Tercatat di Tab 04 & 05 dengan label [NON-PAGU]", "Admin & Member", "Pilih [🚫 Belanja Tambahan (Non-Pagu)]"],
    ["Input Foto Struk / Nota", "[Kirim Foto Kuitansi / Struk Belanjaan]", "AI Vision OCR otomatis membaca teks & angka di nota", "Menyiapkan draf belanja lengkap dengan link foto Drive", "Admin & Member", "Cek draf sebelum tekan [✅ Ya, Simpan]"],
    ["Pendaftaran Pagu Baru", "Buat pagu tanggal 2026-09-10 no induk PO-2026/09/SPPG2-02", "Mendaftarkan surat pesanan pagu baru resmi BGN", "Menambah baris di Tab 02 & rincian bahan di Tab 03", "Admin Saja", "Mengisi plafon awal Tab 06"],
    ["Ubah Pagu (1-Shot)", "Ubah harga ayam menjadi 37000 di PO-2026/09/SPPG2-01", "Koreksi kuantitas, harga satuan, atau rekanan pagu", "Update seketika pada Tab 03 & sinkron ke Tab 06", "Admin Saja", "Tombol konfirmasi perubahan harga"],
    ["Hapus 1 Nota (Cascade)", "hapus EI002", "Membatalkan seluruh transaksi nota belanja tertentu", "Hapus baris Tab 04, seluruh rincian Tab 05, reset Tab 06", "Admin Saja", "Tombol [🗑️ Ya, Hapus Transaksi]"],
    ["Hapus 1 Bahan Belanja", "hapus rincian Sayur Sop Campur dari EI002", "Menghapus salah satu bahan saja dari suatu nota", "Hapus baris terkait di Tab 05, potong total di Tab 04", "Admin Saja", "Tombol [🗑️ Ya, Hapus Bahan]"],
    ["Hapus Multi-Bahan", "hapus Sayur Sop Campur dan Minyak Goreng dari EI002", "Gunakan kata 'dan' atau koma (,) antar nama bahan", "Hapus kedua baris di Tab 05, potong total di Tab 04", "Admin Saja", "Tombol [🗑️ Ya, Hapus 2 Bahan Ini]"],
    ["Hapus Bahan dari Pagu", "hapus bahan ceker ayam di PO-2026/09/SPPG2-01", "Menghapus alokasi komoditas dari pagu resmi BGN", "Hapus baris di Tab 03, kurangi pagu Tab 02 & Tab 06", "Admin Saja", "Tombol [🗑️ Ya, Hapus Pagu]"],
    ["Rekap Margin Harian", "rekap atau margin", "Menampilkan ringkasan surplus/defisit dapur hari ini", "Membaca data live dari Tab 06 & Tab 01", "Admin Saja", "Tombol Cetak PDF & Link Sheets"],
    ["Cetak Dokumen SPJ (PDF)", "pdf atau kirim pdf", "Menghasilkan file PDF resmi format standar BGN", "File PDF di-generate otomatis dan dikirim ke Telegram", "Admin Saja", "Siap dicetak untuk berkas SPJ"],
    ["Undang Anggota Tim", "/invite Budi member", "Membuat link undangan 15 menit (role: admin/member)", "Mencatat akun terverifikasi ke database izin bot", "Admin & Super", "Penerima klik link & otomatis aktif"],
    // R28: Blank
    ["", "", "", "", "", ""],
    // R29: Section 3 Header
    ["3. STANDAR STATUS EVALUASI MARGIN PADA TAB 06", "", "", "", "", ""],
    // R30: Table 3 Header
    ["Status Indikator", "Kriteria Evaluasi", "Dampak Finansial Dapur SPPG", "Tindakan Operasional yang Disarankan", "Penanggung Jawab", "Keterangan Sistem"],
    // R31-R35: Margin Status Rows
    ["🟢 HEMAT", "Harga Beli < Plafon Pagu (Kuantitas terpenuhi)", "Menghasilkan SURPLUS EFISIENSI (Margin positif)", "Pertahankan rekanan supplier dan kualitas bahan baku", "Petugas Pengadaan", "Margin dihitung otomatis di Kolom K & L"],
    ["🟢 PAS", "Harga Beli = Plafon Pagu (100% sesuai target)", "MARGIN NETRAL (Realisasi sama persis dengan pagu)", "Perencanaan belanja akurat, lanjutkan operasional normal", "Petugas Pengadaan", "Selisih margin Rp 0 (0,00%)"],
    ["🔴 OVER BUDGET", "Harga Beli > Plafon Pagu BGN", "DEFISIT BIAYA (Memotong margin keuntungan SPPG)", "Negosiasi harga ke supplier, ganti rekanan, atau evaluasi menu", "Kepala Dapur & Admin", "Angka selisih berwarna merah negatif"],
    ["🟠 BELUM LENGKAP", "Kuantitas belanja riil < Target Kuantitas Pagu", "PENGADAAN BERTAHAP (Belum dapat ditagihkan penuh)", "Catat sisa belanjaan saat barang gelombang berikutnya tiba", "Staf Belanja Pasar", "Menampilkan rasio kuantitas, misal: (60/100 sisir)"],
    ["🟡 MENUNGGU INVOICE", "Pagu sudah dibuat, namun belum ada belanja masuk", "ALOKASI ANGGARAN AKTIF (Belum ada mutasi kas riil)", "Segera input nota belanja setelah transaksi pasar selesai", "Admin / Operator", "Kolom harga faktur & realisasi masih kosong"],
    // R36: Blank
    ["", "", "", "", "", ""],
    // R37: Section 4 Header
    ["4. PROTOKOL KEAMANAN INTEGRITAS DATA & SISTEM OTOMASI (SOP)", "", "", "", "", ""],
    // R38-R42: SOP Rows
    ["Aturan 1", "Dilarang Menghapus Rumus", "Tab 01, Tab 04 Col F, dan Tab 06 mengandalkan formula relasional otomatis. Jangan menimpa rumus dengan angka statis.", "Mencegah putusnya sinkronisasi buku kas otomatis.", "Semua Pengguna", "Dipantau oleh Delta Sync"],
    ["Aturan 2", "Pencatatan Lewat Bot", "Selalu utamakan pencatatan transaksi belanja melalui Telegram bot agar tercatat di audit trail & terhubung ke Google Drive.", "Menjaga bukti fisik nota tersimpan rapi untuk pemeriksaan BGN.", "Petugas Belanja", "Audit log tercatat di Tab Master"],
    ["Aturan 3", "Penghapusan Berjenjang", "Jika transaksi nota salah input, gunakan perintah 'hapus [ID]' di Telegram agar anak-anak rinciannya bersih otomatis.", "Mencegah adanya data transaksi yatim (orphan rows) di Tab 05.", "Admin Saja", "Mendukung Cascade Delete"],
    ["Aturan 4", "Sinkronisasi Real-Time", "Setiap kali ada pengeditan data di spreadsheet, Delta Sync Daemon bot mendeteksi perubahan dalam hitungan detik.", "Memastikan laporan margin di Telegram selalu mutakhir.", "Sistem Otomatis", "Berjalan 24/7 di background"],
  ];
}

/**
 * Builds styling batch requests for Tab 00_PANDUAN_OPERASIONAL
 */
export function createGuidelineTabStylingRequests(sheetId: number, rowCount = 42): sheets_v4.Schema$Request[] {
  return [
    // Unmerge previous merges in range
    {
      unmergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 6 },
      },
    },
    // Merge R1 (Banner Title)
    {
      mergeCells: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
        mergeType: "MERGE_ALL",
      },
    },
    // Format R1
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) },
            textFormat: { foregroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.WHITE) }, fontSize: 13, bold: true },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    // Merge R2 (Banner Subtitle)
    {
      mergeCells: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 6 },
        mergeType: "MERGE_ALL",
      },
    },
    // Format R2
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.EMBLEM_GOLD) },
            textFormat: { foregroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) }, fontSize: 10, bold: true },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    // Format Section 1 Header (R4)
    {
      mergeCells: {
        range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 6 },
        mergeType: "MERGE_ALL",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SLATE_DARK) },
            textFormat: { foregroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.WHITE) }, fontSize: 11, bold: true },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,verticalAlignment)",
      },
    },
    // Table 1 Header (R5)
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SOFT_SKY_BLUE) },
            textFormat: { foregroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) }, fontSize: 10, bold: true },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    // Section 2 Header (R13)
    {
      mergeCells: {
        range: { sheetId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: 0, endColumnIndex: 6 },
        mergeType: "MERGE_ALL",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 12, endRowIndex: 13, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SLATE_DARK) },
            textFormat: { foregroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.WHITE) }, fontSize: 11, bold: true },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,verticalAlignment)",
      },
    },
    // Table 2 Header (R14)
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 13, endRowIndex: 14, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SOFT_SKY_BLUE) },
            textFormat: { foregroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) }, fontSize: 10, bold: true },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    // Section 3 Header (R29)
    {
      mergeCells: {
        range: { sheetId, startRowIndex: 28, endRowIndex: 29, startColumnIndex: 0, endColumnIndex: 6 },
        mergeType: "MERGE_ALL",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 28, endRowIndex: 29, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SLATE_DARK) },
            textFormat: { foregroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.WHITE) }, fontSize: 11, bold: true },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,verticalAlignment)",
      },
    },
    // Table 3 Header (R30)
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 29, endRowIndex: 30, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SOFT_SKY_BLUE) },
            textFormat: { foregroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) }, fontSize: 10, bold: true },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    // Section 4 Header (R37)
    {
      mergeCells: {
        range: { sheetId, startRowIndex: 36, endRowIndex: 37, startColumnIndex: 0, endColumnIndex: 6 },
        mergeType: "MERGE_ALL",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 36, endRowIndex: 37, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SLATE_DARK) },
            textFormat: { foregroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.WHITE) }, fontSize: 11, bold: true },
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,verticalAlignment)",
      },
    },
    // Table 4 Header (R38)
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 37, endRowIndex: 38, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            backgroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.SOFT_SKY_BLUE) },
            textFormat: { foregroundColorStyle: { rgbColor: hexToRgbColor(BGN_PALETTE.DEEP_NAVY) }, fontSize: 10, bold: true },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    // Word wrap for all content
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 6 },
        cell: {
          userEnteredFormat: {
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat.wrapStrategy",
      },
    },
    // Column widths for optimal readability
    ...[
      { col: 0, width: 140 }, // A: Nomor Tab / Kategori / Status / Aturan
      { col: 1, width: 260 }, // B: Nama Tab / Contoh Pesan / Kriteria / SOP
      { col: 2, width: 320 }, // C: Sifat Data / Penjelasan Parameter / Dampak Finansial / SOP
      { col: 3, width: 340 }, // D: Fungsi / Dampak Sheets / Tindakan / Tujuan
      { col: 4, width: 160 }, // E: SOP Pengisian / Hak Akses / PIC
      { col: 5, width: 220 }, // F: Keterikatan Relasional / Status / Keterangan Sistem
    ].map((cw) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: cw.col, endIndex: cw.col + 1 },
        properties: { pixelSize: cw.width },
        fields: "pixelSize",
      },
    })),
    // Row heights for banners
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 42 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 28 },
        fields: "pixelSize",
      },
    },
  ];
}

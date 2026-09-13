# Design Specification: Filter & Total PO Dinamis pada Tab 06 (06_MARGIN) 📊

**Tanggal**: 13 September 2026  
**Status**: Approved by User  
**Target Repository**: `https://github.com/iza-aa/iza-sppg-agent`  
**Komponen Utama**: Google Sheets Engine, Recipes & Styling, Backend Synchronization Services

---

## 1. Executive Summary & Latar Belakang

Pada tab evaluasi **`06_MARGIN` (Perbandingan Margin SPPG)**, saat ini judul kolom terletak langsung di baris 1 (`A1:O1`) dan data transaksi rincian bahan dimulai pada baris 2 (`A2:O`).

Pengguna membutuhkan panel ringkasan eksekutif (*Executive Summary & Filter Bar*) tepat di atas tabel data dengan spesifikasi:
1. **Dropdown Filter PO Interaktif**: Terletak tepat di atas kolom Kuantitas (Kolom G), memungkinkan pengguna memilih `"SEMUA PO"` atau memilih salah satu nomor PO spesifik (`No SPPG Ref`).
2. **Auto-Populate (Daftar PO Otomatis Bertambah)**: Ketika bot atau pengguna mencatat PO baru di Tab 02 (`02_PENDAPATAN`), nomor PO baru tersebut otomatis muncul di pilihan dropdown Tab 06 tanpa konfigurasi manual.
3. **Baris Ringkasan Total & Efisiensi Real-Time**:
   - Di atas kolom Satuan (Kolom H) terdapat teks label **`TOTAL`**.
   - Di atas kolom Total Pendapatan (Kolom J) menghitung akumulasi pagu pendapatan.
   - Di atas kolom Total Realisasi (Kolom L) menghitung akumulasi belanja riil.
   - Di atas kolom Margin Bersih (Kolom M) menghitung selisih laba bersih (Rp).
   - Di atas kolom % Margin (Kolom N) menghitung persentase efisiensi margin.
   - Di atas kolom Status (Kolom O) menampilkan status kesehatan anggaran: **`🟢 HEMAT`**, **`🟢 PAS`**, atau **`🔴 OVER BUDGET`** (Sesuai Pilihan 1 yang disetujui).
4. **Pewarnaan Dinamis (Conditional Formatting)**: Margin Bersih dan % Margin memiliki indikator warna hijau (surplus) atau merah (defisit) selaras dengan baris data transaksi.

---

## 2. Struktur Grid & Tata Letak Tab 06

### 2.1 Konfigurasi Freeze Baris
Tab 06 akan memiliki **2 baris terkunci (`frozenRowCount: 2`)**:
- **Baris 1**: Panel Filter & Subtotal Ringkasan Eksekutif.
- **Baris 2**: Header Judul Kolom Tabel Transaksi (Kolom A s/d O).
- **Baris 3 ke bawah**: Baris data transaksi komparasi bahan baku.

### 2.2 Pemetaan Kolom Baris 1 (Header Ringkasan)

| Kolom | Huruf | Konten Baris 1 | Tipe Nilai / Formula | Format Tampilan |
| :--- | :---: | :--- | :--- | :--- |
| **No SPPG Ref s/d Uraian Bahan** | A s/d F | `EVALUASI MARGIN & ANGGARAN PO` | Teks Statis (B2:F2 atau A1:F1 Merged) | Bold, Navy/Slate Blue, Center |
| **Kuantitas** | G | Dropdown Pilihan PO | Data Validation: `='08_MASTER_DATA'!$E$2:$E` | Dropdown UI, Default: `"SEMUA PO"` |
| **Satuan** | H | `TOTAL` | Teks Statis | Bold, Center |
| **Harga Pendapatan** | I | `-` | Teks Statis | Center, Abu-abu |
| **Total Pendapatan** | J | Total Pagu PO terpilih | `=IF(OR($G$1=""; $G$1="SEMUA PO"); SUBTOTAL(109; J3:J); SUMIFS(J3:J; $A$3:$A; $G$1))` | Currency (`Rp#,##0`), Bold |
| **Harga Invoice** | K | `-` | Teks Statis | Center, Abu-abu |
| **Total Realisasi** | L | Total Belanja riil PO terpilih | `=IF(OR($G$1=""; $G$1="SEMUA PO"); SUBTOTAL(109; L3:L); SUMIFS(L3:L; $A$3:$A; $G$1))` | Currency (`Rp#,##0`), Bold |
| **Margin Bersih (Rp)** | M | Selisih Surplus/Defisit | `=J1-L1` | Currency (`Rp#,##0`), Bold + Color Format |
| **% Margin** | N | Rasio Efisiensi Margin | `=IF(J1>0; M1/J1; 0)` | Percentage (`0.00%`), Bold + Color Format |
| **Status Evaluasi** | O | Badge Evaluasi Anggaran | `=IF(J1=0; "-"; IF(M1>0; "🟢 HEMAT"; IF(M1=0; "🟢 PAS"; "🔴 OVER BUDGET")))` | Center, Bold, Dynamic Badge |

### 2.3 Pemetaan Kolom Baris 2 (Header Kolom Tabel)
Baris 2 memuat 15 header kolom resmi:
`['No SPPG Ref', 'ID Pendapatan', 'ID Pengeluaran', 'Tanggal', 'Nama Supplier', 'Uraian Bahan', 'Kuantitas', 'Satuan', 'Harga Pendapatan', 'Total Pendapatan', 'Harga Invoice', 'Total Realisasi', 'Margin Bersih (Rp)', '% Margin', 'Status']`

---

## 3. Desain Data Validation & Auto-Populate PO

Agar daftar nomor PO di dropdown G1 selalu termutakhirkan secara otomatis setiap kali ada data baru, lembar `08_MASTER_DATA` akan ditambahkan formula dinamis pada **Kolom E**:

* **Sel E1**: Header `DAFTAR PO SISTEM`
* **Sel E2**: `"SEMUA PO"` (opsi default untuk melihat grand total)
* **Sel E3**: Formula filter unik dinamis:
  ```excel
  =IFERROR(SORT(UNIQUE(FILTER('02_PENDAPATAN'!A2:A; '02_PENDAPATAN'!A2:A<>""))); "")
  ```
* **Koneksi Validasi Sel G1 di Tab 06**:
  - Tipe Validasi: `ONE_OF_RANGE`
  - Rentang Target: `'08_MASTER_DATA'!$E$2:$E`
  - Strict: `true`
  - ShowCustomUi: `true` (menampilkan dropdown panah ke bawah)

---

## 4. Desain Styling & Conditional Formatting

1. **Baris 1 Styling**:
   - Background Color: Slate Light / Soft Cool Gray (`#F1F5F9`) dengan border bawah ganda (*double bottom border*) untuk memisahkan panel ringkasan dengan header kolom.
   - Text Formatting: Font size 10pt, Semi-bold/Bold, Navy Theme (`#0F2042`).
2. **Conditional Formatting pada Sel M1, N1, O1**:
   - **Kondisi Hijau (Surplus / Hemat)**:
     - Rule: Nilai sel `> 0`
     - Background: Soft Emerald (`#DCFCE7`), Teks: Dark Green (`#166534`).
   - **Kondisi Merah (Defisit / Over Budget)**:
     - Rule: Nilai sel `< 0`
     - Background: Soft Rose (`#FEE2E2`), Teks: Dark Red (`#991B1B`).
   - **Kondisi Netral (Sesuai Pagu / Pas)**:
     - Rule: Nilai sel `= 0`
     - Background: Soft Amber/Neutral Gray (`#FEF3C7`), Teks: Dark Bronze (`#92400E`).

---

## 5. Dampak Row Offset & Penyelarasan Kode Backend (Zero-Regression)

Karena data rincian di Tab 06 bergeser dari Baris 2 ke **Baris 3**, seluruh modul backend yang mengakses Tab 06 akan diselaraskan:

### 5.1 `src/core/google/recipes/operational-dashboard.recipe.ts`
- Menyediakan baris nilai untuk Tab 06:
  - Row 1: Nilai dan formula ringkasan eksekutif.
  - Row 2: 15 Header kolom.
- Memperbarui `tabPerbandinganMarginHeaders` agar mengembalikan `[rowSummaryValues, rowColumnHeaderValues]`.

### 5.2 `src/core/google/recipes/styling.ts`
- Memperbarui properti `SHEET_IDS.PERBANDINGAN_MARGIN`:
  - `frozenRowCount: 2` (sebelumnya `1`).
- Menambahkan request `setDataValidation` untuk sel `G1` (SheetId `PERBANDINGAN_MARGIN`, `startRowIndex: 0, endRowIndex: 1, startColumnIndex: 6, endColumnIndex: 7`).
- Menambahkan formatting font, alignment, number formats, dan conditional formatting untuk Baris 1 (Row Index 0).

### 5.3 `src/core/google/services/sheets-client.provider.ts`
- Pada proses inisialisasi sheet (`initializeSpreadsheetStructure` dan `formatExistingSpreadsheet`):
  - Mengirim data header ke range `'${SHEET_NAMES.MARGIN}'!A1:O2`.
  - Menginisialisasi Kolom E di `08_MASTER_DATA` dengan formula daftar PO dinamis.

### 5.4 `src/core/google/services/pagu-sheets.service.ts`
- Pada penambahan bahan ke Tab 06 (`appendRowsSafely` / `insertRow`):
  - Verifikasi baris terakhir: Jika sheet kosong atau hanya ada header, target baris pertama data adalah Baris 3.
  - Saat mencari lokasi baris PO untuk disisipkan, pastikan pencarian data dimulai dari Baris 3 (`A3:A`).
  - Formula status baris rincian: Menyesuaikan referensi baris `=IF(M${actualRow}>0; ...)` di mana `actualRow` dihitung berbasis Baris 3+.

### 5.5 `src/core/google/services/expense-sheets.service.ts`
- Pada pembacaan Tab 06 untuk pencocokan transaksi:
  - Range `A2:O` diperbarui menjadi `A3:O`.
  - Offset pembacaan `rIdx` disesuaikan (`const actualRow = rIdx + 3` saat membaca dari `A3:O`, atau `rIdx + 1` saat membaca `A:O` dengan mengabaikan 2 baris pertama).
- Pembaruan status rekonsiliasi ke kolom K, L, M, N, O tetap akurat pada baris transaksi yang bersangkutan.

### 5.6 `src/core/google/services/margin-sheets.service.ts`
- `getPaguCandidatesForCommodity`:
  - Range pembacaan: `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A3:O`.
  - Perhitungan indeks baris: `rowIndex: rIdx + 3` (sebelumnya `rIdx + 2`).

### 5.7 `src/core/sync/delta-sync.daemon.ts`
- Pada deteksi perubahan langsung (direct edit) di Tab 06:
  - Mengabaikan baris 1 (Panel Ringkasan Total) dan baris 2 (Header Kolom) agar tidak disalahartikan sebagai perubahan baris data transaksi.

---

## 6. Rencana Verifikasi (Testing Plan)

1. **Uji Kompilasi TypeScript**:
   - `npm run build` berhasil tanpa type error.
2. **Uji Formula & Layout Google Sheets**:
   - Verifikasi bahwa struktur tab terinisialisasi dengan benar:
     - Baris 1: Banner ringkasan, dropdown G1, teks TOTAL di H1, formula di J1, L1, M1, N1, O1.
     - Baris 2: 15 Header kolom.
     - Baris 3: Data transaksi pertama.
   - Verifikasi dropdown `PILIH PO`: Menampilkan `"SEMUA PO"` dan nomor-nomor PO dari `02_PENDAPATAN`.
   - Verifikasi kalkulasi formula:
     - Saat memilih `"SEMUA PO"`: J1 menjumlahkan seluruh `J3:J`, L1 menjumlahkan seluruh `L3:L`, M1 = `J1-L1`, N1 = `M1/J1`.
     - Saat memilih salah satu PO (misal `PO-001`): J1 dan L1 hanya menjumlahkan baris yang memiliki `No SPPG Ref` = `PO-001`.
   - Verifikasi conditional formatting: Sel M1, N1, dan O1 berubah warna hijau saat surplus dan merah saat defisit.
3. **Uji Regresi Operasional Bot**:
   - Pencatatan Pagu baru via bot: Data bahan terinput mulai dari baris 3 dan tersinkronisasi ke Tab 02, 03, dan 06.
   - Pencatatan Belanja via bot: Rekonsiliasi invoice pada Tab 06 masuk tepat pada baris bahan yang dituju tanpa merusak Baris 1 atau 2.
   - Delta Sync Daemon: Berjalan mulus tanpa memicu false-alert pada Baris 1 atau 2.

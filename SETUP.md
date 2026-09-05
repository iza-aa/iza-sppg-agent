# 🛠️ Panduan Setup & Deployment: MBG Assistant (BGN)

Dokumen ini berisi panduan lengkap langkah-demi-langkah untuk menyiapkan, mengonfigurasi, dan mendeploy sistem asisten operasional **Makanan Bergizi Gratis (MBG)** di bawah naungan **Badan Gizi Nasional (BGN)**.

---

## 📌 Daftar Komponen & Arsitektur

| Komponen | Layanan / Provider | Fungsi |
|---|---|---|
| **Bot Messaging** | Telegram API (Grammy) | Antarmuka interaktif Ayah/Operator lapangan |
| **Penyimpanan Data Riil** | Google Sheets API v4 | Lembar kerja 5-Tab Hybrid (Plafon vs Riil) |
| **Media Vault (Foto)** | Google Drive API v3 | Arsip foto WebP 80% hemat penyimpanan |
| **State Machine & Whitelist**| Supabase PostgreSQL | Pencegah duplikasi data & otorisasi user |
| **AI Multimodal Parser** | Google Gemini 2.5 / 2.0 Flash | Ekstraksi 20+ bahan nota SPPG & bon suplier |
| **Laporan Resmi SPJ** | PDFKit | Cetak PDF resmi berstandar Badan Gizi Nasional |
| **24/7 Hosting** | Koyeb Cloud | Container Linux 24/7 tanpa timeout serverless |

---

## Langkah 1: Migrasi Database Supabase

1. Buka dashboard proyek Supabase Anda di browser: [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Pilih proyek Anda, lalu klik menu **SQL Editor** di bilah sisi kiri.
3. Buka file [supabase/migrations/20260904_initial_sppg_schema.sql](supabase/migrations/20260904_initial_sppg_schema.sql) di repositori ini, salin seluruh kodenya, dan tempelkan ke SQL Editor Supabase.
4. Klik **Run** (Jalankan).
   - Seluruh tabel (`sppg_users`, `pending_agent_actions`, `sppg_orders`, `sppg_order_items`, `sppg_supplier_expenses`, `sppg_heartbeat`), indeks, dan trigger keamanan akan dibuat secara otomatis.
5. **Daftarkan Telegram ID Pengguna (Whitelist):**
   Jalankan query SQL berikut untuk mendaftarkan akun Telegram Anda dan Ayah:
   ```sql
   INSERT INTO sppg_users (telegram_user_id, full_name, role)
   VALUES
     (123456789, 'Ayah (Operator Utama)', 'ADMIN'),
     (987654321, 'Iza (Super Admin)', 'SUPERADMIN')
   ON CONFLICT (telegram_user_id) DO NOTHING;
   ```
   *(Ganti `123456789` dengan Telegram User ID yang sebenarnya. User ID dapat dicek di Telegram via bot `@userinfobot`).*

---

## Langkah 2: Hak Akses Google Drive & Service Account

1. Email Google Cloud Service Account yang digunakan:
   `mbg-service-bot@mbg-assistant.iam.gserviceaccount.com`
2. Buka folder root Google Drive **`mbg-assistant`**:
   [https://drive.google.com/drive/folders/1T6iFdrOj7_y8XJiQ941KTmDkOfhwfHeR](https://drive.google.com/drive/folders/1T6iFdrOj7_y8XJiQ941KTmDkOfhwfHeR)
3. Klik tombol **Share (Bagikan)** pada folder tersebut.
4. Masukkan email: `mbg-service-bot@mbg-assistant.iam.gserviceaccount.com`, pilih peran **Editor**, lalu klik **Kirim / Selesai**.
5. **Penting (Pewarisan Izin):**
   Karena 4 Google Spreadsheet berada di dalam folder root ini, semua spreadsheet secara otomatis mewarisi hak akses Editor:
   - `MBG - Master Dashboard`: `1Bjxue57nLpH-nrwXxH2uh-CZoPWTK_JKZ5YMWgwZSbM`
   - `MBG - SPPG Patila`: `1kOOZVfc2m6aYylhDJNi1lRh2_UWLgU540FJ7fwROLPA`
   - `MBG - SPPG 2`: `1uh5ULDa6ZcFU5fKPm9yfu_lUqP1y6yNJswr1NhkC4IY`
   - `MBG - SPPG 3`: `1-YbHkTZQeeZ5KCRKq4GXES9ApqRUNlXhe0zgi_LnEII`

---

## Langkah 3: Pemasangan Google Apps Script (`kode.gs`)

Agar spreadsheet memiliki menu kustom BGN, fitur auto-lock bulan lalu, dan styling otomatis:
1. Buka masing-masing spreadsheet di browser (misal: SPPG Patila).
2. Klik menu **Ekstensi (Extensions)** -> **Apps Script**.
3. Hapus kode bawaan `function myFunction()`, lalu tempelkan seluruh kode dari:
   [google-apps-script/kode.gs](google-apps-script/kode.gs)
4. Klik tombol **Simpan (Save / 💾)** di bagian atas editor Apps Script.
5. Muat ulang (*refresh*) halaman Google Sheets Anda.
6. Menu baru **`[⚡ MENU KELOLA SPPG]`** akan muncul di baris menu atas dengan tombol:
   - 🎨 **Terapkan Format Standar BGN**
   - 🔒 **Kunci Data Bulan Lalu (Proteksi SPJ)**
   - 📦 **Arsipkan Data Tahunan**
   - ℹ️ **Informasi Versi Sistem**

---

## Langkah 4: Deployment 24/7 di Koyeb Cloud

Sistem ini didesain untuk berjalan sebagai *background worker* 24/7 tanpa batas waktu eksekusi (*timeout*) dan tanpa *cold start*.

1. Buat akun atau login di [https://app.koyeb.com](https://app.koyeb.com).
2. Klik **Create App** -> pilih **GitHub**.
3. Pilih repositori: `iza-aa/iza-sppg-agent` (Branch: `main`).
4. **Builder Configuration:**
   - Builder: **Dockerfile** (otomatis terdeteksi dari repositori).
5. **Service Type:**
   - Pilih **Worker** (karena bot menggunakan *Telegram Long Polling*, tidak memerlukan port HTTP publik yang rentan spam).
6. **Environment Variables:**
   Masukkan variabel-variabel berikut di halaman Koyeb:

   | Variabel | Nilai / Contoh |
   |---|---|
   | `NODE_ENV` | `production` |
   | `LOG_LEVEL` | `info` |
   | `TELEGRAM_BOT_TOKEN_PATILA` | `8941228271:AAE3tjTjgIm00V9cPLezev_8rkpMiKAMqL4` |
   | `TELEGRAM_BOT_TOKEN_UNIT2` | `8832930054:AAEAQncT1G8vR9VKVZOIe3Wrb-ck3IYj418` |
   | `TELEGRAM_BOT_TOKEN_UNIT3` | `8973187995:AAGnFfyk97tiuHfdGtFxeFNwRXeiQOo--2c` |
   | `GOOGLE_DRIVE_FOLDER_ID` | `1T6iFdrOj7_y8XJiQ941KTmDkOfhwfHeR` |
   | `GOOGLE_SHEET_ID_MASTER` | `1Bjxue57nLpH-nrwXxH2uh-CZoPWTK_JKZ5YMWgwZSbM` |
   | `GOOGLE_SHEET_ID_PATILA` | `1kOOZVfc2m6aYylhDJNi1lRh2_UWLgU540FJ7fwROLPA` |
   | `GOOGLE_SHEET_ID_UNIT2` | `1uh5ULDa6ZcFU5fKPm9yfu_lUqP1y6yNJswr1NhkC4IY` |
   | `GOOGLE_SHEET_ID_UNIT3` | `1-YbHkTZQeeZ5KCRKq4GXES9ApqRUNlXhe0zgi_LnEII` |
   | `GEMINI_API_KEYS` | Salin kunci Gemini API Anda (pisahkan koma jika lebih dari 1) |
   | `SUPABASE_URL` | URL project Supabase Anda (`https://xxx.supabase.co`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Kunci `service_role` Supabase |
   | `GOOGLE_SERVICE_ACCOUNT_BASE64` | String base64 dari `service-account.json` *(lihat cara di bawah)* |

7. **Cara Menghasilkan `GOOGLE_SERVICE_ACCOUNT_BASE64`:**
   Jalankan perintah ini di terminal komputer Anda:
   ```bash
   base64 -i service-account.json
   ```
   Salin teks output panjang tersebut dan tempelkan ke variabel `GOOGLE_SERVICE_ACCOUNT_BASE64` di Koyeb. Aplikasi akan secara otomatis me-materialisasi file `service-account.json` saat kontainer booting!
8. Klik tombol **Deploy**. Koyeb akan mengompilasi Docker image dan menjalankan Supervisor.

---

## Langkah 5: Menjalankan Secara Lokal (Development)

Jika Anda ingin menjalankan bot di komputer lokal (Mac/Linux):
```bash
# 1. Pastikan dependensi terpasang
npm install

# 2. Jalankan seluruh unit testing
npm test

# 3. Jalankan bot dalam mode pengembangan (Supervisor mengawasi semua unit)
npm run dev

# Atau jalankan hanya unit Patila secara terisolasi:
npm run worker sppg_patila
```

---

## 🔒 Keamanan & Praktik Terbaik
- **Zero Secrets in Git**: File `.env` dan `service-account.json` wajib berada di `.gitignore`. Jangan pernah mengunggah kredensial ke GitHub.
- **Fault-Isolation**: Setiap bot SPPG berjalan pada proses worker terpisah. Jika ada kendala jaringan pada Bot 2, Bot Patila tetap melayani Ayah tanpa gangguan.
- **Keep-Warm Scheduler**: Supervisor menjalankan ping otomatis setiap 12 jam ke tabel `sppg_heartbeat` di Supabase agar proyek Supabase gratis tidak dinonaktifkan (*auto-pause*).

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
| **AI Multimodal Parser** | Google Gemini 2.5 / 2.0 Flash + agy CLI | Ekstraksi 20+ bahan nota SPPG & bon suplier |
| **Laporan Resmi SPJ** | PDFKit | Cetak PDF resmi berstandar Badan Gizi Nasional |
| **24/7 Production Hosting** | Linux Cloud VPS (PM2) / Render (Docker) | Menjalankan Supervisor & Multi-Bot 24/7 |

---

## Langkah 1: Migrasi Database Supabase

1. Buka dashboard proyek Supabase Anda di browser: [https://supabase.com/dashboard](https://supabase.com/dashboard).
2. Pilih proyek Anda, lalu klik menu **SQL Editor** di bilah sisi kiri.
3. Buka file [supabase/migrations/20260904_initial_sppg_schema.sql](supabase/migrations/20260904_initial_sppg_schema.sql) di repositori ini, salin seluruh kodenya, dan tempelkan ke SQL Editor Supabase.
4. Klik **Run** (Jalankan).
   - Seluruh tabel (`sppg_users`, `sppg_pending_actions`, `sppg_orders`, `sppg_order_items`, `sppg_supplier_expenses`, `sppg_heartbeat`, `sppg_invites`), indeks, dan trigger keamanan akan dibuat secara otomatis.
5. **Daftarkan Telegram ID Pengguna (Whitelist):**
   Jalankan query SQL berikut untuk mendaftarkan akun Telegram Anda dan Ayah:
   ```sql
   INSERT INTO sppg_users (id, first_name, role, status)
   VALUES
     (7546537134, 'Heizaaa', 'super_admin', 'active'),
     (7591684041, 'Ayah', 'admin', 'active')
   ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;
   ```
   *(Atau gunakan perintah instan `/invite Ayah admin` dari Telegram Super Admin untuk membuat link undangan otomatis tanpa buka SQL).*

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

## Langkah 4: Deployment Produksi 24/7

### Opsi A: Deployment di Linux Cloud VPS (PM2) — [Teruji & Aktif]

Menjalankan `mbg-assistant` di server Ubuntu bersama `wa-agent` dengan konsumsi RAM ultra-ringan (~140 MB).

1. **Kompilasi TypeScript di Lokal (Mac):**
   ```bash
   npm run build
   ```
2. **Sinkronisasi Kode ke Server VPS:**
   ```bash
   scp -i ~/Downloads/iza-key.pem -r dist package.json package-lock.json .env service-account.json heizaaa@103.150.191.121:~/mbg-assistant/
   ```
3. **Jalankan via PM2 di VPS:**
   ```bash
   ssh -i ~/Downloads/iza-key.pem heizaaa@103.150.191.121
   cd ~/mbg-assistant
   npm install --omit=dev
   pm2 start dist/supervisor.js --name mbg-assistant
   pm2 save
   ```
4. **Verifikasi Status & Health Endpoint:**
   ```bash
   pm2 status
   curl http://localhost:8080/health
   ```

### Opsi B: Deployment di Container / Render.com (Docker)

1. Buat **Web Service** baru di dashboard Render.com.
2. Hubungkan repositori GitHub `iza-aa/iza-sppg-agent`.
3. Pilih Environment: **Docker** (Render otomatis membaca [Dockerfile](Dockerfile)).
4. Konfigurasikan Environment Variables sesuai daftar di `.env.example`.
5. Port HTTP: `8080` (Otomatis melayani `/health` dan `/ping` untuk health-check probe).

---

## Langkah 5: Menjalankan Secara Lokal (Development)

Jika Anda ingin menjalankan bot di komputer lokal (Mac/Linux):
```bash
# 1. Pastikan dependensi terpasang
npm install

# 2. Jalankan seluruh unit testing (8 test suites)
npm test

# 3. Jalankan bot dalam mode pengembangan (Supervisor mengawasi semua unit)
npm run dev

# Atau jalankan hanya unit Patila secara terisolasi:
npm run worker sppg_patila
```

---

## 🔒 Keamanan & Praktik Terbaik
- **Zero Secrets in Git**: File `.env` dan `service-account.json` wajib berada di `.gitignore`. Jangan pernah mengunggah kredensial ke GitHub.
- **Fault-Isolation**: Setiap bot SPPG memiliki error boundary terisolasi. Jika satu bot mengalami gangguan jaringan, bot lainnya tetap melayani Ayah tanpa interupsi.
- **Keep-Warm Scheduler**: Supervisor menjalankan ping otomatis setiap 12 jam ke tabel `sppg_heartbeat` di Supabase agar database tetap aktif 24/7.

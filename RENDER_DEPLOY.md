# Panduan Deploy Render.com 24/7 (Free Tier 512 MB RAM) 🚀

Panduan langkah-demi-langkah untuk mendeploy bot **MBG Assistant (Badan Gizi Nasional)** ke **Render.com** secara gratis dan berjalan aktif 24 jam sehari, 7 hari seminggu tanpa risiko *Out-of-Memory (OOM)* maupun *sleep/suspend*.

---

## 📋 Fitur Arsitektur Low-RAM yang Terpasang
- **Single-Process Multi-Bot Engine:** Seluruh bot unit SPPG (`@sppg1bot`, `@sppg2bot`, `@sppg3bot`) berjalan dalam 1 event loop terisolasi. Baseline RAM hanya **~45–55 MB** (menghemat 115 MB RAM, menyisakan ruang lega >400 MB).
- **Instant Port Binding (Port 8080):** Server HTTP native langsung menyala di milidetik pertama, sehingga pemeriksaan port (*Port Check*) Render langsung **PASS dalam < 1 detik**.
- **Sharp Zero-Cache:** Cache memori C++ native (`libvips`) dimatikan total (`sharp.cache(false)`) sehingga setiap gambar nota selesai diproses langsung dibebaskan dari RAM.
- **V8 Safety Throttling:** Batas memori JS dipasang di `--max-old-space-size=350`, menjamin memori stabil tanpa membebani CPU dengan *GC thrashing*.
- **Keep-Warm Endpoint:** Endpoint `/ping` dan `/health` siap dipanggil otomatis agar bot tidak pernah tertidur (*zero sleep*).

---

## 🛠️ Langkah 1: Salin String Base64 Google Service Account

Karena file `service-account.json` bersifat rahasia dan tidak boleh di-commit ke GitHub publik, sistem telah dirancang untuk membaca string **Base64** secara otomatis dari Environment Variable.

Jalankan perintah berikut di terminal Mac Anda (dari folder project `mbg-assistant`):
```bash
base64 -i service-account.json | tr -d '\n' | pbcopy
```
> [!TIP]
> Perintah di atas akan langsung menyalin seluruh isi `service-account.json` dalam format Base64 ke clipboard (copy) Mac Anda. Simpan string ini untuk Langkah 3.

---

## 🌐 Langkah 2: Buat Web Service Baru di Render.com

1. Buka [Dashboard Render](https://dashboard.render.com/) dan login menggunakan akun **GitHub** Anda.
2. Klik tombol **New +** di pojok kanan atas, lalu pilih **Web Service**.
3. Pilih opsi **"Build and deploy from a Git repository"**, lalu klik **Next**.
4. Hubungkan repositori GitHub Anda: cari dan pilih **`iza-aa/iza-sppg-agent`**.
5. Isi konfigurasi dasar berikut:
   * **Name**: `mbg-assistant` (atau nama pilihan Anda)
   * **Region**: `Singapore (Southeast Asia)` *(Paling cepat dan rendah latensi untuk Indonesia)*
   * **Branch**: `main`
   * **Root Directory**: *(Biarkan kosong)*
   * **Runtime**: **`Docker`** *(Render akan otomatis membaca Dockerfile multi-stage kita)*
   * **Instance Type**: **`Free`** (0.1 CPU, 512 MB RAM)

---

## 🔐 Langkah 3: Konfigurasi Environment Variables

Gulir ke bawah ke bagian **Environment Variables**, lalu masukkan variabel-variabel berikut (klik *Add Environment Variable*):

| Key | Value / Keterangan |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `EXECUTION_MODE` | `single` |
| `LOG_LEVEL` | `info` |
| `TELEGRAM_SUPER_ADMIN_ID` | `7546537134` |
| `TELEGRAM_ADMIN_IDS` | `7546537134,7591684041` |
| `TELEGRAM_BOT_TOKEN_PATILA` | `8941228271:AAE3tjTjgIm00V9cPLezev_8rkpMiKAMqL4` |
| `TELEGRAM_BOT_TOKEN_UNIT2` | `8832930054:AAEAQncT1G8vR9VKVZOIe3Wrb-ck3IYj418` |
| `TELEGRAM_BOT_TOKEN_UNIT3` | `8973187995:AAGnFfyk97tiuHfdGtFxeFNwRXeiQOo--2c` |
| `SUPABASE_URL` | `https://ikqlyniyyfdtlyfdkmmv.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | *(Paste Service Role Key Supabase Anda)* |
| `GOOGLE_DRIVE_FOLDER_ID` | `1T6iFdrOj7_y8XJiQ941KTmDkOfhwfHeR` |
| `SPREADSHEET_ID_PATILA` | `1kOOZVfc2m6aYylhDJNi1lRh2_UWLgU540FJ7fwROLPA` |
| `SPREADSHEET_ID_UNIT2` | `1uh5ULDa6ZcFU5fKPm9yfu_lUqP1y6yNJswr1NhkC4IY` |
| `SPREADSHEET_ID_UNIT3` | `1-YbHkTZQeeZ5KCRKq4GXES9ApqRUNlXhe0zgi_LnEII` |
| `SPREADSHEET_ID_MASTER` | `1Bjxue57nLpH-nrwXxH2uh-CZoPWTK_JKZ5YMWgwZSbM` |
| `GOOGLE_SERVICE_ACCOUNT_BASE64` | *(Paste string Base64 yang sudah Anda copy di Langkah 1)* |
| `GEMINI_API_KEYS` | *(Daftar Gemini API Key Anda, dipisahkan koma)* |

---

## 🚀 Langkah 4: Deploy & Periksa Log

1. Klik tombol **Deploy Web Service**.
2. Render akan mengunduh repositori, menjalankan build Docker multi-stage, dan mengeksekusi container.
3. Di tab **Logs**, Anda akan melihat pesan:
   ```text
   ⚡ [HTTP Server] Health & Keep-Warm listener active on port 8080
   🍽️  MBG ASSISTANT - MASTER SUPERVISOR STARTING
   Execution Mode: [SINGLE]
   Found 3 enabled SPPG units.
   ✅ [Single Mode] SPPG Patila active as @sppg1bot
   ✅ [Single Mode] SPPG Unit 2 active as @sppg2bot
   ✅ [Single Mode] SPPG Unit 3 active as @sppg3bot
   ```
4. Render akan memberikan URL publik untuk service Anda, contoh: `https://mbg-assistant.onrender.com`.

---

## ⏰ Langkah 5: Setup Keep-Warm 24/7 Gratis (Cron-job.org)

Render Free Tier akan otomatis tidur (*sleep*) jika tidak ada request masuk selama 15 menit. Agar bot aktif **24 jam nonstop**, gunakan cron job eksternal gratis:

1. Buka [https://cron-job.org/](https://cron-job.org/) dan buat akun gratis (atau login).
2. Di dashboard, klik **Create Cronjob**.
3. Isi kolom berikut:
   * **Title**: `MBG Bot Keep-Alive`
   * **URL**: `https://<nama-service-anda>.onrender.com/ping`
   * **Execution schedule**: Pilih **Every 10 minutes** (`*/10 * * * *`).
   * **Request method**: `GET`
4. Klik **Create**.

> [!NOTE]
> Ping setiap 10 menit ini hanya memicu respon teks ringan `"PONG"` (< 10 milidetik), mengonsumsi 0 bandwidth, dan menjaga container Render tetap bangun 24/7. Karena akun Render Anda hanya menjalankan 1 service tunggal ini, kuota 750 jam/bulan gratis tidak akan pernah kehabisan.

---

## 📊 Langkah 6: Pemantauan RAM & Status Real-time

Anda bisa memeriksa kondisi memori dan status bot kapan saja langsung dari browser HP atau laptop dengan membuka:
`https://<nama-service-anda>.onrender.com/health`

Contoh response JSON:
```json
{
  "status": "ok",
  "service": "mbg-assistant",
  "mode": "single",
  "active_units": [
    "sppg_patila",
    "sppg_unit2",
    "sppg_unit3"
  ],
  "uptime_seconds": 3600,
  "memory": {
    "rss_mb": 52.4,
    "heap_used_mb": 18.2,
    "heap_total_mb": 26.5,
    "external_mb": 4.1
  },
  "timestamp": "2026-09-05T08:00:00.000Z"
}
```
*Jika `rss_mb` menunjukkan ~50–70 MB, berarti pemakaian memori Anda hanya ~10–13% dari kapasitas 512 MB (Sangat Dingin & Aman).*

# MBG Assistant - Maintenance & Operations Scripts

Direktori ini berisi skrip utilitas operasional dan migration untuk asisten MBG SPPG.

## 🚀 Skrip Operasional Aktif

| Skrip | Deskripsi | Perintah |
|---|---|---|
| `setup-all-units-5tabs.ts` | Inisialisasi struktur 5-tab standar pada spreadsheet semua unit SPPG | `npx tsx scripts/setup-all-units-5tabs.ts` |
| `execute-migration-6tabs.ts` | Migrasi spreadsheet ke format relasional 6-tab | `npx tsx scripts/execute-migration-6tabs.ts` |
| `seed-dummy-supabase.ts` | Seeding data awal akun pengguna dan draf ke Supabase | `npx tsx scripts/seed-dummy-supabase.ts` |
| `seed-dummy-spreadsheet.ts` | Seeding data simulasi transaksi ke Google Sheets | `npx tsx scripts/seed-dummy-spreadsheet.ts` |

## 📦 Arsip (`scripts/archive/`)
Berisi skrip-skrip inspeksi ad-hoc, diagnosis banding/validasi, dan script testing lokal historis yang telah selesai digunakan selama tahap investigasi.

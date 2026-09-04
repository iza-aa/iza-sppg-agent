# IZA SPPG MBG Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun asisten Telegram operasional multi-bot untuk vendor Makanan Bergizi Gratis (MBG) terintegrasi dengan Google Sheets (Arsitektur 5-Tab Hybrid), Google Drive Media Vault (WebP 80%), Supabase, `agy CLI`, dan Gemini Vision, dengan pemisahan Nota Pesanan SPPG (Pendapatan/Plafon) dan Invoice Supplier (Pengeluaran), otomatisasi Apps Script (`kode.gs`), ekspor laporan resmi PDF bertema Badan Gizi Nasional (BGN), serta siap deploy ke **Koyeb Cloud** (Docker 24/7).

**Architecture:** Hybrid Master Supervisor & Micro-Workers dengan isolasi proses (3 bot Telegram berjalan di child-process terpisah agar jika satu bot error, bot lainnya tidak terganggu). Menggunakan shared core services untuk AI extraction, kompresi foto WebP, sinkronisasi Google Sheets 5-tab, dan Supabase PostgreSQL.

**Tech Stack:** Node.js 22 LTS, TypeScript, Grammy (Telegram Bot), `@google/generative-ai`, `googleapis`, `sharp`, `pdfkit`, `@supabase/supabase-js`, `zod`, `vitest`, Docker (Koyeb Deploy).

**Spec:** [`docs/superpowers/specs/2026-09-04-sppg-mbg-assistant-design.md`](file:///Users/heizaaa/Desktop/cdev/mbg-assistant/docs/superpowers/specs/2026-09-04-sppg-mbg-assistant-design.md)

## Verified Project Identifiers & Credentials
- **Target Repository**: `https://github.com/iza-aa/iza-sppg-agent`
- **Google Service Account**: `mbg-service-bot@mbg-assistant.iam.gserviceaccount.com`
- **Google Drive Root Folder**: `1T6iFdrOj7_y8XJiQ941KTmDkOfhwfHeR` (`mbg-assistant`)
- **Google Spreadsheets**:
  1. `MBG - SPPG Patila`: `1kOOZVfc2m6aYylhDJNi1lRh2_UWLgU540FJ7fwROLPA`
  2. `MBG - SPPG 2`: `1uh5ULDa6ZcFU5fKPm9yfu_lUqP1y6yNJswr1NhkC4IY`
  3. `MBG - SPPG 3`: `1-YbHkTZQeeZ5KCRKq4GXES9ApqRUNlXhe0zgi_LnEII`
  4. `MBG - Master Dashboard`: `1Bjxue57nLpH-nrwXxH2uh-CZoPWTK_JKZ5YMWgwZSbM`
- **Telegram Bot Tokens**:
  - Bot 1 (SPPG Patila): `8941228271:AAE3tjTjgIm00V9cPLezev_8rkpMiKAMqL4`
  - Bot 2 (SPPG Unit 2): `8832930054:AAEAQncT1G8vR9VKVZOIe3Wrb-ck3IYj418`
  - Bot 3 (SPPG Unit 3): `8973187995:AAGnFfyk97tiuHfdGtFxeFNwRXeiQOo--2c`

---

### Task 1: Project Scaffolding & Configuration Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `src/config/env.ts`
- Create: `src/config/sppg.config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `sppgConfigs: SPPGUnitConfig[]`, `env: AppEnv`

- [ ] **Step 1: Create package.json with dependencies (grammy, googleapis, sharp, pdfkit, supabase, zod, vitest)**
- [ ] **Step 2: Create tsconfig.json (ESM NodeNext) and vitest.config.ts**
- [ ] **Step 3: Create .env.example with verified Spreadsheet IDs and Drive Root Folder ID**
- [ ] **Step 4: Implement src/config/env.ts and src/config/sppg.config.ts supporting multi-bot mapping**
- [ ] **Step 5: Write unit test in tests/config.test.ts verifying environment and SPPG config loader**
- [ ] **Step 6: Run tests and commit Task 1**

---

### Task 2: Core AI Multimodal Engine & Dual Document Parsers

**Files:**
- Create: `src/core/ai/gemini-client.ts`
- Create: `src/core/ai/agy-connector.ts`
- Create: `src/core/ai/schemas/sppg-order.schema.ts`
- Create: `src/core/ai/schemas/supplier-receipt.schema.ts`
- Create: `src/core/ai/parsers/sppg-order.parser.ts`
- Create: `src/core/ai/parsers/supplier-receipt.parser.ts`
- Test: `tests/ai-parsers.test.ts`

**Interfaces:**
- Consumes: `gemini-client.ts` multi-key pool, `agy-connector.ts` subprocess
- Produces: `parseSppgOrder(imageBuffer, mimeType): Promise<ExtractedSppgOrder>`, `parseSupplierReceipt(imageBuffer, mimeType): Promise<ExtractedSupplierReceipt>`

- [ ] **Step 1: Implement multi-key pool and nested model fallback loop in gemini-client.ts**
- [ ] **Step 2: Implement agy CLI connector with dynamic path discovery, dynamic model routing (High/Low), and 3-tier regex JSON fallback in agy-connector.ts**
- [ ] **Step 3: Define Zod schemas for Nota Pesanan SPPG (Pendapatan/Plafon) and Kwitansi Supplier (Pengeluaran Riil)**
- [ ] **Step 4: Implement deterministic CPU sum check and Indonesian unit extraction (`ekor`, `jerigen`, `kg`, `liter`, `ikat`, `keranjang`)**
- [ ] **Step 5: Write unit tests in tests/ai-parsers.test.ts verifying calculations (22 items totaling Rp 29.581.000 from SPPG Patila order)**
- [ ] **Step 6: Run tests and commit Task 2**

---

### Task 3: Google Drive Media Vault with Sharp WebP Compression

**Files:**
- Create: `src/core/utils/image-optimizer.ts`
- Create: `src/core/google/drive.service.ts`
- Test: `tests/drive-service.test.ts`

**Interfaces:**
- Consumes: `imageBuffer: Buffer`, `sppgId: string`, `date: string`, `supplierName: string`
- Produces: `uploadReceiptToDrive(buffer, metadata): Promise<{ webViewLink: string, fileId: string }>`

- [ ] **Step 1: Implement image-optimizer.ts with low VPS RAM consumption (`sharp.concurrency(1)`, WebP 80%, max 1200px)**
- [ ] **Step 2: Implement drive.service.ts with dynamic hierarchy `/mbg-assistant/[SPPG_ID]/[Tahun]/[Bulan]/Supplier/`**
- [ ] **Step 3: Add in-place upsert logic, public reader permissions, and direct view URL generation**
- [ ] **Step 4: Write unit tests verifying compression ratio (<150KB) and mock upload**
- [ ] **Step 5: Run tests and commit Task 3**

---

### Task 4: Google Sheets 5-Tab Hybrid Engine & Apps Script Integration

**Files:**
- Create: `src/core/google/sheets.service.ts`
- Update: `src/core/google/sheets-recipes.ts`
- Verify: `google-apps-script/kode.gs`
- Test: `tests/sheets-service.test.ts`

**Interfaces:**
- Consumes: `ExtractedSppgOrder`, `ExtractedSupplierReceipt`, `driveLink`
- Produces: `recordSppgOrder()`, `recordSupplierExpense()`, `getMarginSummary()`

- [ ] **Step 1: Implement sheets.service.ts supporting 5 tabs (`01_RINGKASAN_EKSEKUTIF`, `02_PENDAPATAN_SPPG`, `03_PENGELUARAN_SUPPLIER`, `04_REKAP_MARGIN_HARIAN`, `05_MASTER_DATA`)**
- [ ] **Step 2: Implement exact row index lookup (`values.get A:A`) to eliminate row jumping**
- [ ] **Step 3: Apply Badan Gizi Nasional styling batch update (Sticky KPI cards, Navy `#0F2042` Header, Currency `Rp #,##0`, formula `=HYPERLINK()`)**
- [ ] **Step 4: Verify google-apps-script/kode.gs matches operational sheets**
- [ ] **Step 5: Write unit tests with mock Google Sheets API calls**
- [ ] **Step 6: Run tests and commit Task 4**

---

### Task 5: Official BGN PDF Report Generator

**Files:**
- Create: `src/core/pdf/pdf-report.service.ts`
- Test: `tests/pdf-report.test.ts`

**Interfaces:**
- Consumes: `SPPGOrderRecord`, `SupplierExpenseRecord[]`, `MarginSummary`
- Produces: `generateOfficialSppgPdf(data): Promise<Buffer>`

- [ ] **Step 1: Implement PDFKit report generator with official Badan Gizi Nasional header layout**
- [ ] **Step 2: Add 3-column financial summary strip (Plafon vs Belanja vs Sisa Margin) with color indicators**
- [ ] **Step 3: Add itemized supplier purchase table with auto-pagination and running footer**
- [ ] **Step 4: Add validation signature blocks (Kepala SPPG & Rekanan Penyedia Makanan)**
- [ ] **Step 5: Write test verifying non-empty PDF buffer generation**
- [ ] **Step 6: Run tests and commit Task 5**

---

### Task 6: Supabase State Machine, Repositories, Whitelist & Heartbeat

**Files:**
- Create: `supabase/migrations/20260904_initial_sppg_schema.sql`
- Create: `src/core/db/supabase.ts`
- Create: `src/core/db/repositories/user.repository.ts`
- Create: `src/core/db/repositories/pending-action.repository.ts`
- Create: `src/core/db/repositories/sppg.repository.ts`
- Create: `src/core/db/heartbeat.ts`
- Test: `tests/repositories.test.ts`

**Interfaces:**
- Consumes: Supabase credentials
- Produces: Whitelist checks, pending action draft storage, confirmation state machine, and heartbeat ping

- [ ] **Step 1: Write SQL migration file with `users`, `pending_agent_actions`, `sppg_orders`, `sppg_order_items`, `supplier_expenses`**
- [ ] **Step 2: Implement UserRepository with single-use invite token logic (`/invite`) and whitelist verification**
- [ ] **Step 3: Implement PendingActionRepository for interactive confirmation state machine (10-minute expiry)**
- [ ] **Step 4: Implement SppgRepository for local querying and caching**
- [ ] **Step 5: Implement heartbeat ping to prevent Supabase free tier auto-pause during holidays**
- [ ] **Step 6: Write unit tests verifying repository methods and mock DB operations**
- [ ] **Step 7: Run tests and commit Task 6**

---

### Task 7: Grammy Bot Micro-Workers & Master Supervisor

**Files:**
- Create: `src/core/telegram/keyboards.ts`
- Create: `src/core/telegram/formatter.ts`
- Create: `src/core/telegram/bot-handler.ts`
- Create: `src/worker.ts`
- Create: `src/supervisor.ts`
- Test: `tests/bot-handler.test.ts`

**Interfaces:**
- Consumes: `SPPGUnitConfig`, Grammy Bot instances
- Produces: Isolated running bot workers and auto-recovery supervisor process

- [ ] **Step 1: Implement keyboards.ts and formatter.ts for HTML draft card and in-place buttons**
- [ ] **Step 2: Implement bot-handler.ts with message routing, photo download buffer, auto-cleanup wizard, and PDF delivery**
- [ ] **Step 3: Implement src/worker.ts to run a single SPPG bot instance with localized error boundaries**
- [ ] **Step 4: Implement src/supervisor.ts to fork, monitor, and auto-restart failed bot micro-workers**
- [ ] **Step 5: Write test verifying supervisor lifecycle and worker message routing**
- [ ] **Step 6: Run tests and commit Task 7**

---

### Task 8: Koyeb Dockerfile, Documentation, & End-to-End Verification

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `SETUP.md`
- Create: `README.md`
- Test: End-to-end integration test with real SPPG Patila order sheet data

- [ ] **Step 1: Create production multi-stage Dockerfile optimized for Koyeb (Node.js 22 LTS Alpine/Slim, Sharp C++ support, non-root user)**
- [ ] **Step 2: Write detailed SETUP.md explaining Supabase migration execution, Apps Script installation in Google Sheets, and Koyeb CLI deploy**
- [ ] **Step 3: Write README.md with system architecture diagram, bot command guide, and operational manual for Ayah**
- [ ] **Step 4: Run comprehensive test suite (`npm test`)**
- [ ] **Step 5: Verify build succeeds (`npm run build`)**
- [ ] **Step 6: Commit and push changes to target GitHub repository `https://github.com/iza-aa/iza-sppg-agent`**

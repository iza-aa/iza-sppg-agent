# IZA SPPG MBG Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun asisten Telegram operasional multi-bot untuk vendor Makanan Bergizi Gratis (MBG) terintegrasi dengan Google Sheets, Google Drive, Supabase, `agy CLI`, dan Gemini Vision, dengan pemisahan Nota Pesanan SPPG (Pendapatan/Plafon) dan Invoice Supplier (Pengeluaran), otomatisasi Apps Script (`kode.gs`), dan ekspor laporan resmi PDF bertema Badan Gizi Nasional (BGN).

**Architecture:** Hybrid Master Supervisor & Micro-Workers dengan isolasi proses (3 bot Telegram berjalan di child-process terpisah agar jika satu bot error, bot lainnya tidak terganggu). Menggunakan shared core services untuk AI extraction, kompresi foto WebP, sinkronisasi Google Sheets 3-tab, dan Supabase PostgreSQL.

**Tech Stack:** Node.js, TypeScript, Grammy (Telegram Bot), `@google/generative-ai`, `googleapis`, `sharp`, `pdfkit`, `@supabase/supabase-js`, `zod`, `vitest`.

**Spec:** [`docs/superpowers/specs/2026-09-04-sppg-mbg-assistant-design.md`](file:///Users/heizaaa/Desktop/cdev/mbg-assistant/docs/superpowers/specs/2026-09-04-sppg-mbg-assistant-design.md)

## Global Constraints
- Platform Target: macOS (Development lokal) & Ubuntu Linux (Biznet GIO VPS Production).
- Brand Palette: Deep Navy (`#0F2042`), Emblem Gold (`#D4A017`), Soft Sky Blue (`#90C7DE`).
- Secret Protection: Semua API Keys, Token Telegram, dan Service Account disimpan di `.env` (tidak di-commit).
- Fault Tolerance: Error pada satu worker bot tidak boleh mematikan bot unit lain.
- Deterministic Math: Semua penjumlahan nilai uang dan kuantitas dihitung ulang dengan CPU Math Check di backend.

---

### Task 1: Project Scaffolding & Configuration Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/config/env.ts`
- Create: `src/config/sppg.config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `sppgConfigs: SPPGUnitConfig[]`, `env: AppEnv`

- [ ] **Step 1: Create package.json and project configuration files**
- [ ] **Step 2: Create .gitignore and .env.example with placeholders for 3 bots, Supabase, Gemini, and Google credentials**
- [ ] **Step 3: Implement src/config/sppg.config.ts supporting multi-bot config mapping**
- [ ] **Step 4: Write test verifying environment and SPPG config loader**
- [ ] **Step 5: Run test to verify it passes**
- [ ] **Step 6: Commit Task 1**

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

- [ ] **Step 1: Implement multi-key pool and model fallback in gemini-client.ts**
- [ ] **Step 2: Implement agy CLI subprocess connector with dynamic model routing and 3-tier regex JSON fallback in agy-connector.ts**
- [ ] **Step 3: Define Zod schemas for Nota Pesanan SPPG (Pendapatan) and Kwitansi Supplier (Pengeluaran)**
- [ ] **Step 4: Implement deterministic CPU sum check and unit normalizer (ekor, jerigen, kg, liter, dll.)**
- [ ] **Step 5: Write unit tests with mock OCR outputs (verifying calculation of 22 items totalling Rp 29.581.000)**
- [ ] **Step 6: Run tests to verify they pass**
- [ ] **Step 7: Commit Task 2**

---

### Task 3: Google Drive Media Vault with Sharp WebP Compression

**Files:**
- Create: `src/core/utils/image-optimizer.ts`
- Create: `src/core/google/drive.service.ts`
- Test: `tests/drive-service.test.ts`

**Interfaces:**
- Consumes: `imageBuffer: Buffer`, `sppgId: string`, `date: string`, `supplierName: string`
- Produces: `uploadReceiptToDrive(buffer, metadata): Promise<{ webViewLink: string, fileId: string }>`

- [ ] **Step 1: Implement image-optimizer.ts with low VPS RAM consumption (WebP 80%, max 1200px)**
- [ ] **Step 2: Implement drive.service.ts with dynamic hierarchy `/MBG/[SPPG_ID]/[Tahun-Bulan]/Supplier/`**
- [ ] **Step 3: Add in-place upsert logic and public reader permissions**
- [ ] **Step 4: Write unit tests verifying compression and mock upload**
- [ ] **Step 5: Run tests and commit Task 3**

---

### Task 4: Google Sheets Engine & Google Apps Script (`kode.gs`)

**Files:**
- Create: `src/core/google/sheets.service.ts`
- Create: `google-apps-script/kode.gs`
- Test: `tests/sheets-service.test.ts`

**Interfaces:**
- Consumes: `ExtractedSppgOrder`, `ExtractedSupplierReceipt`, `driveLink`
- Produces: `recordSppgOrder()`, `recordSupplierExpense()`, `getMarginSummary()`

- [ ] **Step 1: Implement sheets.service.ts supporting 3 tabs (`PENDAPATAN_SPPG`, `PENGELUARAN_SUPPLIER`, `REKAP_MARGIN_HARIAN`)**
- [ ] **Step 2: Implement exact row index lookup (`values.get A:A`) to eliminate row jumping**
- [ ] **Step 3: Apply Badan Gizi Nasional styling batch update (Navy `#0F2042` Header, Rupiah Currency formatting)**
- [ ] **Step 4: Write google-apps-script/kode.gs for custom menu `[⚡ Menu SPPG]`, auto-formulas, and cell styling**
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

### Task 6: Supabase State Machine, Repositories, and Whitelist

**Files:**
- Create: `supabase/migrations/20260904_initial_sppg_schema.sql`
- Create: `src/core/db/supabase.ts`
- Create: `src/core/db/repositories/user.repository.ts`
- Create: `src/core/db/repositories/pending-action.repository.ts`
- Create: `src/core/db/repositories/sppg.repository.ts`
- Test: `tests/repositories.test.ts`

**Interfaces:**
- Consumes: Supabase credentials
- Produces: Whitelist checks, pending action draft storage, and confirmation state machine

- [ ] **Step 1: Write SQL migration file with `users`, `pending_agent_actions`, `sppg_orders`, `sppg_order_items`, `supplier_expenses`**
- [ ] **Step 2: Implement UserRepository with single-use invite token logic (`/invite`) and whitelist verification**
- [ ] **Step 3: Implement PendingActionRepository for interactive confirmation state machine (10-minute expiry)**
- [ ] **Step 4: Implement SppgRepository for local querying and caching**
- [ ] **Step 5: Write unit tests verifying repository methods and mock DB operations**
- [ ] **Step 6: Run tests and commit Task 6**

---

### Task 7: Grammy Bot Micro-Workers & Master Supervisor

**Files:**
- Create: `src/core/telegram/bot-handler.ts`
- Create: `src/worker.ts`
- Create: `src/supervisor.ts`
- Test: `tests/bot-handler.test.ts`

**Interfaces:**
- Consumes: `SPPGUnitConfig`, Grammy Bot instances
- Produces: Isolated running bot workers and auto-recovery supervisor process

- [ ] **Step 1: Implement bot-handler.ts with message routing, photo download buffer, inline keyboard buttons, and PDF delivery**
- [ ] **Step 2: Implement obsolete keyboard cleanup (`clearPreviousKeyboard`) to prevent double-clicking**
- [ ] **Step 3: Implement src/worker.ts to run a single SPPG bot instance with localized error boundaries**
- [ ] **Step 4: Implement src/supervisor.ts to fork, monitor, and auto-restart failed bot micro-workers**
- [ ] **Step 5: Write test verifying supervisor lifecycle and worker message routing**
- [ ] **Step 6: Run tests and commit Task 7**

---

### Task 8: Comprehensive Setup Guide & Local Verification on Mac

**Files:**
- Create: `SETUP.md`
- Create: `README.md`
- Test: End-to-end integration test with real SPPG Patila order sheet data

- [ ] **Step 1: Write detailed SETUP.md explaining BotFather setup, Supabase migration, Google Service Account, Apps Script installation, and Mac startup**
- [ ] **Step 2: Write README.md with system architecture diagram, command list, and deployment instructions for Biznet GIO VPS**
- [ ] **Step 3: Run comprehensive test suite (`npm test`)**
- [ ] **Step 4: Verify build succeeds (`npm run build`)**
- [ ] **Step 5: Commit and push changes to target GitHub repository `https://github.com/iza-aa/iza-sppg-agent`**

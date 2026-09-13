# Tab 06 Dynamic PO Filter & Executive Subtotal Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an interactive dynamic PO dropdown filter and executive subtotal header on Tab 06 (`06_MARGIN` / `06_PERBANDINGAN_MARGIN`) with zero-regression row offset synchronization across all Google Sheets services.

**Architecture:** 
- Tab 06 grid layout is updated to have 2 frozen rows: Row 1 contains the executive summary & PO filter dropdown, Row 2 contains the 15 standard column headers, and Row 3+ contains data rows.
- Dynamic PO list is stored on `08_MASTER_DATA!E2:E` using `=IFERROR(SORT(UNIQUE(FILTER('02_PENDAPATAN'!A2:A; '02_PENDAPATAN'!A2:A<>""))); "")` with `"SEMUA PO"` on top.
- Data validation on `06_MARGIN!G1` connects to `'08_MASTER_DATA'!$E$2:$E`.
- Formulas in Row 1 calculate totals using dynamic `IF/SUBTOTAL/SUMIFS` based on the selected PO.
- Backend services (`pagu-sheets`, `expense-sheets`, `margin-sheets`, `sheets-client.provider`, and `delta-sync.daemon`) are updated to use 1-based Row 3+ for data rows.

**Tech Stack:** TypeScript, Google Sheets API v4, Node.js, Vitest/Jest test suites.

**Spec:** [docs/superpowers/specs/2026-09-13-tab-06-po-filter-design.md](file:///Users/heizaaa/Desktop/cdev/mbg-assistant/docs/superpowers/specs/2026-09-13-tab-06-po-filter-design.md)

## Global Constraints
- Target Tab: `06_MARGIN` (also supports aliases `06_PERBANDINGAN_MARGIN`, `06_REKAP_MARGIN`).
- 2 Frozen Rows (`frozenRowCount: 2`).
- Row 1 Columns:
  - A-F: Label `"EVALUASI MARGIN & ANGGARAN PO"`
  - G: Dropdown filter for PO (Default: `"SEMUA PO"`)
  - H: Label `"TOTAL"`
  - I: `"-"`
  - J: `=IF(OR($G$1=""; $G$1="SEMUA PO"); SUBTOTAL(109; J3:J); SUMIFS(J3:J; $A$3:$A; $G$1))`
  - K: `"-"`
  - L: `=IF(OR($G$1=""; $G$1="SEMUA PO"); SUBTOTAL(109; L3:L); SUMIFS(L3:L; $A$3:$A; $G$1))`
  - M: `=J1-L1`
  - N: `=IF(J1>0; M1/J1; 0)`
  - O: `=IF(J1=0; "-"; IF(M1>0; "🟢 HEMAT"; IF(M1=0; "🟢 PAS"; "🔴 OVER BUDGET")))`
- Row 2 Columns:
  - `['No SPPG Ref', 'ID Pendapatan', 'ID Pengeluaran', 'Tanggal', 'Nama Supplier', 'Uraian Bahan', 'Kuantitas', 'Satuan', 'Harga Pendapatan', 'Total Pendapatan', 'Harga Invoice', 'Total Realisasi', 'Margin Bersih (Rp)', '% Margin', 'Status']`
- Data starts on Row 3 (Row index 2 in 0-based indexing; row number 3 in 1-based A1 notation).

---

### Task 1: Update Operational Dashboard Recipe Values & Master Data PO List

**Files:**
- Modify: `src/core/google/recipes/operational-dashboard.recipe.ts`
- Modify: `src/core/google/recipes/constants.ts` (if needed)
- Test: `tests/operational-dashboard-tab06.test.ts`

**Interfaces:**
- `getOperationalDashboardValues`: Returns `tabPerbandinganMarginHeaders` with 2 rows (Row 1 summary values/formulas, Row 2 column headers), and `tabMasterDataValues` or PO formula in Master Data.

- [ ] **Step 1: Write unit test for Tab 06 values structure**
- [ ] **Step 2: Update `operational-dashboard.recipe.ts` to output 2-row Tab 06 headers and Master Data dynamic PO formula**
- [ ] **Step 3: Run unit test to verify recipe output**
- [ ] **Step 4: Commit Task 1 changes**

---

### Task 2: Update Styling & Conditional Formatting for Tab 06

**Files:**
- Modify: `src/core/google/recipes/styling.ts`
- Test: `tests/styling-tab06.test.ts`

**Interfaces:**
- `createDefaultStylingRequests`: Sets `frozenRowCount: 2` for `SHEET_IDS.PERBANDINGAN_MARGIN`.
- Data validation request on `G1` pointing to `'08_MASTER_DATA'!$E$2:$E`.
- Styling for Row 1 (background, bold text, alignments, number format `Rp#,##0` for J, L, M, and `0.00%` for N).
- Conditional formatting for M1, N1, O1 (`> 0` green, `< 0` red, `= 0` amber/neutral).

- [ ] **Step 1: Write test checking Tab 06 styling requests and frozenRowCount**
- [ ] **Step 2: Add Row 1 formatting, conditional formatting, and Data Validation in `styling.ts`**
- [ ] **Step 3: Run test to confirm requests match specs**
- [ ] **Step 4: Commit Task 2 changes**

---

### Task 3: Update Sheets Client Provider Initialization

**Files:**
- Modify: `src/core/google/services/sheets-client.provider.ts`

**Interfaces:**
- `initializeSpreadsheetStructure`: writes Tab 06 values to range `'${SHEET_NAMES.PERBANDINGAN_MARGIN}'!A1:O2` and PO list formula to `'${SHEET_NAMES.MASTER_DATA}'!E1:E3`.
- `formatExistingSpreadsheet`: updates range `'${SHEET_NAMES.MARGIN}'!A1:O2` and `'${SHEET_NAMES.MASTER_DATA}'!E1:E3`.

- [ ] **Step 1: Update batchUpdate ranges in `sheets-client.provider.ts`**
- [ ] **Step 2: Run `npm run build` to verify type compliance**
- [ ] **Step 3: Commit Task 3 changes**

---

### Task 4: Align Row Offsets in PaguSheetsService

**Files:**
- Modify: `src/core/google/services/pagu-sheets.service.ts`
- Test: `tests/pagu-sheets-tab06-offset.test.ts`

**Interfaces:**
- `PaguSheetsService`: when inserting or querying Tab 06, ensures existing row scanning and insertion offsets account for Row 1 (Summary) and Row 2 (Headers), so data starts at Row 3.

- [ ] **Step 1: Inspect and adjust Tab 06 row insertion and index calculation in `pagu-sheets.service.ts`**
- [ ] **Step 2: Verify unit test passes for pagu insertion**
- [ ] **Step 3: Commit Task 4 changes**

---

### Task 5: Align Row Offsets in ExpenseSheetsService

**Files:**
- Modify: `src/core/google/services/expense-sheets.service.ts`
- Test: `tests/expense-sheets-tab06-offset.test.ts`

**Interfaces:**
- `ExpenseSheetsService`: Tab 06 reconciliation reads starting at Row 3 (`A3:O`) or handles index + 1 when reading `A:O`, updating matching rows without touching Row 1 or 2.

- [ ] **Step 1: Update range from `A2:O` to `A3:O` and row index offset `rIdx + 3` across reconciliation methods**
- [ ] **Step 2: Verify unit test for expense reconciliation**
- [ ] **Step 3: Commit Task 5 changes**

---

### Task 6: Align MarginSheetsService and DeltaSyncDaemon

**Files:**
- Modify: `src/core/google/services/margin-sheets.service.ts`
- Modify: `src/core/sync/delta-sync.daemon.ts`

**Interfaces:**
- `MarginSheetsService.getPaguCandidatesForCommodity`: uses range `A3:O` and `rowIndex = rIdx + 3`.
- `DeltaSyncDaemon`: ignores Row 1 and Row 2 in Tab 06 change detection.

- [ ] **Step 1: Update `margin-sheets.service.ts` range to `A3:O` and offset to `rIdx + 3`**
- [ ] **Step 2: Update `delta-sync.daemon.ts` to ignore Row 1 and Row 2 on Tab 06**
- [ ] **Step 3: Commit Task 6 changes**

---

### Task 7: Full System Verification & Git Push

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite (`npm test`)**
- [ ] **Step 2: Run build (`npm run build`)**
- [ ] **Step 3: Push commits to remote origin (`git push origin main`)**

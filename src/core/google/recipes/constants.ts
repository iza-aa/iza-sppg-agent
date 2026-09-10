import { sheets_v4 } from "googleapis";

/**
 * ============================================================================
 * GOOGLE SHEETS API V4 BATCH UPDATE CONSTANTS & PALETTES - MBG ASSISTANT (BGN)
 * ============================================================================
 */

export interface SheetsColorRgba {
  red: number;
  green: number;
  blue: number;
  alpha?: number;
}

export const BGN_PALETTE = {
  DEEP_NAVY: "#0F2042",
  EMBLEM_GOLD: "#D4A017",
  SOFT_SKY_BLUE: "#90C7DE",
  CRIMSON_RED: "#C62828",
  FOREST_GREEN: "#14532D",
  SLATE_DARK: "#1E293B",
  SLATE_GRAY: "#64748B",
  SLATE_LIGHT: "#F8FAFC",
  WHITE: "#FFFFFF",
  ALERT_GREEN_BG: "#E8F5E9",
  ALERT_GREEN_TXT: "#2E7D32",
  ALERT_YELLOW_BG: "#FEF3C7",
  ALERT_YELLOW_TXT: "#B45309",
  ALERT_RED_BG: "#FEE2E2",
  ALERT_RED_TXT: "#B91C1C",
} as const;

export const SHEET_IDS = {
  PANDUAN: 1000,
  DASHBOARD: 1001,
  PAGU_PENERIMAAN: 1002,
  RINCIAN_PENDAPATAN: 1003,
  PAGU_PENGELUARAN: 1004,
  RINCIAN_PENGELUARAN: 1005,
  PERBANDINGAN_MARGIN: 1006,
  MASTER_DATA: 1007,
  // Backward compat aliases
  PAGU_RINGKASAN: 1002,
  PAGU_RINCIAN: 1003,
  PENGELUARAN_SUPPLIER: 1004,
  REKAP_MARGIN: 1006,
  RINGKASAN_EKSEKUTIF: 1001,
  PENDAPATAN_SPPG: 1002,
  REKAP_MARGIN_HARIAN: 1006,
} as const;

export const SHEET_NAMES = {
  PANDUAN: "00_PANDUAN_OPERASIONAL",
  DASHBOARD: "01_DASHBOARD",
  PAGU_PENERIMAAN: "02_PAGU_PENERIMAAN",
  RINCIAN_PENDAPATAN: "03_RINCIAN_PENDAPATAN",
  PAGU_PENGELUARAN: "04_PAGU_PENGELUARAN",
  RINCIAN_PENGELUARAN: "05_RINCIAN_PENGELUARAN",
  PERBANDINGAN_MARGIN: "06_PERBANDINGAN_MARGIN",
  MASTER_DATA: "07_MASTER_DATA",
  // Backward compat aliases
  PAGU_RINGKASAN: "02_PAGU_PENERIMAAN",
  PAGU_RINCIAN: "03_RINCIAN_PENDAPATAN",
  PAGU_RINCIAN_PENDAPATAN: "03_RINCIAN_PENDAPATAN",
  PENGELUARAN_SUPPLIER: "04_PAGU_PENGELUARAN",
  REKAP_MARGIN: "06_PERBANDINGAN_MARGIN",
  RINGKASAN_EKSEKUTIF: "01_DASHBOARD",
  PENDAPATAN_SPPG: "02_PAGU_PENERIMAAN",
  REKAP_MARGIN_HARIAN: "06_PERBANDINGAN_MARGIN",
} as const;

export const MASTER_SHEET_IDS = {
  DASHBOARD: 0,
  SEMUA_TRANSAKSI: 2002,
  DAFTAR_DAPUR: 2003,
  LOG_AKTIVITAS: 2004,
  KONSOLIDASI_NASIONAL: 0,
  SEMUA_TRANSAKSI_GLOBAL: 2002,
  DIREKTORI_SPPG: 2003,
  LOG_AKTIVITAS_GLOBAL: 2004,
} as const;

export const MASTER_SHEET_NAMES = {
  DASHBOARD: "01_DASHBOARD",
  SEMUA_TRANSAKSI: "02_SEMUA_TRANSAKSI",
  DAFTAR_DAPUR: "03_DAFTAR_DAPUR",
  LOG_AKTIVITAS: "04_LOG_AKTIVITAS",
  KONSOLIDASI_NASIONAL: "01_DASHBOARD",
  SEMUA_TRANSAKSI_GLOBAL: "02_SEMUA_TRANSAKSI",
  DIREKTORI_SPPG: "03_DAFTAR_DAPUR",
  LOG_AKTIVITAS_GLOBAL: "04_LOG_AKTIVITAS",
} as const;

/**
 * Mengonversi kode Hex (#RRGGBB) ke Google Sheets API RGBA format (float 0.0 - 1.0)
 */
export function hexToRgbColor(hex: string, alpha: number = 1.0): sheets_v4.Schema$Color {
  const cleanHex = hex.replace(/^#/, "");
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  return {
    red: Math.round(r * 10000) / 10000,
    green: Math.round(g * 10000) / 10000,
    blue: Math.round(b * 10000) / 10000,
    alpha,
  };
}

export function resolveSheetId(sheetMap: Map<string, number> | undefined, title: string, fallback: number): number {
  return sheetMap?.get(title) ?? fallback;
}

/**
 * ============================================================================
 * DATE & TIME UTILITIES - MBG ASSISTANT (WIB / UTC+7)
 * ============================================================================
 * Menyediakan fungsi format tanggal dan waktu standar Indonesia (WIB)
 * untuk integritas audit trail di Google Sheets dan antarmuka bot Telegram.
 */

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function toWibDate(date: Date = new Date()): Date {
  // Convert given UTC timestamp to UTC+7 representation
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  return new Date(utc + WIB_OFFSET_MS);
}

/**
 * Menghasilkan timestamp audit lengkap untuk Kolom K Google Sheets.
 * Format: "2026-09-11 09:44:00 WIB"
 */
export function getWibTimestamp(date: Date = new Date()): string {
  const w = toWibDate(date);
  const year = w.getFullYear();
  const month = String(w.getMonth() + 1).padStart(2, "0");
  const day = String(w.getDate()).padStart(2, "0");
  const hours = String(w.getHours()).padStart(2, "0");
  const minutes = String(w.getMinutes()).padStart(2, "0");
  const seconds = String(w.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} WIB`;
}

/**
 * Menghasilkan jam ringkas format "[HH:mm:ss]" untuk kronologi audit trail.
 */
export function getWibTimeOnly(date: Date = new Date()): string {
  const w = toWibDate(date);
  const hours = String(w.getHours()).padStart(2, "0");
  const minutes = String(w.getMinutes()).padStart(2, "0");
  const seconds = String(w.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Menghasilkan tag edit ringkas untuk catatan riwayat edit.
 * Format: "11/09 19:00"
 */
export function getWibShortTimestamp(date: Date = new Date()): string {
  const w = toWibDate(date);
  const day = String(w.getDate()).padStart(2, "0");
  const month = String(w.getMonth() + 1).padStart(2, "0");
  const hours = String(w.getHours()).padStart(2, "0");
  const minutes = String(w.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${minutes}`;
}

/**
 * Menghasilkan tanggal standar ISO "YYYY-MM-DD" berbasis waktu WIB.
 */
export function getWibDateStr(date: Date = new Date()): string {
  const w = toWibDate(date);
  const year = w.getFullYear();
  const month = String(w.getMonth() + 1).padStart(2, "0");
  const day = String(w.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Menghasilkan teks waktu ramah untuk kartu bot Telegram.
 * Format: "11 Sep 2026, 09:44 WIB"
 */
export function formatWibDisplay(date: Date = new Date()): string {
  const w = toWibDate(date);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
    "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
  ];
  const day = w.getDate();
  const month = months[w.getMonth()];
  const year = w.getFullYear();
  const hours = String(w.getHours()).padStart(2, "0");
  const minutes = String(w.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes} WIB`;
}

/**
 * Periode laporan operasional (kalender WIB).
 *
 * Preset mengikuti kalender bisnis, bukan "N hari terakhir":
 * - all   : seluruh data historis (tanpa batas tanggal).
 * - today : tanggal berjalan.
 * - week  : Senin minggu berjalan sampai hari ini.
 * - month : tanggal 1 bulan berjalan sampai hari ini.
 *
 * Tanggal tetap dikirim sebagai YYYY-MM-DD; backend menafsirkannya sebagai
 * hari bisnis WIB (lib/report.ts), sehingga batas hari konsisten.
 */

import { addDaysToDateCode, dateCodeParts, dateCodeToDisplay, todayDateCode } from './dates'

export type ReportPreset = 'all' | 'today' | 'week' | 'month' | 'custom'

export interface ReportRange {
  /** null bersama `to` = tanpa batas periode (seluruh data). */
  from: string | null
  to: string | null
}

/** Kode tanggal YYYY-MM-DD hari ini menurut kalender WIB. */
export function todayBusinessDateCode(reference = new Date()): string {
  return todayDateCode(reference)
}

function shiftDateCode(code: string, days: number): string {
  return addDaysToDateCode(code, days)
}

/** Senin pada minggu yang sama dengan `code` (kalender Gregorian). */
export function startOfWeekMonday(code: string): string {
  const date = new Date(`${code}T00:00:00.000Z`)
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  return shiftDateCode(code, -daysSinceMonday)
}

/** Tanggal 1 pada bulan yang sama dengan `code`. */
export function startOfMonth(code: string): string {
  return `${code.slice(0, 7)}-01`
}

/** Rentang untuk preset Semua / Hari Ini / Minggu Ini / Bulan Ini. */
export function presetRange(
  preset: Exclude<ReportPreset, 'custom'>,
  reference = new Date()
): ReportRange {
  if (preset === 'all') {
    return { from: null, to: null }
  }
  const today = todayBusinessDateCode(reference)
  if (preset === 'today') {
    return { from: today, to: today }
  }
  if (preset === 'week') {
    return { from: startOfWeekMonday(today), to: today }
  }
  return { from: startOfMonth(today), to: today }
}

/** Validasi rentang kustom: kedua tanggal wajib ada dan akhir >= mulai. */
export function validateReportRange(from: string, to: string): string | null {
  if (!from || !to) {
    return 'Tanggal mulai dan tanggal akhir wajib diisi.'
  }
  if (from > to) {
    return 'Tanggal akhir tidak boleh lebih awal daripada tanggal mulai.'
  }
  return null
}

/** Label ringkas rentang tanggal untuk ditampilkan ke pengguna. */
export function formatReportRange(from: string | null, to: string | null): string {
  if (!from || !to) return ''
  if (!dateCodeParts(from) || !dateCodeParts(to)) return `${from} – ${to}`
  return `${dateCodeToDisplay(from)} – ${dateCodeToDisplay(to)}`
}

/** Bagian nama file CSV yang aman dan informatif. */
export function reportFilePeriod(from: string | null, to: string | null): string {
  if (!from || !to) return 'semua-data'
  return `${from}_${to}`
}

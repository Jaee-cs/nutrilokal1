/**
 * Utilitas tanggal bisnis NutriLokal (kalender WIB).
 *
 * Semua tanggal aktivitas disimpan/dikirim sebagai kode `YYYY-MM-DD` dan
 * ditampilkan sebagai `DD/MM/YYYY`. Perhitungan "hari ini" memakai zona
 * waktu Asia/Jakarta agar tidak bergeser satu hari di server/browser dengan
 * zona waktu berbeda.
 */

export const WIB_TIME_ZONE = 'Asia/Jakarta'

const DATE_CODE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export interface DateCodeParts {
  year: number
  month: number
  day: number
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** Kode tanggal `YYYY-MM-DD` hari ini menurut kalender WIB. */
export function todayDateCode(reference: Date = new Date()): string {
  return reference.toLocaleDateString('sv-SE', { timeZone: WIB_TIME_ZONE })
}

/** Membaca kode tanggal yang benar-benar ada di kalender (bukan 31/02). */
export function dateCodeParts(code: string | null | undefined): DateCodeParts | null {
  if (!code) return null
  const match = DATE_CODE_PATTERN.exec(code.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day }
}

export function isDateCode(value: string | null | undefined): value is string {
  return dateCodeParts(value) !== null
}

export function dateCodeFromParts(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`
}

/** `YYYY-MM-DD` → `DD/MM/YYYY` (aman untuk nilai yang tidak valid). */
export function dateCodeToDisplay(code: string | null | undefined): string {
  const parts = dateCodeParts(code)
  if (!parts) return code ? String(code) : ''
  return `${pad(parts.day)}/${pad(parts.month)}/${pad(parts.year, 4)}`
}

/** Tanggal kalender WIB dari instan ISO/timestamp → kode `YYYY-MM-DD`. */
export function isoToDateCode(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    const text = String(iso)
    return isDateCode(text) ? text : ''
  }
  return date.toLocaleDateString('sv-SE', { timeZone: WIB_TIME_ZONE })
}

/** Tanggal kalender WIB dari instan ISO/timestamp → `DD/MM/YYYY`. */
export function isoToDateDisplay(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    // Nilai yang sudah berupa kode tanggal (mis. dari API QR publik).
    return dateCodeToDisplay(String(iso))
  }
  return date.toLocaleDateString('en-GB', {
    timeZone: WIB_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/** Instan ISO/timestamp → `DD/MM/YYYY HH:mm` menurut kalender WIB. */
export function isoToDateTimeDisplay(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  const day = date.toLocaleDateString('en-GB', {
    timeZone: WIB_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const time = date.toLocaleTimeString('en-GB', {
    timeZone: WIB_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${day} ${time}`
}

/** Hanya jam `HH:mm` menurut kalender WIB. */
export function isoToTimeDisplay(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('en-GB', {
    timeZone: WIB_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * Mengubah ketikan pengguna menjadi kode tanggal.
 * Menerima `DD/MM/YYYY`, `DDMMYYYY`, dan `YYYY-MM-DD` (tempel/otomatisasi uji).
 */
export function parseDateInput(text: string): string | null {
  const value = text.trim()
  if (value === '') return null

  if (DATE_CODE_PATTERN.test(value)) {
    return isDateCode(value) ? value : null
  }

  const digits = value.replace(/\D/g, '')
  if (digits.length !== 8) return null
  const day = Number(digits.slice(0, 2))
  const month = Number(digits.slice(2, 4))
  const year = Number(digits.slice(4, 8))
  const code = dateCodeFromParts(year, month, day)
  return isDateCode(code) ? code : null
}

/** Menyisipkan garis miring otomatis saat pengguna mengetik angka. */
export function formatDateInputDigits(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

export function addDaysToDateCode(code: string, days: number): string {
  const parts = dateCodeParts(code)
  if (!parts) return code
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return date.toISOString().slice(0, 10)
}

/** Perbandingan leksikografis aman untuk kode `YYYY-MM-DD`. */
export function compareDateCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

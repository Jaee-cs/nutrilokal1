/**
 * Aturan tanggal kedaluwarsa batch (README 5.5 dan 5.6).
 *
 * Satu sumber kebenaran untuk frontend: penanda kedaluwarsa di semua halaman
 * memakai kalender WIB yang sama dengan backend (`lib/date.ts`), dan hanya
 * tanggal yang sudah DIVALIDASI Admin yang dipakai untuk keputusan jual.
 */

export interface BatchExpiryFields {
  expiryDate: string | null
  expiryValidated: boolean
}

/** Kode tanggal 'YYYY-MM-DD' menurut kalender WIB (sama dengan backend). */
export function wibDateCode(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' })
}

/** Tanggal WIB yang ramah dibaca, mis. '20 Okt 2026'. */
export function wibDateLabel(iso: string | Date): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Batch ditandai kedaluwarsa hanya bila tanggalnya tersedia DAN sudah
 * divalidasi Admin serta sudah lewat menurut kalender WIB (README 5.5).
 * Penolakan transaksi tetap dilakukan backend — ini hanya penanda UI.
 */
export function isBatchExpired(batch: BatchExpiryFields, now: Date = new Date()): boolean {
  if (!batch.expiryDate || !batch.expiryValidated) return false
  return wibDateCode(batch.expiryDate) < wibDateCode(now)
}

/**
 * Label kedaluwarsa HANYA bila tanggal tersedia dan sudah divalidasi
 * (README 5.6); selain itu null agar kolom tersebut tidak ditampilkan.
 */
export function validatedExpiryLabel(batch: BatchExpiryFields): string | null {
  if (!batch.expiryDate || !batch.expiryValidated) return null
  return wibDateLabel(batch.expiryDate)
}

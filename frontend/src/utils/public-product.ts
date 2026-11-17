/**
 * Halaman publik produk untuk QR permanen per produk.
 *
 * QR produk menunjuk ke path stabil berbasis ID produk, bukan kode batch.
 * Dengan begitu QR yang sudah dicetak tidak perlu dibuat ulang ketika ada
 * produksi baru, perubahan informasi produk, atau batch tambahan.
 */

export type PublicBatchStatus = 'TERSEDIA' | 'HABIS' | 'KEDALUWARSA' | 'DITARIK'

export interface PublicBatchStatusMeta {
  label: string
  /** Kelas badge yang sudah dipakai di seluruh aplikasi. */
  cls: 'success' | 'neutral' | 'warning' | 'error'
}

/**
 * Label status publik. Status DITARIK tidak pernah ditampilkan sebagai
 * tersedia; informasi publik batch tersebut memang sudah ditarik Admin.
 */
export const PUBLIC_BATCH_STATUS_META: Record<PublicBatchStatus, PublicBatchStatusMeta> = {
  TERSEDIA: { label: 'Tersedia', cls: 'success' },
  HABIS: { label: 'Stok Habis', cls: 'neutral' },
  KEDALUWARSA: { label: 'Kedaluwarsa', cls: 'warning' },
  DITARIK: { label: 'Informasi Ditarik', cls: 'error' },
}

/** Path publik yang stabil untuk satu produk. */
export function productPublicPath(id: string): string {
  return `/produk/${encodeURIComponent(id)}`
}

/**
 * URL absolut untuk QR. `origin` dapat diberikan agar pengujian tidak
 * bergantung pada `window.location`.
 */
export function productPublicUrl(id: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '')
  return `${base}${productPublicPath(id)}`
}

/**
 * URL foto produk (README 5.6).
 *
 * Backend menyimpan path relatif (`/api/uploads/products/...`) supaya tetap
 * satu origin dengan API. Di pengembangan Vite memproksikan `/api`, di
 * produksi host statis memakai prefiks yang sama — jadi URL cukup dipakai apa
 * adanya. Foto selalu PNG/JPG/WEBP dengan nama file dari server.
 */
import api from '../lib/api'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

/** Menerima path backend (`/api/uploads/...`) atau nama file lama. */
export function productPhotoUrl(photoUrl?: string | null): string | null {
  if (!photoUrl) return null
  const value = photoUrl.trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('/api/')) return `${API_BASE}${value.slice('/api'.length)}`
  return `${API_BASE}/uploads/products/${value.replace(/^\/+/, '')}`
}

/** Batas ukuran foto produk (sama dengan backend: 5 MB). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/**
 * Validasi foto di sisi klien SEBELUM dikirim: tipe dan ukuran. Backend tetap
 * memeriksa ulang (isi berkas diperiksa lewat magic bytes).
 */
export function validatePhotoFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Tipe foto tidak didukung. Gunakan gambar JPG, PNG, atau WEBP.'
  }
  if (file.size === 0) {
    return 'File foto kosong. Pilih gambar JPG, PNG, atau WEBP.'
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return 'Ukuran foto maksimal 5 MB.'
  }
  return null
}

/** Mengirim berkas foto sebagai body biner (bukan base64, bukan multipart). */
export async function uploadProductPhoto(productId: string, file: File) {
  return api.post(`/products/${productId}/photo`, file, {
    headers: { 'Content-Type': file.type },
  })
}

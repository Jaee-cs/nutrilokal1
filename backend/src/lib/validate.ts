/**
 * Validator input untuk master produk dan bahan baku.
 * Semua fungsi mengembalikan pesan error berbahasa Indonesia, atau null jika valid.
 */

export function validateName(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return 'Nama wajib diisi.';
  }
  if (value.trim().length > 200) {
    return 'Nama maksimal 200 karakter.';
  }
  return null;
}

export function validateUnit(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return 'Satuan dasar wajib diisi.';
  }
  if (value.trim().length > 30) {
    return 'Satuan dasar maksimal 30 karakter.';
  }
  return null;
}

export function validateDescription(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return 'Deskripsi harus berupa teks.';
  }
  if (value.length > 2000) {
    return 'Deskripsi maksimal 2000 karakter.';
  }
  return null;
}

/** Harga jual harus angka finit >= 0 dengan maksimal 2 angka di belakang koma. */
export function validateSellingPrice(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Harga jual harus berupa angka.';
  }
  if (value < 0) {
    return 'Harga jual tidak boleh negatif.';
  }
  if (value >= 1e14) {
    return 'Harga jual terlalu besar.';
  }
  const asText = String(value);
  if (asText.includes('e') && value !== 0) {
    return 'Harga jual maksimal 2 angka di belakang koma.';
  }
  const [, decimals] = asText.split('.');
  if (decimals && decimals.length > 2) {
    return 'Harga jual maksimal 2 angka di belakang koma.';
  }
  return null;
}

/** Menormalkan deskripsi: string kosong menjadi null. */
export function normalizeDescription(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  return value.trim();
}

// ---------------------------------------------------------------------------
// Validator untuk catatan stok bahan baku (B4)
// ---------------------------------------------------------------------------

/** Jumlah (stok/hasil/pemakaian) harus angka finit > 0 dengan maksimal 3 angka di belakang koma. */
export function validateQuantity(value: unknown, label = 'Jumlah'): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${label} harus berupa angka.`;
  }
  if (value <= 0) {
    return `${label} harus lebih besar dari nol.`;
  }
  if (value >= 1e11) {
    return `${label} terlalu besar.`;
  }
  const asText = String(value);
  if (asText.includes('e')) {
    return `${label} maksimal 3 angka di belakang koma.`;
  }
  const [, decimals] = asText.split('.');
  if (decimals && decimals.length > 3) {
    return `${label} maksimal 3 angka di belakang koma.`;
  }
  return null;
}

/** Tanggal bisnis wajib berupa tanggal valid (format YYYY-MM-DD atau ISO). */
export function validateDateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return 'Tanggal wajib diisi.';
  }
  if (Number.isNaN(Date.parse(value))) {
    return 'Tanggal tidak valid. Gunakan format YYYY-MM-DD.';
  }
  return null;
}

/** Alasan (wajib untuk saldo awal). */
export function validateReason(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return 'Alasan wajib diisi.';
  }
  if (value.trim().length > 500) {
    return 'Alasan maksimal 500 karakter.';
  }
  return null;
}

/** Catatan opsional penerimaan. */
export function validateNote(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return 'Catatan harus berupa teks.';
  }
  if (value.length > 500) {
    return 'Catatan maksimal 500 karakter.';
  }
  return null;
}

/**
 * Daftar pemakaian bahan pada produksi: array berisi minimal satu objek
 * { materialId, quantity }. Validasi jumlah per bahan dilakukan pemanggil
 * (validateQuantity) karena label pesan berbeda-beda.
 */
export function validateUsageList(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return 'Daftar bahan yang dipakai wajib berisi minimal satu bahan.';
  }
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return 'Setiap pemakaian bahan harus berupa objek { materialId, quantity }.';
    }
    const { materialId } = item as Record<string, unknown>;
    if (typeof materialId !== 'string' || materialId.trim() === '') {
      return 'Setiap pemakaian bahan wajib menyertakan materialId.';
    }
  }
  return null;
}

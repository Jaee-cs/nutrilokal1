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

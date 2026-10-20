/**
 * Foto produk (informasi publik katalog & QR, README 5.6).
 *
 * Prinsip penyimpanan:
 * - Foto disimpan sebagai FILE di penyimpanan lokal backend, BUKAN base64 di
 *   database atau di respons API. Database hanya menyimpan path relatifnya.
 * - Nama file SELALU dibuat server (tidak pernah memakai nama kiriman klien),
 *   sehingga tidak ada celah path traversal; hasil akhir tetap diverifikasi
 *   agar berada di dalam direktori unggahan.
 * - Hanya tipe gambar yang diizinkan (whitelist MIME) DAN isi berkasnya
 *   benar-benar diperiksa lewat magic bytes — tipe yang diklaim klien saja
 *   tidak dipercaya.
 * - Ukuran dibatasi (lihat MAX_PHOTO_BYTES).
 * - Tidak ada layanan eksternal/berbayar yang dipakai.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PHOTO_URL_PREFIX, photoFilePath, productPhotoDir } from '../config/uploads';

/** Nama file yang dibuat server: hex hash + uuid + ekstensi dari MIME. */
const SAFE_FILE_NAME = /^[a-f0-9]{16}-[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** Batas ukuran satu foto produk (5 MB). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Format gambar yang diterima beserta ekstensi file yang dipakai server. */
const ALLOWED_PHOTO_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export const ALLOWED_PHOTO_MIME_LIST = Object.keys(ALLOWED_PHOTO_MIME);

export const PHOTO_SIZE_MESSAGE = `Ukuran foto maksimal ${MAX_PHOTO_BYTES / (1024 * 1024)} MB.`;

export const PHOTO_TYPE_MESSAGE =
  'Tipe foto tidak didukung. Gunakan gambar JPG, PNG, atau WEBP.';

export const PHOTO_EMPTY_MESSAGE = 'File foto kosong. Pilih gambar JPG, PNG, atau WEBP.';

/**
 * Memeriksa isi berkas berdasarkan magic bytes: klaim MIME dari klien tidak
 * cukup. Mengembalikan MIME asli berkas, atau null bila tidak dikenali.
 */
export function detectImageMime(buffer: Buffer): keyof typeof ALLOWED_PHOTO_MIME | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export interface PhotoValidationResult {
  ok: boolean;
  /** Pesan kesalahan berbahasa Indonesia bila tidak valid. */
  message?: string;
  mime?: keyof typeof ALLOWED_PHOTO_MIME;
}

export function validatePhotoBuffer(buffer: Buffer): PhotoValidationResult {
  if (buffer.length === 0) {
    return { ok: false, message: PHOTO_EMPTY_MESSAGE };
  }
  if (buffer.length > MAX_PHOTO_BYTES) {
    return { ok: false, message: PHOTO_SIZE_MESSAGE };
  }
  const mime = detectImageMime(buffer);
  if (!mime) {
    return { ok: false, message: PHOTO_TYPE_MESSAGE };
  }
  return { ok: true, mime };
}

/**
 * Menyimpan foto produk dan mengembalikan path publiknya
 * (mis. `/api/uploads/products/<file>`). Nama file dibuat server:
 * `<hash isi>-<uuid>.<ext>` — aman dari path traversal dan tidak memakai
 * nama asli dari klien, tetapi tetap berubah bila isinya berubah.
 */
export async function saveProductPhoto(productId: string, buffer: Buffer, mime: string): Promise<string> {
  const extension = ALLOWED_PHOTO_MIME[mime];
  const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const fileName = `${digest}-${randomUUID()}${extension}`;
  const directory = productPhotoDir(productId);
  const filePath = path.join(directory, fileName);

  // Hasil akhir WAJIB tetap berada di dalam direktori foto produk ini.
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) {
    throw new Error('FOTO_PATH_TIDAK_VALID');
  }

  await mkdir(directory, { recursive: true });
  await writeFile(resolved, buffer);
  return `${PHOTO_URL_PREFIX}/products/${productId}/${fileName}`;
}

/**
 * Menghapus file foto milik produk. Path yang tidak dikenal (file lama yang
 * sudah hilang, atau path di luar direktori unggahan) diabaikan tanpa error
 * agar penghapusan tetap berhasil dan tidak menghapus berkas lain.
 */
export async function removeProductPhoto(photoUrl: string | null | undefined): Promise<void> {
  if (!photoUrl) {
    return;
  }
  const filePath = resolveStoredPhotoPath(photoUrl);
  if (!filePath) {
    return;
  }
  try {
    await unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Mengubah path tersimpan menjadi lokasi berkas di disk. Mengembalikan null
 * bila path tidak berada di bawah direktori unggahan produk — mencegah
 * penghapusan berkas di luar direktori tersebut (path traversal).
 */
export function resolveStoredPhotoPath(photoUrl: string): string | null {
  if (!photoUrl.startsWith(`${PHOTO_URL_PREFIX}/products/`)) {
    return null;
  }

  // Hanya bentuk path yang dibuat server sendiri yang diterima: nama produk
  // dan nama file tidak boleh memuat pemisah path, `..`, atau nama lain.
  const segments = photoUrl.slice(`${PHOTO_URL_PREFIX}/products/`.length).split('/');
  if (segments.length !== 2 || !SAFE_FILE_NAME.test(segments[1])) {
    return null;
  }

  const filePath = photoFilePath(photoUrl);
  if (!filePath) {
    return null;
  }

  // Path tersimpan harus tepat berada di direktori foto produk tersebut.
  const directory = productPhotoDir(segments[0]);
  if (!filePath.startsWith(`${path.resolve(directory)}${path.sep}`)) {
    return null;
  }
  return filePath;
}

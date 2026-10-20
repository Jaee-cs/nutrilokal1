/**
 * Klien Cloudinary untuk penyimpanan foto produk.
 *
 * Kredensial HANYA dibaca dari environment (CLOUDINARY_CLOUD_NAME,
 * CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET) dan tidak pernah ditulis di
 * source code. Semua unggahan dilakukan di backend — API secret tidak pernah
 * dikirim ke frontend, dan frontend tidak menerima signature apa pun.
 *
 * Bila kredensial belum lengkap, `isCloudinaryEnabled()` bernilai false dan
 * pemanggil memakai penyimpanan lokal (lihat lib/product-photo.ts).
 */
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env';

let configured = false;

/** Aktifkan konfigurasi Cloudinary sekali saja (idempoten). */
function ensureConfigured(): void {
  if (configured || !env.CLOUDINARY.configured) {
    return;
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY.cloudName,
    api_key: env.CLOUDINARY.apiKey,
    api_secret: env.CLOUDINARY.apiSecret,
    secure: true,
  });
  configured = true;
}

/** Apakah Cloudinary dikonfigurasi lengkap dan siap dipakai. */
export function isCloudinaryEnabled(): boolean {
  return env.CLOUDINARY.configured;
}

/** Folder induk unggahan di Cloudinary; semua foto produk berada di bawahnya. */
export const CLOUDINARY_FOLDER = 'nutrilokal/products';

export interface CloudinaryUploadResult {
  /** URL publik (https) foto. */
  secureUrl: string;
  /** Public ID untuk penghapusan/penimpaan berikutnya. */
  publicId: string;
}

/**
 * Mengunggah buffer gambar ke Cloudinary. `productId` dipakai sebagai nama
 * folder agar foto tiap produk terkelompok. Nama berkas dibuat Cloudinary
 * (bukan nama kiriman klien), sehingga tidak ada celah path traversal.
 */
export function uploadProductPhotoToCloudinary(
  productId: string,
  buffer: Buffer
): Promise<CloudinaryUploadResult> {
  ensureConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `${CLOUDINARY_FOLDER}/${productId}`,
        resource_type: 'image',
        // Batasi agar unggahan tidak liar; ukuran berkas sudah dibatasi di
        // validator sebelum fungsi ini dipanggil.
        unique_filename: true,
        overwrite: false,
        invalidate: true,
      },
      (error, result) => {
        if (error || !result) {
          reject(error instanceof Error ? error : new Error('CLOUDINARY_UPLOAD_GAGAL'));
          return;
        }
        resolve({ secureUrl: result.secure_url, publicId: result.public_id });
      }
    );

    stream.on('error', (error) => reject(error));
    stream.end(buffer);
  });
}

/**
 * Menghapus foto di Cloudinary berdasarkan public ID. Kesalahan (mis. foto
 * sudah tidak ada) tidak dilempar agar penghapusan data tetap berhasil.
 */
export async function destroyCloudinaryPhoto(publicId: string): Promise<void> {
  if (!publicId) {
    return;
  }
  ensureConfigured();
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', invalidate: true });
  } catch (error) {
    console.error('[cloudinary] gagal menghapus foto', publicId, error);
  }
}

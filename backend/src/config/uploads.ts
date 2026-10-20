/**
 * Lokasi penyimpanan foto produk (unggahan file).
 *
 * - Default: folder `uploads/` di root backend (di luar `src`), sehingga
 *   `tsc` tidak menyentuhnya dan `tsx watch` tidak restart saat file ditulis.
 * - Dapat diarahkan ke volume/direktori persisten lewat `UPLOADS_DIR`
 *   (mis. mount volume di deployment). Isi direktori ini WAJIB ikut dicadangkan
 *   (backup) bersama database karena tidak tersimpan di dalam database.
 * - URL publik foto memakai prefiks `/api/uploads` supaya tetap satu origin
 *   dengan API (proxy `/api` di pengembangan maupun produksi).
 */
import path from 'node:path';

/** Prefiks URL publik untuk berkas unggahan. */
export const PHOTO_URL_PREFIX = '/api/uploads';

/** Direktori akar penyimpanan unggahan (absolut). */
export function uploadsRoot(): string {
  const configured = process.env.UPLOADS_DIR?.trim();
  return configured ? path.resolve(configured) : path.resolve(__dirname, '../../uploads');
}

/** Direktori foto untuk satu produk. `productId` berasal dari database (cuid). */
export function productPhotoDir(productId: string): string {
  return path.join(uploadsRoot(), 'products', productId);
}

/**
 * Mengubah path publik tersimpan (`/api/uploads/products/<id>/<file>`) menjadi
 * lokasi berkas absolut. Mengembalikan null bila bentuk path tidak dikenal
 * atau hasilnya keluar dari direktori unggahan (proteksi path traversal).
 */
export function photoFilePath(publicPath: string): string | null {
  const prefix = `${PHOTO_URL_PREFIX}/`;
  if (!publicPath.startsWith(prefix)) {
    return null;
  }

  const relative = publicPath.slice(prefix.length);
  // Tolak segmen kosong, `..`, atau pemisah path pada nama yang dikirim.
  const segments = relative.split('/');
  if (segments.length === 0 || segments.some((segment) => segment === '' || segment === '..' || segment.includes('\\'))) {
    return null;
  }

  const root = uploadsRoot();
  const resolved = path.resolve(root, ...segments);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
}

/**
 * Konfigurasi aplikasi Express.
 * createApp() mengembalikan instance app tanpa memulai server,
 * sehingga bisa dipakai juga oleh pengujian (supertest).
 */
import express from 'express';
import { PHOTO_URL_PREFIX, uploadsRoot } from './config/uploads';
import { ensureMaterialHistoryCheckRegistered } from './lib/material-history';
import { ensureProductHistoryCheckRegistered } from './lib/product-history';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { apiRouter } from './routes';

// Pemeriksa riwayat operasional master (README 5.1) — dipakai endpoint
// hapus/ubah satuan master produk dan bahan baku.
ensureMaterialHistoryCheckRegistered();
ensureProductHistoryCheckRegistered();

export function createApp(): express.Express {
  const app = express();

  // Sembunyikan identitas framework dari header respons (info minim).
  app.disable('x-powered-by');

  // Middleware: membaca body JSON dari request.
  app.use(express.json());

  // Foto produk (berkas unggahan) disajikan SEBELUM router API agar halaman
  // publik (katalog & QR tanpa login) dan frontend dapat memuat gambarnya
  // tanpa token. Path traversal ditolak: hanya berkas di dalam direktori
  // unggahan yang dilayani, dan dotfile tidak pernah dikirim.
  app.use(
    PHOTO_URL_PREFIX,
    express.static(uploadsRoot(), {
      dotfiles: 'ignore',
      index: false,
      fallthrough: false,
      maxAge: '1h',
    })
  );

  // Semua endpoint API berada di bawah /api.
  app.use('/api', apiRouter);

  // Penanganan 404 dan error harus dipasang paling akhir.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

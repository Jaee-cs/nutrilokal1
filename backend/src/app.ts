/**
 * Konfigurasi aplikasi Express.
 * createApp() mengembalikan instance app tanpa memulai server,
 * sehingga bisa dipakai juga oleh pengujian (supertest).
 */
import express from 'express';
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

  // Middleware: membaca body JSON dari request.
  app.use(express.json());

  // Semua endpoint API berada di bawah /api.
  app.use('/api', apiRouter);

  // Penanganan 404 dan error harus dipasang paling akhir.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

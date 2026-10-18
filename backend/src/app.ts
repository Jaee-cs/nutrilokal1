/**
 * Konfigurasi aplikasi Express.
 * createApp() mengembalikan instance app tanpa memulai server,
 * sehingga bisa dipakai juga oleh pengujian (supertest).
 */
import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { apiRouter } from './routes';

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

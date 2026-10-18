/**
 * Penanganan error tingkat aplikasi.
 * - notFoundHandler: untuk path yang tidak dikenal (404).
 * - errorHandler: penangkap error tak terduga dari route (500).
 */
import type { NextFunction, Request, Response } from 'express';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ message: 'Endpoint tidak ditemukan.' });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[error]', err);
  res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
}

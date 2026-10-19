/**
 * Penanganan error tingkat aplikasi.
 * - notFoundHandler: untuk path yang tidak dikenal (404).
 * - errorHandler: penangkap error tak terduga dari route (500) dan error
 *   permintaan dari body-parser (JSON tidak valid, payload terlalu besar).
 */
import type { NextFunction, Request, Response } from 'express';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ message: 'Endpoint tidak ditemukan.' });
}

/**
 * Ambil status 4xx bila error membawa status client-error (error dari
 * body-parser memuat `status` 400/413/415). Kode aplikasi sendiri tidak
 * pernah melempar error ber-status — route menangani respons secara langsung.
 */
function clientErrorStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const candidate = (err as { status?: unknown; statusCode?: unknown }).status
    ?? (err as { statusCode?: unknown }).statusCode;
  if (typeof candidate === 'number' && candidate >= 400 && candidate < 500) {
    return candidate;
  }
  return undefined;
}

/** Pesan generik berbahasa Indonesia — tanpa detail internal atau isi payload. */
function clientErrorMessage(status: number): string {
  if (status === 400) {
    return 'Format body permintaan tidak valid.';
  }
  if (status === 413) {
    return 'Ukuran permintaan terlalu besar.';
  }
  if (status === 415) {
    return 'Tipe konten permintaan tidak didukung.';
  }
  return 'Permintaan tidak valid.';
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log lengkap hanya di sisi server untuk penelusuran.
  console.error('[error]', err);

  const clientStatus = clientErrorStatus(err);
  if (clientStatus !== undefined) {
    res.status(clientStatus).json({ message: clientErrorMessage(clientStatus) });
    return;
  }

  // Kegagalan tak terduga (termasuk query database): pesan generik —
  // tanpa stack trace, rahasia, atau detail internal.
  res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
}

/**
 * Middleware CORS (Cross-Origin Resource Sharing).
 *
 * Backend dan frontend dapat berjalan di origin berbeda saat deployment
 * (mis. backend web service & frontend statis di Render). Tanpa header CORS,
 * browser memblokir request API lintas origin — termasuk login.
 *
 * Origin yang diizinkan dibaca dari env FRONTEND_ORIGIN (dipisah koma).
 * Bila tidak ada origin yang dikonfigurasi, CORS tidak diaktifkan sehingga
 * perilaku pengembangan same-origin tetap sama seperti sebelumnya.
 *
 * Tidak memakai dependensi baru; hanya header respons dan penanganan
 * preflight OPTIONS (yang harus dijawab sebelum router API, karena router
 * tidak mendefinisikan handler OPTIONS).
 */
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

const ALLOWED_METHODS = 'GET,POST,PATCH,PUT,DELETE,OPTIONS';

/** Header request yang dipakai aplikasi (Authorization untuk JWT, dll.). */
const ALLOWED_HEADERS = 'Content-Type,Authorization,Idempotency-Key';

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;

  // Tanpa konfigurasi origin → tidak ada header CORS (same-origin saja).
  if (env.FRONTEND_ORIGINS.length > 0 && typeof origin === 'string') {
    if (env.FRONTEND_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      // Vary: Origin agar cache tidak keliru menyajikan respons lintas origin.
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '86400');
    }
  }

  // Jawab preflight lebih awal bila origin diizinkan.
  if (req.method === 'OPTIONS') {
    res.sendStatus(res.getHeader('Access-Control-Allow-Origin') ? 204 : 403);
    return;
  }

  next();
}

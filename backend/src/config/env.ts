/**
 * Memuat dan memvalidasi konfigurasi dari environment variables.
 * Semua nilai rahasia (kredensial database, dll.) harus datang dari
 * file .env — tidak pernah ditulis langsung di source code.
 */
import 'dotenv/config';

const rawPort = process.env.PORT;
const port = rawPort === undefined || rawPort === '' ? 3000 : Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('PORT harus berupa angka antara 1 dan 65535.');
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL belum diatur. Salin file .env.example menjadi .env lalu isi nilai koneksi database.'
  );
}

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error(
    'JWT_SECRET belum diatur atau terlalu pendek (minimal 32 karakter). ' +
      'Buat nilai acak dengan: openssl rand -hex 32'
  );
}

/**
 * Daftar origin frontend yang diizinkan memanggil API lintas domain (CORS).
 *
 * Di produksi frontend dan backend dapat berada di domain berbeda
 * (mis. frontend statis di Render, backend web service di Render). Isi
 * FRONTEND_ORIGIN dengan satu atau beberapa origin dipisah koma, contoh:
 *   FRONTEND_ORIGIN="https://nutrilokal.onrender.com,http://localhost:5173"
 * Bila kosong, CORS dinonaktifkan (perilaku pengembangan same-origin).
 */
const frontendOrigins = (process.env.FRONTEND_ORIGIN ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

export const env = {
  PORT: port,
  DATABASE_URL: databaseUrl,
  JWT_SECRET: jwtSecret,
  FRONTEND_ORIGINS: frontendOrigins,
} as const;

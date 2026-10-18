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

export const env = {
  PORT: port,
  DATABASE_URL: databaseUrl,
} as const;

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

/**
 * Konfigurasi Cloudinary (penyimpanan foto produk).
 *
 * Cloudinary dipakai bila KETIGA nilai terisi. Bila salah satu kosong,
 * aplikasi otomatis memakai penyimpanan lokal seperti sebelumnya — sehingga
 * pengembangan lokal dan VPS tanpa Cloudinary tetap berjalan.
 *
 * Kredensial hanya dibaca dari environment dan tidak pernah ditulis di source
 * code. Di backend, API secret tidak pernah dikirim ke frontend.
 */
const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? '';
const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY?.trim() ?? '';
const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET?.trim() ?? '';

const cloudinaryConfigured = Boolean(
  cloudinaryCloudName && cloudinaryApiKey && cloudinaryApiSecret
);

export const env = {
  PORT: port,
  DATABASE_URL: databaseUrl,
  JWT_SECRET: jwtSecret,
  FRONTEND_ORIGINS: frontendOrigins,
  CLOUDINARY: {
    configured: cloudinaryConfigured,
    cloudName: cloudinaryCloudName,
    apiKey: cloudinaryApiKey,
    apiSecret: cloudinaryApiSecret,
  },
} as const;

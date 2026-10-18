/**
 * Skrip bootstrap akun Admin pertama.
 *
 * Tidak ada pendaftaran publik. Akun Admin pertama disiapkan melalui
 * konfigurasi awal yang aman — kredensial TIDAK ditanam di kode:
 *
 *   1. Isi ADMIN_USERNAME dan ADMIN_PASSWORD di file .env (lokal).
 *   2. Jalankan: npm run admin:create
 *   3. Setelah berhasil, hapus ADMIN_PASSWORD dari .env.
 *
 * Skrip menolak dijalankan jika sudah ada akun Admin.
 */
import '../config/env';
import { createInitialAdmin } from '../lib/bootstrap';
import { prisma } from '../lib/prisma';

async function main(): Promise<void> {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim();

  if (!username || !password) {
    throw new Error(
      'Isi ADMIN_USERNAME dan ADMIN_PASSWORD di file .env lalu jalankan: npm run admin:create'
    );
  }

  const admin = await createInitialAdmin({ username, password, name });
  console.log(`Akun Admin "${admin.username}" berhasil dibuat.`);
  console.log('Langkah selanjutnya: hapus ADMIN_PASSWORD dari file .env.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

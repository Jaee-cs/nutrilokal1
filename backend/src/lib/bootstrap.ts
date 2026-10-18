/**
 * Pembuatan akun Admin pertama.
 *
 * Tidak ada pendaftaran publik. Akun Admin pertama disiapkan melalui
 * konfigurasi awal yang aman — kredensial TIDAK ditanam di kode
 * (lihat src/scripts/create-admin.ts dan .env.example).
 */
import { MIN_PASSWORD_LENGTH, hashPassword } from './password';
import { prisma } from './prisma';

export async function createInitialAdmin(input: {
  username: string;
  password: string;
  name?: string;
}): Promise<{ id: string; username: string }> {
  const username = input.username.trim();

  if (username.length < 3 || username.length > 50) {
    throw new Error('Username harus 3-50 karakter.');
  }

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Kata sandi minimal ${MIN_PASSWORD_LENGTH} karakter.`);
  }

  const existingAdmin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

  if (existingAdmin) {
    throw new Error(
      'Akun Admin sudah ada. Pembuatan akun lain dilakukan oleh Admin melalui aplikasi.'
    );
  }

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword(input.password),
      name: input.name?.trim() || null,
      role: 'ADMIN',
    },
  });

  return { id: user.id, username: user.username };
}

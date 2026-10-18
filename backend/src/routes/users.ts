/**
 * Pengelolaan akun (hanya Admin, sesuai README):
 * - membuat, menonaktifkan, dan mengaktifkan kembali akun Operator
 * - menghapus akun Operator yang belum memiliki riwayat aktivitas
 * - memulai reset kata sandi (Admin tidak melihat kata sandi lama)
 *
 * Akun dengan riwayat aktivitas tidak boleh dihapus permanen.
 * Akun Admin tidak dapat dihapus melalui endpoint ini.
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { userHasActivityHistory } from '../lib/account-history';
import { hashPassword, validateNewPassword } from '../lib/password';
import { prisma } from '../lib/prisma';
import { toPublicUser } from '../lib/user';
import { authenticate, requireAdmin } from '../middleware/auth';

export const usersRouter = Router();

// Semua endpoint di router ini khusus Admin.
usersRouter.use(authenticate, requireAdmin);

const MAX_USERNAME_LENGTH = 50;

function validateUsername(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > MAX_USERNAME_LENGTH) {
    return `Username wajib berupa teks 3-${MAX_USERNAME_LENGTH} karakter.`;
  }
  return null;
}

usersRouter.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  res.json({ data: users.map(toPublicUser) });
});

usersRouter.post('/', async (req, res) => {
  const { username, password, name } = req.body ?? {};

  // Peran akun baru selalu Operator; Admin dibuat hanya melalui
  // bootstrap awal (npm run admin:create), bukan melalui API.
  if (req.body?.role !== undefined) {
    res.status(400).json({ message: 'Peran akun baru hanya dapat berupa OPERATOR.' });
    return;
  }

  const usernameError = validateUsername(username);
  if (usernameError) {
    res.status(400).json({ message: usernameError });
    return;
  }

  const passwordError = validateNewPassword(password);
  if (passwordError) {
    res.status(400).json({ message: passwordError });
    return;
  }

  if (name !== undefined && (typeof name !== 'string' || name.trim().length > 100)) {
    res.status(400).json({ message: 'Nama harus berupa teks maksimal 100 karakter.' });
    return;
  }

  try {
    const user = await prisma.user.create({
      data: {
        username: username.trim(),
        passwordHash: await hashPassword(password),
        name: typeof name === 'string' && name.trim() !== '' ? name.trim() : null,
        role: 'OPERATOR',
      },
    });
    res.status(201).json({ user: toPublicUser(user) });
  } catch (error) {
    // Constraint unik username di database menangani kasus bersamaan.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ message: 'Username sudah digunakan.' });
      return;
    }
    throw error;
  }
});

usersRouter.patch('/:id', async (req, res) => {
  const { isActive } = req.body ?? {};

  if (typeof isActive !== 'boolean') {
    res.status(400).json({ message: 'Field isActive wajib berupa boolean.' });
    return;
  }

  const target = await prisma.user.findUnique({ where: { id: req.params.id } });

  if (!target) {
    res.status(404).json({ message: 'Akun tidak ditemukan.' });
    return;
  }

  // Mencegah Admin menonaktifkan akunnya sendiri dan mengunci akses sistem.
  if (!isActive && target.id === req.user!.id) {
    res.status(400).json({ message: 'Akun Anda sendiri tidak dapat dinonaktifkan.' });
    return;
  }

  const user = await prisma.user.update({ where: { id: target.id }, data: { isActive } });
  res.json({ user: toPublicUser(user) });
});

usersRouter.delete('/:id', async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });

  if (!target) {
    res.status(404).json({ message: 'Akun tidak ditemukan.' });
    return;
  }

  if (target.id === req.user!.id) {
    res.status(400).json({ message: 'Akun Anda sendiri tidak dapat dihapus.' });
    return;
  }

  if (target.role === 'ADMIN') {
    res.status(403).json({ message: 'Akun Admin tidak dapat dihapus.' });
    return;
  }

  if (await userHasActivityHistory(target.id)) {
    res.status(409).json({
      message: 'Akun memiliki riwayat aktivitas dan tidak boleh dihapus permanen. Nonaktifkan akun sebagai gantinya.',
    });
    return;
  }

  await prisma.user.delete({ where: { id: target.id } });
  res.json({ message: `Akun "${target.username}" berhasil dihapus.` });
});

usersRouter.post('/:id/password-reset', async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });

  if (!target) {
    res.status(404).json({ message: 'Akun tidak ditemukan.' });
    return;
  }

  // Kata sandi sementara dibuat acak dan hanya ditampilkan SEKALI ini.
  // Kata sandi lama tidak pernah dilihat atau dikirim oleh sistem.
  const temporaryPassword = `NL-${randomBytes(8).toString('hex')}`;

  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true },
  });

  res.json({
    message:
      'Reset kata sandi dimulai. Berikan kata sandi sementara ini kepada pengguna; ' +
      'pengguna wajib menetapkan kata sandi baru sebelum dapat menggunakan sistem kembali.',
    temporaryPassword,
  });
});

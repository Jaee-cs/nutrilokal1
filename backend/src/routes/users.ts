/**
 * Pengelolaan akun (hanya Admin, sesuai README):
 * - membuat, menonaktifkan/mengarsipkan, dan mengaktifkan kembali akun Operator
 * - memulai reset kata sandi (Admin tidak melihat kata sandi lama)
 *
 * Penghapusan permanen tidak tersedia: DELETE kini mengarsipkan akun Operator.
 * Riwayat aktivitas tidak pernah dihapus. Akun Admin dan akun sendiri tidak
 * dapat diarsipkan lewat endpoint ini.
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import {
  ACTIVITY_RELATION_COUNTS,
  countsIndicateActivity,
} from '../lib/account-history';
import { archiveUser, checkRestoreConflict, parseArchiveReason } from '../lib/archive';
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
  // Daftar pengguna aktif saja. Akun arsip tidak bisa login dan dikelola
  // dari halaman Arsip Admin dengan identitas serta riwayat yang masih utuh.
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: ACTIVITY_RELATION_COUNTS } },
  });

  // Kunci idempotensi tidak memiliki relasi FK ke User; hitung terpisah
  // supaya penanda riwayat di UI sama dengan pemeriksaan saat penghapusan.
  const idempotencyCounts = await prisma.idempotencyKey.groupBy({
    by: ['userId'],
    where: { userId: { in: users.map((user) => user.id) } },
    _count: { _all: true },
  });
  const idempotencyByUser = new Map(
    idempotencyCounts.map((row) => [row.userId, row._count._all])
  );

  res.json({
    data: users.map((user) =>
      toPublicUser(user, {
        hasActivityHistory:
          countsIndicateActivity(user._count) ||
          (idempotencyByUser.get(user.id) ?? 0) > 0,
      })
    ),
  });
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

  // Arsipkan akun Admin lain melalui endpoint Arsip yang punya aturan
  // keamanan eksplisit; PATCH lama hanya untuk Operator.
  if (!isActive && target.role === 'ADMIN') {
    res.status(403).json({ message: 'Akun Admin tidak dapat diarsipkan.' });
    return;
  }

  if (isActive) {
    const conflict = await checkRestoreConflict(prisma, 'user', {
      id: target.id,
      username: target.username,
    });
    if (conflict) {
      res.status(conflict.status).json({ message: conflict.message });
      return;
    }
  }

  const user = await prisma.user.update({
    where: { id: target.id },
    data: {
      isActive,
      archivedAt: isActive ? null : target.archivedAt ?? new Date(),
      archivedById: isActive ? null : target.archivedById ?? req.user!.id,
      archiveReason: isActive ? null : target.archiveReason ?? null,
    },
  });
  res.json({ user: toPublicUser(user) });
});

/**
 * Kompatibilitas endpoint lama: DELETE kini SELALU mengarsipkan akun Operator,
 * bukan menghapusnya. Identitas dan riwayat tetap utuh, dan token lama langsung
 * ditolak karena middleware memeriksa isActive tiap request.
 */
usersRouter.delete('/:id', async (req, res) => {
  const reason = parseArchiveReason(req.body?.reason);
  if (!reason.ok) {
    res.status(400).json({ message: reason.message });
    return;
  }

  const result = await archiveUser(
    req.params.id,
    req.user!.id,
    reason.value,
    req.user!.id
  );
  if (!result.ok) {
    res.status(result.status).json({ message: result.message });
    return;
  }

  res.json({
    message: result.unchanged
      ? `Akun "${result.data.username}" sudah diarsipkan.`
      : `Akun "${result.data.username}" diarsipkan. Riwayat aktivitas tetap tersimpan.`,
    ...(result.warning ? { warning: result.warning } : {}),
    archived: true,
    user: toPublicUser(result.data),
  });
});

usersRouter.post('/:id/password-reset', async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });

  if (!target) {
    res.status(404).json({ message: 'Akun tidak ditemukan.' });
    return;
  }

  // Kata sandi sementara dibuat acak kuat (96 bit) dan hanya ditampilkan
  // SEKALI ini. Kata sandi lama tidak pernah dilihat atau dikirim oleh sistem.
  const temporaryPassword = `NL-${randomBytes(12).toString('base64url')}`;

  await prisma.user.update({
    where: { id: target.id },
    data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true },
  });

  res.set('Cache-Control', 'no-store');
  res.json({
    message:
      'Kata sandi berhasil direset. Sesi login lama akun ini sudah tidak berlaku. ' +
      'Berikan kata sandi sementara ini kepada pengguna; pengguna wajib menetapkan ' +
      'kata sandi baru sebelum dapat menggunakan sistem kembali.',
    temporaryPassword,
  });
});

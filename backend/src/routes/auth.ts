/**
 * Endpoint autentikasi: login, identitas pengguna, dan penyetelan
 * kata sandi baru (untuk pengguna yang direset oleh Admin).
 * Tidak ada pendaftaran publik — akun hanya dibuat oleh Admin.
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { hashPassword, validateNewPassword, verifyPassword } from '../lib/password';
import { toPublicUser } from '../lib/user';
import { authenticate, authenticateAllowPendingPasswordChange } from '../middleware/auth';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== 'string' || username.trim() === '' || typeof password !== 'string' || password === '') {
    res.status(400).json({ message: 'Username dan kata sandi wajib diisi.' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { username: username.trim() } });

  // Pesan yang sama untuk username salah atau kata sandi salah,
  // agar keberadaan akun tidak bisa ditebak pihak luar.
  const invalid = { message: 'Username atau kata sandi salah.' };

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json(invalid);
    return;
  }

  if (!user.isActive) {
    res.status(403).json({ message: 'Akun Anda sudah dinonaktifkan. Hubungi Admin.' });
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  res.json({
    token: signToken({ sub: user.id, role: user.role }),
    user: toPublicUser(user),
  });
});

authRouter.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

  if (!user) {
    res.status(401).json({ message: 'Akun tidak ditemukan atau sudah dinonaktifkan.' });
    return;
  }

  res.json({ user: toPublicUser(user) });
});

authRouter.post('/set-password', authenticateAllowPendingPasswordChange, async (req, res) => {
  const { newPassword } = req.body ?? {};

  const passwordError = validateNewPassword(newPassword);
  if (passwordError) {
    res.status(400).json({ message: passwordError });
    return;
  }

  await prisma.user.update({
    where: { id: req.user!.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });

  res.json({ message: 'Kata sandi berhasil diperbarui. Gunakan kata sandi baru untuk login berikutnya.' });
});

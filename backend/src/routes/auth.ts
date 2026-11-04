/**
 * Endpoint autentikasi: login, identitas pengguna, dan penyetelan
 * kata sandi baru (untuk pengguna yang direset oleh Admin).
 * Tidak ada pendaftaran publik — akun hanya dibuat oleh Admin.
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { signToken } from '../lib/jwt';
import { hashPassword, passwordFingerprint, validateNewPassword, verifyPassword } from '../lib/password';
import { toPublicUser } from '../lib/user';
import { authenticateAllowPendingPasswordChange } from '../middleware/auth';

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

  // Respons berisi token/kredensial tidak boleh disimpan cache HTTP.
  res.set('Cache-Control', 'no-store');
  res.json({
    token: signToken({ sub: user.id, role: user.role, pwd: passwordFingerprint(user.passwordHash) }),
    user: toPublicUser(user),
  });
});

// /me harus tetap bisa diakses saat mustChangePassword=true agar frontend
// dapat memulihkan sesi setelah refresh dan mengetahui bahwa pengguna wajib
// mengganti kata sandi. Endpoint operasional tetap diblokir oleh authenticate.
authRouter.get('/me', authenticateAllowPendingPasswordChange, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });

  if (!user) {
    res.status(401).json({ message: 'Akun tidak ditemukan atau sudah dinonaktifkan.' });
    return;
  }

  res.json({ user: toPublicUser(user) });
});

authRouter.post('/set-password', authenticateAllowPendingPasswordChange, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (typeof currentPassword !== 'string' || currentPassword === '') {
    res.status(400).json({ message: 'Kata sandi saat ini wajib diisi.' });
    return;
  }

  const passwordError = validateNewPassword(newPassword);
  if (passwordError) {
    res.status(400).json({ message: passwordError });
    return;
  }

  // Endpoint ini hanya menargetkan akun pemilik token (req.user.id).
  // Operator tidak memiliki cara mengubah kata sandi akun lain di sini.
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) {
    res.status(401).json({ message: 'Akun tidak ditemukan atau sudah dinonaktifkan.' });
    return;
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    res.status(400).json({ message: 'Kata sandi saat ini salah.' });
    return;
  }

  if (await verifyPassword(newPassword, user.passwordHash)) {
    res.status(400).json({ message: 'Kata sandi baru harus berbeda dari kata sandi saat ini.' });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });

  // Kata sandi berubah → sidik jari token lama berubah. Terbitkan token baru
  // agar sesi yang sedang dipakai tetap berjalan dengan aman.
  res.set('Cache-Control', 'no-store');
  res.json({
    message: 'Kata sandi berhasil diperbarui.',
    token: signToken({ sub: updated.id, role: updated.role, pwd: passwordFingerprint(updated.passwordHash) }),
    user: toPublicUser(updated),
  });
});

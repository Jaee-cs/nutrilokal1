/**
 * Middleware autentikasi dan hak akses.
 *
 * Sesuai README, hak akses harus diperiksa di backend — frontend hanya
 * menyembunyikan tampilan, bukan sumber kebenaran. Status akun diperiksa
 * ulang dari database pada setiap request agar penonaktifan akun dan
 * reset kata sandi langsung berlaku.
 */
import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

type AuthResult = { user: AuthUser; error?: undefined } | { user?: undefined; error: { status: number; message: string } };

async function resolveAuthUser(req: Request): Promise<AuthResult> {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return { error: { status: 401, message: 'Autentikasi diperlukan. Gunakan token Bearer yang valid.' } };
  }

  let sub: string;
  try {
    ({ sub } = verifyToken(header.slice('Bearer '.length)));
  } catch {
    return { error: { status: 401, message: 'Token tidak valid atau sudah kedaluwarsa.' } };
  }

  const user = await prisma.user.findUnique({ where: { id: sub } });

  if (!user || !user.isActive) {
    return { error: { status: 401, message: 'Akun tidak ditemukan atau sudah dinonaktifkan.' } };
  }

  return { user: { id: user.id, username: user.username, role: user.role, mustChangePassword: user.mustChangePassword } };
}

/**
 * Wajibkan login valid dan aktif.
 * Menolak permintaan dari pengguna yang wajib menetapkan kata sandi baru
 * (hasil reset oleh Admin) kecuali hanya untuk endpoint set-password.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const result = await resolveAuthUser(req);

  if (!result.user) {
    res.status(result.error!.status).json({ message: result.error!.message });
    return;
  }

  if (result.user.mustChangePassword) {
    res.status(403).json({
      message: 'Anda harus menetapkan kata sandi baru sebelum menggunakan sistem kembali.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    return;
  }

  req.user = result.user;
  next();
}

/**
 * Seperti authenticate, tetapi mengizinkan pengguna yang wajib mengganti
 * kata sandi. Hanya dipakai oleh endpoint set-password.
 */
export async function authenticateAllowPendingPasswordChange(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const result = await resolveAuthUser(req);

  if (!result.user) {
    res.status(result.error!.status).json({ message: result.error!.message });
    return;
  }

  req.user = result.user;
  next();
}

/** Wajibkan peran Admin. Dipasang setelah authenticate. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ message: 'Hanya Admin yang dapat melakukan aksi ini.' });
    return;
  }
  next();
}

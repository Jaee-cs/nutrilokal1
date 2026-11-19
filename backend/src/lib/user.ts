/**
 * Representasi pengguna yang aman dikirim ke klien.
 * PasswordHash tidak pernah disertakan dalam respons API.
 */
import type { User } from '@prisma/client';

export interface PublicUser {
  id: string;
  username: string;
  name: string | null;
  role: 'ADMIN' | 'OPERATOR';
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  /** Arsip (soft archive). null = data aktif. */
  archivedAt: Date | null;
  archivedById: string | null;
  archiveReason: string | null;
  archivedByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Hanya diisi pada daftar pengguna Admin: true bila akun sudah memiliki
   * riwayat aktivitas. Riwayat tetap dipertahankan saat akun diarsipkan.
   */
  hasActivityHistory?: boolean;
}

export function toPublicUser(
  user: User,
  extras?: { hasActivityHistory?: boolean; archivedByName?: string | null }
): PublicUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    archivedAt: user.archivedAt,
    archivedById: user.archivedById,
    archiveReason: user.archiveReason,
    ...(extras?.archivedByName !== undefined ? { archivedByName: extras.archivedByName } : {}),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    ...(extras?.hasActivityHistory !== undefined
      ? { hasActivityHistory: extras.hasActivityHistory }
      : {}),
  };
}

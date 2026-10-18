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
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

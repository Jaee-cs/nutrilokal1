/**
 * Hash dan verifikasi kata sandi dengan bcrypt.
 * Kata sandi tidak pernah disimpan atau dikirim sebagai teks biasa.
 */
import bcrypt from 'bcryptjs';

/** Panjang minimum kata sandi. */
export const MIN_PASSWORD_LENGTH = 8;

const COST_FACTOR = 10;

export function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, COST_FACTOR);
}

export function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}

/** Memvalidasi kata sandi baru. Mengembalikan pesan error, atau null jika valid. */
export function validateNewPassword(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    return `Kata sandi wajib berupa teks minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  }
  return null;
}

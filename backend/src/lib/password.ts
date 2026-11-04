/**
 * Hash dan verifikasi kata sandi dengan bcrypt.
 * Kata sandi tidak pernah disimpan atau dikirim sebagai teks biasa.
 */
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';

/** Panjang minimum kata sandi. */
export const MIN_PASSWORD_LENGTH = 8;

const COST_FACTOR = 10;

export function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, COST_FACTOR);
}

/**
 * Sidik jari hash kata sandi untuk token login.
 *
 * Token membawa nilai ini dan middleware membandingkannya dengan hash
 * pengguna saat ini. Begitu kata sandi direset atau diganti, sidik jari
 * berubah sehingga seluruh token lama otomatis tidak berlaku — tanpa
 * menambah kolom/migrasi database dan tanpa menyimpan kata sandi.
 */
export function passwordFingerprint(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('base64url').slice(0, 22);
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

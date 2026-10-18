/**
 * Pembuatan dan verifikasi token JWT.
 * Token membawa id dan peran pengguna; rahasia tanda tangan ada di
 * environment variable JWT_SECRET, bukan di kode.
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
  /** User id. */
  sub: string;
  role: 'ADMIN' | 'OPERATOR';
}

/** Masa berlaku token login (satu hari kerja). */
const TOKEN_EXPIRES_IN = '8h';

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);

  if (
    typeof decoded === 'string' ||
    typeof decoded.sub !== 'string' ||
    (decoded.role !== 'ADMIN' && decoded.role !== 'OPERATOR')
  ) {
    throw new Error('Isi token tidak valid.');
  }

  return { sub: decoded.sub, role: decoded.role };
}

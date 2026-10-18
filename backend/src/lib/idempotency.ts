/**
 * Pencegahan permintaan berulang (README 5.4 dan 6: operasi stok harus
 * mencegah perubahan ganda akibat permintaan yang diulang).
 *
 * Klien dapat menyertakan header `Idempotency-Key` (opsional, maks 100 karakter).
 * Kunci disimpan DALAM TRANSAKSI yang sama dengan perubahan stok, sehingga:
 * - permintaan pertama: aksi dijalankan, kunci dan respons tersimpan;
 * - permintaan ulang dengan kunci sama: respons tersimpan dikembalikan
 *   TANPA menjalankan aksi lagi (stok tidak bertambah dua kali);
 * - permintaan bersamaan dengan kunci sama: satu berhasil, satu lagi
 *   ditolak unique constraint database lalu menerima respons tersimpan.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

const MAX_KEY_LENGTH = 100;

export function readIdempotencyKey(headerValue: unknown): string | null {
  if (headerValue === undefined) {
    return null;
  }
  const key = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof key !== 'string' || key.trim() === '' || key.length > MAX_KEY_LENGTH) {
    throw new Error(`Idempotency-Key harus berupa teks 1-${MAX_KEY_LENGTH} karakter.`);
  }
  return key;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Menjalankan operasi yang memengaruhi stok SEKALI per kunci idempotensi.
 * `operation` berjalan di dalam transaksi bersama pencatatan kunci.
 */
export async function runIdempotent<T>(
  input: { key: string | null; endpoint: string; userId: string },
  operation: (tx: Prisma.TransactionClient) => Promise<{ status: number; body: T }>
): Promise<IdempotentResult<T>> {
  if (input.key === null) {
    const result = await prisma.$transaction((tx) => operation(tx));
    return { ...result, replayed: false };
  }

  const where = {
    key_endpoint_userId: { key: input.key, endpoint: input.endpoint, userId: input.userId },
  };

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Permintaan ulang biasa: kunci sudah tercatat dari transaksi sebelumnya.
      const existing = await tx.idempotencyKey.findUnique({ where });
      if (existing) {
        return {
          status: existing.responseStatus,
          body: existing.responseBody as T,
          replayed: true,
        };
      }

      const fresh = await operation(tx);

      await tx.idempotencyKey.create({
        data: {
          key: input.key!,
          endpoint: input.endpoint,
          userId: input.userId,
          responseStatus: fresh.status,
          responseBody: fresh.body as Prisma.InputJsonValue,
        },
      });

      return { ...fresh, replayed: false };
    });

    return result;
  } catch (error) {
    // Permintaan BERSAMAAN dengan kunci sama: unique constraint menolak
    // kunci kedua sehingga transaksi keduanya di-rollback (stok tidak
    // terpengaruh). Ambil respons milik permintaan pertama.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.idempotencyKey.findUnique({ where });
      if (existing) {
        return {
          status: existing.responseStatus,
          body: existing.responseBody as T,
          replayed: true,
        };
      }
    }
    throw error;
  }
}

/**
 * Arsip (soft archive) NutriLokal.
 *
 * Arsip BUKAN penghapusan: baris yang sama diberi isActive = false plus
 * waktu, Admin, dan alasan. Pemulihan memakai baris dan ID yang sama.
 * Tidak ada tabel salinan dan tidak ada jalur penghapusan permanen.
 */
import { Prisma, type Material, type Product, type User } from '@prisma/client';
import { materialNameKey } from './material';
import { prisma } from './prisma';
import { getMaterialStock } from './stock';

export const ARCHIVE_REASON_MAX = 300;
export const ARCHIVE_PAGE_SIZE = 20;
export const ARCHIVE_MAX_PAGE_SIZE = 100;

export type ArchiveReasonResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

/** Alasan arsip opsional; kosong disimpan sebagai null. */
export function parseArchiveReason(value: unknown): ArchiveReasonResult {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, message: 'Alasan arsip harus berupa teks.' };
  }
  const trimmed = value.trim();
  if (trimmed.length > ARCHIVE_REASON_MAX) {
    return { ok: false, message: `Alasan arsip maksimal ${ARCHIVE_REASON_MAX} karakter.` };
  }
  return { ok: true, value: trimmed === '' ? null : trimmed };
}

/** Nilai yang ditulis saat mengarsipkan. */
export function archiveData(adminId: string, reason: string | null) {
  return {
    isActive: false,
    archivedAt: new Date(),
    archivedById: adminId,
    archiveReason: reason,
  };
}

/** Nilai yang ditulis saat memulihkan; identitas dan relasi tidak berubah. */
export function restoreData() {
  return {
    isActive: true,
    archivedAt: null,
    archivedById: null,
    archiveReason: null,
  };
}

export type RestoreConflict = { status: number; message: string };

type RestoreTarget = {
  id: string;
  name?: string | null;
  nameKey?: string;
  username?: string;
};

/**
 * Validasi konflik identitas sebelum pemulihan. Data arsip mempertahankan
 * kunci uniknya, jadi konflik hanya mungkin bila data arsip sudah diganti
 * namanya dan kunci lama dipakai data aktif. Pemulihan dibatalkan — tidak
 * pernah menimpa data aktif atau membuat duplikat.
 */
export async function checkRestoreConflict(
  tx: Prisma.TransactionClient,
  kind: 'product' | 'material' | 'user',
  target: RestoreTarget
): Promise<RestoreConflict | null> {
  if (kind === 'product') {
    const name = typeof target.name === 'string' ? target.name.trim() : '';
    if (!name) return null;
    const clash = await tx.product.findFirst({
      where: {
        isActive: true,
        id: { not: target.id },
        name: { equals: name, mode: 'insensitive' },
      },
      select: { name: true },
    });
    if (clash) {
      return {
        status: 409,
        message:
          `Nama produk "${name}" sudah dipakai produk aktif. ` +
          'Ubah nama produk arsip atau produk aktif tersebut, lalu ulangi pemulihan.',
      };
    }
    return null;
  }

  if (kind === 'material') {
    const key = target.nameKey ?? (target.name ? materialNameKey(target.name) : '');
    if (!key) return null;
    const clash = await tx.material.findFirst({
      where: { isActive: true, id: { not: target.id }, nameKey: key },
      select: { name: true },
    });
    if (clash) {
      return {
        status: 409,
        message:
          `Nama bahan baku "${clash.name}" sudah dipakai bahan aktif. ` +
          'Ubah nama bahan arsip atau bahan aktif tersebut, lalu ulangi pemulihan.',
      };
    }
    return null;
  }

  const username = typeof target.username === 'string' ? target.username.trim() : '';
  if (!username) return null;
  const clash = await tx.user.findFirst({
    where: { isActive: true, id: { not: target.id }, username },
    select: { username: true },
  });
  if (clash) {
    return {
      status: 409,
      message:
        `Nama pengguna "${username}" sudah dipakai akun aktif. ` +
        'Ubah nama pengguna akun arsip atau akun aktif tersebut, lalu ulangi pemulihan.',
    };
  }
  return null;
}

/** Tanggal arsip dari query (YYYY-MM-DD) dipakai untuk filter rentang. */
export function parseArchiveDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(time) ? null : new Date(time);
}

export type ArchiveDateFilter =
  | { ok: true; from?: Date; to?: Date }
  | { ok: false; message: string };

export function parseArchiveDateRange(from: unknown, to: unknown): ArchiveDateFilter {
  const fromDate = from === undefined || from === '' ? undefined : parseArchiveDate(from);
  const toDate = to === undefined || to === '' ? undefined : parseArchiveDate(to);
  if ((from !== undefined && from !== '' && !fromDate) || (to !== undefined && to !== '' && !toDate)) {
    return { ok: false, message: 'Tanggal harus berformat YYYY-MM-DD.' };
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    return { ok: false, message: 'Tanggal awal tidak boleh setelah tanggal akhir.' };
  }
  return {
    ok: true,
    ...(fromDate ? { from: fromDate } : {}),
    ...(toDate ? { to: new Date(toDate.getTime() + 86_399_999) } : {}),
  };
}

/**
 * Filter archivedAt. Tanpa rentang tanggal, semua baris isActive = false
 * ikut tampil — termasuk data lama yang dinonaktifkan sebelum kolom arsip
 * ada (archivedAt masih null) agar tidak hilang dari halaman Arsip.
 */
export function archiveDateWhere(range: { from?: Date; to?: Date }): Prisma.DateTimeFilter {
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lte: range.to } : {}),
  };
}

function positiveInt(value: unknown, fallback: number, max?: number): number {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

export function parseArchivePagination(query: Record<string, unknown>) {
  const page = positiveInt(query.page, 1);
  const pageSize = positiveInt(query.pageSize, ARCHIVE_PAGE_SIZE, ARCHIVE_MAX_PAGE_SIZE);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function searchTerm(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}

// ---------------------------------------------------------------------------
// Operasi arsip/pulihkan — satu transaksi per aksi.
// ---------------------------------------------------------------------------

export type ArchiveResult<T> =
  | { ok: true; data: T; warning?: string; unchanged?: boolean }
  | { ok: false; status: number; message: string };

function failed(status: number, message: string): ArchiveResult<never> {
  return { ok: false, status, message };
}

function isUniqueRace(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const UNIQUE_RACE_MESSAGE =
  'Data bentrok dengan data aktif lain saat pemulihan. Muat ulang halaman Arsip dan coba lagi.';

/** Mengarsipkan produk. Stok tidak dikurangi; hanya diberikan peringatan. */
export async function archiveProduct(
  id: string,
  adminId: string,
  reason: string | null
): Promise<ArchiveResult<Product>> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.product.findUnique({ where: { id } });
    if (!target) return failed(404, 'Produk tidak ditemukan.');
    if (!target.isActive) return { ok: true, data: target, unchanged: true };

    const totals = await tx.batch.aggregate({
      where: { productId: id },
      _sum: { stockQuantity: true },
    });
    const stock = Number(totals._sum.stockQuantity ?? 0);
    const updated = await tx.product.update({
      where: { id },
      data: archiveData(adminId, reason),
    });

    const warning =
      stock > 0
        ? `Produk ini masih memiliki stok ${stock.toLocaleString('id-ID')} ${target.unit}. ` +
          'Stok dan batch tidak diubah saat diarsipkan.'
        : undefined;
    return { ok: true, data: updated, ...(warning ? { warning } : {}) };
  });
}

/** Memulihkan produk yang sama (ID tidak berubah) setelah cek konflik nama. */
export async function restoreProduct(id: string): Promise<ArchiveResult<Product>> {
  try {
    return await prisma.$transaction(async (tx) => {
      const target = await tx.product.findUnique({ where: { id } });
      if (!target) return failed(404, 'Produk tidak ditemukan.');
      if (target.isActive) return { ok: true, data: target, unchanged: true };

      const conflict = await checkRestoreConflict(tx, 'product', target);
      if (conflict) return failed(conflict.status, conflict.message);

      const updated = await tx.product.update({ where: { id }, data: restoreData() });
      return { ok: true, data: updated };
    });
  } catch (error) {
    if (isUniqueRace(error)) return failed(409, UNIQUE_RACE_MESSAGE);
    throw error;
  }
}

/** Mengarsipkan bahan baku; saldo dan riwayat tidak disentuh. */
export async function archiveMaterial(
  id: string,
  adminId: string,
  reason: string | null
): Promise<ArchiveResult<Material>> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.material.findUnique({ where: { id } });
    if (!target) return failed(404, 'Bahan baku tidak ditemukan.');
    if (!target.isActive) return { ok: true, data: target, unchanged: true };

    const stock = await getMaterialStock(tx, id);
    const updated = await tx.material.update({
      where: { id },
      data: archiveData(adminId, reason),
    });

    const warning =
      stock > 0
        ? `Bahan baku ini masih memiliki saldo stok ${stock.toLocaleString('id-ID')} ${target.unit}. ` +
          'Saldo dan riwayat penerimaan/pemakaian tidak dihapus atau diubah.'
        : undefined;
    return { ok: true, data: updated, ...(warning ? { warning } : {}) };
  });
}

/** Memulihkan bahan baku yang sama setelah cek konflik nameKey. */
export async function restoreMaterial(id: string): Promise<ArchiveResult<Material>> {
  try {
    return await prisma.$transaction(async (tx) => {
      const target = await tx.material.findUnique({ where: { id } });
      if (!target) return failed(404, 'Bahan baku tidak ditemukan.');
      if (target.isActive) return { ok: true, data: target, unchanged: true };

      const conflict = await checkRestoreConflict(tx, 'material', target);
      if (conflict) return failed(conflict.status, conflict.message);

      const updated = await tx.material.update({ where: { id }, data: restoreData() });
      return { ok: true, data: updated };
    });
  } catch (error) {
    if (isUniqueRace(error)) return failed(409, UNIQUE_RACE_MESSAGE);
    throw error;
  }
}

/**
 * Mengarsipkan akun Operator. Akun sendiri dan akun Admin tidak pernah
 * diarsipkan lewat jalur ini (aturan keamanan yang sudah berlaku).
 * Token lama otomatis ditolak karena middleware memeriksa isActive tiap request.
 */
export async function archiveUser(
  id: string,
  adminId: string,
  reason: string | null,
  actorId: string
): Promise<ArchiveResult<User>> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id } });
    if (!target) return failed(404, 'Akun tidak ditemukan.');
    if (id === actorId) return failed(400, 'Akun Anda sendiri tidak dapat diarsipkan.');
    if (target.role === 'ADMIN') return failed(403, 'Akun Admin tidak dapat diarsipkan.');
    if (!target.isActive) return { ok: true, data: target, unchanged: true };

    const updated = await tx.user.update({
      where: { id },
      data: archiveData(adminId, reason),
    });
    return {
      ok: true,
      data: updated,
      warning: 'Sesi akun ini langsung dicabut; riwayat aktivitas tetap tersimpan.',
    };
  });
}

/** Memulihkan akun yang sama setelah cek konflik username. */
export async function restoreUser(id: string): Promise<ArchiveResult<User>> {
  try {
    return await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) return failed(404, 'Akun tidak ditemukan.');
      if (target.isActive) return { ok: true, data: target, unchanged: true };

      const conflict = await checkRestoreConflict(tx, 'user', target);
      if (conflict) return failed(conflict.status, conflict.message);

      const updated = await tx.user.update({ where: { id }, data: restoreData() });
      return { ok: true, data: updated };
    });
  } catch (error) {
    if (isUniqueRace(error)) return failed(409, UNIQUE_RACE_MESSAGE);
    throw error;
  }
}

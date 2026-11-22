/**
 * Memeriksa apakah akun memiliki riwayat aktivitas operasional.
 *
 * Sesuai README, akun dengan riwayat aktivitas tidak boleh dihapus
 * permanen — riwayat harus tetap tersedia.
 *
 * Diperluas pada B7 dan B8: mencakup penerimaan & saldo awal bahan (B4),
 * produksi & koreksi produksi (B5), stok awal batch dan penyesuaian stok
 * (B6), pencatatan dan pembatalan penjualan (B7), serta validasi,
 * penerbitan, dan penarikan informasi QR oleh Admin (B8).
 *
 * Audit lanjutan: perubahan tanggal kedaluwarsa batch (audit log) dan kunci
 * idempotensi milik pengguna juga dihitung sebagai data terkait.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Seluruh relasi User yang menandakan riwayat. Dipakai juga oleh daftar
 * pengguna agar penanda `hasActivityHistory` dihitung tanpa N+1 query.
 */
export const ACTIVITY_RELATION_COUNTS = {
  materialReceipts: true,
  materialOpeningBalances: true,
  materialStockMovements: true,
  productions: true,
  productionCorrections: true,
  batchStockMovements: true,
  batchOpeningBalances: true,
  batchExpiryChanges: true,
  stockAdjustments: true,
  saleTransactions: true,
  saleCancellations: true,
  qrValidations: true,
  qrPublications: true,
  qrWithdrawals: true,
} as const satisfies Prisma.UserCountOutputTypeSelect;

export type ActivityRelationCounts = Partial<
  Record<keyof typeof ACTIVITY_RELATION_COUNTS, number>
>;

/** True bila salah satu relasi riwayat memiliki setidaknya satu baris. */
export function countsIndicateActivity(counts: ActivityRelationCounts): boolean {
  return Object.values(counts).some((count) => (count ?? 0) > 0);
}

/** Satu jenis riwayat yang menghalangi penghapusan permanen. */
export interface ActivityBlocker {
  label: string;
  count: number;
}

/**
 * Pemeriksaan riwayat di backend, lengkap dengan jenis riwayatnya.
 * `client` dapat berupa transaksi agar pemeriksaan dan penghapusan berjalan
 * pada snapshot yang sama. Dipakai oleh validasi hapus permanen agar alasan
 * penolakan bisa dijelaskan ke Admin, bukan sekadar true/false.
 */
export async function userActivityBlockers(
  userId: string,
  client: PrismaClient | Prisma.TransactionClient = prisma
): Promise<ActivityBlocker[]> {
  const checks: Array<{ label: string; count: Promise<number> }> = [
    { label: 'riwayat penerimaan bahan baku', count: client.materialReceipt.count({ where: { recordedById: userId } }) },
    { label: 'riwayat saldo awal bahan baku', count: client.materialOpeningBalance.count({ where: { recordedById: userId } }) },
    { label: 'riwayat pergerakan stok bahan baku', count: client.materialStockMovement.count({ where: { recordedById: userId } }) },
    { label: 'riwayat produksi', count: client.production.count({ where: { recordedById: userId } }) },
    { label: 'riwayat koreksi produksi', count: client.productionCorrection.count({ where: { changedById: userId } }) },
    { label: 'riwayat pergerakan stok batch', count: client.batchStockMovement.count({ where: { recordedById: userId } }) },
    { label: 'riwayat stok awal batch', count: client.batchOpeningBalance.count({ where: { recordedById: userId } }) },
    // Audit log perubahan kedaluwarsa batch (B8).
    { label: 'riwayat perubahan kedaluwarsa batch', count: client.batchExpiryChange.count({ where: { changedById: userId } }) },
    { label: 'riwayat penyesuaian stok', count: client.stockAdjustment.count({ where: { adjustedById: userId } }) },
    // Penjualan (B7): pencatat transaksi dan Admin pembatal.
    { label: 'riwayat transaksi penjualan', count: client.saleTransaction.count({ where: { recordedById: userId } }) },
    { label: 'riwayat pembatalan penjualan', count: client.saleTransaction.count({ where: { cancelledById: userId } }) },
    // Publikasi QR (B8): Admin yang memvalidasi, menerbitkan, menarik.
    { label: 'riwayat validasi QR', count: client.qrPublication.count({ where: { validatedById: userId } }) },
    { label: 'riwayat penerbitan QR', count: client.qrPublication.count({ where: { publishedById: userId } }) },
    { label: 'riwayat penarikan QR', count: client.qrPublication.count({ where: { withdrawnById: userId } }) },
    // Kunci idempotensi tidak berelasi FK, tetapi tetap data terkait pengguna.
    { label: 'kunci idempotensi', count: client.idempotencyKey.count({ where: { userId } }) },
  ];

  const results = await Promise.all(
    checks.map(async (check) => ({ label: check.label, count: await check.count }))
  );
  return results.filter((item) => item.count > 0);
}

/** Kompatibilitas dengan pemanggil lama yang hanya butuh ya/tidak. */
export async function userHasActivityHistory(
  userId: string,
  client: PrismaClient | Prisma.TransactionClient = prisma
): Promise<boolean> {
  return (await userActivityBlockers(userId, client)).length > 0;
}

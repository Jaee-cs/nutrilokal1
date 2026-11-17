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

/**
 * Pemeriksaan riwayat di backend. `client` dapat berupa transaksi agar
 * pemeriksaan dan penghapusan berjalan pada snapshot yang sama.
 */
export async function userHasActivityHistory(
  userId: string,
  client: PrismaClient | Prisma.TransactionClient = prisma
): Promise<boolean> {
  const counts = await Promise.all([
    client.materialReceipt.count({ where: { recordedById: userId } }),
    client.materialOpeningBalance.count({ where: { recordedById: userId } }),
    client.materialStockMovement.count({ where: { recordedById: userId } }),
    client.production.count({ where: { recordedById: userId } }),
    client.productionCorrection.count({ where: { changedById: userId } }),
    client.batchStockMovement.count({ where: { recordedById: userId } }),
    client.batchOpeningBalance.count({ where: { recordedById: userId } }),
    // Audit log perubahan kedaluwarsa batch (B8).
    client.batchExpiryChange.count({ where: { changedById: userId } }),
    client.stockAdjustment.count({ where: { adjustedById: userId } }),
    // Penjualan (B7): pencatat transaksi dan Admin pembatal.
    client.saleTransaction.count({ where: { recordedById: userId } }),
    client.saleTransaction.count({ where: { cancelledById: userId } }),
    // Publikasi QR (B8): Admin yang memvalidasi, menerbitkan, menarik.
    client.qrPublication.count({ where: { validatedById: userId } }),
    client.qrPublication.count({ where: { publishedById: userId } }),
    client.qrPublication.count({ where: { withdrawnById: userId } }),
    // Kunci idempotensi tidak berelasi FK, tetapi tetap data terkait pengguna.
    client.idempotencyKey.count({ where: { userId } }),
  ]);

  return counts.some((count) => count > 0);
}

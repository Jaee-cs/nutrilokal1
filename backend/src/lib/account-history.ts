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
 */
import { prisma } from './prisma';

export async function userHasActivityHistory(userId: string): Promise<boolean> {
  const counts = await Promise.all([
    prisma.materialReceipt.count({ where: { recordedById: userId } }),
    prisma.materialOpeningBalance.count({ where: { recordedById: userId } }),
    prisma.materialStockMovement.count({ where: { recordedById: userId } }),
    prisma.production.count({ where: { recordedById: userId } }),
    prisma.productionCorrection.count({ where: { changedById: userId } }),
    prisma.batchStockMovement.count({ where: { recordedById: userId } }),
    prisma.batchOpeningBalance.count({ where: { recordedById: userId } }),
    prisma.stockAdjustment.count({ where: { adjustedById: userId } }),
    // Penjualan (B7): pencatat transaksi dan Admin pembatal.
    prisma.saleTransaction.count({ where: { recordedById: userId } }),
    prisma.saleTransaction.count({ where: { cancelledById: userId } }),
    // Publikasi QR (B8): Admin yang memvalidasi, menerbitkan, menarik.
    prisma.qrPublication.count({ where: { validatedById: userId } }),
    prisma.qrPublication.count({ where: { publishedById: userId } }),
    prisma.qrPublication.count({ where: { withdrawnById: userId } }),
  ]);

  return counts.reduce((sum, count) => sum + count, 0) > 0;
}

/**
 * Memeriksa apakah akun memiliki riwayat aktivitas operasional.
 *
 * Sesuai README, akun dengan riwayat aktivitas tidak boleh dihapus
 * permanen — riwayat harus tetap tersedia.
 *
 * Diperluas pada B6: mencakup penerimaan & saldo awal bahan (B4),
 * produksi & koreksi produksi (B5), serta stok awal batch dan
 * penyesuaian stok (B6). Modul berikutnya (B7-B8) WAJIB memperluas
 * fungsi ini saat menambahkan tabel dengan referensi pengguna
 * (penjualan, pembatalan, publikasi QR).
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
  ]);

  return counts.reduce((sum, count) => sum + count, 0) > 0;
}

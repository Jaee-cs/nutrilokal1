/**
 * Memeriksa apakah akun memiliki riwayat aktivitas operasional.
 *
 * Sesuai README, akun dengan riwayat aktivitas tidak boleh dihapus
 * permanen — riwayat harus tetap tersedia.
 *
 * Diperluas pada B5: mencakup penerimaan & saldo awal bahan baku (B4)
 * serta produksi dan koreksi produksi (B5). Modul berikutnya (B6-B8)
 * WAJIB memperluas fungsi ini saat menambahkan tabel dengan referensi
 * pengguna (penyesuaian stok, penjualan, pembatalan, publikasi QR).
 */
import { prisma } from './prisma';

export async function userHasActivityHistory(userId: string): Promise<boolean> {
  const [receipts, openingBalances, materialMovements, productions, corrections, batchMovements] =
    await Promise.all([
      prisma.materialReceipt.count({ where: { recordedById: userId } }),
      prisma.materialOpeningBalance.count({ where: { recordedById: userId } }),
      prisma.materialStockMovement.count({ where: { recordedById: userId } }),
      prisma.production.count({ where: { recordedById: userId } }),
      prisma.productionCorrection.count({ where: { changedById: userId } }),
      prisma.batchStockMovement.count({ where: { recordedById: userId } }),
    ]);

  return (
    receipts +
      openingBalances +
      materialMovements +
      productions +
      corrections +
      batchMovements >
    0
  );
}

/**
 * Pemeriksa riwayat operasional produk NYATA (README 5.1): produk yang sudah
 * memiliki catatan produksi, batch, penjualan, atau RIWAYAT PUBLIKASI QR
 * tidak boleh dihapus — Admin hanya dapat menonaktifkannya. Penonaktifan
 * tidak menghapus riwayat, dan QR batch lama tetap menampilkan informasi
 * yang sudah diterbitkan kecuali ditarik Admin.
 */
import { prisma } from './prisma';
import { registerOperationalHistoryChecker } from './master-history';

let registered = false;

export function ensureProductHistoryCheckRegistered(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerOperationalHistoryChecker(async (kind, id) => {
    if (kind !== 'product') {
      return false;
    }

    const [productions, batches, saleItems, qrPublications] = await Promise.all([
      prisma.production.count({ where: { productId: id } }),
      prisma.batch.count({ where: { productId: id } }),
      // Riwayat penjualan (B7): produk dengan penjualan tidak boleh dihapus.
      prisma.saleItem.count({ where: { productId: id } }),
      // Riwayat publikasi QR (B8): produk dengan QR terkait tidak boleh dihapus.
      prisma.qrPublication.count({ where: { batch: { is: { productId: id } } } }),
    ]);

    return productions > 0 || batches > 0 || saleItems > 0 || qrPublications > 0;
  });
}

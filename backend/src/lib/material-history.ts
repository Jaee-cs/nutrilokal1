/**
 * Pemeriksa riwayat operasional bahan baku yang NYATA (README 5.1):
 * bahan baku dengan riwayat penerimaan atau saldo awal tidak boleh
 * dihapus — Admin hanya dapat menonaktifkannya.
 *
 * Modul berikutnya (B5 pemakaian produksi, B6 penyesuaian stok) harus
 * memperluas pemeriksaan ini saat menambahkan tabel relasi baru.
 */
import { prisma } from './prisma';
import { registerOperationalHistoryChecker } from './master-history';

let registered = false;

export function ensureMaterialHistoryCheckRegistered(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerOperationalHistoryChecker(async (kind, id) => {
    if (kind !== 'material') {
      return false;
    }

    const [receipts, openingBalances, productionUsages, adjustments] = await Promise.all([
      prisma.materialReceipt.count({ where: { materialId: id } }),
      prisma.materialOpeningBalance.count({ where: { materialId: id } }),
      prisma.productionMaterialUsage.count({ where: { materialId: id } }),
      prisma.stockAdjustment.count({ where: { materialId: id } }),
    ]);

    return receipts > 0 || openingBalances > 0 || productionUsages > 0 || adjustments > 0;
  });
}

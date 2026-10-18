/**
 * Pemeriksa riwayat operasional produk NYATA (README 5.1): produk yang sudah
 * memiliki catatan produksi atau batch tidak boleh dihapus — Admin hanya
 * dapat menonaktifkannya. Penonaktifan tidak menghapus riwayat.
 *
 * Modul berikutnya (B6 stok awal produk jadi, B7 penjualan, B8 QR) harus
 * memperluas pemeriksaan ini saat menambahkan tabel relasi baru.
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

    const [productions, batches] = await Promise.all([
      prisma.production.count({ where: { productId: id } }),
      prisma.batch.count({ where: { productId: id } }),
    ]);

    return productions > 0 || batches > 0;
  });
}

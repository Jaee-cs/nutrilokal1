/**
 * Penghapusan permanen terbatas untuk data yang sudah berada di Arsip.
 *
 * Aturan utama: riwayat tidak boleh ikut terhapus. Sebelum menghapus, seluruh
 * relasi Prisma yang relevan dihitung ulang di dalam transaksi yang sama.
 * Baris target dikunci dengan SELECT ... FOR UPDATE supaya dua permintaan
 * bersamaan tidak sama-sama lolos pemeriksaan. Tidak ada cascade delete:
 * resep produk (milik produk itu sendiri) dihapus secara eksplisit, sedangkan
 * semua tabel historis bersifat Restrict/SetNull dan diperiksa di sini.
 */
import type { Prisma } from '@prisma/client';
import { userActivityBlockers, type ActivityBlocker } from './account-history';
import { prisma } from './prisma';

export type DeleteBlocker = ActivityBlocker;

export type PermanentDeleteResult<T> =
  | { ok: true; data: T; message: string }
  | { ok: false; status: number; message: string; blockers?: DeleteBlocker[] };

function failed(status: number, message: string): PermanentDeleteResult<never> {
  return { ok: false, status, message };
}

function collect(
  checks: Array<{ label: string; count: number }>
): DeleteBlocker[] {
  return checks
    .filter((check) => check.count > 0)
    .map((check) => ({ label: check.label, count: check.count }));
}

function blocked(label: string, blockers: DeleteBlocker[]): PermanentDeleteResult<never> {
  const detail = blockers.map((item) => `${item.label} (${item.count})`).join(', ');
  return {
    ok: false,
    status: 409,
    message: `${label} tidak dapat dihapus karena masih memiliki ${detail}. Data tetap tersimpan di Arsip.`,
    blockers,
  };
}

/**
 * Kunci baris target. Dua permintaan bersamaan akan berurutan: yang kedua
 * melihat baris sudah terhapus dan berhenti di pemeriksaan findUnique.
 */
async function lockRow(
  tx: Prisma.TransactionClient,
  kind: 'product' | 'material' | 'user',
  id: string
): Promise<void> {
  if (kind === 'product') {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${id} FOR UPDATE`;
  } else if (kind === 'material') {
    await tx.$queryRaw`SELECT id FROM materials WHERE id = ${id} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
  }
}

/** Hapus permanen produk yang sudah diarsipkan dan benar-benar tanpa riwayat. */
export async function permanentlyDeleteProduct(
  id: string
): Promise<PermanentDeleteResult<{ id: string }>> {
  return prisma.$transaction(async (tx) => {
    await lockRow(tx, 'product', id);
    const target = await tx.product.findUnique({ where: { id } });
    if (!target) return failed(404, 'Produk tidak ditemukan.');
    if (target.isActive) {
      return failed(409, 'Produk masih aktif. Arsipkan terlebih dahulu sebelum menghapus permanen.');
    }

    const [
      productions,
      batches,
      saleItems,
      qrPublications,
      stockAdjustments,
      unitReviews,
    ] = await Promise.all([
      tx.production.count({ where: { productId: id } }),
      tx.batch.count({ where: { productId: id } }),
      tx.saleItem.count({ where: { productId: id } }),
      tx.qrPublication.count({ where: { batch: { productId: id } } }),
      tx.stockAdjustment.count({ where: { batch: { productId: id } } }),
      tx.unitReview.count({ where: { entityId: id } }),
    ]);

    const blockers = collect([
      { label: 'riwayat produksi', count: productions },
      { label: 'riwayat stok/batch', count: batches },
      { label: 'riwayat penjualan', count: saleItems },
      { label: 'publikasi QR', count: qrPublications },
      { label: 'riwayat penyesuaian stok batch', count: stockAdjustments },
      { label: 'riwayat peninjauan satuan', count: unitReviews },
    ]);
    if (blockers.length > 0) return blocked('Produk', blockers);

    // Resep adalah master milik produk ini (bukan riwayat). Dihapus eksplisit
    // agar tidak bergantung pada ON DELETE CASCADE.
    await tx.productRecipeItem.deleteMany({ where: { productId: id } });
    await tx.product.delete({ where: { id } });
    return {
      ok: true,
      data: { id },
      message: 'Produk berhasil dihapus permanen dari Arsip.',
    };
  });
}

/** Hapus permanen bahan baku yang sudah diarsipkan, tanpa saldo dan riwayat. */
export async function permanentlyDeleteMaterial(
  id: string
): Promise<PermanentDeleteResult<{ id: string }>> {
  return prisma.$transaction(async (tx) => {
    await lockRow(tx, 'material', id);
    const target = await tx.material.findUnique({ where: { id } });
    if (!target) return failed(404, 'Bahan baku tidak ditemukan.');
    if (target.isActive) {
      return failed(409, 'Bahan baku masih aktif. Arsipkan terlebih dahulu sebelum menghapus permanen.');
    }

    const [
      stock,
      receipts,
      openingBalances,
      movements,
      productionUsages,
      adjustments,
      recipeItems,
      unitReviews,
    ] = await Promise.all([
      tx.materialStock.findUnique({ where: { materialId: id } }),
      tx.materialReceipt.count({ where: { materialId: id } }),
      tx.materialOpeningBalance.count({ where: { materialId: id } }),
      tx.materialStockMovement.count({ where: { materialId: id } }),
      tx.productionMaterialUsage.count({ where: { materialId: id } }),
      tx.stockAdjustment.count({ where: { materialId: id } }),
      tx.productRecipeItem.count({ where: { materialId: id } }),
      tx.unitReview.count({ where: { entityId: id } }),
    ]);

    const blockers = collect([
      ...(stock
        ? [
            {
              label: Number(stock.quantity) > 0 ? 'saldo stok' : 'data saldo stok',
              count: 1,
            },
          ]
        : []),
      { label: 'riwayat penerimaan', count: receipts },
      { label: 'riwayat saldo awal', count: openingBalances },
      { label: 'riwayat pergerakan stok', count: movements },
      { label: 'riwayat pemakaian produksi', count: productionUsages },
      { label: 'riwayat penyesuaian stok', count: adjustments },
      { label: 'resep produk yang memakai bahan ini', count: recipeItems },
      { label: 'riwayat peninjauan satuan', count: unitReviews },
    ]);
    if (blockers.length > 0) return blocked('Bahan baku', blockers);

    await tx.material.delete({ where: { id } });
    return {
      ok: true,
      data: { id },
      message: 'Bahan baku berhasil dihapus permanen dari Arsip.',
    };
  });
}

/**
 * Hapus permanen akun. Akun Admin dan akun yang sedang login tidak pernah
 * dihapus. Identitas pelaku aktivitas harus tetap tersedia, jadi akun dengan
 * riwayat maupun dengan data yang pernah diarsipkannya ditolak.
 */
export async function permanentlyDeleteUser(
  id: string,
  actorId: string
): Promise<PermanentDeleteResult<{ id: string }>> {
  return prisma.$transaction(async (tx) => {
    await lockRow(tx, 'user', id);
    const target = await tx.user.findUnique({ where: { id } });
    if (!target) return failed(404, 'Akun tidak ditemukan.');
    if (id === actorId) {
      return failed(400, 'Akun Anda sendiri tidak dapat dihapus permanen.');
    }
    if (target.role === 'ADMIN') {
      return failed(403, 'Akun Admin tidak dapat dihapus permanen.');
    }
    if (target.isActive) {
      return failed(409, 'Akun masih aktif. Arsipkan terlebih dahulu sebelum menghapus permanen.');
    }

    const [activity, archivedProducts, archivedMaterials, archivedUsers, unitReviews] =
      await Promise.all([
        userActivityBlockers(id, tx),
        tx.product.count({ where: { archivedById: id } }),
        tx.material.count({ where: { archivedById: id } }),
        tx.user.count({ where: { archivedById: id } }),
        tx.unitReview.count({ where: { reviewedById: id } }),
      ]);

    const archivedTotal = archivedProducts + archivedMaterials + archivedUsers;
    const blockers: DeleteBlocker[] = [
      ...activity,
      ...(archivedTotal > 0
        ? [
            {
              label: 'data yang diarsipkan oleh akun ini',
              count: archivedTotal,
            },
          ]
        : []),
      ...collect([{ label: 'riwayat peninjauan satuan', count: unitReviews }]),
    ];
    if (blockers.length > 0) return blocked('Akun', blockers);

    await tx.user.delete({ where: { id } });
    return {
      ok: true,
      data: { id },
      message: 'Akun berhasil dihapus permanen dari Arsip.',
    };
  });
}

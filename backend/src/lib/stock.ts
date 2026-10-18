/**
 * Operasi stok bahan baku.
 *
 * Stok dihitung sebagai total per jenis bahan baku (README 5.2).
 * Setiap perubahan stok dilakukan atomik di dalam transaksi dan SELALU
 * disertai catatan pergerakan (MaterialStockMovement) sebagai jejak audit.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

export type StockDb = PrismaClient | Prisma.TransactionClient;

/**
 * Error stok tidak mencukupi; dipetakan route ke respons 409.
 */
export class InsufficientStockError extends Error {}

/** Stok saat ini; 0 bila belum pernah ada pergerakan. */
export async function getMaterialStock(db: StockDb, materialId: string): Promise<number> {
  const stock = await db.materialStock.findUnique({ where: { materialId } });
  return stock ? Number(stock.quantity) : 0;
}

/**
 * Menambah (delta > 0) atau mengurangi (delta < 0) stok bahan baku.
 * Harus dipanggil di dalam transaksi yang sama dengan penyimpanan riwayat.
 * Menolak perubahan yang membuat stok negatif.
 */
export async function applyMaterialStockChange(
  db: StockDb,
  materialId: string,
  delta: Prisma.Decimal
): Promise<void> {
  if (delta.isZero()) {
    return;
  }

  if (delta.isNegative() && (await getMaterialStock(db, materialId)) < Math.abs(Number(delta))) {
    throw new InsufficientStockError('Stok bahan baku tidak mencukupi.');
  }

  // Perbarui baris stok yang ada; syarat quantity >= 0 mencegah stok negatif.
  const updateWhere = { materialId, quantity: { gte: new Prisma.Decimal(0) } };
  const updated = await db.materialStock.updateMany({
    where: updateWhere,
    data: { quantity: { increment: delta } },
  });

  if (updated.count === 1) {
    return;
  }

  // Belum ada baris stok untuk bahan ini — buat baru.
  try {
    await db.materialStock.create({ data: { materialId, quantity: delta } });
    return;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    // Baris dibuat bersamaan oleh transaksi lain; lanjutkan ke langkah ulang di bawah.
  }

  const retried = await db.materialStock.updateMany({
    where: updateWhere,
    data: { quantity: { increment: delta } },
  });

  if (retried.count !== 1) {
    throw new InsufficientStockError('Stok bahan baku tidak mencukupi.');
  }
}

// ---------------------------------------------------------------------------
// Stok produk jadi per batch (README 5.3 dan 5.4)
// ---------------------------------------------------------------------------

/** Stok produk jadi pada suatu batch. */
export async function getBatchStock(db: StockDb, batchId: string): Promise<number> {
  const batch = await db.batch.findUnique({ where: { id: batchId } });
  return batch ? Number(batch.stockQuantity) : 0;
}

/**
 * Menambah (delta > 0) atau mengurangi (delta < 0) stok suatu batch.
 * Harus dipanggil di dalam transaksi yang sama dengan penyimpanan riwayat
 * (BatchStockMovement). Menolak perubahan yang membuat stok batch negatif.
 */
export async function applyBatchStockChange(
  db: StockDb,
  batchId: string,
  delta: Prisma.Decimal
): Promise<void> {
  if (delta.isZero()) {
    return;
  }

  const updated = await db.batch.updateMany({
    where: {
      id: batchId,
      // Syarat stockQuantity + delta >= 0 — mencegah stok batch negatif.
      stockQuantity: { gte: delta.isNegative() ? delta.abs() : new Prisma.Decimal(0) },
    },
    data: { stockQuantity: { increment: delta } },
  });

  if (updated.count !== 1) {
    throw new InsufficientStockError('Stok batch tidak mencukupi.');
  }
}

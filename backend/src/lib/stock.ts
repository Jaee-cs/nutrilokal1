/**
 * Operasi stok bahan baku.
 *
 * Stok dihitung sebagai total per jenis bahan baku (README 5.2).
 * Setiap perubahan stok dilakukan atomik di dalam transaksi dan SELALU
 * disertai catatan pergerakan (MaterialStockMovement) sebagai jejak audit.
 */
import { Prisma, type PrismaClient } from '@prisma/client';

export type StockDb = PrismaClient | Prisma.TransactionClient;

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
    throw new Error('Stok bahan baku tidak mencukupi.');
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
    throw new Error('Stok bahan baku tidak mencukupi.');
  }
}

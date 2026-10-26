/**
 * Master bahan baku (README 5.1 dan 4).
 *
 * - Melihat daftar/detail: Admin dan Operator (informasi operasional).
 * - Membuat, mengubah, menonaktifkan/mengaktifkan, menghapus: hanya Admin.
 * - Setiap bahan baku memiliki satu satuan dasar; tidak ada konversi satuan otomatis.
 * - Bahan baku yang sudah memiliki riwayat operasional tidak boleh dihapus;
 *   Admin hanya dapat menonaktifkannya. Penonaktifan tidak menghapus riwayat.
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { pathId } from '../lib/http';
import { hasOperationalHistory } from '../lib/master-history';
import {
  MATERIAL_NAME_DUPLICATE_MESSAGE,
  materialNameKey,
  toPublicMaterial,
} from '../lib/material';
import { MATERIAL_MOVEMENT_INCLUDE, toPublicMaterialMovement } from '../lib/material-records';
import { prisma } from '../lib/prisma';
import { getMaterialStock } from '../lib/stock';
import { validateName, validateUnit } from '../lib/validate';
import { authenticate, requireAdmin } from '../middleware/auth';
import { materialOpeningBalancesRouter, materialReceiptsRouter } from './material-records';

export const materialsRouter = Router();

/** Penanda internal: bahan memiliki histori sehingga penghapusan ditolak. */
class MaterialHasHistoryError extends Error {}

/**
 * Pelanggaran constraint unik `materials.name_key`. Dipakai sebagai jaring
 * pengaman saat dua permintaan dengan nama sama datang hampir bersamaan:
 * pemeriksaan awal bisa lolos di kedua permintaan, tetapi database hanya
 * mengizinkan satu baris.
 */
function isMaterialNameConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

// ---------- Melihat (Admin & Operator) ----------

materialsRouter.get('/', authenticate, async (_req, res) => {
  const materials = await prisma.material.findMany({ orderBy: { name: 'asc' } });

  // Stok ditampilkan sebagai total per jenis bahan baku (README 5.2).
  const stocks = await prisma.materialStock.findMany({
    where: { materialId: { in: materials.map((m) => m.id) } },
  });
  const stockByMaterial = new Map(stocks.map((s) => [s.materialId, Number(s.quantity)]));

  res.json({ data: materials.map((m) => toPublicMaterial(m, stockByMaterial.get(m.id) ?? 0)) });
});

materialsRouter.get('/:id', authenticate, async (req, res) => {
  const material = await prisma.material.findUnique({ where: { id: pathId(req) } });

  if (!material) {
    res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    return;
  }

  res.json({ material: toPublicMaterial(material, await getMaterialStock(prisma, material.id)) });
});

/**
 * Riwayat pergerakan stok bahan baku (README 5.4).
 *
 * - Dapat dilihat Admin dan Operator (informasi operasional).
 * - Terurut dari kejadian terbaru ke terlama; waktu pencatatan dan ID dipakai
 *   sebagai penentu urutan agar hasil selalu deterministik.
 * - Hanya baca: tidak ada endpoint edit/hapus untuk pergerakan stok.
 */
materialsRouter.get('/:id/movements', authenticate, async (req, res) => {
  const materialId = pathId(req);

  const material = await prisma.material.findUnique({ where: { id: materialId }, select: { id: true } });
  if (!material) {
    res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    return;
  }

  const movements = await prisma.materialStockMovement.findMany({
    where: { materialId },
    orderBy: [{ occurredAt: 'desc' }, { recordedAt: 'desc' }, { id: 'desc' }],
    include: MATERIAL_MOVEMENT_INCLUDE,
  });

  res.json({ data: movements.map(toPublicMaterialMovement) });
});

// ---------- Mengubah (hanya Admin) ----------

materialsRouter.post('/', authenticate, requireAdmin, async (req, res) => {
  const { name, unit } = req.body ?? {};

  const nameError = validateName(name);
  if (nameError) {
    res.status(400).json({ message: nameError });
    return;
  }

  const unitError = validateUnit(unit);
  if (unitError) {
    res.status(400).json({ message: unitError });
    return;
  }

  const trimmedName = name.trim();
  const nameKey = materialNameKey(trimmedName);

  // Pemeriksaan awal untuk pesan yang cepat dan jelas. Bahan nonaktif ikut
  // dihitung karena namanya tetap terdaftar.
  const existing = await prisma.material.findUnique({ where: { nameKey }, select: { id: true } });
  if (existing) {
    res.status(409).json({ message: MATERIAL_NAME_DUPLICATE_MESSAGE });
    return;
  }

  try {
    const material = await prisma.material.create({
      data: { name: trimmedName, nameKey, unit: unit.trim() },
    });
    res.status(201).json({ material: toPublicMaterial(material, 0) });
  } catch (err) {
    // Balapan dua permintaan dengan nama sama: constraint unik database
    // menangkap yang kalah, bukan menyimpan duplikat.
    if (isMaterialNameConflict(err)) {
      res.status(409).json({ message: MATERIAL_NAME_DUPLICATE_MESSAGE });
      return;
    }
    throw err;
  }
});

materialsRouter.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  const target = await prisma.material.findUnique({ where: { id: pathId(req) } });

  if (!target) {
    res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    return;
  }

  const data: Prisma.MaterialUpdateInput = {};

  if (body.name !== undefined) {
    const nameError = validateName(body.name);
    if (nameError) {
      res.status(400).json({ message: nameError });
      return;
    }
    const trimmedName = body.name.trim();
    const nameKey = materialNameKey(trimmedName);

    // Nama sendiri boleh dipakai ulang (mis. hanya mengubah kapitalisasi),
    // tetapi tidak boleh menabrak nama bahan lain — termasuk yang nonaktif.
    if (nameKey !== target.nameKey) {
      const existing = await prisma.material.findUnique({ where: { nameKey }, select: { id: true } });
      if (existing && existing.id !== target.id) {
        res.status(409).json({ message: MATERIAL_NAME_DUPLICATE_MESSAGE });
        return;
      }
    }

    data.name = trimmedName;
    data.nameKey = nameKey;
  }

  if (body.unit !== undefined) {
    const unitError = validateUnit(body.unit);
    if (unitError) {
      res.status(400).json({ message: unitError });
      return;
    }
    // Satuan dasar tidak boleh berubah setelah ada riwayat operasional,
    // agar penerimaan dan pemakaian tetap memakai satuan yang sama.
    if (body.unit.trim() !== target.unit && (await hasOperationalHistory('material', target.id))) {
      res.status(409).json({
        message: 'Satuan dasar tidak dapat diubah karena bahan baku sudah memiliki riwayat operasional.',
      });
      return;
    }
    data.unit = body.unit.trim();
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      res.status(400).json({ message: 'Field isActive wajib berupa boolean.' });
      return;
    }
    data.isActive = body.isActive;
  }

  if (Object.keys(data).length === 0) {
    res.status(400).json({ message: 'Tidak ada perubahan yang diberikan.' });
    return;
  }

  let material;
  try {
    material = await prisma.material.update({ where: { id: target.id }, data });
  } catch (err) {
    // Balapan dua perubahan ke nama yang sama: constraint unik database
    // yang memutuskan, bukan pemeriksaan di atas.
    if (isMaterialNameConflict(err)) {
      res.status(409).json({ message: MATERIAL_NAME_DUPLICATE_MESSAGE });
      return;
    }
    throw err;
  }

  res.json({ material: toPublicMaterial(material, await getMaterialStock(prisma, material.id)) });
});

/**
 * Menghapus bahan baku secara permanen (hanya Admin).
 *
 * Aturan (README 5.1):
 * - Bahan yang belum pernah dipakai (tanpa penerimaan, saldo awal, pemakaian
 *   produksi, penyesuaian stok, maupun jejak pergerakan stok) boleh dihapus
 *   permanen.
 * - Bahan yang sudah memiliki histori-operational TIDAK boleh dihapus: balas
 *   409 dengan alasan yang jelas dan arahkan Admin memakai fitur Nonaktifkan.
 * - Tidak ada cascade delete: histori produksi maupun pergerakan stok tidak
 *   pernah ikut terhapus.
 *
 * Penghapusan dijalankan dalam satu transaksi: pemeriksaan relasi diulang
 * sebagai validasi akhir tepat sebelum baris dihapus, sehingga bahan yang
 * baru saja dipakai tidak bisa terhapus karena balapan data.
 */
materialsRouter.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const materialId = pathId(req);
  const target = await prisma.material.findUnique({ where: { id: materialId } });

  if (!target) {
    res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    return;
  }

  if (await hasOperationalHistory('material', target.id)) {
    res.status(409).json({
      message:
        'Bahan baku memiliki riwayat operasional dan tidak boleh dihapus. ' +
        'Nonaktifkan bahan baku sebagai gantinya.',
    });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Validasi akhir: pastikan tidak ada relasi yang muncul sejak pemeriksaan
      // awal. Relasi ini checked di dalam transaksi agar konsisten.
      const [movements, receipts, openingBalances, productionUsages, adjustments] = await Promise.all([
        tx.materialStockMovement.count({ where: { materialId: target.id } }),
        tx.materialReceipt.count({ where: { materialId: target.id } }),
        tx.materialOpeningBalance.count({ where: { materialId: target.id } }),
        tx.productionMaterialUsage.count({ where: { materialId: target.id } }),
        tx.stockAdjustment.count({ where: { materialId: target.id } }),
      ]);

      if (movements > 0 || receipts > 0 || openingBalances > 0 || productionUsages > 0 || adjustments > 0) {
        throw new MaterialHasHistoryError();
      }

      // Baris stok ikut dihapus (hanya mungkin ada bila belum ada pergerakan).
      await tx.materialStock.deleteMany({ where: { materialId: target.id } });
      await tx.material.delete({ where: { id: target.id } });
    });
  } catch (err) {
    if (err instanceof MaterialHasHistoryError) {
      res.status(409).json({
        message:
          'Bahan baku memiliki riwayat operasional dan tidak boleh dihapus. ' +
          'Nonaktifkan bahan baku sebagai gantinya.',
      });
      return;
    }
    throw err;
  }

  res.json({ message: `Bahan baku "${target.name}" berhasil dihapus.` });
});

// Riwayat penerimaan dan saldo awal per bahan baku.
materialsRouter.use('/:id/receipts', materialReceiptsRouter);
materialsRouter.use('/:id/opening-balances', materialOpeningBalancesRouter);

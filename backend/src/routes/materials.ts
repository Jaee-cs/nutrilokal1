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
import { toPublicMaterial } from '../lib/material';
import { MATERIAL_MOVEMENT_INCLUDE, toPublicMaterialMovement } from '../lib/material-records';
import { prisma } from '../lib/prisma';
import { getMaterialStock } from '../lib/stock';
import { validateName, validateUnit } from '../lib/validate';
import { authenticate, requireAdmin } from '../middleware/auth';
import { materialOpeningBalancesRouter, materialReceiptsRouter } from './material-records';

export const materialsRouter = Router();

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

  const material = await prisma.material.create({
    data: { name: name.trim(), unit: unit.trim() },
  });

  res.status(201).json({ material: toPublicMaterial(material, 0) });
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
    data.name = body.name.trim();
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

  const material = await prisma.material.update({ where: { id: target.id }, data });
  res.json({ material: toPublicMaterial(material, await getMaterialStock(prisma, material.id)) });
});

materialsRouter.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const target = await prisma.material.findUnique({ where: { id: pathId(req) } });

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

  await prisma.material.delete({ where: { id: target.id } });
  res.json({ message: `Bahan baku "${target.name}" berhasil dihapus.` });
});

// Riwayat penerimaan dan saldo awal per bahan baku.
materialsRouter.use('/:id/receipts', materialReceiptsRouter);
materialsRouter.use('/:id/opening-balances', materialOpeningBalancesRouter);

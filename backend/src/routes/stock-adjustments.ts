/**
 * Penyesuaian stok oleh Admin (README 5.4).
 *
 * - Hanya Admin melalui fungsi khusus ini.
 * - Sasaran: bahan baku (MATERIAL) atau suatu batch (BATCH).
 * - Jumlah bernilai TANDA: positif menambah stok, negatif mengurangi.
 * - Alasan wajib dicatat, bersama waktu, pengguna, dan sasaran terkait.
 * - Penyesuaian yang membuat stok bahan baku atau stok batch menjadi
 *   negatif DITOLAK (409), tanpa perubahan apa pun.
 * - Setiap penyesuaian menghasilkan catatan pergerakan stok yang terkait
 *   dengan catatan sumbernya. Tidak ada endpoint edit/hapus.
 * - Retur (README 5.4) ditangani lewat penyesuaian ini: Admin menambah
 *   stok batch asal (positif) dengan alasan retur setelah memeriksa barang.
 * - Header `Idempotency-Key` (opsional) mencegah permintaan berulang.
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { readIdempotencyKey, runIdempotent } from '../lib/idempotency';
import { prisma } from '../lib/prisma';
import {
  applyBatchStockChange,
  applyMaterialStockChange,
  getBatchStock,
  getMaterialStock,
  InsufficientStockError,
} from '../lib/stock';
import {
  STOCK_ADJUSTMENT_INCLUDE,
  toPublicStockAdjustment,
} from '../lib/stock-view';
import { validateAdjustmentQuantity, validateReason } from '../lib/validate';
import { authenticate, requireAdmin } from '../middleware/auth';

export const stockAdjustmentsRouter = Router();

const ADJUSTMENT_ENDPOINT = 'POST /api/stock-adjustments';

stockAdjustmentsRouter.post('/', authenticate, requireAdmin, async (req, res) => {
  const { targetType, targetId, quantity, reason } = req.body ?? {};

  if (targetType !== 'MATERIAL' && targetType !== 'BATCH') {
    res.status(400).json({ message: 'targetType harus "MATERIAL" atau "BATCH".' });
    return;
  }

  if (typeof targetId !== 'string' || targetId.trim() === '') {
    res.status(400).json({ message: 'targetId wajib diisi.' });
    return;
  }

  const quantityError = validateAdjustmentQuantity(quantity);
  if (quantityError) {
    res.status(400).json({ message: quantityError });
    return;
  }

  const reasonError = validateReason(reason);
  if (reasonError) {
    res.status(400).json({ message: reasonError });
    return;
  }

  const id = targetId.trim();
  const target = await (targetType === 'MATERIAL'
    ? prisma.material.findUnique({ where: { id } })
    : prisma.batch.findUnique({ where: { id } }));

  if (!target) {
    res
      .status(404)
      .json({ message: targetType === 'MATERIAL' ? 'Bahan baku tidak ditemukan.' : 'Batch tidak ditemukan.' });
    return;
  }

  let key: string | null;
  try {
    key = readIdempotencyKey(req.headers['idempotency-key']);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Idempotency-Key tidak valid.' });
    return;
  }

  const quantityText = quantity.toFixed(3);
  const reasonText = reason.trim();
  const adjustedById = req.user!.id;
  // Penyesuaian dicatat pada saat dilakukan (tidak ada tanggal terpisah).
  const occurredAt = new Date();

  try {
    const result = await runIdempotent<{
      adjustment: ReturnType<typeof toPublicStockAdjustment>;
      stock: number;
    }>({ key, endpoint: ADJUSTMENT_ENDPOINT, userId: adjustedById }, async (tx) => {
      // Penyesuaian bahan baku: catatan sumber + pergerakan + perubahan
      // stok, semuanya dalam SATU transaksi (README 6).
      if (targetType === 'MATERIAL') {
        const adjustment = await tx.stockAdjustment.create({
          data: { targetType: 'MATERIAL', materialId: id, quantity: quantityText, reason: reasonText, adjustedById },
          include: STOCK_ADJUSTMENT_INCLUDE,
        });

        await tx.materialStockMovement.create({
          data: {
            materialId: id,
            type: 'ADJUSTMENT',
            quantity: quantityText,
            occurredAt,
            recordedById: adjustedById,
            reason: reasonText,
            adjustmentId: adjustment.id,
          },
        });

        await applyMaterialStockChange(tx, id, new Prisma.Decimal(quantityText));

        return {
          status: 201,
          body: {
            adjustment: toPublicStockAdjustment(adjustment),
            stock: await getMaterialStock(tx, id),
          },
        };
      }

      // Penyesuaian stok batch produk jadi.
      const adjustment = await tx.stockAdjustment.create({
        data: { targetType: 'BATCH', batchId: id, quantity: quantityText, reason: reasonText, adjustedById },
        include: STOCK_ADJUSTMENT_INCLUDE,
      });

      await tx.batchStockMovement.create({
        data: {
          batchId: id,
          type: 'ADJUSTMENT',
          quantity: quantityText,
          occurredAt,
          recordedById: adjustedById,
          reason: reasonText,
          adjustmentId: adjustment.id,
        },
      });

      await applyBatchStockChange(tx, id, new Prisma.Decimal(quantityText));

      return {
        status: 201,
        body: {
          adjustment: toPublicStockAdjustment(adjustment),
          stock: await getBatchStock(tx, id),
        },
      };
    });

    res.status(result.status);
    res.setHeader('Idempotent-Replay', result.replayed ? 'true' : 'false');
    res.json(result.body);
    return;
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      res.status(409).json({ message: `Penyesuaian ditolak: ${error.message}` });
      return;
    }
    throw error;
  }
});

// Tidak ada endpoint edit/hapus penyesuaian (README 5.4): riwayat
// pergerakan stok hanya dapat dilihat, tidak pernah diubah/dihapus.

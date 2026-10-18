/**
 * Catatan stok bahan baku (README 5.2 dan 5.4).
 *
 * - Penerimaan bahan baku: dicatat Admin atau Operator; menambah stok.
 * - Saldo awal: khusus Admin; terpisah dari penerimaan biasa; wajib memuat
 *   tanggal, alasan, dan pengguna pencatat; tidak menghitung stok dua kali.
 * - Riwayat hanya dapat dilihat. Tidak ada endpoint edit/hapus — koreksi
 *   dilakukan lewat penyesuaian stok (tugas B6).
 * - Header `Idempotency-Key` (opsional) mencegah permintaan berulang
 *   menambah stok dua kali.
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { pathId } from '../lib/http';
import { readIdempotencyKey, runIdempotent } from '../lib/idempotency';
import {
  toPublicMaterialOpeningBalance,
  toPublicMaterialReceipt,
} from '../lib/material-records';
import { prisma } from '../lib/prisma';
import { applyMaterialStockChange, getMaterialStock } from '../lib/stock';
import { validateDateOnly, validateNote, validateQuantity, validateReason } from '../lib/validate';
import { authenticate, requireAdmin } from '../middleware/auth';

const RECEIPT_ENDPOINT = 'POST /api/materials/:id/receipts';
const OPENING_BALANCE_ENDPOINT = 'POST /api/materials/:id/opening-balances';

const RECORDED_BY_SELECT = { select: { id: true, username: true, name: true } } as const;

function normalizeNote(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// Penerimaan bahan baku (Admin dan Operator)
// ---------------------------------------------------------------------------

export const materialReceiptsRouter = Router({ mergeParams: true });

materialReceiptsRouter.get('/', authenticate, async (req, res) => {
  const materialId = pathId(req);

  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) {
    res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    return;
  }

  const receipts = await prisma.materialReceipt.findMany({
    where: { materialId },
    orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
    include: { recordedBy: RECORDED_BY_SELECT },
  });

  res.json({ data: receipts.map(toPublicMaterialReceipt) });
});

materialReceiptsRouter.post('/', authenticate, async (req, res) => {
  const materialId = pathId(req);
  const { quantity, receivedAt, note } = req.body ?? {};

  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) {
    res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    return;
  }

  if (!material.isActive) {
    res.status(409).json({ message: 'Bahan baku tidak aktif dan tidak dapat menerima penerimaan baru.' });
    return;
  }

  const quantityError = validateQuantity(quantity);
  if (quantityError) {
    res.status(400).json({ message: quantityError });
    return;
  }

  const noteError = validateNote(note);
  if (noteError) {
    res.status(400).json({ message: noteError });
    return;
  }

  if (receivedAt !== undefined) {
    const dateError = validateDateOnly(receivedAt);
    if (dateError) {
      res.status(400).json({ message: dateError });
      return;
    }
  }
  const receivedDate = receivedAt === undefined ? new Date() : new Date(receivedAt);

  let key: string | null;
  try {
    key = readIdempotencyKey(req.headers['idempotency-key']);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Idempotency-Key tidak valid.' });
    return;
  }

  const quantityText = quantity.toFixed(3);
  const recordedById = req.user!.id;

  const result = await runIdempotent<{ receipt: ReturnType<typeof toPublicMaterialReceipt>; stock: number }>(
    { key, endpoint: RECEIPT_ENDPOINT, userId: recordedById },
    async (tx) => {
      const receipt = await tx.materialReceipt.create({
        data: {
          materialId,
          quantity: quantityText,
          receivedAt: receivedDate,
          note: normalizeNote(note),
          recordedById,
        },
        include: { recordedBy: RECORDED_BY_SELECT },
      });

      // Jejak pergerakan stok dikaitkan dengan catatan sumbernya (README 5.4).
      await tx.materialStockMovement.create({
        data: {
          materialId,
          type: 'RECEIPT',
          quantity: quantityText,
          occurredAt: receivedDate,
          recordedById,
          reason: receipt.note,
          receiptId: receipt.id,
        },
      });

      await applyMaterialStockChange(tx, materialId, new Prisma.Decimal(quantityText));

      return {
        status: 201,
        body: { receipt: toPublicMaterialReceipt(receipt), stock: await getMaterialStock(tx, materialId) },
      };
    }
  );

  res.status(result.status);
  res.setHeader('Idempotent-Replay', result.replayed ? 'true' : 'false');
  res.json(result.body);
});

// ---------------------------------------------------------------------------
// Saldo awal bahan baku (khusus Admin)
// ---------------------------------------------------------------------------

export const materialOpeningBalancesRouter = Router({ mergeParams: true });

materialOpeningBalancesRouter.get('/', authenticate, async (req, res) => {
  const materialId = pathId(req);

  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) {
    res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    return;
  }

  const balances = await prisma.materialOpeningBalance.findMany({
    where: { materialId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: { recordedBy: RECORDED_BY_SELECT },
  });

  res.json({ data: balances.map(toPublicMaterialOpeningBalance) });
});

materialOpeningBalancesRouter.post('/', authenticate, requireAdmin, async (req, res) => {
  const materialId = pathId(req);
  const { quantity, date, reason } = req.body ?? {};

  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) {
    res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    return;
  }

  if (!material.isActive) {
    res.status(409).json({ message: 'Bahan baku tidak aktif dan tidak dapat menerima saldo awal baru.' });
    return;
  }

  const quantityError = validateQuantity(quantity);
  if (quantityError) {
    res.status(400).json({ message: quantityError });
    return;
  }

  const dateError = validateDateOnly(date);
  if (dateError) {
    res.status(400).json({ message: dateError });
    return;
  }

  const reasonError = validateReason(reason);
  if (reasonError) {
    res.status(400).json({ message: reasonError });
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
  const openingDate = new Date(date);
  const reasonText = reason.trim();
  const recordedById = req.user!.id;

  const result = await runIdempotent<{
    openingBalance: ReturnType<typeof toPublicMaterialOpeningBalance>;
    stock: number;
  }>(
    { key, endpoint: OPENING_BALANCE_ENDPOINT, userId: recordedById },
    async (tx) => {
      // Saldo awal dicatat TERPISAH dari penerimaan biasa (README 5.2),
      // sehingga stok tidak pernah dihitung dua kali.
      const balance = await tx.materialOpeningBalance.create({
        data: {
          materialId,
          quantity: quantityText,
          date: openingDate,
          reason: reasonText,
          recordedById,
        },
        include: { recordedBy: RECORDED_BY_SELECT },
      });

      await tx.materialStockMovement.create({
        data: {
          materialId,
          type: 'OPENING_BALANCE',
          quantity: quantityText,
          occurredAt: openingDate,
          recordedById,
          reason: reasonText,
          openingBalanceId: balance.id,
        },
      });

      await applyMaterialStockChange(tx, materialId, new Prisma.Decimal(quantityText));

      return {
        status: 201,
        body: {
          openingBalance: toPublicMaterialOpeningBalance(balance),
          stock: await getMaterialStock(tx, materialId),
        },
      };
    }
  );

  res.status(result.status);
  res.setHeader('Idempotent-Replay', result.replayed ? 'true' : 'false');
  res.json(result.body);
});

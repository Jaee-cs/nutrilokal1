/**
 * Produksi dan kode batch (README 5.3 dan 5.4).
 *
 * - Mencatat produksi: Admin dan Operator (README 4).
 * - Mengoreksi catatan produksi (tanggal & jumlah hasil): hanya Admin.
 * - Satu catatan produksi = produksi telah SELESAI. Setelah tersimpan
 *   atomik, stok bahan berkurang sesuai pemakaian aktual dan stok produk
 *   jadi batch bertambah sesuai jumlah hasil.
 * - Tanggal produksi adalah tanggal sebenarnya, tidak boleh masa depan;
 *   pencatatan mundur diperbolehkan. Waktu pencatatan disimpan terpisah.
 * - Kode batch NL-YYYYMMDD-NNN mengikuti tanggal produksi; keunikannya
 *   dijamin constraint database dan diulang saat permintaan bersamaan.
 * - Koreksi tanggal membuat kode batch baru; kode lama disimpan sebagai
 *   alias agar QR/label lama tetap mengarah ke batch yang sama.
 * - Riwayat pergerakan stok tidak pernah diedit/dihapus: koreksi menambah
 *   catatan pergerakan (BatchStockMovement) dan jejak audit
 *   (ProductionCorrection).
 * - Header `Idempotency-Key` (opsional) mencegah permintaan berulang
 *   menambah stok dua kali.
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { allocateBatchCode, isBatchCodeConflict, MAX_BATCH_CODE_ATTEMPTS } from '../lib/batch';
import { businessDateCode, isBusinessDateInFuture, parseBusinessDate } from '../lib/date';
import { pathId } from '../lib/http';
import { readIdempotencyKey, runIdempotent } from '../lib/idempotency';
import { PRODUCTION_INCLUDE, toPublicProduction, type ProductionWithRelations } from '../lib/production';
import { prisma } from '../lib/prisma';
import {
  applyBatchStockChange,
  applyMaterialStockChange,
  getMaterialStock,
  InsufficientStockError,
} from '../lib/stock';
import {
  validateDateOnly,
  validateNote,
  validateQuantity,
  validateUsageList,
} from '../lib/validate';
import { authenticate, requireAdmin } from '../middleware/auth';

export const productionsRouter = Router();

const CREATE_ENDPOINT = 'POST /api/productions';

interface UsageInput {
  materialId: string;
  quantity: number;
  quantityText: string;
}

function normalizeNote(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isProductionIdMissing(error: unknown): boolean {
  return error instanceof Error && error.message === 'CATATAN_PRODUKSI_TIDAK_DITEMUKAN';
}

// ---------------------------------------------------------------------------
// Mencatat produksi (Admin & Operator)
// ---------------------------------------------------------------------------

productionsRouter.post('/', authenticate, async (req, res) => {
  const body = req.body ?? {};
  const { productId, productionDate, yieldQuantity, note, materials } = body;

  if (typeof productId !== 'string' || productId.trim() === '') {
    res.status(400).json({ message: 'productId wajib diisi.' });
    return;
  }

  const dateError = validateDateOnly(productionDate);
  if (dateError) {
    res.status(400).json({ message: dateError });
    return;
  }

  const yieldError = validateQuantity(yieldQuantity, 'Jumlah hasil');
  if (yieldError) {
    res.status(400).json({ message: yieldError });
    return;
  }

  const noteError = validateNote(note);
  if (noteError) {
    res.status(400).json({ message: noteError });
    return;
  }

  const listError = validateUsageList(materials);
  if (listError) {
    res.status(400).json({ message: listError });
    return;
  }

  const usages: UsageInput[] = [];
  const seenMaterialIds = new Set<string>();
  for (const item of materials as Record<string, unknown>[]) {
    const quantity = item.quantity as number;
    const usageError = validateQuantity(quantity, 'Jumlah pemakaian');
    if (usageError) {
      res.status(400).json({ message: usageError });
      return;
    }
    const materialId = (item.materialId as string).trim();
    if (seenMaterialIds.has(materialId)) {
      res.status(400).json({ message: 'Bahan yang sama tidak boleh muncul dua kali dalam satu produksi.' });
      return;
    }
    seenMaterialIds.add(materialId);
    usages.push({ materialId, quantity, quantityText: quantity.toFixed(3) });
  }

  const businessDate = parseBusinessDate(productionDate);
  if (isBusinessDateInFuture(businessDate)) {
    res.status(400).json({ message: 'Tanggal produksi tidak boleh berada di masa depan.' });
    return;
  }

  const product = await prisma.product.findUnique({ where: { id: productId.trim() } });
  if (!product) {
    res.status(404).json({ message: 'Produk tidak ditemukan.' });
    return;
  }
  if (!product.isActive) {
    res.status(409).json({ message: 'Produk tidak aktif dan tidak tersedia untuk produksi baru.' });
    return;
  }

  const materialsInDb = await prisma.material.findMany({
    where: { id: { in: usages.map((u) => u.materialId) } },
  });
  const materialById = new Map(materialsInDb.map((m) => [m.id, m]));
  for (const usage of usages) {
    const material = materialById.get(usage.materialId);
    if (!material) {
      res.status(404).json({ message: `Bahan baku "${usage.materialId}" tidak ditemukan.` });
      return;
    }
    if (!material.isActive) {
      res.status(409).json({ message: `Bahan baku "${material.name}" tidak aktif dan tidak dapat dipakai pada produksi baru.` });
      return;
    }
  }

  let key: string | null;
  try {
    key = readIdempotencyKey(req.headers['idempotency-key']);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Idempotency-Key tidak valid.' });
    return;
  }

  const recordedById = req.user!.id;
  const yieldText = yieldQuantity.toFixed(3);
  const noteText = normalizeNote(note);
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_BATCH_CODE_ATTEMPTS; attempt++) {
    try {
      const result = await runIdempotent<{ production: ReturnType<typeof toPublicProduction> }>(
        { key, endpoint: CREATE_ENDPOINT, userId: recordedById },
        async (tx) => {
          // Validasi stok bahan di dalam transaksi (README 5.2: produksi
          // ditolak jika stok salah satu bahan tidak mencukupi).
          for (const usage of usages) {
            const stock = await getMaterialStock(tx, usage.materialId);
            if (stock < usage.quantity) {
              const material = materialById.get(usage.materialId)!;
              throw new InsufficientStockError(
                `Stok bahan baku "${material.name}" tidak mencukupi (tersedia ${stock}, dibutuhkan ${usage.quantity}).`
              );
            }
          }

          const code = await allocateBatchCode(tx, businessDate);
          const batch = await tx.batch.create({
            data: { code, productId: product.id, productionDate: businessDate, stockQuantity: 0 },
          });

          const production = await tx.production.create({
            data: {
              productId: product.id,
              productionDate: businessDate,
              yieldQuantity: yieldText,
              note: noteText,
              recordedById,
              batchId: batch.id,
            },
          });

          // Pemakaian aktual bahan dicatat manual (README 5.2) — mengurangi
          // stok bahan dan terhubung ke pergerakan stok sebagai jejak audit.
          for (const usage of usages) {
            const usageRecord = await tx.productionMaterialUsage.create({
              data: { productionId: production.id, materialId: usage.materialId, quantity: usage.quantityText },
            });
            await tx.materialStockMovement.create({
              data: {
                materialId: usage.materialId,
                type: 'PRODUCTION_USAGE',
                quantity: usage.quantityText,
                occurredAt: businessDate,
                recordedById,
                reason: `Pemakaian produksi batch ${code}`,
                productionUsageId: usageRecord.id,
              },
            });
            await applyMaterialStockChange(tx, usage.materialId, new Prisma.Decimal(usage.quantityText).negated());
          }

          // Hasil produksi menambah stok produk jadi batch (README 5.3).
          await tx.batchStockMovement.create({
            data: {
              batchId: batch.id,
              type: 'PRODUCTION_YIELD',
              quantity: yieldText,
              occurredAt: businessDate,
              recordedById,
              reason: `Hasil produksi batch ${code}`,
              productionId: production.id,
            },
          });
          await applyBatchStockChange(tx, batch.id, new Prisma.Decimal(yieldText));

          const full = await tx.production.findUniqueOrThrow({
            where: { id: production.id },
            include: PRODUCTION_INCLUDE,
          });
          return { status: 201, body: { production: toPublicProduction(full) } };
        }
      );

      res.status(result.status);
      res.setHeader('Idempotent-Replay', result.replayed ? 'true' : 'false');
      res.json(result.body);
      return;
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        res.status(409).json({ message: error.message });
        return;
      }
      if (!isBatchCodeConflict(error)) {
        throw error;
      }
      // Kode batch diperebutkan permintaan lain — ulangi transaksi penuh
      // agar nomor urut dihitung ulang dari data terbaru.
      lastError = error;
    }
  }

  throw lastError;
});

// ---------------------------------------------------------------------------
// Melihat riwayat produksi (Admin & Operator)
// ---------------------------------------------------------------------------

productionsRouter.get('/', authenticate, async (_req, res) => {
  const productions = await prisma.production.findMany({
    orderBy: [{ productionDate: 'desc' }, { recordedAt: 'desc' }],
    include: PRODUCTION_INCLUDE,
  });
  res.json({ data: productions.map(toPublicProduction) });
});

productionsRouter.get('/:id', authenticate, async (req, res) => {
  const production = await prisma.production.findUnique({
    where: { id: pathId(req) },
    include: PRODUCTION_INCLUDE,
  });

  if (!production) {
    res.status(404).json({ message: 'Catatan produksi tidak ditemukan.' });
    return;
  }

  res.json({ production: toPublicProduction(production) });
});

// ---------------------------------------------------------------------------
// Mengoreksi catatan produksi (hanya Admin)
// ---------------------------------------------------------------------------

productionsRouter.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const productionId = pathId(req);
  const body = req.body ?? {};
  const hasYieldChange = body.yieldQuantity !== undefined;
  const hasDateChange = body.productionDate !== undefined;

  const target = await prisma.production.findUnique({ where: { id: productionId } });
  if (!target) {
    res.status(404).json({ message: 'Catatan produksi tidak ditemukan.' });
    return;
  }

  if (!hasYieldChange && !hasDateChange) {
    res.status(400).json({ message: 'Tidak ada perubahan yang diberikan. Sertakan productionDate dan/atau yieldQuantity.' });
    return;
  }

  if (hasYieldChange) {
    const yieldError = validateQuantity(body.yieldQuantity, 'Jumlah hasil');
    if (yieldError) {
      res.status(400).json({ message: yieldError });
      return;
    }
  }

  let newBusinessDate: Date | null = null;
  if (hasDateChange) {
    const dateError = validateDateOnly(body.productionDate);
    if (dateError) {
      res.status(400).json({ message: dateError });
      return;
    }
    newBusinessDate = parseBusinessDate(body.productionDate);
    if (isBusinessDateInFuture(newBusinessDate)) {
      res.status(400).json({ message: 'Tanggal produksi tidak boleh berada di masa depan.' });
      return;
    }
  }

  let key: string | null;
  try {
    key = readIdempotencyKey(req.headers['idempotency-key']);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Idempotency-Key tidak valid.' });
    return;
  }

  const changedById = req.user!.id;
  const endpoint = `PATCH /api/productions/${productionId}`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_BATCH_CODE_ATTEMPTS; attempt++) {
    try {
      const result = await runIdempotent<{ production: ReturnType<typeof toPublicProduction> }>(
        { key, endpoint, userId: changedById },
        async (tx) => {
          const current = await tx.production.findUnique({
            where: { id: productionId },
            include: { batch: true },
          });
          if (!current || !current.batchId) {
            throw new Error('CATATAN_PRODUKSI_TIDAK_DITEMUKAN');
          }

          const corrections: Prisma.ProductionCorrectionCreateManyInput[] = [];

          // --- Koreksi jumlah hasil: dampak stok batch dihitung backend ---
          if (hasYieldChange) {
            const newYield = new Prisma.Decimal(body.yieldQuantity.toFixed(3));
            const oldYield = current.yieldQuantity;
            if (!oldYield.equals(newYield)) {
              const delta = newYield.minus(oldYield);
              // Menolak perubahan yang membuat stok batch negatif; riwayat
              // penjualan/alokasi batch (B7) tetap memakai batch yang sama.
              await applyBatchStockChange(tx, current.batchId, delta);
              await tx.batchStockMovement.create({
                data: {
                  batchId: current.batchId,
                  type: 'YIELD_CORRECTION',
                  quantity: delta.toFixed(3),
                  occurredAt: new Date(),
                  recordedById: changedById,
                  reason: 'Koreksi jumlah hasil produksi oleh Admin',
                  productionId,
                },
              });
              await tx.production.update({
                where: { id: productionId },
                data: { yieldQuantity: newYield.toFixed(3) },
              });
              corrections.push({
                productionId,
                changedById,
                field: 'yieldQuantity',
                previousValue: oldYield.toFixed(3),
                newValue: newYield.toFixed(3),
              });
            }
          }

          // --- Koreksi tanggal: kode batch baru + alias kode lama ---
          if (hasDateChange) {
            const oldDate = current.productionDate;
            if (businessDateCode(oldDate) !== businessDateCode(newBusinessDate!)) {
              const oldCode = current.batch!.code;
              const newCode = await allocateBatchCode(tx, newBusinessDate!);

              await tx.batchAlias.create({ data: { batchId: current.batchId, code: oldCode } });
              await tx.batch.update({
                where: { id: current.batchId },
                data: { code: newCode, productionDate: newBusinessDate! },
              });
              await tx.production.update({
                where: { id: productionId },
                data: { productionDate: newBusinessDate! },
              });

              corrections.push({
                productionId,
                changedById,
                field: 'productionDate',
                previousValue: oldDate.toISOString(),
                newValue: newBusinessDate!.toISOString(),
              });
              corrections.push({
                productionId,
                changedById,
                field: 'batchCode',
                previousValue: oldCode,
                newValue: newCode,
              });
            }
          }

          if (corrections.length > 0) {
            await tx.productionCorrection.createMany({ data: corrections });
          }

          const full = await tx.production.findUniqueOrThrow({
            where: { id: productionId },
            include: PRODUCTION_INCLUDE,
          });
          return { status: 200, body: { production: toPublicProduction(full) } };
        }
      );

      res.status(result.status);
      res.setHeader('Idempotent-Replay', result.replayed ? 'true' : 'false');
      res.json(result.body);
      return;
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        res.status(409).json({
          message: `Koreksi ditolak: ${error.message}`,
        });
        return;
      }
      if (isProductionIdMissing(error)) {
        res.status(404).json({ message: 'Catatan produksi tidak ditemukan.' });
        return;
      }
      if (!isBatchCodeConflict(error)) {
        throw error;
      }
      // Kode batch untuk tanggal baru diperebutkan — ulangi transaksi penuh.
      lastError = error;
    }
  }

  throw lastError;
});

// Catatan produksi dan riwayat pergerakan stok tidak memiliki endpoint
// edit/hapus (README 5.3): koreksi hanya melalui PATCH di atas, yang
// menambah jejak audit tanpa menyentuh riwayat pergerakan.
export type ProductionResponse = ProductionWithRelations;

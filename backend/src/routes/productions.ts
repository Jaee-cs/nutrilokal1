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
import {
  businessDateCode,
  isBusinessDateAfter,
  isBusinessDateInFuture,
  parseBusinessDate,
} from '../lib/date';
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
import {
  convertQuantity,
  isManualUnit,
  multiplyRecipeQuantity,
  parseUnitCode,
  trimDecimal,
} from '../lib/unit-conversion';
import { authenticate, requireAdmin } from '../middleware/auth';

export const productionsRouter = Router();

const CREATE_ENDPOINT = 'POST /api/productions';

interface UsageInput {
  materialId: string;
  /** Jumlah aktual dalam satuan input pengguna (resep/manual). */
  inputQuantity: number;
  inputQuantityText: string;
  /** Satuan aktual yang dipakai pengguna (kode baku atau teks Manual). */
  inputUnit: string;
  /** Jumlah hasil konversi ke satuan stok bahan baku. */
  stockQuantity: number;
  stockQuantityText: string;
}

function normalizeNote(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isProductionIdMissing(error: unknown): boolean {
  return error instanceof Error && error.message === 'CATATAN_PRODUKSI_TIDAK_DITEMUKAN';
}

function isExpiryBeforeNewProductionDate(error: unknown): boolean {
  return error instanceof Error && error.message === 'TANGGAL_KEDALUWARSA_TIDAK_SETELAH_PRODUKSI';
}

// ---------------------------------------------------------------------------
// Mencatat produksi (Admin & Operator)
// ---------------------------------------------------------------------------

productionsRouter.post('/', authenticate, async (req, res) => {
  const body = req.body ?? {};
  const { productId, productionDate, expiryDate, yieldQuantity, note, materials } = body;

  if (typeof productId !== 'string' || productId.trim() === '') {
    res.status(400).json({ message: 'productId wajib diisi.' });
    return;
  }

  const dateError = validateDateOnly(productionDate);
  if (dateError) {
    res.status(400).json({ message: dateError });
    return;
  }

  if (typeof expiryDate !== 'string' || expiryDate.trim() === '') {
    res.status(400).json({ message: 'Tanggal kedaluwarsa wajib diisi.' });
    return;
  }
  const expiryFormatError = validateDateOnly(expiryDate);
  if (expiryFormatError) {
    res.status(400).json({ message: expiryFormatError });
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

  /**
   * `mode: 'recipe'` (default): backend menghitung sendiri kebutuhan dari
   * resep × jumlah produk. `mode: 'manual'`: jumlah dan satuan aktual yang
   * diinput pengguna dipakai, lalu tetap dikonversi dan divalidasi backend.
   * Item lama tanpa `mode` tetapi membawa `quantity` diperlakukan manual.
   */
  const rawUsages: {
    materialId: string;
    mode: 'recipe' | 'manual';
    quantity?: number;
    unit?: string;
  }[] = [];
  const seenMaterialIds = new Set<string>();
  for (const item of materials as Record<string, unknown>[]) {
    const materialId = (item.materialId as string).trim();
    if (seenMaterialIds.has(materialId)) {
      res.status(400).json({ message: 'Bahan yang sama tidak boleh muncul dua kali dalam satu produksi.' });
      return;
    }
    seenMaterialIds.add(materialId);

    const hasQuantity = item.quantity !== undefined && item.quantity !== null;
    const mode = item.mode === 'manual' || (hasQuantity && item.mode !== 'recipe') ? 'manual' : 'recipe';
    let quantity: number | undefined;
    if (mode === 'manual') {
      const usageError = validateQuantity(item.quantity, 'Jumlah pemakaian');
      if (usageError) {
        res.status(400).json({ message: usageError });
        return;
      }
      quantity = item.quantity as number;
    }
    const rawUnit = typeof item.unit === 'string' ? item.unit.trim() : '';
    rawUsages.push({ materialId, mode, quantity, unit: rawUnit || undefined });
  }

  const businessDate = parseBusinessDate(productionDate);
  if (isBusinessDateInFuture(businessDate)) {
    res.status(400).json({ message: 'Tanggal produksi tidak boleh berada di masa depan.' });
    return;
  }

  const expiryBusinessDate = parseBusinessDate(expiryDate);
  if (!isBusinessDateAfter(expiryBusinessDate, businessDate)) {
    res.status(400).json({ message: 'Tanggal kedaluwarsa harus setelah tanggal produksi.' });
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

  // Resep produk menjadi sumber kebutuhan. Backend yang mengalikan resep
  // dengan jumlah hasil dan mengonversinya ke satuan stok utama bahan.
  const recipeItems = await prisma.productRecipeItem.findMany({
    where: { productId: product.id },
    include: { material: true },
  });
  const recipeByMaterialId = new Map(recipeItems.map((item) => [item.materialId, item]));
  const requestedIds = new Set<string>([
    ...rawUsages.map((u) => u.materialId),
    ...recipeItems.map((item) => item.materialId),
  ]);

  const materialsInDb = await prisma.material.findMany({ where: { id: { in: [...requestedIds] } } });
  const materialById = new Map(materialsInDb.map((m) => [m.id, m]));

  for (const id of requestedIds) {
    const material = materialById.get(id);
    if (!material) {
      res.status(404).json({ message: `Bahan baku "${id}" tidak ditemukan.` });
      return;
    }
    if (!material.isActive) {
      res.status(409).json({
        message: `Bahan baku "${material.name}" tidak aktif dan tidak dapat dipakai pada produksi baru.`,
      });
      return;
    }
  }

  type BuildOutcome = { ok: true; usage: UsageInput } | { ok: false; message: string };

  function isManualMaterial(material: (typeof materialsInDb)[number]): boolean {
    return material.isManual || isManualUnit(material.unit);
  }

  function buildUsage(
    material: (typeof materialsInDb)[number],
    inputQuantity: Prisma.Decimal,
    inputUnit: string
  ): BuildOutcome {
    // Manual tidak dikonversi: jumlah input dipakai apa adanya sebagai stok.
    if (isManualMaterial(material)) {
      if (inputUnit !== material.unit) {
        return {
          ok: false,
          message: `Satuan Manual "${inputUnit}" harus sama persis dengan satuan stok "${material.unit}". (Bahan: ${material.name})`,
        };
      }
      return {
        ok: true,
        usage: {
          materialId: material.id,
          inputQuantity: Number(inputQuantity),
          inputQuantityText: inputQuantity.toFixed(3),
          inputUnit,
          stockQuantity: Number(trimDecimal(inputQuantity)),
          stockQuantityText: inputQuantity.toFixed(3),
        },
      };
    }

    const converted = convertQuantity(inputQuantity, inputUnit, material.unit);
    if (!converted.ok) {
      return { ok: false, message: `${converted.message} (Bahan: ${material.name})` };
    }
    return {
      ok: true,
      usage: {
        materialId: material.id,
        inputQuantity: Number(inputQuantity),
        inputQuantityText: inputQuantity.toFixed(3),
        inputUnit,
        stockQuantity: Number(converted.valueText),
        stockQuantityText: converted.value.toFixed(3),
      },
    };
  }

  function resolveInputUnit(
    material: (typeof materialsInDb)[number],
    unit?: string
  ): { ok: true; code: string } | { ok: false; message: string } {
    if (isManualMaterial(material)) {
      const code = unit ?? material.unit;
      if (code !== material.unit) {
        return {
          ok: false,
          message: `Satuan Manual "${code}" harus sama persis dengan satuan stok "${material.unit}".`,
        };
      }
      return { ok: true, code };
    }
    return unit ? parseUnitCode(unit) : { ok: true, code: material.unit };
  }

  const usages: UsageInput[] = [];
  const yieldDecimal = new Prisma.Decimal(yieldQuantity.toFixed(3));
  const manualByMaterialId = new Map(
    rawUsages.filter((u) => u.mode === 'manual').map((u) => [u.materialId, u])
  );

  for (const recipe of recipeItems) {
    const material = materialById.get(recipe.materialId)!;
    const manual = manualByMaterialId.get(recipe.materialId);

    if (isManualMaterial(material) && !manual) {
      res.status(400).json({
        message:
          `Bahan "${material.name}" bersatuan Manual tidak dapat ditarik otomatis dari resep. ` +
          'Sertakan jumlah dan satuan pemakaian manual.',
      });
      return;
    }

    if (manual) {
      const unit = resolveInputUnit(material, manual.unit);
      if (!unit.ok) {
        res.status(400).json({ message: `${unit.message} (Bahan: ${material.name})` });
        return;
      }
      const built = buildUsage(material, new Prisma.Decimal(manual.quantity!.toFixed(3)), unit.code);
      if (!built.ok) {
        res.status(400).json({ message: built.message });
        return;
      }
      usages.push(built.usage);
      continue;
    }

    const needed = multiplyRecipeQuantity(new Prisma.Decimal(recipe.quantityPerUnit), yieldDecimal);
    if (!needed.ok) {
      res.status(400).json({ message: `${needed.message} (Bahan: ${material.name})` });
      return;
    }
    const built = buildUsage(material, needed.value, recipe.recipeUnit);
    if (!built.ok) {
      res.status(400).json({ message: built.message });
      return;
    }
    usages.push(built.usage);
  }

  // Bahan di luar resep wajib menyertakan jumlah/satuan input manual.
  for (const raw of rawUsages) {
    if (recipeByMaterialId.has(raw.materialId)) continue;
    const material = materialById.get(raw.materialId)!;
    if (raw.mode === 'recipe' || raw.quantity === undefined) {
      res.status(400).json({
        message: `Bahan "${material.name}" tidak memiliki resep pada produk ini. Sertakan jumlah dan satuan input manual.`,
      });
      return;
    }
    const unit = resolveInputUnit(material, raw.unit);
    if (!unit.ok) {
      res.status(400).json({ message: `${unit.message} (Bahan: ${material.name})` });
      return;
    }
    const built = buildUsage(material, new Prisma.Decimal(raw.quantity.toFixed(3)), unit.code);
    if (!built.ok) {
      res.status(400).json({ message: built.message });
      return;
    }
    usages.push(built.usage);
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
          // ditolak jika stok salah satu bahan tidak mencukupi). Perbandingan
          // dan pengurangan memakai jumlah dalam satuan stok bahan baku.
          for (const usage of usages) {
            const stock = await getMaterialStock(tx, usage.materialId);
            if (stock < usage.stockQuantity) {
              const material = materialById.get(usage.materialId)!;
              const needed =
                usage.inputUnit === material.unit
                  ? `${usage.inputQuantityText} ${material.unit}`
                  : `${usage.inputQuantityText} ${usage.inputUnit} (${usage.stockQuantityText} ${material.unit})`;
              throw new InsufficientStockError(
                `Stok bahan baku "${material.name}" tidak mencukupi (tersedia ${stock} ${material.unit}, dibutuhkan ${needed}).`
              );
            }
          }

          const code = await allocateBatchCode(tx, businessDate);
          const expiryRecordedAt = new Date();
          const batch = await tx.batch.create({
            data: {
              code,
              productId: product.id,
              productionDate: businessDate,
              stockQuantity: 0,
              // Tanggal kedaluwarsa kini menjadi bagian wajib pencatatan
              // produksi. Nilainya langsung dianggap tervalidasi karena
              // dicatat bersama fakta produksi yang disimpan.
              expiryDate: expiryBusinessDate,
              expiryValidatedAt: expiryRecordedAt,
            },
          });

          // Audit awal: tanggal lama belum ada, tanggal baru berasal dari
          // pencatatan produksi. Perubahan berikutnya menambah baris baru.
          await tx.batchExpiryChange.create({
            data: {
              batchId: batch.id,
              changedById: recordedById,
              changedAt: expiryRecordedAt,
              previousExpiryDate: null,
              newExpiryDate: expiryBusinessDate,
            },
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

          // Pemakaian aktual bahan dicatat (README 5.2) — mengurangi stok
          // bahan dalam satuan stok dan terhubung ke pergerakan stok sebagai jejak audit.
          for (const usage of usages) {
            const material = materialById.get(usage.materialId)!;
            const usageRecord = await tx.productionMaterialUsage.create({
              data: {
                productionId: production.id,
                materialId: usage.materialId,
                quantity: usage.stockQuantityText,
                inputQuantity: usage.inputQuantityText,
                inputUnit: usage.inputUnit,
              },
            });
            await tx.materialStockMovement.create({
              data: {
                materialId: usage.materialId,
                type: 'PRODUCTION_USAGE',
                quantity: usage.stockQuantityText,
                occurredAt: businessDate,
                recordedById,
                reason:
                  usage.inputUnit === material.unit
                    ? `Pemakaian produksi batch ${code}`
                    : `Pemakaian produksi batch ${code} (${usage.inputQuantityText} ${usage.inputUnit} = ${usage.stockQuantityText} ${material.unit})`,
                productionUsageId: usageRecord.id,
              },
            });
            await applyMaterialStockChange(
              tx,
              usage.materialId,
              new Prisma.Decimal(usage.stockQuantityText).negated()
            );
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

          // Tanggal produksi tidak boleh digeser hingga menyamai/melewati
          // tanggal kedaluwarsa batch. Ini menjaga invariant yang sama
          // dengan pencatatan produksi dan edit tanggal kedaluwarsa.
          if (
            hasDateChange &&
            current.batch?.expiryDate &&
            !isBusinessDateAfter(current.batch.expiryDate, newBusinessDate!)
          ) {
            throw new Error('TANGGAL_KEDALUWARSA_TIDAK_SETELAH_PRODUKSI');
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
      if (isExpiryBeforeNewProductionDate(error)) {
        res.status(400).json({
          message: 'Tanggal produksi baru harus sebelum tanggal kedaluwarsa batch.',
        });
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

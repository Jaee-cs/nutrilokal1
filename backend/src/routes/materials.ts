/**
 * Master bahan baku (README 5.1 dan 4).
 *
 * - Melihat daftar/detail: Admin dan Operator (informasi operasional).
 * - Membuat, mengubah, menonaktifkan/mengaktifkan, mengarsipkan: hanya Admin.
 * - Setiap bahan baku memiliki satu satuan dasar; tidak ada konversi satuan otomatis.
 * - DELETE kini berarti arsip (soft archive), bukan hapus permanen. Saldo stok
 *   dan seluruh riwayat penerimaan/pemakaian/pergerakan tidak diubah.
 * - Daftar operasional hanya menampilkan bahan aktif; bahan arsip dikelola
 *   lewat halaman Arsip Admin.
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import {
  archiveMaterial,
  checkRestoreConflict,
  parseArchiveReason,
} from '../lib/archive';
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
import {
  areUnitsCompatible,
  convertQuantity,
  isAutomaticConversion,
  isManualUnit,
  parseMaterialUnit,
} from '../lib/unit-conversion';
import { validateName, validateReason } from '../lib/validate';
import { authenticate, requireAdmin } from '../middleware/auth';
import { materialOpeningBalancesRouter, materialReceiptsRouter } from './material-records';

export const materialsRouter = Router();

/** Penanda internal: konversi satuan utama tidak aman atau tidak diizinkan. */
class UnitChangeError extends Error {}

/**
 * Validasi saldo eksplisit yang diberikan Admin saat mengubah satuan tanpa
 * konversi (Manual atau lintas kelompok). Boleh nol, tetapi tidak negatif dan
 * maksimal 3 desimal seperti presisi stok.
 */
function validateExplicitStock(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Stok baru pada satuan tujuan wajib berupa angka.';
  }
  if (value < 0) {
    return 'Stok baru tidak boleh negatif.';
  }
  if (value >= 1e11) {
    return 'Stok baru terlalu besar.';
  }
  const text = String(value);
  if (text.includes('e')) {
    return 'Stok baru maksimal 3 angka di belakang koma.';
  }
  const decimals = text.split('.')[1];
  if (decimals && decimals.length > 3) {
    return 'Stok baru maksimal 3 angka di belakang koma.';
  }
  return null;
}

/** Riwayat yang membuat perubahan satuan langsung tidak aman. */
async function hasUnitChangeHistory(materialId: string): Promise<boolean> {
  const [operational, movements] = await Promise.all([
    hasOperationalHistory('material', materialId),
    prisma.materialStockMovement.count({ where: { materialId } }),
  ]);
  return operational || movements > 0;
}

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
  // Daftar/pilihan operasional hanya bahan aktif; saldo tetap dihitung dari
  // seluruh baris stok yang tidak dihapus saat bahan diarsipkan.
  const materials = await prisma.material.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });

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

  const parsedUnit = parseMaterialUnit(unit, req.body?.unitKind);
  if (!parsedUnit.ok) {
    res.status(400).json({ message: parsedUnit.message });
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
      data: {
        name: trimmedName,
        nameKey,
        unit: parsedUnit.value.unit,
        isManual: parsedUnit.value.isManual,
      },
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

  // Unchecked input agar kolom FK arsip (archivedById) ikut bisa ditulis.
  const data: Prisma.MaterialUncheckedUpdateInput = {};

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
    const parsedUnit = parseMaterialUnit(body.unit, body.unitKind);
    if (!parsedUnit.ok) {
      res.status(400).json({ message: parsedUnit.message });
      return;
    }
    const next = parsedUnit.value;
    const changed = next.unit !== target.unit || next.isManual !== target.isManual;

    if (changed) {
      // Resep standar menyimpan satuan per bahan. Perubahan satuan utama yang
      // membuat satuan resep tidak lagi kompatibel akan merusak perhitungan
      // produksi, jadi ditolak hingga Admin memperbarui resep terkait.
      const recipeItems = await prisma.productRecipeItem.findMany({
        where: { materialId: target.id },
        include: { product: { select: { name: true } } },
      });
      const incompatible = recipeItems.find(
        (item) => !areUnitsCompatible(item.recipeUnit, next.unit)
      );
      if (incompatible) {
        res.status(409).json({
          message:
            `Satuan utama tidak dapat diubah karena resep produk "${incompatible.product.name}" ` +
            `memakai satuan "${incompatible.recipeUnit}". Perbarui resep terlebih dahulu.`,
        });
        return;
      }

      const wasManual = target.isManual || isManualUnit(target.unit);
      const needsExplicitAdjustment =
        wasManual || next.isManual || !areUnitsCompatible(target.unit, next.unit);
      if (needsExplicitAdjustment) {
        res.status(409).json({
          message:
            'Perubahan ke/dari satuan Manual atau antar kelompok berat/volume tidak boleh sekadar mengganti label. ' +
            'Gunakan Penyesuaian Satuan dengan stok eksplisit agar perubahan tercatat.',
        });
        return;
      }

      // PATCH hanya untuk bahan yang benar-benar belum dipakai. Bahan dengan
      // riwayat harus memakai endpoint konversi yang mencatat pergerakan stok.
      if (await hasUnitChangeHistory(target.id)) {
        res.status(409).json({
          message:
            'Satuan utama tidak dapat diubah langsung karena bahan baku sudah memiliki riwayat operasional. ' +
            'Gunakan fitur Penyesuaian Satuan agar perubahan stok tercatat.',
        });
        return;
      }
    }

    data.unit = next.unit;
    data.isManual = next.isManual;
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      res.status(400).json({ message: 'Field isActive wajib berupa boolean.' });
      return;
    }

    if (body.isActive === true) {
      const conflict = await checkRestoreConflict(prisma, 'material', {
        id: target.id,
        nameKey: typeof data.nameKey === 'string' ? data.nameKey : target.nameKey,
      });
      if (conflict) {
        res.status(conflict.status).json({ message: conflict.message });
        return;
      }
    }

    data.isActive = body.isActive;
    if (body.isActive === false) {
      data.archivedAt = target.archivedAt ?? new Date();
      data.archivedById = target.archivedById ?? req.user!.id;
      data.archiveReason = target.archiveReason ?? null;
    } else {
      data.archivedAt = null;
      data.archivedById = null;
      data.archiveReason = null;
    }
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
 * Penyesuaian satuan stok utama bahan baku (hanya Admin).
 *
 * Dua alur:
 * 1. Berat ↔ berat atau volume ↔ volume: stok dikonversi otomatis dengan
 *    presisi desimal dan dicatat sebagai `UNIT_CONVERSION`.
 * 2. Manual, atau pindah kelompok berat/volume: TIDAK ada konversi. Admin
 *    wajib mengirim `adjustment` berisi stok eksplisit di satuan baru dan
 *    alasan; nilainya dicatat sebagai `ADJUSTMENT` yang tercatat.
 *
 * Resep tidak boleh tersisa saat mengubah ke/dari Manual, dan resep yang
 * tidak kompatibel ditolak pada alur konversi otomatis. Semua perubahan
 * berada dalam satu transaksi.
 */
materialsRouter.post('/:id/unit-change', authenticate, requireAdmin, async (req, res) => {
  const target = await prisma.material.findUnique({ where: { id: pathId(req) } });
  if (!target) {
    res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    return;
  }

  const parsed = parseMaterialUnit(req.body?.newUnit, req.body?.unitKind);
  if (!parsed.ok) {
    res.status(400).json({ message: parsed.message });
    return;
  }
  const next = parsed.value;
  const fromManual = target.isManual || isManualUnit(target.unit);

  if (next.unit === target.unit && next.isManual === target.isManual) {
    res.status(400).json({ message: 'Satuan baru sama dengan satuan utama saat ini.' });
    return;
  }

  const recipeItems = await prisma.productRecipeItem.findMany({
    where: { materialId: target.id },
    include: { product: { select: { name: true } } },
  });
  const automatic = !fromManual && !next.isManual && isAutomaticConversion(target.unit, next.unit);

  if (automatic) {
    const incompatible = recipeItems.find(
      (item) => !areUnitsCompatible(item.recipeUnit, next.unit)
    );
    if (incompatible) {
      res.status(409).json({
        message:
          `Satuan utama tidak dapat diubah karena resep produk "${incompatible.product.name}" ` +
          `memakai satuan "${incompatible.recipeUnit}". Perbarui resep terlebih dahulu.`,
      });
      return;
    }
  } else {
    const adjustment = req.body?.adjustment as Record<string, unknown> | undefined;
    if (!adjustment || typeof adjustment !== 'object') {
      res.status(400).json({
        message: 'Perubahan satuan ini tidak dikonversi otomatis. Sertakan adjustment berisi stok eksplisit dan alasan.',
      });
      return;
    }
    const stockError = validateExplicitStock(adjustment.quantity);
    if (stockError) {
      res.status(400).json({ message: stockError });
      return;
    }
    const reasonError = validateReason(adjustment.reason);
    if (reasonError) {
      res.status(400).json({ message: reasonError });
      return;
    }

    if (recipeItems.length > 0) {
      res.status(409).json({
        message:
          'Bahan masih dipakai pada resep produk. Perbarui atau hapus resep terkait terlebih dahulu ' +
          'sebelum mengubah ke/dari satuan Manual atau kelompok lain.',
      });
      return;
    }
  }

  const recordedById = req.user!.id;
  const occurredAt = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.material.findUniqueOrThrow({ where: { id: target.id } });
      const stock = await tx.materialStock.findUnique({ where: { materialId: fresh.id } });
      const previousStock = stock ? new Prisma.Decimal(stock.quantity) : new Prisma.Decimal(0);

      let finalStock: Prisma.Decimal;
      let movementReason: string | null = null;
      let movementType: 'UNIT_CONVERSION' | 'ADJUSTMENT' | null = null;
      let movementQuantity: string | null = null;

      if (automatic) {
        if (previousStock.isZero()) {
          finalStock = new Prisma.Decimal(0);
        } else {
          const outcome = convertQuantity(previousStock, fresh.unit, next.unit);
          if (!outcome.ok) throw new UnitChangeError(outcome.message);
          finalStock = outcome.value;
        }
        const delta = finalStock.minus(previousStock);
        if (!delta.isZero()) {
          movementType = 'UNIT_CONVERSION';
          movementQuantity = delta.toFixed(3);
          movementReason =
            `Konversi satuan utama ${fresh.unit} → ${next.unit}: ` +
            `${previousStock.toFixed(3)} ${fresh.unit} = ${finalStock.toFixed(3)} ${next.unit}`;
        }
      } else {
        const adjustment = req.body.adjustment as { quantity: number; reason: string };
        finalStock = new Prisma.Decimal(adjustment.quantity.toFixed(3));
        movementType = 'ADJUSTMENT';
        movementQuantity = finalStock.toFixed(3);
        movementReason =
          `Penetapan ulang stok tanpa konversi saat perubahan satuan ${fresh.unit} → ${next.unit}: ` +
          `${previousStock.toFixed(3)} ${fresh.unit} tidak dikonversi menjadi ` +
          `${finalStock.toFixed(3)} ${next.unit}. Alasan: ${adjustment.reason.trim()}`;
      }

      const material = await tx.material.update({
        where: { id: fresh.id },
        data: { unit: next.unit, isManual: next.isManual },
      });

      if (stock) {
        if (finalStock.isZero()) {
          await tx.materialStock.delete({ where: { materialId: fresh.id } });
        } else {
          await tx.materialStock.update({
            where: { materialId: fresh.id },
            data: { quantity: finalStock.toFixed(3) },
          });
        }
      } else if (!finalStock.isZero()) {
        await tx.materialStock.create({
          data: { materialId: fresh.id, quantity: finalStock.toFixed(3) },
        });
      }

      if (movementType && movementReason && movementQuantity) {
        await tx.materialStockMovement.create({
          data: {
            materialId: fresh.id,
            type: movementType,
            quantity: movementQuantity,
            occurredAt,
            recordedById,
            reason: movementReason,
          },
        });
      }

      return {
        material: toPublicMaterial(material, Number(finalStock)),
        previousStock: previousStock.toFixed(3),
        currentStock: finalStock.toFixed(3),
      };
    });

    res.json(result);
  } catch (error) {
    if (error instanceof UnitChangeError) {
      res.status(400).json({ message: error.message });
      return;
    }
    throw error;
  }
});

/**
 * Kompatibilitas endpoint lama: DELETE kini SELALU mengarsipkan, bukan
 * menghapus permanen. Baris stok, penerimaan, pemakaian, penyesuaian, dan
 * pergerakan tidak dihapus atau diubah; Admin hanya menerima peringatan
 * bila masih ada saldo.
 */
materialsRouter.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const reason = parseArchiveReason(req.body?.reason);
  if (!reason.ok) {
    res.status(400).json({ message: reason.message });
    return;
  }

  const result = await archiveMaterial(pathId(req), req.user!.id, reason.value);
  if (!result.ok) {
    res.status(result.status).json({ message: result.message });
    return;
  }

  res.json({
    message: result.unchanged
      ? `Bahan baku "${result.data.name}" sudah diarsipkan.`
      : `Bahan baku "${result.data.name}" diarsipkan. Saldo dan riwayat tetap utuh.`,
    ...(result.warning ? { warning: result.warning } : {}),
    archived: true,
    material: toPublicMaterial(result.data, 0),
  });
});

// Riwayat penerimaan dan saldo awal per bahan baku.
materialsRouter.use('/:id/receipts', materialReceiptsRouter);
materialsRouter.use('/:id/opening-balances', materialOpeningBalancesRouter);

/**
 * Master produk (README 5.1 dan 4).
 *
 * - Melihat daftar/detail: Admin dan Operator (informasi operasional).
 * - Membuat, mengubah, menonaktifkan/mengaktifkan, menghapus: hanya Admin.
 * - Setiap produk memiliki satu satuan dasar; tidak ada konversi satuan otomatis.
 * - Penghapusan (DELETE) mengikuti README 5.1 dengan urutan pemeriksaan:
 *     1. stok total (jumlah stok seluruh batch) wajib nol — stok tidak pernah
 *        dikurangi, dibuang, atau dipaksa agar penghapusan berhasil;
 *     2. produk yang masih punya riwayat operasional TIDAK dihapus permanen —
 *        diarsipkan (isActive = false) agar riwayat produksi, batch, penjualan,
 *        dan QR tetap utuh;
 *     3. produk tanpa riwayat dihapus permanen.
 * - Penonaktifan/arsip tidak menghapus riwayat, dan produk arsip tetap muncul
 *   di daftar master agar informasi historisnya masih bisa ditampilkan.
 * - Produk nonaktif tidak tersedia untuk produksi/penjualan baru dan tidak
 *   muncul di katalog aktif (pemeriksaan pemakaian dilakukan modul B5/B7/B8).
 */
import { Prisma } from '@prisma/client';
import express, { Router } from 'express';
import { pathId } from '../lib/http';
import { hasOperationalHistory } from '../lib/master-history';
import { parseReportPeriod } from '../lib/report';
import { prisma } from '../lib/prisma';
import { toPublicProduct } from '../lib/product';
import { parseNutritionInput } from '../lib/product-nutrition';
import { PRODUCT_RECIPE_INCLUDE, parseRecipeInput } from '../lib/product-recipe';
import {
  canonicalUnit,
  isManualUnit,
  validateRecipeUnitCompatibility,
  type UnitCode,
} from '../lib/unit-conversion';
import {
  PRODUCT_STOCK_MOVEMENT_INCLUDE,
  buildProductStockHistory,
  parseProductStockMovementType,
} from '../lib/product-stock-history';
import {
  ALLOWED_PHOTO_MIME_LIST,
  MAX_PHOTO_BYTES,
  PHOTO_SIZE_MESSAGE,
  deleteProductPhoto,
  storeProductPhoto,
  validatePhotoBuffer,
} from '../lib/product-photo';
import {
  normalizeDescription,
  validateDescription,
  validateName,
  validateOptionalText,
  validateSellingPrice,
  validateUnit,
} from '../lib/validate';
import { authenticate, requireAdmin } from '../middleware/auth';

export const productsRouter = Router();

// ---------------------------------------------------------------------------
// Foto produk (unggahan berkas ke penyimpanan Cloudinary / lokal, README 5.6)
//
// - Berkas dikirim sebagai body biner mentah dengan Content-Type gambar
//   (tanpa multipart dan tanpa base64), lalu diteruskan backend ke Cloudinary
//   (bila dikonfigurasi) atau disimpan sebagai file lokal (fallback).
// - API secret Cloudinary tidak pernah dikirim ke frontend.
// - Hanya Admin (ditegakkan requireAdmin); Operator tidak dapat mengunggah
//   maupun menghapus foto lewat API.
// - Tipe diperiksa dari isi berkas (magic bytes) dan ukurannya dibatasi.
// ---------------------------------------------------------------------------

const PHOTO_MAX_MB = MAX_PHOTO_BYTES / (1024 * 1024);

const photoBodyParser = express.raw({
  type: ALLOWED_PHOTO_MIME_LIST,
  limit: MAX_PHOTO_BYTES,
});

function isPayloadTooLarge(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { type, status, statusCode } = error as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  return type === 'entity.too.large' || status === 413 || statusCode === 413;
}

/** Parser foto yang mengubah kegagalan body-parser menjadi pesan Indonesia. */
function parsePhoto(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  photoBodyParser(req, res, (error: unknown) => {
    if (error) {
      if (isPayloadTooLarge(error)) {
        res.status(413).json({ message: PHOTO_SIZE_MESSAGE });
        return;
      }
      next(error);
      return;
    }
    if (!Buffer.isBuffer(req.body)) {
      // Content-Type bukan gambar yang diizinkan → body tidak dibaca.
      res.status(400).json({
        message: 'Kirim foto sebagai body berkas gambar (JPG, PNG, atau WEBP), bukan JSON atau teks.',
      });
      return;
    }
    next();
  });
}

/** Mengubah foto produk: unggah (body biner) — menggantikan foto lama bila ada. */
productsRouter.post(
  '/:id/photo',
  authenticate,
  requireAdmin,
  parsePhoto,
  async (req, res) => {
    const target = await prisma.product.findUnique({ where: { id: pathId(req) } });
    if (!target) {
      res.status(404).json({ message: 'Produk tidak ditemukan.' });
      return;
    }

    const validation = validatePhotoBuffer(req.body as Buffer);
    if (!validation.ok) {
      res.status(400).json({ message: validation.message });
      return;
    }

    // 1) Unggah foto BARU lebih dulu. Foto lama belum disentuh.
    const stored = await storeProductPhoto(target.id, req.body as Buffer, validation.mime!);

    // 2) Simpan URL & public ID baru ke database. Bila gagal, foto yang baru
    //    diunggah dibersihkan agar tidak meninggalkan berkas tanpa pemilik;
    //    foto lama tetap utuh (belum dihapus) sehingga data tetap konsisten.
    let updated;
    try {
      updated = await prisma.product.update({
        where: { id: target.id },
        data: { photoUrl: stored.photoUrl, photoPublicId: stored.photoPublicId },
      });
    } catch (error) {
      await deleteProductPhoto(stored.photoUrl, stored.photoPublicId).catch(() => undefined);
      throw error;
    }

    // 3) Baru setelah database sukses, hapus foto LAMA (bila ada dan berbeda).
    if (target.photoUrl && target.photoUrl !== stored.photoUrl) {
      await deleteProductPhoto(target.photoUrl, target.photoPublicId);
    }

    res.json({
      message: 'Foto produk berhasil disimpan.',
      product: toPublicProduct(updated),
    });
  }
);

/** Menghapus foto produk (opsional; produk boleh tetap tanpa foto). */
productsRouter.delete('/:id/photo', authenticate, requireAdmin, async (req, res) => {
  const target = await prisma.product.findUnique({ where: { id: pathId(req) } });
  if (!target) {
    res.status(404).json({ message: 'Produk tidak ditemukan.' });
    return;
  }

  const updated = await prisma.product.update({
    where: { id: target.id },
    data: { photoUrl: null, photoPublicId: null },
  });
  // Hapus berkas hanya setelah kolom database dikosongkan.
  await deleteProductPhoto(target.photoUrl, target.photoPublicId);

  res.json({ message: 'Foto produk dihapus.', product: toPublicProduct(updated) });
});

// ---------- Melihat (Admin & Operator) ----------

productsRouter.get('/', authenticate, async (_req, res) => {
  const products = await prisma.product.findMany({
    orderBy: { name: 'asc' },
    include: PRODUCT_RECIPE_INCLUDE,
  });

  // Total stok per produk = jumlah stok seluruh batch (README 5.4),
  // diturunkan dari data batch — bukan angka tersimpan terpisah.
  const totals = await prisma.batch.groupBy({
    by: ['productId'],
    _sum: { stockQuantity: true },
    _count: { _all: true },
  });
  const totalsByProduct = new Map(
    totals.map((t) => [
      t.productId,
      { stock: Number(t._sum.stockQuantity ?? 0), batchCount: t._count._all },
    ])
  );

  res.json({
    data: products.map((product) =>
      // Produk tanpa batch tetap memperlihatkan total 0 dan batchCount 0
      // agar bentuk respons konsisten.
      toPublicProduct(product, totalsByProduct.get(product.id) ?? { stock: 0, batchCount: 0 })
    ),
  });
});

// ---------------------------------------------------------------------------
// Riwayat pergerakan stok produk jadi (Admin & Operator) — hanya baca
//
// Sumber: ledger BatchStockMovement. Filter produk/waktu/jenis/batch
// dijalankan di backend. Saldo berjalan selalu dihitung dari seluruh ledger
// produk agar tetap benar meski filter memilih sebagian baris.
// ---------------------------------------------------------------------------

async function sendProductStockHistory(
  req: express.Request,
  res: express.Response,
  productId: string
): Promise<void> {
  if (!productId) {
    res.status(400).json({ message: 'productId wajib diisi untuk melihat riwayat stok produk.' });
    return;
  }

  const period = parseReportPeriod(req.query as Record<string, unknown>);
  if (!period.ok) {
    res.status(400).json({ message: period.message });
    return;
  }

  const parsedType = parseProductStockMovementType(req.query.type);
  if (!parsedType.ok) {
    res.status(400).json({
      message:
        'Jenis aktivitas tidak valid. Gunakan PRODUCTION_YIELD, YIELD_CORRECTION, ' +
        'OPENING_BALANCE, ADJUSTMENT, SALE, atau SALE_CANCELLATION.',
    });
    return;
  }

  const batchIdQuery = req.query.batchId;
  if (
    batchIdQuery !== undefined &&
    batchIdQuery !== null &&
    typeof batchIdQuery !== 'string'
  ) {
    res.status(400).json({ message: 'batchId harus berupa satu kode ID batch.' });
    return;
  }
  const batchId =
    typeof batchIdQuery === 'string' && batchIdQuery.trim() !== ''
      ? batchIdQuery.trim()
      : null;

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    res.status(404).json({ message: 'Produk tidak ditemukan.' });
    return;
  }

  const batches = await prisma.batch.findMany({
    where: { productId: product.id },
    select: {
      id: true,
      code: true,
      stockQuantity: true,
      productionDate: true,
      createdAt: true,
    },
    orderBy: [{ code: 'asc' }],
  });

  if (batchId && !batches.some((batch) => batch.id === batchId)) {
    res.status(404).json({ message: 'Batch tidak ditemukan untuk produk ini.' });
    return;
  }

  // Seluruh ledger produk diperlukan untuk saldo berjalan, walaupun respons
  // akhirnya hanya memuat baris yang lolos filter.
  const movements = await prisma.batchStockMovement.findMany({
    where: { batch: { productId: product.id } },
    orderBy: [{ occurredAt: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }],
    include: PRODUCT_STOCK_MOVEMENT_INCLUDE,
  });

  const history = buildProductStockHistory({
    product: { id: product.id, name: product.name, unit: product.unit },
    batches,
    movements,
    filters: {
      from: period.period.from,
      to: period.period.to,
      range: period.period.range,
      type: parsedType.type,
      batchId,
    },
  });

  res.json(history);
}

// Bentuk URL dengan produk sebagai query (produk tetap salah satu filter).
productsRouter.get('/stock-movements', authenticate, async (req, res) => {
  const query = req.query.productId;
  const productId =
    typeof query === 'string' && query.trim() !== '' ? query.trim() : '';
  await sendProductStockHistory(req, res, productId);
});

// Bentuk URL per produk: GET /api/products/:id/stock-movements.
productsRouter.get('/:id/stock-movements', authenticate, async (req, res) => {
  await sendProductStockHistory(req, res, pathId(req));
});

productsRouter.get('/:id', authenticate, async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: pathId(req) },
    include: PRODUCT_RECIPE_INCLUDE,
  });

  if (!product) {
    res.status(404).json({ message: 'Produk tidak ditemukan.' });
    return;
  }

  const totals = await prisma.batch.aggregate({
    where: { productId: product.id },
    _sum: { stockQuantity: true },
    _count: { _all: true },
  });

  res.json({
    product: toPublicProduct(product, {
      stock: Number(totals._sum.stockQuantity ?? 0),
      batchCount: totals._count._all,
    }),
  });
});

// ---------- Mengubah (hanya Admin) ----------

async function validateRecipeItems(items: { materialId: string; quantityPerUnit: number; recipeUnit: string }[]) {
  if (items.length === 0) return null as
    | null
    | { message: string; status: number }
    | { data: { materialId: string; quantityPerUnit: string; recipeUnit: UnitCode }[] };

  const materialIds = items.map((i) => i.materialId);
  const materials = await prisma.material.findMany({
    where: { id: { in: materialIds } },
    select: { id: true, name: true, unit: true, isManual: true, isActive: true },
  });
  const byId = new Map(materials.map((m) => [m.id, m]));

  const data: { materialId: string; quantityPerUnit: string; recipeUnit: UnitCode }[] = [];
  for (const item of items) {
    const material = byId.get(item.materialId);
    if (!material) {
      return { message: `Bahan baku resep "${item.materialId}" tidak ditemukan.`, status: 404 };
    }
    if (!material.isActive) {
      return {
        message: `Bahan baku "${material.name}" tidak aktif dan tidak dapat dipakai pada resep.`,
        status: 409,
      };
    }
    if (material.isManual || isManualUnit(material.unit)) {
      return {
        message:
          `Bahan baku "${material.name}" bersatuan Manual tidak dapat dipakai pada resep otomatis. ` +
          'Catat pemakaiannya secara manual saat produksi.',
        status: 400,
      };
    }
    const compatError = validateRecipeUnitCompatibility(item.recipeUnit, material.unit);
    if (compatError) {
      return { message: `${compatError} (Bahan: ${material.name})`, status: 400 };
    }
    data.push({
      materialId: material.id,
      quantityPerUnit: item.quantityPerUnit.toFixed(3),
      recipeUnit: canonicalUnit(item.recipeUnit)!,
    });
  }
  return { data, status: 200 as const };
}

productsRouter.post('/', authenticate, requireAdmin, async (req, res) => {
  const { name, description, composition, storageInstructions, unit, sellingPrice, recipe, nutrition } =
    req.body ?? {};

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

  const descriptionError = validateDescription(description);
  if (descriptionError) {
    res.status(400).json({ message: descriptionError });
    return;
  }

  const compositionError = validateOptionalText(composition, 'Komposisi bahan');
  if (compositionError) {
    res.status(400).json({ message: compositionError });
    return;
  }

  const storageError = validateOptionalText(storageInstructions, 'Petunjuk penyimpanan');
  if (storageError) {
    res.status(400).json({ message: storageError });
    return;
  }

  const priceError = validateSellingPrice(sellingPrice);
  if (priceError) {
    res.status(400).json({ message: priceError });
    return;
  }

  const parsedRecipe = parseRecipeInput(recipe);
  if (!parsedRecipe.ok) {
    res.status(400).json({ message: parsedRecipe.message });
    return;
  }

  const parsedNutrition =
    nutrition === undefined ? { ok: true as const, value: null } : parseNutritionInput(nutrition);
  if (!parsedNutrition.ok) {
    res.status(400).json({ message: parsedNutrition.message });
    return;
  }

  const recipeResult = await validateRecipeItems(parsedRecipe.items);
  if (recipeResult && 'message' in recipeResult) {
    res.status(recipeResult.status).json({ message: recipeResult.message });
    return;
  }

  const product = await prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name: name.trim(),
        description: normalizeDescription(description),
        composition: normalizeDescription(composition),
        storageInstructions: normalizeDescription(storageInstructions),
        unit: unit.trim(),
        sellingPrice: sellingPrice.toFixed(2),
        nutrition: (parsedNutrition.value ?? Prisma.JsonNull) as Prisma.InputJsonValue | Prisma.NullTypes.JsonNull,
      },
    });
    if (recipeResult && 'data' in recipeResult && recipeResult.data.length > 0) {
      await tx.productRecipeItem.createMany({
        data: recipeResult.data.map((item) => ({ ...item, productId: created.id })),
      });
    }
    return tx.product.findUniqueOrThrow({
      where: { id: created.id },
      include: PRODUCT_RECIPE_INCLUDE,
    });
  });

  res.status(201).json({ product: toPublicProduct(product) });
});

productsRouter.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const body = req.body ?? {};
  const target = await prisma.product.findUnique({ where: { id: pathId(req) } });

  if (!target) {
    res.status(404).json({ message: 'Produk tidak ditemukan.' });
    return;
  }

  const data: Prisma.ProductUpdateInput = {};

  if (body.name !== undefined) {
    const nameError = validateName(body.name);
    if (nameError) {
      res.status(400).json({ message: nameError });
      return;
    }
    data.name = body.name.trim();
  }

  if (body.description !== undefined) {
    const descriptionError = validateDescription(body.description);
    if (descriptionError) {
      res.status(400).json({ message: descriptionError });
      return;
    }
    data.description = normalizeDescription(body.description);
  }

  if (body.composition !== undefined) {
    const compositionError = validateOptionalText(body.composition, 'Komposisi bahan');
    if (compositionError) {
      res.status(400).json({ message: compositionError });
      return;
    }
    data.composition = normalizeDescription(body.composition);
  }

  if (body.storageInstructions !== undefined) {
    const storageError = validateOptionalText(body.storageInstructions, 'Petunjuk penyimpanan');
    if (storageError) {
      res.status(400).json({ message: storageError });
      return;
    }
    data.storageInstructions = normalizeDescription(body.storageInstructions);
  }

  if (body.unit !== undefined) {
    const unitError = validateUnit(body.unit);
    if (unitError) {
      res.status(400).json({ message: unitError });
      return;
    }
    // Satuan dasar tidak boleh berubah setelah ada riwayat operasional,
    // agar produksi, stok, dan penjualan tetap memakai satuan yang sama.
    if (body.unit.trim() !== target.unit && (await hasOperationalHistory('product', target.id))) {
      res.status(409).json({
        message: 'Satuan dasar tidak dapat diubah karena produk sudah memiliki riwayat operasional.',
      });
      return;
    }
    data.unit = body.unit.trim();
  }

  if (body.sellingPrice !== undefined) {
    const priceError = validateSellingPrice(body.sellingPrice);
    if (priceError) {
      res.status(400).json({ message: priceError });
      return;
    }
    data.sellingPrice = body.sellingPrice.toFixed(2);
  }

  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      res.status(400).json({ message: 'Field isActive wajib berupa boolean.' });
      return;
    }
    data.isActive = body.isActive;
  }

  const nutritionProvided = body.nutrition !== undefined;
  if (nutritionProvided) {
    const parsedNutrition = parseNutritionInput(body.nutrition);
    if (!parsedNutrition.ok) {
      res.status(400).json({ message: parsedNutrition.message });
      return;
    }
    data.nutrition =
      (parsedNutrition.value ?? Prisma.JsonNull) as Prisma.InputJsonValue | Prisma.NullTypes.JsonNull;
  }

  const recipeProvided = body.recipe !== undefined;
  let parsedRecipe: ReturnType<typeof parseRecipeInput> | null = null;
  let recipeResult: Awaited<ReturnType<typeof validateRecipeItems>> | null = null;
  if (recipeProvided) {
    parsedRecipe = parseRecipeInput(body.recipe);
    if (!parsedRecipe.ok) {
      res.status(400).json({ message: parsedRecipe.message });
      return;
    }
    recipeResult = await validateRecipeItems(parsedRecipe.items);
    if (recipeResult && 'message' in recipeResult) {
      res.status(recipeResult.status).json({ message: recipeResult.message });
      return;
    }
  }

  if (Object.keys(data).length === 0 && !recipeProvided) {
    res.status(400).json({ message: 'Tidak ada perubahan yang diberikan.' });
    return;
  }

  const product = await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.product.update({ where: { id: target.id }, data });
    }
    if (recipeProvided && parsedRecipe && parsedRecipe.ok) {
      // Resep standar diganti utuh; riwayat produksi lama tidak diubah.
      await tx.productRecipeItem.deleteMany({ where: { productId: target.id } });
      if (recipeResult && 'data' in recipeResult && recipeResult.data.length > 0) {
        await tx.productRecipeItem.createMany({
          data: recipeResult.data.map((item) => ({ ...item, productId: target.id })),
        });
      }
    }
    return tx.product.findUniqueOrThrow({
      where: { id: target.id },
      include: PRODUCT_RECIPE_INCLUDE,
    });
  });

  res.json({ product: toPublicProduct(product) });
});

productsRouter.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const target = await prisma.product.findUnique({ where: { id: pathId(req) } });

  if (!target) {
    res.status(404).json({ message: 'Produk tidak ditemukan.' });
    return;
  }

  // 1) Stok total = jumlah stok seluruh batch (README 5.4). Selama masih ada
  //    stok, penghapusan ditolak — sistem tidak mengurangi/membuang stok untuk
  //    memaksa penghapusan berhasil.
  const totals = await prisma.batch.aggregate({
    where: { productId: target.id },
    _sum: { stockQuantity: true },
  });
  const stock = Number(totals._sum.stockQuantity ?? 0);
  if (stock > 0) {
    res.status(409).json({
      message:
        `Masih ada stok ${target.name} sebanyak ${stock.toLocaleString('id-ID')} ` +
        `${target.unit}. Selesaikan stok terlebih dahulu sebelum menghapus produk.`,
    });
    return;
  }

  // 2) Produk dengan riwayat operasional: diarsipkan (hapus logis) — baris,
  //    riwayat, dan QR tetap tersimpan; produk tidak lagi tersedia untuk
  //    produksi/penjualan baru.
  if (await hasOperationalHistory('product', target.id)) {
    const archived = target.isActive
      ? await prisma.product.update({ where: { id: target.id }, data: { isActive: false } })
      : target;

    res.json({
      message:
        `Produk "${target.name}" diarsipkan karena sudah memiliki riwayat. ` +
        'Riwayat produksi, batch, penjualan, dan QR tetap utuh.',
      archived: true,
      product: toPublicProduct(archived),
    });
    return;
  }

  // 3) Produk tanpa riwayat dan tanpa stok: dihapus permanen (README 5.1).
  //    Berkas fotonya ikut dibersihkan agar tidak menumpuk tanpa pemilik.
  await prisma.product.delete({ where: { id: target.id } });
  await deleteProductPhoto(target.photoUrl, target.photoPublicId);
  res.json({ message: `Produk "${target.name}" berhasil dihapus.`, archived: false });
});

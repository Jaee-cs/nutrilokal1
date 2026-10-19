/**
 * Master produk (README 5.1 dan 4).
 *
 * - Melihat daftar/detail: Admin dan Operator (informasi operasional).
 * - Membuat, mengubah, menonaktifkan/mengaktifkan, menghapus: hanya Admin.
 * - Setiap produk memiliki satu satuan dasar; tidak ada konversi satuan otomatis.
 * - Produk yang sudah memiliki riwayat operasional tidak boleh dihapus;
 *   Admin hanya dapat menonaktifkannya. Penonaktifan tidak menghapus riwayat.
 * - Produk nonaktif tidak tersedia untuk produksi/penjualan baru dan tidak
 *   muncul di katalog aktif (pemeriksaan pemakaian dilakukan modul B5/B7/B8).
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { pathId } from '../lib/http';
import { hasOperationalHistory } from '../lib/master-history';
import { prisma } from '../lib/prisma';
import { toPublicProduct } from '../lib/product';
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

// ---------- Melihat (Admin & Operator) ----------

productsRouter.get('/', authenticate, async (_req, res) => {
  const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });

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

productsRouter.get('/:id', authenticate, async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: pathId(req) } });

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

productsRouter.post('/', authenticate, requireAdmin, async (req, res) => {
  const { name, description, composition, storageInstructions, unit, sellingPrice } = req.body ?? {};

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

  const product = await prisma.product.create({
    data: {
      name: name.trim(),
      description: normalizeDescription(description),
      composition: normalizeDescription(composition),
      storageInstructions: normalizeDescription(storageInstructions),
      unit: unit.trim(),
      sellingPrice: sellingPrice.toFixed(2),
    },
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

  if (Object.keys(data).length === 0) {
    res.status(400).json({ message: 'Tidak ada perubahan yang diberikan.' });
    return;
  }

  const product = await prisma.product.update({ where: { id: target.id }, data });
  res.json({ product: toPublicProduct(product) });
});

productsRouter.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const target = await prisma.product.findUnique({ where: { id: pathId(req) } });

  if (!target) {
    res.status(404).json({ message: 'Produk tidak ditemukan.' });
    return;
  }

  if (await hasOperationalHistory('product', target.id)) {
    res.status(409).json({
      message:
        'Produk memiliki riwayat operasional dan tidak boleh dihapus. ' +
        'Nonaktifkan produk sebagai gantinya.',
    });
    return;
  }

  await prisma.product.delete({ where: { id: target.id } });
  res.json({ message: `Produk "${target.name}" berhasil dihapus.` });
});

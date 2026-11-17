/**
 * Endpoint publik tanpa login (README 5.6 dan 6).
 *
 * - GET /api/public/catalog — daftar produk aktif yang tersedia untuk
 *   katalog digital: nama, deskripsi (bila diisi), satuan, dan harga jual
 *   dari master produk. Produk nonaktif tidak muncul. Tidak ada data
 *   internal (stok, batch, akun) di endpoint ini.
 * - GET /api/public/products/:id — halaman publik produk untuk QR permanen
 *   per produk. Menampilkan informasi produk yang memang untuk publik dan
 *   seluruh riwayat batch produksi terkini (kode, tanggal produksi, tanggal
 *   kedaluwarsa tervalidasi, status). Hanya produk aktif yang dapat diakses.
 * - GET /api/public/qr/:code — informasi traceability per batch berdasarkan
 *   kode batch (termasuk kode lama/alias — QR lama tetap mengarah ke batch
 *   yang sama). Hanya menampilkan informasi yang SUDAH divalidasi dan
 *   diterbitkan Admin: nama produk, deskripsi, kode batch, tanggal
 *   produksi, komposisi bahan, petunjuk penyimpanan, dan tanggal
 *   kedaluwarsa bila tersedia serta tervalidasi. Kolom yang belum
 *   tersedia disembunyikan. Jika informasi ditarik atau belum diterbitkan,
 *   respons hanya berisi pemberitahuan bahwa informasi publik tidak
 *   tersedia — tanpa data internal apa pun.
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { buildPublicProductResponse } from '../lib/public-product';
import { buildPublicQrResponse } from '../lib/qr';

export const publicRouter = Router();

// ---------------------------------------------------------------------------
// Katalog publik (produk aktif saja)
// ---------------------------------------------------------------------------

publicRouter.get('/catalog', async (req, res) => {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });

  res.json({
    products: products.map((product) => {
      // Hanya kolom yang memang untuk publik; kolom kosong disembunyikan.
      const entry: {
        id: string;
        name: string;
        unit: string;
        sellingPrice: number;
        description?: string;
        photoUrl?: string;
      } = {
        id: product.id,
        name: product.name,
        unit: product.unit,
        sellingPrice: Number(product.sellingPrice),
      };
      if (product.description) {
        entry.description = product.description;
      }
      // Foto hanya bila memang sudah diunggah Admin — tanpa data internal.
      if (product.photoUrl) {
        entry.photoUrl = product.photoUrl;
      }
      return entry;
    }),
  });
});

// ---------------------------------------------------------------------------
// Halaman publik produk (QR permanen per produk)
// ---------------------------------------------------------------------------

const PUBLIC_PRODUCT_BATCH_SELECT = {
  code: true,
  productionDate: true,
  expiryDate: true,
  expiryValidatedAt: true,
  stockQuantity: true,
  createdAt: true,
  qrPublication: { select: { withdrawnAt: true } },
} as const;

publicRouter.get('/products/:id', async (req, res) => {
  const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  if (!id) {
    res.status(404).json({ message: 'Informasi produk tidak tersedia.' });
    return;
  }

  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      name: true,
      unit: true,
      description: true,
      composition: true,
      storageInstructions: true,
      photoUrl: true,
      nutrition: true,
      isActive: true,
    },
  });

  // Produk nonaktif/arsip tidak memiliki halaman publik (README 5.1).
  if (!product || !product.isActive) {
    res.status(404).json({
      message: 'Informasi produk tidak tersedia atau produk belum dipublikasikan.',
    });
    return;
  }

  const batches = await prisma.batch.findMany({
    where: { productId: id },
    select: PUBLIC_PRODUCT_BATCH_SELECT,
  });

  // Data selalu dibaca ulang dari database agar batch baru, perubahan
  // kedaluwarsa, dan perubahan status langsung tercermin di halaman publik.
  res.setHeader('Cache-Control', 'no-store');
  res.json(buildPublicProductResponse(product, batches));
});

// ---------------------------------------------------------------------------
// QR traceability per batch (tanpa login)
// ---------------------------------------------------------------------------

const QR_BATCH_INCLUDE = {
  product: {
    select: {
      name: true,
      unit: true,
      description: true,
      composition: true,
      storageInstructions: true,
      photoUrl: true,
    },
  },
  qrPublication: { select: { publishedAt: true, withdrawnAt: true } },
} as const;

publicRouter.get('/qr/:code', async (req, res) => {
  const code = typeof req.params.code === 'string' ? req.params.code.trim() : '';
  if (!code) {
    res.status(404).json({ message: 'Batch tidak ditemukan.' });
    return;
  }

  // Cari berdasarkan kode aktif; bila tidak ada, coba kode lama (alias)
  // agar QR/label lama tetap mengarah ke batch yang sama (README 5.3).
  let batch = await prisma.batch.findUnique({
    where: { code },
    include: QR_BATCH_INCLUDE,
  });
  if (!batch) {
    const alias = await prisma.batchAlias.findUnique({
      where: { code },
      include: { batch: { include: QR_BATCH_INCLUDE } },
    });
    batch = alias?.batch ?? null;
  }

  if (!batch) {
    res.status(404).json({ message: 'Batch tidak ditemukan.' });
    return;
  }

  res.json(
    buildPublicQrResponse(batch, batch.qrPublication)
  );
});

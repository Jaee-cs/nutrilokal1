/**
 * Arsip (soft archive) NutriLokal — khusus Admin.
 *
 * Halaman ini TIDAK menyimpan salinan data. Produk, bahan baku, dan akun
 * tetap berada di tabel asal dengan ID yang sama; hanya status isActive dan
 * metadata arsip yang diubah. Penghapusan permanen (khusus Admin) tersedia
 * lewat DELETE /:kind/:id dan hanya untuk data yang lolos audit relasi.
 *
 * Objek arsip hanya master data. Transaksi, produksi, penjualan, dan
 * pergerakan stok adalah catatan historis dan sengaja tidak ikut diarsipkan.
 */
import { Router, type Response } from 'express';
import {
  archiveDateWhere,
  archiveMaterial,
  archiveProduct,
  archiveUser,
  parseArchiveDateRange,
  parseArchivePagination,
  parseArchiveReason,
  restoreMaterial,
  restoreProduct,
  restoreUser,
  searchTerm,
  type ArchiveResult,
} from '../lib/archive';
import { ACTIVITY_RELATION_COUNTS, countsIndicateActivity } from '../lib/account-history';
import {
  permanentlyDeleteMaterial,
  permanentlyDeleteProduct,
  permanentlyDeleteUser,
  type PermanentDeleteResult,
} from '../lib/permanent-delete';
import { toPublicMaterial } from '../lib/material';
import { PRODUCT_RECIPE_INCLUDE } from '../lib/product-recipe';
import { prisma } from '../lib/prisma';
import { toPublicProduct } from '../lib/product';
import { toPublicUser } from '../lib/user';
import { pathId } from '../lib/http';
import { authenticate, requireAdmin } from '../middleware/auth';

export const archiveRouter = Router();

// Lapisan pertahanan: seluruh endpoint di router ini menolak Operator (403)
// dan permintaan tanpa token (401), termasuk aksi baca/detail.
archiveRouter.use(authenticate, requireAdmin);

type ListQuery = Record<string, unknown>;

function listParams(query: ListQuery) {
  const range = parseArchiveDateRange(query.dateFrom, query.dateTo);
  if (!range.ok) return { error: range.message } as const;
  const pagination = parseArchivePagination(query);
  return {
    range,
    pagination,
    search: searchTerm(query.search),
  } as const;
}

function meta(total: number, page: number, pageSize: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function sendResult<T>(
  res: Response,
  result: ArchiveResult<T>,
  present: (data: T) => unknown,
  action: 'diarsipkan' | 'dipulihkan'
) {
  if (!result.ok) {
    res.status(result.status).json({ message: result.message });
    return;
  }
  res.json({
    message: result.unchanged
      ? `Data sudah ${action}, tidak ada perubahan.`
      : `Data berhasil ${action}.`,
    ...(result.warning ? { warning: result.warning } : {}),
    data: present(result.data),
  });
}

/** Respons hapus permanen: alasan penolakan ikut dikirim ke notifikasi Admin. */
function sendDeleteResult<T>(
  res: Response,
  result: PermanentDeleteResult<T>,
  present: (data: T) => unknown
) {
  if (!result.ok) {
    res.status(result.status).json({
      message: result.message,
      ...(result.blockers ? { blockers: result.blockers } : {}),
    });
    return;
  }
  res.json({ message: result.message, data: present(result.data) });
}

const ARCHIVED_BY_SELECT = { id: true, name: true, username: true } as const;

function archivedByName(record: { archivedBy: { name: string | null; username: string } | null }) {
  return record.archivedBy?.name?.trim() || record.archivedBy?.username || null;
}

// ---------------------------------------------------------------------------
// Ringkasan jumlah arsip per tab
// ---------------------------------------------------------------------------

archiveRouter.get('/summary', async (_req, res) => {
  const [products, materials, users] = await Promise.all([
    prisma.product.count({ where: { isActive: false } }),
    prisma.material.count({ where: { isActive: false } }),
    prisma.user.count({ where: { isActive: false } }),
  ]);
  res.json({ data: { products, materials, users } });
});

// ---------------------------------------------------------------------------
// Produk
// ---------------------------------------------------------------------------

archiveRouter.get('/products', async (req, res) => {
  const params = listParams(req.query as ListQuery);
  if ('error' in params) {
    res.status(400).json({ message: params.error });
    return;
  }
  const { range, pagination, search } = params;
  const where = {
    isActive: false,
    archivedAt: archiveDateWhere(range),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { description: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ archivedAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: { ...PRODUCT_RECIPE_INCLUDE, archivedBy: { select: ARCHIVED_BY_SELECT } },
    }),
    prisma.product.count({ where }),
  ]);
  // Stok dan batch lama tetap terbaca walaupun produk sudah diarsipkan.
  const stockRows = await prisma.batch.groupBy({
    by: ['productId'],
    where: { productId: { in: rows.map((row) => row.id) } },
    _sum: { stockQuantity: true },
    _count: { _all: true },
  });
  const stockByProduct = new Map(
    stockRows.map((row) => [
      row.productId,
      { stock: Number(row._sum.stockQuantity ?? 0), batchCount: row._count._all },
    ])
  );

  res.json({
    data: rows.map((row) =>
      toPublicProduct(row, stockByProduct.get(row.id), {
        archivedByName: archivedByName(row),
      })
    ),
    meta: meta(total, pagination.page, pagination.pageSize),
  });
});

archiveRouter.get('/products/:id', async (req, res) => {
  const row = await prisma.product.findUnique({
    where: { id: pathId(req) },
    include: { ...PRODUCT_RECIPE_INCLUDE, archivedBy: { select: ARCHIVED_BY_SELECT } },
  });
  if (!row) {
    res.status(404).json({ message: 'Produk tidak ditemukan.' });
    return;
  }
  const totals = await prisma.batch.aggregate({
    where: { productId: row.id },
    _sum: { stockQuantity: true },
    _count: { _all: true },
  });
  res.json({
    product: toPublicProduct(
      row,
      {
        stock: Number(totals._sum.stockQuantity ?? 0),
        batchCount: totals._count._all,
      },
      { archivedByName: archivedByName(row) }
    ),
  });
});

archiveRouter.post('/products/:id/archive', async (req, res) => {
  const reason = parseArchiveReason(req.body?.reason);
  if (!reason.ok) {
    res.status(400).json({ message: reason.message });
    return;
  }
  const result = await archiveProduct(pathId(req), req.user!.id, reason.value);
  sendResult(res, result, (product) => toPublicProduct(product), 'diarsipkan');
});

archiveRouter.post('/products/:id/restore', async (req, res) => {
  const result = await restoreProduct(pathId(req));
  sendResult(res, result, (product) => toPublicProduct(product), 'dipulihkan');
});

// ---------------------------------------------------------------------------
// Bahan baku
// ---------------------------------------------------------------------------

async function materialList(query: ListQuery, res: Response) {
  const params = listParams(query);
  if ('error' in params) {
    res.status(400).json({ message: params.error });
    return;
  }
  const { range, pagination, search } = params;
  const where = {
    isActive: false,
    archivedAt: archiveDateWhere(range),
    ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.material.findMany({
      where,
      orderBy: [{ archivedAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: { archivedBy: { select: ARCHIVED_BY_SELECT } },
    }),
    prisma.material.count({ where }),
  ]);
  const stocks = await prisma.materialStock.findMany({
    where: { materialId: { in: rows.map((row) => row.id) } },
  });
  const stockByMaterial = new Map(stocks.map((row) => [row.materialId, Number(row.quantity)]));

  res.json({
    data: rows.map((row) =>
      toPublicMaterial(row, stockByMaterial.get(row.id) ?? 0, {
        archivedByName: archivedByName(row),
      })
    ),
    meta: meta(total, pagination.page, pagination.pageSize),
  });
}

archiveRouter.get('/materials', async (req, res) => {
  await materialList(req.query as ListQuery, res);
});

archiveRouter.get('/materials/:id', async (req, res) => {
  const row = await prisma.material.findUnique({
    where: { id: pathId(req) },
    include: { archivedBy: { select: ARCHIVED_BY_SELECT } },
  });
  if (!row) {
    res.status(404).json({ message: 'Bahan baku tidak ditemukan.' });
    return;
  }
  const { archivedBy, ...material } = row;
  const stock = await prisma.materialStock.findUnique({ where: { materialId: row.id } });
  res.json({
    material: toPublicMaterial(material, stock ? Number(stock.quantity) : 0, {
      archivedByName: archivedByName({ archivedBy }),
    }),
  });
});

archiveRouter.post('/materials/:id/archive', async (req, res) => {
  const reason = parseArchiveReason(req.body?.reason);
  if (!reason.ok) {
    res.status(400).json({ message: reason.message });
    return;
  }
  const result = await archiveMaterial(pathId(req), req.user!.id, reason.value);
  sendResult(res, result, (material) => toPublicMaterial(material, 0), 'diarsipkan');
});

archiveRouter.post('/materials/:id/restore', async (req, res) => {
  const result = await restoreMaterial(pathId(req));
  sendResult(res, result, (material) => toPublicMaterial(material, 0), 'dipulihkan');
});

// ---------------------------------------------------------------------------
// Akun pengguna (Operator)
// ---------------------------------------------------------------------------

archiveRouter.get('/users', async (req, res) => {
  const params = listParams(req.query as ListQuery);
  if ('error' in params) {
    res.status(400).json({ message: params.error });
    return;
  }
  const { range, pagination, search } = params;
  const where = {
    isActive: false,
    archivedAt: archiveDateWhere(range),
    ...(search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ archivedAt: { sort: 'desc', nulls: 'last' } }, { username: 'asc' }],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        _count: { select: ACTIVITY_RELATION_COUNTS },
        archivedBy: { select: ARCHIVED_BY_SELECT },
      },
    }),
    prisma.user.count({ where }),
  ]);
  const userIds = rows.map((row) => row.id);
  const idempotencyCounts = await prisma.idempotencyKey.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds } },
    _count: { _all: true },
  });
  const idempotencyByUser = new Map(
    idempotencyCounts.map((row) => [row.userId, row._count._all])
  );

  res.json({
    data: rows.map((row) =>
      toPublicUser(row, {
        hasActivityHistory:
          countsIndicateActivity(row._count) || (idempotencyByUser.get(row.id) ?? 0) > 0,
        archivedByName: archivedByName(row),
      })
    ),
    meta: meta(total, pagination.page, pagination.pageSize),
  });
});

archiveRouter.get('/users/:id', async (req, res) => {
  const row = await prisma.user.findUnique({
    where: { id: pathId(req) },
    include: {
      _count: { select: ACTIVITY_RELATION_COUNTS },
      archivedBy: { select: ARCHIVED_BY_SELECT },
    },
  });
  if (!row) {
    res.status(404).json({ message: 'Akun tidak ditemukan.' });
    return;
  }
  const idempotencyCount = await prisma.idempotencyKey.count({ where: { userId: row.id } });
  res.json({
    user: toPublicUser(row, {
      hasActivityHistory: countsIndicateActivity(row._count) || idempotencyCount > 0,
      archivedByName: archivedByName(row),
    }),
  });
});

archiveRouter.post('/users/:id/archive', async (req, res) => {
  const reason = parseArchiveReason(req.body?.reason);
  if (!reason.ok) {
    res.status(400).json({ message: reason.message });
    return;
  }
  const result = await archiveUser(pathId(req), req.user!.id, reason.value, req.user!.id);
  sendResult(res, result, (user) => toPublicUser(user), 'diarsipkan');
});

archiveRouter.post('/users/:id/restore', async (req, res) => {
  const result = await restoreUser(pathId(req));
  sendResult(res, result, (user) => toPublicUser(user), 'dipulihkan');
});

// ---------------------------------------------------------------------------
// Penghapusan permanen — hanya Admin (router sudah memasang requireAdmin),
// hanya untuk data yang sedang diarsipkan dan lolos audit relasi di backend.
// ---------------------------------------------------------------------------

archiveRouter.delete('/products/:id', async (req, res) => {
  const result = await permanentlyDeleteProduct(pathId(req));
  sendDeleteResult(res, result, (data) => data);
});

archiveRouter.delete('/materials/:id', async (req, res) => {
  const result = await permanentlyDeleteMaterial(pathId(req));
  sendDeleteResult(res, result, (data) => data);
});

archiveRouter.delete('/users/:id', async (req, res) => {
  const result = await permanentlyDeleteUser(pathId(req), req.user!.id);
  sendDeleteResult(res, result, (data) => data);
});

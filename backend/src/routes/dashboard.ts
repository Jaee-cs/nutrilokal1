/**
 * Dashboard usaha (README ruang lingkup 1 dan 6).
 *
 * Menyajikan ringkasan operasional dari data database AKTUAL — tidak ada
 * angka statistik permanen atau data demo. Semua agregasi dihitung di
 * database (groupBy/aggregate) atau dari jumlah baris minimum.
 *
 * - Materials: stok bahan baku = MaterialStock per jenis (README 5.2).
 * - Products: total stok = jumlah stok seluruh batch (README 5.4);
 *   daftar batch yang MASIH punya stok disertakan agar relevan.
 * - Production: jumlah catatan & jumlah hasil per produk (satuan dasar
 *   masing-masing produk — tidak menjumlahkan lintas satuan).
 * - Sales: omzet = jumlah total transaksi yang TIDAK dibatalkan
 *   (README 5.5); total transaksi sudah dihitung backend saat pencatatan.
 *
 * Filter periode opsional `?period=today|week|month` (kalender WIB) berlaku
 * untuk statistik produksi, penjualan, pembatalan, omzet, serta jumlah
 * bahan/produk yang ditambahkan pada periode tersebut. `week` = 7 hari
 * terakhir dan `month` = 30 hari terakhir, keduanya termasuk hari ini.
 * Tanpa parameter = seluruh data (kompatibel dengan pemanggil lama).
 *
 * Dibaca Admin dan Operator (informasi operasional, README 4).
 * Perincian periode tersedia di /api/reports (B9).
 */
import { Router } from 'express';
import {
  businessDayRange,
  dashboardPeriodCodes,
  instantBusinessDateCode,
  type DashboardPeriod,
} from '../lib/date';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/auth';

export const dashboardRouter = Router();

const RECENT_LIMIT = 5;
const DASHBOARD_PERIODS: readonly DashboardPeriod[] = ['today', 'week', 'month'];

function isDashboardPeriod(value: unknown): value is DashboardPeriod {
  return typeof value === 'string' && DASHBOARD_PERIODS.includes(value as DashboardPeriod);
}

dashboardRouter.get('/', authenticate, async (req, res) => {
  const periodParam = req.query.period;
  let periodInfo: { key: DashboardPeriod; from: string; to: string } | null = null;
  if (periodParam !== undefined) {
    if (!isDashboardPeriod(periodParam)) {
      res.status(400).json({
        message: 'Parameter period harus salah satu: today, week, month.',
      });
      return;
    }
    periodInfo = { key: periodParam, ...dashboardPeriodCodes(periodParam) };
  }
  const range = periodInfo ? businessDayRange(periodInfo.from, periodInfo.to) : null;
  const productionWhere = range ? { productionDate: range } : {};
  const transactionWhere = range ? { recordedAt: range } : {};
  // ---------------------------------------------------------------------
  // Stok bahan baku: total per jenis bahan (README 5.2).
  // ---------------------------------------------------------------------
  const [materials, materialStocks, materialPeriodCount] = await Promise.all([
    prisma.material.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, unit: true } }),
    prisma.materialStock.findMany({ select: { materialId: true, quantity: true } }),
    prisma.material.count({ where: range ? { createdAt: range } : undefined }),
  ]);
  const materialStockBy = new Map(materialStocks.map((s) => [s.materialId, Number(s.quantity)]));

  // ---------------------------------------------------------------------
  // Stok produk jadi: total per produk = jumlah stok seluruh batch.
  // ---------------------------------------------------------------------
  const [products, productTotals, batchesWithStock, productPeriodCount] = await Promise.all([
    prisma.product.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, unit: true } }),
    prisma.batch.groupBy({
      by: ['productId'],
      _sum: { stockQuantity: true },
      _count: { _all: true },
    }),
    // Ringkasan per batch: hanya batch yang masih punya stok.
    prisma.batch.findMany({
      where: { stockQuantity: { gt: 0 } },
      orderBy: { code: 'asc' },
      select: {
        code: true,
        stockQuantity: true,
        productionDate: true,
        expiryDate: true,
        product: { select: { name: true } },
      },
    }),
    prisma.product.count({ where: range ? { createdAt: range } : undefined }),
  ]);
  const productTotalBy = new Map(
    productTotals.map((t) => [
      t.productId,
      { stock: Number(t._sum.stockQuantity ?? 0), batchCount: t._count._all },
    ])
  );

  // ---------------------------------------------------------------------
  // Ringkasan produksi: agregasi DB + catatan terbaru.
  // ---------------------------------------------------------------------
  const [productionAgg, productionByProduct, recentProductions] = await Promise.all([
    prisma.production.aggregate({ where: productionWhere, _count: { _all: true } }),
    prisma.production.groupBy({
      by: ['productId'],
      where: productionWhere,
      _sum: { yieldQuantity: true },
      _count: { _all: true },
    }),
    prisma.production.findMany({
      where: productionWhere,
      orderBy: [{ productionDate: 'desc' }, { recordedAt: 'desc' }],
      take: RECENT_LIMIT,
      select: {
        productionDate: true,
        yieldQuantity: true,
        product: { select: { name: true, unit: true } },
        batch: { select: { code: true } },
      },
    }),
  ]);
  const productNameById = new Map(products.map((p) => [p.id, p]));
  const productUnitById = new Map(products.map((p) => [p.id, p.unit]));

  // ---------------------------------------------------------------------
  // Penjualan & omzet: transaksi batal TIDAK dihitung (README 5.5).
  // ---------------------------------------------------------------------
  const [completedAgg, cancelledAgg, recentSales] = await Promise.all([
    prisma.saleTransaction.aggregate({
      where: { ...transactionWhere, cancelledAt: null },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.saleTransaction.aggregate({
      where: { ...transactionWhere, cancelledAt: { not: null } },
      _count: { _all: true },
    }),
    prisma.saleTransaction.findMany({
      where: transactionWhere,
      orderBy: { recordedAt: 'desc' },
      take: RECENT_LIMIT,
      select: { id: true, recordedAt: true, total: true, cancelledAt: true },
    }),
  ]);

  res.json({
    // null = tanpa filter (kompatibel dengan pemanggil lama).
    period: periodInfo,
    materials: {
      count: materials.length,
      // Jumlah bahan yang ditambahkan pada periode terpilih.
      periodCount: materialPeriodCount,
      items: materials.map((m) => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        stock: materialStockBy.get(m.id) ?? 0,
      })),
    },
    products: {
      count: products.length,
      // Jumlah produk yang ditambahkan pada periode terpilih.
      periodCount: productPeriodCount,
      items: products.map((p) => ({
        id: p.id,
        name: p.name,
        unit: p.unit,
        stock: productTotalBy.get(p.id)?.stock ?? 0,
        batchCount: productTotalBy.get(p.id)?.batchCount ?? 0,
      })),
      batchesWithStock: batchesWithStock.map((b) => ({
        code: b.code,
        productName: b.product.name,
        stock: Number(b.stockQuantity),
        productionDate: b.productionDate,
        expiryDate: b.expiryDate,
      })),
    },
    production: {
      recordCount: productionAgg._count._all,
      byProduct: productionByProduct.map((t) => ({
        productId: t.productId,
        productName: productNameById.get(t.productId)?.name ?? null,
        unit: productUnitById.get(t.productId) ?? null,
        recordCount: t._count._all,
        totalYield: Number(t._sum.yieldQuantity ?? 0),
      })),
      recent: recentProductions.map((p) => ({
        productionDate: p.productionDate,
        productName: p.product.name,
        batchCode: p.batch?.code ?? null,
        yieldQuantity: Number(p.yieldQuantity),
      })),
    },
    sales: {
      transactionCount: completedAgg._count._all,
      cancelledCount: cancelledAgg._count._all,
      omzet: Number(completedAgg._sum.total ?? 0),
      recent: recentSales.map((s) => ({
        id: s.id,
        recordedAt: s.recordedAt,
        // Hari bisnis WIB pencatatan — konsisten dengan filter laporan.
        businessDate: instantBusinessDateCode(s.recordedAt),
        total: Number(s.total),
        status: s.cancelledAt ? 'CANCELLED' : 'COMPLETED',
      })),
    },
  });
});

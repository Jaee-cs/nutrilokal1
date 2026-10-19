/**
 * Laporan operasional (README ruang lingkup 6 dan 6).
 *
 * Semua angka diturunkan dari catatan historis di database — tidak ada
 * angka demo atau statistik permanen. Dibaca Admin dan Operator
 * (informasi operasional, README 4).
 *
 * Filter tanggal opsional `from`/`to` (YYYY-MM-DD, kalender WIB —
 * lihat lib/report). Tanpa filter = seluruh data. Transaksi penjualan
 * yang dibatalkan TIDAK dihitung dalam omzet (README 5.5); nilai
 * penjualan memakai harga satuan yang DISIMPAN pada transaksi, bukan
 * harga master saat ini.
 *
 * - GET /api/reports/stock      — snapshot stok saat ini (bahan & batch).
 * - GET /api/reports/materials  — pergerakan bahan baku per jenis, periode.
 * - GET /api/reports/productions— catatan produksi dan hasil per periode.
 * - GET /api/reports/sales      — omzet per hari bisnis & per produk.
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { instantBusinessDateCode } from '../lib/date';
import { parseReportPeriod } from '../lib/report';
import { prisma } from '../lib/prisma';
import { roundMoney } from '../lib/sale';
import { authenticate } from '../middleware/auth';

export const reportsRouter = Router();

type PeriodWhere = Record<string, unknown>;

function periodWhere(
  field: string,
  range: { gte?: Date; lt?: Date } | null
): PeriodWhere {
  if (!range) {
    return {};
  }
  const condition: Record<string, Date> = {};
  if (range.gte) {
    condition.gte = range.gte;
  }
  if (range.lt) {
    condition.lt = range.lt;
  }
  return { [field]: condition };
}

// ---------------------------------------------------------------------------
// Snapshot stok saat ini
// ---------------------------------------------------------------------------

reportsRouter.get('/stock', authenticate, async (_req, res) => {
  const [materials, materialStocks, products, batches] = await Promise.all([
    prisma.material.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, unit: true } }),
    prisma.materialStock.findMany({ select: { materialId: true, quantity: true } }),
    prisma.product.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, unit: true } }),
    prisma.batch.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        stockQuantity: true,
        productionDate: true,
        expiryDate: true,
        expiryValidatedAt: true,
        product: { select: { id: true } },
      },
    }),
  ]);
  const materialStockBy = new Map(materialStocks.map((s) => [s.materialId, Number(s.quantity)]));
  const batchesByProduct = new Map<string, typeof batches>();
  for (const batch of batches) {
    const list = batchesByProduct.get(batch.product.id) ?? [];
    list.push(batch);
    batchesByProduct.set(batch.product.id, list);
  }

  res.json({
    materials: materials.map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      stock: materialStockBy.get(m.id) ?? 0,
    })),
    // Total stok per produk = jumlah stok seluruh batch (README 5.4);
    // produk tanpa batch tetap muncul dengan stok 0 agar bentuk konsisten.
    products: products.map((p) => {
      const productBatches = batchesByProduct.get(p.id) ?? [];
      return {
        id: p.id,
        name: p.name,
        unit: p.unit,
        stock: productBatches.reduce((sum, b) => sum + Number(b.stockQuantity), 0),
        batches: productBatches.map((b) => ({
          code: b.code,
          stock: Number(b.stockQuantity),
          productionDate: b.productionDate,
          expiryDate: b.expiryDate,
          expiryValidated: b.expiryValidatedAt !== null,
        })),
      };
    }),
  });
});

// ---------------------------------------------------------------------------
// Laporan bahan baku: pergerakan per jenis bahan pada periode
// ---------------------------------------------------------------------------

reportsRouter.get('/materials', authenticate, async (req, res) => {
  const parsed = parseReportPeriod(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    res.status(400).json({ message: parsed.message });
    return;
  }
  const { from, to, range } = parsed.period;

  const [materials, materialStocks, movements] = await Promise.all([
    prisma.material.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, unit: true } }),
    prisma.materialStock.findMany({ select: { materialId: true, quantity: true } }),
    // Satu agregasi DB per (bahan, jenis pergerakan) — tidak memuat
    // seluruh baris pergerakan.
    prisma.materialStockMovement.groupBy({
      by: ['materialId', 'type'],
      where: periodWhere('occurredAt', range),
      _sum: { quantity: true },
      _count: { _all: true },
    }),
  ]);
  const materialStockBy = new Map(materialStocks.map((s) => [s.materialId, Number(s.quantity)]));

  const byMaterial = new Map<
    string,
    { received: number; openingBalance: number; used: number; adjusted: number }
  >();
  for (const row of movements) {
    const entry = byMaterial.get(row.materialId) ?? {
      received: 0,
      openingBalance: 0,
      used: 0,
      adjusted: 0,
    };
    const quantity = Number(row._sum.quantity ?? 0);
    // Jenis pergerakan bahan baku (README 5.2 dan 5.4); hanya ADJUSTMENT
    // yang bernilai tanda.
    if (row.type === 'RECEIPT') {
      entry.received += quantity;
    } else if (row.type === 'OPENING_BALANCE') {
      entry.openingBalance += quantity;
    } else if (row.type === 'PRODUCTION_USAGE') {
      entry.used += quantity;
    } else {
      entry.adjusted += quantity;
    }
    byMaterial.set(row.materialId, entry);
  }

  res.json({
    from,
    to,
    materials: materials.map((m) => {
      const totals = byMaterial.get(m.id);
      return {
        id: m.id,
        name: m.name,
        unit: m.unit,
        received: totals?.received ?? 0,
        openingBalance: totals?.openingBalance ?? 0,
        used: totals?.used ?? 0,
        adjusted: totals?.adjusted ?? 0,
        // Stok saat ini bukan "stok akhir periode" — laporan ini menampilkan
        // pergerakan periode plus saldo aktual terkini.
        currentStock: materialStockBy.get(m.id) ?? 0,
      };
    }),
  });
});

// ---------------------------------------------------------------------------
// Laporan produksi: catatan & jumlah hasil pada periode
// ---------------------------------------------------------------------------

reportsRouter.get('/productions', authenticate, async (req, res) => {
  const parsed = parseReportPeriod(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    res.status(400).json({ message: parsed.message });
    return;
  }
  const { from, to, range } = parsed.period;

  const [records, byProduct, products] = await Promise.all([
    prisma.production.findMany({
      where: periodWhere('productionDate', range),
      orderBy: [{ productionDate: 'desc' }, { recordedAt: 'desc' }],
      select: {
        id: true,
        productionDate: true,
        yieldQuantity: true,
        note: true,
        product: { select: { id: true, name: true, unit: true } },
        batch: { select: { code: true } },
        corrections: { select: { id: true } },
      },
    }),
    prisma.production.groupBy({
      by: ['productId'],
      where: periodWhere('productionDate', range),
      _sum: { yieldQuantity: true },
      _count: { _all: true },
    }),
    prisma.product.findMany({ select: { id: true, name: true, unit: true } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));

  res.json({
    from,
    to,
    summary: {
      recordCount: records.length,
      byProduct: byProduct.map((t) => ({
        productId: t.productId,
        productName: productById.get(t.productId)?.name ?? null,
        unit: productById.get(t.productId)?.unit ?? null,
        recordCount: t._count._all,
        totalYield: Number(t._sum.yieldQuantity ?? 0),
      })),
    },
    records: records.map((r) => ({
      id: r.id,
      productionDate: r.productionDate,
      productName: r.product.name,
      unit: r.product.unit,
      batchCode: r.batch?.code ?? null,
      yieldQuantity: Number(r.yieldQuantity),
      note: r.note,
      correctionCount: r.corrections.length,
    })),
  });
});

// ---------------------------------------------------------------------------
// Laporan penjualan: omzet per hari bisnis & per produk pada periode
// ---------------------------------------------------------------------------

reportsRouter.get('/sales', authenticate, async (req, res) => {
  const parsed = parseReportPeriod(req.query as Record<string, unknown>);
  if (!parsed.ok) {
    res.status(400).json({ message: parsed.message });
    return;
  }
  const { from, to, range } = parsed.period;

  const transactionWhere = periodWhere('recordedAt', range);

  // Omzet: jumlah total transaksi yang TIDAK dibatalkan (README 5.5).
  // Total sudah dihitung backend saat pencatatan; perubahan harga master
  // tidak mengubah nilai historis.
  const [completedAgg, cancelledAgg, transactions, items] = await Promise.all([
    prisma.saleTransaction.aggregate({
      where: { ...transactionWhere, cancelledAt: null },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.saleTransaction.aggregate({
      where: { ...transactionWhere, cancelledAt: { not: null } },
      _count: { _all: true },
    }),
    // Baris minimum per transaksi (tanpa item/alokasi) untuk omzet harian —
    // menghindari penghitungan ganda dari banyak item atau alokasi batch.
    prisma.saleTransaction.findMany({
      where: transactionWhere,
      select: { total: true, recordedAt: true, cancelledAt: true },
    }),
    // Per produk: SATU baris per (transaksi, produk); harga dari snapshot
    // transaksi. Alokasi batch TIDAK dijumlahkan (bukan sumber nilai).
    prisma.saleItem.findMany({
      where: { transaction: { ...transactionWhere, cancelledAt: null } },
      select: {
        quantity: true,
        unitPrice: true,
        product: { select: { id: true, name: true, unit: true } },
      },
    }),
  ]);

  // Omzet per hari bisnis WIB — dikelompokkan dari timestamp pencatatan.
  const byDay = new Map<string, { transactionCount: number; omzet: number }>();
  for (const t of transactions) {
    if (t.cancelledAt) {
      continue;
    }
    const day = instantBusinessDateCode(t.recordedAt);
    const entry = byDay.get(day) ?? { transactionCount: 0, omzet: 0 };
    entry.transactionCount += 1;
    entry.omzet += Number(t.total);
    byDay.set(day, entry);
  }

  // Nilai per produk: jumlah × harga snapshot (bukan harga master kini),
  // dibulatkan 2 desimal seperti total transaksi (README 5.5).
  const byProduct = new Map<
    string,
    { name: string; unit: string; quantity: number; value: number }
  >();
  for (const item of items) {
    const entry = byProduct.get(item.product.id) ?? {
      name: item.product.name,
      unit: item.product.unit,
      quantity: 0,
      value: 0,
    };
    entry.quantity += Number(item.quantity);
    entry.value += Number(
      roundMoney(new Prisma.Decimal(item.quantity).mul(item.unitPrice))
    );
    byProduct.set(item.product.id, entry);
  }

  res.json({
    from,
    to,
    summary: {
      transactionCount: completedAgg._count._all,
      cancelledCount: cancelledAgg._count._all,
      omzet: Number(completedAgg._sum.total ?? 0),
    },
    byDay: [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, entry]) => ({ date, ...entry })),
    byProduct: [...byProduct.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([productId, entry]) => ({ productId, ...entry })),
  });
});

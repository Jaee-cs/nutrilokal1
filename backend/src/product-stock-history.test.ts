/**
 * Pengujian integrasi riwayat pergerakan stok produk.
 *
 * Menguji pembacaan ledger BatchStockMovement melalui API baru: produksi,
 * penjualan multi-batch, pembatalan ke batch asal, koreksi produksi,
 * penyesuaian stok, filter gabungan, saldo berjalan, fallback data historis,
 * kegagalan atomik, dan tidak adanya pencatatan ganda.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';

const app = createApp();

const runId = `history-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const wibFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dateCode(offsetDays: number): string {
  return wibFormatter.format(new Date(Date.now() + offsetDays * 86_400_000));
}

const today = dateCode(0);
const tomorrow = dateCode(1);

let adminToken = '';
let operatorToken = '';
let adminId = '';
let operatorId = '';
let productId = '';
let materialId = '';
let productionId = '';
let productionBatchId = '';
let productionBatchCode = '';
let openingBatchId = '';
let openingBatchCode = '';
let saleId = '';
let legacyBatchId = '';
let legacyBatchCode = '';

interface HistoryRow {
  id: string;
  type: string;
  quantity: number;
  stockIn: number;
  stockOut: number;
  balanceAfter: number;
  batchBalanceAfter: number;
  occurredAt: string;
  recordedAt: string;
  reason: string | null;
  isHistoricalFallback: boolean;
  batch: { id: string; code: string; currentStock: number };
  recordedBy: { id: string; username: string; name: string | null } | null;
  reference: { kind: string; id: string; label: string } | null;
}

interface HistoryResponse {
  data: HistoryRow[];
  product: { id: string; name: string; unit: string; currentStock: number; batchCount: number };
  summary: {
    movementCount: number;
    totalIn: number;
    totalOut: number;
    currentStock: number;
    reconstructedStock: number;
    consistent: boolean;
    hasHistoricalFallback: boolean;
  };
}

async function login(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

async function history(params: Record<string, string> = {}) {
  return request(app)
    .get(`/api/products/${productId}/stock-movements`)
    .set(auth(operatorToken))
    .query(params);
}

function createSale(body: Record<string, unknown>, idempotencyKey?: string) {
  const req = request(app).post('/api/sales').set(auth(operatorToken));
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  return req.send(body);
}

async function productStock(): Promise<number> {
  const res = await request(app).get(`/api/products/${productId}`).set(auth(operatorToken));
  expect(res.status).toBe(200);
  return res.body.product.stock as number;
}

async function batchStock(batchId: string): Promise<number> {
  const res = await request(app).get(`/api/batches/${batchId}`).set(auth(operatorToken));
  expect(res.status).toBe(200);
  return res.body.batch.stock as number;
}

async function ledgerSum(batchId: string): Promise<number> {
  const movements = await prisma.batchStockMovement.findMany({
    where: { batchId },
    select: { quantity: true },
  });
  return movements.reduce((sum, row) => sum + Number(row.quantity), 0);
}

beforeAll(async () => {
  await prisma.user.create({
    data: {
      username: `${runId}-admin`,
      passwordHash: await hashPassword('admin-rahasia-123'),
      role: 'ADMIN',
    },
  });
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: `${runId}-admin` } });
  adminId = admin.id;

  await prisma.user.create({
    data: {
      username: `${runId}-operator`,
      passwordHash: await hashPassword('operator-rahasia-123'),
      role: 'OPERATOR',
    },
  });
  const operator = await prisma.user.findUniqueOrThrow({
    where: { username: `${runId}-operator` },
  });
  operatorId = operator.id;

  adminToken = (await login(`${runId}-admin`, 'admin-rahasia-123')).body.token;
  operatorToken = (await login(`${runId}-operator`, 'operator-rahasia-123')).body.token;
  expect(adminToken).toBeTruthy();
  expect(operatorToken).toBeTruthy();

  const productRes = await request(app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name: `${runId}-produk`, unit: 'pcs', sellingPrice: 12500 });
  expect(productRes.status).toBe(201);
  productId = productRes.body.product.id;

  const materialRes = await request(app)
    .post('/api/materials')
    .set(auth(adminToken))
    .send({ name: `${runId}-bahan`, unit: 'kg' });
  expect(materialRes.status).toBe(201);
  materialId = materialRes.body.material.id;

  const receiptRes = await request(app)
    .post(`/api/materials/${materialId}/receipts`)
    .set(auth(operatorToken))
    .send({ quantity: 50 });
  expect(receiptRes.status).toBe(201);

  const productionRes = await request(app)
    .post('/api/productions')
    .set(auth(operatorToken))
    .send({
      productId,
      productionDate: today,
      expiryDate: dateCode(90),
      yieldQuantity: 10,
      note: 'Produksi uji riwayat',
      materials: [{ materialId, quantity: 2 }],
    });
  expect(productionRes.status).toBe(201);
  productionId = productionRes.body.production.id;
  productionBatchId = productionRes.body.production.batch.id;
  productionBatchCode = productionRes.body.production.batch.code;

  const openingRes = await request(app)
    .post('/api/batches/opening-stock')
    .set(auth(adminToken))
    .send({ productId, quantity: 5, productionDate: today, note: 'Stok awal uji' });
  expect(openingRes.status).toBe(201);
  openingBatchId = openingRes.body.batch.id;
  openingBatchCode = openingRes.body.batch.code;
});

afterAll(async () => {
  const products = await prisma.product.findMany({
    where: { name: { startsWith: runId } },
    select: { id: true },
  });
  const productIds = products.map((product) => product.id);
  const batches = await prisma.batch.findMany({
    where: { productId: { in: productIds } },
    select: { id: true },
  });
  const batchIds = batches.map((batch) => batch.id);
  const productions = await prisma.production.findMany({
    where: { productId: { in: productIds } },
    select: { id: true },
  });
  const productionIds = productions.map((production) => production.id);
  const materials = await prisma.material.findMany({
    where: { name: { startsWith: runId } },
    select: { id: true },
  });
  const materialIds = materials.map((material) => material.id);
  const sales = await prisma.saleTransaction.findMany({
    where: { recordedBy: { username: { startsWith: runId } } },
    select: { id: true },
  });
  const saleIds = sales.map((sale) => sale.id);

  await prisma.batchStockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchExpiryChange.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.stockAdjustment.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.saleAllocation.deleteMany({
    where: { item: { transactionId: { in: saleIds } } },
  });
  await prisma.saleItem.deleteMany({ where: { transactionId: { in: saleIds } } });
  await prisma.saleTransaction.deleteMany({ where: { id: { in: saleIds } } });
  await prisma.batchOpeningBalance.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchAlias.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.productionCorrection.deleteMany({
    where: { productionId: { in: productionIds } },
  });
  await prisma.materialStockMovement.deleteMany({
    where: { materialId: { in: materialIds } },
  });
  await prisma.productionMaterialUsage.deleteMany({
    where: { productionId: { in: productionIds } },
  });
  await prisma.materialReceipt.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialOpeningBalance.deleteMany({
    where: { materialId: { in: materialIds } },
  });
  await prisma.production.deleteMany({ where: { id: { in: productionIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.materialStock.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.material.deleteMany({ where: { id: { in: materialIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

describe('riwayat pergerakan stok produk', () => {
  it('mencatat produksi dan stok awal dengan batch yang benar', async () => {
    const res = await history();
    expect(res.status).toBe(200);
    const body = res.body as HistoryResponse;

    const productionRow = body.data.find((row) => row.type === 'PRODUCTION_YIELD');
    expect(productionRow).toBeTruthy();
    expect(productionRow!.batch.id).toBe(productionBatchId);
    expect(productionRow!.batch.code).toBe(productionBatchCode);
    expect(productionRow!.quantity).toBe(10);
    expect(productionRow!.stockIn).toBe(10);
    expect(productionRow!.stockOut).toBe(0);
    expect(productionRow!.batchBalanceAfter).toBe(10);
    expect(productionRow!.recordedBy?.id).toBe(operatorId);
    expect(productionRow!.reason).toContain(productionBatchCode);
    expect(productionRow!.reference?.kind).toBe('PRODUCTION');
    expect(productionRow!.reference?.id).toBe(productionId);

    const openingRow = body.data.find(
      (row) => row.type === 'OPENING_BALANCE' && !row.isHistoricalFallback
    );
    expect(openingRow).toBeTruthy();
    expect(openingRow!.batch.id).toBe(openingBatchId);
    expect(openingRow!.batch.code).toBe(openingBatchCode);
    expect(openingRow!.stockIn).toBe(5);
    expect(openingRow!.batchBalanceAfter).toBe(5);
    expect(openingRow!.recordedBy?.id).toBe(adminId);

    expect(body.product.currentStock).toBe(15);
    expect(body.summary.consistent).toBe(true);
    expect(await productStock()).toBe(15);
  });

  it('mencatat penjualan multi-batch sebagai baris terpisah per batch', async () => {
    const res = await createSale({
      items: [
        {
          productId,
          allocations: [
            { batchId: productionBatchId, quantity: 3 },
            { batchId: openingBatchId, quantity: 2 },
          ],
        },
      ],
    });
    expect(res.status).toBe(201);
    saleId = res.body.transaction.id;

    const historyRes = await history({ type: 'SALE' });
    expect(historyRes.status).toBe(200);
    const rows = historyRes.body.data as HistoryRow[];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.batch.id))).toEqual(
      new Set([productionBatchId, openingBatchId])
    );

    const productionRow = rows.find((row) => row.batch.id === productionBatchId)!;
    const openingRow = rows.find((row) => row.batch.id === openingBatchId)!;
    expect(productionRow.quantity).toBe(-3);
    expect(productionRow.stockOut).toBe(3);
    expect(productionRow.batchBalanceAfter).toBe(7);
    expect(openingRow.quantity).toBe(-2);
    expect(openingRow.stockOut).toBe(2);
    expect(openingRow.batchBalanceAfter).toBe(3);
    expect(productionRow.reference?.kind).toBe('SALE');
    expect(productionRow.reference?.id).toBe(saleId);
    expect(openingRow.reference?.id).toBe(saleId);
    expect(productionRow.recordedBy?.id).toBe(operatorId);

    const saleMovements = await prisma.batchStockMovement.count({
      where: { type: 'SALE', saleAllocation: { item: { transactionId: saleId } } },
    });
    expect(saleMovements).toBe(2);
    expect(await batchStock(productionBatchId)).toBe(7);
    expect(await batchStock(openingBatchId)).toBe(3);
    expect(await productStock()).toBe(10);
  });

  it('mengembalikan stok pembatalan ke batch asal tanpa pencatatan ganda', async () => {
    const cancelRes = await request(app)
      .post(`/api/sales/${saleId}/cancel`)
      .set(auth(adminToken))
      .send({ reason: 'Pembeli membatalkan pesanan' });
    expect(cancelRes.status).toBe(200);

    const historyRes = await history({ type: 'SALE_CANCELLATION' });
    expect(historyRes.status).toBe(200);
    const rows = historyRes.body.data as HistoryRow[];
    expect(rows).toHaveLength(2);

    const productionRow = rows.find((row) => row.batch.id === productionBatchId)!;
    const openingRow = rows.find((row) => row.batch.id === openingBatchId)!;
    expect(productionRow.quantity).toBe(3);
    expect(productionRow.stockIn).toBe(3);
    expect(productionRow.batchBalanceAfter).toBe(10);
    expect(openingRow.quantity).toBe(2);
    expect(openingRow.stockIn).toBe(2);
    expect(openingRow.batchBalanceAfter).toBe(5);
    expect(productionRow.reference?.id).toBe(saleId);
    expect(productionRow.reason).toBe('Pembeli membatalkan pesanan');

    const again = await request(app)
      .post(`/api/sales/${saleId}/cancel`)
      .set(auth(adminToken))
      .send({ reason: 'Percobaan pembatalan kedua' });
    expect(again.status).toBe(409);

    const cancellationMovements = await prisma.batchStockMovement.count({
      where: { type: 'SALE_CANCELLATION', saleAllocation: { item: { transactionId: saleId } } },
    });
    expect(cancellationMovements).toBe(2);
    expect(await batchStock(productionBatchId)).toBe(10);
    expect(await batchStock(openingBatchId)).toBe(5);
    expect(await productStock()).toBe(15);
  });

  it('mencatat selisih koreksi jumlah produksi sebagai pergerakan tersendiri', async () => {
    const correction = await request(app)
      .patch(`/api/productions/${productionId}`)
      .set(auth(adminToken))
      .send({ yieldQuantity: 8 });
    expect(correction.status).toBe(200);

    const res = await history({ type: 'YIELD_CORRECTION' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const row = res.body.data[0] as HistoryRow;
    expect(row.batch.id).toBe(productionBatchId);
    expect(row.quantity).toBe(-2);
    expect(row.stockOut).toBe(2);
    expect(row.batchBalanceAfter).toBe(8);
    expect(row.reference?.kind).toBe('PRODUCTION');
    expect(row.reference?.id).toBe(productionId);
    expect(row.reason).toContain('Koreksi');
    expect(await batchStock(productionBatchId)).toBe(8);
    expect(await productStock()).toBe(13);
  });

  it('mencatat penyesuaian stok batch beserta alasan dan pengguna', async () => {
    const adjustment = await request(app)
      .post('/api/stock-adjustments')
      .set(auth(adminToken))
      .send({
        targetType: 'BATCH',
        targetId: productionBatchId,
        quantity: -1,
        reason: 'Barang rusak saat pemeriksaan',
      });
    expect(adjustment.status).toBe(201);

    const res = await history({ type: 'ADJUSTMENT' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const row = res.body.data[0] as HistoryRow;
    expect(row.quantity).toBe(-1);
    expect(row.stockOut).toBe(1);
    expect(row.batchBalanceAfter).toBe(7);
    expect(row.reason).toBe('Barang rusak saat pemeriksaan');
    expect(row.recordedBy?.id).toBe(adminId);
    expect(row.reference?.kind).toBe('ADJUSTMENT');
    expect(row.reference?.id).toBe(adjustment.body.adjustment.id);
    expect(await productStock()).toBe(12);
  });

  it('menerapkan filter produk, tanggal, jenis, dan batch secara bersamaan', async () => {
    const res = await history({
      from: today,
      to: today,
      type: 'SALE_CANCELLATION',
      batchId: productionBatchId,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].type).toBe('SALE_CANCELLATION');
    expect(res.body.data[0].batch.id).toBe(productionBatchId);
    expect(res.body.summary.movementCount).toBe(1);
    expect(res.body.summary.totalIn).toBe(3);
    expect(res.body.summary.totalOut).toBe(0);

    const empty = await history({ from: tomorrow, to: tomorrow });
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.summary.movementCount).toBe(0);

    const invalidRange = await history({ from: tomorrow, to: today });
    expect(invalidRange.status).toBe(400);

    const invalidType = await history({ type: 'BUKAN_AKTIVITAS' });
    expect(invalidType.status).toBe(400);

    const wrongBatch = await history({ batchId: 'batch-tidak-ada' });
    expect(wrongBatch.status).toBe(404);
  });

  it('menampilkan saldo awal historis untuk batch lama tanpa ledger tanpa mengarang ledger baru', async () => {
    legacyBatchCode = `NL-LEGACY-${runId.slice(-12).toUpperCase()}`;
    const legacy = await prisma.batch.create({
      data: {
        code: legacyBatchCode,
        productId,
        productionDate: new Date(`${today}T00:00:00.000Z`),
        stockQuantity: 4,
      },
    });
    legacyBatchId = legacy.id;

    const res = await history({ batchId: legacyBatchId });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const row = res.body.data[0] as HistoryRow;
    expect(row.isHistoricalFallback).toBe(true);
    expect(row.type).toBe('OPENING_BALANCE');
    expect(row.quantity).toBe(4);
    expect(row.stockIn).toBe(4);
    expect(row.batchBalanceAfter).toBe(4);
    expect(row.recordedBy).toBeNull();
    expect(row.reason).toBe('Saldo Awal (Riwayat Sebelumnya Tidak Tersedia)');
    expect(row.reference).toBeNull();
    expect(res.body.summary.hasHistoricalFallback).toBe(true);
    expect(res.body.summary.consistent).toBe(true);
    expect(res.body.summary.currentStock).toBe(16);
    expect(await productStock()).toBe(16);

    // Fallback hanya tampilan: tidak menulis pergerakan baru ke database.
    expect(await ledgerSum(legacyBatchId)).toBe(0);
    expect(
      await prisma.batchStockMovement.count({ where: { batchId: legacyBatchId } })
    ).toBe(0);
  });

  it('tidak mengubah stok atau riwayat saat penjualan gagal (atomik)', async () => {
    const beforeHistory = await history();
    const beforeStock = await productStock();

    const failed = await createSale({
      items: [
        {
          productId,
          allocations: [
            { batchId: productionBatchId, quantity: 1 },
            { batchId: openingBatchId, quantity: 999 },
          ],
        },
      ],
    });
    expect(failed.status).toBe(409);

    const afterHistory = await history();
    expect(afterHistory.body.data).toHaveLength(beforeHistory.body.data.length);
    expect(await productStock()).toBe(beforeStock);
    expect(await batchStock(productionBatchId)).toBe(7);
    expect(await batchStock(openingBatchId)).toBe(5);
  });

  it('tidak mencatat penjualan atau pergerakan dua kali saat idempotency key dipakai ulang', async () => {
    const key = `${runId}-sale-idempotent`;
    const body = {
      items: [
        {
          productId,
          allocations: [{ batchId: productionBatchId, quantity: 1 }],
        },
      ],
    };

    const first = await createSale(body, key);
    const second = await createSale(body, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const firstSaleId = first.body.transaction.id;
    expect(second.body.transaction.id).toBe(firstSaleId);
    expect(second.headers['idempotent-replay']).toBe('true');

    const saleMovements = await prisma.batchStockMovement.count({
      where: { type: 'SALE', saleAllocation: { item: { transactionId: firstSaleId } } },
    });
    expect(saleMovements).toBe(1);
    expect(await batchStock(productionBatchId)).toBe(6);
  });

  it('menjaga saldo riwayat konsisten dengan stok produk dan setiap batch', async () => {
    const res = await history();
    expect(res.status).toBe(200);
    const body = res.body as HistoryResponse;
    const currentStock = await productStock();

    expect(body.summary.consistent).toBe(true);
    expect(body.summary.reconstructedStock).toBe(currentStock);
    expect(body.product.currentStock).toBe(currentStock);
    expect(body.data[0].balanceAfter).toBe(currentStock);

    const byBatch = new Map<string, number>();
    for (const row of body.data) {
      byBatch.set(row.batch.id, (byBatch.get(row.batch.id) ?? 0) + row.quantity);
    }

    const batches = await prisma.batch.findMany({
      where: { productId },
      select: { id: true, stockQuantity: true },
    });
    for (const batch of batches) {
      expect(byBatch.get(batch.id) ?? 0).toBeCloseTo(Number(batch.stockQuantity), 3);
      expect(await batchStock(batch.id)).toBeCloseTo(Number(batch.stockQuantity), 3);
    }
    const total = batches.reduce((sum, batch) => sum + Number(batch.stockQuantity), 0);
    expect(body.data.reduce((sum, row) => sum + row.quantity, 0)).toBeCloseTo(total, 3);
  });
});

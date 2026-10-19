/**
 * Pengujian integrasi B9: dashboard usaha dan laporan operasional.
 * Berjalan terhadap database PostgreSQL lokal (docker compose) — seluruh
 * angka diambil dari API dan dibandingkan dengan data database aktual,
 * bukan angka contoh yang ditanam.
 *
 * Yang diuji:
 * - Kondisi database kosong: respons valid (nol/kosong), bukan error.
 * - Dashboard menampilkan data aktual: stok bahan, stok produk & per
 *   batch, ringkasan produksi, penjualan & omzet.
 * - Omzet hanya menghitung transaksi yang TIDAK dibatalkan; nilai historis
 *   memakai harga yang disimpan pada transaksi — perubahan harga master
 *   tidak mengubahnya.
 * - Transaksi multi-item dan multi-alokasi tidak menggandakan omzet.
 * - Filter tanggal laporan (kalender WIB) berfungsi; rentang tidak valid
 *   ditolak 400.
 * - Otorisasi: tanpa token 401; Operator (informasi operasional) boleh
 *   membaca; kegagalan query database dipetakan ke 500 yang aman.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { todayBusinessDateCode } from './lib/date';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';

const app = createApp();

const runId = `b9-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let adminToken = '';
let operatorToken = '';

// Fixture (dibuat pada describe kedua — describe pertama menguji DB kosong).
let matA = ''; // penerimaan 20 kg hari ini, dipakai produksi, disesuaikan -2
let matB = ''; // saldo awal 5 kg
let prodA = ''; // harga awal 15000; produksi hari ini (10) & kemarin (6)
let prodB = ''; // stok awal batch 5 pcs; terjual lalu ada pembatalan
let prodC = ''; // tanpa batch — memastikan bentuk laporan tetap konsisten
let batchA1 = ''; // produksi hari ini (ID)
let batchA2 = ''; // produksi kemarin (uji filter tanggal, ID)
let batchB1 = ''; // stok awal (NL-OPEN, ID)
let codeA1 = ''; // kode batch produksi hari ini
let codeA2 = ''; // kode batch produksi kemarin
let codeB1 = ''; // kode batch stok awal (NL-OPEN...)

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const wibFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Kode tanggal WIB hari ini + offset hari. */
function dateCode(offsetDays: number): string {
  return wibFormatter.format(new Date(Date.now() + offsetDays * 86_400_000));
}
const today = () => todayBusinessDateCode();
const yesterday = () => dateCode(-1);
const tomorrow = () => dateCode(1);

async function login(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

function createProduct(suffix: string, sellingPrice: number) {
  return request(app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name: `${runId}-produk-${suffix}`, unit: 'pcs', sellingPrice })
    .then((res) => {
      expect(res.status).toBe(201);
      return res.body.product.id as string;
    });
}

function createSale(body: Record<string, unknown>, token = operatorToken) {
  return request(app).post('/api/sales').set(auth(token)).send(body);
}

/** Laporan dengan query period opsional. */
function report(path: string, query: Record<string, string> = {}, token = adminToken) {
  const req = request(app).get(`/api/reports/${path}`).set(auth(token));
  for (const [key, value] of Object.entries(query)) {
    req.query({ [key]: value });
  }
  return req;
}

// ---------------------------------------------------------------------------
// File-level setup: hanya akun (bisnis fixture dibuat setelah uji DB kosong)
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await prisma.user.create({
    data: {
      username: `${runId}-admin`,
      passwordHash: await hashPassword('admin-rahasia-123'),
      role: 'ADMIN',
    },
  });
  await prisma.user.create({
    data: {
      username: `${runId}-operator`,
      passwordHash: await hashPassword('operator-rahasia-123'),
      role: 'OPERATOR',
    },
  });
  adminToken = (await login(`${runId}-admin`, 'admin-rahasia-123')).body.token;
  operatorToken = (await login(`${runId}-operator`, 'operator-rahasia-123')).body.token;
  expect(adminToken).toBeTruthy();
  expect(operatorToken).toBeTruthy();
});

afterAll(async () => {
  const products = await prisma.product.findMany({
    where: { name: { startsWith: runId } },
    select: { id: true },
  });
  const productIds = products.map((p) => p.id);
  const materials = await prisma.material.findMany({
    where: { name: { startsWith: runId } },
    select: { id: true },
  });
  const materialIds = materials.map((m) => m.id);
  const batches = await prisma.batch.findMany({
    where: { productId: { in: productIds } },
    select: { id: true },
  });
  const batchIds = batches.map((b) => b.id);
  const sales = await prisma.saleTransaction.findMany({
    where: { recordedBy: { username: { startsWith: runId } } },
    select: { id: true },
  });
  const saleIds = sales.map((s) => s.id);

  // Hapus berdasarkan relasi (tanpa ON DELETE CASCADE di skema),
  // anak dulu sebelum orang tua.
  await prisma.materialStockMovement.deleteMany({
    where: { materialId: { in: materialIds } },
  });
  await prisma.stockAdjustment.deleteMany({
    where: { materialId: { in: materialIds } },
  });
  await prisma.batchStockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.saleAllocation.deleteMany({ where: { item: { transactionId: { in: saleIds } } } });
  await prisma.saleItem.deleteMany({ where: { transactionId: { in: saleIds } } });
  await prisma.saleTransaction.deleteMany({ where: { id: { in: saleIds } } });
  await prisma.batchOpeningBalance.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.productionMaterialUsage.deleteMany({
    where: { production: { productId: { in: productIds } } },
  });
  await prisma.production.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.materialReceipt.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialOpeningBalance.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialStock.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.material.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

// ---------------------------------------------------------------------------
// Kondisi database kosong
// ---------------------------------------------------------------------------

describe('kondisi database kosong', () => {
  it('dashboard & seluruh laporan mengembalikan respons valid berisi nol/kosong', async () => {
    const [dash, stock, materials, productions, sales] = await Promise.all([
      request(app).get('/api/dashboard').set(auth(operatorToken)),
      report('stock'),
      report('materials'),
      report('productions'),
      report('sales'),
    ]);

    for (const res of [dash, stock, materials, productions, sales]) {
      expect(res.status).toBe(200);
    }

    // Angka nol dan daftar kosong — bukan error.
    // (Bila database lokal berisi data uji lain, perbandingan langsung
    // dengan database di bawah memastikan angka tetap berasal dari data.)
    const [dbMaterials, dbProducts, dbProductions, dbSales, dbCancelled] = await Promise.all([
      prisma.material.count(),
      prisma.product.count(),
      prisma.production.count(),
      prisma.saleTransaction.count({ where: { cancelledAt: null } }),
      prisma.saleTransaction.count({ where: { cancelledAt: { not: null } } }),
    ]);
    expect(dash.body.materials.count).toBe(dbMaterials);
    expect(dash.body.products.count).toBe(dbProducts);
    expect(dash.body.production.recordCount).toBe(dbProductions);
    expect(dash.body.sales.transactionCount).toBe(dbSales);
    expect(dash.body.sales.cancelledCount).toBe(dbCancelled);
    expect(Array.isArray(dash.body.products.batchesWithStock)).toBe(true);
    expect(Array.isArray(dash.body.production.recent)).toBe(true);
    expect(Array.isArray(dash.body.sales.recent)).toBe(true);

    expect(stock.body.materials.filter((m: any) => m.name.startsWith(runId))).toEqual([]);
    expect(stock.body.products.filter((p: any) => p.name.startsWith(runId))).toEqual([]);
    expect(
      materials.body.materials.filter((m: any) => m.name.startsWith(runId))
    ).toEqual([]);
    expect(
      productions.body.records.filter((r: any) => r.productName.startsWith(runId))
    ).toEqual([]);
    expect(Array.isArray(productions.body.summary.byProduct)).toBe(true);
    expect(productions.body.summary.recordCount).toBe(dbProductions);
    expect(Array.isArray(sales.body.byDay)).toBe(true);
    expect(Array.isArray(sales.body.byProduct)).toBe(true);
    // Omzet laporan = jumlah total transaksi aktif di database.
    const dbOmzet = await prisma.saleTransaction.aggregate({
      where: { cancelledAt: null },
      _sum: { total: true },
    });
    expect(sales.body.summary.omzet).toBe(Number(dbOmzet._sum.total ?? 0));
    expect(sales.body.summary.transactionCount).toBe(dbSales);
    expect(sales.body.summary.cancelledCount).toBe(dbCancelled);
  });

  it('periode tanpa data menghasilkan nol dan daftar kosong (bukan error)', async () => {
    const res = await report('sales', { from: tomorrow(), to: tomorrow() });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ transactionCount: 0, cancelledCount: 0, omzet: 0 });
    expect(res.body.byDay).toEqual([]);
    expect(res.body.byProduct).toEqual([]);

    const prodRes = await report('productions', { from: tomorrow(), to: tomorrow() });
    expect(prodRes.status).toBe(200);
    expect(prodRes.body.summary.recordCount).toBe(0);
    expect(prodRes.body.records).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Setup fixture data aktual — dibuat di beforeAll describe induk sehingga
// uji "database kosong" di atas benar-benar berjalan sebelum data ada
// (beforeAll tingkat file berjalan sebelum seluruh tes).
// ---------------------------------------------------------------------------

describe('dashboard & laporan dengan data aktual', () => {
  beforeAll(async () => {
    // Bahan baku.
    matA = await (async () => {
      const res = await request(app)
        .post('/api/materials')
        .set(auth(adminToken))
        .send({ name: `${runId}-bahan-a`, unit: 'kg' });
      expect(res.status).toBe(201);
      return res.body.material.id;
    })();
    matB = await (await request(app)
      .post('/api/materials')
      .set(auth(adminToken))
      .send({ name: `${runId}-bahan-b`, unit: 'kg' })).body.material.id;

  // Penerimaan 20 kg matA (tanggal bisnis hari ini).
  const receipt = await request(app)
    .post(`/api/materials/${matA}/receipts`)
    .set(auth(operatorToken))
    .send({ quantity: 20, receivedAt: today() });
  expect(receipt.status).toBe(201);

  // Saldo awal 5 kg matB — dicatat Admin, terpisah dari penerimaan.
  const opening = await request(app)
    .post(`/api/materials/${matB}/opening-balances`)
    .set(auth(adminToken))
    .send({ quantity: 5, date: today(), reason: 'Saldo awal gudang KWT.' });
  expect(opening.status).toBe(201);

  // Produk.
  prodA = await createProduct('a', 15000);
  prodB = await createProduct('b', 8000);
  prodC = await createProduct('c', 5000);

  // Produksi hari ini: hasil 10, memakai 4 kg matA.
  const prod1 = await request(app)
    .post('/api/productions')
    .set(auth(operatorToken))
    .send({
      productId: prodA,
      productionDate: today(),
      yieldQuantity: 10,
      materials: [{ materialId: matA, quantity: 4 }],
    });
  expect(prod1.status).toBe(201);
  batchA1 = prod1.body.production.batch.id;
  codeA1 = prod1.body.production.batch.code;

  // Produksi kemarin (pencatatan mundur): hasil 6, memakai 2 kg matA.
  const prod2 = await request(app)
    .post('/api/productions')
    .set(auth(operatorToken))
    .send({
      productId: prodA,
      productionDate: yesterday(),
      yieldQuantity: 6,
      materials: [{ materialId: matA, quantity: 2 }],
    });
  expect(prod2.status).toBe(201);
  batchA2 = prod2.body.production.batch.id;
  codeA2 = prod2.body.production.batch.code;

  // Stok awal produk jadi prodB: 5 pcs, tanpa tanggal produksi (NL-OPEN).
  const openBatch = await request(app)
    .post('/api/batches/opening-stock')
    .set(auth(adminToken))
    .send({ productId: prodB, quantity: 5 });
  expect(openBatch.status).toBe(201);
  batchB1 = openBatch.body.batch.id;
  codeB1 = openBatch.body.batch.code;

  // Penjualan 1 (multi-item + multi-alokasi):
  //   prodA 4 pcs (2 dari A1 + 2 dari A2), prodB 2 pcs (dari B1)
  // Total backend: 4×15000 + 2×8000 = 76000.
  const sale1 = await createSale({
    items: [
      {
        productId: prodA,
        allocations: [
          { batchId: batchA1, quantity: 2 },
          { batchId: batchA2, quantity: 2 },
        ],
      },
      { productId: prodB, allocations: [{ batchId: batchB1, quantity: 2 }] },
    ],
  });
  expect(sale1.status).toBe(201);

  // Penjualan 2 (nanti dibatalkan Admin): prodB 1 pcs = 8000.
  const sale2 = await createSale({
    items: [{ productId: prodB, allocations: [{ batchId: batchB1, quantity: 1 }] }],
  });
  expect(sale2.status).toBe(201);
  const cancel = await request(app)
    .post(`/api/sales/${sale2.body.transaction.id}/cancel`)
    .set(auth(adminToken))
    .send({ reason: 'Transaksi uji B9 — salah catat.' });
  expect(cancel.status).toBe(200);

  // Penyesuaian stok matA: -2 kg (Admin, alasan wajib).
  const adjustment = await request(app)
    .post('/api/stock-adjustments')
    .set(auth(adminToken))
    .send({ targetType: 'MATERIAL', targetId: matA, quantity: -2, reason: 'Rusak saat penyimpanan.' });
  expect(adjustment.status).toBe(201);

  // Perubahan harga master SETELAH penjualan — nilai historis tidak berubah.
  const priceChange = await request(app)
    .patch(`/api/products/${prodA}`)
    .set(auth(adminToken))
    .send({ sellingPrice: 99999 });
  expect(priceChange.status).toBe(200);
});

// ---------------------------------------------------------------------------
// Dashboard usaha
// ---------------------------------------------------------------------------

describe('dashboard usaha', () => {
  it('menampilkan data aktual dari database', async () => {
    const res = await request(app).get('/api/dashboard').set(auth(operatorToken));
    expect(res.status).toBe(200);
    const body = res.body;

    // Stok bahan: matA 20-4-2-2=12 kg; matB 5 kg.
    const matByName = new Map(body.materials.items.map((m: any) => [m.name, m]));
    expect(matByName.get(`${runId}-bahan-a`).stock).toBe(12);
    expect(matByName.get(`${runId}-bahan-b`).stock).toBe(5);

    // Stok produk = jumlah stok seluruh batch (README 5.4).
    const prodByName = new Map(body.products.items.map((p: any) => [p.name, p]));
    // prodA: 10+6 hasil - 4 terjual = 12 (2 batch).
    expect(prodByName.get(`${runId}-produk-a`).stock).toBe(12);
    expect(prodByName.get(`${runId}-produk-a`).batchCount).toBe(2);
    // prodB: 5 stok awal - 2 terjual - 1 + 1 (pembatalan mengembalikan stok) = 3.
    expect(prodByName.get(`${runId}-produk-b`).stock).toBe(3);
    expect(prodByName.get(`${runId}-produk-b`).batchCount).toBe(1);
    // prodC tanpa batch: nol, bentuk tetap konsisten.
    expect(prodByName.get(`${runId}-produk-c`).stock).toBe(0);
    expect(prodByName.get(`${runId}-produk-c`).batchCount).toBe(0);

    // Per batch: hanya batch yang masih punya stok.
    expect(body.products.batchesWithStock).toHaveLength(3);
    const batchStocks = new Map(
      body.products.batchesWithStock.map((b: any) => [b.code, b.stock])
    );
    // Stok per batch: A1 10-2=8, A2 6-2=4, B1 5-2-1+1=3.
    expect(batchStocks.get(codeA1)).toBe(8);
    expect(batchStocks.get(codeA2)).toBe(4);
    expect(batchStocks.get(codeB1)).toBe(3);
    // Semua stok batch > 0 dan totalnya = jumlah total produk (12 + 3).
    const totalBatchStock = body.products.batchesWithStock.reduce(
      (sum: number, b: any) => sum + b.stock,
      0
    );
    expect(totalBatchStock).toBe(15);

    // Ringkasan produksi: 2 catatan, hasil prodA total 16.
    expect(body.production.recordCount).toBe(2);
    const prodSummary = body.production.byProduct.find(
      (p: any) => p.productId === prodA
    );
    expect(prodSummary.recordCount).toBe(2);
    expect(prodSummary.totalYield).toBe(16);
    expect(body.production.recent).toHaveLength(2);
    // Terbaru dulu: produksi hari ini (10) sebelum kemarin (6).
    expect(body.production.recent[0].yieldQuantity).toBe(10);
    expect(body.production.recent[1].yieldQuantity).toBe(6);

    // Penjualan & omzet: 1 transaksi aktif (76000), 1 dibatalkan (8000).
    // Harga master yang sudah 99999 TIDAK mengubah nilai historis.
    expect(body.sales.transactionCount).toBe(1);
    expect(body.sales.cancelledCount).toBe(1);
    expect(body.sales.omzet).toBe(76000);
    expect(body.sales.recent).toHaveLength(2);
    const statuses = body.sales.recent.map((s: any) => s.status).sort();
    expect(statuses).toEqual(['CANCELLED', 'COMPLETED']);
  });

  it('menolak akses tanpa autentikasi', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Laporan stok
// ---------------------------------------------------------------------------

describe('laporan stok', () => {
  it('menampilkan snapshot stok aktual bahan dan per batch', async () => {
    const res = await report('stock');
    expect(res.status).toBe(200);

    const matByName = new Map(res.body.materials.map((m: any) => [m.name, m]));
    expect(matByName.get(`${runId}-bahan-a`).stock).toBe(12);
    expect(matByName.get(`${runId}-bahan-a`).unit).toBe('kg');
    expect(matByName.get(`${runId}-bahan-b`).stock).toBe(5);

    const prodByName = new Map(res.body.products.map((p: any) => [p.name, p]));
    const a = prodByName.get(`${runId}-produk-a`);
    expect(a.stock).toBe(12);
    expect(a.batches).toHaveLength(2);
    // Stok per batch cocok dengan kode batch produksi (hari ini & kemarin).
    const batchStockMap = new Map(a.batches.map((b: any) => [b.code, b.stock]));
    expect([...batchStockMap.values()].sort((x, y) => x - y)).toEqual([4, 8]);

    const b = prodByName.get(`${runId}-produk-b`);
    expect(b.stock).toBe(3);
    expect(b.batches).toHaveLength(1);
    expect(b.batches[0].productionDate).toBeNull(); // NL-OPEN tanpa tanggal
    expect(b.batches[0].expiryDate).toBeNull();
    expect(b.batches[0].expiryValidated).toBe(false);

    // Produk tanpa batch tetap muncul dengan stok 0 dan daftar kosong.
    const c = prodByName.get(`${runId}-produk-c`);
    expect(c.stock).toBe(0);
    expect(c.batches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Laporan bahan baku
// ---------------------------------------------------------------------------

describe('laporan bahan baku', () => {
  it('pergerakan periode hari ini sesuai catatan (penerimaan, pemakaian, penyesuaian)', async () => {
    const res = await report('materials', { from: today(), to: today() });
    expect(res.status).toBe(200);
    expect(res.body.from).toBe(today());
    expect(res.body.to).toBe(today());

    const a = res.body.materials.find((m: any) => m.name === `${runId}-bahan-a`);
    expect(a.received).toBe(20); // penerimaan hari ini
    expect(a.openingBalance).toBe(0);
    expect(a.used).toBe(4); // pemakaian produksi hari ini (4 kg)
    expect(a.adjusted).toBe(-2); // penyesuaian -2 kg
    expect(a.currentStock).toBe(12); // selalu saldo terkini

    const b = res.body.materials.find((m: any) => m.name === `${runId}-bahan-b`);
    expect(b.received).toBe(0);
    expect(b.openingBalance).toBe(5); // saldo awal hari ini
    expect(b.used).toBe(0);
    expect(b.adjusted).toBe(0);
  });

  it('filter tanggal kemarin memisahkan pemakaian produksi kemarin', async () => {
    const res = await report('materials', { from: yesterday(), to: yesterday() });
    expect(res.status).toBe(200);

    const a = res.body.materials.find((m: any) => m.name === `${runId}-bahan-a`);
    expect(a.received).toBe(0); // penerimaan terjadi hari ini, bukan kemarin
    expect(a.used).toBe(2); // produksi kemarin memakai 2 kg
    expect(a.adjusted).toBe(0);
    expect(a.currentStock).toBe(12); // stok terkini tidak terikat periode
  });

  it('menolak parameter tanggal tidak valid (400)', async () => {
    const badFormat = await report('materials', { from: 'bukan-tanggal' });
    expect(badFormat.status).toBe(400);

    const impossibleDate = await report('materials', { from: '2026-02-31' });
    expect(impossibleDate.status).toBe(400);

    const reversed = await report('materials', { from: tomorrow(), to: today() });
    expect(reversed.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Laporan produksi
// ---------------------------------------------------------------------------

describe('laporan produksi', () => {
  it('seluruh periode: 2 catatan, hasil 16, kode batch & jumlah koreksi benar', async () => {
    const res = await report('productions');
    expect(res.status).toBe(200);
    expect(res.body.summary.recordCount).toBe(2);

    const prodSummary = res.body.summary.byProduct.find((p: any) => p.productId === prodA);
    expect(prodSummary.recordCount).toBe(2);
    expect(prodSummary.totalYield).toBe(16);
    expect(prodSummary.productName).toBe(`${runId}-produk-a`);

    // Terbaru dulu; kode batch produksi hari ini & kemarin tercatat.
    expect(res.body.records).toHaveLength(2);
    const batchCodes = res.body.records.map((r: any) => r.batchCode);
    expect(batchCodes).toContain(codeA1);
    expect(batchCodes).toContain(codeA2);
    expect(res.body.records[0].correctionCount).toBe(0);
    expect(
      res.body.records.map((r: any) => r.yieldQuantity).sort((x: number, y: number) => x - y)
    ).toEqual([6, 10]);
  });

  it('filter tanggal hari ini hanya memuat produksi hari ini', async () => {
    const res = await report('productions', { from: today(), to: today() });
    expect(res.status).toBe(200);
    expect(res.body.summary.recordCount).toBe(1);
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].yieldQuantity).toBe(10);

    const yesterdayRes = await report('productions', { from: yesterday(), to: yesterday() });
    expect(yesterdayRes.body.summary.recordCount).toBe(1);
    expect(yesterdayRes.body.records[0].yieldQuantity).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Laporan penjualan
// ---------------------------------------------------------------------------

describe('laporan penjualan', () => {
  it('omzet hanya transaksi aktif, memakai harga snapshot — bukan harga master kini', async () => {
    const res = await report('sales');
    expect(res.status).toBe(200);

    // 1 transaksi aktif 76000; 1 dibatalkan (8000) tidak dihitung.
    // Harga master prodA sudah 99999 — omzet TETAP 76000.
    expect(res.body.summary.transactionCount).toBe(1);
    expect(res.body.summary.cancelledCount).toBe(1);
    expect(res.body.summary.omzet).toBe(76000);

    // Per produk: nilai = jumlah × harga snapshot transaksi.
    const byProduct = new Map(res.body.byProduct.map((p: any) => [p.productId, p]));
    const a = byProduct.get(prodA);
    expect(a.quantity).toBe(4);
    expect(a.value).toBe(60000); // 4 × 15000 (harga lama), bukan 4 × 99999
    const b = byProduct.get(prodB);
    expect(b.quantity).toBe(2); // hanya transaksi aktif — pembatalan dikecualikan
    expect(b.value).toBe(16000); // 2 × 8000
  });

  it('transaksi multi-item & multi-alokasi tidak menggandakan omzet', async () => {
    const res = await report('sales');
    // Transaksi 1 memiliki 2 item dan 3 alokasi batch; omzet tetap satu
    // kali total transaksi (76000), bukan kelipatan jumlah alokasi.
    expect(res.body.summary.omzet).toBe(76000);
    // Nilai per produk dijumlahkan dari baris item — alokasi tidak dihitung.
    const totalItemValue = res.body.byProduct.reduce((sum: number, p: any) => sum + p.value, 0);
    expect(totalItemValue).toBe(76000);
  });

  it('omzet per hari bisnis WIB benar dan transaksi batal tidak muncul', async () => {
    const res = await report('sales');
    expect(res.body.byDay).toHaveLength(1);
    expect(res.body.byDay[0].date).toBe(today());
    expect(res.body.byDay[0].transactionCount).toBe(1);
    expect(res.body.byDay[0].omzet).toBe(76000); // 8000 yang dibatalkan tidak dihitung
  });

  it('filter tanggal bekerja: kemarin tanpa penjualan, hari ini sesuai', async () => {
    const yesterdayRes = await report('sales', { from: yesterday(), to: yesterday() });
    expect(yesterdayRes.status).toBe(200);
    expect(yesterdayRes.body.summary.omzet).toBe(0);
    expect(yesterdayRes.body.byDay).toEqual([]);

    const todayRes = await report('sales', { from: today(), to: today() });
    expect(todayRes.body.summary.transactionCount).toBe(1);
    expect(todayRes.body.summary.omzet).toBe(76000);
    expect(todayRes.body.byDay).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Otorisasi dan penanganan kegagalan
// ---------------------------------------------------------------------------

describe('otorisasi & kegagalan database', () => {
  const endpoints = [
    '/api/dashboard',
    '/api/reports/stock',
    '/api/reports/materials',
    '/api/reports/productions',
    '/api/reports/sales',
  ];

  it('menolak akses tanpa autentikasi (401)', async () => {
    for (const path of endpoints) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });

  it('Operator (informasi operasional) boleh membaca dashboard & laporan', async () => {
    for (const path of endpoints) {
      const res = await request(app).get(path).set(auth(operatorToken));
      expect(res.status).toBe(200);
    }
  });

  it('kegagalan query database dipetakan ke 500 yang aman', async () => {
    const spy = vi
      .spyOn(prisma.material, 'findMany')
      .mockRejectedValueOnce(new Error('simulasi database down'));
    try {
      const res = await report('stock');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ message: 'Terjadi kesalahan pada server.' });
      // Detail error internal tidak bocor ke klien.
      expect(JSON.stringify(res.body)).not.toContain('database down');
    } finally {
      spy.mockRestore();
    }
  });
});
}); // describe('dashboard & laporan dengan data aktual')

/**
 * Pengujian integrasi B6: stok produk jadi per batch, total stok per produk,
 * stok awal produk jadi (Admin), dan penyesuaian stok (Admin).
 * Berjalan terhadap database PostgreSQL lokal (docker compose).
 *
 * Catatan konvensi ledger yang diuji:
 * - Batch (BatchStockMovement): SEMUA quantity bernilai tanda.
 * - Bahan (MaterialStockMovement): RECEIPT/OPENING_BALANCE/PRODUCTION_USAGE
 *   disimpan positif (pemakaian mengurangi stok saat dihitung), ADJUSTMENT
 *   bernilai tanda.
 */
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';
import { runIdempotent } from './lib/idempotency';
import { applyBatchStockChange, applyMaterialStockChange } from './lib/stock';

const app = createApp();

const runId = `b6-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let adminToken = '';
let operatorToken = '';
let adminId = '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const wibFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Kode tanggal WIB hari ini + `offsetDays`. */
function dateCode(offsetDays: number): string {
  return wibFormatter.format(new Date(Date.now() + offsetDays * 86_400_000));
}
const todayCode = () => dateCode(0);
const pastCode = (days: number) => dateCode(-days);
const tomorrowCode = () => dateCode(1);

function sequenceOf(code: string): number {
  const parsed = Number.parseInt(code.slice(-3), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Kode batch berikutnya yang diharapkan untuk suatu prefix (dari data terkini). */
async function expectedNextCode(prefix: string): Promise<string> {
  const [lastBatch, lastAlias] = await Promise.all([
    prisma.batch.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } }),
    prisma.batchAlias.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } }),
  ]);
  const next =
    Math.max(lastBatch ? sequenceOf(lastBatch.code) : 0, lastAlias ? sequenceOf(lastAlias.code) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

async function login(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

async function createProduct(suffix: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name: `${runId}-produk-${suffix}`, unit: 'pcs', sellingPrice: 15000, ...overrides });
  expect(res.status).toBe(201);
  return res.body.product;
}

async function createMaterial(suffix: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/materials')
    .set(auth(adminToken))
    .send({ name: `${runId}-bahan-${suffix}`, unit: 'kg', ...overrides });
  expect(res.status).toBe(201);
  return res.body.material;
}

/** Memberi stok bahan lewat penerimaan (B4). */
async function stockViaReceipt(materialId: string, quantity: number) {
  const res = await request(app)
    .post(`/api/materials/${materialId}/receipts`)
    .set(auth(operatorToken))
    .send({ quantity });
  expect(res.status).toBe(201);
  return res.body.stock as number;
}

function postProduction(body: Record<string, unknown>, token = operatorToken) {
  return request(app).post('/api/productions').set(auth(token)).send(body);
}

/** Mencatat stok awal produk jadi (khusus Admin). */
function openingStock(body: Record<string, unknown>, token = adminToken) {
  return request(app).post('/api/batches/opening-stock').set(auth(token)).send(body);
}

/** Menyesuaian stok (khusus Admin). */
function adjust(body: Record<string, unknown>, token = adminToken) {
  return request(app).post('/api/stock-adjustments').set(auth(token)).send(body);
}

async function getMaterialStockApi(materialId: string): Promise<number> {
  const res = await request(app).get(`/api/materials/${materialId}`).set(auth(operatorToken));
  return res.body.material.stock;
}

async function getProductSummary(productId: string): Promise<{ stock: number; batchCount: number }> {
  const res = await request(app).get(`/api/products/${productId}`).set(auth(operatorToken));
  expect(res.status).toBe(200);
  return { stock: res.body.product.stock, batchCount: res.body.product.batchCount };
}

// ---------------------------------------------------------------------------
// Audit konsistensi stok
// ---------------------------------------------------------------------------

/** Stok batch tersimpan == jumlah SELURUH pergerakan (semuanya bertanda). */
async function auditBatchStock(productIds: string[]) {
  const batches = await prisma.batch.findMany({
    where: { productId: { in: productIds } },
    select: { id: true, code: true, stockQuantity: true },
  });
  for (const batch of batches) {
    const movements = await prisma.batchStockMovement.findMany({
      where: { batchId: batch.id },
      select: { quantity: true },
    });
    const sum = movements.reduce((acc, m) => acc + Number(m.quantity), 0);
    expect(
      Number(batch.stockQuantity),
      `stok batch ${batch.code} tidak sama dengan jumlah pergerakannya`
    ).toBeCloseTo(sum, 3);
  }
}

/**
 * Stok bahan tersimpan == jumlah pergerakan dengan konvensi ledger bahan:
 * RECEIPT/OPENING_BALANCE/ADJUSTMENT ditambahkan, PRODUCTION_USAGE dikurangkan.
 */
async function auditMaterialStock(materialIds: string[]) {
  const stocks = await prisma.materialStock.findMany({
    where: { materialId: { in: materialIds } },
    select: { materialId: true, quantity: true },
  });
  for (const stock of stocks) {
    const movements = await prisma.materialStockMovement.findMany({
      where: { materialId: stock.materialId },
      select: { type: true, quantity: true },
    });
    const sum = movements.reduce(
      (acc, m) => acc + (m.type === 'PRODUCTION_USAGE' ? -Number(m.quantity) : Number(m.quantity)),
      0
    );
    expect(
      Number(stock.quantity),
      'stok bahan tidak sama dengan jumlah pergerakannya'
    ).toBeCloseTo(sum, 3);
  }
}

/** Total stok produk (respons API) == jumlah stok seluruh batch produk itu. */
async function auditProductTotals(productIds: string[]) {
  for (const productId of productIds) {
    const batches = await prisma.batch.findMany({
      where: { productId },
      select: { stockQuantity: true },
    });
    const sum = batches.reduce((acc, b) => acc + Number(b.stockQuantity), 0);
    const summary = await getProductSummary(productId);
    expect(summary.stock, 'total produk ≠ jumlah stok seluruh batch').toBeCloseTo(sum, 3);
    expect(summary.batchCount).toBe(batches.length);
  }
}

async function allRunProductIds(): Promise<string[]> {
  const products = await prisma.product.findMany({
    where: { name: { startsWith: runId } },
    select: { id: true },
  });
  return products.map((p) => p.id);
}

async function allRunMaterialIds(): Promise<string[]> {
  const materials = await prisma.material.findMany({
    where: { name: { startsWith: runId } },
    select: { id: true },
  });
  return materials.map((m) => m.id);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

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
  const batches = await prisma.batch.findMany({
    where: { productId: { in: productIds } },
    select: { id: true },
  });
  const batchIds = batches.map((b) => b.id);
  const productions = await prisma.production.findMany({
    where: { productId: { in: productIds } },
    select: { id: true },
  });
  const productionIds = productions.map((p) => p.id);
  const materials = await prisma.material.findMany({
    where: { name: { startsWith: runId } },
    select: { id: true },
  });
  const materialIds = materials.map((m) => m.id);

  // Hapus berdasarkan relasi (tanpa ON DELETE CASCADE di skema).
  await prisma.batchStockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.materialStockMovement.deleteMany({ where: { materialId: { in: materialIds } } });
  // Penyesuaian dirujuk oleh pergerakan — dihapus setelah pergerakan.
  await prisma.stockAdjustment.deleteMany({
    where: {
      OR: [{ materialId: { in: materialIds } }, { batchId: { in: batchIds } }],
    },
  });
  await prisma.batchOpeningBalance.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.productionCorrection.deleteMany({ where: { productionId: { in: productionIds } } });
  await prisma.productionMaterialUsage.deleteMany({ where: { productionId: { in: productionIds } } });
  await prisma.materialReceipt.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialOpeningBalance.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.batchAlias.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.production.deleteMany({ where: { id: { in: productionIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.materialStock.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.material.deleteMany({ where: { id: { in: materialIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

// ---------------------------------------------------------------------------
// Melihat stok per batch dan total per produk
// ---------------------------------------------------------------------------

describe('Melihat stok per batch dan total stok per produk', () => {
  it('Stok batch = hasil produksi; total produk = jumlah stok seluruh batch', async () => {
    const product = await createProduct('total');
    const bahan = await createMaterial('total');
    await stockViaReceipt(bahan.id, 100);

    const first = await postProduction({
      productId: product.id,
      productionDate: pastCode(3),
      yieldQuantity: 25,
      materials: [{ materialId: bahan.id, quantity: 10 }],
    });
    const second = await postProduction({
      productId: product.id,
      productionDate: pastCode(2),
      yieldQuantity: 10,
      materials: [{ materialId: bahan.id, quantity: 5 }],
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const list = await request(app)
      .get(`/api/batches?productId=${product.id}`)
      .set(auth(operatorToken));
    expect(list.status).toBe(200);
    const listed = list.body.data as {
      id: string;
      code: string;
      stock: number;
      productionDate: string | null;
      hasLimitedHistory: boolean;
      aliases: string[];
      product: { id: string };
    }[];
    expect(listed).toHaveLength(2);
    expect(listed.map((b) => b.stock).reduce((a, b) => a + b, 0)).toBe(35);
    expect(listed.every((b) => b.product.id === product.id)).toBe(true);
    expect(listed.every((b) => b.hasLimitedHistory === false)).toBe(true);
    expect(listed.every((b) => Array.isArray(b.aliases))).toBe(true);

    const detail = await request(app)
      .get(`/api/batches/${first.body.production.batch.id}`)
      .set(auth(operatorToken));
    expect(detail.status).toBe(200);
    const batch = detail.body.batch;
    expect(batch.stock).toBe(25);
    expect(batch.productionDate).toContain(pastCode(3));
    expect(batch.hasLimitedHistory).toBe(false);
    expect(batch.movements).toHaveLength(1);
    expect(batch.movements[0].type).toBe('PRODUCTION_YIELD');
    expect(batch.movements[0].quantity).toBe(25);
    expect(batch.movements[0].recordedBy.username).toBe(`${runId}-operator`);
    expect(batch.movements[0].occurredAt).toContain(pastCode(3));
    expect(batch.openingBalance).toBeNull();

    const summary = await getProductSummary(product.id);
    expect(summary.stock).toBe(35);
    expect(summary.batchCount).toBe(2);

    // Daftar produk menampilkan total yang sama (bukan angka terpisah).
    const products = await request(app).get('/api/products').set(auth(operatorToken));
    const entry = (products.body.data as { id: string; stock: number; batchCount: number }[]).find(
      (p) => p.id === product.id
    );
    expect(entry?.stock).toBe(35);
    expect(entry?.batchCount).toBe(2);

    await auditBatchStock([product.id]);
    await auditProductTotals([product.id]);
  });

  it('Produk tanpa batch melaporkan total stok 0 dan batchCount 0', async () => {
    const product = await createProduct('kosong');
    const summary = await getProductSummary(product.id);
    expect(summary).toEqual({ stock: 0, batchCount: 0 });

    const products = await request(app).get('/api/products').set(auth(operatorToken));
    const entry = (products.body.data as { id: string; stock?: number; batchCount?: number }[]).find(
      (p) => p.id === product.id
    );
    expect(entry?.stock).toBe(0);
    expect(entry?.batchCount).toBe(0);

    const list = await request(app).get('/api/batches').set(auth(operatorToken));
    expect(list.status).toBe(200);
    expect((list.body.data as { product: { id: string } }[]).some((b) => b.product.id === product.id)).toBe(false);
  });

  it('Koreksi hasil produksi mengubah stok batch dan total produk tetap = jumlah batch', async () => {
    const product = await createProduct('koreksi-total');
    const bahan = await createMaterial('koreksi-total');
    await stockViaReceipt(bahan.id, 100);

    const created = await postProduction({
      productId: product.id,
      productionDate: pastCode(4),
      yieldQuantity: 25,
      materials: [{ materialId: bahan.id, quantity: 10 }],
    });
    expect(created.status).toBe(201);
    expect(await getProductSummary(product.id)).toEqual({ stock: 25, batchCount: 1 });

    const corrected = await request(app)
      .patch(`/api/productions/${created.body.production.id}`)
      .set(auth(adminToken))
      .send({ yieldQuantity: 18 });
    expect(corrected.status).toBe(200);

    const summary = await getProductSummary(product.id);
    expect(summary.stock).toBe(18);

    await auditBatchStock([product.id]);
    await auditProductTotals([product.id]);
  });

  it('Penyesuaian stok batch mengubah stok batch dan total produk mengikutinya', async () => {
    const product = await createProduct('sesuaian-total');
    const up = await openingStock({ productId: product.id, quantity: 10 });
    expect(up.status).toBe(201);
    const batchId = up.body.batch.id;

    const plus = await adjust({
      targetType: 'BATCH',
      targetId: batchId,
      quantity: 5,
      reason: 'Barang hasil retur diperiksa dan layak jual',
    });
    expect(plus.status).toBe(201);
    expect(plus.body.stock).toBe(15);

    const minus = await adjust({
      targetType: 'BATCH',
      targetId: batchId,
      quantity: -3,
      reason: 'Kerusakan fisik pada pengemasan ulang',
    });
    expect(minus.status).toBe(201);
    expect(minus.body.stock).toBe(12);

    const summary = await getProductSummary(product.id);
    expect(summary.stock).toBe(12);
    expect(summary.batchCount).toBe(1);

    await auditBatchStock([product.id]);
    await auditProductTotals([product.id]);
  });
});

// ---------------------------------------------------------------------------
// Stok awal produk jadi (README 5.3)
// ---------------------------------------------------------------------------

describe('Stok awal produk jadi (hanya Admin)', () => {
  it('Tanpa tanggal produksi: kode NL-OPEN-<tanggal pencatatan>, riwayat terbatas', async () => {
    const product = await createProduct('open');
    const prefix = `NL-OPEN-${todayCode().replace(/-/g, '')}-`;
    const expected = await expectedNextCode(prefix);

    const res = await openingStock({ productId: product.id, quantity: 12.5, note: 'Stok awal gudang lama' });

    expect(res.status).toBe(201);
    expect(res.body.batch.code).toMatch(new RegExp(`^${prefix}\\d{3}$`));
    expect(res.body.batch.code).toBe(expected);
    // Tanggal produksi TIDAK dikarang.
    expect(res.body.batch.productionDate).toBeNull();
    expect(res.body.batch.hasLimitedHistory).toBe(true);
    expect(res.body.batch.stock).toBe(12.5);
    expect(res.body.stock).toBe(12.5);
    expect(res.body.batch.aliases).toEqual([]);

    // Pergerakan stok awal tercatat dan dikaitkan dengan catatan sumbernya.
    const movements = res.body.batch.movements as {
      type: string;
      quantity: number;
      occurredAt: string;
      reason: string | null;
      recordedBy: { username: string };
    }[];
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe('OPENING_BALANCE');
    expect(movements[0].quantity).toBe(12.5);
    expect(movements[0].reason).toBe('Stok awal gudang lama');
    expect(movements[0].recordedBy.username).toBe(`${runId}-admin`);
    // Tanggal pada pergerakan = tanggal pencatatan (hari ini, kalender WIB).
    expect(wibFormatter.format(new Date(movements[0].occurredAt))).toBe(todayCode());

    const opening = res.body.batch.openingBalance as {
      quantity: number;
      note: string | null;
      recordedBy: { username: string };
    };
    expect(opening.quantity).toBe(12.5);
    expect(opening.note).toBe('Stok awal gudang lama');
    expect(opening.recordedBy.username).toBe(`${runId}-admin`);

    // Tersimpan di database dan terhubung dua arah dengan pergerakannya.
    const stored = await prisma.batch.findUniqueOrThrow({
      where: { id: res.body.batch.id },
      include: { openingBalance: true, stockMovements: true },
    });
    expect(stored.productionDate).toBeNull();
    expect(Number(stored.stockQuantity)).toBe(12.5);
    expect(stored.openingBalance?.id).toBeTruthy();
    expect(stored.stockMovements).toHaveLength(1);
    expect(stored.stockMovements[0].openingBalanceId).toBe(stored.openingBalance?.id);

    const summary = await getProductSummary(product.id);
    expect(summary).toEqual({ stock: 12.5, batchCount: 1 });

    await auditBatchStock([product.id]);
    await auditProductTotals([product.id]);
  });

  it('Nomor urut stok awal berlanjut untuk tanggal pencatatan yang sama', async () => {
    const product = await createProduct('open-urut');
    const prefix = `NL-OPEN-${todayCode().replace(/-/g, '')}-`;
    const expectedFirst = await expectedNextCode(prefix);

    const first = await openingStock({ productId: product.id, quantity: 5 });
    expect(first.status).toBe(201);
    expect(first.body.batch.code).toBe(expectedFirst);

    const expectedSecond = await expectedNextCode(prefix);
    expect(expectedSecond).not.toBe(expectedFirst);

    const second = await openingStock({ productId: product.id, quantity: 7 });
    expect(second.status).toBe(201);
    expect(second.body.batch.code).toBe(expectedSecond);

    const summary = await getProductSummary(product.id);
    expect(summary.stock).toBe(12);
    expect(summary.batchCount).toBe(2);
  });

  it('Dengan tanggal produksi diketahui: kode NL-TANGGAL-NNN dan tanggal produksi terisi', async () => {
    const product = await createProduct('open-tanggal');
    const date = pastCode(400);
    const prefix = `NL-${date.replace(/-/g, '')}-`;
    const expected = await expectedNextCode(prefix);

    const res = await openingStock({ productId: product.id, quantity: 20, productionDate: date });
    expect(res.status).toBe(201);
    expect(res.body.batch.code).toBe(expected);
    expect(res.body.batch.code).toMatch(new RegExp(`^NL-\\d{8}-\\d{3}$`));
    expect(res.body.batch.productionDate).toContain(date);
    // Tanpa catatan produksi, batch stok awal tetap ditandai riwayat terbatas
    // (tidak ada komposisi/riwayat hasil yang bisa ditampilkan).
    expect(res.body.batch.hasLimitedHistory).toBe(true);
    expect(res.body.batch.stock).toBe(20);

    const summary = await getProductSummary(product.id);
    expect(summary.stock).toBe(20);
    await auditBatchStock([product.id]);
  });

  it('Validasi dan pengecekan stok awal ditolak (400/404/409) tanpa data tersimpan', async () => {
    const product = await createProduct('open-validasi');
    const inactive = await createProduct('open-nonaktif');
    const deact = await request(app)
      .patch(`/api/products/${inactive.id}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(deact.status).toBe(200);

    expect((await openingStock({ productId: product.id, quantity: 0 })).status).toBe(400);
    expect((await openingStock({ productId: product.id, quantity: -4 })).status).toBe(400);
    expect((await openingStock({ productId: product.id, quantity: 1.2345 })).status).toBe(400);
    expect((await openingStock({ productId: product.id, quantity: 'lima' })).status).toBe(400);
    expect((await openingStock({ quantity: 5 })).status).toBe(400);
    expect((await openingStock({ productId: '   ', quantity: 5 })).status).toBe(400);
    expect(
      (await openingStock({ productId: product.id, quantity: 5, productionDate: 'bukan-tanggal' })).status
    ).toBe(400);
    expect(
      (await openingStock({ productId: product.id, quantity: 5, productionDate: tomorrowCode() })).status
    ).toBe(400);
    expect((await openingStock({ productId: 'tidak-ada', quantity: 5 })).status).toBe(404);
    // Produk nonaktif tidak menerima stok awal baru (konsisten dengan aturan produksi).
    expect((await openingStock({ productId: inactive.id, quantity: 5 })).status).toBe(409);

    expect(await prisma.batch.count({ where: { productId: { in: [product.id, inactive.id] } } })).toBe(0);
    expect(
      await prisma.batchOpeningBalance.count({ where: { batch: { is: { productId: product.id } } } })
    ).toBe(0);
    const summary = await getProductSummary(product.id);
    expect(summary).toEqual({ stock: 0, batchCount: 0 });
  });

  it('Hanya Admin yang boleh mencatat stok awal (403/401); melihat butuh login', async () => {
    const product = await createProduct('open-otoritas');

    const byOperator = await openingStock({ productId: product.id, quantity: 5 }, operatorToken);
    expect(byOperator.status).toBe(403);

    const withoutToken = await request(app)
      .post('/api/batches/opening-stock')
      .send({ productId: product.id, quantity: 5 });
    expect(withoutToken.status).toBe(401);

    expect((await request(app).get('/api/batches')).status).toBe(401);
    expect((await request(app).get(`/api/batches/${'id-tidak-ada'}`).set(auth(operatorToken))).status).toBe(404);
    expect(
      (await request(app).get(`/api/batches?productId=${'produk-tidak-ada'}`).set(auth(operatorToken))).status
    ).toBe(404);

    expect(await prisma.batch.count({ where: { productId: product.id } })).toBe(0);
  });

  it('Idempotency-Key stok awal: permintaan ulang tidak menambah batch/stok dua kali', async () => {
    const product = await createProduct('open-idem');
    const key = `${runId}-open-idem`;
    const body = { productId: product.id, quantity: 9 };

    const first = await openingStock(body).set('Idempotency-Key', key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replay']).toBe('false');

    const second = await openingStock(body).set('Idempotency-Key', key);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body).toEqual(first.body);

    expect(await prisma.batch.count({ where: { productId: product.id } })).toBe(1);
    expect(await getProductSummary(product.id)).toEqual({ stock: 9, batchCount: 1 });
    await auditBatchStock([product.id]);
  });

  it('Permintaan stok awal BERSAMAAN: kode tetap unik dan kedua stok tercatat', async () => {
    const product = await createProduct('open-bersamaan');

    const [first, second] = await Promise.all([
      openingStock({ productId: product.id, quantity: 5 }),
      openingStock({ productId: product.id, quantity: 7 }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.batch.code).not.toBe(second.body.batch.code);

    const summary = await getProductSummary(product.id);
    expect(summary.stock).toBe(12);
    expect(summary.batchCount).toBe(2);

    const codes = await prisma.batch.findMany({
      where: { productId: product.id },
      select: { code: true },
    });
    expect(new Set(codes.map((c) => c.code)).size).toBe(codes.length);
    await auditBatchStock([product.id]);
  });
});

// ---------------------------------------------------------------------------
// Penyesuaian stok (README 5.4)
// ---------------------------------------------------------------------------

describe('Penyesuaian stok (hanya Admin)', () => {
  it('Bahan baku: positif menambah, negatif mengurangi; alasan, waktu, pengguna, pergerakan tercatat', async () => {
    const material = await createMaterial('sesuaian');
    await stockViaReceipt(material.id, 100);

    const up = await adjust({
      targetType: 'MATERIAL',
      targetId: material.id,
      quantity: 5.5,
      reason: 'Koreksi hasil stok opname: fisik lebih banyak',
    });
    expect(up.status).toBe(201);
    expect(up.body.adjustment.targetType).toBe('MATERIAL');
    expect(up.body.adjustment.targetId).toBe(material.id);
    expect(up.body.adjustment.target).toEqual({
      kind: 'material',
      id: material.id,
      name: `${runId}-bahan-sesuaian`,
      unit: 'kg',
    });
    expect(up.body.adjustment.quantity).toBe(5.5);
    expect(up.body.adjustment.reason).toBe('Koreksi hasil stok opname: fisik lebih banyak');
    expect(up.body.adjustment.adjustedBy.username).toBe(`${runId}-admin`);
    expect(typeof up.body.adjustment.adjustedAt).toBe('string');
    expect(up.body.stock).toBe(105.5);

    const down = await adjust({
      targetType: 'MATERIAL',
      targetId: material.id,
      quantity: -3.5,
      reason: 'Barang rusak saat pemindahan gudang',
    });
    expect(down.status).toBe(201);
    expect(down.body.adjustment.quantity).toBe(-3.5);
    expect(down.body.stock).toBe(102);
    expect(await getMaterialStockApi(material.id)).toBe(102);

    // Catatan sumber + pergerakan terkait (dua arah), riwayat tidak diubah.
    const adjustments = await prisma.stockAdjustment.findMany({ where: { materialId: material.id } });
    expect(adjustments).toHaveLength(2);
    expect(adjustments.every((a) => a.adjustedById === adminId)).toBe(true);
    expect(adjustments.every((a) => a.adjustedAt instanceof Date)).toBe(true);

    const movements = await prisma.materialStockMovement.findMany({
      where: { materialId: material.id, type: 'ADJUSTMENT' },
      orderBy: { recordedAt: 'asc' },
    });
    expect(movements).toHaveLength(2);
    expect(Number(movements[0].quantity)).toBe(5.5);
    expect(Number(movements[1].quantity)).toBe(-3.5);
    expect(movements[0].adjustmentId).toBe(adjustments.find((a) => Number(a.quantity) === 5.5)?.id);
    expect(movements[0].reason).toBe('Koreksi hasil stok opname: fisik lebih banyak');
    expect(movements[0].recordedById).toBe(adminId);

    // Riwayat penerimaan lama tidak berubah.
    const receipts = await prisma.materialStockMovement.findMany({ where: { materialId: material.id } });
    expect(receipts.filter((m) => m.type === 'RECEIPT')).toHaveLength(1);

    await auditMaterialStock([material.id]);
  });

  it('Retur: Admin menambah stok batch asal dengan alasan retur dan pemeriksaan barang', async () => {
    const product = await createProduct('retur');
    const bahan = await createMaterial('retur');
    await stockViaReceipt(bahan.id, 50);
    const created = await postProduction({
      productId: product.id,
      productionDate: pastCode(1),
      yieldQuantity: 10,
      materials: [{ materialId: bahan.id, quantity: 5 }],
    });
    expect(created.status).toBe(201);
    const batchId = created.body.production.batch.id;

    const res = await adjust({
      targetType: 'BATCH',
      targetId: batchId,
      quantity: 3,
      reason: 'Retur penjualan — barang diperiksa dan masih layak jual',
    });
    expect(res.status).toBe(201);
    expect(res.body.adjustment.target).toEqual({
      kind: 'batch',
      id: batchId,
      code: created.body.production.batch.code,
      productName: `${runId}-produk-retur`,
    });
    expect(res.body.adjustment.quantity).toBe(3);
    expect(res.body.adjustment.adjustedBy.username).toBe(`${runId}-admin`);
    expect(res.body.stock).toBe(13);

    const summary = await getProductSummary(product.id);
    expect(summary.stock).toBe(13);

    const movement = await prisma.batchStockMovement.findFirst({
      where: { batchId, type: 'ADJUSTMENT' },
    });
    expect(movement).toBeTruthy();
    expect(Number(movement!.quantity)).toBe(3);
    expect(movement!.reason).toBe('Retur penjualan — barang diperiksa dan masih layak jual');
    expect(movement!.recordedById).toBe(adminId);

    await auditBatchStock([product.id]);
    await auditProductTotals([product.id]);
  });

  it('Penyesuaian yang membuat stok bahan/batch negatif DITOLAK (409) tanpa perubahan apa pun', async () => {
    const material = await createMaterial('negatif');
    await stockViaReceipt(material.id, 10);
    const product = await createProduct('negatif');
    const opening = await openingStock({ productId: product.id, quantity: 8 });
    expect(opening.status).toBe(201);
    const batchId = opening.body.batch.id;

    const materialBefore = await getMaterialStockApi(material.id);
    const materialMovementsBefore = await prisma.materialStockMovement.count({
      where: { materialId: material.id },
    });
    const batchBefore = (await getProductSummary(product.id)).stock;
    const batchMovementsBefore = await prisma.batchStockMovement.count({ where: { batchId } });

    const overMaterial = await adjust({
      targetType: 'MATERIAL',
      targetId: material.id,
      quantity: -10.001,
      reason: 'Melebihi stok tersedia',
    });
    expect(overMaterial.status).toBe(409);
    expect(overMaterial.body.message).toContain('tidak mencukupi');

    const overBatch = await adjust({
      targetType: 'BATCH',
      targetId: batchId,
      quantity: -8.001,
      reason: 'Melebihi stok batch tersedia',
    });
    expect(overBatch.status).toBe(409);

    // Tidak ada catatan stok maupun pergerakan yang tersimpan dari penolakan.
    expect(await getMaterialStockApi(material.id)).toBe(materialBefore);
    expect(await prisma.materialStockMovement.count({ where: { materialId: material.id } })).toBe(
      materialMovementsBefore
    );
    expect((await getProductSummary(product.id)).stock).toBe(batchBefore);
    expect(await prisma.batchStockMovement.count({ where: { batchId } })).toBe(batchMovementsBefore);
    expect(
      await prisma.stockAdjustment.count({
        where: { OR: [{ materialId: material.id }, { batchId }] },
      })
    ).toBe(0);

    // Penyesuaian SAH berikutnya tetap diterima: stok persis 0 dibolehkan,
    // stok di bawah 0 tetap ditolak.
    const exactBatch = await adjust({
      targetType: 'BATCH',
      targetId: batchId,
      quantity: -8,
      reason: 'Menghabiskan stok batch sampai nol',
    });
    expect(exactBatch.status).toBe(201);
    expect(exactBatch.body.stock).toBe(0);

    const exactMaterial = await adjust({
      targetType: 'MATERIAL',
      targetId: material.id,
      quantity: -10,
      reason: 'Menghabiskan stok bahan sampai nol',
    });
    expect(exactMaterial.status).toBe(201);
    expect(exactMaterial.body.stock).toBe(0);

    const belowZero = await adjust({
      targetType: 'MATERIAL',
      targetId: material.id,
      quantity: -0.001,
      reason: 'Melewati nol',
    });
    expect(belowZero.status).toBe(409);
    expect(await getMaterialStockApi(material.id)).toBe(0);
    expect((await getProductSummary(product.id)).stock).toBe(0);

    await auditMaterialStock([material.id]);
    await auditBatchStock([product.id]);
  });

  it('Validasi penyesuaian ditolak (400/404) tanpa data tersimpan', async () => {
    const material = await createMaterial('sesuaian-validasi');
    await stockViaReceipt(material.id, 10);

    expect(
      (await adjust({ targetType: 'MATERIAL', targetId: material.id, quantity: 0, reason: 'nol' })).status
    ).toBe(400);
    expect(
      (await adjust({ targetType: 'MATERIAL', targetId: material.id, quantity: 1.2345, reason: 'desimal' }))
        .status
    ).toBe(400);
    expect(
      (await adjust({ targetType: 'MATERIAL', targetId: material.id, quantity: 'lima', reason: 'teks' }))
        .status
    ).toBe(400);
    expect((await adjust({ targetType: 'MATERIAL', targetId: material.id, quantity: 5 })).status).toBe(400);
    expect(
      (await adjust({ targetType: 'MATERIAL', targetId: material.id, quantity: 5, reason: '   ' })).status
    ).toBe(400);
    expect((await adjust({ targetType: 'SALAH', targetId: material.id, quantity: 5, reason: 'x' })).status).toBe(400);
    expect((await adjust({ targetType: 'MATERIAL', quantity: 5, reason: 'x' })).status).toBe(400);
    expect(
      (await adjust({ targetType: 'MATERIAL', targetId: 'tidak-ada', quantity: 5, reason: 'x' })).status
    ).toBe(404);
    expect(
      (await adjust({ targetType: 'BATCH', targetId: 'tidak-ada', quantity: 5, reason: 'x' })).status
    ).toBe(404);

    // Tidak ada penyesuaian maupun pergerakan yang tercatat.
    expect(
      await prisma.stockAdjustment.count({
        where: { OR: [{ materialId: material.id }, { batchId: 'tidak-ada' }] },
      })
    ).toBe(0);
    expect(await prisma.materialStockMovement.count({ where: { materialId: material.id } })).toBe(1);
    expect(await getMaterialStockApi(material.id)).toBe(10);
  });

  it('Hanya Admin yang boleh menyesuaikan stok (403/401)', async () => {
    const material = await createMaterial('sesuaian-otoritas');
    await stockViaReceipt(material.id, 10);
    const body = { targetType: 'MATERIAL', targetId: material.id, quantity: -2, reason: 'uji hak akses' };

    expect((await adjust(body, operatorToken)).status).toBe(403);
    expect((await request(app).post('/api/stock-adjustments').send(body)).status).toBe(401);

    expect(await getMaterialStockApi(material.id)).toBe(10);
    expect(await prisma.stockAdjustment.count({ where: { materialId: material.id } })).toBe(0);
  });

  it('Idempotency-Key penyesuaian: permintaan ulang tidak mengubah stok dua kali', async () => {
    const material = await createMaterial('sesuaian-idem');
    await stockViaReceipt(material.id, 20);
    const key = `${runId}-sesuaian-idem`;
    const body = { targetType: 'MATERIAL', targetId: material.id, quantity: -4, reason: 'uji idempotensi' };

    const first = await adjust(body).set('Idempotency-Key', key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replay']).toBe('false');

    const second = await adjust(body).set('Idempotency-Key', key);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body).toEqual(first.body);

    expect(await getMaterialStockApi(material.id)).toBe(16); // 20 - 4, bukan 20 - 8
    expect(await prisma.stockAdjustment.count({ where: { materialId: material.id } })).toBe(1);
    expect(
      await prisma.materialStockMovement.count({ where: { materialId: material.id, type: 'ADJUSTMENT' } })
    ).toBe(1);

    await auditMaterialStock([material.id]);
  });

  it('Penyesuaian tetap diizinkan pada master yang dinonaktifkan (koreksi data yang sudah ada)', async () => {
    const material = await createMaterial('sesuaian-nonaktif');
    await stockViaReceipt(material.id, 10);
    const deact = await request(app)
      .patch(`/api/materials/${material.id}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(deact.status).toBe(200);

    const res = await adjust({
      targetType: 'MATERIAL',
      targetId: material.id,
      quantity: -2,
      reason: 'Koreksi stok bahan yang sudah tidak aktif',
    });
    expect(res.status).toBe(201);
    expect(res.body.stock).toBe(8);

    await auditMaterialStock([material.id]);
  });
});

// ---------------------------------------------------------------------------
// Integritas, atomisitas, dan riwayat
// ---------------------------------------------------------------------------

describe('Integritas dan riwayat', () => {
  it('Tidak ada endpoint edit/hapus untuk batch, stok awal, atau penyesuaian', async () => {
    const product = await createProduct('kunci-rute');
    const opening = await openingStock({ productId: product.id, quantity: 6 });
    expect(opening.status).toBe(201);
    const batchId = opening.body.batch.id;
    const adjustment = await adjust({
      targetType: 'BATCH',
      targetId: batchId,
      quantity: -1,
      reason: 'Uji kunci rute',
    });
    expect(adjustment.status).toBe(201);
    const adjustmentId = adjustment.body.adjustment.id;

    expect((await request(app).delete(`/api/batches/${batchId}`).set(auth(adminToken))).status).toBe(404);
    expect(
      (await request(app).patch(`/api/batches/${batchId}`).set(auth(adminToken)).send({ code: 'NL-X' })).status
    ).toBe(404);
    expect((await request(app).delete('/api/batches').set(auth(adminToken))).status).toBe(404);
    expect((await request(app).delete(`/api/stock-adjustments/${adjustmentId}`).set(auth(adminToken))).status).toBe(404);
    expect(
      (await request(app)
        .patch(`/api/stock-adjustments/${adjustmentId}`)
        .set(auth(adminToken))
        .send({ reason: 'diubah' })).status
    ).toBe(404);
    expect((await request(app).delete('/api/stock-adjustments').set(auth(adminToken))).status).toBe(404);

    // Catatan asli tetap utuh.
    const detail = await request(app).get(`/api/batches/${batchId}`).set(auth(operatorToken));
    expect(detail.body.batch.stock).toBe(5);
    expect(detail.body.batch.movements).toHaveLength(2);
    const stored = await prisma.stockAdjustment.findUnique({ where: { id: adjustmentId } });
    expect(stored?.reason).toBe('Uji kunci rute');

    await auditBatchStock([product.id]);
  });

  it('Kegagalan di tengah transaksi tidak menyisakan penyesuaian atau stok setengah jadi (bahan)', async () => {
    const material = await createMaterial('atomik');
    await stockViaReceipt(material.id, 10);

    await expect(
      runIdempotent({ key: `${runId}-gagal-bahan`, endpoint: 'UJI-ATOMIK-B6-MATERIAL', userId: adminId }, async (tx) => {
        const adjustment = await tx.stockAdjustment.create({
          data: {
            targetType: 'MATERIAL',
            materialId: material.id,
            quantity: '-2.000',
            reason: 'uji atomik bahan',
            adjustedById: adminId,
          },
        });
        await tx.materialStockMovement.create({
          data: {
            materialId: material.id,
            type: 'ADJUSTMENT',
            quantity: '-2.000',
            occurredAt: new Date(),
            recordedById: adminId,
            reason: 'uji atomik bahan',
            adjustmentId: adjustment.id,
          },
        });
        await applyMaterialStockChange(tx, material.id, new Prisma.Decimal('-2'));
        throw new Error('gagal uji B6 bahan');
      })
    ).rejects.toThrow('gagal uji B6 bahan');

    expect(await prisma.stockAdjustment.count({ where: { materialId: material.id } })).toBe(0);
    expect(
      await prisma.materialStockMovement.count({ where: { materialId: material.id, type: 'ADJUSTMENT' } })
    ).toBe(0);
    expect(await getMaterialStockApi(material.id)).toBe(10);
    expect(
      await prisma.idempotencyKey.findUnique({
        where: {
          key_endpoint_userId: { key: `${runId}-gagal-bahan`, endpoint: 'UJI-ATOMIK-B6-MATERIAL', userId: adminId },
        },
      })
    ).toBeNull();
  });

  it('Kegagalan di tengah transaksi tidak menyisakan penyesuaian atau stok setengah jadi (batch)', async () => {
    const product = await createProduct('atomik-batch');
    const opening = await openingStock({ productId: product.id, quantity: 7 });
    expect(opening.status).toBe(201);
    const batchId = opening.body.batch.id;

    await expect(
      runIdempotent({ key: `${runId}-gagal-batch`, endpoint: 'UJI-ATOMIK-B6-BATCH', userId: adminId }, async (tx) => {
        const adjustment = await tx.stockAdjustment.create({
          data: {
            targetType: 'BATCH',
            batchId,
            quantity: '-3.000',
            reason: 'uji atomik batch',
            adjustedById: adminId,
          },
        });
        await tx.batchStockMovement.create({
          data: {
            batchId,
            type: 'ADJUSTMENT',
            quantity: '-3.000',
            occurredAt: new Date(),
            recordedById: adminId,
            reason: 'uji atomik batch',
            adjustmentId: adjustment.id,
          },
        });
        await applyBatchStockChange(tx, batchId, new Prisma.Decimal('-3'));
        throw new Error('gagal uji B6 batch');
      })
    ).rejects.toThrow('gagal uji B6 batch');

    expect(await prisma.stockAdjustment.count({ where: { batchId } })).toBe(0);
    expect(await prisma.batchStockMovement.count({ where: { batchId, type: 'ADJUSTMENT' } })).toBe(0);
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(Number(batch.stockQuantity)).toBe(7);
    await auditBatchStock([product.id]);
  });

  it('Bahan yang HANYA punya riwayat penyesuaian tidak dapat dihapus/diubah satuan (409)', async () => {
    // Tidak ada penerimaan/saldo awal — satu-satunya riwayat adalah penyesuaian.
    const material = await createMaterial('riwayat-sesuaian');
    const res = await adjust({
      targetType: 'MATERIAL',
      targetId: material.id,
      quantity: 5,
      reason: 'Pencetus riwayat operasional',
    });
    expect(res.status).toBe(201);
    expect(res.body.stock).toBe(5);

    expect((await request(app).delete(`/api/materials/${material.id}`).set(auth(adminToken))).status).toBe(409);
    expect(
      (await request(app).patch(`/api/materials/${material.id}`).set(auth(adminToken)).send({ unit: 'liter' })).status
    ).toBe(409);

    // Penonaktifan tetap boleh dan riwayat tetap utuh.
    const deact = await request(app)
      .patch(`/api/materials/${material.id}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(deact.status).toBe(200);
    expect(await getMaterialStockApi(material.id)).toBe(5);
  });

  it('Produk dengan batch stok awal tidak dapat dihapus/diubah satuan (409), hanya dinonaktifkan', async () => {
    const product = await createProduct('riwayat-open');
    const opening = await openingStock({ productId: product.id, quantity: 4 });
    expect(opening.status).toBe(201);

    expect((await request(app).delete(`/api/products/${product.id}`).set(auth(adminToken))).status).toBe(409);
    expect(
      (await request(app).patch(`/api/products/${product.id}`).set(auth(adminToken)).send({ unit: 'box' })).status
    ).toBe(409);

    const deact = await request(app)
      .patch(`/api/products/${product.id}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(deact.status).toBe(200);
    expect((await getProductSummary(product.id)).stock).toBe(4);
  });

  it('Audit konsistensi akhir: seluruh data uji memenuhi stok = jumlah pergerakan dan total = jumlah batch', async () => {
    const productIds = await allRunProductIds();
    const materialIds = await allRunMaterialIds();
    expect(productIds.length).toBeGreaterThan(0);
    expect(materialIds.length).toBeGreaterThan(0);

    await auditBatchStock(productIds);
    await auditMaterialStock(materialIds);
    await auditProductTotals(productIds);
  });
});

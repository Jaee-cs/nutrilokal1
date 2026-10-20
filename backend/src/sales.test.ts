/**
 * Pengujian integrasi B7: penjualan, alokasi batch per item, perhitungan
 * total di backend, penolakan transaksi parsial/kedaluwarsa, pembatalan
 * oleh Admin, pengembalian stok ke batch asal, idempotensi, dan
 * konkurensi. Berjalan terhadap database PostgreSQL lokal (docker compose).
 *
 * Konvensi ledger batch yang diuji (sama dengan B6): SEMUA quantity
 * BatchStockMovement bernilai tanda — penjualan (SALE) negatif,
 * pengembalian saat pembatalan (SALE_CANCELLATION) positif.
 */
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { parseBusinessDate } from './lib/date';
import { runIdempotent } from './lib/idempotency';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';
import { applyBatchStockChange } from './lib/stock';

const app = createApp();

const runId = `b7-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let adminToken = '';
let operatorToken = '';
let adminId = '';
let operatorId = '';

/** Semua id transaksi yang berhasil dibuat selama pengujian (untuk omzet). */
const createdSaleIds: string[] = [];

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
const pastCode = (days: number) => dateCode(-days);
const tomorrowCode = () => dateCode(1);

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

/** Membuat batch lewat stok awal produk jadi (Admin, README 5.3). */
async function createBatch(productId: string, quantity: number) {
  const res = await request(app)
    .post('/api/batches/opening-stock')
    .set(auth(adminToken))
    .send({ productId, quantity });
  expect(res.status).toBe(201);
  return res.body.batch as { id: string; code: string; stock: number };
}

function createSale(body: Record<string, unknown>, token = operatorToken, idempotencyKey?: string) {
  const req = request(app).post('/api/sales').set(auth(token));
  if (idempotencyKey) {
    req.set('Idempotency-Key', idempotencyKey);
  }
  const sent = req.send(body);
  return sent.then((res) => {
    if (res.status === 201 && res.body?.transaction?.id) {
      createdSaleIds.push(res.body.transaction.id);
    }
    return res;
  });
}

function cancelSale(id: string, body: Record<string, unknown>, token = adminToken, idempotencyKey?: string) {
  const req = request(app).post(`/api/sales/${id}/cancel`).set(auth(token));
  if (idempotencyKey) {
    req.set('Idempotency-Key', idempotencyKey);
  }
  return req.send(body);
}

function setExpiry(batchId: string, expiryDate: string | null, token = adminToken) {
  return request(app).patch(`/api/batches/${batchId}/expiry`).set(auth(token)).send({ expiryDate });
}

async function getBatch(batchId: string) {
  const res = await request(app).get(`/api/batches/${batchId}`).set(auth(operatorToken));
  expect(res.status).toBe(200);
  return res.body.batch;
}

async function batchStock(batchId: string): Promise<number> {
  return (await getBatch(batchId)).stock;
}

async function getProductSummary(productId: string): Promise<{ stock: number; batchCount: number }> {
  const res = await request(app).get(`/api/products/${productId}`).set(auth(operatorToken));
  expect(res.status).toBe(200);
  return { stock: res.body.product.stock, batchCount: res.body.product.batchCount };
}

/** Badan permintaan penjualan: satu item per produk. */
function saleBody(entries: {
  productId: string;
  allocations: { batchId: string; quantity: number }[];
}[]) {
  return { items: entries };
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

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

// Id produk & batch dipakai lintas blok pengujian (pengujian berurutan).
let prodA = '';
let prodB = '';
let prodC = '';
let prodPrice = '';
let prodExp = '';
let prodInactive = '';
let prodFail = '';
let batchA1 = '';
let batchA2 = '';
let batchB1 = '';
let batchC1 = '';
let batchC2 = '';
let batchP1 = '';
let batchE1 = '';
let batchI1 = '';
let batchF1 = '';

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
  const operator = await prisma.user.findUniqueOrThrow({ where: { username: `${runId}-operator` } });
  operatorId = operator.id;

  adminToken = (await login(`${runId}-admin`, 'admin-rahasia-123')).body.token;
  operatorToken = (await login(`${runId}-operator`, 'operator-rahasia-123')).body.token;
  expect(adminToken).toBeTruthy();
  expect(operatorToken).toBeTruthy();

  prodA = (await createProduct('a', { sellingPrice: 15000 })).id;
  prodB = (await createProduct('b', { sellingPrice: 10000 })).id;
  prodC = (await createProduct('c', { sellingPrice: 5000 })).id;
  prodPrice = (await createProduct('harga', { sellingPrice: 3000 })).id;
  prodExp = (await createProduct('kedaluwarsa', { sellingPrice: 8000 })).id;
  prodInactive = (await createProduct('nonaktif', { sellingPrice: 7000 })).id;
  prodFail = (await createProduct('gagal', { sellingPrice: 12000 })).id;

  batchA1 = (await createBatch(prodA, 10)).id;
  batchA2 = (await createBatch(prodA, 4)).id;
  batchB1 = (await createBatch(prodB, 6)).id;
  batchC1 = (await createBatch(prodC, 5)).id;
  batchC2 = (await createBatch(prodC, 5)).id;
  batchP1 = (await createBatch(prodPrice, 5)).id;
  batchE1 = (await createBatch(prodExp, 7)).id;
  batchI1 = (await createBatch(prodInactive, 5)).id;
  batchF1 = (await createBatch(prodFail, 10)).id;
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
  const sales = await prisma.saleTransaction.findMany({
    where: { recordedBy: { username: { startsWith: runId } } },
    select: { id: true },
  });
  const saleIds = sales.map((s) => s.id);

  // Hapus berdasarkan relasi (tanpa ON DELETE CASCADE di skema).
  await prisma.batchStockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.stockAdjustment.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.saleAllocation.deleteMany({ where: { item: { transactionId: { in: saleIds } } } });
  await prisma.saleItem.deleteMany({ where: { transactionId: { in: saleIds } } });
  await prisma.saleTransaction.deleteMany({ where: { id: { in: saleIds } } });
  await prisma.batchOpeningBalance.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.idempotencyKey.deleteMany({ where: { endpoint: { startsWith: 'POST /api/sales' } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

// ---------------------------------------------------------------------------
// Pencatatan penjualan
// ---------------------------------------------------------------------------

describe('pencatatan penjualan', () => {
  it('menyimpan transaksi satu produk: harga dari master, stok batch berkurang, pergerakan tercatat', async () => {
    const res = await createSale(
      saleBody([{ productId: prodA, allocations: [{ batchId: batchA1, quantity: 2 }] }])
    );

    expect(res.status).toBe(201);
    const transaction = res.body.transaction;
    expect(transaction.status).toBe('COMPLETED');
    expect(transaction.total).toBe(30000); // 2 × 15000, dihitung backend
    expect(transaction.cancelledAt).toBeNull();
    expect(transaction.recordedBy.id).toBe(operatorId);
    expect(transaction.items).toHaveLength(1);
    expect(transaction.items[0].unitPrice).toBe(15000);
    expect(transaction.items[0].lineTotal).toBe(30000);
    expect(transaction.items[0].allocations).toHaveLength(1);
    expect(transaction.items[0].allocations[0].batchCode).toBeTruthy();
    expect(transaction.items[0].allocations[0].quantity).toBe(2);

    // Stok batch berkurang sesuai alokasi (10 → 8).
    expect(await batchStock(batchA1)).toBe(8);

    // Pergerakan SALE tercatat, bernilai negatif, terkait catatan sumber
    // (alokasi) dan mencatat pencatat transaksi.
    const batchDetail = await getBatch(batchA1);
    const saleMovement = batchDetail.movements.find((m: { type: string }) => m.type === 'SALE');
    expect(saleMovement).toBeTruthy();
    expect(saleMovement.quantity).toBe(-2);

    const allocationRow = await prisma.saleAllocation.findFirst({
      where: { batchId: batchA1 },
      include: { movements: true },
    });
    expect(allocationRow).toBeTruthy();
    expect(allocationRow!.movements.map((m) => m.type)).toContain('SALE');
    const movement = await prisma.batchStockMovement.findFirst({
      where: { saleAllocationId: allocationRow!.id, type: 'SALE' },
    });
    expect(movement).toBeTruthy();
    expect(movement!.recordedById).toBe(operatorId);
    expect(movement!.reason).toBe('Penjualan');
    expect(Number(movement!.quantity)).toBe(-2);
  });

  it('menyimpan transaksi beberapa jenis produk dalam satu transaksi', async () => {
    const res = await createSale(
      saleBody([
        { productId: prodA, allocations: [{ batchId: batchA1, quantity: 1 }] },
        { productId: prodB, allocations: [{ batchId: batchB1, quantity: 1 }] },
      ])
    );

    expect(res.status).toBe(201);
    expect(res.body.transaction.items).toHaveLength(2);
    // Total = 1×15000 + 1×10000 (dihitung backend).
    expect(res.body.transaction.total).toBe(25000);
    // Stok kedua batch berkurang (8 → 7 dan 6 → 5).
    expect(await batchStock(batchA1)).toBe(7);
    expect(await batchStock(batchB1)).toBe(5);
  });

  it('mendukung satu item yang dialokasikan ke beberapa batch', async () => {
    const res = await createSale(
      saleBody([
        {
          productId: prodC,
          allocations: [
            { batchId: batchC1, quantity: 2 },
            { batchId: batchC2, quantity: 3 },
          ],
        },
      ])
    );

    expect(res.status).toBe(201);
    const item = res.body.transaction.items[0];
    // Jumlah item = jumlah seluruh alokasinya (2 + 3 = 5).
    expect(item.quantity).toBe(5);
    expect(item.allocations).toHaveLength(2);
    expect(res.body.transaction.total).toBe(25000); // 5 × 5000
    // Stok tiap batch berkurang sesuai alokasinya (5 → 3 dan 5 → 2).
    expect(await batchStock(batchC1)).toBe(3);
    expect(await batchStock(batchC2)).toBe(2);
  });

  it('mengabaikan total/unitPrice kiriman klien — total selalu dihitung backend', async () => {
    const res = await createSale({
      total: 999,
      items: [
        {
          productId: prodB,
          unitPrice: 1,
          quantity: 999,
          allocations: [{ batchId: batchB1, quantity: 2 }],
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.transaction.total).toBe(20000); // 2 × 10000 (harga master)
    expect(res.body.transaction.items[0].unitPrice).toBe(10000);
    expect(res.body.transaction.items[0].quantity).toBe(2);
    // Stok berkurang 5 → 3.
    expect(await batchStock(batchB1)).toBe(3);
  });

  it('harga satuan transaksi tetap setelah harga master produk berubah', async () => {
    const first = await createSale(
      saleBody([{ productId: prodPrice, allocations: [{ batchId: batchP1, quantity: 1 }] }])
    );
    expect(first.status).toBe(201);
    expect(first.body.transaction.total).toBe(3000);
    const firstId = first.body.transaction.id;

    const patched = await request(app)
      .patch(`/api/products/${prodPrice}`)
      .set(auth(adminToken))
      .send({ sellingPrice: 4000 });
    expect(patched.status).toBe(200);

    // Transaksi lama tidak berubah: harga & total tetap pada saat transaksi.
    const detail = await request(app)
      .get(`/api/sales/${firstId}`)
      .set(auth(operatorToken));
    expect(detail.status).toBe(200);
    expect(detail.body.transaction.items[0].unitPrice).toBe(3000);
    expect(detail.body.transaction.total).toBe(3000);
    expect(detail.body.transaction.items[0].lineTotal).toBe(3000);

    // Transaksi baru memakai harga master terbaru.
    const second = await createSale(
      saleBody([{ productId: prodPrice, allocations: [{ batchId: batchP1, quantity: 1 }] }])
    );
    expect(second.status).toBe(201);
    expect(second.body.transaction.items[0].unitPrice).toBe(4000);
    expect(second.body.transaction.total).toBe(4000);
    // Stok p1: 5 → 4 → 3.
    expect(await batchStock(batchP1)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Penolakan transaksi
// ---------------------------------------------------------------------------

describe('penolakan transaksi', () => {
  it('menolak SELURUH transaksi saat stok satu batch tidak mencukupi — tanpa perubahan parsial', async () => {
    const txBefore = await prisma.saleTransaction.count();
    const a1MovementsBefore = await prisma.batchStockMovement.count({ where: { batchId: batchA1 } });
    const b1AllocationsBefore = await prisma.saleAllocation.count({ where: { batchId: batchB1 } });
    const stockA1 = await batchStock(batchA1); // 7
    const stockB1 = await batchStock(batchB1); // 3

    // Item pertama cukup stok, item kedua tidak — semuanya harus ditolak.
    const res = await createSale(
      saleBody([
        { productId: prodA, allocations: [{ batchId: batchA1, quantity: 2 }] },
        { productId: prodB, allocations: [{ batchId: batchB1, quantity: 10 }] },
      ])
    );

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('Penjualan ditolak');
    expect(res.body.message).toContain('tidak mencukupi');
    // Tidak ada transaksi tersimpan.
    expect(await prisma.saleTransaction.count()).toBe(txBefore);
    // Stok TIDAK berubah sama sekali (termasuk item yang cukup).
    expect(await batchStock(batchA1)).toBe(stockA1);
    expect(await batchStock(batchB1)).toBe(stockB1);
    // Tidak ada pergerakan atau alokasi baru.
    expect(await prisma.batchStockMovement.count({ where: { batchId: batchA1 } })).toBe(
      a1MovementsBefore
    );
    expect(await prisma.saleAllocation.count({ where: { batchId: batchB1 } })).toBe(
      b1AllocationsBefore
    );
  });

  it('menolak satu item dengan alokasi batch yang stoknya tidak mencukupi', async () => {
    const stockB1 = await batchStock(batchB1); // 3
    const res = await createSale(
      saleBody([{ productId: prodB, allocations: [{ batchId: batchB1, quantity: 5 }] }])
    );

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('tidak mencukupi');
    expect(await batchStock(batchB1)).toBe(stockB1);
  });

  it('menolak input yang tidak valid (400) tanpa mengubah stok', async () => {
    const stockA1 = await batchStock(batchA1);

    const cases: Record<string, unknown>[] = [
      {}, // items hilang
      { items: [] }, // kosong
      { items: [{}] }, // tanpa productId
      { items: [{ productId: prodA, allocations: [] }] }, // tanpa alokasi
      {
        items: [
          { productId: prodA, allocations: [{ batchId: batchA1, quantity: 1 }] },
          { productId: prodA, allocations: [{ batchId: batchA2, quantity: 1 }] },
        ],
      }, // produk duplikat
      {
        items: [
          {
            productId: prodA,
            allocations: [
              { batchId: batchA1, quantity: 1 },
              { batchId: batchA1, quantity: 1 },
            ],
          },
        ],
      }, // batch duplikat pada satu item
      { items: [{ productId: prodA, allocations: [{ batchId: batchA1, quantity: 0 }] }] },
      { items: [{ productId: prodA, allocations: [{ batchId: batchA1, quantity: 1.2345 }] }] },
      { items: [{ productId: prodA, allocations: [{ batchId: batchA1, quantity: 'abc' }] }] },
    ];

    for (const body of cases) {
      const res = await createSale(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }

    expect(await batchStock(batchA1)).toBe(stockA1);
  });

  it('menolak produk tidak ditemukan (404) dan produk nonaktif (409)', async () => {
    const notFound = await createSale(
      saleBody([
        { productId: 'produk-tidak-ada', allocations: [{ batchId: batchA1, quantity: 1 }] },
      ])
    );
    expect(notFound.status).toBe(404);

    const deactivated = await request(app)
      .patch(`/api/products/${prodInactive}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);

    const inactiveSale = await createSale(
      saleBody([{ productId: prodInactive, allocations: [{ batchId: batchI1, quantity: 1 }] }])
    );
    expect(inactiveSale.status).toBe(409);
    expect(inactiveSale.body.message).toContain('tidak aktif');
    // Stok batch produk nonaktif tidak berubah.
    expect(await batchStock(batchI1)).toBe(5);
  });

  it('menolak batch tidak ditemukan (404) dan batch milik produk lain (400)', async () => {
    const notFound = await createSale(
      saleBody([{ productId: prodA, allocations: [{ batchId: 'batch-tidak-ada', quantity: 1 }] }])
    );
    expect(notFound.status).toBe(404);

    // batchC1 milik produk C, bukan produk A.
    const mismatch = await createSale(
      saleBody([{ productId: prodA, allocations: [{ batchId: batchC1, quantity: 1 }] }])
    );
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.message).toContain('bukan milik produk');
    expect(await batchStock(batchC1)).toBe(3);
  });

  it('menolak Idempotency-Key yang tidak valid (400)', async () => {
    const res = await createSale(
      saleBody([{ productId: prodA, allocations: [{ batchId: batchA1, quantity: 1 }] }]),
      operatorToken,
      'x'.repeat(101)
    );
    expect(res.status).toBe(400);
  });

  it('menolak akses tanpa autentikasi (401)', async () => {
    const list = await request(app).get('/api/sales');
    expect(list.status).toBe(401);

    const create = await request(app)
      .post('/api/sales')
      .send(saleBody([{ productId: prodA, allocations: [{ batchId: batchA1, quantity: 1 }] }]));
    expect(create.status).toBe(401);

    const cancel = await request(app).post('/api/sales/some-id/cancel').send({ reason: 'x' });
    expect(cancel.status).toBe(401);

    const badToken = await request(app)
      .get('/api/sales')
      .set({ Authorization: 'Bearer token-tidak-valid' });
    expect(badToken.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tanggal kedaluwarsa batch
// ---------------------------------------------------------------------------

describe('tanggal kedaluwarsa batch', () => {
  it('Admin mencatat, memvalidasi, dan mengosongkan tanggal kedaluwarsa batch', async () => {
    const forbidden = await setExpiry(batchE1, tomorrowCode(), operatorToken);
    expect(forbidden.status).toBe(403);

    const missingBatch = await setExpiry('batch-tidak-ada', tomorrowCode());
    expect(missingBatch.status).toBe(404);

    const withoutField = await request(app)
      .patch(`/api/batches/${batchE1}/expiry`)
      .set(auth(adminToken))
      .send({});
    expect(withoutField.status).toBe(400);

    const wrongType = await setExpiry(batchE1, false as unknown as string);
    expect(wrongType.status).toBe(400);

    const wrongFormat = await setExpiry(batchE1, 'bukan-tanggal');
    expect(wrongFormat.status).toBe(400);

    const saved = await setExpiry(batchE1, tomorrowCode());
    expect(saved.status).toBe(200);
    expect(typeof saved.body.batch.expiryDate).toBe('string');
    expect(saved.body.batch.expiryValidated).toBe(true);

    const detail = await getBatch(batchE1);
    expect(typeof detail.expiryDate).toBe('string');
    expect(detail.expiryValidated).toBe(true);

    const cleared = await setExpiry(batchE1, null);
    expect(cleared.status).toBe(200);
    expect(cleared.body.batch.expiryDate).toBeNull();
    expect(cleared.body.batch.expiryValidated).toBe(false);
  });

  it('menolak penjualan dari batch yang sudah kedaluwarsa dan tervalidasi', async () => {
    const saved = await setExpiry(batchE1, pastCode(3));
    expect(saved.status).toBe(200);

    const txBefore = await prisma.saleTransaction.count();
    const stockBefore = await batchStock(batchE1); // 7

    const res = await createSale(
      saleBody([{ productId: prodExp, allocations: [{ batchId: batchE1, quantity: 1 }] }])
    );

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('kedaluwarsa');
    expect(await prisma.saleTransaction.count()).toBe(txBefore);
    expect(await batchStock(batchE1)).toBe(stockBefore);
    expect(await prisma.saleAllocation.count({ where: { batchId: batchE1 } })).toBe(0);
  });

  it('mengizinkan penjualan batch dengan tanggal kedaluwarsa masa depan', async () => {
    const saved = await setExpiry(batchE1, tomorrowCode());
    expect(saved.status).toBe(200);

    const res = await createSale(
      saleBody([{ productId: prodExp, allocations: [{ batchId: batchE1, quantity: 2 }] }])
    );
    expect(res.status).toBe(201);
    expect(await batchStock(batchE1)).toBe(5); // 7 → 2
  });

  it('mengizinkan penjualan batch tanpa tanggal kedaluwarsa', async () => {
    // batchA2 belum pernah dicatat kedaluwarsanya.
    const detail = await getBatch(batchA2);
    expect(detail.expiryDate).toBeNull();
    expect(detail.expiryValidated).toBe(false);

    const res = await createSale(
      saleBody([{ productId: prodA, allocations: [{ batchId: batchA2, quantity: 1 }] }])
    );
    expect(res.status).toBe(201);
    expect(await batchStock(batchA2)).toBe(3); // 4 → 3
  });

  it('mengizinkan penjualan batch yang tanggalnya tercatat tetapi BELUM divalidasi', async () => {
    // README 5.6: tanggal boleh tersedia tetapi belum divalidasi — saat itu
    // belum ditolak (status ini diset langsung di DB karena endpoint Admin
    // selalu menandai tanggalnya tervalidasi).
    await prisma.batch.update({
      where: { id: batchA2 },
      data: { expiryDate: parseBusinessDate(pastCode(2)), expiryValidatedAt: null },
    });

    const res = await createSale(
      saleBody([{ productId: prodA, allocations: [{ batchId: batchA2, quantity: 1 }] }])
    );
    expect(res.status).toBe(201);

    await prisma.batch.update({
      where: { id: batchA2 },
      data: { expiryDate: null, expiryValidatedAt: null },
    });
    expect(await batchStock(batchA2)).toBe(2); // 3 → 2
  });
});

// ---------------------------------------------------------------------------
// Pembatalan transaksi
// ---------------------------------------------------------------------------

describe('pembatalan transaksi', () => {
  let cancelledSaleId = '';

  it('Admin membatalkan transaksi dengan alasan — stok kembali ke batch asal', async () => {
    const sale = await createSale(
      saleBody([
        {
          productId: prodC,
          allocations: [
            { batchId: batchC1, quantity: 1 },
            { batchId: batchC2, quantity: 1 },
          ],
        },
      ])
    );
    expect(sale.status).toBe(201);
    cancelledSaleId = sale.body.transaction.id;
    expect(await batchStock(batchC1)).toBe(2); // 3 → 2
    expect(await batchStock(batchC2)).toBe(1); // 2 → 1

    const res = await cancelSale(cancelledSaleId, { reason: 'Barang rusak di perjalanan' });
    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe('CANCELLED');
    expect(res.body.transaction.cancelReason).toBe('Barang rusak di perjalanan');
    expect(res.body.transaction.cancelledBy.id).toBe(adminId);
    expect(res.body.transaction.cancelledAt).toBeTruthy();

    // Stok dikembalikan persis ke batch asal sesuai alokasi.
    expect(await batchStock(batchC1)).toBe(3);
    expect(await batchStock(batchC2)).toBe(2);

    // Riwayat transaksi, item, dan alokasi TETAP tersimpan: satu item
    // (produk C) dengan dua alokasi batch.
    expect(
      await prisma.saleItem.count({ where: { transactionId: cancelledSaleId } })
    ).toBe(1);
    const allocations = await prisma.saleAllocation.findMany({
      where: { item: { transactionId: cancelledSaleId } },
      include: { movements: true },
    });
    expect(allocations).toHaveLength(2);

    // Setiap alokasi punya jejak SALE (negatif) dan SALE_CANCELLATION
    // (positif) yang terkait catatan sumbernya, dengan alasan pembatalan.
    for (const allocation of allocations) {
      const types = allocation.movements.map((m) => m.type).sort();
      expect(types).toEqual(['SALE', 'SALE_CANCELLATION']);
      const saleMovement = allocation.movements.find((m) => m.type === 'SALE')!;
      const cancelMovement = allocation.movements.find((m) => m.type === 'SALE_CANCELLATION')!;
      expect(Number(saleMovement.quantity)).toBeLessThan(0);
      expect(Number(cancelMovement.quantity)).toBeGreaterThan(0);
      expect(cancelMovement.reason).toBe('Barang rusak di perjalanan');
      expect(cancelMovement.recordedById).toBe(adminId);
    }
  });

  it('menolak pembatalan tanpa alasan, oleh Operator, tanpa login, dan transaksi tidak ada', async () => {
    const noReason = await cancelSale(cancelledSaleId, {});
    expect(noReason.status).toBe(400);
    expect(noReason.body.message).toContain('Alasan');

    const byOperator = await cancelSale(cancelledSaleId, { reason: 'x' }, operatorToken);
    expect(byOperator.status).toBe(403);

    const noToken = await request(app)
      .post(`/api/sales/${cancelledSaleId}/cancel`)
      .send({ reason: 'x' });
    expect(noToken.status).toBe(401);

    const missing = await cancelSale('transaksi-tidak-ada', { reason: 'x' });
    expect(missing.status).toBe(404);
  });

  it('pembatalan berulang tidak mengembalikan stok lebih dari satu kali', async () => {
    const stockC1 = await batchStock(batchC1);
    const stockC2 = await batchStock(batchC2);
    const cancelMovements = await prisma.batchStockMovement.count({
      where: { type: 'SALE_CANCELLATION', saleAllocationId: { not: null } },
    });

    const repeat = await cancelSale(cancelledSaleId, { reason: 'Pembatalan ulang' });
    expect(repeat.status).toBe(409);
    expect(repeat.body.message).toContain('sudah dibatalkan');

    // Stok dan jumlah pergerakan pengembalian tidak bertambah.
    expect(await batchStock(batchC1)).toBe(stockC1);
    expect(await batchStock(batchC2)).toBe(stockC2);
    expect(
      await prisma.batchStockMovement.count({
        where: { type: 'SALE_CANCELLATION', saleAllocationId: { not: null } },
      })
    ).toBe(cancelMovements);
  });

  it('pembatalan dengan Idempotency-Key: permintaan ulang hanya memainkan respons tersimpan', async () => {
    const sale = await createSale(
      saleBody([{ productId: prodA, allocations: [{ batchId: batchA1, quantity: 1 }] }])
    );
    expect(sale.status).toBe(201);
    const saleId = sale.body.transaction.id;
    expect(await batchStock(batchA1)).toBe(6); // 7 → 6

    const first = await cancelSale(saleId, { reason: 'Uji idempotensi' }, adminToken, 'b7-cancel-1');
    expect(first.status).toBe(200);
    expect(first.headers['idempotent-replay']).toBe('false');
    expect(await batchStock(batchA1)).toBe(7); // stok kembali

    const second = await cancelSale(saleId, { reason: 'Uji idempotensi' }, adminToken, 'b7-cancel-1');
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body.transaction.status).toBe('CANCELLED');
    // Stok TIDAK digandakan.
    expect(await batchStock(batchA1)).toBe(7);

    // Tanpa kunci: ditolak dengan jelas, stok tetap.
    const third = await cancelSale(saleId, { reason: 'Uji idempotensi' });
    expect(third.status).toBe(409);
    expect(await batchStock(batchA1)).toBe(7);
  });

  it('penjualan yang benar setelah pembatalan dicatat sebagai transaksi baru', async () => {
    const res = await createSale(
      saleBody([{ productId: prodA, allocations: [{ batchId: batchA1, quantity: 1 }] }])
    );
    expect(res.status).toBe(201);
    expect(res.body.transaction.id).not.toBe(cancelledSaleId);
    expect(res.body.transaction.status).toBe('COMPLETED');
    expect(await batchStock(batchA1)).toBe(6); // 7 → 6

    // Transaksi lama tetap CANCELLED (tidak diedit).
    const old = await request(app).get(`/api/sales/${cancelledSaleId}`).set(auth(operatorToken));
    expect(old.status).toBe(200);
    expect(old.body.transaction.status).toBe('CANCELLED');
    expect(old.body.transaction.cancelReason).toBe('Barang rusak di perjalanan');
  });

  it('transaksi batal tidak masuk perhitungan omzet', async () => {
    const rows = await prisma.saleTransaction.findMany({
      where: { id: { in: createdSaleIds } },
      select: { id: true, total: true, cancelledAt: true },
    });
    expect(rows.length).toBeGreaterThan(0);

    const cancelled = rows.filter((row) => row.cancelledAt !== null);
    const active = rows.filter((row) => row.cancelledAt === null);
    expect(cancelled.length).toBeGreaterThan(0);
    expect(active.length).toBeGreaterThan(0);

    // Kondisi data yang akan dipakai omzet (README 5.5; endpoint laporan
    // pada B9): hanya transaksi yang tidak dibatalkan yang dijumlahkan.
    const activeRows = rows.filter((row) => row.cancelledAt === null);
    const activeSum = active.reduce((sum, row) => sum + Number(row.total), 0);
    const allSum = rows.reduce((sum, row) => sum + Number(row.total), 0);
    const cancelledSum = cancelled.reduce((sum, row) => sum + Number(row.total), 0);

    expect(activeRows).toHaveLength(active.length);
    expect(activeSum + cancelledSum).toBeCloseTo(allSum, 2);
    expect(allSum).toBeGreaterThan(activeSum); // transaksi batal tidak ikut
    // Tidak ada transaksi batal yang masuk hitungan aktif.
    const cancelledIds = new Set(cancelled.map((row) => row.id));
    expect(active.some((row) => cancelledIds.has(row.id))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Idempotensi dan konkurensi
// ---------------------------------------------------------------------------

describe('idempotensi dan konkurensi', () => {
  it('permintaan ulang dengan Idempotency-Key tidak menggandakan penjualan', async () => {
    const body = saleBody([{ productId: prodA, allocations: [{ batchId: batchA1, quantity: 1 }] }]);
    const stockBefore = await batchStock(batchA1); // 6
    const countBefore = await prisma.saleTransaction.count();

    const first = await createSale(body, operatorToken, 'b7-sale-1');
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replay']).toBe('false');

    const second = await createSale(body, operatorToken, 'b7-sale-1');
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body.transaction.id).toBe(first.body.transaction.id);

    // Stok berkurang tepat satu kali; hanya satu transaksi tersimpan.
    expect(await batchStock(batchA1)).toBe(stockBefore - 1);
    expect(await prisma.saleTransaction.count()).toBe(countBefore + 1);
  });

  it('permintaan BERSAMAAN dengan kunci sama hanya mencatat satu transaksi', async () => {
    const body = saleBody([{ productId: prodA, allocations: [{ batchId: batchA1, quantity: 1 }] }]);
    const stockBefore = await batchStock(batchA1); // 5

    const [r1, r2] = await Promise.all([
      createSale(body, operatorToken, 'b7-sale-concurrent-same'),
      createSale(body, operatorToken, 'b7-sale-concurrent-same'),
    ]);

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.transaction.id).toBe(r2.body.transaction.id);
    // Tepat satu respons asli, satu lainnya adalah pemulihan respons tersimpan.
    const replays = [r1.headers['idempotent-replay'], r2.headers['idempotent-replay']];
    expect(replays.filter((value) => value === 'false')).toHaveLength(1);
    // Stok berkurang tepat satu kali.
    expect(await batchStock(batchA1)).toBe(stockBefore - 1);
    expect(
      await prisma.saleTransaction.count({ where: { id: r1.body.transaction.id } })
    ).toBe(1);
  });

  it('permintaan penjualan BERSAMAAN tidak menyebabkan overselling atau stok negatif', async () => {
    const stockBefore = await batchStock(batchA1); // 4 — dua penjualan berebut stok
    expect(stockBefore).toBeLessThan(6);

    const body = saleBody([{ productId: prodA, allocations: [{ batchId: batchA1, quantity: 3 }] }]);
    const [r1, r2] = await Promise.all([
      createSale(body, operatorToken, 'b7-sale-concurrent-a'),
      createSale(body, operatorToken, 'b7-sale-concurrent-b'),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.message).toContain('Penjualan ditolak');

    // Stok berkurang hanya sekali dan TIDAK PERNAH negatif.
    const stockAfter = await batchStock(batchA1);
    expect(stockAfter).toBe(stockBefore - 3);
    expect(stockAfter).toBeGreaterThanOrEqual(0);
  });

  it('kegagalan database tidak meninggalkan transaksi atau perubahan stok parsial', async () => {
    const key = `${runId}-simulasi-gagal`;
    const stockBefore = await batchStock(batchF1); // 10
    const txBefore = await prisma.saleTransaction.count();
    const movementsBefore = await prisma.batchStockMovement.count({ where: { batchId: batchF1 } });

    await expect(
      runIdempotent({ key, endpoint: 'POST /api/sales', userId: adminId }, async (tx) => {
        const sale = await tx.saleTransaction.create({
          data: { total: '12000.00', recordedById: adminId },
        });
        const item = await tx.saleItem.create({
          data: {
            transactionId: sale.id,
            productId: prodFail,
            quantity: '1.000',
            unitPrice: '12000.00',
          },
        });
        const allocation = await tx.saleAllocation.create({
          data: { itemId: item.id, batchId: batchF1, quantity: '1.000' },
        });
        await tx.batchStockMovement.create({
          data: {
            batchId: batchF1,
            type: 'SALE',
            quantity: '-1.000',
            occurredAt: new Date(),
            recordedById: adminId,
            saleAllocationId: allocation.id,
          },
        });
        await applyBatchStockChange(tx, batchF1, new Prisma.Decimal('-1.000'));
        throw new Error('SIMULASI_KEGAGALAN_DATABASE');
      })
    ).rejects.toThrow('SIMULASI_KEGAGALAN_DATABASE');

    // Semua catatan terkai rollback bersama — tidak ada yang tersimpan.
    expect(await batchStock(batchF1)).toBe(stockBefore);
    expect(await prisma.saleTransaction.count()).toBe(txBefore);
    expect(await prisma.batchStockMovement.count({ where: { batchId: batchF1 } })).toBe(
      movementsBefore
    );
    expect(await prisma.saleAllocation.count({ where: { batchId: batchF1 } })).toBe(0);
    expect(
      await prisma.idempotencyKey.findUnique({
        where: { key_endpoint_userId: { key, endpoint: 'POST /api/sales', userId: adminId } },
      })
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hak akses, batasan endpoint, dan riwayat
// ---------------------------------------------------------------------------

describe('hak akses, batasan endpoint, dan riwayat', () => {
  it('Operator dapat melihat riwayat penjualan (README 4)', async () => {
    const list = await request(app).get('/api/sales').set(auth(operatorToken));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.data.length).toBeGreaterThan(0);

    const knownId = createdSaleIds[createdSaleIds.length - 1];
    expect(list.body.data.some((t: { id: string }) => t.id === knownId)).toBe(true);

    const detail = await request(app).get(`/api/sales/${knownId}`).set(auth(operatorToken));
    expect(detail.status).toBe(200);
    expect(detail.body.transaction.items.length).toBeGreaterThan(0);

    const missing = await request(app).get('/api/sales/transaksi-tidak-ada').set(auth(operatorToken));
    expect(missing.status).toBe(404);
  });

  it('transaksi tidak memiliki endpoint edit/hapus (README 5.5)', async () => {
    const id = createdSaleIds[0];

    const put = await request(app).put(`/api/sales/${id}`).set(auth(adminToken)).send({});
    expect(put.status).toBe(404);

    const patch = await request(app).patch(`/api/sales/${id}`).set(auth(adminToken)).send({});
    expect(patch.status).toBe(404);

    const del = await request(app).delete(`/api/sales/${id}`).set(auth(adminToken));
    expect(del.status).toBe(404);

    const delList = await request(app).delete('/api/sales').set(auth(adminToken));
    expect(delList.status).toBe(404);

    // Riwayat pergerakan stok juga tidak punya endpoint edit/hapus.
    const movementDel = await request(app)
      .delete('/api/batches/' + batchA1)
      .set(auth(adminToken));
    expect(movementDel.status).toBe(404);
  });

  it('produk dengan riwayat penjualan: ditolak selama stok ada, lalu diarsipkan (README 5.1)', async () => {
    // Selama masih ada stok, penghapusan ditolak — stok tidak dikurangi atau
    // dibuang untuk memaksa penghapusan berhasil.
    const withStock = await request(app).delete(`/api/products/${prodA}`).set(auth(adminToken));
    expect(withStock.status).toBe(409);
    expect(withStock.body.message).toMatch(/stok/i);

    // Sisa stok diselesaikan lewat penyesuaian resmi (riwayat tidak dihapus).
    const prodABatches = await prisma.batch.findMany({
      where: { productId: prodA },
      select: { id: true, stockQuantity: true },
    });
    expect(prodABatches.length).toBeGreaterThan(0);
    for (const item of prodABatches) {
      const remaining = Number(item.stockQuantity);
      if (remaining > 0) {
        const settle = await request(app)
          .post('/api/stock-adjustments')
          .set(auth(adminToken))
          .send({
            targetType: 'BATCH',
            targetId: item.id,
            quantity: -remaining,
            reason: 'Stok diselesaikan untuk uji penghapusan',
          });
        expect(settle.status).toBe(201);
      }
    }

    // Stok nol + ada riwayat penjualan: diarsipkan, bukan dihapus permanen.
    const res = await request(app).delete(`/api/products/${prodA}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
    expect(res.body.message).toContain('riwayat');

    // Produk tetap bisa dibaca (arsip) dan riwayat penjualan/batch utuh.
    const detail = await request(app).get(`/api/products/${prodA}`).set(auth(adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body.product.isActive).toBe(false);
    expect(await prisma.saleItem.count({ where: { productId: prodA } })).toBeGreaterThan(0);
    expect(await prisma.batch.count({ where: { productId: prodA } })).toBe(prodABatches.length);
  });
});

// ---------------------------------------------------------------------------
// Audit konsistensi stok
// ---------------------------------------------------------------------------

describe('audit konsistensi stok', () => {
  it('stok batch = jumlah seluruh pergerakan dan total produk = jumlah stok batch', async () => {
    const productIds = await allRunProductIds();
    expect(productIds.length).toBeGreaterThan(0);
    await auditBatchStock(productIds);
    await auditProductTotals(productIds);
  });
});

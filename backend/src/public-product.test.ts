/**
 * Pengujian halaman publik produk untuk QR permanen per produk.
 *
 * Fokus:
 * - Satu endpoint publik mengembalikan informasi produk dan SELURUH batch
 *   terkait, selalu dibaca dari database (bukan daftar statis).
 * - Batch baru otomatis muncul; perubahan kedaluwarsa langsung tercermin.
 * - Urutan batch: produksi terbaru lebih dulu; batch tanpa tanggal di akhir.
 * - Status batch mengikuti kondisi sebenarnya: tersedia, habis, kedaluwarsa,
 *   atau ditarik — batch yang ditarik tidak pernah berstatus tersedia.
 * - Produk tanpa batch tetap menampilkan informasi produknya.
 * - Produk nonaktif dan ID tak dikenal tidak dapat diakses.
 * - Tidak ada data internal (stok, harga, akun) yang bocor.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';

const app = createApp();
const runId = `pub-product-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let adminToken = '';
let adminId = '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function wibDateCode(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

async function login(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

async function createProduct(suffix: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({
      name: `${runId}-produk-${suffix}`,
      unit: 'pcs',
      sellingPrice: 15000,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.product as { id: string };
}

async function createBatch(productId: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/batches/opening-stock')
    .set(auth(adminToken))
    .send({ productId, quantity: 10, ...body });
  expect(res.status).toBe(201);
  return res.body.batch as { id: string; code: string };
}

async function setExpiry(batchId: string, expiryDate: string) {
  const res = await request(app)
    .patch(`/api/batches/${batchId}/expiry`)
    .set(auth(adminToken))
    .send({ expiryDate });
  expect(res.status).toBe(200);
}

async function adjustToZero(batchId: string, quantity: number) {
  const res = await request(app)
    .post('/api/stock-adjustments')
    .set(auth(adminToken))
    .send({
      targetType: 'BATCH',
      targetId: batchId,
      quantity: -quantity,
      reason: 'Stok batch habis untuk pengujian halaman publik',
    });
  expect(res.status).toBe(201);
}

async function publishThenWithdraw(batchId: string) {
  for (const action of ['validate', 'publish', 'withdraw']) {
    const res = await request(app)
      .post(`/api/batches/${batchId}/qr/${action}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
  }
}

const getPublicProduct = (id: string) =>
  request(app).get(`/api/public/products/${encodeURIComponent(id)}`);

interface PublicBatchBody {
  code: string;
  productionDate: string | null;
  expiryDate: string | null;
  status: 'TERSEDIA' | 'HABIS' | 'KEDALUWARSA' | 'DITARIK';
}

function findBatch(body: { batches: PublicBatchBody[] }, code: string): PublicBatchBody {
  const batch = body.batches.find((item) => item.code === code);
  expect(batch).toBeTruthy();
  return batch!;
}

// Fixture produk dan batch.
let productMain = '';
let productEmpty = '';
let productInactive = '';
let batchOld = '';
let batchMiddle = '';
let batchNew = '';
let batchWithdrawn = '';
let batchOpening = '';

beforeAll(async () => {
  await prisma.user.create({
    data: {
      username: `${runId}-admin`,
      passwordHash: await hashPassword('admin-rahasia-123'),
      role: 'ADMIN',
    },
  });
  adminId = (await prisma.user.findUniqueOrThrow({ where: { username: `${runId}-admin` } })).id;
  adminToken = (await login(`${runId}-admin`, 'admin-rahasia-123')).body.token;
  expect(adminToken).toBeTruthy();

  productMain = (
    await createProduct('utama', {
      description: 'Produk uji dengan informasi publik lengkap.',
      composition: 'Beras merah, gula aren, kelapa parut.',
      storageInstructions: 'Simpan di tempat kering dan sejuk.',
    })
  ).id;
  productEmpty = (await createProduct('tanpa-batch')).id;
  productInactive = (await createProduct('nonaktif')).id;

  // Batch lama (masih tersedia).
  batchOld = (await createBatch(productMain, { productionDate: wibDateCode(-30) })).code;
  const oldBatch = await prisma.batch.findUniqueOrThrow({ where: { code: batchOld } });
  await setExpiry(oldBatch.id, wibDateCode(30));

  // Batch menengah yang sudah kedaluwarsa.
  batchMiddle = (await createBatch(productMain, { productionDate: wibDateCode(-10) })).code;
  const middleBatch = await prisma.batch.findUniqueOrThrow({ where: { code: batchMiddle } });
  await setExpiry(middleBatch.id, wibDateCode(-1));

  // Batch baru yang stoknya sudah habis.
  batchNew = (await createBatch(productMain, { productionDate: wibDateCode(-5), quantity: 5 })).code;
  const newBatch = await prisma.batch.findUniqueOrThrow({ where: { code: batchNew } });
  await adjustToZero(newBatch.id, 5);

  // Batch yang informasinya ditarik Admin.
  batchWithdrawn = (await createBatch(productMain, { productionDate: wibDateCode(-1) })).code;
  const withdrawnBatch = await prisma.batch.findUniqueOrThrow({ where: { code: batchWithdrawn } });
  await publishThenWithdraw(withdrawnBatch.id);

  // Batch stok awal tanpa tanggal produksi: riwayatnya terbatas dan harus
  // diletakkan paling akhir, bukan dianggap produksi terbaru.
  batchOpening = (await createBatch(productMain, { quantity: 4 })).code;

  // Produk nonaktif tidak boleh punya halaman publik.
  const deactivate = await request(app)
    .patch(`/api/products/${productInactive}`)
    .set(auth(adminToken))
    .send({ isActive: false });
  expect(deactivate.status).toBe(200);
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

  await prisma.qrPublication.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchAlias.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchStockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchExpiryChange.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.stockAdjustment.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchOpeningBalance.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

describe('halaman publik produk', () => {
  it('terbuka tanpa login dan menampilkan informasi produk yang aman', async () => {
    const res = await getPublicProduct(productMain);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.producer).toEqual({
      name: 'KWT Gogor',
      location: 'Kalurahan Salam, Patuk, Gunungkidul',
    });
    expect(Object.keys(res.body.product).sort()).toEqual([
      'composition',
      'description',
      'name',
      'storageInstructions',
      'unit',
    ]);
    expect(res.body.product.name).toBe(`${runId}-produk-utama`);
    expect(res.body.product.composition).toBe('Beras merah, gula aren, kelapa parut.');

    // Tidak ada data internal di seluruh respons.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('stockQuantity');
    expect(serialized).not.toContain('sellingPrice');
    expect(serialized).not.toContain('isActive');
    expect(serialized).not.toContain(adminId);
    expect(serialized).not.toContain(`${runId}-admin`);
  });

  it('menampilkan seluruh batch terkait, terbaru lebih dulu', async () => {
    const res = await getPublicProduct(productMain);
    expect(res.status).toBe(200);

    const codes = (res.body.batches as PublicBatchBody[]).map((batch) => batch.code);
    expect(codes).toEqual([batchWithdrawn, batchNew, batchMiddle, batchOld, batchOpening]);
    // Batch tanpa tanggal produksi tetap tampil, tetapi di akhir daftar.
    expect(findBatch(res.body, batchOpening).productionDate).toBeNull();
  });

  it('status batch mengikuti kondisi sebenarnya, bukan label statis', async () => {
    const res = await getPublicProduct(productMain);
    expect(findBatch(res.body, batchOld).status).toBe('TERSEDIA');
    expect(findBatch(res.body, batchMiddle).status).toBe('KEDALUWARSA');
    expect(findBatch(res.body, batchNew).status).toBe('HABIS');
    expect(findBatch(res.body, batchWithdrawn).status).toBe('DITARIK');
    expect(findBatch(res.body, batchOpening).status).toBe('TERSEDIA');
    // Batch yang ditarik tidak pernah berstatus tersedia.
    expect(findBatch(res.body, batchWithdrawn).status).not.toBe('TERSEDIA');
  });

  it('batch baru otomatis muncul tanpa mengubah identitas produk', async () => {
    const created = await createBatch(productMain, {
      productionDate: wibDateCode(0),
      quantity: 3,
    });

    const res = await getPublicProduct(productMain);
    expect(res.status).toBe(200);
    expect(res.body.batches[0].code).toBe(created.code);
    expect(res.body.batches[0].status).toBe('TERSEDIA');
    // Halaman publik tetap memakai ID produk yang sama (QR tidak berubah).
    expect(res.body.product.name).toBe(`${runId}-produk-utama`);
  });

  it('perubahan tanggal kedaluwarsa langsung tercermin', async () => {
    const oldBatch = await prisma.batch.findUniqueOrThrow({ where: { code: batchOld } });
    const newExpiry = wibDateCode(45);
    await setExpiry(oldBatch.id, newExpiry);

    const res = await getPublicProduct(productMain);
    const updated = findBatch(res.body, batchOld);
    expect(updated.expiryDate).toBe(newExpiry);
    expect(updated.status).toBe('TERSEDIA');
    // Kode batch tidak berubah saat tanggal kedaluwarsa diperbarui.
    expect(updated.code).toBe(batchOld);
  });

  it('tanggal kedaluwarsa yang belum tervalidasi tidak dikirim', async () => {
    // Simulasikan data lama: tanggal ada tetapi belum divalidasi Admin.
    const oldBatch = await prisma.batch.findUniqueOrThrow({ where: { code: batchOld } });
    await prisma.batch.update({
      where: { id: oldBatch.id },
      data: { expiryDate: new Date(`${wibDateCode(20)}T00:00:00.000Z`), expiryValidatedAt: null },
    });

    const res = await getPublicProduct(productMain);
    expect(findBatch(res.body, batchOld).expiryDate).toBeNull();
  });

  it('produk tanpa batch tetap menampilkan informasi produknya', async () => {
    const res = await getPublicProduct(productEmpty);
    expect(res.status).toBe(200);
    expect(res.body.product.name).toBe(`${runId}-produk-tanpa-batch`);
    // Kolom opsional yang kosong disembunyikan, bukan null.
    expect(Object.keys(res.body.product).sort()).toEqual(['name', 'unit']);
    expect(res.body.batches).toEqual([]);
  });

  it('produk nonaktif dan ID tak dikenal tidak dapat diakses', async () => {
    const inactive = await getPublicProduct(productInactive);
    expect(inactive.status).toBe(404);
    expect(inactive.body.message).toMatch(/tidak tersedia|belum dipublikasikan/i);

    const unknown = await getPublicProduct(`${runId}-tidak-ada`);
    expect(unknown.status).toBe(404);
  });

  it('selalu mengirim data terbaru tanpa cache', async () => {
    const res = await getPublicProduct(productMain);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

/**
 * Pengujian integrasi B5: pencatatan produksi, kode batch, pemakaian
 * aktual bahan, stok atomik, dan koreksi catatan produksi oleh Admin.
 * Berjalan terhadap database PostgreSQL lokal (docker compose).
 */
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { formatBatchCode } from './lib/batch';
import { runIdempotent } from './lib/idempotency';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';
import { applyBatchStockChange, InsufficientStockError } from './lib/stock';

const app = createApp();

const runId = `b5-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

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

/** Kode tanggal WIB hari ini minus `daysAgo` hari. */
function pastCode(daysAgo: number): string {
  return wibFormatter.format(new Date(Date.now() - daysAgo * 86_400_000));
}

/** Kode tanggal WIB besok. */
function tomorrowCode(): string {
  return wibFormatter.format(new Date(Date.now() + 86_400_000));
}

/** Kode batch yang diharapkan untuk satu tanggal produksi. */
function expectedCode(dateCode: string, sequence: number): string {
  return `NL-${dateCode.replace(/-/g, '')}-${String(sequence).padStart(3, '0')}`;
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

async function getMaterialStockApi(materialId: string): Promise<number> {
  const res = await request(app).get(`/api/materials/${materialId}`).set(auth(operatorToken));
  return res.body.material.stock;
}

beforeAll(async () => {
  await prisma.user.create({
    data: { username: `${runId}-admin`, passwordHash: await hashPassword('admin-rahasia-123'), role: 'ADMIN' },
  });
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: `${runId}-admin` } });
  adminId = admin.id;
  await prisma.user.create({
    data: { username: `${runId}-operator`, passwordHash: await hashPassword('operator-rahasia-123'), role: 'OPERATOR' },
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
  const batches = await prisma.batch.findMany({ where: { productId: { in: productIds } }, select: { id: true } });
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
  await prisma.productionCorrection.deleteMany({ where: { productionId: { in: productionIds } } });
  await prisma.materialStockMovement.deleteMany({ where: { materialId: { in: materialIds } } });
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

describe('Pencatatan produksi', () => {
  it('Operator mencatat produksi: kode batch NL-TANGGAL-001, stok bahan berkurang, stok batch = hasil', async () => {
    const product = await createProduct('sukses');
    const bahanA = await createMaterial('sukses-a');
    const bahanB = await createMaterial('sukses-b');
    await stockViaReceipt(bahanA.id, 100);
    await stockViaReceipt(bahanB.id, 50);

    const productionDate = pastCode(3);
    const res = await postProduction({
      productId: product.id,
      productionDate,
      yieldQuantity: 25,
      note: 'Batch percobaan',
      materials: [
        { materialId: bahanA.id, quantity: 10 },
        { materialId: bahanB.id, quantity: 2.5 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.production.productionDate).toContain(productionDate);
    expect(res.body.production.yieldQuantity).toBe(25);
    expect(res.body.production.note).toBe('Batch percobaan');
    expect(res.body.production.recordedBy.username).toBe(`${runId}-operator`);
    expect(res.body.production.batch.code).toBe(expectedCode(productionDate, 1));
    expect(res.body.production.batch.stock).toBe(25);
    expect(res.body.production.batch.aliases).toEqual([]);

    // Stok bahan berkurang sesuai pemakaian aktual.
    expect(await getMaterialStockApi(bahanA.id)).toBe(90);
    expect(await getMaterialStockApi(bahanB.id)).toBe(47.5);

    // Pemakaian tercatat per bahan.
    const usages = res.body.production.usages as { materialId: string; quantity: number }[];
    expect(usages).toHaveLength(2);
    expect(usages.find((u) => u.materialId === bahanA.id)?.quantity).toBe(10);
    expect(usages.find((u) => u.materialId === bahanB.id)?.quantity).toBe(2.5);

    // Jejak pergerakan stok terkait catatan sumbernya (README 5.4).
    const usageMovements = await prisma.materialStockMovement.findMany({
      where: { materialId: { in: [bahanA.id, bahanB.id] }, type: 'PRODUCTION_USAGE' },
    });
    expect(usageMovements).toHaveLength(2);
    expect(usageMovements.every((m) => m.productionUsageId !== null)).toBe(true);

    const yieldMovements = await prisma.batchStockMovement.findMany({
      where: { batchId: res.body.production.batch.id, type: 'PRODUCTION_YIELD' },
    });
    expect(yieldMovements).toHaveLength(1);
    expect(Number(yieldMovements[0].quantity)).toBe(25);
    expect(yieldMovements[0].productionId).toBe(res.body.production.id);
  });

  it('Nomor urut kode batch lanjut ke -002 untuk tanggal produksi yang sama', async () => {
    const product = await createProduct('urut');
    const bahan = await createMaterial('urut');
    await stockViaReceipt(bahan.id, 100);

    const productionDate = pastCode(4);
    const first = await postProduction({
      productId: product.id,
      productionDate,
      yieldQuantity: 5,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });
    const second = await postProduction({
      productId: product.id,
      productionDate,
      yieldQuantity: 6,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });

    expect(first.body.production.batch.code).toBe(expectedCode(productionDate, 1));
    expect(second.body.production.batch.code).toBe(expectedCode(productionDate, 2));
  });

  it('Pencatatan mundur: kode mengikuti tanggal produksi sebenarnya, waktu pencatatan terpisah', async () => {
    const product = await createProduct('mundur');
    const bahan = await createMaterial('mundur');
    await stockViaReceipt(bahan.id, 100);

    const productionDate = pastCode(10); // jauh sebelum hari ini, dicatat hari ini
    const res = await postProduction({
      productId: product.id,
      productionDate,
      yieldQuantity: 3,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.production.batch.code).toBe(expectedCode(productionDate, 1));
    // Waktu pencatatan disimpan terpisah dan lebih baru dari tanggal produksi.
    expect(new Date(res.body.production.recordedAt).getTime()).toBeGreaterThan(
      new Date(res.body.production.productionDate).getTime()
    );
  });

  it('Pemakaian bahan dari saldo awal B4 dapat dipakai produksi', async () => {
    const product = await createProduct('saldo-awal');
    const bahan = await createMaterial('saldo-awal');

    const opening = await request(app)
      .post(`/api/materials/${bahan.id}/opening-balances`)
      .set(auth(adminToken))
      .send({ quantity: 20, date: pastCode(15), reason: 'Stok awal gudang' });
    expect(opening.status).toBe(201);

    const res = await postProduction({
      productId: product.id,
      productionDate: pastCode(2),
      yieldQuantity: 8,
      materials: [{ materialId: bahan.id, quantity: 12 }],
    });

    expect(res.status).toBe(201);
    expect(await getMaterialStockApi(bahan.id)).toBe(8);
  });

  it('Admin juga dapat mencatat produksi', async () => {
    const product = await createProduct('admin');
    const bahan = await createMaterial('admin');
    await stockViaReceipt(bahan.id, 10);

    const res = await postProduction(
      {
        productId: product.id,
        productionDate: pastCode(1),
        yieldQuantity: 4,
        materials: [{ materialId: bahan.id, quantity: 2 }],
      },
      adminToken
    );

    expect(res.status).toBe(201);
    expect(res.body.production.recordedBy.username).toBe(`${runId}-admin`);
  });

  it('Daftar dan detail produksi dapat dilihat, terurut tanggal terbaru', async () => {
    const list = await request(app).get('/api/productions').set(auth(operatorToken));
    expect(list.status).toBe(200);
    expect((list.body.data as { id: string }[]).length).toBeGreaterThan(1);

    const dates = (list.body.data as { productionDate: string }[]).map((p) => p.productionDate);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);

    const firstId = (list.body.data as { id: string }[])[0].id;
    const detail = await request(app).get(`/api/productions/${firstId}`).set(auth(operatorToken));
    expect(detail.status).toBe(200);
    expect(detail.body.production.id).toBe(firstId);

    const missing = await request(app).get('/api/productions/id-tidak-ada').set(auth(operatorToken));
    expect(missing.status).toBe(404);
  });
});

describe('Penolakan produksi yang tidak valid', () => {
  it('Stok salah satu bahan tidak mencukupi: SELURUH produksi ditolak atomik (409)', async () => {
    const product = await createProduct('gagal-stok');
    const bahanA = await createMaterial('gagal-stok-a');
    const bahanB = await createMaterial('gagal-stok-b');
    await stockViaReceipt(bahanA.id, 10);
    await stockViaReceipt(bahanB.id, 100); // cukup, tapi bahanA kurang

    const res = await postProduction({
      productId: product.id,
      productionDate: pastCode(1),
      yieldQuantity: 10,
      materials: [
        { materialId: bahanA.id, quantity: 50 }, // melebihi stok
        { materialId: bahanB.id, quantity: 5 },
      ],
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('tidak mencukupi');

    // Atomik: tidak ada produksi/batch/pemakaian/pergerakan yang tersisa.
    const productions = await prisma.production.findMany({ where: { productId: product.id } });
    expect(productions).toHaveLength(0);
    const batches = await prisma.batch.findMany({ where: { productId: product.id } });
    expect(batches).toHaveLength(0);
    expect(await prisma.productionMaterialUsage.count({ where: { materialId: bahanA.id } })).toBe(0);
    expect(await prisma.materialStockMovement.count({ where: { materialId: bahanB.id, type: 'PRODUCTION_USAGE' } })).toBe(0);

    // Stok bahan yang mencukupi pun tidak berubah.
    expect(await getMaterialStockApi(bahanA.id)).toBe(10);
    expect(await getMaterialStockApi(bahanB.id)).toBe(100);
  });

  it('Menolak tanggal masa depan dan tanggal tidak valid (400)', async () => {
    const product = await createProduct('validasi-tanggal');
    const bahan = await createMaterial('validasi-tanggal');
    await stockViaReceipt(bahan.id, 10);

    const future = await postProduction({
      productId: product.id,
      productionDate: tomorrowCode(),
      yieldQuantity: 1,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });
    expect(future.status).toBe(400);
    expect(future.body.message).toContain('masa depan');

    const invalid = await postProduction({
      productId: product.id,
      productionDate: 'bukan-tanggal',
      yieldQuantity: 1,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });
    expect(invalid.status).toBe(400);
  });

  it('Menolak jumlah hasil dan pemakaian yang tidak valid (400)', async () => {
    const product = await createProduct('validasi-jumlah');
    const bahan = await createMaterial('validasi-jumlah');
    await stockViaReceipt(bahan.id, 10);

    const base = { productId: product.id, productionDate: pastCode(1), materials: [{ materialId: bahan.id, quantity: 1 }] };
    expect((await postProduction({ ...base, yieldQuantity: 0 })).status).toBe(400);
    expect((await postProduction({ ...base, yieldQuantity: -5 })).status).toBe(400);
    expect((await postProduction({ ...base, yieldQuantity: 1.2345 })).status).toBe(400);

    expect((await postProduction({ ...base, yieldQuantity: 1, materials: [] })).status).toBe(400);
    expect((await postProduction({ ...base, yieldQuantity: 1, materials: 'bukan-array' })).status).toBe(400);
    expect(
      (await postProduction({ ...base, yieldQuantity: 1, materials: [{ materialId: bahan.id, quantity: 0 }] })).status
    ).toBe(400);
    expect(
      (await postProduction({
        ...base,
        yieldQuantity: 1,
        materials: [
          { materialId: bahan.id, quantity: 1 },
          { materialId: bahan.id, quantity: 2 },
        ],
      })).status
    ).toBe(400);

    // Stok tidak berubah oleh permintaan yang ditolak.
    expect(await getMaterialStockApi(bahan.id)).toBe(10);
  });

  it('Menolak produk/bahan tidak dikenal (404) dan nonaktif (409); tanpa token (401)', async () => {
    const product = await createProduct('otoritas');
    const bahan = await createMaterial('otoritas');
    await stockViaReceipt(bahan.id, 10);

    const unknownProduct = await postProduction({
      productId: 'id-tidak-ada',
      productionDate: pastCode(1),
      yieldQuantity: 1,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });
    expect(unknownProduct.status).toBe(404);

    const unknownMaterial = await postProduction({
      productId: product.id,
      productionDate: pastCode(1),
      yieldQuantity: 1,
      materials: [{ materialId: 'id-tidak-ada', quantity: 1 }],
    });
    expect(unknownMaterial.status).toBe(404);

    const inactiveProduct = await createProduct('nonaktif');
    await request(app).patch(`/api/products/${inactiveProduct.id}`).set(auth(adminToken)).send({ isActive: false });
    const inactiveProductRes = await postProduction({
      productId: inactiveProduct.id,
      productionDate: pastCode(1),
      yieldQuantity: 1,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });
    expect(inactiveProductRes.status).toBe(409);

    const inactiveMaterial = await createMaterial('nonaktif');
    await stockViaReceipt(inactiveMaterial.id, 10);
    await request(app).patch(`/api/materials/${inactiveMaterial.id}`).set(auth(adminToken)).send({ isActive: false });
    const inactiveMaterialRes = await postProduction({
      productId: product.id,
      productionDate: pastCode(1),
      yieldQuantity: 1,
      materials: [{ materialId: inactiveMaterial.id, quantity: 1 }],
    });
    expect(inactiveMaterialRes.status).toBe(409);

    const withoutToken = await request(app).post('/api/productions').send({
      productId: product.id,
      productionDate: pastCode(1),
      yieldQuantity: 1,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });
    expect(withoutToken.status).toBe(401);
  });
});

describe('Pencegahan permintaan berulang dan permintaan bersamaan', () => {
  it('Idempotency-Key sama: produksi dan stok hanya sekali; respons identik', async () => {
    const product = await createProduct('idem');
    const bahan = await createMaterial('idem');
    await stockViaReceipt(bahan.id, 20);
    const key = `${runId}-idem-produksi`;

    const body = {
      productId: product.id,
      productionDate: pastCode(2),
      yieldQuantity: 7,
      materials: [{ materialId: bahan.id, quantity: 3 }],
    };

    const first = await postProduction(body).set('Idempotency-Key', key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replay']).toBe('false');

    const second = await postProduction(body).set('Idempotency-Key', key);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body).toEqual(first.body);

    expect(await getMaterialStockApi(bahan.id)).toBe(17); // 20 - 3, bukan 20 - 6
    const list = await request(app).get('/api/productions').set(auth(operatorToken));
    const forProduct = (list.body.data as { productId: string }[]).filter((p) => p.productId === product.id);
    expect(forProduct).toHaveLength(1);
  });

  it('Permintaan BERSAMAAN pada tanggal sama: kode batch tetap unik', async () => {
    const product = await createProduct('bersamaan');
    const bahan = await createMaterial('bersamaan');
    await stockViaReceipt(bahan.id, 100);

    const productionDate = pastCode(6);
    const [first, second] = await Promise.all([
      postProduction({
        productId: product.id,
        productionDate,
        yieldQuantity: 10,
        note: 'permintaan-a',
        materials: [{ materialId: bahan.id, quantity: 2 }],
      }),
      postProduction({
        productId: product.id,
        productionDate,
        yieldQuantity: 10,
        note: 'permintaan-b',
        materials: [{ materialId: bahan.id, quantity: 2 }],
      }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const codes = [first.body.production.batch.code, second.body.production.batch.code].sort();
    expect(codes).toEqual([expectedCode(productionDate, 1), expectedCode(productionDate, 2)]);

    // Stok bahan berkurang dua kali (dua produksi nyata), stok batch dua batch.
    expect(await getMaterialStockApi(bahan.id)).toBe(96);
  });
});

describe('Koreksi catatan produksi (hanya Admin)', () => {
  it('Operator ditolak (403), tanpa token (401), id asing (404)', async () => {
    const product = await createProduct('koreksi-otoritas');
    const bahan = await createMaterial('koreksi-otoritas');
    await stockViaReceipt(bahan.id, 10);
    const created = await postProduction({
      productId: product.id,
      productionDate: pastCode(1),
      yieldQuantity: 4,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });
    const id = created.body.production.id;

    const byOperator = await request(app)
      .patch(`/api/productions/${id}`)
      .set(auth(operatorToken))
      .send({ yieldQuantity: 3 });
    expect(byOperator.status).toBe(403);

    const withoutToken = await request(app)
      .patch(`/api/productions/${id}`)
      .send({ yieldQuantity: 3 });
    expect(withoutToken.status).toBe(401);

    const unknown = await request(app)
      .patch('/api/productions/id-tidak-ada')
      .set(auth(adminToken))
      .send({ yieldQuantity: 3 });
    expect(unknown.status).toBe(404);
  });

  it('Koreksi jumlah hasil menurunkan stok batch dan meninggalkan jejak audit', async () => {
    const product = await createProduct('koreksi-hasil');
    const bahan = await createMaterial('koreksi-hasil');
    await stockViaReceipt(bahan.id, 100);

    const created = await postProduction({
      productId: product.id,
      productionDate: pastCode(2),
      yieldQuantity: 25,
      materials: [{ materialId: bahan.id, quantity: 10 }],
    });
    const id = created.body.production.id;
    const batchId = created.body.production.batch.id;

    const res = await request(app)
      .patch(`/api/productions/${id}`)
      .set(auth(adminToken))
      .send({ yieldQuantity: 20 });

    expect(res.status).toBe(200);
    expect(res.body.production.yieldQuantity).toBe(20);
    expect(res.body.production.batch.stock).toBe(20);
    expect(res.body.production.batch.code).toBe(created.body.production.batch.code);

    // Pemakaian bahan TIDAK berubah (dicatat aktual, bukan dari hasil).
    expect(await getMaterialStockApi(bahan.id)).toBe(90);

    // Pergerakan koreksi tercatat tanpa menyentuh pergerakan lama.
    const movements = await prisma.batchStockMovement.findMany({ where: { batchId }, orderBy: { recordedAt: 'asc' } });
    expect(movements).toHaveLength(2);
    expect(movements[0].type).toBe('PRODUCTION_YIELD');
    expect(Number(movements[0].quantity)).toBe(25); // riwayat lama utuh
    expect(movements[1].type).toBe('YIELD_CORRECTION');
    expect(Number(movements[1].quantity)).toBe(-5);

    // Jejak audit koreksi.
    const corrections = await prisma.productionCorrection.findMany({ where: { productionId: id } });
    expect(corrections).toHaveLength(1);
    expect(corrections[0].field).toBe('yieldQuantity');
    expect(corrections[0].previousValue).toBe('25.000');
    expect(corrections[0].newValue).toBe('20.000');
    expect(corrections[0].changedById).toBe(adminId);

    // Koreksi kembali menaikkan stok batch.
    const up = await request(app).patch(`/api/productions/${id}`).set(auth(adminToken)).send({ yieldQuantity: 30 });
    expect(up.status).toBe(200);
    expect(up.body.production.batch.stock).toBe(30);
  });

  it('Koreksi tanggal membuat kode baru, kode lama jadi alias, identitas batch dipertahankan', async () => {
    const product = await createProduct('koreksi-tanggal');
    const bahan = await createMaterial('koreksi-tanggal');
    await stockViaReceipt(bahan.id, 100);

    const dateA = pastCode(30);
    const dateB = pastCode(25);
    const created = await postProduction({
      productId: product.id,
      productionDate: dateA,
      yieldQuantity: 12,
      materials: [{ materialId: bahan.id, quantity: 4 }],
    });
    const id = created.body.production.id;
    const oldCode = created.body.production.batch.code;
    const batchId = created.body.production.batch.id;
    expect(oldCode).toBe(expectedCode(dateA, 1));

    // Buat batch lain pada tanggal B terlebih dahulu agar urutan lanjut.
    const other = await postProduction({
      productId: product.id,
      productionDate: dateB,
      yieldQuantity: 2,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });
    expect(other.body.production.batch.code).toBe(expectedCode(dateB, 1));

    const res = await request(app)
      .patch(`/api/productions/${id}`)
      .set(auth(adminToken))
      .send({ productionDate: dateB });

    expect(res.status).toBe(200);
    // Kode baru lanjut dari urutan tanggal B; kode lama menjadi alias.
    expect(res.body.production.batch.code).toBe(expectedCode(dateB, 2));
    expect(res.body.production.batch.aliases).toContain(oldCode);
    expect(res.body.production.productionDate).toContain(dateB);
    // Stok dan identitas batch TIDAK berubah — alokasi batch (B7) tetap sah.
    expect(res.body.production.batch.stock).toBe(12);
    expect(res.body.production.batch.id).toBe(batchId);

    // Alias tersimpan di database dan kode unik terjaga.
    const alias = await prisma.batchAlias.findUnique({ where: { code: oldCode } });
    expect(alias?.batchId).toBe(batchId);

    // Jejak audit: productionDate + batchCode.
    const corrections = await prisma.productionCorrection.findMany({
      where: { productionId: id },
      orderBy: { changedAt: 'asc' },
    });
    const fields = corrections.map((c) => c.field);
    expect(fields).toContain('productionDate');
    expect(fields).toContain('batchCode');
    const codeCorrection = corrections.find((c) => c.field === 'batchCode');
    expect(codeCorrection?.previousValue).toBe(oldCode);
    expect(codeCorrection?.newValue).toBe(expectedCode(dateB, 2));

    // Koreksi tanggal kedua: dua alias, semua kode tetap unik.
    const dateC = pastCode(20);
    const again = await request(app)
      .patch(`/api/productions/${id}`)
      .set(auth(adminToken))
      .send({ productionDate: dateC });
    expect(again.status).toBe(200);
    expect(again.body.production.batch.aliases).toEqual([oldCode, expectedCode(dateB, 2)]);
    expect(again.body.production.batch.code).toBe(expectedCode(dateC, 1));

    const allCodes = await prisma.batch.findMany({ where: { productId: product.id }, select: { code: true } });
    const allAliases = await prisma.batchAlias.findMany({ select: { code: true } });
    const everyCode = [...allCodes.map((c) => c.code), ...allAliases.map((c) => c.code)];
    expect(new Set(everyCode).size).toBe(everyCode.length);
  });

  it('Koreksi tanggal dan jumlah hasil sekaligus diterapkan atomik', async () => {
    const product = await createProduct('koreksi-gabung');
    const bahan = await createMaterial('koreksi-gabung');
    await stockViaReceipt(bahan.id, 100);

    const created = await postProduction({
      productId: product.id,
      productionDate: pastCode(28),
      yieldQuantity: 15,
      materials: [{ materialId: bahan.id, quantity: 5 }],
    });
    const id = created.body.production.id;

    const newDate = pastCode(27);
    const res = await request(app)
      .patch(`/api/productions/${id}`)
      .set(auth(adminToken))
      .send({ productionDate: newDate, yieldQuantity: 18 });

    expect(res.status).toBe(200);
    expect(res.body.production.yieldQuantity).toBe(18);
    expect(res.body.production.batch.stock).toBe(18);
    expect(res.body.production.productionDate).toContain(newDate);
    expect(res.body.production.batch.code).toBe(expectedCode(newDate, 1));
    expect(res.body.production.batch.aliases).toEqual([expectedCode(pastCode(28), 1)]);

    const corrections = await prisma.productionCorrection.findMany({ where: { productionId: id } });
    expect(corrections.map((c) => c.field).sort()).toEqual(['batchCode', 'productionDate', 'yieldQuantity']);
  });

  it('Koreksi dengan nilai sama tidak mengubah apa pun (200 tanpa jejak baru)', async () => {
    const product = await createProduct('koreksi-sama');
    const bahan = await createMaterial('koreksi-sama');
    await stockViaReceipt(bahan.id, 50);

    const date = pastCode(2);
    const created = await postProduction({
      productId: product.id,
      productionDate: date,
      yieldQuantity: 9,
      materials: [{ materialId: bahan.id, quantity: 2 }],
    });
    const id = created.body.production.id;

    const res = await request(app)
      .patch(`/api/productions/${id}`)
      .set(auth(adminToken))
      .send({ productionDate: date, yieldQuantity: 9 });

    expect(res.status).toBe(200);
    expect(res.body.production.batch.code).toBe(created.body.production.batch.code);
    expect(res.body.production.batch.aliases).toEqual([]);

    expect(await prisma.productionCorrection.count({ where: { productionId: id } })).toBe(0);
    expect(await prisma.batchStockMovement.count({ where: { batchId: created.body.production.batch.id } })).toBe(1);
  });

  it('Koreksi idempoten: permintaan ulang tidak mengulang dampak stok', async () => {
    const product = await createProduct('koreksi-idem');
    const bahan = await createMaterial('koreksi-idem');
    await stockViaReceipt(bahan.id, 50);

    const created = await postProduction({
      productId: product.id,
      productionDate: pastCode(2),
      yieldQuantity: 10,
      materials: [{ materialId: bahan.id, quantity: 2 }],
    });
    const id = created.body.production.id;
    const key = `${runId}-koreksi-idem`;

    const patch = () =>
      request(app)
        .patch(`/api/productions/${id}`)
        .set(auth(adminToken))
        .set('Idempotency-Key', key)
        .send({ yieldQuantity: 6 });

    const first = await patch();
    expect(first.status).toBe(200);
    expect(first.headers['idempotent-replay']).toBe('false');

    const second = await patch();
    expect(second.status).toBe(200);
    expect(second.headers['idempotent-replay']).toBe('true');
    expect(second.body).toEqual(first.body);

    // Stok batch dikoreksi sekali saja: 6, bukan 10 - 4 - 4 = 2.
    expect(second.body.production.batch.stock).toBe(6);
    expect(await prisma.batchStockMovement.count({ where: { batchId: first.body.production.batch.id } })).toBe(2);
  });

  it('Koreksi tidak valid ditolak (400)', async () => {
    const product = await createProduct('koreksi-validasi');
    const bahan = await createMaterial('koreksi-validasi');
    await stockViaReceipt(bahan.id, 20);
    const created = await postProduction({
      productId: product.id,
      productionDate: pastCode(1),
      yieldQuantity: 5,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });
    const id = created.body.production.id;

    expect((await request(app).patch(`/api/productions/${id}`).set(auth(adminToken)).send({})).status).toBe(400);
    expect(
      (await request(app).patch(`/api/productions/${id}`).set(auth(adminToken)).send({ yieldQuantity: 0 })).status
    ).toBe(400);
    expect(
      (await request(app).patch(`/api/productions/${id}`).set(auth(adminToken)).send({ yieldQuantity: -1 })).status
    ).toBe(400);
    expect(
      (await request(app)
        .patch(`/api/productions/${id}`)
        .set(auth(adminToken))
        .send({ productionDate: tomorrowCode() })).status
    ).toBe(400);
    expect(
      (await request(app)
        .patch(`/api/productions/${id}`)
        .set(auth(adminToken))
        .send({ productionDate: 'bukan-tanggal' })).status
    ).toBe(400);

    // Tidak ada perubahan stok maupun jejak.
    expect(await prisma.productionCorrection.count({ where: { productionId: id } })).toBe(0);
  });

  it('Penjaga stok: perubahan yang membuat stok batch negatif ditolak', async () => {
    const product = await createProduct('koreksi-negatif');
    const bahan = await createMaterial('koreksi-negatif');
    await stockViaReceipt(bahan.id, 20);
    const created = await postProduction({
      productId: product.id,
      productionDate: pastCode(1),
      yieldQuantity: 5,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });
    const batchId = created.body.production.batch.id;

    // Penjaga pada level helper stok (dapat terjadi setelah B7 menurunkan
    // stok batch lewat penjualan): delta melebihi stok → ditolak atomik.
    await expect(
      prisma.$transaction((tx) => applyBatchStockChange(tx, batchId, new Prisma.Decimal(-20)))
    ).rejects.toThrow(InsufficientStockError);

    const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
    expect(Number(batch.stockQuantity)).toBe(5);
  });
});

describe('Integritas dan riwayat', () => {
  it('Tidak ada endpoint edit/hapus catatan produksi, pemakaian, atau batch', async () => {
    const product = await createProduct('kunci-rute');
    const bahan = await createMaterial('kunci-rute');
    await stockViaReceipt(bahan.id, 10);
    const created = await postProduction({
      productId: product.id,
      productionDate: pastCode(1),
      yieldQuantity: 4,
      materials: [{ materialId: bahan.id, quantity: 1 }],
    });
    const id = created.body.production.id;

    expect((await request(app).delete(`/api/productions/${id}`).set(auth(adminToken))).status).toBe(404);
    expect(
      (await request(app).patch(`/api/productions/${id}`).set(auth(adminToken)).send({ note: 'x' })).status
    ).toBe(400);
    const usageId = created.body.production.usages[0].materialId;
    expect(
      (await request(app).delete(`/api/productions/${id}/usages/${usageId}`).set(auth(adminToken))).status
    ).toBe(404);
    expect((await request(app).delete(`/api/batches/${created.body.production.batch.id}`).set(auth(adminToken))).status).toBe(404);

    // Catatan asli tetap utuh.
    const detail = await request(app).get(`/api/productions/${id}`).set(auth(operatorToken));
    expect(detail.body.production.yieldQuantity).toBe(4);
  });

  it('Kegagalan di tengah transaksi tidak menyisakan produksi atau stok setengah jadi', async () => {
    const product = await createProduct('atomik');
    const bahan = await createMaterial('atomik');
    await stockViaReceipt(bahan.id, 30);

    await expect(
      runIdempotent({ key: `${runId}-gagal`, endpoint: 'UJI-ATOMIK-B5', userId: adminId }, async (tx) => {
        const batch = await tx.batch.create({
          data: { code: formatBatchCode(new Date(), 999), productId: product.id, productionDate: new Date(), stockQuantity: 0 },
        });
        const production = await tx.production.create({
          data: { productId: product.id, productionDate: new Date(), yieldQuantity: '5.000', recordedById: adminId, batchId: batch.id },
        });
        const usage = await tx.productionMaterialUsage.create({
          data: { productionId: production.id, materialId: bahan.id, quantity: '3.000' },
        });
        await tx.materialStockMovement.create({
          data: { materialId: bahan.id, type: 'PRODUCTION_USAGE', quantity: '3.000', occurredAt: new Date(), recordedById: adminId, productionUsageId: usage.id },
        });
        throw new Error('gagal uji');
      })
    ).rejects.toThrow('gagal uji');

    // Tidak ada catatan setengah jadi; stok bahan tidak berubah.
    expect(await prisma.production.count({ where: { productId: product.id } })).toBe(0);
    expect(await prisma.batch.count({ where: { productId: product.id } })).toBe(0);
    expect(await prisma.productionMaterialUsage.count({ where: { materialId: bahan.id } })).toBe(0);
    expect(await getMaterialStockApi(bahan.id)).toBe(30);
  });

  it('Produk dengan riwayat produksi tidak dapat dihapus/diubah satuan; bahan dengan pemakaian juga (409)', async () => {
    const product = await createProduct('riwayat-nyata');
    const bahan = await createMaterial('riwayat-nyata');
    await stockViaReceipt(bahan.id, 10);
    await postProduction({
      productId: product.id,
      productionDate: pastCode(1),
      yieldQuantity: 4,
      materials: [{ materialId: bahan.id, quantity: 2 }],
    });

    expect((await request(app).delete(`/api/products/${product.id}`).set(auth(adminToken))).status).toBe(409);
    expect(
      (await request(app).patch(`/api/products/${product.id}`).set(auth(adminToken)).send({ unit: 'box' })).status
    ).toBe(409);
    expect((await request(app).delete(`/api/materials/${bahan.id}`).set(auth(adminToken))).status).toBe(409);
    expect(
      (await request(app).patch(`/api/materials/${bahan.id}`).set(auth(adminToken)).send({ unit: 'liter' })).status
    ).toBe(409);

    // Riwayat tetap utuh.
    const list = await request(app).get('/api/productions').set(auth(operatorToken));
    expect((list.body.data as { productId: string }[]).some((p) => p.productId === product.id)).toBe(true);
  });
});

/**
 * Pengujian integrasi standardisasi satuan bahan baku:
 * kode baku, konversi satuan utama yang tercatat, perhitungan resep di
 * backend, kompatibilitas satuan, stok tidak mencukupi, dan penandaan data lama.
 * Berjalan terhadap database PostgreSQL lokal (docker compose).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';

const app = createApp();
const runId = `b9-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
let adminToken = '';
let operatorToken = '';

const wibFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const pastDate = () => wibFormatter.format(new Date(Date.now() - 3 * 86_400_000));
const expiryDate = () => wibFormatter.format(new Date(Date.now() + 90 * 86_400_000));

async function createMaterial(suffix: string, unit = 'kg', unitKind?: 'mass' | 'volume' | 'manual') {
  const res = await request(app)
    .post('/api/materials')
    .set(auth(adminToken))
    .send({ name: `${runId}-${suffix}`, unit, ...(unitKind ? { unitKind } : {}) });
  expect(res.status).toBe(201);
  return res.body.material as { id: string; unit: string; stock: number };
}

async function createProduct(suffix: string, recipe: Record<string, unknown>[]) {
  const res = await request(app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({
      name: `${runId}-produk-${suffix}`,
      unit: 'pcs',
      sellingPrice: 10000,
      recipe,
    });
  expect(res.status).toBe(201);
  return res.body.product as { id: string };
}

async function addReceipt(materialId: string, quantity: number) {
  const res = await request(app)
    .post(`/api/materials/${materialId}/receipts`)
    .set(auth(operatorToken))
    .send({ quantity });
  expect(res.status).toBe(201);
}

async function stockOf(materialId: string): Promise<number> {
  const res = await request(app).get(`/api/materials/${materialId}`).set(auth(operatorToken));
  return res.body.material.stock as number;
}

beforeAll(async () => {
  await prisma.user.create({
    data: { username: `${runId}-admin`, passwordHash: await hashPassword('rahasia-123'), role: 'ADMIN' },
  });
  await prisma.user.create({
    data: { username: `${runId}-operator`, passwordHash: await hashPassword('rahasia-123'), role: 'OPERATOR' },
  });
  adminToken = (
    await request(app).post('/api/auth/login').send({ username: `${runId}-admin`, password: 'rahasia-123' })
  ).body.token;
  operatorToken = (
    await request(app).post('/api/auth/login').send({ username: `${runId}-operator`, password: 'rahasia-123' })
  ).body.token;
  expect(adminToken && operatorToken).toBeTruthy();
});

afterAll(async () => {
  const products = await prisma.product.findMany({ where: { name: { startsWith: runId } }, select: { id: true } });
  const productIds = products.map((p) => p.id);
  const batches = await prisma.batch.findMany({ where: { productId: { in: productIds } }, select: { id: true } });
  const batchIds = batches.map((b) => b.id);
  const productions = await prisma.production.findMany({ where: { productId: { in: productIds } }, select: { id: true } });
  const productionIds = productions.map((p) => p.id);
  const materials = await prisma.material.findMany({ where: { name: { startsWith: runId } }, select: { id: true } });
  const materialIds = materials.map((m) => m.id);
  const reviewIds = (
    await prisma.unitReview.findMany({
      where: { OR: [{ entityId: { in: materialIds } }, { entityId: { startsWith: runId } }] },
      select: { id: true },
    })
  ).map((r) => r.id);

  await prisma.batchStockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchExpiryChange.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.productionCorrection.deleteMany({ where: { productionId: { in: productionIds } } });
  await prisma.materialStockMovement.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.productionMaterialUsage.deleteMany({ where: { productionId: { in: productionIds } } });
  await prisma.materialReceipt.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialOpeningBalance.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.batchAlias.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.production.deleteMany({ where: { id: { in: productionIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.materialStock.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.material.deleteMany({ where: { id: { in: materialIds } } });
  await prisma.unitReview.deleteMany({ where: { id: { in: reviewIds } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

describe('Satuan baku pada master dan resep', () => {
  it('hanya menerima kode baku dan menormalkan alias lama', async () => {
    const accepted = await createMaterial('satuan-g', 'g');
    expect(accepted.unit).toBe('g');

    const alias = await request(app)
      .post('/api/materials')
      .set(auth(adminToken))
      .send({ name: `${runId}-alias-gram`, unit: 'gram' });
    expect(alias.status).toBe(201);
    expect(alias.body.material.unit).toBe('g');

    const rejected = await request(app)
      .post('/api/materials')
      .set(auth(adminToken))
      .send({ name: `${runId}-satuan-asing`, unit: 'box' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toContain('unitKind');

    const manual = await createMaterial('manual-teks', 'bungkus', 'manual');
    expect(manual.unit).toBe('bungkus');
    const detail = await request(app).get(`/api/materials/${manual.id}`).set(auth(operatorToken));
    expect(detail.body.material.isManual).toBe(true);
  });

  it('bahan Manual tidak boleh masuk resep otomatis', async () => {
    const material = await createMaterial('manual-resep', 'pcs', 'manual');
    const res = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send({
        name: `${runId}-resep-manual`,
        unit: 'pcs',
        sellingPrice: 10000,
        recipe: [{ materialId: material.id, quantityPerUnit: 1, recipeUnit: 'g' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Manual');
  });
});

describe('Perubahan satuan utama dengan konversi stok', () => {
  it('Admin mengonversi kg ke g, stok tercatat, riwayat resep tetap kompatibel', async () => {
    const material = await createMaterial('konversi', 'kg');
    await addReceipt(material.id, 2);
    const product = await createProduct('konversi', [
      { materialId: material.id, quantityPerUnit: 150, recipeUnit: 'g' },
    ]);

    const forbidden = await request(app)
      .post(`/api/materials/${material.id}/unit-change`)
      .set(auth(operatorToken))
      .send({ newUnit: 'g' });
    expect(forbidden.status).toBe(403);

    const incompatible = await request(app)
      .post(`/api/materials/${material.id}/unit-change`)
      .set(auth(adminToken))
      .send({ newUnit: 'L' });
    expect(incompatible.status).toBe(400);
    expect(await stockOf(material.id)).toBe(2);

    const changed = await request(app)
      .post(`/api/materials/${material.id}/unit-change`)
      .set(auth(adminToken))
      .send({ newUnit: 'g' });
    expect(changed.status).toBe(200);
    expect(changed.body.material.unit).toBe('g');
    expect(changed.body.currentStock).toBe('2000.000');
    expect(await stockOf(material.id)).toBe(2000);

    const movements = await prisma.materialStockMovement.findMany({
      where: { materialId: material.id, type: 'UNIT_CONVERSION' },
    });
    expect(movements).toHaveLength(1);
    expect(Number(movements[0].quantity)).toBe(1998);
    expect(movements[0].reason).toContain('2.000 kg = 2000.000 g');

    // Resep lama tetap terbaca dan tetap kompatibel.
    const detail = await request(app).get(`/api/products/${product.id}`).set(auth(operatorToken));
    expect(detail.body.product.recipe[0].recipeUnit).toBe('g');
  });

  it('pindah ke satuan Manual memakai stok eksplisit dan tercatat tanpa konversi', async () => {
    const material = await createMaterial('pindah-manual', 'kg');
    await addReceipt(material.id, 2);

    const missing = await request(app)
      .post(`/api/materials/${material.id}/unit-change`)
      .set(auth(adminToken))
      .send({ newUnit: 'bungkus', unitKind: 'manual' });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toContain('adjustment');

    const changed = await request(app)
      .post(`/api/materials/${material.id}/unit-change`)
      .set(auth(adminToken))
      .send({
        newUnit: 'bungkus',
        unitKind: 'manual',
        adjustment: { quantity: 10, reason: 'Stok opname: 10 bungkus' },
      });
    expect(changed.status).toBe(200);
    expect(changed.body.material.unit).toBe('bungkus');
    expect(changed.body.material.isManual).toBe(true);
    expect(changed.body.currentStock).toBe('10.000');
    expect(await stockOf(material.id)).toBe(10);

    const movement = await prisma.materialStockMovement.findFirstOrThrow({
      where: { materialId: material.id, type: 'ADJUSTMENT' },
    });
    expect(Number(movement.quantity)).toBe(10);
    expect(movement.reason).toContain('tanpa konversi');
    expect(movement.reason).toContain('Stok opname: 10 bungkus');
  });
});

describe('Perhitungan produksi dilakukan backend', () => {
  it('resep × jumlah produk dikonversi ke satuan stok sebelum pemotongan', async () => {
    const material = await createMaterial('produksi-resep', 'kg');
    await addReceipt(material.id, 1);
    const product = await createProduct('produksi-resep', [
      { materialId: material.id, quantityPerUnit: 150, recipeUnit: 'g' },
    ]);

    // Klien sengaja TIDAK mengirim quantity: backend yang menghitung 150 g × 2.
    const res = await request(app)
      .post('/api/productions')
      .set(auth(operatorToken))
      .send({
        productId: product.id,
        productionDate: pastDate(),
        expiryDate: expiryDate(),
        yieldQuantity: 2,
        materials: [{ materialId: material.id, mode: 'recipe' }],
      });
    expect(res.status).toBe(201);

    const usage = await prisma.productionMaterialUsage.findFirstOrThrow({
      where: { productionId: res.body.production.id },
    });
    expect(usage.quantity.toString()).toBe('0.3');
    expect(usage.inputQuantity?.toString()).toBe('300');
    expect(usage.inputUnit).toBe('g');
    expect(await stockOf(material.id)).toBe(0.7);
  });

  it('input manual tetap dikonversi dan divalidasi backend', async () => {
    const material = await createMaterial('produksi-manual', 'kg');
    await addReceipt(material.id, 1);
    const product = await createProduct('produksi-manual', [
      { materialId: material.id, quantityPerUnit: 150, recipeUnit: 'g' },
    ]);

    const res = await request(app)
      .post('/api/productions')
      .set(auth(operatorToken))
      .send({
        productId: product.id,
        productionDate: pastDate(),
        expiryDate: expiryDate(),
        yieldQuantity: 2,
        materials: [{ materialId: material.id, mode: 'manual', quantity: 200, unit: 'g' }],
      });
    expect(res.status).toBe(201);
    const usage = await prisma.productionMaterialUsage.findFirstOrThrow({
      where: { productionId: res.body.production.id },
    });
    expect(usage.quantity.toString()).toBe('0.2');
    expect(usage.inputUnit).toBe('g');
  });

  it('bahan Manual hanya dicatat manual dan tidak dikonversi', async () => {
    const material = await createMaterial('produksi-manual-teks', 'bungkus', 'manual');
    await addReceipt(material.id, 5);
    const product = await createProduct('produksi-manual-teks', []);

    const auto = await request(app)
      .post('/api/productions')
      .set(auth(operatorToken))
      .send({
        productId: product.id,
        productionDate: pastDate(),
        expiryDate: expiryDate(),
        yieldQuantity: 1,
        materials: [{ materialId: material.id, mode: 'recipe' }],
      });
    expect(auto.status).toBe(400);
    expect(auto.body.message).toContain('manual');

    const res = await request(app)
      .post('/api/productions')
      .set(auth(operatorToken))
      .send({
        productId: product.id,
        productionDate: pastDate(),
        expiryDate: expiryDate(),
        yieldQuantity: 1,
        materials: [{ materialId: material.id, mode: 'manual', quantity: 2, unit: 'bungkus' }],
      });
    expect(res.status).toBe(201);
    const usage = await prisma.productionMaterialUsage.findFirstOrThrow({
      where: { productionId: res.body.production.id },
    });
    expect(usage.quantity.toString()).toBe('2');
    expect(usage.inputQuantity?.toString()).toBe('2');
    expect(usage.inputUnit).toBe('bungkus');
    expect(await stockOf(material.id)).toBe(3);
  });

  it('stok kurang setelah konversi ditolak dan tidak ada yang berkurang', async () => {
    const cukup = await createMaterial('atomik-a', 'kg');
    const kurang = await createMaterial('atomik-b', 'kg');
    await addReceipt(cukup.id, 10);
    await addReceipt(kurang.id, 0.1);
    const product = await createProduct('atomik', [
      { materialId: cukup.id, quantityPerUnit: 100, recipeUnit: 'g' },
      { materialId: kurang.id, quantityPerUnit: 500, recipeUnit: 'g' },
    ]);

    const before = await prisma.production.count({ where: { productId: product.id } });
    const res = await request(app)
      .post('/api/productions')
      .set(auth(operatorToken))
      .send({
        productId: product.id,
        productionDate: pastDate(),
        expiryDate: expiryDate(),
        yieldQuantity: 5,
        materials: [
          { materialId: cukup.id, mode: 'recipe' },
          { materialId: kurang.id, mode: 'recipe' },
        ],
      });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/tidak mencukupi/);
    expect(await prisma.production.count({ where: { productId: product.id } })).toBe(before);
    expect(await stockOf(cukup.id)).toBe(10);
    expect(await stockOf(kurang.id)).toBe(0.1);
  });
});

describe('Penandaan data satuan lama', () => {
  it('hanya Admin yang bisa melihat dan menandai data ambigu', async () => {
    const forbidden = await request(app).get('/api/admin/unit-reviews').set(auth(operatorToken));
    expect(forbidden.status).toBe(403);

    const review = await prisma.unitReview.create({
      data: {
        entityType: 'PRODUCTION_MATERIAL_USAGE',
        entityId: `${runId}-legacy`,
        field: 'inputUnit',
        reason: 'Uji penandaan.',
      },
    });

    const list = await request(app).get('/api/admin/unit-reviews').set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data.some((r: { id: string }) => r.id === review.id)).toBe(true);

    const reviewed = await request(app)
      .patch(`/api/admin/unit-reviews/${review.id}/review`)
      .set(auth(adminToken))
      .send({ note: 'Sudah diperiksa.' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.review.note).toBe('Sudah diperiksa.');
    expect(reviewed.body.review.reviewedAt).toBeTruthy();
  });
});

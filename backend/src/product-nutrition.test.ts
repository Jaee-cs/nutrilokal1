/**
 * Pengujian integrasi fitur Informasi Nilai Gizi Produk.
 * - Admin dapat menambah/mengubah nilai gizi; Operator tidak dapat mengubah.
 * - Nilai kosong tidak dianggap nol; komponen kosong tidak disimpan.
 * - Produk lama tanpa nilai gizi tetap berfungsi.
 * - Perubahan tercermin di halaman publik/QR produk tanpa ganti QR.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';

const app = createApp();
const runId = `nutri-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let adminToken = '';
let operatorToken = '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

const baseProduct = (suffix: string) => ({
  name: `${runId}-${suffix}`,
  unit: 'pcs',
  sellingPrice: 10000,
});

const sampleNutrition = {
  servingSizeAmount: 30,
  servingSizeUnit: 'g',
  servingsPerPackage: 4,
  components: [
    { name: 'Energi Total', amount: 120, unit: 'kkal', akgPercent: 6 },
    { name: 'Lemak Total', amount: 2.5, unit: 'g' },
    { name: 'Protein', amount: 1, unit: 'g', akgPercent: 2 },
  ],
};

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
  await prisma.product.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

describe('Informasi nilai gizi produk', () => {
  it('Admin dapat membuat produk dengan nilai gizi dan membacanya kembali', async () => {
    const created = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send({ ...baseProduct('buat'), nutrition: sampleNutrition });
    expect(created.status).toBe(201);
    expect(created.body.product.nutrition).toMatchObject({
      servingSizeAmount: 30,
      servingSizeUnit: 'g',
      servingsPerPackage: 4,
    });
    expect(created.body.product.nutrition.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Energi Total', amount: 120, unit: 'kkal', akgPercent: 6 }),
      ])
    );

    const detail = await request(app)
      .get(`/api/products/${created.body.product.id}`)
      .set(auth(operatorToken));
    expect(detail.status).toBe(200);
    expect(detail.body.product.nutrition.servingSizeAmount).toBe(30);
  });

  it('nilai kosong tidak dianggap nol dan komponen/baris kosong tidak disimpan', async () => {
    const created = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send({
        ...baseProduct('kosong'),
        nutrition: {
          servingSizeAmount: '',
          servingSizeUnit: '  ',
          servingsPerPackage: null,
          components: [
            { name: 'Protein', amount: '', unit: '', akgPercent: '' }, // kosong -> diabaikan
            { name: '  ' }, // kosong -> diabaikan
            { name: 'Natrium', amount: '', unit: 'mg', akgPercent: '' }, // ada nilai bermakna (satuan)
          ],
        },
      });
    expect(created.status).toBe(201);
    expect(created.body.product.nutrition).toEqual({
      components: [{ name: 'Natrium', unit: 'mg' }],
    });
    expect(created.body.product.nutrition.servingSizeAmount).toBeUndefined();
    expect(created.body.product.nutrition.servingsPerPackage).toBeUndefined();
  });

  it('Admin dapat mengedit, menambah, dan menghapus komponen gizi', async () => {
    const created = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send({ ...baseProduct('edit'), nutrition: sampleNutrition });
    expect(created.status).toBe(201);
    const id = created.body.product.id as string;

    const updated = await request(app)
      .patch(`/api/products/${id}`)
      .set(auth(adminToken))
      .send({
        nutrition: {
          servingSizeAmount: 25,
          servingSizeUnit: 'ml',
          servingsPerPackage: 5,
          components: [
            { name: 'Energi Total', amount: 90, unit: 'kkal' },
            { name: 'Vitamin C', amount: 10, unit: 'mg', akgPercent: 15 },
          ],
        },
      });
    expect(updated.status).toBe(200);
    expect(updated.body.product.nutrition.servingSizeAmount).toBe(25);
    expect(updated.body.product.nutrition.components).toHaveLength(2);
    expect(updated.body.product.nutrition.components).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Vitamin C', akgPercent: 15 })])
    );

    const cleared = await request(app)
      .patch(`/api/products/${id}`)
      .set(auth(adminToken))
      .send({ nutrition: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.product.nutrition).toBeNull();
  });

  it('produk lama tanpa nilai gizi tetap berfungsi dan publik tidak menampilkan tabel', async () => {
    const created = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send(baseProduct('lama'));
    expect(created.status).toBe(201);
    expect(created.body.product.nutrition).toBeNull();

    const publicRes = await request(app).get(`/api/public/products/${created.body.product.id}`);
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.product.nutrition).toBeUndefined();
  });

  it('perubahan nilai gizi langsung tercermin di halaman publik produk (QR)', async () => {
    const created = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send(baseProduct('publik'));
    const id = created.body.product.id as string;

    const before = await request(app).get(`/api/public/products/${id}`);
    expect(before.status).toBe(200);
    expect(before.body.product.nutrition).toBeUndefined();

    await request(app)
      .patch(`/api/products/${id}`)
      .set(auth(adminToken))
      .send({ nutrition: sampleNutrition });

    const after = await request(app).get(`/api/public/products/${id}`);
    expect(after.status).toBe(200);
    expect(after.body.product.nutrition.servingSizeAmount).toBe(30);
    expect(after.body.product.nutrition.components[0].name).toBe('Energi Total');

    await request(app).patch(`/api/products/${id}`).set(auth(adminToken)).send({ nutrition: null });
    const cleared = await request(app).get(`/api/public/products/${id}`);
    expect(cleared.body.product.nutrition).toBeUndefined();
  });

  it('Operator tidak dapat menambah/mengubah nilai gizi; validasi angka/satuan ditolak', async () => {
    const deniedCreate = await request(app)
      .post('/api/products')
      .set(auth(operatorToken))
      .send({ ...baseProduct('op'), nutrition: sampleNutrition });
    expect(deniedCreate.status).toBe(403);

    const created = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .send(baseProduct('val'));
    const id = created.body.product.id as string;

    const deniedPatch = await request(app)
      .patch(`/api/products/${id}`)
      .set(auth(operatorToken))
      .send({ nutrition: sampleNutrition });
    expect(deniedPatch.status).toBe(403);

    const badNumber = await request(app)
      .patch(`/api/products/${id}`)
      .set(auth(adminToken))
      .send({ nutrition: { components: [{ name: 'Protein', amount: -1, unit: 'g' }] } });
    expect(badNumber.status).toBe(400);

    const badAkg = await request(app)
      .patch(`/api/products/${id}`)
      .set(auth(adminToken))
      .send({ nutrition: { components: [{ name: 'Protein', akgPercent: 'x' }] } });
    expect(badAkg.status).toBe(400);

    const missingName = await request(app)
      .patch(`/api/products/${id}`)
      .set(auth(adminToken))
      .send({ nutrition: { components: [{ amount: 1, unit: 'g' }] } });
    expect(missingName.status).toBe(400);
  });
});

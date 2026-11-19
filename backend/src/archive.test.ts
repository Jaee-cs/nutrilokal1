/**
 * Pengujian integrasi fitur Arsip (soft archive).
 *
 * Menjamin: arsip bukan hapus permanen, ID/relasi/riwayat tetap utuh,
 * hak aksip Admin ditegakkan di backend, data arsip tidak dipakai operasi
 * baru, dan pemulihan menolak konflik identitas tanpa menimpa data aktif.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';

const app = createApp();
const runId = `arsip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken = '';
let operatorToken = '';
let adminId = '';
let operatorId = '';

function login(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

async function createProduct(suffix: string, name = `${runId}-produk-${suffix}`) {
  const res = await request(app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name, description: 'Deskripsi uji arsip', unit: 'pcs', sellingPrice: 12500 });
  expect(res.status).toBe(201);
  return res.body.product as { id: string; name: string; isActive: boolean };
}

async function createMaterial(suffix: string) {
  const res = await request(app)
    .post('/api/materials')
    .set(auth(adminToken))
    .send({ name: `${runId}-bahan-${suffix}`, unit: 'kg' });
  expect(res.status).toBe(201);
  return res.body.material as { id: string; name: string; isActive: boolean };
}

async function createOperator(suffix: string) {
  const username = `${runId}-operator-${suffix}`;
  const res = await request(app)
    .post('/api/users')
    .set(auth(adminToken))
    .send({ username, password: 'operator-rahasia-123', name: 'Operator Uji Arsip' });
  expect(res.status).toBe(201);
  return { username, id: res.body.user.id as string };
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      username: `${runId}-admin`,
      passwordHash: await hashPassword('admin-rahasia-123'),
      role: 'ADMIN',
    },
  });
  const operator = await prisma.user.create({
    data: {
      username: `${runId}-operator-utama`,
      passwordHash: await hashPassword('operator-rahasia-123'),
      role: 'OPERATOR',
    },
  });
  adminId = admin.id;
  operatorId = operator.id;
  adminToken = (await login(admin.username, 'admin-rahasia-123')).body.token;
  operatorToken = (await login(operator.username, 'operator-rahasia-123')).body.token;
  expect(adminToken).toBeTruthy();
  expect(operatorToken).toBeTruthy();
});

afterAll(async () => {
  const productIds = (
    await prisma.product.findMany({ where: { name: { startsWith: runId } }, select: { id: true } })
  ).map((row) => row.id);
  const materialIds = (
    await prisma.material.findMany({ where: { name: { startsWith: runId } }, select: { id: true } })
  ).map((row) => row.id);

  const batches = await prisma.batch.findMany({
    where: { productId: { in: productIds } },
    select: { id: true },
  });
  const batchIds = batches.map((row) => row.id);
  await prisma.batchStockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchOpeningBalance.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.qrPublication.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });

  await prisma.materialStockMovement.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialReceipt.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialStock.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.productRecipeItem.deleteMany({
    where: { OR: [{ productId: { in: productIds } }, { materialId: { in: materialIds } }] },
  });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.material.deleteMany({ where: { id: { in: materialIds } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

describe('Arsip — alur utama', () => {
  it('1 & 9. Admin mengarsipkan dan memulihkan produk dengan ID yang sama (tanpa duplikat)', async () => {
    const product = await createProduct('arsip-produk');
    const before = await prisma.product.count({ where: { name: product.name } });

    const archived = await request(app)
      .post(`/api/archive/products/${product.id}/archive`)
      .set(auth(adminToken))
      .send({ reason: 'Produk tidak diproduksi lagi' });
    expect(archived.status).toBe(200);
    expect(archived.body.data.isActive).toBe(false);
    expect(archived.body.data.archivedAt).toBeTruthy();
    expect(archived.body.data.archivedById).toBe(adminId);
    expect(archived.body.data.archiveReason).toBe('Produk tidak diproduksi lagi');

    const restored = await request(app)
      .post(`/api/archive/products/${product.id}/restore`)
      .set(auth(adminToken));
    expect(restored.status).toBe(200);
    expect(restored.body.data.id).toBe(product.id);
    expect(restored.body.data.isActive).toBe(true);
    expect(restored.body.data.archivedAt).toBeNull();
    expect(await prisma.product.count({ where: { name: product.name } })).toBe(before);
  });

  it('2 & 6. Admin mengarsipkan dan memulihkan bahan baku; saldo dan riwayat tetap utuh', async () => {
    const material = await createMaterial('arsip-bahan');
    const receipt = await request(app)
      .post(`/api/materials/${material.id}/receipts`)
      .set(auth(adminToken))
      .send({ quantity: 7, receivedAt: '2026-10-20', note: 'Penerimaan uji arsip' });
    expect(receipt.status).toBe(201);

    const archived = await request(app)
      .post(`/api/archive/materials/${material.id}/archive`)
      .set(auth(adminToken))
      .send({ reason: 'Supplier berhenti' });
    expect(archived.status).toBe(200);
    expect(archived.body.warning).toMatch(/saldo stok/i);

    const stock = await prisma.materialStock.findUnique({ where: { materialId: material.id } });
    expect(Number(stock?.quantity)).toBe(7);
    expect(await prisma.materialReceipt.count({ where: { materialId: material.id } })).toBe(1);
    expect(await prisma.materialStockMovement.count({ where: { materialId: material.id } })).toBeGreaterThan(0);

    const restored = await request(app)
      .post(`/api/archive/materials/${material.id}/restore`)
      .set(auth(adminToken));
    expect(restored.status).toBe(200);
    expect(restored.body.data.id).toBe(material.id);
    expect(restored.body.data.unit).toBe('kg');
    expect(Number((await prisma.materialStock.findUnique({ where: { materialId: material.id } }))?.quantity)).toBe(7);
  });

  it('3. Admin mengarsipkan dan memulihkan akun Operator; sesi langsung dicabut', async () => {
    const operator = await createOperator('arsip');
    const token = (await login(operator.username, 'operator-rahasia-123')).body.token;
    expect(token).toBeTruthy();

    const archived = await request(app)
      .post(`/api/archive/users/${operator.id}/archive`)
      .set(auth(adminToken))
      .send({ reason: 'Tidak aktif' });
    expect(archived.status).toBe(200);
    expect(archived.body.data.isActive).toBe(false);
    expect(archived.body.warning).toMatch(/sesi/i);

    const blocked = await request(app).get('/api/auth/me').set(auth(token));
    expect(blocked.status).toBe(401);

    const restored = await request(app)
      .post(`/api/archive/users/${operator.id}/restore`)
      .set(auth(adminToken));
    expect(restored.status).toBe(200);
    expect(restored.body.data.id).toBe(operator.id);
    expect(restored.body.data.username).toBe(operator.username);
    expect((await login(operator.username, 'operator-rahasia-123')).status).toBe(200);
  });

  it('4. Operator dan permintaan tanpa token ditolak oleh backend (403/401)', async () => {
    const paths = ['/api/archive/summary', '/api/archive/products', '/api/archive/materials/:id', '/api/archive/users'];
    for (const path of paths) {
      const target = path.replace(':id', 'id-bebas');
      expect((await request(app).get(target).set(auth(operatorToken))).status).toBe(403);
      expect((await request(app).get(target)).status).toBe(401);
      expect(
        (await request(app).post(`${target}/archive`).set(auth(operatorToken)).send({})).status
      ).toBe(403);
      expect(
        (await request(app).post(`${target}/restore`).set(auth(operatorToken))).status
      ).toBe(403);
    }
    expect((await request(app).post('/api/archive/products/id-bebas/archive').set(auth(operatorToken))).status).toBe(403);
  });

  it('5. Data arsip tidak muncul pada daftar/pilihan operasional baru', async () => {
    const product = await createProduct('tidak-muncul');
    const material = await createMaterial('tidak-muncul');
    const operator = await createOperator('tidak-muncul');

    await request(app).post(`/api/archive/products/${product.id}/archive`).set(auth(adminToken));
    await request(app).post(`/api/archive/materials/${material.id}/archive`).set(auth(adminToken));
    await request(app).post(`/api/archive/users/${operator.id}/archive`).set(auth(adminToken));

    const products = await request(app).get('/api/products').set(auth(adminToken));
    const materials = await request(app).get('/api/materials').set(auth(adminToken));
    const users = await request(app).get('/api/users').set(auth(adminToken));
    expect(products.body.data.some((row: { id: string }) => row.id === product.id)).toBe(false);
    expect(materials.body.data.some((row: { id: string }) => row.id === material.id)).toBe(false);
    expect(users.body.data.some((row: { id: string }) => row.id === operator.id)).toBe(false);

    const archivedList = await request(app).get('/api/archive/products').set(auth(adminToken));
    expect(archivedList.body.data.some((row: { id: string }) => row.id === product.id)).toBe(true);
  });

  it('7. Riwayat produksi dan transaksi tetap dapat diakses setelah master diarsipkan', async () => {
    const product = await createProduct('riwayat');
    const material = await createMaterial('riwayat-produksi');
    const batch = await request(app)
      .post('/api/batches/opening-stock')
      .set(auth(adminToken))
      .send({ productId: product.id, quantity: 5, note: 'Stok awal uji arsip' });
    expect(batch.status).toBe(201);
    const batchId = batch.body.batch.id as string;

    await request(app).post(`/api/archive/products/${product.id}/archive`).set(auth(adminToken));
    await request(app).post(`/api/archive/materials/${material.id}/archive`).set(auth(adminToken));

    const history = await request(app)
      .get(`/api/products/${product.id}/stock-movements`)
      .set(auth(adminToken));
    expect(history.status).toBe(200);
    expect(Array.isArray(history.body.data ?? history.body.movements)).toBe(true);

    const batchDetail = await request(app).get(`/api/batches/${batchId}`).set(auth(adminToken));
    expect(batchDetail.status).toBe(200);
    expect(batchDetail.body.batch.product.name).toBe(product.name);
  });

  it('8. QR/URL publik produk memakai ID lama; halaman publik berstatus tidak tersedia saat arsip', async () => {
    const product = await createProduct('qr');
    const publicBefore = await request(app).get(`/api/public/products/${product.id}`);
    expect(publicBefore.status).toBe(200);

    await request(app).post(`/api/archive/products/${product.id}/archive`).set(auth(adminToken));
    const publicArchived = await request(app).get(`/api/public/products/${product.id}`);
    expect(publicArchived.status).toBe(404);

    const detail = await request(app).get(`/api/archive/products/${product.id}`).set(auth(adminToken));
    expect(detail.body.product.id).toBe(product.id);

    await request(app).post(`/api/archive/products/${product.id}/restore`).set(auth(adminToken));
    // URL publik `/produk/:id` tidak berubah: endpoint yang sama kembali
    // tersedia dengan identitas produk lama (bukan produk/QR baru).
    const publicAfter = await request(app).get(`/api/public/products/${product.id}`);
    expect(publicAfter.status).toBe(200);
    expect(publicAfter.body.product.name).toBe(product.name);
    expect(await prisma.product.count({ where: { id: product.id } })).toBe(1);
  });

  it('10. Konflik nama saat pemulihan ditolak (409) tanpa menimpa data aktif', async () => {
    const name = `${runId}-produk-konflik`;
    const archivedProduct = await createProduct('konflik-arsip', name);
    await request(app).post(`/api/archive/products/${archivedProduct.id}/archive`).set(auth(adminToken));

    const activeProduct = await createProduct('konflik-aktif', name);
    const conflict = await request(app)
      .post(`/api/archive/products/${archivedProduct.id}/restore`)
      .set(auth(adminToken));
    expect(conflict.status).toBe(409);
    expect(conflict.body.message).toMatch(/sudah dipakai produk aktif/i);
    expect(conflict.body.message).toMatch(/ubah nama/i);

    const stillArchived = await prisma.product.findUniqueOrThrow({ where: { id: archivedProduct.id } });
    expect(stillArchived.isActive).toBe(false);
    const active = await prisma.product.findUniqueOrThrow({ where: { id: activeProduct.id } });
    expect(active.isActive).toBe(true);
    expect(active.name).toBe(name);
  });

  it('11. Tidak ada hapus permanen: DELETE berulang tetap mengarsipkan dan baris tetap ada', async () => {
    const product = await createProduct('delete-compat');
    const material = await createMaterial('delete-compat');
    const operator = await createOperator('delete-compat');

    for (const path of ['products', 'materials', 'users']) {
      const id =
        path === 'products' ? product.id : path === 'materials' ? material.id : operator.id;
      const first = await request(app).delete(`/api/${path}/${id}`).set(auth(adminToken));
      expect(first.status).toBe(200);
      expect(first.body.archived).toBe(true);
      const second = await request(app).delete(`/api/${path}/${id}`).set(auth(adminToken));
      expect(second.status).toBe(200);
      expect(second.body.archived).toBe(true);
    }

    expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    expect(await prisma.material.findUnique({ where: { id: material.id } })).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: operator.id } })).not.toBeNull();
  });

  it('Admin yang sedang dipakai tidak dapat diarsipkan', async () => {
    const self = await request(app)
      .post(`/api/archive/users/${adminId}/archive`)
      .set(auth(adminToken));
    expect(self.status).toBe(400);

    const otherAdmin = await prisma.user.create({
      data: {
        username: `${runId}-admin-lain`,
        passwordHash: await hashPassword('admin-rahasia-123'),
        role: 'ADMIN',
      },
    });
    const other = await request(app)
      .post(`/api/archive/users/${otherAdmin.id}/archive`)
      .set(auth(adminToken));
    expect(other.status).toBe(403);
  });

  it('Daftar arsip diurutkan terbaru ke terlama (data lama tanpa tanggal di bawah)', async () => {
    const newest = await createProduct('urutan-baru');
    const older = await createProduct('urutan-lama');
    const legacy = await createProduct('urutan-legacy');

    for (const product of [newest, older, legacy]) {
      const archived = await request(app)
        .post(`/api/archive/products/${product.id}/archive`)
        .set(auth(adminToken));
      expect(archived.status).toBe(200);
    }

    await prisma.product.update({
      where: { id: newest.id },
      data: { archivedAt: new Date('2026-11-18T10:00:00.000Z') },
    });
    await prisma.product.update({
      where: { id: older.id },
      data: { archivedAt: new Date('2026-11-01T10:00:00.000Z') },
    });
    // Data yang sudah nonaktif sebelum kolom arsip ada tidak punya tanggal.
    await prisma.product.update({ where: { id: legacy.id }, data: { archivedAt: null } });

    const list = await request(app)
      .get('/api/archive/products')
      .query({ search: runId, pageSize: 100 })
      .set(auth(adminToken));
    expect(list.status).toBe(200);

    const ids = (list.body.data as Array<{ id: string }>).map((row) => row.id);
    expect(ids.indexOf(newest.id)).toBeLessThan(ids.indexOf(older.id));
    expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(legacy.id));
  });
});

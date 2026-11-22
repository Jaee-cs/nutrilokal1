/**
 * Pengujian integrasi penghapusan permanen terbatas dari Arsip.
 *
 * Fokus: validasi menyeluruh di backend, transaksi aman, Operator ditolak,
 * dan riwayat/data lain tidak ikut terhapus.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';

const app = createApp();
const runId = `hapus-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let adminToken = '';
let operatorToken = '';
let adminId = '';

type Kind = 'products' | 'materials' | 'users';

function login(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

async function createProduct(suffix: string) {
  const res = await request(app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name: `${runId}-produk-${suffix}`, unit: 'pcs', sellingPrice: 12000 });
  expect(res.status).toBe(201);
  return res.body.product as { id: string; name: string };
}

async function createMaterial(suffix: string) {
  const res = await request(app)
    .post('/api/materials')
    .set(auth(adminToken))
    .send({ name: `${runId}-bahan-${suffix}`, unit: 'kg' });
  expect(res.status).toBe(201);
  return res.body.material as { id: string; name: string };
}

async function createOperator(suffix: string) {
  const username = `${runId}-operator-${suffix}`;
  const res = await request(app)
    .post('/api/users')
    .set(auth(adminToken))
    .send({ username, password: 'operator-rahasia-123', name: 'Operator Uji Hapus' });
  expect(res.status).toBe(201);
  return { username, id: res.body.user.id as string };
}

async function archive(kind: Kind, id: string) {
  const res = await request(app)
    .post(`/api/archive/${kind}/${id}/archive`)
    .set(auth(adminToken))
    .send({ reason: 'Uji penghapusan permanen' });
  expect(res.status).toBe(200);
}

function remove(kind: Kind, id: string, token = adminToken) {
  return request(app).delete(`/api/archive/${kind}/${id}`).set(auth(token));
}

function removeDirect(id: string, token = adminToken) {
  return request(app).delete(`/api/products/${id}/permanent`).set(auth(token));
}

async function createBatch(productId: string, suffix: string) {
  return prisma.batch.create({
    data: {
      code: `${runId}-batch-${suffix}`,
      productId,
      stockQuantity: 0,
    },
  });
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
  const userIds = (
    await prisma.user.findMany({ where: { username: { startsWith: runId } }, select: { id: true } })
  ).map((row) => row.id);
  const batchIds = (
    await prisma.batch.findMany({ where: { productId: { in: productIds } }, select: { id: true } })
  ).map((row) => row.id);
  const productionIds = (
    await prisma.production.findMany({ where: { productId: { in: productIds } }, select: { id: true } })
  ).map((row) => row.id);
  const txIds = (
    await prisma.saleTransaction.findMany({ where: { recordedById: { in: userIds } }, select: { id: true } })
  ).map((row) => row.id);

  await prisma.saleAllocation.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.saleItem.deleteMany({
    where: { OR: [{ transactionId: { in: txIds } }, { productId: { in: productIds } }] },
  });
  await prisma.saleTransaction.deleteMany({ where: { id: { in: txIds } } });
  await prisma.batchStockMovement.deleteMany({
    where: { OR: [{ batchId: { in: batchIds } }, { productionId: { in: productionIds } }] },
  });
  await prisma.batchOpeningBalance.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchExpiryChange.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.qrPublication.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.stockAdjustment.deleteMany({
    where: { OR: [{ materialId: { in: materialIds } }, { batchId: { in: batchIds } }] },
  });
  await prisma.productionCorrection.deleteMany({ where: { productionId: { in: productionIds } } });
  await prisma.productionMaterialUsage.deleteMany({
    where: { OR: [{ productionId: { in: productionIds } }, { materialId: { in: materialIds } }] },
  });
  await prisma.production.deleteMany({ where: { id: { in: productionIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.materialStockMovement.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialReceipt.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialOpeningBalance.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialStock.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.productRecipeItem.deleteMany({
    where: { OR: [{ productId: { in: productIds } }, { materialId: { in: materialIds } }] },
  });
  await prisma.unitReview.deleteMany({
    where: {
      OR: [
        { entityId: { in: [...productIds, ...materialIds] } },
        { reviewedById: { in: userIds } },
      ],
    },
  });
  await prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.material.deleteMany({ where: { id: { in: materialIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe('Hapus permanen terbatas dari Arsip', () => {
  it('1. Produk tanpa riwayat dapat dihapus permanen; resepnya ikut dibersihkan', async () => {
    const material = await createMaterial('resep');
    const product = await createProduct('bersih');
    await prisma.productRecipeItem.create({
      data: {
        productId: product.id,
        materialId: material.id,
        quantityPerUnit: 1,
        recipeUnit: 'kg',
      },
    });
    await archive('products', product.id);

    const res = await remove('products', product.id);
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('berhasil dihapus permanen');
    expect(await prisma.product.findUnique({ where: { id: product.id } })).toBeNull();
    expect(
      await prisma.productRecipeItem.count({ where: { productId: product.id } })
    ).toBe(0);
    expect(await prisma.material.findUnique({ where: { id: material.id } })).not.toBeNull();
  });

  it('2. Produk dengan riwayat produksi ditolak dan tetap di Arsip', async () => {
    const product = await createProduct('produksi');
    await archive('products', product.id);
    await prisma.production.create({
      data: {
        productId: product.id,
        productionDate: new Date(),
        yieldQuantity: 2,
        recordedById: adminId,
      },
    });

    const res = await remove('products', product.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('riwayat produksi');
    expect(res.body.message).toContain('Data tetap tersimpan di Arsip');
    expect(res.body.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'riwayat produksi', count: 1 })])
    );
    expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
  });

  it('3. Produk dengan riwayat penjualan ditolak', async () => {
    const product = await createProduct('penjualan');
    await archive('products', product.id);
    const tx = await prisma.saleTransaction.create({
      data: { total: 12000, recordedById: adminId },
    });
    await prisma.saleItem.create({
      data: {
        transactionId: tx.id,
        productId: product.id,
        quantity: 1,
        unitPrice: 12000,
      },
    });

    const res = await remove('products', product.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('riwayat penjualan');
    expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    expect(await prisma.saleItem.count({ where: { transactionId: tx.id } })).toBe(1);
  });

  it('4. Bahan baku tanpa saldo dan tanpa riwayat dapat dihapus permanen', async () => {
    const material = await createMaterial('bersih');
    await archive('materials', material.id);

    const res = await remove('materials', material.id);
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('berhasil dihapus permanen');
    expect(await prisma.material.findUnique({ where: { id: material.id } })).toBeNull();
  });

  it('5. Bahan baku dengan saldo dan riwayat ditolak', async () => {
    const material = await createMaterial('saldo');
    await archive('materials', material.id);
    const receipt = await prisma.materialReceipt.create({
      data: {
        materialId: material.id,
        quantity: 5,
        receivedAt: new Date(),
        recordedById: adminId,
      },
    });
    await prisma.materialStockMovement.create({
      data: {
        materialId: material.id,
        type: 'RECEIPT',
        quantity: 5,
        occurredAt: new Date(),
        recordedById: adminId,
        receiptId: receipt.id,
      },
    });
    await prisma.materialStock.create({ data: { materialId: material.id, quantity: 5 } });

    const res = await remove('materials', material.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('saldo stok');
    expect(res.body.message).toContain('riwayat penerimaan');
    expect(res.body.message).toContain('riwayat pergerakan stok');
    expect(await prisma.material.findUnique({ where: { id: material.id } })).not.toBeNull();
  });

  it('6. Akun dengan riwayat aktivitas ditolak; akun tanpa riwayat boleh dihapus', async () => {
    const withHistory = await createOperator('riwayat');
    const material = await createMaterial('aktivitas');
    await archive('users', withHistory.id);
    await prisma.materialReceipt.create({
      data: {
        materialId: material.id,
        quantity: 1,
        receivedAt: new Date(),
        recordedById: withHistory.id,
      },
    });

    const rejected = await remove('users', withHistory.id);
    expect(rejected.status).toBe(409);
    expect(rejected.body.message).toContain('riwayat penerimaan bahan baku');
    expect(await prisma.user.findUnique({ where: { id: withHistory.id } })).not.toBeNull();

    const clean = await createOperator('bersih');
    await archive('users', clean.id);
    const ok = await remove('users', clean.id);
    expect(ok.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: clean.id } })).toBeNull();
  });

  it('7. Akun Admin dan akun sendiri tidak dapat dihapus permanen', async () => {
    const self = await remove('users', adminId);
    expect(self.status).toBe(400);

    const secondAdmin = await prisma.user.create({
      data: {
        username: `${runId}-admin-kedua`,
        passwordHash: await hashPassword('admin-rahasia-123'),
        role: 'ADMIN',
        isActive: false,
        archivedAt: new Date(),
        archivedById: adminId,
      },
    });
    const other = await remove('users', secondAdmin.id);
    expect(other.status).toBe(403);
    expect(other.body.message).toContain('Akun Admin');
    expect(await prisma.user.findUnique({ where: { id: secondAdmin.id } })).not.toBeNull();
  });

  it('8. Operator tidak dapat memakai endpoint hapus permanen', async () => {
    const product = await createProduct('operator');
    await archive('products', product.id);

    const res = await remove('products', product.id, operatorToken);
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Hanya Admin');
    expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
  });

  it('9. Penghapusan yang memenuhi syarat tidak mengubah data dan riwayat lain', async () => {
    const clean = await createProduct('utuh-bersih');
    const withHistory = await createProduct('utuh-riwayat');
    await archive('products', clean.id);
    await archive('products', withHistory.id);
    await prisma.production.create({
      data: {
        productId: withHistory.id,
        productionDate: new Date(),
        yieldQuantity: 3,
        recordedById: adminId,
      },
    });

    const historyBefore = await prisma.production.count({ where: { productId: withHistory.id } });
    const res = await remove('products', clean.id);
    expect(res.status).toBe(200);
    expect(await prisma.product.findUnique({ where: { id: clean.id } })).toBeNull();
    expect(await prisma.product.findUnique({ where: { id: withHistory.id } })).not.toBeNull();
    expect(await prisma.production.count({ where: { productId: withHistory.id } })).toBe(
      historyBefore
    );
  });

  it('10. Penghapusan ulang dan permintaan bersamaan ditangani aman', async () => {
    const product = await createProduct('balapan');
    await archive('products', product.id);

    const results = await Promise.all([
      remove('products', product.id),
      remove('products', product.id),
    ]);
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([200, 404]);
    expect(await prisma.product.findUnique({ where: { id: product.id } })).toBeNull();

    const again = await remove('products', product.id);
    expect(again.status).toBe(404);
    expect(again.body.message).toBe('Produk tidak ditemukan.');
  });

  it('11. Produk arsip dengan stok tersisa ditolak dan tetap di Arsip', async () => {
    const product = await createProduct('stok-tersisa');
    await archive('products', product.id);
    await prisma.batch.create({
      data: {
        code: `${runId}-batch-stok-tersisa`,
        productId: product.id,
        stockQuantity: 7,
      },
    });

    const res = await remove('products', product.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('stok tersisa');
    expect(res.body.message).toContain('Data tetap tersimpan di Arsip.');
    expect(res.body.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'stok tersisa', count: 1 })])
    );
    expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    expect(
      await prisma.batch.count({ where: { productId: product.id, stockQuantity: 7 } })
    ).toBe(1);
  });
});

describe('Hapus permanen langsung dari daftar produk aktif', () => {
  it('1. Produk aktif tanpa riwayat dan tanpa stok dapat dihapus permanen', async () => {
    const material = await createMaterial('resep-langsung');
    const product = await createProduct('bersih-langsung');
    await prisma.productRecipeItem.create({
      data: {
        productId: product.id,
        materialId: material.id,
        quantityPerUnit: 1,
        recipeUnit: 'kg',
      },
    });

    const res = await removeDirect(product.id);
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('berhasil dihapus permanen');
    expect(await prisma.product.findUnique({ where: { id: product.id } })).toBeNull();
    expect(
      await prisma.productRecipeItem.count({ where: { productId: product.id } })
    ).toBe(0);
    expect(await prisma.material.findUnique({ where: { id: material.id } })).not.toBeNull();
  });

  it('2. Produk dengan riwayat produksi ditolak dan diarahkan ke Arsipkan', async () => {
    const product = await createProduct('produksi-langsung');
    await prisma.production.create({
      data: {
        productId: product.id,
        productionDate: new Date(),
        yieldQuantity: 2,
        recordedById: adminId,
      },
    });

    const res = await removeDirect(product.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('riwayat produksi');
    expect(res.body.message).toContain('Gunakan Arsipkan');
    expect(res.body.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'riwayat produksi', count: 1 })])
    );
    expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
  });

  it('3. Produk dengan riwayat penjualan ditolak', async () => {
    const product = await createProduct('penjualan-langsung');
    const tx = await prisma.saleTransaction.create({
      data: { total: 12000, recordedById: adminId },
    });
    await prisma.saleItem.create({
      data: {
        transactionId: tx.id,
        productId: product.id,
        quantity: 1,
        unitPrice: 12000,
      },
    });

    const res = await removeDirect(product.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('riwayat penjualan');
    expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    expect(await prisma.saleItem.count({ where: { transactionId: tx.id } })).toBe(1);
  });

  it('4. Produk dengan riwayat pergerakan stok ditolak', async () => {
    const product = await createProduct('pergerakan-langsung');
    const batch = await createBatch(product.id, 'pergerakan');
    await prisma.batchStockMovement.create({
      data: {
        batchId: batch.id,
        type: 'OPENING_BALANCE',
        quantity: 5,
        occurredAt: new Date(),
        recordedById: adminId,
      },
    });

    const res = await removeDirect(product.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('riwayat pergerakan stok batch');
    expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
  });

  it('5. Produk yang masih memiliki batch atau stok ditolak', async () => {
    const product = await createProduct('batch-langsung');
    await createBatch(product.id, 'stok');

    const res = await removeDirect(product.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('riwayat stok/batch');
    expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
  });

  it('6. Operator tidak dapat memanggil endpoint hapus permanen lewat API', async () => {
    const product = await createProduct('operator-langsung');

    const res = await removeDirect(product.id, operatorToken);
    expect(res.status).toBe(403);
    expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
  });
});

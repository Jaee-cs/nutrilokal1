/**
 * Pengujian Fase C: riwayat pergerakan stok bahan baku (README 5.4).
 *
 * - GET /api/materials/:id/movements: hanya baca, terbuka untuk Admin dan
 *   Operator, ditolak tanpa token.
 * - Tidak ada endpoint edit/hapus pergerakan stok (riwayat bersifat tetap).
 * - Penyesuaian stok tetap khusus Admin dan wajib mencatat alasan.
 * - Urutan riwayat: kejadian terbaru lebih dulu, deterministik.
 *
 * Konvensi ledger bahan (sama dengan stock.test.ts):
 * RECEIPT/OPENING_BALANCE/PRODUCTION_USAGE disimpan positif (pemakaian
 * mengurangi stok saat dihitung), ADJUSTMENT bernilai tanda.
 *
 * Berjalan terhadap database PostgreSQL lokal (docker compose).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';

const app = createApp();

const runId = `c1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let adminToken = '';
let operatorToken = '';
let adminId = '';
let materialId = '';
let productId = '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Kode tanggal 'YYYY-MM-DD' `offsetDays` dari hari ini (basis UTC). */
function dayCode(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

interface MovementRow {
  id: string;
  materialId: string;
  type: string;
  quantity: number;
  delta: number;
  occurredAt: string;
  recordedAt: string;
  recordedBy: { id: string; username: string; name: string | null };
  reason: string | null;
  sourceId: string | null;
}

function movementsRequest(token?: string) {
  const req = request(app).get(`/api/materials/${materialId}/movements`);
  if (token) req.set(auth(token));
  return req;
}

async function listMovements(token: string): Promise<MovementRow[]> {
  const res = await movementsRequest(token);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.data)).toBe(true);
  return res.body.data as MovementRow[];
}

function findType(rows: MovementRow[], type: string): MovementRow {
  const row = rows.find((r) => r.type === type);
  expect(row, `pergerakan bertipe ${type} tidak ditemukan`).toBeTruthy();
  return row!;
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      username: `${runId}-admin`,
      passwordHash: await hashPassword('admin-rahasia-123'),
      role: 'ADMIN',
    },
  });
  adminId = admin.id;
  await prisma.user.create({
    data: {
      username: `${runId}-operator`,
      passwordHash: await hashPassword('operator-rahasia-123'),
      role: 'OPERATOR',
    },
  });

  adminToken = (
    await request(app).post('/api/auth/login').send({ username: `${runId}-admin`, password: 'admin-rahasia-123' })
  ).body.token;
  operatorToken = (
    await request(app).post('/api/auth/login').send({ username: `${runId}-operator`, password: 'operator-rahasia-123' })
  ).body.token;
  expect(adminToken).toBeTruthy();
  expect(operatorToken).toBeTruthy();

  const materialRes = await request(app)
    .post('/api/materials')
    .set(auth(adminToken))
    .send({ name: `${runId}-bahan`, unit: 'kg' });
  expect(materialRes.status).toBe(201);
  materialId = materialRes.body.material.id;

  const productRes = await request(app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name: `${runId}-produk`, unit: 'pcs', sellingPrice: 15000 });
  expect(productRes.status).toBe(201);
  productId = productRes.body.product.id;

  // Empat pergerakan dengan tanggal kejadian berbeda agar urutan deterministik.
  const opening = await request(app)
    .post(`/api/materials/${materialId}/opening-balances`)
    .set(auth(adminToken))
    .send({ quantity: 10, date: dayCode(-4), reason: 'Saldo awal bahan uji' });
  expect(opening.status).toBe(201);

  const receipt = await request(app)
    .post(`/api/materials/${materialId}/receipts`)
    .set(auth(operatorToken))
    .send({ quantity: 5, receivedAt: dayCode(-3), note: 'Penerimaan bahan uji' });
  expect(receipt.status).toBe(201);

  const production = await request(app)
    .post('/api/productions')
    .set(auth(operatorToken))
    .send({ productId, productionDate: dayCode(-2), yieldQuantity: 6, materials: [{ materialId, quantity: 3 }] });
  expect(production.status).toBe(201);

  const adjustment = await request(app)
    .post('/api/stock-adjustments')
    .set(auth(adminToken))
    .send({ targetType: 'MATERIAL', targetId: materialId, quantity: -2, reason: 'Kerusakan bahan saat penyimpanan' });
  expect(adjustment.status).toBe(201);
});

afterAll(async () => {
  const materials = await prisma.material.findMany({
    where: { name: { startsWith: runId } },
    select: { id: true },
  });
  const materialIds = materials.map((m) => m.id);
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

  // Urutan penghapusan mengikuti arah relasi (tanpa ON DELETE CASCADE).
  await prisma.materialStockMovement.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.batchStockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.stockAdjustment.deleteMany({
    where: { OR: [{ materialId: { in: materialIds } }, { batchId: { in: batchIds } }] },
  });
  await prisma.productionMaterialUsage.deleteMany({ where: { productionId: { in: productionIds } } });
  await prisma.production.deleteMany({ where: { id: { in: productionIds } } });
  await prisma.batchAlias.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchOpeningBalance.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.materialReceipt.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialOpeningBalance.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialStock.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.material.deleteMany({ where: { id: { in: materialIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.idempotencyKey.deleteMany({ where: { userId: { in: [adminId] } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

describe('Akses role ke riwayat pergerakan stok', () => {
  it('menolak permintaan tanpa token dan dengan token rusak (401)', async () => {
    expect((await movementsRequest()).status).toBe(401);
    const broken = await request(app)
      .get(`/api/materials/${materialId}/movements`)
      .set(auth('token-rusak-bukan-jwt.tentu.gagal'));
    expect(broken.status).toBe(401);
  });

  it('Admin dan Operator sama-sama dapat melihat riwayat (200)', async () => {
    const asAdmin = await listMovements(adminToken);
    const asOperator = await listMovements(operatorToken);
    expect(asAdmin).toHaveLength(4);
    expect(asOperator).toHaveLength(4);
    expect(asOperator.map((r) => r.id)).toEqual(asAdmin.map((r) => r.id));
  });

  it('Operator ditolak (403) saat menyesuaikan stok', async () => {
    const res = await request(app)
      .post('/api/stock-adjustments')
      .set(auth(operatorToken))
      .send({ targetType: 'MATERIAL', targetId: materialId, quantity: 1, reason: 'Percobaan operator' });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Hanya Admin yang dapat melakukan aksi ini.');
    expect(await listMovements(operatorToken)).toHaveLength(4);
  });

  it('mengembalikan 404 untuk bahan baku yang tidak ditemukan', async () => {
    const res = await request(app)
      .get('/api/materials/id-tidak-ada/movements')
      .set(auth(adminToken));
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Bahan baku tidak ditemukan.');
  });
});

describe('Isi dan urutan riwayat pergerakan', () => {
  it('urut dari kejadian terbaru ke terlama', async () => {
    const rows = await listMovements(adminToken);

    expect(rows.map((r) => r.type)).toEqual([
      'ADJUSTMENT',
      'PRODUCTION_USAGE',
      'RECEIPT',
      'OPENING_BALANCE',
    ]);

    for (let i = 0; i + 1 < rows.length; i += 1) {
      expect(new Date(rows[i].occurredAt).getTime()).toBeGreaterThanOrEqual(
        new Date(rows[i + 1].occurredAt).getTime()
      );
    }
  });

  it('mencatat jenis, nilai, dampak, waktu, pengguna, dan alasan', async () => {
    const rows = await listMovements(adminToken);

    const opening = findType(rows, 'OPENING_BALANCE');
    expect(opening.quantity).toBe(10);
    expect(opening.delta).toBe(10);
    expect(opening.reason).toBe('Saldo awal bahan uji');
    expect(opening.recordedBy.username).toBe(`${runId}-admin`);
    expect(opening.occurredAt).toBe(`${dayCode(-4)}T00:00:00.000Z`);
    expect(opening.sourceId).toBeTruthy();
    expect(opening.materialId).toBe(materialId);

    const receipt = findType(rows, 'RECEIPT');
    expect(receipt.quantity).toBe(5);
    expect(receipt.delta).toBe(5);
    expect(receipt.reason).toBe('Penerimaan bahan uji');
    expect(receipt.recordedBy.username).toBe(`${runId}-operator`);
    expect(receipt.occurredAt).toBe(`${dayCode(-3)}T00:00:00.000Z`);
    expect(receipt.sourceId).toBeTruthy();

    const usage = findType(rows, 'PRODUCTION_USAGE');
    expect(usage.quantity).toBe(3);
    // Pemakaian disimpan positif tetapi MENURUNKAN stok.
    expect(usage.delta).toBe(-3);
    expect(usage.reason).toContain('Pemakaian produksi');
    expect(usage.recordedBy.username).toBe(`${runId}-operator`);
    expect(usage.occurredAt).toBe(`${dayCode(-2)}T00:00:00.000Z`);
    expect(usage.sourceId).toBeTruthy();

    const adjustment = findType(rows, 'ADJUSTMENT');
    expect(adjustment.quantity).toBe(-2);
    expect(adjustment.delta).toBe(-2);
    expect(adjustment.reason).toBe('Kerusakan bahan saat penyimpanan');
    expect(adjustment.recordedBy.username).toBe(`${runId}-admin`);
    expect(adjustment.sourceId).toBeTruthy();

    for (const row of rows) {
      expect(Number.isNaN(Date.parse(row.recordedAt))).toBe(false);
      expect(row.recordedBy.id).toBeTruthy();
    }
  });

  it('total dampak seluruh pergerakan sama dengan stok saat ini', async () => {
    const rows = await listMovements(adminToken);
    const sum = rows.reduce((acc, row) => acc + row.delta, 0);

    const detail = await request(app).get(`/api/materials/${materialId}`).set(auth(operatorToken));
    expect(detail.status).toBe(200);

    expect(sum).toBe(10);
    expect(detail.body.material.stock).toBe(10);
  });
});

describe('Penyesuaian stok oleh Admin', () => {
  it('tercatat di riwayat dan terhubung ke catatan penyesuaiannya', async () => {
    const rows = await listMovements(adminToken);
    const adjustment = findType(rows, 'ADJUSTMENT');
    expect(adjustment.sourceId).toBeTruthy();

    const record = await prisma.stockAdjustment.findUnique({
      where: { id: adjustment.sourceId! },
      include: { materialMovement: true },
    });

    expect(record).toBeTruthy();
    expect(record!.targetType).toBe('MATERIAL');
    expect(record!.materialId).toBe(materialId);
    expect(Number(record!.quantity)).toBe(-2);
    expect(record!.reason).toBe('Kerusakan bahan saat penyimpanan');
    expect(record!.adjustedById).toBe(adminId);
    // Pergerakan dan catatan penyesuaian saling terhubung dua arah.
    expect(record!.materialMovement?.id).toBe(adjustment.id);
  });

  it('yang membuat stok negatif ditolak tanpa pergerakan baru', async () => {
    const before = await listMovements(adminToken);

    const res = await request(app)
      .post('/api/stock-adjustments')
      .set(auth(adminToken))
      .send({ targetType: 'MATERIAL', targetId: materialId, quantity: -999, reason: 'Pengurangan berlebihan' });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('tidak mencukupi');

    const after = await listMovements(adminToken);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  });
});

describe('Riwayat tidak dapat diedit atau dihapus', () => {
  it('tidak ada endpoint edit/hapus pergerakan stok (404)', async () => {
    const rows = await listMovements(adminToken);
    const target = rows[0];
    const before = JSON.stringify(rows);

    const attempts = [
      request(app).patch(`/api/materials/${materialId}/movements`).set(auth(adminToken)).send({ reason: 'diubah' }),
      request(app).delete(`/api/materials/${materialId}/movements`).set(auth(adminToken)),
      request(app)
        .patch(`/api/materials/${materialId}/movements/${target.id}`)
        .set(auth(adminToken))
        .send({ reason: 'diubah' }),
      request(app).delete(`/api/materials/${materialId}/movements/${target.id}`).set(auth(adminToken)),
    ];

    for (const attempt of attempts) {
      expect((await attempt).status).toBe(404);
    }

    const after = await listMovements(adminToken);
    expect(JSON.stringify(after)).toBe(before);
  });
});

/**
 * Pengujian integrasi B4: penerimaan bahan baku, saldo awal, integritas
 * stok, dan pencegahan permintaan berulang.
 * Berjalan terhadap database PostgreSQL lokal (docker compose).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { runIdempotent } from './lib/idempotency';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';

const app = createApp();

const runId = `b4-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let adminToken = '';
let operatorToken = '';
let adminId = '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function login(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

async function createMaterial(suffix: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/materials')
    .set(auth(adminToken))
    .send({ name: `${runId}-bahan-${suffix}`, unit: 'kg', ...overrides });
  expect(res.status).toBe(201);
  return res.body.material;
}

function postReceipt(materialId: string, body: Record<string, unknown>, idempotencyKey?: string) {
  const req = request(app)
    .post(`/api/materials/${materialId}/receipts`)
    .set(auth(operatorToken))
    .send(body);
  if (idempotencyKey) {
    req.set('Idempotency-Key', idempotencyKey);
  }
  return req;
}

function postOpeningBalance(materialId: string, body: Record<string, unknown>, idempotencyKey?: string) {
  const req = request(app)
    .post(`/api/materials/${materialId}/opening-balances`)
    .set(auth(adminToken))
    .send(body);
  if (idempotencyKey) {
    req.set('Idempotency-Key', idempotencyKey);
  }
  return req;
}

async function getStock(materialId: string): Promise<number> {
  const res = await request(app).get(`/api/materials/${materialId}`).set(auth(operatorToken));
  return res.body.material.stock;
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: { username: `${runId}-admin`, passwordHash: await hashPassword('admin-rahasia-123'), role: 'ADMIN' },
  });
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
  const materials = await prisma.material.findMany({
    where: { name: { startsWith: runId } },
    select: { id: true },
  });
  const ids = materials.map((m) => m.id);

  // Hapus berdasarkan relasi (tanpa ON DELETE CASCADE di skema).
  await prisma.materialStockMovement.deleteMany({ where: { materialId: { in: ids } } });
  await prisma.materialReceipt.deleteMany({ where: { materialId: { in: ids } } });
  await prisma.materialOpeningBalance.deleteMany({ where: { materialId: { in: ids } } });
  await prisma.materialStock.deleteMany({ where: { materialId: { in: ids } } });
  await prisma.material.deleteMany({ where: { id: { in: ids } } });
  await prisma.idempotencyKey.deleteMany({ where: { key: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

describe('Penerimaan bahan baku', () => {
  it('Operator mencatat penerimaan: stok bertambah dan riwayat tersimpan dengan pencatat', async () => {
    const material = await createMaterial('terima');

    const res = await postReceipt(material.id, { quantity: 10, note: 'Pembelian dari supplier', receivedAt: '2026-10-10' });
    expect(res.status).toBe(201);
    expect(res.body.receipt.quantity).toBe(10);
    expect(res.body.receipt.note).toBe('Pembelian dari supplier');
    expect(res.body.receipt.recordedBy.username).toBe(`${runId}-operator`);
    expect(res.body.receipt.receivedAt).toContain('2026-10-10');
    expect(res.body.stock).toBe(10);

    // Stok pada master terlihat oleh Operator.
    expect(await getStock(material.id)).toBe(10);

    // Riwayat penerimaan dapat ditelusuri.
    const list = await request(app).get(`/api/materials/${material.id}/receipts`).set(auth(operatorToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].recordedBy.username).toBe(`${runId}-operator`);
  });

  it('Admin juga dapat mencatat penerimaan; tanggal diisi otomatis bila tidak diberikan', async () => {
    const material = await createMaterial('terima-admin');

    const res = await request(app)
      .post(`/api/materials/${material.id}/receipts`)
      .set(auth(adminToken))
      .send({ quantity: 2.5 });

    expect(res.status).toBe(201);
    expect(res.body.receipt.recordedBy.username).toBe(`${runId}-admin`);
    expect(res.body.receipt.receivedAt).toBeTruthy(); // tanggal bisnis terisi
    expect(res.body.stock).toBe(2.5);
  });

  it('Stok dihitung sebagai total per jenis bahan baku, bukan per penerimaan', async () => {
    const material = await createMaterial('total');

    expect((await postReceipt(material.id, { quantity: 10 })).status).toBe(201);
    expect((await postReceipt(material.id, { quantity: 2.5 })).status).toBe(201);

    expect(await getStock(material.id)).toBe(12.5);

    const list = await request(app).get(`/api/materials/${material.id}/receipts`).set(auth(operatorToken));
    expect(list.body.data).toHaveLength(2);
  });

  it('Menolak akses tanpa autentikasi (401)', async () => {
    const material = await createMaterial('tanpa-token');

    const res = await request(app)
      .post(`/api/materials/${material.id}/receipts`)
      .send({ quantity: 5 });
    expect(res.status).toBe(401);
  });

  it('Menolak jumlah nol, negatif, bukan angka, atau lebih dari 3 desimal (400)', async () => {
    const material = await createMaterial('validasi');

    expect((await postReceipt(material.id, { quantity: 0 })).status).toBe(400);
    expect((await postReceipt(material.id, { quantity: -5 })).status).toBe(400);
    expect((await postReceipt(material.id, { quantity: 'lima' })).status).toBe(400);
    expect((await postReceipt(material.id, { quantity: 1.2345 })).status).toBe(400);

    // Stok tidak berubah oleh permintaan yang ditolak.
    expect(await getStock(material.id)).toBe(0);
  });

  it('Menolak catatan bukan teks dan tanggal tidak valid (400)', async () => {
    const material = await createMaterial('validasi-2');

    expect((await postReceipt(material.id, { quantity: 5, note: 123 })).status).toBe(400);
    expect((await postReceipt(material.id, { quantity: 5, receivedAt: 'bukan-tanggal' })).status).toBe(400);
  });

  it('Menolak bahan baku tidak dikenal (404) dan bahan baku nonaktif (409)', async () => {
    const missing = await postReceipt('id-tidak-ada', { quantity: 5 });
    expect(missing.status).toBe(404);

    const inactive = await createMaterial('nonaktif');
    await request(app)
      .patch(`/api/materials/${inactive.id}`)
      .set(auth(adminToken))
      .send({ isActive: false });

    const res = await postReceipt(inactive.id, { quantity: 5 });
    expect(res.status).toBe(409);
    expect(await getStock(inactive.id)).toBe(0);
  });
});

describe('Saldo awal bahan baku', () => {
  it('Admin mencatat saldo awal: wajib tanggal, alasan, dan pencatat; stok bertambah', async () => {
    const material = await createMaterial('saldo-awal');

    const res = await postOpeningBalance(material.id, { quantity: 20, date: '2026-10-01', reason: 'Stok awal gudang' });
    expect(res.status).toBe(201);
    expect(res.body.openingBalance.quantity).toBe(20);
    expect(res.body.openingBalance.reason).toBe('Stok awal gudang');
    expect(res.body.openingBalance.recordedBy.username).toBe(`${runId}-admin`);
    expect(res.body.openingBalance.date).toContain('2026-10-01');
    expect(res.body.stock).toBe(20);

    const list = await request(app).get(`/api/materials/${material.id}/opening-balances`).set(auth(operatorToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('Operator ditolak mencatat saldo awal (403) dan tanpa token ditolak (401)', async () => {
    const material = await createMaterial('saldo-otoritas');

    const byOperator = await request(app)
      .post(`/api/materials/${material.id}/opening-balances`)
      .set(auth(operatorToken))
      .send({ quantity: 5, date: '2026-10-01', reason: 'uji' });
    expect(byOperator.status).toBe(403);

    const withoutToken = await request(app)
      .post(`/api/materials/${material.id}/opening-balances`)
      .send({ quantity: 5, date: '2026-10-01', reason: 'uji' });
    expect(withoutToken.status).toBe(401);
  });

  it('Saldo awal terpisah dari penerimaan biasa — stok tidak dihitung dua kali', async () => {
    const material = await createMaterial('tidak-ganda');

    expect((await postOpeningBalance(material.id, { quantity: 5, date: '2026-10-01', reason: 'Stok awal' })).status).toBe(201);
    expect((await postReceipt(material.id, { quantity: 3 })).status).toBe(201);

    // Stok = saldo awal + penerimaan, masing-masing sekali.
    expect(await getStock(material.id)).toBe(8);

    // Saldo awal TIDAK muncul sebagai penerimaan biasa.
    const receipts = await request(app).get(`/api/materials/${material.id}/receipts`).set(auth(operatorToken));
    expect(receipts.body.data).toHaveLength(1);
    expect(receipts.body.data[0].quantity).toBe(3);

    const balances = await request(app).get(`/api/materials/${material.id}/opening-balances`).set(auth(operatorToken));
    expect(balances.body.data).toHaveLength(1);
    expect(balances.body.data[0].quantity).toBe(5);
  });

  it('Menolak tanggal dan alasan wajib yang tidak valid (400)', async () => {
    const material = await createMaterial('saldo-validasi');

    expect((await postOpeningBalance(material.id, { quantity: 0, date: '2026-10-01', reason: 'x' })).status).toBe(400);
    expect((await postOpeningBalance(material.id, { quantity: -1, date: '2026-10-01', reason: 'x' })).status).toBe(400);
    expect((await postOpeningBalance(material.id, { quantity: 5, reason: 'x' })).status).toBe(400);
    expect((await postOpeningBalance(material.id, { quantity: 5, date: 'bukan-tanggal', reason: 'x' })).status).toBe(400);
    expect((await postOpeningBalance(material.id, { quantity: 5, date: '2026-10-01', reason: '' })).status).toBe(400);
    expect((await postOpeningBalance(material.id, { quantity: 5, date: '2026-10-01', reason: 'x'.repeat(501) })).status).toBe(400);

    expect(await getStock(material.id)).toBe(0);
  });

  it('Menolak bahan nonaktif (409) dan tidak dikenal (404)', async () => {
    const inactive = await createMaterial('saldo-nonaktif');
    await request(app).patch(`/api/materials/${inactive.id}`).set(auth(adminToken)).send({ isActive: false });

    expect((await postOpeningBalance(inactive.id, { quantity: 5, date: '2026-10-01', reason: 'x' })).status).toBe(409);
    expect((await postOpeningBalance('id-tidak-ada', { quantity: 5, date: '2026-10-01', reason: 'x' })).status).toBe(404);
  });
});

describe('Pencegahan permintaan berulang (Idempotency-Key)', () => {
  it('Permintaan ulang dengan kunci sama tidak menambah stok dua kali', async () => {
    const material = await createMaterial('idem');
    const key = `${runId}-idem-1`;

    const first = await postReceipt(material.id, { quantity: 7 }, key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replay']).toBe('false');

    const second = await postReceipt(material.id, { quantity: 7 }, key);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replay']).toBe('true');
    // Respons identik, termasuk id catatan yang sama.
    expect(second.body).toEqual(first.body);

    expect(await getStock(material.id)).toBe(7);

    const list = await request(app).get(`/api/materials/${material.id}/receipts`).set(auth(operatorToken));
    expect(list.body.data).toHaveLength(1);
  });

  it('Saldo awal dengan kunci sama juga tidak terhitung dua kali', async () => {
    const material = await createMaterial('idem-saldo');
    const key = `${runId}-idem-saldo`;

    await postOpeningBalance(material.id, { quantity: 4, date: '2026-10-01', reason: 'Stok awal' }, key);
    const repeat = await postOpeningBalance(material.id, { quantity: 4, date: '2026-10-01', reason: 'Stok awal' }, key);

    expect(repeat.headers['idempotent-replay']).toBe('true');
    expect(await getStock(material.id)).toBe(4);
  });

  it('Kunci berbeda tetap dihitung sebagai catatan baru', async () => {
    const material = await createMaterial('idem-beda');

    await postReceipt(material.id, { quantity: 1 }, `${runId}-kunci-a`);
    await postReceipt(material.id, { quantity: 1 }, `${runId}-kunci-b`);

    expect(await getStock(material.id)).toBe(2);
  });

  it('Permintaan BERSAMAAN dengan kunci sama hanya menambah stok sekali', async () => {
    const material = await createMaterial('idem-bersamaan');
    const key = `${runId}-idem-bersamaan`;

    const [first, second] = await Promise.all([
      postReceipt(material.id, { quantity: 9 }, key),
      postReceipt(material.id, { quantity: 9 }, key),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Keduanya memperoleh catatan yang sama.
    expect(first.body.receipt.id).toBe(second.body.receipt.id);

    expect(await getStock(material.id)).toBe(9);

    const list = await request(app).get(`/api/materials/${material.id}/receipts`).set(auth(operatorToken));
    expect(list.body.data).toHaveLength(1);
  });

  it('Menolak Idempotency-Key yang tidak valid (400)', async () => {
    const material = await createMaterial('idem-validasi');

    const res = await postReceipt(material.id, { quantity: 1 }, 'x'.repeat(101));
    expect(res.status).toBe(400);
  });
});

describe('Integritas dan riwayat', () => {
  it('Kegagalan di tengah transaksi tidak menyisakan stok atau riwayat sebagian', async () => {
    const material = await createMaterial('atomik');

    await expect(
      runIdempotent(
        { key: `${runId}-gagal`, endpoint: 'UJI-ATOMIK', userId: adminId },
        async (tx) => {
          const receipt = await tx.materialReceipt.create({
            data: { materialId: material.id, quantity: '5.000', receivedAt: new Date(), recordedById: adminId },
          });
          await tx.materialStockMovement.create({
            data: { materialId: material.id, type: 'RECEIPT', quantity: '5.000', occurredAt: new Date(), recordedById: adminId, receiptId: receipt.id },
          });
          throw new Error('gagal uji');
        }
      )
    ).rejects.toThrow('gagal uji');

    // Tidak ada riwayat setengah jadi dan stok tidak berubah.
    expect(await getStock(material.id)).toBe(0);
    expect(await prisma.materialReceipt.count({ where: { materialId: material.id } })).toBe(0);
    expect(await prisma.materialStockMovement.count({ where: { materialId: material.id } })).toBe(0);
    expect(await prisma.materialStock.count({ where: { materialId: material.id } })).toBe(0);
  });

  it('Bahan dengan riwayat nyata tidak dapat dihapus (409) dan satuan tidak dapat diubah (409)', async () => {
    const material = await createMaterial('riwayat-nyata');
    await postReceipt(material.id, { quantity: 3 });

    const deleted = await request(app).delete(`/api/materials/${material.id}`).set(auth(adminToken));
    expect(deleted.status).toBe(409);

    const unitChange = await request(app)
      .patch(`/api/materials/${material.id}`)
      .set(auth(adminToken))
      .send({ unit: 'liter' });
    expect(unitChange.status).toBe(409);

    // Data tetap utuh.
    const detail = await request(app).get(`/api/materials/${material.id}`).set(auth(operatorToken));
    expect(detail.body.material.unit).toBe('kg');
    expect(detail.body.material.stock).toBe(3);
  });

  it('Riwayat tidak memiliki endpoint edit atau hapus', async () => {
    const material = await createMaterial('riwayat-kunci');
    const receipt = await postReceipt(material.id, { quantity: 1 });

    const patch = await request(app)
      .patch(`/api/materials/${material.id}/receipts/${receipt.body.receipt.id}`)
      .set(auth(adminToken))
      .send({ quantity: 99 });
    expect(patch.status).toBe(404);

    const remove = await request(app)
      .delete(`/api/materials/${material.id}/receipts/${receipt.body.receipt.id}`)
      .set(auth(adminToken));
    expect(remove.status).toBe(404);

    // Catatan asli tetap utuh.
    const list = await request(app).get(`/api/materials/${material.id}/receipts`).set(auth(operatorToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].quantity).toBe(1);
  });

  it('Riwayat penerimaan dan saldo awal tetap tersimpan dan terurut', async () => {
    const material = await createMaterial('riwayat-urut');

    await postReceipt(material.id, { quantity: 1, receivedAt: '2026-10-05' });
    await postReceipt(material.id, { quantity: 2, receivedAt: '2026-10-12' });
    await postOpeningBalance(material.id, { quantity: 4, date: '2026-10-01', reason: 'Stok awal' });

    const receipts = await request(app).get(`/api/materials/${material.id}/receipts`).set(auth(operatorToken));
    expect(receipts.body.data.map((r: { quantity: number }) => r.quantity)).toEqual([2, 1]); // terbaru dulu

    const balances = await request(app).get(`/api/materials/${material.id}/opening-balances`).set(auth(operatorToken));
    expect(balances.body.data).toHaveLength(1);

    expect(await getStock(material.id)).toBe(7);
  });
});

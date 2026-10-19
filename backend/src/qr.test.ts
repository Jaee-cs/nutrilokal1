/**
 * Pengujian integrasi B8: katalog publik dan QR traceability per batch.
 * Berjalan terhadap database PostgreSQL lokal (docker compose) — semua
 * data diambil dari database aktual melalui API, bukan data contoh.
 *
 * Yang diuji:
 * - Katalog publik hanya menampilkan produk aktif dengan kolom yang
 *   memang untuk publik; produk nonaktif hilang; tidak ada data internal.
 * - Informasi QR hanya tampil setelah divalidasi DAN diterbitkan Admin;
 *   sebelum itu respons publik hanya pemberitahuan (tidak ada kebocoran).
 * - Kolom yang belum tersedia/tervalidasi disembunyikan (bukan null).
 * - QR membuka informasi tanpa login; kode lama (alias) mengarah ke batch
 *   yang sama; kode batch unik dijamin database.
 * - Penerbitan, pembaruan (via master), dan penarikan oleh Admin berfungsi;
 *   QR yang ditarik tidak lagi menampilkan informasi sebelumnya.
 * - Produk nonaktif: hilang dari katalog tapi QR yang sudah terbit tetap
 *   menampilkan informasi (kecuali ditarik); tidak bisa dihapus.
 * - Endpoint internal menolak tanpa autentikasi / role yang salah.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';
import { userHasActivityHistory } from './lib/account-history';

const app = createApp();

const runId = `b8-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let adminToken = '';
let operatorToken = '';
let adminId = '';

// Fixture yang dibuat beforeAll.
let prodFull = ''; // produk dengan seluruh info publik terisi
let prodPlain = ''; // produk tanpa info publik opsional
let batchFull = ''; // batch dengan tanggal produksi diketahui
let batchPlain = ''; // batch stok awal tanpa tanggal produksi (NL-OPEN)
const oldCode = `${runId}-kode-lama`; // alias kode lama batchFull

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

function createProduct(suffix: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name: `${runId}-produk-${suffix}`, unit: 'pcs', sellingPrice: 15000, ...overrides })
    .then((res) => {
      expect(res.status).toBe(201);
      return res.body.product as { id: string };
    });
}

function createBatch(productId: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/batches/opening-stock')
    .set(auth(adminToken))
    .send({ productId, quantity: 10, ...body })
    .then((res) => {
      expect(res.status).toBe(201);
      return res.body.batch as { id: string; code: string };
    });
}

const getQrInternal = (batchId: string, token = adminToken) =>
  request(app).get(`/api/batches/${batchId}/qr`).set(token ? auth(token) : {});

const postQr = (batchId: string, action: string, token = adminToken) =>
  request(app).post(`/api/batches/${batchId}/qr/${action}`).set(auth(token));

const getPublicQr = (code: string) => request(app).get(`/api/public/qr/${encodeURIComponent(code)}`);

const getCatalog = () => request(app).get('/api/public/catalog');

beforeAll(async () => {
  await prisma.user.create({
    data: {
      username: `${runId}-admin`,
      passwordHash: await hashPassword('admin-rahasia-123'),
      role: 'ADMIN',
    },
  });
  adminId = (await prisma.user.findUniqueOrThrow({ where: { username: `${runId}-admin` } })).id;
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

  prodFull = (
    await createProduct('lengkap', {
      description: 'Snack sehat khas KWT Gogor.',
      composition: 'Biji beras merah, gula aren, kelapa parut.',
      storageInstructions: 'Simpan di tempat kering dan sejuk, jauhkan dari sinar matahari.',
      sellingPrice: 20000,
    })
  ).id;
  prodPlain = (await createProduct('polos')).id;

  // Batch dengan tanggal produksi diketahui (dicatat via stok awal).
  batchFull = (await createBatch(prodFull, { productionDate: wibDateCode(-7) })).id;
  // Batch stok awal tanpa tanggal produksi — riwayat terbatas (README 5.3).
  batchPlain = (await createBatch(prodPlain)).id;

  // Kode lama (alias) terdaftar langsung di database — mesin alias
  // sendiri sudah diuji pada B5.
  await prisma.batchAlias.create({ data: { batchId: batchFull, code: oldCode } });

  // Tanggal kedaluwarsa batchFull dicatat Admin (sekalius tervalidasi).
  const expiryRes = await request(app)
    .patch(`/api/batches/${batchFull}/expiry`)
    .set(auth(adminToken))
    .send({ expiryDate: wibDateCode(30) });
  expect(expiryRes.status).toBe(200);
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

  // Hapus berdasarkan relasi (tanpa ON DELETE CASCADE di skema).
  await prisma.qrPublication.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchAlias.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchStockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batchOpeningBalance.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.product.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

// ---------------------------------------------------------------------------
// Katalog publik
// ---------------------------------------------------------------------------

describe('katalog publik', () => {
  it('terbuka tanpa login dan hanya memuat produk aktif dengan kolom publik', async () => {
    const res = await getCatalog();
    expect(res.status).toBe(200);

    const products: Array<Record<string, unknown>> = res.body.products;
    const mine = products.filter((p) => typeof p.name === 'string' && p.name.startsWith(runId));
    expect(mine.length).toBe(2);

    const full = mine.find((p) => p.name === `${runId}-produk-lengkap`)!;
    // Hanya kolom yang memang untuk publik; tidak ada data internal.
    expect(Object.keys(full).sort()).toEqual(['description', 'name', 'sellingPrice', 'unit']);
    expect(full.description).toBe('Snack sehat khas KWT Gogor.');
    expect(full.sellingPrice).toBe(20000);

    const plain = mine.find((p) => p.name === `${runId}-produk-polos`)!;
    // Kolom yang belum diisi Admin disembunyikan — bukan null.
    expect(Object.keys(plain).sort()).toEqual(['name', 'sellingPrice', 'unit']);
  });

  it('data katalog selalu berasal dari master terkini (bukan salinan)', async () => {
    const patch = await request(app)
      .patch(`/api/products/${prodPlain}`)
      .set(auth(adminToken))
      .send({ sellingPrice: 17500 });
    expect(patch.status).toBe(200);

    const res = await getCatalog();
    const updated = (res.body.products as Array<Record<string, unknown>>).find(
      (p) => p.name === `${runId}-produk-polos`
    )!;
    expect(updated.sellingPrice).toBe(17500);
  });

  it('produk yang dinonaktifkan tidak muncul di katalog aktif', async () => {
    const patch = await request(app)
      .patch(`/api/products/${prodPlain}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(patch.status).toBe(200);

    const res = await getCatalog();
    const names = (res.body.products as Array<{ name: string }>).map((p) => p.name);
    expect(names).not.toContain(`${runId}-produk-polos`);

    // Kembalikan agar pengujian lain bisa memakai produk ini.
    const restore = await request(app)
      .patch(`/api/products/${prodPlain}`)
      .set(auth(adminToken))
      .send({ isActive: true });
    expect(restore.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// QR traceability per batch
// ---------------------------------------------------------------------------

describe('QR traceability per batch', () => {
  it('sebelum divalidasi/diterbitkan: publik hanya menerima pemberitahuan, tanpa data', async () => {
    // Kode batch valid tapi belum ada publikasi.
    const res = await getPublicQr((await createBatch(prodPlain)).code);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'UNAVAILABLE',
      message: 'Informasi publik untuk batch ini tidak tersedia.',
    });

    const internal = await getQrInternal(batchFull);
    expect(internal.status).toBe(200);
    expect(internal.body.qr.status).toBe('NOT_CONFIGURED');
  });

  it('divalidasi tapi belum diterbitkan: informasi tidak bocor ke publik', async () => {
    const validate = await postQr(batchFull, 'validate');
    expect(validate.status).toBe(200);
    expect(validate.body.qr.status).toBe('VALIDATED');
    expect(validate.body.qr.validatedBy.id).toBe(adminId);

    const res = await getPublicQr(await getBatchCode(batchFull));
    expect(res.status).toBe(200);
    // Tidak ada satu pun kolom data — hanya pemberitahuan.
    expect(Object.keys(res.body).sort()).toEqual(['message', 'status']);
    expect(res.body.status).toBe('UNAVAILABLE');
  });

  it('QR tanpa login menampilkan informasi yang sudah divalidasi & diterbitkan', async () => {
    const publish = await postQr(batchFull, 'publish');
    expect(publish.status).toBe(200);
    expect(publish.body.qr.status).toBe('PUBLISHED');
    expect(publish.body.qr.publishedBy.id).toBe(adminId);
    expect(publish.body.qr.publicPath).toBe(
      `/api/public/qr/${publish.body.qr.code}`
    );

    const res = await getPublicQr(publish.body.qr.code);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PUBLISHED');

    // Tepat seperti daftar kolom yang diizinkan README 5.6.
    expect(Object.keys(res.body.product).sort()).toEqual([
      'composition',
      'description',
      'name',
      'storageInstructions',
      'unit',
    ]);
    expect(res.body.product.name).toBe(`${runId}-produk-lengkap`);
    expect(res.body.product.composition).toBe('Biji beras merah, gula aren, kelapa parut.');

    expect(Object.keys(res.body.batch).sort()).toEqual([
      'code',
      'expiryDate',
      'productionDate',
    ]);
    expect(res.body.batch.productionDate).toBe(wibDateCode(-7));
    expect(res.body.batch.expiryDate).toBe(wibDateCode(30));

    // Tidak ada data internal: stok, harga, id, akun, status siklus.
    const flattened = JSON.stringify(res.body);
    expect(flattened).not.toContain('stock');
    expect(flattened).not.toContain(adminId);
    expect(flattened).not.toContain('sellingPrice');
    expect(flattened).not.toContain(runId + '-admin');
  });

  it('kode lama (alias) mengarah ke batch yang sama; kode batch unik', async () => {
    const aliasRes = await getPublicQr(oldCode);
    expect(aliasRes.status).toBe(200);
    expect(aliasRes.body.status).toBe('PUBLISHED');
    expect(aliasRes.body.batch.code).toBe((await getBatchCode(batchFull)));

    // Kode lain untuk batch kedua menampilkan batchnya sendiri — QR unik.
    const otherCode = await getBatchCode(batchPlain);
    expect(otherCode).not.toBe((await getBatchCode(batchFull)));
    const otherRes = await getPublicQr(otherCode);
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.status).toBe('UNAVAILABLE'); // belum diterbitkan

    // Constraint UNIQUE database: kode duplikat dan dua baris QR untuk
    // satu batch sama-sama ditolak.
    await expect(
      prisma.batchAlias.create({ data: { batchId: batchPlain, code: oldCode } })
    ).rejects.toThrow();
    await expect(
      prisma.qrPublication.create({ data: { batchId: batchFull } })
    ).rejects.toThrow();
  });

  it('kolom yang belum tersedia/tervalidasi disembunyikan dari QR', async () => {
    // Batch tanpa tanggal produksi (riwayat terbatas): kolom disembunyikan.
    await postQr(batchPlain, 'validate');
    await postQr(batchPlain, 'publish');
    const plainRes = await getPublicQr(await getBatchCode(batchPlain));
    expect(plainRes.body.status).toBe('PUBLISHED');
    expect(Object.keys(plainRes.body.batch).sort()).toEqual(['code']);
    expect(Object.keys(plainRes.body.product)).toEqual(['name', 'unit']); // tanpa deskripsi/komposisi/petunjuk

    // Tanggal kedaluwarsa yang BELUM divalidasi disembunyikan (disimulasikan
    // lewat database — jalur API selalu memvalidasi saat pencatatan, B7).
    await prisma.batch.update({
      where: { id: batchPlain },
      data: { expiryDate: new Date(Date.now() + 86_400_000 * 10), expiryValidatedAt: null },
    });
    const hiddenExpiry = await getPublicQr(await getBatchCode(batchPlain));
    expect(Object.keys(hiddenExpiry.body.batch).sort()).toEqual(['code']);

    // Setelah dicatat Admin (tervalidasi), tanggal kedaluwarsa tampil.
    const setExpiry = await request(app)
      .patch(`/api/batches/${batchPlain}/expiry`)
      .set(auth(adminToken))
      .send({ expiryDate: wibDateCode(60) });
    expect(setExpiry.status).toBe(200);
    const shownExpiry = await getPublicQr(await getBatchCode(batchPlain));
    expect(shownExpiry.body.batch.expiryDate).toBe(wibDateCode(60));
  });

  it('Admin dapat memperbarui informasi publik lewat master produk', async () => {
    const patch = await request(app)
      .patch(`/api/products/${prodFull}`)
      .set(auth(adminToken))
      .send({
        description: 'Deskripsi terbaru hasil pemeriksaan Admin.',
        composition: 'Resep baru: beras merah dan gula aren organik.',
      });
    expect(patch.status).toBe(200);

    const res = await getPublicQr(await getBatchCode(batchFull));
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.product.description).toBe('Deskripsi terbaru hasil pemeriksaan Admin.');
    expect(res.body.product.composition).toBe('Resep baru: beras merah dan gula aren organik.');
  });

  it('QR yang ditarik hanya menampilkan pemberitahuan — tanpa informasi sebelumnya', async () => {
    const withdraw = await postQr(batchFull, 'withdraw');
    expect(withdraw.status).toBe(200);
    expect(withdraw.body.qr.status).toBe('WITHDRAWN');
    expect(withdraw.body.qr.withdrawnBy.id).toBe(adminId);

    const res = await getPublicQr(await getBatchCode(batchFull));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'UNAVAILABLE',
      message: 'Informasi publik untuk batch ini tidak tersedia.',
    });

    // Penarikan dua kali ditolak.
    const again = await postQr(batchFull, 'withdraw');
    expect(again.status).toBe(409);

    // Admin dapat menerbitkan kembali setelah memeriksa ulang.
    const republish = await postQr(batchFull, 'publish');
    expect(republish.status).toBe(200);
    expect(republish.body.qr.status).toBe('PUBLISHED');
    const backRes = await getPublicQr(await getBatchCode(batchFull));
    expect(backRes.body.status).toBe('PUBLISHED');
    expect(backRes.body.product.name).toBe(`${runId}-produk-lengkap`);
  });

  it('menerbitkan sebelum validasi dan menarik sebelum penerbitan ditolak', async () => {
    const fresh = await createBatch(prodFull, { productionDate: wibDateCode(-1) });

    const publishFirst = await postQr(fresh.id, 'publish');
    expect(publishFirst.status).toBe(409);

    await postQr(fresh.id, 'validate');
    const withdrawFirst = await postQr(fresh.id, 'withdraw');
    expect(withdrawFirst.status).toBe(409);
  });

  it('produk nonaktif: katalog berhenti menampilkan tapi QR terbit tetap menampilkan informasi', async () => {
    const deactivate = await request(app)
      .patch(`/api/products/${prodFull}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);

    // Tidak ada di katalog aktif.
    const catalog = await getCatalog();
    const names = (catalog.body.products as Array<{ name: string }>).map((p) => p.name);
    expect(names).not.toContain(`${runId}-produk-lengkap`);

    // QR lama tetap menampilkan informasi yang sudah diterbitkan (README 5.1).
    const res = await getPublicQr(await getBatchCode(batchFull));
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.product.name).toBe(`${runId}-produk-lengkap`);

    // Produk dengan riwayat publikasi QR tidak boleh dihapus.
    const del = await request(app).delete(`/api/products/${prodFull}`).set(auth(adminToken));
    expect(del.status).toBe(409);

    // Setelah Admin menarik, QR tidak menampilkan apa pun lagi.
    await postQr(batchFull, 'withdraw');
    const withdrawn = await getPublicQr(await getBatchCode(batchFull));
    expect(withdrawn.body).toEqual({
      status: 'UNAVAILABLE',
      message: 'Informasi publik untuk batch ini tidak tersedia.',
    });

    const restore = await request(app)
      .patch(`/api/products/${prodFull}`)
      .set(auth(adminToken))
      .send({ isActive: true });
    expect(restore.status).toBe(200);
  });

  it('kode yang tidak dikenal menghasilkan 404', async () => {
    const res = await getPublicQr(`${runId}-tidak-ada`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Otorisasi endpoint internal
// ---------------------------------------------------------------------------

describe('otorisasi endpoint QR internal', () => {
  it('menolak tanpa autentikasi', async () => {
    for (const [method, path] of [
      ['get', `/api/batches/${batchFull}/qr`],
      ['post', `/api/batches/${batchFull}/qr/validate`],
      ['post', `/api/batches/${batchFull}/qr/publish`],
      ['post', `/api/batches/${batchFull}/qr/withdraw`],
    ] as const) {
      const res = await (request(app) as any)[method](path);
      expect(res.status).toBe(401);
    }
  });

  it('Operator hanya boleh melihat status, bukan mengubahnya', async () => {
    const view = await getQrInternal(batchFull, operatorToken);
    expect(view.status).toBe(200);
    expect(view.body.qr.status).toBeTruthy();

    for (const action of ['validate', 'publish', 'withdraw']) {
      const res = await postQr(batchFull, action, operatorToken);
      expect(res.status).toBe(403);
    }
  });

  it('batch tidak dikenal menghasilkan 404 pada endpoint internal', async () => {
    const res = await request(app).get('/api/batches/tidak-ada/qr').set(auth(adminToken));
    expect(res.status).toBe(404);
  });

  it('riwayat publikasi QR tercatat sebagai riwayat akun Admin', async () => {
    // Admin telah memvalidasi, menerbitkan, dan menarik QR selama pengujian ini.
    expect(await userHasActivityHistory(adminId)).toBe(true);
  });
});

async function getBatchCode(batchId: string): Promise<string> {
  const res = await request(app).get(`/api/batches/${batchId}`).set(auth(adminToken));
  expect(res.status).toBe(200);
  return res.body.batch.code;
}

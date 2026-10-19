/**
 * Pemeriksaan keamanan dan pengujian integrasi B10.
 *
 * Berjalan terhadap database PostgreSQL lokal. Tidak ada data produksi yang
 * disentuh — seluruh fixture memakai prefix runId dan dibersihkan setelah tes.
 *
 * Yang diuji:
 * - Matriks otorisasi SELURUH endpoint: tanpa token / token rusak → 401;
 *   Operator pada endpoint khusus Admin → 403; endpoint publik tetap terbuka.
 * - Kata sandi tidak pernah muncul di respons API; tersimpan sebagai hash
 *   bcrypt; login tidak membocor keberadaan akun.
 * - Token alg:none dan token rusak ditolak.
 * - Error permintaan rusak (JSON tidak valid → 400, payload >100kb → 413)
 *   tidak lagi dilaporkan sebagai 500; tidak ada stack trace yang bocor;
 *   header X-Powered-By tidak dikirim.
 * - REGRESI bug race B10 (ditemukan saat pemeriksaan, sudah diperbaiki):
 *   1) penyesuaian negatif bersamaan tidak dapat membuat stok bahan negatif;
 *   2) dua penerimaan bersamaan pada material tanpa baris stok tidak lagi
 *      memicu unique-violation di dalam transaksi (dulu: 500 / 25P02).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword } from './lib/password';
import { prisma } from './lib/prisma';

const app = createApp();

const runId = `b10-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let adminToken = '';
let operatorToken = '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

beforeAll(async () => {
  await prisma.user.create({
    data: {
      username: `${runId}-admin`,
      passwordHash: await hashPassword('b10-admin-rahasia-123'),
      role: 'ADMIN',
    },
  });
  await prisma.user.create({
    data: {
      username: `${runId}-operator`,
      passwordHash: await hashPassword('b10-operator-rahasia-123'),
      role: 'OPERATOR',
    },
  });
  adminToken = (await login(`${runId}-admin`, 'b10-admin-rahasia-123')).body.token;
  operatorToken = (await login(`${runId}-operator`, 'b10-operator-rahasia-123')).body.token;
  expect(adminToken).toBeTruthy();
  expect(operatorToken).toBeTruthy();
});

afterAll(async () => {
  const materials = await prisma.material.findMany({
    where: { name: { startsWith: runId } },
    select: { id: true },
  });
  const materialIds = materials.map((m) => m.id);

  // Anak dulu sebelum orang tua (tanpa ON DELETE CASCADE).
  await prisma.materialStockMovement.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.stockAdjustment.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialReceipt.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.materialStock.deleteMany({ where: { materialId: { in: materialIds } } });
  await prisma.material.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

// ---------------------------------------------------------------------------
// 1. Matriks otorisasi seluruh endpoint
// ---------------------------------------------------------------------------

type Access = 'public' | 'user' | 'admin';

/** Invetarisasi endpoint aktual (sumber: src/routes/*). */
const ROUTES: Array<{ method: 'get' | 'post' | 'patch' | 'delete'; path: string; access: Access }> = [
  // Publik (tanpa login) — README 5.6 + health check
  { method: 'get', path: '/api/health', access: 'public' },
  { method: 'post', path: '/api/auth/login', access: 'public' },
  { method: 'get', path: '/api/public/catalog', access: 'public' },
  { method: 'get', path: '/api/public/qr/kode-tidak-ada', access: 'public' },

  // Login & pengguna
  { method: 'get', path: '/api/auth/me', access: 'user' },
  { method: 'post', path: '/api/auth/set-password', access: 'user' },
  { method: 'get', path: '/api/users', access: 'admin' },
  { method: 'post', path: '/api/users', access: 'admin' },
  { method: 'patch', path: '/api/users/id-tidak-ada', access: 'admin' },
  { method: 'delete', path: '/api/users/id-tidak-ada', access: 'admin' },
  { method: 'post', path: '/api/users/id-tidak-ada/password-reset', access: 'admin' },

  // Master produk & bahan
  { method: 'get', path: '/api/products', access: 'user' },
  { method: 'get', path: '/api/products/id-tidak-ada', access: 'user' },
  { method: 'post', path: '/api/products', access: 'admin' },
  { method: 'patch', path: '/api/products/id-tidak-ada', access: 'admin' },
  { method: 'delete', path: '/api/products/id-tidak-ada', access: 'admin' },
  { method: 'get', path: '/api/materials', access: 'user' },
  { method: 'get', path: '/api/materials/id-tidak-ada', access: 'user' },
  { method: 'post', path: '/api/materials', access: 'admin' },
  { method: 'patch', path: '/api/materials/id-tidak-ada', access: 'admin' },
  { method: 'delete', path: '/api/materials/id-tidak-ada', access: 'admin' },
  // Riwayat pergerakan stok: hanya baca, Admin dan Operator (Fase C).
  { method: 'get', path: '/api/materials/id-tidak-ada/movements', access: 'user' },

  // Penerimaan (Operator boleh) & saldo awal (Admin)
  { method: 'get', path: '/api/materials/id-tidak-ada/receipts', access: 'user' },
  { method: 'post', path: '/api/materials/id-tidak-ada/receipts', access: 'user' },
  { method: 'get', path: '/api/materials/id-tidak-ada/opening-balances', access: 'user' },
  { method: 'post', path: '/api/materials/id-tidak-ada/opening-balances', access: 'admin' },

  // Produksi
  { method: 'post', path: '/api/productions', access: 'user' },
  { method: 'get', path: '/api/productions', access: 'user' },
  { method: 'get', path: '/api/productions/id-tidak-ada', access: 'user' },
  { method: 'patch', path: '/api/productions/id-tidak-ada', access: 'admin' },

  // Batch, stok awal, kedaluwarsa, QR
  { method: 'get', path: '/api/batches', access: 'user' },
  { method: 'get', path: '/api/batches/id-tidak-ada', access: 'user' },
  { method: 'get', path: '/api/batches/id-tidak-ada/qr', access: 'user' },
  { method: 'post', path: '/api/batches/opening-stock', access: 'admin' },
  { method: 'patch', path: '/api/batches/id-tidak-ada/expiry', access: 'admin' },
  { method: 'post', path: '/api/batches/id-tidak-ada/qr/validate', access: 'admin' },
  { method: 'post', path: '/api/batches/id-tidak-ada/qr/publish', access: 'admin' },
  { method: 'post', path: '/api/batches/id-tidak-ada/qr/withdraw', access: 'admin' },

  // Penyesuaian stok, penjualan, pembatalan
  { method: 'post', path: '/api/stock-adjustments', access: 'admin' },
  { method: 'post', path: '/api/sales', access: 'user' },
  { method: 'get', path: '/api/sales', access: 'user' },
  { method: 'get', path: '/api/sales/id-tidak-ada', access: 'user' },
  { method: 'post', path: '/api/sales/id-tidak-ada/cancel', access: 'admin' },

  // Dashboard & laporan
  { method: 'get', path: '/api/dashboard', access: 'user' },
  { method: 'get', path: '/api/reports/stock', access: 'user' },
  { method: 'get', path: '/api/reports/materials', access: 'user' },
  { method: 'get', path: '/api/reports/productions', access: 'user' },
  { method: 'get', path: '/api/reports/sales', access: 'user' },
];

function call(route: (typeof ROUTES)[number], token?: string) {
  const req = request(app)[route.method](route.path);
  if (token) {
    req.set(auth(token));
  }
  // Body kosong valid JSON untuk metode yang membaca body (tanpa efek samping:
  // validasi/otorisasi berjalan sebelum penyimpanan apa pun).
  if (route.method !== 'get') {
    req.set('Content-Type', 'application/json').send('{}');
  }
  return req;
}

describe('matriks otorisasi endpoint', () => {
  it('semua endpoint non-publik menolak permintaan tanpa token (401)', async () => {
    const failures: string[] = [];
    for (const route of ROUTES) {
      if (route.access === 'public') continue;
      const res = await call(route);
      if (res.status !== 401) {
        failures.push(`${route.method.toUpperCase()} ${route.path} → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('semua endpoint non-publik menolak token rusak (401)', async () => {
    const failures: string[] = [];
    for (const route of ROUTES) {
      if (route.access === 'public') continue;
      const res = await call(route, 'token-rusak-bukan-jwt.tentu.gagal');
      if (res.status !== 401) {
        failures.push(`${route.method.toUpperCase()} ${route.path} → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('Operator ditolak (403) pada SELURUH endpoint khusus Admin', async () => {
    const failures: string[] = [];
    for (const route of ROUTES) {
      if (route.access !== 'admin') continue;
      const res = await call(route, operatorToken);
      if (res.status !== 403) {
        failures.push(`${route.method.toUpperCase()} ${route.path} → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('Operator melewati autentikasi pada endpoint baca/operasional (bukan 401/403)', async () => {
    const failures: string[] = [];
    for (const route of ROUTES) {
      if (route.access !== 'user') continue;
      const res = await call(route, operatorToken);
      if (res.status === 401 || res.status === 403) {
        failures.push(`${route.method.toUpperCase()} ${route.path} → ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('endpoint publik terbuka tanpa token; login menolak body kosong (400, bukan 401)', async () => {
    for (const route of ROUTES) {
      if (route.access !== 'public') continue;
      const res = await call(route);
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    }
    const loginRes = await request(app).post('/api/auth/login').send({});
    expect(loginRes.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 2. Kata sandi, hash, dan kebocoran data
// ---------------------------------------------------------------------------

describe('kata sandi dan kebocoran data', () => {
  it('respons API tidak pernah memuat passwordHash atau field password', async () => {
    const responses = await Promise.all([
      request(app).post('/api/auth/login').send({ username: `${runId}-admin`, password: 'b10-admin-rahasia-123' }),
      request(app).get('/api/auth/me').set(auth(adminToken)),
      request(app).get('/api/users').set(auth(adminToken)),
      request(app).get('/api/sales').set(auth(adminToken)),
      request(app).get('/api/dashboard').set(auth(operatorToken)),
    ]);
    for (const res of responses) {
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('passwordHash');
      expect(text).not.toContain('"password":');
    }
  });

  it('kata sandi tersimpan sebagai hash bcrypt, bukan teks biasa', async () => {
    const user = await prisma.user.findUnique({ where: { username: `${runId}-admin` } });
    expect(user).not.toBeNull();
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(user!.passwordHash).not.toContain('b10-admin-rahasia-123');
  });

  it('login tidak membocor keberadaan akun (pesan sama untuk akun tak dikenal & salah)', async () => {
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ username: `${runId}-tidak-ada`, password: 'apapun-salah-123' });
    const wrongPass = await request(app)
      .post('/api/auth/login')
      .send({ username: `${runId}-admin`, password: 'apapun-salah-123' });
    expect(unknown.status).toBe(401);
    expect(wrongPass.status).toBe(401);
    expect(unknown.body).toEqual(wrongPass.body);
  });

  it('token alg:none dan token dengan peran dipalsukan ditolak (401)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'bukan-id-asli', role: 'ADMIN' })
    ).toString('base64url');
    const algNone = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${header}.${payload}.`);
    expect(algNone.status).toBe(401);

    // Token dengan signature salah (payload asli, secret lain) juga ditolak.
    const forgedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const forged = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${forgedHeader}.${payload}.signature-salah`);
    expect(forged.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 3. Penanganan error permintaan rusak (regresi perbaikan B10)
// ---------------------------------------------------------------------------

describe('penanganan error permintaan', () => {
  it('body JSON tidak valid → 400 dengan pesan generik (bukan 500, tanpa detail parser)', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .set('Content-Type', 'application/json')
      .send('{broken');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: 'Format body permintaan tidak valid.' });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('SyntaxError');
    expect(text).not.toContain('position');
    expect(text).not.toContain('\\n'); // tanpa baris stack trace
  });

  it('payload melebihi batas (100kb) → 413, bukan 500', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(adminToken))
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ name: 'x'.repeat(200_000), unit: 'kg' }));
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ message: 'Ukuran permintaan terlalu besar.' });
  });

  it('header X-Powered-By tidak dikirim', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('error tak terduga tetap 500 dengan pesan generik tanpa stack trace', async () => {
    // Lewat mocking: route laporan memanggil Prisma — paksa gagal.
    const { vi } = await import('vitest');
    const { prisma: pr } = await import('./lib/prisma');
    const spy = vi.spyOn(pr.material, 'findMany').mockRejectedValueOnce(new Error('rahasia-database-internal'));
    try {
      const res = await request(app).get('/api/reports/stock').set(auth(adminToken));
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ message: 'Terjadi kesalahan pada server.' });
      expect(JSON.stringify(res.body)).not.toContain('rahasia-database-internal');
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. REGRESI race B10 — stok negatif & unique-violation dalam transaksi
// ---------------------------------------------------------------------------

async function createRaceMaterial(suffix: string): Promise<string> {
  const res = await request(app)
    .post('/api/materials')
    .set(auth(adminToken))
    .send({ name: `${runId}-race-${suffix}`, unit: 'kg' });
  expect(res.status).toBe(201);
  return res.body.material.id;
}

describe('regresi: permintaan stok bersamaan (bug B10)', () => {
  it('penyesuaian negatif bersamaan tidak pernah membuat stok bahan negatif', async () => {
    const failures: string[] = [];

    for (let round = 0; round < 4; round++) {
      const matId = await createRaceMaterial(`neg-${round}`);
      const receipt = await request(app)
        .post(`/api/materials/${matId}/receipts`)
        .set(auth(adminToken))
        .send({ quantity: 10 });
      expect(receipt.status).toBe(201);

      // 5 penyesuaian -3 bersamaan pada stok 10.
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          request(app)
            .post('/api/stock-adjustments')
            .set(auth(adminToken))
            .send({
              targetType: 'MATERIAL',
              targetId: matId,
              quantity: -3,
              reason: `Uji race B10 putaran ${round}-${i}`,
            })
        )
      );

      const ok = results.filter((r) => r.status === 201).length;
      const rejected = results.filter((r) => r.status === 409).length;
      const unexpected = results.filter((r) => r.status !== 201 && r.status !== 409);

      // Tidak boleh ada 500 (dulu: jalur catch-P2002 dalam transaksi → 25P02).
      if (unexpected.length > 0) {
        failures.push(`putaran ${round}: status tak terduga ${unexpected.map((r) => r.status).join(',')}`);
      }
      // Hanya 3 dari 5 yang boleh berhasil (10 → 7 → 4 → 1); guard menjamin
      // permintaan berikutnya ditolak 409, bukan meneruskan stok ke bawah.
      if (ok !== 3 || rejected !== 2) {
        failures.push(`putaran ${round}: berhasil ${ok}, ditolak ${rejected} (harus 3/2)`);
      }

      const stock = await prisma.materialStock.findUnique({ where: { materialId: matId } });
      const finalStock = Number(stock?.quantity ?? -999);
      // Stok tidak pernah negatif dan selalu = 10 - 3 × berhasil.
      if (finalStock < 0) {
        failures.push(`putaran ${round}: STOK NEGATIF ${finalStock}`);
      }
      if (finalStock !== 10 - 3 * ok) {
        failures.push(`putaran ${round}: stok ${finalStock} ≠ 10 - 3×${ok}`);
      }

      // Ledger konsisten: stok = jumlah seluruh pergerakan.
      const sums = await prisma.materialStockMovement.aggregate({
        where: { materialId: matId },
        _sum: { quantity: true },
      });
      if (Number(sums._sum.quantity ?? 0) !== finalStock) {
        failures.push(`putaran ${round}: stok ${finalStock} ≠ jumlah pergerakan ${sums._sum.quantity}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('dua penerimaan bersamaan pada material tanpa baris stok: dua-duanya sukses, stok = total', async () => {
    const failures: string[] = [];

    for (let round = 0; round < 4; round++) {
      const matId = await createRaceMaterial(`first-${round}`);

      const [a, b] = await Promise.all([
        request(app).post(`/api/materials/${matId}/receipts`).set(auth(adminToken)).send({ quantity: 5 }),
        request(app).post(`/api/materials/${matId}/receipts`).set(auth(adminToken)).send({ quantity: 7 }),
      ]);

      // Dulu: INSERT ... ON CONFLICT bentrok → unique violation (P2002) di
      // dalam transaksi aktif → retry gagal 25P02 → 500 dan stok tidak utuh.
      if (a.status !== 201 || b.status !== 201) {
        failures.push(`putaran ${round}: status ${a.status}/${b.status} (harus 201/201)`);
        continue;
      }

      const stock = await prisma.materialStock.findUnique({ where: { materialId: matId } });
      const finalStock = Number(stock?.quantity ?? 0);
      const receiptCount = await prisma.materialReceipt.count({ where: { materialId: matId } });

      if (finalStock !== 12) {
        failures.push(`putaran ${round}: stok ${finalStock} ≠ 12`);
      }
      if (receiptCount !== 2) {
        failures.push(`putaran ${round}: catatan penerimaan ${receiptCount} ≠ 2`);
      }

      const sums = await prisma.materialStockMovement.aggregate({
        where: { materialId: matId },
        _sum: { quantity: true },
      });
      if (Number(sums._sum.quantity ?? 0) !== 12) {
        failures.push(`putaran ${round}: jumlah pergerakan ${sums._sum.quantity} ≠ 12`);
      }
    }

    expect(failures).toEqual([]);
  });
});

/**
 * Pengujian integrasi B3: master produk dan master bahan baku.
 * Berjalan terhadap database PostgreSQL lokal (docker compose).
 */
import request from 'supertest';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashPassword } from './lib/password';
import { removeProductPhoto, resolveStoredPhotoPath } from './lib/product-photo';
import { registerOperationalHistoryChecker } from './lib/master-history';
import { prisma } from './lib/prisma';

const app = createApp();

// Penanda unik agar data uji tidak mengganggu data lain dan mudah dibersihkan.
const runId = `b3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let adminToken = '';
let operatorToken = '';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function login(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

const historyDisposers: Array<() => void> = [];

/** Mendaftarkan pemeriksa riwayat palsu untuk produk/bahan tertentu (hanya saat uji). */
function fakeHistoryFor(ids: string[]): void {
  historyDisposers.push(
    registerOperationalHistoryChecker(async (_kind, id) => ids.includes(id))
  );
}

beforeAll(async () => {
  await prisma.user.create({
    data: { username: `${runId}-admin`, passwordHash: await hashPassword('admin-rahasia-123'), role: 'ADMIN' },
  });
  await prisma.user.create({
    data: { username: `${runId}-operator`, passwordHash: await hashPassword('operator-rahasia-123'), role: 'OPERATOR' },
  });

  adminToken = (await login(`${runId}-admin`, 'admin-rahasia-123')).body.token;
  operatorToken = (await login(`${runId}-operator`, 'operator-rahasia-123')).body.token;

  expect(adminToken).toBeTruthy();
  expect(operatorToken).toBeTruthy();
});

afterEach(() => {
  while (historyDisposers.length > 0) {
    historyDisposers.pop()?.();
  }
});

afterAll(async () => {
  // Batch uji (stok awal) dibersihkan lebih dulu agar penghapusan produk
  // tidak melanggar kunci asing. Jaring pengaman bila sebuah uji gagal
  // di tengah jalan sebelum blok pembersihannya sendiri sempat berjalan.
  const testProductIds = (
    await prisma.product.findMany({
      where: { name: { startsWith: runId } },
      select: { id: true },
    })
  ).map((product) => product.id);

  const testMaterialIds = (
    await prisma.material.findMany({
      where: { name: { startsWith: runId } },
      select: { id: true },
    })
  ).map((material) => material.id);

  if (testMaterialIds.length > 0) {
    await prisma.productionMaterialUsage.deleteMany({ where: { materialId: { in: testMaterialIds } } });
  }

  // Produksi uji dihapus sebelum batch uji (Production.batchId -> Batch.id).
  await prisma.production.deleteMany({ where: { productId: { in: testProductIds } } });

  if (testProductIds.length > 0) {
    const batches = await prisma.batch.findMany({
      where: { productId: { in: testProductIds } },
      select: { id: true },
    });
    const batchIds = batches.map((batch) => batch.id);
    if (batchIds.length > 0) {
      await prisma.batchStockMovement.deleteMany({ where: { batchId: { in: batchIds } } });
      await prisma.batchOpeningBalance.deleteMany({ where: { batchId: { in: batchIds } } });
      await prisma.qrPublication.deleteMany({ where: { batchId: { in: batchIds } } });
      await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    }
  }

  // Jejak stok bahan uji dibersihkan lebih dulu (terhubung ke penerimaan,
  // saldo awal, pemakaian produksi, dan penyesuaian) agar bahan uji bisa
  // dihapus tanpa melanggar kunci asing.
  if (testMaterialIds.length > 0) {
    await prisma.materialStockMovement.deleteMany({ where: { materialId: { in: testMaterialIds } } });
    await prisma.materialReceipt.deleteMany({ where: { materialId: { in: testMaterialIds } } });
    await prisma.materialOpeningBalance.deleteMany({ where: { materialId: { in: testMaterialIds } } });
    await prisma.stockAdjustment.deleteMany({ where: { materialId: { in: testMaterialIds } } });
    await prisma.materialStock.deleteMany({ where: { materialId: { in: testMaterialIds } } });
  }

  await prisma.product.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.material.deleteMany({ where: { name: { startsWith: runId } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

async function createProduct(suffix: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/products')
    .set(auth(adminToken))
    .send({ name: `${runId}-produk-${suffix}`, description: 'Deskripsi uji', unit: 'pcs', sellingPrice: 15000, ...overrides });
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

describe('Master produk — CRUD', () => {
  it('Admin membuat produk: data tersimpan sesuai dan tanpa field internal', async () => {
    const product = await createProduct('baru', { sellingPrice: 15000.5, name: `${runId}-produk-baru` });

    expect(product.name).toBe(`${runId}-produk-baru`);
    expect(product.unit).toBe('pcs');
    expect(product.sellingPrice).toBe(15000.5);
    expect(product.description).toBe('Deskripsi uji');
    expect(product.isActive).toBe(true);
    expect(product).not.toHaveProperty('passwordHash');
  });

  it('Operator membaca daftar dan detail produk diperbolehkan', async () => {
    const product = await createProduct('dibaca');

    const list = await request(app).get('/api/products').set(auth(operatorToken));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.data.some((p: { id: string }) => p.id === product.id)).toBe(true);

    const detail = await request(app).get(`/api/products/${product.id}`).set(auth(operatorToken));
    expect(detail.status).toBe(200);
    expect(detail.body.product.id).toBe(product.id);
  });

  it('Membaca tanpa token ditolak (401)', async () => {
    const list = await request(app).get('/api/products');
    expect(list.status).toBe(401);

    const detail = await request(app).get('/api/products/abc');
    expect(detail.status).toBe(401);
  });

  it('Operator ditolak mengubah produk (403)', async () => {
    const product = await createProduct('operator-tolak');

    const created = await request(app)
      .post('/api/products')
      .set(auth(operatorToken))
      .send({ name: `${runId}-dilarang`, unit: 'pcs', sellingPrice: 1000 });
    expect(created.status).toBe(403);

    const patched = await request(app)
      .patch(`/api/products/${product.id}`)
      .set(auth(operatorToken))
      .send({ name: `${runId}-dilarang` });
    expect(patched.status).toBe(403);

    const deleted = await request(app).delete(`/api/products/${product.id}`).set(auth(operatorToken));
    expect(deleted.status).toBe(403);
  });

  it('Admin mengubah nama dan harga jual', async () => {
    const product = await createProduct('ubah');

    const patched = await request(app)
      .patch(`/api/products/${product.id}`)
      .set(auth(adminToken))
      .send({ name: `${runId}-produk-ubah-baru`, sellingPrice: 17500 });

    expect(patched.status).toBe(200);
    expect(patched.body.product.name).toBe(`${runId}-produk-ubah-baru`);
    expect(patched.body.product.sellingPrice).toBe(17500);
    // Field lain tidak ikut berubah.
    expect(patched.body.product.unit).toBe('pcs');
    expect(patched.body.product.description).toBe('Deskripsi uji');
  });

  it('Admin menghapus produk yang belum memiliki riwayat, lalu detailnya 404', async () => {
    const product = await createProduct('dihapus');

    const deleted = await request(app).delete(`/api/products/${product.id}`).set(auth(adminToken));
    expect(deleted.status).toBe(200);
    expect(deleted.body.archived).toBe(false);

    const detail = await request(app).get(`/api/products/${product.id}`).set(auth(adminToken));
    expect(detail.status).toBe(404);
  });

  it('Detail dan penghapusan id tidak dikenal mengembalikan 404', async () => {
    const detail = await request(app).get('/api/products/id-tidak-ada').set(auth(adminToken));
    expect(detail.status).toBe(404);

    const deleted = await request(app).delete('/api/products/id-tidak-ada').set(auth(adminToken));
    expect(deleted.status).toBe(404);
  });
});

describe('Master produk — validasi input', () => {
  const post = (body: Record<string, unknown>) =>
    request(app).post('/api/products').set(auth(adminToken)).send(body);

  it('nama kosong ditolak (400)', async () => {
    expect((await post({ name: '   ', unit: 'pcs', sellingPrice: 1000 })).status).toBe(400);
  });

  it('satuan dasar kosong ditolak (400)', async () => {
    expect((await post({ name: `${runId}-x`, unit: '', sellingPrice: 1000 })).status).toBe(400);
  });

  it('harga jual negatif, bukan angka, atau lebih dari 2 desimal ditolak (400)', async () => {
    expect((await post({ name: `${runId}-x`, unit: 'pcs', sellingPrice: -1 })).status).toBe(400);
    expect((await post({ name: `${runId}-x`, unit: 'pcs', sellingPrice: 'seribu' })).status).toBe(400);
    expect((await post({ name: `${runId}-x`, unit: 'pcs', sellingPrice: 1000.123 })).status).toBe(400);
  });

  it('deskripsi bertipe bukan teks ditolak (400)', async () => {
    expect((await post({ name: `${runId}-x`, unit: 'pcs', sellingPrice: 1000, description: 123 })).status).toBe(400);
  });

  it('PATCH tanpa perubahan ditolak (400)', async () => {
    const product = await createProduct('kosong');
    const patched = await request(app).patch(`/api/products/${product.id}`).set(auth(adminToken)).send({});
    expect(patched.status).toBe(400);
  });
});

describe('Master produk — riwayat operasional dan penghapusan', () => {
  it('Produk dengan riwayat diarsipkan (bukan dihapus permanen) dan datanya tetap utuh', async () => {
    const product = await createProduct('riwayat');
    fakeHistoryFor([product.id]);

    const deleted = await request(app).delete(`/api/products/${product.id}`).set(auth(adminToken));
    expect(deleted.status).toBe(200);
    expect(deleted.body.archived).toBe(true);
    expect(deleted.body.message).toMatch(/diarsipkan/i);

    // Hapus logis: baris produk tetap ada (riwayat tidak dihapus) dan
    // berstatus nonaktif sehingga tidak dipakai untuk transaksi baru.
    const detail = await request(app).get(`/api/products/${product.id}`).set(auth(adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body.product.name).toBe(product.name);
    expect(detail.body.product.isActive).toBe(false);

    // Penghapusan berulang idempoten — tetap terarsip, tidak error.
    const again = await request(app).delete(`/api/products/${product.id}`).set(auth(adminToken));
    expect(again.status).toBe(200);
    expect(again.body.archived).toBe(true);
  });

  it('Produk dengan stok tersisa ditolak dihapus (409) dan stok tidak dikurangi', async () => {
    const product = await createProduct('berstok');

    const created = await request(app)
      .post('/api/batches/opening-stock')
      .set(auth(adminToken))
      .send({ productId: product.id, quantity: 5, productionDate: '2026-10-19', note: 'Stok awal uji' });
    expect(created.status).toBe(201);
    const batchId: string | undefined = created.body?.batch?.id;
    expect(batchId).toBeTruthy();

    try {
      const deleted = await request(app).delete(`/api/products/${product.id}`).set(auth(adminToken));
      expect(deleted.status).toBe(409);
      expect(deleted.body.message).toMatch(/stok/i);
      expect(deleted.body.message).toMatch(/selesai/i);

      // Stok TIDAK dikurangi/dibuang untuk memaksa penghapusan berhasil,
      // dan produk tetap utuh (masih aktif).
      const detail = await request(app).get(`/api/products/${product.id}`).set(auth(adminToken));
      expect(detail.status).toBe(200);
      expect(detail.body.product.stock).toBe(5);
      expect(detail.body.product.isActive).toBe(true);
      expect(detail.body.product.batchCount).toBe(1);
    } finally {
      if (batchId) {
        // Bersihkan batch uji beserta catatan pembentuknya.
        await prisma.batchStockMovement.deleteMany({ where: { batchId } });
        await prisma.batchOpeningBalance.deleteMany({ where: { batchId } });
        await prisma.batch.delete({ where: { id: batchId } });
      }
    }
  });

  it('Satuan dasar tidak dapat diubah setelah ada riwayat operasional (409)', async () => {
    const product = await createProduct('satuan');
    fakeHistoryFor([product.id]);

    const patched = await request(app)
      .patch(`/api/products/${product.id}`)
      .set(auth(adminToken))
      .send({ unit: 'box' });
    expect(patched.status).toBe(409);

    // Harga dan status tetap boleh diubah meski ada riwayat.
    const pricePatch = await request(app)
      .patch(`/api/products/${product.id}`)
      .set(auth(adminToken))
      .send({ sellingPrice: 20000, isActive: false });
    expect(pricePatch.status).toBe(200);
    expect(pricePatch.body.product.sellingPrice).toBe(20000);
    expect(pricePatch.body.product.isActive).toBe(false);
    expect(pricePatch.body.product.unit).toBe('pcs'); // satuan tidak berubah
  });

  it('Penonaktifan tidak menghapus atau merusak data; bisa diaktifkan kembali', async () => {
    const product = await createProduct('nonaktif');

    const deactivate = await request(app)
      .patch(`/api/products/${product.id}`)
      .set(auth(adminToken))
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.product.isActive).toBe(false);

    // Semua data lain tetap utuh.
    const detail = await request(app).get(`/api/products/${product.id}`).set(auth(adminToken));
    expect(detail.body.product).toMatchObject({
      name: product.name,
      description: product.description,
      unit: product.unit,
      sellingPrice: product.sellingPrice,
      isActive: false,
    });

    const reactivate = await request(app)
      .patch(`/api/products/${product.id}`)
      .set(auth(adminToken))
      .send({ isActive: true });
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.product.isActive).toBe(true);
  });

  it('Satuan dasar boleh diubah selama belum ada riwayat operasional', async () => {
    const product = await createProduct('satuan-bebas');

    const patched = await request(app)
      .patch(`/api/products/${product.id}`)
      .set(auth(adminToken))
      .send({ unit: 'box' });
    expect(patched.status).toBe(200);
    expect(patched.body.product.unit).toBe('box');
  });
});

// ---------------------------------------------------------------------------
// Foto produk (unggahan berkas lokal, README 5.6)
// ---------------------------------------------------------------------------

/** Foto PNG 1x1 piksel yang valid (untuk menguji unggahan sungguhan). */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAI/wH+0pM4AAAAAElFTkSuQmCC',
  'base64'
);

/** Foto JPEG minimal dengan magic bytes benar. */
const JPEG_MIN = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(64, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

describe('Foto produk — unggah, ganti, hapus, dan validasi berkas', () => {
  // Berkas aplikasi di luar direktori unggahan (untuk membuktikan tidak
  // ada berkas lain yang tersentuh percobaan path traversal).
  const packageJsonPath = join(__dirname, '..', 'package.json');

  const uploadPhoto = (productId: string, body: Buffer, contentType: string, token = adminToken) =>
    request(app)
      .post(`/api/products/${productId}/photo`)
      .set(auth(token))
      .set('Content-Type', contentType)
      .send(body);

  const photoFileExists = (photoUrl: string): Promise<boolean> =>
    access(resolveStoredPhotoPath(photoUrl) ?? '').then(
      () => true,
      () => false
    );

  afterAll(async () => {
    // Berkas uji tidak boleh tertinggal di direktori unggahan.
    const leftovers = await prisma.product.findMany({
      where: { name: { startsWith: runId } },
      select: { photoUrl: true },
    });
    for (const leftover of leftovers) {
      await removeProductPhoto(leftover.photoUrl);
    }
  });

  it('produk baru tanpa foto tetap boleh dibuat dan photoUrl bernilai null', async () => {
    const product = await createProduct('tanpa-foto');
    expect(product.photoUrl).toBeNull();
  });

  it('Admin mengunggah foto PNG: berkas tersimpan dan dapat diakses publik', async () => {
    const product = await createProduct('foto-png');

    const res = await uploadPhoto(product.id, PNG_1PX, 'image/png');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/foto/i);
    expect(res.body.product.photoUrl).toMatch(/^\/api\/uploads\/products\//);
    // Tidak ada base64/isi gambar di respons API.
    expect(JSON.stringify(res.body)).not.toContain(PNG_1PX.toString('base64').slice(0, 24));

    // Berkas fisik benar-benar ada dan isinya identik dengan yang dikirim.
    const storedPath = resolveStoredPhotoPath(res.body.product.photoUrl)!;
    expect(storedPath).toBeTruthy();
    expect(await readFile(storedPath)).toEqual(PNG_1PX);

    // URL foto dapat diakses TANPA login (halaman publik katalog & QR).
    const served = await request(app).get(res.body.product.photoUrl);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/image\/png/);
  });

  it('foto lama diganti dan berkas lama dihapus dari disk', async () => {
    const product = await createProduct('ganti-foto');

    const first = await uploadPhoto(product.id, PNG_1PX, 'image/png');
    expect(first.status).toBe(200);
    const firstPath = resolveStoredPhotoPath(first.body.product.photoUrl)!;

    const second = await uploadPhoto(product.id, JPEG_MIN, 'image/jpeg');
    expect(second.status).toBe(200);
    expect(second.body.product.photoUrl).not.toBe(first.body.product.photoUrl);
    expect(second.body.product.photoUrl).toMatch(/\.jpg$/);

    expect(await photoFileExists(first.body.product.photoUrl)).toBe(false);
    expect(await readFile(resolveStoredPhotoPath(second.body.product.photoUrl)!)).toEqual(JPEG_MIN);
    expect(firstPath).not.toBe(resolveStoredPhotoPath(second.body.product.photoUrl)!);
  });

  it('foto dapat dihapus dan berkasnya ikut dihapus', async () => {
    const product = await createProduct('hapus-foto');

    const uploaded = await uploadPhoto(product.id, PNG_1PX, 'image/png');
    expect(uploaded.status).toBe(200);
    const photoUrl = uploaded.body.product.photoUrl as string;

    const deleted = await request(app)
      .delete(`/api/products/${product.id}/photo`)
      .set(auth(adminToken));
    expect(deleted.status).toBe(200);
    expect(deleted.body.product.photoUrl).toBeNull();
    expect(await photoFileExists(photoUrl)).toBe(false);

    // Menghapus foto saat produk memang belum punya foto tetap aman.
    const again = await request(app)
      .delete(`/api/products/${product.id}/photo`)
      .set(auth(adminToken));
    expect(again.status).toBe(200);
    expect(again.body.product.photoUrl).toBeNull();
  });

  it('tipe berkas tidak didukung ditolak (400) dan tidak ada berkas tersimpan', async () => {
    const product = await createProduct('tipe-salah');

    const textFile = await uploadPhoto(product.id, Buffer.from('bukan gambar'), 'text/plain');
    expect(textFile.status).toBe(400);
    expect(textFile.body.message).toMatch(/JPG, PNG, atau WEBP/i);

    // Content-Type gambar palsu: isi berkasnya tetap diperiksa (magic bytes).
    const fakeImage = await uploadPhoto(product.id, Buffer.from('<svg>palsu</svg>'), 'image/png');
    expect(fakeImage.status).toBe(400);
    expect(fakeImage.body.message).toMatch(/JPG, PNG, atau WEBP/i);

    const detail = await request(app).get(`/api/products/${product.id}`).set(auth(adminToken));
    expect(detail.body.product.photoUrl).toBeNull();
  });

  it('berkas kosong ditolak (400) dengan pesan yang jelas', async () => {
    const product = await createProduct('foto-kosong');

    const empty = await uploadPhoto(product.id, Buffer.alloc(0), 'image/png');
    expect(empty.status).toBe(400);
    expect(empty.body.message).toMatch(/kosong|pilih gambar/i);
  });

  it('foto melebihi 5 MB ditolak (413) dan produk tetap tanpa foto', async () => {
    const product = await createProduct('foto-besar');

    const oversize = await uploadPhoto(
      product.id,
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(6 * 1024 * 1024, 0x20)]),
      'image/jpeg'
    );
    expect(oversize.status).toBe(413);
    expect(oversize.body.message).toMatch(/maksimal 5 MB/i);

    const detail = await request(app).get(`/api/products/${product.id}`).set(auth(adminToken));
    expect(detail.body.product.photoUrl).toBeNull();
  });

  it('unggahan tanpa berkas gambar (body JSON) ditolak (400)', async () => {
    const product = await createProduct('foto-json');

    const res = await request(app)
      .post(`/api/products/${product.id}/photo`)
      .set(auth(adminToken))
      .send({ photo: 'data:image/png;base64,AAAA' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/JPG, PNG, atau WEBP|body berkas/i);
  });

  it('Operator tidak dapat mengunggah maupun menghapus foto (403)', async () => {
    const product = await createProduct('foto-operator');

    const upload = await uploadPhoto(product.id, PNG_1PX, 'image/png', operatorToken);
    expect(upload.status).toBe(403);

    const remove = await request(app)
      .delete(`/api/products/${product.id}/photo`)
      .set(auth(operatorToken));
    expect(remove.status).toBe(403);

    // Tanpa token ditolak 401.
    const anonymous = await request(app)
      .post(`/api/products/${product.id}/photo`)
      .set('Content-Type', 'image/png')
      .send(PNG_1PX);
    expect(anonymous.status).toBe(401);

    const detail = await request(app).get(`/api/products/${product.id}`).set(auth(adminToken));
    expect(detail.body.product.photoUrl).toBeNull();
  });

  it('produk tidak dikenal: unggah/hapus foto 404', async () => {
    expect((await uploadPhoto('id-tidak-ada', PNG_1PX, 'image/png')).status).toBe(404);
    expect(
      (await request(app).delete('/api/products/id-tidak-ada/photo').set(auth(adminToken))).status
    ).toBe(404);
  });

  it('path traversal ditolak: berkas di luar direktori unggahan tidak dapat diakses/dihapus', async () => {
    // Percobaan membaca berkas di luar direktori unggahan lewat URL publik.
    for (const attempt of [
      '/api/uploads/../package.json',
      '/api/uploads/%2e%2e%2fpackage.json',
      '/api/uploads/..%2f..%2f.env',
    ]) {
      const res = await request(app).get(attempt);
      expect([400, 403, 404]).toContain(res.status);
      expect(JSON.stringify(res.body ?? {})).not.toContain('jwt');
    }

    // Path tersimpan yang aneh (dari database) tidak dipakai untuk menghapus
    // berkas di luar direktori unggahan.
    expect(resolveStoredPhotoPath('/api/uploads/products/x/../../.env')).toBeNull();
    expect(resolveStoredPhotoPath('/api/uploads/products/x/y/evil.png')).toBeNull();
    expect(resolveStoredPhotoPath('/etc/passwd')).toBeNull();
    await removeProductPhoto('/api/uploads/products/../package.json');

    const product = await createProduct('traversal');
    await prisma.product.update({
      where: { id: product.id },
      data: { photoUrl: '../../package.json' },
    });
    const deleted = await request(app)
      .delete(`/api/products/${product.id}/photo`)
      .set(auth(adminToken));
    expect(deleted.status).toBe(200);
    expect(deleted.body.product.photoUrl).toBeNull();
    // Berkas aplikasi tetap ada — tidak ada yang terhapus di luar unggahan.
    expect(await readFile(packageJsonPath, 'utf8')).toContain('nutrilokal-backend');
  });

  it('menghapus produk permanen ikut membersihkan berkas fotonya', async () => {
    const product = await createProduct('hapus-produk-foto');

    const uploaded = await uploadPhoto(product.id, PNG_1PX, 'image/png');
    expect(uploaded.status).toBe(200);
    const photoUrl = uploaded.body.product.photoUrl as string;
    expect(await photoFileExists(photoUrl)).toBe(true);

    const deleted = await request(app).delete(`/api/products/${product.id}`).set(auth(adminToken));
    expect(deleted.status).toBe(200);
    expect(deleted.body.archived).toBe(false);
    expect(await photoFileExists(photoUrl)).toBe(false);
  });
});

describe('Master bahan baku — CRUD, hak akses, dan validasi', () => {
  it('Admin membuat bahan baku; Operator boleh membaca', async () => {
    const material = await createMaterial('baru');
    expect(material.name).toBe(`${runId}-bahan-baru`);
    expect(material.unit).toBe('kg');
    expect(material.isActive).toBe(true);
    expect(material).not.toHaveProperty('sellingPrice');

    const list = await request(app).get('/api/materials').set(auth(operatorToken));
    expect(list.status).toBe(200);
    expect(list.body.data.some((m: { id: string }) => m.id === material.id)).toBe(true);

    const detail = await request(app).get(`/api/materials/${material.id}`).set(auth(operatorToken));
    expect(detail.status).toBe(200);
  });

  it('Akses tanpa token ditolak (401) dan Operator ditolak mengubah (403)', async () => {
    expect((await request(app).get('/api/materials')).status).toBe(401);

    const material = await createMaterial('otoritas');
    const created = await request(app)
      .post('/api/materials')
      .set(auth(operatorToken))
      .send({ name: `${runId}-dilarang`, unit: 'kg' });
    expect(created.status).toBe(403);

    const patched = await request(app)
      .patch(`/api/materials/${material.id}`)
      .set(auth(operatorToken))
      .send({ name: `${runId}-dilarang` });
    expect(patched.status).toBe(403);

    const deleted = await request(app).delete(`/api/materials/${material.id}`).set(auth(operatorToken));
    expect(deleted.status).toBe(403);
  });

  it('Validasi nama dan satuan dasar wajib diisi (400)', async () => {
    const bad1 = await request(app).post('/api/materials').set(auth(adminToken)).send({ name: '', unit: 'kg' });
    expect(bad1.status).toBe(400);

    const bad2 = await request(app).post('/api/materials').set(auth(adminToken)).send({ name: `${runId}-x`, unit: '  ' });
    expect(bad2.status).toBe(400);
  });

  it('Admin mengubah nama bahan baku', async () => {
    const material = await createMaterial('ubah');

    const patched = await request(app)
      .patch(`/api/materials/${material.id}`)
      .set(auth(adminToken))
      .send({ name: `${runId}-bahan-ubah-baru` });
    expect(patched.status).toBe(200);
    expect(patched.body.material.name).toBe(`${runId}-bahan-ubah-baru`);
    expect(patched.body.material.unit).toBe('kg');
  });

  it('Bahan dengan riwayat operasional tidak dapat dihapus (409) dan satuan tidak dapat diubah (409)', async () => {
    const material = await createMaterial('riwayat');
    fakeHistoryFor([material.id]);

    const deleted = await request(app).delete(`/api/materials/${material.id}`).set(auth(adminToken));
    expect(deleted.status).toBe(409);
    expect(deleted.body.message).match(/riwayat operasional/i);

    const unitPatch = await request(app)
      .patch(`/api/materials/${material.id}`)
      .set(auth(adminToken))
      .send({ unit: 'liter' });
    expect(unitPatch.status).toBe(409);

    // Data tetap utuh.
    const detail = await request(app).get(`/api/materials/${material.id}`).set(auth(adminToken));
    expect(detail.body.material.unit).toBe('kg');
  });

  it('Bahan tanpa riwayat dapat dihapus; id tidak dikenal mengembalikan 404', async () => {
    const material = await createMaterial('dihapus');
    const deleted = await request(app).delete(`/api/materials/${material.id}`).set(auth(adminToken));
    expect(deleted.status).toBe(200);

    const detail = await request(app).get(`/api/materials/${material.id}`).set(auth(adminToken));
    expect(detail.status).toBe(404);

    const missing = await request(app).patch('/api/materials/id-tidak-ada').set(auth(adminToken)).send({ name: 'x' });
    expect(missing.status).toBe(404);
  });
});

describe('Hapus bahan baku — validasi relasi nyata', () => {
  it('Bahan dengan penerimaan nyata ditolak (409) dan riwayat tetap utuh', async () => {
    const material = await createMaterial('ada-penerimaan');

    const receipt = await request(app)
      .post(`/api/materials/${material.id}/receipts`)
      .set(auth(adminToken))
      .send({ quantity: 5, receivedAt: '2026-10-20', note: 'Penerimaan uji hapus' });
    expect(receipt.status).toBe(201);

    const deleted = await request(app).delete(`/api/materials/${material.id}`).set(auth(adminToken));
    expect(deleted.status).toBe(409);
    expect(deleted.body.message).toMatch(/riwayat operasional/i);
    expect(deleted.body.message).toMatch(/nonaktifkan/i);

    // Bahan dan riwayatnya tidak rusak.
    const detail = await request(app).get(`/api/materials/${material.id}`).set(auth(adminToken));
    expect(detail.status).toBe(200);
    expect(detail.body.material.name).toBe(material.name);
  });

  it('Bahan dengan pemakaian produksi ditolak (409) dan tidak ada cascade delete', async () => {
    const material = await createMaterial('ada-produksi');
    const product = await createProduct('bahan-produksi');

    // Catat pemakaian aktual bahan pada produksi. Relasi pemakaian produksi
    // dibuat langsung agar bahan ini TIDAK punya penerimaan/saldo awal, jadi
    // penolakan penghapusan benar-benar berasal dari relasi pemakaian produksi.
    const admin = await prisma.user.findUnique({
      where: { username: `${runId}-admin` },
      select: { id: true },
    });
    const production = await prisma.production.create({
      data: {
        productId: product.id,
        productionDate: new Date('2026-10-20T00:00:00.000Z'),
        yieldQuantity: 10,
        recordedById: admin!.id,
      },
      select: { id: true },
    });
    await prisma.productionMaterialUsage.create({
      data: { productionId: production.id, materialId: material.id, quantity: 2 },
    });

    const deleted = await request(app).delete(`/api/materials/${material.id}`).set(auth(adminToken));
    expect(deleted.status).toBe(409);
    expect(deleted.body.message).toMatch(/riwayat operasional/i);

    // Riwayat pemakaian produksi masih ada (tidak ikut terhapus).
    const usage = await prisma.productionMaterialUsage.findFirst({
      where: { materialId: material.id },
    });
    expect(usage).toBeTruthy();
  });

  it('Operator tidak dapat menghapus bahan baku (403)', async () => {
    const material = await createMaterial('operator-hapus');

    const deleted = await request(app).delete(`/api/materials/${material.id}`).set(auth(operatorToken));
    expect(deleted.status).toBe(403);

    // Tanpa token ditolak 401.
    const anonymous = await request(app).delete(`/api/materials/${material.id}`);
    expect(anonymous.status).toBe(401);

    // Bahan tetap ada.
    const detail = await request(app).get(`/api/materials/${material.id}`).set(auth(adminToken));
    expect(detail.status).toBe(200);
  });
});

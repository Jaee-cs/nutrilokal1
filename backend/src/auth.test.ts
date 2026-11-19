/**
 * Pengujian integrasi B2: autentikasi, pengelolaan akun, dan hak akses.
 * Berjalan terhadap database PostgreSQL lokal (docker compose).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createInitialAdmin } from './lib/bootstrap';
import { hashPassword, verifyPassword } from './lib/password';
import { prisma } from './lib/prisma';

const app = createApp();

// Penanda unik agar data uji tidak mengganggu data lain dan mudah dibersihkan.
const runId = `b2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const ADMIN_USERNAME = `${runId}-admin`;
const ADMIN_PASSWORD = 'admin-rahasia-123';
const OPERATOR_USERNAME = `${runId}-operator`;
const OPERATOR_PASSWORD = 'operator-rahasia-123';

let adminToken = '';
let operatorToken = '';

function login(username: string, password: string) {
  return request(app).post('/api/auth/login').send({ username, password });
}

async function createTempOperator(suffix: string) {
  const username = `${runId}-${suffix}`;
  const password = 'kata-sandi-tes';
  const user = await prisma.user.create({
    data: { username, passwordHash: await hashPassword(password), role: 'OPERATOR' },
  });
  return { user, password };
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: { username: ADMIN_USERNAME, passwordHash: await hashPassword(ADMIN_PASSWORD), role: 'ADMIN' },
  });
  await prisma.user.create({
    data: { username: OPERATOR_USERNAME, passwordHash: await hashPassword(OPERATOR_PASSWORD), role: 'OPERATOR' },
  });

  const adminLogin = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const operatorLogin = await login(OPERATOR_USERNAME, OPERATOR_PASSWORD);
  adminToken = adminLogin.body.token;
  operatorToken = operatorLogin.body.token;

  expect(admin.role).toBe('ADMIN');
  expect(adminToken).toBeTruthy();
  expect(operatorToken).toBeTruthy();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
});

describe('POST /api/auth/login', () => {
  it('berhasil dengan kredensial benar dan tidak mengembalikan hash', async () => {
    const res = await login(ADMIN_USERNAME, ADMIN_PASSWORD);

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.username).toBe(ADMIN_USERNAME);
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('menolak kata sandi salah dengan pesan umum', async () => {
    const res = await login(ADMIN_USERNAME, 'kata-sandi-salah');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Username atau kata sandi salah.');
  });

  it('menolak username tidak dikenal dengan pesan yang sama (anti user enumeration)', async () => {
    const res = await login(`${runId}-tidak-ada`, 'kata-sandi-salah');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Username atau kata sandi salah.');
  });

  it('menolak permintaan tanpa username atau kata sandi', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: ADMIN_USERNAME });

    expect(res.status).toBe(400);
  });

  it('menolak akun yang sudah dinonaktifkan', async () => {
    const { user, password } = await createTempOperator('login-nonaktif');
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const res = await login(user.username, password);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/dinonaktifkan/i);
  });
});

describe('GET /api/auth/me', () => {
  it('menolak request tanpa token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('menolak token rusak', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token-rusak');
    expect(res.status).toBe(401);
  });

  it('mengembalikan data pengguna yang login', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(ADMIN_USERNAME);
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });
});

describe('PATCH /api/auth/me — profil sendiri', () => {
  it('menolak permintaan tanpa token dan token rusak', async () => {
    const tanpaToken = await request(app).patch('/api/auth/me').send({ name: 'Uji' });
    const tokenRusak = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', 'Bearer token-rusak')
      .send({ name: 'Uji' });

    expect(tanpaToken.status).toBe(401);
    expect(tokenRusak.status).toBe(401);
  });

  it('Operator dapat mengubah nama lengkapnya sendiri', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { username: OPERATOR_USERNAME } });
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Operator Profil Baru' });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Operator Profil Baru');
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.name).toBe('Operator Profil Baru');
    expect(after.username).toBe(before.username);
    expect(after.role).toBe(before.role);
    expect(after.isActive).toBe(before.isActive);
    expect(after.mustChangePassword).toBe(before.mustChangePassword);
    expect(after.passwordHash).toBe(before.passwordHash);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${operatorToken}`);
    expect(me.body.user.name).toBe('Operator Profil Baru');
  });

  it('Admin juga dapat mengubah nama lengkapnya sendiri', async () => {
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Admin Profil Baru' });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Admin Profil Baru');
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('tidak mengubah akun pengguna lain', async () => {
    const { user: lain } = await createTempOperator('profil-lain');
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'Hanya Saya' });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: lain.id } });
    expect(res.status).toBe(200);
    expect(after.name).toBeNull();
  });

  it('menolak field selain nama dan tipe nama yang tidak valid', async () => {
    const auth = `Bearer ${operatorToken}`;

    const role = await request(app).patch('/api/auth/me').set('Authorization', auth).send({ name: 'X', role: 'ADMIN' });
    const username = await request(app).patch('/api/auth/me').set('Authorization', auth).send({ username: 'ubah' });
    const kosong = await request(app).patch('/api/auth/me').set('Authorization', auth).send({});
    const angka = await request(app).patch('/api/auth/me').set('Authorization', auth).send({ name: 123 });
    const panjang = await request(app).patch('/api/auth/me').set('Authorization', auth).send({ name: 'a'.repeat(101) });

    for (const res of [role, username, kosong, angka, panjang]) {
      expect(res.status).toBe(400);
    }
  });

  it('nama kosong disimpan sebagai null', async () => {
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '   ' });

    expect(res.status).toBe(200);
    expect(res.body.user.name).toBeNull();
  });

  it('diblokir saat pengguna wajib mengganti kata sandi', async () => {
    const { user, password } = await createTempOperator('profil-wajib');
    await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    const forcedLogin = await login(user.username, password);
    const res = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${forcedLogin.body.token}`)
      .send({ name: 'Diblokir' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
});

describe('Hak akses: Operator vs Admin', () => {
  it('Operator ditolak melihat daftar akun (403)', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
  });

  it('Request tanpa token ditolak (401)', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('Operator ditolak membuat akun (403)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ username: `${runId}-x`, password: 'kata-sandi-tes' });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/users — Admin membuat akun Operator', () => {
  it('berhasil membuat Operator dan mengembalikan data tanpa hash', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `${runId}-baru`, password: 'kata-sandi-baru', name: 'Operator Baru' });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe(`${runId}-baru`);
    expect(res.body.user.role).toBe('OPERATOR');
    expect(res.body.user).not.toHaveProperty('passwordHash');
  });

  it('menolak username duplikat (409)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `${runId}-baru`, password: 'kata-sandi-baru' });

    expect(res.status).toBe(409);
  });

  it('menolak pembuatan akun Admin melalui API (400)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `${runId}-admin-curiang`, password: 'kata-sandi-baru', role: 'ADMIN' });

    expect(res.status).toBe(400);
    const count = await prisma.user.count({ where: { username: `${runId}-admin-curiang` } });
    expect(count).toBe(0);
  });

  it('menolak kata sandi terlalu pendek (400)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: `${runId}-lemah`, password: 'pendek' });

    expect(res.status).toBe(400);
  });

  it('menolak username terlalu pendek (400)', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'ab', password: 'kata-sandi-baru' });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/users/:id — nonaktifkan/aktifkan kembali', () => {
  it('nonaktifkan akun: token lama ditolak dan login gagal; aktifkan kembali memulihkan akses', async () => {
    const { user, password } = await createTempOperator('nonaktif');

    // Login dulu untuk mendapatkan token sebelum dinonaktifkan.
    const beforeLogin = await login(user.username, password);
    expect(beforeLogin.status).toBe(200);
    const oldToken = beforeLogin.body.token;

    // Nonaktifkan.
    const deactivate = await request(app)
      .patch(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);
    expect(deactivate.body.user.isActive).toBe(false);

    // Token lama langsung ditolak.
    const blockedMe = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
    expect(blockedMe.status).toBe(401);

    // Login gagal.
    const blockedLogin = await login(user.username, password);
    expect(blockedLogin.status).toBe(403);

    // Aktifkan kembali.
    const reactivate = await request(app)
      .patch(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true });
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.user.isActive).toBe(true);

    const restoredLogin = await login(user.username, password);
    expect(restoredLogin.status).toBe(200);
  });

  it('menolak isActive yang bukan boolean (400)', async () => {
    const { user } = await createTempOperator('patch-invalid');
    const res = await request(app)
      .patch(`/api/users/${user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: 'no' });

    expect(res.status).toBe(400);
  });

  it('menolak Admin menonaktifkan akunnya sendiri (400)', async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { username: ADMIN_USERNAME } });
    const res = await request(app)
      .patch(`/api/users/${admin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(400);
  });

  it('mengembalikan 404 untuk id yang tidak ada', async () => {
    const res = await request(app)
      .patch('/api/users/id-tidak-ada')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(404);
  });
});

describe('Arsip akun via DELETE /api/users/:id (kompatibilitas)', () => {
  it('mengarsipkan Operator tanpa riwayat aktivitas', async () => {
    const { user, password } = await createTempOperator('dihapus');
    const userToken = (await login(user.username, password)).body.token;

    const res = await request(app).delete(`/api/users/${user.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);

    // Baris akun tetap ada dengan ID sama; hanya statusnya yang berubah.
    const archived = await prisma.user.findUnique({ where: { id: user.id } });
    expect(archived).not.toBeNull();
    expect(archived?.isActive).toBe(false);
    expect(archived?.archivedAt).not.toBeNull();

    // Token pengguna terarsip langsung tidak berlaku (sesi dicabut).
    const blocked = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${userToken}`);
    expect(blocked.status).toBe(401);
  });

  it('menolak Admin menghapus akunnya sendiri (400)', async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { username: ADMIN_USERNAME } });
    const res = await request(app).delete(`/api/users/${admin.id}`).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });

  it('menolak penghapusan akun Admin lain (403)', async () => {
    const secondAdmin = await prisma.user.create({
      data: { username: `${runId}-admin-kedua`, passwordHash: await hashPassword('kata-sandi-tes'), role: 'ADMIN' },
    });

    const res = await request(app).delete(`/api/users/${secondAdmin.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);

    await prisma.user.delete({ where: { id: secondAdmin.id } });
  });

  it('mengembalikan 404 untuk id yang tidak ada', async () => {
    const res = await request(app).delete('/api/users/id-tidak-ada').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('mengarsipkan Operator yang memiliki riwayat transaksi penjualan', async () => {
    const { user } = await createTempOperator('riwayat-penjualan');
    const sale = await prisma.saleTransaction.create({
      data: { total: 1000, recordedById: user.id },
    });

    try {
      const res = await request(app)
        .delete(`/api/users/${user.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(true);
      // Akun dan riwayatnya tetap ada, tidak dihapus.
      const archived = await prisma.user.findUnique({ where: { id: user.id } });
      expect(archived).not.toBeNull();
      expect(archived?.isActive).toBe(false);
      expect(await prisma.saleTransaction.findUnique({ where: { id: sale.id } })).not.toBeNull();
    } finally {
      await prisma.saleTransaction.delete({ where: { id: sale.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });

  it('mengarsipkan Operator yang hanya memiliki audit log perubahan kedaluwarsa', async () => {
    const { user } = await createTempOperator('riwayat-audit');
    const product = await prisma.product.create({
      data: { name: `${runId}-produk-audit`, unit: 'pcs', sellingPrice: 1000 },
    });
    const batch = await prisma.batch.create({
      data: { code: `${runId}-AUDIT`, productId: product.id },
    });
    const change = await prisma.batchExpiryChange.create({
      data: { batchId: batch.id, changedById: user.id, newExpiryDate: new Date() },
    });

    try {
      const res = await request(app)
        .delete(`/api/users/${user.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(true);
      const archived = await prisma.user.findUnique({ where: { id: user.id } });
      expect(archived).not.toBeNull();
      expect(archived?.isActive).toBe(false);
    } finally {
      await prisma.batchExpiryChange.delete({ where: { id: change.id } });
      await prisma.batch.delete({ where: { id: batch.id } });
      await prisma.product.delete({ where: { id: product.id } });
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });

  it('tidak mengubah akun lain saat satu Operator diarsipkan', async () => {
    const { user: keep } = await createTempOperator('tetap-ada');
    const { user: remove } = await createTempOperator('hapus-saja');
    const before = await prisma.user.count({ where: { username: { startsWith: runId } } });

    const res = await request(app)
      .delete(`/api/users/${remove.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const archived = await prisma.user.findUnique({ where: { id: remove.id } });
    expect(archived).not.toBeNull();
    expect(archived?.isActive).toBe(false);
    expect((await prisma.user.findUnique({ where: { id: keep.id } }))?.isActive).toBe(true);
    const after = await prisma.user.count({ where: { username: { startsWith: runId } } });
    expect(after).toBe(before);
  });

  it('menandai riwayat aktivitas pada daftar pengguna', async () => {
    const { user: fresh } = await createTempOperator('flag-tanpa-riwayat');
    const { user: withHistory } = await createTempOperator('flag-dengan-riwayat');
    const sale = await prisma.saleTransaction.create({
      data: { total: 500, recordedById: withHistory.id },
    });

    try {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const byId = new Map<string, { hasActivityHistory?: boolean }>(
        res.body.data.map((item: { id: string; hasActivityHistory?: boolean }) => [item.id, item])
      );
      expect(byId.get(fresh.id)?.hasActivityHistory).toBe(false);
      expect(byId.get(withHistory.id)?.hasActivityHistory).toBe(true);
    } finally {
      await prisma.saleTransaction.delete({ where: { id: sale.id } });
      await prisma.user.deleteMany({ where: { id: { in: [fresh.id, withHistory.id] } } });
    }
  });
});

describe('Alur reset kata sandi oleh Admin', () => {
  it('reset membuat kata sandi sementara dan tidak mengubah identitas akun', async () => {
    const { user, password } = await createTempOperator('reset-identitas');

    // Sesi lama dibuat sebelum reset — harus langsung tidak berlaku.
    const oldLogin = await login(user.username, password);
    expect(oldLogin.status).toBe(200);
    const oldToken = oldLogin.body.token as string;

    const reset = await request(app)
      .post(`/api/users/${user.id}/password-reset`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reset.status).toBe(200);
    expect(typeof reset.body.temporaryPassword).toBe('string');
    expect(reset.body.temporaryPassword.startsWith('NL-')).toBe(true);
    expect(JSON.stringify(reset.body)).not.toContain('passwordHash');
    const tempPassword = reset.body.temporaryPassword as string;

    // Hanya hash + wajib ganti yang berubah; username, role, status tetap.
    const afterReset = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(afterReset.username).toBe(user.username);
    expect(afterReset.role).toBe('OPERATOR');
    expect(afterReset.isActive).toBe(true);
    expect(afterReset.mustChangePassword).toBe(true);
    expect(afterReset.passwordHash).not.toBe(tempPassword);
    expect(await verifyPassword(tempPassword, afterReset.passwordHash)).toBe(true);

    // Sesi login lama tidak dapat dipakai lagi.
    const oldSession = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(oldSession.status).toBe(401);

    // Kata sandi lama juga mati.
    const oldPasswordLogin = await login(user.username, password);
    expect(oldPasswordLogin.status).toBe(401);
  });

  it('wajib ganti kata sandi: /me tetap terbuka, endpoint operasional ditolak, lalu akses pulih', async () => {
    const { user, password } = await createTempOperator('reset-alur');

    const reset = await request(app)
      .post(`/api/users/${user.id}/password-reset`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reset.status).toBe(200);
    const tempPassword = reset.body.temporaryPassword as string;

    // Kata sandi sementara dapat dipakai login.
    const tempLogin = await login(user.username, tempPassword);
    expect(tempLogin.status).toBe(200);
    expect(tempLogin.body.user.mustChangePassword).toBe(true);
    const tempToken = tempLogin.body.token as string;

    // Identitas sendiri tetap dapat dibaca (dibutuhkan setelah refresh),
    // tetapi Dashboard/API operasional diblokir backend.
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tempToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(true);

    const blockedDashboard = await request(app)
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${tempToken}`);
    expect(blockedDashboard.status).toBe(403);
    expect(blockedDashboard.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const blockedUsers = await request(app).get('/api/users').set('Authorization', `Bearer ${tempToken}`);
    expect(blockedUsers.status).toBe(403);

    // Kata sandi saat ini wajib diisi dan harus benar.
    const withoutCurrent = await request(app)
      .post('/api/auth/set-password')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ newPassword: 'kata-sandi-baru-123' });
    expect(withoutCurrent.status).toBe(400);

    const wrongCurrent = await request(app)
      .post('/api/auth/set-password')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ currentPassword: 'salah-total', newPassword: 'kata-sandi-baru-123' });
    expect(wrongCurrent.status).toBe(400);
    expect(wrongCurrent.body.message).toMatch(/saat ini salah/i);

    const weak = await request(app)
      .post('/api/auth/set-password')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ currentPassword: tempPassword, newPassword: 'pendek' });
    expect(weak.status).toBe(400);

    const sameAsCurrent = await request(app)
      .post('/api/auth/set-password')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ currentPassword: tempPassword, newPassword: tempPassword });
    expect(sameAsCurrent.status).toBe(400);

    const setNew = await request(app)
      .post('/api/auth/set-password')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ currentPassword: tempPassword, newPassword: 'kata-sandi-baru-123' });
    expect(setNew.status).toBe(200);
    expect(typeof setNew.body.token).toBe('string');
    expect(setNew.body.user.mustChangePassword).toBe(false);

    // Token sesi lama (sebelum password diganti) dan token sementara mati;
    // token baru dari respons set-password langsung berlaku.
    const oldTempSession = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tempToken}`);
    expect(oldTempSession.status).toBe(401);

    const newSession = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${setNew.body.token}`);
    expect(newSession.status).toBe(200);
    expect(newSession.body.user.mustChangePassword).toBe(false);

    // Kata sandi sementara tidak lagi berlaku; kata sandi baru berlaku.
    const tempLoginAgain = await login(user.username, tempPassword);
    expect(tempLoginAgain.status).toBe(401);

    const newLogin = await login(user.username, 'kata-sandi-baru-123');
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.mustChangePassword).toBe(false);

    // Admin tetap dapat mengelola akun setelah reset.
    const adminUsers = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
    expect(adminUsers.status).toBe(200);
    expect(adminUsers.body.data.some((item: { id: string }) => item.id === user.id)).toBe(true);

    // Kata sandi lama tidak pernah kembali berlaku.
    const oldPasswordLogin = await login(user.username, password);
    expect(oldPasswordLogin.status).toBe(401);
  });

  it('reset berulang: kata sandi sementara sebelumnya langsung tidak berlaku', async () => {
    const { user } = await createTempOperator('reset-berulang');

    const firstReset = await request(app)
      .post(`/api/users/${user.id}/password-reset`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(firstReset.status).toBe(200);
    const firstTemp = firstReset.body.temporaryPassword as string;

    const secondReset = await request(app)
      .post(`/api/users/${user.id}/password-reset`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(secondReset.status).toBe(200);
    const secondTemp = secondReset.body.temporaryPassword as string;

    expect(secondTemp).not.toBe(firstTemp);

    const firstLogin = await login(user.username, firstTemp);
    expect(firstLogin.status).toBe(401);

    const secondLogin = await login(user.username, secondTemp);
    expect(secondLogin.status).toBe(200);
    expect(secondLogin.body.user.mustChangePassword).toBe(true);
  });

  it('set-password menolak request tanpa token (401)', async () => {
    const res = await request(app)
      .post('/api/auth/set-password')
      .send({ currentPassword: 'apa-saja', newPassword: 'kata-sandi-baru' });
    expect(res.status).toBe(401);
  });

  it('reset mengembalikan 404 untuk id yang tidak ada', async () => {
    const res = await request(app)
      .post('/api/users/id-tidak-ada/password-reset')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('Bootstrap akun Admin pertama', () => {
  it('menolak kata sandi terlalu pendek', async () => {
    await expect(
      createInitialAdmin({ username: `${runId}-initial-admin`, password: 'pendek' })
    ).rejects.toThrow(/minimal 8/);
  });

  it('berhasil membuat Admin pertama saat belum ada Admin (diuji dalam transaksi yang di-rollback)', async () => {
    const outcome = await prisma
      .$transaction(async (tx) => {
        // Simulasikan kondisi awal: belum ada satupun akun Admin.
        // Ubah peran (bukan hapus baris) agar tidak melanggar foreign key
        // riwayat yang mereferensikan akun Admin yang sudah ada di database.
        await tx.user.updateMany({ where: { role: 'ADMIN' }, data: { role: 'OPERATOR' } });

        const admin = await createInitialAdmin(
          { username: `${runId}-initial-admin`, password: 'bootstrap-rahasia-123', name: 'Admin Awal' },
          tx
        );

        const created = await tx.user.findUniqueOrThrow({ where: { id: admin.id } });
        expect(created.role).toBe('ADMIN');
        expect(created.name).toBe('Admin Awal');

        // Kata sandi tersimpan sebagai hash bcrypt, bukan teks biasa.
        expect(created.passwordHash).not.toBe('bootstrap-rahasia-123');
        expect(await verifyPassword('bootstrap-rahasia-123', created.passwordHash)).toBe(true);

        throw new Error('ROLLBACK_UJI');
      })
      .catch((error: unknown) => error);

    // Pastikan transaksi benar-benar di-rollback sehingga data sungguhan tidak berubah.
    expect((outcome as Error).message).toBe('ROLLBACK_UJI');
  });

  it('menolak pembuatan Admin kedua', async () => {
    // Pastikan minimal ada satu Admin (data uji atau data lokal).
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (adminCount === 0) {
      await prisma.user.create({
        data: {
          username: `${runId}-admin-nyata`,
          passwordHash: await hashPassword('kata-sandi-tes'),
          role: 'ADMIN',
        },
      });
    }

    await expect(
      createInitialAdmin({ username: `${runId}-admin-kedua`, password: 'bootstrap-rahasia-123' })
    ).rejects.toThrow(/sudah ada/i);
  });
});

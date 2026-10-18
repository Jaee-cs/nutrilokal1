/**
 * Pengujian integrasi B2: autentikasi, pengelolaan akun, dan hak akses.
 * Berjalan terhadap database PostgreSQL lokal (docker compose).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createInitialAdmin } from './lib/bootstrap';
import { hashPassword } from './lib/password';
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

describe('DELETE /api/users/:id', () => {
  it('menghapus Operator tanpa riwayat aktivitas', async () => {
    const { user, password } = await createTempOperator('dihapus');
    const userToken = (await login(user.username, password)).body.token;

    const res = await request(app).delete(`/api/users/${user.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    // Token pengguna terhapus langsung tidak berlaku.
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
});

describe('Alur reset kata sandi oleh Admin', () => {
  it('reset: kata sandi lama mati, token wajib ganti kata sandi, dan akses pulih setelah set-password', async () => {
    const { user, password } = await createTempOperator('reset');

    // 1. Admin memulai reset dan mendapatkan kata sandi sementara (sekali tampil).
    const reset = await request(app)
      .post(`/api/users/${user.id}/password-reset`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reset.status).toBe(200);
    expect(typeof reset.body.temporaryPassword).toBe('string');
    expect(reset.body.temporaryPassword.startsWith('NL-')).toBe(true);
    const tempPassword = reset.body.temporaryPassword as string;

    // 2. Kata sandi lama sudah tidak berlaku.
    const oldLogin = await login(user.username, password);
    expect(oldLogin.status).toBe(401);

    // 3. Login dengan kata sandi sementara berhasil, wajib ganti kata sandi.
    const tempLogin = await login(user.username, tempPassword);
    expect(tempLogin.status).toBe(200);
    expect(tempLogin.body.user.mustChangePassword).toBe(true);
    const tempToken = tempLogin.body.token as string;

    // 4. Semua endpoint lain ditolak sampai kata sandi baru ditetapkan.
    const blocked = await request(app).get('/api/users').set('Authorization', `Bearer ${tempToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // 5. Set-password menolak kata sandi lemah lalu menerima yang valid.
    const weak = await request(app)
      .post('/api/auth/set-password')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ newPassword: 'pendek' });
    expect(weak.status).toBe(400);

    const setNew = await request(app)
      .post('/api/auth/set-password')
      .set('Authorization', `Bearer ${tempToken}`)
      .send({ newPassword: 'kata-sandi-baru-123' });
    expect(setNew.status).toBe(200);

    // 6. Akses pulih; kata sandi sementara sudah mati.
    const recovered = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tempToken}`);
    expect(recovered.status).toBe(200);

    const tempLoginAgain = await login(user.username, tempPassword);
    expect(tempLoginAgain.status).toBe(401);

    const newLogin = await login(user.username, 'kata-sandi-baru-123');
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.mustChangePassword).toBe(false);
  });

  it('set-password menolak request tanpa token (401)', async () => {
    const res = await request(app).post('/api/auth/set-password').send({ newPassword: 'kata-sandi-baru' });
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

  it('berhasil membuat Admin pertama saat belum ada Admin', async () => {
    // Bersihkan semua akun uji agar benar-benar belum ada Admin.
    await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    expect(adminCount).toBe(0);

    const admin = await createInitialAdmin({
      username: `${runId}-initial-admin`,
      password: 'bootstrap-rahasia-123',
      name: 'Admin Awal',
    });

    const created = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(created.role).toBe('ADMIN');

    // Admin hasil bootstrap bisa login.
    const loginRes = await login(created.username, 'bootstrap-rahasia-123');
    expect(loginRes.status).toBe(200);
  });

  it('menolak pembuatan Admin kedua', async () => {
    await expect(
      createInitialAdmin({ username: `${runId}-admin-kedua`, password: 'bootstrap-rahasia-123' })
    ).rejects.toThrow(/sudah ada/i);
  });
});

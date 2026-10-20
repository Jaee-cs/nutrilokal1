/**
 * Integrasi Cloudinary untuk foto produk (README 5.6).
 *
 * Pengujian ini memakai MOCK paket `cloudinary` — tidak ada permintaan jaringan
 * ke Cloudinary yang sesungguhnya. Yang dibuktikan:
 *  1. Bila ketiga kredensial diisi, unggahan produk masuk ke Cloudinary dan
 *     URL + public ID disimpan ke database.
 *  2. Saat foto diganti, foto baru diunggah lebih dulu, database diperbarui,
 *     BARU foto lama dihapus memakai public ID lama (aman & tidak destruktif).
 *  3. Saat unggahan ke Cloudinary gagal, produk tetap tidak berubah dan tidak
 *     ada public ID yang tersimpan (data tetap konsisten).
 *  4. Saat penghapusan di Cloudinary gagal, perubahan database tetap berhasil.
 *
 * Catatan: kredensial palsu diset lewat `vi.hoisted` agar sudah terpasang
 * SEBELUM modul aplikasi dievaluasi (konfigurasi Cloudinary dibaca sekali saat
 * modul dimuat). Paket `cloudinary` di-mock penuh sehingga tidak ada jaringan.
 */
import type { Express } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

const cloudinaryEnv = vi.hoisted(() => {
  process.env.CLOUDINARY_CLOUD_NAME = 'nl-test-cloud';
  process.env.CLOUDINARY_API_KEY = 'nl-test-key';
  process.env.CLOUDINARY_API_SECRET = 'nl-test-secret';
  return true;
});

const uploadStream = vi.fn();
const destroy = vi.fn();

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload_stream: (...args: unknown[]) => uploadStream(...args),
      destroy: (...args: unknown[]) => destroy(...args),
    },
  },
}));

import { createApp } from './app';
import { prisma as sharedPrisma } from './lib/prisma';
import { env } from './config/env';

void cloudinaryEnv;

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAI/wH+0pM4AAAAAElFTkSuQmCC',
  'base64'
);

/** Meniru perilaku `upload_stream` Cloudinary: callback dipanggil async. */
function mockUploadSuccess(publicId: string, secureUrl: string) {
  uploadStream.mockImplementation(
    (_options: unknown, callback: (error: unknown, result: unknown) => void) => {
      const stream = {
        on: () => stream,
        end: () => {
          setImmediate(() => callback(null, { public_id: publicId, secure_url: secureUrl }));
        },
      };
      return stream;
    }
  );
}

describe('Foto produk — penyimpanan Cloudinary', () => {
  let app: Express;
  let prisma: PrismaClient = sharedPrisma;
  let adminToken = '';
  let runId = '';

  beforeAll(async () => {
    expect(env.CLOUDINARY.configured).toBe(true);
    app = createApp();
    const passwordMod = await import('./lib/password');
    runId = `test-cloud-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    await prisma.user.create({
      data: {
        username: `${runId}-admin`,
        passwordHash: await passwordMod.hashPassword('admin-rahasia-123'),
        role: 'ADMIN',
      },
    });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: `${runId}-admin`, password: 'admin-rahasia-123' });
    adminToken = login.body.token;
    expect(adminToken).toBeTruthy();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: runId } } });
    await prisma.product.deleteMany({ where: { name: { startsWith: runId } } });
    await prisma.$disconnect();
  });

  async function createProduct(suffix: string) {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${runId}-${suffix}`, unit: 'pcs', sellingPrice: 1000 });
    expect(res.status).toBe(201);
    return res.body.product as { id: string; photoUrl: string | null };
  }

  const uploadPhoto = (productId: string, body: Buffer, contentType = 'image/png') =>
    request(app)
      .post(`/api/products/${productId}/photo`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', contentType)
      .send(body);

  it('unggahan masuk Cloudinary dan URL + public ID tersimpan', async () => {
    mockUploadSuccess(
      'nutrilokal/products/abc/foto-1',
      'https://res.cloudinary.com/nl/image/upload/abc.jpg'
    );
    const product = await createProduct('cloud-upload');

    const res = await uploadPhoto(product.id, PNG_1PX);
    expect(res.status).toBe(200);
    expect(res.body.product.photoUrl).toBe(
      'https://res.cloudinary.com/nl/image/upload/abc.jpg'
    );
    // Public ID TIDAK bocor ke respons API.
    expect(JSON.stringify(res.body)).not.toContain('nutrilokal/products/abc/foto-1');

    const stored = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stored?.photoUrl).toBe('https://res.cloudinary.com/nl/image/upload/abc.jpg');
    expect(stored?.photoPublicId).toBe('nutrilokal/products/abc/foto-1');

    // Cloudinary dipanggil dengan folder produk dan resource_type image.
    const options = uploadStream.mock.calls[0][0] as { folder: string; resource_type: string };
    expect(options.folder).toBe(`nutrilokal/products/${product.id}`);
    expect(options.resource_type).toBe('image');
  });

  it('ganti foto: unggah baru → simpan DB → hapus foto lama via public ID', async () => {
    mockUploadSuccess(
      'nutrilokal/products/old/foto-lama',
      'https://res.cloudinary.com/nl/old.jpg'
    );
    const product = await createProduct('cloud-ganti');

    const first = await uploadPhoto(product.id, PNG_1PX);
    expect(first.status).toBe(200);

    mockUploadSuccess(
      'nutrilokal/products/new/foto-baru',
      'https://res.cloudinary.com/nl/new.jpg'
    );
    destroy.mockClear();
    const second = await uploadPhoto(product.id, PNG_1PX);
    expect(second.status).toBe(200);
    expect(second.body.product.photoUrl).toBe('https://res.cloudinary.com/nl/new.jpg');

    // Foto lama dihapus memakai public ID lama, SETELAH database sukses.
    expect(destroy).toHaveBeenCalledWith(
      'nutrilokal/products/old/foto-lama',
      expect.objectContaining({ resource_type: 'image' })
    );

    const stored = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stored?.photoPublicId).toBe('nutrilokal/products/new/foto-baru');
  });

  it('penghapusan foto mengosongkan kolom dan menghapus objek Cloudinary', async () => {
    mockUploadSuccess('nutrilokal/products/del/foto', 'https://res.cloudinary.com/nl/del.jpg');
    const product = await createProduct('cloud-hapus');
    await uploadPhoto(product.id, PNG_1PX);

    destroy.mockClear();
    const res = await request(app)
      .delete(`/api/products/${product.id}/photo`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.product.photoUrl).toBeNull();
    expect(destroy).toHaveBeenCalledWith(
      'nutrilokal/products/del/foto',
      expect.objectContaining({ resource_type: 'image' })
    );

    const stored = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stored?.photoUrl).toBeNull();
    expect(stored?.photoPublicId).toBeNull();
  });

  it('unggahan Cloudinary gagal: produk tidak berubah dan tidak ada public ID tersimpan', async () => {
    uploadStream.mockImplementation(
      (_options: unknown, callback: (error: unknown, result: unknown) => void) => {
        const stream = {
          on: () => stream,
          end: () => setImmediate(() => callback(new Error('cloudinary down'), null)),
        };
        return stream;
      }
    );

    const product = await createProduct('cloud-gagal');
    const res = await uploadPhoto(product.id, PNG_1PX);
    expect(res.status).toBeGreaterThanOrEqual(500);

    const stored = await prisma.product.findUnique({ where: { id: product.id } });
    expect(stored?.photoUrl).toBeNull();
    expect(stored?.photoPublicId).toBeNull();
  });

  it('hapus foto lama gagal di Cloudinary: perubahan database tetap berhasil', async () => {
    mockUploadSuccess(
      'nutrilokal/products/fail-del/lama',
      'https://res.cloudinary.com/nl/lama.jpg'
    );
    const product = await createProduct('cloud-hapus-gagal');
    await uploadPhoto(product.id, PNG_1PX);

    destroy.mockImplementationOnce(() => Promise.reject(new Error('destroy gagal')));
    const res = await request(app)
      .delete(`/api/products/${product.id}/photo`)
      .set('Authorization', `Bearer ${adminToken}`);
    // Penghapusan data tidak boleh gagal hanya karena penyimpanan eksternal error.
    expect(res.status).toBe(200);
    expect(res.body.product.photoUrl).toBeNull();
  });
});

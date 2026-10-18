import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

const app = createApp();

describe('GET /api/health', () => {
  it('mengembalikan status backend dan koneksi database', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'nutrilokal-backend',
      database: 'up',
    });
    expect(typeof res.body.timestamp).toBe('string');
    expect(Number.isInteger(res.body.uptimeSeconds)).toBe(true);
  });
});

describe('Route yang tidak dikenal', () => {
  it('mengembalikan 404 dengan pesan JSON', async () => {
    const res = await request(app).get('/api/tidak-ada');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('message');
  });
});

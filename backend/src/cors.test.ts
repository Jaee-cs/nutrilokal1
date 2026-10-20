/**
 * Pengujian middleware CORS: origin yang diizinkan menerima header CORS,
 * preflight OPTIONS dijawab, dan origin tak dikenal tidak mendapat header.
 *
 * Middleware diuji pada instance Express kecil dengan origin yang disuntik
 * lewat env FRONTEND_ORIGIN, terpisah dari createApp() yang membaca env saat
 * modul dimuat.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ALLOWED = 'https://nutrilokal-testing.onrender.com';
const UNKNOWN = 'https://jahat.example.com';

describe('CORS middleware', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.FRONTEND_ORIGIN = `${ALLOWED},http://localhost:5173`;
    const { corsMiddleware } = await import('./middleware/cors');
    app = express();
    app.use(corsMiddleware);
    app.get('/api/ping', (_req, res) => {
      res.json({ ok: true });
    });
  });

  afterAll(() => {
    delete process.env.FRONTEND_ORIGIN;
  });

  it('memberi header CORS untuk origin yang diizinkan', async () => {
    const res = await request(app).get('/api/ping').set('Origin', ALLOWED);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
    expect(res.headers.vary).toContain('Origin');
  });

  it('tidak memberi header CORS untuk origin tak dikenal', async () => {
    const res = await request(app).get('/api/ping').set('Origin', UNKNOWN);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('menjawab preflight OPTIONS untuk origin yang diizinkan', async () => {
    const res = await request(app)
      .options('/api/ping')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('menolak preflight dari origin tak dikenal', async () => {
    const res = await request(app).options('/api/ping').set('Origin', UNKNOWN);
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('tanpa Origin (same-origin/server-to-server) tetap lolos', async () => {
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

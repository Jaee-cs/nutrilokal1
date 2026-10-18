/**
 * Health check: memeriksa status backend dan koneksi database.
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const report = {
    status: 'ok' as 'ok' | 'degraded',
    service: 'nutrilokal-backend',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    database: 'down' as 'up' | 'down',
  };

  try {
    // Query sederhana untuk memastikan database benar-benar bisa diakses.
    await prisma.$queryRaw`SELECT 1`;
    report.database = 'up';
  } catch (error) {
    report.database = 'down';
    report.status = 'degraded';
    console.error('[health] Koneksi database gagal:', error);
  }

  // 503 jika database tidak terjangkau agar mudah dipantau oleh tools monitoring.
  res.status(report.status === 'ok' ? 200 : 503).json(report);
});

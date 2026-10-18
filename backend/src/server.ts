/**
 * Titik masuk server backend.
 * Menjalankan Express di PORT dari environment variables dan
 * memastikan koneksi database ditutup dengan aman saat server berhenti.
 */
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`NutriLokal backend berjalan di http://localhost:${env.PORT}`);
  console.log(`Health check: http://localhost:${env.PORT}/api/health`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} diterima. Menutup server dengan aman...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

/**
 * Entry point produksi untuk Hostinger Web App.
 *
 * Hostinger menjalankan berkas ini sebagai Express app. Setelah build command
 * (`npm install && npx prisma generate && npm run build && npx prisma migrate deploy`)
 * menghasilkan dist/, berkas ini menyerahkan kontrol ke server NutriLokal.
 * Sebelum dist/ ada, berkas ini tetap merupakan Express app yang valid.
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const compiledServer = path.join(__dirname, 'dist', 'server.js');

/**
 * Bootstrap akun Admin pertama bila kredensial disediakan lewat environment.
 * Dipakai karena menjalankan skrip CLI Prisma di lingkungan SSH Hostinger
 * memicu panic Query Engine, sedangkan runtime Passenger berjalan normal.
 * Aman dijalankan berulang: createInitialAdmin menolak bila Admin sudah ada.
 */
async function bootstrapAdminIfRequested() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    return;
  }

  const bootstrapPath = path.join(__dirname, 'dist', 'lib', 'bootstrap.js');
  if (!fs.existsSync(bootstrapPath)) {
    return;
  }

  const { createInitialAdmin } = require(bootstrapPath);

  try {
    const admin = await createInitialAdmin({
      username,
      password,
      name: process.env.ADMIN_NAME?.trim() || undefined,
    });
    console.log(`Akun Admin "${admin.username}" berhasil dibuat.`);
  } catch (error) {
    console.log(`Bootstrap Admin dilewati: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (fs.existsSync(compiledServer)) {
  void bootstrapAdminIfRequested().finally(() => {
    require(compiledServer);
  });
} else {
  const app = express();
  app.get('/', (_req, res) => {
    res.send('NutriLokal backend sedang disiapkan.');
  });
  app.listen(Number(process.env.PORT) || 3000, () => {
    console.log('NutriLokal bootstrap server siap; menunggu hasil build.');
  });
}

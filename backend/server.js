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

if (fs.existsSync(compiledServer)) {
  require(compiledServer);
} else {
  const app = express();
  app.get('/', (_req, res) => {
    res.send('NutriLokal backend sedang disiapkan.');
  });
  app.listen(Number(process.env.PORT) || 3000, () => {
    console.log('NutriLokal bootstrap server siap; menunggu hasil build.');
  });
}

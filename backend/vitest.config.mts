import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Semua file pengujian berbagi SATU database PostgreSQL lokal.
    // Jalankan file secara berurutan (bukan paralel) agar tes dari file
    // berbeda tidak saling melanggar foreign key atau mengunci baris
    // saat transaksi berjalan bersamaan (mis. tes bootstrap Admin).
    fileParallelism: false,
    // Interaksi stok bersamaan diuji di dalam satu file tes, bukan antar file.
    testTimeout: 20_000,
  },
});

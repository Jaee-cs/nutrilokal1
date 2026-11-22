-- Keterangan tambahan opsional pada penyesuaian stok.
--
-- Aman untuk data lama: hanya menambah satu kolom nullable. Tidak mengubah
-- stok, riwayat pergerakan, transaksi, maupun data lainnya.
ALTER TABLE "stock_adjustments"
  ADD COLUMN "note" TEXT;

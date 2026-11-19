-- Arsip (soft archive) untuk master data.
--
-- Aman untuk data lama: hanya menambah kolom nullable dan indeks.
-- Status isActive tidak diubah, jadi seluruh data yang sudah ada tetap
-- dianggap aktif. Tidak ada tabel salinan, tidak ada ID baru, tidak ada
-- penghapusan data, dan tidak ada perubahan pada riwayat/transaksi.

ALTER TABLE "products"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedById" TEXT,
  ADD COLUMN "archiveReason" TEXT;

ALTER TABLE "materials"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedById" TEXT,
  ADD COLUMN "archiveReason" TEXT;

ALTER TABLE "users"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedById" TEXT,
  ADD COLUMN "archiveReason" TEXT;

CREATE INDEX "products_archivedAt_idx" ON "products"("archivedAt");
CREATE INDEX "materials_archivedAt_idx" ON "materials"("archivedAt");
CREATE INDEX "users_archivedAt_idx" ON "users"("archivedAt");

-- Pencatat arsip adalah Admin. ON DELETE SET NULL menjaga integritas bila
-- suatu hari akun Admin dihapus lewat jalur administratif di luar aplikasi.
ALTER TABLE "products"
  ADD CONSTRAINT "products_archivedById_fkey"
  FOREIGN KEY ("archivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "materials"
  ADD CONSTRAINT "materials_archivedById_fkey"
  FOREIGN KEY ("archivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_archivedById_fkey"
  FOREIGN KEY ("archivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

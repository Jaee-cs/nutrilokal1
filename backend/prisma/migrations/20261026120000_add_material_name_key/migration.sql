-- Nama bahan baku unik tanpa membedakan huruf besar/kecil dan spasi
-- di awal/akhir nama.
--
-- Kolom "name_key" menyimpan lower(btrim(name)) dan diberi indeks unik.
-- Dengan begitu duplikat tetap tertolak di tingkat database, termasuk saat
-- dua permintaan penambahan datang hampir bersamaan. Bahan nonaktif tetap
-- menempati kuncinya sehingga tidak dapat dibuat ulang dengan nama sama.
--
-- Data lama diisi otomatis dari kolom "name"; tidak ada baris yang dihapus
-- atau digabungkan. Bila ternyata sudah ada nama duplikat, migrasi berhenti
-- dengan pesan jelas agar dapat dirapikan manual lebih dulu.
ALTER TABLE "materials" ADD COLUMN "name_key" TEXT;

UPDATE "materials" SET "name_key" = lower(btrim("name"));

DO $$
DECLARE
  duplicate_key TEXT;
BEGIN
  SELECT lower(btrim("name")) INTO duplicate_key
  FROM "materials"
  GROUP BY lower(btrim("name"))
  HAVING count(*) > 1
  LIMIT 1;

  IF duplicate_key IS NOT NULL THEN
    RAISE EXCEPTION
      'Migrasi dibatalkan: nama bahan baku "%" terdaftar lebih dari sekali. Rapikan data duplikat secara manual sebelum menjalankan migrasi ini.',
      duplicate_key;
  END IF;
END $$;

ALTER TABLE "materials" ALTER COLUMN "name_key" SET NOT NULL;

CREATE UNIQUE INDEX "materials_name_key_key" ON "materials"("name_key");

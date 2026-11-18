-- Satuan Manual sebagai teks bebas.
--
-- Satuan hasil audit sebelumnya (`mg`, `g`, `kg`, `ml`, `L`, `pcs`) tetap
-- disimpan apa adanya. Tidak ada angka stok, penerimaan, pergerakan, atau
-- pemakaian produksi historis yang diubah. Kode lama di luar Berat/Volume
-- (mis. `pcs`) kini diperlakukan sebagai satuan Manual dan ditandai untuk
-- pemeriksaan Admin, bukan dikonversi otomatis.

-- Penanda Manual pada bahan baku.
ALTER TABLE "materials" ADD COLUMN "isManual" BOOLEAN NOT NULL DEFAULT false;

-- Kolom satuan menjadi teks agar pengguna dapat mengetik satuan Manual sendiri.
ALTER TABLE "materials"
  ALTER COLUMN "unit" TYPE TEXT USING "unit"::text;
ALTER TABLE "product_recipe_items"
  ALTER COLUMN "recipeUnit" TYPE TEXT USING "recipeUnit"::text;
ALTER TABLE "productions_material_usage"
  ALTER COLUMN "inputUnit" TYPE TEXT USING "inputUnit"::text;

-- Kode lama di luar Berat/Volume menjadi Manual. Tidak ada tebak konversi.
UPDATE "materials"
SET "isManual" = true
WHERE "unit" NOT IN ('mg', 'g', 'kg', 'ml', 'L');

-- Tandai bahan Manual lama. `NOT EXISTS` menghindari duplikasi dengan penanda
-- yang sudah dibuat migrasi sebelumnya untuk satuan benar-benar asing.
INSERT INTO "unit_reviews"
  ("id", "entityType", "entityId", "field", "legacyValue", "reason")
SELECT 'ur-manual-material-' || m."id", 'MATERIAL', m."id", 'unit', m."unit",
  'Satuan lama di luar Berat/Volume kini diperlakukan sebagai Manual. Tidak dikonversi otomatis; periksa sebelum dipakai resep atau konversi.'
FROM "materials" m
WHERE m."unit" NOT IN ('mg', 'g', 'kg', 'ml', 'L')
  AND NOT EXISTS (
    SELECT 1 FROM "unit_reviews" ur
    WHERE ur."entityType" = 'MATERIAL' AND ur."entityId" = m."id" AND ur."field" = 'unit'
  );

-- Tandai resep lama yang memakai satuan Manual. Resep tidak diubah/dihapus;
-- Admin perlu membersihkannya sebelum satuan bahan dapat diubah.
INSERT INTO "unit_reviews"
  ("id", "entityType", "entityId", "field", "legacyValue", "reason")
SELECT 'ur-manual-recipe-' || r."id", 'PRODUCT_RECIPE_ITEM', r."id", 'recipeUnit', r."recipeUnit",
  'Resep lama memakai satuan Manual. Resep otomatis hanya untuk Berat/Volume; Admin perlu memperbarui atau menghapus resep ini.'
FROM "product_recipe_items" r
WHERE r."recipeUnit" NOT IN ('mg', 'g', 'kg', 'ml', 'L')
  AND NOT EXISTS (
    SELECT 1 FROM "unit_reviews" ur
    WHERE ur."entityType" = 'PRODUCT_RECIPE_ITEM' AND ur."entityId" = r."id" AND ur."field" = 'recipeUnit'
  );

-- Tandai pemakaian produksi lama bersatuan Manual. Catatan historis tetap utuh.
INSERT INTO "unit_reviews"
  ("id", "entityType", "entityId", "field", "legacyValue", "reason")
SELECT 'ur-manual-usage-' || u."id", 'PRODUCTION_MATERIAL_USAGE', u."id", 'inputUnit', u."inputUnit",
  'Pemakaian produksi lama memakai satuan Manual. Jumlah dan satuan historis tidak diubah; tidak ada konversi otomatis.'
FROM "productions_material_usage" u
WHERE u."inputUnit" IS NOT NULL
  AND u."inputUnit" NOT IN ('mg', 'g', 'kg', 'ml', 'L')
  AND NOT EXISTS (
    SELECT 1 FROM "unit_reviews" ur
    WHERE ur."entityType" = 'PRODUCTION_MATERIAL_USAGE'
      AND ur."entityId" = u."id" AND ur."field" = 'inputUnit'
  );

-- Enum lama tidak dipakai lagi setelah semua kolom menjadi teks.
DROP TYPE "UnitCode";

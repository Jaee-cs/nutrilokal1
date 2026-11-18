-- Standardisasi satuan bahan baku, resep, dan pemakaian produksi.
--
-- Strategi konservatif:
-- 1. Alias yang JELAS dipetakan ke kode baku (gram -> g, liter/l -> L).
--    Angka stok, penerimaan, pergerakan, dan catatan produksi TIDAK diubah.
-- 2. Data yang tidak jelas TIDAK ditebak; ditandai di `unit_reviews` untuk
--    pemeriksaan Admin. `products.unit` sengaja tetap TEXT agar alur
--    penjualan dan laporan lama tidak berubah.
-- 3. Kolom satuan bahan/resep/input diubah menjadi enum UnitCode sehingga
--    teks bebas tidak bisa lagi tersimpan.

-- CreateEnum
CREATE TYPE "UnitCode" AS ENUM (
  'mg', 'g', 'kg', 'ml', 'L', 'pcs', 'buah', 'butir', 'sachet', 'bungkus', 'botol', 'kaleng'
);

-- CreateTable: penanda data yang perlu pemeriksaan Admin.
CREATE TABLE "unit_reviews" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "legacyValue" TEXT,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "note" TEXT,
  CONSTRAINT "unit_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "unit_reviews_reviewedAt_idx" ON "unit_reviews"("reviewedAt");

-- Pemetaan alias lama yang tidak ambigu.
UPDATE "materials" SET "unit" = 'g'
  WHERE lower("unit") IN ('gram', 'grams', 'g');
UPDATE "materials" SET "unit" = 'L'
  WHERE lower("unit") IN ('liter', 'liters', 'litre', 'litres', 'l');

UPDATE "product_recipe_items" SET "recipeUnit" = 'g'
  WHERE lower("recipeUnit") IN ('gram', 'grams', 'g');
UPDATE "product_recipe_items" SET "recipeUnit" = 'L'
  WHERE lower("recipeUnit") IN ('liter', 'liters', 'litre', 'litres', 'l');

UPDATE "productions_material_usage" SET "inputUnit" = 'g'
  WHERE lower("inputUnit") IN ('gram', 'grams', 'g');
UPDATE "productions_material_usage" SET "inputUnit" = 'L'
  WHERE lower("inputUnit") IN ('liter', 'liters', 'litre', 'litres', 'l');

-- Tandai satuan yang tidak dikenal. Tidak ada nilai yang ditebak atau diubah.
INSERT INTO "unit_reviews"
  ("id", "entityType", "entityId", "field", "legacyValue", "reason")
SELECT 'ur-material-' || "id", 'MATERIAL', "id", 'unit', "unit",
  'Satuan bahan lama tidak termasuk kode baku. Tetap disimpan apa adanya dan menunggu pemeriksaan Admin.'
FROM "materials"
WHERE "unit" NOT IN ('mg','g','kg','ml','L','pcs','buah','butir','sachet','bungkus','botol','kaleng');

INSERT INTO "unit_reviews"
  ("id", "entityType", "entityId", "field", "legacyValue", "reason")
SELECT 'ur-recipe-' || "id", 'PRODUCT_RECIPE_ITEM', "id", 'recipeUnit', "recipeUnit",
  'Satuan resep lama tidak termasuk kode baku. Resep tidak diubah otomatis; menunggu pemeriksaan Admin.'
FROM "product_recipe_items"
WHERE "recipeUnit" NOT IN ('mg','g','kg','ml','L','pcs','buah','butir','sachet','bungkus','botol','kaleng');

INSERT INTO "unit_reviews"
  ("id", "entityType", "entityId", "field", "legacyValue", "reason")
SELECT 'ur-usage-' || "id", 'PRODUCTION_MATERIAL_USAGE', "id", 'inputUnit', "inputUnit",
  'Satuan input produksi lama tidak termasuk kode baku. Catatan produksi historis tidak diubah.'
FROM "productions_material_usage"
WHERE "inputUnit" IS NOT NULL
  AND "inputUnit" NOT IN ('mg','g','kg','ml','L','pcs','buah','butir','sachet','bungkus','botol','kaleng');

INSERT INTO "unit_reviews"
  ("id", "entityType", "entityId", "field", "legacyValue", "reason")
SELECT 'ur-usage-null-' || "id", 'PRODUCTION_MATERIAL_USAGE', "id", 'inputUnit', NULL,
  'Data produksi lama tidak menyimpan satuan input. Jumlah dan satuan stok historis tidak diubah; perlu pemeriksaan Admin.'
FROM "productions_material_usage"
WHERE "inputUnit" IS NULL;

INSERT INTO "unit_reviews"
  ("id", "entityType", "entityId", "field", "legacyValue", "reason")
SELECT 'ur-product-' || "id", 'PRODUCT', "id", 'unit', "unit",
  'Satuan produk lama di luar daftar baku. Tidak dipetakan otomatis agar transaksi dan laporan lama tidak berubah.'
FROM "products"
WHERE "unit" NOT IN ('mg','g','kg','ml','L','pcs','buah','butir','sachet','bungkus','botol','kaleng');

-- AlterTable: kode baku dijamin oleh tipe database, bukan hanya validasi API.
ALTER TABLE "materials"
  ALTER COLUMN "unit" TYPE "UnitCode" USING "unit"::"UnitCode";
ALTER TABLE "product_recipe_items"
  ALTER COLUMN "recipeUnit" TYPE "UnitCode" USING "recipeUnit"::"UnitCode";
ALTER TABLE "productions_material_usage"
  ALTER COLUMN "inputUnit" TYPE "UnitCode" USING "inputUnit"::"UnitCode";

-- AlterEnum: pencatatan konversi satuan utama oleh Admin.
ALTER TYPE "StockMovementType" ADD VALUE 'UNIT_CONVERSION';

-- Resep standar produk (kebutuhan bahan per 1 satuan produk) dan rincian
-- input aktual pemakaian produksi. Aman untuk data lama: kolom baru nullable
-- dan tabel resep baru kosong.

ALTER TABLE "productions_material_usage"
  ADD COLUMN "inputQuantity" DECIMAL(14,3),
  ADD COLUMN "inputUnit" TEXT;

CREATE TABLE "product_recipe_items" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "quantityPerUnit" DECIMAL(14,3) NOT NULL,
  "recipeUnit" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_recipe_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_recipe_items_productId_materialId_key" ON "product_recipe_items"("productId", "materialId");
CREATE INDEX "product_recipe_items_materialId_idx" ON "product_recipe_items"("materialId");

ALTER TABLE "product_recipe_items"
  ADD CONSTRAINT "product_recipe_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_recipe_items"
  ADD CONSTRAINT "product_recipe_items_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

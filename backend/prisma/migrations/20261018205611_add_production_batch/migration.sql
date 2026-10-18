/*
  Warnings:

  - A unique constraint covering the columns `[productionUsageId]` on the table `material_stock_movements` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "BatchMovementType" AS ENUM ('PRODUCTION_YIELD', 'YIELD_CORRECTION');

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION_USAGE';

-- AlterTable
ALTER TABLE "material_stock_movements" ADD COLUMN     "productionUsageId" TEXT;

-- CreateTable
CREATE TABLE "productions" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productionDate" TIMESTAMP(3) NOT NULL,
    "yieldQuantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batchId" TEXT,

    CONSTRAINT "productions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productions_material_usage" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "productions_material_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productionDate" TIMESTAMP(3) NOT NULL,
    "stockQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_aliases" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_corrections" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "field" TEXT NOT NULL,
    "previousValue" TEXT NOT NULL,
    "newValue" TEXT NOT NULL,

    CONSTRAINT "production_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_stock_movements" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "type" "BatchMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "reason" TEXT,
    "productionId" TEXT,

    CONSTRAINT "batch_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "productions_batchId_key" ON "productions"("batchId");

-- CreateIndex
CREATE INDEX "productions_productId_idx" ON "productions"("productId");

-- CreateIndex
CREATE INDEX "productions_material_usage_materialId_idx" ON "productions_material_usage"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "productions_material_usage_productionId_materialId_key" ON "productions_material_usage"("productionId", "materialId");

-- CreateIndex
CREATE UNIQUE INDEX "batches_code_key" ON "batches"("code");

-- CreateIndex
CREATE INDEX "batches_productId_idx" ON "batches"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "batch_aliases_code_key" ON "batch_aliases"("code");

-- CreateIndex
CREATE INDEX "batch_aliases_batchId_idx" ON "batch_aliases"("batchId");

-- CreateIndex
CREATE INDEX "production_corrections_productionId_idx" ON "production_corrections"("productionId");

-- CreateIndex
CREATE INDEX "batch_stock_movements_batchId_idx" ON "batch_stock_movements"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "material_stock_movements_productionUsageId_key" ON "material_stock_movements"("productionUsageId");

-- AddForeignKey
ALTER TABLE "material_stock_movements" ADD CONSTRAINT "material_stock_movements_productionUsageId_fkey" FOREIGN KEY ("productionUsageId") REFERENCES "productions_material_usage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productions" ADD CONSTRAINT "productions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productions" ADD CONSTRAINT "productions_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productions" ADD CONSTRAINT "productions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productions_material_usage" ADD CONSTRAINT "productions_material_usage_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "productions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productions_material_usage" ADD CONSTRAINT "productions_material_usage_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_aliases" ADD CONSTRAINT "batch_aliases_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_corrections" ADD CONSTRAINT "production_corrections_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "productions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_corrections" ADD CONSTRAINT "production_corrections_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_stock_movements" ADD CONSTRAINT "batch_stock_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_stock_movements" ADD CONSTRAINT "batch_stock_movements_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_stock_movements" ADD CONSTRAINT "batch_stock_movements_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "productions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

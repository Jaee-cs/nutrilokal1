/*
  Warnings:

  - A unique constraint covering the columns `[openingBalanceId]` on the table `batch_stock_movements` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[adjustmentId]` on the table `batch_stock_movements` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[adjustmentId]` on the table `material_stock_movements` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "StockAdjustmentTargetType" AS ENUM ('MATERIAL', 'BATCH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BatchMovementType" ADD VALUE 'OPENING_BALANCE';
ALTER TYPE "BatchMovementType" ADD VALUE 'ADJUSTMENT';

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'ADJUSTMENT';

-- AlterTable
ALTER TABLE "batch_stock_movements" ADD COLUMN     "adjustmentId" TEXT,
ADD COLUMN     "openingBalanceId" TEXT;

-- AlterTable
ALTER TABLE "batches" ALTER COLUMN "productionDate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "material_stock_movements" ADD COLUMN     "adjustmentId" TEXT;

-- CreateTable
CREATE TABLE "batch_opening_balances" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" TEXT NOT NULL,
    "targetType" "StockAdjustmentTargetType" NOT NULL,
    "materialId" TEXT,
    "batchId" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "adjustedById" TEXT NOT NULL,
    "adjustedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "batch_opening_balances_batchId_key" ON "batch_opening_balances"("batchId");

-- CreateIndex
CREATE INDEX "stock_adjustments_materialId_idx" ON "stock_adjustments"("materialId");

-- CreateIndex
CREATE INDEX "stock_adjustments_batchId_idx" ON "stock_adjustments"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "batch_stock_movements_openingBalanceId_key" ON "batch_stock_movements"("openingBalanceId");

-- CreateIndex
CREATE UNIQUE INDEX "batch_stock_movements_adjustmentId_key" ON "batch_stock_movements"("adjustmentId");

-- CreateIndex
CREATE UNIQUE INDEX "material_stock_movements_adjustmentId_key" ON "material_stock_movements"("adjustmentId");

-- AddForeignKey
ALTER TABLE "material_stock_movements" ADD CONSTRAINT "material_stock_movements_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "stock_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_stock_movements" ADD CONSTRAINT "batch_stock_movements_openingBalanceId_fkey" FOREIGN KEY ("openingBalanceId") REFERENCES "batch_opening_balances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_stock_movements" ADD CONSTRAINT "batch_stock_movements_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "stock_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_opening_balances" ADD CONSTRAINT "batch_opening_balances_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_opening_balances" ADD CONSTRAINT "batch_opening_balances_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_adjustedById_fkey" FOREIGN KEY ("adjustedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

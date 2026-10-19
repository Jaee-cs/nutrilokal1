-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BatchMovementType" ADD VALUE 'SALE';
ALTER TYPE "BatchMovementType" ADD VALUE 'SALE_CANCELLATION';

-- AlterTable
ALTER TABLE "batch_stock_movements" ADD COLUMN     "saleAllocationId" TEXT;

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "expiryValidatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sale_transactions" (
    "id" TEXT NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,

    CONSTRAINT "sale_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_allocations" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "sale_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_transactions_recordedById_idx" ON "sale_transactions"("recordedById");

-- CreateIndex
CREATE INDEX "sale_transactions_cancelledById_idx" ON "sale_transactions"("cancelledById");

-- CreateIndex
CREATE INDEX "sale_items_productId_idx" ON "sale_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_transactionId_productId_key" ON "sale_items"("transactionId", "productId");

-- CreateIndex
CREATE INDEX "sale_allocations_batchId_idx" ON "sale_allocations"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_allocations_itemId_batchId_key" ON "sale_allocations"("itemId", "batchId");

-- CreateIndex
CREATE INDEX "batch_stock_movements_saleAllocationId_idx" ON "batch_stock_movements"("saleAllocationId");

-- AddForeignKey
ALTER TABLE "batch_stock_movements" ADD CONSTRAINT "batch_stock_movements_saleAllocationId_fkey" FOREIGN KEY ("saleAllocationId") REFERENCES "sale_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_transactions" ADD CONSTRAINT "sale_transactions_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_transactions" ADD CONSTRAINT "sale_transactions_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "sale_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_allocations" ADD CONSTRAINT "sale_allocations_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_allocations" ADD CONSTRAINT "sale_allocations_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'OPENING_BALANCE');

-- CreateTable
CREATE TABLE "material_stocks" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_stock_movements" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT NOT NULL,
    "reason" TEXT,
    "receiptId" TEXT,
    "openingBalanceId" TEXT,

    CONSTRAINT "material_stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_receipts" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_opening_balances" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_opening_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key","endpoint","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_stocks_materialId_key" ON "material_stocks"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "material_stock_movements_receiptId_key" ON "material_stock_movements"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "material_stock_movements_openingBalanceId_key" ON "material_stock_movements"("openingBalanceId");

-- CreateIndex
CREATE INDEX "material_stock_movements_materialId_idx" ON "material_stock_movements"("materialId");

-- CreateIndex
CREATE INDEX "material_receipts_materialId_idx" ON "material_receipts"("materialId");

-- CreateIndex
CREATE INDEX "material_opening_balances_materialId_idx" ON "material_opening_balances"("materialId");

-- AddForeignKey
ALTER TABLE "material_stocks" ADD CONSTRAINT "material_stocks_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_movements" ADD CONSTRAINT "material_stock_movements_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_movements" ADD CONSTRAINT "material_stock_movements_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_movements" ADD CONSTRAINT "material_stock_movements_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "material_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_stock_movements" ADD CONSTRAINT "material_stock_movements_openingBalanceId_fkey" FOREIGN KEY ("openingBalanceId") REFERENCES "material_opening_balances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_receipts" ADD CONSTRAINT "material_receipts_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_receipts" ADD CONSTRAINT "material_receipts_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_opening_balances" ADD CONSTRAINT "material_opening_balances_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_opening_balances" ADD CONSTRAINT "material_opening_balances_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

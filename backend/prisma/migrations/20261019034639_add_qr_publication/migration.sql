-- AlterTable
ALTER TABLE "products" ADD COLUMN     "composition" TEXT,
ADD COLUMN     "storageInstructions" TEXT;

-- CreateTable
CREATE TABLE "qr_publications" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "validatedAt" TIMESTAMP(3),
    "validatedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qr_publications_batchId_key" ON "qr_publications"("batchId");

-- CreateIndex
CREATE INDEX "qr_publications_validatedById_idx" ON "qr_publications"("validatedById");

-- CreateIndex
CREATE INDEX "qr_publications_publishedById_idx" ON "qr_publications"("publishedById");

-- CreateIndex
CREATE INDEX "qr_publications_withdrawnById_idx" ON "qr_publications"("withdrawnById");

-- AddForeignKey
ALTER TABLE "qr_publications" ADD CONSTRAINT "qr_publications_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_publications" ADD CONSTRAINT "qr_publications_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_publications" ADD CONSTRAINT "qr_publications_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_publications" ADD CONSTRAINT "qr_publications_withdrawnById_fkey" FOREIGN KEY ("withdrawnById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

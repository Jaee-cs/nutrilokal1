-- Jejak audit perubahan tanggal kedaluwarsa batch.
--
-- Tabel baru tidak mengubah atau menghapus tanggal kedaluwarsa batch lama.
-- Batch stok awal dan batch hasil produksi sama-sama dapat memiliki riwayat.
CREATE TABLE "batch_expiry_changes" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousExpiryDate" TIMESTAMP(3),
    "newExpiryDate" TIMESTAMP(3),

    CONSTRAINT "batch_expiry_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "batch_expiry_changes_batchId_idx" ON "batch_expiry_changes"("batchId");

ALTER TABLE "batch_expiry_changes" ADD CONSTRAINT "batch_expiry_changes_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "batch_expiry_changes" ADD CONSTRAINT "batch_expiry_changes_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

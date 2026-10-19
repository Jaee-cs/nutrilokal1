/**
 * Stok produk jadi per batch (README 5.3 dan 5.4).
 *
 * - Melihat daftar/detail batch: Admin dan Operator.
 * - Mencatat stok awal produk jadi per batch: hanya Admin (README 5.3).
 *   Hanya informasi yang benar-benar diketahui boleh dicatat; tanggal
 *   produksi boleh kosong dan saat itu kode memakai format
 *   NL-OPEN-YYYYMMDD-NNN (tanggal pada kode = tanggal pencatatan).
 * - Total stok per produk = jumlah stok seluruh batch; dihitung dari data
 *   batch (bukan angka tersimpan terpisah) agar tidak ada dua sumber stok.
 * - Mencatat/membersihkan tanggal kedaluwarsa batch: hanya Admin
 *   (README 5.5 dan 5.6); tanggal yang dicatat Admin dianggap tervalidasi.
 * - Tidak ada endpoint edit/hapus batch atau riwayat pergerakan stok.
 * - Header `Idempotency-Key` (opsional) mencegah permintaan berulang.
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import {
  allocateBatchCode,
  allocateOpeningBatchCode,
  isBatchCodeConflict,
  MAX_BATCH_CODE_ATTEMPTS,
} from '../lib/batch';
import {
  BATCH_DETAIL_INCLUDE,
  BATCH_INCLUDE,
  toPublicBatch,
  toPublicBatchDetail,
} from '../lib/stock-view';
import { isBusinessDateInFuture, parseBusinessDate, todayBusinessDateCode } from '../lib/date';
import { pathId } from '../lib/http';
import { readIdempotencyKey, runIdempotent } from '../lib/idempotency';
import { prisma } from '../lib/prisma';
import { applyBatchStockChange, getBatchStock } from '../lib/stock';
import { validateNote, validateQuantity, validateDateOnly } from '../lib/validate';
import { authenticate, requireAdmin } from '../middleware/auth';

export const batchesRouter = Router();

const OPENING_STOCK_ENDPOINT = 'POST /api/batches/opening-stock';

function normalizeNote(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// ---------------------------------------------------------------------------
// Melihat stok per batch (Admin & Operator)
// ---------------------------------------------------------------------------

batchesRouter.get('/', authenticate, async (req, res) => {
  const where: Prisma.BatchWhereInput = {};

  const productIdQuery = req.query.productId;
  if (typeof productIdQuery === 'string' && productIdQuery.trim() !== '') {
    const product = await prisma.product.findUnique({ where: { id: productIdQuery.trim() } });
    if (!product) {
      res.status(404).json({ message: 'Produk tidak ditemukan.' });
      return;
    }
    where.productId = product.id;
  }

  const batches = await prisma.batch.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { code: 'desc' }],
    include: BATCH_INCLUDE,
  });

  res.json({ data: batches.map(toPublicBatch) });
});

batchesRouter.get('/:id', authenticate, async (req, res) => {
  const batch = await prisma.batch.findUnique({
    where: { id: pathId(req) },
    include: BATCH_DETAIL_INCLUDE,
  });

  if (!batch) {
    res.status(404).json({ message: 'Batch tidak ditemukan.' });
    return;
  }

  res.json({ batch: toPublicBatchDetail(batch) });
});

// ---------------------------------------------------------------------------
// Mencatat tanggal kedaluwarsa per batch (khusus Admin, README 5.5 & 5.6)
// ---------------------------------------------------------------------------
//
// Tanggal kedaluwarsa BOLEH kosong bila belum tersedia atau belum
// divalidasi (README 5.6). Pencatatan dilakukan Admin — karena Admin yang
// memvalidasi informasi (README 4) — sehingga tanggal yang tersimpan ikut
// ditandai tervalidasi (expiryValidatedAt). Pengosongan mengembalikan
// kedua kolom ke null. Endpoint ini bersifat idempoten secara alami
// (hanya menetapkan metadata, tanpa perubahan stok).
batchesRouter.patch('/:id/expiry', authenticate, requireAdmin, async (req, res) => {
  const batchId = pathId(req);
  const body = req.body ?? {};

  if (!('expiryDate' in body)) {
    res.status(400).json({
      message: 'Sertakan expiryDate (tanggal YYYY-MM-DD) atau null untuk mengosongkan.',
    });
    return;
  }

  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) {
    res.status(404).json({ message: 'Batch tidak ditemukan.' });
    return;
  }

  const value = body.expiryDate;
  if (value !== null && typeof value !== 'string') {
    res.status(400).json({ message: 'expiryDate harus berupa tanggal (YYYY-MM-DD) atau null.' });
    return;
  }

  if (value === null) {
    const cleared = await prisma.batch.update({
      where: { id: batchId },
      data: { expiryDate: null, expiryValidatedAt: null },
      include: BATCH_INCLUDE,
    });
    res.json({ batch: toPublicBatch(cleared) });
    return;
  }

  const dateError = validateDateOnly(value);
  if (dateError) {
    res.status(400).json({ message: dateError });
    return;
  }

  const updated = await prisma.batch.update({
    where: { id: batchId },
    // Tanggal yang dicatat Admin sekaligus menjadi tervalidasi.
    data: { expiryDate: parseBusinessDate(value), expiryValidatedAt: new Date() },
    include: BATCH_INCLUDE,
  });
  res.json({ batch: toPublicBatch(updated) });
});

// ---------------------------------------------------------------------------
// Stok awal produk jadi per batch (khusus Admin, README 5.3)
// ---------------------------------------------------------------------------

batchesRouter.post('/opening-stock', authenticate, requireAdmin, async (req, res) => {
  const { productId, quantity, productionDate, note } = req.body ?? {};

  if (typeof productId !== 'string' || productId.trim() === '') {
    res.status(400).json({ message: 'productId wajib diisi.' });
    return;
  }

  const quantityError = validateQuantity(quantity, 'Jumlah stok awal');
  if (quantityError) {
    res.status(400).json({ message: quantityError });
    return;
  }

  const noteError = validateNote(note);
  if (noteError) {
    res.status(400).json({ message: noteError });
    return;
  }

  // Tanggal produksi BOLEH tidak diketahui — saat itu tanggal produksi
  // dikosongkan dan kode memakai NL-OPEN-<tanggal pencatatan>-NNN.
  let knownProductionDate: Date | null = null;
  if (productionDate !== undefined && productionDate !== null) {
    const dateError = validateDateOnly(productionDate);
    if (dateError) {
      res.status(400).json({ message: dateError });
      return;
    }
    knownProductionDate = parseBusinessDate(productionDate);
    if (isBusinessDateInFuture(knownProductionDate)) {
      res.status(400).json({ message: 'Tanggal produksi tidak boleh berada di masa depan.' });
      return;
    }
  }

  const product = await prisma.product.findUnique({ where: { id: productId.trim() } });
  if (!product) {
    res.status(404).json({ message: 'Produk tidak ditemukan.' });
    return;
  }
  if (!product.isActive) {
    res.status(409).json({ message: 'Produk tidak aktif dan tidak dapat menerima stok awal baru.' });
    return;
  }

  let key: string | null;
  try {
    key = readIdempotencyKey(req.headers['idempotency-key']);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : 'Idempotency-Key tidak valid.' });
    return;
  }

  const quantityText = quantity.toFixed(3);
  const noteText = normalizeNote(note);
  const recordedById = req.user!.id;
  // Tanggal pencatatan stok awal (hari ini, kalender WIB).
  const recordingDate = parseBusinessDate(todayBusinessDateCode());
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_BATCH_CODE_ATTEMPTS; attempt++) {
    try {
      const result = await runIdempotent<{
        batch: ReturnType<typeof toPublicBatchDetail>;
        stock: number;
      }>({ key, endpoint: OPENING_STOCK_ENDPOINT, userId: recordedById }, async (tx) => {
        const code = knownProductionDate
          ? await allocateBatchCode(tx, knownProductionDate)
          : await allocateOpeningBatchCode(tx, recordingDate);
        // Tanggal pada kode batch (README 5.3).
        const codeDate = knownProductionDate ?? recordingDate;

        const batch = await tx.batch.create({
          data: {
            code,
            productId: product.id,
            productionDate: knownProductionDate,
            stockQuantity: 0,
          },
        });

        // Catatan sumber stok awal; riwayat tidak pernah diedit/dihapus.
        const openingBalance = await tx.batchOpeningBalance.create({
          data: { batchId: batch.id, quantity: quantityText, note: noteText, recordedById },
        });

        await tx.batchStockMovement.create({
          data: {
            batchId: batch.id,
            type: 'OPENING_BALANCE',
            quantity: quantityText,
            occurredAt: codeDate,
            recordedById,
            reason: noteText,
            openingBalanceId: openingBalance.id,
          },
        });

        await applyBatchStockChange(tx, batch.id, new Prisma.Decimal(quantityText));

        const full = await tx.batch.findUniqueOrThrow({
          where: { id: batch.id },
          include: BATCH_DETAIL_INCLUDE,
        });
        return {
          status: 201,
          body: { batch: toPublicBatchDetail(full), stock: await getBatchStock(tx, batch.id) },
        };
      });

      res.status(result.status);
      res.setHeader('Idempotent-Replay', result.replayed ? 'true' : 'false');
      res.json(result.body);
      return;
    } catch (error) {
      if (!isBatchCodeConflict(error)) {
        throw error;
      }
      // Kode batch diperebutkan permintaan lain — ulangi transaksi penuh
      // agar nomor urut dihitung ulang dari data terbaru.
      lastError = error;
    }
  }

  throw lastError;
});

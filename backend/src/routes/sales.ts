/**
 * Penjualan dan pembatalan transaksi (README 5.5).
 *
 * - Mencatat penjualan: Admin dan Operator (README 4); memilih batch yang
 *   benar-benar diambil untuk setiap item.
 * - Satu transaksi boleh berisi beberapa jenis produk; satu item boleh
 *   dialokasikan ke beberapa batch.
 * - Harga satuan diambil dari master produk saat transaksi dan DISIMPAN
 *   pada item, sehingga perubahan harga master tidak mengubah transaksi lama.
 * - Total transaksi DIHITUNG backend dari harga master × jumlah item —
 *   bukan dari input klien.
 * - Validasi stok tiap batch berjalan DALAM transaksi database; bila satu
 *   item atau alokasi tidak mencukupi (atau batch kedaluwarsa tervalidasi),
 *   SELURUH transaksi ditolak: tidak ada transaksi parsial dan tidak ada
 *   stok yang berubah.
 * - Pembatalan hanya Admin dengan alasan; stok dikembalikan ke batch asal
 *   berdasarkan alokasi. Riwayat alokasi tetap tersimpan, pembatalan
 *   berulang tidak pernah mengembalikan stok dua kali, dan transaksi batal
 *   tidak masuk omzet (cancelledAt terisi).
 * - Tidak ada endpoint edit/hapus transaksi (404).
 * - Header `Idempotency-Key` (opsional) mencegah permintaan berulang
 *   menggandakan penjualan.
 */
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { businessDateCode, todayBusinessDateCode } from '../lib/date';
import { pathId } from '../lib/http';
import { readIdempotencyKey, runIdempotent } from '../lib/idempotency';
import { prisma } from '../lib/prisma';
import {
  AlreadyCancelledError,
  computeSaleTotal,
  SALE_INCLUDE,
  SaleNotFoundError,
  SaleRejectedError,
  toPublicSale,
} from '../lib/sale';
import { applyBatchStockChange, InsufficientStockError } from '../lib/stock';
import { validateQuantity, validateReason, validateSaleItems } from '../lib/validate';
import { authenticate, requireAdmin } from '../middleware/auth';

export const salesRouter = Router();

const CREATE_ENDPOINT = 'POST /api/sales';

interface AllocationInput {
  batchId: string;
  quantity: number;
  quantityText: string;
}

interface ItemInput {
  productId: string;
  allocations: AllocationInput[];
}

const cancelEndpoint = (saleId: string): string => `POST /api/sales/${saleId}/cancel`;

// ---------------------------------------------------------------------------
// Mencatat penjualan (Admin & Operator)
// ---------------------------------------------------------------------------

salesRouter.post('/', authenticate, async (req, res) => {
  const items = req.body?.items;

  const itemsError = validateSaleItems(items);
  if (itemsError) {
    res.status(400).json({ message: itemsError });
    return;
  }

  // Normalkan input; satu produk maksimal satu item dan satu batch maksimal
  // satu alokasi per item agar aturan alokasi tetap jelas dan atomik.
  const normalized: ItemInput[] = [];
  const seenProductIds = new Set<string>();
  for (const item of items as Record<string, unknown>[]) {
    const productId = (item.productId as string).trim();
    if (seenProductIds.has(productId)) {
      res.status(400).json({
        message: 'Produk yang sama tidak boleh muncul dua kali dalam satu transaksi.',
      });
      return;
    }
    seenProductIds.add(productId);

    const allocations: AllocationInput[] = [];
    const seenBatchIds = new Set<string>();
    for (const allocation of item.allocations as Record<string, unknown>[]) {
      const quantityError = validateQuantity(allocation.quantity, 'Jumlah alokasi');
      if (quantityError) {
        res.status(400).json({ message: quantityError });
        return;
      }
      const batchId = (allocation.batchId as string).trim();
      if (seenBatchIds.has(batchId)) {
        res.status(400).json({
          message: 'Batch yang sama tidak boleh dialokasikan dua kali pada satu item.',
        });
        return;
      }
      seenBatchIds.add(batchId);
      // validateQuantity memastikan nilai berupa angka valid.
      const quantity = allocation.quantity as number;
      allocations.push({
        batchId,
        quantity,
        quantityText: quantity.toFixed(3),
      });
    }
    normalized.push({ productId, allocations });
  }

  // Produk: wajib ada; penjualan baru hanya untuk produk aktif (README 5.1).
  const products = await prisma.product.findMany({
    where: { id: { in: normalized.map((item) => item.productId) } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));
  for (const item of normalized) {
    const product = productById.get(item.productId);
    if (!product) {
      res.status(404).json({ message: `Produk "${item.productId}" tidak ditemukan.` });
      return;
    }
    if (!product.isActive) {
      res.status(409).json({
        message: `Produk "${product.name}" tidak aktif dan tidak tersedia untuk penjualan baru.`,
      });
      return;
    }
  }

  // Batch: wajib ada dan harus milik produk pada item yang sama.
  // (Cek kedaluwarsa dilakukan di dalam transaksi bersamaan dengan stok.)
  const batchIds = normalized.flatMap((item) => item.allocations.map((a) => a.batchId));
  const batches = await prisma.batch.findMany({ where: { id: { in: batchIds } } });
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  for (const item of normalized) {
    for (const allocation of item.allocations) {
      const batch = batchById.get(allocation.batchId);
      if (!batch) {
        res.status(404).json({ message: `Batch "${allocation.batchId}" tidak ditemukan.` });
        return;
      }
      if (batch.productId !== item.productId) {
        res.status(400).json({
          message: `Batch "${batch.code}" bukan milik produk yang dipilih.`,
        });
        return;
      }
    }
  }

  let key: string | null;
  try {
    key = readIdempotencyKey(req.headers['idempotency-key']);
  } catch (error) {
    res
      .status(400)
      .json({ message: error instanceof Error ? error.message : 'Idempotency-Key tidak valid.' });
    return;
  }

  const recordedById = req.user!.id;
  const occurredAt = new Date();

  try {
    const result = await runIdempotent<{ transaction: ReturnType<typeof toPublicSale> }>(
      { key, endpoint: CREATE_ENDPOINT, userId: recordedById },
      async (tx) => {
        // Urutkan alokasi berdasarkan batchId agar urutan penguncian baris
        // stok selalu sama pada setiap transaksi (mencegah deadlock).
        const flat = normalized
          .flatMap((item) =>
            item.allocations.map((allocation) => ({ ...allocation, productId: item.productId }))
          )
          .sort((a, b) => a.batchId.localeCompare(b.batchId));

        // --- Validasi stok & kedaluwarsa tiap batch DALAM transaksi.
        for (const allocation of flat) {
          const batch = await tx.batch.findUniqueOrThrow({ where: { id: allocation.batchId } });

          // README 5.5: batch ditolak bila tanggal kedaluwarsa tersedia,
          // sudah divalidasi, dan tanggalnya sudah lewat (kalender WIB).
          if (
            batch.expiryDate &&
            batch.expiryValidatedAt &&
            businessDateCode(batch.expiryDate) < todayBusinessDateCode()
          ) {
            throw new SaleRejectedError(
              `batch ${batch.code} sudah kedaluwarsa (${businessDateCode(batch.expiryDate)}).`
            );
          }

          const required = Number(allocation.quantityText);
          const available = Number(batch.stockQuantity);
          if (available < required) {
            throw new InsufficientStockError(
              `Stok batch ${batch.code} tidak mencukupi (tersedia ${available}, dibutuhkan ${required}).`
            );
          }
        }

        // --- Total DIHITUNG backend dari harga satuan master produk.
        const lines = normalized.map((item) => {
          const product = productById.get(item.productId)!;
          const quantity = item.allocations.reduce(
            (sum, allocation) => sum.plus(allocation.quantityText),
            new Prisma.Decimal(0)
          );
          return { item, product, quantity };
        });
        const total = computeSaleTotal(
          lines.map((line) => ({ unitPrice: line.product.sellingPrice, quantity: line.quantity }))
        );

        const transaction = await tx.saleTransaction.create({
          data: { total: total.toFixed(2), recordedById },
        });

        // --- Item penjualan + alokasi batch (riwayat alokasi tetap ada
        //     walaupun transaksi dibatalkan).
        const pendingMovements: {
          batchId: string;
          quantityText: string;
          allocationId: string;
        }[] = [];

        for (const line of lines) {
          const itemRow = await tx.saleItem.create({
            data: {
              transactionId: transaction.id,
              productId: line.item.productId,
              quantity: line.quantity.toFixed(3),
              unitPrice: line.product.sellingPrice.toFixed(2),
            },
          });
          for (const allocation of line.item.allocations) {
            const allocationRow = await tx.saleAllocation.create({
              data: {
                itemId: itemRow.id,
                batchId: allocation.batchId,
                quantity: allocation.quantityText,
              },
            });
            pendingMovements.push({
              batchId: allocation.batchId,
              quantityText: allocation.quantityText,
              allocationId: allocationRow.id,
            });
          }
        }

        // --- Pergerakan stok + pengurangan stok batch, urut batchId.
        //     Penjaga `stockQuantity >= jumlah` pada applyBatchStockChange
        //     bersifat atomik: permintaan bersamaan tidak bisa overselling.
        pendingMovements.sort((a, b) => a.batchId.localeCompare(b.batchId));
        for (const movement of pendingMovements) {
          const delta = new Prisma.Decimal(movement.quantityText).negated();
          await tx.batchStockMovement.create({
            data: {
              batchId: movement.batchId,
              type: 'SALE',
              quantity: delta.toFixed(3),
              occurredAt,
              recordedById,
              reason: 'Penjualan',
              saleAllocationId: movement.allocationId,
            },
          });
          await applyBatchStockChange(tx, movement.batchId, delta);
        }

        const full = await tx.saleTransaction.findUniqueOrThrow({
          where: { id: transaction.id },
          include: SALE_INCLUDE,
        });
        return { status: 201, body: { transaction: toPublicSale(full) } };
      }
    );

    res.status(result.status);
    res.setHeader('Idempotent-Replay', result.replayed ? 'true' : 'false');
    res.json(result.body);
    return;
  } catch (error) {
    if (error instanceof InsufficientStockError || error instanceof SaleRejectedError) {
      res.status(409).json({ message: `Penjualan ditolak: ${error.message}` });
      return;
    }
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Melihat riwayat penjualan (Admin & Operator)
// ---------------------------------------------------------------------------

salesRouter.get('/', authenticate, async (_req, res) => {
  const transactions = await prisma.saleTransaction.findMany({
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    include: SALE_INCLUDE,
  });
  res.json({ data: transactions.map(toPublicSale) });
});

salesRouter.get('/:id', authenticate, async (req, res) => {
  const transaction = await prisma.saleTransaction.findUnique({
    where: { id: pathId(req) },
    include: SALE_INCLUDE,
  });

  if (!transaction) {
    res.status(404).json({ message: 'Transaksi penjualan tidak ditemukan.' });
    return;
  }

  res.json({ transaction: toPublicSale(transaction) });
});

// ---------------------------------------------------------------------------
// Membatalkan transaksi (hanya Admin, README 5.5)
// ---------------------------------------------------------------------------

salesRouter.post('/:id/cancel', authenticate, requireAdmin, async (req, res) => {
  const saleId = pathId(req);

  const reasonError = validateReason(req.body?.reason);
  if (reasonError) {
    res.status(400).json({ message: reasonError });
    return;
  }

  let key: string | null;
  try {
    key = readIdempotencyKey(req.headers['idempotency-key']);
  } catch (error) {
    res
      .status(400)
      .json({ message: error instanceof Error ? error.message : 'Idempotency-Key tidak valid.' });
    return;
  }

  const cancelledById = req.user!.id;
  const cancelReason = req.body.reason.trim();
  const occurredAt = new Date();

  try {
    const result = await runIdempotent<{ transaction: ReturnType<typeof toPublicSale> }>(
      { key, endpoint: cancelEndpoint(saleId), userId: cancelledById },
      async (tx) => {
        const current = await tx.saleTransaction.findUnique({ where: { id: saleId } });
        if (!current) {
          throw new SaleNotFoundError();
        }
        if (current.cancelledAt) {
          throw new AlreadyCancelledError();
        }

        // Pengembalian stok hanya boleh SEKALI: baris hanya diperbarui bila
        // masih belum dibatalkan — pembatalan bersamaan tidak pernah
        // mengembalikan stok dua kali.
        const updated = await tx.saleTransaction.updateMany({
          where: { id: saleId, cancelledAt: null },
          data: { cancelReason, cancelledAt: occurredAt, cancelledById },
        });
        if (updated.count === 0) {
          throw new AlreadyCancelledError();
        }

        // Kembalikan stok ke batch asal berdasarkan alokasi transaksi
        // (README 5.5). Riwayat alokasi dan pergerakan tetap tersimpan.
        const allocations = await tx.saleAllocation.findMany({
          where: { item: { transactionId: saleId } },
          orderBy: { batchId: 'asc' },
        });
        for (const allocation of allocations) {
          await tx.batchStockMovement.create({
            data: {
              batchId: allocation.batchId,
              type: 'SALE_CANCELLATION',
              quantity: allocation.quantity.toFixed(3),
              occurredAt,
              recordedById: cancelledById,
              reason: cancelReason,
              saleAllocationId: allocation.id,
            },
          });
          await applyBatchStockChange(tx, allocation.batchId, allocation.quantity);
        }

        const full = await tx.saleTransaction.findUniqueOrThrow({
          where: { id: saleId },
          include: SALE_INCLUDE,
        });
        return { status: 200, body: { transaction: toPublicSale(full) } };
      }
    );

    res.status(result.status);
    res.setHeader('Idempotent-Replay', result.replayed ? 'true' : 'false');
    res.json(result.body);
    return;
  } catch (error) {
    if (error instanceof SaleNotFoundError) {
      res.status(404).json({ message: 'Transaksi penjualan tidak ditemukan.' });
      return;
    }
    if (error instanceof AlreadyCancelledError) {
      res.status(409).json({ message: 'Transaksi sudah dibatalkan.' });
      return;
    }
    throw error;
  }
});

// Transaksi tersimpan tidak memiliki endpoint edit/hapus (README 5.5):
// riwayat penjualan dan alokasi batch hanya dapat dilihat. Transaksi yang
// benar setelah pembatalan dicatat sebagai transaksi baru melalui POST /.

/**
 * Representasi transaksi penjualan, item, dan alokasi batch untuk respons
 * API (README 5.5), termasuk perhitungan total yang dilakukan BACKEND.
 *
 * - Harga satuan disimpan per item dari master produk pada saat transaksi;
 *   perubahan harga master tidak mengubah transaksi lama.
 * - Total = jumlah (harga satuan × jumlah) per baris, dibulatkan ke 2
 *   desimal (HALF-UP) agar selalu cocok dengan kolom total DECIMAL(14,2).
 * - Status transaksi TIDAK disimpan ganda: dibatalkan ditandai cancelledAt;
 *   respons API menurunkan status 'COMPLETED' | 'CANCELLED' dari situ
 *   (satu sumber kebenaran, sesuai semangat README 6).
 */
import { Prisma } from '@prisma/client';

const RECORDED_BY_SELECT = { select: { id: true, username: true, name: true } } as const;

export const SALE_INCLUDE = {
  recordedBy: RECORDED_BY_SELECT,
  cancelledBy: RECORDED_BY_SELECT,
  items: {
    orderBy: { product: { name: 'asc' as const } },
    include: {
      product: { select: { id: true, name: true, unit: true } },
      allocations: {
        orderBy: { batch: { code: 'asc' as const } },
        include: { batch: { select: { id: true, code: true } } },
      },
    },
  },
} as const;

export type SaleWithRelations = Prisma.SaleTransactionGetPayload<{
  include: typeof SALE_INCLUDE;
}>;

// ---------------------------------------------------------------------------
// Perhitungan total di backend
// ---------------------------------------------------------------------------

/** Membulatkan uang ke 2 desimal (HALF-UP) agar cocok dengan DECIMAL(14,2). */
export function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Total baris = harga satuan × jumlah, dibulatkan 2 desimal. */
export function lineTotal(unitPrice: Prisma.Decimal, quantity: Prisma.Decimal): Prisma.Decimal {
  return roundMoney(unitPrice.times(quantity));
}

/** Total transaksi = jumlah seluruh total baris item (dihitung backend). */
export function computeSaleTotal(
  lines: { unitPrice: Prisma.Decimal; quantity: Prisma.Decimal }[]
): Prisma.Decimal {
  return lines.reduce(
    (sum, line) => sum.plus(lineTotal(line.unitPrice, line.quantity)),
    new Prisma.Decimal(0)
  );
}

// ---------------------------------------------------------------------------
// Error khusus penjualan — dipetakan route ke respons HTTP
// ---------------------------------------------------------------------------

/** Id transaksi tidak ditemukan — dipetakan route ke respons 404. */
export class SaleNotFoundError extends Error {}

/** Transaksi sudah dibatalkan — dipetakan route ke respons 409. */
export class AlreadyCancelledError extends Error {}

/** Penjualan ditolak aturan bisnis (kedaluwarsa) — dipetakan route ke 409. */
export class SaleRejectedError extends Error {}

// ---------------------------------------------------------------------------
// Bentuk respons API
// ---------------------------------------------------------------------------

export interface PublicSaleAllocation {
  batchId: string;
  batchCode: string;
  quantity: number;
}

export interface PublicSaleItem {
  productId: string;
  product: { id: string; name: string; unit: string };
  /** Jumlah terjual = jumlah seluruh alokasi item ini. */
  quantity: number;
  /** Harga satuan dari master pada saat transaksi (README 5.5). */
  unitPrice: number;
  /** Harga satuan × jumlah (dihitung backend). */
  lineTotal: number;
  allocations: PublicSaleAllocation[];
}

export interface PublicSale {
  id: string;
  /** COMPLETED = tersimpan (memengaruhi stok & omzet); CANCELLED = dibatalkan Admin. */
  status: 'COMPLETED' | 'CANCELLED';
  /** Total transaksi — dihitung backend, bukan dari input klien. */
  total: number;
  items: PublicSaleItem[];
  recordedBy: { id: string; username: string; name: string | null };
  recordedAt: Date;
  cancelReason: string | null;
  cancelledAt: Date | null;
  cancelledBy: { id: string; username: string; name: string | null } | null;
}

export function toPublicSale(sale: SaleWithRelations): PublicSale {
  return {
    id: sale.id,
    status: sale.cancelledAt ? 'CANCELLED' : 'COMPLETED',
    total: Number(sale.total),
    items: sale.items.map((item) => ({
      productId: item.productId,
      product: item.product,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      lineTotal: Number(lineTotal(item.unitPrice, item.quantity)),
      allocations: item.allocations.map((allocation) => ({
        batchId: allocation.batchId,
        batchCode: allocation.batch.code,
        quantity: Number(allocation.quantity),
      })),
    })),
    recordedBy: sale.recordedBy,
    recordedAt: sale.recordedAt,
    cancelReason: sale.cancelReason,
    cancelledAt: sale.cancelledAt,
    cancelledBy: sale.cancelledBy,
  };
}

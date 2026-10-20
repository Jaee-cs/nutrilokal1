/**
 * Representasi batch, pergerakan stok batch, dan penyesuaian stok
 * untuk respons API (README 5.3 dan 5.4).
 */
import { Prisma } from '@prisma/client';

const RECORDED_BY_SELECT = { select: { id: true, username: true, name: true } } as const;

export const BATCH_INCLUDE = {
  product: { select: { id: true, name: true, unit: true, photoUrl: true } },
  aliases: { orderBy: { createdAt: 'asc' as const } },
  // Kehadiran catatan produksi menandai riwayat batch (README 5.3).
  production: { select: { id: true } },
} as const;

export const BATCH_DETAIL_INCLUDE = {
  ...BATCH_INCLUDE,
  openingBalance: { include: { recordedBy: RECORDED_BY_SELECT } },
  stockMovements: {
    orderBy: { recordedAt: 'desc' as const },
    include: { recordedBy: RECORDED_BY_SELECT },
  },
} as const;

export type BatchWithSummary = Prisma.BatchGetPayload<{ include: typeof BATCH_INCLUDE }>;
export type BatchWithDetail = Prisma.BatchGetPayload<{ include: typeof BATCH_DETAIL_INCLUDE }>;

export interface PublicBatch {
  id: string;
  code: string;
  /** Kode lama hasil koreksi tanggal produksi — tetap mengarah ke batch ini. */
  aliases: string[];
  product: { id: string; name: string; unit: string; photoUrl: string | null };
  /** KOSONG untuk batch stok awal yang tanggal produksinya tidak diketahui. */
  productionDate: Date | null;
  stock: number;
  /** Batch tanpa catatan produksi (mis. stok awal) — riwayat terbatas. */
  hasLimitedHistory: boolean;
  /** Tanggal kedaluwarsa (README 5.6); kosong bila belum tersedia/tervalidasi. */
  expiryDate: Date | null;
  /** True bila tanggal kedaluwarsa sudah dicatat dan divalidasi Admin. */
  expiryValidated: boolean;
  createdAt: Date;
}

export function toPublicBatch(batch: BatchWithSummary): PublicBatch {
  return {
    id: batch.id,
    code: batch.code,
    aliases: batch.aliases.map((alias) => alias.code),
    product: batch.product,
    productionDate: batch.productionDate,
    stock: Number(batch.stockQuantity),
    hasLimitedHistory: batch.production === null,
    expiryDate: batch.expiryDate,
    expiryValidated: batch.expiryValidatedAt !== null,
    createdAt: batch.createdAt,
  };
}

export interface PublicBatchMovement {
  id: string;
  type: string;
  /** Tanda: positif menambah stok batch, negatif mengurangi. */
  quantity: number;
  occurredAt: Date;
  recordedAt: Date;
  recordedBy: { id: string; username: string; name: string | null };
  reason: string | null;
}

export function toPublicBatchMovement(
  movement: BatchWithDetail['stockMovements'][number]
): PublicBatchMovement {
  return {
    id: movement.id,
    type: movement.type,
    quantity: Number(movement.quantity),
    occurredAt: movement.occurredAt,
    recordedAt: movement.recordedAt,
    recordedBy: movement.recordedBy,
    reason: movement.reason,
  };
}

export interface PublicBatchDetail extends PublicBatch {
  openingBalance: {
    id: string;
    quantity: number;
    note: string | null;
    recordedBy: { id: string; username: string; name: string | null };
    createdAt: Date;
  } | null;
  movements: PublicBatchMovement[];
}

export function toPublicBatchDetail(batch: BatchWithDetail): PublicBatchDetail {
  return {
    ...toPublicBatch(batch),
    openingBalance: batch.openingBalance
      ? {
          id: batch.openingBalance.id,
          quantity: Number(batch.openingBalance.quantity),
          note: batch.openingBalance.note,
          recordedBy: batch.openingBalance.recordedBy,
          createdAt: batch.openingBalance.createdAt,
        }
      : null,
    movements: batch.stockMovements.map(toPublicBatchMovement),
  };
}

// ---------------------------------------------------------------------------
// Penyesuaian stok (README 5.4)
// ---------------------------------------------------------------------------

export const STOCK_ADJUSTMENT_INCLUDE = {
  adjustedBy: RECORDED_BY_SELECT,
  material: { select: { id: true, name: true, unit: true } },
  batch: { select: { id: true, code: true, product: { select: { name: true } } } },
} as const;

export type StockAdjustmentWithRelations = Prisma.StockAdjustmentGetPayload<{
  include: typeof STOCK_ADJUSTMENT_INCLUDE;
}>;

export interface PublicStockAdjustment {
  id: string;
  targetType: 'MATERIAL' | 'BATCH';
  targetId: string | null;
  /** Tanda: positif menambah stok, negatif mengurangi. */
  quantity: number;
  reason: string;
  adjustedBy: { id: string; username: string; name: string | null };
  adjustedAt: Date;
  target:
    | { kind: 'material'; id: string; name: string; unit: string }
    | { kind: 'batch'; id: string; code: string; productName: string }
    | null;
}

export function toPublicStockAdjustment(
  adjustment: StockAdjustmentWithRelations
): PublicStockAdjustment {
  let target: PublicStockAdjustment['target'] = null;
  if (adjustment.targetType === 'MATERIAL' && adjustment.material) {
    target = {
      kind: 'material',
      id: adjustment.material.id,
      name: adjustment.material.name,
      unit: adjustment.material.unit,
    };
  } else if (adjustment.targetType === 'BATCH' && adjustment.batch) {
    target = {
      kind: 'batch',
      id: adjustment.batch.id,
      code: adjustment.batch.code,
      productName: adjustment.batch.product.name,
    };
  }

  return {
    id: adjustment.id,
    targetType: adjustment.targetType,
    targetId: adjustment.materialId ?? adjustment.batchId,
    quantity: Number(adjustment.quantity),
    reason: adjustment.reason,
    adjustedBy: adjustment.adjustedBy,
    adjustedAt: adjustment.adjustedAt,
    target,
  };
}

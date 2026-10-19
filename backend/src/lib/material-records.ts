/**
 * Representasi riwayat penerimaan, saldo awal, dan pergerakan stok bahan
 * baku untuk respons API. Jejak pergerakan stok tidak pernah diedit atau
 * dihapus (README 5.3-5.4): hanya dapat dilihat.
 */
import type { MaterialOpeningBalance, MaterialReceipt, MaterialStockMovement, StockMovementType } from '@prisma/client';

export interface MaterialUserSummary {
  id: string;
  username: string;
  name: string | null;
}

export interface PublicMaterialReceipt {
  id: string;
  materialId: string;
  quantity: number;
  receivedAt: Date;
  note: string | null;
  recordedBy: MaterialUserSummary;
  createdAt: Date;
}

export function toPublicMaterialReceipt(receipt: MaterialReceipt & { recordedBy: MaterialUserSummary }): PublicMaterialReceipt {
  return {
    id: receipt.id,
    materialId: receipt.materialId,
    quantity: Number(receipt.quantity),
    receivedAt: receipt.receivedAt,
    note: receipt.note,
    recordedBy: receipt.recordedBy,
    createdAt: receipt.createdAt,
  };
}

export interface PublicMaterialOpeningBalance {
  id: string;
  materialId: string;
  quantity: number;
  date: Date;
  reason: string;
  recordedBy: MaterialUserSummary;
  createdAt: Date;
}

export function toPublicMaterialOpeningBalance(
  balance: MaterialOpeningBalance & { recordedBy: MaterialUserSummary }
): PublicMaterialOpeningBalance {
  return {
    id: balance.id,
    materialId: balance.materialId,
    quantity: Number(balance.quantity),
    date: balance.date,
    reason: balance.reason,
    recordedBy: balance.recordedBy,
    createdAt: balance.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Pergerakan stok bahan baku (README 5.4) — hanya baca
// ---------------------------------------------------------------------------

export const MATERIAL_MOVEMENT_INCLUDE = {
  recordedBy: { select: { id: true, username: true, name: true } },
} as const;

export type MaterialMovementWithRecorder = MaterialStockMovement & {
  recordedBy: MaterialUserSummary;
};

export interface PublicMaterialMovement {
  id: string;
  materialId: string;
  type: StockMovementType;
  /**
   * Nilai sebagaimana disimpan di ledger: selalu positif untuk penerimaan,
   * saldo awal, dan pemakaian produksi; penyesuaian bernilai TANDA.
   */
  quantity: number;
  /**
   * Dampak sebenarnya terhadap stok: positif menambah, negatif mengurangi.
   * Pemakaian produksi disimpan positif tetapi mengurangi stok.
   */
  delta: number;
  occurredAt: Date;
  recordedAt: Date;
  recordedBy: MaterialUserSummary;
  reason: string | null;
  /** ID catatan sumber (penerimaan/saldo awal/pemakaian/penyesuaian). */
  sourceId: string | null;
}

export function toPublicMaterialMovement(movement: MaterialMovementWithRecorder): PublicMaterialMovement {
  const quantity = Number(movement.quantity);

  return {
    id: movement.id,
    materialId: movement.materialId,
    type: movement.type,
    quantity,
    // Konvensi ledger bahan: hanya ADJUSTMENT yang sudah bernilai tanda.
    delta: movement.type === 'PRODUCTION_USAGE' ? -quantity : quantity,
    occurredAt: movement.occurredAt,
    recordedAt: movement.recordedAt,
    recordedBy: movement.recordedBy,
    reason: movement.reason,
    sourceId:
      movement.adjustmentId ??
      movement.productionUsageId ??
      movement.receiptId ??
      movement.openingBalanceId,
  };
}

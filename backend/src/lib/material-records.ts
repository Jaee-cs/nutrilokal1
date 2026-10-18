/**
 * Representasi riwayat penerimaan dan saldo awal untuk respons API.
 * Jejak pergerakan stok tidak pernah diedit atau dihapus (README 5.3-5.4).
 */
import type { MaterialOpeningBalance, MaterialReceipt } from '@prisma/client';

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

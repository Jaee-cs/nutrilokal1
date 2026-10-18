/**
 * Representasi catatan produksi untuk respons API.
 * Termasuk batch (kode aktif + alias kode lama) dan pemakaian bahan aktual.
 */
import type { Batch, BatchAlias, Production, ProductionMaterialUsage } from '@prisma/client';

export type ProductionWithRelations = Production & {
  product: { id: string; name: string; unit: string };
  recordedBy: { id: string; username: string; name: string | null };
  batch: (Batch & { aliases: BatchAlias[] }) | null;
  usages: (ProductionMaterialUsage & {
    material: { id: string; name: string; unit: string };
  })[];
};

export const PRODUCTION_INCLUDE = {
  product: { select: { id: true, name: true, unit: true } },
  recordedBy: { select: { id: true, username: true, name: true } },
  batch: { include: { aliases: { orderBy: { createdAt: 'asc' as const } } } },
  usages: {
    include: { material: { select: { id: true, name: true, unit: true } } },
    orderBy: { material: { name: 'asc' as const } },
  },
} as const;

export interface PublicProduction {
  id: string;
  productId: string;
  product: { id: string; name: string; unit: string };
  productionDate: Date;
  yieldQuantity: number;
  note: string | null;
  recordedBy: { id: string; username: string; name: string | null };
  recordedAt: Date;
  batch: {
    id: string;
    code: string;
    productionDate: Date;
    stock: number;
    aliases: string[];
  } | null;
  usages: {
    materialId: string;
    material: { id: string; name: string; unit: string };
    quantity: number;
  }[];
}

export function toPublicProduction(p: ProductionWithRelations): PublicProduction {
  return {
    id: p.id,
    productId: p.productId,
    product: p.product,
    productionDate: p.productionDate,
    yieldQuantity: Number(p.yieldQuantity),
    note: p.note,
    recordedBy: p.recordedBy,
    recordedAt: p.recordedAt,
    batch: p.batch
      ? {
          id: p.batch.id,
          code: p.batch.code,
          productionDate: p.batch.productionDate,
          stock: Number(p.batch.stockQuantity),
          aliases: p.batch.aliases.map((alias) => alias.code),
        }
      : null,
    usages: p.usages.map((usage) => ({
      materialId: usage.materialId,
      material: usage.material,
      quantity: Number(usage.quantity),
    })),
  };
}

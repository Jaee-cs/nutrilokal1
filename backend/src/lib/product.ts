/**
 * Representasi produk yang aman dikirim ke klien.
 */
import type { Product } from '@prisma/client';

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  sellingPrice: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicProduct(product: Product): PublicProduct {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    unit: product.unit,
    sellingPrice: Number(product.sellingPrice),
    isActive: product.isActive,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

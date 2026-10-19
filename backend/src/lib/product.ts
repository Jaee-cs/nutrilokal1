/**
 * Representasi produk yang aman dikirim ke klien.
 * Menyertakan total stok produk dan jumlah batch bila tersedia —
 * total SELALU diturunkan dari jumlah stok seluruh batch (README 5.4),
 * bukan angka tersimpan terpisah.
 */
import type { Product } from '@prisma/client';

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  /** Komposisi bahan (info publik QR/katalog, README 5.6). */
  composition: string | null;
  /** Petunjuk penyimpanan (info publik QR/katalog, README 5.6). */
  storageInstructions: string | null;
  unit: string;
  sellingPrice: number;
  isActive: boolean;
  /** Total stok produk jadi = jumlah stok seluruh batch produk ini. */
  stock?: number;
  batchCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductStockSummary {
  stock: number;
  batchCount: number;
}

export function toPublicProduct(
  product: Product,
  stockSummary?: ProductStockSummary
): PublicProduct {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    composition: product.composition,
    storageInstructions: product.storageInstructions,
    unit: product.unit,
    sellingPrice: Number(product.sellingPrice),
    isActive: product.isActive,
    ...(stockSummary ? { stock: stockSummary.stock, batchCount: stockSummary.batchCount } : {}),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

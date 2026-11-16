/**
 * Representasi produk yang aman dikirim ke klien.
 * Menyertakan total stok produk dan jumlah batch bila tersedia —
 * total SELALU diturunkan dari jumlah stok seluruh batch (README 5.4),
 * bukan angka tersimpan terpisah.
 */
import type { Prisma, Product } from '@prisma/client';
import { toPublicRecipeItem, type PublicRecipeItem } from './product-recipe';

export interface PublicProduct {
  id: string;
  name: string;
  description: string | null;
  /** Komposisi bahan (info publik QR/katalog, README 5.6). */
  composition: string | null;
  /** Petunjuk penyimpanan (info publik QR/katalog, README 5.6). */
  storageInstructions: string | null;
  /** Path publik foto produk (info publik QR/katalog, README 5.6). */
  photoUrl: string | null;
  unit: string;
  sellingPrice: number;
  isActive: boolean;
  /** Total stok produk jadi = jumlah stok seluruh batch produk ini. */
  stock?: number;
  batchCount?: number;
  /** Resep standar bahan per 1 satuan produk (kosong bila belum diatur). */
  recipe: PublicRecipeItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductStockSummary {
  stock: number;
  batchCount: number;
}

type RecipeItemWithMaterial = Prisma.ProductRecipeItemGetPayload<{
  include: { material: { select: { id: true; name: true; unit: true; isActive: true } } };
}>;

type ProductWithOptionalRecipe = Product & { recipeItems?: RecipeItemWithMaterial[] };

export function toPublicProduct(
  product: ProductWithOptionalRecipe,
  stockSummary?: ProductStockSummary
): PublicProduct {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    composition: product.composition,
    storageInstructions: product.storageInstructions,
    photoUrl: product.photoUrl,
    unit: product.unit,
    sellingPrice: Number(product.sellingPrice),
    isActive: product.isActive,
    ...(stockSummary ? { stock: stockSummary.stock, batchCount: stockSummary.batchCount } : {}),
    recipe: (product.recipeItems ?? []).map(toPublicRecipeItem),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

import { Prisma } from '@prisma/client';
import { validateQuantity } from './validate';
import { validateRecipeUnitCompatibility } from './unit-conversion';

export interface RecipeItemInput {
  materialId: string;
  quantityPerUnit: number;
  recipeUnit: string;
}

export interface PublicRecipeItem {
  materialId: string;
  material: { id: string; name: string; unit: string; isActive: boolean };
  quantityPerUnit: number;
  recipeUnit: string;
}

export const PRODUCT_RECIPE_INCLUDE = {
  recipeItems: {
    include: { material: { select: { id: true, name: true, unit: true, isActive: true } } },
    orderBy: [{ material: { name: 'asc' as const } }, { createdAt: 'asc' as const }],
  },
} satisfies import('@prisma/client').Prisma.ProductInclude;

type RecipeItemWithMaterial = Prisma.ProductRecipeItemGetPayload<{
  include: { material: { select: { id: true; name: true; unit: true; isActive: true } } };
}>;

export function toPublicRecipeItem(item: RecipeItemWithMaterial): PublicRecipeItem {
  return {
    materialId: item.materialId,
    material: item.material,
    quantityPerUnit: Number(item.quantityPerUnit),
    recipeUnit: item.recipeUnit,
  };
}

export function parseRecipeInput(
  value: unknown
):
  | { ok: true; items: RecipeItemInput[] }
  | { ok: false; message: string } {
  if (value === undefined) {
    return { ok: true, items: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, message: 'Resep bahan baku harus berupa daftar.' };
  }

  const items: RecipeItemInput[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const item = value[index] as Record<string, unknown> | null;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return { ok: false, message: `Bahan resep ke-${index + 1} tidak valid.` };
    }
    const materialId = typeof item.materialId === 'string' ? item.materialId.trim() : '';
    if (!materialId) {
      return { ok: false, message: `Bahan resep ke-${index + 1} wajib dipilih.` };
    }
    if (seen.has(materialId)) {
      return { ok: false, message: 'Bahan yang sama tidak boleh dimasukkan berulang dalam satu resep.' };
    }
    seen.add(materialId);

    const qtyError = validateQuantity(item.quantityPerUnit, 'Jumlah kebutuhan resep');
    if (qtyError) {
      return { ok: false, message: qtyError };
    }

    const recipeUnit = typeof item.recipeUnit === 'string' ? item.recipeUnit.trim() : '';
    if (!recipeUnit) {
      return { ok: false, message: `Satuan resep ke-${index + 1} wajib diisi.` };
    }
    if (recipeUnit.length > 30) {
      return { ok: false, message: 'Satuan resep maksimal 30 karakter.' };
    }

    items.push({
      materialId,
      quantityPerUnit: item.quantityPerUnit as number,
      recipeUnit,
    });
  }

  return { ok: true, items };
}

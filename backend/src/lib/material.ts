/**
 * Representasi bahan baku yang aman dikirim ke klien.
 * `stock` adalah saldo total per jenis bahan baku (README 5.2).
 */
import type { Material } from '@prisma/client';

export interface PublicMaterial {
  id: string;
  name: string;
  unit: string;
  isActive: boolean;
  stock: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicMaterial(material: Material, stock: number): PublicMaterial {
  return {
    id: material.id,
    name: material.name,
    unit: material.unit,
    isActive: material.isActive,
    stock,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
}

/**
 * Representasi bahan baku yang aman dikirim ke klien.
 */
import type { Material } from '@prisma/client';

export interface PublicMaterial {
  id: string;
  name: string;
  unit: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicMaterial(material: Material): PublicMaterial {
  return {
    id: material.id,
    name: material.name,
    unit: material.unit,
    isActive: material.isActive,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
}

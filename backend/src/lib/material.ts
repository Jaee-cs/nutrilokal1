/**
 * Representasi bahan baku yang aman dikirim ke klien.
 * `stock` adalah saldo total per jenis bahan baku (README 5.2).
 */
import type { Material } from '@prisma/client';

/** Pesan seragam saat nama bahan baku sudah dipakai bahan lain. */
export const MATERIAL_NAME_DUPLICATE_MESSAGE =
  'Nama bahan baku sudah terdaftar. Gunakan nama yang berbeda.';

/**
 * Kunci pembanding nama bahan baku: tanpa spasi di awal/akhir dan tanpa
 * membedakan huruf besar/kecil. Hanya kecocokan penuh yang dianggap
 * duplikat — "Singkong" tetap berbeda dari "Singkong Kuning".
 */
export function materialNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export interface PublicMaterial {
  id: string;
  name: string;
  unit: string;
  /** true bila satuan Manual (teks bebas, tanpa konversi otomatis). */
  isManual: boolean;
  isActive: boolean;
  stock: number;
  /** Arsip (soft archive). null = data aktif. */
  archivedAt: Date | null;
  archivedById: string | null;
  archiveReason: string | null;
  archivedByName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicMaterial(
  material: Material,
  stock: number,
  extras?: { archivedByName?: string | null }
): PublicMaterial {
  return {
    id: material.id,
    name: material.name,
    unit: material.unit,
    isManual: material.isManual,
    isActive: material.isActive,
    stock,
    archivedAt: material.archivedAt,
    archivedById: material.archivedById,
    archiveReason: material.archiveReason,
    ...(extras?.archivedByName !== undefined ? { archivedByName: extras.archivedByName } : {}),
    createdAt: material.createdAt,
    updatedAt: material.updatedAt,
  };
}

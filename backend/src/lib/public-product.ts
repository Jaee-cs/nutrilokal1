/**
 * Halaman publik produk (QR permanen per produk).
 *
 * QR produk menunjuk ke halaman publik yang stabil berdasarkan ID produk,
 * bukan kode batch. Halaman ini menampilkan informasi produk yang memang
 * untuk publik dan seluruh riwayat batch produksi yang dibaca langsung dari
 * database setiap kali diminta.
 *
 * Prinsip keamanan:
 * - Hanya produk aktif yang dapat diakses. Produk nonaktif/arsip tidak
 *   memiliki halaman publik.
 * - Tidak ada data internal: stok, harga, akun pengguna, ID batch, status
 *   siklus QR batch, atau riwayat audit.
 * - Tanggal kedaluwarsa hanya dikirim bila sudah dicatat dan divalidasi
 *   Admin (aturan README 5.6 yang sama dengan QR batch).
 * - Status batch diturunkan dari fakta terkini (stok, kedaluwarsa, dan
 *   penarikan publikasi QR batch), bukan disimpan sebagai label statis.
 */
import { Prisma } from '@prisma/client';
import { businessDateCode, todayBusinessDateCode } from './date';

/** Informasi produsen yang memang untuk publik. */
export const PUBLIC_PRODUCER = {
  name: 'KWT Gogor',
  location: 'Kalurahan Salam, Patuk, Gunungkidul',
} as const;

export type PublicProductBatchStatus =
  | 'TERSEDIA'
  | 'HABIS'
  | 'KEDALUWARSA'
  | 'DITARIK';

export interface PublicProductBatch {
  code: string;
  /** `null` untuk batch stok awal yang tanggal produksinya tidak diketahui. */
  productionDate: string | null;
  /** `null` bila belum tersedia atau belum divalidasi Admin. */
  expiryDate: string | null;
  status: PublicProductBatchStatus;
}

export interface PublicProductInfo {
  name: string;
  unit: string;
  description?: string;
  composition?: string;
  storageInstructions?: string;
  photoUrl?: string;
}

export interface PublicProductPage {
  status: 'PUBLISHED';
  producer: { name: string; location: string };
  product: PublicProductInfo;
  /** Urut dari produksi terbaru ke terlama; batch tanpa tanggal di akhir. */
  batches: PublicProductBatch[];
}

interface ProductFacts {
  name: string;
  unit: string;
  description: string | null;
  composition: string | null;
  storageInstructions: string | null;
  photoUrl: string | null;
}

interface BatchFacts {
  code: string;
  productionDate: Date | null;
  expiryDate: Date | null;
  expiryValidatedAt: Date | null;
  stockQuantity: Prisma.Decimal;
  createdAt: Date;
  qrPublication: { withdrawnAt: Date | null } | null;
}

/**
 * Batch terbaru lebih dulu. Batch tanpa tanggal produksi (stok awal yang
 * tanggalnya tidak diketahui) diletakkan paling akhir agar tidak dianggap
 * sebagai produksi terbaru.
 */
export function sortPublicBatchesNewestFirst<T extends {
  productionDate: Date | null;
  createdAt: Date;
  code: string;
}>(batches: T[]): T[] {
  return [...batches].sort((a, b) => {
    const aTime = a.productionDate?.getTime() ?? null;
    const bTime = b.productionDate?.getTime() ?? null;

    if (aTime === null && bTime === null) {
      return b.createdAt.getTime() - a.createdAt.getTime() || b.code.localeCompare(a.code);
    }
    if (aTime === null) return 1;
    if (bTime === null) return -1;

    return (
      bTime - aTime ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.code.localeCompare(a.code)
    );
  });
}

/**
 * Status publik satu batch berdasarkan kondisi sebenarnya:
 * - DITARIK bila informasi publik batch pernah ditarik Admin.
 * - KEDALUWARSA bila tanggal kedaluwarsa sudah tervalidasi dan sudah lewat.
 * - HABIS bila stok batch sudah nol.
 * - TERSEDIA hanya bila tidak ada kondisi di atas.
 */
export function publicBatchStatus(
  batch: BatchFacts,
  todayCode = todayBusinessDateCode()
): PublicProductBatchStatus {
  if (batch.qrPublication?.withdrawnAt) {
    return 'DITARIK';
  }
  if (
    batch.expiryDate &&
    batch.expiryValidatedAt &&
    businessDateCode(batch.expiryDate) < todayCode
  ) {
    return 'KEDALUWARSA';
  }
  if (Number(batch.stockQuantity) <= 0) {
    return 'HABIS';
  }
  return 'TERSEDIA';
}

/** Membangun respons publik produk beserta riwayat batch terkini. */
export function buildPublicProductResponse(
  product: ProductFacts,
  batches: BatchFacts[],
  todayCode = todayBusinessDateCode()
): PublicProductPage {
  const info: PublicProductInfo = {
    name: product.name,
    unit: product.unit,
  };
  if (product.description) info.description = product.description;
  if (product.composition) info.composition = product.composition;
  if (product.storageInstructions) info.storageInstructions = product.storageInstructions;
  if (product.photoUrl) info.photoUrl = product.photoUrl;

  const publicBatches = sortPublicBatchesNewestFirst(batches).map((batch) => ({
    code: batch.code,
    productionDate: batch.productionDate ? businessDateCode(batch.productionDate) : null,
    // Tanggal kedaluwarsa hanya tampil setelah dicatat & divalidasi Admin.
    expiryDate:
      batch.expiryDate && batch.expiryValidatedAt
        ? businessDateCode(batch.expiryDate)
        : null,
    status: publicBatchStatus(batch, todayCode),
  }));

  return {
    status: 'PUBLISHED',
    producer: PUBLIC_PRODUCER,
    product: info,
    batches: publicBatches,
  };
}

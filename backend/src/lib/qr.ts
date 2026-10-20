/**
 * Representasi status publikasi QR per batch (README 5.6) untuk respons
 * API internal, serta pembangun respons PUBLIK (tanpa login).
 *
 * Prinsip keamanan (README 5.6 dan 6):
 * - Endpoint publik hanya mengirim informasi yang sudah divalidasi dan
 *   diterbitkan Admin: nama produk, deskripsi, kode batch, tanggal
 *   produksi, komposisi bahan, petunjuk penyimpanan, dan tanggal
 *   kedaluwarsa bila tersedia serta tervalidasi.
 * - Kolom yang belum tersedia atau belum divalidasi DISSEMBUNYIKAN
 *   (tidak muncul sama sekali di respons — bukan null).
 * - Jika informasi ditarik (atau belum pernah diterbitkan), respons
 *   publik HANYA berisi pemberitahuan "tidak tersedia" — tanpa data
 *   yang ditarik dan tanpa data internal (stok, harga, akun, id, dsb.).
 */
import { Prisma } from '@prisma/client';
import { businessDateCode } from './date';

const RECORDED_BY_SELECT = { select: { id: true, username: true, name: true } } as const;

export const QR_PUBLICATION_INCLUDE = {
  validatedBy: RECORDED_BY_SELECT,
  publishedBy: RECORDED_BY_SELECT,
  withdrawnBy: RECORDED_BY_SELECT,
} as const;

export type QrPublicationWithActors = Prisma.QrPublicationGetPayload<{
  include: typeof QR_PUBLICATION_INCLUDE;
}>;

/** Status QR diturunkan dari timestamp — satu sumber kebenaran. */
export type QrStatus = 'NOT_CONFIGURED' | 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'WITHDRAWN';

export function qrStatus(publication: {
  validatedAt: Date | null;
  publishedAt: Date | null;
  withdrawnAt: Date | null;
} | null): QrStatus {
  if (!publication) {
    return 'NOT_CONFIGURED';
  }
  if (publication.withdrawnAt) {
    return 'WITHDRAWN';
  }
  if (!publication.publishedAt) {
    return publication.validatedAt ? 'VALIDATED' : 'DRAFT';
  }
  return 'PUBLISHED';
}

/** Jalur endpoint publik untuk kode batch (target QR). */
export function qrPublicPath(code: string): string {
  return `/api/public/qr/${code}`;
}

export interface PublicQrManagement {
  batchId: string;
  code: string;
  publicPath: string;
  status: QrStatus;
  validatedAt: Date | null;
  validatedBy: { id: string; username: string; name: string | null } | null;
  publishedAt: Date | null;
  publishedBy: { id: string; username: string; name: string | null } | null;
  withdrawnAt: Date | null;
  withdrawnBy: { id: string; username: string; name: string | null } | null;
}

export function toPublicQrManagement(
  batch: { id: string; code: string },
  publication: QrPublicationWithActors | null
): PublicQrManagement {
  return {
    batchId: batch.id,
    code: batch.code,
    publicPath: qrPublicPath(batch.code),
    status: qrStatus(publication),
    validatedAt: publication?.validatedAt ?? null,
    validatedBy: publication?.validatedBy ?? null,
    publishedAt: publication?.publishedAt ?? null,
    publishedBy: publication?.publishedBy ?? null,
    withdrawnAt: publication?.withdrawnAt ?? null,
    withdrawnBy: publication?.withdrawnBy ?? null,
  };
}

// ---------------------------------------------------------------------------
// Respons publik (tanpa login)
// ---------------------------------------------------------------------------

/** Pemberitahuan tunggal untuk semua kasus tidak tersedia. */
export const QR_UNAVAILABLE_MESSAGE = 'Informasi publik untuk batch ini tidak tersedia.';

export interface PublicQrUnavailable {
  status: 'UNAVAILABLE';
  message: string;
}

export interface PublicQrPublished {
  status: 'PUBLISHED';
  product: {
    name: string;
    unit: string;
    /** Disembunyikan bila belum diisi Admin. */
    description?: string;
    /** Disembunyikan bila belum diisi Admin. */
    composition?: string;
    /** Disembunyikan bila belum diisi Admin. */
    storageInstructions?: string;
    /** Path foto produk; disembunyikan bila Admin belum mengunggah foto. */
    photoUrl?: string;
  };
  batch: {
    code: string;
    /** Disembunyikan bila tidak diketahui (batch stok awal, README 5.3). */
    productionDate?: string;
    /** Hanya jika tersedia DAN tervalidasi (README 5.6). */
    expiryDate?: string;
  };
}

export type PublicQrResponse = PublicQrPublished | PublicQrUnavailable;

interface QrBatchFacts {
  code: string;
  productionDate: Date | null;
  expiryDate: Date | null;
  expiryValidatedAt: Date | null;
  product: {
    name: string;
    unit: string;
    description: string | null;
    composition: string | null;
    storageInstructions: string | null;
    photoUrl: string | null;
  };
}

/**
 * Membangun respons publik QR. Data hanya muncul bila publikasi berstatus
 * PUBLISHED (sudah divalidasi dan diterbitkan, belum ditarik); setiap
 * kolom yang belum tersedia/disembunyikan tidak dikirim sama sekali.
 */
export function buildPublicQrResponse(
  batch: QrBatchFacts | null,
  publication: { publishedAt: Date | null; withdrawnAt: Date | null } | null
): PublicQrResponse {
  // Data hanya tampil bila sudah diterbitkan DAN belum ditarik.
  if (!batch || !publication || !publication.publishedAt || publication.withdrawnAt) {
    return { status: 'UNAVAILABLE', message: QR_UNAVAILABLE_MESSAGE };
  }

  const product: PublicQrPublished['product'] = {
    name: batch.product.name,
    unit: batch.product.unit,
  };
  if (batch.product.description) {
    product.description = batch.product.description;
  }
  if (batch.product.composition) {
    product.composition = batch.product.composition;
  }
  if (batch.product.storageInstructions) {
    product.storageInstructions = batch.product.storageInstructions;
  }
  // Foto produk: hanya bila Admin sudah mengunggahnya.
  if (batch.product.photoUrl) {
    product.photoUrl = batch.product.photoUrl;
  }

  const publicBatch: PublicQrPublished['batch'] = { code: batch.code };
  if (batch.productionDate) {
    publicBatch.productionDate = businessDateCode(batch.productionDate);
  }
  if (batch.expiryDate && batch.expiryValidatedAt) {
    publicBatch.expiryDate = businessDateCode(batch.expiryDate);
  }

  return { status: 'PUBLISHED', product, batch: publicBatch };
}

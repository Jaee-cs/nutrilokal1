/**
 * Kode batch (README 5.3): format NL-YYYYMMDD-NNN, tanggal pada kode
 * mengikuti tanggal produksi sebenarnya, nomor urut dimulai dari 001
 * untuk tanggal produksi tersebut.
 *
 * Keunikan kode dijamin UNIQUE constraint database (README 6). Alokasi
 * dilakukan di dalam transaksi yang sama dengan penyimpanan produksi;
 * saat permintaan bersamaan memperebutkan nomor yang sama, transaksi
 * yang kalah unique constraint diulang dengan nomor berikutnya.
 */
import { Prisma } from '@prisma/client';
import { businessDateCode } from './date';

export const MAX_BATCH_CODE_ATTEMPTS = 5;

/** 'NL-YYYYMMDD-' untuk satu tanggal produksi. */
export function batchCodePrefix(productionDate: Date): string {
  return `NL-${businessDateCode(productionDate).replace(/-/g, '')}-`;
}

/** 'NL-YYYYMMDD-NNN' dengan nomor urut tiga digit. */
export function formatBatchCode(productionDate: Date, sequence: number): string {
  return `${batchCodePrefix(productionDate)}${String(sequence).padStart(3, '0')}`;
}

/** 'NL-OPEN-YYYYMMDD-' untuk stok awal produk jadi (README 5.3). */
export function openingBatchCodePrefix(recordingDate: Date): string {
  return `NL-OPEN-${businessDateCode(recordingDate).replace(/-/g, '')}-`;
}

/** 'NL-OPEN-YYYYMMDD-NNN' — tanggal pada kode adalah tanggal PENCATATAN stok awal. */
export function formatOpeningBatchCode(recordingDate: Date, sequence: number): string {
  return `${openingBatchCodePrefix(recordingDate)}${String(sequence).padStart(3, '0')}`;
}

function sequenceOf(code: string): number {
  const parsed = Number.parseInt(code.slice(-3), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Nomor urut tertinggi pada suatu prefix kode (termasuk alias). */
async function lastSequenceFor(tx: Prisma.TransactionClient, prefix: string): Promise<number> {
  const [lastBatch, lastAlias] = await Promise.all([
    tx.batch.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    }),
    tx.batchAlias.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    }),
  ]);

  return Math.max(
    lastBatch ? sequenceOf(lastBatch.code) : 0,
    lastAlias ? sequenceOf(lastAlias.code) : 0
  );
}

/**
 * Mengalokasikan kode batch berikutnya untuk suatu tanggal produksi di dalam
 * transaksi. Memperhitungkan kode aktif DAN alias (kode lama hasil koreksi
 * tanggal), sehingga nomor urut tidak pernah dipakai ulang — termasuk untuk
 * pencatatan produksi mundur belakangan.
 */
export async function allocateBatchCode(
  tx: Prisma.TransactionClient,
  productionDate: Date
): Promise<string> {
  const lastSequence = await lastSequenceFor(tx, batchCodePrefix(productionDate));
  return formatBatchCode(productionDate, lastSequence + 1);
}

/**
 * Mengalokasikan kode stok awal `NL-OPEN-YYYYMMDD-NNN` untuk suatu tanggal
 * pencatatan (README 5.3). Urutan dihitung per tanggal pencatatan dan tidak
 * pernah memakai ulang nomor yang sudah dipakai.
 */
export async function allocateOpeningBatchCode(
  tx: Prisma.TransactionClient,
  recordingDate: Date
): Promise<string> {
  const lastSequence = await lastSequenceFor(tx, openingBatchCodePrefix(recordingDate));
  return formatOpeningBatchCode(recordingDate, lastSequence + 1);
}

/**
 * True bila error adalah pelanggaran UNIQUE constraint pada kolom kode
 * batch (batches.code atau batch_aliases.code) akibat permintaan bersamaan.
 */
export function isBatchCodeConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target) && target.includes('code');
}

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

function sequenceOf(code: string): number {
  const parsed = Number.parseInt(code.slice(-3), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
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
  const prefix = batchCodePrefix(productionDate);

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

  const lastSequence = Math.max(
    lastBatch ? sequenceOf(lastBatch.code) : 0,
    lastAlias ? sequenceOf(lastAlias.code) : 0
  );

  return formatBatchCode(productionDate, lastSequence + 1);
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

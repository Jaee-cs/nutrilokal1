/**
 * Rentang tanggal untuk laporan operasional (B9).
 *
 * Aturan:
 * - Parameter `from`/`to` opsional berformat ketat YYYY-MM-DD (tanggal
 *   bisnis kalender WIB). Tanpa filter = seluruh data.
 * - `from` tidak boleh setelah `to`.
 * - Filter memakai hari bisnis WIB yang sama untuk timestamp pencatatan
 *   (mis. recordedAt transaksi) maupun tanggal bisnis tersimpan (mis.
 *   productionDate) — lihat businessDayRange di lib/date.
 */
import { businessDateCode, businessDayRange, parseBusinessDate } from './date';
import { validateDateOnly } from './validate';

export interface ReportPeriod {
  from: string | null;
  to: string | null;
  /** null = tanpa batas (seluruh data). */
  range: { gte?: Date; lt?: Date } | null;
}

export type PeriodParseResult =
  | { ok: true; period: ReportPeriod }
  | { ok: false; message: string };

function parseDateParam(value: unknown): { ok: boolean; value: string | null } {
  if (value === undefined || value === null) {
    return { ok: true, value: null };
  }
  const valid =
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    validateDateOnly(value) === null &&
    // Round-trip memastikan tanggal kalender nyata (mis. 2026-02-31 ditolak).
    businessDateCode(parseBusinessDate(value)) === value;
  return { ok: valid, value: valid ? value : null };
}

/**
 * Membaca dan memvalidasi query `from`/`to` laporan.
 * Mengembalikan pesan 400 bila format atau rentang tidak valid.
 */
export function parseReportPeriod(query: Record<string, unknown>): PeriodParseResult {
  const from = parseDateParam(query.from);
  const to = parseDateParam(query.to);

  if (!from.ok) {
    return { ok: false, message: 'Parameter from harus berupa tanggal valid YYYY-MM-DD.' };
  }
  if (!to.ok) {
    return { ok: false, message: 'Parameter to harus berupa tanggal valid YYYY-MM-DD.' };
  }

  const fromCode = from.value;
  const toCode = to.value;
  if (fromCode && toCode && fromCode > toCode) {
    return { ok: false, message: 'Rentang tanggal tidak valid: from tidak boleh setelah to.' };
  }

  let range: ReportPeriod['range'] = null;
  if (fromCode && toCode) {
    range = businessDayRange(fromCode, toCode);
  } else if (fromCode) {
    range = { gte: businessDayRange(fromCode, fromCode).gte };
  } else if (toCode) {
    range = { lt: businessDayRange(toCode, toCode).lt };
  }

  return { ok: true, period: { from: fromCode, to: toCode, range } };
}

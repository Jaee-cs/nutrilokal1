import { Prisma } from '@prisma/client';

/**
 * Konversi satuan resep ↔ satuan stok bahan baku (README resep & konversi).
 *
 * Aturan yang berlaku:
 * - Berat `mg`, `g`, `kg` saling kompatibel dan dikonversi otomatis.
 * - Volume `ml`, `L` saling kompatibel dan dikonversi otomatis.
 * - Berat dan volume tidak boleh dicampur.
 * - Satuan Manual adalah teks bebas yang dipilih pengguna. Tidak ada
 *   konversi otomatis, tidak ditebak, dan tidak boleh dipakai resep otomatis.
 * - Alias lama (`gram`, `liter`, `l`, dll.) diterima saat membaca data lama,
 *   lalu dinormalisasi ke kode baku via `canonicalUnit`/`parseUnitCode`.
 * - Perhitungan memakai aritmetika desimal presisi (Prisma.Decimal) agar
 *   stok tidak terpengaruh kesalahan pembulatan floating-point.
 */

export type UnitGroup = 'mass' | 'volume' | 'manual';
export type StandardUnitGroup = Exclude<UnitGroup, 'manual'>;

export const UNIT_CODES = ['mg', 'g', 'kg', 'ml', 'L'] as const;

export type UnitCode = (typeof UNIT_CODES)[number];

export const UNIT_OPTIONS: { group: StandardUnitGroup; label: string; units: UnitCode[] }[] = [
  { group: 'mass', label: 'Berat', units: ['mg', 'g', 'kg'] },
  { group: 'volume', label: 'Volume', units: ['ml', 'L'] },
];

export const UNIT_KIND_LABELS: Record<UnitGroup, string> = {
  mass: 'Berat',
  volume: 'Volume',
  manual: 'Manual',
};

interface UnitDefinition {
  group: StandardUnitGroup;
  /** Faktor ke satuan dasar kelompok (berat: mg, volume: ml). */
  toBase: Prisma.Decimal;
  /** Kode baku yang disimpan di database. */
  canonical: UnitCode;
  /** Label ramah pengguna. */
  label: string;
}

const DEFINITIONS: Record<string, UnitDefinition> = {
  mg: { group: 'mass', toBase: new Prisma.Decimal(1), canonical: 'mg', label: 'mg' },
  g: { group: 'mass', toBase: new Prisma.Decimal(1000), canonical: 'g', label: 'gram' },
  gram: { group: 'mass', toBase: new Prisma.Decimal(1000), canonical: 'g', label: 'gram' },
  grams: { group: 'mass', toBase: new Prisma.Decimal(1000), canonical: 'g', label: 'gram' },
  kg: { group: 'mass', toBase: new Prisma.Decimal(1_000_000), canonical: 'kg', label: 'kg' },
  kilogram: { group: 'mass', toBase: new Prisma.Decimal(1_000_000), canonical: 'kg', label: 'kg' },
  kilograms: { group: 'mass', toBase: new Prisma.Decimal(1_000_000), canonical: 'kg', label: 'kg' },

  ml: { group: 'volume', toBase: new Prisma.Decimal(1), canonical: 'ml', label: 'ml' },
  milliliter: { group: 'volume', toBase: new Prisma.Decimal(1), canonical: 'ml', label: 'ml' },
  milliliters: { group: 'volume', toBase: new Prisma.Decimal(1), canonical: 'ml', label: 'ml' },
  l: { group: 'volume', toBase: new Prisma.Decimal(1000), canonical: 'L', label: 'liter' },
  liter: { group: 'volume', toBase: new Prisma.Decimal(1000), canonical: 'L', label: 'liter' },
  liters: { group: 'volume', toBase: new Prisma.Decimal(1000), canonical: 'L', label: 'liter' },
  litre: { group: 'volume', toBase: new Prisma.Decimal(1000), canonical: 'L', label: 'liter' },
  litres: { group: 'volume', toBase: new Prisma.Decimal(1000), canonical: 'L', label: 'liter' },
};

export function normalizeUnitKey(unit: string): string {
  return unit.trim().toLowerCase();
}

export function getUnitDefinition(unit: string): UnitDefinition | null {
  return DEFINITIONS[normalizeUnitKey(unit)] ?? null;
}

/** Kode baku untuk satuan berat/volume (termasuk alias lama). */
export function canonicalUnit(unit: string): UnitCode | null {
  return getUnitDefinition(unit)?.canonical ?? null;
}

/** Label ramah pengguna untuk kode/alias satuan. Teks bebas dikembalikan apa adanya. */
export function unitLabel(unit: string): string {
  return getUnitDefinition(unit)?.label ?? unit.trim();
}

/** Satuan di luar kode berat/volume diperlakukan sebagai Manual. */
export function isManualUnit(unit: string): boolean {
  return canonicalUnit(unit) === null;
}

export function isConvertibleUnit(unit: string): boolean {
  return !isManualUnit(unit);
}

/** Kelompok satuan: `manual` untuk semua teks bebas. */
export function unitGroupOf(unit: string): UnitGroup {
  if (isManualUnit(unit)) return 'manual';
  return getUnitDefinition(unit)!.group;
}

export function getUnitGroup(unit: string): UnitGroup {
  return unitGroupOf(unit);
}

export type UnitCodeOutcome =
  | { ok: true; code: UnitCode }
  | { ok: false; message: string };

/**
 * Memvalidasi dan menormalkan input satuan menjadi kode baku Berat/Volume.
 * Dipakai untuk resep dan input produksi. Satuan Manual tidak diterima di sini.
 */
export function parseUnitCode(value: unknown): UnitCodeOutcome {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, message: 'Satuan wajib diisi.' };
  }
  if (value.trim().length > 30) {
    return { ok: false, message: 'Satuan maksimal 30 karakter.' };
  }
  const code = canonicalUnit(value);
  if (!code) {
    return {
      ok: false,
      message: `Satuan "${value.trim()}" bukan satuan Berat/Volume. Pilih: ${UNIT_CODES.join(', ')}.`,
    };
  }
  return { ok: true, code };
}

export interface MaterialUnit {
  unit: string;
  unitKind: UnitGroup;
  isManual: boolean;
}

export type MaterialUnitOutcome =
  | { ok: true; value: MaterialUnit }
  | { ok: false; message: string };

/**
 * Memvalidasi satuan utama bahan baku.
 *
 * `unitKind = 'manual'` membuat satuan teks bebas; jika tidak diberikan,
 * hanya kode Berat/Volume yang diterima. Kode baku tidak boleh dipakai
 * sebagai teks Manual karena akan mengaburkan konversi otomatis.
 */
export function parseMaterialUnit(value: unknown, unitKind?: unknown): MaterialUnitOutcome {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, message: 'Satuan wajib diisi.' };
  }
  const unit = value.trim();
  if (unit.length > 30) {
    return { ok: false, message: 'Satuan maksimal 30 karakter.' };
  }

  const validKinds: UnitGroup[] = ['mass', 'volume', 'manual'];
  if (unitKind !== undefined && unitKind !== null && unitKind !== '' &&
      !validKinds.includes(unitKind as UnitGroup)) {
    return { ok: false, message: 'Jenis satuan tidak valid. Pilih Berat, Volume, atau Manual.' };
  }

  if (unitKind === 'manual') {
    if (!isManualUnit(unit)) {
      return {
        ok: false,
        message: `Satuan Manual tidak boleh memakai kode baku ${UNIT_CODES.join(', ')}. Ketik nama satuan sendiri.`,
      };
    }
    return { ok: true, value: { unit, unitKind: 'manual', isManual: true } };
  }

  const parsed = parseUnitCode(unit);
  if (!parsed.ok) {
    return {
      ok: false,
      message: `${parsed.message} Gunakan unitKind "manual" untuk satuan teks bebas.`,
    };
  }
  const group = getUnitDefinition(parsed.code)!.group;
  if (unitKind && unitKind !== group) {
    return {
      ok: false,
      message: `Satuan "${parsed.code}" termasuk kelompok ${UNIT_KIND_LABELS[group]}, bukan ${UNIT_KIND_LABELS[unitKind as UnitGroup]}.`,
    };
  }
  return { ok: true, value: { unit: parsed.code, unitKind: group, isManual: false } };
}

/**
 * Kompatibel bila keduanya berada dalam grup konversi berat/volume yang sama.
 * Dua satuan Manual hanya kompatibel bila teksnya persis sama; tetap tanpa
 * konversi.
 */
export function areUnitsCompatible(fromUnit: string, toUnit: string): boolean {
  const fromCode = canonicalUnit(fromUnit);
  const toCode = canonicalUnit(toUnit);
  if (!fromCode || !toCode) return fromUnit.trim() === toUnit.trim();
  return getUnitDefinition(fromCode)!.group === getUnitDefinition(toCode)!.group;
}

/** Konversi otomatis hanya untuk pasangan Berat/Volume dalam grup sama. */
export function isAutomaticConversion(fromUnit: string, toUnit: string): boolean {
  return !isManualUnit(fromUnit) && !isManualUnit(toUnit) && areUnitsCompatible(fromUnit, toUnit);
}

function countDecimalPlaces(value: Prisma.Decimal): number {
  const text = value.toFixed(); // tanpa notasi eksponen
  const dot = text.indexOf('.');
  if (dot === -1) return 0;
  return text.length - dot - 1;
}

/** Menghilangkan nol desimal di belakang untuk representasi stabil. */
export function trimDecimal(value: Prisma.Decimal): string {
  const fixed = value.toFixed();
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/\.?0+$/, '');
}

export interface ConversionResult {
  ok: true;
  /** Nilai dalam satuan tujuan, presisi desimal penuh hasil konversi. */
  value: Prisma.Decimal;
  /** Teks tanpa nol desimal berlebih (aman untuk Decimal/JSON). */
  valueText: string;
}

export interface ConversionError {
  ok: false;
  message: string;
}

export type ConvertOutcome = ConversionResult | ConversionError;

/** Menolak nilai non-positif atau hasil dengan lebih dari 3 angka desimal. */
function validateResult(value: Prisma.Decimal, toUnit: string): ConvertOutcome {
  if (value.lte(0)) {
    return { ok: false, message: 'Jumlah hasil konversi harus lebih besar dari nol.' };
  }

  const decimals = countDecimalPlaces(value);
  if (decimals > 3) {
    return {
      ok: false,
      message:
        `Hasil konversi ke satuan "${toUnit.trim()}" (${trimDecimal(value)}) memiliki lebih dari 3 angka desimal ` +
        'dan tidak dapat dicatat pada presisi stok. Sesuaikan jumlah atau satuan resep.',
    };
  }

  return { ok: true, value, valueText: trimDecimal(value) };
}

/**
 * Mengonversi jumlah dari `fromUnit` ke `toUnit`.
 * - Manual tidak pernah dikonversi otomatis.
 * - Lintas grup berat/volume ditolak.
 * - Hasil > 3 desimal ditolak (batas presisi stok), tanpa pembulatan yang
 *   menurunkan jumlah stok yang dibutuhkan.
 */
export function convertQuantity(amount: Prisma.Decimal, fromUnit: string, toUnit: string): ConvertOutcome {
  if (isManualUnit(fromUnit) || isManualUnit(toUnit)) {
    return {
      ok: false,
      message:
        `Satuan "${isManualUnit(fromUnit) ? fromUnit.trim() : toUnit.trim()}" adalah satuan Manual dan tidak dapat dikonversi otomatis. ` +
        'Lakukan penyesuaian stok eksplisit atau gunakan satuan yang sama persis.',
    };
  }

  const fromCode = canonicalUnit(fromUnit)!;
  const toCode = canonicalUnit(toUnit)!;

  let value: Prisma.Decimal;
  if (fromCode === toCode) {
    value = amount;
  } else {
    const fromDef = getUnitDefinition(fromUnit)!;
    const toDef = getUnitDefinition(toUnit)!;
    if (fromDef.group !== toDef.group) {
      return {
        ok: false,
        message:
          `Satuan "${fromUnit.trim()}" tidak kompatibel dengan satuan stok "${toUnit.trim()}". ` +
          'Konversi otomatis hanya didukung dalam kelompok berat (mg, g, kg) atau volume (ml, L).',
      };
    }
    const inBase = amount.mul(fromDef.toBase);
    value = inBase.div(toDef.toBase);
  }

  return validateResult(value, toUnit);
}

/**
 * Kebutuhan resep = jumlah per unit produk × jumlah produk yang dibuat.
 * Mengembalikan desimal presisi penuh; batas 3 desimal tetap diperiksa oleh
 * `convertQuantity`/`validateResult` sebelum stok disentuh.
 */
export function multiplyRecipeQuantity(
  quantityPerUnit: Prisma.Decimal,
  yieldQuantity: Prisma.Decimal
): ConvertOutcome {
  return validateResult(quantityPerUnit.mul(yieldQuantity), 'jumlah produksi');
}

/**
 * Memvalidasi satuan resep terhadap satuan stok bahan baku.
 * Mengembalikan null bila valid, atau pesan error Indonesia bila tidak.
 */
export function validateRecipeUnitCompatibility(recipeUnit: unknown, stockUnit: string): string | null {
  if (isManualUnit(stockUnit)) {
    return (
      `Bahan dengan satuan Manual "${stockUnit}" tidak dapat dipakai pada resep otomatis. ` +
      'Catat pemakaiannya secara manual saat produksi.'
    );
  }

  const parsed = parseUnitCode(recipeUnit);
  if (!parsed.ok) {
    return parsed.message.replace('Satuan wajib diisi.', 'Satuan resep wajib diisi.');
  }

  const stockCode = canonicalUnit(stockUnit)!;
  if (!areUnitsCompatible(parsed.code, stockCode)) {
    const options = compatibleRecipeUnits(stockCode).join(', ');
    return (
      `Satuan resep "${parsed.code}" tidak kompatibel dengan satuan stok "${stockCode}". ` +
      `Gunakan satuan dalam kelompok yang sama: ${options}.`
    );
  }
  return null;
}

/** Daftar kode satuan baku yang ditawarkan untuk resep berdasarkan satuan stok. */
export function compatibleRecipeUnits(stockUnit: string): string[] {
  const code = canonicalUnit(stockUnit);
  if (!code) return [];
  const group = getUnitDefinition(code)!.group;
  if (group === 'mass') return ['mg', 'g', 'kg'];
  return ['ml', 'L'];
}

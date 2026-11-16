import { Prisma } from '@prisma/client';

/**
 * Konversi satuan resep ↔ satuan stok bahan baku (README resep & konversi).
 *
 * - Mendukung massa (mg, gram/g, kg/kilogram) dan volume (ml, liter/l).
 * - Konversi hanya dalam kelompok yang sama; lintas kelompok ditolak.
 * - Perhitungan memakai aritmetika desimal presisi (Prisma.Decimal) agar
 *   stok tidak terpengaruh kesalahan pembulatan floating-point.
 */

export type UnitGroup = 'mass' | 'volume';

interface UnitDefinition {
  group: UnitGroup;
  /** Faktor ke satuan dasar kelompok (massa: mg, volume: ml). */
  toBase: Prisma.Decimal;
  /** Bentuk kanonik untuk ditampilkan/disimpan bila dinormalisasi. */
  canonical: string;
}

const DEFINITIONS: Record<string, UnitDefinition> = {
  mg: { group: 'mass', toBase: new Prisma.Decimal(1), canonical: 'mg' },
  g: { group: 'mass', toBase: new Prisma.Decimal(1000), canonical: 'gram' },
  gram: { group: 'mass', toBase: new Prisma.Decimal(1000), canonical: 'gram' },
  grams: { group: 'mass', toBase: new Prisma.Decimal(1000), canonical: 'gram' },
  kg: { group: 'mass', toBase: new Prisma.Decimal(1_000_000), canonical: 'kg' },
  kilogram: { group: 'mass', toBase: new Prisma.Decimal(1_000_000), canonical: 'kg' },
  kilograms: { group: 'mass', toBase: new Prisma.Decimal(1_000_000), canonical: 'kg' },

  ml: { group: 'volume', toBase: new Prisma.Decimal(1), canonical: 'ml' },
  milliliter: { group: 'volume', toBase: new Prisma.Decimal(1), canonical: 'ml' },
  milliliters: { group: 'volume', toBase: new Prisma.Decimal(1), canonical: 'ml' },
  l: { group: 'volume', toBase: new Prisma.Decimal(1000), canonical: 'liter' },
  liter: { group: 'volume', toBase: new Prisma.Decimal(1000), canonical: 'liter' },
  liters: { group: 'volume', toBase: new Prisma.Decimal(1000), canonical: 'liter' },
  litre: { group: 'volume', toBase: new Prisma.Decimal(1000), canonical: 'liter' },
  litres: { group: 'volume', toBase: new Prisma.Decimal(1000), canonical: 'liter' },
};

export function normalizeUnitKey(unit: string): string {
  return unit.trim().toLowerCase();
}

export function getUnitDefinition(unit: string): UnitDefinition | null {
  return DEFINITIONS[normalizeUnitKey(unit)] ?? null;
}

export function getUnitGroup(unit: string): UnitGroup | null {
  return getUnitDefinition(unit)?.group ?? null;
}

/**
 * Satuan dianggap kompatibel bila identik (setelah normalisasi spasi/kasus)
 * atau berada dalam kelompok konversi yang sama.
 */
export function areUnitsCompatible(fromUnit: string, toUnit: string): boolean {
  const fromKey = normalizeUnitKey(fromUnit);
  const toKey = normalizeUnitKey(toUnit);
  if (fromKey === toKey) return true;
  const fromDef = getUnitDefinition(fromUnit);
  const toDef = getUnitDefinition(toUnit);
  return Boolean(fromDef && toDef && fromDef.group === toDef.group);
}

function countDecimalPlaces(value: Prisma.Decimal): number {
  const text = value.toFixed(); // no exponent
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

/**
 * Mengonversi jumlah dari `fromUnit` ke `toUnit`.
 * - Gagal jika satuan tidak kompatibel / lintas kelompok.
 * - Gagal jika hasil pada satuan tujuan melebihi 3 angka desimal (batas
 *   presisi stok NutriLokal) atau terlalu kecil sehingga menjadi nol.
 */
export function convertQuantity(amount: Prisma.Decimal, fromUnit: string, toUnit: string): ConvertOutcome {
  const fromKey = normalizeUnitKey(fromUnit);
  const toKey = normalizeUnitKey(toUnit);

  let value: Prisma.Decimal;
  if (fromKey === toKey) {
    value = amount;
  } else {
    const fromDef = getUnitDefinition(fromUnit);
    const toDef = getUnitDefinition(toUnit);
    if (!fromDef || !toDef || fromDef.group !== toDef.group) {
      return {
        ok: false,
        message:
          `Satuan resep "${fromUnit.trim()}" tidak kompatibel dengan satuan stok "${toUnit.trim()}". ` +
          'Konversi otomatis hanya didukung dalam kelompok satuan yang sama (berat atau volume).',
      };
    }
    const inBase = amount.mul(fromDef.toBase);
    value = inBase.div(toDef.toBase);
  }

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
 * Memvalidasi satuan resep terhadap satuan stok bahan baku.
 * Mengembalikan null bila valid, atau pesan error Indonesia bila tidak.
 */
export function validateRecipeUnitCompatibility(recipeUnit: unknown, stockUnit: string): string | null {
  if (typeof recipeUnit !== 'string' || recipeUnit.trim() === '') {
    return 'Satuan resep wajib diisi.';
  }
  if (recipeUnit.trim().length > 30) {
    return 'Satuan resep maksimal 30 karakter.';
  }
  if (!areUnitsCompatible(recipeUnit, stockUnit)) {
    return (
      `Satuan resep "${recipeUnit.trim()}" tidak kompatibel dengan satuan stok bahan "${stockUnit}". ` +
      'Gunakan satuan dalam kelompok yang sama (mg, gram, kg) atau (ml, liter), atau satuan yang sama persis.'
    );
  }
  return null;
}

/** Daftar satuan yang ditawarkan untuk resep berdasarkan satuan stok bahan. */
export function compatibleRecipeUnits(stockUnit: string): string[] {
  const key = normalizeUnitKey(stockUnit);
  const def = getUnitDefinition(stockUnit);
  if (!def) {
    // Satuan kustom/tidak dikenal: hanya satuan yang sama persis yang aman.
    return [stockUnit.trim()];
  }
  if (def.group === 'mass') return ['mg', 'gram', 'kg'];
  return ['ml', 'liter'];
}

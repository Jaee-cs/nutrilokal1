/**
 * Utilitas satuan dan pratinjau konversi (frontend).
 *
 * Kode baku diselaraskan dengan backend (`backend/src/lib/unit-conversion.ts`):
 * Berat mg/g/kg dan Volume ml/L dapat dikonversi otomatis. Satuan Manual
 * adalah teks bebas pengguna dan tidak memiliki konversi. Backend tetap
 * sumber validasi dan perhitungan stok yang sah; fungsi di sini hanya untuk
 * dropdown, label, dan pratinjau agar pengguna bisa memeriksa.
 */

export type UnitGroup = 'mass' | 'volume' | 'manual'
export type StandardUnitGroup = Exclude<UnitGroup, 'manual'>

export const UNIT_GROUPS: { group: StandardUnitGroup; label: string; units: string[] }[] = [
  { group: 'mass', label: 'Berat', units: ['mg', 'g', 'kg'] },
  { group: 'volume', label: 'Volume', units: ['ml', 'L'] },
]

export const UNIT_KIND_LABELS: Record<UnitGroup, string> = {
  mass: 'Berat',
  volume: 'Volume',
  manual: 'Manual',
}

export const STANDARD_UNIT_CODES = ['mg', 'g', 'kg', 'ml', 'L']

export const UNIT_LABELS: Record<string, string> = {
  mg: 'mg',
  g: 'gram',
  kg: 'kg',
  ml: 'ml',
  L: 'liter',
}

interface UnitDefinition {
  group: StandardUnitGroup
  toBase: number
  canonical: string
}

// Alias lama tetap dikenal supaya data yang belum ternormalisasi bisa dibaca.
const DEFINITIONS: Record<string, UnitDefinition> = {
  mg: { group: 'mass', toBase: 1, canonical: 'mg' },
  g: { group: 'mass', toBase: 1000, canonical: 'g' },
  gram: { group: 'mass', toBase: 1000, canonical: 'g' },
  grams: { group: 'mass', toBase: 1000, canonical: 'g' },
  kg: { group: 'mass', toBase: 1_000_000, canonical: 'kg' },
  kilogram: { group: 'mass', toBase: 1_000_000, canonical: 'kg' },
  kilograms: { group: 'mass', toBase: 1_000_000, canonical: 'kg' },

  ml: { group: 'volume', toBase: 1, canonical: 'ml' },
  milliliter: { group: 'volume', toBase: 1, canonical: 'ml' },
  milliliters: { group: 'volume', toBase: 1, canonical: 'ml' },
  l: { group: 'volume', toBase: 1000, canonical: 'L' },
  liter: { group: 'volume', toBase: 1000, canonical: 'L' },
  liters: { group: 'volume', toBase: 1000, canonical: 'L' },
  litre: { group: 'volume', toBase: 1000, canonical: 'L' },
  litres: { group: 'volume', toBase: 1000, canonical: 'L' },
}

export function normalizeUnitKey(unit: string): string {
  return unit.trim().toLowerCase()
}

function getDefinition(unit: string): UnitDefinition | null {
  return DEFINITIONS[normalizeUnitKey(unit)] ?? null
}

export function canonicalUnit(unit: string): string | null {
  return getDefinition(unit)?.canonical ?? null
}

/** Satuan di luar Berat/Volume diperlakukan sebagai Manual. */
export function isManualUnit(unit: string): boolean {
  return canonicalUnit(unit) === null
}

export function unitKindOf(unit: string): UnitGroup {
  if (isManualUnit(unit)) return 'manual'
  return getDefinition(unit)!.group
}

export function unitLabel(unit: string): string {
  const code = canonicalUnit(unit)
  return (code && UNIT_LABELS[code]) || unit.trim()
}

/** Label dropdown lengkap, mis. "g — gram". */
export function unitOptionLabel(code: string): string {
  const label = UNIT_LABELS[code]
  return label && label !== code ? `${code} — ${label}` : code
}

export function areUnitsCompatible(fromUnit: string, toUnit: string): boolean {
  const fromDef = getDefinition(fromUnit)
  const toDef = getDefinition(toUnit)
  if (!fromDef || !toDef) return fromUnit.trim() === toUnit.trim()
  return fromDef.group === toDef.group
}

/** Hanya Berat/Volume dalam grup yang sama yang dikonversi otomatis. */
export function isAutomaticConversion(fromUnit: string, toUnit: string): boolean {
  return !isManualUnit(fromUnit) && !isManualUnit(toUnit) && areUnitsCompatible(fromUnit, toUnit)
}

/** Opsi resep: kosong untuk Manual karena bahan Manual tidak boleh di resep. */
export function compatibleRecipeUnits(stockUnit: string): string[] {
  const code = canonicalUnit(stockUnit)
  if (!code) return []
  const group = getDefinition(code)!.group
  if (group === 'mass') return ['mg', 'g', 'kg']
  return ['ml', 'L']
}

/** Opsi satuan resep. Alias lama tidak membuat opsi ganda. */
export function recipeUnitOptions(stockUnit: string, _currentUnit?: string): string[] {
  return compatibleRecipeUnits(stockUnit)
}

function trimZeros(text: string): string {
  if (!text.includes('.')) return text
  return text.replace(/\.?0+$/, '')
}

/** Format angka hingga 3 desimal tanpa nol berlebih. */
export function formatQty(value: number): string {
  if (!Number.isFinite(value)) return ''
  const fixed = value.toFixed(3)
  return trimZeros(fixed)
}

/** Mengalikan kebutuhan resep per unit dengan jumlah hasil produksi. */
export function multiplyRecipeQty(perUnit: number, yieldCount: number): string {
  if (!Number.isFinite(perUnit) || !Number.isFinite(yieldCount)) return ''
  return formatQty(perUnit * yieldCount)
}

/** Pratinjau konversi. Satuan Manual tidak pernah dikonversi otomatis. */
export function convertQuantityValue(amount: number, fromUnit: string, toUnit: string): number | null {
  if (!Number.isFinite(amount)) return null
  const fromCode = canonicalUnit(fromUnit)
  const toCode = canonicalUnit(toUnit)
  if (!fromCode || !toCode) return null
  if (fromCode === toCode) return amount
  const fromDef = getDefinition(fromCode)!
  const toDef = getDefinition(toCode)!
  if (fromDef.group !== toDef.group) return null
  return (amount * fromDef.toBase) / toDef.toBase
}

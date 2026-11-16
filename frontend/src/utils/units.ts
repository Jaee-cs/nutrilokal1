/**
 * Utilitas konversi satuan resep (frontend) — logika diselaraskan dengan
 * backend agar pratinjau perhitungan konsisten. Backend tetap sumber validasi.
 */

export type UnitGroup = 'mass' | 'volume'

interface UnitDefinition {
  group: UnitGroup
  toBase: number
}

const DEFINITIONS: Record<string, UnitDefinition> = {
  mg: { group: 'mass', toBase: 1 },
  g: { group: 'mass', toBase: 1000 },
  gram: { group: 'mass', toBase: 1000 },
  grams: { group: 'mass', toBase: 1000 },
  kg: { group: 'mass', toBase: 1_000_000 },
  kilogram: { group: 'mass', toBase: 1_000_000 },
  kilograms: { group: 'mass', toBase: 1_000_000 },

  ml: { group: 'volume', toBase: 1 },
  milliliter: { group: 'volume', toBase: 1 },
  milliliters: { group: 'volume', toBase: 1 },
  l: { group: 'volume', toBase: 1000 },
  liter: { group: 'volume', toBase: 1000 },
  liters: { group: 'volume', toBase: 1000 },
  litre: { group: 'volume', toBase: 1000 },
  litres: { group: 'volume', toBase: 1000 },
}

export function normalizeUnitKey(unit: string): string {
  return unit.trim().toLowerCase()
}

function getDefinition(unit: string): UnitDefinition | null {
  return DEFINITIONS[normalizeUnitKey(unit)] ?? null
}

export function areUnitsCompatible(fromUnit: string, toUnit: string): boolean {
  const fromKey = normalizeUnitKey(fromUnit)
  const toKey = normalizeUnitKey(toUnit)
  if (fromKey === toKey) return true
  const fromDef = getDefinition(fromUnit)
  const toDef = getDefinition(toUnit)
  return Boolean(fromDef && toDef && fromDef.group === toDef.group)
}

export function compatibleRecipeUnits(stockUnit: string): string[] {
  const def = getDefinition(stockUnit)
  if (!def) return [stockUnit.trim()]
  if (def.group === 'mass') return ['mg', 'gram', 'kg']
  return ['ml', 'liter']
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

export function convertQuantityValue(amount: number, fromUnit: string, toUnit: string): number | null {
  if (!Number.isFinite(amount)) return null
  const fromKey = normalizeUnitKey(fromUnit)
  const toKey = normalizeUnitKey(toUnit)
  if (fromKey === toKey) return amount
  const fromDef = getDefinition(fromUnit)
  const toDef = getDefinition(toUnit)
  if (!fromDef || !toDef || fromDef.group !== toDef.group) return null
  return (amount * fromDef.toBase) / toDef.toBase
}

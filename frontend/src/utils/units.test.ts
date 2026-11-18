import { describe, expect, it } from 'vitest'
import {
  areUnitsCompatible,
  canonicalUnit,
  compatibleRecipeUnits,
  convertQuantityValue,
  isAutomaticConversion,
  isManualUnit,
  recipeUnitOptions,
  unitKindOf,
  unitLabel,
  UNIT_GROUPS,
  UNIT_KIND_LABELS,
} from './units'

describe('utilitas satuan baku', () => {
  it('menyediakan Berat dan Volume sebagai satu-satunya opsi baku', () => {
    expect(UNIT_GROUPS.map((g) => g.label)).toEqual(['Berat', 'Volume'])
    expect(UNIT_GROUPS[0].units).toEqual(['mg', 'g', 'kg'])
    expect(UNIT_GROUPS[1].units).toEqual(['ml', 'L'])
    expect(UNIT_KIND_LABELS.manual).toBe('Manual')
    expect(unitLabel('g')).toBe('gram')
    expect(unitLabel('L')).toBe('liter')
  })

  it('hanya menganggap satuan satu kelompok sebagai kompatibel', () => {
    expect(areUnitsCompatible('g', 'kg')).toBe(true)
    expect(areUnitsCompatible('ml', 'L')).toBe(true)
    expect(areUnitsCompatible('g', 'ml')).toBe(false)
    expect(areUnitsCompatible('pcs', 'pcs')).toBe(true)
    expect(areUnitsCompatible('pcs', 'kg')).toBe(false)
  })

  it('satuan Manual tidak dikonversi otomatis', () => {
    expect(isManualUnit('pcs')).toBe(true)
    expect(isManualUnit('bungkus')).toBe(true)
    expect(isManualUnit('kg')).toBe(false)
    expect(unitKindOf('sachet')).toBe('manual')
    expect(areUnitsCompatible('pcs', 'butir')).toBe(false)
    expect(areUnitsCompatible('sachet', 'g')).toBe(false)
    expect(convertQuantityValue(2, 'bungkus', 'pcs')).toBeNull()
    expect(convertQuantityValue(2, 'pcs', 'pcs')).toBeNull()
    expect(isAutomaticConversion('pcs', 'pcs')).toBe(false)
  })

  it('tidak menawarkan resep untuk bahan Manual', () => {
    expect(compatibleRecipeUnits('kg')).toEqual(['mg', 'g', 'kg'])
    expect(compatibleRecipeUnits('L')).toEqual(['ml', 'L'])
    expect(compatibleRecipeUnits('sachet')).toEqual([])
    expect(recipeUnitOptions('pcs', 'pcs')).toEqual([])
  })

  it('menormalkan alias lama tanpa membuat opsi ganda', () => {
    expect(canonicalUnit('gram')).toBe('g')
    expect(canonicalUnit('liter')).toBe('L')
    expect(recipeUnitOptions('kg', 'g')).toEqual(['mg', 'g', 'kg'])
    expect(recipeUnitOptions('kg', 'gram')).toEqual(['mg', 'g', 'kg'])
    expect(recipeUnitOptions('L', 'ml')).toEqual(['ml', 'L'])
    expect(recipeUnitOptions('kg', 'ml')).toEqual(['mg', 'g', 'kg'])
  })

  it('mengonversi berat dan volume dalam kelompok yang sama', () => {
    expect(convertQuantityValue(1.5, 'kg', 'g')).toBe(1500)
    expect(convertQuantityValue(250, 'ml', 'L')).toBe(0.25)
    expect(convertQuantityValue(500, 'mg', 'g')).toBe(0.5)
    expect(convertQuantityValue(1, 'kg', 'ml')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  areUnitsCompatible,
  compatibleRecipeUnits,
  convertQuantityValue,
  recipeUnitOptions,
} from './units'

describe('utilitas satuan resep', () => {
  it('hanya menganggap satuan satu kelompok sebagai kompatibel', () => {
    expect(areUnitsCompatible('gram', 'kg')).toBe(true)
    expect(areUnitsCompatible('ml', 'liter')).toBe(true)
    expect(areUnitsCompatible('gram', 'ml')).toBe(false)
    expect(areUnitsCompatible('pcs', 'pcs')).toBe(true)
    expect(areUnitsCompatible('pcs', 'kg')).toBe(false)
  })

  it('menawarkan satuan sesuai kelompok satuan stok', () => {
    expect(compatibleRecipeUnits('kg')).toEqual(['mg', 'gram', 'kg'])
    expect(compatibleRecipeUnits('liter')).toEqual(['ml', 'liter'])
    expect(compatibleRecipeUnits('pcs')).toEqual(['pcs'])
  })

  it('mempertahankan satuan lama yang masih kompatibel agar tidak tampil kosong', () => {
    expect(recipeUnitOptions('kg', 'g')).toEqual(['g', 'mg', 'gram', 'kg'])
    expect(recipeUnitOptions('kg', 'gram')).toEqual(['mg', 'gram', 'kg'])
    expect(recipeUnitOptions('liter', 'ml')).toEqual(['ml', 'liter'])
    // Satuan lama yang tidak kompatibel tidak dipaksakan.
    expect(recipeUnitOptions('kg', 'ml')).toEqual(['mg', 'gram', 'kg'])
    expect(recipeUnitOptions('pcs', 'pcs')).toEqual(['pcs'])
  })

  it('mengonversi jumlah dalam kelompok yang sama dan menolak lintas kelompok', () => {
    expect(convertQuantityValue(1.5, 'kg', 'gram')).toBe(1500)
    expect(convertQuantityValue(250, 'ml', 'liter')).toBe(0.25)
    expect(convertQuantityValue(1, 'kg', 'ml')).toBeNull()
  })
})

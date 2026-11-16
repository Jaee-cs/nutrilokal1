import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  areUnitsCompatible,
  compatibleRecipeUnits,
  convertQuantity,
  trimDecimal,
  validateRecipeUnitCompatibility,
} from './lib/unit-conversion';

function dec(value: string | number) {
  return new Prisma.Decimal(value);
}

describe('unit-conversion', () => {
  it('mengonversi gram ke kg (contoh README)', () => {
    const result = convertQuantity(dec('200'), 'gram', 'kg');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valueText).toBe('0.2');
      expect(trimDecimal(dec('1.800'))).toBe('1.8');
    }
  });

  it('mengonversi kg ke gram dan ml ke liter', () => {
    const mass = convertQuantity(dec('1.5'), 'kg', 'gram');
    expect(mass.ok && mass.valueText).toBe('1500');

    const vol = convertQuantity(dec(250), 'ml', 'liter');
    expect(vol.ok && vol.valueText).toBe('0.25');

    const back = convertQuantity(dec('0.5'), 'liter', 'ml');
    expect(back.ok && back.valueText).toBe('500');
  });

  it('mendukung mg dalam kelompok berat', () => {
    const result = convertQuantity(dec(500), 'mg', 'gram');
    expect(result.ok && result.valueText).toBe('0.5');
  });

  it('menganggap satuan identik (case-insensitive) kompatibel tanpa konversi', () => {
    expect(areUnitsCompatible('PCS', 'pcs')).toBe(true);
    expect(areUnitsCompatible('Kg', 'KG')).toBe(true);
    const result = convertQuantity(dec('2.5'), 'pcs', 'PCS');
    expect(result.ok && result.valueText).toBe('2.5');
  });

  it('menolak konversi lintas kelompok (berat ke volume) dan satuan tidak dikenal', () => {
    expect(areUnitsCompatible('gram', 'ml')).toBe(false);
    expect(convertQuantity(dec(100), 'gram', 'ml').ok).toBe(false);
    expect(areUnitsCompatible('gram', 'pcs')).toBe(false);
    expect(validateRecipeUnitCompatibility('ml', 'kg')).toContain('tidak kompatibel');
  });

  it('menolak hasil konversi yang melampaui presisi 3 desimal stok', () => {
    // 1 mg -> kg = 0.000001 kg (6 desimal) tidak muat di presisi stok 3 desimal
    const result = convertQuantity(dec(1), 'mg', 'kg');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('3 angka desimal');
    }
  });

  it('memberi opsi satuan resep yang kompatibel', () => {
    expect(compatibleRecipeUnits('kg')).toEqual(['mg', 'gram', 'kg']);
    expect(compatibleRecipeUnits('liter')).toEqual(['ml', 'liter']);
    expect(compatibleRecipeUnits('pcs')).toEqual(['pcs']);
  });
});

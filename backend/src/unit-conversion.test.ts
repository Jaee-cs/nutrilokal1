import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  areUnitsCompatible,
  canonicalUnit,
  compatibleRecipeUnits,
  convertQuantity,
  isAutomaticConversion,
  isManualUnit,
  multiplyRecipeQuantity,
  parseMaterialUnit,
  parseUnitCode,
  trimDecimal,
  validateRecipeUnitCompatibility,
} from './lib/unit-conversion';

function dec(value: string | number) {
  return new Prisma.Decimal(value);
}

describe('unit-conversion — konversi berat', () => {
  it('mengonversi g ke kg (contoh README) dan sebaliknya', () => {
    const result = convertQuantity(dec('200'), 'g', 'kg');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.valueText).toBe('0.2');
      expect(trimDecimal(dec('1.800'))).toBe('1.8');
    }

    expect(convertQuantity(dec('1.5'), 'kg', 'g').ok && convertQuantity(dec('1.5'), 'kg', 'g').valueText).toBe('1500');
    expect(convertQuantity(dec(1), 'kg', 'mg').ok && convertQuantity(dec(1), 'kg', 'mg').valueText).toBe('1000000');
  });

  it('mendukung mg dan satuan identik tanpa konversi', () => {
    expect(convertQuantity(dec(500), 'mg', 'g').ok && convertQuantity(dec(500), 'mg', 'g').valueText).toBe('0.5');
    expect(areUnitsCompatible('Kg', 'KG')).toBe(true);
    const result = convertQuantity(dec('2.5'), 'g', 'g');
    expect(result.ok && result.valueText).toBe('2.5');
  });
});

describe('unit-conversion — konversi volume', () => {
  it('mengonversi ml ke L dan sebaliknya', () => {
    expect(convertQuantity(dec(250), 'ml', 'L').ok && convertQuantity(dec(250), 'ml', 'L').valueText).toBe('0.25');
    expect(convertQuantity(dec('0.5'), 'L', 'ml').ok && convertQuantity(dec('0.5'), 'L', 'ml').valueText).toBe('500');
  });
});

describe('unit-conversion — satuan Manual', () => {
  it('menerima teks bebas hanya bila unitKind manual', () => {
    expect(parseMaterialUnit('box').ok).toBe(false);
    const manual = parseMaterialUnit('kemasan khusus', 'manual');
    expect(manual.ok).toBe(true);
    if (manual.ok) {
      expect(manual.value.unit).toBe('kemasan khusus');
      expect(manual.value.isManual).toBe(true);
    }
    expect(parseMaterialUnit('g', 'manual').ok).toBe(false);
    expect(isManualUnit('pcs')).toBe(true);
    expect(isManualUnit('kg')).toBe(false);
  });

  it('tidak mengonversi dan tidak memakai Manual pada resep otomatis', () => {
    expect(areUnitsCompatible('pcs', 'butir')).toBe(false);
    expect(areUnitsCompatible(' pcs ', 'pcs')).toBe(true);
    expect(convertQuantity(dec(2), 'bungkus', 'pcs').ok).toBe(false);
    expect(convertQuantity(dec(2), 'pcs', 'pcs').ok).toBe(false);
    expect(validateRecipeUnitCompatibility('g', 'pcs')).toContain('Manual');
    expect(compatibleRecipeUnits('sachet')).toEqual([]);
    expect(compatibleRecipeUnits('kaleng')).toEqual([]);
  });

  it('membatasi konversi otomatis ke pasangan Berat/Volume yang sama', () => {
    expect(isAutomaticConversion('g', 'kg')).toBe(true);
    expect(isAutomaticConversion('ml', 'L')).toBe(true);
    expect(isAutomaticConversion('g', 'ml')).toBe(false);
    expect(isAutomaticConversion('pcs', 'pcs')).toBe(false);
  });
});

describe('unit-conversion — validasi dan kompatibilitas data lama', () => {
  it('menolak konversi lintas kelompok dan satuan tidak dikenal', () => {
    expect(areUnitsCompatible('g', 'ml')).toBe(false);
    expect(convertQuantity(dec(100), 'g', 'ml').ok).toBe(false);
    expect(areUnitsCompatible('g', 'pcs')).toBe(false);
    expect(validateRecipeUnitCompatibility('ml', 'kg')).toContain('tidak kompatibel');
    expect(parseUnitCode('box').ok).toBe(false);
  });

  it('menerima alias lama saat membaca data dan menormalkannya ke kode baku', () => {
    expect(canonicalUnit('gram')).toBe('g');
    expect(canonicalUnit('liter')).toBe('L');
    expect(canonicalUnit('KG')).toBe('kg');
    expect(parseUnitCode(' gram ')).toEqual({ ok: true, code: 'g' });
    expect(convertQuantity(dec('200'), 'gram', 'kg').ok && convertQuantity(dec('200'), 'gram', 'kg').valueText).toBe('0.2');
    expect(compatibleRecipeUnits('g')).toEqual(['mg', 'g', 'kg']);
    expect(compatibleRecipeUnits('L')).toEqual(['ml', 'L']);
  });

  it('menolak hasil konversi yang melampaui presisi 3 desimal stok', () => {
    // 1 mg -> kg = 0.000001 kg (6 desimal) tidak muat di presisi stok 3 desimal.
    const result = convertQuantity(dec(1), 'mg', 'kg');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('3 angka desimal');
  });

  it('mengalikan resep × hasil produksi dengan presisi desimal', () => {
    const needed = multiplyRecipeQuantity(dec('0.5'), dec(3));
    expect(needed.ok && needed.valueText).toBe('1.5');
    const tooPrecise = multiplyRecipeQuantity(dec('0.0005'), dec(3));
    expect(tooPrecise.ok).toBe(false);
  });
});

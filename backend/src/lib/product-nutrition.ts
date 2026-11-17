/**
 * Informasi nilai gizi produk (opsional, dikelola Admin).
 *
 * Nilai disimpan sebagai bagian dari data produk dan ditampilkan apa adanya:
 * - field/komponen kosong tidak disimpan dan tidak dianggap nol,
 * - %AKG hanya disimpan/ditampilkan bila diisi Admin (tidak dikarang/dihitung),
 * - komponen tanpa nilai apa pun disembunyikan dari data publik.
 *
 * Bentuk bersifat toleran agar produk lama tanpa data tetap berfungsi.
 */

export interface ProductNutritionComponent {
  /** Nama komponen/zat gizi (mis. "Energi Total", "Vitamin C"). */
  name: string;
  /** Jumlah kandungan; hanya bila diisi (bukan nol buatan). */
  amount?: number;
  /** Satuan jumlah (mis. g, mg, kkal). */
  unit?: string;
  /** Persentase AKG; hanya bila diisi (bukan nol buatan). */
  akgPercent?: number;
}

export interface ProductNutrition {
  /** Takaran saji (angka) bila diisi. */
  servingSizeAmount?: number;
  /** Satuan takaran saji (mis. g, ml, sajian). */
  servingSizeUnit?: string;
  /** Jumlah sajian per kemasan bila diisi. */
  servingsPerPackage?: number;
  /** Daftar komponen gizi yang memiliki nilai. */
  components?: ProductNutritionComponent[];
}

export type NutritionParseResult =
  | { ok: true; value: ProductNutrition | null }
  | { ok: false; message: string };

const MAX_COMPONENTS = 50;
const MAX_NAME = 100;
const MAX_UNIT = 30;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function parseOptionalNumber(
  value: unknown,
  label: string,
  options: { min: number; maxDecimals: number; max: number },
): { ok: true; value: number | undefined } | { ok: false; message: string } {
  if (isBlank(value)) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, message: `${label} harus berupa angka.` };
  }
  if (value < options.min) {
    return { ok: false, message: `${label} tidak boleh kurang dari ${options.min}.` };
  }
  if (value >= options.max) {
    return { ok: false, message: `${label} terlalu besar.` };
  }
  const asText = String(value);
  if (asText.includes('e')) {
    return { ok: false, message: `${label} tidak valid.` };
  }
  const [, decimals] = asText.split('.');
  if (decimals && decimals.length > options.maxDecimals) {
    return {
      ok: false,
      message: `${label} maksimal ${options.maxDecimals} angka di belakang koma.`,
    };
  }
  return { ok: true, value };
}

/**
 * Memvalidasi dan menormalkan input nilai gizi dari Admin.
 * - undefined = tidak diubah oleh pemanggil (ditangani terpisah di route).
 * - null atau objek kosong = hapus/kosongkan informasi nilai gizi.
 * - objek terisi = simpan hanya field/komponen yang benar-benar berisi nilai.
 */
export function parseNutritionInput(value: unknown): NutritionParseResult {
  if (value === null) return { ok: true, value: null };
  if (!isPlainObject(value)) {
    return { ok: false, message: 'Informasi nilai gizi harus berupa objek atau null.' };
  }

  const servingAmount = parseOptionalNumber(value.servingSizeAmount, 'Takaran saji', {
    min: 0,
    maxDecimals: 3,
    max: 1e9,
  });
  if (!servingAmount.ok) return servingAmount;

  const servingUnit = normalizeText(value.servingSizeUnit, MAX_UNIT);

  const servingsPerPackage = parseOptionalNumber(
    value.servingsPerPackage,
    'Jumlah sajian per kemasan',
    { min: 0, maxDecimals: 3, max: 1e9 },
  );
  if (!servingsPerPackage.ok) return servingsPerPackage;

  const rawComponents = value.components;
  let components: ProductNutritionComponent[] | undefined;
  if (rawComponents !== undefined) {
    if (!Array.isArray(rawComponents)) {
      return { ok: false, message: 'Daftar kandungan gizi harus berupa array.' };
    }
    if (rawComponents.length > MAX_COMPONENTS) {
      return { ok: false, message: `Daftar kandungan gizi maksimal ${MAX_COMPONENTS} komponen.` };
    }

    const parsed: ProductNutritionComponent[] = [];
    for (let i = 0; i < rawComponents.length; i++) {
      const raw = rawComponents[i];
      if (!isPlainObject(raw)) {
        return { ok: false, message: `Komponen gizi baris ${i + 1} harus berupa objek.` };
      }
      const name = normalizeText(raw.name, MAX_NAME);
      const amount = parseOptionalNumber(raw.amount, `Jumlah komponen gizi baris ${i + 1}`, {
        min: 0,
        maxDecimals: 3,
        max: 1e9,
      });
      if (!amount.ok) return amount;
      const unit = normalizeText(raw.unit, MAX_UNIT);
      const akg = parseOptionalNumber(raw.akgPercent, `%AKG komponen gizi baris ${i + 1}`, {
        min: 0,
        maxDecimals: 2,
        max: 10000,
      });
      if (!akg.ok) return akg;

      const hasValue = amount.value !== undefined || !!unit || akg.value !== undefined;
      const hasAnyInput = !!name || hasValue;
      if (!hasAnyInput) continue; // baris kosong diabaikan
      if (!name) {
        return { ok: false, message: `Nama komponen gizi baris ${i + 1} wajib diisi.` };
      }
      // Komponen tanpa jumlah/satuan/%AKG tidak memiliki nilai gizi bermakna.
      if (!hasValue) continue;

      const component: ProductNutritionComponent = { name };
      if (amount.value !== undefined) component.amount = amount.value;
      if (unit) component.unit = unit;
      if (akg.value !== undefined) component.akgPercent = akg.value;
      parsed.push(component);
    }
    components = parsed.length > 0 ? parsed : undefined;
  }

  const result: ProductNutrition = {};
  if (servingAmount.value !== undefined) result.servingSizeAmount = servingAmount.value;
  if (servingUnit) result.servingSizeUnit = servingUnit;
  if (servingsPerPackage.value !== undefined) result.servingsPerPackage = servingsPerPackage.value;
  if (components) result.components = components;

  const hasData =
    result.servingSizeAmount !== undefined ||
    !!result.servingSizeUnit ||
    result.servingsPerPackage !== undefined ||
    (result.components?.length ?? 0) > 0;

  return { ok: true, value: hasData ? result : null };
}

/** Menormalkan data nutrisi dari database untuk respons internal Admin/Operator. */
export function toPublicProductNutrition(value: unknown): ProductNutrition | null {
  const parsed = parseNutritionInput(value);
  if (!parsed.ok) return null;
  return parsed.value;
}

/**
 * Data nutrisi untuk halaman publik/QR: hanya field dan komponen yang memiliki
 * nilai nyata. Komponen tanpa nama/jumlah/satuan/%AKG bermakna disaring.
 * Mengembalikan null bila tidak ada informasi yang layak ditampilkan.
 */
export function toPublicNutritionView(value: unknown): ProductNutrition | null {
  const nutrition = toPublicProductNutrition(value);
  if (!nutrition) return null;

  const components = (nutrition.components ?? []).filter(
    (c) => c.amount !== undefined || !!c.unit || c.akgPercent !== undefined,
  );
  const view: ProductNutrition = {};
  if (nutrition.servingSizeAmount !== undefined) view.servingSizeAmount = nutrition.servingSizeAmount;
  if (nutrition.servingSizeUnit) view.servingSizeUnit = nutrition.servingSizeUnit;
  if (nutrition.servingsPerPackage !== undefined) view.servingsPerPackage = nutrition.servingsPerPackage;
  if (components.length > 0) view.components = components;

  const hasData =
    view.servingSizeAmount !== undefined ||
    !!view.servingSizeUnit ||
    view.servingsPerPackage !== undefined ||
    (view.components?.length ?? 0) > 0;
  return hasData ? view : null;
}

export function hasNutritionContent(value: ProductNutrition | null | undefined): boolean {
  if (!value) return false;
  return (
    value.servingSizeAmount !== undefined ||
    !!value.servingSizeUnit ||
    value.servingsPerPackage !== undefined ||
    (value.components?.length ?? 0) > 0
  );
}

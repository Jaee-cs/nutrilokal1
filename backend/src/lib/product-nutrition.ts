/**
 * Informasi nilai gizi produk (opsional, dikelola Admin).
 *
 * Nilai disimpan sebagai bagian dari data produk dan ditampilkan apa adanya:
 * - field/komponen kosong tidak disimpan dan tidak dianggap nol,
 * - %AKG hanya disimpan/ditampilkan bila diisi Admin (tidak dikarang/dihitung),
 * - komponen tanpa nilai apa pun disembunyikan dari data publik.
 *
 * Produk lama memakai field takaran saji + `components` (baris kandungan gizi)
 * langsung di root. Produk dengan beberapa komponen kemasan memakai `sections`,
 * yaitu array berurutan; tiap section memiliki takaran saji dan tabel gizinya
 * sendiri. Satu section tanpa nama selalu dinormalkan kembali ke bentuk lama,
 * sehingga data lama tetap terbaca tanpa diinput ulang.
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

/** Satu komponen kemasan dengan tabel nilai gizinya sendiri. */
export interface ProductNutritionSection {
  /** Nama komponen kemasan; wajib hanya bila ada lebih dari satu section. */
  name?: string;
  /** Takaran saji (angka) bila diisi. */
  servingSizeAmount?: number;
  /** Satuan takaran saji (mis. g, ml, sajian). */
  servingSizeUnit?: string;
  /** Jumlah sajian per kemasan bila diisi. */
  servingsPerPackage?: number;
  /** Baris kandungan gizi pada komponen ini. */
  components?: ProductNutritionComponent[];
}

export interface ProductNutrition {
  /** Takaran saji (angka) bila diisi. Dipakai produk lama/satu komponen. */
  servingSizeAmount?: number;
  /** Satuan takaran saji (mis. g, ml, sajian). */
  servingSizeUnit?: string;
  /** Jumlah sajian per kemasan bila diisi. */
  servingsPerPackage?: number;
  /** Daftar komponen gizi yang memiliki nilai. */
  components?: ProductNutritionComponent[];
  /** Komponen kemasan, urut sesuai input. Hanya untuk produk multi-komponen. */
  sections?: ProductNutritionSection[];
}

export type NutritionParseResult =
  | { ok: true; value: ProductNutrition | null }
  | { ok: false; message: string };

const MAX_COMPONENTS = 50;
const MAX_SECTIONS = 20;
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

interface ParsedBlock {
  name?: string;
  servingSizeAmount?: number;
  servingSizeUnit?: string;
  servingsPerPackage?: number;
  components?: ProductNutritionComponent[];
}

function blockHasData(block: ParsedBlock): boolean {
  return (
    block.servingSizeAmount !== undefined ||
    !!block.servingSizeUnit ||
    block.servingsPerPackage !== undefined ||
    (block.components?.length ?? 0) > 0
  );
}

type BlockParseResult =
  | { ok: true; value: ParsedBlock | null }
  | { ok: false; message: string };

/**
 * Memvalidasi satu blok nilai gizi (root lama atau satu `sections` item).
 * `prefix` hanya diisi untuk section agar pesan kesalahan menyebut nomornya.
 */
function parseBlock(
  raw: Record<string, unknown>,
  options: { prefix: string; readName: boolean },
): BlockParseResult {
  const name = options.readName ? normalizeText(raw.name, MAX_NAME) : null;

  const servingAmount = parseOptionalNumber(raw.servingSizeAmount, `${options.prefix}Takaran saji`, {
    min: 0,
    maxDecimals: 3,
    max: 1e9,
  });
  if (!servingAmount.ok) return servingAmount;

  const servingUnit = normalizeText(raw.servingSizeUnit, MAX_UNIT);

  const servingsPerPackage = parseOptionalNumber(
    raw.servingsPerPackage,
    `${options.prefix}Jumlah sajian per kemasan`,
    { min: 0, maxDecimals: 3, max: 1e9 },
  );
  if (!servingsPerPackage.ok) return servingsPerPackage;

  const rawComponents = raw.components;
  let components: ProductNutritionComponent[] | undefined;
  if (rawComponents !== undefined) {
    if (!Array.isArray(rawComponents)) {
      return { ok: false, message: `${options.prefix}Daftar kandungan gizi harus berupa array.` };
    }
    if (rawComponents.length > MAX_COMPONENTS) {
      return {
        ok: false,
        message: `${options.prefix}Daftar kandungan gizi maksimal ${MAX_COMPONENTS} komponen.`,
      };
    }

    const parsed: ProductNutritionComponent[] = [];
    for (let i = 0; i < rawComponents.length; i++) {
      const row = rawComponents[i];
      if (!isPlainObject(row)) {
        return {
          ok: false,
          message: `${options.prefix}Komponen gizi baris ${i + 1} harus berupa objek.`,
        };
      }
      const rowName = normalizeText(row.name, MAX_NAME);
      const amount = parseOptionalNumber(
        row.amount,
        `${options.prefix}Jumlah komponen gizi baris ${i + 1}`,
        { min: 0, maxDecimals: 3, max: 1e9 },
      );
      if (!amount.ok) return amount;
      const unit = normalizeText(row.unit, MAX_UNIT);
      const akg = parseOptionalNumber(
        row.akgPercent,
        `${options.prefix}%AKG komponen gizi baris ${i + 1}`,
        { min: 0, maxDecimals: 2, max: 10000 },
      );
      if (!akg.ok) return akg;

      const hasValue = amount.value !== undefined || !!unit || akg.value !== undefined;
      const hasAnyInput = !!rowName || hasValue;
      if (!hasAnyInput) continue; // baris kosong diabaikan
      if (!rowName) {
        return {
          ok: false,
          message: `${options.prefix}Nama komponen gizi baris ${i + 1} wajib diisi.`,
        };
      }
      // Komponen tanpa jumlah/satuan/%AKG tidak memiliki nilai gizi bermakna.
      if (!hasValue) continue;

      const component: ProductNutritionComponent = { name: rowName };
      if (amount.value !== undefined) component.amount = amount.value;
      if (unit) component.unit = unit;
      if (akg.value !== undefined) component.akgPercent = akg.value;
      parsed.push(component);
    }
    components = parsed.length > 0 ? parsed : undefined;
  }

  const block: ParsedBlock = {};
  if (name) block.name = name;
  if (servingAmount.value !== undefined) block.servingSizeAmount = servingAmount.value;
  if (servingUnit) block.servingSizeUnit = servingUnit;
  if (servingsPerPackage.value !== undefined) block.servingsPerPackage = servingsPerPackage.value;
  if (components) block.components = components;

  return { ok: true, value: blockHasData(block) ? block : null };
}

function blockToNutrition(block: ParsedBlock): ProductNutrition | null {
  const result: ProductNutrition = {};
  if (block.servingSizeAmount !== undefined) result.servingSizeAmount = block.servingSizeAmount;
  if (block.servingSizeUnit) result.servingSizeUnit = block.servingSizeUnit;
  if (block.servingsPerPackage !== undefined) {
    result.servingsPerPackage = block.servingsPerPackage;
  }
  if (block.components) result.components = block.components;
  return blockHasData(block) ? result : null;
}

function blockToSection(block: ParsedBlock): ProductNutritionSection {
  const section: ProductNutritionSection = {};
  if (block.name) section.name = block.name;
  if (block.servingSizeAmount !== undefined) section.servingSizeAmount = block.servingSizeAmount;
  if (block.servingSizeUnit) section.servingSizeUnit = block.servingSizeUnit;
  if (block.servingsPerPackage !== undefined) {
    section.servingsPerPackage = block.servingsPerPackage;
  }
  if (block.components) section.components = block.components;
  return section;
}

/**
 * Memvalidasi dan menormalkan input nilai gizi dari Admin.
 * - undefined = tidak diubah oleh pemanggil (ditangani terpisah di route).
 * - null atau objek kosong = hapus/kosongkan informasi nilai gizi.
 * - objek terisi = simpan hanya field/komponen yang benar-benar berisi nilai.
 * - `sections` = komponen kemasan multi-table; urutan array dipertahankan.
 */
export function parseNutritionInput(value: unknown): NutritionParseResult {
  if (value === null) return { ok: true, value: null };
  if (!isPlainObject(value)) {
    return { ok: false, message: 'Informasi nilai gizi harus berupa objek atau null.' };
  }

  const rawSections = value.sections;
  if (rawSections !== undefined && !Array.isArray(rawSections)) {
    return { ok: false, message: 'Daftar komponen kemasan harus berupa array.' };
  }

  if (Array.isArray(rawSections) && rawSections.length > 0) {
    if (rawSections.length > MAX_SECTIONS) {
      return { ok: false, message: `Komponen kemasan maksimal ${MAX_SECTIONS} komponen.` };
    }

    const candidates: Array<{ position: number; block: ParsedBlock }> = [];
    for (let i = 0; i < rawSections.length; i++) {
      const raw = rawSections[i];
      if (!isPlainObject(raw)) {
        return { ok: false, message: `Komponen kemasan ${i + 1} harus berupa objek.` };
      }
      const parsed = parseBlock(raw, {
        prefix: `Komponen kemasan ${i + 1}: `,
        readName: true,
      });
      if (!parsed.ok) return parsed;
      if (!parsed.value) continue; // komponen kosong tidak disimpan/ditampilkan
      candidates.push({ position: i + 1, block: parsed.value });
    }

    if (candidates.length > 1) {
      for (const candidate of candidates) {
        if (!candidate.block.name) {
          return {
            ok: false,
            message: `Nama komponen kemasan ${candidate.position} wajib diisi.`,
          };
        }
      }
      return {
        ok: true,
        value: { sections: candidates.map((candidate) => blockToSection(candidate.block)) },
      };
    }

    // Satu komponen: bentuknya samakan dengan data lama (tanpa nama/sections).
    if (candidates.length === 1) return { ok: true, value: blockToNutrition(candidates[0].block) };
    return { ok: true, value: null };
  }

  const parsedRoot = parseBlock(value, { prefix: '', readName: false });
  if (!parsedRoot.ok) return parsedRoot;
  return { ok: true, value: parsedRoot.value ? blockToNutrition(parsedRoot.value) : null };
}

/** Menormalkan data nutrisi dari database untuk respons internal Admin/Operator. */
export function toPublicProductNutrition(value: unknown): ProductNutrition | null {
  const parsed = parseNutritionInput(value);
  if (!parsed.ok) return null;
  return parsed.value;
}

/**
 * Data nutrisi untuk halaman publik/QR: hanya field dan komponen yang memiliki
 * nilai nyata. Section dan baris tanpa nilai disaring. Satu section yang tersisa
 * dikembalikan dalam bentuk lama agar tampilan tidak berubah.
 * Mengembalikan null bila tidak ada informasi yang layak ditampilkan.
 */
export function toPublicNutritionView(value: unknown): ProductNutrition | null {
  const nutrition = toPublicProductNutrition(value);
  if (!nutrition) return null;

  if (nutrition.sections && nutrition.sections.length > 0) {
    const sections: ProductNutritionSection[] = [];
    for (const section of nutrition.sections) {
      const parsed = parseBlock(
        {
          name: section.name,
          servingSizeAmount: section.servingSizeAmount,
          servingSizeUnit: section.servingSizeUnit,
          servingsPerPackage: section.servingsPerPackage,
          components: section.components,
        },
        { prefix: '', readName: true },
      );
      if (!parsed.ok || !parsed.value) continue;
      sections.push(blockToSection(parsed.value));
    }

    if (sections.length === 1) return blockToNutrition(sections[0]);
    if (sections.length > 1) return { sections };
    return null;
  }

  const components = (nutrition.components ?? []).filter(
    (c) => c.amount !== undefined || !!c.unit || c.akgPercent !== undefined,
  );
  const view: ProductNutrition = {};
  if (nutrition.servingSizeAmount !== undefined) view.servingSizeAmount = nutrition.servingSizeAmount;
  if (nutrition.servingSizeUnit) view.servingSizeUnit = nutrition.servingSizeUnit;
  if (nutrition.servingsPerPackage !== undefined) {
    view.servingsPerPackage = nutrition.servingsPerPackage;
  }
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
  if (
    value.servingSizeAmount !== undefined ||
    !!value.servingSizeUnit ||
    value.servingsPerPackage !== undefined ||
    (value.components?.length ?? 0) > 0
  ) {
    return true;
  }
  return (value.sections ?? []).some((section) => blockHasData(section));
}

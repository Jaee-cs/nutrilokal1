/**
 * Riwayat pergerakan stok produk jadi (README 5.3–5.5).
 *
 * Sumber tunggal riwayat adalah ledger BatchStockMovement. Setiap baris
 * ledger sudah ditulis atomik bersama perubahan stok batch oleh modul
 * produksi, penjualan/pembatalan, stok awal, dan penyesuaian stok.
 *
 * Endpoint riwayat hanya MEMBACA ledger. Tidak ada pencatatan baru di sini
 * dan filter tidak pernah mengubah stok aktual.
 *
 * Saldo berjalan dihitung dari SELURUH ledger produk, bukan hanya baris yang
 * lolos filter. Dengan begitu nilai saldo pada hasil filter tetap benar.
 * Batch lama yang stoknya tidak memiliki ledger (data sebelum pencatatan
 * tersedia) ditampilkan sebagai baris "Saldo Awal (Riwayat Sebelumnya Tidak
 * Tersedia)" yang ditandai jelas — bukan transaksi karangan.
 */
import { Prisma } from '@prisma/client';

const RECORDED_BY_SELECT = { select: { id: true, username: true, name: true } } as const;

export const PRODUCT_STOCK_MOVEMENT_TYPES = [
  'PRODUCTION_YIELD',
  'YIELD_CORRECTION',
  'OPENING_BALANCE',
  'ADJUSTMENT',
  'SALE',
  'SALE_CANCELLATION',
] as const;

export type ProductStockMovementType = (typeof PRODUCT_STOCK_MOVEMENT_TYPES)[number];

const PRODUCT_STOCK_MOVEMENT_TYPE_SET = new Set<string>(PRODUCT_STOCK_MOVEMENT_TYPES);

export const PRODUCT_STOCK_MOVEMENT_INCLUDE = {
  batch: { select: { id: true, code: true } },
  recordedBy: RECORDED_BY_SELECT,
  production: { select: { id: true } },
  adjustment: { select: { id: true, note: true } },
  openingBalance: { select: { id: true } },
  saleAllocation: {
    select: {
      id: true,
      item: { select: { transaction: { select: { id: true } } } },
    },
  },
} as const;

export type ProductStockMovementWithRelations = Prisma.BatchStockMovementGetPayload<{
  include: typeof PRODUCT_STOCK_MOVEMENT_INCLUDE;
}>;

export interface ProductStockHistoryProduct {
  id: string;
  name: string;
  unit: string;
}

export interface ProductStockHistoryBatch {
  id: string;
  code: string;
  stockQuantity: Prisma.Decimal;
  productionDate: Date | null;
  createdAt: Date;
}

export interface ProductStockHistoryRange {
  gte?: Date;
  lt?: Date;
}

export interface ProductStockHistoryFilters {
  from: string | null;
  to: string | null;
  range: ProductStockHistoryRange | null;
  type: ProductStockMovementType | null;
  batchId: string | null;
}

export interface ProductStockHistoryReference {
  kind: 'PRODUCTION' | 'SALE' | 'ADJUSTMENT' | 'OPENING_BALANCE';
  id: string;
  label: string;
}

export interface PublicProductStockMovement {
  id: string;
  product: ProductStockHistoryProduct;
  batch: {
    id: string;
    code: string;
    /** Stok batch saat ini (bukan saldo pada baris riwayat). */
    currentStock: number;
  };
  type: ProductStockMovementType;
  /** Nilai bertanda: positif menambah stok, negatif mengurangi. */
  quantity: number;
  /** Nilai positif untuk kolom stok masuk; 0 bila tidak ada. */
  stockIn: number;
  /** Nilai positif untuk kolom stok keluar; 0 bila tidak ada. */
  stockOut: number;
  /** Saldo total produk setelah pergerakan ini (termasuk seluruh batch). */
  balanceAfter: number;
  /** Saldo batch ini setelah pergerakan. */
  batchBalanceAfter: number;
  occurredAt: Date;
  recordedAt: Date;
  recordedBy: { id: string; username: string; name: string | null } | null;
  reason: string | null;
  /** Keterangan tambahan penyesuaian stok (bila ada). */
  note: string | null;
  reference: ProductStockHistoryReference | null;
  /** ID catatan sumber; null untuk baris saldo awal historis. */
  sourceId: string | null;
  /** Baris turunan untuk stok lama yang tidak memiliki ledger. */
  isHistoricalFallback: boolean;
}

export interface ProductStockHistoryResult {
  product: ProductStockHistoryProduct & {
    currentStock: number;
    batchCount: number;
  };
  filters: {
    from: string | null;
    to: string | null;
    type: ProductStockMovementType | null;
    batchId: string | null;
  };
  summary: {
    movementCount: number;
    totalIn: number;
    totalOut: number;
    currentStock: number;
    /** Saldo akhir hasil rekonstruksi ledger (harus sama dengan stok aktual). */
    reconstructedStock: number;
    consistent: boolean;
    hasHistoricalFallback: boolean;
  };
  data: PublicProductStockMovement[];
}

interface InternalStockMovement {
  id: string;
  batchId: string;
  type: ProductStockMovementType;
  quantity: Prisma.Decimal;
  occurredAt: Date;
  recordedAt: Date;
  recordedBy: { id: string; username: string; name: string | null } | null;
  reason: string | null;
  /** Keterangan tambahan penyesuaian stok (bila ada). */
  note: string | null;
  reference: ProductStockHistoryReference | null;
  sourceId: string | null;
  isHistoricalFallback: boolean;
}

/** Menerima hanya jenis aktivitas yang dikenal; selain itu null. */
export function parseProductStockMovementType(value: unknown):
  | { ok: true; type: ProductStockMovementType | null }
  | { ok: false } {
  if (value === undefined || value === null) {
    return { ok: true, type: null };
  }
  if (typeof value !== 'string') {
    return { ok: false };
  }
  const type = value.trim();
  if (type === '') {
    return { ok: true, type: null };
  }
  if (!PRODUCT_STOCK_MOVEMENT_TYPE_SET.has(type)) {
    return { ok: false };
  }
  return { ok: true, type: type as ProductStockMovementType };
}

function shortId(id: string): string {
  return id.slice(-8).toUpperCase();
}

function referenceFor(
  movement: ProductStockMovementWithRelations
): ProductStockHistoryReference | null {
  if (movement.productionId) {
    return {
      kind: 'PRODUCTION',
      id: movement.productionId,
      label: `Produksi #${shortId(movement.productionId)}`,
    };
  }
  if (movement.adjustmentId) {
    return {
      kind: 'ADJUSTMENT',
      id: movement.adjustmentId,
      label: `Penyesuaian #${shortId(movement.adjustmentId)}`,
    };
  }
  if (movement.openingBalanceId) {
    return {
      kind: 'OPENING_BALANCE',
      id: movement.openingBalanceId,
      label: 'Saldo awal batch',
    };
  }
  const saleId = movement.saleAllocation?.item.transaction.id;
  if (saleId) {
    return {
      kind: 'SALE',
      id: saleId,
      label: `Penjualan #${shortId(saleId)}`,
    };
  }
  return null;
}

function sourceIdFor(movement: ProductStockMovementWithRelations): string | null {
  return (
    movement.productionId ??
    movement.adjustmentId ??
    movement.openingBalanceId ??
    movement.saleAllocationId
  );
}

function realMovementToInternal(
  movement: ProductStockMovementWithRelations
): InternalStockMovement {
  return {
    id: movement.id,
    batchId: movement.batchId,
    type: movement.type as ProductStockMovementType,
    quantity: new Prisma.Decimal(movement.quantity),
    occurredAt: movement.occurredAt,
    recordedAt: movement.recordedAt,
    recordedBy: movement.recordedBy,
    reason: movement.reason,
    note: movement.adjustment?.note ?? null,
    reference: referenceFor(movement),
    sourceId: sourceIdFor(movement),
    isHistoricalFallback: false,
  };
}

/** Urutan kronologis ledger; id menjadi pemecah seri yang stabil. */
function compareChronological(a: InternalStockMovement, b: InternalStockMovement): number {
  const occurred = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (occurred !== 0) return occurred;
  const recorded = a.recordedAt.getTime() - b.recordedAt.getTime();
  if (recorded !== 0) return recorded;
  return a.id.localeCompare(b.id);
}

function isWithinRange(
  occurredAt: Date,
  range: ProductStockHistoryRange | null
): boolean {
  if (!range) return true;
  if (range.gte && occurredAt.getTime() < range.gte.getTime()) return false;
  if (range.lt && occurredAt.getTime() >= range.lt.getTime()) return false;
  return true;
}

/**
 * Membentuk riwayat dari data yang sudah ada. Semua saldo dihitung dari
 * seluruh ledger; filter hanya memilih baris yang ditampilkan.
 */
export function buildProductStockHistory(input: {
  product: ProductStockHistoryProduct;
  batches: ProductStockHistoryBatch[];
  movements: ProductStockMovementWithRelations[];
  filters: ProductStockHistoryFilters;
}): ProductStockHistoryResult {
  const { product, batches, movements, filters } = input;

  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const movementsByBatch = new Map<string, InternalStockMovement[]>();
  for (const movement of movements) {
    if (!batchById.has(movement.batchId)) continue;
    const internal = realMovementToInternal(movement);
    const rows = movementsByBatch.get(movement.batchId) ?? [];
    rows.push(internal);
    movementsByBatch.set(movement.batchId, rows);
  }

  const allRows: InternalStockMovement[] = [];
  for (const batch of batches) {
    const batchRows = movementsByBatch.get(batch.id) ?? [];

    // Stok aktual = jumlah ledger + saldo historis yang tidak tercatat.
    // Selisih hanya ditampilkan, tidak ditulis ulang ke database.
    const ledgerTotal = batchRows.reduce(
      (sum, row) => sum.plus(row.quantity),
      new Prisma.Decimal(0)
    );
    const historicalResidual = new Prisma.Decimal(batch.stockQuantity).minus(ledgerTotal);

    if (!historicalResidual.isZero()) {
      const earliest = batchRows.reduce<InternalStockMovement | null>(
        (current, row) => (!current || compareChronological(row, current) < 0 ? row : current),
        null
      );
      const base = batch.productionDate ?? batch.createdAt;
      const firstKnown = earliest ? earliest.occurredAt.getTime() : base.getTime();
      // Pastikan baris saldo awal historis selalu berada sebelum ledger
      // paling awal yang diketahui untuk batch ini.
      const fallbackAt = new Date(Math.min(base.getTime(), firstKnown) - 1);

      allRows.push({
        id: `historical-opening:${batch.id}`,
        batchId: batch.id,
        type: 'OPENING_BALANCE',
        quantity: historicalResidual,
        occurredAt: fallbackAt,
        recordedAt: fallbackAt,
        recordedBy: null,
        reason: 'Saldo Awal (Riwayat Sebelumnya Tidak Tersedia)',
        note: null,
        reference: null,
        sourceId: null,
        isHistoricalFallback: true,
      });
    }

    allRows.push(...batchRows);
  }

  allRows.sort(compareChronological);

  const balanceByMovementId = new Map<
    string,
    { balanceAfter: Prisma.Decimal; batchBalanceAfter: Prisma.Decimal }
  >();
  const batchBalances = new Map<string, Prisma.Decimal>();
  let productBalance = new Prisma.Decimal(0);

  for (const row of allRows) {
    productBalance = productBalance.plus(row.quantity);
    const batchBalance = (batchBalances.get(row.batchId) ?? new Prisma.Decimal(0)).plus(
      row.quantity
    );
    batchBalances.set(row.batchId, batchBalance);
    balanceByMovementId.set(row.id, {
      balanceAfter: productBalance,
      batchBalanceAfter: batchBalance,
    });
  }

  const filtered = allRows.filter((row) => {
    if (filters.batchId && row.batchId !== filters.batchId) return false;
    if (filters.type && row.type !== filters.type) return false;
    return isWithinRange(row.occurredAt, filters.range);
  });

  const data = filtered
    .slice()
    .sort((a, b) => -compareChronological(a, b))
    .map((row): PublicProductStockMovement => {
      const batch = batchById.get(row.batchId)!;
      const balances = balanceByMovementId.get(row.id)!;
      const quantity = Number(row.quantity);
      return {
        id: row.id,
        product,
        batch: {
          id: batch.id,
          code: batch.code,
          currentStock: Number(batch.stockQuantity),
        },
        type: row.type,
        quantity,
        stockIn: quantity > 0 ? quantity : 0,
        stockOut: quantity < 0 ? Math.abs(quantity) : 0,
        balanceAfter: Number(balances.balanceAfter),
        batchBalanceAfter: Number(balances.batchBalanceAfter),
        occurredAt: row.occurredAt,
        recordedAt: row.recordedAt,
        recordedBy: row.recordedBy,
        reason: row.reason,
        note: row.note,
        reference: row.reference,
        sourceId: row.sourceId,
        isHistoricalFallback: row.isHistoricalFallback,
      };
    });

  const currentStock = batches.reduce(
    (sum, batch) => sum.plus(batch.stockQuantity),
    new Prisma.Decimal(0)
  );
  const totalIn = data.reduce((sum, row) => sum + row.stockIn, 0);
  const totalOut = data.reduce((sum, row) => sum + row.stockOut, 0);

  return {
    product: {
      ...product,
      currentStock: Number(currentStock),
      batchCount: batches.length,
    },
    filters: {
      from: filters.from,
      to: filters.to,
      type: filters.type,
      batchId: filters.batchId,
    },
    summary: {
      movementCount: data.length,
      totalIn,
      totalOut,
      currentStock: Number(currentStock),
      reconstructedStock: Number(productBalance),
      consistent: productBalance.equals(currentStock),
      hasHistoricalFallback: data.some((row) => row.isHistoricalFallback),
    },
    data,
  };
}

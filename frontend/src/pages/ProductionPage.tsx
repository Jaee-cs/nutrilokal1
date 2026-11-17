import { useEffect, useMemo, useState } from 'react'
import api from '../lib/api'
import { Drawer } from '../components/Drawer'
import { DateField } from '../components/DateField'
import { useAuth } from '../hooks/useAuth'
import { useNotify } from '../components/NotificationProvider'
import { wibDateCode, wibDateLabel, isBatchExpired, nextDateCode } from '../utils/batch-expiry'
import { isoToDateTimeDisplay, todayDateCode } from '../utils/dates'
import { productPhotoUrl } from '../utils/product-photo'
import { areUnitsCompatible, convertQuantityValue, formatQty, multiplyRecipeQty, recipeUnitOptions } from '../utils/units'

interface RecipeItem {
  materialId: string
  material: { id: string; name: string; unit: string; isActive: boolean }
  quantityPerUnit: number
  recipeUnit: string
}

interface Product {
  id: string
  name: string
  unit: string
  isActive: boolean
  recipe?: RecipeItem[]
}

interface Material {
  id: string
  name: string
  unit: string
  isActive: boolean
  stock?: number
}

/** Batch pada respons produksi (toPublicProduction). */
interface ProductionBatch {
  id: string
  code: string
  productionDate: string | null
  stock: number
  aliases: string[]
  expiryDate: string | null
  expiryValidated: boolean
}

interface Production {
  id: string
  productId: string
  product: { id: string; name: string; unit: string }
  productionDate: string
  yieldQuantity: number
  note?: string | null
  recordedBy: { username: string; name?: string | null }
  recordedAt: string
  batch: ProductionBatch | null
  usages: Array<{
    materialId: string
    material: { name: string; unit: string }
    quantity: number
    inputQuantity?: number | null
    inputUnit?: string | null
  }>
}

/** Ringkasan batch dari GET /batches (toPublicBatch). */
interface BatchSummary {
  id: string
  code: string
  aliases: string[]
  product: { id: string; name: string; unit: string; photoUrl?: string | null }
  productionDate: string | null
  stock: number
  hasLimitedHistory: boolean
  expiryDate: string | null
  expiryValidated: boolean
  createdAt: string
}

type BatchMovementType =
  | 'PRODUCTION_YIELD'
  | 'YIELD_CORRECTION'
  | 'OPENING_BALANCE'
  | 'ADJUSTMENT'
  | 'SALE'
  | 'SALE_CANCELLATION'

interface BatchMovement {
  id: string
  type: BatchMovementType
  /** Nilai bertanda: positif menambah stok batch, negatif mengurangi. */
  quantity: number
  occurredAt: string
  recordedAt: string
  recordedBy: { id: string; username: string; name?: string | null }
  reason: string | null
}

interface BatchExpiryChange {
  id: string
  previousExpiryDate: string | null
  newExpiryDate: string | null
  changedAt: string
  changedBy: { id: string; username: string; name?: string | null }
}

/** Detail batch dari GET /batches/:id (toPublicBatchDetail). */
interface BatchDetail extends BatchSummary {
  openingBalance: {
    id: string
    quantity: number
    note: string | null
    recordedBy: { id: string; username: string; name?: string | null }
    createdAt: string
  } | null
  movements: BatchMovement[]
  expiryHistory: BatchExpiryChange[]
}

const MOVEMENT_LABELS: Record<BatchMovementType, string> = {
  PRODUCTION_YIELD: 'Hasil Produksi',
  YIELD_CORRECTION: 'Koreksi Hasil',
  OPENING_BALANCE: 'Saldo Awal',
  ADJUSTMENT: 'Penyesuaian',
  SALE: 'Penjualan',
  SALE_CANCELLATION: 'Pembatalan Penjualan',
}

function formatNumber(value: number): string {
  return Number(value).toLocaleString('id-ID')
}

/** Waktu pencatatan (tanggal + jam) menurut kalender WIB. */
function wibDateTime(iso: string): string {
  const label = isoToDateTimeDisplay(iso)
  return label ? `${label} WIB` : iso
}

/** Angka bertanda untuk menampilkan perubahan stok. */
function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${formatNumber(value)}`
}

/**
 * Teks kedaluwarsa untuk UI internal: tanggal hanya dianggap sah setelah
 * divalidasi Admin (README 5.6); batch yang tanggalnya sudah lewat ditandai.
 */
function expiryInfo(batch?: BatchSummary): { text: string; expired: boolean } {
  if (!batch || !batch.expiryDate) return { text: 'belum dicatat', expired: false }
  const label = wibDateLabel(batch.expiryDate)
  if (!batch.expiryValidated) return { text: `${label} (belum divalidasi)`, expired: false }
  const expired = isBatchExpired(batch)
  return { text: expired ? `${label} (kedaluwarsa)` : label, expired }
}

export function ProductionPage() {
  const { user } = useAuth()
  const notify = useNotify()
  const isAdmin = user?.role === 'ADMIN'

  const [products, setProducts] = useState<Product[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [loading, setLoading] = useState(true)
  // Gagal memuat data halaman tetap tampil inline; hasil tindakan memakai dialog.
  const [loadError, setLoadError] = useState<string | null>(null)
  type UsageRow = {
    rowId: string
    materialId: string
    materialQty: string
    unit: string
    fromRecipe: boolean
    recipeQtyPerUnit?: number
  }

  const [form, setForm] = useState({
    productId: '',
    productionDate: todayDateCode(),
    expiryDate: '',
    yieldQuantity: '',
  })
  const [usageRows, setUsageRows] = useState<UsageRow[]>([
    { rowId: 'row-0', materialId: '', materialQty: '', unit: '', fromRecipe: false },
  ])
  const [manualEdited, setManualEdited] = useState(false)
  const [recalcNotice, setRecalcNotice] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Detail batch (Admin & Operator boleh melihat; mengubah kedaluwarsa: Admin)
  const [detail, setDetail] = useState<BatchDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [expiryDraft, setExpiryDraft] = useState('')
  const [savingExpiry, setSavingExpiry] = useState(false)
  const [clearArmed, setClearArmed] = useState(false)

  async function fetchData(): Promise<boolean> {
    try {
      setLoading(true)
      const [p, m, pr, b] = await Promise.all([
        api.get('/products'),
        api.get('/materials'),
        api.get('/productions').catch(() => ({ data: { data: [] } })),
        api.get('/batches').catch(() => ({ data: { data: [] } })),
      ])
      setProducts((p.data.data || p.data) || [])
      setMaterials((m.data.data || m.data) || [])
      setProductions((pr.data.data || pr.data) || [])
      setBatches((b.data.data || b.data) || [])
      setLoadError(null)
      return true
    } catch (err: any) {
      setLoadError(err.response?.data?.message || 'Gagal memuat data')
      return false
    } finally {
      setLoading(false)
    }
  }

  /** Memuat detail batch; kegagalan dilaporkan lewat dialog notifikasi. */
  async function loadDetail(batchId: string): Promise<boolean> {
    setDetailLoading(true)
    try {
      const res = await api.get(`/batches/${batchId}`)
      const batch: BatchDetail = res.data.batch
      setDetail(batch)
      setExpiryDraft(batch.expiryDate ? wibDateCode(batch.expiryDate) : '')
      return true
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal memuat detail batch')
      return false
    } finally {
      setDetailLoading(false)
    }
  }

  async function openDetail(batchId: string) {
    setClearArmed(false)
    setDetail(null)
    setDetailOpen(true)
    await loadDetail(batchId)
  }

  function closeDetail() {
    setDetailOpen(false)
    setDetail(null)
    setClearArmed(false)
  }

  useEffect(() => {
    fetchData()
  }, [])

  function newRowId() {
    return `row-${Math.random().toString(36).slice(2, 10)}`
  }

  function emptyUsageRow(): UsageRow {
    return { rowId: newRowId(), materialId: '', materialQty: '', unit: '', fromRecipe: false }
  }

  function buildRecipeRows(product: Product | undefined, yieldValue: string): UsageRow[] {
    const recipe = (product?.recipe ?? []).filter((item) => item.material?.isActive !== false)
    if (recipe.length === 0) return [emptyUsageRow()]
    const yieldNum = Number(yieldValue)
    return recipe.map((item) => ({
      rowId: newRowId(),
      materialId: item.materialId,
      materialQty:
        yieldValue && Number.isFinite(yieldNum) && yieldNum > 0
          ? multiplyRecipeQty(item.quantityPerUnit, yieldNum)
          : formatQty(item.quantityPerUnit),
      unit: item.recipeUnit,
      fromRecipe: true,
      recipeQtyPerUnit: item.quantityPerUnit,
    }))
  }

  const selectedProduct = products.find((p) => p.id === form.productId)
  const hasRecipe = (selectedProduct?.recipe ?? []).some(
    (item) => item.material?.isActive !== false
  )

  function applyRecipeForProduct(productId: string, yieldValue: string, markManual = false) {
    const product = products.find((p) => p.id === productId)
    const recipe = product?.recipe ?? []
    if (recipe.length > 0) {
      setUsageRows(buildRecipeRows(product, yieldValue))
      setManualEdited(markManual)
      setRecalcNotice(false)
    } else {
      setUsageRows([emptyUsageRow()])
      setManualEdited(false)
      setRecalcNotice(false)
    }
  }

  function handleProductChange(productId: string) {
    setForm((f) => ({ ...f, productId }))
    applyRecipeForProduct(productId, form.yieldQuantity)
  }

  function handleYieldChange(value: string) {
    setForm((f) => ({ ...f, yieldQuantity: value }))
    if (!hasRecipe) return
    if (manualEdited) {
      setRecalcNotice(true)
      return
    }
    const product = products.find((p) => p.id === form.productId)
    setUsageRows(buildRecipeRows(product, value))
    setRecalcNotice(false)
  }

  function recalculateFromRecipe() {
    const product = products.find((p) => p.id === form.productId)
    setUsageRows(buildRecipeRows(product, form.yieldQuantity))
    setManualEdited(false)
    setRecalcNotice(false)
  }

  async function submitProduction(e: React.FormEvent) {
    e.preventDefault()
    if (!form.productId || !form.productionDate || !form.expiryDate || !form.yieldQuantity) {
      notify.error('Produk, tanggal produksi, tanggal kedaluwarsa, dan jumlah hasil wajib diisi.')
      return
    }
    if (form.expiryDate <= form.productionDate) {
      notify.error('Tanggal kedaluwarsa harus setelah tanggal produksi.')
      return
    }
    setSubmitting(true)
    try {
      const materialsPayload = usageRows
        .filter((r) => r.materialId && r.materialQty)
        .map((r) => {
          const material = materials.find((m) => m.id === r.materialId)
          return {
            materialId: r.materialId,
            quantity: Number(r.materialQty),
            unit: r.unit || material?.unit || undefined,
          }
        })

      const payload: any = {
        productId: form.productId,
        productionDate: form.productionDate,
        expiryDate: form.expiryDate,
        yieldQuantity: Number(form.yieldQuantity),
        materials: materialsPayload,
      }
      const res = await api.post('/productions', payload)
      setForm({ productId: '', productionDate: todayDateCode(), expiryDate: '', yieldQuantity: '' })
      setUsageRows([emptyUsageRow()])
      setManualEdited(false)
      setRecalcNotice(false)
      await fetchData()
      notify.success(`Produksi berhasil. Kode batch: ${res.data.production.batch?.code || '-'}`)
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mencatat produksi')
    } finally {
      setSubmitting(false)
    }
  }

  function markManual() {
    setManualEdited(true)
  }

  function addUsageRow() {
    markManual()
    setUsageRows((rows) => [...rows, emptyUsageRow()])
  }

  function removeUsageRow(index: number) {
    markManual()
    setUsageRows((rows) => {
      const next = rows.filter((_, i) => i !== index)
      return next.length > 0 ? next : [emptyUsageRow()]
    })
  }

  function updateUsageRow(index: number, patch: Partial<UsageRow>) {
    markManual()
    setUsageRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  /** Menyimpan tanggal kedaluwarsa sekaligus memvalidasinya (khusus Admin). */
  async function saveExpiry(e: React.FormEvent) {
    e.preventDefault()

    if (!detail) return
    const date = expiryDraft.trim()
    if (!date) {
      notify.error('Tanggal kedaluwarsa wajib diisi.')
      return
    }

    const productionDate = detail.productionDate ? wibDateCode(detail.productionDate) : null
    if (productionDate && date <= productionDate) {
      notify.error('Tanggal kedaluwarsa harus setelah tanggal produksi.')
      return
    }

    const previousLabel = detail.expiryDate ? wibDateLabel(detail.expiryDate) : 'belum dicatat'
    const confirmed = await notify.confirm({
      title: 'Simpan Tanggal Kedaluwarsa',
      message: `Tanggal kedaluwarsa batch ${detail.code} akan diubah dari ${previousLabel} menjadi ${wibDateLabel(date)}. Simpan perubahan?`,
      confirmLabel: 'Ya, Simpan',
    })
    if (!confirmed) return

    setSavingExpiry(true)
    try {
      await api.patch(`/batches/${detail.id}/expiry`, { expiryDate: date })
      // Muat ulang DULU (detail + daftar), lalu tampilkan pesan sukses agar
      // pesan tidak terhapus oleh pemuatan ulang.
      const detailOk = await loadDetail(detail.id)
      const listOk = await fetchData()
      if (detailOk && listOk) {
        notify.success('Tanggal kedaluwarsa berhasil disimpan dan divalidasi')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal menyimpan tanggal kedaluwarsa')
    } finally {
      setSavingExpiry(false)
      setClearArmed(false)
    }
  }

  /** Mengosongkan tanggal kedaluwarsa (kembali "belum tersedia"). */
  async function clearExpiry() {
    if (!detail) return
    setSavingExpiry(true)
    try {
      await api.patch(`/batches/${detail.id}/expiry`, { expiryDate: null })
      const detailOk = await loadDetail(detail.id)
      const listOk = await fetchData()
      if (detailOk && listOk) {
        notify.success('Tanggal kedaluwarsa dikosongkan')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mengosongkan tanggal kedaluwarsa')
    } finally {
      setSavingExpiry(false)
      setClearArmed(false)
    }
  }

  const activeProducts = products.filter(p => p.isActive)
  const activeMaterials = useMemo(() => materials.filter(m => m.isActive), [materials])
  const batchById = new Map(batches.map(b => [b.id, b]))
  const minProductionExpiry = form.productionDate ? nextDateCode(form.productionDate) : undefined
  const minDetailExpiry =
    detail?.productionDate ? nextDateCode(wibDateCode(detail.productionDate)) : undefined

  const detailExpiry = detail ? expiryInfo(detail) : null
  const detailUnit = detail?.product.unit || ''
  const movements = detail ? detail.movements.slice(0, 10) : []
  // Saldo berjalan mundur dari stok terkini (baris terbaru paling atas).
  let runningBalance: number | undefined = detail?.stock
  const movementRows = movements.map(movement => {
    const balance = runningBalance
    if (runningBalance !== undefined) runningBalance -= movement.quantity
    return { movement, balance }
  })

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Produksi &amp; Batch</h1>
        <p className="page-subtitle">
          Catat produksi, pantau stok produk, dan kelola informasi batch.
        </p>
      </div>

      {loadError && !detailOpen && <div className="alert error">{loadError}</div>}

      <div className="grid-2col">
        {/* Form produksi */}
        <section className="card">
          <h2 className="card-title">Catat Produksi</h2>
          <form onSubmit={submitProduction} className="stack-form">
            <div className="field">
              <label htmlFor="pr-product">Produk</label>
              <select
                id="pr-product"
                value={form.productId}
                onChange={e => handleProductChange(e.target.value)}
                required
              >
                <option value="">Pilih produk</option>
                {activeProducts.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="pr-date">Tanggal Produksi</label>
                <DateField
                  id="pr-date"
                  value={form.productionDate}
                  max={todayDateCode()}
                  onChange={(productionDate) => setForm(f => ({ ...f, productionDate }))}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="pr-expiry">Tanggal Kedaluwarsa</label>
                <DateField
                  id="pr-expiry"
                  value={form.expiryDate}
                  min={minProductionExpiry}
                  onChange={(expiryDate) => setForm(f => ({ ...f, expiryDate }))}
                  required
                />
                <span className="text-muted" style={{ fontSize: 12 }}>
                  Harus setelah tanggal produksi.
                </span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="pr-yield">Jumlah Hasil</label>
              <input
                id="pr-yield"
                type="number"
                step="0.001"
                min="0"
                value={form.yieldQuantity}
                onChange={e => handleYieldChange(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>Bahan yang Digunakan</label>
              <div className="stack-form" style={{ gap: '0.75rem' }}>
                {hasRecipe && (
                  <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                    Resep produk dimuat otomatis untuk 1 {selectedProduct?.unit || 'satuan'}. Jumlah
                    dihitung dari hasil produksi dan ditampilkan dalam satuan resep. Anda tetap dapat
                    menyesuaikan, menambah, atau menghapus bahan sesuai kebutuhan aktual.
                  </p>
                )}
                {recalcNotice && hasRecipe && (
                  <div className="alert info" style={{ margin: 0 }}>
                    <span>Jumlah produksi berubah. Perhitungan bahan disesuaikan manual dan tidak ditimpa otomatis.</span>
                    <div className="form-actions" style={{ marginTop: '0.5rem' }}>
                      <button type="button" className="button secondary" onClick={recalculateFromRecipe}>
                        Hitung Ulang dari Resep
                      </button>
                    </div>
                  </div>
                )}
                {!hasRecipe && form.productId && (
                  <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                    Produk ini belum memiliki resep. Masukkan bahan dan jumlah yang digunakan secara
                    manual.
                  </p>
                )}
                {usageRows.map((row, idx) => {
                  const material = materials.find((m) => m.id === row.materialId)
                  const unitOptions = material
                    ? recipeUnitOptions(material.unit, row.unit)
                    : row.unit
                      ? [row.unit]
                      : []
                  return (
                    <div key={row.rowId} className="form-row" style={{ alignItems: 'flex-end' }}>
                      <div className="field" style={{ flex: 2, minWidth: 160 }}>
                        <label htmlFor={`pr-material-${idx}`}>Bahan Baku</label>
                        <select
                          id={`pr-material-${idx}`}
                          value={row.materialId}
                          onChange={e => {
                            const materialId = e.target.value
                            const nextMaterial = materials.find((m) => m.id === materialId)
                            const nextUnit = nextMaterial?.unit || ''
                            const keepUnit = Boolean(
                              row.unit && nextUnit && areUnitsCompatible(row.unit, nextUnit)
                            )
                            updateUsageRow(idx, {
                              materialId,
                              // Satuan resep lama dipertahankan hanya bila masih
                              // kompatibel dengan satuan stok bahan baru; baris
                              // yang bahan bakunya diganti tidak lagi dianggap
                              // murni dari resep sehingga satuannya dapat diubah.
                              unit: keepUnit ? row.unit : nextUnit,
                              fromRecipe: false,
                            })
                          }}
                        >
                          <option value="">Pilih bahan</option>
                          {activeMaterials
                            .filter(m => !usageRows.some((r, i) => i !== idx && r.materialId === m.id))
                            .map(m => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.unit}){m.stock !== undefined ? ` — stok ${m.stock}` : ''}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div className="field" style={{ flex: 1, minWidth: 120 }}>
                        <label htmlFor={`pr-mqty-${idx}`}>Jumlah Digunakan</label>
                        <input
                          id={`pr-mqty-${idx}`}
                          type="number"
                          step="0.001"
                          min="0"
                          value={row.materialQty}
                          onChange={e => updateUsageRow(idx, { materialQty: e.target.value })}
                          disabled={!row.materialId}
                        />
                      </div>
                      <div className="field" style={{ flex: 1, minWidth: 110 }}>
                        <label htmlFor={`pr-unit-${idx}`}>Satuan</label>
                        {row.fromRecipe || unitOptions.length <= 1 ? (
                          <input
                            id={`pr-unit-${idx}`}
                            value={row.unit || material?.unit || ''}
                            readOnly
                            disabled={!row.materialId}
                            title={row.fromRecipe ? 'Satuan mengikuti resep' : undefined}
                          />
                        ) : (
                          <select
                            id={`pr-unit-${idx}`}
                            value={row.unit || material?.unit || ''}
                            onChange={e => updateUsageRow(idx, { unit: e.target.value })}
                            disabled={!row.materialId}
                          >
                            {unitOptions.map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        )}
                        {material && row.unit && row.unit !== material.unit && areUnitsCompatible(row.unit, material.unit) && (
                          <span className="text-muted" style={{ fontSize: 11 }}>
                            ≈ {formatQty(convertQuantityValue(Number(row.materialQty || 0), row.unit, material.unit) ?? 0)} {material.unit}
                          </span>
                        )}
                      </div>
                      <div className="form-actions" style={{ margin: 0 }}>
                        <button
                          type="button"
                          className="button secondary production-usage-remove"
                          onClick={() => removeUsageRow(idx)}
                          disabled={usageRows.length === 1}
                          aria-label={`Hapus bahan ${idx + 1}`}
                          title="Hapus bahan"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                  )
                })}
                <div className="form-actions production-usage-actions" style={{ marginTop: 0 }}>
                  <button type="button" className="button secondary" onClick={addUsageRow}>
                    Tambah Bahan
                  </button>
                  <button
                    type="button"
                    className="button secondary production-usage-remove"
                    onClick={() => removeUsageRow(usageRows.length - 1)}
                    disabled={usageRows.length === 1}
                  >
                    Hapus Bahan
                  </button>
                </div>
              </div>
            </div>
            <div className="form-actions production-submit-actions">
              <button className="button production-submit-btn" disabled={submitting}>
                {submitting ? 'Menyimpan...' : 'Simpan Produksi'}
              </button>
            </div>
          </form>
        </section>

        {/* Bahan tersedia (ringkas) */}
        <section className="card">
          <h2 className="card-title">Stok Bahan Digunakan</h2>
          {activeMaterials.length === 0 ? (
            <p className="text-muted">Belum ada bahan aktif.</p>
          ) : (
            <div className="chip-list">
              {activeMaterials.map(m => (
                <span key={m.id} className="chip">
                  <span className="chip-name">{m.name}</span>
                  <span className="chip-count">
                    {m.stock !== undefined ? m.stock.toLocaleString('id-ID') : '0'} {m.unit}
                  </span>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Riwayat produksi */}
      <section className="card section-card">
        <div className="section-head">
          <h2 className="card-title">Riwayat Produksi &amp; Batch</h2>
          <span className="text-muted">{productions.length} catatan</span>
        </div>
        {/* Desktop: tabel lengkap */}
        <div className="table-wrapper desktop-table">
          <table>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Produk</th>
                <th>Hasil</th>
                <th>Batch</th>
                <th>Bahan Digunakan</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6}>Memuat...</td></tr>
              ) : productions.length === 0 ? (
                <tr><td colSpan={6} className="text-muted">Belum ada catatan produksi</td></tr>
              ) : (
                productions.slice(0, 20).map(p => {
                  const summary = p.batch ? batchById.get(p.batch.id) : undefined
                  const expiry = expiryInfo(summary)
                  return (
                    <tr key={p.id}>
                      <td>
                        {wibDateLabel(p.productionDate)}
                        <div className="cell-secondary">dicatat {wibDateTime(p.recordedAt)}</div>
                      </td>
                      <td className="cell-primary">{p.product.name}</td>
                      <td className="num">
                        <strong>{formatNumber(p.yieldQuantity)}</strong>{' '}
                        <span className="text-muted">{p.product.unit}</span>
                      </td>
                      <td>
                        {p.batch ? (
                          <>
                            <span className="badge neutral">{p.batch.code}</span>
                            <div className="cell-secondary">
                              stok {formatNumber(p.batch.stock)} {p.product.unit}
                            </div>
                            <div className="cell-secondary">
                              kedaluwarsa: {expiry.text}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td className="text-muted">
                        {p.usages
                          .map(u => {
                            const qty = u.inputQuantity ?? u.quantity
                            const unit = u.inputUnit || u.material.unit
                            return `${u.material.name} ${formatQty(Number(qty))} ${unit}`
                          })
                          .join(', ') || '-'}
                      </td>
                      <td>
                        {p.batch ? (
                          <button className="button secondary" onClick={() => openDetail(p.batch!.id)}>
                            Detail Batch
                          </button>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile: kartu riwayat produksi */}
        <div className="mobile-list">
          {loading ? (
            <p className="text-muted">Memuat...</p>
          ) : productions.length === 0 ? (
            <p className="text-muted">Belum ada catatan produksi</p>
          ) : (
            productions.slice(0, 20).map(p => {
              const summary = p.batch ? batchById.get(p.batch.id) : undefined
              const expiry = expiryInfo(summary)
              return (
                <article className="production-item" key={p.id}>
                  {/* Kepala: identitas produk + tanggal */}
                  <div className="production-item-head">
                    <div className="production-item-product">{p.product.name}</div>
                    <div className="production-item-date">
                      <span className="material-symbols-outlined production-item-icon">event</span>
                      {wibDateLabel(p.productionDate)}
                    </div>
                  </div>

                  {/* Dua kolom: kiri (Hasil, Kedaluwarsa) — kanan (Batch, Bahan) */}
                  <div className="production-item-grid">
                    <div className="production-item-col">
                      <div className="production-item-field">
                        <span className="production-item-label">Hasil</span>
                        <span className="production-item-value num">
                          <strong>{formatNumber(p.yieldQuantity)}</strong>{' '}
                          <span className="unit">{p.product.unit}</span>
                        </span>
                      </div>
                      {p.batch && (
                        <div className="production-item-field">
                          <span className="production-item-label">Kedaluwarsa</span>
                          <span className="production-item-expiry">{expiry.text}</span>
                        </div>
                      )}
                    </div>

                    <div className="production-item-col">
                      <div className="production-item-field">
                        <span className="production-item-label">Batch</span>
                        {p.batch ? (
                          <span className="production-item-batch">
                            <span className="batch-code">{p.batch.code}</span>
                            <span className="production-item-sub">
                              stok {formatNumber(p.batch.stock)} {p.product.unit}
                            </span>
                          </span>
                        ) : (
                          <span className="production-item-value text-muted">-</span>
                        )}
                      </div>
                      <div className="production-item-field">
                        <span className="production-item-label">Bahan Digunakan</span>
                        <span className="production-item-usage">
                          {p.usages
                            .map(u => {
                              const qty = u.inputQuantity ?? u.quantity
                              const unit = u.inputUnit || u.material.unit
                              return `${u.material.name} ${formatQty(Number(qty))} ${unit}`
                            })
                            .join(', ') || '-'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="production-item-foot">
                    <span className="production-item-sub">dicatat {wibDateTime(p.recordedAt)}</span>
                    {p.batch && (
                      <button
                        className="button secondary production-item-action"
                        onClick={() => openDetail(p.batch!.id)}
                      >
                        Detail Batch
                      </button>
                    )}
                  </div>
                </article>
              )
            })
          )}
        </div>
      </section>

      {/* Detail batch */}
      <Drawer
        open={detailOpen}
        title={detail ? `Batch ${detail.code}` : 'Detail Batch'}
        onClose={closeDetail}
      >
        {detailLoading && !detail ? (
          <p className="text-muted">Memuat detail batch...</p>
        ) : !detail ? (
          <p className="text-muted">Detail batch tidak tersedia.</p>
        ) : (
          <>
            {/* Foto produk dari master (hanya bila Admin sudah mengunggahnya). */}
            {productPhotoUrl(detail.product.photoUrl) && (
              <div className="product-photo detail-photo">
                <img
                  src={productPhotoUrl(detail.product.photoUrl)!}
                  alt={`Foto ${detail.product.name}`}
                />
              </div>
            )}
            <div className="detail-grid">
              <div className="detail-item">
                <span className="card-label">Kode Batch</span>
                <span className="detail-value">{detail.code}</span>
              </div>
              <div className="detail-item">
                <span className="card-label">Produk</span>
                <span className="detail-value">
                  {detail.product.name} ({detail.product.unit})
                </span>
              </div>
              <div className="detail-item">
                <span className="card-label">Tanggal Produksi</span>
                <span className="detail-value">
                  {detail.productionDate ? wibDateLabel(detail.productionDate) : '-'}
                </span>
              </div>
              <div className="detail-item">
                <span className="card-label">Stok Batch</span>
                <span className="detail-value">
                  {formatNumber(detail.stock)} {detailUnit}
                </span>
              </div>
              <div className="detail-item">
                <span className="card-label">Tanggal Kedaluwarsa</span>
                <span className="detail-value">
                  {detailExpiry && detailExpiry.text}
                  {detailExpiry?.expired && (
                    <>
                      {' '}
                      <span className="badge error">Kedaluwarsa</span>
                    </>
                  )}
                </span>
              </div>
              <div className="detail-item">
                <span className="card-label">Riwayat</span>
                <span className="detail-value">
                  {detail.hasLimitedHistory ? (
                    <span className="badge warning">Terbatas (stok awal)</span>
                  ) : (
                    <span className="badge success">Lengkap</span>
                  )}
                </span>
              </div>
              {detail.aliases.length > 0 && (
                <div className="detail-item">
                  <span className="card-label">Kode Lama</span>
                  <span className="detail-value">{detail.aliases.join(', ')}</span>
                </div>
              )}
            </div>

            {/* Audit perubahan tanggal kedaluwarsa, terlihat untuk semua role. */}
            {detail.expiryHistory.length > 0 && (
              <div className="card section-card">
                <h2 className="card-title">Riwayat Perubahan Kedaluwarsa</h2>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Tanggal Lama</th>
                        <th>Tanggal Baru</th>
                        <th>Waktu Perubahan</th>
                        <th>Diubah oleh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.expiryHistory.map(change => (
                        <tr key={change.id}>
                          <td>
                            {change.previousExpiryDate
                              ? wibDateLabel(change.previousExpiryDate)
                              : 'Belum dicatat'}
                          </td>
                          <td>
                            {change.newExpiryDate
                              ? wibDateLabel(change.newExpiryDate)
                              : 'Dikosongkan'}
                          </td>
                          <td>{wibDateTime(change.changedAt)}</td>
                          <td>
                            {change.changedBy.name || change.changedBy.username}
                            <div className="cell-secondary">{change.changedBy.username}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Mengatur tanggal kedaluwarsa: hanya Admin (ditegakkan backend) */}
            {isAdmin && (
              <div className="card section-card">
                <h2 className="card-title">Atur Tanggal Kedaluwarsa</h2>
                <p className="text-muted">
                  Menyimpan tanggal sekaligus memvalidasinya. Setelah tanggalnya lewat, penjualan
                  dari batch ini ditolak backend; stok tetap tercatat sampai disesuaikan.
                </p>
                <form onSubmit={saveExpiry} className="form-row">
                  <div className="field">
                    <label htmlFor="batch-expiry">Tanggal Kedaluwarsa</label>
                    <DateField
                      id="batch-expiry"
                      value={expiryDraft}
                      min={minDetailExpiry}
                      onChange={setExpiryDraft}
                      required
                    />
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      Harus setelah tanggal produksi batch.
                    </span>
                  </div>
                  <div className="form-actions">
                    <button className="button" disabled={savingExpiry}>
                      {savingExpiry ? 'Menyimpan...' : 'Simpan Tanggal'}
                    </button>
                  </div>
                </form>
                {clearArmed ? (
                  <div className="form-actions">
                    <span className="text-muted">Kosongkan tanggal kedaluwarsa batch ini?</span>
                    <button className="button danger" onClick={clearExpiry} disabled={savingExpiry}>
                      Ya, kosongkan
                    </button>
                    <button className="button secondary" onClick={() => setClearArmed(false)}>
                      Batal
                    </button>
                  </div>
                ) : (
                  <div className="form-actions">
                    <button
                      className="button secondary"
                      onClick={() => setClearArmed(true)}
                      disabled={savingExpiry || !detail.expiryDate}
                    >
                      Kosongkan Tanggal
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Riwayat pergerakan stok batch */}
            <div className="card section-card">
              <div className="section-head">
                <h2 className="card-title">Riwayat Pergerakan Batch</h2>
                <span className="text-muted">
                  {detail.movements.length > movements.length
                    ? `${movements.length} pergerakan terbaru dari ${detail.movements.length}`
                    : `${detail.movements.length} pergerakan`}
                </span>
              </div>
              {detail.openingBalance && (
                <p className="text-muted">
                  Saldo awal: {formatNumber(detail.openingBalance.quantity)} {detailUnit} oleh{' '}
                  {detail.openingBalance.recordedBy.username}
                  {detail.openingBalance.note ? ` — ${detail.openingBalance.note}` : ''}
                </p>
              )}
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Tanggal Aktivitas</th>
                      <th>Jenis</th>
                      <th>Perubahan</th>
                      <th>Saldo</th>
                      <th>Alasan</th>
                      <th>Dicatat oleh</th>
                      <th>Waktu Pencatatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-muted">Belum ada pergerakan stok batch</td>
                      </tr>
                    ) : (
                      movementRows.map(({ movement, balance }) => (
                        <tr key={movement.id}>
                          <td>{wibDateLabel(movement.occurredAt)}</td>
                          <td>{MOVEMENT_LABELS[movement.type] || movement.type}</td>
                          <td className="num">
                            <strong>{signed(movement.quantity)}</strong>{' '}
                            <span className="text-muted">{detailUnit}</span>
                          </td>
                          <td className="num">
                            {balance !== undefined ? formatNumber(balance) : '-'}{' '}
                            <span className="text-muted">{detailUnit}</span>
                          </td>
                          <td className="text-muted">{movement.reason || '-'}</td>
                          <td>{movement.recordedBy?.username || '-'}</td>
                          <td className="text-muted">{wibDateTime(movement.recordedAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}

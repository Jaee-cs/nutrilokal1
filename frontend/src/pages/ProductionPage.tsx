import { useEffect, useState } from 'react'
import api from '../lib/api'
import { Drawer } from '../components/Drawer'
import { useAuth } from '../hooks/useAuth'
import { wibDateCode, wibDateLabel, isBatchExpired } from '../utils/batch-expiry'
import { productPhotoUrl } from '../utils/product-photo'

interface Product {
  id: string
  name: string
  unit: string
  isActive: boolean
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
  usages: Array<{ materialId: string; material: { name: string; unit: string }; quantity: number }>
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
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  const isAdmin = user?.role === 'ADMIN'

  const [products, setProducts] = useState<Product[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({ productId: '', productionDate: '', yieldQuantity: '', materialId: '', materialQty: '' })
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
      return true
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat data')
      return false
    } finally {
      setLoading(false)
    }
  }

  /**
   * Memuat detail batch. Tidak mengosongkan pesan error/sukses supaya pesan
   * dari aksi pemanggil tidak ikut terhapus (pola yang sama dengan riwayat
   * pergerakan stok bahan baku).
   */
  async function loadDetail(batchId: string): Promise<boolean> {
    setDetailLoading(true)
    try {
      const res = await api.get(`/batches/${batchId}`)
      const batch: BatchDetail = res.data.batch
      setDetail(batch)
      setExpiryDraft(batch.expiryDate ? wibDateCode(batch.expiryDate) : '')
      return true
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat detail batch')
      return false
    } finally {
      setDetailLoading(false)
    }
  }

  async function openDetail(batchId: string) {
    setError(null)
    setSuccess(null)
    setClearArmed(false)
    setDetail(null)
    setDetailOpen(true)
    await loadDetail(batchId)
  }

  function closeDetail() {
    setDetailOpen(false)
    setDetail(null)
    setClearArmed(false)
    setError(null)
    setSuccess(null)
  }

  useEffect(() => {
    fetchData()
  }, [])

  async function submitProduction(e: React.FormEvent) {
    e.preventDefault()
    if (!form.productId || !form.yieldQuantity) return
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const payload: any = {
        productId: form.productId,
        productionDate: form.productionDate || undefined,
        yieldQuantity: Number(form.yieldQuantity),
        materials: [],
      }
      if (form.materialId && form.materialQty) {
        payload.materials = [{ materialId: form.materialId, quantity: Number(form.materialQty) }]
      }
      const res = await api.post('/productions', payload)
      setSuccess(`Produksi berhasil. Kode batch: ${res.data.production.batch?.code || '-'}`)
      setForm({ productId: '', productionDate: '', yieldQuantity: '', materialId: '', materialQty: '' })
      await fetchData()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mencatat produksi')
    } finally {
      setSubmitting(false)
    }
  }

  /** Menyimpan tanggal kedaluwarsa sekaligus memvalidasinya (khusus Admin). */
  async function saveExpiry(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!detail) return
    const date = expiryDraft.trim()
    if (!date) {
      setError('Tanggal kedaluwarsa wajib diisi.')
      return
    }

    setSavingExpiry(true)
    try {
      await api.patch(`/batches/${detail.id}/expiry`, { expiryDate: date })
      // Muat ulang DULU (detail + daftar), lalu tampilkan pesan sukses agar
      // pesan tidak terhapus oleh pemuatan ulang.
      const detailOk = await loadDetail(detail.id)
      const listOk = await fetchData()
      if (detailOk && listOk) {
        setSuccess('Tanggal kedaluwarsa berhasil disimpan dan divalidasi')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal menyimpan tanggal kedaluwarsa')
    } finally {
      setSavingExpiry(false)
      setClearArmed(false)
    }
  }

  /** Mengosongkan tanggal kedaluwarsa (kembali "belum tersedia"). */
  async function clearExpiry() {
    if (!detail) return
    setError(null)
    setSuccess(null)
    setSavingExpiry(true)
    try {
      await api.patch(`/batches/${detail.id}/expiry`, { expiryDate: null })
      const detailOk = await loadDetail(detail.id)
      const listOk = await fetchData()
      if (detailOk && listOk) {
        setSuccess('Tanggal kedaluwarsa dikosongkan')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mengosongkan tanggal kedaluwarsa')
    } finally {
      setSavingExpiry(false)
      setClearArmed(false)
    }
  }

  const activeProducts = products.filter(p => p.isActive)
  const activeMaterials = materials.filter(m => m.isActive)
  const batchById = new Map(batches.map(b => [b.id, b]))

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
          Pencatatan produksi mengikuti aturan backend — kode batch dibuat otomatis, informasi batch
          (stok dan tanggal kedaluwarsa) dapat dilihat per batch.
        </p>
      </div>

      {error && !detailOpen && <div className="alert error">{error}</div>}
      {success && !detailOpen && <div className="alert success">{success}</div>}

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
                onChange={e => setForm(f => ({ ...f, productId: e.target.value }))}
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
                <label htmlFor="pr-date">Tanggal Produksi (opsional)</label>
                <input
                  id="pr-date"
                  type="date"
                  value={form.productionDate}
                  onChange={e => setForm(f => ({ ...f, productionDate: e.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="pr-yield">Jumlah Hasil</label>
                <input
                  id="pr-yield"
                  type="number"
                  step="0.001"
                  min="0"
                  value={form.yieldQuantity}
                  onChange={e => setForm(f => ({ ...f, yieldQuantity: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="pr-material">Bahan Digunakan (opsional)</label>
                <select
                  id="pr-material"
                  value={form.materialId}
                  onChange={e => setForm(f => ({ ...f, materialId: e.target.value }))}
                >
                  <option value="">Pilih bahan (opsional)</option>
                  {activeMaterials.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pr-mqty">Jumlah Bahan</label>
                <input
                  id="pr-mqty"
                  type="number"
                  step="0.001"
                  min="0"
                  value={form.materialQty}
                  onChange={e => setForm(f => ({ ...f, materialQty: e.target.value }))}
                  disabled={!form.materialId}
                />
              </div>
            </div>
            <div className="form-actions">
              <button className="button" disabled={submitting}>
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
                        {p.usages.map(u => `${u.material.name} ${u.quantity} ${u.material.unit}`).join(', ') || '-'}
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
                          {p.usages.map(u => `${u.material.name} ${u.quantity} ${u.material.unit}`).join(', ') || '-'}
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
        {error && <div className="alert error">{error}</div>}
        {success && <div className="alert success">{success}</div>}

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
                    <input
                      id="batch-expiry"
                      type="date"
                      value={expiryDraft}
                      onChange={e => setExpiryDraft(e.target.value)}
                      required
                    />
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
                      <th>Tanggal</th>
                      <th>Jenis</th>
                      <th>Perubahan</th>
                      <th>Saldo</th>
                      <th>Alasan</th>
                      <th>Dicatat oleh</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movementRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-muted">Belum ada pergerakan stok batch</td>
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

import { useEffect, useState } from 'react'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'

interface Material {
  id: string
  name: string
  unit: string
  isActive: boolean
  stock?: number
}

interface Receipt {
  id: string
  materialId: string
  quantity: number
  receivedAt: string
  note?: string | null
  recordedBy?: { username: string; name?: string | null }
  createdAt: string
}

type MovementType = 'RECEIPT' | 'OPENING_BALANCE' | 'PRODUCTION_USAGE' | 'ADJUSTMENT'

interface Movement {
  id: string
  materialId: string
  type: MovementType
  /** Nilai sebagaimana disimpan di ledger (penyesuaian bernilai tanda). */
  quantity: number
  /** Dampak terhadap stok: positif menambah, negatif mengurangi. */
  delta: number
  occurredAt: string
  recordedAt: string
  recordedBy?: { id: string; username: string; name?: string | null }
  reason?: string | null
  sourceId?: string | null
}

const MOVEMENT_LABELS: Record<MovementType, string> = {
  RECEIPT: 'Penerimaan',
  OPENING_BALANCE: 'Saldo Awal',
  PRODUCTION_USAGE: 'Pemakaian Produksi',
  ADJUSTMENT: 'Penyesuaian',
}

/** Tanggal bisnis (YYYY-MM-DD) pada kalender WIB. */
function businessDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' })
}

/** Angka bertanda untuk menampilkan perubahan stok. */
function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toLocaleString('id-ID')}`
}

/**
 * Saldo berjalan per pergerakan, dihitung MUNDUR dari stok terkini:
 * baris terbaru (paling atas) memakai stok saat ini sebagai saldo setelahnya.
 */
function buildMovementRows(rows: Movement[], currentStock?: number) {
  let running = currentStock
  return rows.map((movement) => {
    const balance = running
    if (running !== undefined) {
      running = running - movement.delta
    }
    return { movement, balance }
  })
}

export function MaterialStockPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const [materials, setMaterials] = useState<Material[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [receiptMaterialId, setReceiptMaterialId] = useState('')
  const [loadingReceipts, setLoadingReceipts] = useState(false)

  const [movements, setMovements] = useState<Movement[]>([])
  const [movementMaterialId, setMovementMaterialId] = useState('')
  const [loadingMovements, setLoadingMovements] = useState(false)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({ materialId: '', quantity: '', receivedAt: '', note: '' })
  const [submitting, setSubmitting] = useState(false)

  const [adjForm, setAdjForm] = useState({ materialId: '', quantity: '', reason: '' })
  const [submittingAdj, setSubmittingAdj] = useState(false)

  async function fetchData(): Promise<boolean> {
    try {
      setLoading(true)
      const m = await api.get('/materials')
      const mats = (m.data.data || m.data).map((x: any) => ({
        id: x.id,
        name: x.name,
        unit: x.unit,
        isActive: x.isActive,
        stock: x.stock,
      }))
      setMaterials(mats)
      return true
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat data bahan baku')
      return false
    } finally {
      setLoading(false)
    }
  }

  async function loadReceipts(materialId: string) {
    if (!materialId) {
      setReceipts([])
      return
    }
    setLoadingReceipts(true)
    try {
      const r = await api.get(`/materials/${materialId}/receipts`)
      setReceipts(r.data.data || r.data || [])
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat riwayat penerimaan')
      setReceipts([])
    } finally {
      setLoadingReceipts(false)
    }
  }

  /** Memuat riwayat pergerakan stok; mengembalikan false bila gagal. */
  async function loadMovements(materialId: string): Promise<boolean> {
    if (!materialId) {
      setMovements([])
      return true
    }
    setLoadingMovements(true)
    try {
      const r = await api.get(`/materials/${materialId}/movements`)
      setMovements(r.data.data || r.data || [])
      return true
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat riwayat pergerakan stok')
      setMovements([])
      return false
    } finally {
      setLoadingMovements(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  async function submitReceipt(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await api.post(`/materials/${form.materialId}/receipts`, {
        quantity: Number(form.quantity),
        receivedAt: form.receivedAt || undefined,
        note: form.note || undefined,
      })
      setSuccess('Penerimaan bahan baku berhasil dicatat')
      setForm({ materialId: '', quantity: '', receivedAt: '', note: '' })
      await fetchData()
      if (receiptMaterialId) await loadReceipts(receiptMaterialId)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mencatat penerimaan')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault()
    // Setiap percobaan baru dimulai dari keadaan pesan yang bersih, termasuk
    // saat validasi klien gagal (jangan biarkan pesan sukses lama menempel).
    setError(null)
    setSuccess(null)

    const targetId = adjForm.materialId
    const quantity = Number(adjForm.quantity)
    const reason = adjForm.reason.trim()

    if (!targetId) {
      setError('Pilih bahan baku yang akan disesuaikan.')
      return
    }
    if (!Number.isFinite(quantity) || quantity === 0) {
      setError('Jumlah penyesuaian tidak boleh nol.')
      return
    }
    if (!reason) {
      setError('Alasan penyesuaian wajib diisi.')
      return
    }

    setSubmittingAdj(true)
    try {
      await api.post('/stock-adjustments', {
        targetType: 'MATERIAL',
        targetId,
        quantity,
        reason,
      })
      setAdjForm({ materialId: '', quantity: '', reason: '' })

      // Muat ulang DULU (stok + riwayat), lalu tampilkan pesan sukses agar
      // pesan tidak langsung terhapus oleh pemuatan ulang.
      const stockRefreshed = await fetchData()
      let historyRefreshed = true
      if (!movementMaterialId || movementMaterialId === targetId) {
        setMovementMaterialId(targetId)
        historyRefreshed = await loadMovements(targetId)
      }
      if (stockRefreshed && historyRefreshed) {
        setSuccess('Penyesuaian stok berhasil dicatat')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mencatat penyesuaian stok')
    } finally {
      setSubmittingAdj(false)
    }
  }

  const activeCount = materials.filter(m => m.isActive).length
  const inactiveCount = materials.length - activeCount

  const movementMaterial = materials.find(m => m.id === movementMaterialId)
  const movementRows = buildMovementRows(movements, movementMaterial?.stock)
  const movementUnit = movementMaterial?.unit || ''

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Bahan Baku &amp; Stok</h1>
        <p className="page-subtitle">
          Saldo stok aktual, penerimaan, dan riwayat pergerakan — data dari backend.
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      {/* Ringkasan */}
      <div className="summary-row">
        <div className="summary-item">
          <span className="card-label">Total Bahan</span>
          <span className="summary-value">{materials.length}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Bahan Aktif</span>
          <span className="summary-value">{activeCount}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Diarsipkan</span>
          <span className="summary-value">{inactiveCount}</span>
        </div>
      </div>

      {/* Stok per bahan */}
      <section className="card section-card">
        <h2 className="card-title">Stok per Bahan Baku</h2>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Bahan Baku</th>
                <th>Satuan</th>
                <th>Stok Aktual</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4}>Memuat...</td></tr>
              ) : materials.length === 0 ? (
                <tr><td colSpan={4} className="text-muted">Belum ada bahan baku</td></tr>
              ) : (
                materials.map(m => (
                  <tr key={m.id}>
                    <td className="cell-primary">{m.name}</td>
                    <td>{m.unit}</td>
                    <td className="num">
                      <strong>{m.stock !== undefined ? m.stock.toLocaleString('id-ID') : '-'}</strong>
                    </td>
                    <td>
                      {m.isActive ? (
                        <span className="badge success">Aktif</span>
                      ) : (
                        <span className="badge neutral">Nonaktif</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Riwayat pergerakan stok (Admin & Operator) */}
      <section className="card section-card">
        <div className="section-head">
          <h2 className="card-title">Riwayat Pergerakan Stok</h2>
          <div className="field" style={{ minWidth: '240px' }}>
            <label htmlFor="movement-material">Bahan baku</label>
            <select
              id="movement-material"
              value={movementMaterialId}
              onChange={(e) => {
                const value = e.target.value
                setMovementMaterialId(value)
                loadMovements(value)
              }}
            >
              <option value="">Pilih bahan baku</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-muted">
          Riwayat hanya dapat dilihat — tidak dapat diedit atau dihapus. Kejadian terbaru
          berada paling atas; saldo dihitung mundur dari stok terkini.
        </p>
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
              {!movementMaterialId ? (
                <tr><td colSpan={6} className="text-muted">Pilih bahan baku untuk melihat riwayat pergerakan stok</td></tr>
              ) : loadingMovements ? (
                <tr><td colSpan={6}>Memuat riwayat...</td></tr>
              ) : movementRows.length === 0 ? (
                <tr><td colSpan={6} className="text-muted">Belum ada pergerakan stok</td></tr>
              ) : (
                movementRows.map(({ movement, balance }) => (
                  <tr key={movement.id}>
                    <td>{businessDate(movement.occurredAt)}</td>
                    <td>{MOVEMENT_LABELS[movement.type] || movement.type}</td>
                    <td className="num">
                      <strong>{signed(movement.delta)}</strong>{' '}
                      <span className="text-muted">{movementUnit}</span>
                    </td>
                    <td className="num">
                      {balance !== undefined ? balance.toLocaleString('id-ID') : '-'}{' '}
                      <span className="text-muted">{movementUnit}</span>
                    </td>
                    <td className="text-muted">{movement.reason || '-'}</td>
                    <td>{movement.recordedBy?.username || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Penyesuaian stok — hanya Admin (backend juga menegakkan) */}
      {isAdmin && (
        <section className="card section-card">
          <h2 className="card-title">Penyesuaian Stok</h2>
          <p className="text-muted">
            Jumlah bernilai tanda: positif menambah stok, negatif mengurangi. Alasan wajib
            diisi dan tercatat permanen pada riwayat pergerakan.
          </p>
          <form onSubmit={submitAdjustment} className="form-row">
            <div className="field">
              <label htmlFor="adj-material">Bahan Baku</label>
              <select
                id="adj-material"
                value={adjForm.materialId}
                onChange={e => setAdjForm(f => ({ ...f, materialId: e.target.value }))}
                required
              >
                <option value="">Pilih bahan baku</option>
                {materials.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="adj-quantity">Jumlah (bertanda)</label>
              <input
                id="adj-quantity"
                type="number"
                step="0.001"
                value={adjForm.quantity}
                onChange={e => setAdjForm(f => ({ ...f, quantity: e.target.value }))}
                placeholder="cth. -2.5"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="adj-reason">Alasan</label>
              <input
                id="adj-reason"
                value={adjForm.reason}
                onChange={e => setAdjForm(f => ({ ...f, reason: e.target.value }))}
                required
              />
            </div>
            <div className="form-actions">
              <button className="button" disabled={submittingAdj}>
                {submittingAdj ? 'Menyimpan...' : 'Catat Penyesuaian'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Form penerimaan */}
      <section className="card section-card">
        <h2 className="card-title">Catat Penerimaan Bahan Baku</h2>
        <form onSubmit={submitReceipt} className="form-row">
          <div className="field">
            <label htmlFor="rs-material">Bahan Baku</label>
            <select
              id="rs-material"
              value={form.materialId}
              onChange={e => setForm(f => ({ ...f, materialId: e.target.value }))}
              required
            >
              <option value="">Pilih bahan baku</option>
              {materials.filter(m => m.isActive).map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rs-qty">Jumlah</label>
            <input
              id="rs-qty"
              type="number"
              step="0.001"
              min="0"
              value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="rs-date">Tanggal Penerimaan (opsional)</label>
            <input
              id="rs-date"
              type="date"
              value={form.receivedAt}
              onChange={e => setForm(f => ({ ...f, receivedAt: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="rs-note">Catatan (opsional)</label>
            <input
              id="rs-note"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            />
          </div>
          <div className="form-actions">
            <button className="button" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Catat Penerimaan'}
            </button>
          </div>
        </form>
      </section>

      {/* Riwayat penerimaan */}
      <section className="card section-card">
        <div className="section-head">
          <h2 className="card-title">Riwayat Penerimaan</h2>
          <div className="field" style={{ minWidth: '240px' }}>
            <label htmlFor="receipt-material">Bahan baku</label>
            <select
              id="receipt-material"
              value={receiptMaterialId}
              onChange={(e) => { setReceiptMaterialId(e.target.value); loadReceipts(e.target.value) }}
            >
              <option value="">Pilih bahan baku</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Bahan</th>
                <th>Jumlah</th>
                <th>Tanggal Terima</th>
                <th>Dicatat oleh</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {!receiptMaterialId ? (
                <tr><td colSpan={5} className="text-muted">Pilih bahan baku untuk melihat riwayat penerimaan</td></tr>
              ) : loadingReceipts ? (
                <tr><td colSpan={5}>Memuat riwayat...</td></tr>
              ) : receipts.length === 0 ? (
                <tr><td colSpan={5} className="text-muted">Belum ada riwayat penerimaan</td></tr>
              ) : (
                receipts.slice(0, 20).map(r => (
                  <tr key={r.id}>
                    <td>{materials.find(m => m.id === r.materialId)?.name || r.materialId}</td>
                    <td className="num">
                      {Number(r.quantity).toLocaleString('id-ID')}{' '}
                      <span className="text-muted">{materials.find(m => m.id === r.materialId)?.unit || ''}</span>
                    </td>
                    <td>{r.receivedAt || new Date(r.createdAt).toISOString().slice(0, 10)}</td>
                    <td>{r.recordedBy?.username || '-'}</td>
                    <td className="text-muted">{r.note || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

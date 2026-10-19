import { useEffect, useState } from 'react'
import api from '../lib/api'
import { Drawer } from '../components/Drawer'
import { useAuth } from '../hooks/useAuth'

interface Material {
  id: string
  name: string
  unit: string
  description?: string | null
  stock?: number
  isActive: boolean
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

const EMPTY_FORM = { name: '', unit: '', description: '' }

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

/**
 * Halaman gabungan "Bahan Baku" (Fase D): master bahan baku, stok aktual,
 * riwayat pergerakan, penyesuaian (Admin), penerimaan, dan saldo awal (Admin).
 * Semua data berasal dari backend — tidak ada aturan bisnis baru di sini.
 */
export function MaterialsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Master: tambah bahan (Admin — ditegakkan backend)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  // Riwayat pergerakan stok (Admin & Operator)
  const [movements, setMovements] = useState<Movement[]>([])
  const [movementMaterialId, setMovementMaterialId] = useState('')
  const [loadingMovements, setLoadingMovements] = useState(false)

  // Penyesuaian stok (Admin)
  const [adjForm, setAdjForm] = useState({ materialId: '', quantity: '', reason: '' })
  const [submittingAdj, setSubmittingAdj] = useState(false)

  // Penerimaan bahan baku (Admin & Operator)
  const [receiptForm, setReceiptForm] = useState({ materialId: '', quantity: '', receivedAt: '', note: '' })
  const [submittingReceipt, setSubmittingReceipt] = useState(false)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [receiptMaterialId, setReceiptMaterialId] = useState('')
  const [loadingReceipts, setLoadingReceipts] = useState(false)

  // Saldo awal bahan baku (Admin)
  const [obForm, setObForm] = useState({ materialId: '', quantity: '', date: '', reason: '' })
  const [submittingOb, setSubmittingOb] = useState(false)

  async function fetchMaterials(): Promise<boolean> {
    try {
      setLoading(true)
      const res = await api.get('/materials')
      setMaterials(res.data.data || res.data)
      return true
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat bahan baku')
      return false
    } finally {
      setLoading(false)
    }
  }

  async function loadMovements(materialId: string): Promise<boolean> {
    if (!materialId) {
      setMovements([])
      return true
    }
    setLoadingMovements(true)
    try {
      const res = await api.get(`/materials/${materialId}/movements`)
      setMovements(res.data.data || res.data || [])
      return true
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat riwayat pergerakan stok')
      setMovements([])
      return false
    } finally {
      setLoadingMovements(false)
    }
  }

  async function loadReceipts(materialId: string) {
    if (!materialId) {
      setReceipts([])
      return
    }
    setLoadingReceipts(true)
    try {
      const res = await api.get(`/materials/${materialId}/receipts`)
      setReceipts(res.data.data || res.data || [])
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat riwayat penerimaan')
      setReceipts([])
    } finally {
      setLoadingReceipts(false)
    }
  }

  useEffect(() => {
    fetchMaterials()
  }, [])

  function openDrawer() {
    setForm(EMPTY_FORM)
    setError(null)
    setDrawerOpen(true)
  }

  async function createMaterial(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await api.post('/materials', {
        name: form.name,
        unit: form.unit,
        description: form.description || undefined,
      })
      setSuccess('Bahan baku berhasil ditambahkan')
      setDrawerOpen(false)
      await fetchMaterials()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal menambah bahan baku')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    try {
      await api.patch(`/materials/${id}`, { isActive: !current })
      await fetchMaterials()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mengubah status')
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
      const stockRefreshed = await fetchMaterials()
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

  async function submitReceipt(e: React.FormEvent) {
    e.preventDefault()
    setSubmittingReceipt(true)
    setError(null)
    setSuccess(null)
    try {
      await api.post(`/materials/${receiptForm.materialId}/receipts`, {
        quantity: Number(receiptForm.quantity),
        receivedAt: receiptForm.receivedAt || undefined,
        note: receiptForm.note || undefined,
      })
      setSuccess('Penerimaan bahan baku berhasil dicatat')
      setReceiptForm({ materialId: '', quantity: '', receivedAt: '', note: '' })
      await fetchMaterials()
      if (receiptMaterialId) await loadReceipts(receiptMaterialId)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mencatat penerimaan')
    } finally {
      setSubmittingReceipt(false)
    }
  }

  async function submitOpeningBalance(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const materialId = obForm.materialId
    const quantity = Number(obForm.quantity)
    const date = obForm.date
    const reason = obForm.reason.trim()

    if (!materialId) {
      setError('Pilih bahan baku untuk saldo awal.')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Jumlah saldo awal harus lebih besar dari nol.')
      return
    }
    if (!date) {
      setError('Tanggal saldo awal wajib diisi.')
      return
    }
    if (!reason) {
      setError('Alasan saldo awal wajib diisi.')
      return
    }

    setSubmittingOb(true)
    try {
      await api.post(`/materials/${materialId}/opening-balances`, { quantity, date, reason })
      setObForm({ materialId: '', quantity: '', date: '', reason: '' })

      // Saldo awal menambah stok DAN membuat pergerakan baru — segarkan
      // keduanya dulu, baru tampilkan pesan sukses.
      const stockRefreshed = await fetchMaterials()
      let historyRefreshed = true
      if (!movementMaterialId || movementMaterialId === materialId) {
        setMovementMaterialId(materialId)
        historyRefreshed = await loadMovements(materialId)
      }
      if (stockRefreshed && historyRefreshed) {
        setSuccess('Saldo awal bahan baku berhasil dicatat')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mencatat saldo awal')
    } finally {
      setSubmittingOb(false)
    }
  }

  const activeCount = materials.filter((m) => m.isActive).length
  const inactiveCount = materials.length - activeCount

  const activeMaterials = materials.filter((m) => m.isActive)
  const movementMaterial = materials.find((m) => m.id === movementMaterialId)
  const movementRows = buildMovementRows(movements, movementMaterial?.stock)
  const movementUnit = movementMaterial?.unit || ''

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Bahan Baku</h1>
        <p className="page-subtitle">
          Master bahan baku, stok aktual, penerimaan, saldo awal, riwayat pergerakan, dan
          penyesuaian — data dari backend.
        </p>
      </div>

      {error && !drawerOpen && <div className="alert error">{error}</div>}
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

      {/* Daftar bahan baku + stok aktual (satu tabel) */}
      <section className="card section-card">
        <div className="toolbar">
          <h2 className="card-title">Daftar Bahan Baku</h2>
          <button className="button" onClick={openDrawer}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
            Tambah Bahan
          </button>
        </div>

        {loading ? (
          <p className="text-muted">Memuat bahan baku...</p>
        ) : materials.length === 0 ? (
          <p className="text-muted">Belum ada bahan baku. Klik “Tambah Bahan” untuk menambah.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Nama Bahan</th>
                  <th>Satuan</th>
                  <th>Stok Aktual</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="cell-primary">{m.name}</div>
                      {m.description && <div className="cell-secondary">{m.description}</div>}
                    </td>
                    <td>{m.unit}</td>
                    <td className="num">
                      <strong>{Number(m.stock ?? 0).toLocaleString('id-ID')}</strong>
                    </td>
                    <td>
                      {m.isActive ? (
                        <span className="badge success">Aktif</span>
                      ) : (
                        <span className="badge neutral">Nonaktif</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="button secondary"
                        onClick={() => toggleActive(m.id, m.isActive)}
                      >
                        {m.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

      {/* Penerimaan bahan baku (Admin & Operator) */}
      <section className="card section-card">
        <h2 className="card-title">Catat Penerimaan Bahan Baku</h2>
        <form onSubmit={submitReceipt} className="form-row">
          <div className="field">
            <label htmlFor="rs-material">Bahan Baku</label>
            <select
              id="rs-material"
              value={receiptForm.materialId}
              onChange={e => setReceiptForm(f => ({ ...f, materialId: e.target.value }))}
              required
            >
              <option value="">Pilih bahan baku</option>
              {activeMaterials.map(m => (
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
              value={receiptForm.quantity}
              onChange={e => setReceiptForm(f => ({ ...f, quantity: e.target.value }))}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="rs-date">Tanggal Penerimaan (opsional)</label>
            <input
              id="rs-date"
              type="date"
              value={receiptForm.receivedAt}
              onChange={e => setReceiptForm(f => ({ ...f, receivedAt: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="rs-note">Catatan (opsional)</label>
            <input
              id="rs-note"
              value={receiptForm.note}
              onChange={e => setReceiptForm(f => ({ ...f, note: e.target.value }))}
            />
          </div>
          <div className="form-actions">
            <button className="button" disabled={submittingReceipt}>
              {submittingReceipt ? 'Menyimpan...' : 'Catat Penerimaan'}
            </button>
          </div>
        </form>
      </section>

      {/* Saldo awal bahan baku — hanya Admin (README 5.2) */}
      {isAdmin && (
        <section className="card section-card">
          <h2 className="card-title">Catat Saldo Awal Bahan Baku</h2>
          <p className="text-muted">
            Saldo awal dicatat terpisah dari penerimaan biasa dan tidak menghitung stok dua
            kali. Tanggal, alasan, dan pengguna pencatat wajib tercatat.
          </p>
          <form onSubmit={submitOpeningBalance} className="form-row">
            <div className="field">
              <label htmlFor="ob-material">Bahan Baku</label>
              <select
                id="ob-material"
                value={obForm.materialId}
                onChange={e => setObForm(f => ({ ...f, materialId: e.target.value }))}
                required
              >
                <option value="">Pilih bahan baku</option>
                {activeMaterials.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ob-qty">Jumlah</label>
              <input
                id="ob-qty"
                type="number"
                step="0.001"
                min="0"
                value={obForm.quantity}
                onChange={e => setObForm(f => ({ ...f, quantity: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="ob-date">Tanggal Saldo Awal</label>
              <input
                id="ob-date"
                type="date"
                value={obForm.date}
                onChange={e => setObForm(f => ({ ...f, date: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="ob-reason">Alasan</label>
              <input
                id="ob-reason"
                value={obForm.reason}
                onChange={e => setObForm(f => ({ ...f, reason: e.target.value }))}
                required
              />
            </div>
            <div className="form-actions">
              <button className="button" disabled={submittingOb}>
                {submittingOb ? 'Menyimpan...' : 'Catat Saldo Awal'}
              </button>
            </div>
          </form>
        </section>
      )}

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

      <Drawer open={drawerOpen} title="Tambah Bahan Baku" onClose={() => setDrawerOpen(false)}>
        {error && <div className="alert error">{error}</div>}
        <form onSubmit={createMaterial} className="drawer-form">
          <div className="field">
            <label htmlFor="m-name">Nama Bahan</label>
            <input
              id="m-name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Contoh: Sapi Segar"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="m-unit">Satuan Dasar</label>
            <input
              id="m-unit"
              value={form.unit}
              onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
              placeholder="Contoh: kg"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="m-desc">Deskripsi (opsional)</label>
            <textarea
              id="m-desc"
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="drawer-actions">
            <button type="button" className="button secondary" onClick={() => setDrawerOpen(false)}>
              Batal
            </button>
            <button className="button" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan Bahan'}
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  )
}

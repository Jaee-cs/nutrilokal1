import { useEffect, useState } from 'react'
import api from '../lib/api'
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

type TabKey = 'list' | 'add' | 'adjust' | 'receipt'

const MOVEMENT_LABELS: Record<MovementType, string> = {
  RECEIPT: 'Penerimaan',
  OPENING_BALANCE: 'Saldo Awal',
  PRODUCTION_USAGE: 'Pemakaian Produksi',
  ADJUSTMENT: 'Penyesuaian',
}

const EMPTY_ADD = { name: '', unit: '', description: '' }
const EMPTY_ADD_OB = { quantity: '', date: '', reason: '' }
const EMPTY_OB = { materialId: '', quantity: '', date: '', reason: '' }
const EMPTY_ADJ = { materialId: '', quantity: '', reason: '' }
const EMPTY_RECEIPT = { materialId: '', quantity: '', receivedAt: '', note: '' }

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
 * Halaman "Bahan Baku" dengan navigasi tab: Daftar Bahan, Tambah Bahan
 * (termasuk saldo awal opsional), Penyesuaian Stok (Admin), dan Penerimaan.
 * Semua data dan aturan berasal dari backend — tidak ada aturan bisnis baru.
 */
export function MaterialsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'

  const [tab, setTab] = useState<TabKey>('list')
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Material | null>(null)

  // Tambah bahan baku (+ saldo awal opsional dalam satu alur, Admin)
  const [addForm, setAddForm] = useState(EMPTY_ADD)
  const [obEnabled, setObEnabled] = useState(false)
  const [addObForm, setAddObForm] = useState(EMPTY_ADD_OB)
  const [submittingAdd, setSubmittingAdd] = useState(false)

  // Saldo awal bahan yang sudah ada (Admin)
  const [obForm, setObForm] = useState(EMPTY_OB)
  const [submittingOb, setSubmittingOb] = useState(false)

  // Riwayat pergerakan stok (Admin & Operator)
  const [movements, setMovements] = useState<Movement[]>([])
  const [movementMaterialId, setMovementMaterialId] = useState('')
  const [loadingMovements, setLoadingMovements] = useState(false)

  // Penyesuaian stok (Admin)
  const [adjForm, setAdjForm] = useState(EMPTY_ADJ)
  const [submittingAdj, setSubmittingAdj] = useState(false)

  // Penerimaan bahan baku (Admin & Operator)
  const [receiptForm, setReceiptForm] = useState(EMPTY_RECEIPT)
  const [submittingReceipt, setSubmittingReceipt] = useState(false)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [receiptMaterialId, setReceiptMaterialId] = useState('')
  const [loadingReceipts, setLoadingReceipts] = useState(false)

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

  async function loadReceipts(materialId: string): Promise<boolean> {
    if (!materialId) {
      setReceipts([])
      return true
    }
    setLoadingReceipts(true)
    try {
      const res = await api.get(`/materials/${materialId}/receipts`)
      setReceipts(res.data.data || res.data || [])
      return true
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat riwayat penerimaan')
      setReceipts([])
      return false
    } finally {
      setLoadingReceipts(false)
    }
  }

  useEffect(() => {
    fetchMaterials()
  }, [])

  // Tab yang tersedia mengikuti hak akses backend: menambah bahan, menonaktifkan
  // bahan, dan penyesuaian stok hanya Admin; penerimaan juga untuk Operator.
  const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
    { key: 'list', label: 'Daftar Bahan', icon: 'list_alt' },
    ...(isAdmin ? [{ key: 'add' as TabKey, label: 'Tambah Bahan', icon: 'add_box' }] : []),
    ...(isAdmin ? [{ key: 'adjust' as TabKey, label: 'Penyesuaian Stok', icon: 'tune' }] : []),
    { key: 'receipt', label: 'Penerimaan', icon: 'move_to_inbox' },
  ]
  const activeTab: TabKey = tabs.some((t) => t.key === tab) ? tab : 'list'

  /** Perpindahan tab tidak pernah mengirim formulir; pesan lama dibersihkan
      agar tidak ada umpan balik dari tab lain yang menyesatkan. */
  function selectTab(key: TabKey) {
    if (key === activeTab) return
    setTab(key)
    setError(null)
    setSuccess(null)
  }

  /**
   * Tambah bahan baku; saldo awal (opsional) dicatat SEKALI dalam alur yang
   * sama setelah bahan berhasil dibuat. Bila saldo awal gagal, bahan tetap
   * ada dan pengguna diberi tahu supaya tidak mengulang pembuatan bahan.
   */
  async function createMaterial(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!addForm.name.trim()) {
      setError('Nama bahan wajib diisi.')
      return
    }
    if (!addForm.unit.trim()) {
      setError('Satuan bahan wajib diisi.')
      return
    }
    if (obEnabled) {
      const obQuantity = Number(addObForm.quantity)
      if (!Number.isFinite(obQuantity) || obQuantity <= 0) {
        setError('Jumlah saldo awal harus lebih besar dari nol.')
        return
      }
      if (!addObForm.date) {
        setError('Tanggal saldo awal wajib diisi.')
        return
      }
      if (!addObForm.reason.trim()) {
        setError('Alasan saldo awal wajib diisi.')
        return
      }
    }

    setSubmittingAdd(true)
    try {
      const created = await api.post('/materials', {
        name: addForm.name,
        unit: addForm.unit,
        description: addForm.description || undefined,
      })
      const newMaterial: Material = created.data.material

      let openingBalanceError: string | null = null
      if (obEnabled) {
        try {
          await api.post(`/materials/${newMaterial.id}/opening-balances`, {
            quantity: Number(addObForm.quantity),
            date: addObForm.date,
            reason: addObForm.reason.trim(),
          })
        } catch (err: any) {
          openingBalanceError = err.response?.data?.message || 'Gagal mencatat saldo awal'
        }
      }

      // Segarkan daftar dulu, baru tampilkan pesan.
      const refreshed = await fetchMaterials()
      if (refreshed) {
        if (openingBalanceError) {
          setError(
            `Bahan baku "${newMaterial.name}" berhasil ditambahkan, tetapi saldo awal gagal dicatat: ${openingBalanceError}`
          )
        } else if (obEnabled) {
          setSuccess(
            `Bahan baku "${newMaterial.name}" berhasil ditambahkan beserta saldo awal ${Number(addObForm.quantity).toLocaleString('id-ID')} ${newMaterial.unit}`
          )
        } else {
          setSuccess(`Bahan baku "${newMaterial.name}" berhasil ditambahkan`)
        }
      }

      // Kosongkan formulir, termasuk centang saldo awal, agar tidak tercatat dua kali.
      setAddForm(EMPTY_ADD)
      setAddObForm(EMPTY_ADD_OB)
      setObEnabled(false)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal menambah bahan baku')
    } finally {
      setSubmittingAdd(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    setError(null)
    setSuccess(null)
    try {
      await api.patch(`/materials/${id}`, { isActive: !current })
      const refreshed = await fetchMaterials()
      if (refreshed) {
        setSuccess(current ? 'Bahan baku dinonaktifkan' : 'Bahan baku diaktifkan kembali')
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mengubah status')
    }
  }

  function openDeleteDialog(m: Material) {
    setError(null)
    setSuccess(null)
    setDeleteTarget(m)
  }

  function closeDeleteDialog() {
    if (deletingId) return
    setDeleteTarget(null)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setError(null)
    setSuccess(null)
    setDeletingId(deleteTarget.id)
    try {
      const res = await api.delete(`/materials/${deleteTarget.id}`)
      const message = res.data?.message || `Bahan baku "${deleteTarget.name}" berhasil dihapus.`
      setMaterials(prev => prev.filter(m => m.id !== deleteTarget.id))
      setDeleteTarget(null)
      setSuccess(message)
      if (movementMaterialId === deleteTarget.id) {
        setMovementMaterialId('')
        setMovements([])
      }
      if (receiptMaterialId === deleteTarget.id) {
        setReceiptMaterialId('')
        setReceipts([])
      }
      if (adjForm.materialId === deleteTarget.id) {
        setAdjForm(EMPTY_ADJ)
      }
      if (receiptForm.materialId === deleteTarget.id) {
        setReceiptForm(EMPTY_RECEIPT)
      }
      if (obForm.materialId === deleteTarget.id) {
        setObForm(EMPTY_OB)
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal menghapus bahan baku')
    } finally {
      setDeletingId(null)
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
      setAdjForm(EMPTY_ADJ)

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
    setError(null)
    setSuccess(null)

    const targetId = receiptForm.materialId
    const quantity = Number(receiptForm.quantity)
    if (!targetId) {
      setError('Pilih bahan baku yang diterima.')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Jumlah penerimaan harus lebih besar dari nol.')
      return
    }

    setSubmittingReceipt(true)
    try {
      await api.post(`/materials/${targetId}/receipts`, {
        quantity,
        receivedAt: receiptForm.receivedAt || undefined,
        note: receiptForm.note || undefined,
      })
      setReceiptForm(EMPTY_RECEIPT)

      // Segarkan stok dan riwayat penerimaan, baru tampilkan pesan sukses.
      const stockRefreshed = await fetchMaterials()
      const historyTarget = receiptMaterialId || targetId
      setReceiptMaterialId(historyTarget)
      const historyRefreshed = await loadReceipts(historyTarget)
      if (stockRefreshed && historyRefreshed) {
        setSuccess('Penerimaan bahan baku berhasil dicatat')
      }
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
      setObForm(EMPTY_OB)

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
  const adjMaterial = materials.find((m) => m.id === adjForm.materialId)

  return (
    <div className="container materials-page">
      <div className="page-head">
        <h1 className="page-title">Bahan Baku</h1>
        <p className="page-subtitle">
          Master bahan baku, stok aktual, penerimaan, saldo awal, riwayat pergerakan, dan
          penyesuaian — seluruh data berasal dari backend.
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      {/* Ringkasan stok */}
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

      {/* Navigasi tab (responsif: dapat digulir mendatar pada layar sempit) */}
      <div className="tab-nav" role="tablist" aria-label="Bagian halaman bahan baku">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`tab-${item.key}`}
            aria-selected={activeTab === item.key}
            aria-controls={`panel-${item.key}`}
            className="tab-btn"
            onClick={() => selectTab(item.key)}
          >
            <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18 }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Tab: Daftar Bahan                                                */}
      {/* ---------------------------------------------------------------- */}
      {activeTab === 'list' && (
        <div className="tab-panel" role="tabpanel" id="panel-list" aria-labelledby="tab-list">
          <section className="card section-card">
            <div className="toolbar">
              <h2 className="card-title">Daftar Bahan Baku</h2>
              {isAdmin && (
                <button type="button" className="button" onClick={() => selectTab('add')}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
                  Tambah Bahan
                </button>
              )}
            </div>

            {loading ? (
              <p className="text-muted">Memuat bahan baku...</p>
            ) : materials.length === 0 ? (
              <p className="text-muted">
                Belum ada bahan baku.
                {isAdmin ? ' Gunakan tab “Tambah Bahan” untuk menambah.' : ' Hubungi Admin untuk menambah bahan.'}
              </p>
            ) : (
              <>
                {/* Desktop: tabel */}
                <div className="table-wrapper desktop-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Nama Bahan</th>
                        <th>Satuan</th>
                        <th>Stok Aktual</th>
                        <th>Status</th>
                        {isAdmin && <th>Aksi</th>}
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
                          {isAdmin && (
                            <td>
                              <div className="row-actions">
                                <button
                                  type="button"
                                  className="button secondary"
                                  onClick={() => toggleActive(m.id, m.isActive)}
                                >
                                  {m.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                                </button>
                                <button
                                  type="button"
                                  className="button danger-outline"
                                  onClick={() => openDeleteDialog(m)}
                                  title="Hapus bahan baku"
                                >
                                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                                  Hapus
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: kartu bahan baku */}
                <div className="mobile-list">
                  {materials.map((m) => (
                    <article className="material-item" key={m.id}>
                      <div className="material-item-main">
                        <div className="material-item-name">{m.name}</div>
                        {m.description && <div className="material-item-desc">{m.description}</div>}
                        <div className="material-item-meta">
                          <span className="material-item-stock">
                            <strong>{Number(m.stock ?? 0).toLocaleString('id-ID')}</strong>
                            <span className="unit">{m.unit}</span>
                          </span>
                          {m.isActive ? (
                            <span className="badge success">Aktif</span>
                          ) : (
                            <span className="badge neutral">Nonaktif</span>
                          )}
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="material-item-action">
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => toggleActive(m.id, m.isActive)}
                          >
                            {m.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                          <button
                            type="button"
                            className="button danger-outline material-item-delete"
                            onClick={() => openDeleteDialog(m)}
                            aria-label={`Hapus bahan baku ${m.name}`}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Riwayat pergerakan stok (Admin & Operator) */}
          <section className="card section-card">
            <div className="section-head">
              <h2 className="card-title">Riwayat Pergerakan Stok</h2>
              <div className="field filter-field">
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
            <div className="table-wrapper desktop-table">
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

            {/* Mobile: kartu riwayat pergerakan */}
            <div className="mobile-list">
              {!movementMaterialId ? (
                <p className="text-muted">Pilih bahan baku untuk melihat riwayat pergerakan stok</p>
              ) : loadingMovements ? (
                <p className="text-muted">Memuat riwayat...</p>
              ) : movementRows.length === 0 ? (
                <p className="text-muted">Belum ada pergerakan stok</p>
              ) : (
                movementRows.map(({ movement, balance }) => (
                  <article className="history-item history-item-split" key={movement.id}>
                    <div className="history-item-main">
                      <div className="history-item-type">{MOVEMENT_LABELS[movement.type] || movement.type}</div>
                      <div className="history-item-date">{businessDate(movement.occurredAt)}</div>
                      {movement.reason && <div className="history-item-note">{movement.reason}</div>}
                      <div className="history-item-note">Dicatat oleh: {movement.recordedBy?.username || '-'}</div>
                    </div>
                    {/* Kanan: jumlah perubahan (numerik utama) + saldo setelahnya */}
                    <div className="history-item-amount">
                      <span className={`history-item-delta ${movement.delta >= 0 ? 'plus' : 'minus'}`}>
                        <strong>{signed(movement.delta)}</strong>
                        <span className="unit">{movementUnit}</span>
                      </span>
                      <span className="history-item-balance">
                        Saldo: {balance !== undefined ? balance.toLocaleString('id-ID') : '-'} {movementUnit}
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Tab: Tambah Bahan (+ saldo awal opsional) — hanya Admin          */}
      {/* ---------------------------------------------------------------- */}
      {activeTab === 'add' && isAdmin && (
        <div className="tab-panel" role="tabpanel" id="panel-add" aria-labelledby="tab-add">
          <section className="card section-card">
            <h2 className="card-title">Tambah Bahan Baku</h2>
            <p className="text-muted">
              Isi data bahan baru. Saldo awal bersifat opsional — centang bagian saldo awal hanya
              bila jumlah awal bahan ini benar-benar diketahui. Saldo awal dicatat satu kali
              bersama bahan baru.
            </p>
            <form onSubmit={createMaterial} className="material-form">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="m-name">Nama Bahan</label>
                  <input
                    id="m-name"
                    value={addForm.name}
                    onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Contoh: Sapi Segar"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="m-unit">Satuan Dasar</label>
                  <input
                    id="m-unit"
                    value={addForm.unit}
                    onChange={e => setAddForm(f => ({ ...f, unit: e.target.value }))}
                    placeholder="Contoh: kg"
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="m-desc">Deskripsi (opsional)</label>
                <textarea
                  id="m-desc"
                  rows={2}
                  value={addForm.description}
                  onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="optional-block">
                <div className="checkbox-row">
                  <input
                    id="ob-enable"
                    type="checkbox"
                    checked={obEnabled}
                    onChange={e => {
                      setObEnabled(e.target.checked)
                      if (!e.target.checked) setAddObForm(EMPTY_ADD_OB)
                    }}
                  />
                  <label htmlFor="ob-enable">Catat saldo awal sekaligus (opsional)</label>
                </div>
                {obEnabled ? (
                  <div className="form-row" style={{ marginTop: '1rem' }}>
                    <div className="field">
                      <label htmlFor="ob-qty-new">Jumlah Saldo Awal</label>
                      <input
                        id="ob-qty-new"
                        type="number"
                        step="0.001"
                        min="0"
                        value={addObForm.quantity}
                        onChange={e => setAddObForm(f => ({ ...f, quantity: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="ob-date-new">Tanggal Saldo Awal</label>
                      <input
                        id="ob-date-new"
                        type="date"
                        value={addObForm.date}
                        onChange={e => setAddObForm(f => ({ ...f, date: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="ob-reason-new">Alasan</label>
                      <input
                        id="ob-reason-new"
                        value={addObForm.reason}
                        onChange={e => setAddObForm(f => ({ ...f, reason: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-muted optional-hint">
                    Tanpa saldo awal, bahan tetap dibuat dengan stok 0 dan dapat menerima
                    penerimaan atau saldo awal susulan.
                  </p>
                )}
              </div>

              <div className="form-actions">
                <button className="button" disabled={submittingAdd}>
                  {submittingAdd
                    ? 'Menyimpan...'
                    : obEnabled ? 'Simpan Bahan + Saldo Awal' : 'Simpan Bahan'}
                </button>
              </div>
            </form>
          </section>

          <section className="card section-card">
            <h2 className="card-title">Catat Saldo Awal Bahan yang Sudah Ada</h2>
            <p className="text-muted">
              Untuk bahan yang sudah terdaftar tetapi saldo awalnya belum tercatat. Bahan baru
              cukup dicatat lewat formulir di atas — jangan mencatat saldo awal dua kali untuk
              bahan yang sama. Tanggal, alasan, dan pengguna pencatat tersimpan pada riwayat
              pergerakan.
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
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Tab: Penyesuaian Stok — hanya Admin (backend juga menegakkan)    */}
      {/* ---------------------------------------------------------------- */}
      {activeTab === 'adjust' && isAdmin && (
        <div className="tab-panel" role="tabpanel" id="panel-adjust" aria-labelledby="tab-adjust">
          <section className="card section-card">
            <h2 className="card-title">Penyesuaian Stok</h2>
            <p className="text-muted">
              Jumlah bernilai tanda: positif menambah stok, negatif mengurangi. Alasan wajib
              diisi dan tercatat permanen pada riwayat pergerakan stok.
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
            {adjMaterial && (
              <p className="text-muted optional-hint">
                Stok {adjMaterial.name} saat ini: {Number(adjMaterial.stock ?? 0).toLocaleString('id-ID')} {adjMaterial.unit}
                {' '}— hasil penyesuaian tidak boleh membuat stok menjadi negatif.
              </p>
            )}
          </section>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Tab: Penerimaan (Admin & Operator)                               */}
      {/* ---------------------------------------------------------------- */}
      {activeTab === 'receipt' && (
        <div className="tab-panel" role="tabpanel" id="panel-receipt" aria-labelledby="tab-receipt">
          <section className="card section-card">
            <h2 className="card-title">Catat Penerimaan Bahan Baku</h2>
            <p className="text-muted">
              Penerimaan menambah stok bahan dan tercatat pada riwayat pergerakan stok.
            </p>
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

          {/* Riwayat penerimaan (Admin & Operator) */}
          <section className="card section-card">
            <div className="section-head">
              <h2 className="card-title">Riwayat Penerimaan</h2>
              <div className="field filter-field">
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
            <div className="table-wrapper desktop-table">
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

            {/* Mobile: kartu riwayat penerimaan */}
            <div className="mobile-list">
              {!receiptMaterialId ? (
                <p className="text-muted">Pilih bahan baku untuk melihat riwayat penerimaan</p>
              ) : loadingReceipts ? (
                <p className="text-muted">Memuat riwayat...</p>
              ) : receipts.length === 0 ? (
                <p className="text-muted">Belum ada riwayat penerimaan</p>
              ) : (
                receipts.slice(0, 20).map(r => (
                  <article className="history-item" key={r.id}>
                    <div className="history-item-top">
                      <span className="history-item-date">
                        {r.receivedAt || new Date(r.createdAt).toISOString().slice(0, 10)}
                      </span>
                      <span className="history-item-type">
                        {materials.find(m => m.id === r.materialId)?.name || r.materialId}
                      </span>
                    </div>
                    <div className="history-item-delta plus">
                      <strong>+{Number(r.quantity).toLocaleString('id-ID')}</strong>
                      <span className="unit">{materials.find(m => m.id === r.materialId)?.unit || ''}</span>
                    </div>
                    <div className="history-item-foot">
                      <span className="by">Dicatat oleh: {r.recordedBy?.username || '-'}</span>
                      {r.note && <span className="by">{r.note}</span>}
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {/* Dialog konfirmasi hapus bahan baku (hanya Admin) */}
      {isAdmin && deleteTarget && (
        <div className="modal-root">
          <div className="modal-overlay" onClick={closeDeleteDialog} />
          <div
            className="modal-panel confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
          >
            <div className="modal-head-row">
              <div>
                <h3 className="modal-title" id="confirm-delete-title">Hapus Bahan Baku</h3>
                <p className="modal-subtitle">Tindakan ini tidak dapat dibatalkan.</p>
              </div>
              <button className="icon-btn" onClick={closeDeleteDialog} aria-label="Tutup" disabled={!!deletingId}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="confirm-body">
              <p>
                Bahan baku <strong>{deleteTarget.name}</strong> ({deleteTarget.unit}) akan dihapus
                secara permanen dari daftar bahan baku.
              </p>
              <p className="text-muted">
                Bahan yang sudah memiliki riwayat penerimaan, saldo awal, pemakaian produksi, atau
                penyesuaian stok tidak dapat dihapus — gunakan fitur Nonaktifkan sebagai gantinya.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={closeDeleteDialog}
                disabled={!!deletingId}
              >
                Batal
              </button>
              <button
                type="button"
                className="button danger"
                onClick={confirmDelete}
                disabled={!!deletingId}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>delete</span>
                {deletingId ? 'Menghapus...' : 'Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

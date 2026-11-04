import { useEffect, useState } from 'react'
import api from '../lib/api'
import { Drawer } from '../components/Drawer'
import { PhotoField } from '../components/PhotoField'
import { useAuth } from '../hooks/useAuth'
import { useNotify } from '../components/NotificationProvider'
import { productPhotoUrl, uploadProductPhoto } from '../utils/product-photo'

interface Product {
  id: string
  name: string
  unit: string
  sellingPrice: number
  description?: string | null
  composition?: string | null
  storageInstructions?: string | null
  photoUrl?: string | null
  stock?: number
  batchCount?: number
  isActive: boolean
}

type MovementType =
  | 'PRODUCTION_YIELD'
  | 'YIELD_CORRECTION'
  | 'OPENING_BALANCE'
  | 'ADJUSTMENT'
  | 'SALE'
  | 'SALE_CANCELLATION'

interface ProductStockMovement {
  id: string
  product: { id: string; name: string; unit: string }
  batch: { id: string; code: string; currentStock: number }
  type: MovementType
  quantity: number
  stockIn: number
  stockOut: number
  balanceAfter: number
  batchBalanceAfter: number
  occurredAt: string
  recordedAt: string
  recordedBy: { id: string; username: string; name?: string | null } | null
  reason?: string | null
  reference?: { kind: string; id: string; label: string } | null
  sourceId?: string | null
  isHistoricalFallback: boolean
}

interface ProductBatchOption {
  id: string
  code: string
  stock: number
}

interface ProductHistorySummary {
  movementCount: number
  totalIn: number
  totalOut: number
  currentStock: number
  reconstructedStock: number
  consistent: boolean
  hasHistoricalFallback: boolean
}

const EMPTY_FORM = {
  name: '',
  unit: '',
  sellingPrice: '',
  description: '',
  composition: '',
  storageInstructions: '',
}

const MOVEMENT_LABELS: Record<MovementType, string> = {
  PRODUCTION_YIELD: 'Produksi',
  YIELD_CORRECTION: 'Koreksi Produksi',
  OPENING_BALANCE: 'Saldo Awal',
  ADJUSTMENT: 'Penyesuaian Stok',
  SALE: 'Penjualan',
  SALE_CANCELLATION: 'Pembatalan Penjualan',
}

const MOVEMENT_FILTER_OPTIONS: Array<{ value: MovementType; label: string }> = [
  { value: 'PRODUCTION_YIELD', label: 'Produksi' },
  { value: 'SALE', label: 'Penjualan' },
  { value: 'SALE_CANCELLATION', label: 'Pembatalan Penjualan' },
  { value: 'ADJUSTMENT', label: 'Penyesuaian Stok' },
  { value: 'YIELD_CORRECTION', label: 'Koreksi Produksi' },
  { value: 'OPENING_BALANCE', label: 'Saldo Awal' },
]

const quantityFormatter = new Intl.NumberFormat('id-ID', {
  maximumFractionDigits: 3,
})

function formatQuantity(value: number): string {
  return quantityFormatter.format(value)
}

/** Tanggal bisnis aktivitas pada kalender WIB. */
function movementDate(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** Waktu pencatatan pada kalender WIB (tanggal aktivitas dapat mundur). */
function movementTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function movementRecorder(row: ProductStockMovement): string {
  return row.recordedBy?.name || row.recordedBy?.username || 'Tidak tercatat'
}

export function ProductsPage() {
  const { user } = useAuth()
  const notify = useNotify()
  const isAdmin = user?.role === 'ADMIN'

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  // Kegagalan memuat daftar produk tetap tampil di halaman. Pesan hasil
  // tindakan (simpan, ubah status, hapus, unggah foto) memakai dialog.
  const [loadError, setLoadError] = useState<string | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  // Foto pada form: `undefined` = tidak diubah, `File` = unggah/ganti,
  // `null` = hapus foto yang tersimpan.
  const [photoFile, setPhotoFile] = useState<File | null | undefined>(undefined)
  const [photoNotice, setPhotoNotice] = useState<string | null>(null)

  // Mode edit (hanya Admin): id produk yang sedang diubah + datanya.
  const [editTarget, setEditTarget] = useState<Product | null>(null)

  // Proses hapus berjalan setelah pengguna menyetujui dialog konfirmasi.
  const [deleting, setDeleting] = useState(false)

  // Riwayat pergerakan stok produk (Admin & Operator): seluruh filter
  // dikirim ke backend; tidak ada penyaringan data yang sudah dimuat di UI.
  const [historyProductId, setHistoryProductId] = useState('')
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')
  const [historyType, setHistoryType] = useState('')
  const [historyBatchId, setHistoryBatchId] = useState('')
  const [historyBatches, setHistoryBatches] = useState<ProductBatchOption[]>([])
  const [historyMovements, setHistoryMovements] = useState<ProductStockMovement[]>([])
  const [historySummary, setHistorySummary] = useState<ProductHistorySummary | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  async function fetchProducts(): Promise<boolean> {
    try {
      const res = await api.get('/products')
      setProducts(res.data.data || res.data)
      setLoadError(null)
      return true
    } catch (err: any) {
      setLoadError(err.response?.data?.message || 'Gagal memuat produk')
      return false
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProducts()
  }, [])

  async function loadHistoryBatches(productId: string): Promise<void> {
    if (!productId) {
      setHistoryBatches([])
      return
    }
    try {
      const res = await api.get('/batches', { params: { productId } })
      setHistoryBatches(res.data.data || res.data || [])
    } catch (err: any) {
      setHistoryBatches([])
      setHistoryError(err.response?.data?.message || 'Gagal memuat daftar batch produk')
    }
  }

  async function fetchProductHistory(
    productId = historyProductId,
    overrides: Partial<{ from: string; to: string; type: string; batchId: string }> = {},
  ): Promise<boolean> {
    if (!productId) {
      setHistoryMovements([])
      setHistorySummary(null)
      setHistoryLoaded(false)
      setHistoryError(null)
      return false
    }

    const from = overrides.from ?? historyFrom
    const to = overrides.to ?? historyTo
    const type = overrides.type ?? historyType
    const batchId = overrides.batchId ?? historyBatchId

    if (from && to && from > to) {
      setHistoryError('Tanggal Dari tidak boleh setelah tanggal Sampai.')
      return false
    }

    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const params: Record<string, string> = {}
      if (from) params.from = from
      if (to) params.to = to
      if (type) params.type = type
      if (batchId) params.batchId = batchId

      const res = await api.get(`/products/${productId}/stock-movements`, { params })
      setHistoryMovements(res.data.data || [])
      setHistorySummary(res.data.summary || null)
      setHistoryLoaded(true)
      return true
    } catch (err: any) {
      setHistoryMovements([])
      setHistorySummary(null)
      setHistoryLoaded(false)
      setHistoryError(err.response?.data?.message || 'Gagal memuat riwayat pergerakan stok produk')
      return false
    } finally {
      setHistoryLoading(false)
    }
  }

  /**
   * Memilih produk sekaligus memuat batch dan riwayatnya. Filter tanggal,
   * jenis, dan batch lain baru diterapkan saat tombol Terapkan Filter ditekan.
   */
  async function changeHistoryProduct(productId: string): Promise<void> {
    setHistoryProductId(productId)
    setHistoryBatchId('')
    setHistoryMovements([])
    setHistorySummary(null)
    setHistoryLoaded(false)
    setHistoryError(null)

    if (!productId) {
      setHistoryBatches([])
      return
    }

    await loadHistoryBatches(productId)
    await fetchProductHistory(productId, { batchId: '' })
  }

  async function applyHistoryFilters(e: React.FormEvent) {
    e.preventDefault()
    await fetchProductHistory()
  }

  function resetHistoryFilters() {
    setHistoryProductId('')
    setHistoryFrom('')
    setHistoryTo('')
    setHistoryType('')
    setHistoryBatchId('')
    setHistoryBatches([])
    setHistoryMovements([])
    setHistorySummary(null)
    setHistoryLoading(false)
    setHistoryLoaded(false)
    setHistoryError(null)
  }

  function openDrawer() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setPhotoFile(undefined)
    setPhotoNotice(null)
    setDrawerOpen(true)
  }

  function openEdit(product: Product) {
    setEditTarget(product)
    setForm({
      name: product.name,
      unit: product.unit,
      sellingPrice: String(product.sellingPrice),
      description: product.description ?? '',
      composition: product.composition ?? '',
      storageInstructions: product.storageInstructions ?? '',
    })
    setPhotoFile(undefined)
    setPhotoNotice(null)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setEditTarget(null)
    setPhotoFile(undefined)
    setPhotoNotice(null)
  }

  /**
   * Menyelaraskan foto dengan pilihan pengguna: hapus foto lama, unggah foto
   * baru, atau tidak mengubah apa pun. Mengembalikan pesan kegagalan (atau
   * null) — kegagalan unggah tidak menggagalkan data produk yang sudah
   * tersimpan, tetapi selalu dilaporkan.
   */
  async function syncPhoto(productId: string): Promise<string | null> {
    try {
      if (photoFile === null) {
        await api.delete(`/products/${productId}/photo`)
      } else if (photoFile) {
        await uploadProductPhoto(productId, photoFile)
      }
      return null
    } catch (err: any) {
      return err.response?.data?.message || 'Foto gagal disimpan'
    }
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    let created: Product | null = null
    try {
      const res = await api.post('/products', {
        name: form.name,
        unit: form.unit,
        sellingPrice: Number(form.sellingPrice),
        description: form.description || undefined,
        composition: form.composition || undefined,
        storageInstructions: form.storageInstructions || undefined,
      })
      created = res.data.product as Product
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal menambah produk')
      setSubmitting(false)
      return
    }

    const photoError = created ? await syncPhoto(created.id) : null
    closeDrawer()
    const refreshed = await fetchProducts()
    if (refreshed) {
      if (photoError) {
        notify.warning(`Produk berhasil ditambahkan, tetapi foto gagal disimpan: ${photoError}`)
      } else if (photoFile) {
        notify.success('Produk berhasil ditambahkan beserta fotonya.')
      } else {
        notify.success('Produk berhasil ditambahkan')
      }
    }
    setSubmitting(false)
  }

  async function updateProduct(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return

    setSubmitting(true)
    try {
      await api.patch(`/products/${editTarget.id}`, {
        name: form.name,
        unit: form.unit,
        sellingPrice: Number(form.sellingPrice),
        description: form.description,
        composition: form.composition,
        storageInstructions: form.storageInstructions,
      })
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal menyimpan perubahan produk')
      setSubmitting(false)
      return
    }

    const photoError = await syncPhoto(editTarget.id)
    closeDrawer()
    const refreshed = await fetchProducts()
    if (refreshed) {
      if (photoError) {
        notify.warning(`Perubahan produk tersimpan, tetapi foto gagal disimpan: ${photoError}`)
      } else {
        notify.success('Perubahan produk berhasil disimpan')
      }
    }
    setSubmitting(false)
  }

  async function toggleActive(id: string, current: boolean) {
    try {
      await api.patch(`/products/${id}`, { isActive: !current })
      const refreshed = await fetchProducts()
      if (refreshed) {
        notify.success(current ? 'Produk dinonaktifkan' : 'Produk diaktifkan kembali')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mengubah status')
    }
  }

  /**
   * Konfirmasi hapus memakai dialog terpusat. Rincian stok dan batch tetap
   * ditampilkan agar Admin memahami dampak tindakan sebelum menyetujuinya.
   */
  async function requestDelete(product: Product) {
    const photo = productPhotoUrl(product.photoUrl)
    const confirmed = await notify.confirm({
      title: 'Hapus Produk',
      message: `Produk "${product.name}" akan dihapus dari daftar produk.`,
      tone: 'danger',
      confirmLabel: 'Ya, Hapus',
      cancelLabel: 'Batal',
      details: (
        <>
          {photo && (
            <img
              src={photo}
              alt={`Foto ${product.name}`}
              style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }}
            />
          )}
          <p>
            Stok saat ini: {Number(product.stock ?? 0).toLocaleString('id-ID')} {product.unit} · Batch:{' '}
            {Number(product.batchCount ?? 0).toLocaleString('id-ID')}
          </p>
          <p className="text-muted">
            Produk tanpa riwayat operasional dihapus permanen. Produk yang sudah memiliki riwayat
            akan diarsipkan, dan produk yang stoknya masih tersedia akan ditolak oleh sistem.
          </p>
        </>
      ),
    })
    if (!confirmed) return

    setDeleting(true)
    try {
      // Backend yang menentukan hasil: hapus permanen (tanpa riwayat),
      // arsipkan (punya riwayat), atau tolak (stok masih ada).
      const res = await api.delete(`/products/${product.id}`)
      const refreshed = await fetchProducts()
      if (refreshed) {
        notify.success(res.data?.message || 'Produk berhasil dihapus')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal menghapus produk')
    } finally {
      setDeleting(false)
    }
  }

  const activeCount = products.filter(p => p.isActive).length
  const inactiveCount = products.length - activeCount
  const selectedHistoryProduct = products.find(p => p.id === historyProductId)
  const historyUnit =
    selectedHistoryProduct?.unit || historyMovements[0]?.product.unit || ''

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Kelola Produk KWT</h1>
        <p className="page-subtitle">
          Data produk olahan, satuan dasar, dan harga jual mengikuti backend.
        </p>
      </div>

      {loadError && !drawerOpen && <div className="alert error">{loadError}</div>}

      {/* Ringkasan singkat */}
      <div className="summary-row">
        <div className="summary-item">
          <span className="card-label">Total Produk</span>
          <span className="summary-value">{products.length}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Aktif Diproduksi</span>
          <span className="summary-value">{activeCount}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Diarsipkan</span>
          <span className="summary-value">{inactiveCount}</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <h2 className="card-title">Daftar Produk</h2>
        <button className="button" onClick={openDrawer}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          Tambah Produk
        </button>
      </div>

      {/* Grid kartu produk */}
      {loading ? (
        <p className="text-muted">Memuat produk...</p>
      ) : products.length === 0 ? (
        <div className="card">
          <p className="text-muted">Belum ada produk. Klik “Tambah Produk” untuk menambah.</p>
        </div>
      ) : (
        <div className="product-grid">
          {products.map(p => {
            const photo = productPhotoUrl(p.photoUrl)
            return (
              <div key={p.id} className="card product-card">
                {isAdmin && (
                  <button
                    className="icon-button product-edit"
                    onClick={() => openEdit(p)}
                    aria-label={`Edit ${p.name}`}
                    title="Edit produk"
                  >
                    <span className="material-symbols-outlined">edit</span>
                  </button>
                )}

                <div className="product-card-head">
                  <div className="product-info">
                    <h3 className="product-name">{p.name}</h3>
                    <p className="product-unit">Satuan: {p.unit}</p>
                  </div>
                  {p.isActive ? (
                    <span className="badge success">Aktif</span>
                  ) : (
                    <span className="badge neutral">Diarsipkan</span>
                  )}
                </div>

                {photo && (
                  <div className="product-photo">
                    <img src={photo} alt={`Foto ${p.name}`} loading="lazy" />
                  </div>
                )}

                <div className="product-price">
                  <span className="card-label">Harga Jual</span>
                  <span className="price-value">
                    Rp {Number(p.sellingPrice).toLocaleString('id-ID')}
                  </span>
                </div>

                <div className="product-meta">
                  <div className="meta-item">
                    <span className="card-label">Stok Total</span>
                    <span className="meta-value">{Number(p.stock ?? 0).toLocaleString('id-ID')}</span>
                  </div>
                  <div className="meta-item">
                    <span className="card-label">Batch</span>
                    <span className="meta-value">{Number(p.batchCount ?? 0).toLocaleString('id-ID')}</span>
                  </div>
                </div>

                <div className="product-actions">
                  <button
                    className="button secondary"
                    onClick={() => toggleActive(p.id, p.isActive)}
                  >
                    {p.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  {isAdmin && (
                    <button
                      className="button danger-outline"
                      onClick={() => requestDelete(p)}
                      disabled={deleting}
                      aria-label={`Hapus ${p.name}`}
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Riwayat pergerakan stok produk (Admin & Operator) */}
      <section className="card section-card product-history">
        <div className="section-head">
          <div>
            <h2 className="card-title">Riwayat Pergerakan Stok Produk</h2>
            <p className="text-muted product-history-intro">
              Riwayat permanen dari ledger batch. Filter hanya memilih data yang ditampilkan
              dan tidak mengubah stok aktual.
            </p>
          </div>
        </div>

        <form className="product-history-filter" onSubmit={applyHistoryFilters}>
          <div className="field">
            <label htmlFor="history-product">Produk</label>
            <select
              id="history-product"
              value={historyProductId}
              onChange={(e) => void changeHistoryProduct(e.target.value)}
            >
              <option value="">Pilih produk</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.unit})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="history-from">Dari</label>
            <input
              id="history-from"
              type="date"
              value={historyFrom}
              max={historyTo || undefined}
              onChange={(e) => setHistoryFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="history-to">Sampai</label>
            <input
              id="history-to"
              type="date"
              value={historyTo}
              min={historyFrom || undefined}
              onChange={(e) => setHistoryTo(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="history-type">Jenis Aktivitas</label>
            <select
              id="history-type"
              value={historyType}
              onChange={(e) => setHistoryType(e.target.value)}
            >
              <option value="">Semua aktivitas</option>
              {MOVEMENT_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="history-batch">Batch</label>
            <select
              id="history-batch"
              value={historyBatchId}
              onChange={(e) => setHistoryBatchId(e.target.value)}
              disabled={!historyProductId || historyBatches.length === 0}
            >
              <option value="">Semua batch</option>
              {historyBatches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.code} · stok {formatQuantity(batch.stock)}
                </option>
              ))}
            </select>
          </div>
          <div className="product-history-filter-actions">
            <button type="button" className="button secondary" onClick={resetHistoryFilters}>
              Reset Filter
            </button>
            <button type="submit" className="button" disabled={!historyProductId || historyLoading}>
              {historyLoading ? 'Memuat...' : 'Terapkan Filter'}
            </button>
          </div>
        </form>

        {historyError && <div className="alert error">{historyError}</div>}

        {historySummary && !historyLoading && !historyError && (
          <div className="product-history-summary" aria-live="polite">
            <div>
              <span className="card-label">Stok Produk Saat Ini</span>
              <strong className="num">
                {formatQuantity(historySummary.currentStock)} {historyUnit}
              </strong>
            </div>
            <div>
              <span className="card-label">Pergerakan Ditampilkan</span>
              <strong className="num">{formatQuantity(historySummary.movementCount)}</strong>
            </div>
            <div>
              <span className="card-label">Total Stok Masuk</span>
              <strong className="num product-history-in">
                +{formatQuantity(historySummary.totalIn)} {historyUnit}
              </strong>
            </div>
            <div>
              <span className="card-label">Total Stok Keluar</span>
              <strong className="num product-history-out">
                −{formatQuantity(historySummary.totalOut)} {historyUnit}
              </strong>
            </div>
          </div>
        )}

        {historySummary?.hasHistoricalFallback && !historyLoading && !historyError && (
          <div className="product-history-fallback-note">
            <span className="material-symbols-outlined" aria-hidden="true">info</span>
            <p>
              Sebagian saldo berasal dari <strong>Saldo Awal (Riwayat Sebelumnya Tidak
              Tersedia)</strong>. Baris tersebut ditandai agar tidak disalahartikan sebagai
              transaksi lama yang tercatat lengkap.
            </p>
          </div>
        )}

        {!historyProductId ? (
          <div className="product-history-empty">
            <span className="material-symbols-outlined" aria-hidden="true">query_stats</span>
            <p><strong>Pilih produk untuk melihat riwayat pergerakan stok.</strong></p>
            <p className="text-muted">
              Setelah produk dipilih, riwayat produksi, penjualan, pembatalan, penyesuaian,
              koreksi, dan saldo awal batch akan ditampilkan.
            </p>
          </div>
        ) : historyLoading ? (
          <p className="text-muted product-history-loading">Memuat riwayat pergerakan stok...</p>
        ) : historyError ? null : historyLoaded && historyMovements.length === 0 ? (
          <div className="product-history-empty">
            <span className="material-symbols-outlined" aria-hidden="true">history_toggle_off</span>
            <p><strong>Riwayat tidak ditemukan untuk filter ini.</strong></p>
            <p className="text-muted">
              Ubah rentang tanggal, jenis aktivitas, atau batch, lalu tekan Terapkan Filter.
            </p>
          </div>
        ) : historyMovements.length > 0 ? (
          <>
            <div className="table-wrapper desktop-table product-history-table">
              <table>
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Jenis Aktivitas</th>
                    <th>Batch</th>
                    <th>Stok Masuk</th>
                    <th>Stok Keluar</th>
                    <th>Saldo Produk</th>
                    <th>Saldo Batch</th>
                    <th>Keterangan / Referensi</th>
                  </tr>
                </thead>
                <tbody>
                  {historyMovements.map((row) => (
                    <tr key={row.id}>
                      <td className="product-history-date">
                        <span>{movementDate(row.occurredAt)}</span>
                        <span className="product-history-sub">
                          {movementTime(row.recordedAt)} WIB
                        </span>
                      </td>
                      <td>
                        <span
                          className={`movement-type ${
                            row.stockIn > 0 ? 'in' : row.stockOut > 0 ? 'out' : 'neutral'
                          }`}
                        >
                          {MOVEMENT_LABELS[row.type] || row.type}
                        </span>
                        {row.isHistoricalFallback && (
                          <span className="badge warning product-history-fallback-badge">
                            Riwayat historis
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="product-history-batch-code" title={`ID batch: ${row.batch.id}`}>
                          {row.batch.code}
                        </span>
                      </td>
                      <td className="num">
                        {row.stockIn > 0 ? (
                          <span className="product-history-in">
                            +{formatQuantity(row.stockIn)}{' '}
                            <span className="product-history-unit">{row.product.unit}</span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        {row.stockOut > 0 ? (
                          <span className="product-history-out">
                            −{formatQuantity(row.stockOut)}{' '}
                            <span className="product-history-unit">{row.product.unit}</span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="num">
                        <strong>{formatQuantity(row.balanceAfter)}</strong>{' '}
                        <span className="product-history-unit">{row.product.unit}</span>
                      </td>
                      <td className="num">
                        <strong>{formatQuantity(row.batchBalanceAfter)}</strong>{' '}
                        <span className="product-history-unit">{row.product.unit}</span>
                      </td>
                      <td className="product-history-notes">
                        <div>{row.reason || '—'}</div>
                        {row.reference && (
                          <div className="product-history-reference">{row.reference.label}</div>
                        )}
                        <div className="product-history-sub">
                          Dicatat oleh {movementRecorder(row)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: kartu agar tidak memerlukan scroll horizontal. */}
            <div className="mobile-list">
              {historyMovements.map((row) => (
                <article
                  className={`history-item product-history-card ${
                    row.isHistoricalFallback ? 'historical' : ''
                  }`}
                  key={row.id}
                >
                  <div className="history-item-top">
                    <span
                      className={`movement-type ${
                        row.stockIn > 0 ? 'in' : row.stockOut > 0 ? 'out' : 'neutral'
                      }`}
                    >
                      {MOVEMENT_LABELS[row.type] || row.type}
                    </span>
                    <span className="history-item-date">{movementDate(row.occurredAt)}</span>
                  </div>
                  <div className="product-history-card-batch">
                    <span className="card-label">Batch</span>
                    <strong>{row.batch.code}</strong>
                  </div>
                  {row.isHistoricalFallback && (
                    <span className="badge warning">Riwayat historis</span>
                  )}
                  <div className="product-history-mobile-grid">
                    <div>
                      <span className="card-label">Stok Masuk</span>
                      <strong className={`num ${row.stockIn > 0 ? 'product-history-in' : 'text-muted'}`}>
                        {row.stockIn > 0
                          ? `+${formatQuantity(row.stockIn)} ${row.product.unit}`
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span className="card-label">Stok Keluar</span>
                      <strong className={`num ${row.stockOut > 0 ? 'product-history-out' : 'text-muted'}`}>
                        {row.stockOut > 0
                          ? `−${formatQuantity(row.stockOut)} ${row.product.unit}`
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span className="card-label">Saldo Produk</span>
                      <strong className="num">
                        {formatQuantity(row.balanceAfter)} {row.product.unit}
                      </strong>
                    </div>
                    <div>
                      <span className="card-label">Saldo Batch</span>
                      <strong className="num">
                        {formatQuantity(row.batchBalanceAfter)} {row.product.unit}
                      </strong>
                    </div>
                  </div>
                  <div className="history-item-note">
                    {row.reason || 'Tanpa keterangan'}
                    {row.reference ? ` · ${row.reference.label}` : ''}
                  </div>
                  <div className="history-item-note">
                    Dicatat oleh {movementRecorder(row)} · {movementTime(row.recordedAt)} WIB
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </section>

      {/* Drawer tambah/edit produk (Admin) */}
      <Drawer
        open={drawerOpen}
        title={editTarget ? 'Edit Produk' : 'Tambah Produk'}
        onClose={closeDrawer}
      >
        <form onSubmit={editTarget ? updateProduct : createProduct} className="drawer-form">
          <div className="field">
            <label htmlFor="p-name">Nama Produk</label>
            <input
              id="p-name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Contoh: Keripik Singkong Balado"
              required
            />
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="p-unit">Satuan Dasar</label>
              <input
                id="p-unit"
                value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="Contoh: pcs"
                required
              />
              {editTarget && (
                <span className="text-muted">
                  Satuan tidak dapat diubah bila produk sudah memiliki riwayat operasional.
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="p-price">Harga Jual (Rp)</label>
              <input
                id="p-price"
                type="number"
                step="0.01"
                min="0"
                value={form.sellingPrice}
                onChange={e => setForm(f => ({ ...f, sellingPrice: e.target.value }))}
                required
              />
            </div>
          </div>

          <PhotoField
            currentUrl={editTarget?.photoUrl ?? null}
            file={photoFile}
            onChange={setPhotoFile}
            savedMessage={photoNotice}
          />

          <div className="field">
            <label htmlFor="p-desc">Deskripsi (opsional)</label>
            <textarea
              id="p-desc"
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="p-comp">Komposisi (opsional)</label>
            <textarea
              id="p-comp"
              rows={2}
              value={form.composition}
              onChange={e => setForm(f => ({ ...f, composition: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="p-storage">Petunjuk Penyimpanan (opsional)</label>
            <textarea
              id="p-storage"
              rows={2}
              value={form.storageInstructions}
              onChange={e => setForm(f => ({ ...f, storageInstructions: e.target.value }))}
            />
          </div>
          <div className="drawer-actions">
            <button type="button" className="button secondary" onClick={closeDrawer}>
              Batal
            </button>
            <button className="button" disabled={submitting}>
              {submitting
                ? 'Menyimpan...'
                : editTarget
                  ? 'Simpan Perubahan'
                  : 'Simpan Produk'}
            </button>
          </div>
        </form>
      </Drawer>

    </div>
  )
}

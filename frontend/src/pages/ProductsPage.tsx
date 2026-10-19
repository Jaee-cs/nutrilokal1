import { useEffect, useState } from 'react'
import api from '../lib/api'
import { Drawer } from '../components/Drawer'

interface Product {
  id: string
  name: string
  unit: string
  sellingPrice: number
  description?: string | null
  composition?: string | null
  storageInstructions?: string | null
  stock?: number
  batchCount?: number
  isActive: boolean
}

const EMPTY_FORM = {
  name: '',
  unit: '',
  sellingPrice: '',
  description: '',
  composition: '',
  storageInstructions: '',
}

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  async function fetchProducts() {
    try {
      const res = await api.get('/products')
      setProducts(res.data.data || res.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat produk')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProducts()
  }, [])

  function openDrawer() {
    setForm(EMPTY_FORM)
    setError(null)
    setDrawerOpen(true)
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await api.post('/products', {
        name: form.name,
        unit: form.unit,
        sellingPrice: Number(form.sellingPrice),
        description: form.description || undefined,
        composition: form.composition || undefined,
        storageInstructions: form.storageInstructions || undefined,
      })
      setSuccess('Produk berhasil ditambahkan')
      setDrawerOpen(false)
      await fetchProducts()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal menambah produk')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    try {
      await api.patch(`/products/${id}`, { isActive: !current })
      await fetchProducts()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mengubah status')
    }
  }

  const activeCount = products.filter(p => p.isActive).length
  const inactiveCount = products.length - activeCount

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Kelola Produk KWT</h1>
        <p className="page-subtitle">
          Data produk olahan, satuan dasar, dan harga jual mengikuti backend.
        </p>
      </div>

      {error && !drawerOpen && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

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
          {products.map(p => (
            <div key={p.id} className="card product-card">
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
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drawer tambah produk */}
      <Drawer open={drawerOpen} title="Tambah Produk" onClose={() => setDrawerOpen(false)}>
        {error && <div className="alert error">{error}</div>}
        <form onSubmit={createProduct} className="drawer-form">
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
            <button type="button" className="button secondary" onClick={() => setDrawerOpen(false)}>
              Batal
            </button>
            <button className="button" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan Produk'}
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  )
}

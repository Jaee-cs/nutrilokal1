import { useEffect, useState } from 'react'
import api from '../lib/api'

interface Product {
  id: string
  name: string
  unit: string
  sellingPrice: number
  description?: string | null
  composition?: string | null
  storageInstructions?: string | null
  isActive: boolean
  createdAt: string
  updatedAt?: string | null
}

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', unit: '', sellingPrice: '', description: '', composition: '', storageInstructions: '' })
  const [creating, setCreating] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

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

  async function createProduct(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
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
      setForm({ name: '', unit: '', sellingPrice: '', description: '', composition: '', storageInstructions: '' })
      await fetchProducts()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal menambah produk')
    } finally {
      setCreating(false)
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

  return (
    <div className="container">
      <h1 className="page-title">Master Produk</h1>
      <p className="page-subtitle">Kelola produk sesuai data yang didukung backend.</p>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert" style={{ borderColor: '#bbf7d0', background: '#f0fdf4', color: '#166534' }}>{success}</div>}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Tambah Produk</h2>
        <form onSubmit={createProduct}>
          <div className="form-row" style={{ marginBottom: '1rem' }}>
            <div className="field">
              <label>Nama Produk</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Satuan Dasar</label>
              <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Harga Jual</label>
              <input type="number" step="0.01" value={form.sellingPrice} onChange={e => setForm(f => ({ ...f, sellingPrice: e.target.value }))} required />
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: '1rem' }}>
            <div className="field">
              <label>Deskripsi (opsional)</label>
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="field">
              <label>Komposisi (opsional)</label>
              <textarea value={form.composition} onChange={e => setForm(f => ({ ...f, composition: e.target.value }))} rows={2} />
            </div>
            <div className="field">
              <label>Petunjuk Penyimpanan (opsional)</label>
              <textarea value={form.storageInstructions} onChange={e => setForm(f => ({ ...f, storageInstructions: e.target.value }))} rows={2} />
            </div>
          </div>
          <button className="button" disabled={creating}>{creating ? 'Menyimpan...' : 'Tambah Produk'}</button>
        </form>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Nama</th>
              <th>Satuan</th>
              <th>Harga Jual</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5}>Memuat...</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={5} style={{ color: 'var(--color-muted)' }}>Belum ada produk</td></tr>
            ) : (
              products.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.unit}</td>
                  <td>{Number(p.sellingPrice).toLocaleString('id-ID')}</td>
                  <td>{p.isActive ? 'Aktif' : 'Nonaktif'}</td>
                  <td style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button className="button secondary" onClick={() => toggleActive(p.id, p.isActive)}>{p.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

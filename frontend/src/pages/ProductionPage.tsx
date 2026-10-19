import { useEffect, useState } from 'react'
import api from '../lib/api'

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

interface Production {
  id: string
  productId: string
  product: { name: string; unit: string }
  productionDate: string
  yieldQuantity: number
  batch: { code: string } | null
  usages: Array<{ materialId: string; material: { name: string; unit: string }; quantity: number }>
  createdAt: string
}

export function ProductionPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({ productId: '', productionDate: '', yieldQuantity: '', materialId: '', materialQty: '' })
  const [submitting, setSubmitting] = useState(false)

  async function fetchData() {
    try {
      setLoading(true)
      const [p, m, pr] = await Promise.all([
        api.get('/products'),
        api.get('/materials'),
        api.get('/productions').catch(() => ({ data: { data: [] } }))
      ])
      setProducts((p.data.data || p.data) || [])
      setMaterials((m.data.data || m.data) || [])
      setProductions((pr.data.data || pr.data) || [])
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat data')
    } finally {
      setLoading(false)
    }
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

  return (
    <div className="container">
      <h1 className="page-title">Produksi & Batch</h1>
      <p className="page-subtitle">Pencatatan produksi sesuai aturan backend.</p>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert" style={{ borderColor: '#bbf7d0', background: '#f0fdf4', color: '#166534' }}>{success}</div>}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Catat Produksi</h2>
        <form onSubmit={submitProduction} className="form-row">
          <div className="field">
            <label>Produk</label>
            <select value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))} required>
              <option value="">Pilih produk</option>
              {products.filter(p => p.isActive).map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Tanggal Produksi (opsional)</label>
            <input type="date" value={form.productionDate} onChange={e => setForm(f => ({ ...f, productionDate: e.target.value }))} />
          </div>
          <div className="field">
            <label>Jumlah Hasil</label>
            <input type="number" step="0.001" value={form.yieldQuantity} onChange={e => setForm(f => ({ ...f, yieldQuantity: e.target.value }))} required />
          </div>
          <div className="field">
            <label>Bahan Digunakan</label>
            <select value={form.materialId} onChange={e => setForm(f => ({ ...f, materialId: e.target.value }))}>
              <option value="">Pilih bahan (opsional)</option>
              {materials.filter(m => m.isActive).map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Jumlah Bahan</label>
            <input type="number" step="0.001" value={form.materialQty} onChange={e => setForm(f => ({ ...f, materialQty: e.target.value }))} disabled={!form.materialId} />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="button" disabled={submitting}>{submitting ? 'Menyimpan...' : 'Simpan Produksi'}</button>
          </div>
        </form>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Produk</th>
              <th>Hasil</th>
              <th>Kode Batch</th>
              <th>Bahan Digunakan</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5}>Memuat...</td></tr>
            ) : productions.length === 0 ? (
              <tr><td colSpan={5} style={{ color: 'var(--color-muted)' }}>Belum ada catatan produksi</td></tr>
            ) : (
              productions.slice(0, 20).map(p => (
                <tr key={p.id}>
                  <td>{p.productionDate}</td>
                  <td>{p.product.name}</td>
                  <td>{Number(p.yieldQuantity).toLocaleString('id-ID')} {p.product.unit}</td>
                  <td>{p.batch?.code || '-'}</td>
                  <td>{p.usages.map(u => `${u.material.name} ${u.quantity} ${u.material.unit}`).join(', ') || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

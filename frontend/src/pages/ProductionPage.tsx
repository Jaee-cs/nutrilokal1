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

  const activeProducts = products.filter(p => p.isActive)
  const activeMaterials = materials.filter(m => m.isActive)

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Produksi &amp; Batch</h1>
        <p className="page-subtitle">
          Pencatatan produksi mengikuti aturan backend — kode batch dibuat otomatis.
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

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
                <tr><td colSpan={5} className="text-muted">Belum ada catatan produksi</td></tr>
              ) : (
                productions.slice(0, 20).map(p => (
                  <tr key={p.id}>
                    <td>{p.productionDate}</td>
                    <td className="cell-primary">{p.product.name}</td>
                    <td className="num">
                      <strong>{Number(p.yieldQuantity).toLocaleString('id-ID')}</strong>{' '}
                      <span className="text-muted">{p.product.unit}</span>
                    </td>
                    <td>
                      {p.batch?.code ? (
                        <span className="badge neutral">{p.batch.code}</span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td className="text-muted">
                      {p.usages.map(u => `${u.material.name} ${u.quantity} ${u.material.unit}`).join(', ') || '-'}
                    </td>
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

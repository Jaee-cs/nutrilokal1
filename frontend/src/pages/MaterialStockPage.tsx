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

export function MaterialStockPage() {
  const { user } = useAuth()
  const [materials, setMaterials] = useState<Material[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({ materialId: '', quantity: '', receivedAt: '', note: '' })
  const [submitting, setSubmitting] = useState(false)

  async function fetchData() {
    try {
      setLoading(true)
      const [m, r] = await Promise.all([
        api.get('/materials'),
        api.get('/materials/any/receipts').catch(() => ({ data: { data: [] } }))
      ])
      const mats = (m.data.data || m.data).map((x: any) => ({
        id: x.id,
        name: x.name,
        unit: x.unit,
        isActive: x.isActive,
        stock: x.stock,
      }))
      setMaterials(mats)
      setReceipts((r.data.data || r.data) || [])
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat data bahan baku')
    } finally {
      setLoading(false)
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
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mencatat penerimaan')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container">
      <h1 className="page-title">Bahan Baku & Stok</h1>
      <p className="page-subtitle">Saldo stok aktual, penerimaan, dan riwayat pergerakan (data dari backend).</p>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert" style={{ borderColor: '#bbf7d0', background: '#f0fdf4', color: '#166534' }}>{success}</div>}

      <div className="table-wrapper" style={{ marginBottom: '1.5rem' }}>
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
              <tr><td colSpan={4} style={{ color: 'var(--color-muted)' }}>Belum ada bahan baku</td></tr>
            ) : (
              materials.map(m => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.unit}</td>
                  <td>{m.stock !== undefined ? m.stock.toLocaleString('id-ID') : '-'}</td>
                  <td>{m.isActive ? 'Aktif' : 'Nonaktif'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {user?.role === 'ADMIN' || user?.role === 'OPERATOR' ? (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Catat Penerimaan Bahan Baku</h2>
          <form onSubmit={submitReceipt} className="form-row">
            <div className="field">
              <label>Bahan Baku</label>
              <select value={form.materialId} onChange={e => setForm(f => ({ ...f, materialId: e.target.value }))} required>
                <option value="">Pilih bahan baku</option>
                {materials.filter(m => m.isActive).map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Jumlah</label>
              <input type="number" step="0.001" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Tanggal Penerimaan (opsional)</label>
              <input type="date" value={form.receivedAt} onChange={e => setForm(f => ({ ...f, receivedAt: e.target.value }))} />
            </div>
            <div className="field">
              <label>Catatan (opsional)</label>
              <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'end' }}>
              <button className="button" disabled={submitting}>{submitting ? 'Menyimpan...' : 'Catat Penerimaan'}</button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="card">
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Riwayat Penerimaan</h2>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Bahan</th>
                <th>Jumlah</th>
                <th>Satuan</th>
                <th>Tanggal Terima</th>
                <th>Dicatat oleh</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {receipts.length === 0 ? (
                <tr><td colSpan={6} style={{ color: 'var(--color-muted)' }}>Belum ada riwayat penerimaan</td></tr>
              ) : (
                receipts.slice(0, 20).map(r => (
                  <tr key={r.id}>
                    <td>{materials.find(m => m.id === r.materialId)?.name || r.materialId}</td>
                    <td>{Number(r.quantity).toLocaleString('id-ID')}</td>
                    <td>{materials.find(m => m.id === r.materialId)?.unit || '-'}</td>
                    <td>{r.receivedAt || new Date(r.createdAt).toISOString().slice(0, 10)}</td>
                    <td>{r.recordedBy?.username || '-'}</td>
                    <td>{r.note || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

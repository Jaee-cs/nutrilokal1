import { useEffect, useState } from 'react'
import api from '../lib/api'

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
  const [materials, setMaterials] = useState<Material[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [receiptMaterialId, setReceiptMaterialId] = useState('')
  const [loadingReceipts, setLoadingReceipts] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({ materialId: '', quantity: '', receivedAt: '', note: '' })
  const [submitting, setSubmitting] = useState(false)

  async function fetchData() {
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
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat data bahan baku')
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

  const activeCount = materials.filter(m => m.isActive).length
  const inactiveCount = materials.length - activeCount

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

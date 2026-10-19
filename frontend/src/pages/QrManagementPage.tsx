import { useEffect, useState } from 'react'
import api from '../lib/api'

interface Batch {
  id: string
  code: string
  product: { name: string }
  productionDate: string
  stockQuantity: number
  isActive: boolean
  qrPublication?: { publishedAt?: string | null; withdrawnAt?: string | null; validatedAt?: string | null } | null
}

export function QrManagementPage() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [selected, setSelected] = useState<Batch | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [acting, setActing] = useState(false)

  async function fetchBatches() {
    try {
      setLoading(true)
      const res = await api.get('/batches')
      setBatches((res.data.data || res.data) || [])
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat batch')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchBatches() }, [])

  async function fetchDetail(id: string) {
    try {
      setError(null)
      setSuccess(null)
      const res = await api.get(`/batches/${id}/qr`)
      setDetail(res.data)
      setSelected(batches.find(b => b.id === id) || null)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat detail QR')
    }
  }

  async function act(id: string, action: 'validate' | 'publish' | 'withdraw') {
    setActing(true)
    setError(null)
    setSuccess(null)
    try {
      await api.post(`/batches/${id}/qr/${action}`, {})
      setSuccess(`Aksi ${action} berhasil`)
      await fetchDetail(id)
      await fetchBatches()
    } catch (err: any) {
      setError(err.response?.data?.message || `Gagal ${action}`)
    } finally {
      setActing(false)
    }
  }

  return (
    <div className="container">
      <h1 className="page-title">QR Traceability — Validasi & Publikasi (Admin)</h1>
      <p className="page-subtitle">Kelola status QR per batch sesuai aturan backend.</p>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert" style={{ borderColor: '#bbf7d0', background: '#f0fdf4', color: '#166534' }}>{success}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Daftar Batch</h2>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>Kode Batch</th><th>Produk</th><th>Tgl Produksi</th><th>Stok</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={5}>Memuat...</td></tr> : batches.length === 0 ? (
                <tr><td colSpan={5} style={{ color: 'var(--color-muted)' }}>Belum ada batch</td></tr>
              ) : batches.slice(0, 30).map(b => (
                <tr key={b.id}>
                  <td>{b.code}</td>
                  <td>{b.product.name}</td>
                  <td>{b.productionDate}</td>
                  <td>{Number(b.stockQuantity).toLocaleString('id-ID')}</td>
                  <td><button className="button secondary" onClick={() => fetchDetail(b.id)}>Detail QR</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail && (
        <div className="card">
          <h2 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Detail QR — {selected?.code}</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <button className="button secondary" disabled={acting} onClick={() => act(selected!.id, 'validate')}>Validasi</button>
            <button className="button" disabled={acting} onClick={() => act(selected!.id, 'publish')}>Publikasi</button>
            <button className="button secondary" disabled={acting} onClick={() => act(selected!.id, 'withdraw')}>Tarik Publikasi</button>
          </div>
          <pre style={{ overflowX: 'auto', fontSize: '0.875rem' }}>{JSON.stringify(detail, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

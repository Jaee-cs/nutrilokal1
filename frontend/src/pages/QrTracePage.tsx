import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../lib/api'

interface QrInfo {
  productName: string
  batchCode: string
  productionDate: string
  expiryDate?: string | null
  composition?: string | null
  storageInstructions?: string | null
  description?: string | null
  published: boolean
}

export function QrTracePage() {
  const { code } = useParams()
  const [info, setInfo] = useState<QrInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState(code || '')

  async function fetchQr(c: string) {
    if (!c.trim()) return
    try {
      setLoading(true)
      setError(null)
      setInfo(null)
      const res = await api.get(`/public/qr/${encodeURIComponent(c.trim())}`)
      setInfo(res.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'QR tidak ditemukan atau belum dipublikasikan')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (code) {
      setInput(code)
      fetchQr(code)
    }
  }, [code])

  return (
    <div className="container">
      <h1 className="page-title">Traceability QR (Publik)</h1>
      <p className="page-subtitle">Cek informasi batch yang telah divalidasi &amp; dipublikasikan.</p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="form-row">
          <div className="field">
            <label>Kode Batch / QR</label>
            <input value={input} onChange={e => setInput(e.target.value)} placeholder="Masukkan kode batch" />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="button" onClick={() => fetchQr(input)}>Cek</button>
          </div>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {loading && <div className="card">Memuat...</div>}

      {info && (
        <div className="card">
          <h2 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>{info.productName} — Batch {info.batchCode}</h2>
          <div style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div><strong>Tanggal Produksi:</strong> {info.productionDate}</div>
            {info.expiryDate && <div><strong>Kedaluwarsa:</strong> {info.expiryDate}</div>}
            {info.description && <div style={{ gridColumn: '1 / -1' }}><strong>Deskripsi:</strong> {info.description}</div>}
            {info.composition && <div style={{ gridColumn: '1 / -1' }}><strong>Komposisi:</strong> {info.composition}</div>}
            {info.storageInstructions && <div style={{ gridColumn: '1 / -1' }}><strong>Petunjuk Penyimpanan:</strong> {info.storageInstructions}</div>}
            <div style={{ gridColumn: '1 / -1', color: 'var(--color-muted)' }}>Status publik: {info.published ? 'Tersedia' : 'Tidak tersedia'}</div>
          </div>
        </div>
      )}
    </div>
  )
}

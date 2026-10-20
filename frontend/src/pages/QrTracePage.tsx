import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../lib/api'
import { productPhotoUrl } from '../utils/product-photo'

// Respons backend: GET /api/public/qr/:code
// { status: 'PUBLISHED', product: {...}, batch: {...} } | { status: 'UNAVAILABLE', message }
interface QrPublished {
  status: 'PUBLISHED'
  product: {
    name: string
    unit: string
    description?: string
    composition?: string
    storageInstructions?: string
    photoUrl?: string
  }
  batch: {
    code: string
    productionDate?: string
    expiryDate?: string
  }
}

interface QrUnavailable {
  status: 'UNAVAILABLE'
  message: string
}

type QrResponse = QrPublished | QrUnavailable

export function QrTracePage() {
  const { code } = useParams()
  const [info, setInfo] = useState<QrResponse | null>(null)
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

  const published = info?.status === 'PUBLISHED' ? (info as QrPublished) : null

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Traceability QR (Publik)</h1>
        <p className="page-subtitle">
          Cek informasi batch yang telah divalidasi &amp; dipublikasikan Admin.
        </p>
      </div>

      <section className="card section-card">
        <div className="form-row">
          <div className="field">
            <label htmlFor="qr-code">Kode Batch / QR</label>
            <input
              id="qr-code"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Contoh: NL-SKG-202410-008"
            />
          </div>
          <div className="form-actions">
            <button className="button" onClick={() => fetchQr(input)} disabled={loading}>
              {loading ? 'Mengecek...' : 'Cek QR'}
            </button>
          </div>
        </div>
      </section>

      {error && <div className="alert error">{error}</div>}

      {info && info.status === 'UNAVAILABLE' && (
        <div className="alert error">{info.message}</div>
      )}

      {published && (
        <section className="card section-card">
          <div className="section-head">
            <div>
              <h2 className="card-title" style={{ marginBottom: '0.25rem' }}>
                {published.product.name}
              </h2>
              <span className="text-muted">Batch {published.batch.code}</span>
            </div>
            <span className="badge success">Tersedia Publik</span>
          </div>

          {/* Foto produk dari master (hanya bila Admin sudah mengunggahnya). */}
          {productPhotoUrl(published.product.photoUrl) && (
            <div className="product-photo qr-trace-photo">
              <img
                src={productPhotoUrl(published.product.photoUrl)!}
                alt={`Foto ${published.product.name}`}
              />
            </div>
          )}

          <div className="qr-meta">
            <div className="qr-meta-item">
              <span className="card-label">Tanggal Produksi</span>
              <span className="qr-meta-value">{published.batch.productionDate || '-'}</span>
            </div>
            <div className="qr-meta-item">
              <span className="card-label">Kedaluwarsa</span>
              <span className="qr-meta-value">{published.batch.expiryDate || '-'}</span>
            </div>
            <div className="qr-meta-item">
              <span className="card-label">Satuan</span>
              <span className="qr-meta-value">{published.product.unit}</span>
            </div>
            {published.product.description && (
              <div className="qr-meta-item" style={{ gridColumn: '1 / -1' }}>
                <span className="card-label">Deskripsi</span>
                <span className="qr-meta-value" style={{ fontWeight: 400 }}>
                  {published.product.description}
                </span>
              </div>
            )}
            {published.product.composition && (
              <div className="qr-meta-item" style={{ gridColumn: '1 / -1' }}>
                <span className="card-label">Komposisi</span>
                <span className="qr-meta-value" style={{ fontWeight: 400 }}>
                  {published.product.composition}
                </span>
              </div>
            )}
            {published.product.storageInstructions && (
              <div className="qr-meta-item" style={{ gridColumn: '1 / -1' }}>
                <span className="card-label">Petunjuk Penyimpanan</span>
                <span className="qr-meta-value" style={{ fontWeight: 400 }}>
                  {published.product.storageInstructions}
                </span>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

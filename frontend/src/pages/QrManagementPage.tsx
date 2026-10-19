import { useEffect, useState } from 'react'
import api from '../lib/api'

interface Batch {
  id: string
  code: string
  product: { name: string }
  productionDate: string
  stockQuantity: number
  isActive: boolean
}

interface QrDetail {
  batchId: string
  code: string
  publicPath: string
  status: 'NOT_CONFIGURED' | 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'WITHDRAWN'
  validatedAt: string | null
  validatedBy: { username: string; name?: string | null } | null
  publishedAt: string | null
  publishedBy: { username: string; name?: string | null } | null
  withdrawnAt: string | null
  withdrawnBy: { username: string; name?: string | null } | null
}

const STATUS_LABEL: Record<QrDetail['status'], { label: string; cls: string }> = {
  NOT_CONFIGURED: { label: 'Belum Dikonfigurasi', cls: 'neutral' },
  DRAFT: { label: 'Draf', cls: 'neutral' },
  VALIDATED: { label: 'Tervalidasi', cls: 'warning' },
  PUBLISHED: { label: 'Diterbitkan', cls: 'success' },
  WITHDRAWN: { label: 'Ditarik', cls: 'error' },
}

function formatDate(iso: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function QrManagementPage() {
  const [batches, setBatches] = useState<Batch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [detail, setDetail] = useState<QrDetail | null>(null)
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
      setDetail(res.data.qr)
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
      const label = action === 'validate' ? 'Validasi' : action === 'publish' ? 'Publikasi' : 'Penarikan'
      setSuccess(`${label} QR berhasil`)
      await fetchDetail(id)
      await fetchBatches()
    } catch (err: any) {
      const label = action === 'validate' ? 'memvalidasi' : action === 'publish' ? 'menerbitkan' : 'menarik'
      setError(err.response?.data?.message || `Gagal ${label} QR`)
    } finally {
      setActing(false)
    }
  }

  const statusInfo = detail ? STATUS_LABEL[detail.status] : null

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">QR Traceability</h1>
        <p className="page-subtitle">
          Validasi dan publikasi informasi QR per batch — siklus: validasi → terbitkan → (tarik).
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      <section className="card section-card">
        <div className="section-head">
          <h2 className="card-title">Daftar Batch</h2>
          <span className="text-muted">{batches.length} batch</span>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Kode Batch</th>
                <th>Produk</th>
                <th>Tgl Produksi</th>
                <th>Stok</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5}>Memuat...</td></tr>
              ) : batches.length === 0 ? (
                <tr><td colSpan={5} className="text-muted">Belum ada batch</td></tr>
              ) : (
                batches.slice(0, 30).map(b => (
                  <tr key={b.id} className={detail?.batchId === b.id ? 'row-active' : ''}>
                    <td><span className="badge neutral">{b.code}</span></td>
                    <td className="cell-primary">{b.product.name}</td>
                    <td>{b.productionDate}</td>
                    <td className="num">{Number(b.stockQuantity).toLocaleString('id-ID')}</td>
                    <td>
                      <button className="button secondary" onClick={() => fetchDetail(b.id)}>
                        Detail QR
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detail && statusInfo && (
        <section className="card section-card">
          <div className="section-head">
            <h2 className="card-title">Detail QR — {detail.code}</h2>
            <span className={`badge ${statusInfo.cls}`}>{statusInfo.label}</span>
          </div>

          <div className="qr-actions">
            <button
              className="button secondary"
              disabled={acting}
              onClick={() => act(detail.batchId, 'validate')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>verified</span>
              {detail.status === 'DRAFT' || detail.status === 'NOT_CONFIGURED' ? 'Validasi' : 'Validasi Ulang'}
            </button>
            <button
              className="button"
              disabled={acting || detail.status === 'PUBLISHED'}
              onClick={() => act(detail.batchId, 'publish')}
              title={detail.status !== 'VALIDATED' && detail.status !== 'PUBLISHED' ? 'Wajib divalidasi terlebih dahulu' : undefined}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>publish</span>
              Terbitkan
            </button>
            <button
              className="button secondary"
              disabled={acting || detail.status !== 'PUBLISHED'}
              onClick={() => act(detail.batchId, 'withdraw')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>undo</span>
              Tarik Publikasi
            </button>
          </div>

          <div className="qr-meta">
            <div className="qr-meta-item">
              <span className="card-label">Status</span>
              <span className="qr-meta-value">{statusInfo.label}</span>
            </div>
            <div className="qr-meta-item">
              <span className="card-label">Path Publik</span>
              <span className="qr-meta-value mono">{detail.publicPath}</span>
            </div>
            <div className="qr-meta-item">
              <span className="card-label">Divalidasi</span>
              <span className="qr-meta-value">
                {formatDate(detail.validatedAt)}
                {detail.validatedBy && <span className="cell-secondary">oleh {detail.validatedBy.username}</span>}
              </span>
            </div>
            <div className="qr-meta-item">
              <span className="card-label">Diterbitkan</span>
              <span className="qr-meta-value">
                {formatDate(detail.publishedAt)}
                {detail.publishedBy && <span className="cell-secondary">oleh {detail.publishedBy.username}</span>}
              </span>
            </div>
            <div className="qr-meta-item">
              <span className="card-label">Ditarik</span>
              <span className="qr-meta-value">
                {formatDate(detail.withdrawnAt)}
                {detail.withdrawnBy && <span className="cell-secondary">oleh {detail.withdrawnBy.username}</span>}
              </span>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

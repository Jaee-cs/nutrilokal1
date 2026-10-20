import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import api from '../lib/api'
import { validatedExpiryLabel } from '../utils/batch-expiry'
import { productPhotoUrl } from '../utils/product-photo'

// Bentuk API GET /batches (toPublicBatch): stock, productionDate bisa null
// (batch stok awal), expiryDate/expiryValidated untuk label.
interface Batch {
  id: string
  code: string
  product: { name: string; photoUrl?: string | null }
  productionDate: string | null
  stock: number
  expiryDate: string | null
  expiryValidated: boolean
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

// Data yang dibutuhkan untuk menggambar satu label cetak.
interface LabelState {
  code: string
  productName: string
  /** Tanggal kedaluwarsa HANYA bila sudah divalidasi (README 5.6). */
  expiryLabel: string | null
  /** Foto produk bila Admin sudah mengunggahnya (opsional). */
  photoUrl: string | null
  dataUrl: string
}

const STATUS_LABEL: Record<QrDetail['status'], { label: string; cls: string }> = {
  NOT_CONFIGURED: { label: 'Belum Dikonfigurasi', cls: 'neutral' },
  DRAFT: { label: 'Draf', cls: 'neutral' },
  VALIDATED: { label: 'Tervalidasi', cls: 'warning' },
  PUBLISHED: { label: 'Diterbitkan', cls: 'success' },
  WITHDRAWN: { label: 'Ditarik', cls: 'error' },
}

// Opsi generasi QR: dibuat di klien (tanpa layanan eksternal), koreksi galat M.
const QR_OPTIONS = { width: 320, margin: 1, errorCorrectionLevel: 'M' as const } as const

// Target QR adalah HALAMAN pelacakan publik (QrTracePage, tanpa login),
// bukan endpoint JSON API — QR harus dapat dipindai lalu dibuka di browser.
function publicTraceUrl(code: string): string {
  return `${window.location.origin}/qr/${encodeURIComponent(code)}`
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
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [label, setLabel] = useState<LabelState | null>(null)

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

  // Gambar QR untuk batch yang sedang dibuka di panel detail.
  useEffect(() => {
    let active = true
    if (!detail) {
      setQrDataUrl(null)
      return
    }
    QRCode.toDataURL(publicTraceUrl(detail.code), QR_OPTIONS)
      .then(url => { if (active) setQrDataUrl(url) })
      .catch(() => { if (active) setError('Gagal membuat gambar QR') })
    return () => { active = false }
  }, [detail])

  async function fetchDetail(id: string): Promise<boolean> {
    try {
      setError(null)
      setSuccess(null)
      const res = await api.get(`/batches/${id}/qr`)
      setDetail(res.data.qr)
      return true
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat detail QR')
      return false
    }
  }

  async function act(id: string, action: 'validate' | 'publish' | 'withdraw') {
    setActing(true)
    setError(null)
    setSuccess(null)
    try {
      await api.post(`/batches/${id}/qr/${action}`, {})
      const actionLabel = action === 'validate' ? 'Validasi' : action === 'publish' ? 'Publikasi' : 'Penarikan'
      // Muat ulang DULU (fetchDetail mengosongkan pesan), lalu tampilkan sukses
      // agar pesan tidak langsung terhapus. Bila muat ulang gagal, pesan error
      // dari fetchDetail dipertahankan (tidak ditimpa sukses).
      const refreshed = await fetchDetail(id)
      await fetchBatches()
      if (refreshed) {
        setSuccess(`${actionLabel} QR berhasil`)
      }
    } catch (err: any) {
      const actionLabel = action === 'validate' ? 'memvalidasi' : action === 'publish' ? 'menerbitkan' : 'menarik'
      setError(err.response?.data?.message || `Gagal ${actionLabel} QR`)
    } finally {
      setActing(false)
    }
  }

  // Buka pratinjau label: QR digambar dari URL pelacakan publik batch ini.
  async function openLabel(
    code: string,
    productName: string,
    expiryLabel: string | null,
    photoUrl: string | null
  ) {
    setError(null)
    try {
      const dataUrl = await QRCode.toDataURL(publicTraceUrl(code), QR_OPTIONS)
      setLabel({ code, productName, expiryLabel, photoUrl, dataUrl })
    } catch {
      setError('Gagal membuat gambar QR untuk label')
    }
  }

  function labelFromBatch(b: Batch) {
    openLabel(b.code, b.product.name, validatedExpiryLabel(b), productPhotoUrl(b.product.photoUrl))
  }

  function labelFromDetail() {
    if (!detail) return
    const b = batches.find(x => x.id === detail.batchId)
    openLabel(
      detail.code,
      b?.product.name ?? detail.code,
      b ? validatedExpiryLabel(b) : null,
      productPhotoUrl(b?.product.photoUrl)
    )
  }

  const statusInfo = detail ? STATUS_LABEL[detail.status] : null
  // Foto produk untuk batch yang sedang dibuka (dari daftar batch).
  const detailPhotoUrl = detail
    ? batches.find((b) => b.id === detail.batchId)?.product.photoUrl ?? null
    : null

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
                    <td>{b.productionDate ?? '-'}</td>
                    <td className="num">{b.stock.toLocaleString('id-ID')}</td>
                    <td>
                      <div className="row-actions">
                        <button className="button secondary" onClick={() => fetchDetail(b.id)}>
                          Detail QR
                        </button>
                        <button className="button secondary" onClick={() => labelFromBatch(b)}>
                          Label
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detail && statusInfo && (
        <section className="card section-card qr-detail">
          <div className="section-head">
            <h2 className="card-title">Detail QR — {detail.code}</h2>
            <span className={`badge ${statusInfo.cls}`}>{statusInfo.label}</span>
          </div>

          {/* Foto produk dari master (hanya bila Admin sudah mengunggahnya). */}
          {productPhotoUrl(detailPhotoUrl) && (
            <div className="product-photo qr-detail-photo">
              <img src={productPhotoUrl(detailPhotoUrl)!} alt="Foto produk batch ini" />
            </div>
          )}

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

          {/* Gambar QR + URL tujuan sebenarnya (halaman publik, bukan API). */}
          <div className="qr-preview">
            <div className="qr-preview-image">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`Kode QR batch ${detail.code}`}
                  width={180}
                  height={180}
                />
              ) : (
                <div className="qr-placeholder text-muted">Membuat QR…</div>
              )}
            </div>
            <div className="qr-preview-info">
              <div className="qr-meta-item">
                <span className="card-label">URL Pelacakan (Publik)</span>
                <span className="qr-meta-value mono">{publicTraceUrl(detail.code)}</span>
              </div>
              <div className="qr-meta-item">
                <span className="card-label">Endpoint API</span>
                <span className="qr-meta-value mono">{detail.publicPath}</span>
              </div>
              <div>
                <button className="button secondary" onClick={labelFromDetail}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>print</span>
                  Pratinjau Label
                </button>
              </div>
            </div>
          </div>

          <div className="qr-meta">
            <div className="qr-meta-item">
              <span className="card-label">Status</span>
              <span className="qr-meta-value">{statusInfo.label}</span>
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

      {/* Pratinjau label cetak */}
      {label && (
        <div className="modal-root">
          <div className="modal-overlay" onClick={() => setLabel(null)} />
          <div className="modal-panel label-modal-panel" role="dialog" aria-modal="true" aria-label="Pratinjau label batch">
            <h3 className="modal-title">Pratinjau Label</h3>
            <div className="label-sheet">
              <div className="label-brand">NutriLokal</div>
              <div className="label-body">
                {label.photoUrl && (
                  <img className="label-photo" src={label.photoUrl} alt={`Foto ${label.productName}`} />
                )}
                <img className="label-qr" src={label.dataUrl} alt={`Kode QR batch ${label.code}`} />
                <div className="label-info">
                  <div className="label-product">{label.productName}</div>
                  <div className="label-code">{label.code}</div>
                  <div className="label-expiry">
                    {label.expiryLabel ? `Kedaluwarsa: ${label.expiryLabel}` : 'Kedaluwarsa: —'}
                  </div>
                </div>
              </div>
              <div className="label-foot">Pindai QR untuk informasi pelacakan batch.</div>
            </div>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setLabel(null)}>Tutup</button>
              <button className="button" onClick={() => window.print()}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>print</span>
                Cetak Label
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../lib/api'
import { dateCodeToDisplay } from '../utils/dates'
import { productPhotoUrl } from '../utils/product-photo'
import {
  PUBLIC_BATCH_STATUS_META,
  type PublicBatchStatus,
} from '../utils/public-product'
import { whatsappOrderUrl } from '../utils/whatsapp'

// Respons backend: GET /api/public/products/:id
// Hanya informasi publik. Riwayat batch selalu dibaca ulang dari database,
// sehingga batch baru dan perubahan status langsung tampil tanpa cetak ulang QR.
interface PublicProductBatch {
  code: string
  productionDate: string | null
  expiryDate: string | null
  status: PublicBatchStatus
}

/** Informasi nilai gizi publik (opsional, hanya bila diisi Admin). */
interface PublicNutritionComponent {
  name: string
  amount?: number
  unit?: string
  akgPercent?: number
}

interface PublicProductNutrition {
  servingSizeAmount?: number
  servingSizeUnit?: string
  servingsPerPackage?: number
  components?: PublicNutritionComponent[]
}

interface PublicProductPageData {
  status: 'PUBLISHED'
  producer: { name: string; location: string }
  product: {
    name: string
    unit: string
    description?: string
    composition?: string
    storageInstructions?: string
    photoUrl?: string
    nutrition?: PublicProductNutrition
  }
  batches: PublicProductBatch[]
}

const numberFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 })

function formatNutritionNumber(value?: number): string | null {
  if (value === undefined || value === null || !Number.isFinite(value)) return null
  return numberFormatter.format(value)
}

function formatServingSize(nutrition: PublicProductNutrition): string | null {
  const amount = formatNutritionNumber(nutrition.servingSizeAmount)
  const unit = nutrition.servingSizeUnit?.trim()
  if (amount && unit) return `${amount} ${unit}`
  if (amount) return amount
  if (unit) return unit
  return null
}

function formatServingsPerPackage(nutrition: PublicProductNutrition): string | null {
  return formatNutritionNumber(nutrition.servingsPerPackage)
}

function componentAmountLabel(component: PublicNutritionComponent): string | null {
  const amount = formatNutritionNumber(component.amount)
  const unit = component.unit?.trim()
  if (amount && unit) return `${amount} ${unit}`
  if (amount) return amount
  if (unit) return unit
  return null
}

function componentAkgLabel(component: PublicNutritionComponent): string | null {
  const akg = formatNutritionNumber(component.akgPercent)
  return akg ? `${akg}% AKG` : null
}

function hasPublicNutrition(nutrition?: PublicProductNutrition): nutrition is PublicProductNutrition {
  if (!nutrition) return false
  const hasServing =
    nutrition.servingSizeAmount !== undefined ||
    !!nutrition.servingSizeUnit?.trim() ||
    nutrition.servingsPerPackage !== undefined
  const hasComponents = (nutrition.components ?? []).some(
    (c) => c.amount !== undefined || !!c.unit?.trim() || c.akgPercent !== undefined,
  )
  return hasServing || hasComponents
}

function DetailCard({
  title,
  children,
  className = '',
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`detail-card ${className}`.trim()}>
      <h2 className="detail-card-title">{title}</h2>
      <div className="detail-card-body">{children}</div>
    </section>
  )
}

export function ProductPublicPage() {
  const { id } = useParams()
  const [data, setData] = useState<PublicProductPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!id) {
      setLoading(false)
      setError('Informasi produk tidak tersedia.')
      return
    }

    setLoading(true)
    setError(null)
    api
      .get(`/public/products/${encodeURIComponent(id)}`)
      .then((res) => {
        if (active) setData(res.data)
      })
      .catch((err: any) => {
        if (!active) return
        setData(null)
        setError(
          err.response?.data?.message ||
            'Informasi produk tidak tersedia atau produk belum dipublikasikan.',
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [id])

  const product = data?.product
  const photo = productPhotoUrl(product?.photoUrl)
  const nutrition = hasPublicNutrition(product?.nutrition) ? product?.nutrition : undefined
  const storageLines = (product?.storageInstructions ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return (
    <div className="public-page">
      <div className="public-shell">
        <header className="public-topbar">
          <Link to="/" className="public-brand">
            <img src="/logo.png" alt="NutriLokal" />
            <span className="public-brand-text">
              <strong>
                NutriLokal
                <span className="public-brand-dot" aria-hidden="true" />
              </strong>
              <small>KWT Gogor · Patuk</small>
            </span>
          </Link>
          <Link to="/catalog" className="public-catalog-link">
            <span className="material-symbols-outlined" aria-hidden="true">
              arrow_back
            </span>
            Katalog
          </Link>
        </header>

        <main className="public-product-main">
          {loading ? (
            <p className="detail-loading">Memuat informasi produk...</p>
          ) : error || !data || !product ? (
            <section className="detail-card detail-unavailable">
              <h1>Informasi Produk Tidak Tersedia</h1>
              <p>
                {error ||
                  'Produk ini belum dipublikasikan atau sudah tidak aktif. Hubungi KWT Gogor bila membutuhkan bantuan.'}
              </p>
              <div className="detail-unavailable-actions">
                <Link to="/catalog" className="detail-secondary-action">
                  Lihat Katalog
                </Link>
              </div>
            </section>
          ) : (
            <>
              <section className="detail-card detail-hero">
                <div className={`detail-hero-photo${photo ? '' : ' is-empty'}`}>
                  {photo ? (
                    <img src={photo} alt={`Foto ${product.name}`} />
                  ) : (
                    <div className="detail-photo-placeholder" aria-hidden="true">
                      <span className="material-symbols-outlined">inventory_2</span>
                      <span>Foto produk belum tersedia</span>
                    </div>
                  )}
                  <span className="detail-photo-badge">
                    Produk {data.producer.name}
                  </span>
                </div>

                <div className="detail-hero-body">
                  <div className="detail-hero-meta">
                    <span className="detail-eyebrow">Informasi Produk</span>
                    <span className="detail-netto">Per {product.unit}</span>
                  </div>
                  <h1 className="detail-product-name">{product.name}</h1>
                  <p className="detail-product-caption">
                    Informasi dari {data.producer.name}
                  </p>

                  <div className="detail-origin-grid">
                    <div className="detail-origin-item">
                      <span className="detail-origin-icon" aria-hidden="true">
                        <span className="material-symbols-outlined">groups</span>
                      </span>
                      <span>
                        <small>Produsen</small>
                        <strong>{data.producer.name}</strong>
                      </span>
                    </div>
                    <div className="detail-origin-item">
                      <span className="detail-origin-icon" aria-hidden="true">
                        <span className="material-symbols-outlined">location_on</span>
                      </span>
                      <span>
                        <small>Lokasi Produksi</small>
                        <strong>{data.producer.location}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="detail-scan-note">
                    <span className="material-symbols-outlined" aria-hidden="true">
                      qr_code_2
                    </span>
                    <p>
                      Pindai QR ini untuk melihat informasi produk dan seluruh
                      riwayat batch produksinya. Cocokkan kode batch pada kemasan
                      Anda dengan daftar di bawah.
                    </p>
                  </div>
                </div>
              </section>

              {product.description && (
                <DetailCard title="Deskripsi Produk">
                  <p className="detail-text">{product.description}</p>
                </DetailCard>
              )}

              {product.composition && (
                <DetailCard title="Komposisi">
                  <p className="detail-text">{product.composition}</p>
                </DetailCard>
              )}

              {nutrition && (
                <DetailCard title="Informasi Nilai Gizi" className="detail-nutrition">
                  {formatServingSize(nutrition) && (
                    <div className="detail-nutrition-row">
                      <span>Takaran Saji</span>
                      <strong>{formatServingSize(nutrition)}</strong>
                    </div>
                  )}
                  {formatServingsPerPackage(nutrition) && (
                    <div className="detail-nutrition-row">
                      <span>Jumlah Sajian per Kemasan</span>
                      <strong>{formatServingsPerPackage(nutrition)}</strong>
                    </div>
                  )}
                  {(nutrition.components?.length ?? 0) > 0 && (
                    <div className="detail-nutrition-table" role="table" aria-label="Kandungan gizi">
                      <div className="detail-nutrition-head" role="row">
                        <span role="columnheader">Kandungan Gizi</span>
                        <span role="columnheader">Jumlah</span>
                        <span role="columnheader">%AKG</span>
                      </div>
                      {nutrition.components!.map((component, index) => {
                        const amount = componentAmountLabel(component)
                        const akg = componentAkgLabel(component)
                        if (!amount && !akg) return null
                        return (
                          <div
                            className="detail-nutrition-item"
                            role="row"
                            key={`${component.name}-${index}`}
                          >
                            <span className="detail-nutrition-name" role="cell">{component.name}</span>
                            <span className="detail-nutrition-amount" role="cell">{amount || '—'}</span>
                            <span className="detail-nutrition-akg" role="cell">{akg || ''}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </DetailCard>
              )}

              {product.storageInstructions && (
                <DetailCard title="Petunjuk Penyimpanan">
                  <ul className="detail-storage-list">
                    {storageLines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </DetailCard>
              )}

              <section className="detail-card detail-batch-section">
                <div className="detail-batch-heading">
                  <div>
                    <h2>Riwayat Produksi &amp; Batch</h2>
                    <p>Transparansi kualitas dari kebun ke tangan Anda</p>
                  </div>
                  <span className="detail-batch-count">
                    {data.batches.length} batch
                  </span>
                </div>
                <p className="detail-batch-note">
                  QR di kemasan bersifat permanen untuk produk ini dan tidak
                  memilih batch tertentu. Batch terbaru ditampilkan lebih dulu;
                  status dihitung dari catatan stok, tanggal kedaluwarsa
                  tervalidasi, dan publikasi informasi terkini.
                </p>

                {data.batches.length === 0 ? (
                  <p className="detail-empty-batch">
                    Belum ada catatan batch untuk produk ini.
                  </p>
                ) : (
                  <div
                    className="detail-batch-list"
                    role="table"
                    aria-label="Riwayat batch produksi"
                  >
                    <div className="detail-batch-row detail-batch-head" role="row">
                      <span role="columnheader">Kode Batch</span>
                      <span role="columnheader">Tanggal Produksi</span>
                      <span role="columnheader">Kedaluwarsa</span>
                      <span role="columnheader">Status</span>
                    </div>
                    {data.batches.map((batch) => {
                      const status = PUBLIC_BATCH_STATUS_META[batch.status]
                      return (
                        <div className="detail-batch-row" role="row" key={batch.code}>
                          <div
                            className="detail-batch-code"
                            role="cell"
                            data-label="Kode Batch"
                          >
                            {batch.code}
                          </div>
                          <div
                            className="detail-batch-date"
                            role="cell"
                            data-label="Prod"
                          >
                            {dateCodeToDisplay(batch.productionDate) || '—'}
                          </div>
                          <div
                            className="detail-batch-expiry"
                            role="cell"
                            data-label="Kedaluwarsa"
                          >
                            {dateCodeToDisplay(batch.expiryDate) || '—'}
                          </div>
                          <div
                            className="detail-batch-status-cell"
                            role="cell"
                            data-label="Status"
                          >
                            <span className={`detail-status ${status.cls}`}>
                              {status.label}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <p className="detail-sync-note">
                  Informasi ini disinkronisasi langsung dari buku catatan
                  produksi {data.producer.name}.
                </p>
              </section>

              <section className="detail-actions">
                <a
                  className="detail-whatsapp"
                  href={whatsappOrderUrl(product.name)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    chat
                  </span>
                  Pesan via WhatsApp
                </a>
                <Link to="/catalog" className="detail-secondary-action">
                  Kembali ke Katalog
                </Link>
              </section>
            </>
          )}
        </main>

        <footer className="detail-footer">
          <div className="detail-footer-brand">
            <span className="detail-footer-dot" aria-hidden="true" />
            NutriLokal Traceability
          </div>
          <p>© 2026 NutriLokal · KWT Gogor, Kalurahan Salam, Patuk.</p>
        </footer>
      </div>
    </div>
  )
}

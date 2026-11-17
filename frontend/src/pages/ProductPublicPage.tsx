import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../lib/api'
import { dateCodeToDisplay } from '../utils/dates'
import { productPhotoUrl } from '../utils/product-photo'
import {
  PUBLIC_BATCH_STATUS_META,
  type PublicBatchStatus,
} from '../utils/public-product'

// Respons backend: GET /api/public/products/:id
// Hanya berisi informasi yang memang untuk publik. Riwayat batch selalu
// dibaca dari database, sehingga batch baru dan perubahan status langsung
// tampil tanpa membuat ulang QR.
interface PublicProductBatch {
  code: string
  productionDate: string | null
  expiryDate: string | null
  status: PublicBatchStatus
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
  }
  batches: PublicProductBatch[]
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

  return (
    <div className="public-page">
      <header className="public-topbar">
        <Link to="/" className="public-brand">
          <img src="/logo.png" alt="NutriLokal" />
          <span>NutriLokal</span>
        </Link>
        <Link to="/catalog" className="button secondary">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            storefront
          </span>
          Katalog
        </Link>
      </header>

      <main className="container public-product">
        {loading ? (
          <p className="text-muted">Memuat informasi produk...</p>
        ) : error || !data || !product ? (
          <section className="card section-card public-unavailable">
            <h1 className="page-title">Informasi Produk Tidak Tersedia</h1>
            <p className="page-subtitle">
              {error ||
                'Produk ini belum dipublikasikan atau sudah tidak aktif. Hubungi KWT Gogor bila membutuhkan bantuan.'}
            </p>
            <div className="public-unavailable-actions">
              <Link to="/catalog" className="button secondary">
                Lihat Katalog
              </Link>
            </div>
          </section>
        ) : (
          <>
            <section className="card public-product-hero">
              {photo && (
                <div className="public-product-photo">
                  <img src={photo} alt={`Foto ${product.name}`} />
                </div>
              )}
              <div className="public-product-body">
                <p className="public-eyebrow">Informasi Produk</p>
                <h1 className="public-product-name">{product.name}</h1>
                <p className="public-product-unit">Dikemas per {product.unit}</p>

                <dl className="public-meta">
                  <div className="public-meta-item">
                    <dt className="card-label">Produsen</dt>
                    <dd className="public-meta-value">{data.producer.name}</dd>
                  </div>
                  <div className="public-meta-item">
                    <dt className="card-label">Lokasi Produksi</dt>
                    <dd className="public-meta-value">{data.producer.location}</dd>
                  </div>
                </dl>

                <p className="public-scan-note">
                  Pindai QR ini untuk melihat informasi produk dan seluruh riwayat
                  batch produksinya. Cocokkan kode batch pada kemasan Anda dengan
                  daftar di bawah.
                </p>
              </div>
            </section>

            {(product.description ||
              product.composition ||
              product.storageInstructions) && (
              <div className="public-info-grid">
                {product.description && (
                  <section className="card public-info-card">
                    <h2 className="card-title">Deskripsi</h2>
                    <p className="public-info-text">{product.description}</p>
                  </section>
                )}
                {product.composition && (
                  <section className="card public-info-card">
                    <h2 className="card-title">Komposisi</h2>
                    <p className="public-info-text">{product.composition}</p>
                  </section>
                )}
                {product.storageInstructions && (
                  <section className="card public-info-card">
                    <h2 className="card-title">Petunjuk Penyimpanan</h2>
                    <p className="public-info-text">{product.storageInstructions}</p>
                  </section>
                )}
              </div>
            )}

            <section className="card section-card public-batch-section">
              <div className="section-head">
                <div>
                  <h2 className="card-title">Riwayat Produksi &amp; Batch</h2>
                  <p className="public-section-note">
                    Batch terbaru ditampilkan lebih dulu. Status dihitung dari
                    catatan stok, tanggal kedaluwarsa tervalidasi, dan publikasi
                    informasi terkini.
                  </p>
                </div>
                <span className="badge neutral">{data.batches.length} batch</span>
              </div>

              {data.batches.length === 0 ? (
                <p className="text-muted">
                  Belum ada catatan batch untuk produk ini.
                </p>
              ) : (
                <div
                  className="public-batch-list"
                  role="table"
                  aria-label="Riwayat batch produksi"
                >
                  <div className="public-batch-row public-batch-head" role="row">
                    <span role="columnheader">Kode Batch</span>
                    <span role="columnheader">Tanggal Produksi</span>
                    <span role="columnheader">Kedaluwarsa</span>
                    <span role="columnheader">Status</span>
                  </div>
                  {data.batches.map((batch) => {
                    const status = PUBLIC_BATCH_STATUS_META[batch.status]
                    return (
                      <div className="public-batch-row" role="row" key={batch.code}>
                        <div
                          className="public-batch-cell public-batch-code"
                          role="cell"
                          data-label="Kode Batch"
                        >
                          {batch.code}
                        </div>
                        <div
                          className="public-batch-cell"
                          role="cell"
                          data-label="Tanggal Produksi"
                        >
                          {dateCodeToDisplay(batch.productionDate) || '—'}
                        </div>
                        <div
                          className="public-batch-cell"
                          role="cell"
                          data-label="Kedaluwarsa"
                        >
                          {dateCodeToDisplay(batch.expiryDate) || '—'}
                        </div>
                        <div className="public-batch-cell" role="cell" data-label="Status">
                          <span className={`badge ${status.cls}`}>{status.label}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <p className="public-foot-note">
              Informasi ini berasal dari catatan produksi {data.producer.name}.
              Hubungi produsen bila ada pertanyaan tentang produk atau batch Anda.
            </p>
          </>
        )}
      </main>
    </div>
  )
}

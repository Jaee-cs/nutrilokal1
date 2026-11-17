import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { useNotify } from '../components/NotificationProvider'
import { productPhotoUrl } from '../utils/product-photo'
import { productPublicPath, productPublicUrl } from '../utils/public-product'

// GET /products mengembalikan seluruh produk (termasuk yang diarsipkan).
// QR produk bersifat permanen: URL-nya hanya bergantung pada ID produk,
// sehingga tidak berubah saat ada produksi baru atau perubahan data produk.
interface Product {
  id: string
  name: string
  unit: string
  isActive: boolean
  photoUrl?: string | null
}

interface LabelState {
  productName: string
  photoUrl: string | null
  dataUrl: string
}

// QR dibuat di klien (tanpa layanan eksternal), koreksi galat M.
const QR_OPTIONS = { width: 320, margin: 1, errorCorrectionLevel: 'M' as const } as const

function downloadFileName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `qr-produk-${slug || 'nutrilokal'}.png`
}

export function ProductQrPage() {
  const notify = useNotify()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [qrById, setQrById] = useState<Record<string, string>>({})
  const [label, setLabel] = useState<LabelState | null>(null)

  async function fetchProducts() {
    try {
      setLoading(true)
      const res = await api.get('/products')
      setProducts((res.data.data || res.data) ?? [])
      setLoadError(null)
    } catch (err: any) {
      setLoadError(err.response?.data?.message || 'Gagal memuat produk')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProducts()
  }, [])

  // Gambar QR untuk seluruh produk. QR hanya bergantung pada ID produk,
  // bukan pada batch, sehingga tetap sama sepanjang umur produk.
  useEffect(() => {
    let active = true
    if (products.length === 0) {
      setQrById({})
      return
    }

    Promise.all(
      products.map(async (product) => {
        try {
          const dataUrl = await QRCode.toDataURL(productPublicUrl(product.id), QR_OPTIONS)
          return [product.id, dataUrl] as const
        } catch {
          return null
        }
      }),
    )
      .then((entries) => {
        if (!active) return
        const next: Record<string, string> = {}
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1]
        }
        setQrById(next)
      })
      .catch(() => {
        if (active) notify.error('Gagal membuat gambar QR produk')
      })

    return () => {
      active = false
    }
  }, [products])

  async function downloadQr(product: Product) {
    try {
      // Unduhan memakai resolusi lebih tinggi agar tajam saat dicetak.
      const dataUrl = await QRCode.toDataURL(productPublicUrl(product.id), {
        ...QR_OPTIONS,
        width: 1024,
      })
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = downloadFileName(product.name)
      document.body.appendChild(link)
      link.click()
      link.remove()
      notify.success('QR produk berhasil diunduh')
    } catch {
      notify.error('Gagal mengunduh QR produk')
    }
  }

  async function openLabel(product: Product) {
    const dataUrl =
      qrById[product.id] ??
      (await QRCode.toDataURL(productPublicUrl(product.id), QR_OPTIONS).catch(() => null))
    if (!dataUrl) {
      notify.error('Gagal membuat gambar QR untuk label')
      return
    }
    setLabel({
      productName: product.name,
      photoUrl: productPhotoUrl(product.photoUrl),
      dataUrl,
    })
  }

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">QR Produk</h1>
        <p className="page-subtitle">
          Satu QR permanen untuk setiap produk. QR mengarah ke halaman publik
          produk yang menampilkan informasi produk dan seluruh riwayat batch
          terbaru, sehingga tidak perlu dibuat ulang saat ada produksi baru.
        </p>
      </div>

      {loadError && <div className="alert error">{loadError}</div>}

      <section className="card section-card">
        <div className="section-head">
          <h2 className="card-title">Daftar Produk</h2>
          <span className="text-muted">{products.length} produk</span>
        </div>

        {loading ? (
          <p className="text-muted">Memuat produk...</p>
        ) : products.length === 0 ? (
          <p className="text-muted">Belum ada produk.</p>
        ) : (
          <div className="product-qr-grid">
            {products.map((product) => {
              const qr = qrById[product.id]
              const url = productPublicUrl(product.id)
              return (
                <article className="product-qr-card" key={product.id}>
                  <div className="product-qr-preview">
                    {qr ? (
                      <img src={qr} alt={`Kode QR produk ${product.name}`} />
                    ) : (
                      <div className="qr-placeholder text-muted">Membuat QR…</div>
                    )}
                  </div>

                  <div className="product-qr-body">
                    <div className="product-qr-head">
                      <h3 className="product-name">{product.name}</h3>
                      <span className={`badge ${product.isActive ? 'success' : 'neutral'}`}>
                        {product.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                    <p className="product-unit">Per {product.unit}</p>
                    <p className="product-qr-url">{productPublicPath(product.id)}</p>

                    {!product.isActive && (
                      <p className="product-qr-note text-muted">
                        Halaman publik tidak aktif selama produk dinonaktifkan.
                        QR tetap sama dan berlaku kembali bila produk diaktifkan.
                      </p>
                    )}

                    <div className="product-qr-actions">
                      <button
                        className="button"
                        onClick={() => downloadQr(product)}
                        disabled={!qr}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          download
                        </span>
                        Unduh PNG
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => openLabel(product)}
                        disabled={!qr}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          print
                        </span>
                        Label
                      </button>
                      <Link
                        to={productPublicPath(product.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="button secondary"
                        title={url}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          open_in_new
                        </span>
                        Buka Halaman
                      </Link>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {/* Pratinjau label cetak. Kelas label yang sama dipakai QR batch agar
          hasil cetak tetap konsisten (70mm x 50mm). */}
      {label && (
        <div className="modal-root">
          <div className="modal-overlay" onClick={() => setLabel(null)} />
          <div
            className="modal-panel label-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Pratinjau label produk"
          >
            <h3 className="modal-title">Pratinjau Label Produk</h3>
            <div className="label-sheet">
              <div className="label-brand">NutriLokal · KWT Gogor</div>
              <div className={`label-top-row${label.photoUrl ? '' : ' qr-only'}`}>
                {label.photoUrl && (
                  <div className="label-visuals">
                    <img
                      className="label-photo"
                      src={label.photoUrl}
                      alt={`Foto ${label.productName}`}
                    />
                  </div>
                )}
                <div className="label-qr-col">
                  <img
                    className="label-qr"
                    src={label.dataUrl}
                    alt={`Kode QR produk ${label.productName}`}
                  />
                </div>
              </div>
              <div className="label-info">
                <div className="label-product">{label.productName}</div>
              </div>
              <div className="label-foot">
                Pindai QR untuk informasi produk &amp; riwayat batch.
              </div>
            </div>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setLabel(null)}>
                Tutup
              </button>
              <button className="button" onClick={() => window.print()}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  print
                </span>
                Cetak Label
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

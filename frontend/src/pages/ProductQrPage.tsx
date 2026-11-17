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

// QR dibuat di klien (tanpa layanan eksternal), koreksi galat M.
// Pratinjau 320px cukup untuk 80px di kartu; unduhan/cetak memakai 1024px.
// Cetak memakai quiet zone 4 modul sesuai spesifikasi QR.
const QR_OPTIONS = { width: 320, margin: 1, errorCorrectionLevel: 'M' as const } as const
const PRINT_QR_OPTIONS = { ...QR_OPTIONS, width: 1024, margin: 4 } as const

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

  /**
   * Cetak memakai iframe tersembunyi yang berisi SATU QR saja. Dokumen cetak
   * ini terpisah dari halaman daftar produk sehingga tidak ada kartu, foto,
   * tombol, header, maupun QR produk lain yang ikut tercetak.
   */
  async function printQrOnly(product: Product) {
    try {
      const dataUrl = await QRCode.toDataURL(
        productPublicUrl(product.id),
        PRINT_QR_OPTIONS,
      )

      const frame = document.createElement('iframe')
      frame.setAttribute('aria-hidden', 'true')
      frame.style.position = 'fixed'
      frame.style.right = '0'
      frame.style.bottom = '0'
      frame.style.width = '0'
      frame.style.height = '0'
      frame.style.border = '0'
      document.body.appendChild(frame)

      const doc = frame.contentDocument
      if (!doc) throw new Error('Dokumen cetak tidak tersedia')

      doc.open()
      doc.write(`<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>QR Produk</title>
  <style>
    @page { size: A4 portrait; margin: 18mm; }
    html, body { margin: 0; padding: 0; height: 100%; background: #fff; }
    body { display: flex; align-items: center; justify-content: center; }
    img {
      display: block;
      width: 60mm;
      height: 60mm;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  </style>
</head>
<body><img src="${dataUrl}" alt="Kode QR produk" /></body>
</html>`)
      doc.close()

      const printWindow = frame.contentWindow
      printWindow?.focus()
      printWindow?.print()
      // Bersihkan iframe setelah dialog cetak ditutup; fallback timeout
      // untuk browser yang tidak memicu afterprint.
      printWindow?.addEventListener('afterprint', () => frame.remove(), { once: true })
      window.setTimeout(() => frame.remove(), 60_000)
    } catch {
      notify.error('Gagal membuat gambar QR untuk cetak')
    }
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
              const photo = productPhotoUrl(product.photoUrl)
              return (
                <article className="product-qr-card" key={product.id}>
                  <div className="product-qr-main">
                    <div className="product-qr-photo">
                      {photo ? (
                        <img src={photo} alt={`Foto ${product.name}`} loading="lazy" />
                      ) : (
                        <span className="material-symbols-outlined" aria-hidden="true">
                          inventory_2
                        </span>
                      )}
                    </div>

                    <div className="product-qr-body">
                      <div className="product-qr-head">
                        <h3 className="product-name" title={product.name}>{product.name}</h3>
                        <span className={`badge ${product.isActive ? 'success' : 'neutral'}`}>
                          {product.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </div>
                      <p className="product-unit">Per {product.unit}</p>
                      <p className="product-qr-url">{productPublicPath(product.id)}</p>
                    </div>

                    <div className="product-qr-preview">
                      {qr ? (
                        <img src={qr} alt={`Kode QR produk ${product.name}`} />
                      ) : (
                        <div className="qr-placeholder text-muted">QR</div>
                      )}
                    </div>
                  </div>

                  {!product.isActive && (
                    <p className="product-qr-note text-muted">
                      Halaman publik nonaktif. QR tetap berlaku saat produk diaktifkan.
                    </p>
                  )}

                  <div className="product-qr-actions">
                    <button
                      className="button"
                      onClick={() => downloadQr(product)}
                      disabled={!qr}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        download
                      </span>
                      Unduh QR
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => printQrOnly(product)}
                      disabled={!qr}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        print
                      </span>
                      Cetak QR
                    </button>
                    <Link
                      to={productPublicPath(product.id)}
                      target="_blank"
                      rel="noreferrer"
                      className="button secondary"
                      title={url}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        open_in_new
                      </span>
                      Buka Halaman
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

    </div>
  )
}
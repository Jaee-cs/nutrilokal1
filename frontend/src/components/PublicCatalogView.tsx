import { Link } from 'react-router-dom'
import { productPhotoUrl } from '../utils/product-photo'
import { productPublicPath } from '../utils/public-product'
import { whatsappOrderUrl } from '../utils/whatsapp'

/** Shape dari GET /api/public/catalog — hanya field publik. */
export interface PublicCatalogProduct {
  id: string
  name: string
  unit: string
  sellingPrice: number
  description?: string
  photoUrl?: string
}

interface PublicCatalogViewProps {
  products: PublicCatalogProduct[]
  loading: boolean
  error: string | null
}

/**
 * Komponen tampilan katalog publik sesuai referensi `halaman awal/code.html`.
 * Dipakai bersama oleh rute "/" dan "/catalog" agar navigasi keduanya tetap
 * hidup tanpa menduplikasi markup.
 */
export function PublicCatalogView({
  products,
  loading,
  error,
}: PublicCatalogViewProps) {
  return (
    <>
      <main className="landing-main">
        <div className="landing-head">
          <h1 className="landing-title">Katalog Publik</h1>
          <p className="landing-subtitle">
            Produk aktif KWT Gogor yang tersedia untuk umum.
          </p>
        </div>

        {error && <div className="landing-alert">{error}</div>}

        {loading ? (
          <p className="landing-loading">Memuat katalog...</p>
        ) : products.length === 0 ? (
          <div className="landing-empty">Belum ada produk aktif.</div>
        ) : (
          <div className="landing-catalog">
            {products.map((product) => {
              const photo = productPhotoUrl(product.photoUrl)
              const detailPath = productPublicPath(product.id)

              return (
                <article className="landing-product-card" key={product.id}>
                  <div className="landing-card-head">
                    <div className="landing-card-identity">
                      <h2 className="landing-product-name">
                        <Link to={detailPath}>{product.name}</Link>
                      </h2>
                      <p className="landing-product-unit">Per {product.unit}</p>
                    </div>
                    <span className="landing-status">
                      <span className="landing-status-dot" aria-hidden="true" />
                      Aktif
                    </span>
                  </div>

                  {photo ? (
                    <div className="landing-photo">
                      <img
                        src={photo}
                        alt={`Foto ${product.name}`}
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  ) : (
                    <div className="landing-photo landing-photo-empty" aria-hidden="true">
                      <span className="material-symbols-outlined">inventory_2</span>
                    </div>
                  )}

                  <div className="landing-price">
                    <span className="landing-price-label">Harga Jual</span>
                    <strong className="landing-price-value">
                      Rp {Number(product.sellingPrice).toLocaleString('id-ID')}
                    </strong>
                  </div>

                  {product.description && (
                    <p className="landing-description">{product.description}</p>
                  )}

                  <div className="landing-card-actions">
                    <a
                      className="landing-order"
                      href={whatsappOrderUrl(product.name)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        chat
                      </span>
                      Pesan WhatsApp
                    </a>
                    <Link
                      className="landing-info"
                      to={detailPath}
                      aria-label={`Informasi Produk ${product.name}`}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        info
                      </span>
                      Info
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        <div className="landing-trust">
          <div className="landing-trust-icon" aria-hidden="true">
            <span className="material-symbols-outlined">verified_user</span>
          </div>
          <div className="landing-trust-text">
            <strong>100% Produk Kelompok Tani</strong>
            <p>
              Diproduksi secara bersih, higienis, dan terdata langsung dari
              kebun anggota KWT Gogor.
            </p>
          </div>
        </div>

        <div className="landing-secondary-links">
          <Link to="/qr-trace" className="landing-trace-link">
            <span className="material-symbols-outlined" aria-hidden="true">
              qr_code_2
            </span>
            Cek Traceability QR
          </Link>
        </div>
      </main>

      <footer className="landing-foot">
        © 2026 NutriLokal · KWT Gogor, Kalurahan Salam
      </footer>
    </>
  )
}

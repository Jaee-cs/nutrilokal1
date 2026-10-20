import { Link } from 'react-router-dom'
import './LandingPage.css'

/**
 * Landing page publik NutriLokal.
 *
 * Titik masuk aplikasi (rute "/") untuk pengunjung tanpa login:
 * - "Lihat Katalog" menuju halaman katalog publik yang sudah ada (/catalog),
 *   yang memang dapat dibuka tanpa token.
 * - "Login" menuju halaman login yang sekarang (/login) tanpa mengubah
 *   alur autentikasinya.
 *
 * Halaman ini murni tampilan frontend: tidak memanggil API dan tidak
 * mengubah aturan bisnis apa pun.
 */
export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand">
            <span className="material-symbols-outlined landing-brand-icon">eco</span>
            <span className="landing-brand-name">NutriLokal</span>
          </div>
          <Link to="/login" className="button secondary landing-nav-login">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              login
            </span>
            Login
          </Link>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <span className="landing-eyebrow">
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              location_on
            </span>
            KWT Gogor · Kalurahan Salam, Patuk, Gunungkidul
          </span>

          <h1 className="landing-title">
            Ketahanan pangan lokal,
            <br />
            terlacak hingga batch.
          </h1>

          <p className="landing-lead">
            NutriLokal membantu KWT Gogor mengelola produksi, bahan baku, dan penjualan
            sekaligus menjaga setiap produk dapat ditelusuri asalnya. Lihat katalog produk
            kami, atau masuk untuk mengelola sistem.
          </p>

          <div className="landing-actions">
            <Link to="/catalog" className="button landing-cta">
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                storefront
              </span>
              Lihat Katalog
            </Link>
            <Link to="/login" className="button secondary landing-cta">
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                login
              </span>
              Login Admin / Operator
            </Link>
          </div>

          <ul className="landing-points">
            <li>
              <span className="material-symbols-outlined landing-point-icon">inventory_2</span>
              Produk olahan lokal dari bahan segar
            </li>
            <li>
              <span className="material-symbols-outlined landing-point-icon">qr_code_2</span>
              Traceability batch lewat kode QR
            </li>
            <li>
              <span className="material-symbols-outlined landing-point-icon">verified</span>
              Proses produksi tercatat dan transparan
            </li>
          </ul>
        </section>

        <aside className="landing-aside" aria-hidden="true">
          <div className="landing-card">
            <span className="material-symbols-outlined landing-card-icon">eco</span>
            <div className="landing-card-title">Produk Segar, Terlacak</div>
            <p className="landing-card-text">
              Setiap batch tercatat sejak produksi hingga sampai ke pelanggan.
            </p>
          </div>
        </aside>
      </main>

      <footer className="landing-foot">© 2026 NutriLokal · KWT Gogor, Kalurahan Salam</footer>
    </div>
  )
}

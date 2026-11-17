import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import {
  PublicCatalogView,
  type PublicCatalogProduct,
} from '../components/PublicCatalogView'
import './LandingPage.css'

/** Rute "/catalog" memakai tampilan katalog referensi yang sama dengan "/". */
export function CatalogPage() {
  const [products, setProducts] = useState<PublicCatalogProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    setLoading(true)
    setError(null)
    api
      .get('/public/catalog')
      .then((res) => {
        if (active) setProducts(res.data?.products ?? [])
      })
      .catch((err: any) => {
        if (!active) return
        setProducts([])
        setError(err.response?.data?.message || 'Gagal memuat katalog')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link to="/" className="landing-brand">
            <img src="/logo.png" alt="NutriLokal" />
            <span className="landing-brand-text">
              <strong>NutriLokal</strong>
              <small>KWT Gogor</small>
            </span>
          </Link>
          <Link to="/login" className="landing-login">
            <span className="material-symbols-outlined" aria-hidden="true">
              login
            </span>
            Masuk
          </Link>
        </div>
      </header>

      <PublicCatalogView products={products} loading={loading} error={error} />
    </div>
  )
}

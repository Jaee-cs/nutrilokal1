import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'

interface PublicProduct {
  name: string
  unit: string
  sellingPrice: number
  description?: string
}

export function CatalogPage() {
  const [products, setProducts] = useState<PublicProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function fetchCatalog() {
    try {
      setLoading(true)
      const res = await api.get('/public/catalog')
      setProducts(res.data.products || [])
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat katalog')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCatalog()
  }, [])

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Katalog Publik</h1>
        <p className="page-subtitle">
          Produk aktif KWT Gogor yang tersedia untuk umum.
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <p className="text-muted">Memuat katalog...</p>
      ) : products.length === 0 ? (
        <div className="card">
          <p className="text-muted">Belum ada produk aktif.</p>
        </div>
      ) : (
        <div className="product-grid">
          {products.map((p, idx) => (
            <div key={idx} className="card product-card">
              <div className="product-card-head">
                <div className="product-info">
                  <h3 className="product-name">{p.name}</h3>
                  <p className="product-unit">Per {p.unit}</p>
                </div>
                <span className="badge success">Aktif</span>
              </div>

              <div className="product-price">
                <span className="card-label">Harga Jual</span>
                <span className="price-value">
                  Rp {Number(p.sellingPrice).toLocaleString('id-ID')}
                </span>
              </div>

              {p.description && <p className="product-desc">{p.description}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="catalog-foot">
        <Link to="/qr-trace" className="button secondary">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>qr_code_2</span>
          Cek Traceability QR
        </Link>
      </div>
    </div>
  )
}

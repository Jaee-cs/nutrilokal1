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
      <h1 className="page-title">Katalog Publik</h1>
      <p className="page-subtitle">Produk aktif yang tersedia untuk publik.</p>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="card">Memuat...</div>
      ) : products.length === 0 ? (
        <div className="card" style={{ color: 'var(--color-muted)' }}>Belum ada produk aktif.</div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Produk</th>
                <th>Satuan</th>
                <th>Harga Jual</th>
                <th>Deskripsi</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p, idx) => (
                <tr key={idx}>
                  <td>{p.name}</td>
                  <td>{p.unit}</td>
                  <td>Rp {Number(p.sellingPrice).toLocaleString('id-ID')}</td>
                  <td>{p.description || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: '1rem' }}>
        <Link to="/qr-trace" style={{ color: 'var(--color-primary)' }}>Cek Traceability QR</Link>
      </div>
    </div>
  )
}

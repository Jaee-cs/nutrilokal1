import { useEffect, useState } from 'react'
import api from '../lib/api'

interface DashboardData {
  materials: { items: Array<{ name: string; unit: string; stock: number }>, count: number }
  products: { items: Array<{ name: string; unit: string; stock: number; batchCount: number }>, count: number, batchesWithStock: Array<any> }
  production: { recordCount: number, byProduct: Array<any>, recent: Array<any> }
  sales: { transactionCount: number, cancelledCount: number, omzet: number, recent: Array<any> }
}

export function ReportsPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function fetchDashboard() {
    try {
      setLoading(true)
      const res = await api.get('/dashboard')
      setData(res.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat dashboard/laporan')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboard()
  }, [])

  return (
    <div className="container">
      <h1 className="page-title">Dashboard & Laporan</h1>
      <p className="page-subtitle">Ringkasan operasional berdasarkan data aktual (transaksi batal tidak masuk omzet).</p>

      {error && <div className="alert error">{error}</div>}

      {loading && <div className="card">Memuat...</div>}

      {data && (
        <div>
          <div className="form-row" style={{ marginBottom: '1rem' }}>
            <div className="card">
              <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Stok Bahan Baku</h3>
              <div>Jenis: {data.materials.count}</div>
            </div>
            <div className="card">
              <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Stok Produk Jadi</h3>
              <div>Produk: {data.products.count}</div>
            </div>
            <div className="card">
              <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Produksi</h3>
              <div>Catatan: {data.production.recordCount}</div>
            </div>
            <div className="card">
              <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Penjualan</h3>
              <div>Transaksi Selesai: {data.sales.transactionCount}</div>
              <div>Dibatalkan: {data.sales.cancelledCount}</div>
              <div>Omzet: Rp {Number(data.sales.omzet).toLocaleString('id-ID')}</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <h2 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Stok Bahan Baku (per jenis)</h2>
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Bahan</th><th>Satuan</th><th>Stok</th></tr></thead>
                <tbody>
                  {data.materials.items.map((m, i) => (
                    <tr key={i}><td>{m.name}</td><td>{m.unit}</td><td>{m.stock.toLocaleString('id-ID')}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: '1rem' }}>
            <h2 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Stok Produk Jadi</h2>
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Produk</th><th>Satuan</th><th>Stok Total</th><th>Batch dengan Stok</th></tr></thead>
                <tbody>
                  {data.products.items.map((p, i) => (
                    <tr key={i}><td>{p.name}</td><td>{p.unit}</td><td>{p.stock.toLocaleString('id-ID')}</td><td>{p.batchCount}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.products.batchesWithStock.length > 0 && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <h2 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Batch dengan Stok</h2>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Kode Batch</th><th>Produk</th><th>Stok</th><th>Tgl Produksi</th><th>Kedaluwarsa</th></tr></thead>
                  <tbody>
                    {data.products.batchesWithStock.slice(0, 20).map((b, i) => (
                      <tr key={i}><td>{b.code}</td><td>{b.productName}</td><td>{b.stock.toLocaleString('id-ID')}</td><td>{b.productionDate}</td><td>{b.expiryDate || '-'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <h2 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Penjualan Terbaru</h2>
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Waktu</th><th>Total</th><th>Status</th></tr></thead>
                <tbody>
                  {data.sales.recent.map((s: any, i: number) => (
                    <tr key={i}>
                      <td>{new Date(s.recordedAt).toLocaleString('id-ID')}</td>
                      <td>Rp {Number(s.total).toLocaleString('id-ID')}</td>
                      <td>{s.cancelledAt ? 'Dibatalkan' : 'Selesai'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

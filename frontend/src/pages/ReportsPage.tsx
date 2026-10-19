import { useCallback, useEffect, useState } from 'react'
import api from '../lib/api'

interface StockReport {
  materials: Array<{ id: string; name: string; unit: string; stock: number }>
  products: Array<{ id: string; name: string; unit: string; stock: number; batches: Array<{ code: string }> }>
}

interface MaterialsReport {
  from: string | null
  to: string | null
  materials: Array<{
    id: string; name: string; unit: string
    received: number; openingBalance: number; used: number; adjusted: number; currentStock: number
  }>
}

interface ProductionsReport {
  from: string | null
  to: string | null
  summary: { recordCount: number; byProduct: Array<{ productName: string; unit: string; recordCount: number; totalYield: number }> }
  records: Array<{ id: string; productionDate: string; productName: string; unit: string; yieldQuantity: number }>
}

interface SalesReport {
  from: string | null
  to: string | null
  summary: { transactionCount: number; cancelledCount: number; omzet: number }
  byDay: Array<{ date: string; transactionCount: number; omzet: number }>
  byProduct: Array<{ productId: string; name: string; unit: string; quantity: number; value: number }>
}

const nf = (n: number) => Number(n).toLocaleString('id-ID')

export function ReportsPage() {
  const [stock, setStock] = useState<StockReport | null>(null)
  const [materials, setMaterials] = useState<MaterialsReport | null>(null)
  const [productions, setProductions] = useState<ProductionsReport | null>(null)
  const [sales, setSales] = useState<SalesReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const fetchReports = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params: Record<string, string> = {}
    if (from) params.from = from
    if (to) params.to = to
    try {
      const [s, m, p, sa] = await Promise.all([
        api.get('/reports/stock'),
        api.get('/reports/materials', { params }),
        api.get('/reports/productions', { params }),
        api.get('/reports/sales', { params }),
      ])
      setStock(s.data)
      setMaterials(m.data)
      setProductions(p.data)
      setSales(sa.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat laporan')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  return (
    <div className="container">
      <h1 className="page-title">Laporan Operasional</h1>
      <p className="page-subtitle">
        Angka diturunkan dari catatan historis di database. Transaksi batal tidak dihitung sebagai omzet.
      </p>

      {error && <div className="alert error">{error}</div>}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Filter tanggal (opsional)</h3>
        <div className="form-row" style={{ alignItems: 'end' }}>
          <div className="field">
            <label htmlFor="report-from">Dari</label>
            <input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="report-to">Sampai</label>
            <input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button type="button" className="button" onClick={fetchReports} disabled={loading}>
            {loading ? 'Memuat...' : 'Terapkan'}
          </button>
        </div>
      </div>

      {loading && <div className="card">Memuat laporan...</div>}

      {!loading && sales && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Ringkasan Penjualan{(sales.from || sales.to) ? ' (periode dipilih)' : ''}</h3>
          <div className="form-row" style={{ marginBottom: '0.5rem' }}>
            <div><strong>Transaksi aktif:</strong> {sales.summary.transactionCount}</div>
            <div><strong>Dibatalkan:</strong> {sales.summary.cancelledCount}</div>
            <div><strong>Omzet:</strong> Rp {nf(sales.summary.omzet)}</div>
          </div>
          {sales.byDay.length > 0 && (
            <div className="table-wrapper" style={{ marginTop: '0.5rem' }}>
              <table>
                <thead><tr><th>Tanggal</th><th>Transaksi</th><th>Omzet</th></tr></thead>
                <tbody>
                  {sales.byDay.map((d, i) => (
                    <tr key={i}><td>{d.date}</td><td>{d.transactionCount}</td><td>Rp {nf(d.omzet)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sales.byProduct.length > 0 && (
            <div className="table-wrapper" style={{ marginTop: '0.5rem' }}>
              <table>
                <thead><tr><th>Produk</th><th>Qty</th><th>Omzet</th></tr></thead>
                <tbody>
                  {sales.byProduct.map((p, i) => (
                    <tr key={i}><td>{p.name}</td><td>{nf(p.quantity)} {p.unit}</td><td>Rp {nf(p.value)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sales.byDay.length === 0 && sales.byProduct.length === 0 && (
            <p style={{ color: 'var(--color-muted)' }}>Tidak ada data penjualan pada periode ini.</p>
          )}
        </div>
      )}

      {!loading && productions && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Ringkasan Produksi</h3>
          <p><strong>Catatan:</strong> {productions.summary.recordCount}</p>
          {productions.summary.byProduct.length > 0 && (
            <div className="table-wrapper" style={{ marginTop: '0.5rem' }}>
              <table>
                <thead><tr><th>Produk</th><th>Catatan</th><th>Total hasil</th></tr></thead>
                <tbody>
                  {productions.summary.byProduct.map((p, i) => (
                    <tr key={i}><td>{p.productName}</td><td>{p.recordCount}</td><td>{nf(p.totalYield)} {p.unit}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {productions.records.length > 0 && (
            <div className="table-wrapper" style={{ marginTop: '0.5rem' }}>
              <table>
                <thead><tr><th>Tanggal</th><th>Produk</th><th>Hasil</th></tr></thead>
                <tbody>
                  {productions.records.slice(0, 20).map((r) => (
                    <tr key={r.id}><td>{new Date(r.productionDate).toLocaleDateString('id-ID')}</td><td>{r.productName}</td><td>{nf(r.yieldQuantity)} {r.unit}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading && materials && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Pergerakan Bahan Baku</h3>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Bahan</th><th>Diterima</th><th>Saldo awal</th><th>Dipakai</th><th>Disesuaikan</th><th>Stok saat ini</th></tr></thead>
              <tbody>
                {materials.materials.map((m, i) => (
                  <tr key={i}>
                    <td>{m.name}</td><td>{nf(m.received)}</td><td>{nf(m.openingBalance)}</td>
                    <td>{nf(m.used)}</td><td>{nf(m.adjusted)}</td><td>{nf(m.currentStock)} {m.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && stock && (
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Snapshot Stok Saat Ini</h3>
          <h4 style={{ margin: '0.5rem 0' }}>Bahan baku</h4>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Bahan</th><th>Stok</th></tr></thead>
              <tbody>{stock.materials.map((m, i) => (<tr key={i}><td>{m.name}</td><td>{nf(m.stock)} {m.unit}</td></tr>))}</tbody>
            </table>
          </div>
          <h4 style={{ margin: '0.5rem 0' }}>Produk jadi</h4>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Produk</th><th>Stok</th><th>Batch</th></tr></thead>
              <tbody>
                {stock.products.map((p, i) => (
                  <tr key={i}><td>{p.name}</td><td>{nf(p.stock)}</td><td>{p.batches.map((b) => b.code).join(', ') || '-'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

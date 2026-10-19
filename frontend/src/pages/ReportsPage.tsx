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
      <div className="page-head">
        <h1 className="page-title">Laporan Operasional</h1>
        <p className="page-subtitle">
          Angka diturunkan dari catatan historis di database. Transaksi batal tidak dihitung sebagai omzet.
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}

      {/* Filter tanggal */}
      <section className="card section-card">
        <div className="section-head">
          <h2 className="card-title">Filter tanggal (opsional)</h2>
          <button type="button" className="button" onClick={fetchReports} disabled={loading}>
            {loading ? 'Memuat...' : 'Terapkan'}
          </button>
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="report-from">Dari</label>
            <input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="report-to">Sampai</label>
            <input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </section>

      {loading && <p className="text-muted">Memuat laporan...</p>}

      {/* Ringkasan penjualan */}
      {!loading && sales && (
        <section className="card section-card">
          <div className="section-head">
            <h2 className="card-title">
              Ringkasan Penjualan{(sales.from || sales.to) ? ' (periode dipilih)' : ''}
            </h2>
          </div>
          <div className="summary-row" style={{ marginBottom: '1rem' }}>
            <div className="summary-item">
              <span className="card-label">Transaksi Aktif</span>
              <span className="summary-value">{sales.summary.transactionCount}</span>
            </div>
            <div className="summary-item">
              <span className="card-label">Dibatalkan</span>
              <span className="summary-value">{sales.summary.cancelledCount}</span>
            </div>
            <div className="summary-item">
              <span className="card-label">Omzet</span>
              <span className="summary-value" style={{ color: 'var(--primary)' }}>
                Rp {nf(sales.summary.omzet)}
              </span>
            </div>
          </div>

          {sales.byDay.length > 0 && (
            <>
              <h3 className="sub-heading">Omzet per Hari</h3>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Tanggal</th><th>Transaksi</th><th>Omzet</th></tr></thead>
                  <tbody>
                    {sales.byDay.map((d, i) => (
                      <tr key={i}>
                        <td>{d.date}</td>
                        <td className="num">{d.transactionCount}</td>
                        <td className="num">Rp {nf(d.omzet)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {sales.byProduct.length > 0 && (
            <>
              <h3 className="sub-heading">Penjualan per Produk</h3>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Produk</th><th>Qty</th><th>Omzet</th></tr></thead>
                  <tbody>
                    {sales.byProduct.map((p, i) => (
                      <tr key={i}>
                        <td className="cell-primary">{p.name}</td>
                        <td className="num">{nf(p.quantity)} <span className="text-muted">{p.unit}</span></td>
                        <td className="num">Rp {nf(p.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {sales.byDay.length === 0 && sales.byProduct.length === 0 && (
            <p className="text-muted">Tidak ada data penjualan pada periode ini.</p>
          )}
        </section>
      )}

      {/* Ringkasan produksi */}
      {!loading && productions && (
        <section className="card section-card">
          <div className="section-head">
            <h2 className="card-title">Ringkasan Produksi</h2>
            <span className="text-muted">{productions.summary.recordCount} catatan</span>
          </div>

          {productions.summary.byProduct.length > 0 && (
            <>
              <h3 className="sub-heading">Per Produk</h3>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Produk</th><th>Catatan</th><th>Total Hasil</th></tr></thead>
                  <tbody>
                    {productions.summary.byProduct.map((p, i) => (
                      <tr key={i}>
                        <td className="cell-primary">{p.productName}</td>
                        <td className="num">{p.recordCount}</td>
                        <td className="num">{nf(p.totalYield)} <span className="text-muted">{p.unit}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {productions.records.length > 0 && (
            <>
              <h3 className="sub-heading">Catatan Terakhir</h3>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Tanggal</th><th>Produk</th><th>Hasil</th></tr></thead>
                  <tbody>
                    {productions.records.slice(0, 20).map((r) => (
                      <tr key={r.id}>
                        <td>{new Date(r.productionDate).toLocaleDateString('id-ID')}</td>
                        <td className="cell-primary">{r.productName}</td>
                        <td className="num">{nf(r.yieldQuantity)} <span className="text-muted">{r.unit}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* Pergerakan bahan baku */}
      {!loading && materials && (
        <section className="card section-card">
          <div className="section-head">
            <h2 className="card-title">Pergerakan Bahan Baku</h2>
            {(materials.from || materials.to) && <span className="text-muted">periode dipilih</span>}
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Bahan</th>
                  <th>Diterima</th>
                  <th>Saldo Awal</th>
                  <th>Dipakai</th>
                  <th>Disesuaikan</th>
                  <th>Stok Saat Ini</th>
                </tr>
              </thead>
              <tbody>
                {materials.materials.map((m, i) => (
                  <tr key={i}>
                    <td className="cell-primary">{m.name}</td>
                    <td className="num">{nf(m.received)}</td>
                    <td className="num">{nf(m.openingBalance)}</td>
                    <td className="num">{nf(m.used)}</td>
                    <td className="num">{nf(m.adjusted)}</td>
                    <td className="num"><strong>{nf(m.currentStock)}</strong> <span className="text-muted">{m.unit}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Snapshot stok */}
      {!loading && stock && (
        <section className="card section-card">
          <div className="section-head">
            <h2 className="card-title">Snapshot Stok Saat Ini</h2>
          </div>

          <h3 className="sub-heading">Bahan Baku</h3>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Bahan</th><th>Stok</th></tr></thead>
              <tbody>
                {stock.materials.map((m, i) => (
                  <tr key={i}>
                    <td className="cell-primary">{m.name}</td>
                    <td className="num"><strong>{nf(m.stock)}</strong> <span className="text-muted">{m.unit}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="sub-heading">Produk Jadi</h3>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Produk</th><th>Stok</th><th>Batch</th></tr></thead>
              <tbody>
                {stock.products.map((p, i) => (
                  <tr key={i}>
                    <td className="cell-primary">{p.name}</td>
                    <td className="num"><strong>{nf(p.stock)}</strong></td>
                    <td className="text-muted">{p.batches.map((b) => b.code).join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

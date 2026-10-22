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

type ReportTab = 'penjualan' | 'produksi' | 'bahan-baku' | 'stok-saat-ini'

const REPORT_TABS: Array<{ id: ReportTab; label: string }> = [
  { id: 'penjualan', label: 'Penjualan' },
  { id: 'produksi', label: 'Produksi' },
  { id: 'bahan-baku', label: 'Bahan Baku' },
  { id: 'stok-saat-ini', label: 'Stok Saat Ini' },
]

export function ReportsPage() {
  const [stock, setStock] = useState<StockReport | null>(null)
  const [materials, setMaterials] = useState<MaterialsReport | null>(null)
  const [productions, setProductions] = useState<ProductionsReport | null>(null)
  const [sales, setSales] = useState<SalesReport | null>(null)

  const [loadingSales, setLoadingSales] = useState(true)
  const [loadingProd, setLoadingProd] = useState(true)
  const [loadingMat, setLoadingMat] = useState(true)
  const [loadingStock, setLoadingStock] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<ReportTab>('penjualan')

  // Per-tab filters
  const [salesFrom, setSalesFrom] = useState('')
  const [salesTo, setSalesTo] = useState('')
  const [prodFrom, setProdFrom] = useState('')
  const [prodTo, setProdTo] = useState('')
  const [matFrom, setMatFrom] = useState('')
  const [matTo, setMatTo] = useState('')

  const fetchSales = useCallback(async (f = salesFrom, t = salesTo) => {
    setLoadingSales(true)
    setError(null)
    const params: Record<string, string> = {}
    if (f) params.from = f
    if (t) params.to = t
    try {
      if (f && t && f > t) {
        setError('Tanggal Dari tidak boleh melebihi tanggal Sampai.')
        setLoadingSales(false)
        return
      }
      const res = await api.get('/reports/sales', { params })
      setSales(res.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat laporan penjualan')
    } finally {
      setLoadingSales(false)
    }
  }, [salesFrom, salesTo])

  const fetchProd = useCallback(async (f = prodFrom, t = prodTo) => {
    setLoadingProd(true)
    setError(null)
    const params: Record<string, string> = {}
    if (f) params.from = f
    if (t) params.to = t
    try {
      if (f && t && f > t) {
        setError('Tanggal Dari tidak boleh melebihi tanggal Sampai.')
        setLoadingProd(false)
        return
      }
      const res = await api.get('/reports/productions', { params })
      setProductions(res.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat laporan produksi')
    } finally {
      setLoadingProd(false)
    }
  }, [prodFrom, prodTo])

  const fetchMat = useCallback(async (f = matFrom, t = matTo) => {
    setLoadingMat(true)
    setError(null)
    const params: Record<string, string> = {}
    if (f) params.from = f
    if (t) params.to = t
    try {
      if (f && t && f > t) {
        setError('Tanggal Dari tidak boleh melebihi tanggal Sampai.')
        setLoadingMat(false)
        return
      }
      const res = await api.get('/reports/materials', { params })
      setMaterials(res.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat laporan bahan baku')
    } finally {
      setLoadingMat(false)
    }
  }, [matFrom, matTo])

  const fetchStock = useCallback(async () => {
    setLoadingStock(true)
    setError(null)
    try {
      const res = await api.get('/reports/stock')
      setStock(res.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat laporan stok')
    } finally {
      setLoadingStock(false)
    }
  }, [])

  useEffect(() => {
    fetchSales(salesFrom, salesTo)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchProd(prodFrom, prodTo)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchMat(matFrom, matTo)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchStock()
  }, [fetchStock])

  const applySales = () => {
    if (salesFrom && salesTo && salesFrom > salesTo) {
      setError('Tanggal Dari tidak boleh melebihi tanggal Sampai.')
      return
    }
    setError(null)
    fetchSales(salesFrom, salesTo)
  }

  const resetSales = () => {
    setSalesFrom('')
    setSalesTo('')
    setError(null)
    fetchSales('', '')
  }

  const applyProd = () => {
    if (prodFrom && prodTo && prodFrom > prodTo) {
      setError('Tanggal Dari tidak boleh melebihi tanggal Sampai.')
      return
    }
    setError(null)
    fetchProd(prodFrom, prodTo)
  }

  const resetProd = () => {
    setProdFrom('')
    setProdTo('')
    setError(null)
    fetchProd('', '')
  }

  const applyMat = () => {
    if (matFrom && matTo && matFrom > matTo) {
      setError('Tanggal Dari tidak boleh melebihi tanggal Sampai.')
      return
    }
    setError(null)
    fetchMat(matFrom, matTo)
  }

  const resetMat = () => {
    setMatFrom('')
    setMatTo('')
    setError(null)
    fetchMat('', '')
  }

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Laporan Operasional</h1>
        <p className="page-subtitle">Pantau aktivitas dan ringkasan operasional NutriLokal.</p>
      </div>

      {error && <div className="alert error">{error}</div>}

      {/* Navigasi tab laporan */}
      <div className="reports-tabs" role="tablist" aria-label="Bagian laporan">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`reports-tab ${activeTab === tab.id ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ringkasan Penjualan */}
      {activeTab === 'penjualan' && (
        <section className="card section-card">
          <div className="section-head">
            <h2 className="card-title">Ringkasan Penjualan{(sales?.from || sales?.to) ? ' (periode dipilih)' : ''}</h2>
          </div>

          {/* Filter Periode */}
          <div className="report-filter">
            <div className="report-filter-title">Filter Periode</div>
            <div className="report-filter-row">
              <div className="field report-filter-field">
                <label htmlFor="sales-from">Dari</label>
                <input id="sales-from" type="date" value={salesFrom} onChange={(e) => setSalesFrom(e.target.value)} />
              </div>
              <div className="field report-filter-field">
                <label htmlFor="sales-to">Sampai</label>
                <input id="sales-to" type="date" value={salesTo} onChange={(e) => setSalesTo(e.target.value)} />
              </div>
            </div>
            <div className="report-filter-actions">
              <button type="button" className="button" onClick={applySales} disabled={loadingSales}>
                {loadingSales ? 'Memuat...' : 'Terapkan Filter'}
              </button>
              <button type="button" className="button secondary" onClick={resetSales} disabled={loadingSales}>
                Reset
              </button>
            </div>
          </div>

          {loadingSales && <p className="text-muted">Memuat laporan...</p>}
          {!loadingSales && sales && (
            <>
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
            </>
          )}
        </section>
      )}

      {/* Ringkasan Produksi */}
      {activeTab === 'produksi' && (
        <section className="card section-card">
          <div className="section-head">
            <h2 className="card-title">Ringkasan Produksi</h2>
            {productions && <span className="text-muted">{productions.summary.recordCount} catatan</span>}
          </div>

          <div className="report-filter">
            <div className="report-filter-title">Filter Periode</div>
            <div className="report-filter-row">
              <div className="field report-filter-field">
                <label htmlFor="prod-from">Dari</label>
                <input id="prod-from" type="date" value={prodFrom} onChange={(e) => setProdFrom(e.target.value)} />
              </div>
              <div className="field report-filter-field">
                <label htmlFor="prod-to">Sampai</label>
                <input id="prod-to" type="date" value={prodTo} onChange={(e) => setProdTo(e.target.value)} />
              </div>
            </div>
            <div className="report-filter-actions">
              <button type="button" className="button" onClick={applyProd} disabled={loadingProd}>
                {loadingProd ? 'Memuat...' : 'Terapkan Filter'}
              </button>
              <button type="button" className="button secondary" onClick={resetProd} disabled={loadingProd}>
                Reset
              </button>
            </div>
          </div>

          {loadingProd && <p className="text-muted">Memuat laporan...</p>}
          {!loadingProd && productions && (
            <>
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

              {productions.summary.byProduct.length === 0 && productions.records.length === 0 && (
                <p className="text-muted">Tidak ada data produksi pada periode ini.</p>
              )}
            </>
          )}
        </section>
      )}

      {/* Pergerakan Bahan Baku */}
      {activeTab === 'bahan-baku' && (
        <section className="card section-card">
          <div className="section-head">
            <h2 className="card-title">Pergerakan Bahan Baku</h2>
            {materials && (materials.from || materials.to) && <span className="text-muted">periode dipilih</span>}
          </div>

          <div className="report-filter">
            <div className="report-filter-title">Filter Periode</div>
            <div className="report-filter-row">
              <div className="field report-filter-field">
                <label htmlFor="mat-from">Dari</label>
                <input id="mat-from" type="date" value={matFrom} onChange={(e) => setMatFrom(e.target.value)} />
              </div>
              <div className="field report-filter-field">
                <label htmlFor="mat-to">Sampai</label>
                <input id="mat-to" type="date" value={matTo} onChange={(e) => setMatTo(e.target.value)} />
              </div>
            </div>
            <div className="report-filter-actions">
              <button type="button" className="button" onClick={applyMat} disabled={loadingMat}>
                {loadingMat ? 'Memuat...' : 'Terapkan Filter'}
              </button>
              <button type="button" className="button secondary" onClick={resetMat} disabled={loadingMat}>
                Reset
              </button>
            </div>
          </div>

          {loadingMat && <p className="text-muted">Memuat laporan...</p>}
          {!loadingMat && materials && (
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
          )}
          {!loadingMat && materials && materials.materials.length === 0 && (
            <p className="text-muted">Tidak ada data bahan baku pada periode ini.</p>
          )}
        </section>
      )}

      {/* Snapshot Stok Saat Ini */}
      {activeTab === 'stok-saat-ini' && (
        <section className="card section-card">
          <div className="section-head">
            <h2 className="card-title">Snapshot Stok Saat Ini</h2>
          </div>

          {loadingStock && <p className="text-muted">Memuat laporan...</p>}
          {!loadingStock && stock && (
            <>
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
            </>
          )}
        </section>
      )}
    </div>
  )
}

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Download, X } from 'lucide-react'
import api from '../lib/api'
import { DateField } from '../components/DateField'
import { dateCodeToDisplay, isoToDateDisplay } from '../utils/dates'
import {
  formatReportRange,
  presetRange,
  reportFilePeriod,
  validateReportRange,
  type ReportPreset,
  type ReportRange,
} from '../utils/report-period'

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

function downloadCsv(filename: string, rows: string[][]) {
  const csvContent = '\uFEFF' + rows.map(row => row.map(csvEscape).join(',')).join('\r\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
}

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

const PRESET_OPTIONS: Array<{ id: Exclude<ReportPreset, 'custom'>; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'today', label: 'Hari Ini' },
  { id: 'week', label: 'Minggu Ini' },
  { id: 'month', label: 'Bulan Ini' },
]

interface PeriodModalProps {
  open: boolean
  initialFrom: string
  initialTo: string
  onClose: () => void
  onApply: (from: string, to: string) => void
}

/** Modal periode kustom, terpusat dan memakai sistem modal NutriLokal. */
function PeriodModal({ open, initialFrom, initialTo, onClose, onApply }: PeriodModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFrom(initialFrom)
    setTo(initialTo)
    setError(null)
  }, [open, initialFrom, initialTo])

  useEffect(() => {
    if (!open) return

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const firstInput = panelRef.current?.querySelector<HTMLInputElement>('input')
    firstInput?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus?.()
    }
  }, [open])

  if (!open) return null

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const message = validateReportRange(from, to)
    if (message) {
      setError(message)
      return
    }
    onApply(from, to)
  }

  return createPortal(
    <div className="modal-root">
      <div className="modal-overlay" onClick={onClose} />
      <div
        ref={panelRef}
        className="modal-panel report-period-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="report-period-modal-head">
          <div>
            <h2 className="modal-title" id={titleId}>Pilih Periode Laporan</h2>
            <p className="text-muted report-period-modal-subtitle">
              Pilih tanggal mulai dan tanggal akhir. Rentang berlaku untuk seluruh kategori laporan.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Tutup dialog periode"
            title="Tutup"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={submit} className="report-period-form">
          <div className="form-row">
            <div className="field">
              <label htmlFor="report-period-from">Tanggal Mulai</label>
              <DateField
                id="report-period-from"
                value={from}
                max={to || undefined}
                onChange={(value) => {
                  setFrom(value)
                  setError(null)
                }}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="report-period-to">Tanggal Akhir</label>
              <DateField
                id="report-period-to"
                value={to}
                min={from || undefined}
                onChange={(value) => {
                  setTo(value)
                  setError(null)
                }}
                required
              />
            </div>
          </div>

          {error && <div className="alert error" role="alert">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Batal
            </button>
            <button className="button">Terapkan</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

interface ExportButtonProps {
  table: string
  onClick: () => void
  disabled?: boolean
}

/** Tombol ekspor yang selalu berada tepat di bawah tabel terkait. */
function ExportButton({ table, onClick, disabled }: ExportButtonProps) {
  return (
    <div className="table-export-row">
      <button
        type="button"
        className="button secondary report-export-button"
        onClick={onClick}
        disabled={disabled}
        aria-label={`Export CSV ${table}`}
        title={`Export CSV ${table}`}
      >
        <Download size={16} aria-hidden="true" />
        Export CSV
      </button>
    </div>
  )
}

export function ReportsPage() {
  const [stock, setStock] = useState<StockReport | null>(null)
  const [materials, setMaterials] = useState<MaterialsReport | null>(null)
  const [productions, setProductions] = useState<ProductionsReport | null>(null)
  const [sales, setSales] = useState<SalesReport | null>(null)

  const [loadingSales, setLoadingSales] = useState(true)
  const [loadingProd, setLoadingProd] = useState(true)
  const [loadingMat, setLoadingMat] = useState(true)
  const [loadingStock, setLoadingStock] = useState(true)
  // Gagal memuat laporan tetap tampil inline (keadaan halaman).
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stockError, setStockError] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<ReportTab>('penjualan')

  // Satu periode untuk semua kategori. Default: Bulan Ini.
  const [preset, setPreset] = useState<ReportPreset>('month')
  const [range, setRange] = useState<ReportRange>(() => presetRange('month'))
  const [customOpen, setCustomOpen] = useState(false)

  useEffect(() => {
    let active = true
    // Tanpa `from`/`to` = seluruh data historis (preset Semua).
    const params = range.from && range.to ? { from: range.from, to: range.to } : {}

    setLoadingSales(true)
    setLoadingProd(true)
    setLoadingMat(true)

    Promise.allSettled([
      api.get('/reports/sales', { params }),
      api.get('/reports/productions', { params }),
      api.get('/reports/materials', { params }),
    ])
      .then(([salesResult, prodResult, matResult]) => {
        if (!active) return

        let error: string | null = null

        if (salesResult.status === 'fulfilled') {
          setSales(salesResult.value.data)
        } else {
          error = salesResult.reason?.response?.data?.message || 'Gagal memuat laporan penjualan'
        }

        if (prodResult.status === 'fulfilled') {
          setProductions(prodResult.value.data)
        } else {
          error = error || prodResult.reason?.response?.data?.message || 'Gagal memuat laporan produksi'
        }

        if (matResult.status === 'fulfilled') {
          setMaterials(matResult.value.data)
        } else {
          error = error || matResult.reason?.response?.data?.message || 'Gagal memuat laporan bahan baku'
        }

        setLoadError(error)
      })
      .finally(() => {
        if (!active) return
        setLoadingSales(false)
        setLoadingProd(false)
        setLoadingMat(false)
      })

    return () => {
      active = false
    }
  }, [range.from, range.to])

  useEffect(() => {
    let active = true
    setLoadingStock(true)
    api.get('/reports/stock')
      .then((res) => {
        if (!active) return
        setStock(res.data)
        setStockError(null)
      })
      .catch((err: any) => {
        if (!active) return
        setStockError(err.response?.data?.message || 'Gagal memuat laporan stok')
      })
      .finally(() => {
        if (active) setLoadingStock(false)
      })
    return () => {
      active = false
    }
  }, [])

  const filePeriod = reportFilePeriod(range.from, range.to)

  function applyPreset(next: Exclude<ReportPreset, 'custom'>) {
    setPreset(next)
    setRange(presetRange(next))
  }

  function applyCustom(from: string, to: string) {
    setPreset('custom')
    setRange({ from, to })
    setCustomOpen(false)
  }

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Laporan Operasional</h1>
        <p className="page-subtitle">Pantau aktivitas dan ringkasan operasional NutriLokal.</p>
      </div>

      {loadError && <div className="alert error">{loadError}</div>}
      {stockError && <div className="alert error">{stockError}</div>}

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

      {/* Satu filter periode untuk seluruh kategori laporan. */}
      <div className="report-period-filter-block">
        <div className="report-period-filter" role="group" aria-label="Filter periode laporan">
          {PRESET_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`reports-tab ${preset === option.id ? 'active' : ''}`}
              aria-pressed={preset === option.id}
              onClick={() => applyPreset(option.id)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className={`icon-button report-period-calendar ${preset === 'custom' ? 'active' : ''}`}
            aria-label="Pilih periode kustom"
            title="Pilih periode kustom"
            onClick={() => setCustomOpen(true)}
          >
            <CalendarDays size={18} aria-hidden="true" />
          </button>
        </div>
        {preset === 'custom' && (
          <p className="report-period-range" aria-live="polite">
            Periode kustom: <strong>{formatReportRange(range.from, range.to)}</strong>
          </p>
        )}
      </div>

      {/* Ringkasan Penjualan */}
      {activeTab === 'penjualan' && (
        <section className="card section-card">
          <div className="section-head">
            <h2 className="card-title">Ringkasan Penjualan</h2>
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
                            <td>{dateCodeToDisplay(d.date)}</td>
                            <td className="num">{d.transactionCount}</td>
                            <td className="num">Rp {nf(d.omzet)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ExportButton
                    table="Omzet per Hari"
                    disabled={loadingSales}
                    onClick={() => {
                      const rows: string[][] = [['Tanggal', 'Transaksi', 'Omzet']]
                      sales.byDay.forEach(d => {
                        rows.push([d.date, String(d.transactionCount), String(d.omzet)])
                      })
                      downloadCsv(`laporan-penjualan-omzet-per-hari-${filePeriod}.csv`, rows)
                    }}
                  />
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
                  <ExportButton
                    table="Penjualan per Produk"
                    disabled={loadingSales}
                    onClick={() => {
                      const rows: string[][] = [['Produk', 'Qty', 'Satuan', 'Omzet']]
                      sales.byProduct.forEach(p => {
                        rows.push([p.name, String(p.quantity), p.unit, String(p.value)])
                      })
                      downloadCsv(`laporan-penjualan-per-produk-${filePeriod}.csv`, rows)
                    }}
                  />
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
                  <ExportButton
                    table="Produksi per Produk"
                    disabled={loadingProd}
                    onClick={() => {
                      const rows: string[][] = [['Produk', 'Jumlah Catatan', 'Total Hasil', 'Satuan']]
                      productions.summary.byProduct.forEach(p => {
                        rows.push([p.productName || '', String(p.recordCount), String(p.totalYield), p.unit || ''])
                      })
                      downloadCsv(`laporan-produksi-per-produk-${filePeriod}.csv`, rows)
                    }}
                  />
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
                            <td>{isoToDateDisplay(r.productionDate)}</td>
                            <td className="cell-primary">{r.productName}</td>
                            <td className="num">{nf(r.yieldQuantity)} <span className="text-muted">{r.unit}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {productions.records.length > 20 && (
                    <p className="text-muted report-table-note">
                      Menampilkan 20 dari {productions.records.length} catatan. Export CSV memuat seluruh catatan periode ini.
                    </p>
                  )}
                  <ExportButton
                    table="Catatan Produksi"
                    disabled={loadingProd}
                    onClick={() => {
                      const rows: string[][] = [['Tanggal', 'Produk', 'Jumlah Hasil', 'Satuan']]
                      productions.records.forEach(r => {
                        rows.push([
                          typeof r.productionDate === 'string' && r.productionDate.length >= 10 ? r.productionDate.slice(0, 10) : String(r.productionDate),
                          r.productName,
                          String(r.yieldQuantity),
                          r.unit,
                        ])
                      })
                      downloadCsv(`laporan-produksi-catatan-${filePeriod}.csv`, rows)
                    }}
                  />
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
          </div>

          {loadingMat && <p className="text-muted">Memuat laporan...</p>}
          {!loadingMat && materials && materials.materials.length > 0 && (
            <>
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
              <ExportButton
                table="Pergerakan Bahan Baku"
                disabled={loadingMat}
                onClick={() => {
                  const rows: string[][] = [['Bahan', 'Diterima', 'Saldo Awal', 'Dipakai', 'Disesuaikan', 'Stok Saat Ini', 'Satuan']]
                  materials.materials.forEach(m => {
                    rows.push([
                      m.name,
                      String(m.received),
                      String(m.openingBalance),
                      String(m.used),
                      String(m.adjusted),
                      String(m.currentStock),
                      m.unit,
                    ])
                  })
                  downloadCsv(`laporan-bahan-baku-pergerakan-${filePeriod}.csv`, rows)
                }}
              />
            </>
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
              {stock.materials.length > 0 && (
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
                  <ExportButton
                    table="Stok Bahan Baku"
                    disabled={loadingStock}
                    onClick={() => {
                      const rows: string[][] = [['Bahan', 'Stok', 'Satuan']]
                      stock.materials.forEach(m => {
                        rows.push([m.name, String(m.stock), m.unit])
                      })
                      downloadCsv(`laporan-stok-saat-ini-bahan-baku-${filePeriod}.csv`, rows)
                    }}
                  />
                </>
              )}

              {stock.products.length > 0 && (
                <>
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
                  <ExportButton
                    table="Stok Produk Jadi"
                    disabled={loadingStock}
                    onClick={() => {
                      const rows: string[][] = [['Produk', 'Stok', 'Satuan', 'Batch']]
                      stock.products.forEach(p => {
                        rows.push([p.name, String(p.stock), p.unit, p.batches.map(b => b.code).join(' | ')])
                      })
                      downloadCsv(`laporan-stok-saat-ini-produk-jadi-${filePeriod}.csv`, rows)
                    }}
                  />
                </>
              )}

              {stock.materials.length === 0 && stock.products.length === 0 && (
                <p className="text-muted">Tidak ada data stok saat ini.</p>
              )}
            </>
          )}
        </section>
      )}

      <PeriodModal
        open={customOpen}
        initialFrom={range.from ?? presetRange('month').from ?? ''}
        initialTo={range.to ?? presetRange('month').to ?? ''}
        onClose={() => setCustomOpen(false)}
        onApply={applyCustom}
      />
    </div>
  )
}

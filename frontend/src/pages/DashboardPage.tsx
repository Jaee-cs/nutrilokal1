import { useEffect, useState } from 'react'
import api from '../lib/api'

function rupiah(n: number | string) {
  return `Rp ${Number(n).toLocaleString('id-ID')}`
}

function formatDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface Stat {
  label: string
  value: string
  detail?: string
  tone?: 'primary' | 'success' | 'warning' | 'error'
}

export function DashboardPage() {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [ld, setLd] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await api.get('/dashboard')
        setD(r.data)
      } catch (e: any) {
        setErr(e.response?.data?.message || 'Gagal memuat dashboard')
      } finally {
        setLd(false)
      }
    })()
  }, [])

  if (ld) {
    return (
      <div className="container">
        <p className="text-muted">Memuat dashboard...</p>
      </div>
    )
  }

  if (err) {
    return (
      <div className="container">
        <div className="alert error">{err}</div>
      </div>
    )
  }

  if (!d) return null

  const stats: Stat[] = [
    { label: 'Jenis Bahan Baku', value: String(d.materials.count), detail: 'Bahan terdaftar' },
    { label: 'Produk', value: String(d.products.count), detail: 'Produk olahan' },
    { label: 'Catatan Produksi', value: String(d.production.recordCount), detail: 'Batch tercatat' },
    { label: 'Transaksi Aktif', value: String(d.sales.transactionCount), detail: 'Selesai', tone: 'success' },
    { label: 'Transaksi Dibatalkan', value: String(d.sales.cancelledCount), detail: 'Dibatalkan', tone: 'warning' },
    { label: 'Omzet', value: rupiah(d.sales.omzet), detail: 'Transaksi aktif', tone: 'primary' },
  ]

  const recentSales: any[] = d.sales.recent ?? []
  const batches: any[] = d.products.batchesWithStock ?? []

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Dashboard operasional</h1>
        <p className="page-subtitle">
          Ringkasan produksi, stok, dan penjualan KWT Gogor hari ini.
        </p>
      </div>

      {/* KPI grid */}
      <div className="kpi-grid">
        {stats.map(s => (
          <div key={s.label} className={`card kpi-card ${s.tone ? `kpi-${s.tone}` : ''}`}>
            <div className="card-label">{s.label}</div>
            <div className="card-value">{s.value}</div>
            {s.detail && <div className="kpi-detail">{s.detail}</div>}
          </div>
        ))}
      </div>

      {/* Batch dengan stok */}
      <section className="card section-card">
        <div className="section-head">
          <h2 className="card-title">Batch dengan stok tersedia</h2>
          <span className="text-muted">{batches.length} batch</span>
        </div>
        {batches.length === 0 ? (
          <p className="text-muted">Belum ada batch dengan stok tersisa.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Kode Batch</th>
                  <th>Produk</th>
                  <th>Tgl Produksi</th>
                  <th>Stok</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b, i) => (
                  <tr key={b.code + i}>
                    <td>
                      <span className="badge neutral">{b.code}</span>
                    </td>
                    <td>{b.productName}</td>
                    <td>{formatDate(b.productionDate)}</td>
                    <td>
                      <strong>{Number(b.stock).toLocaleString('id-ID')}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Transaksi terakhir */}
      <section className="card section-card">
        <div className="section-head">
          <h2 className="card-title">Transaksi penjualan terakhir</h2>
          <span className="text-muted">{recentSales.length} transaksi</span>
        </div>
        {recentSales.length === 0 ? (
          <p className="text-muted">Belum ada transaksi penjualan.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Tipe</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map(s => (
                  <tr key={s.id}>
                    <td>{formatDate(s.recordedAt)}</td>
                    <td>
                      {s.type === 'MANUAL' ? 'Manual' : s.type === 'POS' ? 'POS' : 'QRIS'}
                    </td>
                    <td>{rupiah(s.total)}</td>
                    <td>
                      {s.status === 'COMPLETED' ? (
                        <span className="badge success">Aktif</span>
                      ) : (
                        <span className="badge error">Dibatalkan</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

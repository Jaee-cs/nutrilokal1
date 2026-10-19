import { useEffect, useState } from 'react'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'

interface Product {
  id: string
  name: string
  unit: string
  sellingPrice: number
  isActive: boolean
}

interface Batch {
  id: string
  code: string
  productId: string
  stockQuantity: number
  productionDate: string
  expiryDate: string | null
  isActive: boolean
}

interface SaleItem {
  id: string
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  subtotal: number
  allocations?: Array<{ batchId: string; batchCode: string; quantity: number }>
}

interface Sale {
  id: string
  saleNumber: string
  saleDate: string
  total: number
  status: string
  cancelledAt?: string | null
  cancelReason?: string | null
  createdBy?: { username: string }
  items: SaleItem[]
  createdAt: string
}

interface SaleFormItem {
  productId: string
  batchId: string
  quantity: string
}

export function SalesPage() {
  const { user } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [formItems, setFormItems] = useState<SaleFormItem[]>([{ productId: '', batchId: '', quantity: '' }])
  const [submitting, setSubmitting] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  async function fetchData() {
    try {
      setLoading(true)
      const [p, b, s] = await Promise.all([
        api.get('/products'),
        api.get('/batches'),
        api.get('/sales').catch(() => ({ data: { data: [] } }))
      ])
      setProducts((p.data.data || p.data) || [])
      setBatches((b.data.data || b.data) || [])
      setSales((s.data.data || s.data) || [])
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat data penjualan')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  function addFormItem() {
    setFormItems(items => [...items, { productId: '', batchId: '', quantity: '' }])
  }

  function updateFormItem(idx: number, field: keyof SaleFormItem, value: string) {
    setFormItems(items => items.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  function removeFormItem(idx: number) {
    setFormItems(items => items.filter((_, i) => i !== idx))
  }

  function getBatchesForProduct(productId: string) {
    return batches.filter(b => b.productId === productId && b.stockQuantity > 0)
  }

  function getProductPrice(productId: string) {
    return products.find(p => p.id === productId)?.sellingPrice || 0
  }

  function getProductUnit(productId: string) {
    return products.find(p => p.id === productId)?.unit || ''
  }

  function computeTotal() {
    return formItems.reduce((sum, it) => {
      if (!it.productId || !it.batchId || !it.quantity) return sum
      const price = getProductPrice(it.productId)
      const qty = Number(it.quantity)
      return sum + (isNaN(qty) ? 0 : price * qty)
    }, 0)
  }

  async function submitSale(e: React.FormEvent) {
    e.preventDefault()
    for (const it of formItems) {
      if (!it.productId || !it.batchId || !it.quantity) {
        setError('Semua item wajib diisi (produk, batch, jumlah)')
        return
      }
      const qty = Number(it.quantity)
      if (isNaN(qty) || qty <= 0) {
        setError('Jumlah harus lebih dari 0')
        return
      }
    }
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const itemsPayload = formItems.map(it => {
        const qty = Number(it.quantity)
        return {
          productId: it.productId,
          allocations: [{ batchId: it.batchId, quantity: qty }]
        }
      })
      const res = await api.post('/sales', { items: itemsPayload })
      setSuccess(`Penjualan berhasil. No: ${res.data.sale.saleNumber}`)
      setFormItems([{ productId: '', batchId: '', quantity: '' }])
      await fetchData()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mencatat penjualan')
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelSale() {
    if (!cancelTarget || !cancelReason.trim()) return
    setCancelling(true)
    setError(null)
    setSuccess(null)
    try {
      await api.post(`/sales/${cancelTarget.id}/cancel`, { reason: cancelReason.trim() })
      setSuccess('Transaksi berhasil dibatalkan')
      setCancelTarget(null)
      setCancelReason('')
      await fetchData()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal membatalkan transaksi')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Penjualan &amp; Pembatalan</h1>
        <p className="page-subtitle">
          Pencatatan penjualan berdasarkan stok batch aktual — riwayat tidak dapat diubah, hanya dibatalkan.
        </p>
      </div>

      {error && !cancelTarget && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      {/* Form penjualan */}
      <section className="card section-card">
        <h2 className="card-title">Transaksi Penjualan</h2>
        <form onSubmit={submitSale}>
          <div className="sale-items">
            {formItems.map((it, idx) => (
              <div key={idx} className="sale-item-row">
                <div className="sale-item-fields">
                  <div className="field">
                    <label htmlFor={`si-prod-${idx}`}>Produk</label>
                    <select
                      id={`si-prod-${idx}`}
                      value={it.productId}
                      onChange={e => { updateFormItem(idx, 'productId', e.target.value); updateFormItem(idx, 'batchId', ''); }}
                      required
                    >
                      <option value="">Pilih produk</option>
                      {products.filter(p => p.isActive).map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.unit}) - Rp {Number(p.sellingPrice).toLocaleString('id-ID')}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`si-batch-${idx}`}>Batch</label>
                    <select
                      id={`si-batch-${idx}`}
                      value={it.batchId}
                      onChange={e => updateFormItem(idx, 'batchId', e.target.value)}
                      required
                      disabled={!it.productId}
                    >
                      <option value="">Pilih batch (stok tersedia)</option>
                      {getBatchesForProduct(it.productId).map(b => (
                        <option key={b.id} value={b.id}>{b.code} — stok {b.stockQuantity.toLocaleString('id-ID')}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`si-qty-${idx}`}>Jumlah ({it.productId ? getProductUnit(it.productId) : ''})</label>
                    <input
                      id={`si-qty-${idx}`}
                      type="number"
                      step="0.001"
                      min="0"
                      value={it.quantity}
                      onChange={e => updateFormItem(idx, 'quantity', e.target.value)}
                      required
                    />
                  </div>
                  <div className="field sale-item-subtotal">
                    <label>Subtotal</label>
                    <div className="subtotal-value">
                      Rp {(it.productId && it.quantity ? getProductPrice(it.productId) * Number(it.quantity) : 0).toLocaleString('id-ID')}
                    </div>
                  </div>
                </div>
                {formItems.length > 1 && (
                  <button type="button" className="icon-btn danger" onClick={() => removeFormItem(idx)} title="Hapus item">
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="sale-footer">
            <button type="button" className="button secondary" onClick={addFormItem}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
              Tambah Item
            </button>
            <div className="sale-total">
              <span className="card-label">Total</span>
              <span className="sale-total-value">Rp {computeTotal().toLocaleString('id-ID')}</span>
            </div>
            <button className="button" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan Penjualan'}
            </button>
          </div>
        </form>
      </section>

      {/* Riwayat */}
      <section className="card section-card">
        <div className="section-head">
          <h2 className="card-title">Riwayat Penjualan</h2>
          <span className="text-muted">{sales.length} transaksi</span>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>No. Transaksi</th>
                <th>Tanggal</th>
                <th>Total</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5}>Memuat...</td></tr>
              ) : sales.length === 0 ? (
                <tr><td colSpan={5} className="text-muted">Belum ada transaksi</td></tr>
              ) : (
                sales.slice(0, 20).map(s => (
                  <tr key={s.id}>
                    <td className="cell-primary">{s.saleNumber}</td>
                    <td>{s.saleDate}</td>
                    <td className="num"><strong>Rp {Number(s.total).toLocaleString('id-ID')}</strong></td>
                    <td>
                      {s.status === 'CANCELLED' ? (
                        <span className="badge error">Dibatalkan</span>
                      ) : (
                        <span className="badge success">Selesai</span>
                      )}
                    </td>
                    <td>
                      {user?.role === 'ADMIN' && s.status !== 'CANCELLED' && (
                        <button className="button secondary" onClick={() => setCancelTarget(s)}>Batalkan</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal pembatalan */}
      {cancelTarget && (
        <div className="modal-root">
          <div className="modal-overlay" onClick={() => setCancelTarget(null)} />
          <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Batalkan transaksi">
            <h3 className="modal-title">Batalkan Transaksi {cancelTarget.saleNumber}</h3>
            <p className="text-muted" style={{ marginBottom: '1rem' }}>
              Transaksi tidak dihapus — statusnya diubah menjadi dibatalkan dan stok batch dikembalikan.
            </p>
            {error && <div className="alert error">{error}</div>}
            <div className="field">
              <label htmlFor="cancel-reason">Alasan pembatalan (wajib)</label>
              <input
                id="cancel-reason"
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                placeholder="Masukkan alasan"
              />
            </div>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => { setCancelTarget(null); setCancelReason('') }}>
                Kembali
              </button>
              <button
                className="button danger"
                disabled={cancelling || !cancelReason.trim()}
                onClick={cancelSale}
              >
                {cancelling ? 'Membatalkan...' : 'Konfirmasi Pembatalan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

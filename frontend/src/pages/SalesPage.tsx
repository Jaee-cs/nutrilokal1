import { useEffect, useState } from 'react'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'
// Kode tanggal dan penanda kedaluwarsa memakai aturan bersama di
// utils/batch-expiry.ts (kalender WIB, sama dengan backend lib/date.ts).
import { wibDateCode, isBatchExpired } from '../utils/batch-expiry'

interface Product {
  id: string
  name: string
  unit: string
  sellingPrice: number
  isActive: boolean
}

// Bentuk API GET /batches (toPublicBatch): product.id dan stock — bukan
// productId/stockQuantity. expiryValidated menandai tanggal kedaluwarsa
// sudah divalidasi Admin (README 5.5).
interface Batch {
  id: string
  code: string
  product: { id: string; name: string; unit: string }
  productionDate: string | null
  stock: number
  expiryDate: string | null
  expiryValidated: boolean
}

// Bentuk respons API penjualan (toPublicSale).
interface SaleAllocation {
  batchId: string
  batchCode: string
  quantity: number
}

interface SaleItem {
  productId: string
  product: { id: string; name: string; unit: string }
  quantity: number
  unitPrice: number
  lineTotal: number
  allocations: SaleAllocation[]
}

interface Sale {
  id: string
  status: 'COMPLETED' | 'CANCELLED'
  total: number
  items: SaleItem[]
  recordedBy: { username: string; name?: string | null }
  recordedAt: string
  cancelReason: string | null
  cancelledAt: string | null
}

interface AllocationForm {
  batchId: string
  quantity: string
}

interface SaleFormItem {
  productId: string
  allocations: AllocationForm[]
}

const EMPTY_FORM: SaleFormItem[] = [
  { productId: '', allocations: [{ batchId: '', quantity: '' }] },
]

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function SalesPage() {
  const { user } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [formItems, setFormItems] = useState<SaleFormItem[]>(EMPTY_FORM)
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
    setFormItems(items => [...items, { productId: '', allocations: [{ batchId: '', quantity: '' }] }])
  }

  function removeFormItem(idx: number) {
    setFormItems(items => items.filter((_, i) => i !== idx))
  }

  // Mengganti produk mereset alokasi batch (batch harus milik produk).
  function setProduct(idx: number, productId: string) {
    setFormItems(items => items.map((it, i) =>
      i === idx ? { productId, allocations: [{ batchId: '', quantity: '' }] } : it
    ))
  }

  function addAllocation(idx: number) {
    setFormItems(items => items.map((it, i) =>
      i === idx ? { ...it, allocations: [...it.allocations, { batchId: '', quantity: '' }] } : it
    ))
  }

  function updateAllocation(itemIdx: number, allocIdx: number, field: keyof AllocationForm, value: string) {
    setFormItems(items => items.map((it, i) =>
      i === itemIdx
        ? {
            ...it,
            allocations: it.allocations.map((a, j) => j === allocIdx ? { ...a, [field]: value } : a),
          }
        : it
    ))
  }

  function removeAllocation(itemIdx: number, allocIdx: number) {
    setFormItems(items => items.map((it, i) => {
      if (i !== itemIdx || it.allocations.length <= 1) return it
      return { ...it, allocations: it.allocations.filter((_, j) => j !== allocIdx) }
    }))
  }

  // Batch dengan stok tersedia untuk produk; batch yang sudah dipilih pada
  // alokasi lain dalam item yang sama disembunyikan (satu batch maksimal
  // satu alokasi per item — aturan backend). Batch kedaluwarsa tetap
  // ditampilkan (stok & tanggal terlihat) tetapi tidak dapat dipilih.
  function getBatchesForProduct(productId: string, excludeIds: string[]) {
    return batches.filter(b =>
      b.product.id === productId && b.stock > 0 && !excludeIds.includes(b.id)
    )
  }

  function getProductPrice(productId: string) {
    return products.find(p => p.id === productId)?.sellingPrice || 0
  }

  function getProductUnit(productId: string) {
    return products.find(p => p.id === productId)?.unit || ''
  }

  function itemSubtotal(it: SaleFormItem) {
    if (!it.productId) return 0
    const price = getProductPrice(it.productId)
    return it.allocations.reduce((sum, alloc) => {
      if (!alloc.batchId || !alloc.quantity) return sum
      const qty = Number(alloc.quantity)
      return sum + (isNaN(qty) ? 0 : price * qty)
    }, 0)
  }

  function computeTotal() {
    return formItems.reduce((sum, it) => sum + itemSubtotal(it), 0)
  }

  function batchOptionLabel(b: Batch) {
    const parts = [b.code, `stok ${b.stock.toLocaleString('id-ID')}`]
    if (b.expiryDate) {
      parts.push(isBatchExpired(b) ? `kedaluwarsa ${wibDateCode(b.expiryDate)} (tidak dapat dijual)` : `kedaluwarsa ${wibDateCode(b.expiryDate)}`)
    }
    return parts.join(' — ')
  }

  async function submitSale(e: React.FormEvent) {
    e.preventDefault()
    const seenProducts = new Set<string>()
    for (const it of formItems) {
      if (!it.productId) {
        setError('Setiap item harus memilih produk.')
        return
      }
      if (seenProducts.has(it.productId)) {
        setError('Produk yang sama tidak boleh muncul dua kali dalam satu transaksi.')
        return
      }
      seenProducts.add(it.productId)
      const seenBatches = new Set<string>()
      for (const alloc of it.allocations) {
        if (!alloc.batchId || !alloc.quantity) {
          setError('Setiap alokasi wajib memilih batch dan mengisi jumlah.')
          return
        }
        if (seenBatches.has(alloc.batchId)) {
          setError('Batch yang sama tidak boleh dialokasikan dua kali pada satu item.')
          return
        }
        seenBatches.add(alloc.batchId)
        const qty = Number(alloc.quantity)
        if (isNaN(qty) || qty <= 0) {
          setError('Jumlah harus lebih dari 0')
          return
        }
      }
    }
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const itemsPayload = formItems.map(it => ({
        productId: it.productId,
        allocations: it.allocations.map(alloc => ({
          batchId: alloc.batchId,
          quantity: Number(alloc.quantity),
        })),
      }))
      const res = await api.post('/sales', { items: itemsPayload })
      const transaction = res.data?.transaction
      setSuccess(transaction
        ? `Penjualan berhasil. ID: ${transaction.id}`
        : 'Penjualan berhasil.')
      setFormItems(EMPTY_FORM)
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
                <div className="sale-item-main">
                  <div className="sale-item-fields">
                    <div className="field">
                      <label htmlFor={`si-prod-${idx}`}>Produk</label>
                      <select
                        id={`si-prod-${idx}`}
                        value={it.productId}
                        onChange={e => setProduct(idx, e.target.value)}
                        required
                      >
                        <option value="">Pilih produk</option>
                        {products.filter(p => p.isActive).map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.unit}) - Rp {Number(p.sellingPrice).toLocaleString('id-ID')}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field sale-item-subtotal">
                      <label>Subtotal</label>
                      <div className="subtotal-value">
                        Rp {itemSubtotal(it).toLocaleString('id-ID')}
                      </div>
                    </div>
                  </div>

                  <div className="sale-item-allocs">
                    <span className="card-label">Batch &amp; Jumlah</span>
                    {it.allocations.map((alloc, aIdx) => {
                      const otherIds = it.allocations.filter((_, j) => j !== aIdx).map(a => a.batchId)
                      return (
                        <div className="sale-alloc-row" key={aIdx}>
                          <div className="field">
                            <label htmlFor={`si-batch-${idx}-${aIdx}`}>Batch</label>
                            <select
                              id={`si-batch-${idx}-${aIdx}`}
                              value={alloc.batchId}
                              onChange={e => updateAllocation(idx, aIdx, 'batchId', e.target.value)}
                              required
                              disabled={!it.productId}
                            >
                              <option value="">Pilih batch (stok tersedia)</option>
                              {getBatchesForProduct(it.productId, otherIds).map(b => (
                                <option key={b.id} value={b.id} disabled={isBatchExpired(b)}>
                                  {batchOptionLabel(b)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label htmlFor={`si-qty-${idx}-${aIdx}`}>Jumlah ({it.productId ? getProductUnit(it.productId) : ''})</label>
                            <input
                              id={`si-qty-${idx}-${aIdx}`}
                              type="number"
                              step="0.001"
                              min="0"
                              value={alloc.quantity}
                              onChange={e => updateAllocation(idx, aIdx, 'quantity', e.target.value)}
                              required
                            />
                          </div>
                          {it.allocations.length > 1 && (
                            <button
                              type="button"
                              className="icon-btn danger"
                              onClick={() => removeAllocation(idx, aIdx)}
                              title="Hapus alokasi batch"
                            >
                              <span className="material-symbols-outlined">delete</span>
                            </button>
                          )}
                        </div>
                      )
                    })}
                    <button
                      type="button"
                      className="button secondary sale-alloc-add"
                      onClick={() => addAllocation(idx)}
                      disabled={!it.productId}
                      title={it.productId ? undefined : 'Pilih produk terlebih dahulu'}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
                      Tambah Batch
                    </button>
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
                <th>ID Transaksi</th>
                <th>Tanggal</th>
                <th>Item</th>
                <th>Total</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6}>Memuat...</td></tr>
              ) : sales.length === 0 ? (
                <tr><td colSpan={6} className="text-muted">Belum ada transaksi</td></tr>
              ) : (
                sales.slice(0, 20).map(s => (
                  <tr key={s.id}>
                    <td className="cell-primary">{s.id}</td>
                    <td>
                      {formatDateTime(s.recordedAt)}
                      <div className="cell-secondary">oleh {s.recordedBy.username}</div>
                    </td>
                    <td>
                      {s.items.map((item, i) => (
                        <div key={i}>
                          <div className="cell-primary">
                            {item.product.name} × {item.quantity.toLocaleString('id-ID')} {item.product.unit}
                          </div>
                          <div className="cell-secondary">
                            Batch: {item.allocations.map(a => `${a.batchCode} (${a.quantity.toLocaleString('id-ID')})`).join(', ')}
                          </div>
                        </div>
                      ))}
                    </td>
                    <td className="num"><strong>Rp {Number(s.total).toLocaleString('id-ID')}</strong></td>
                    <td>
                      {s.status === 'CANCELLED' ? (
                        <>
                          <span className="badge error">Dibatalkan</span>
                          {s.cancelReason && <div className="cell-secondary">Alasan: {s.cancelReason}</div>}
                        </>
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
            <h3 className="modal-title">Batalkan Transaksi {cancelTarget.id}</h3>
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

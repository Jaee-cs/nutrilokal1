import { useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useFormPersistence } from '../hooks/useFormPersistence'
import { useNotify } from '../components/NotificationProvider'
import { readFormState } from '../lib/form-state'
// Kode tanggal dan penanda kedaluwarsa memakai aturan bersama di
// utils/batch-expiry.ts (kalender WIB, sama dengan backend lib/date.ts).
import { wibDateCode, isBatchExpired } from '../utils/batch-expiry'
import { dateCodeToDisplay, isoToDateTimeDisplay } from '../utils/dates'

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

function emptySalesForm(): SaleFormItem[] {
  return [{ productId: '', allocations: [{ batchId: '', quantity: '' }] }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validasi struktur keranjang yang dibaca dari localStorage. */
function parseSalesSnapshot(raw: unknown): SaleFormItem[] | null {
  if (!Array.isArray(raw)) return null
  const asString = (value: unknown): string | null =>
    typeof value === 'string' ? value : null
  const items: SaleFormItem[] = []

  for (const item of raw) {
    if (!isRecord(item) || !Array.isArray(item.allocations)) return null
    const productId = asString(item.productId)
    if (productId === null) return null
    const allocations: AllocationForm[] = []
    for (const allocation of item.allocations) {
      if (!isRecord(allocation)) return null
      const batchId = asString(allocation.batchId)
      const quantity = asString(allocation.quantity)
      if (batchId === null || quantity === null) return null
      allocations.push({ batchId, quantity })
    }
    if (allocations.length === 0) allocations.push({ batchId: '', quantity: '' })
    items.push({ productId, allocations })
  }

  if (items.length === 0) return null
  return items
}

/**
 * Validasi ulang produk, batch, stok, dan duplikasi terhadap data terbaru.
 * Referensi yang tidak valid dibersihkan satu per satu; jumlah yang sudah
 * diketik tetap dipertahankan.
 */
function validateSalesSnapshot(
  snapshot: SaleFormItem[],
  products: Product[],
  batches: Batch[]
): { snapshot: SaleFormItem[]; warnings: string[] } {
  const warnings: string[] = []
  const activeProductIds = new Set(products.filter((p) => p.isActive).map((p) => p.id))
  const seenProducts = new Set<string>()

  const items = snapshot.map((item) => {
    let productId = item.productId
    let productInvalid = false
    if (productId && !activeProductIds.has(productId)) {
      warnings.push('Produk pada isian tersimpan sudah tidak tersedia/nonaktif. Pilih produk lain; jumlah yang sudah diisi tetap dipertahankan.')
      productId = ''
      productInvalid = true
    } else if (productId && seenProducts.has(productId)) {
      warnings.push('Produk yang sama muncul lebih dari sekali. Pilih produk lain pada item tersebut.')
      productId = ''
      productInvalid = true
    }
    if (productId) seenProducts.add(productId)

    const seenBatches = new Set<string>()
    const allocations = item.allocations.map((allocation) => {
      let batchId = allocation.batchId
      if (!productId || productInvalid) {
        if (batchId) {
          warnings.push('Batch pada isian tersimpan ikut dibersihkan karena produk tidak valid. Pilih produk dan batch baru; jumlah tetap dipertahankan.')
        }
        batchId = ''
      } else if (batchId) {
        const batch = batches.find((b) => b.id === batchId)
        if (!batch) {
          warnings.push('Batch pada isian tersimpan sudah tidak tersedia. Pilih batch lain; jumlah tetap dipertahankan.')
          batchId = ''
        } else if (batch.product.id !== productId) {
          warnings.push('Batch pada isian tersimpan tidak sesuai dengan produk yang dipilih. Pilih batch lain.')
          batchId = ''
        } else if (batch.stock <= 0) {
          warnings.push(`Batch ${batch.code} sudah tidak memiliki stok. Jumlah tetap dipertahankan, pilih batch lain.`)
          batchId = ''
        } else if (isBatchExpired(batch)) {
          warnings.push(`Batch ${batch.code} sudah kedaluwarsa. Jumlah tetap dipertahankan, pilih batch lain.`)
          batchId = ''
        } else if (seenBatches.has(batchId)) {
          warnings.push('Batch yang sama muncul lebih dari sekali pada satu item. Pilih batch lain.')
          batchId = ''
        } else {
          seenBatches.add(batchId)
          const qty = Number(allocation.quantity)
          if (Number.isFinite(qty) && qty > batch.stock) {
            warnings.push(`Stok batch ${batch.code} tersedia ${batch.stock}; jumlah pada form perlu disesuaikan.`)
          }
        }
      }

      const qty = Number(allocation.quantity)
      if (allocation.quantity && (!Number.isFinite(qty) || qty <= 0)) {
        warnings.push('Jumlah pada isian tersimpan harus lebih dari 0.')
      }
      return { batchId, quantity: allocation.quantity }
    })

    return { productId, allocations }
  })

  return { snapshot: items, warnings }
}

function formatDateTime(iso: string): string {
  const label = isoToDateTimeDisplay(iso)
  return label ? `${label} WIB` : iso
}

export function SalesPage() {
  const { user } = useAuth()
  const notify = useNotify()
  const [products, setProducts] = useState<Product[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [dataReady, setDataReady] = useState(false)
  // Gagal memuat data halaman tetap inline; hasil tindakan memakai dialog.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [restoreWarnings, setRestoreWarnings] = useState<string[]>([])

  const restoredRef = useRef<SaleFormItem[] | null | undefined>(undefined)
  if (restoredRef.current === undefined) {
    restoredRef.current = readFormState(user?.id, 'sales', parseSalesSnapshot)
  }
  const validatedRef = useRef(false)
  const initialSnapshot = restoredRef.current ?? null

  const [formItems, setFormItems] = useState<SaleFormItem[]>(() => initialSnapshot ?? emptySalesForm())
  const [submitting, setSubmitting] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const salesDirty = formItems.some((item) =>
    Boolean(item.productId || item.allocations.some((a) => a.batchId || a.quantity))
  )
  const { clearPersisted } = useFormPersistence({
    userId: user?.id,
    formKey: 'sales',
    state: formItems,
    dirty: salesDirty,
    enabled: dataReady,
  })

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
      setLoadError(null)
      setDataReady(true)
    } catch (err: any) {
      setLoadError(err.response?.data?.message || 'Gagal memuat data penjualan')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  // Validasi ulang hanya sekali, setelah data master terbaru tersedia.
  useEffect(() => {
    if (!dataReady || validatedRef.current) return
    validatedRef.current = true
    const restored = restoredRef.current
    if (!restored) return
    const checked = validateSalesSnapshot(restored, products, batches)
    setFormItems(checked.snapshot)
    setRestoreWarnings(checked.warnings)
  }, [dataReady, products, batches])

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

  async function resetSalesForm() {
    if (!salesDirty) return
    const confirmed = await notify.confirm({
      title: 'Kosongkan Isian Penjualan',
      message: 'Seluruh item dan alokasi batch pada form penjualan akan dihapus. Lanjutkan?',
      confirmLabel: 'Ya, Kosongkan',
      tone: 'warning',
    })
    if (!confirmed) return
    clearPersisted()
    setFormItems(emptySalesForm())
    setRestoreWarnings([])
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
      const expiryLabel = dateCodeToDisplay(wibDateCode(b.expiryDate))
      parts.push(isBatchExpired(b) ? `kedaluwarsa ${expiryLabel} (tidak dapat dijual)` : `kedaluwarsa ${expiryLabel}`)
    }
    return parts.join(' — ')
  }

  async function submitSale(e: React.FormEvent) {
    e.preventDefault()
    const seenProducts = new Set<string>()
    for (const it of formItems) {
      if (!it.productId) {
        notify.error('Setiap item harus memilih produk.')
        return
      }
      if (seenProducts.has(it.productId)) {
        notify.error('Produk yang sama tidak boleh muncul dua kali dalam satu transaksi.')
        return
      }
      seenProducts.add(it.productId)
      const seenBatches = new Set<string>()
      for (const alloc of it.allocations) {
        if (!alloc.batchId || !alloc.quantity) {
          notify.error('Setiap alokasi wajib memilih batch dan mengisi jumlah.')
          return
        }
        if (seenBatches.has(alloc.batchId)) {
          notify.error('Batch yang sama tidak boleh dialokasikan dua kali pada satu item.')
          return
        }
        seenBatches.add(alloc.batchId)
        const qty = Number(alloc.quantity)
        if (isNaN(qty) || qty <= 0) {
          notify.error('Jumlah harus lebih dari 0')
          return
        }
      }
    }
    setSubmitting(true)
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
      clearPersisted()
      setFormItems(emptySalesForm())
      setRestoreWarnings([])
      await fetchData()
      notify.success(transaction
        ? `Penjualan berhasil. ID: ${transaction.id}`
        : 'Penjualan berhasil.')
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mencatat penjualan')
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelSale() {
    if (!cancelTarget) return
    if (!cancelReason.trim()) {
      notify.error('Alasan pembatalan wajib diisi.')
      return
    }
    setCancelling(true)
    try {
      await api.post(`/sales/${cancelTarget.id}/cancel`, { reason: cancelReason.trim() })
      setCancelTarget(null)
      setCancelReason('')
      await fetchData()
      notify.success('Transaksi berhasil dibatalkan')
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal membatalkan transaksi')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Penjualan &amp; Pembatalan</h1>
        <p className="page-subtitle">
          Catat transaksi penjualan dan kelola pembatalan transaksi.
        </p>
      </div>

      {loadError && !cancelTarget && <div className="alert error">{loadError}</div>}

      {restoreWarnings.length > 0 && (
        <div className="alert warning">
          <strong>Isian tersimpan sudah diperiksa ulang.</strong>
          <ul style={{ margin: '0.35rem 0 0', paddingLeft: 18 }}>
            {restoreWarnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Form penjualan */}
      <section className="card section-card">
        <h2 className="card-title">Transaksi Penjualan</h2>
        <form onSubmit={submitSale}>
          <div className="sale-items">
            {formItems.map((it, idx) => (
              <div key={idx} className="sale-item-row">
                <div className="sale-item-main">
                  {/* Produk: dropdown selebar penuh item. */}
                  <div className="field sale-item-product">
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
                              <option value="">Pilih batch</option>
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

                  {/* Subtotal: di bawah seluruh alokasi batch item ini. */}
                  <div className="sale-item-subtotal">
                    <span className="sale-item-subtotal-label">Subtotal</span>
                    <span className="subtotal-value">
                      Rp {itemSubtotal(it).toLocaleString('id-ID')}
                    </span>
                  </div>
                </div>
                {formItems.length > 1 && (
                  <button
                    type="button"
                    className="icon-btn danger sale-item-remove"
                    onClick={() => removeFormItem(idx)}
                    title="Hapus item"
                    aria-label="Hapus item"
                  >
                    <span className="material-symbols-outlined">close</span>
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
            <button type="button" className="button secondary" onClick={resetSalesForm}>
              Kosongkan Form
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
        <div className="desktop-table">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>ID Transaksi</th>
                  <th>Waktu Pencatatan</th>
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
        </div>

        {/* Mobile: daftar kartu transaksi */}
        <div className="mobile-list">
          {loading ? (
            <p className="text-muted">Memuat...</p>
          ) : sales.length === 0 ? (
            <p className="text-muted">Belum ada transaksi</p>
          ) : (
            sales.slice(0, 20).map(s => (
              <article className="sale-history-item" key={s.id}>
                <div className="sale-history-head">
                  <div className="sale-history-id">{s.id}</div>
                  <div className="sale-history-status">
                    {s.status === 'CANCELLED' ? (
                      <span className="badge error">Dibatalkan</span>
                    ) : (
                      <span className="badge success">Selesai</span>
                    )}
                  </div>
                </div>
                <div className="sale-history-meta">
                  <span>{formatDateTime(s.recordedAt)}</span>
                  <span>oleh {s.recordedBy.username}</span>
                </div>
                <div className="sale-history-items">
                  {s.items.map((item, i) => (
                    <div className="sale-history-line" key={i}>
                      <div className="sale-history-product">
                        {item.product.name} × {item.quantity.toLocaleString('id-ID')} {item.product.unit}
                      </div>
                      <div className="sale-history-batches">
                        Batch: {item.allocations.map(a => `${a.batchCode} (${a.quantity.toLocaleString('id-ID')})`).join(', ')}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="sale-history-foot">
                  <div className="sale-history-total">
                    <span className="sale-history-total-label">Total</span>
                    <span className="sale-history-total-value">Rp {Number(s.total).toLocaleString('id-ID')}</span>
                  </div>
                  {s.status === 'CANCELLED' && s.cancelReason && (
                    <div className="sale-history-reason">Alasan: {s.cancelReason}</div>
                  )}
                  {user?.role === 'ADMIN' && s.status !== 'CANCELLED' && (
                    <button className="button secondary sale-history-cancel" onClick={() => setCancelTarget(s)}>
                      Batalkan Transaksi
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
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

import { useEffect, useState } from 'react'
import api from '../lib/api'
import { Drawer } from '../components/Drawer'
import { PhotoField } from '../components/PhotoField'
import { useAuth } from '../hooks/useAuth'
import { useNotify } from '../components/NotificationProvider'
import { productPhotoUrl, uploadProductPhoto } from '../utils/product-photo'

interface Product {
  id: string
  name: string
  unit: string
  sellingPrice: number
  description?: string | null
  composition?: string | null
  storageInstructions?: string | null
  photoUrl?: string | null
  stock?: number
  batchCount?: number
  isActive: boolean
}

const EMPTY_FORM = {
  name: '',
  unit: '',
  sellingPrice: '',
  description: '',
  composition: '',
  storageInstructions: '',
}

export function ProductsPage() {
  const { user } = useAuth()
  const notify = useNotify()
  const isAdmin = user?.role === 'ADMIN'

  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  // Kegagalan memuat daftar produk tetap tampil di halaman. Pesan hasil
  // tindakan (simpan, ubah status, hapus, unggah foto) memakai dialog.
  const [loadError, setLoadError] = useState<string | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  // Foto pada form: `undefined` = tidak diubah, `File` = unggah/ganti,
  // `null` = hapus foto yang tersimpan.
  const [photoFile, setPhotoFile] = useState<File | null | undefined>(undefined)
  const [photoNotice, setPhotoNotice] = useState<string | null>(null)

  // Mode edit (hanya Admin): id produk yang sedang diubah + datanya.
  const [editTarget, setEditTarget] = useState<Product | null>(null)

  // Proses hapus berjalan setelah pengguna menyetujui dialog konfirmasi.
  const [deleting, setDeleting] = useState(false)

  async function fetchProducts(): Promise<boolean> {
    try {
      const res = await api.get('/products')
      setProducts(res.data.data || res.data)
      setLoadError(null)
      return true
    } catch (err: any) {
      setLoadError(err.response?.data?.message || 'Gagal memuat produk')
      return false
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProducts()
  }, [])

  function openDrawer() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setPhotoFile(undefined)
    setPhotoNotice(null)
    setDrawerOpen(true)
  }

  function openEdit(product: Product) {
    setEditTarget(product)
    setForm({
      name: product.name,
      unit: product.unit,
      sellingPrice: String(product.sellingPrice),
      description: product.description ?? '',
      composition: product.composition ?? '',
      storageInstructions: product.storageInstructions ?? '',
    })
    setPhotoFile(undefined)
    setPhotoNotice(null)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setEditTarget(null)
    setPhotoFile(undefined)
    setPhotoNotice(null)
  }

  /**
   * Menyelaraskan foto dengan pilihan pengguna: hapus foto lama, unggah foto
   * baru, atau tidak mengubah apa pun. Mengembalikan pesan kegagalan (atau
   * null) — kegagalan unggah tidak menggagalkan data produk yang sudah
   * tersimpan, tetapi selalu dilaporkan.
   */
  async function syncPhoto(productId: string): Promise<string | null> {
    try {
      if (photoFile === null) {
        await api.delete(`/products/${productId}/photo`)
      } else if (photoFile) {
        await uploadProductPhoto(productId, photoFile)
      }
      return null
    } catch (err: any) {
      return err.response?.data?.message || 'Foto gagal disimpan'
    }
  }

  async function createProduct(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    let created: Product | null = null
    try {
      const res = await api.post('/products', {
        name: form.name,
        unit: form.unit,
        sellingPrice: Number(form.sellingPrice),
        description: form.description || undefined,
        composition: form.composition || undefined,
        storageInstructions: form.storageInstructions || undefined,
      })
      created = res.data.product as Product
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal menambah produk')
      setSubmitting(false)
      return
    }

    const photoError = created ? await syncPhoto(created.id) : null
    closeDrawer()
    const refreshed = await fetchProducts()
    if (refreshed) {
      if (photoError) {
        notify.warning(`Produk berhasil ditambahkan, tetapi foto gagal disimpan: ${photoError}`)
      } else if (photoFile) {
        notify.success('Produk berhasil ditambahkan beserta fotonya.')
      } else {
        notify.success('Produk berhasil ditambahkan')
      }
    }
    setSubmitting(false)
  }

  async function updateProduct(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return

    setSubmitting(true)
    try {
      await api.patch(`/products/${editTarget.id}`, {
        name: form.name,
        unit: form.unit,
        sellingPrice: Number(form.sellingPrice),
        description: form.description,
        composition: form.composition,
        storageInstructions: form.storageInstructions,
      })
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal menyimpan perubahan produk')
      setSubmitting(false)
      return
    }

    const photoError = await syncPhoto(editTarget.id)
    closeDrawer()
    const refreshed = await fetchProducts()
    if (refreshed) {
      if (photoError) {
        notify.warning(`Perubahan produk tersimpan, tetapi foto gagal disimpan: ${photoError}`)
      } else {
        notify.success('Perubahan produk berhasil disimpan')
      }
    }
    setSubmitting(false)
  }

  async function toggleActive(id: string, current: boolean) {
    try {
      await api.patch(`/products/${id}`, { isActive: !current })
      const refreshed = await fetchProducts()
      if (refreshed) {
        notify.success(current ? 'Produk dinonaktifkan' : 'Produk diaktifkan kembali')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mengubah status')
    }
  }

  /**
   * Konfirmasi hapus memakai dialog terpusat. Rincian stok dan batch tetap
   * ditampilkan agar Admin memahami dampak tindakan sebelum menyetujuinya.
   */
  async function requestDelete(product: Product) {
    const photo = productPhotoUrl(product.photoUrl)
    const confirmed = await notify.confirm({
      title: 'Hapus Produk',
      message: `Produk "${product.name}" akan dihapus dari daftar produk.`,
      tone: 'danger',
      confirmLabel: 'Ya, Hapus',
      cancelLabel: 'Batal',
      details: (
        <>
          {photo && (
            <img
              src={photo}
              alt={`Foto ${product.name}`}
              style={{ width: '100%', maxHeight: 120, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }}
            />
          )}
          <p>
            Stok saat ini: {Number(product.stock ?? 0).toLocaleString('id-ID')} {product.unit} · Batch:{' '}
            {Number(product.batchCount ?? 0).toLocaleString('id-ID')}
          </p>
          <p className="text-muted">
            Produk tanpa riwayat operasional dihapus permanen. Produk yang sudah memiliki riwayat
            akan diarsipkan, dan produk yang stoknya masih tersedia akan ditolak oleh sistem.
          </p>
        </>
      ),
    })
    if (!confirmed) return

    setDeleting(true)
    try {
      // Backend yang menentukan hasil: hapus permanen (tanpa riwayat),
      // arsipkan (punya riwayat), atau tolak (stok masih ada).
      const res = await api.delete(`/products/${product.id}`)
      const refreshed = await fetchProducts()
      if (refreshed) {
        notify.success(res.data?.message || 'Produk berhasil dihapus')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal menghapus produk')
    } finally {
      setDeleting(false)
    }
  }

  const activeCount = products.filter(p => p.isActive).length
  const inactiveCount = products.length - activeCount

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Kelola Produk KWT</h1>
        <p className="page-subtitle">
          Data produk olahan, satuan dasar, dan harga jual mengikuti backend.
        </p>
      </div>

      {loadError && !drawerOpen && <div className="alert error">{loadError}</div>}

      {/* Ringkasan singkat */}
      <div className="summary-row">
        <div className="summary-item">
          <span className="card-label">Total Produk</span>
          <span className="summary-value">{products.length}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Aktif Diproduksi</span>
          <span className="summary-value">{activeCount}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Diarsipkan</span>
          <span className="summary-value">{inactiveCount}</span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <h2 className="card-title">Daftar Produk</h2>
        <button className="button" onClick={openDrawer}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          Tambah Produk
        </button>
      </div>

      {/* Grid kartu produk */}
      {loading ? (
        <p className="text-muted">Memuat produk...</p>
      ) : products.length === 0 ? (
        <div className="card">
          <p className="text-muted">Belum ada produk. Klik “Tambah Produk” untuk menambah.</p>
        </div>
      ) : (
        <div className="product-grid">
          {products.map(p => {
            const photo = productPhotoUrl(p.photoUrl)
            return (
              <div key={p.id} className="card product-card">
                {isAdmin && (
                  <button
                    className="icon-button product-edit"
                    onClick={() => openEdit(p)}
                    aria-label={`Edit ${p.name}`}
                    title="Edit produk"
                  >
                    <span className="material-symbols-outlined">edit</span>
                  </button>
                )}

                <div className="product-card-head">
                  <div className="product-info">
                    <h3 className="product-name">{p.name}</h3>
                    <p className="product-unit">Satuan: {p.unit}</p>
                  </div>
                  {p.isActive ? (
                    <span className="badge success">Aktif</span>
                  ) : (
                    <span className="badge neutral">Diarsipkan</span>
                  )}
                </div>

                {photo && (
                  <div className="product-photo">
                    <img src={photo} alt={`Foto ${p.name}`} loading="lazy" />
                  </div>
                )}

                <div className="product-price">
                  <span className="card-label">Harga Jual</span>
                  <span className="price-value">
                    Rp {Number(p.sellingPrice).toLocaleString('id-ID')}
                  </span>
                </div>

                <div className="product-meta">
                  <div className="meta-item">
                    <span className="card-label">Stok Total</span>
                    <span className="meta-value">{Number(p.stock ?? 0).toLocaleString('id-ID')}</span>
                  </div>
                  <div className="meta-item">
                    <span className="card-label">Batch</span>
                    <span className="meta-value">{Number(p.batchCount ?? 0).toLocaleString('id-ID')}</span>
                  </div>
                </div>

                <div className="product-actions">
                  <button
                    className="button secondary"
                    onClick={() => toggleActive(p.id, p.isActive)}
                  >
                    {p.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  {isAdmin && (
                    <button
                      className="button danger-outline"
                      onClick={() => requestDelete(p)}
                      disabled={deleting}
                      aria-label={`Hapus ${p.name}`}
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Drawer tambah/edit produk (Admin) */}
      <Drawer
        open={drawerOpen}
        title={editTarget ? 'Edit Produk' : 'Tambah Produk'}
        onClose={closeDrawer}
      >
        <form onSubmit={editTarget ? updateProduct : createProduct} className="drawer-form">
          <div className="field">
            <label htmlFor="p-name">Nama Produk</label>
            <input
              id="p-name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Contoh: Keripik Singkong Balado"
              required
            />
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="p-unit">Satuan Dasar</label>
              <input
                id="p-unit"
                value={form.unit}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="Contoh: pcs"
                required
              />
              {editTarget && (
                <span className="text-muted">
                  Satuan tidak dapat diubah bila produk sudah memiliki riwayat operasional.
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="p-price">Harga Jual (Rp)</label>
              <input
                id="p-price"
                type="number"
                step="0.01"
                min="0"
                value={form.sellingPrice}
                onChange={e => setForm(f => ({ ...f, sellingPrice: e.target.value }))}
                required
              />
            </div>
          </div>

          <PhotoField
            currentUrl={editTarget?.photoUrl ?? null}
            file={photoFile}
            onChange={setPhotoFile}
            savedMessage={photoNotice}
          />

          <div className="field">
            <label htmlFor="p-desc">Deskripsi (opsional)</label>
            <textarea
              id="p-desc"
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="p-comp">Komposisi (opsional)</label>
            <textarea
              id="p-comp"
              rows={2}
              value={form.composition}
              onChange={e => setForm(f => ({ ...f, composition: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="p-storage">Petunjuk Penyimpanan (opsional)</label>
            <textarea
              id="p-storage"
              rows={2}
              value={form.storageInstructions}
              onChange={e => setForm(f => ({ ...f, storageInstructions: e.target.value }))}
            />
          </div>
          <div className="drawer-actions">
            <button type="button" className="button secondary" onClick={closeDrawer}>
              Batal
            </button>
            <button className="button" disabled={submitting}>
              {submitting
                ? 'Menyimpan...'
                : editTarget
                  ? 'Simpan Perubahan'
                  : 'Simpan Produk'}
            </button>
          </div>
        </form>
      </Drawer>

    </div>
  )
}

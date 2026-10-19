import { useEffect, useState } from 'react'
import api from '../lib/api'
import { Drawer } from '../components/Drawer'

interface Material {
  id: string
  name: string
  unit: string
  description?: string | null
  stock?: number
  isActive: boolean
}

const EMPTY_FORM = { name: '', unit: '', description: '' }

export function MaterialsPage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  async function fetchMaterials() {
    try {
      const res = await api.get('/materials')
      setMaterials(res.data.data || res.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat bahan baku')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMaterials()
  }, [])

  function openDrawer() {
    setForm(EMPTY_FORM)
    setError(null)
    setDrawerOpen(true)
  }

  async function createMaterial(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      await api.post('/materials', {
        name: form.name,
        unit: form.unit,
        description: form.description || undefined,
      })
      setSuccess('Bahan baku berhasil ditambahkan')
      setDrawerOpen(false)
      await fetchMaterials()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal menambah bahan baku')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    try {
      await api.patch(`/materials/${id}`, { isActive: !current })
      await fetchMaterials()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mengubah status')
    }
  }

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Master Bahan Baku</h1>
        <p className="page-subtitle">
          Kelola jenis bahan baku, satuan dasar, dan status aktif.
        </p>
      </div>

      {error && !drawerOpen && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      <div className="toolbar">
        <h2 className="card-title">Daftar Bahan Baku</h2>
        <button className="button" onClick={openDrawer}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
          Tambah Bahan
        </button>
      </div>

      {loading ? (
        <p className="text-muted">Memuat bahan baku...</p>
      ) : materials.length === 0 ? (
        <div className="card">
          <p className="text-muted">Belum ada bahan baku. Klik “Tambah Bahan” untuk menambah.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Nama Bahan</th>
                <th>Satuan</th>
                <th>Stok</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {materials.map(m => (
                <tr key={m.id}>
                  <td>
                    <div className="cell-primary">{m.name}</div>
                    {m.description && <div className="cell-secondary">{m.description}</div>}
                  </td>
                  <td>{m.unit}</td>
                  <td className="num">{Number(m.stock ?? 0).toLocaleString('id-ID')}</td>
                  <td>
                    {m.isActive ? (
                      <span className="badge success">Aktif</span>
                    ) : (
                      <span className="badge neutral">Nonaktif</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="button secondary"
                      onClick={() => toggleActive(m.id, m.isActive)}
                    >
                      {m.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={drawerOpen} title="Tambah Bahan Baku" onClose={() => setDrawerOpen(false)}>
        {error && <div className="alert error">{error}</div>}
        <form onSubmit={createMaterial} className="drawer-form">
          <div className="field">
            <label htmlFor="m-name">Nama Bahan</label>
            <input
              id="m-name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Contoh: Sapi Segar"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="m-unit">Satuan Dasar</label>
            <input
              id="m-unit"
              value={form.unit}
              onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
              placeholder="Contoh: kg"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="m-desc">Deskripsi (opsional)</label>
            <textarea
              id="m-desc"
              rows={2}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="drawer-actions">
            <button type="button" className="button secondary" onClick={() => setDrawerOpen(false)}>
              Batal
            </button>
            <button className="button" disabled={submitting}>
              {submitting ? 'Menyimpan...' : 'Simpan Bahan'}
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  )
}

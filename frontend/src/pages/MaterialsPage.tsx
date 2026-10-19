import { useEffect, useState } from 'react'
import api from '../lib/api'

interface Material {
  id: string
  name: string
  unit: string
  description?: string | null
  isActive: boolean
  createdAt: string
  updatedAt?: string | null
}

export function MaterialsPage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', unit: '', description: '' })
  const [creating, setCreating] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

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

  async function createMaterial(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    setSuccess(null)
    try {
      await api.post('/materials', {
        name: form.name,
        unit: form.unit,
        description: form.description || undefined,
      })
      setSuccess('Bahan baku berhasil ditambahkan')
      setForm({ name: '', unit: '', description: '' })
      await fetchMaterials()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal menambah bahan baku')
    } finally {
      setCreating(false)
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
      <h1 className="page-title">Master Bahan Baku</h1>
      <p className="page-subtitle">Kelola bahan baku sesuai struktur backend.</p>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert" style={{ borderColor: '#bbf7d0', background: '#f0fdf4', color: '#166534' }}>{success}</div>}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Tambah Bahan Baku</h2>
        <form onSubmit={createMaterial}>
          <div className="form-row" style={{ marginBottom: '1rem' }}>
            <div className="field">
              <label>Nama Bahan</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Satuan Dasar</label>
              <input value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))} required />
            </div>
            <div className="field">
              <label>Deskripsi (opsional)</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <button className="button" disabled={creating}>{creating ? 'Menyimpan...' : 'Tambah Bahan Baku'}</button>
        </form>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Nama</th>
              <th>Satuan</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4}>Memuat...</td></tr>
            ) : materials.length === 0 ? (
              <tr><td colSpan={4} style={{ color: 'var(--color-muted)' }}>Belum ada bahan baku</td></tr>
            ) : (
              materials.map(m => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.unit}</td>
                  <td>{m.isActive ? 'Aktif' : 'Nonaktif'}</td>
                  <td style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button className="button secondary" onClick={() => toggleActive(m.id, m.isActive)}>{m.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

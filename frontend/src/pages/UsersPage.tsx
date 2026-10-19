import { useEffect, useState } from 'react'
import api from '../lib/api'

interface User {
  id: string
  username: string
  role: 'ADMIN' | 'OPERATOR'
  name?: string | null
  isActive: boolean
  mustChangePassword: boolean
  createdAt: string
  updatedAt?: string | null
  lastLoginAt?: string | null
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ username: '', password: '', name: '' })
  const [creating, setCreating] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  async function fetchUsers() {
    try {
      const res = await api.get('/users')
      setUsers(res.data.data || res.data)
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal memuat pengguna')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  async function createOperator(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    setSuccess(null)
    try {
      await api.post('/users', { username: form.username, password: form.password, name: form.name || undefined, role: 'OPERATOR' })
      setSuccess('Operator berhasil dibuat')
      setForm({ username: '', password: '', name: '' })
      await fetchUsers()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal membuat pengguna')
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    try {
      await api.patch(`/users/${id}`, { isActive: !current })
      await fetchUsers()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mengubah status')
    }
  }

  async function resetPassword(id: string) {
    try {
      await api.post(`/users/${id}/password-reset`)
      await fetchUsers()
      setSuccess('Reset kata sandi berhasil. Pengguna wajib ganti kata sandi saat login berikutnya.')
    } catch (err: any) {
      setError(err.response?.data?.message || 'Gagal mereset kata sandi')
    }
  }

  return (
    <div className="container">
      <h1 className="page-title">Manajemen Pengguna</h1>
      <p className="page-subtitle">Hanya Admin yang dapat mengakses halaman ini.</p>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert" style={{ borderColor: '#bbf7d0', background: '#f0fdf4', color: '#166534' }}>{success}</div>}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem' }}>Buat Akun Operator</h2>
        <form onSubmit={createOperator} className="form-row">
          <div className="field">
            <label>Username</label>
            <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required minLength={3} />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={8} />
          </div>
          <div className="field">
            <label>Nama (opsional)</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="button" disabled={creating}>{creating ? 'Menyimpan...' : 'Buat Operator'}</button>
          </div>
        </form>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Wajib ganti password</th>
              <th>Terakhir login</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6}>Memuat...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={6} style={{ color: 'var(--color-muted)' }}>Belum ada pengguna</td></tr>
            ) : (
              users.map(u => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.role}</td>
                  <td>{u.isActive ? 'Aktif' : 'Nonaktif'}</td>
                  <td>{u.mustChangePassword ? 'Ya' : 'Tidak'}</td>
                  <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('id-ID') : '-'}</td>
                  <td style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button className="button secondary" onClick={() => toggleActive(u.id, u.isActive)} disabled={u.role === 'ADMIN'}>{u.isActive ? 'Nonaktifkan' : 'Aktifkan'}</button>
                    <button className="button secondary" onClick={() => resetPassword(u.id)} disabled={u.role === 'ADMIN'}>Reset Password</button>
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

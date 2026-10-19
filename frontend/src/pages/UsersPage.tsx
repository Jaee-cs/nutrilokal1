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

  const adminCount = users.filter(u => u.role === 'ADMIN').length
  const operatorCount = users.filter(u => u.role === 'OPERATOR').length

  return (
    <div className="container">
      <div className="page-head">
        <h1 className="page-title">Manajemen Pengguna</h1>
        <p className="page-subtitle">
          Hanya Admin yang dapat mengelola akun Operator.
        </p>
      </div>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      <div className="summary-row">
        <div className="summary-item">
          <span className="card-label">Total Pengguna</span>
          <span className="summary-value">{users.length}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Admin</span>
          <span className="summary-value">{adminCount}</span>
        </div>
        <div className="summary-item">
          <span className="card-label">Operator</span>
          <span className="summary-value">{operatorCount}</span>
        </div>
      </div>

      <section className="card section-card">
        <h2 className="card-title">Buat Akun Operator</h2>
        <form onSubmit={createOperator} className="form-row">
          <div className="field">
            <label htmlFor="u-username">Username</label>
            <input
              id="u-username"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              required
              minLength={3}
              placeholder="Minimal 3 karakter"
            />
          </div>
          <div className="field">
            <label htmlFor="u-password">Kata Sandi</label>
            <input
              id="u-password"
              type="password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
              placeholder="Minimal 8 karakter"
            />
          </div>
          <div className="field">
            <label htmlFor="u-name">Nama (opsional)</label>
            <input
              id="u-name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="form-actions">
            <button className="button" disabled={creating}>
              {creating ? 'Menyimpan...' : 'Buat Operator'}
            </button>
          </div>
        </form>
      </section>

      <section className="card section-card">
        <div className="section-head">
          <h2 className="card-title">Daftar Pengguna</h2>
          <span className="text-muted">{users.length} akun</span>
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
                <tr><td colSpan={6} className="text-muted">Belum ada pengguna</td></tr>
              ) : (
                users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div className="cell-primary">{u.username}</div>
                      {u.name && <div className="cell-secondary">{u.name}</div>}
                    </td>
                    <td>
                      {u.role === 'ADMIN' ? (
                        <span className="badge neutral">Admin</span>
                      ) : (
                        <span className="badge success">Operator</span>
                      )}
                    </td>
                    <td>
                      {u.isActive ? (
                        <span className="badge success">Aktif</span>
                      ) : (
                        <span className="badge neutral">Nonaktif</span>
                      )}
                    </td>
                    <td>{u.mustChangePassword ? <span className="badge warning">Ya</span> : 'Tidak'}</td>
                    <td className="text-muted">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('id-ID') : '-'}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="button secondary"
                          onClick={() => toggleActive(u.id, u.isActive)}
                          disabled={u.role === 'ADMIN'}
                        >
                          {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => resetPassword(u.id)}
                          disabled={u.role === 'ADMIN'}
                        >
                          Reset Password
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

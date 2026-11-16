import { useEffect, useRef, useState } from 'react'
import api from '../lib/api'
import { useNotify } from '../components/NotificationProvider'
import { PasswordInput } from '../components/PasswordInput'

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

/**
 * Isi dialog kata sandi sementara. Kata sandi hanya hidup di elemen ini
 * selama dialog terbuka dan tidak disimpan di state halaman.
 */
function TemporaryPasswordDetails({ username, password }: { username: string; password: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)

  async function copyPassword() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(password)
      } else {
        inputRef.current?.focus()
        inputRef.current?.select()
        document.execCommand('copy')
      }
      setCopied(true)
    } catch {
      // Clipboard bisa diblokir browser; pilih teks agar dapat disalin manual.
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  return (
    <div className="temp-password">
      <p className="temp-password-label">
        Kata sandi sementara untuk <strong>{username}</strong>
      </p>
      <input
        ref={inputRef}
        className="temp-password-value"
        value={password}
        readOnly
        aria-label="Kata sandi sementara"
        onFocus={(event) => event.currentTarget.select()}
      />
      <button type="button" className="button secondary temp-password-copy" onClick={copyPassword}>
        <span className="material-symbols-outlined" aria-hidden="true">
          {copied ? 'check' : 'content_copy'}
        </span>
        {copied ? 'Tersalin' : 'Salin kata sandi'}
      </button>
      <p className="temp-password-warning">
        Kata sandi ini hanya ditampilkan sekali. Setelah dialog ditutup, kata sandi tidak
        dapat dilihat lagi — lakukan reset ulang jika perlu.
      </p>
    </div>
  )
}

export function UsersPage() {
  const notify = useNotify()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  // Kegagalan memuat daftar tetap ditampilkan di halaman karena pengguna
  // perlu melihat keadaan halaman yang gagal dimuat (bukan hasil tindakan).
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState({ username: '', password: '', name: '' })
  const [creating, setCreating] = useState(false)
  const [resettingId, setResettingId] = useState<string | null>(null)

  async function fetchUsers(): Promise<boolean> {
    try {
      const res = await api.get('/users')
      setUsers(res.data.data || res.data)
      setLoadError(null)
      return true
    } catch (err: any) {
      setLoadError(err.response?.data?.message || 'Gagal memuat pengguna')
      return false
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
    try {
      // Backend SELALU membuat akun baru dengan role OPERATOR (README: Admin hanya
      // dibuat lewat bootstrap). Field `role` tidak dikirim karena backend menolak
      // keberadaannya (400) sebagai pengaman eskalasi peran menjadi Admin.
      await api.post('/users', {
        username: form.username.trim(),
        password: form.password,
        name: form.name.trim() || undefined,
      })
      // Kosongkan formulir lebih dulu, lalu segarkan daftar, baru tampilkan pesan
      // sukses — pesan tidak hilang akibat pemuatan ulang.
      setForm({ username: '', password: '', name: '' })
      const refreshed = await fetchUsers()
      if (refreshed) notify.success('Operator berhasil dibuat')
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal membuat pengguna')
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(id: string, current: boolean) {
    try {
      await api.patch(`/users/${id}`, { isActive: !current })
      await fetchUsers()
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mengubah status')
    }
  }

  async function resetPassword(user: User) {
    const confirmed = await notify.confirm({
      title: 'Reset Kata Sandi',
      message:
        `Reset kata sandi untuk "${user.username}"? Kata sandi lama dan semua sesi login ` +
        'akun ini akan langsung tidak berlaku.',
      confirmLabel: 'Ya, Reset',
      tone: 'warning',
    })
    if (!confirmed) return

    setResettingId(user.id)
    try {
      const res = await api.post(`/users/${user.id}/password-reset`)
      const temporaryPassword: string | undefined = res.data?.temporaryPassword
      // Segarkan daftar tanpa menunda dialog: kata sandi sementara hanya
      // ditampilkan sekali, jadi jangan bergantung pada keberhasilan refresh.
      void fetchUsers()
      if (temporaryPassword) {
        notify.info(
          `Berikan kata sandi sementara ini kepada ${user.username}. Pengguna wajib ` +
            'menggantinya sebelum dapat menggunakan sistem kembali.',
          'Kata Sandi Sementara',
          {
            tone: 'warning',
            confirmLabel: 'Saya sudah menyalin',
            details: (
              <TemporaryPasswordDetails username={user.username} password={temporaryPassword} />
            ),
          },
        )
      } else {
        notify.success('Reset kata sandi berhasil.')
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal mereset kata sandi')
    } finally {
      setResettingId(null)
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

      {loadError && <div className="alert error">{loadError}</div>}

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
            <PasswordInput
              id="u-password"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              required
              minLength={8}
              placeholder="Minimal 8 karakter"
              visibilityLabel="kata sandi operator"
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
        <div className="desktop-table">
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
                            onClick={() => resetPassword(u)}
                            disabled={u.role === 'ADMIN' || resettingId === u.id}
                          >
                            {resettingId === u.id ? 'Mereset...' : 'Reset Password'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile: kartu pengguna */}
        <div className="mobile-list users-mobile-list">
          {loading ? (
            <p className="text-muted">Memuat...</p>
          ) : users.length === 0 ? (
            <p className="text-muted">Belum ada pengguna</p>
          ) : (
            users.map(u => (
              <article className="user-card" key={u.id}>
                <div className="user-card-head">
                  <div className="user-card-identity">
                    <div className="user-card-username">{u.username}</div>
                    {u.name && <div className="user-card-name">{u.name}</div>}
                  </div>
                  <div className="user-card-badges">
                    {u.role === 'ADMIN' ? (
                      <span className="badge neutral">Admin</span>
                    ) : (
                      <span className="badge success">Operator</span>
                    )}
                    {u.isActive ? (
                      <span className="badge success">Aktif</span>
                    ) : (
                      <span className="badge neutral">Nonaktif</span>
                    )}
                  </div>
                </div>
                <div className="user-card-meta">
                  <div className="user-card-row">
                    <span className="user-card-label">Wajib ganti password</span>
                    <span className="user-card-value">{u.mustChangePassword ? 'Ya' : 'Tidak'}</span>
                  </div>
                  <div className="user-card-row">
                    <span className="user-card-label">Terakhir login</span>
                    <span className="user-card-value">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('id-ID') : '-'}</span>
                  </div>
                </div>
                <div className="user-card-actions">
                  <button
                    className="button secondary"
                    onClick={() => toggleActive(u.id, u.isActive)}
                    disabled={u.role === 'ADMIN'}
                  >
                    {u.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => resetPassword(u)}
                    disabled={u.role === 'ADMIN' || resettingId === u.id}
                  >
                    {resettingId === u.id ? 'Mereset...' : 'Reset Password'}
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

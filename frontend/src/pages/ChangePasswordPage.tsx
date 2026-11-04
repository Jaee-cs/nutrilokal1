import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useNotify } from '../components/NotificationProvider'

const MIN_PASSWORD_LENGTH = 8

/**
 * Halaman wajib ganti kata sandi.
 *
 * Dibuka untuk akun yang baru direset Admin (mustChangePassword=true).
 * Pengguna memasukkan kata sandi sementara, kata sandi baru, dan
 * konfirmasinya. Backend memverifikasi kata sandi saat ini, menyimpan hash
 * baru, mencabut token lama, lalu mengembalikan token sesi baru.
 */
export function ChangePasswordPage() {
  const { login } = useAuth()
  const notify = useNotify()
  const navigate = useNavigate()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()

    if (!currentPassword) {
      notify.error('Kata sandi saat ini wajib diisi.')
      return
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      notify.error(`Kata sandi baru minimal ${MIN_PASSWORD_LENGTH} karakter.`)
      return
    }
    if (newPassword !== confirmPassword) {
      notify.error('Konfirmasi kata sandi baru tidak sama.')
      return
    }
    if (newPassword === currentPassword) {
      notify.error('Kata sandi baru harus berbeda dari kata sandi saat ini.')
      return
    }

    setSaving(true)
    try {
      const res = await api.post('/auth/set-password', { currentPassword, newPassword })
      // Simpan token baru sebelum berpindah halaman: token lama sudah tidak
      // berlaku karena hash kata sandi berubah.
      login(res.data.token, res.data.user)
      navigate('/dashboard', { replace: true })
      notify.success('Kata sandi berhasil diperbarui.')
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal memperbarui kata sandi.')
    } finally {
      setSaving(false)
    }
  }

  const inputType = showPasswords ? 'text' : 'password'

  return (
    <div className="container password-page">
      <div className="page-head">
        <h1 className="page-title">Perbarui Password</h1>
        <p className="page-subtitle">
          Akun Anda menggunakan kata sandi sementara. Tetapkan kata sandi baru sebelum
          melanjutkan ke Dashboard.
        </p>
      </div>

      <section className="card password-card">
        <div className="password-card-intro">
          <span className="password-card-icon material-symbols-outlined" aria-hidden="true">
            lock_reset
          </span>
          <div>
            <h2 className="card-title">Buat Kata Sandi Baru</h2>
            <p className="text-muted">
              Gunakan minimal {MIN_PASSWORD_LENGTH} karakter. Kata sandi sementara tidak
              dapat dipakai lagi setelah perubahan berhasil disimpan.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="password-form">
          <div className="field">
            <label htmlFor="current-password">Password saat ini</label>
            <input
              id="current-password"
              type={inputType}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label htmlFor="new-password">Password baru</label>
            <input
              id="new-password"
              type={inputType}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="confirm-password">Konfirmasi password baru</label>
            <input
              id="confirm-password"
              type={inputType}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </div>

          <div className="password-form-foot">
            <button
              type="button"
              className="password-visibility-toggle"
              onClick={() => setShowPasswords((value) => !value)}
              aria-pressed={showPasswords}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                {showPasswords ? 'visibility_off' : 'visibility'}
              </span>
              {showPasswords ? 'Sembunyikan password' : 'Tampilkan password'}
            </button>

            <button type="submit" className="button" disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan Password Baru'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

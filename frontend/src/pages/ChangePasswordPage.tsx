import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useNotify } from '../components/NotificationProvider'
import {
  MIN_PASSWORD_LENGTH,
  PasswordChangeForm,
} from '../components/PasswordChangeForm'

/**
 * Halaman wajib ganti kata sandi.
 *
 * Dibuka untuk akun yang baru direset Admin (mustChangePassword=true).
 * Format dan validasi form berasal dari komponen yang sama dengan yang
 * dipakai menu profil; bedanya, setelah berhasil halaman ini kembali ke
 * Dashboard memakai token baru yang dikembalikan backend.
 */
export function ChangePasswordPage() {
  const { login } = useAuth()
  const notify = useNotify()
  const navigate = useNavigate()

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

        <PasswordChangeForm
          onSuccess={({ token, user }) => {
            // Simpan token baru sebelum berpindah halaman: token lama sudah tidak
            // berlaku karena sidik jari kata sandi berubah.
            login(token, user)
            navigate('/dashboard', { replace: true })
            notify.success('Kata sandi berhasil diperbarui.')
          }}
        />
      </section>
    </div>
  )
}

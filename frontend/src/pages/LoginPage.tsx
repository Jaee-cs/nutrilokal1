import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { useNotify } from '../components/NotificationProvider'
import './LoginPage.css'

export function LoginPage() {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [l, setL] = useState(false)
  const { login } = useAuth()
  const notify = useNotify()
  const nav = useNavigate()

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    setL(true)
    try {
      const r = await api.post('/auth/login', { username: u, password: p })
      login(r.data.token, r.data.user)
      nav('/dashboard')
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Gagal login')
    } finally {
      setL(false)
    }
  }

  return (
    <div className="login-shell">
      {/* Panel branding kiri */}
      <aside className="login-hero">
        <div className="login-hero-inner">
          <div className="login-brand">
            <span className="material-symbols-outlined login-brand-icon">eco</span>
            <span className="login-brand-name">NutriLokal</span>
          </div>
          <h1 className="login-hero-title">
            Ketahanan pangan lokal,
            <br />
            terlacak hingga batch.
          </h1>
          <p className="login-hero-text">
            Sistem produksi &amp; traceability KWT Gogor, Kalurahan Salam — Patuk, Gunungkidul.
          </p>
          <div className="login-hero-tags">
            <span className="badge success">Sertifikasi Halal</span>
            <span className="badge neutral">TKI 5342</span>
            <span className="badge neutral">TKI 5342</span>
          </div>
        </div>
        <div className="login-hero-footer">© 2026 NutriLokal · KWT Gogor</div>
      </aside>

      {/* Form kanan */}
      <main className="login-main">
        <div className="login-main-inner">
          {/* Logo NutriLokal di atas kotak form (di tengah, di luar kartu) */}
          <img src="/logo.png" alt="NutriLokal" className="login-logo" />
          <div className="login-card">
            <h2 className="login-title">Masuk</h2>
            <p className="login-subtitle">Gunakan akun Admin atau Operator untuk melanjutkan.</p>

            <form onSubmit={submit} className="login-form">
              <div className="field">
                <label htmlFor="login-username">Username</label>
                <input
                  id="login-username"
                  value={u}
                  onChange={ev => setU(ev.target.value)}
                  placeholder="Masukkan username"
                  autoComplete="username"
                />
              </div>
              <div className="field">
                <label htmlFor="login-password">Kata sandi</label>
                <input
                  id="login-password"
                  type="password"
                  value={p}
                  onChange={ev => setP(ev.target.value)}
                  placeholder="Masukkan kata sandi"
                  autoComplete="current-password"
                />
              </div>
              <button className="button login-submit" disabled={l}>
                {l ? 'Memproses...' : 'Masuk'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}

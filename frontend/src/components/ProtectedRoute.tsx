import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

/**
 * Penjaga rute terlindungi.
 *
 * Saat status masih 'restoring' (memvalidasi token ke GET /auth/me),
 * JANGAN mengarahkan ke mana pun — hanya tampilkan pemuatan. Redirect
 * prematur adalah akar penyebab hard refresh di /users & /product-qr
 * terlempar ke /dashboard (F12).
 *
 * Pengguna yang wajib mengganti kata sandi diarahkan ke /change-password
 * sebelum halaman operasional mana pun dirender. Backend juga menolak
 * seluruh endpoint operasional dengan 403 PASSWORD_CHANGE_REQUIRED, jadi
 * pembatasan ini tidak bergantung pada URL saja.
 */
export function ProtectedRoute() {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'restoring') return <RouteLoading />
  if (status === 'unauthenticated') return <Navigate to="/login" replace />
  if (user?.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  return <Outlet />
}

/**
 * Penjaga khusus halaman Perbarui Password.
 * Hanya dapat dibuka oleh sesi yang valid dan memang sedang wajib mengganti
 * kata sandi. Setelah selesai, pengguna diarahkan ke Dashboard.
 */
export function PasswordChangeRoute() {
  const { status, user } = useAuth()

  if (status === 'restoring') return <RouteLoading />
  if (status === 'unauthenticated') return <Navigate to="/login" replace />
  if (user && !user.mustChangePassword) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/**
 * Penjaga rute khusus Admin.
 * Role diverifikasi dari backend via /auth/me — bukan dari token yang
 * disimpan klien. Selama identitas belum terkonfirmasi, akses ditahan
 * (fallback ke dashboard), backend tetap menjadi sumber kebenaran.
 */
export function AdminRoute() {
  const { status, user } = useAuth()

  if (status === 'restoring') return <RouteLoading />
  if (status === 'unauthenticated') return <Navigate to="/login" replace />
  if (user?.mustChangePassword) return <Navigate to="/change-password" replace />
  // Role pasti diperlukan untuk masuk; bila tidak terkonfirmasi, tahan di
  // dashboard.
  if (user?.role !== 'ADMIN') return <Navigate to="/dashboard" replace />
  return <Outlet />
}

function RouteLoading() {
  return (
    <div className="container">
      <p className="text-muted">Memuat sesi...</p>
    </div>
  )
}

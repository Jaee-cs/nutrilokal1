import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

/**
 * Penjaga rute terlindungi.
 *
 * Saat status masih 'restoring' (memvalidasi token ke GET /auth/me),
 * JANGAN mengarahkan ke mana pun — hanya tampilkan pemuatan. Redirect
 * prematur adalah akar penyebab hard refresh di /users & /qr-management
 * terlempar ke /dashboard (F12).
 */
export function ProtectedRoute() {
  const { status } = useAuth()

  if (status === 'restoring') return <RouteLoading />
  if (status === 'unauthenticated') return <Navigate to="/login" replace />
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
  // Role pasti diperlukan untuk masuk; bila tidak terkonfirmasi (mis. 403
  // PASSWORD_CHANGE_REQUIRED), tahan di dashboard.
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

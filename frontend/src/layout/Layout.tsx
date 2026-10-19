import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export function Layout() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: '#ffffff', borderBottom: '1px solid var(--color-border)' }}>
        <div
          className="container"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
            <NavLink to="/dashboard" style={{ fontWeight: 600, fontSize: '1.1rem' }}>
              NutriLokal
            </NavLink>
            <nav style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
              <NavLink to="/dashboard">Dashboard</NavLink><NavLink to="/products">Produk</NavLink><NavLink to="/materials">Master Bahan</NavLink><NavLink to="/material-stock">Bahan Baku & Stok</NavLink>
              {user?.role === 'ADMIN' && <NavLink to="/users">Pengguna</NavLink>}
            </nav>
          </div>
          <button className="button secondary" onClick={handleLogout}>
            Keluar
          </button>
        </div>
      </header>
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
    </div>
  )
}

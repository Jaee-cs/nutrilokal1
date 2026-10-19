import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import './Layout.css'

interface NavItem {
  to: string
  label: string
  icon: string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'grid_view' },
  { to: '/products', label: 'Produk', icon: 'inventory_2' },
  { to: '/materials', label: 'Bahan Baku', icon: 'nutrition' },
  { to: '/material-stock', label: 'Bahan Baku & Stok', icon: 'warehouse' },
  { to: '/production', label: 'Produksi & Batch', icon: 'precision_manufacturing' },
  { to: '/sales', label: 'Penjualan', icon: 'receipt_long' },
  { to: '/reports', label: 'Laporan', icon: 'assessment' },
]

const ADMIN_NAV_ITEMS: NavItem[] = [
  { to: '/users', label: 'Pengguna', icon: 'group' },
  { to: '/qr-management', label: 'QR Traceability', icon: 'qr_code_2' },
]

export function Layout() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const allItems = user?.role === 'ADMIN' ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS] : NAV_ITEMS

  return (
    <div className="app-shell">
      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <span className="material-symbols-outlined brand-icon">eco</span>
            <span className="brand-name">NutriLokal</span>
          </div>
          <span className="sidebar-badge">V1.0 · KWT Gogor, Salam</span>
        </div>

        <nav className="sidebar-nav">
          {allItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <span className="material-symbols-outlined nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="profile-card">
            <div className="profile-info">
              <div className="profile-name">{user?.name || user?.username || 'Pengguna'}</div>
              <div className="profile-role">{user?.role === 'ADMIN' ? 'Administrator' : 'Operator'}</div>
            </div>
            <button className="logout-btn" onClick={handleLogout} title="Keluar">
              <span className="material-symbols-outlined">logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="main-area">
        <header className="top-header">
          <div className="header-left">
            <button
              className="menu-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="Buka menu"
            >
              <span className="material-symbols-outlined">menu</span>
            </button>
            <span className="header-location">
              <span className="material-symbols-outlined location-icon">location_on</span>
              KWT Gogor
              <span className="location-sep">·</span>
              <span className="location-detail">Kalurahan Salam, Patuk, Gunungkidul</span>
            </span>
          </div>
        </header>

        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

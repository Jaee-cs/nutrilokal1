import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './layout/Layout'
import { AdminRoute, ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './hooks/useAuth'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { UsersPage } from './pages/UsersPage'
import { ProductsPage } from './pages/ProductsPage'
import { MaterialsPage } from './pages/MaterialsPage'
import { ProductionPage } from './pages/ProductionPage'
import { SalesPage } from './pages/SalesPage'
import { CatalogPage } from './pages/CatalogPage'
import { QrTracePage } from './pages/QrTracePage'
import { QrManagementPage } from './pages/QrManagementPage'
import { ReportsPage } from './pages/ReportsPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Halaman publik: landing, katalog, dan traceability QR —
              semuanya dapat dibuka tanpa token (README 5.6). */}
          <Route path="/" element={<LandingPage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="qr/:code" element={<QrTracePage />} />
          <Route path="qr-trace" element={<QrTracePage />} />
          <Route path="login" element={<LoginPage />} />
          {/* Halaman internal tetap di balik penjaga autentikasi. */}
          <Route element={<Layout />}>
            <Route element={<ProtectedRoute />}>
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="materials" element={<MaterialsPage />} />
              {/* Rute lama digabung ke /materials (Fase D) — redirect agar tautan lama tetap hidup. */}
              <Route path="material-stock" element={<Navigate to="/materials" replace />} />
              <Route path="production" element={<ProductionPage />} />
              <Route path="sales" element={<SalesPage />} />
              <Route path="reports" element={<ReportsPage />} />
            </Route>
            <Route element={<AdminRoute />}>
              <Route path="users" element={<UsersPage />} />
              <Route path="qr-management" element={<QrManagementPage />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

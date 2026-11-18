import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './layout/Layout'
import { AdminRoute, PasswordChangeRoute, ProtectedRoute } from './components/ProtectedRoute'
import { NotificationProvider } from './components/NotificationProvider'
import { AuthProvider } from './hooks/useAuth'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { DashboardPage } from './pages/DashboardPage'
import { UsersPage } from './pages/UsersPage'
import { ProductsPage } from './pages/ProductsPage'
import { MaterialsPage } from './pages/MaterialsPage'
import { ProductionPage } from './pages/ProductionPage'
import { SalesPage } from './pages/SalesPage'
import { CatalogPage } from './pages/CatalogPage'
import { ProductPublicPage } from './pages/ProductPublicPage'
import { LegacyQrRedirectPage } from './pages/LegacyQrRedirectPage'
import { ProductQrPage } from './pages/ProductQrPage'
import { ReportsPage } from './pages/ReportsPage'

export default function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <BrowserRouter>
          <Routes>
            {/* Halaman publik: landing, katalog, dan halaman produk (QR permanen).
                /qr/:code hanya shim kompatibilitas untuk QR batch yang sudah
                dicetak — langsung mengalihkan ke halaman produk. */}
            <Route path="/" element={<LandingPage />} />
            <Route path="catalog" element={<CatalogPage />} />
            <Route path="produk/:id" element={<ProductPublicPage />} />
            <Route path="qr/:code" element={<LegacyQrRedirectPage />} />
            <Route path="login" element={<LoginPage />} />
            {/* Halaman internal tetap di balik penjaga autentikasi. */}
            <Route element={<Layout />}>
              {/* Wajib ganti kata sandi: halaman ini tetap dapat diakses
                  setelah refresh, tetapi halaman operasional tidak. */}
              <Route element={<PasswordChangeRoute />}>
                <Route path="change-password" element={<ChangePasswordPage />} />
              </Route>
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
                <Route path="product-qr" element={<ProductQrPage />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </NotificationProvider>
    </AuthProvider>
  )
}

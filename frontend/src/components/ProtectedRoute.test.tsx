import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminRoute, PasswordChangeRoute, ProtectedRoute } from './ProtectedRoute'

type AuthState = {
  status: 'restoring' | 'authenticated' | 'unauthenticated'
  user: null | {
    id: string
    username: string
    role: 'ADMIN' | 'OPERATOR'
    mustChangePassword: boolean
  }
}

const auth = vi.hoisted(() => ({ current: null as AuthState | null }))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => auth.current,
}))

function renderRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Halaman Login</div>} />
        <Route element={<PasswordChangeRoute />}>
          <Route path="/change-password" element={<div>Halaman Perbarui Password</div>} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<div>Halaman Dashboard</div>} />
        </Route>
        <Route element={<AdminRoute />}>
          <Route path="/users" element={<div>Halaman Pengguna</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('penjaga rute wajib ganti kata sandi', () => {
  beforeEach(() => {
    auth.current = null
  })

  it('mengarahkan pengguna mustChangePassword dari Dashboard ke halaman Perbarui Password', () => {
    auth.current = {
      status: 'authenticated',
      user: { id: 'u1', username: 'operator', role: 'OPERATOR', mustChangePassword: true },
    }

    renderRoutes('/dashboard')

    expect(screen.getByText('Halaman Perbarui Password')).toBeInTheDocument()
    expect(screen.queryByText('Halaman Dashboard')).not.toBeInTheDocument()
  })

  it('menahan akses Admin (mis. /users) selama kata sandi wajib diganti', () => {
    auth.current = {
      status: 'authenticated',
      user: { id: 'u1', username: 'admin', role: 'ADMIN', mustChangePassword: true },
    }

    renderRoutes('/users')

    expect(screen.getByText('Halaman Perbarui Password')).toBeInTheDocument()
    expect(screen.queryByText('Halaman Pengguna')).not.toBeInTheDocument()
  })

  it('mengizinkan halaman Perbarui Password setelah refresh sesi', () => {
    auth.current = {
      status: 'authenticated',
      user: { id: 'u1', username: 'operator', role: 'OPERATOR', mustChangePassword: true },
    }

    renderRoutes('/change-password')

    expect(screen.getByText('Halaman Perbarui Password')).toBeInTheDocument()
  })

  it('tidak mengizinkan sesi tanpa login', () => {
    auth.current = { status: 'unauthenticated', user: null }

    renderRoutes('/change-password')

    expect(screen.getByText('Halaman Login')).toBeInTheDocument()
  })

  it('mengizinkan Dashboard untuk pengguna yang tidak wajib ganti kata sandi', () => {
    auth.current = {
      status: 'authenticated',
      user: { id: 'u1', username: 'operator', role: 'OPERATOR', mustChangePassword: false },
    }

    renderRoutes('/dashboard')

    expect(screen.getByText('Halaman Dashboard')).toBeInTheDocument()
  })
})

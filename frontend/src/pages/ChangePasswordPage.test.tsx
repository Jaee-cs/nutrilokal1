import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { NotificationProvider } from '../components/NotificationProvider'
import { ChangePasswordPage } from './ChangePasswordPage'

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  post: vi.fn(),
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ login: mocks.login }),
}))

vi.mock('../lib/api', () => ({
  default: { post: mocks.post },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

function renderPage() {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={['/change-password']}>
        <Routes>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/dashboard" element={<div>Dashboard tujuan</div>} />
        </Routes>
      </MemoryRouter>
    </NotificationProvider>,
  )
}

async function fillForm(current: string, next: string, confirmation = next) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Password saat ini'), current)
  await user.type(screen.getByLabelText('Password baru'), next)
  await user.type(screen.getByLabelText('Konfirmasi password baru'), confirmation)
  return user
}

describe('ChangePasswordPage', () => {
  beforeEach(() => {
    mocks.login.mockReset()
    mocks.post.mockReset()
  })

  it('menolak konfirmasi yang tidak sama tanpa memanggil API', async () => {
    renderPage()
    const user = await fillForm('sementara-123', 'baru-rahasia-123', 'beda-rahasia-123')

    await user.click(screen.getByRole('button', { name: 'Simpan Password Baru' }))

    expect(await screen.findByText('Konfirmasi kata sandi baru tidak sama.')).toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('menolak kata sandi baru yang kurang dari 8 karakter', async () => {
    renderPage()
    const user = await fillForm('sementara-123', 'pendek')

    await user.click(screen.getByRole('button', { name: 'Simpan Password Baru' }))

    expect(await screen.findByText('Kata sandi baru minimal 8 karakter.')).toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('menampilkan pesan backend saat kata sandi saat ini salah', async () => {
    mocks.post.mockRejectedValue({ response: { data: { message: 'Kata sandi saat ini salah.' } } })
    renderPage()
    const user = await fillForm('salah-total', 'baru-rahasia-123')

    await user.click(screen.getByRole('button', { name: 'Simpan Password Baru' }))

    expect(await screen.findByText('Kata sandi saat ini salah.')).toBeInTheDocument()
    expect(mocks.login).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Perbarui Password' })).toBeInTheDocument()
  })

  it('menyimpan token sesi baru dan berpindah ke Dashboard setelah berhasil', async () => {
    mocks.post.mockResolvedValue({
      data: {
        token: 'token-baru',
        user: { id: 'u1', username: 'operator', role: 'OPERATOR', mustChangePassword: false },
      },
    })
    renderPage()
    const user = await fillForm('sementara-123', 'baru-rahasia-123')

    await user.click(screen.getByRole('button', { name: 'Simpan Password Baru' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/auth/set-password', {
        currentPassword: 'sementara-123',
        newPassword: 'baru-rahasia-123',
      }),
    )
    expect(mocks.login).toHaveBeenCalledWith('token-baru', {
      id: 'u1',
      username: 'operator',
      role: 'OPERATOR',
      mustChangePassword: false,
    })
    expect(await screen.findByText('Dashboard tujuan')).toBeInTheDocument()
  })

  it('setiap input kata sandi punya kontrol tampil/sembunyi sendiri', async () => {
    renderPage()
    const user = userEvent.setup()
    const current = screen.getByLabelText('Password saat ini')
    const next = screen.getByLabelText('Password baru')
    const confirmation = screen.getByLabelText('Konfirmasi password baru')

    expect(current).toHaveAttribute('type', 'password')
    expect(next).toHaveAttribute('type', 'password')
    expect(confirmation).toHaveAttribute('type', 'password')

    await user.type(next, 'rahasia-baru')
    await user.click(screen.getByRole('button', { name: 'Tampilkan password baru' }))

    expect(next).toHaveAttribute('type', 'text')
    expect(next).toHaveValue('rahasia-baru')
    expect(current).toHaveAttribute('type', 'password')
    expect(confirmation).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Sembunyikan password baru' }))
    expect(next).toHaveAttribute('type', 'password')
    expect(next).toHaveValue('rahasia-baru')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserMenu } from './UserMenu'
import type { User } from '../hooks/useAuth'

const mocks = vi.hoisted(() => ({
  user: null as User | null,
  login: vi.fn(),
  logout: vi.fn(),
  updateUser: vi.fn(),
  navigate: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: mocks.user,
    login: mocks.login,
    logout: mocks.logout,
    updateUser: mocks.updateUser,
  }),
}))

vi.mock('../lib/api', () => ({
  default: { post: mocks.post, patch: mocks.patch },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

vi.mock('./NotificationProvider', () => ({
  useNotify: () => ({
    error: mocks.error,
    success: mocks.success,
    warning: vi.fn(),
    info: vi.fn(),
    confirm: mocks.confirm,
  }),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))

const admin: User = {
  id: 'u1',
  username: 'admin.uji',
  name: 'Admin NutriLokal',
  role: 'ADMIN',
  mustChangePassword: false,
  createdAt: '2026-01-15T00:00:00.000Z',
}

function renderMenu() {
  return render(<UserMenu />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = { ...admin }
  mocks.confirm.mockResolvedValue(true)
  mocks.patch.mockResolvedValue({
    data: { user: { ...admin, name: 'Nama Baru' } },
  })
  mocks.post.mockResolvedValue({
    data: {
      token: 'token-baru',
      user: { ...admin, name: 'Nama Baru' },
    },
  })
})

describe('menu profil di header', () => {
  it('menampilkan avatar inisial, nama, dan role', () => {
    renderMenu()

    expect(screen.getByRole('img', { name: 'Avatar Admin NutriLokal' })).toHaveTextContent('AN')
    expect(screen.getByRole('button', { name: 'Menu profil Admin NutriLokal' })).toBeInTheDocument()
  })

  it('memakai foto profil bila tersedia', () => {
    mocks.user = { ...admin, photoUrl: '/foto-profil.png' }
    renderMenu()

    expect(screen.getByAltText('Foto profil Admin NutriLokal')).toBeInTheDocument()
  })

  it('membuka dropdown dengan identitas dan tiga menu', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Menu profil Admin NutriLokal' }))

    expect(screen.getByText('Admin NutriLokal')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Profil Saya' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Ubah Password' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Keluar' })).toBeInTheDocument()
  })

  it('menutup dropdown dengan Escape dan klik di luar', async () => {
    const user = userEvent.setup()
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Menu profil Admin NutriLokal' })

    await user.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('menampilkan profil sendiri dan mengubah nama lengkap saja', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Menu profil Admin NutriLokal' }))
    await user.click(screen.getByRole('menuitem', { name: 'Profil Saya' }))

    expect(screen.getByRole('dialog', { name: 'Profil Saya' })).toBeInTheDocument()
    expect(screen.getByText('admin.uji')).toBeInTheDocument()
    expect(screen.getByText('15 Januari 2026')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ubah Nama Lengkap' }))
    const input = screen.getByLabelText('Nama lengkap')
    await user.clear(input)
    await user.type(input, 'Nama Baru')
    await user.click(screen.getByRole('button', { name: 'Simpan Perubahan' }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith('/auth/me', { name: 'Nama Baru' }))
    expect(mocks.updateUser).toHaveBeenCalled()
    expect(mocks.success).toHaveBeenCalled()
  })

  it('memakai endpoint set-password yang sudah ada dan menyimpan token baru', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Menu profil Admin NutriLokal' }))
    await user.click(screen.getByRole('menuitem', { name: 'Ubah Password' }))

    const dialog = screen.getByRole('dialog', { name: 'Ubah Password' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByLabelText('Password saat ini')).toBeInTheDocument()
    expect(screen.getByLabelText('Password baru')).toBeInTheDocument()
    expect(screen.getByLabelText('Konfirmasi password baru')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Password saat ini'), 'lama12345')
    await user.type(screen.getByLabelText('Password baru'), 'baru12345')
    await user.type(screen.getByLabelText('Konfirmasi password baru'), 'baru12345')
    await user.click(screen.getByRole('button', { name: 'Simpan Password Baru' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/auth/set-password', {
        currentPassword: 'lama12345',
        newPassword: 'baru12345',
      }),
    )
    expect(mocks.login).toHaveBeenCalledWith('token-baru', expect.objectContaining({ id: 'u1' }))
    expect(mocks.success).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('menolak konfirmasi kata sandi yang berbeda', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Menu profil Admin NutriLokal' }))
    await user.click(screen.getByRole('menuitem', { name: 'Ubah Password' }))

    await user.type(screen.getByLabelText('Password saat ini'), 'lama12345')
    await user.type(screen.getByLabelText('Password baru'), 'baru12345')
    await user.type(screen.getByLabelText('Konfirmasi password baru'), 'salah12345')
    await user.click(screen.getByRole('button', { name: 'Simpan Password Baru' }))

    expect(mocks.error).toHaveBeenCalledWith('Konfirmasi kata sandi baru tidak sama.')
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('minta konfirmasi sebelum keluar dan membersihkan sesi', async () => {
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Menu profil Admin NutriLokal' }))
    await user.click(screen.getByRole('menuitem', { name: 'Keluar' }))

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }))
    expect(mocks.logout).toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith('/login')
  })

  it('tidak keluar bila konfirmasi dibatalkan', async () => {
    mocks.confirm.mockResolvedValue(false)
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Menu profil Admin NutriLokal' }))
    await user.click(screen.getByRole('menuitem', { name: 'Keluar' }))

    expect(mocks.logout).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('tidak ditampilkan saat pengguna wajib ganti kata sandi', () => {
    mocks.user = { ...admin, mustChangePassword: true }
    renderMenu()

    expect(screen.queryByRole('button', { name: /Menu profil/ })).not.toBeInTheDocument()
  })

  it('menampilkan label Operator sesuai akun yang login', async () => {
    mocks.user = { ...admin, role: 'OPERATOR', name: 'Operator Uji' }
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByRole('button', { name: 'Menu profil Operator Uji' }))

    expect(screen.getByText('Operator')).toBeInTheDocument()
  })
})

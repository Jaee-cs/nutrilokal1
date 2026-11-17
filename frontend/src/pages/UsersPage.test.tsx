import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { NotificationProvider } from '../components/NotificationProvider'
import { UsersPage } from './UsersPage'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
    delete: mocks.del,
  },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

const users = [
  {
    id: 'u-op',
    username: 'operator-baru',
    name: 'Operator Baru',
    role: 'OPERATOR',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastLoginAt: null,
    hasActivityHistory: false,
  },
  {
    id: 'u-op2',
    username: 'operator-lama',
    name: 'Operator Lama',
    role: 'OPERATOR',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    lastLoginAt: null,
    hasActivityHistory: true,
  },
  {
    id: 'u-admin',
    username: 'admin',
    name: 'Administrator',
    role: 'ADMIN',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    lastLoginAt: null,
    hasActivityHistory: true,
  },
]

function renderPage() {
  return render(
    <NotificationProvider>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </NotificationProvider>,
  )
}

function rowFor(username: string): HTMLElement {
  const row = screen
    .getAllByRole('row')
    .find((candidate) => candidate.textContent?.includes(username))
  if (!row) throw new Error(`Baris untuk ${username} tidak ditemukan`)
  return row
}

async function openDeleteConfirmation(username = 'operator-baru') {
  const user = userEvent.setup()
  const buttons = await screen.findAllByRole('button', { name: `Hapus akun ${username}` })
  // Tombol yang sama muncul di tabel desktop dan kartu mobile.
  await user.click(buttons[0])
  const dialog = await screen.findByRole('alertdialog', { name: 'Hapus Akun Operator' })
  return { user, dialog }
}

describe('UsersPage — hapus akun Operator', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
    mocks.del.mockReset()
  })

  it('hanya menampilkan ikon hapus untuk Operator tanpa riwayat', async () => {
    mocks.get.mockResolvedValue({ data: { data: users } })
    renderPage()

    await screen.findAllByText('operator-baru')

    // Desktop dan kartu mobile sama-sama menampilkan tombol hapus.
    expect(
      screen.getAllByRole('button', { name: 'Hapus akun operator-baru' }),
    ).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: 'Hapus akun operator-lama' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Hapus akun admin' }),
    ).not.toBeInTheDocument()

    // Operator dengan riwayat tetap hanya punya dua tombol lama.
    const historyRow = rowFor('operator-lama')
    expect(within(historyRow).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Nonaktifkan',
      'Reset Password',
    ])

    // Admin tidak memiliki opsi hapus dan tombolnya tetap nonaktif.
    const adminRow = rowFor('admin')
    const adminButtons = within(adminRow).getAllByRole('button')
    expect(adminButtons.map((button) => button.textContent)).toEqual([
      'Nonaktifkan',
      'Reset Password',
    ])
    expect(adminButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
  })

  it('menampilkan identitas akun dan pembatalan tidak memanggil API', async () => {
    mocks.get.mockResolvedValue({ data: { data: users } })
    renderPage()
    await screen.findAllByText('operator-baru')

    const { user, dialog } = await openDeleteConfirmation()

    expect(within(dialog).getByText('operator-baru')).toBeInTheDocument()
    expect(within(dialog).getByText('Operator Baru')).toBeInTheDocument()
    expect(within(dialog).getByText(/permanen/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Batal' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Hapus Akun' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Batal' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(mocks.del).not.toHaveBeenCalled()
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it('menghapus akun tanpa riwayat dan memperbarui daftar tanpa reload', async () => {
    mocks.get
      .mockResolvedValueOnce({ data: { data: users } })
      .mockResolvedValueOnce({
        data: { data: users.filter((item) => item.id !== 'u-op') },
      })
    renderPage()
    await screen.findAllByText('operator-baru')

    const { user, dialog } = await openDeleteConfirmation()
    await user.click(within(dialog).getByRole('button', { name: 'Hapus Akun' }))

    await waitFor(() => {
      expect(mocks.del).toHaveBeenCalledWith('/users/u-op')
    })
    await waitFor(() => {
      expect(screen.queryAllByText('operator-baru')).toHaveLength(0)
    })
    expect(mocks.get).toHaveBeenCalledTimes(2)
    expect(
      await screen.findByText('Akun "operator-baru" berhasil dihapus'),
    ).toBeInTheDocument()
  })

  it('menampilkan penolakan backend bila akun ternyata memiliki riwayat', async () => {
    mocks.get.mockResolvedValue({ data: { data: users } })
    mocks.del.mockRejectedValue({
      response: {
        status: 409,
        data: {
          message:
            'Akun memiliki riwayat aktivitas dan tidak boleh dihapus permanen. Nonaktifkan akun sebagai gantinya.',
        },
      },
    })
    renderPage()
    await screen.findAllByText('operator-baru')

    const { user, dialog } = await openDeleteConfirmation()
    await user.click(within(dialog).getByRole('button', { name: 'Hapus Akun' }))

    expect(
      await screen.findByText(/Akun memiliki riwayat aktivitas dan tidak boleh dihapus permanen/),
    ).toBeInTheDocument()
    // Akun tetap tampil; daftar disegarkan agar tombol menyesuaikan server.
    expect(screen.getAllByText('operator-baru').length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledTimes(2)
    })
  })
})

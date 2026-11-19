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

async function openArchiveConfirmation(username = 'operator-baru') {
  const user = userEvent.setup()
  const buttons = await screen.findAllByRole('button', { name: `Arsipkan akun ${username}` })
  // Tombol yang sama muncul di tabel desktop dan kartu mobile.
  await user.click(buttons[0])
  const dialog = await screen.findByRole('alertdialog', { name: 'Arsipkan Akun Operator' })
  return { user, dialog }
}

/** Balas daftar pengguna dan ringkasan arsip sesuai URL yang diminta. */
function mockGetUsers(list = users) {
  mocks.get.mockImplementation((url: string) =>
    Promise.resolve(
      url === '/archive/summary'
        ? { data: { data: { products: 0, materials: 0, users: 0 } } }
        : { data: { data: list } },
    ),
  )
}

describe('UsersPage — arsip akun Operator', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
    mocks.del.mockReset()
  })

  it('menampilkan ikon arsip untuk semua Operator, bukan untuk Admin', async () => {
    mockGetUsers()
    renderPage()

    await screen.findAllByText('operator-baru')

    // Desktop dan kartu mobile sama-sama menampilkan tombol arsip.
    expect(
      screen.getAllByRole('button', { name: 'Arsipkan akun operator-baru' }),
    ).toHaveLength(2)
    // Riwayat aktivitas tidak menghalangi pengarsipan.
    expect(
      screen.getAllByRole('button', { name: 'Arsipkan akun operator-lama' }),
    ).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: 'Arsipkan akun admin' }),
    ).not.toBeInTheDocument()

    const historyRow = rowFor('operator-lama')
    expect(
      within(historyRow).getByRole('button', { name: 'Arsipkan akun operator-lama' }),
    ).toBeInTheDocument()

    // Admin tidak memiliki opsi arsip dan tombolnya tetap nonaktif.
    const adminRow = rowFor('admin')
    const adminButtons = within(adminRow).getAllByRole('button')
    expect(adminButtons.map((button) => button.textContent)).toEqual([
      'Nonaktifkan',
      'Reset Password',
    ])
    expect(adminButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
  })

  it('menampilkan identitas akun dan pembatalan tidak memanggil API', async () => {
    mockGetUsers()
    renderPage()
    await screen.findAllByText('operator-baru')

    const { user, dialog } = await openArchiveConfirmation()

    expect(within(dialog).getByText('operator-baru')).toBeInTheDocument()
    expect(within(dialog).getByText('Operator Baru')).toBeInTheDocument()
    expect(within(dialog).getByText(/dicabut/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Batal' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Ya, Arsipkan' })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Batal' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(mocks.del).not.toHaveBeenCalled()
    // Satu panggilan daftar pengguna + satu panggilan ringkasan arsip.
    expect(mocks.get).toHaveBeenCalledTimes(2)
  })

  it('mengarsipkan akun dan memperbarui daftar tanpa reload', async () => {
    let remaining = [...users]
    mockGetUsers()
    mocks.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/archive/summary'
          ? { data: { data: { products: 0, materials: 0, users: 0 } } }
          : { data: { data: remaining } },
      ),
    )
    mocks.del.mockImplementation(() => {
      remaining = users.filter((item) => item.id !== 'u-op')
      return Promise.resolve({
        data: { message: 'Akun "operator-baru" diarsipkan. Riwayat aktivitas tetap tersimpan.' },
      })
    })
    renderPage()
    await screen.findAllByText('operator-baru')

    const { user, dialog } = await openArchiveConfirmation()
    await user.click(within(dialog).getByRole('button', { name: 'Ya, Arsipkan' }))

    await waitFor(() => {
      expect(mocks.del).toHaveBeenCalledWith('/users/u-op')
    })
    await waitFor(() => {
      expect(screen.queryAllByText('operator-baru')).toHaveLength(0)
    })
    expect(
      await screen.findByText(/berhasil diarsipkan|diarsipkan\. Riwayat/i),
    ).toBeInTheDocument()
  })

  it('menampilkan penolakan backend saat pengarsipan gagal', async () => {
    mockGetUsers()
    mocks.del.mockRejectedValue({
      response: {
        status: 400,
        data: { message: 'Akun Anda sendiri tidak dapat diarsipkan.' },
      },
    })
    renderPage()
    await screen.findAllByText('operator-baru')

    const { user, dialog } = await openArchiveConfirmation()
    await user.click(within(dialog).getByRole('button', { name: 'Ya, Arsipkan' }))

    expect(
      await screen.findByText(/Akun Anda sendiri tidak dapat diarsipkan/),
    ).toBeInTheDocument()
    // Akun tetap tampil; daftar disegarkan agar tombol menyesuaikan server.
    expect(screen.getAllByText('operator-baru').length).toBeGreaterThan(0)
    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalled()
    })
  })
})

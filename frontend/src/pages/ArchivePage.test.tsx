import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { NotificationProvider } from '../components/NotificationProvider'
import { ArchivePage } from './ArchivePage'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }))
const authState = vi.hoisted(() => ({ role: 'ADMIN' as 'ADMIN' | 'OPERATOR' }))

vi.mock('../lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, delete: mocks.delete },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin-1', username: 'admin', role: authState.role } }),
}))

const archivedProduct = {
  id: 'p-arsip',
  name: 'Keripik Arsip',
  unit: 'pcs',
  sellingPrice: 15000,
  stock: 4,
  batchCount: 1,
  isActive: false,
  recipe: [],
  nutrition: null,
  archivedAt: '2026-11-18T02:15:00.000Z',
  archivedById: 'admin-1',
  archivedByName: 'Admin Utama',
  archiveReason: 'Tidak diproduksi lagi',
}

const olderProduct = {
  ...archivedProduct,
  id: 'p-arsip-lama',
  name: 'Keripik Lama',
  archivedAt: '2026-11-01T02:15:00.000Z',
}

const archivedMaterial = {
  id: 'm-arsip',
  name: 'Tepung Arsip',
  unit: 'kg',
  stock: 2,
  isManual: false,
  isActive: false,
  archivedAt: '2026-11-17T02:15:00.000Z',
  archivedById: 'admin-1',
  archivedByName: 'Admin Utama',
  archiveReason: 'Tidak dipakai',
}

const archivedUser = {
  id: 'u-arsip',
  username: 'operator.arsip',
  name: 'Operator Arsip',
  role: 'OPERATOR',
  hasActivityHistory: false,
  lastLoginAt: null,
  isActive: false,
  archivedAt: '2026-11-16T02:15:00.000Z',
  archivedById: 'admin-1',
  archivedByName: 'Admin Utama',
  archiveReason: 'Account lama',
}

function renderPage() {
  return render(
    <NotificationProvider>
      <MemoryRouter>
        <ArchivePage />
      </MemoryRouter>
    </NotificationProvider>,
  )
}

/** Tombol aksi per baris pada dua representasi yang dipilih CSS (desktop/mobile). */
function actionButtonsPerRow(view: 'desktop' | 'mobile'): string[][] {
  const container = document.querySelector(view === 'desktop' ? '.desktop-table' : '.mobile-list')
  if (!container) throw new Error(`Kontainer ${view} tidak ditemukan`)
  const rows = Array.from(
    view === 'desktop'
      ? container.querySelectorAll('tbody tr')
      : container.querySelectorAll('.archive-card'),
  )
  return rows.map((row) =>
    Array.from(row.querySelectorAll('.archive-actions button')).map(
      (button) => button.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    ),
  )
}

function mockApi() {
  mocks.get.mockImplementation((url: string) => {
    if (url === '/archive/summary') {
      return Promise.resolve({ data: { data: { products: 1, materials: 2, users: 3 } } })
    }
    if (url === '/archive/products') {
      return Promise.resolve({
        data: {
          data: [archivedProduct, olderProduct],
          meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
        },
      })
    }
    if (url === '/archive/materials') {
      return Promise.resolve({
        data: {
          data: [archivedMaterial],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      })
    }
    if (url === '/archive/users') {
      return Promise.resolve({
        data: {
          data: [archivedUser],
          meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      })
    }
    if (url === '/archive/products/p-arsip') {
      return Promise.resolve({ data: { product: archivedProduct } })
    }
    if (url === '/archive/materials/m-arsip') {
      return Promise.resolve({ data: { material: archivedMaterial } })
    }
    if (url === '/archive/users/u-arsip') {
      return Promise.resolve({ data: { user: archivedUser } })
    }
    return Promise.resolve({ data: { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } })
  })
  mocks.post.mockResolvedValue({ data: { message: 'Data berhasil dipulihkan.' } })
  mocks.delete.mockResolvedValue({ data: { message: 'Produk berhasil dihapus permanen dari Arsip.' } })
}

describe('ArchivePage — halaman Arsip Admin', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.delete.mockReset()
    authState.role = 'ADMIN'
    mockApi()
  })

  it('menampilkan tiga tab master dengan tiga aksi pada produk', async () => {
    renderPage()

    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Produk (1)',
      'Bahan Baku (2)',
      'Akun Pengguna (3)',
    ])
    expect(screen.queryByRole('tab', { name: /Lainnya/i })).not.toBeInTheDocument()

    expect((await screen.findAllByText('Keripik Arsip')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Admin Utama').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tidak diproduksi lagi').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Pulihkan/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Hapus' }).length).toBeGreaterThan(0)
  })

  it('menampilkan detail arsip beserta stok, alasan, dan Admin', async () => {
    const user = userEvent.setup()
    renderPage()

    const [detailButton] = await screen.findAllByRole('button', { name: /Detail/ })
    await user.click(detailButton)

    const dialog = await screen.findByRole('dialog', { name: /Detail Produk: Keripik Arsip/ })
    expect(within(dialog).getByText('p-arsip')).toBeInTheDocument()
    expect(within(dialog).getByText('15.000')).toBeInTheDocument()
    expect(within(dialog).getByText('4 pcs')).toBeInTheDocument()
    expect(within(dialog).getByText('Admin Utama')).toBeInTheDocument()
    expect(mocks.get).toHaveBeenCalledWith('/archive/products/p-arsip')
  })

  it('memulihkan data setelah konfirmasi tanpa menghapus baris', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Keripik Arsip')

    const [restoreButton] = screen.getAllByRole('button', { name: /Pulihkan/ })
    await user.click(restoreButton)

    const dialog = await screen.findByRole('alertdialog', { name: 'Pulihkan Data' })
    expect(within(dialog).getByText(/ID dan riwayat yang tidak berubah/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Ya, Pulihkan' }))

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('/archive/products/p-arsip/restore')
    })
    expect(await screen.findByText('Data berhasil dipulihkan.')).toBeInTheDocument()
  })

  it('memuat seluruh arsip tanpa filter dan menampilkan terbaru lebih dulu', async () => {
    renderPage()
    await screen.findAllByText('Keripik Arsip')

    expect(mocks.get).toHaveBeenCalledWith('/archive/products', {
      params: { page: 1, pageSize: 20 },
    })
    expect(screen.queryByLabelText('Pencarian')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cari/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Tanggal arsip dari/)).not.toBeInTheDocument()
    expect(screen.getByText(/terbaru ke terlama/)).toBeInTheDocument()

    const dataRows = screen
      .getAllByRole('row')
      .filter((row) => row.textContent?.includes('ID: p-arsip'))
    expect(dataRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Keripik Arsip'),
      expect.stringContaining('Keripik Lama'),
    ])
  })

  it('detail produk arsip menyediakan Detail, Pulihkan, dan Hapus', async () => {
    const user = userEvent.setup()
    renderPage()

    const [detailButton] = await screen.findAllByRole('button', { name: /Detail/ })
    await user.click(detailButton)

    const dialog = await screen.findByRole('dialog', { name: /Detail Produk: Keripik Arsip/ })
    expect(within(dialog).getAllByRole('button', { name: 'Tutup' }).length).toBeGreaterThan(0)
    expect(within(dialog).getByRole('button', { name: /Pulihkan/ })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Hapus' })).toBeInTheDocument()
  })

  it('Hapus memakai konfirmasi danger bermama produk dan hanya jalan setelah disetujui', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Keripik Arsip')

    const [deleteButton] = screen.getAllByRole('button', { name: 'Hapus' })
    await user.click(deleteButton)

    const dialog = await screen.findByRole('alertdialog', { name: 'Hapus Permanen Produk' })
    expect(within(dialog).getAllByText(/Keripik Arsip/).length).toBeGreaterThan(0)
    expect(within(dialog).getByText(/bersifat permanen/i)).toBeInTheDocument()
    expect(within(dialog).getByText(/dibatalkan dan produk tetap tersimpan di Arsip/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Batal' }))
    expect(mocks.delete).not.toHaveBeenCalled()

    await user.click(screen.getAllByRole('button', { name: 'Hapus' })[0])
    const dialog2 = await screen.findByRole('alertdialog', { name: 'Hapus Permanen Produk' })
    await user.click(within(dialog2).getByRole('button', { name: 'Hapus Permanen' }))

    await waitFor(() => {
      expect(mocks.delete).toHaveBeenCalledWith('/archive/products/p-arsip')
    })
    expect(await screen.findByText('Produk berhasil dihapus permanen dari Arsip.')).toBeInTheDocument()
  })

  it('menampilkan alasan penolakan backend dan menyatakan produk tetap di Arsip', async () => {
    mocks.delete.mockRejectedValueOnce({
      response: {
        data: {
          message:
            'Produk tidak dapat dihapus karena masih memiliki riwayat produksi (1), stok tersisa (1). Data tetap tersimpan di Arsip.',
        },
      },
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Keripik Arsip')

    await user.click(screen.getAllByRole('button', { name: 'Hapus' })[0])
    const dialog = await screen.findByRole('alertdialog', { name: 'Hapus Permanen Produk' })
    await user.click(within(dialog).getByRole('button', { name: 'Hapus Permanen' }))

    expect(await screen.findByText('Penghapusan Ditolak')).toBeInTheDocument()
    expect(await screen.findByText(/masih memiliki riwayat produksi \(1\), stok tersisa \(1\)/i)).toBeInTheDocument()
  })

  it('Hapus bahan baku memakai endpoint dan konfirmasi sesuai kategori', async () => {
    mocks.delete.mockResolvedValueOnce({
      data: { message: 'Bahan baku berhasil dihapus permanen dari Arsip.' },
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Keripik Arsip')
    await user.click(await screen.findByRole('tab', { name: /Bahan Baku/ }))
    await screen.findAllByText('Tepung Arsip')

    await user.click(screen.getAllByRole('button', { name: 'Hapus' })[0])
    const dialog = await screen.findByRole('alertdialog', { name: 'Hapus Permanen Bahan Baku' })
    expect(within(dialog).getAllByText(/Tepung Arsip/).length).toBeGreaterThan(0)
    expect(within(dialog).getByText(/bersifat permanen/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Hapus Permanen' }))

    await waitFor(() => {
      expect(mocks.delete).toHaveBeenCalledWith('/archive/materials/m-arsip')
    })
    expect(
      await screen.findByText('Bahan baku berhasil dihapus permanen dari Arsip.')
    ).toBeInTheDocument()
  })

  it('Hapus akun memakai endpoint dan konfirmasi sesuai kategori', async () => {
    mocks.delete.mockResolvedValueOnce({
      data: { message: 'Akun berhasil dihapus permanen dari Arsip.' },
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Keripik Arsip')
    await user.click(await screen.findByRole('tab', { name: /Akun Pengguna/ }))
    await screen.findAllByText('operator.arsip')

    await user.click(screen.getAllByRole('button', { name: 'Hapus' })[0])
    const dialog = await screen.findByRole('alertdialog', { name: 'Hapus Permanen Akun Pengguna' })
    expect(within(dialog).getAllByText(/operator\.arsip/).length).toBeGreaterThan(0)
    expect(within(dialog).getByText(/bersifat permanen/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Hapus Permanen' }))

    await waitFor(() => {
      expect(mocks.delete).toHaveBeenCalledWith('/archive/users/u-arsip')
    })
    expect(await screen.findByText('Akun berhasil dihapus permanen dari Arsip.')).toBeInTheDocument()
  })

  it('penolakan hapus akun menampilkan alasan backend tanpa menghapus data', async () => {
    mocks.delete.mockRejectedValueOnce({
      response: {
        data: {
          message:
            'Akun tidak dapat dihapus karena masih memiliki riwayat transaksi (2). Data tetap tersimpan di Arsip.',
        },
      },
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Keripik Arsip')
    await user.click(await screen.findByRole('tab', { name: /Akun Pengguna/ }))
    await screen.findAllByText('operator.arsip')

    await user.click(screen.getAllByRole('button', { name: 'Hapus' })[0])
    const dialog = await screen.findByRole('alertdialog', { name: 'Hapus Permanen Akun Pengguna' })
    await user.click(within(dialog).getByRole('button', { name: 'Hapus Permanen' }))

    expect(await screen.findByText('Penghapusan Ditolak')).toBeInTheDocument()
    expect(await screen.findByText(/masih memiliki riwayat transaksi \(2\)/i)).toBeInTheDocument()
  })

  it('Produk: tiga aksi tampil di tabel desktop dan kartu mobile', async () => {
    renderPage()
    await screen.findAllByText('Keripik Arsip')

    const expected = [
      ['Detail', 'Pulihkan', 'Hapus'],
      ['Detail', 'Pulihkan', 'Hapus'],
    ]
    expect(actionButtonsPerRow('desktop')).toEqual(expected)
    expect(actionButtonsPerRow('mobile')).toEqual(expected)
  })

  it('Bahan Baku: tiga aksi tampil di tabel desktop dan kartu mobile', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Keripik Arsip')

    await user.click(await screen.findByRole('tab', { name: /Bahan Baku/ }))
    await screen.findAllByText('Tepung Arsip')

    const expected = [['Detail', 'Pulihkan', 'Hapus']]
    expect(actionButtonsPerRow('desktop')).toEqual(expected)
    expect(actionButtonsPerRow('mobile')).toEqual(expected)
  })

  it('Akun Pengguna: tiga aksi tampil di tabel desktop dan kartu mobile', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Keripik Arsip')

    await user.click(await screen.findByRole('tab', { name: /Akun Pengguna/ }))
    await screen.findAllByText('operator.arsip')

    const expected = [['Detail', 'Pulihkan', 'Hapus']]
    expect(actionButtonsPerRow('desktop')).toEqual(expected)
    expect(actionButtonsPerRow('mobile')).toEqual(expected)
  })

  it('modal detail memiliki tiga aksi pada semua kategori', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByText('Keripik Arsip')

    await user.click(screen.getAllByRole('button', { name: 'Detail' })[0])
    let dialog = await screen.findByRole('dialog', { name: /Detail Produk: Keripik Arsip/ })
    expect(within(dialog).getByRole('button', { name: 'Hapus' })).toBeInTheDocument()
    await user.click(within(dialog).getAllByRole('button', { name: 'Tutup' })[0])

    await user.click(await screen.findByRole('tab', { name: /Bahan Baku/ }))
    await screen.findAllByText('Tepung Arsip')
    await user.click(screen.getAllByRole('button', { name: 'Detail' })[0])
    dialog = await screen.findByRole('dialog', { name: /Detail Bahan Baku: Tepung Arsip/ })
    expect(within(dialog).getByRole('button', { name: 'Hapus' })).toBeInTheDocument()
    await user.click(within(dialog).getAllByRole('button', { name: 'Tutup' })[0])

    await user.click(await screen.findByRole('tab', { name: /Akun Pengguna/ }))
    await screen.findAllByText('operator.arsip')
    await user.click(screen.getAllByRole('button', { name: 'Detail' })[0])
    dialog = await screen.findByRole('dialog', { name: /Detail Akun Pengguna: operator.arsip/ })
    expect(within(dialog).getByRole('button', { name: 'Hapus' })).toBeInTheDocument()
  })

  it('Operator tidak melihat tombol Hapus pada produk arsip', async () => {
    authState.role = 'OPERATOR'
    renderPage()
    await screen.findAllByText('Keripik Arsip')

    expect(screen.queryByRole('button', { name: 'Hapus' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Pulihkan/ }).length).toBeGreaterThan(0)
  })
})

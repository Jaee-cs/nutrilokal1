import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { NotificationProvider } from '../components/NotificationProvider'
import { ArchivePage } from './ArchivePage'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('../lib/api', () => ({
  default: { get: mocks.get, post: mocks.post },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
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

function renderPage() {
  return render(
    <NotificationProvider>
      <MemoryRouter>
        <ArchivePage />
      </MemoryRouter>
    </NotificationProvider>,
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
    if (url === '/archive/products/p-arsip') {
      return Promise.resolve({ data: { product: archivedProduct } })
    }
    return Promise.resolve({ data: { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } })
  })
  mocks.post.mockResolvedValue({ data: { message: 'Data berhasil dipulihkan.' } })
}

describe('ArchivePage — halaman Arsip Admin', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mockApi()
  })

  it('menampilkan tiga tab master tanpa tab Lainnya dan tanpa aksi hapus', async () => {
    renderPage()

    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Produk (1)',
      'Bahan Baku (2)',
      'Akun Pengguna (3)',
    ])
    expect(screen.queryByRole('tab', { name: /Lainnya/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hapus Permanen/i })).not.toBeInTheDocument()

    expect((await screen.findAllByText('Keripik Arsip')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Admin Utama').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tidak diproduksi lagi').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Pulihkan/ }).length).toBeGreaterThan(0)
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
})

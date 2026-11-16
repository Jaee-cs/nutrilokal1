import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaterialsPage } from './MaterialsPage'

const mocks = vi.hoisted(() => ({
  role: 'ADMIN' as 'ADMIN' | 'OPERATOR',
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    confirm: vi.fn(),
  },
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'admin', name: 'Admin Uji', role: mocks.role },
  }),
}))

vi.mock('../components/NotificationProvider', () => ({
  useNotify: () => mocks.notify,
}))

vi.mock('../lib/api', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
    patch: mocks.patch,
    delete: mocks.delete,
  },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

const material = {
  id: 'm1',
  name: 'Sapi Segar',
  unit: 'kg',
  description: 'Daging sapi',
  stock: 12,
  isActive: true,
}

function mockMaterials() {
  mocks.get.mockImplementation((url: string) => {
    if (url === '/materials') {
      return Promise.resolve({ data: { data: [material] } })
    }
    return Promise.reject(new Error(`URL tidak di-mock: ${url}`))
  })
}

describe('MaterialsPage — modal dan aksi per bahan', () => {
  beforeEach(() => {
    mocks.role = 'ADMIN'
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
    mocks.delete.mockReset()
    Object.values(mocks.notify).forEach((fn) => fn.mockReset())
    mocks.notify.confirm.mockResolvedValue(false)
    mockMaterials()
  })

  it('menghapus navigasi tab dan menampilkan aksi bahan di daftar', async () => {
    render(<MaterialsPage />)

    expect((await screen.findAllByText('Sapi Segar')).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Daftar Bahan Baku' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Tambah Bahan' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Tambah Stok' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Penyesuaian stok Sapi Segar' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Hapus bahan baku Sapi Segar' }).length).toBeGreaterThan(0)
  })

  it('membuka form tambah bahan sebagai modal terpusat', async () => {
    const user = userEvent.setup()
    render(<MaterialsPage />)

    await user.click(await screen.findByRole('button', { name: 'Tambah Bahan' }))

    const dialog = screen.getByRole('dialog', { name: 'Tambah Bahan Baku' })
    expect(within(dialog).getByLabelText('Nama Bahan')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Satuan Dasar')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Deskripsi (opsional)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Catat saldo awal sekaligus (opsional)')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Tambah Bahan Baku' })).not.toBeInTheDocument()
  })

  it('membuka modal penerimaan dengan bahan yang dipilih sudah terisi', async () => {
    const user = userEvent.setup()
    render(<MaterialsPage />)

    const [stockButton] = await screen.findAllByRole('button', { name: 'Tambah Stok' })
    await user.click(stockButton)

    const dialog = screen.getByRole('dialog', { name: 'Tambah Stok Bahan Baku' })
    expect(within(dialog).getByLabelText('Bahan Baku')).toHaveValue('m1')
    expect(within(dialog).getByLabelText('Jumlah')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Tanggal Penerimaan (opsional)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Catatan (opsional)')).toBeInTheDocument()
  })

  it('membuka modal penyesuaian stok dengan bahan yang dipilih sudah terisi', async () => {
    const user = userEvent.setup()
    render(<MaterialsPage />)

    const [adjustButton] = await screen.findAllByRole('button', { name: 'Penyesuaian stok Sapi Segar' })
    await user.click(adjustButton)

    const dialog = screen.getByRole('dialog', { name: 'Penyesuaian Stok' })
    expect(within(dialog).getByLabelText('Bahan Baku')).toHaveValue('m1')
    expect(within(dialog).getByLabelText('Jumlah (bertanda)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Alasan')).toBeInTheDocument()
    expect(within(dialog).getByText(/Stok Sapi Segar saat ini: 12 kg/)).toBeInTheDocument()
  })

  it('tetap memakai konfirmasi terpusat sebelum menghapus bahan', async () => {
    const user = userEvent.setup()
    render(<MaterialsPage />)

    const [deleteButton] = await screen.findAllByRole('button', { name: 'Hapus bahan baku Sapi Segar' })
    await user.click(deleteButton)

    expect(mocks.notify.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Hapus Bahan Baku',
        tone: 'danger',
        confirmLabel: 'Ya, Hapus',
      }),
    )
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('Operator tetap dapat menambah stok tetapi tidak melihat aksi Admin', async () => {
    mocks.role = 'OPERATOR'
    render(<MaterialsPage />)

    expect((await screen.findAllByText('Sapi Segar')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Tambah Bahan' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Tambah Stok' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Penyesuaian stok Sapi Segar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hapus bahan baku Sapi Segar' })).not.toBeInTheDocument()
  })
})

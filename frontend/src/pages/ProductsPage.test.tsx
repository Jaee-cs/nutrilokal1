import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductsPage } from './ProductsPage'

const mocks = vi.hoisted(() => ({
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
    user: { id: 'u1', username: 'admin', name: 'Admin Uji', role: 'ADMIN' },
  }),
}))

vi.mock('../components/NotificationProvider', () => ({
  useNotify: () => mocks.notify,
}))

vi.mock('../lib/api', () => ({
  default: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

const product = {
  id: 'p1',
  name: 'Keripik Uji',
  unit: 'pcs',
  sellingPrice: 12000,
  stock: 8,
  batchCount: 2,
  isActive: true,
}

const batches = [
  { id: 'b1', code: 'NL-20261031-001', stock: 6 },
  { id: 'b2', code: 'NL-20261031-002', stock: 2 },
]

const movements = [
  {
    id: 'm1',
    product: { id: 'p1', name: 'Keripik Uji', unit: 'pcs' },
    batch: { id: 'b1', code: 'NL-20261031-001', currentStock: 6 },
    type: 'SALE',
    quantity: -2,
    stockIn: 0,
    stockOut: 2,
    balanceAfter: 6,
    batchBalanceAfter: 6,
    occurredAt: '2026-10-31T03:00:00.000Z',
    recordedAt: '2026-10-31T03:00:00.000Z',
    recordedBy: { id: 'u2', username: 'operator', name: 'Operator Uji' },
    reason: 'Penjualan kasir',
    reference: { kind: 'SALE', id: 'sale1', label: 'Penjualan #SALE0001' },
    sourceId: 'alloc1',
    isHistoricalFallback: false,
  },
  {
    id: 'historical-opening:b2',
    product: { id: 'p1', name: 'Keripik Uji', unit: 'pcs' },
    batch: { id: 'b2', code: 'NL-20261031-002', currentStock: 2 },
    type: 'OPENING_BALANCE',
    quantity: 2,
    stockIn: 2,
    stockOut: 0,
    balanceAfter: 8,
    batchBalanceAfter: 2,
    occurredAt: '2026-10-30T23:59:59.999Z',
    recordedAt: '2026-10-30T23:59:59.999Z',
    recordedBy: null,
    reason: 'Saldo Awal (Riwayat Sebelumnya Tidak Tersedia)',
    reference: null,
    sourceId: null,
    isHistoricalFallback: true,
  },
]

const summary = {
  movementCount: 2,
  totalIn: 2,
  totalOut: 2,
  currentStock: 8,
  reconstructedStock: 8,
  consistent: true,
  hasHistoricalFallback: true,
}

const emptySummary = {
  movementCount: 0,
  totalIn: 0,
  totalOut: 0,
  currentStock: 8,
  reconstructedStock: 8,
  consistent: true,
  hasHistoricalFallback: false,
}

function mockApi() {
  mocks.get.mockImplementation((url: string, config?: { params?: Record<string, string> }) => {
    if (url === '/products') {
      return Promise.resolve({ data: { data: [product] } })
    }
    if (url === '/materials') {
      return Promise.resolve({ data: { data: [] } })
    }
    if (url === '/batches') {
      return Promise.resolve({ data: { data: batches } })
    }
    if (url === '/products/p1/stock-movements') {
      if (config?.params?.type === 'PRODUCTION_YIELD') {
        return Promise.resolve({ data: { data: [], summary: emptySummary } })
      }
      return Promise.resolve({ data: { data: movements, summary } })
    }
    return Promise.reject(new Error(`URL tidak di-mock: ${url}`))
  })
}

async function selectProduct() {
  const user = userEvent.setup()
  await screen.findByRole('option', { name: 'Keripik Uji (pcs)' })
  await user.selectOptions(screen.getByLabelText('Produk'), 'p1')
  await screen.findByRole('table')
  return user
}

describe('ProductsPage — modal tambah produk', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
    mocks.delete.mockReset()
    Object.values(mocks.notify).forEach((fn) => fn.mockReset())
    mockApi()
    mocks.post.mockResolvedValue({ data: { product: { ...product, id: 'p-new' } } })
    mocks.patch.mockResolvedValue({ data: { product } })
  })

  it('menampilkan form tambah produk sebagai dialog terpusat dengan seluruh isian', async () => {
    render(<ProductsPage />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /Tambah Produk/ }))

    const dialog = screen.getByRole('dialog', { name: 'Tambah Produk' })
    expect(within(dialog).getByLabelText('Nama Produk')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Satuan Dasar')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Harga Jual (Rp)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Foto Produk (opsional)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Deskripsi (opsional)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Komposisi (opsional)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Petunjuk Penyimpanan (opsional)')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Batal' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Simpan Produk' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Tutup dialog produk' })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('kartu produk menampilkan Arsipkan dan Hapus, bukan Nonaktifkan', async () => {
    render(<ProductsPage />)

    expect(await screen.findByRole('button', { name: 'Arsipkan Keripik Uji' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hapus Keripik Uji' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Nonaktifkan/ })).not.toBeInTheDocument()
  })

  it('Arsipkan menampilkan konfirmasi bermama produk dan hanya berjalan setelah disetujui', async () => {
    render(<ProductsPage />)
    const user = userEvent.setup()
    mocks.notify.confirm.mockResolvedValueOnce(false)

    await user.click(await screen.findByRole('button', { name: 'Arsipkan Keripik Uji' }))
    expect(mocks.notify.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Arsipkan Produk',
        confirmLabel: 'Ya, Arsipkan',
        message: expect.stringContaining('Keripik Uji'),
      })
    )
    expect(mocks.delete).not.toHaveBeenCalled()

    mocks.notify.confirm.mockResolvedValueOnce(true)
    mocks.delete.mockResolvedValueOnce({ data: { message: 'Produk diarsipkan.' } })
    await user.click(screen.getByRole('button', { name: 'Arsipkan Keripik Uji' }))

    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('/products/p1'))
    expect(mocks.notify.success).toHaveBeenCalledWith('Produk diarsipkan.')
  })

  it('Hapus memakai konfirmasi danger, menyebut nama produk, dan memanggil endpoint permanen', async () => {
    render(<ProductsPage />)
    const user = userEvent.setup()
    mocks.notify.confirm.mockResolvedValueOnce(false)

    await user.click(await screen.findByRole('button', { name: 'Hapus Keripik Uji' }))
    expect(mocks.notify.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Hapus Permanen Produk',
        tone: 'danger',
        confirmLabel: 'Hapus Permanen',
        cancelLabel: 'Batal',
        message: expect.stringContaining('Keripik Uji'),
      })
    )
    expect(mocks.delete).not.toHaveBeenCalled()

    mocks.notify.confirm.mockResolvedValueOnce(true)
    mocks.delete.mockResolvedValueOnce({ data: { message: 'Produk berhasil dihapus permanen.' } })
    await user.click(screen.getByRole('button', { name: 'Hapus Keripik Uji' }))

    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('/products/p1/permanent'))
    expect(mocks.notify.success).toHaveBeenCalledWith('Produk berhasil dihapus permanen.')
  })

  it('Hapus menampilkan alasan penolakan backend tanpa menghapus data', async () => {
    render(<ProductsPage />)
    const user = userEvent.setup()
    mocks.notify.confirm.mockResolvedValueOnce(true)
    mocks.delete.mockRejectedValueOnce({
      response: {
        data: {
          message:
            'Produk tidak dapat dihapus karena masih memiliki riwayat produksi (1). Gunakan Arsipkan bila produk masih diperlukan.',
        },
      },
    })

    await user.click(await screen.findByRole('button', { name: 'Hapus Keripik Uji' }))
    await waitFor(() => expect(mocks.notify.error).toHaveBeenCalled())
    expect(mocks.notify.error).toHaveBeenCalledWith(
      expect.stringContaining('riwayat produksi'),
      'Penghapusan Ditolak'
    )
  })

  it('Admin menyimpan satu komponen nilai gizi dalam bentuk lama tanpa nama komponen', async () => {
    render(<ProductsPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Tambah Produk/ }))
    const dialog = screen.getByRole('dialog', { name: 'Tambah Produk' })

    await user.type(within(dialog).getByLabelText('Nama Produk'), 'Produk Gizi')
    await user.type(within(dialog).getByLabelText('Satuan Dasar'), 'pcs')
    await user.type(within(dialog).getByLabelText('Harga Jual (Rp)'), '10000')
    await user.click(within(dialog).getByRole('button', { name: /Informasi Nilai Gizi/ }))

    expect(within(dialog).queryByLabelText('Nama Komponen')).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('Takaran Saji'), '30')
    await user.type(within(dialog).getByLabelText('Satuan takaran saji komponen 1'), 'g')
    await user.type(within(dialog).getByLabelText('Jumlah Sajian per Kemasan'), '4')
    await user.type(within(dialog).getAllByLabelText('Jumlah')[0], '120')
    await user.click(within(dialog).getByRole('button', { name: 'Simpan Produk' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    const payload = mocks.post.mock.calls[0][1]
    expect(payload.nutrition.sections).toBeUndefined()
    expect(payload.nutrition).toMatchObject({
      servingSizeAmount: 30,
      servingSizeUnit: 'g',
      servingsPerPackage: 4,
      components: [expect.objectContaining({ name: 'Energi Total', amount: 120 })],
    })
  })

  it('Admin menambah dua komponen kemasan dan menyimpan datanya secara terpisah', async () => {
    render(<ProductsPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Tambah Produk/ }))
    const dialog = screen.getByRole('dialog', { name: 'Tambah Produk' })

    await user.type(within(dialog).getByLabelText('Nama Produk'), 'NUGALOE')
    await user.type(within(dialog).getByLabelText('Satuan Dasar'), 'pcs')
    await user.type(within(dialog).getByLabelText('Harga Jual (Rp)'), '15000')
    await user.click(within(dialog).getByRole('button', { name: /Informasi Nilai Gizi/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Tambah Komponen' }))

    const names = within(dialog).getAllByLabelText('Nama Komponen')
    expect(names).toHaveLength(2)
    await user.type(names[0], 'NUGALOE — Nugget Lele')
    await user.type(names[1], 'ALOE VERA SAOS')

    const servings = within(dialog).getAllByLabelText('Takaran Saji')
    await user.type(servings[0], '80')
    await user.type(servings[1], '30')
    const units = within(dialog).getAllByLabelText(/Satuan takaran saji komponen/)
    await user.type(units[0], 'g')
    await user.type(units[1], 'g')
    const amounts = within(dialog).getAllByLabelText('Jumlah')
    await user.type(amounts[0], '12.5')
    await user.type(amounts[8], '4')

    await user.click(within(dialog).getByRole('button', { name: 'Simpan Produk' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    const payload = mocks.post.mock.calls[0][1]
    expect(payload.nutrition.servingSizeAmount).toBeUndefined()
    expect(payload.nutrition.sections).toHaveLength(2)
    expect(payload.nutrition.sections[0]).toMatchObject({
      name: 'NUGALOE — Nugget Lele',
      servingSizeAmount: 80,
      servingSizeUnit: 'g',
      components: [expect.objectContaining({ name: 'Energi Total', amount: 12.5 })],
    })
    expect(payload.nutrition.sections[1]).toMatchObject({
      name: 'ALOE VERA SAOS',
      servingSizeAmount: 30,
      servingSizeUnit: 'g',
      components: [expect.objectContaining({ name: 'Energi Total', amount: 4 })],
    })
  })

  it('Admin menghapus salah satu komponen tanpa mengubah komponen lainnya', async () => {
    render(<ProductsPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Tambah Produk/ }))
    const dialog = screen.getByRole('dialog', { name: 'Tambah Produk' })

    await user.type(within(dialog).getByLabelText('Nama Produk'), 'NUGALOE')
    await user.type(within(dialog).getByLabelText('Satuan Dasar'), 'pcs')
    await user.type(within(dialog).getByLabelText('Harga Jual (Rp)'), '15000')
    await user.click(within(dialog).getByRole('button', { name: /Informasi Nilai Gizi/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Tambah Komponen' }))

    const names = within(dialog).getAllByLabelText('Nama Komponen')
    await user.type(names[1], 'ALOE VERA SAOS')
    const servings = within(dialog).getAllByLabelText('Takaran Saji')
    await user.type(servings[1], '30')
    const amounts = within(dialog).getAllByLabelText('Jumlah')
    await user.type(amounts[8], '4')

    await user.click(within(dialog).getByRole('button', { name: 'Hapus komponen kemasan 1' }))
    expect(within(dialog).queryByLabelText('Nama Komponen')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Simpan Produk' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalled())
    const payload = mocks.post.mock.calls[0][1]
    expect(payload.nutrition.sections).toBeUndefined()
    expect(payload.nutrition).toMatchObject({
      servingSizeAmount: 30,
      components: [expect.objectContaining({ name: 'Energi Total', amount: 4 })],
    })
    expect(payload.nutrition.name).toBeUndefined()
  })

  it('Admin menolak simpan bila nama komponen kemasan kosong', async () => {
    render(<ProductsPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Tambah Produk/ }))
    const dialog = screen.getByRole('dialog', { name: 'Tambah Produk' })

    await user.type(within(dialog).getByLabelText('Nama Produk'), 'NUGALOE')
    await user.type(within(dialog).getByLabelText('Satuan Dasar'), 'pcs')
    await user.type(within(dialog).getByLabelText('Harga Jual (Rp)'), '15000')
    await user.click(within(dialog).getByRole('button', { name: /Informasi Nilai Gizi/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Tambah Komponen' }))

    const servings = within(dialog).getAllByLabelText('Takaran Saji')
    await user.type(servings[0], '80')
    await user.type(servings[1], '30')
    await user.click(within(dialog).getByRole('button', { name: 'Simpan Produk' }))

    await waitFor(() => expect(mocks.notify.error).toHaveBeenCalled())
    expect(mocks.notify.error).toHaveBeenCalledWith('Nama komponen kemasan 1 wajib diisi.')
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('Admin melihat komponen gizi yang tersimpan saat mengedit produk', async () => {
    const original = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation((url: string, config?: { params?: Record<string, string> }) => {
      if (url === '/products') {
        return Promise.resolve({
          data: {
            data: [
              {
                ...product,
                nutrition: {
                  sections: [
                    {
                      name: 'NUGALOE — Nugget Lele',
                      servingSizeAmount: 80,
                      servingSizeUnit: 'g',
                      components: [{ name: 'Energi Total', amount: 12, unit: 'kkal' }],
                    },
                    {
                      name: 'ALOE VERA SAOS',
                      servingSizeAmount: 30,
                      servingSizeUnit: 'g',
                      components: [{ name: 'Gula Total', amount: 4, unit: 'g' }],
                    },
                  ],
                },
              },
            ],
          },
        })
      }
      return original(url, config)
    })

    render(<ProductsPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Edit Keripik Uji' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Produk' })
    await user.click(within(dialog).getByRole('button', { name: /Informasi Nilai Gizi/ }))

    const names = within(dialog).getAllByLabelText('Nama Komponen')
    expect(names).toHaveLength(2)
    expect(names[0]).toHaveValue('NUGALOE — Nugget Lele')
    expect(names[1]).toHaveValue('ALOE VERA SAOS')
    const servings = within(dialog).getAllByLabelText('Takaran Saji')
    expect(servings[0]).toHaveValue(80)
    expect(servings[1]).toHaveValue(30)
    expect(within(dialog).getAllByLabelText('Nama Kandungan')[6]).toHaveValue('Gula Total')
  })

  it('menutup modal lewat tombol X, Escape, dan backdrop tanpa menutup saat isian diklik', async () => {
    render(<ProductsPage />)
    const user = userEvent.setup()
    const openModal = async () =>
      user.click(await screen.findByRole('button', { name: /Tambah Produk/ }))

    await openModal()
    await user.type(screen.getByLabelText('Nama Produk'), 'Produk Uji')
    await user.click(screen.getByLabelText('Deskripsi (opsional)'))
    expect(screen.getByRole('dialog', { name: /Tambah Produk/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Nama Produk')).toHaveValue('Produk Uji')

    await user.click(screen.getByRole('button', { name: 'Tutup dialog produk' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')

    await openModal()
    expect(screen.getByLabelText('Nama Produk')).toHaveValue('')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await openModal()
    fireEvent.click(document.querySelector('.modal-overlay') as HTMLElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Admin menambahkan resep bahan baku dan mengirimkannya bersama produk baru', async () => {
    const original = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation((url: string, config?: { params?: Record<string, string> }) => {
      if (url === '/materials') {
        return Promise.resolve({
          data: { data: [{ id: 'm1', name: 'Tepung', unit: 'kg', isActive: true }] },
        })
      }
      return original(url, config)
    })

    render(<ProductsPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Tambah Produk/ }))

    const dialog = screen.getByRole('dialog', { name: 'Tambah Produk' })
    await user.type(within(dialog).getByLabelText('Nama Produk'), 'Produk Resep')
    await user.type(within(dialog).getByLabelText('Satuan Dasar'), 'pcs')
    await user.type(within(dialog).getByLabelText('Harga Jual (Rp)'), '10000')

    await user.click(within(dialog).getByRole('button', { name: 'Tambah Bahan' }))
    await user.selectOptions(within(dialog).getByLabelText('Bahan Baku'), 'm1')
    await user.type(document.getElementById('recipe-qty-0') as HTMLElement, '150')
    await user.selectOptions(within(dialog).getByLabelText('Satuan Resep'), 'g')

    await user.click(within(dialog).getByRole('button', { name: 'Simpan Produk' }))

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith(
        '/products',
        expect.objectContaining({
          name: 'Produk Resep',
          recipe: [{ materialId: 'm1', quantityPerUnit: 150, recipeUnit: 'g' }],
        })
      )
    })
  })

  it('tidak menawarkan bahan Manual sebagai bahan resep otomatis', async () => {
    const original = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation((url: string, config?: { params?: Record<string, string> }) => {
      if (url === '/materials') {
        return Promise.resolve({
          data: {
            data: [
              { id: 'm1', name: 'Tepung', unit: 'kg', isActive: true },
              { id: 'm2', name: 'Kemasan', unit: 'bungkus', isManual: true, isActive: true },
              { id: 'm3', name: 'Minyak', unit: 'L', isActive: true },
            ],
          },
        })
      }
      return original(url, config)
    })

    render(<ProductsPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /Tambah Produk/ }))

    const dialog = screen.getByRole('dialog', { name: 'Tambah Produk' })
    await user.click(within(dialog).getByRole('button', { name: 'Tambah Bahan' }))
    const materialField = within(dialog).getByLabelText('Bahan Baku')

    expect(within(materialField).getByRole('option', { name: /Tepung/ })).toBeInTheDocument()
    expect(within(materialField).getByRole('option', { name: /Minyak/ })).toBeInTheDocument()
    expect(within(materialField).queryByRole('option', { name: /Kemasan/ })).not.toBeInTheDocument()
  })
})

describe('ProductsPage — riwayat pergerakan stok produk', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
    mocks.delete.mockReset()
    Object.values(mocks.notify).forEach((fn) => fn.mockReset())
    mockApi()
    mocks.post.mockResolvedValue({ data: { product: { ...product, id: 'p-new' } } })
    mocks.patch.mockResolvedValue({ data: { product } })
  })

  it('memuat riwayat dari backend setelah produk dipilih dan menandai saldo historis', async () => {
    render(<ProductsPage />)

    expect(
      await screen.findByText('Pilih produk untuk melihat riwayat pergerakan stok.'),
    ).toBeInTheDocument()
    expect(mocks.get).toHaveBeenCalledWith('/products')

    await selectProduct()

    const table = screen.getByRole('table')
    expect(within(table).getByText('Penjualan')).toBeInTheDocument()
    expect(within(table).getByText(/Dicatat oleh Operator Uji/)).toBeInTheDocument()
    expect(within(table).getByText('Penjualan #SALE0001')).toBeInTheDocument()
    expect(within(table).getByText('Saldo Awal')).toBeInTheDocument()
    expect(
      within(table).getByText('Saldo Awal (Riwayat Sebelumnya Tidak Tersedia)'),
    ).toBeInTheDocument()
    expect(within(table).getAllByText('Riwayat historis').length).toBeGreaterThan(0)

    expect(screen.getByText('Stok Produk Saat Ini').parentElement).toHaveTextContent('8 pcs')
    expect(screen.getByText('Pergerakan Ditampilkan')).toBeInTheDocument()
    expect(screen.getByText(/Sebagian saldo berasal dari/)).toBeInTheDocument()

    await waitFor(() =>
      expect(mocks.get).toHaveBeenCalledWith('/products/p1/stock-movements', {
        params: {},
      }),
    )
    expect(mocks.get).toHaveBeenCalledWith('/batches', { params: { productId: 'p1' } })
  })

  it('mengirim seluruh filter gabungan ke backend dan menampilkan empty state', async () => {
    render(<ProductsPage />)
    const user = await selectProduct()

    fireEvent.change(screen.getByLabelText('Dari'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Sampai'), { target: { value: '2026-10-31' } })
    await user.selectOptions(screen.getByLabelText('Jenis Aktivitas'), 'PRODUCTION_YIELD')
    await user.selectOptions(screen.getByLabelText('Batch'), 'b1')
    await user.click(screen.getByRole('button', { name: 'Terapkan Filter' }))

    await waitFor(() =>
      expect(mocks.get).toHaveBeenLastCalledWith('/products/p1/stock-movements', {
        params: {
          from: '2026-10-01',
          to: '2026-10-31',
          type: 'PRODUCTION_YIELD',
          batchId: 'b1',
        },
      }),
    )
    expect(
      await screen.findByText('Riwayat tidak ditemukan untuk filter ini.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('menolak rentang tanggal terbalik tanpa memanggil API riwayat', async () => {
    render(<ProductsPage />)
    await selectProduct()
    const historyCallsBefore = mocks.get.mock.calls.filter(
      ([url]) => url === '/products/p1/stock-movements',
    ).length

    fireEvent.change(screen.getByLabelText('Dari'), { target: { value: '2026-10-31' } })
    fireEvent.change(screen.getByLabelText('Sampai'), { target: { value: '2026-10-01' } })
    // Browser juga menahan submit saat atribut min/max tidak valid; submit
    // langsung memastikan pengaman aplikasi tetap diuji.
    fireEvent.submit(screen.getByRole('button', { name: 'Terapkan Filter' }).closest('form')!)

    expect(
      await screen.findByText('Tanggal Dari tidak boleh setelah tanggal Sampai.'),
    ).toBeInTheDocument()
    expect(
      mocks.get.mock.calls.filter(([url]) => url === '/products/p1/stock-movements'),
    ).toHaveLength(historyCallsBefore)
  })

  it('Reset Filter mengembalikan seluruh filter dan riwayat ke kondisi awal', async () => {
    render(<ProductsPage />)
    const user = await selectProduct()

    fireEvent.change(screen.getByLabelText('Dari'), { target: { value: '2026-10-01' } })
    await user.selectOptions(screen.getByLabelText('Jenis Aktivitas'), 'SALE')
    await user.selectOptions(screen.getByLabelText('Batch'), 'b1')

    await user.click(screen.getByRole('button', { name: 'Reset Filter' }))

    expect((screen.getByLabelText('Produk') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Dari') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Sampai') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Jenis Aktivitas') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Batch') as HTMLSelectElement).value).toBe('')
    expect(screen.getByLabelText('Batch')).toBeDisabled()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(
      screen.getByText('Pilih produk untuk melihat riwayat pergerakan stok.'),
    ).toBeInTheDocument()
  })

  it('koreksi stok menampilkan alasan, keterangan, jenis, dan stok sebelum/sesudah pada riwayat', async () => {
    const original = mocks.get.getMockImplementation()!
    mocks.get.mockImplementation((url: string, config?: { params?: Record<string, string> }) => {
      if (url === '/products/p1/stock-movements') {
        return Promise.resolve({
          data: {
            data: [
              ...movements.map((row) =>
                row.id === 'm1' ? { ...row, note: 'Retur supplier' } : row
              ),
              {
                id: 'adj1',
                product: { id: 'p1', name: 'Keripik Uji', unit: 'pcs' },
                batch: { id: 'b1', code: 'NL-20261031-001', currentStock: 8 },
                type: 'ADJUSTMENT',
                quantity: 2,
                stockIn: 2,
                stockOut: 0,
                balanceAfter: 8,
                batchBalanceAfter: 8,
                occurredAt: '2026-11-01T03:00:00.000Z',
                recordedAt: '2026-11-01T03:00:00.000Z',
                recordedBy: { id: 'u1', username: 'admin', name: 'Admin Uji' },
                reason: 'Produk rusak',
                note: 'Retur dari gudang',
                reference: { kind: 'ADJUSTMENT', id: 'adj1', label: 'Penyesuaian #ADJ1' },
                sourceId: 'adj1',
                isHistoricalFallback: false,
              },
            ],
            summary,
          },
        })
      }
      return original(url, config)
    })

    render(<ProductsPage />)
    await selectProduct()

    const table = screen.getByRole('table')
    expect(within(table).getByText('Keterangan: Retur supplier')).toBeInTheDocument()
    expect(within(table).getByText('Produk rusak')).toBeInTheDocument()
    expect(within(table).getByText('Keterangan: Retur dari gudang')).toBeInTheDocument()
    expect(
      within(table).getByText('Penambahan · Stok batch 6 → 8 pcs')
    ).toBeInTheDocument()
  })
})

describe('ProductsPage — Edit Stok', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
    mocks.delete.mockReset()
    Object.values(mocks.notify).forEach((fn) => fn.mockReset())
    mockApi()
    mocks.post.mockResolvedValue({ data: { product } })
    mocks.patch.mockResolvedValue({ data: { product } })
    mocks.notify.confirm.mockResolvedValue(true)
  })

  async function openStockDialog() {
    const user = userEvent.setup()
    render(<ProductsPage />)
    await user.click(await screen.findByRole('button', { name: 'Edit Stok Keripik Uji' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit Stok' })
    await within(dialog).findByRole('option', { name: /NL-20261031-001/ })
    return { user, dialog }
  }

  it('kartu produk menampilkan tiga aksi berurutan: Edit Stok, Arsipkan, Hapus', async () => {
    render(<ProductsPage />)
    const archive = await screen.findByRole('button', { name: 'Arsipkan Keripik Uji' })
    const actions = archive.parentElement!
    expect(Array.from(actions.querySelectorAll('button')).map((button) => button.textContent)).toEqual([
      'Edit Stok',
      'Arsipkan',
      'Hapus',
    ])
  })

  it('modal menampilkan produk, batch, stok tersedia, jenis, jumlah, alasan, dan keterangan', async () => {
    const { dialog } = await openStockDialog()

    expect(within(dialog).getByText('Keripik Uji')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Batch')).toBeInTheDocument()
    expect(within(dialog).getByText(/Stok tersedia pada batch terpilih/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Jenis Koreksi')).toHaveValue('TAMBAH')
    expect(within(dialog).getByLabelText('Jumlah Stok')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Keterangan Tambahan (opsional)')).toBeInTheDocument()

    const reason = within(dialog).getByLabelText('Alasan Koreksi')
    expect(Array.from(reason.querySelectorAll('option')).map((option) => option.textContent)).toEqual([
      'Pilih alasan...',
      'Kedaluwarsa',
      'Produk rusak',
      'Produk hilang',
      'Selisih stok opname',
      'Kesalahan pencatatan',
      'Lainnya',
    ])
  })

  it('Penambahan mengirim jumlah positif, menampilkan konfirmasi, dan menutup modal', async () => {
    const { user, dialog } = await openStockDialog()
    await user.selectOptions(within(dialog).getByLabelText('Batch'), 'b1')
    await user.type(within(dialog).getByLabelText('Jumlah Stok'), '2')
    await user.selectOptions(within(dialog).getByLabelText('Alasan Koreksi'), 'Produk rusak')
    await user.type(
      within(dialog).getByLabelText('Keterangan Tambahan (opsional)'),
      'Retur dari gudang'
    )

    await user.click(within(dialog).getByRole('button', { name: 'Simpan Koreksi' }))

    expect(mocks.notify.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Konfirmasi Koreksi Stok',
        tone: 'warning',
        confirmLabel: 'Simpan Koreksi',
        message: expect.stringContaining('Keripik Uji'),
      })
    )
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/stock-adjustments', {
        targetType: 'BATCH',
        targetId: 'b1',
        quantity: 2,
        reason: 'Produk rusak',
        note: 'Retur dari gudang',
      })
    )
    expect(mocks.notify.success).toHaveBeenCalledWith(expect.stringContaining('6 → 8'))
    expect(screen.queryByRole('dialog', { name: 'Edit Stok' })).not.toBeInTheDocument()
  })

  it('Pengurangan mengirim jumlah negatif dan menghitung stok sesudah dengan benar', async () => {
    const { user, dialog } = await openStockDialog()
    await user.selectOptions(within(dialog).getByLabelText('Batch'), 'b1')
    await user.selectOptions(within(dialog).getByLabelText('Jenis Koreksi'), 'KURANG')
    await user.type(within(dialog).getByLabelText('Jumlah Stok'), '2.5')
    await user.selectOptions(within(dialog).getByLabelText('Alasan Koreksi'), 'Selisih stok opname')

    await user.click(within(dialog).getByRole('button', { name: 'Simpan Koreksi' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/stock-adjustments', {
        targetType: 'BATCH',
        targetId: 'b1',
        quantity: -2.5,
        reason: 'Selisih stok opname',
        note: undefined,
      })
    )
    expect(mocks.notify.success).toHaveBeenCalledWith(expect.stringContaining('6 → 3,5'))
  })

  it('Pengurangan melebihi stok tersedia ditolak sebelum konfirmasi', async () => {
    const { user, dialog } = await openStockDialog()
    await user.selectOptions(within(dialog).getByLabelText('Batch'), 'b1')
    await user.selectOptions(within(dialog).getByLabelText('Jenis Koreksi'), 'KURANG')
    await user.type(within(dialog).getByLabelText('Jumlah Stok'), '7')
    await user.selectOptions(within(dialog).getByLabelText('Alasan Koreksi'), 'Kedaluwarsa')

    await user.click(within(dialog).getByRole('button', { name: 'Simpan Koreksi' }))

    expect(mocks.notify.error).toHaveBeenCalledWith(
      expect.stringContaining('hanya 6 pcs')
    )
    expect(mocks.notify.confirm).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('batch belum dipilih ditolak sebelum konfirmasi', async () => {
    const { user, dialog } = await openStockDialog()
    fireEvent.change(within(dialog).getByLabelText('Jumlah Stok'), { target: { value: '1' } })
    fireEvent.change(within(dialog).getByLabelText('Alasan Koreksi'), { target: { value: 'Lainnya' } })

    await user.click(within(dialog).getByRole('button', { name: 'Simpan Koreksi' }))

    expect(mocks.notify.error).toHaveBeenCalledWith('Pilih batch yang akan dikoreksi.')
    expect(mocks.notify.confirm).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('jumlah nol ditolak sebelum konfirmasi', async () => {
    const { dialog } = await openStockDialog()
    fireEvent.change(within(dialog).getByLabelText('Batch'), { target: { value: 'b1' } })
    fireEvent.change(within(dialog).getByLabelText('Jumlah Stok'), { target: { value: '0' } })
    fireEvent.change(within(dialog).getByLabelText('Alasan Koreksi'), { target: { value: 'Lainnya' } })

    // Browser menahan submit karena atribut min; submit langsung menguji
    // pengaman aplikasi bila validasi bawaan dilewati.
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Simpan Koreksi' }).closest('form')!)

    expect(mocks.notify.error).toHaveBeenCalledWith('Jumlah koreksi harus lebih besar dari nol.')
    expect(mocks.notify.confirm).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('alasan kosong ditolak sebelum konfirmasi', async () => {
    const { user, dialog } = await openStockDialog()
    fireEvent.change(within(dialog).getByLabelText('Batch'), { target: { value: 'b1' } })
    fireEvent.change(within(dialog).getByLabelText('Jumlah Stok'), { target: { value: '1' } })

    await user.click(within(dialog).getByRole('button', { name: 'Simpan Koreksi' }))

    expect(mocks.notify.error).toHaveBeenCalledWith('Pilih alasan koreksi stok.')
    expect(mocks.notify.confirm).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('batch yang tidak ditemukan ditolak sebelum konfirmasi', async () => {
    const { user, dialog } = await openStockDialog()
    fireEvent.change(within(dialog).getByLabelText('Batch'), { target: { value: 'batch-hilang' } })
    fireEvent.change(within(dialog).getByLabelText('Jumlah Stok'), { target: { value: '1' } })
    fireEvent.change(within(dialog).getByLabelText('Alasan Koreksi'), { target: { value: 'Lainnya' } })

    await user.click(within(dialog).getByRole('button', { name: 'Simpan Koreksi' }))

    expect(mocks.notify.error).toHaveBeenCalledWith('Pilih batch yang akan dikoreksi.')
    expect(mocks.notify.confirm).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('membatalkan konfirmasi tidak mengirim koreksi', async () => {
    const { user, dialog } = await openStockDialog()
    mocks.notify.confirm.mockResolvedValueOnce(false)
    await user.selectOptions(within(dialog).getByLabelText('Batch'), 'b1')
    await user.type(within(dialog).getByLabelText('Jumlah Stok'), '1')
    await user.selectOptions(within(dialog).getByLabelText('Alasan Koreksi'), 'Lainnya')

    await user.click(within(dialog).getByRole('button', { name: 'Simpan Koreksi' }))

    expect(mocks.post).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Edit Stok' })).toBeInTheDocument()
  })

  it('Menolak koreksi ketika backend menolak stok tidak mencukupi', async () => {
    const { user, dialog } = await openStockDialog()
    mocks.post.mockRejectedValueOnce({
      response: { data: { message: 'Penyesuaian ditolak: Stok batch tidak mencukupi.' } },
    })
    await user.selectOptions(within(dialog).getByLabelText('Batch'), 'b1')
    await user.type(within(dialog).getByLabelText('Jumlah Stok'), '1')
    await user.selectOptions(within(dialog).getByLabelText('Alasan Koreksi'), 'Produk hilang')

    await user.click(within(dialog).getByRole('button', { name: 'Simpan Koreksi' }))

    await waitFor(() =>
      expect(mocks.notify.error).toHaveBeenCalledWith(
        'Penyesuaian ditolak: Stok batch tidak mencukupi.',
        'Koreksi Ditolak'
      )
    )
    expect(screen.getByRole('dialog', { name: 'Edit Stok' })).toBeInTheDocument()
  })
})

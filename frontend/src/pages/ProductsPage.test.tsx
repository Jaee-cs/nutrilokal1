import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductsPage } from './ProductsPage'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
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
  default: { get: mocks.get },
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

describe('ProductsPage — riwayat pergerakan stok produk', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    Object.values(mocks.notify).forEach((fn) => fn.mockReset())
    mockApi()
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
})

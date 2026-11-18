import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SalesPage } from './SalesPage'
import { formStateKey, readFormState, writeFormState } from '../lib/form-state'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  userId: 'u1',
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
    user: { id: mocks.userId, username: 'admin', name: 'Admin Uji', role: 'ADMIN' },
  }),
}))

vi.mock('../components/NotificationProvider', () => ({
  useNotify: () => mocks.notify,
}))

vi.mock('../lib/api', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
  },
}))

const product = {
  id: 'p1',
  name: 'Keripik Uji',
  unit: 'pcs',
  sellingPrice: 10000,
  isActive: true,
}

const batch = {
  id: 'b1',
  code: 'NL-20261101-001',
  product: { id: 'p1', name: 'Keripik Uji', unit: 'pcs' },
  productionDate: '2026-11-01T00:00:00.000Z',
  stock: 10,
  expiryDate: null,
  expiryValidated: false,
}

function mockApi() {
  mocks.get.mockImplementation((url: string) => {
    if (url === '/products') return Promise.resolve({ data: { data: [product] } })
    if (url === '/batches') return Promise.resolve({ data: { data: [batch] } })
    if (url === '/sales') return Promise.resolve({ data: { data: [] } })
    return Promise.reject(new Error(`URL tidak di-mock: ${url}`))
  })
  mocks.post.mockResolvedValue({ data: { transaction: { id: 'tx-uji' } } })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.userId = 'u1'
  mockApi()
  mocks.notify.confirm.mockResolvedValue(true)
})

const readAnyFormState = (userId: string, formKey: 'production' | 'sales') =>
  readFormState(userId, formKey, (raw) => raw)

function validSalesSnapshot() {
  return [{ productId: 'p1', allocations: [{ batchId: 'b1', quantity: '2' }] }]
}

async function renderWithData() {
  render(<SalesPage />)
  await screen.findByRole('option', { name: /Keripik Uji/ })
}

function expectRestoredForm() {
  expect(screen.getByLabelText('Produk')).toHaveValue('p1')
  expect(screen.getByLabelText('Batch')).toHaveValue('b1')
  expect(screen.getByLabelText(/Jumlah/)).toHaveValue(2)
}

describe('SalesPage - pemulihan isian lokal', () => {
  it('memulihkan keranjang setelah halaman ditutup dan dibuka lagi', async () => {
    writeFormState('u1', 'sales', validSalesSnapshot())

    const first = render(<SalesPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })
    expectRestoredForm()
    first.unmount()

    await renderWithData()
    expectRestoredForm()
  })

  it('menyimpan perubahan dengan debounce dan memisahkan isian antar akun', async () => {
    writeFormState('u1', 'sales', validSalesSnapshot())
    const first = render(<SalesPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })

    fireEvent.change(screen.getByLabelText(/Jumlah/), { target: { value: '3' } })
    await waitFor(() => {
      expect(readAnyFormState('u1', 'sales')).toEqual([
        { productId: 'p1', allocations: [{ batchId: 'b1', quantity: '3' }] },
      ])
    }, { timeout: 2000 })
    expect(readAnyFormState('u2', 'sales')).toBeNull()

    first.unmount()
    mocks.userId = 'u2'
    await renderWithData()
    expect(screen.getByLabelText('Produk')).toHaveValue('')
    expect(readAnyFormState('u1', 'sales')).toEqual([
      { productId: 'p1', allocations: [{ batchId: 'b1', quantity: '3' }] },
    ])
    expect(localStorage.getItem(formStateKey('u1', 'production'))).toBeNull()
  })

  it('mempertahankan keranjang saat transaksi gagal', async () => {
    writeFormState('u1', 'sales', validSalesSnapshot())
    mocks.post.mockRejectedValueOnce(new Error('Gagal menyimpan'))
    await renderWithData()

    fireEvent.submit(screen.getByRole('button', { name: 'Simpan Penjualan' }).closest('form')!)

    await waitFor(() => expect(mocks.notify.error).toHaveBeenCalled())
    expectRestoredForm()
    expect(readAnyFormState('u1', 'sales')).toEqual(validSalesSnapshot())
  })

  it('menghapus keranjang dan tidak menimpa ulang setelah transaksi berhasil', async () => {
    writeFormState('u1', 'sales', validSalesSnapshot())
    await renderWithData()

    fireEvent.submit(screen.getByRole('button', { name: 'Simpan Penjualan' }).closest('form')!)

    await waitFor(() => expect(mocks.notify.success).toHaveBeenCalled())
    expect(screen.getByLabelText('Produk')).toHaveValue('')
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(readAnyFormState('u1', 'sales')).toBeNull()
  })

  it('meminta konfirmasi sebelum mengosongkan keranjang', async () => {
    writeFormState('u1', 'sales', validSalesSnapshot())
    const user = userEvent.setup()
    await renderWithData()

    mocks.notify.confirm.mockResolvedValueOnce(false)
    await user.click(screen.getByRole('button', { name: 'Kosongkan Form' }))
    expectRestoredForm()

    mocks.notify.confirm.mockResolvedValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Kosongkan Form' }))
    expect(screen.getByLabelText('Produk')).toHaveValue('')
    await waitFor(() => expect(readAnyFormState('u1', 'sales')).toBeNull())
  })

  it('memberi tahu produk dan batch invalid tanpa menghapus jumlah', async () => {
    writeFormState('u1', 'sales', [
      { productId: 'p-hilang', allocations: [{ batchId: 'b-hilang', quantity: '2' }] },
    ])

    await renderWithData()

    expect(await screen.findByText(/Produk pada isian tersimpan sudah tidak tersedia/i)).toBeInTheDocument()
    expect(screen.getByText(/Batch pada isian tersimpan/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Produk')).toHaveValue('')
    expect(screen.getByLabelText(/Jumlah/)).toHaveValue(2)
  })
})

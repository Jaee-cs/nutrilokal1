import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductionPage } from './ProductionPage'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  role: 'ADMIN' as 'ADMIN' | 'OPERATOR',
  productions: [] as unknown[],
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
  },
}))

const product = {
  id: 'p1',
  name: 'Keripik Uji',
  unit: 'pcs',
  isActive: true,
}

const batchSummary = {
  id: 'b1',
  code: 'NL-20261001-001',
  aliases: [],
  product: { id: 'p1', name: 'Keripik Uji', unit: 'pcs', photoUrl: null },
  productionDate: '2026-10-01T00:00:00.000Z',
  stock: 10,
  hasLimitedHistory: false,
  expiryDate: '2026-12-01T00:00:00.000Z',
  expiryValidated: true,
  createdAt: '2026-10-01T03:00:00.000Z',
}

const production = {
  id: 'prod1',
  productId: 'p1',
  product: { id: 'p1', name: 'Keripik Uji', unit: 'pcs' },
  productionDate: '2026-10-01T00:00:00.000Z',
  yieldQuantity: 10,
  recordedBy: { username: 'operator', name: 'Operator Uji' },
  recordedAt: '2026-10-01T03:00:00.000Z',
  batch: {
    id: 'b1',
    code: 'NL-20261001-001',
    productionDate: '2026-10-01T00:00:00.000Z',
    stock: 10,
    aliases: [],
    expiryDate: '2026-12-01T00:00:00.000Z',
    expiryValidated: true,
  },
  usages: [],
}

const batchDetail = {
  ...batchSummary,
  openingBalance: null,
  movements: [],
  expiryHistory: [
    {
      id: 'change1',
      previousExpiryDate: '2026-11-01T00:00:00.000Z',
      newExpiryDate: '2026-12-01T00:00:00.000Z',
      changedAt: '2026-10-02T03:00:00.000Z',
      changedBy: { id: 'u1', username: 'admin', name: 'Admin Uji' },
    },
  ],
}

function mockApi() {
  mocks.get.mockImplementation((url: string) => {
    if (url === '/products') {
      return Promise.resolve({ data: { data: [product] } })
    }
    if (url === '/materials') {
      return Promise.resolve({ data: { data: [] } })
    }
    if (url === '/productions') {
      return Promise.resolve({ data: { data: mocks.productions } })
    }
    if (url === '/batches') {
      return Promise.resolve({ data: { data: mocks.productions.length ? [batchSummary] : [] } })
    }
    if (url === '/batches/b1') {
      return Promise.resolve({ data: { batch: batchDetail } })
    }
    return Promise.reject(new Error(`URL tidak di-mock: ${url}`))
  })
  mocks.post.mockResolvedValue({
    data: { production: { batch: { id: 'b1', code: 'NL-20261001-001' } } },
  })
  mocks.patch.mockResolvedValue({ data: { batch: batchSummary } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.role = 'ADMIN'
  mocks.productions = []
  mockApi()
  mocks.notify.confirm.mockResolvedValue(true)
})

describe('ProductionPage - tanggal kedaluwarsa', () => {
  it('menyediakan input tanggal kedaluwarsa wajib setelah tanggal produksi', async () => {
    render(<ProductionPage />)

    expect(await screen.findByRole('option', { name: /Keripik Uji/ })).toBeInTheDocument()
    const productionDate = screen.getByLabelText('Tanggal Produksi')
    const expiryDate = screen.getByLabelText('Tanggal Kedaluwarsa')

    expect(productionDate).toBeRequired()
    expect(expiryDate).toBeRequired()
    expect(expiryDate).not.toHaveAttribute('min')

    fireEvent.change(productionDate, { target: { value: '2026-10-01' } })
    expect(expiryDate).toHaveAttribute('min', '2026-10-02')
  })

  it('mengirim tanggal kedaluwarsa bersama pencatatan produksi', async () => {
    const user = userEvent.setup()
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })

    await user.selectOptions(screen.getByLabelText('Produk'), 'p1')
    fireEvent.change(screen.getByLabelText('Tanggal Produksi'), {
      target: { value: '2026-10-01' },
    })
    fireEvent.change(screen.getByLabelText('Tanggal Kedaluwarsa'), {
      target: { value: '2026-12-01' },
    })
    fireEvent.change(screen.getByLabelText('Jumlah Hasil'), { target: { value: '10' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Simpan Produksi' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith(
        '/productions',
        expect.objectContaining({
          productId: 'p1',
          productionDate: '2026-10-01',
          expiryDate: '2026-12-01',
          yieldQuantity: 10,
        })
      )
    })
    expect(mocks.notify.success).toHaveBeenCalledWith(
      expect.stringContaining('Produksi berhasil')
    )
  })

  it('menolak tanggal kedaluwarsa yang tidak setelah tanggal produksi', async () => {
    const user = userEvent.setup()
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })

    await user.selectOptions(screen.getByLabelText('Produk'), 'p1')
    fireEvent.change(screen.getByLabelText('Tanggal Produksi'), {
      target: { value: '2026-10-01' },
    })
    fireEvent.change(screen.getByLabelText('Tanggal Kedaluwarsa'), {
      target: { value: '2026-10-01' },
    })
    fireEvent.change(screen.getByLabelText('Jumlah Hasil'), { target: { value: '10' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Simpan Produksi' }).closest('form')!)

    expect(mocks.notify.error).toHaveBeenCalledWith(
      'Tanggal kedaluwarsa harus setelah tanggal produksi.'
    )
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('Admin harus mengonfirmasi sebelum menyimpan perubahan tanggal', async () => {
    mocks.productions = [production]
    const user = userEvent.setup()
    render(<ProductionPage />)

    await user.click((await screen.findAllByRole('button', { name: 'Detail Batch' }))[0])
    const dialog = await screen.findByRole('dialog', { name: /Batch NL-20261001-001/ })
    expect(
      within(dialog).getByRole('heading', { name: 'Atur Tanggal Kedaluwarsa' })
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Riwayat Perubahan Kedaluwarsa')).toBeInTheDocument()

    const input = within(dialog).getByLabelText('Tanggal Kedaluwarsa')
    fireEvent.change(input, { target: { value: '2026-12-15' } })
    const form = within(dialog).getByRole('button', { name: 'Simpan Tanggal' }).closest('form')!

    mocks.notify.confirm.mockResolvedValueOnce(false)
    fireEvent.submit(form)
    await waitFor(() => expect(mocks.notify.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.patch).not.toHaveBeenCalled()

    mocks.notify.confirm.mockResolvedValueOnce(true)
    fireEvent.submit(form)
    await waitFor(() => {
      expect(mocks.patch).toHaveBeenCalledWith('/batches/b1/expiry', {
        expiryDate: '2026-12-15',
      })
    })
    expect(mocks.notify.confirm.mock.calls[1][0].message).toContain('NL-20261001-001')
  })

  it('Operator hanya dapat melihat tanggal dan riwayat, tanpa form edit', async () => {
    mocks.role = 'OPERATOR'
    mocks.productions = [production]
    const user = userEvent.setup()
    render(<ProductionPage />)

    await user.click((await screen.findAllByRole('button', { name: 'Detail Batch' }))[0])
    const dialog = await screen.findByRole('dialog', { name: /Batch NL-20261001-001/ })

    expect(within(dialog).getByText('Riwayat Perubahan Kedaluwarsa')).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('heading', { name: 'Atur Tanggal Kedaluwarsa' })
    ).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Tanggal Kedaluwarsa')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Simpan Tanggal' })).not.toBeInTheDocument()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReportsPage } from './ReportsPage'
import { formatReportRange, presetRange, reportFilePeriod } from '../utils/report-period'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  default: { get: mocks.get },
}))

const downloads: string[] = []
const blobs: Blob[] = []

const stockData = {
  materials: [{ id: 'm1', name: 'Singkong', unit: 'kg', stock: 11 }],
  products: [
    {
      id: 'p1',
      name: 'Keripik Uji',
      unit: 'pcs',
      stock: 8,
      batches: [{ code: 'NL-001' }, { code: 'NL-002' }],
    },
  ],
}

function salesData(from: string, to: string) {
  return {
    from,
    to,
    summary: { transactionCount: 2, cancelledCount: 1, omzet: 150000 },
    byDay: [{ date: '2026-11-10', transactionCount: 2, omzet: 150000 }],
    byProduct: [
      { productId: 'p1', name: 'Keripik Uji', unit: 'pcs', quantity: 5, value: 150000 },
    ],
  }
}

function productionsData(from: string, to: string) {
  return {
    from,
    to,
    summary: {
      recordCount: 25,
      byProduct: [
        { productName: 'Keripik Uji', unit: 'pcs', recordCount: 25, totalYield: 325 },
      ],
    },
    records: Array.from({ length: 25 }, (_, i) => ({
      id: `r${i + 1}`,
      productionDate: `2026-11-${String((i % 9) + 1).padStart(2, '0')}`,
      productName: `Produk ${i + 1}`,
      unit: 'pcs',
      yieldQuantity: i + 1,
    })),
  }
}

function materialsData(from: string, to: string) {
  return {
    from,
    to,
    materials: [
      {
        id: 'm1',
        name: 'Singkong',
        unit: 'kg',
        received: 10,
        openingBalance: 5,
        used: 3,
        adjusted: -1,
        currentStock: 11,
      },
    ],
  }
}

function mockReports() {
  mocks.get.mockImplementation((url: string, config?: { params?: { from: string; to: string } }) => {
    if (url === '/reports/stock') {
      return Promise.resolve({ data: stockData })
    }
    const from = config?.params?.from ?? ''
    const to = config?.params?.to ?? ''
    if (url === '/reports/sales') return Promise.resolve({ data: salesData(from, to) })
    if (url === '/reports/productions') return Promise.resolve({ data: productionsData(from, to) })
    if (url === '/reports/materials') return Promise.resolve({ data: materialsData(from, to) })
    return Promise.reject(new Error(`URL tidak di-mock: ${url}`))
  })
}

beforeEach(() => {
  mocks.get.mockReset()
  downloads.length = 0
  blobs.length = 0
  vi.restoreAllMocks()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:mock'
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  })
  mockReports()
})

describe('ReportsPage — filter periode dan ekspor per tabel', () => {
  it('memakai Bulan Ini sebagai default dan memuat seluruh laporan dengan periode yang sama', async () => {
    render(<ReportsPage />)

    expect(await screen.findByRole('button', { name: 'Export CSV Omzet per Hari' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bulan Ini' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Semua' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hari Ini' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minggu Ini' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pilih periode kustom' })).toBeInTheDocument()
    expect(screen.queryByText('Filter Periode')).not.toBeInTheDocument()

    const month = presetRange('month')
    expect(mocks.get).toHaveBeenCalledWith('/reports/sales', { params: month })
    expect(mocks.get).toHaveBeenCalledWith('/reports/productions', { params: month })
    expect(mocks.get).toHaveBeenCalledWith('/reports/materials', { params: month })
    expect(mocks.get).toHaveBeenCalledWith('/reports/stock')
  })

  it('menerapkan preset Hari Ini dan Minggu Ini ke semua laporan serta mempertahankannya saat pindah tab', async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)
    await screen.findByRole('button', { name: 'Export CSV Omzet per Hari' })

    await user.click(screen.getByRole('button', { name: 'Hari Ini' }))
    const today = presetRange('today')
    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith('/reports/sales', { params: today })
      expect(mocks.get).toHaveBeenCalledWith('/reports/productions', { params: today })
      expect(mocks.get).toHaveBeenCalledWith('/reports/materials', { params: today })
    })
    expect(screen.getByRole('button', { name: 'Hari Ini' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Minggu Ini' }))
    const week = presetRange('week')
    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith('/reports/sales', { params: week })
    })
    expect(screen.getByRole('button', { name: 'Minggu Ini' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('tab', { name: 'Produksi' }))
    expect(screen.getByRole('button', { name: 'Minggu Ini' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('menerapkan Semua tanpa parameter tanggal dan mempertahankannya saat pindah tab', async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)
    await screen.findByRole('button', { name: 'Export CSV Omzet per Hari' })

    await user.click(screen.getByRole('button', { name: 'Semua' }))
    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith('/reports/sales', { params: {} })
      expect(mocks.get).toHaveBeenCalledWith('/reports/productions', { params: {} })
      expect(mocks.get).toHaveBeenCalledWith('/reports/materials', { params: {} })
    })
    expect(screen.getByRole('button', { name: 'Semua' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('tab', { name: 'Produksi' }))
    expect(screen.getByRole('button', { name: 'Semua' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('tab', { name: 'Penjualan' }))
    await user.click(await screen.findByRole('button', { name: 'Export CSV Omzet per Hari' }))
    expect(downloads[0]).toBe('laporan-penjualan-omzet-per-hari-semua-data.csv')
    expect(await blobs[0].text()).toContain('2026-11-10,2,150000')

    // Stok adalah snapshot terkini: tidak diambil ulang saat periode berubah.
    expect(mocks.get.mock.calls.filter(([url]) => url === '/reports/stock')).toHaveLength(1)
  })

  it('membuka modal periode kustom, menolak rentang terbalik, lalu menerapkan rentang valid', async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)
    await screen.findByRole('button', { name: 'Export CSV Omzet per Hari' })

    await user.click(screen.getByRole('button', { name: 'Pilih periode kustom' }))
    const dialog = screen.getByRole('dialog', { name: 'Pilih Periode Laporan' })
    const fromInput = within(dialog).getByLabelText('Tanggal Mulai')
    const toInput = within(dialog).getByLabelText('Tanggal Akhir')

    fireEvent.change(fromInput, { target: { value: '2026-11-14' } })
    fireEvent.change(toInput, { target: { value: '2026-11-10' } })
    const callsBeforeInvalid = mocks.get.mock.calls.length
    await user.click(within(dialog).getByRole('button', { name: 'Terapkan' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Tanggal akhir tidak boleh lebih awal daripada tanggal mulai.',
    )
    expect(mocks.get.mock.calls.length).toBe(callsBeforeInvalid)

    fireEvent.change(fromInput, { target: { value: '2026-11-02' } })
    fireEvent.change(toInput, { target: { value: '2026-11-09' } })
    await user.click(within(dialog).getByRole('button', { name: 'Terapkan' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Pilih Periode Laporan' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Pilih periode kustom' })).toHaveClass('active')
    expect(screen.getByText(formatReportRange('2026-11-02', '2026-11-09'))).toBeInTheDocument()

    const custom = { from: '2026-11-02', to: '2026-11-09' }
    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith('/reports/sales', { params: custom })
      expect(mocks.get).toHaveBeenCalledWith('/reports/productions', { params: custom })
      expect(mocks.get).toHaveBeenCalledWith('/reports/materials', { params: custom })
    })
  })

  it('mengekspor setiap tabel penjualan secara terpisah sesuai periode aktif', async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)
    await screen.findByRole('button', { name: 'Export CSV Omzet per Hari' })

    const period = reportFilePeriod(presetRange('month').from, presetRange('month').to)

    await user.click(screen.getByRole('button', { name: 'Export CSV Omzet per Hari' }))
    expect(downloads[0]).toBe(`laporan-penjualan-omzet-per-hari-${period}.csv`)
    const dayCsv = await blobs[0].text()
    expect(dayCsv).toContain('Tanggal,Transaksi,Omzet')
    expect(dayCsv).toContain('2026-11-10,2,150000')
    expect(dayCsv).not.toContain('Keripik Uji')

    await user.click(screen.getByRole('button', { name: 'Export CSV Penjualan per Produk' }))
    expect(downloads[1]).toBe(`laporan-penjualan-per-produk-${period}.csv`)
    const productCsv = await blobs[1].text()
    expect(productCsv).toContain('Produk,Qty,Satuan,Omzet')
    expect(productCsv).toContain('Keripik Uji,5,pcs,150000')
    expect(productCsv).not.toContain('Tanggal,Transaksi,Omzet')
  })

  it('mengekspor seluruh baris catatan produksi, termasuk yang tidak tampil di tabel', async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)
    await screen.findByRole('button', { name: 'Export CSV Omzet per Hari' })

    await user.click(screen.getByRole('tab', { name: 'Produksi' }))
    expect(await screen.findByRole('button', { name: 'Export CSV Catatan Produksi' })).toBeInTheDocument()
    expect(screen.queryByText('Produk 25')).not.toBeInTheDocument()

    const period = reportFilePeriod(presetRange('month').from, presetRange('month').to)
    await user.click(screen.getByRole('button', { name: 'Export CSV Catatan Produksi' }))
    expect(downloads[0]).toBe(`laporan-produksi-catatan-${period}.csv`)
    const csv = await blobs[0].text()
    expect(csv).toContain('Produk 25')
    expect(csv.split('\r\n')).toHaveLength(26)
  })

  it('mengekspor tabel bahan baku dan kedua tabel stok saat ini secara terpisah', async () => {
    const user = userEvent.setup()
    render(<ReportsPage />)
    await screen.findByRole('button', { name: 'Export CSV Omzet per Hari' })

    await user.click(screen.getByRole('tab', { name: 'Bahan Baku' }))
    expect(await screen.findByRole('button', { name: 'Export CSV Pergerakan Bahan Baku' })).toBeInTheDocument()
    const period = reportFilePeriod(presetRange('month').from, presetRange('month').to)
    await user.click(screen.getByRole('button', { name: 'Export CSV Pergerakan Bahan Baku' }))
    expect(downloads[0]).toBe(`laporan-bahan-baku-pergerakan-${period}.csv`)
    expect(await blobs[0].text()).toContain('Singkong,10,5,3,-1,11,kg')

    await user.click(screen.getByRole('tab', { name: 'Stok Saat Ini' }))
    expect(await screen.findByRole('button', { name: 'Export CSV Stok Bahan Baku' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Export CSV Stok Bahan Baku' }))
    expect(downloads[1]).toBe(`laporan-stok-saat-ini-bahan-baku-${period}.csv`)
    expect(await blobs[1].text()).toContain('Singkong,11,kg')

    await user.click(screen.getByRole('button', { name: 'Export CSV Stok Produk Jadi' }))
    expect(downloads[2]).toBe(`laporan-stok-saat-ini-produk-jadi-${period}.csv`)
    expect(await blobs[2].text()).toContain('Keripik Uji,8,pcs,NL-001 | NL-002')

    // Stok adalah snapshot terkini: perubahan periode tidak memicu ulang endpoint stok.
    await user.click(screen.getByRole('button', { name: 'Hari Ini' }))
    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledWith('/reports/sales', { params: presetRange('today') })
    })
    expect(mocks.get.mock.calls.filter(([url]) => url === '/reports/stock')).toHaveLength(1)
  })
})

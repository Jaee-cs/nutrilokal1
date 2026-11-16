import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardPage } from './DashboardPage'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  default: { get: mocks.get },
}))

function dashboardData(period: string) {
  return {
    period: { key: period, from: '2026-11-01', to: '2026-11-13' },
    materials: {
      count: 10,
      periodCount: period === 'month' ? 2 : 1,
      items: [],
    },
    products: {
      count: 5,
      periodCount: period === 'month' ? 3 : 1,
      items: [],
      batchesWithStock: [],
    },
    production: {
      recordCount: period === 'month' ? 8 : 2,
      byProduct: [],
      recent: [],
    },
    sales: {
      transactionCount: period === 'month' ? 4 : 1,
      cancelledCount: period === 'month' ? 1 : 0,
      omzet: period === 'month' ? 120000 : period === 'week' ? 50000 : 10000,
      recent: [],
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockImplementation((_url: string, config: { params: { period: string } }) =>
    Promise.resolve({ data: dashboardData(config.params.period) })
  )
})

describe('DashboardPage - filter periode', () => {
  it('default Bulan Ini dan memuat data periode tersebut', async () => {
    render(<DashboardPage />)

    expect(await screen.findByText('Rp 120.000')).toBeInTheDocument()
    expect(mocks.get).toHaveBeenCalledWith('/dashboard', { params: { period: 'month' } })

    const monthTab = screen.getByRole('tab', { name: 'Bulan Ini' })
    expect(monthTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Hari Ini' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Minggu Ini' })).toBeInTheDocument()
    expect(screen.getByText(/KWT Gogor 30 hari terakhir/)).toBeInTheDocument()
  })

  it('mengubah seluruh statistik saat filter Hari Ini dipilih', async () => {
    const user = userEvent.setup()
    render(<DashboardPage />)
    await screen.findByText('Rp 120.000')

    await user.click(screen.getByRole('tab', { name: 'Hari Ini' }))

    await waitFor(() => {
      expect(mocks.get).toHaveBeenLastCalledWith('/dashboard', { params: { period: 'today' } })
    })
    expect(await screen.findByText('Rp 10.000')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Hari Ini' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByText(/KWT Gogor hari ini/)).toBeInTheDocument()
  })

  it('mendukung filter Minggu Ini', async () => {
    const user = userEvent.setup()
    render(<DashboardPage />)
    await screen.findByText('Rp 120.000')

    await user.click(screen.getByRole('tab', { name: 'Minggu Ini' }))

    await waitFor(() => {
      expect(mocks.get).toHaveBeenLastCalledWith('/dashboard', { params: { period: 'week' } })
    })
    expect(await screen.findByText('Rp 50.000')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Minggu Ini' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })
})

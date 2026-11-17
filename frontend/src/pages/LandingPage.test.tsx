import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LandingPage } from './LandingPage'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  default: { get: mocks.get },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

describe('LandingPage', () => {
  beforeEach(() => {
    mocks.get.mockReset()
  })

  it('menampilkan katalog publik dari API beserta aksi masuk, WhatsApp, dan info', async () => {
    mocks.get.mockResolvedValue({
      data: {
        products: [
          {
            id: 'p1',
            name: 'Aloe Jelly Drink',
            unit: 'pcs',
            sellingPrice: 12000,
            description: 'Minuman lidah buaya.',
          },
        ],
      },
    })

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Aloe Jelly Drink' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Masuk/ })).toHaveAttribute('href', '/login')
    expect(screen.getByText('Rp 12.000')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Informasi Produk Aloe Jelly Drink/ })).toHaveAttribute(
      'href',
      '/produk/p1',
    )
    expect(screen.getByRole('link', { name: /Pesan WhatsApp/ })).toHaveAttribute(
      'href',
      expect.stringContaining(encodeURIComponent('Aloe Jelly Drink')),
    )
    expect(mocks.get).toHaveBeenCalledWith('/public/catalog')
  })
})

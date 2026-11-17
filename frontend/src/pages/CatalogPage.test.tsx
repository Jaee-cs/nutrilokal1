import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CatalogPage } from './CatalogPage'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  default: { get: mocks.get },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

describe('CatalogPage', () => {
  beforeEach(() => {
    mocks.get.mockReset()
  })

  it('menautkan setiap produk ke halaman publiknya', async () => {
    mocks.get.mockResolvedValue({
      data: {
        products: [
          {
            id: 'p1',
            name: 'Keripik Uji',
            unit: 'pcs',
            sellingPrice: 15000,
            description: 'Camilan lokal.',
          },
        ],
      },
    })

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('link', { name: 'Keripik Uji' })).toHaveAttribute(
      'href',
      '/produk/p1',
    )
    expect(screen.getByRole('link', { name: /Informasi Produk/ })).toHaveAttribute(
      'href',
      '/produk/p1',
    )
    expect(screen.getByRole('link', { name: /Masuk/ })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: /Cek Traceability QR/ })).toHaveAttribute(
      'href',
      '/qr-trace',
    )
    expect(screen.getByRole('link', { name: /Pesan WhatsApp/ })).toHaveAttribute(
      'href',
      expect.stringContaining(encodeURIComponent('Keripik Uji')),
    )
  })
})

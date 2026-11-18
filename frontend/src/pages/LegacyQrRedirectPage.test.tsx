import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LegacyQrRedirectPage } from './LegacyQrRedirectPage'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  default: { get: mocks.get },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/qr/:code" element={<LegacyQrRedirectPage />} />
        <Route path="/produk/:id" element={<div>Halaman publik produk</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LegacyQrRedirectPage — kompatibilitas QR lama', () => {
  beforeEach(() => {
    mocks.get.mockReset()
  })

  it('mengalihkan kode QR batch lama ke halaman publik produk', async () => {
    mocks.get.mockResolvedValue({ data: { productId: 'prod-1' } })

    renderAt('/qr/NL-20261110-002')

    expect(await screen.findByText('Halaman publik produk')).toBeInTheDocument()
    expect(mocks.get).toHaveBeenCalledWith('/public/qr/NL-20261110-002/product')
  })

  it('mengalihkan kode alias dengan karakter khusus tanpa merusak URL', async () => {
    mocks.get.mockResolvedValue({ data: { productId: 'produk/istimewa' } })

    renderAt('/qr/NL%20LAMA%2F2026')

    expect(await screen.findByText('Halaman publik produk')).toBeInTheDocument()
    expect(mocks.get).toHaveBeenCalledWith('/public/qr/NL%20LAMA%2F2026/product')
  })

  it('menampilkan tautan katalog bila kode QR lama tidak ditemukan', async () => {
    mocks.get.mockRejectedValue(new Error('404'))

    renderAt('/qr/TIDAK-ADA')

    expect(await screen.findByRole('link', { name: 'Lihat Katalog' })).toHaveAttribute(
      'href',
      '/catalog',
    )
    expect(screen.queryByText('Halaman publik produk')).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1))
  })
})

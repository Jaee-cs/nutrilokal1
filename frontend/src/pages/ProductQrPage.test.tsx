import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ProductQrPage } from './ProductQrPage'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  toDataURL: vi.fn(),
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    confirm: vi.fn(),
  },
}))

vi.mock('../lib/api', () => ({
  default: { get: mocks.get },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

vi.mock('../components/NotificationProvider', () => ({
  useNotify: () => mocks.notify,
}))

vi.mock('qrcode', () => ({
  default: { toDataURL: mocks.toDataURL },
}))

const activeProduct = {
  id: 'p1',
  name: 'Keripik Uji',
  unit: 'pcs',
  isActive: true,
  photoUrl: null,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ProductQrPage />
    </MemoryRouter>,
  )
}

describe('ProductQrPage', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.toDataURL.mockReset()
    mocks.toDataURL.mockResolvedValue('data:image/png;base64,qr-produk')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('membuat QR permanen yang mengarah ke halaman produk berdasarkan ID', async () => {
    mocks.get.mockResolvedValue({ data: { data: [activeProduct] } })
    renderPage()

    expect(await screen.findByAltText('Kode QR produk Keripik Uji')).toHaveAttribute(
      'src',
      'data:image/png;base64,qr-produk',
    )
    expect(screen.getByText('/produk/p1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Buka Halaman/ })).toHaveAttribute(
      'href',
      '/produk/p1',
    )

    // Target QR hanya bergantung pada ID produk, bukan batch.
    expect(mocks.toDataURL).toHaveBeenCalledWith(
      expect.stringMatching(/\/produk\/p1$/),
      expect.objectContaining({ width: 320 }),
    )
  })

  it('menampilkan pratinjau label cetak untuk produk', async () => {
    mocks.get.mockResolvedValue({ data: { data: [activeProduct] } })
    renderPage()

    await screen.findByAltText('Kode QR produk Keripik Uji')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Label/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Pratinjau label produk' })
    expect(within(dialog).getByText('Keripik Uji')).toBeInTheDocument()
    expect(within(dialog).getByAltText('Kode QR produk Keripik Uji')).toHaveAttribute(
      'src',
      'data:image/png;base64,qr-produk',
    )
    expect(within(dialog).getByRole('button', { name: /Cetak Label/ })).toBeInTheDocument()
  })

  it('mengunduh QR resolusi tinggi saat tombol unduh ditekan', async () => {
    mocks.get.mockResolvedValue({ data: { data: [activeProduct] } })
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    renderPage()

    await screen.findByAltText('Kode QR produk Keripik Uji')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Unduh PNG/ }))

    await waitFor(() => {
      expect(mocks.toDataURL).toHaveBeenCalledWith(
        expect.stringMatching(/\/produk\/p1$/),
        expect.objectContaining({ width: 1024 }),
      )
    })
    expect(clickSpy).toHaveBeenCalled()
    expect(mocks.notify.success).toHaveBeenCalledWith('QR produk berhasil diunduh')
  })

  it('menandai produk nonaktif tanpa menyembunyikan QR permanennya', async () => {
    mocks.get.mockResolvedValue({
      data: {
        data: [{ ...activeProduct, id: 'p2', name: 'Produk Arsip', isActive: false }],
      },
    })
    renderPage()

    expect(await screen.findByAltText('Kode QR produk Produk Arsip')).toBeInTheDocument()
    expect(screen.getByText('Nonaktif')).toBeInTheDocument()
    expect(
      screen.getByText(/Halaman publik tidak aktif selama produk dinonaktifkan/),
    ).toBeInTheDocument()
    // QR tetap dapat diunduh/dicetak; URL-nya tidak berubah.
    expect(screen.getByText('/produk/p2')).toBeInTheDocument()
  })

  it('menampilkan pesan saat daftar produk gagal dimuat', async () => {
    mocks.get.mockRejectedValue({
      response: { data: { message: 'Gagal memuat produk dari server' } },
    })
    renderPage()

    expect(await screen.findByText('Gagal memuat produk dari server')).toBeInTheDocument()
  })
})

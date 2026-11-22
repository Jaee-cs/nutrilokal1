import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProductPublicPage } from './ProductPublicPage'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../lib/api', () => ({
  default: { get: mocks.get },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

const published = {
  status: 'PUBLISHED',
  producer: { name: 'KWT Gogor', location: 'Kalurahan Salam, Patuk, Gunungkidul' },
  product: {
    name: 'Keripik Uji',
    unit: 'pcs',
    description: 'Camilan sehat dari bahan lokal.',
    composition: 'Singkong, garam, minyak kelapa.',
    storageInstructions: 'Simpan di tempat kering dan sejuk.',
  },
  batches: [
    {
      code: 'NL-20261110-002',
      productionDate: '2026-11-10',
      expiryDate: '2026-12-10',
      status: 'TERSEDIA',
    },
    {
      code: 'NL-20261101-001',
      productionDate: '2026-11-01',
      expiryDate: '2026-11-15',
      status: 'KEDALUWARSA',
    },
    {
      code: 'NL-20261020-001',
      productionDate: '2026-10-20',
      expiryDate: null,
      status: 'HABIS',
    },
    {
      code: 'NL-20261015-001',
      productionDate: '2026-10-15',
      expiryDate: null,
      status: 'DITARIK',
    },
  ],
}

function renderPage(id = 'p1') {
  return render(
    <MemoryRouter initialEntries={[`/produk/${id}`]}>
      <Routes>
        <Route path="/produk/:id" element={<ProductPublicPage />} />
        <Route path="/catalog" element={<div>Katalog tujuan</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProductPublicPage', () => {
  beforeEach(() => {
    mocks.get.mockReset()
  })

  it('menampilkan informasi produk, produsen, dan seluruh batch dari API', async () => {
    mocks.get.mockResolvedValue({ data: published })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Keripik Uji' })).toBeInTheDocument()
    expect(screen.getByText('KWT Gogor')).toBeInTheDocument()
    expect(screen.getByText('Kalurahan Salam, Patuk, Gunungkidul')).toBeInTheDocument()
    expect(screen.getByText('Camilan sehat dari bahan lokal.')).toBeInTheDocument()
    expect(screen.getByText('Singkong, garam, minyak kelapa.')).toBeInTheDocument()
    expect(screen.getByText('Simpan di tempat kering dan sejuk.')).toBeInTheDocument()
    expect(screen.getByText('4 batch')).toBeInTheDocument()
    expect(screen.getByText(/QR di kemasan bersifat permanen untuk produk ini/)).toBeInTheDocument()
    expect(screen.queryByText(/batch terbaru pasti/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Informasi Nilai Gizi' })).not.toBeInTheDocument()

    expect(mocks.get).toHaveBeenCalledWith('/public/products/p1')

    expect(screen.getByRole('link', { name: /Pesan via WhatsApp/ })).toHaveAttribute(
      'href',
      expect.stringContaining(encodeURIComponent('Keripik Uji')),
    )
    expect(screen.getByRole('link', { name: /Kembali ke Katalog/ })).toHaveAttribute(
      'href',
      '/catalog',
    )

    // Urutan mengikuti respons backend: produksi terbaru lebih dulu.
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('NL-20261110-002'),
      expect.stringContaining('NL-20261101-001'),
      expect.stringContaining('NL-20261020-001'),
      expect.stringContaining('NL-20261015-001'),
    ])

    // Tanggal ditampilkan DD/MM/YYYY dan kedaluwarsa kosong jadi tanda pisah.
    expect(screen.getByText('10/11/2026')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('menampilkan status batch yang sebenarnya dan tidak pernah membuat batch ditarik tampak tersedia', async () => {
    mocks.get.mockResolvedValue({ data: published })
    renderPage()

    await screen.findByRole('heading', { name: 'Keripik Uji' })

    const rows = screen.getAllByRole('row').slice(1)
    const statuses = rows.map(
      (row) => within(row).getAllByRole('cell')[3].textContent,
    )
    expect(statuses).toEqual(['Tersedia', 'Kedaluwarsa', 'Stok Habis', 'Informasi Ditarik'])

    const withdrawnRow = rows.find((row) => row.textContent?.includes('NL-20261015-001'))!
    expect(within(withdrawnRow).queryByText('Tersedia')).not.toBeInTheDocument()
  })

  it('menampilkan nilai gizi hanya bila datanya tersedia dari API', async () => {
    mocks.get.mockResolvedValue({
      data: {
        ...published,
        product: {
          ...published.product,
          nutrition: {
            servingSizeAmount: 250,
            servingSizeUnit: 'ml',
            servingsPerPackage: 4,
            components: [
              { name: 'Protein', amount: 0.5, unit: 'g', akgPercent: 1 },
              { name: 'Vitamin C', akgPercent: 15 },
            ],
          },
        },
      },
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Keripik Uji' })
    expect(screen.getByRole('heading', { name: 'Informasi Nilai Gizi' })).toBeInTheDocument()
    expect(screen.getByText('Takaran Saji')).toBeInTheDocument()
    expect(screen.getByText('250 ml')).toBeInTheDocument()
    expect(screen.getByText('Jumlah Sajian per Kemasan')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Protein')).toBeInTheDocument()
    expect(screen.getByText('0,5 g')).toBeInTheDocument()
    expect(screen.getByText('1% AKG')).toBeInTheDocument()
    expect(screen.getByText('Vitamin C')).toBeInTheDocument()
    expect(screen.getByText('15% AKG')).toBeInTheDocument()
  })

  it('tidak menampilkan tabel nutrisi kosong atau komponen tanpa nilai', async () => {
    mocks.get.mockResolvedValue({
      data: {
        ...published,
        product: {
          ...published.product,
          nutrition: { components: [{ name: 'Protein' }, { name: ' ', amount: undefined }] },
        },
      },
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Keripik Uji' })
    expect(screen.queryByRole('heading', { name: 'Informasi Nilai Gizi' })).not.toBeInTheDocument()
  })

  it('menampilkan dua komponen kemasan secara vertikal dengan nama dan tabel terpisah', async () => {
    mocks.get.mockResolvedValue({
      data: {
        ...published,
        product: {
          ...published.product,
          nutrition: {
            sections: [
              {
                name: 'NUGALOE — Nugget Lele',
                servingSizeAmount: 80,
                servingSizeUnit: 'g',
                servingsPerPackage: 5,
                components: [{ name: 'Protein Lele', amount: 12.5, unit: 'g', akgPercent: 25 }],
              },
              {
                name: 'ALOE VERA SAOS',
                servingSizeAmount: 30,
                servingSizeUnit: 'g',
                servingsPerPackage: 5,
                components: [{ name: 'Gula Saos', amount: 4, unit: 'g' }],
              },
            ],
          },
        },
      },
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Keripik Uji' })
    const tables = screen.getAllByRole('table', { name: 'Kandungan gizi' })
    expect(tables).toHaveLength(2)
    expect(
      screen.getByRole('heading', { name: 'NUGALOE — Nugget Lele', level: 3 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ALOE VERA SAOS', level: 3 })).toBeInTheDocument()
    expect(tables[0].textContent).toContain('Protein Lele')
    expect(tables[1].textContent).toContain('Gula Saos')
    expect(tables[0].textContent).not.toContain('Gula Saos')
    expect(screen.getByText('80 g')).toBeInTheDocument()
    expect(screen.getByText('30 g')).toBeInTheDocument()
    expect(screen.getByText('12,5 g')).toBeInTheDocument()
    expect(screen.getByText('25% AKG')).toBeInTheDocument()
    expect(screen.getByText('4 g')).toBeInTheDocument()
  })

  it('menampilkan tiga komponen kemasan tanpa menggabungkan nilainya', async () => {
    mocks.get.mockResolvedValue({
      data: {
        ...published,
        product: {
          ...published.product,
          nutrition: {
            sections: [
              {
                name: 'Komponen Satu',
                servingSizeAmount: 10,
                servingSizeUnit: 'g',
                components: [{ name: 'Protein Satu', amount: 1, unit: 'g' }],
              },
              {
                name: 'Komponen Dua',
                servingSizeAmount: 20,
                servingSizeUnit: 'g',
                components: [{ name: 'Serat Dua', amount: 2, unit: 'g' }],
              },
              {
                name: 'Komponen Tiga',
                servingSizeAmount: 30,
                servingSizeUnit: 'g',
                components: [{ name: 'Natrium Tiga', amount: 3, unit: 'mg' }],
              },
            ],
          },
        },
      },
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Keripik Uji' })
    const tables = screen.getAllByRole('table', { name: 'Kandungan gizi' })
    expect(tables).toHaveLength(3)
    expect(tables.map((table) => table.textContent)).toEqual([
      expect.stringContaining('Protein Satu'),
      expect.stringContaining('Serat Dua'),
      expect.stringContaining('Natrium Tiga'),
    ])
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3)
  })

  it('produk lama satu tabel dan satu section tetap tampil tanpa nama komponen', async () => {
    mocks.get.mockResolvedValue({
      data: {
        ...published,
        product: {
          ...published.product,
          nutrition: {
            servingSizeAmount: 250,
            servingSizeUnit: 'ml',
            components: [{ name: 'Protein Lama', amount: 0.5, unit: 'g' }],
          },
        },
      },
    })
    renderPage('p-lama')

    await screen.findByRole('heading', { name: 'Keripik Uji' })
    expect(screen.getAllByRole('table', { name: 'Kandungan gizi' })).toHaveLength(1)
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
    expect(screen.getByText('Protein Lama')).toBeInTheDocument()
    expect(screen.getByText('250 ml')).toBeInTheDocument()

    mocks.get.mockResolvedValue({
      data: {
        ...published,
        product: {
          ...published.product,
          nutrition: {
            sections: [
              {
                name: 'Nama yang tidak perlu',
                servingSizeAmount: 60,
                servingSizeUnit: 'g',
                components: [{ name: 'Protein Tunggal', amount: 2, unit: 'g' }],
              },
            ],
          },
        },
      },
    })
    renderPage('p-satu-section')
    await waitFor(() => {
      expect(screen.getAllByRole('table', { name: 'Kandungan gizi' })).toHaveLength(2)
    })
    expect(screen.queryByText('Nama yang tidak perlu')).not.toBeInTheDocument()
  })

  it('komponen tanpa data gizi tidak menampilkan tabel kosong', async () => {
    mocks.get.mockResolvedValue({
      data: {
        ...published,
        product: {
          ...published.product,
          nutrition: {
            sections: [
              {
                name: 'Komponen Terisi',
                servingSizeAmount: 45,
                servingSizeUnit: 'g',
                components: [{ name: 'Protein Ada', amount: 3, unit: 'g' }],
              },
              { name: 'Komponen Kosong', components: [{ name: 'Protein Kosong' }] },
            ],
          },
        },
      },
    })
    renderPage()

    await screen.findByRole('heading', { name: 'Keripik Uji' })
    expect(screen.getAllByRole('table', { name: 'Kandungan gizi' })).toHaveLength(1)
    expect(screen.getByText('Protein Ada')).toBeInTheDocument()
    expect(screen.queryByText('Komponen Kosong')).not.toBeInTheDocument()
    expect(screen.queryByText('Protein Kosong')).not.toBeInTheDocument()
  })

  it('menampilkan pesan yang jelas untuk produk tanpa batch', async () => {
    mocks.get.mockResolvedValue({
      data: {
        ...published,
        product: { name: 'Produk Baru', unit: 'pcs' },
        batches: [],
      },
    })
    renderPage('p2')

    expect(await screen.findByRole('heading', { name: 'Produk Baru' })).toBeInTheDocument()
    expect(screen.getByText('Belum ada catatan batch untuk produk ini.')).toBeInTheDocument()
    expect(screen.getByText('0 batch')).toBeInTheDocument()
  })

  it('menampilkan halaman tidak tersedia untuk produk nonaktif atau tidak dikenal', async () => {
    mocks.get.mockRejectedValue({
      response: {
        status: 404,
        data: { message: 'Informasi produk tidak tersedia atau produk belum dipublikasikan.' },
      },
    })
    renderPage('tidak-ada')

    expect(
      await screen.findByRole('heading', { name: 'Informasi Produk Tidak Tersedia' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Informasi produk tidak tersedia atau produk belum dipublikasikan.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lihat Katalog' })).toHaveAttribute('href', '/catalog')
  })

  it('menunggu data sebelum menampilkan halaman produk', async () => {
    mocks.get.mockReturnValue(new Promise(() => undefined))
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Memuat informasi produk...')).toBeInTheDocument()
    })
  })
})

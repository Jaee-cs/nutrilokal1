import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProductionPage } from './ProductionPage'
import { formStateKey, readFormState, writeFormState } from '../lib/form-state'
import { addDaysToDateCode, todayDateCode } from '../utils/dates'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  userId: 'u1',
  role: 'ADMIN' as 'ADMIN' | 'OPERATOR',
  productions: [] as unknown[],
  materials: [] as unknown[],
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
    user: { id: mocks.userId, username: 'admin', name: 'Admin Uji', role: mocks.role },
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
      return Promise.resolve({ data: { data: mocks.materials } })
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
  localStorage.clear()
  mocks.userId = 'u1'
  mocks.role = 'ADMIN'
  mocks.productions = []
  mocks.materials = []
  mockApi()
  mocks.notify.confirm.mockResolvedValue(true)
})

const readAnyFormState = (userId: string, formKey: 'production' | 'sales') =>
  readFormState(userId, formKey, (raw) => raw)

function validProductionSnapshot() {
  return {
    form: {
      productId: 'p1',
      productionDate: '2026-10-01',
      expiryDate: '2026-12-01',
      yieldQuantity: '10',
    },
    usageRows: [
      { rowId: 'row-uji', materialId: '', materialQty: '', unit: '', fromRecipe: false },
    ],
    manualEdited: false,
    recalcNotice: false,
  }
}

describe('ProductionPage - resep bahan baku dan konversi satuan', () => {
  const recipeProduct = {
    id: 'p-recipe',
    name: 'Produk Resep',
    unit: 'pcs',
    isActive: true,
    recipe: [
      {
        materialId: 'm-berat',
        material: { id: 'm-berat', name: 'Tepung', unit: 'kg', isActive: true },
        quantityPerUnit: 150,
        recipeUnit: 'g',
      },
      {
        materialId: 'm-volume',
        material: { id: 'm-volume', name: 'Susu', unit: 'L', isActive: true },
        quantityPerUnit: 250,
        recipeUnit: 'ml',
      },
    ],
  }

  const recipeMaterials = [
    { id: 'm-berat', name: 'Tepung', unit: 'kg', isActive: true, stock: 10 },
    { id: 'm-volume', name: 'Susu', unit: 'L', isActive: true, stock: 5 },
    { id: 'm-lain', name: 'Minyak', unit: 'L', isActive: true, stock: 3 },
  ]

  function mockRecipeApi() {
    mocks.get.mockImplementation((url: string) => {
      if (url === '/products') return Promise.resolve({ data: { data: [recipeProduct] } })
      if (url === '/materials') return Promise.resolve({ data: { data: recipeMaterials } })
      if (url === '/productions') return Promise.resolve({ data: { data: [] } })
      if (url === '/batches') return Promise.resolve({ data: { data: [] } })
      return Promise.reject(new Error(`URL tidak di-mock: ${url}`))
    })
  }

  it('memuat resep otomatis dan menghitung jumlah sesuai hasil produksi', async () => {
    mockRecipeApi()
    const user = userEvent.setup()
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Produk Resep/ })

    await user.selectOptions(screen.getByLabelText('Produk'), 'p-recipe')

    // Sebelum hasil diisi, jumlah ditampilkan per 1 unit produk.
    expect(screen.getAllByLabelText('Jumlah Digunakan')[0]).toHaveValue(150)
    expect(screen.getAllByLabelText('Jumlah Digunakan')[1]).toHaveValue(250)
    expect(screen.getAllByLabelText('Satuan')[0]).toHaveValue('g')
    expect(screen.getAllByLabelText('Satuan')[1]).toHaveValue('ml')

    fireEvent.change(screen.getByLabelText('Jumlah Hasil'), { target: { value: '2' } })

    expect(screen.getAllByLabelText('Jumlah Digunakan')[0]).toHaveValue(300)
    expect(screen.getAllByLabelText('Jumlah Digunakan')[1]).toHaveValue(500)
  })

  it('perubahan hasil tidak menimpa penyesuaian manual dan menyediakan hitung ulang', async () => {
    mockRecipeApi()
    const user = userEvent.setup()
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Produk Resep/ })

    await user.selectOptions(screen.getByLabelText('Produk'), 'p-recipe')
    fireEvent.change(screen.getByLabelText('Jumlah Hasil'), { target: { value: '2' } })

    const firstQty = screen.getAllByLabelText('Jumlah Digunakan')[0]
    fireEvent.change(firstQty, { target: { value: '999' } })

    fireEvent.change(screen.getByLabelText('Jumlah Hasil'), { target: { value: '3' } })

    // Nilai manual dipertahankan, bukan ditimpa otomatis.
    expect(screen.getAllByLabelText('Jumlah Digunakan')[0]).toHaveValue(999)
    expect(screen.getAllByLabelText('Jumlah Digunakan')[1]).toHaveValue(500)
    expect(
      screen.getByText(/Perhitungan bahan disesuaikan manual dan tidak ditimpa otomatis/i)
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hitung Ulang dari Resep' }))

    expect(screen.getAllByLabelText('Jumlah Digunakan')[0]).toHaveValue(450)
    expect(screen.getAllByLabelText('Jumlah Digunakan')[1]).toHaveValue(750)
    expect(
      screen.queryByText(/Perhitungan bahan disesuaikan manual dan tidak ditimpa otomatis/i)
    ).not.toBeInTheDocument()
  })

  it('mengganti bahan pada baris resep menyesuaikan satuan agar tetap valid', async () => {
    mockRecipeApi()
    const user = userEvent.setup()
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Produk Resep/ })

    await user.selectOptions(screen.getByLabelText('Produk'), 'p-recipe')
    await user.selectOptions(screen.getAllByLabelText('Bahan Baku')[0], 'm-lain')

    // Satuan resep g tidak kompatibel dengan bahan baru bersatuan L,
    // sehingga baris memakai satuan stok bahan baru dan dapat diubah.
    const unitField = screen.getAllByLabelText('Satuan')[0]
    expect(unitField).toHaveValue('L')
    expect(unitField.tagName).toBe('SELECT')
    expect(screen.getAllByLabelText('Bahan Baku')[0]).toHaveValue('m-lain')
  })

  it('mengirim baris resep tanpa quantity agar backend yang menghitung', async () => {
    mockRecipeApi()
    const user = userEvent.setup()
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Produk Resep/ })

    await user.selectOptions(screen.getByLabelText('Produk'), 'p-recipe')
    fireEvent.change(screen.getByLabelText('Tanggal Produksi'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Tanggal Kedaluwarsa'), { target: { value: '2026-12-01' } })
    fireEvent.change(screen.getByLabelText('Jumlah Hasil'), { target: { value: '2' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Simpan Produksi' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith(
        '/productions',
        expect.objectContaining({
          yieldQuantity: 2,
          materials: [
            { materialId: 'm-berat', mode: 'recipe' },
            { materialId: 'm-volume', mode: 'recipe' },
          ],
        })
      )
    })
  })

  it('mengirim baris yang disesuaikan sebagai pemakaian manual', async () => {
    mockRecipeApi()
    const user = userEvent.setup()
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Produk Resep/ })

    await user.selectOptions(screen.getByLabelText('Produk'), 'p-recipe')
    fireEvent.change(screen.getByLabelText('Tanggal Produksi'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Tanggal Kedaluwarsa'), { target: { value: '2026-12-01' } })
    fireEvent.change(screen.getByLabelText('Jumlah Hasil'), { target: { value: '2' } })
    fireEvent.change(screen.getAllByLabelText('Jumlah Digunakan')[0], { target: { value: '999' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Simpan Produksi' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith(
        '/productions',
        expect.objectContaining({
          materials: [
            { materialId: 'm-berat', mode: 'manual', quantity: 999, unit: 'g' },
            { materialId: 'm-volume', mode: 'recipe' },
          ],
        })
      )
    })
  })

  it('bahan Manual tidak ditarik otomatis dari resep dan dicatat apa adanya', async () => {
    const manualProduct = {
      id: 'p-manual',
      name: 'Produk Manual',
      unit: 'pcs',
      isActive: true,
      recipe: [
        {
          materialId: 'm-manual',
          material: { id: 'm-manual', name: 'Kemasan', unit: 'bungkus', isActive: true },
          quantityPerUnit: 2,
          recipeUnit: 'bungkus',
        },
      ],
    }
    mocks.get.mockImplementation((url: string) => {
      if (url === '/products') return Promise.resolve({ data: { data: [manualProduct] } })
      if (url === '/materials') {
        return Promise.resolve({
          data: {
            data: [
              {
                id: 'm-manual',
                name: 'Kemasan',
                unit: 'bungkus',
                isManual: true,
                isActive: true,
                stock: 5,
              },
            ],
          },
        })
      }
      if (url === '/productions') return Promise.resolve({ data: { data: [] } })
      if (url === '/batches') return Promise.resolve({ data: { data: [] } })
      return Promise.reject(new Error(`URL tidak di-mock: ${url}`))
    })

    const user = userEvent.setup()
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Produk Manual/ })
    await user.selectOptions(screen.getByLabelText('Produk'), 'p-manual')

    // Jumlah tidak diisi otomatis dari resep; satuan dipertahankan persis.
    expect(screen.getByLabelText('Jumlah Digunakan')).toHaveValue(null)
    expect(screen.getByLabelText('Satuan')).toHaveValue('bungkus')
    expect(screen.getByText(/Satuan Manual dicatat apa adanya, tanpa konversi/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Tanggal Produksi'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Tanggal Kedaluwarsa'), { target: { value: '2026-12-01' } })
    fireEvent.change(screen.getByLabelText('Jumlah Hasil'), { target: { value: '2' } })

    // Validasi frontend menolak jumlah kosong sebelum request dikirim.
    fireEvent.submit(screen.getByRole('button', { name: 'Simpan Produksi' }).closest('form')!)
    await waitFor(() => expect(mocks.notify.error).toHaveBeenCalled())
    expect(mocks.post).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Jumlah Digunakan'), { target: { value: '3' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Simpan Produksi' }).closest('form')!)

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith(
        '/productions',
        expect.objectContaining({
          materials: [{ materialId: 'm-manual', mode: 'manual', quantity: 3, unit: 'bungkus' }],
        })
      )
    })
  })
})

describe('ProductionPage - tanggal kedaluwarsa', () => {
  it('menyediakan input tanggal kedaluwarsa wajib setelah tanggal produksi', async () => {
    render(<ProductionPage />)

    expect(await screen.findByRole('option', { name: /Keripik Uji/ })).toBeInTheDocument()
    const productionDate = screen.getByLabelText('Tanggal Produksi')
    const expiryDate = screen.getByLabelText('Tanggal Kedaluwarsa')

    expect(productionDate).toBeRequired()
    expect(expiryDate).toBeRequired()
    // Tanggal produksi default hari ini (WIB); kedaluwarsa harus setelahnya.
    const today = todayDateCode()
    expect(productionDate).toHaveValue(today.split('-').reverse().join('/'))
    expect(expiryDate).toHaveValue('')
    expect(expiryDate).toHaveAttribute('min', addDaysToDateCode(today, 1))

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

describe('ProductionPage - pemulihan isian lokal', () => {
  function expectRestoredForm() {
    expect(screen.getByLabelText('Produk')).toHaveValue('p1')
    expect(screen.getByLabelText('Tanggal Produksi')).toHaveValue('01/10/2026')
    expect(screen.getByLabelText('Tanggal Kedaluwarsa')).toHaveValue('01/12/2026')
    expect(screen.getByLabelText('Jumlah Hasil')).toHaveValue(10)
  }

  it('memulihkan isian setelah halaman ditutup dan dibuka lagi', async () => {
    writeFormState('u1', 'production', validProductionSnapshot())

    const first = render(<ProductionPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })
    expectRestoredForm()
    first.unmount()

    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })
    expectRestoredForm()
  })

  it('menyimpan perubahan dengan debounce dan memisahkan isian antar akun', async () => {
    const first = render(<ProductionPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })

    fireEvent.change(screen.getByLabelText('Jumlah Hasil'), { target: { value: '7' } })
    await waitFor(() => {
      expect(readAnyFormState('u1', 'production')).toMatchObject({
        form: { yieldQuantity: '7' },
      })
    }, { timeout: 2000 })
    expect(readAnyFormState('u2', 'production')).toBeNull()

    first.unmount()
    mocks.userId = 'u2'
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })
    expect(screen.getByLabelText('Jumlah Hasil')).toHaveValue(null)
    expect(readAnyFormState('u1', 'production')).toMatchObject({
      form: { yieldQuantity: '7' },
    })
    expect(localStorage.getItem(formStateKey('u1', 'sales'))).toBeNull()
  })

  it('menyimpan ketikan terakhir saat halaman dibongkar sebelum debounce selesai', async () => {
    const first = render(<ProductionPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })

    fireEvent.change(screen.getByLabelText('Jumlah Hasil'), { target: { value: '9' } })
    first.unmount()

    expect(readAnyFormState('u1', 'production')).toMatchObject({
      form: { yieldQuantity: '9' },
    })
  })

  it('mempertahankan isian saat transaksi gagal', async () => {
    writeFormState('u1', 'production', validProductionSnapshot())
    mocks.post.mockRejectedValueOnce(new Error('Gagal menyimpan'))
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })

    fireEvent.submit(screen.getByRole('button', { name: 'Simpan Produksi' }).closest('form')!)

    await waitFor(() => expect(mocks.notify.error).toHaveBeenCalled())
    expectRestoredForm()
    expect(readAnyFormState('u1', 'production')).toMatchObject({
      form: { yieldQuantity: '10' },
    })
  })

  it('menghapus isian dan tidak menimpa ulang setelah transaksi berhasil', async () => {
    writeFormState('u1', 'production', validProductionSnapshot())
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })

    fireEvent.submit(screen.getByRole('button', { name: 'Simpan Produksi' }).closest('form')!)

    await waitFor(() => expect(mocks.notify.success).toHaveBeenCalled())
    expect(screen.getByLabelText('Jumlah Hasil')).toHaveValue(null)
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(readAnyFormState('u1', 'production')).toBeNull()
  })

  it('meminta konfirmasi sebelum mengosongkan form', async () => {
    writeFormState('u1', 'production', validProductionSnapshot())
    const user = userEvent.setup()
    render(<ProductionPage />)
    await screen.findByRole('option', { name: /Keripik Uji/ })

    mocks.notify.confirm.mockResolvedValueOnce(false)
    await user.click(screen.getByRole('button', { name: 'Kosongkan Form' }))
    expectRestoredForm()

    mocks.notify.confirm.mockResolvedValueOnce(true)
    await user.click(screen.getByRole('button', { name: 'Kosongkan Form' }))
    expect(screen.getByLabelText('Jumlah Hasil')).toHaveValue(null)
    await waitFor(() => expect(readAnyFormState('u1', 'production')).toBeNull())
  })

  it('memberi tahu referensi invalid tanpa menghapus isian lain', async () => {
    mocks.materials = [
      { id: 'm1', name: 'Tepung', unit: 'kg', isActive: true, stock: 1 },
    ]
    const snapshot = validProductionSnapshot()
    snapshot.form.productId = 'p-hilang'
    snapshot.usageRows = [
      { rowId: 'row-invalid', materialId: 'm-hilang', materialQty: '2', unit: 'kg', fromRecipe: false },
    ]
    writeFormState('u1', 'production', snapshot)

    render(<ProductionPage />)

    expect(await screen.findByText(/Produk pada isian tersimpan sudah tidak tersedia/i)).toBeInTheDocument()
    expect(screen.getByText(/Bahan pada isian tersimpan sudah tidak tersedia/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Produk')).toHaveValue('')
    expect(screen.getByLabelText('Jumlah Hasil')).toHaveValue(10)
    expect(screen.getByLabelText('Jumlah Digunakan')).toHaveValue(2)
  })
})

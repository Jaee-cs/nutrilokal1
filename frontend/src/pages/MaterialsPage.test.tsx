import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MaterialsPage } from './MaterialsPage'
import { dateCodeToDisplay, todayDateCode } from '../utils/dates'

const mocks = vi.hoisted(() => ({
  role: 'ADMIN' as 'ADMIN' | 'OPERATOR',
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
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
    delete: mocks.delete,
  },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

const material = {
  id: 'm1',
  name: 'Sapi Segar',
  unit: 'kg',
  description: 'Daging sapi',
  stock: 12,
  isActive: true,
}

const manualMaterial = {
  id: 'm2',
  name: 'Kemasan Khusus',
  unit: 'bungkus',
  isManual: true,
  stock: 4,
  isActive: true,
}

function mockMaterials() {
  mocks.get.mockImplementation((url: string) => {
    if (url === '/materials') {
      return Promise.resolve({ data: { data: [material, manualMaterial] } })
    }
    return Promise.reject(new Error(`URL tidak di-mock: ${url}`))
  })
}

async function openEditDialog(user: ReturnType<typeof userEvent.setup>, name = 'Sapi Segar') {
  const [button] = await screen.findAllByRole('button', {
    name: `Penyesuaian bahan baku ${name}`,
  })
  await user.click(button)
  return screen.getByRole('dialog', { name: 'Penyesuaian Bahan Baku' })
}

describe('MaterialsPage — modal dan aksi per bahan', () => {
  beforeEach(() => {
    mocks.role = 'ADMIN'
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.patch.mockReset()
    mocks.delete.mockReset()
    Object.values(mocks.notify).forEach((fn) => fn.mockReset())
    mocks.notify.confirm.mockResolvedValue(false)
    mockMaterials()
  })

  it('menampilkan aksi bahan di daftar tanpa tab di luar modal', async () => {
    render(<MaterialsPage />)

    expect((await screen.findAllByText('Sapi Segar')).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Daftar Bahan Baku' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Tambah Bahan' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Tambah Stok' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Penyesuaian bahan baku Sapi Segar' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Arsipkan bahan baku Sapi Segar' }).length).toBeGreaterThan(0)
  })

  it('membuka form tambah bahan sebagai modal terpusat', async () => {
    const user = userEvent.setup()
    render(<MaterialsPage />)

    await user.click(await screen.findByRole('button', { name: 'Tambah Bahan' }))

    const dialog = screen.getByRole('dialog', { name: 'Tambah Bahan Baku' })
    expect(within(dialog).getByLabelText('Nama Bahan')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Jenis Satuan')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Satuan Stok Utama')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Deskripsi (opsional)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Catat saldo awal sekaligus (opsional)')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Tambah Bahan Baku' })).not.toBeInTheDocument()
  })

  it('membuka modal penerimaan dengan bahan yang dipilih sudah terisi', async () => {
    const user = userEvent.setup()
    render(<MaterialsPage />)

    const [stockButton] = await screen.findAllByRole('button', { name: 'Tambah Stok' })
    await user.click(stockButton)

    const dialog = screen.getByRole('dialog', { name: 'Tambah Stok Bahan Baku' })
    expect(within(dialog).getByLabelText('Bahan Baku')).toHaveValue('m1')
    expect(within(dialog).getByLabelText('Jumlah')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Tanggal Penerimaan (opsional)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Catatan (opsional)')).toBeInTheDocument()
  })

  it('pensil membuka satu modal bertab dengan tab Penyesuaian Stok aktif', async () => {
    const user = userEvent.setup()
    render(<MaterialsPage />)

    const dialog = await openEditDialog(user)
    expect(within(dialog).getByRole('tablist')).toBeInTheDocument()
    expect(within(dialog).getByRole('tab', { name: 'Penyesuaian Stok' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    const materialField = within(dialog).getByLabelText('Bahan Baku')
    expect(materialField).toHaveValue('Sapi Segar (kg)')
    expect(materialField).toHaveAttribute('readonly')
    expect(within(dialog).queryByRole('combobox', { name: 'Bahan Baku' })).not.toBeInTheDocument()
    expect(within(dialog).getByLabelText('Jumlah (bertanda)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Alasan')).toBeInTheDocument()
    expect(within(dialog).getByText(/Stok Sapi Segar saat ini: 12 kg/)).toBeInTheDocument()
  })

  it('modal mengikuti bahan pada kartu yang diklik, termasuk saat berpindah tab dan bahan', async () => {
    const user = userEvent.setup()
    render(<MaterialsPage />)

    const first = await openEditDialog(user, 'Sapi Segar')
    expect(within(first).getByLabelText('Bahan Baku')).toHaveValue('Sapi Segar (kg)')
    expect(within(first).getByText(/Stok Sapi Segar saat ini: 12 kg/)).toBeInTheDocument()
    expect(within(first).queryByRole('combobox', { name: 'Bahan Baku' })).not.toBeInTheDocument()
    await user.click(within(first).getByRole('button', { name: 'Batal' }))

    const second = await openEditDialog(user, 'Kemasan Khusus')
    expect(within(second).getByLabelText('Bahan Baku')).toHaveValue('Kemasan Khusus (bungkus)')
    expect(
      within(second).getByText(/Stok Kemasan Khusus saat ini: 4 bungkus/)
    ).toBeInTheDocument()
    expect(within(second).queryByRole('combobox', { name: 'Bahan Baku' })).not.toBeInTheDocument()

    await user.click(within(second).getByRole('tab', { name: 'Penyesuaian Satuan' }))
    expect(within(second).getByLabelText('Bahan Baku')).toHaveValue('Kemasan Khusus')

    await user.click(within(second).getByRole('tab', { name: 'Penyesuaian Stok' }))
    expect(within(second).getByLabelText('Bahan Baku')).toHaveValue('Kemasan Khusus (bungkus)')
    expect(
      within(second).getByText(/Stok Kemasan Khusus saat ini: 4 bungkus/)
    ).toBeInTheDocument()
  })

  it('Penyesuaian Stok mengirim ID bahan dari kartu yang diklik', async () => {
    const user = userEvent.setup()
    mocks.get.mockImplementation((url: string) => {
      if (url === '/materials') return Promise.resolve({ data: { data: [material, manualMaterial] } })
      if (url === '/materials/m2/movements') return Promise.resolve({ data: { data: [] } })
      return Promise.reject(new Error(`URL tidak di-mock: ${url}`))
    })
    mocks.post.mockResolvedValue({ data: {} })

    render(<MaterialsPage />)
    const dialog = await openEditDialog(user, 'Kemasan Khusus')

    await user.type(within(dialog).getByLabelText('Jumlah (bertanda)'), '-1')
    await user.type(within(dialog).getByLabelText('Alasan'), 'Produk rusak')
    await user.click(within(dialog).getByRole('button', { name: 'Catat Penyesuaian' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/stock-adjustments', {
        targetType: 'MATERIAL',
        targetId: 'm2',
        quantity: -1,
        date: todayDateCode(),
        reason: 'Produk rusak',
      })
    )
    expect(mocks.notify.success).toHaveBeenCalledWith('Penyesuaian stok berhasil dicatat')
  })

  it('mengisi tanggal penerimaan dan penyesuaian dengan hari ini secara default', async () => {
    const user = userEvent.setup()
    render(<MaterialsPage />)

    const [stockButton] = await screen.findAllByRole('button', { name: 'Tambah Stok' })
    await user.click(stockButton)
    const receiptDialog = screen.getByRole('dialog', { name: 'Tambah Stok Bahan Baku' })
    expect(within(receiptDialog).getByLabelText('Tanggal Penerimaan (opsional)')).toHaveValue(
      dateCodeToDisplay(todayDateCode()),
    )
    await user.click(within(receiptDialog).getByRole('button', { name: 'Batal' }))

    const dialog = await openEditDialog(user)
    expect(within(dialog).getByLabelText('Tanggal Penyesuaian')).toHaveValue(
      dateCodeToDisplay(todayDateCode()),
    )
  })

  it('mengirim tanggal penyesuaian yang dapat diubah ke backend', async () => {
    const user = userEvent.setup()
    mocks.get.mockImplementation((url: string) => {
      if (url === '/materials') return Promise.resolve({ data: { data: [material] } })
      if (url === '/materials/m1/movements') return Promise.resolve({ data: { data: [] } })
      return Promise.reject(new Error(`URL tidak di-mock: ${url}`))
    })
    mocks.post.mockResolvedValue({ data: {} })

    render(<MaterialsPage />)
    const dialog = await openEditDialog(user)

    await user.type(within(dialog).getByLabelText('Jumlah (bertanda)'), '2')
    fireEvent.change(within(dialog).getByLabelText('Tanggal Penyesuaian'), {
      target: { value: '2026-10-05' },
    })
    await user.type(within(dialog).getByLabelText('Alasan'), 'Koreksi stok opname')

    await user.click(within(dialog).getByRole('button', { name: 'Catat Penyesuaian' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/stock-adjustments', {
        targetType: 'MATERIAL',
        targetId: 'm1',
        quantity: 2,
        date: '2026-10-05',
        reason: 'Koreksi stok opname',
      }),
    )
  })

  it('tetap memakai konfirmasi terpusat sebelum mengarsipkan bahan', async () => {
    const user = userEvent.setup()
    render(<MaterialsPage />)

    const [archiveButton] = await screen.findAllByRole('button', { name: 'Arsipkan bahan baku Sapi Segar' })
    await user.click(archiveButton)

    expect(mocks.notify.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Arsipkan Bahan Baku',
        tone: 'warning',
        confirmLabel: 'Ya, Arsipkan',
      }),
    )
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('form tambah bahan hanya menawarkan Berat/Volume dan input Manual teks bebas', async () => {
    const user = userEvent.setup()
    render(<MaterialsPage />)

    await user.click(await screen.findByRole('button', { name: 'Tambah Bahan' }))
    const dialog = screen.getByRole('dialog', { name: 'Tambah Bahan Baku' })
    const kindField = within(dialog).getByLabelText('Jenis Satuan')
    const unitField = within(dialog).getByLabelText('Satuan Stok Utama')

    expect(within(kindField).getByRole('option', { name: 'Berat' })).toBeInTheDocument()
    expect(within(kindField).getByRole('option', { name: 'Volume' })).toBeInTheDocument()
    expect(within(kindField).getByRole('option', { name: 'Manual' })).toBeInTheDocument()
    expect(unitField.tagName).toBe('SELECT')
    expect(within(unitField).getByRole('group', { name: 'Berat' })).toBeInTheDocument()
    expect(within(unitField).queryByRole('group', { name: 'Volume' })).not.toBeInTheDocument()
    expect(within(unitField).queryByRole('group', { name: 'Jumlah' })).not.toBeInTheDocument()
    expect(within(unitField).getByRole('option', { name: 'g — gram' })).toHaveValue('g')

    await user.selectOptions(within(dialog).getByLabelText('Jenis Satuan'), 'volume')
    expect(within(unitField).getByRole('group', { name: 'Volume' })).toBeInTheDocument()
    expect(within(unitField).getByRole('option', { name: 'L — liter' })).toHaveValue('L')

    await user.selectOptions(within(dialog).getByLabelText('Jenis Satuan'), 'manual')
    expect(within(dialog).getByLabelText('Satuan Stok Utama').tagName).toBe('INPUT')
    await user.type(within(dialog).getByLabelText('Satuan Stok Utama'), 'ikat')
    expect(within(dialog).getByLabelText('Satuan Stok Utama')).toHaveValue('ikat')
  })

  it('Admin mengonversi Berat yang kompatibel setelah konfirmasi', async () => {
    const user = userEvent.setup()
    mocks.get.mockImplementation((url: string) => {
      if (url === '/materials') return Promise.resolve({ data: { data: [material] } })
      if (url === '/materials/m1/movements') return Promise.resolve({ data: { data: [] } })
      return Promise.reject(new Error(`URL tidak di-mock: ${url}`))
    })
    mocks.post.mockResolvedValue({ data: { currentStock: '12000.000' } })
    mocks.notify.confirm.mockResolvedValue(true)

    render(<MaterialsPage />)
    const dialog = await openEditDialog(user)
    await user.click(within(dialog).getByRole('tab', { name: 'Penyesuaian Satuan' }))

    expect(within(dialog).getByLabelText('Satuan Saat Ini')).toHaveValue('kg')
    const target = within(dialog).getByLabelText('Satuan Tujuan')
    expect(within(target).queryByRole('option', { name: 'L — liter' })).not.toBeInTheDocument()

    await user.selectOptions(target, 'g')
    expect(within(dialog).getByText(/12 kg → 12000 g/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Terapkan Konversi' }))

    expect(mocks.notify.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Konfirmasi Perubahan Satuan' }),
    )
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/materials/m1/unit-change', {
        newUnit: 'g',
        unitKind: 'mass',
      }),
    )
    expect(mocks.notify.success).toHaveBeenCalledWith(
      expect.stringContaining('Stok menjadi 12000 g')
    )
  })

  it('perubahan ke Manual meminta stok eksplisit dan alasan sebelum konfirmasi', async () => {
    const user = userEvent.setup()
    mocks.post.mockResolvedValue({ data: { currentStock: '10.000' } })
    mocks.notify.confirm.mockResolvedValue(true)

    render(<MaterialsPage />)
    const dialog = await openEditDialog(user)
    await user.click(within(dialog).getByRole('tab', { name: 'Penyesuaian Satuan' }))
    await user.selectOptions(within(dialog).getByLabelText('Jenis Satuan Tujuan'), 'manual')
    await user.type(within(dialog).getByLabelText('Satuan Tujuan'), 'dus')
    await user.type(within(dialog).getByLabelText('Stok Aktual di Satuan Baru'), '10')
    await user.type(within(dialog).getByLabelText('Alasan Penyesuaian'), 'Stok opname')

    await user.click(within(dialog).getByRole('button', { name: 'Terapkan Penyesuaian' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/materials/m1/unit-change', {
        newUnit: 'dus',
        unitKind: 'manual',
        adjustment: { quantity: 10, reason: 'Stok opname' },
      }),
    )
    expect(mocks.notify.success).toHaveBeenCalledWith(
      expect.stringContaining('tanpa konversi')
    )
  })

  it('Operator tetap dapat menambah stok tetapi tidak melihat aksi Admin', async () => {
    mocks.role = 'OPERATOR'
    render(<MaterialsPage />)

    expect((await screen.findAllByText('Sapi Segar')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Tambah Bahan' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Tambah Stok' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Penyesuaian bahan baku Sapi Segar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arsipkan bahan baku Sapi Segar' })).not.toBeInTheDocument()
  })
})

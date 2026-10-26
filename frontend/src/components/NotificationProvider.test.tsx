import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationProvider, useNotify } from './NotificationProvider'

/**
 * Harness kecil yang meniru halaman: formulir berisi input dan tombol yang
 * memicu notifikasi. Dipakai untuk memastikan dialog tidak menghapus isi
 * formulir yang masih valid saat ditutup.
 */
function Harness({
  onConfirmResult,
}: {
  onConfirmResult?: (ok: boolean) => void
}) {
  const notify = useNotify()
  const [name, setName] = useState('')

  return (
    <div>
      <label htmlFor="name">Nama</label>
      <input id="name" value={name} onChange={(event) => setName(event.target.value)} />
      <button type="button" onClick={() => notify.success('Bahan berhasil ditambahkan')}>
        Picu sukses
      </button>
      <button type="button" onClick={() => notify.error('Nama bahan sudah terdaftar')}>
        Picu error
      </button>
      <button
        type="button"
        onClick={() => {
          void notify
            .confirm({
              title: 'Hapus Bahan Baku',
              message: 'Bahan "Singkong" akan dihapus.',
              confirmLabel: 'Ya, Hapus',
              tone: 'danger',
            })
            .then((ok) => onConfirmResult?.(ok))
        }}
      >
        Picu konfirmasi
      </button>
      <button type="button" onClick={() => notify.success('Pesan ganda')}>
        Picu ganda
      </button>
      <button type="button" onClick={() => notify.success('Pesan ganda')}>
        Picu ganda lagi
      </button>
    </div>
  )
}

function renderHarness(onConfirmResult?: (ok: boolean) => void) {
  return render(
    <NotificationProvider>
      <Harness onConfirmResult={onConfirmResult} />
    </NotificationProvider>,
  )
}

describe('NotificationProvider', () => {
  it('menampilkan dialog sukses dan menutupnya lewat tombol OK tanpa menghapus input', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.type(screen.getByLabelText('Nama'), 'Keripik')
    await user.click(screen.getByRole('button', { name: 'Picu sukses' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Bahan berhasil ditambahkan')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Berhasil' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'OK' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nama')).toHaveValue('Keripik')
  })

  it('menampilkan dialog error sebagai alertdialog dengan tombol OK', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByRole('button', { name: 'Picu error' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Nama bahan sudah terdaftar')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Terjadi Kesalahan' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('tidak menjalankan tindakan sebelum tombol konfirmasi ditekan', async () => {
    const user = userEvent.setup()
    const onConfirmResult = vi.fn()
    renderHarness(onConfirmResult)

    await user.click(screen.getByRole('button', { name: 'Picu konfirmasi' }))

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Bahan "Singkong" akan dihapus.')).toBeInTheDocument()
    // Fokus awal berada di Batal agar Enter tidak langsung menghapus.
    expect(screen.getByRole('button', { name: 'Batal' })).toHaveFocus()
    expect(onConfirmResult).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Ya, Hapus' }))

    await waitFor(() => expect(onConfirmResult).toHaveBeenCalledWith(true))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('membatalkan konfirmasi lewat tombol Batal tanpa menjalankan tindakan', async () => {
    const user = userEvent.setup()
    const onConfirmResult = vi.fn()
    renderHarness(onConfirmResult)

    await user.click(screen.getByRole('button', { name: 'Picu konfirmasi' }))
    await user.click(screen.getByRole('button', { name: 'Batal' }))

    await waitFor(() => expect(onConfirmResult).toHaveBeenCalledWith(false))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('menutup dialog informasi dengan Escape tanpa menjalankan aksi', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByRole('button', { name: 'Picu sukses' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Escape pada konfirmasi menghasilkan batal, bukan persetujuan', async () => {
    const user = userEvent.setup()
    const onConfirmResult = vi.fn()
    renderHarness(onConfirmResult)

    await user.click(screen.getByRole('button', { name: 'Picu konfirmasi' }))
    await user.keyboard('{Escape}')

    await waitFor(() => expect(onConfirmResult).toHaveBeenCalledWith(false))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('klik backdrop pada konfirmasi dianggap batal', async () => {
    const user = userEvent.setup()
    const onConfirmResult = vi.fn()
    renderHarness(onConfirmResult)

    await user.click(screen.getByRole('button', { name: 'Picu konfirmasi' }))
    const backdrop = document.querySelector('.notification-backdrop')
    expect(backdrop).not.toBeNull()
    await user.click(backdrop as HTMLElement)

    await waitFor(() => expect(onConfirmResult).toHaveBeenCalledWith(false))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('mencegah dialog berulang untuk pesan yang sama', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByRole('button', { name: 'Picu ganda' }))

    expect(screen.getAllByText('Pesan ganda')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'OK' }))

    // Tidak ada dialog kedua yang antre dari klik ganda/kejadian yang sama.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Pesan ganda')).not.toBeInTheDocument()
  })

  it('mengunci gulir halaman selama dialog terbuka dan memulihkannya saat ditutup', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByRole('button', { name: 'Picu sukses' }))
    expect(document.body.style.overflow).toBe('hidden')

    await user.click(screen.getByRole('button', { name: 'OK' }))
    expect(document.body.style.overflow).toBe('')
  })

  it('mengembalikan fokus ke tombol pemicu setelah dialog ditutup', async () => {
    const user = userEvent.setup()
    renderHarness()

    const trigger = screen.getByRole('button', { name: 'Picu sukses' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'OK' }))

    expect(trigger).toHaveFocus()
  })

  it('menjebak fokus keyboard di dalam dialog konfirmasi', async () => {
    const user = userEvent.setup()
    renderHarness()

    await user.click(screen.getByRole('button', { name: 'Picu konfirmasi' }))
    expect(screen.getByRole('button', { name: 'Batal' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Ya, Hapus' })).toHaveFocus()

    // Tab dari tombol terakhir kembali ke tombol pertama, tidak keluar dialog.
    await user.tab()
    expect(screen.getByRole('button', { name: 'Batal' })).toHaveFocus()

    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Ya, Hapus' })).toHaveFocus()
  })
})

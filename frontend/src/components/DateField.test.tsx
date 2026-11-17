import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateField, type DateFieldProps } from './DateField'

function Harness({ initial = '', ...props }: Partial<DateFieldProps> & { initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <DateField id="tanggal" value={value} onChange={setValue} {...props} />
      <output data-testid="value">{value}</output>
    </>
  )
}

describe('DateField', () => {
  it('menampilkan kode tanggal sebagai DD/MM/YYYY', () => {
    render(<Harness initial="2026-11-17" />)
    expect(screen.getByRole('textbox')).toHaveValue('17/11/2026')
  })

  it('mengizinkan ketikan manual dengan garis miring otomatis', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByRole('textbox')

    await user.type(input, '20112026')

    expect(input).toHaveValue('20/11/2026')
    expect(screen.getByTestId('value')).toHaveTextContent('2026-11-20')
  })

  it('menerima nilai ISO (tempel/otomatisasi) tanpa mengubah nilai tersimpan', () => {
    render(<Harness />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: '2026-12-01' } })

    expect(input).toHaveValue('01/12/2026')
    expect(screen.getByTestId('value')).toHaveTextContent('2026-12-01')
  })

  it('memilih tanggal lewat kalender dan menutup popover', async () => {
    const user = userEvent.setup()
    render(<Harness initial="2026-11-17" />)

    await user.click(screen.getByRole('button', { name: 'Buka kalender' }))
    const dialog = screen.getByRole('dialog', { name: 'Pilih tanggal' })
    expect(dialog).toHaveTextContent('November 2026')

    await user.click(screen.getByRole('button', { name: '20/11/2026' }))

    expect(screen.getByTestId('value')).toHaveTextContent('2026-11-20')
    expect(screen.getByRole('textbox')).toHaveValue('20/11/2026')
    expect(screen.queryByRole('dialog', { name: 'Pilih tanggal' })).not.toBeInTheDocument()
  })

  it('menonaktifkan tanggal di luar batas min dan meneruskan atribut batas', async () => {
    const user = userEvent.setup()
    render(<Harness initial="2026-11-18" min="2026-11-18" max="2026-11-20" />)
    const input = screen.getByRole('textbox')

    expect(input).toHaveAttribute('min', '2026-11-18')
    expect(input).toHaveAttribute('max', '2026-11-20')

    await user.click(screen.getByRole('button', { name: 'Buka kalender' }))
    expect(screen.getByRole('button', { name: '17/11/2026' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '21/11/2026' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '18/11/2026' })).toBeEnabled()
  })

  it('mengosongkan tanggal hanya bila tidak wajib', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness initial="2026-11-17" />)

    await user.click(screen.getByRole('button', { name: 'Buka kalender' }))
    await user.click(screen.getByRole('button', { name: 'Hapus' }))

    expect(screen.getByTestId('value')).toHaveTextContent('')
    expect(screen.getByRole('textbox')).toHaveValue('')

    unmount()

    render(<Harness initial="2026-11-17" required />)
    await user.click(screen.getByRole('button', { name: 'Buka kalender' }))
    expect(screen.queryByRole('button', { name: 'Hapus' })).not.toBeInTheDocument()
  })

  it('menutup kalender dengan tombol Escape', async () => {
    const user = userEvent.setup()
    render(<Harness initial="2026-11-17" />)

    await user.click(screen.getByRole('button', { name: 'Buka kalender' }))
    expect(screen.getByRole('dialog', { name: 'Pilih tanggal' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Pilih tanggal' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('menandai ketikan tanggal yang tidak valid', () => {
    render(<Harness />)
    const input = screen.getByRole('textbox')

    fireEvent.change(input, { target: { value: '31022026' } })
    fireEvent.blur(input)

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('value')).toHaveTextContent('')
  })
})

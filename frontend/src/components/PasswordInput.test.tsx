import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PasswordInput } from './PasswordInput'

describe('PasswordInput', () => {
  it('menyembunyikan kata sandi secara default', () => {
    render(<PasswordInput id="p" value="rahasia" onChange={() => {}} />)

    const input = screen.getByDisplayValue('rahasia')
    expect(input).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Tampilkan kata sandi' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('berganti ke teks tanpa mengubah nilai dan dapat disembunyikan lagi', async () => {
    const user = userEvent.setup()
    render(
      <PasswordInput id="p" value="rahasia" onChange={() => {}} visibilityLabel="kata sandi baru" />,
    )

    const input = screen.getByDisplayValue('rahasia')
    const show = screen.getByRole('button', { name: 'Tampilkan kata sandi baru' })
    expect(show).toHaveAttribute('aria-controls', 'p')

    await user.click(show)
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue('rahasia')
    expect(screen.getByRole('button', { name: 'Sembunyikan kata sandi baru' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Sembunyikan kata sandi baru' }))
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveValue('rahasia')
  })

  it('menjaga status visibilitas setiap instance tetap independen', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <PasswordInput id="a" value="satu" onChange={() => {}} visibilityLabel="password baru" />
        <PasswordInput id="b" value="dua" onChange={() => {}} visibilityLabel="konfirmasi" />
      </div>,
    )

    const first = screen.getByDisplayValue('satu')
    const second = screen.getByDisplayValue('dua')

    await user.click(screen.getByRole('button', { name: 'Tampilkan password baru' }))

    expect(first).toHaveAttribute('type', 'text')
    expect(second).toHaveAttribute('type', 'password')
  })
})

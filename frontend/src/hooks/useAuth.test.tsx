import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from './useAuth'
import { UNAUTHORIZED_EVENT } from '../lib/api'
import { readFormState, writeFormState } from '../lib/form-state'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('../lib/api', () => ({
  default: { get: mocks.get },
  UNAUTHORIZED_EVENT: 'nutrilokal:unauthorized',
}))

function Consumer() {
  const { status, logout } = useAuth()
  return (
    <div>
      <span>{status}</span>
      <button onClick={logout}>Logout</button>
    </div>
  )
}

const readAny = (userId: string, formKey: 'production' | 'sales') =>
  readFormState(userId, formKey, (raw) => raw)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.get.mockResolvedValue({
    data: {
      user: {
        id: 'u1',
        username: 'admin',
        name: 'Admin Uji',
        role: 'ADMIN',
        mustChangePassword: false,
      },
    },
  })
})

async function renderAuthenticated() {
  localStorage.setItem('nutrilokal_token', 'token-uji')
  writeFormState('u1', 'production', { yield: '10' })
  writeFormState('u1', 'sales', [{ batch: 'b1' }])
  writeFormState('u2', 'production', { yield: '20' })
  render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>
  )
  await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument())
}

describe('useAuth - pembersihan isian form saat sesi berakhir', () => {
  it('logout menghapus isian form akun yang sedang login saja', async () => {
    await renderAuthenticated()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Logout' }))

    expect(readAny('u1', 'production')).toBeNull()
    expect(readAny('u1', 'sales')).toBeNull()
    expect(readAny('u2', 'production')).toEqual({ yield: '20' })
    expect(localStorage.getItem('nutrilokal_token')).toBeNull()
  })

  it('sesi tidak valid menghapus isian form akun yang sedang login', async () => {
    await renderAuthenticated()

    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    })

    expect(readAny('u1', 'production')).toBeNull()
    expect(readAny('u1', 'sales')).toBeNull()
    expect(readAny('u2', 'production')).toEqual({ yield: '20' })
  })
})

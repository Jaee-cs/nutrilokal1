import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAllFormStates,
  clearFormState,
  clearUserFormStates,
  formStateKey,
  readFormState,
  writeFormState,
} from './form-state'

const identity = (raw: unknown) => raw

beforeEach(() => {
  localStorage.clear()
})

describe('form-state', () => {
  it('memakai kunci terpisah per akun dan jenis form', () => {
    expect(formStateKey('u1', 'production')).toBe('nutrilokal:form-state:u1:production')
    expect(formStateKey('u1', 'sales')).toBe('nutrilokal:form-state:u1:sales')

    expect(writeFormState('u1', 'production', { yield: '10' })).toBe(true)
    expect(writeFormState('u1', 'sales', [{ batch: 'b1' }])).toBe(true)
    expect(writeFormState('u2', 'production', { yield: '20' })).toBe(true)

    expect(readFormState('u1', 'production', identity)).toEqual({ yield: '10' })
    expect(readFormState('u1', 'sales', identity)).toEqual([{ batch: 'b1' }])
    expect(readFormState('u2', 'production', identity)).toEqual({ yield: '20' })
    expect(readFormState('u2', 'sales', identity)).toBeNull()
  })

  it('menghapus isian satu akun tanpa mengubah akun lain', () => {
    writeFormState('u1', 'production', { yield: '10' })
    writeFormState('u1', 'sales', [{ batch: 'b1' }])
    writeFormState('u2', 'production', { yield: '20' })

    clearUserFormStates('u1')

    expect(readFormState('u1', 'production', identity)).toBeNull()
    expect(readFormState('u1', 'sales', identity)).toBeNull()
    expect(readFormState('u2', 'production', identity)).toEqual({ yield: '20' })

    clearFormState('u2', 'production')
    expect(readFormState('u2', 'production', identity)).toBeNull()
  })

  it('membuang data rusak atau struktur tidak valid', () => {
    const key = formStateKey('u1', 'production')
    localStorage.setItem(key, '{bukan-json')
    expect(readFormState('u1', 'production', identity)).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()

    writeFormState('u1', 'production', { yield: '10' })
    expect(readFormState('u1', 'production', () => null)).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('clearAllFormStates hanya menghapus kunci namespace form-state', () => {
    writeFormState('u1', 'production', { yield: '10' })
    writeFormState('u2', 'sales', [{ batch: 'b1' }])
    localStorage.setItem('nutrilokal_token', 'token-uji')

    clearAllFormStates()

    expect(readFormState('u1', 'production', identity)).toBeNull()
    expect(readFormState('u2', 'sales', identity)).toBeNull()
    expect(localStorage.getItem('nutrilokal_token')).toBe('token-uji')
  })
})

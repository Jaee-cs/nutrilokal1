import { describe, expect, it } from 'vitest'
import {
  addDaysToDateCode,
  compareDateCodes,
  dateCodeParts,
  dateCodeToDisplay,
  formatDateInputDigits,
  isoToDateCode,
  isoToDateDisplay,
  isoToDateTimeDisplay,
  isDateCode,
  parseDateInput,
  todayDateCode,
} from './dates'

describe('utilitas tanggal WIB', () => {
  it('menentukan hari ini menurut kalender WIB, bukan zona waktu server', () => {
    // 16 Nov 2026 23:59 WIB — masih tanggal 16.
    expect(todayDateCode(new Date('2026-11-16T16:59:00.000Z'))).toBe('2026-11-16')
    // 17 Nov 2026 00:00 WIB — sudah berganti tanggal.
    expect(todayDateCode(new Date('2026-11-16T17:00:00.000Z'))).toBe('2026-11-17')
    // 17 Nov 2026 23:59 UTC — di WIB sudah tanggal 18.
    expect(todayDateCode(new Date('2026-11-17T23:59:00.000Z'))).toBe('2026-11-18')
  })

  it('membaca dan menampilkan kode tanggal sebagai DD/MM/YYYY', () => {
    expect(dateCodeParts('2026-11-17')).toEqual({ year: 2026, month: 11, day: 17 })
    expect(dateCodeParts('2026-02-30')).toBeNull()
    expect(isDateCode('2026-02-29')).toBe(false)
    expect(isDateCode('2028-02-29')).toBe(true)
    expect(dateCodeToDisplay('2026-01-05')).toBe('05/01/2026')
    expect(dateCodeToDisplay('')).toBe('')
  })

  it('mengubah timestamp ISO menjadi tanggal/jam WIB tanpa geser satu hari', () => {
    // Tengah malam UTC tanggal 17 = pukul 07.00 WIB tanggal 17.
    expect(isoToDateCode('2026-11-17T00:00:00.000Z')).toBe('2026-11-17')
    expect(isoToDateDisplay('2026-11-17T00:00:00.000Z')).toBe('17/11/2026')
    // Pukul 18.00 UTC tanggal 17 = pukul 01.00 WIB tanggal 18.
    expect(isoToDateDisplay('2026-11-17T18:00:00.000Z')).toBe('18/11/2026')
    expect(isoToDateTimeDisplay('2026-11-17T18:05:00.000Z')).toBe('18/11/2026 01:05')
    // Kode tanggal dari API QR publik tidak dianggap timestamp.
    expect(isoToDateDisplay('2026-11-17')).toBe('17/11/2026')
  })

  it('menerima ketikan DD/MM/YYYY, angka polos, dan nilai ISO', () => {
    expect(parseDateInput('17/11/2026')).toBe('2026-11-17')
    expect(parseDateInput('17112026')).toBe('2026-11-17')
    expect(parseDateInput('2026-11-17')).toBe('2026-11-17')
    expect(parseDateInput('31/02/2026')).toBeNull()
    expect(parseDateInput('')).toBeNull()
    expect(parseDateInput('17/11')).toBeNull()
  })

  it('menyisipkan garis miring otomatis saat mengetik', () => {
    expect(formatDateInputDigits('1')).toBe('1')
    expect(formatDateInputDigits('1711')).toBe('17/11')
    expect(formatDateInputDigits('17112026')).toBe('17/11/2026')
    expect(formatDateInputDigits('17/11/2026')).toBe('17/11/2026')
    expect(formatDateInputDigits('17-11-2026')).toBe('17/11/2026')
    expect(formatDateInputDigits('1711202699')).toBe('17/11/2026')
  })

  it('menambah hari melewati batas bulan dan tahun', () => {
    expect(addDaysToDateCode('2026-11-17', 1)).toBe('2026-11-18')
    expect(addDaysToDateCode('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDateCode('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('membandingkan kode tanggal secara kronologis', () => {
    expect(compareDateCodes('2026-11-17', '2026-11-18')).toBe(-1)
    expect(compareDateCodes('2026-11-18', '2026-11-17')).toBe(1)
    expect(compareDateCodes('2026-11-17', '2026-11-17')).toBe(0)
  })
})

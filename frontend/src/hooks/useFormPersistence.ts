import { useCallback, useEffect, useRef } from 'react'
import { clearFormState, writeFormState, type FormStateKey } from '../lib/form-state'

interface Options<T> {
  userId: string | null | undefined
  formKey: FormStateKey
  state: T
  /** Tulis hanya saat form memang berisi isian (bukan form kosong awal). */
  dirty: boolean
  /** Tunggu sampai data master selesai dimuat sebelum menyimpan. */
  enabled?: boolean
  delay?: number
}

/**
 * Menyimpan state form dengan debounce. `clearPersisted` menaikkan generasi
 * supaya timer yang sedang tertunda tidak bisa menulis ulang isian lama
 * setelah transaksi berhasil/reset.
 */
export function useFormPersistence<T>({
  userId,
  formKey,
  state,
  dirty,
  enabled = true,
  delay = 350,
}: Options<T>) {
  const generationRef = useRef(0)
  const latestRef = useRef({ userId, formKey, state, dirty, enabled, generation: 0 })

  useEffect(() => {
    latestRef.current = { userId, formKey, state, dirty, enabled, generation: generationRef.current }
  }, [userId, formKey, state, dirty, enabled])

  const clearPersisted = useCallback(() => {
    generationRef.current += 1
    clearFormState(userId, formKey)
  }, [userId, formKey])

  // Pindah halaman/refresh bisa terjadi sebelum debounce selesai. Tulis
  // isian terakhir saat halaman dibongkar atau pagehide, kecuali state baru
  // saja yang dibatalkan lewat clearPersisted.
  useEffect(() => {
    function flush() {
      const latest = latestRef.current
      if (!latest.enabled || !latest.dirty || !latest.userId) return
      if (latest.generation !== generationRef.current) return
      writeFormState(latest.userId, latest.formKey, latest.state)
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  useEffect(() => {
    if (!enabled || !dirty || !userId) return

    const generation = generationRef.current
    const timer = window.setTimeout(() => {
      if (generationRef.current !== generation) return
      writeFormState(userId, formKey, state)
    }, delay)

    return () => window.clearTimeout(timer)
  }, [userId, formKey, state, dirty, enabled, delay])

  return { clearPersisted }
}

/**
 * Penyimpanan sementara isian form di localStorage.
 *
 * Hanya dipakai oleh form halaman Produksi dan Penjualan. Kuncinya memakai
 * id akun + jenis form supaya isian antar akun dan antar form tidak tertukar.
 * Isian yang disimpan sudah berupa whitelist field form — tidak ada token,
 * kata sandi, maupun data sensitif lain yang ikut tersimpan.
 */

const STORAGE_PREFIX = 'nutrilokal:form-state'
const STATE_VERSION = 1

export const FORM_STATE_KEYS = ['production', 'sales'] as const

export type FormStateKey = (typeof FORM_STATE_KEYS)[number]

interface Envelope<T> {
  version: number
  savedAt: string
  state: T
}

export function formStateKey(userId: string, formKey: FormStateKey): string {
  return `${STORAGE_PREFIX}:${userId}:${formKey}`
}

function parseEnvelope(raw: string): { version: number; state: unknown } | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Envelope<unknown>>
    if (!parsed || typeof parsed !== 'object' || parsed.version !== STATE_VERSION) return null
    if (!('state' in parsed)) return null
    return { version: parsed.version, state: parsed.state }
  } catch {
    return null
  }
}

/**
 * Membaca isian yang tersimpan. Parser dipakai untuk memvalidasi struktur
 * sesuai jenis form; data rusak/versi lama dibuang supaya tidak dipulihkan.
 */
export function readFormState<T>(
  userId: string | null | undefined,
  formKey: FormStateKey,
  parse: (raw: unknown) => T | null
): T | null {
  if (!userId) return null
  const key = formStateKey(userId, formKey)
  let raw: string | null
  try {
    raw = localStorage.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null

  const envelope = parseEnvelope(raw)
  if (!envelope) {
    try {
      localStorage.removeItem(key)
    } catch {
      // localStorage bisa gagal di mode privat; abaikan.
    }
    return null
  }

  const state = parse(envelope.state)
  if (state === null) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Abaikan kegagalan penghapusan.
    }
  }
  return state
}

/** Menulis isian terbaru. Gagal menulis tidak boleh mengganggu pemakaian form. */
export function writeFormState<T>(
  userId: string | null | undefined,
  formKey: FormStateKey,
  state: T
): boolean {
  if (!userId) return false
  const envelope: Envelope<T> = {
    version: STATE_VERSION,
    savedAt: new Date().toISOString(),
    state,
  }
  try {
    localStorage.setItem(formStateKey(userId, formKey), JSON.stringify(envelope))
    return true
  } catch {
    return false
  }
}

/** Menghapus isian satu form untuk satu akun. */
export function clearFormState(
  userId: string | null | undefined,
  formKey: FormStateKey
): void {
  if (!userId) return
  try {
    localStorage.removeItem(formStateKey(userId, formKey))
  } catch {
    // Abaikan kegagalan akses localStorage.
  }
}

/** Menghapus seluruh isian form Produksi dan Penjualan milik satu akun. */
export function clearUserFormStates(userId: string | null | undefined): void {
  if (!userId) return
  FORM_STATE_KEYS.forEach((formKey) => clearFormState(userId, formKey))
}

/**
 * Fallback saat sesi tidak valid dan id akun tidak diketahui. Hanya menghapus
 * kunci dalam namespace form-state ini, tidak menyentuh data localStorage lain.
 */
export function clearAllFormStates(): void {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith(`${STORAGE_PREFIX}:`)) keys.push(key)
    }
    keys.forEach((key) => localStorage.removeItem(key))
  } catch {
    // Abaikan kegagalan akses localStorage.
  }
}

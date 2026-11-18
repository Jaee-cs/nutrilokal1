import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import api, { UNAUTHORIZED_EVENT } from '../lib/api'
import { clearAllFormStates, clearUserFormStates } from '../lib/form-state'

export interface User {
  id: string
  username: string
  role: 'ADMIN' | 'OPERATOR'
  name?: string | null
  mustChangePassword: boolean
  /** Tersedia dari GET /auth/me (toPublicUser backend). */
  createdAt?: string
  /** Belum ada di backend saat ini; dipakai bila suatu hari tersedia. */
  photoUrl?: string | null
}

/**
 * Status sesi:
 * - 'restoring'      : ada token di storage, identitas sedang divalidasi
 *                      ke backend (GET /auth/me) — route guard BELUM boleh
 *                      mengarahkan ke mana pun (tanpa redirect prematur).
 * - 'authenticated'  : sesi aktif. `user` bisa sementara null bila backend
 *                      mengalami gangguan jaringan — token tetap disimpan,
 *                      guard berbasis role yang menuntut role pasti akan
 *                      menahan akses. Pengguna dengan mustChangePassword
 *                      tetap memiliki `user` (dari GET /auth/me) dan
 *                      diarahkan ke halaman Perbarui Password.
 * - 'unauthenticated': tidak ada sesi.
 */
type AuthStatus = 'restoring' | 'authenticated' | 'unauthenticated'

interface AuthContextValue {
  token: string | null
  user: User | null
  status: AuthStatus
  login: (t: string, u: User) => void
  logout: () => void
  /** Perbarui data profil pengguna aktif tanpa mengganti token. */
  updateUser: (u: User) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const TOKEN_KEY = 'nutrilokal_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>(() =>
    localStorage.getItem(TOKEN_KEY) ? 'restoring' : 'unauthenticated'
  )
  // Dipakai saat sesi berakhir: id akun terakhir yang dikenal dipakai untuk
  // menghapus isian form sementara akun itu saja.
  const userIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (user?.id) userIdRef.current = user.id
  }, [user?.id])

  function clearSessionFormState() {
    if (userIdRef.current) clearUserFormStates(userIdRef.current)
    else clearAllFormStates()
    userIdRef.current = null
  }

  // Pemulihan sesi setelah hard refresh: validasi token ke backend
  // lewat GET /auth/me — satu-satunya sumber identitas yang tepercaya.
  useEffect(() => {
    if (!token) {
      setStatus('unauthenticated')
      setUser(null)
      return
    }

    let cancelled = false

    api
      .get('/auth/me')
      .then((res) => {
        if (cancelled) return
        setUser(res.data.user)
        setStatus('authenticated')
      })
      .catch((err: any) => {
        if (cancelled) return
        const httpStatus: number | undefined = err.response?.status

        if (httpStatus === 401) {
          // Token kedaluwarsa/tidak valid/akun nonaktif: akhiri sesi.
          // Interceptor api.ts sudah menghapus token dari storage.
          localStorage.removeItem(TOKEN_KEY)
          clearSessionFormState()
          setToken(null)
          setUser(null)
          setStatus('unauthenticated')
          return
        }

        // Gangguan jaringan/server: jangan hapus sesi karena gagal verifikasi.
        // Halaman yang membutuhkan identitas pasti akan menahan akses sampai
        // pemulihan berikutnya berhasil.
        setUser(null)
        setStatus('authenticated')
      })

    return () => {
      cancelled = true
    }
  }, [token])

  // Sesi tidak valid yang terjadi di tengah pemakaian (token kedaluwarsa
  // saat request berjalan): sinkronkan state dengan storage.
  useEffect(() => {
    if (!token) return
    function onUnauthorized() {
      clearSessionFormState()
      setUser(null)
      setStatus('unauthenticated')
      setToken(null)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [token])

  function login(t: string, u: User) {
    localStorage.setItem(TOKEN_KEY, t)
    userIdRef.current = u.id
    setToken(t)
    setUser(u)
    setStatus('authenticated')
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY)
    clearSessionFormState()
    setToken(null)
    setUser(null)
    setStatus('unauthenticated')
  }

  function updateUser(u: User) {
    // Nama/avatar berubah, identitas dan token tidak.
    setUser(u)
  }

  return (
    <AuthContext.Provider value={{ token, user, status, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

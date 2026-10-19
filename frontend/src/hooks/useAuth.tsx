import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import api, { UNAUTHORIZED_EVENT } from '../lib/api'

interface User {
  id: string
  username: string
  role: 'ADMIN' | 'OPERATOR'
  name?: string | null
}

/**
 * Status sesi:
 * - 'restoring'      : ada token di storage, identitas sedang divalidasi
 *                      ke backend (GET /auth/me) — route guard BELUM boleh
 *                      mengarahkan ke mana pun (tanpa redirect prematur).
 * - 'authenticated'  : sesi aktif. `user` bisa sementara null bila backend
 *                      menjawab 403 PASSWORD_CHANGE_REQUIRED atau gangguan
 *                      jaringan — token tetap disimpan, guard berbasis role
 *                      yang menuntut role pasti akan menahan akses.
 * - 'unauthenticated': tidak ada sesi.
 */
type AuthStatus = 'restoring' | 'authenticated' | 'unauthenticated'

interface AuthContextValue {
  token: string | null
  user: User | null
  status: AuthStatus
  login: (t: string, u: User) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const TOKEN_KEY = 'nutrilokal_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>(() =>
    localStorage.getItem(TOKEN_KEY) ? 'restoring' : 'unauthenticated'
  )

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
          setToken(null)
          setUser(null)
          setStatus('unauthenticated')
          return
        }

        // 403 PASSWORD_CHANGE_REQUIRED: token valid, tetapi seluruh endpoint
        // (kecuali set-password) diblokir backend. Tanpa UI set-password di
        // frontend, sesi dipertahankan — guard role tetap menahan akses
        // halaman Admin karena identitas peran tidak terkonfirmasi.
        // Gangguan jaringan/server: jangan hapus sesi karena gagal verifikasi.
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
      setUser(null)
      setStatus('unauthenticated')
      setToken(null)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [token])

  function login(t: string, u: User) {
    localStorage.setItem(TOKEN_KEY, t)
    setToken(t)
    setUser(u)
    setStatus('authenticated')
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
    setStatus('unauthenticated')
  }

  return (
    <AuthContext.Provider value={{ token, user, status, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

import axios from 'axios'

const TOKEN_KEY = 'nutrilokal_token'

/** Event dipancarkan saat backend menjawab 401 — sesi dianggap tidak valid. */
export const UNAUTHORIZED_EVENT = 'nutrilokal:unauthorized'

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api' })

api.interceptors.request.use((config) => {
  const t = localStorage.getItem(TOKEN_KEY)
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (e) => {
    if (e.response?.status === 401) {
      // Token tidak valid/kedaluwarsa: hapus dari storage dan beri tahu
      // AuthProvider agar state sesi ikut direset (guard tidak basi).
      localStorage.removeItem(TOKEN_KEY)
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    return Promise.reject(e)
  }
)

export default api

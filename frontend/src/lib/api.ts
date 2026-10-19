import axios from 'axios'
const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api' })
api.interceptors.request.use((config) => { const t = localStorage.getItem('nutrilokal_token'); if (t) config.headers.Authorization = `Bearer ${t}`; return config })
api.interceptors.response.use(r => r, e => { if (e.response?.status === 401) localStorage.removeItem('nutrilokal_token'); return Promise.reject(e) })
export default api

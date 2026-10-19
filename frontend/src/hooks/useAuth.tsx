import { createContext, useContext, useState, type ReactNode } from 'react'
interface User { id: string; username: string; role: 'ADMIN'|'OPERATOR'; name?: string|null }
interface AuthContextValue { token: string|null; user: User|null; login: (t:string,u:User)=>void; logout: ()=>void }
const AuthContext = createContext<AuthContextValue|undefined>(undefined)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string|null>(() => localStorage.getItem('nutrilokal_token'))
  const [user, setUser] = useState<User|null>(null)
  function login(t:string,u:User){ localStorage.setItem('nutrilokal_token',t); setToken(t); setUser(u) }
  function logout(){ localStorage.removeItem('nutrilokal_token'); setToken(null); setUser(null) }
  return <AuthContext.Provider value={{token,user,login,logout}}>{children}</AuthContext.Provider>
}
export function useAuth(){ const ctx = useContext(AuthContext); if(!ctx) throw new Error('useAuth must be used within AuthProvider'); return ctx }

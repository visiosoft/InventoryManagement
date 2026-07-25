import { createContext, useContext, useState, type ReactNode } from 'react'
import { api } from './api'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string          // 'admin' | 'staff'
  permissions: string[] // module keys; admins bypass this entirely
  isActive: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  /** Returns true if the current user can access the given module key. Admins always return true. */
  hasPermission: (module: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem('pb_user')
    return raw ? JSON.parse(raw) : null
  })

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password })
    localStorage.setItem('pb_token', data.token)
    localStorage.setItem('pb_user', JSON.stringify(data.user))
    setUser(data.user)
  }

  function logout() {
    localStorage.removeItem('pb_token')
    localStorage.removeItem('pb_user')
    setUser(null)
  }

  function hasPermission(module: string): boolean {
    if (!user) return false
    if (user.role === 'admin') return true
    return user.permissions.includes(module)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

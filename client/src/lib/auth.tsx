import { createContext, useContext, useState, type ReactNode } from 'react'
import { api } from './api'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: string          // 'admin' | 'staff'
  permissions: string[] // module keys; admins with empty list get all access
  isActive: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  /** Returns true if the current user can access the given module key. */
  hasPermission: (module: string | string[]) => boolean
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

  /**
   * An array means any one of them is enough.
   *
   * Needed where a screen was historically reached through another module's
   * permission: giving it a name of its own must not take it away from people
   * who already had it under the old one.
   */
  function hasPermission(module: string | string[]): boolean {
    if (!user) return false
    // An admin with no explicit list gets everything; an admin with a list is
    // held to it, which is why a 17-module admin can be missing a screen.
    if (user.role === 'admin' && !user.permissions?.length) return true
    const wanted = Array.isArray(module) ? module : [module]
    return wanted.some((m) => user.permissions.includes(m))
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

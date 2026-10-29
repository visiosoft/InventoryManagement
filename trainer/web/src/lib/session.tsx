import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, TOKEN_KEY, ORG_KEY } from './api'

export type OrgRef = { id: string; name: string; slug: string; role: string }
export type User = { id: string; email: string; name: string; platformAdmin: boolean; orgs: OrgRef[] }

type Ctx = {
  user: User | null; loading: boolean; orgId: string | null
  signIn: (token: string, user: User) => void; signOut: () => void
  setOrg: (id: string) => void; refresh: () => Promise<void>
}
const SessionContext = createContext<Ctx | null>(null)

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch { /* ignore */ } }

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(Boolean(read(TOKEN_KEY)))
  const [orgId, setOrgId] = useState<string | null>(read(ORG_KEY))

  const pickOrg = useCallback((u: User, preferred: string | null) => {
    const id = u.orgs.some((o) => o.id === preferred) ? preferred : u.orgs[0]?.id ?? null
    write(ORG_KEY, id); setOrgId(id)
  }, [])

  const refresh = useCallback(async () => {
    if (!read(TOKEN_KEY)) { setLoading(false); return }
    try {
      const { data } = await api.get('/auth/me')
      setUser(data.user); pickOrg(data.user, read(ORG_KEY))
    } catch { setUser(null) } finally { setLoading(false) }
  }, [pickOrg])

  useEffect(() => { void refresh() }, [refresh])

  const value: Ctx = {
    user, loading, orgId,
    signIn: (token, u) => { write(TOKEN_KEY, token); setUser(u); pickOrg(u, read(ORG_KEY)) },
    signOut: () => { write(TOKEN_KEY, null); write(ORG_KEY, null); setUser(null); setOrgId(null) },
    setOrg: (id) => { write(ORG_KEY, id); setOrgId(id) },
    refresh,
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession() {
  const c = useContext(SessionContext)
  if (!c) throw new Error('useSession outside SessionProvider')
  return c
}

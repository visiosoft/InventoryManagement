import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'

type U = { _id: string; name: string; email: string; role: string; isActive?: boolean }
const ROLE: Record<string, string> = { admin: 'Admin', accounts_admin: 'Accounts admin', sales_rep: 'Sales', accounts: 'Accounts', staff: 'Staff' }

/**
 * "View as" — top right, admins only. Opens the app exactly as another person
 * sees it so an admin can check how they work, with no password and no way to
 * change anything while looking.
 */
export function ViewAsSwitcher() {
  const { user, viewingAs, viewAs } = useAuth()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const enabled = user?.role === 'admin' && !viewingAs
  const { data } = useQuery<U[]>({ queryKey: ['view-as-users'], queryFn: () => api.get('/users').then((r) => r.data), enabled: enabled && open })

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  if (!enabled) return null

  const list = (data ?? []).filter((u) => u.isActive !== false && u._id !== user?.id
    && `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} title="See the app as another person (view-only)"
        className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-sm font-medium hover:bg-muted/60 cursor-pointer">
        <Eye size={14} /> View as
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl border bg-white shadow-xl p-2" style={{ borderColor: 'rgba(20,8,31,.10)' }}>
          <div className="text-[11px] text-muted-foreground px-2 pb-1.5">View-only. Nothing you do here is saved or sent as them.</div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…"
            className="w-full h-9 rounded-md border px-2.5 text-sm mb-1.5" />
          <div className="max-h-72 overflow-y-auto">
            {!data && <div className="px-2 py-2 text-sm text-muted-foreground">Loading…</div>}
            {data && list.length === 0 && <div className="px-2 py-2 text-sm text-muted-foreground">Nobody found.</div>}
            {list.map((u) => (
              <button key={u._id} onClick={() => viewAs(u._id).catch((e) => setErr(apiError(e)))}
                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/60 cursor-pointer">
                <div className="text-sm font-medium">{u.name}</div>
                <div className="text-[11px] text-muted-foreground">{ROLE[u.role] || u.role} · {u.email}</div>
              </button>
            ))}
          </div>
          {err && <div className="text-xs text-red-600 px-2 pt-1">{err}</div>}
        </div>
      )}
    </div>
  )
}

/** Shown across the top of every page while viewing as someone else. */
export function ViewAsBanner() {
  const { viewingAs, exitViewAs } = useAuth()
  if (!viewingAs) return null
  return (
    <div className="sticky top-0 z-[60] flex items-center justify-center gap-3 px-3 py-2 text-sm font-semibold text-white" style={{ background: '#5B2BC9' }}>
      <Eye size={14} /> Viewing as {viewingAs} — view-only
      <button onClick={exitViewAs} className="rounded-full bg-white/20 hover:bg-white/30 px-3 py-0.5 cursor-pointer">Exit</button>
    </div>
  )
}

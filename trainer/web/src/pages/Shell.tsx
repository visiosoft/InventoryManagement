import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, CheckSquare, BookOpenCheck, Upload, FlaskConical, Settings, Shield, LogOut, GraduationCap, Plus, Menu } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useSession } from '../lib/session'
import { type Me, INK, MUTED, PURPLE, LINE, HEAD } from './theme'

/* The signed-in frame: the organisation being worked on, its pages, and who
   is signed in. Everything below it receives `me` (the organisation and the
   person's role in it). */

const NAV = [
  { to: '/', label: 'Overview', icon: BarChart3, end: true },
  { to: '/review', label: 'Review', icon: CheckSquare },
  { to: '/answers', label: 'Approved answers', icon: BookOpenCheck },
  { to: '/imports', label: 'Conversations', icon: Upload },
  { to: '/tests', label: 'Tests', icon: FlaskConical },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export type OutletCtx = { me: Me }

export default function Shell() {
  const { user, orgId, setOrg, signOut, refresh } = useSession()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const me = useQuery<Me>({ queryKey: ['org', orgId], queryFn: () => api.get('/org').then((r) => r.data), enabled: Boolean(orgId), retry: false })

  const switchOrg = (id: string) => { setOrg(id); qc.clear(); nav('/') }
  async function newOrg() {
    const name = window.prompt('Name of the business (a new customer workspace)')
    if (!name?.trim()) return
    try { const { data } = await api.post('/auth/orgs', { name }); await refresh(); switchOrg(data.org.id) } catch (e) { window.alert(apiError(e)) }
  }

  if (!user) return null
  const link = ({ isActive }: { isActive: boolean }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-semibold ${isActive ? 'bg-[#EFEBFB] text-[#4A2A9E]' : 'text-[#3B3347] hover:bg-[#F6F4FB]'}`

  const sidebar = (
    <aside className="flex h-full flex-col" style={{ width: 236, background: '#fff', borderRight: `1px solid ${LINE}` }}>
      <div className="flex items-center gap-2" style={{ padding: '16px 16px 12px' }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: PURPLE, display: 'grid', placeItems: 'center' }}><GraduationCap size={17} color="#fff" /></span>
        <span style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 15, color: INK }}>AI Training Center</span>
      </div>
      <div style={{ padding: '0 12px 12px' }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: MUTED, textTransform: 'uppercase', margin: '0 4px 4px' }}>Organisation</div>
        <div className="flex gap-1">
          <select value={orgId ?? ''} onChange={(e) => switchOrg(e.target.value)} aria-label="Organisation"
            style={{ flex: 1, minWidth: 0, height: 34, border: `1px solid rgba(20,8,31,.16)`, borderRadius: 9, padding: '0 8px', fontSize: 13, fontWeight: 700, background: '#fff' }}>
            {user.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button type="button" onClick={newOrg} title="New organisation" aria-label="New organisation" style={{ width: 34, height: 34, border: `1px solid ${LINE}`, borderRadius: 9, display: 'grid', placeItems: 'center' }}><Plus size={15} /></button>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5" style={{ padding: '0 10px' }} onClick={() => setOpen(false)}>
        {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={link}><n.icon size={16} /> {n.label}</NavLink>)}
        {user.platformAdmin && <NavLink to="/platform" className={link}><Shield size={16} /> Platform</NavLink>}
      </nav>
      <div style={{ padding: 12, borderTop: `1px solid ${LINE}` }}>
        <div className="truncate" style={{ fontSize: 13, fontWeight: 700, color: INK }}>{user.name || user.email}</div>
        <div className="truncate" style={{ fontSize: 12, color: MUTED }}>{user.email}{me.data ? ` · ${me.data.role}` : ''}</div>
        <button type="button" onClick={() => { signOut(); qc.clear(); nav('/login') }} className="flex items-center gap-1.5" style={{ fontSize: 12.5, color: MUTED, marginTop: 8 }}><LogOut size={13} /> Sign out</button>
      </div>
    </aside>
  )

  return (
    <div className="flex min-h-screen">
      <div className="hidden md:block" style={{ position: 'sticky', top: 0, height: '100vh' }}>{sidebar}</div>
      {open && <div className="fixed inset-0 z-40 flex md:hidden" style={{ background: 'rgba(20,8,31,.3)' }} onClick={() => setOpen(false)}><div onClick={(e) => e.stopPropagation()}>{sidebar}</div></div>}
      <main className="min-w-0 flex-1" style={{ padding: '18px 22px 40px' }}>
        <button type="button" className="md:hidden flex items-center gap-2" onClick={() => setOpen(true)} style={{ marginBottom: 12, fontWeight: 700 }}><Menu size={18} /> {me.data?.org.name}</button>
        {!user.orgs.length ? (
          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 24 }}>You are not in any organisation yet. <button type="button" onClick={newOrg} style={{ color: PURPLE, fontWeight: 700 }}>Create one</button>.</div>
        ) : me.isError ? (
          <div style={{ color: '#B91C1C' }}>{apiError(me.error)}</div>
        ) : me.data ? <Outlet context={{ me: me.data } satisfies OutletCtx} /> : <div style={{ color: MUTED }}>Loading…</div>}
      </main>
    </div>
  )
}

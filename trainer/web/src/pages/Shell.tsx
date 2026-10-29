import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutGrid, CheckSquare, BookOpenCheck, MessagesSquare, FlaskConical, Settings, Shield, LogOut, GraduationCap, Plus, Menu, ChevronDown, ArrowRight, Sparkles, Upload, Building2 } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useSession } from '../lib/session'
import { type Me, INK, MUTED, ACCENT, TINT, panel, btn } from './theme'

/* The signed-in frame: a floating sidebar card, the organisation being worked
   on and its pages, and who is signed in. Everything below receives `me`
   (the organisation and the person's role in it). */

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, end: true },
  { to: '/review', label: 'Review', icon: CheckSquare },
  { to: '/answers', label: 'Approved answers', icon: BookOpenCheck },
  { to: '/imports', label: 'Conversations', icon: MessagesSquare },
  { to: '/tests', label: 'Tests', icon: FlaskConical },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export type OutletCtx = { me: Me }
type Overview = { questions: number; review: Record<string, number>; knowledge: Record<string, number>; activeSnapshot: number; evals: unknown[] }

/** The one thing to do next, from where the organisation actually is. Pure. */
function nextStep(o?: Overview): { title: string; body: string; to: string; cta: string } | null {
  if (!o) return null
  const toReview = (o.review.new ?? 0) + (o.review.suggested ?? 0)
  const waiting = o.knowledge.approved ?? 0
  if (!o.questions) return { title: 'Bring in conversations', body: 'Import real chats to find what customers keep asking.', to: '/imports', cta: 'Import' }
  if (toReview) return { title: `${toReview} question${toReview === 1 ? '' : 's'} to review`, body: 'Approve or edit the answers the AI should give.', to: '/review', cta: 'Start reviewing' }
  if (waiting) return { title: `Publish ${waiting} answer${waiting === 1 ? '' : 's'}`, body: 'Approved answers reach your agents once published.', to: '/answers', cta: 'Publish' }
  if (!o.evals.length) return { title: 'Test your agent', body: 'See how it answers questions kept aside.', to: '/tests', cta: 'Run a test' }
  return { title: 'All caught up', body: 'Import new conversations weekly to keep improving.', to: '/imports', cta: 'Import more' }
}

const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')

export default function Shell() {
  const { user, orgId, setOrg, signOut, refresh } = useSession()
  const qc = useQueryClient()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const me = useQuery<Me>({ queryKey: ['org', orgId], queryFn: () => api.get('/org').then((r) => r.data), enabled: Boolean(orgId), retry: false })
  const ov = useQuery<Overview>({ queryKey: ['overview', orgId], queryFn: () => api.get('/training/overview').then((r) => r.data), enabled: Boolean(me.data) })
  const step = nextStep(ov.data)

  const switchOrg = (id: string) => { setOrg(id); qc.clear(); nav('/') }
  async function newOrg() {
    const name = window.prompt('Name of the business (a new customer workspace)')
    if (!name?.trim()) return
    try { const { data } = await api.post('/auth/orgs', { name }); await refresh(); switchOrg(data.org.id) } catch (e) { window.alert(apiError(e)) }
  }

  if (!user) return null
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] transition-colors ${isActive ? 'font-semibold text-[#2563EB] bg-gradient-to-r from-[#E8F0FF] to-[#F3F7FF] shadow-[0_1px_2px_rgba(15,23,42,.05),inset_0_0_0_1px_rgba(37,99,235,.10)]' : 'font-medium text-[#334155] hover:bg-white/70'}`

  const sidebar = (
    <aside className="flex h-full flex-col" style={{ width: 248, ...panel, borderRadius: 22, padding: '18px 14px' }}>
      <div className="flex items-center gap-2.5" style={{ padding: '2px 8px 18px' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg, #60A5FA, #2563EB)', display: 'grid', placeItems: 'center', boxShadow: '0 6px 14px -6px rgba(37,99,235,.6)' }}><GraduationCap size={18} color="#fff" /></span>
        <span style={{ fontWeight: 700, fontSize: 16, color: INK, letterSpacing: '-.01em' }}>AI Training <span style={{ fontWeight: 500, color: MUTED }}>Center</span></span>
      </div>
      <nav className="flex-1 space-y-1" onClick={() => setOpen(false)}>
        {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={link}><n.icon size={18} strokeWidth={1.8} /> {n.label}</NavLink>)}
        {user.platformAdmin && <NavLink to="/platform" className={link}><Shield size={18} strokeWidth={1.8} /> Platform</NavLink>}
      </nav>
      {step && (
        <div style={{ background: 'linear-gradient(160deg, #F5F8FF, #EAF1FF)', border: '1px solid rgba(37,99,235,.10)', borderRadius: 16, padding: 14, margin: '12px 0' }}>
          <div className="flex items-center gap-2" style={{ fontWeight: 600, fontSize: 13.5, color: INK }}><Sparkles size={15} style={{ color: ACCENT }} /> {step.title}</div>
          <div style={{ fontSize: 12.5, color: MUTED, margin: '6px 0 10px', lineHeight: 1.45 }}>{step.body}</div>
          <Link to={step.to} onClick={() => setOpen(false)} className="flex items-center justify-center gap-1.5" style={{ background: '#fff', borderRadius: 10, padding: '8px 0', fontSize: 13, fontWeight: 600, color: ACCENT, boxShadow: '0 1px 2px rgba(15,23,42,.06)' }}>{step.cta} <ArrowRight size={14} /></Link>
        </div>
      )}
      <div className="relative">
        <button type="button" onClick={() => setMenu(!menu)} className="flex w-full items-center gap-3 rounded-xl text-left hover:bg-white/70" style={{ padding: '8px 8px' }} aria-label="Account menu">
          <span style={{ width: 36, height: 36, borderRadius: 99, background: 'linear-gradient(135deg, #93C5FD, #2563EB)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13 }}>{initials(user.name || user.email)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate" style={{ fontSize: 13.5, fontWeight: 600, color: INK }}>{user.name || user.email}</span>
            <span className="block truncate" style={{ fontSize: 12, color: MUTED, textTransform: 'capitalize' }}>{me.data?.role ?? ''}</span>
          </span>
          <ChevronDown size={16} style={{ color: MUTED }} />
        </button>
        {menu && (
          <div style={{ position: 'absolute', bottom: 52, left: 0, right: 0, ...panel, background: '#fff', padding: 6, zIndex: 10 }}>
            <div className="truncate" style={{ fontSize: 12, color: MUTED, padding: '6px 10px' }}>{user.email}</div>
            <button type="button" onClick={() => { signOut(); qc.clear(); nav('/login') }} className="flex w-full items-center gap-2 rounded-lg hover:bg-[#F1F5F9]" style={{ padding: '8px 10px', fontSize: 13, color: '#DC2626' }}><LogOut size={14} /> Sign out</button>
          </div>
        )}
      </div>
    </aside>
  )

  return (
    <div className="flex min-h-screen" style={{ gap: 22, padding: 18 }}>
      <div className="hidden lg:block" style={{ position: 'sticky', top: 18, height: 'calc(100vh - 36px)' }}>{sidebar}</div>
      {open && <div className="fixed inset-0 z-40 flex lg:hidden" style={{ background: 'rgba(15,23,42,.25)', padding: 12 }} onClick={() => setOpen(false)}><div onClick={(e) => e.stopPropagation()}>{sidebar}</div></div>}
      <main className="min-w-0 flex-1" style={{ paddingBottom: 30 }}>
        <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 20 }}>
          <div className="lg:hidden"><button type="button" onClick={() => setOpen(true)} aria-label="Menu" style={{ width: 40, height: 40, borderRadius: 12, ...panel, display: 'grid', placeItems: 'center' }}><Menu size={18} /></button></div>
          <div className="flex items-center gap-2" style={{ ...panel, borderRadius: 14, padding: '4px 4px 4px 12px', minWidth: 0 }}>
            <Building2 size={16} style={{ color: MUTED, flex: '0 0 auto' }} />
            <select value={orgId ?? ''} onChange={(e) => switchOrg(e.target.value)} aria-label="Organisation"
              style={{ border: 0, background: 'transparent', height: 34, fontSize: 14, fontWeight: 600, color: INK, maxWidth: 260, outline: 'none' }}>
              {user.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button type="button" onClick={newOrg} title="New organisation" aria-label="New organisation" style={{ width: 32, height: 32, borderRadius: 10, background: TINT, color: ACCENT, display: 'grid', placeItems: 'center' }}><Plus size={16} /></button>
          </div>
          <div className="flex-1" />
          {me.data?.permissions.includes('import') && <button type="button" onClick={() => nav('/imports')} style={{ ...btn(true), height: 42, padding: '0 18px', borderRadius: 12, fontSize: 14 }}><Upload size={16} /> Import conversations</button>}
        </div>
        {!user.orgs.length ? (
          <div style={{ ...panel, padding: 24 }}>You are not in any organisation yet. <button type="button" onClick={newOrg} style={{ color: ACCENT, fontWeight: 700 }}>Create one</button>.</div>
        ) : me.isError ? (
          <div style={{ color: '#B91C1C' }}>{apiError(me.error)}</div>
        ) : me.data ? <Outlet context={{ me: me.data } satisfies OutletCtx} /> : <div style={{ color: MUTED }}>Loading…</div>}
      </main>
    </div>
  )
}


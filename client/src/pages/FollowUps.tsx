import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowRight, CalendarDays, CheckSquare, ChevronDown, Eye, Filter, Flame, MessageCircle,
  Search, Sparkles, Square, Star, X, Clock,
} from 'lucide-react'
import { api, followUpQueueApi, leadFollowUpApi, type FollowUpPriority, type FollowUpQueueItem, type FollowUpReason } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Skeleton } from '../components/ui'
import FollowUpDrawer from '../components/FollowUpDrawer'
import FollowUpBulkModal from '../components/FollowUpBulkModal'
import { REASON_UI, whyFor, agoText, initialsOf } from '../lib/followUpUi'

/* ── The design reference's palette, copied ──────────────────────────────── */
const FONT = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif"
const TEXT = '#111827'
const SUB = '#6B7280'
const LINE = '#E5E7EB'
const BRAND = '#6D28D9'          // tab underline, bulk button
const BRAND_DARK = '#5B21B6'
const WA_GREEN = '#16A34A'       // Send button
const WA_ICON = '#22C55E'

const PRIORITY: Record<FollowUpPriority, { label: string; bg: string; fg: string; dot: string }> = {
  high: { label: 'High', bg: '#FEE2E2', fg: '#B91C1C', dot: '#EF4444' },
  medium: { label: 'Medium', bg: '#FEF3C7', fg: '#B45309', dot: '#F59E0B' },
  low: { label: 'Low', bg: '#DCFCE7', fg: '#15803D', dot: '#22C55E' },
}
const INTENT: Record<'hot' | 'warm' | 'cold' | 'none', { label: string; bg: string; fg: string }> = {
  hot: { label: 'High', bg: '#FEE2E2', fg: '#B91C1C' },
  warm: { label: 'Medium', bg: '#FEF3C7', fg: '#B45309' },
  cold: { label: 'Low', bg: '#F3F4F6', fg: '#6B7280' },
  none: { label: '—', bg: '#F3F4F6', fg: '#9CA3AF' },
}
const QUIET_PILL = { bg: '#FFEDD5', fg: '#C2410C' }
const NEEDS_REPLY_PILL = { bg: '#FEE2E2', fg: '#B91C1C' }

type Tab = 'due' | 'needs_reply' | 'overdue' | 'ai' | 'upcoming' | 'hot' | 'completed'

const TABS: { key: Tab; label: string; tone?: string }[] = [
  { key: 'due', label: 'Due Now' },
  { key: 'needs_reply', label: 'Needs Reply', tone: '#B91C1C' },
  { key: 'overdue', label: 'Overdue', tone: '#B91C1C' },
  { key: 'ai', label: 'AI Recommended' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'hot', label: 'Hot Leads' },
  { key: 'completed', label: 'Completed' },
]

const EMPTY: Record<Tab, string> = {
  due: 'No follow-ups due today. Great work — you’re all caught up.',
  needs_reply: 'Nobody is waiting on a reply. Every customer who wrote has been answered.',
  overdue: 'Nothing is overdue.',
  ai: 'No AI recommendations right now — every open thread has been read.',
  upcoming: 'Nothing scheduled for the next 7 days.',
  hot: 'No hot leads need attention right now.',
  completed: 'No follow-ups sent in the last 30 days.',
}

type UpcomingLead = {
  _id: string; fullName: string; phone: string; status: string; temperature?: string
  followUpAt: string; owner?: { name?: string } | null
}
type LogRow = Awaited<ReturnType<typeof leadFollowUpApi.log>>['rows'][number]

function isOverdue(it: FollowUpQueueItem) {
  return (it.reason === 'manual_followup_due' && it.reasonDetail === 'overdue_date' && it.daysWaiting >= 1)
    || (it.reason === 'sales_response_overdue' && it.daysWaiting >= 1)
}
function inTab(it: FollowUpQueueItem, tab: Tab) {
  if (tab === 'due') return true
  if (tab === 'needs_reply') return it.reason === 'sales_response_overdue'
  if (tab === 'overdue') return isOverdue(it)
  if (tab === 'ai') return Boolean(it.nextAction)
  if (tab === 'hot') return it.temperature === 'hot'
  return false
}
function isTomorrow(iso: string) {
  const d = new Date(iso); const t = new Date(); t.setDate(t.getDate() + 1)
  return d.toDateString() === t.toDateString()
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
/** The bold line in the AI Recommendation column. */
function recommendationFor(it: FollowUpQueueItem) {
  if (it.nextAction) return it.nextAction
  if (it.reason === 'sales_response_overdue') return 'Reply now'
  if (it.reason === 'manual_followup_due') return it.reasonDetail === 'exhausted' ? 'Decide next step' : 'Follow up as scheduled'
  if (it.quietStage && it.quietStage.next >= it.quietStage.total) return 'Final follow-up'
  return it.temperature === 'hot' ? 'Follow up now' : 'Check interest'
}
/** The short grey line under the customer's name. */
function customerSub(it: FollowUpQueueItem) {
  const s = it.aiSummary || it.recentMessages[0]?.text || REASON_UI[it.reason].blurb
  return s.length > 44 ? `${s.slice(0, 42)}…` : s
}

/**
 * The follow-up queue: who to contact today, why, and what to send.
 *
 * Styled to the supplied design reference. Every row is something to do,
 * ranked, with the reason on it. "Needs reply" (a customer we owe an
 * answer) has its own tab and its own red pill so it is never read as
 * "went quiet on us" — different failures, different urgency.
 */
export default function FollowUps() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [tab, setTab] = useState<Tab>('due')
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<'' | FollowUpPriority>('')
  const [intent, setIntent] = useState<'' | 'hot' | 'warm' | 'cold'>('')
  const [reasonF, setReasonF] = useState<'' | FollowUpReason>('')
  const [owner, setOwner] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement | null>(null)
  const dateRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false)
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDateOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['follow-up-queue', isAdmin ? owner : 'mine'],
    queryFn: () => followUpQueueApi.list(isAdmin && owner ? { owner } : undefined),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
  const items = data?.items ?? []
  const summary = data?.summary

  // Scheduled for the coming days — the existing board endpoint, scoped the
  // same way server-side.
  const { data: sched } = useQuery({
    queryKey: ['follow-up-upcoming', isAdmin ? owner : 'mine'],
    queryFn: () => api.get<{ overdue: UpcomingLead[]; today: UpcomingLead[]; upcoming: UpcomingLead[] }>('/leads/follow-ups', { params: { days: 7, ...(isAdmin && owner ? { owner } : {}) } }).then((r) => r.data),
    staleTime: 60_000,
  })
  const upcoming = sched?.upcoming ?? []

  // What went out — the send log, newest first.
  const { data: log } = useQuery({
    queryKey: ['follow-up-completed', isAdmin ? owner : 'mine'],
    queryFn: () => leadFollowUpApi.log(isAdmin && owner ? { owner } : undefined),
    staleTime: 60_000,
    enabled: tab === 'completed',
  })
  const completed = (log?.rows ?? []).filter((r) => r.status === 'sent')

  const owners = useMemo(() => {
    const m = new Map<string, string>()
    for (const it of items) if (it.ownerId) m.set(it.ownerId, it.ownerName)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [items])

  const counts = useMemo<Record<Tab, number>>(() => ({
    due: items.length,
    needs_reply: items.filter((it) => it.reason === 'sales_response_overdue').length,
    overdue: items.filter(isOverdue).length,
    ai: items.filter((it) => it.nextAction).length,
    upcoming: upcoming.length,
    hot: items.filter((it) => it.temperature === 'hot').length,
    completed: completed.length,
  }), [items, upcoming, completed])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    return items.filter((it) => {
      if (!inTab(it, tab)) return false
      if (priority && it.priority !== priority) return false
      if (intent && it.temperature !== intent) return false
      if (reasonF && it.reason !== reasonF) return false
      if (q) {
        const nameHit = it.name.toLowerCase().includes(q)
        const phoneHit = qDigits.length >= 4 && (it.phoneNormalized || '').includes(qDigits)
        if (!nameHit && !phoneHit) return false
      }
      return true
    })
  }, [items, tab, priority, intent, reasonF, search])

  const openIndex = openId ? visible.findIndex((it) => it.leadId === openId) : -1
  const nextId = openIndex >= 0 && openIndex + 1 < visible.length ? visible[openIndex + 1].leadId : null
  const activeFilters = [priority, intent, reasonF, owner].filter(Boolean).length

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const allShownOn = visible.length > 0 && visible.every((it) => selected.has(it.leadId))
  function toggleAllShown() {
    setSelected((s) => {
      const n = new Set(s)
      visible.forEach((it) => allShownOn ? n.delete(it.leadId) : n.add(it.leadId))
      return n
    })
  }
  function leaveSelectMode() { setSelecting(false); setSelected(new Set()) }

  const opportunity = items.filter((it) => it.temperature === 'hot' || it.temperature === 'warm').length
  const tomorrow = upcoming.filter((l) => isTomorrow(l.followUpAt)).length

  const tiles: { key: Tab | 'opportunity' | 'tomorrow'; label: string; value: number; sub: string; bg: string; border: string; icon: React.ReactNode; iconBg: string }[] = summary ? [
    { key: 'due', label: 'Due Today', value: summary.total, sub: 'Leads need attention', bg: '#FFF1F2', border: '#FECDD3', icon: <Clock size={16} />, iconBg: '#EF4444' },
    { key: 'overdue', label: 'Overdue', value: summary.overdue, sub: 'Past due date', bg: '#FFF7ED', border: '#FED7AA', icon: <AlertTriangle size={16} />, iconBg: '#F59E0B' },
    { key: 'ai', label: 'AI Suggested', value: summary.aiSuggested, sub: 'Recommended by AI', bg: '#F5F3FF', border: '#DDD6FE', icon: <Sparkles size={16} />, iconBg: '#7C3AED' },
    { key: 'tomorrow', label: 'Tomorrow', value: tomorrow, sub: 'Scheduled for tomorrow', bg: '#EFF6FF', border: '#BFDBFE', icon: <CalendarDays size={16} />, iconBg: '#3B82F6' },
    { key: 'hot', label: 'Hot Leads', value: summary.hot, sub: 'High intent / buying signals', bg: '#ECFDF5', border: '#A7F3D0', icon: <Flame size={16} />, iconBg: '#22C55E' },
    { key: 'opportunity', label: 'Opportunity', value: opportunity, sub: 'Potential to convert', bg: '#F0FDFA', border: '#99F6E4', icon: <Star size={16} />, iconBg: '#14B8A6' },
  ] : []

  const pill = (bg: string, fg: string, text: string, dot?: string) => (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ background: bg, color: fg }}>
      {dot && <span className="rounded-full" style={{ width: 6, height: 6, background: dot }} />}{text}
    </span>
  )
  const avatar = (name: string, size = 30) => (
    <span className="grid place-items-center rounded-full shrink-0 text-[11px] font-bold" style={{ width: size, height: size, background: '#EDE9FE', color: BRAND_DARK }}>{initialsOf(name)}</span>
  )

  const showQueueRows = tab !== 'upcoming' && tab !== 'completed'

  return (
    <div className="px-1 py-3" style={{ fontFamily: FONT, color: TEXT }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.1 }}>Follow-Ups</h1>
          <p className="text-[14px] mt-1" style={{ color: SUB }}>Reach out at the right time. Turn quiet leads into new opportunities.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative" ref={dateRef}>
            <button type="button" onClick={() => setDateOpen((v) => !v)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border text-[14px] font-medium cursor-pointer bg-white"
              style={{ borderColor: LINE }}>
              <CalendarDays size={16} style={{ color: SUB }} />
              {tab === 'upcoming' ? 'Next 7 days' : `Today, ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
              <ChevronDown size={15} style={{ color: SUB }} />
            </button>
            {dateOpen && (
              <div className="absolute right-0 mt-1 w-44 rounded-lg border bg-white shadow-lg z-20 py-1" style={{ borderColor: LINE }}>
                {([['due', 'Today'], ['overdue', 'Overdue'], ['upcoming', 'Next 7 days']] as [Tab, string][]).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => { setTab(k); setDateOpen(false) }}
                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-50 cursor-pointer" style={{ color: tab === k ? BRAND : TEXT, fontWeight: tab === k ? 600 : 400 }}>{l}</button>
                ))}
              </div>
            )}
          </div>
          {selecting ? (
            <button type="button" onClick={leaveSelectMode}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border text-[14px] font-semibold cursor-pointer bg-white" style={{ borderColor: LINE }}>
              <X size={15} /> Cancel
            </button>
          ) : (
            <button type="button" onClick={() => setSelecting(true)} disabled={!items.length}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-[14px] font-semibold cursor-pointer disabled:opacity-40 text-white"
              style={{ background: BRAND }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Send Follow-Up (Bulk)
            </button>
          )}
        </div>
      </div>

      {/* ── KPI cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mt-5">
        {isLoading && !summary
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[100px] rounded-xl" />)
          : tiles.map((t) => {
            const target: Tab | null = t.key === 'opportunity' ? 'hot' : t.key === 'tomorrow' ? 'upcoming' : t.key
            return (
              <button key={t.label} type="button" onClick={() => target && setTab(target)}
                className="text-left rounded-xl border p-4 cursor-pointer hover:shadow-sm transition-shadow" style={{ background: t.bg, borderColor: t.border }}>
                <div className="flex items-center gap-2.5">
                  <span className="grid place-items-center rounded-full text-white shrink-0" style={{ width: 32, height: 32, background: t.iconBg }}>{t.icon}</span>
                  <span className="text-[13px] font-semibold">{t.label}</span>
                </div>
                <div className="flex items-end justify-between mt-2">
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.1 }}>{t.value}</div>
                    <div className="text-[11.5px] mt-1" style={{ color: SUB }}>{t.sub}</div>
                  </div>
                  <ArrowRight size={14} style={{ color: SUB }} />
                </div>
              </button>
            )
          })}
      </div>

      {/* ── Tabs + filter + search ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mt-6 border-b" style={{ borderColor: LINE }}>
        <div className="flex gap-1 overflow-x-auto flex-1 min-w-0">
          {TABS.map((t) => {
            const on = tab === t.key
            const n = counts[t.key]
            return (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className="flex items-center gap-2 px-3 pb-3 pt-1 text-[14px] font-semibold cursor-pointer -mb-px whitespace-nowrap"
                style={{ color: on ? BRAND : SUB, borderBottom: `2px solid ${on ? BRAND : 'transparent'}` }}>
                {t.label}
                {(n > 0 || on) && (
                  <span className="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-md text-[11.5px] font-bold"
                    style={{ background: t.tone ? '#FEE2E2' : '#EDE9FE', color: t.tone || BRAND }}>{n}</span>
                )}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 pb-2">
          <div className="relative" ref={filterRef}>
            <button type="button" onClick={() => setFilterOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13px] font-medium cursor-pointer bg-white" style={{ borderColor: LINE, color: activeFilters ? BRAND : TEXT }}>
              <Filter size={14} /> Filter{activeFilters ? ` (${activeFilters})` : ''}
            </button>
            {filterOpen && (
              <div className="absolute right-0 mt-1 w-64 rounded-lg border bg-white shadow-lg z-20 p-3 space-y-2.5" style={{ borderColor: LINE }}>
                <label className="block text-[11px] font-semibold uppercase" style={{ color: SUB, letterSpacing: '.06em' }}>Priority
                  <select value={priority} onChange={(e) => setPriority(e.target.value as '' | FollowUpPriority)} className="mt-1 w-full h-9 border rounded-lg px-2 text-[13px] font-normal normal-case bg-white" style={{ borderColor: LINE }}>
                    <option value="">Any</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                </label>
                <label className="block text-[11px] font-semibold uppercase" style={{ color: SUB, letterSpacing: '.06em' }}>Intent
                  <select value={intent} onChange={(e) => setIntent(e.target.value as '' | 'hot' | 'warm' | 'cold')} className="mt-1 w-full h-9 border rounded-lg px-2 text-[13px] font-normal normal-case bg-white" style={{ borderColor: LINE }}>
                    <option value="">Any</option><option value="hot">High</option><option value="warm">Medium</option><option value="cold">Low</option>
                  </select>
                </label>
                <label className="block text-[11px] font-semibold uppercase" style={{ color: SUB, letterSpacing: '.06em' }}>Reason
                  <select value={reasonF} onChange={(e) => setReasonF(e.target.value as '' | FollowUpReason)} className="mt-1 w-full h-9 border rounded-lg px-2 text-[13px] font-normal normal-case bg-white" style={{ borderColor: LINE }}>
                    <option value="">Any</option>
                    <option value="sales_response_overdue">Customer waiting on us</option>
                    <option value="customer_quiet">Customer went quiet</option>
                    <option value="manual_followup_due">Scheduled follow-up</option>
                  </select>
                </label>
                {isAdmin && (
                  <label className="block text-[11px] font-semibold uppercase" style={{ color: SUB, letterSpacing: '.06em' }}>Salesperson
                    <select value={owner} onChange={(e) => setOwner(e.target.value)} className="mt-1 w-full h-9 border rounded-lg px-2 text-[13px] font-normal normal-case bg-white" style={{ borderColor: LINE }}>
                      <option value="">All</option>
                      {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  </label>
                )}
                {activeFilters > 0 && (
                  <button type="button" onClick={() => { setPriority(''); setIntent(''); setReasonF(''); setOwner('') }} className="text-[12px] font-semibold cursor-pointer" style={{ color: BRAND }}>Clear filters</button>
                )}
              </div>
            )}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: SUB }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search follow-ups…"
              className="h-9 w-[200px] border rounded-lg pl-9 pr-3 text-[13px] bg-white" style={{ borderColor: LINE }} />
          </div>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="mt-4 rounded-xl border bg-white overflow-hidden" style={{ borderColor: LINE }}>
        {showQueueRows ? (
          isLoading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[60px]" />)}</div>
          ) : isError ? (
            <div className="p-8 text-center">
              <p className="text-[14px] font-semibold">Couldn&rsquo;t load the queue.</p>
              <button type="button" onClick={() => refetch()} className="mt-2 text-[13px] font-semibold cursor-pointer" style={{ color: BRAND }}>Retry</button>
            </div>
          ) : visible.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-[14px] font-semibold">{items.length && (search || activeFilters) ? 'Nothing matches those filters.' : EMPTY[tab]}</p>
              {!items.length && <p className="text-[12.5px] mt-1" style={{ color: SUB }}>Leads appear here the moment a customer is waiting on you, has gone quiet, or a follow-up you scheduled arrives.</p>}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="text-left text-[12px] font-semibold" style={{ color: SUB, background: '#F9FAFB' }}>
                    <th className="pl-4 pr-2 py-3 w-10">
                      {selecting
                        ? <button type="button" onClick={toggleAllShown} className="cursor-pointer align-middle" style={{ color: allShownOn ? BRAND : '#9CA3AF' }}>{allShownOn ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                        : <Square size={16} style={{ color: '#D1D5DB' }} />}
                    </th>
                    <th className="px-2 py-3">Priority</th>
                    <th className="px-2 py-3">Customer</th>
                    <th className="px-2 py-3">Phone</th>
                    <th className="px-2 py-3">Assigned To</th>
                    <th className="px-2 py-3">Last Contact</th>
                    <th className="px-2 py-3">Quiet For</th>
                    <th className="px-2 py-3">Intent</th>
                    <th className="px-2 py-3">AI Recommendation</th>
                    <th className="px-2 py-3">Next Action</th>
                    <th className="px-2 py-3 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((it) => {
                    const p = PRIORITY[it.priority]
                    const iu = INTENT[it.temperature ?? 'none']
                    const on = selected.has(it.leadId)
                    const lastContact = [it.lastInboundAt, it.lastOutboundAt].filter(Boolean).sort().pop() || it.since
                    const waiting = it.reason === 'sales_response_overdue'
                    const recent = it.lastNudgedAt && Date.now() - new Date(it.lastNudgedAt).getTime() < 12 * 3600_000
                    return (
                      <tr key={it.leadId} className="border-t hover:bg-gray-50 cursor-pointer" style={{ borderColor: LINE, background: on ? '#F5F3FF' : undefined }}
                        onClick={() => (selecting ? toggle(it.leadId) : setOpenId(it.leadId))}>
                        <td className="pl-4 pr-2 py-3" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => { if (!selecting) setSelecting(true); toggle(it.leadId) }} className="cursor-pointer align-middle" style={{ color: on ? BRAND : '#D1D5DB' }}>{on ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                        </td>
                        <td className="px-2 py-3">{pill(p.bg, p.fg, p.label, p.dot)}</td>
                        <td className="px-2 py-3 min-w-[170px]">
                          <div className="text-[13.5px] font-bold">{it.name}</div>
                          <div className="text-[12px] mt-0.5" style={{ color: SUB }}>{customerSub(it)}</div>
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-[13px]"><MessageCircle size={15} style={{ color: WA_ICON }} />{it.phone}</span>
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-2 text-[13px]">{avatar(it.ownerName)}{it.ownerName}</span>
                        </td>
                        <td className="px-2 py-3 whitespace-nowrap text-[13px]">
                          <div>{fmtDate(lastContact)}</div>
                          <div className="text-[12px]" style={{ color: SUB }}>{fmtTime(lastContact)}</div>
                        </td>
                        <td className="px-2 py-3">
                          {waiting
                            ? pill(NEEDS_REPLY_PILL.bg, NEEDS_REPLY_PILL.fg, `Waiting ${it.daysWaiting === 0 ? agoText(it.since) : `${it.daysWaiting}d`}`)
                            : pill(QUIET_PILL.bg, QUIET_PILL.fg, `${it.daysWaiting} day${it.daysWaiting === 1 ? '' : 's'}`)}
                        </td>
                        <td className="px-2 py-3">{pill(iu.bg, iu.fg, iu.label)}</td>
                        <td className="px-2 py-3 min-w-[200px]">
                          <div className="text-[13px] font-bold">{recommendationFor(it)}</div>
                          <div className="text-[12px] mt-0.5" style={{ color: SUB }} title={whyFor(it)}>
                            {waiting ? 'Customer is waiting on us' : (it.aiReason || whyFor(it)).slice(0, 60)}
                          </div>
                          {recent && <div className="text-[11px] mt-0.5 font-semibold" style={{ color: '#B45309' }}>⚠ Messaged {agoText(it.lastNudgedAt)}</div>}
                        </td>
                        <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                          {waiting && it.windowOpen ? (
                            <Link to={`/whatsapp?phone=${it.phoneNormalized}`} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold text-white" style={{ background: WA_GREEN }}>
                              <MessageCircle size={14} /> Reply
                            </Link>
                          ) : (
                            <button type="button" onClick={() => setOpenId(it.leadId)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold text-white cursor-pointer" style={{ background: WA_GREEN }}>
                              <MessageCircle size={14} /> Send
                            </button>
                          )}
                        </td>
                        <td className="px-2 py-3 pr-4" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => setOpenId(it.leadId)} title="View" className="grid place-items-center rounded-lg border cursor-pointer hover:bg-gray-50" style={{ width: 32, height: 32, borderColor: LINE, color: SUB }}>
                            <Eye size={15} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : tab === 'upcoming' ? (
          upcoming.length === 0 ? (
            <div className="p-12 text-center"><p className="text-[14px] font-semibold">{EMPTY.upcoming}</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="text-left text-[12px] font-semibold" style={{ color: SUB, background: '#F9FAFB' }}>
                    <th className="pl-4 px-2 py-3">Customer</th><th className="px-2 py-3">Phone</th><th className="px-2 py-3">Assigned To</th><th className="px-2 py-3">Scheduled</th><th className="px-2 py-3">Intent</th><th className="px-2 py-3 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((l) => {
                    const iu = INTENT[(l.temperature as 'hot' | 'warm' | 'cold') || 'none']
                    return (
                      <tr key={l._id} className="border-t hover:bg-gray-50 cursor-pointer" style={{ borderColor: LINE }} onClick={() => setOpenId(l._id)}>
                        <td className="pl-4 px-2 py-3 text-[13.5px] font-bold">{l.fullName}</td>
                        <td className="px-2 py-3 whitespace-nowrap"><span className="inline-flex items-center gap-1.5 text-[13px]"><MessageCircle size={15} style={{ color: WA_ICON }} />{l.phone}</span></td>
                        <td className="px-2 py-3 whitespace-nowrap"><span className="inline-flex items-center gap-2 text-[13px]">{avatar(l.owner?.name || '—')}{l.owner?.name || 'Unassigned'}</span></td>
                        <td className="px-2 py-3 text-[13px]">{isTomorrow(l.followUpAt) ? pill('#DBEAFE', '#1D4ED8', 'Tomorrow') : fmtDate(l.followUpAt)}</td>
                        <td className="px-2 py-3">{pill(iu.bg, iu.fg, iu.label)}</td>
                        <td className="px-2 py-3 pr-4" onClick={(e) => e.stopPropagation()}>
                          <button type="button" onClick={() => setOpenId(l._id)} className="grid place-items-center rounded-lg border cursor-pointer hover:bg-gray-50" style={{ width: 32, height: 32, borderColor: LINE, color: SUB }}><Eye size={15} /></button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          completed.length === 0 ? (
            <div className="p-12 text-center"><p className="text-[14px] font-semibold">{EMPTY.completed}</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="text-left text-[12px] font-semibold" style={{ color: SUB, background: '#F9FAFB' }}>
                    <th className="pl-4 px-2 py-3">Customer</th><th className="px-2 py-3">Template</th><th className="px-2 py-3">Sent By</th><th className="px-2 py-3">Sent</th><th className="px-2 py-3">Reason</th><th className="px-2 py-3 pr-4">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.map((r: LogRow) => (
                    <tr key={r.id} className="border-t hover:bg-gray-50 cursor-pointer" style={{ borderColor: LINE }} onClick={() => r.leadId && setOpenId(r.leadId)}>
                      <td className="pl-4 px-2 py-3"><div className="text-[13.5px] font-bold">{r.leadName || '—'}</div><div className="text-[12px]" style={{ color: SUB }}>{r.phone}</div></td>
                      <td className="px-2 py-3 text-[13px]">{r.templateLabel}</td>
                      <td className="px-2 py-3 whitespace-nowrap"><span className="inline-flex items-center gap-2 text-[13px]">{avatar(r.sentByName || '—')}{r.sentByName || '—'}</span></td>
                      <td className="px-2 py-3 whitespace-nowrap text-[13px]"><div>{fmtDate(r.sentAt)}</div><div className="text-[12px]" style={{ color: SUB }}>{fmtTime(r.sentAt)}</div></td>
                      <td className="px-2 py-3 text-[12.5px] max-w-[260px] truncate" style={{ color: SUB }} title={r.reason}>{r.reason || '—'}</td>
                      <td className="px-2 py-3 pr-4">{r.repliedAt ? pill('#DCFCE7', '#15803D', `Replied ${agoText(r.repliedAt)}`) : pill('#F3F4F6', '#6B7280', 'No reply yet')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* ── Sticky bulk bar ──────────────────────────────────────────────── */}
      {selecting && (
        <div className="sticky bottom-0 mt-4 -mx-1 px-4 py-3 flex items-center justify-between gap-3 flex-wrap rounded-t-xl border-t bg-white/95 backdrop-blur" style={{ borderColor: LINE }}>
          <span className="text-[13px]" style={{ color: SUB }}>{selected.size === 0 ? 'Select the leads to follow up.' : `${selected.size} selected.`}</span>
          <button type="button" disabled={selected.size === 0} onClick={() => setBulkOpen(true)}
            className="h-10 px-5 rounded-lg text-[14px] font-semibold text-white cursor-pointer disabled:opacity-40" style={{ background: BRAND }}>
            Review {selected.size ? `${selected.size} ` : ''}message{selected.size === 1 ? '' : 's'}
          </button>
        </div>
      )}

      {openId && (
        <FollowUpDrawer
          leadId={openId}
          nextLeadId={nextId}
          snapshotAt={data?.snapshotAt}
          onClose={() => setOpenId(null)}
          onAdvance={(id) => setOpenId(id)}
          onChanged={() => refetch()}
        />
      )}
      {bulkOpen && (
        <FollowUpBulkModal
          items={items.filter((it) => selected.has(it.leadId))}
          snapshotAt={data?.snapshotAt}
          onClose={() => setBulkOpen(false)}
          onDone={() => { setBulkOpen(false); leaveSelectMode(); refetch() }}
        />
      )}
    </div>
  )
}

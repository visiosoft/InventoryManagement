import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, CalendarDays, CheckSquare, Eye, Filter, MessageCircle,
  Search, Square, X, Clock,
} from 'lucide-react'
import { followUpQueueApi, leadFollowUpApi, type FollowUpPriority, type FollowUpQueueItem, type FollowUpReason, type FollowUpWindow } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Skeleton } from '../components/ui'
import FollowUpDrawer from '../components/FollowUpDrawer'
import FollowUpBulkModal from '../components/FollowUpBulkModal'
import PipelineFunnel from '../components/PipelineFunnel'
import { REASON_UI, whyFor, agoText, initialsOf, customerBadge } from '../lib/followUpUi'

/* ── The design reference's palette, copied ──────────────────────────────── */
const FONT = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif"
const TEXT = '#111827'
const SUB = '#6B7280'
const LINE = '#E5E7EB'
const BRAND = '#6D28D9'
const BRAND_DARK = '#5B21B6'
const WA_GREEN = '#16A34A'
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

const WINDOW_LABEL: Record<FollowUpWindow, { label: string; bg: string; fg: string }> = {
  now: { label: 'Now', bg: '#FEE2E2', fg: '#B91C1C' },
  today: { label: 'Today', bg: '#FFEDD5', fg: '#C2410C' },
  tomorrow: { label: 'Tomorrow', bg: '#DBEAFE', fg: '#1D4ED8' },
  in_3_days: { label: 'In 3 days', bg: '#EDE9FE', fg: '#6D28D9' },
  in_7_days: { label: 'In 7 days', bg: '#DCFCE7', fg: '#15803D' },
  later: { label: 'Later', bg: '#CCFBF1', fg: '#0F766E' },
  exhausted: { label: 'Decide', bg: '#F3F4F6', fg: '#374151' },
}

/** Within a day: which intent bucket. High is a rep's first stop —
 *  a hot lead due today is worth more than a cold one due today, so it
 *  gets its own tab rather than being sorted somewhere inside "All". */
type Tab = 'high' | 'medium' | 'low' | 'completed'
const TABS: { key: Tab; label: string; tone?: string }[] = [
  { key: 'high', label: 'High Intent', tone: '#B91C1C' },
  { key: 'medium', label: 'Medium Intent', tone: '#B45309' },
  { key: 'low', label: 'Low Intent' },
  { key: 'completed', label: 'Completed' },
]
/** No AI read yet defaults to the middle bucket — an unscored lead is not
 *  the same claim as a cold one, and it should not hide in "Low" where
 *  nobody is looking for it. */
function intentOf(it: FollowUpQueueItem): 'hot' | 'warm' | 'cold' {
  return it.temperature ?? 'warm'
}

type LogRow = Awaited<ReturnType<typeof leadFollowUpApi.log>>['rows'][number]

function inTab(it: FollowUpQueueItem, tab: Tab) {
  if (tab === 'completed') return true
  const t = intentOf(it)
  if (tab === 'high') return t === 'hot'
  if (tab === 'medium') return t === 'warm'
  return t === 'cold'
}
/** Within High Intent specifically: a customer waiting on our reply, or a
 *  lead due right now, outranks one merely due today or later — "follow up
 *  right away" means the ones actually owed a reply surface first. */
function urgencyRank(it: FollowUpQueueItem): number {
  if (it.reason === 'sales_response_overdue') return 0
  if (it.window === 'now') return 1
  if (it.window === 'today') return 2
  if (it.window === 'exhausted') return 3
  return 4
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
/** The bold line of the AI Recommendation cell: the AI's next action when
 *  it has one, else the honest fallback for where the lead sits. */
function recommendationFor(it: FollowUpQueueItem) {
  if (it.reason === 'sales_response_overdue') return 'Reply now'
  if (it.window === 'exhausted') return 'Decide: keep, nurture or close'
  if (it.nextAction) return it.nextAction
  if (it.reason === 'manual_followup_due') return 'Follow up as scheduled'
  if (it.quietStage.next >= it.quietStage.total) return 'Final follow-up'
  return it.temperature === 'hot' ? 'Follow up now' : 'Check interest'
}
/** The line under it: the AI's read of the conversation on every tab -
 *  Needs reply included, where it says what the customer is waiting for. */
function recommendationDetail(it: FollowUpQueueItem) {
  if (it.reason === 'sales_response_overdue') {
    return (it.nextAction || it.aiSummary || 'Customer is waiting on us').slice(0, 70)
  }
  return (it.aiSummary || it.aiReason || whyFor(it)).slice(0, 70)
}
function customerSub(it: FollowUpQueueItem) {
  const s = it.aiSummary || it.recentMessages[0]?.text || REASON_UI[it.reason].blurb
  return s.length > 44 ? `${s.slice(0, 42)}…` : s
}
/** "Follow-up 2 of 3 · last sent 4d ago" — where they are in the cadence. */
function cadenceText(it: FollowUpQueueItem) {
  if (it.reason === 'sales_response_overdue') return 'Awaiting our reply'
  const sent = it.lastSentAt ? ` · last sent ${agoText(it.lastSentAt)}` : ''
  if (it.reason === 'manual_followup_due') return `${it.reasonDetail === 'exhausted' ? 'Chase exhausted' : 'Scheduled'}${sent}`
  return `${it.quietStage.label}${sent}`
}

/**
 * The follow-up queue: who to contact, grouped by how promising they are.
 *
 * "Needs reply" (a customer we owe an answer) still outranks everything
 * within its bucket via urgencyRank — see below — even without a separate
 * card for it; a send before a lead's actual due day is still refused by
 * the server regardless of what's on screen.
 */
export default function FollowUps() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  // High Intent first: it is the bucket that actually needs a follow-up
  // right away, not a neutral starting point like the old "All" tab was.
  const [tab, setTab] = useState<Tab>('high')
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<'' | FollowUpPriority>('')
  const [reasonF, setReasonF] = useState<'' | FollowUpReason>('')
  const [customerF, setCustomerF] = useState<'' | 'tenant' | 'not_customer'>('')
  const [owner, setOwner] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const filterRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const away = (e: MouseEvent) => { if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false) }
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

  // AI reads still being written on the server: come back for them once,
  // rather than polling — a queue of 300 stale threads takes a few minutes.
  useEffect(() => {
    if (!data?.aiPending) return
    const t = window.setTimeout(() => refetch(), 20_000)
    return () => window.clearTimeout(t)
  }, [data?.aiPending, refetch])

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

  const tabCounts = useMemo<Record<Tab, number>>(() => ({
    high: items.filter((it) => intentOf(it) === 'hot').length,
    medium: items.filter((it) => intentOf(it) === 'warm').length,
    low: items.filter((it) => intentOf(it) === 'cold').length,
    completed: completed.length,
  }), [items, completed])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    const filtered = items.filter((it) => {
      if (!inTab(it, tab)) return false
      if (priority && it.priority !== priority) return false
      if (reasonF && it.reason !== reasonF) return false
      if (customerF === 'tenant' && it.customer?.status !== 'active') return false
      if (customerF === 'not_customer' && it.customer) return false
      if (q) {
        const nameHit = it.name.toLowerCase().includes(q)
        const phoneHit = qDigits.length >= 4 && (it.phoneNormalized || '').includes(qDigits)
        if (!nameHit && !phoneHit) return false
      }
      return true
    })
    // High Intent only: surface who's actually owed a reply, or due right
    // now, ahead of the rest of the bucket — "follow up right away" is a
    // sort order, not just a filter.
    return tab === 'high' ? [...filtered].sort((a, b) => urgencyRank(a) - urgencyRank(b)) : filtered
  }, [items, tab, priority, reasonF, customerF, search])

  const openIndex = openId ? visible.findIndex((it) => it.leadId === openId) : -1
  const nextId = openIndex >= 0 && openIndex + 1 < visible.length ? visible[openIndex + 1].leadId : null
  const activeFilters = [priority, reasonF, customerF, owner].filter(Boolean).length
  const tenantsInView = visible.filter((it) => it.customer?.status === 'active').length

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  const allShownOn = visible.length > 0 && visible.every((it) => selected.has(it.leadId))
  function toggleAllShown() {
    setSelected((s) => { const n = new Set(s); visible.forEach((it) => allShownOn ? n.delete(it.leadId) : n.add(it.leadId)); return n })
  }
  function leaveSelectMode() { setSelecting(false); setSelected(new Set()) }

  const pill = (bg: string, fg: string, text: string, dot?: string) => (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ background: bg, color: fg }}>
      {dot && <span className="rounded-full" style={{ width: 6, height: 6, background: dot }} />}{text}
    </span>
  )
  const avatar = (name: string, size = 30) => (
    <span className="grid place-items-center rounded-full shrink-0 text-[11px] font-bold" style={{ width: size, height: size, background: '#EDE9FE', color: BRAND_DARK }}>{initialsOf(name)}</span>
  )

  return (
    <div className="px-1 py-3" style={{ fontFamily: FONT, color: TEXT }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1.1 }}>Follow-Ups</h1>
          <p className="text-[14px] mt-1" style={{ color: SUB }}>Reach out at the right time. Turn quiet leads into new opportunities.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border text-[14px] font-medium bg-white" style={{ borderColor: LINE }}>
            <CalendarDays size={16} style={{ color: SUB }} />
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          {selecting ? (
            <button type="button" onClick={leaveSelectMode}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border text-[14px] font-semibold cursor-pointer bg-white" style={{ borderColor: LINE }}>
              <X size={15} /> Cancel
            </button>
          ) : (
            <button type="button" onClick={() => setSelecting(true)} disabled={!items.length}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg text-[14px] font-semibold cursor-pointer disabled:opacity-40 text-white" style={{ background: BRAND }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Send Follow-Up (Bulk)
            </button>
          )}
        </div>
      </div>

      <PipelineFunnel />

      {/* ── Tabs: what kind ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mt-6 border-b" style={{ borderColor: LINE }}>
        <div className="flex gap-1 overflow-x-auto flex-1 min-w-0">
          {TABS.map((t) => {
            const on = tab === t.key
            const n = tabCounts[t.key]
            return (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className="flex items-center gap-2 px-3 pb-3 pt-1 text-[14px] font-semibold cursor-pointer -mb-px whitespace-nowrap"
                style={{ color: on ? BRAND : SUB, borderBottom: `2px solid ${on ? BRAND : 'transparent'}` }}>
                {t.label}
                {(n > 0 || on) && t.key !== 'completed' && (
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
                <label className="block text-[11px] font-semibold uppercase" style={{ color: SUB, letterSpacing: '.06em' }}>Reason
                  <select value={reasonF} onChange={(e) => setReasonF(e.target.value as '' | FollowUpReason)} className="mt-1 w-full h-9 border rounded-lg px-2 text-[13px] font-normal normal-case bg-white" style={{ borderColor: LINE }}>
                    <option value="">Any</option>
                    <option value="sales_response_overdue">Customer waiting on us</option>
                    <option value="customer_quiet">Customer went quiet</option>
                    <option value="manual_followup_due">Scheduled follow-up</option>
                  </select>
                </label>
                <label className="block text-[11px] font-semibold uppercase" style={{ color: SUB, letterSpacing: '.06em' }}>In our system
                  <select value={customerF} onChange={(e) => setCustomerF(e.target.value as '' | 'tenant' | 'not_customer')} className="mt-1 w-full h-9 border rounded-lg px-2 text-[13px] font-normal normal-case bg-white" style={{ borderColor: LINE }}>
                    <option value="">Anyone</option>
                    <option value="tenant">Active tenants only</option>
                    <option value="not_customer">Not a customer yet</option>
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
                  <button type="button" onClick={() => { setPriority(''); setReasonF(''); setCustomerF(''); setOwner('') }} className="text-[12px] font-semibold cursor-pointer" style={{ color: BRAND }}>Clear filters</button>
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
      {tab === 'high' && tabCounts.high > 0 && (
        <p className="text-[12.5px] mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold" style={{ background: '#FEE2E2', color: '#B91C1C' }}>
          <AlertTriangle size={13} />
          <b>{tabCounts.high}</b> high-intent {tabCounts.high === 1 ? 'lead needs' : 'leads need'} a follow-up right away — the ones actually owed a reply are listed first.
        </p>
      )}
      {tenantsInView > 0 && tab !== 'completed' && (
        <p className="text-[12.5px] mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: '#DCFCE7', color: '#15803D' }}>
          <b>{tenantsInView}</b> of these {tenantsInView === 1 ? 'is an active tenant' : 'are active tenants'} — marked in green. A lead template would be wrong for them; they are left out of bulk sends unless you include them deliberately.
        </p>
      )}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="mt-4 rounded-xl border bg-white overflow-hidden" style={{ borderColor: LINE }}>
        {tab === 'completed' ? (
          completed.length === 0 ? (
            <div className="p-12 text-center"><p className="text-[14px] font-semibold">No follow-ups sent in the last 30 days.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1020px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="text-left text-[12px] font-semibold" style={{ color: SUB, background: '#F9FAFB' }}>
                    <th className="pl-4 px-2 py-3">Customer</th><th className="px-2 py-3">Template</th><th className="px-2 py-3">Sent By</th><th className="px-2 py-3">Sent</th><th className="px-2 py-3">Reason</th><th className="px-2 py-3">AI Recommendation</th><th className="px-2 py-3 pr-4">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.map((r: LogRow) => (
                    <tr key={r.id} className="border-t hover:bg-gray-50 cursor-pointer" style={{ borderColor: LINE }} onClick={() => r.leadId && setOpenId(r.leadId)}>
                      <td className="pl-4 px-2 py-3"><div className="text-[13.5px] font-bold">{r.leadName || '—'}</div><div className="text-[12px]" style={{ color: SUB }}>{r.phone}</div></td>
                      <td className="px-2 py-3 text-[13px]">{r.templateLabel}</td>
                      <td className="px-2 py-3 whitespace-nowrap"><span className="inline-flex items-center gap-2 text-[13px]">{avatar(r.sentByName || '—')}{r.sentByName || '—'}</span></td>
                      <td className="px-2 py-3 whitespace-nowrap text-[13px]"><div>{fmtDate(r.sentAt)}</div><div className="text-[12px]" style={{ color: SUB }}>{fmtTime(r.sentAt)}</div></td>
                      <td className="px-2 py-3 text-[12.5px] max-w-[220px] truncate" style={{ color: SUB }} title={r.reason}>{r.reason || '—'}</td>
                      <td className="px-2 py-3 min-w-[200px]">
                        <div className="text-[13px] font-bold">{r.aiNext || (r.repliedAt ? 'They replied — continue in chat' : 'Wait for the next cadence day')}</div>
                        {r.aiSummary && <div className="text-[12px] mt-0.5 max-w-[260px] truncate" style={{ color: SUB }} title={r.aiSummary}>{r.aiSummary}</div>}
                      </td>
                      <td className="px-2 py-3 pr-4">{r.repliedAt ? pill('#DCFCE7', '#15803D', `Replied ${agoText(r.repliedAt)}`) : pill('#F3F4F6', '#6B7280', 'No reply yet')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[60px]" />)}</div>
        ) : isError ? (
          <div className="p-8 text-center">
            <p className="text-[14px] font-semibold">Couldn&rsquo;t load the queue.</p>
            <button type="button" onClick={() => refetch()} className="mt-2 text-[13px] font-semibold cursor-pointer" style={{ color: BRAND }}>Retry</button>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[14px] font-semibold">
              {!items.length
                ? 'Nobody needs a follow-up right now. Great work — you’re all caught up.'
                : tabCounts[tab] === 0
                  ? `No ${TABS.find((t) => t.key === tab)?.label.toLowerCase()} follow-ups right now.`
                  : 'Nothing matches those filters.'}
            </p>
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
                  <th className="px-2 py-3">Next Contact</th>
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
                  const w = WINDOW_LABEL[it.window]
                  const on = selected.has(it.leadId)
                  const lastContact = [it.lastInboundAt, it.lastOutboundAt, it.lastSentAt].filter(Boolean).sort().pop() || it.since
                  const waiting = it.reason === 'sales_response_overdue'
                  const due = it.window === 'now' || it.window === 'today'
                  return (
                    <tr key={it.leadId} className="border-t hover:bg-gray-50 cursor-pointer" style={{ borderColor: LINE, background: on ? '#F5F3FF' : undefined }}
                      onClick={() => (selecting ? toggle(it.leadId) : setOpenId(it.leadId))}>
                      <td className="pl-4 pr-2 py-3" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => { if (!selecting) setSelecting(true); toggle(it.leadId) }} className="cursor-pointer align-middle" style={{ color: on ? BRAND : '#D1D5DB' }}>{on ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                      </td>
                      <td className="px-2 py-3">{pill(p.bg, p.fg, p.label, p.dot)}</td>
                      <td className="px-2 py-3 min-w-[190px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[13.5px] font-bold">{it.name}</span>
                          {(() => { const b = customerBadge(it.customer); return b ? <span title={b.title} className="px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap" style={{ background: b.bg, color: b.fg }}>{b.label}</span> : null })()}
                        </div>
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
                      <td className="px-2 py-3 min-w-[150px]">
                        {pill(w.bg, w.fg, it.nextContactAt && !due && it.window !== 'now' ? `${w.label} · ${fmtDate(it.nextContactAt)}` : w.label)}
                        <div className="text-[11.5px] mt-1" style={{ color: SUB }}>{cadenceText(it)}</div>
                      </td>
                      <td className="px-2 py-3">{pill(iu.bg, iu.fg, iu.label)}</td>
                      <td className="px-2 py-3 min-w-[200px]">
                        <div className="text-[13px] font-bold">{recommendationFor(it)}</div>
                        <div className="text-[12px] mt-0.5" style={{ color: SUB }} title={whyFor(it)}>
                          {recommendationDetail(it)}
                        </div>
                      </td>
                      <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                        {waiting && it.windowOpen ? (
                          <Link to={`/whatsapp?phone=${it.phoneNormalized}`} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold text-white" style={{ background: WA_GREEN }}>
                            <MessageCircle size={14} /> Reply
                          </Link>
                        ) : due || it.window === 'exhausted' ? (
                          <button type="button" onClick={() => setOpenId(it.leadId)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold text-white cursor-pointer" style={{ background: WA_GREEN }}>
                            <MessageCircle size={14} /> {it.window === 'exhausted' ? 'Decide' : 'Send'}
                          </button>
                        ) : (
                          <button type="button" onClick={() => setOpenId(it.leadId)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg border text-[13px] font-semibold cursor-pointer" style={{ borderColor: LINE, color: SUB }} title="Not due yet — open to override">
                            <Clock size={14} /> {w.label}
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

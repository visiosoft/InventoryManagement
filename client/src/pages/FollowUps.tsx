import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckSquare, MessageCircle, Search, Square, X } from 'lucide-react'
import { followUpQueueApi, type FollowUpPriority, type FollowUpQueueItem, type FollowUpReason } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Skeleton } from '../components/ui'
import FollowUpDrawer from '../components/FollowUpDrawer'
import FollowUpBulkModal from '../components/FollowUpBulkModal'
import {
  INK, MUTED, PURPLE, PURPLE_DEEP, PURPLE_TINT, HAIRLINE, CREAM, DISPLAY,
  REASON_UI, PRIORITY_UI, TEMP_UI, whyFor, agoText, initialsOf, stageText,
} from '../lib/followUpUi'

type Tab = 'needs_reply' | 'customer_quiet' | 'manual_due' | 'hot' | 'all'

const TABS: { key: Tab; label: string; blurb: string }[] = [
  { key: 'needs_reply', label: 'Needs reply', blurb: REASON_UI.sales_response_overdue.blurb },
  { key: 'customer_quiet', label: 'Went quiet', blurb: REASON_UI.customer_quiet.blurb },
  { key: 'manual_due', label: 'Due / overdue', blurb: REASON_UI.manual_followup_due.blurb },
  { key: 'hot', label: 'Hot', blurb: 'High intent, whatever the reason' },
  { key: 'all', label: 'All', blurb: 'Everything, highest priority first' },
]

const EMPTY: Record<Tab, string> = {
  needs_reply: 'Nobody is waiting on a reply. Every customer who wrote has been answered.',
  customer_quiet: 'Nobody has gone quiet on you. Good sign.',
  manual_due: 'No scheduled follow-ups are due. Nothing you promised is overdue.',
  hot: 'No hot leads need attention right now.',
  all: 'No follow-ups due today. Great work — you’re all caught up.',
}

function inTab(it: FollowUpQueueItem, tab: Tab) {
  if (tab === 'all') return true
  if (tab === 'hot') return it.temperature === 'hot'
  const want: Record<Exclude<Tab, 'all' | 'hot'>, FollowUpReason> = {
    needs_reply: 'sales_response_overdue',
    customer_quiet: 'customer_quiet',
    manual_due: 'manual_followup_due',
  }
  return it.reason === want[tab]
}

/**
 * The follow-up queue: who to contact today, why, and what to send.
 *
 * Not a report. Every row is something to do, ranked, with the reason on
 * it — a rep works down the list rather than reading a count. Three kinds
 * of row are kept visibly apart: a customer we owe a reply (red), one who
 * went quiet on us (purple), and a follow-up somebody scheduled (amber).
 * Reps see their own; admin sees everyone, with an owner filter.
 */
export default function FollowUps() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [tab, setTab] = useState<Tab>('needs_reply')
  const [search, setSearch] = useState('')
  const [priority, setPriority] = useState<'' | FollowUpPriority>('')
  const [temperature, setTemperature] = useState<'' | 'hot' | 'warm' | 'cold'>('')
  const [owner, setOwner] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['follow-up-queue', isAdmin ? owner : 'mine'],
    queryFn: () => followUpQueueApi.list(isAdmin && owner ? { owner } : undefined),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
  const items = data?.items ?? []
  const summary = data?.summary

  const owners = useMemo(() => {
    const m = new Map<string, string>()
    for (const it of items) if (it.ownerId) m.set(it.ownerId, it.ownerName)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [items])

  const tabCounts = useMemo(() => {
    const c: Record<Tab, number> = { needs_reply: 0, customer_quiet: 0, manual_due: 0, hot: 0, all: items.length }
    for (const it of items) {
      if (it.reason === 'sales_response_overdue') c.needs_reply += 1
      else if (it.reason === 'customer_quiet') c.customer_quiet += 1
      else c.manual_due += 1
      if (it.temperature === 'hot') c.hot += 1
    }
    return c
  }, [items])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    return items.filter((it) => {
      if (!inTab(it, tab)) return false
      if (priority && it.priority !== priority) return false
      if (temperature && it.temperature !== temperature) return false
      if (q) {
        const nameHit = it.name.toLowerCase().includes(q)
        const phoneHit = qDigits.length >= 4 && (it.phoneNormalized || '').includes(qDigits)
        if (!nameHit && !phoneHit) return false
      }
      return true
    })
  }, [items, tab, priority, temperature, search])

  const openIndex = openId ? visible.findIndex((it) => it.leadId === openId) : -1
  const nextId = openIndex >= 0 && openIndex + 1 < visible.length ? visible[openIndex + 1].leadId : null

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function selectAllVisible() {
    setSelected((s) => {
      const ids = visible.map((it) => it.leadId)
      const all = ids.every((id) => s.has(id))
      const n = new Set(s)
      ids.forEach((id) => all ? n.delete(id) : n.add(id))
      return n
    })
  }
  function leaveSelectMode() { setSelecting(false); setSelected(new Set()) }

  const tiles = summary ? [
    { label: 'Due today', value: summary.total, sub: 'need attention', tone: INK },
    { label: 'Needs reply', value: summary.needsReply, sub: 'customers waiting on us', tone: '#B91C1C' },
    { label: 'Overdue', value: summary.overdue, sub: 'past their day', tone: '#92400E' },
    { label: 'Hot leads', value: summary.hot, sub: 'high intent', tone: '#B91C1C' },
    { label: 'AI suggested', value: summary.aiSuggested, sub: 'a next step is known', tone: PURPLE },
    { label: 'Dormant', value: summary.customerQuiet, sub: 'went quiet on us', tone: PURPLE_DEEP },
  ] : []

  return (
    <div className="px-2 py-4" style={{ color: INK }}>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 28, letterSpacing: '-.03em', lineHeight: 1.05 }}>Follow-Ups</h1>
          <p className="text-sm mt-1" style={{ color: MUTED }}>Reach out at the right time. Turn quiet leads into new opportunities.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: MUTED }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          {selecting ? (
            <button type="button" onClick={leaveSelectMode}
              className="h-9 px-4 rounded-full border text-xs font-semibold cursor-pointer hover:bg-muted"
              style={{ borderColor: HAIRLINE }}>
              <X size={13} className="inline -mt-0.5 mr-1" /> Cancel
            </button>
          ) : (
            <button type="button" onClick={() => setSelecting(true)} disabled={!items.length}
              className="h-9 px-4 rounded-full text-xs font-semibold cursor-pointer disabled:opacity-40"
              style={{ background: PURPLE, color: '#fff', boxShadow: '0 8px 24px rgba(91,43,201,.22)' }}>
              + Send Follow-Up (Bulk)
            </button>
          )}
        </div>
      </div>

      {/* ── Tiles ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-5">
        {isLoading && !summary
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)
          : tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border px-4 py-3.5" style={{ borderColor: HAIRLINE, background: '#fff' }}>
              <div className="text-[11px] font-semibold uppercase" style={{ letterSpacing: '.06em', color: MUTED }}>{t.label}</div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, letterSpacing: '-.03em', lineHeight: 1.05, color: t.tone, marginTop: 4 }}>{t.value}</div>
              <div className="text-[11px] mt-0.5" style={{ color: MUTED }}>{t.sub}</div>
            </div>
          ))}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 mt-6 border-b overflow-x-auto" style={{ borderColor: HAIRLINE }}>
        {TABS.map((t) => {
          const on = tab === t.key
          const tone = t.key === 'needs_reply' ? '#B91C1C' : t.key === 'customer_quiet' ? PURPLE_DEEP : t.key === 'manual_due' ? '#92400E' : PURPLE
          return (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} title={t.blurb}
              className="flex items-center gap-1.5 px-2 pb-3 text-sm font-bold cursor-pointer -mb-px whitespace-nowrap"
              style={{ color: on ? tone : MUTED, borderBottom: `2px solid ${on ? tone : 'transparent'}` }}>
              {t.label}
              <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10.5px] font-bold"
                style={{ background: on ? tone : '#EEE9F6', color: on ? '#fff' : MUTED }}>
                {tabCounts[t.key]}
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-xs mt-2" style={{ color: MUTED }}>{TABS.find((t) => t.key === tab)?.blurb}</p>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone"
            className="h-9 w-[220px] border rounded-full pl-9 pr-3 text-sm bg-background" style={{ borderColor: HAIRLINE }} />
        </div>
        <select value={priority} onChange={(e) => setPriority(e.target.value as '' | FollowUpPriority)}
          className="h-9 border rounded-full px-3 text-sm bg-background" style={{ borderColor: HAIRLINE }}>
          <option value="">Any priority</option>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select value={temperature} onChange={(e) => setTemperature(e.target.value as '' | 'hot' | 'warm' | 'cold')}
          className="h-9 border rounded-full px-3 text-sm bg-background" style={{ borderColor: HAIRLINE }}>
          <option value="">Any intent</option>
          <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
        </select>
        {isAdmin && (
          <select value={owner} onChange={(e) => setOwner(e.target.value)}
            className="h-9 border rounded-full px-3 text-sm bg-background" style={{ borderColor: HAIRLINE }}>
            <option value="">All reps</option>
            {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        {selecting && visible.length > 0 && (
          <button type="button" onClick={selectAllVisible} className="ml-auto text-xs font-semibold cursor-pointer" style={{ color: PURPLE_DEEP }}>
            {visible.every((it) => selected.has(it.leadId)) ? 'Clear all shown' : `Select all shown (${visible.length})`}
          </button>
        )}
      </div>

      {/* ── List ─────────────────────────────────────────────────────────── */}
      <div className="mt-4 rounded-2xl border overflow-hidden" style={{ borderColor: HAIRLINE, background: '#fff' }}>
        {isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[76px]" />)}</div>
        ) : isError ? (
          <div className="p-8 text-center">
            <p className="text-sm font-semibold">Couldn&rsquo;t load the queue.</p>
            <button type="button" onClick={() => refetch()} className="mt-2 text-xs font-semibold cursor-pointer" style={{ color: PURPLE_DEEP }}>Retry</button>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold">{items.length && (search || priority || temperature) ? 'Nothing matches those filters.' : EMPTY[tab]}</p>
            {!items.length && <p className="text-xs mt-1" style={{ color: MUTED }}>Leads show up here the moment a customer is waiting on you, has gone quiet, or a follow-up you scheduled arrives.</p>}
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'rgba(20,8,31,.06)' }}>
            <div className="hidden lg:grid grid-cols-[28px_84px_1.6fr_1fr_2.2fr_1fr_120px] gap-3 items-center px-4 py-2 text-[11px] font-bold uppercase" style={{ letterSpacing: '.06em', color: MUTED, background: CREAM }}>
              <div />
              <div>Priority</div><div>Customer</div><div>{isAdmin ? 'Assigned to' : 'Waiting'}</div><div>Why</div><div>Stage</div><div />
            </div>
            {visible.map((it) => {
              const r = REASON_UI[it.reason]
              const p = PRIORITY_UI[it.priority]
              const on = selected.has(it.leadId)
              const recent = it.lastNudgedAt && Date.now() - new Date(it.lastNudgedAt).getTime() < 12 * 3600_000
              return (
                <div key={it.leadId}
                  className="grid grid-cols-1 lg:grid-cols-[28px_84px_1.6fr_1fr_2.2fr_1fr_120px] gap-2 lg:gap-3 lg:items-center px-4 py-3 hover:bg-[#FBF9FF] cursor-pointer"
                  style={{ background: on ? PURPLE_TINT : undefined }}
                  onClick={() => (selecting ? toggle(it.leadId) : setOpenId(it.leadId))}>
                  <div className="hidden lg:block" onClick={(e) => e.stopPropagation()}>
                    {selecting
                      ? <button type="button" onClick={() => toggle(it.leadId)} className="cursor-pointer" style={{ color: on ? PURPLE : MUTED }}>{on ? <CheckSquare size={17} /> : <Square size={17} />}</button>
                      : <span className="grid place-items-center rounded-full text-[10px] font-bold" style={{ width: 26, height: 26, background: '#EDE5FF', color: PURPLE_DEEP }}>{initialsOf(it.name)}</span>}
                  </div>
                  <div className="flex items-center gap-2 lg:block">
                    {selecting && <button type="button" onClick={(e) => { e.stopPropagation(); toggle(it.leadId) }} className="lg:hidden cursor-pointer" style={{ color: on ? PURPLE : MUTED }}>{on ? <CheckSquare size={17} /> : <Square size={17} />}</button>}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: p.bg, color: p.fg, letterSpacing: '.06em' }}>{p.label}</span>
                    <span className="lg:hidden px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: r.bg, color: r.fg }}>{r.label}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold truncate">{it.name}</span>
                      {it.temperature && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase" style={{ background: TEMP_UI[it.temperature].bg, color: TEMP_UI[it.temperature].fg }}>{it.temperature}</span>}
                    </div>
                    <div className="text-xs" style={{ color: MUTED }}>{it.phone}</div>
                  </div>
                  <div className="text-xs" style={{ color: MUTED }}>
                    {isAdmin && <div className="text-sm" style={{ color: INK }}>{it.ownerName}</div>}
                    <span className="hidden lg:inline">{it.daysWaiting === 0 ? agoText(it.since) : `${it.daysWaiting} day${it.daysWaiting === 1 ? '' : 's'}`}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="hidden lg:inline-block px-2 py-0.5 rounded-full text-[10px] font-bold mr-1.5 align-middle" style={{ background: r.bg, color: r.fg }}>{r.label}</span>
                    <span className="text-xs align-middle" style={{ color: '#4A4357' }}>{whyFor(it)}</span>
                    {recent && <span className="block text-[11px] mt-0.5 font-semibold" style={{ color: '#8A5A00' }}>⚠ Already messaged {agoText(it.lastNudgedAt)}{it.lastNudgedBy ? ` by ${it.lastNudgedBy}` : ''}</span>}
                  </div>
                  <div className="text-xs" style={{ color: MUTED }}>{stageText(it) || '—'}</div>
                  <div className="flex items-center gap-2 lg:justify-end" onClick={(e) => e.stopPropagation()}>
                    {it.reason === 'sales_response_overdue' && it.windowOpen ? (
                      <Link to={`/whatsapp?phone=${it.phoneNormalized}`} className="inline-flex items-center gap-1 h-8 px-3 rounded-full text-xs font-bold" style={{ background: '#DCFCE7', color: '#047857' }}>
                        <MessageCircle size={13} /> Reply
                      </Link>
                    ) : (
                      <button type="button" onClick={() => setOpenId(it.leadId)} className="h-8 px-3 rounded-full text-xs font-bold cursor-pointer" style={{ background: PURPLE, color: '#fff' }}>
                        Send
                      </button>
                    )}
                    <button type="button" onClick={() => setOpenId(it.leadId)} className="h-8 px-2.5 rounded-full border text-xs font-semibold cursor-pointer" style={{ borderColor: HAIRLINE, color: INK }}>View</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Sticky bulk bar ──────────────────────────────────────────────── */}
      {selecting && (
        <div className="sticky bottom-0 mt-4 -mx-2 px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: 'rgba(251,248,242,.94)', backdropFilter: 'blur(10px)', borderTop: `1px solid ${HAIRLINE}` }}>
          <span className="text-sm" style={{ color: MUTED }}>{selected.size === 0 ? 'Select the leads to follow up.' : `${selected.size} selected.`}</span>
          <button type="button" disabled={selected.size === 0} onClick={() => setBulkOpen(true)}
            className="h-10 px-5 rounded-full text-sm font-bold cursor-pointer disabled:opacity-40"
            style={{ background: PURPLE, color: '#fff', boxShadow: '0 8px 24px rgba(91,43,201,.22)' }}>
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

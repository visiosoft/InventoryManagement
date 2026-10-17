import { useEffect, useMemo, useState } from 'react'
import { IntentReportCard } from '../components/IntentReportCard'
import { LostReasonsCard } from '../components/LostReasonsCard'
import { SourceReportCard } from '../components/SourceReportCard'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CheckSquare, ChevronDown, Clock, HelpCircle, MessageCircle, Search, Square, X } from 'lucide-react'
import { followUpQueueApi, leadFollowUpApi, type FollowUpQueueItem } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Skeleton } from '../components/ui'
import FollowUpDrawer from '../components/FollowUpDrawer'
import FollowUpBulkModal from '../components/FollowUpBulkModal'
import PipelineFunnel from '../components/PipelineFunnel'
import { agoText, customerBadge, whyFor } from '../lib/followUpUi'

/**
 * Follow-Ups — who to contact next, and nothing else.
 *
 * Three tabs, by what the rep has to do:
 *   Reply now  — the customer wrote and is waiting for us
 *   Due today  — a follow-up is due (they went quiet, or a date we set came up)
 *   Coming up  — due on a later day; nothing to do yet
 * Hot leads (the AI's read of the chat) sort first inside each tab. Opening a
 * row shows the chat and the follow-up to send.
 */

const FONT = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif"
const TEXT = '#111827'
const SUB = '#6B7280'
const LINE = '#E5E7EB'
const BRAND = '#6D28D9'
const WA_GREEN = '#16A34A'

type Tab = 'reply' | 'missed' | 'today' | 'later' | 'sent'

/* A list nobody can finish is a list nobody opens. Each rep gets today's best
   DAILY_TARGET due follow-ups; the rest wait under Later, best first. Leads
   silent for STALE_DAYS+ stop being "due" and become a clean-up decision. */
const DAILY_TARGET = 30
const STALE_DAYS = 60

/** Where a lead sits, before the daily target is applied. */
type Base = 'reply' | 'missed' | 'due' | 'coming'
function baseOf(it: FollowUpQueueItem): Base {
  if (it.reason === 'sales_response_overdue') return it.windowOpen ? 'reply' : 'missed'
  if (it.window === 'now' || it.window === 'today' || it.window === 'exhausted') return 'due'
  return 'coming'
}
/** The final place: today's list, the backlog over the target, stale, or coming up. */
type Bucket = 'reply' | 'missed' | 'today' | 'backlog' | 'stale' | 'coming'
const LATER_SECTIONS: { key: Bucket; title: string }[] = [
  { key: 'backlog', title: `Due, but over today's ${DAILY_TARGET} — best first` },
  { key: 'stale', title: `Silent ${STALE_DAYS}+ days — close or nurture` },
  { key: 'coming', title: 'Coming up — nothing to do yet' },
]
/** Best first: the intent score when the chat has been read, else hot/warm/cold. */
function rank(it: FollowUpQueueItem) {
  return it.intent?.score ?? ({ hot: 70, warm: 50, cold: 30 } as const)[heat(it)]
}
const byBest = (a: FollowUpQueueItem, b: FollowUpQueueItem) => rank(b) - rank(a) || a.daysWaiting - b.daysWaiting

/** Hot, warm or cold — the AI's read of the chat; unread counts as warm. */
function heat(it: FollowUpQueueItem): 'hot' | 'warm' | 'cold' {
  if (it.intent) return it.intent.band === 'high' ? 'hot' : it.intent.band === 'low' ? 'cold' : 'warm'
  return it.temperature ?? 'warm'
}
const HEAT = {
  hot: { label: 'Hot', bg: '#FEE2E2', fg: '#B91C1C' },
  warm: { label: 'Warm', bg: '#FEF3C7', fg: '#B45309' },
  cold: { label: 'Cold', bg: '#E0F2FE', fg: '#0369A1' },
} as const

/** One plain line: what to do and why. */
function whatToDo(it: FollowUpQueueItem) {
  if (it.reason === 'sales_response_overdue') {
    return it.windowOpen
      ? `They wrote ${agoText(it.lastInboundAt || it.since)} — waiting for your reply`
      : `They wrote ${agoText(it.lastInboundAt || it.since)} and nobody answered — over 24 hours, send a template`
  }
  if (it.window === 'exhausted') return 'All follow-ups sent, no reply — keep, nurture or close?'
  if (it.daysWaiting >= STALE_DAYS) return `Silent for ${it.daysWaiting} days — close it, or move it to nurture`
  if (it.reason === 'manual_followup_due') return 'The follow-up you scheduled is due'
  const step = it.quietStage.total ? ` (follow-up ${Math.min(it.quietStage.next, it.quietStage.total)} of ${it.quietStage.total})` : ''
  return `Quiet for ${it.daysWaiting} day${it.daysWaiting === 1 ? '' : 's'}${step}`
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export default function FollowUps() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [tab, setTab] = useState<Tab>('reply')
  const [search, setSearch] = useState('')
  const [owner, setOwner] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['follow-up-queue', isAdmin ? owner : 'mine'],
    queryFn: () => followUpQueueApi.list(isAdmin && owner ? { owner } : undefined),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  })
  const items = data?.items ?? []

  // AI reads still being written on the server: come back for them once.
  useEffect(() => {
    if (!data?.aiPending) return
    const t = window.setTimeout(() => refetch(), 20_000)
    return () => window.clearTimeout(t)
  }, [data?.aiPending, refetch])

  const { data: log } = useQuery({
    queryKey: ['follow-up-completed', isAdmin ? owner : 'mine'],
    queryFn: () => leadFollowUpApi.log(isAdmin && owner ? { owner } : undefined),
    staleTime: 60_000,
    enabled: tab === 'sent',
  })
  const sent = (log?.rows ?? []).filter((r) => r.status === 'sent')

  const owners = useMemo(() => {
    const m = new Map<string, string>()
    for (const it of items) if (it.ownerId) m.set(it.ownerId, it.ownerName)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [items])

  // Every lead's place: due follow-ups are ranked per rep, the best
  // DAILY_TARGET make today's list, the rest go to Later.
  const bucketOf = useMemo(() => {
    const m = new Map<string, Bucket>()
    const dueByOwner = new Map<string, FollowUpQueueItem[]>()
    for (const it of items) {
      const b = baseOf(it)
      if (b !== 'due') { m.set(it.leadId, b); continue }
      if (it.daysWaiting >= STALE_DAYS) { m.set(it.leadId, 'stale'); continue }
      const k = it.ownerId || '-'
      if (!dueByOwner.has(k)) dueByOwner.set(k, [])
      dueByOwner.get(k)!.push(it)
    }
    for (const list of dueByOwner.values()) {
      list.sort(byBest).forEach((it, i) => m.set(it.leadId, i < DAILY_TARGET ? 'today' : 'backlog'))
    }
    return m
  }, [items])
  const inTab = (it: FollowUpQueueItem, t: Tab) => {
    const b = bucketOf.get(it.leadId)
    if (t === 'later') return b === 'backlog' || b === 'stale' || b === 'coming'
    return b === t
  }

  const counts = useMemo(() => ({
    reply: items.filter((it) => bucketOf.get(it.leadId) === 'reply').length,
    missed: items.filter((it) => bucketOf.get(it.leadId) === 'missed').length,
    today: items.filter((it) => bucketOf.get(it.leadId) === 'today').length,
    later: items.filter((it) => ['backlog', 'stale', 'coming'].includes(bucketOf.get(it.leadId) || '')).length,
  }), [items, bucketOf])

  // Start on the first tab that has something in it.
  const [picked, setPicked] = useState(false)
  useEffect(() => {
    if (picked || isLoading) return
    setPicked(true)
    setTab(counts.reply ? 'reply' : counts.missed ? 'missed' : counts.today ? 'today' : 'later')
  }, [picked, isLoading, counts])

  const visible = useMemo(() => {
    if (tab === 'sent') return []
    const q = search.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    const order = (it: FollowUpQueueItem) => LATER_SECTIONS.findIndex((x) => x.key === bucketOf.get(it.leadId))
    return items
      .filter((it) => inTab(it, tab))
      .filter((it) => !q || it.name.toLowerCase().includes(q) || (qDigits.length >= 4 && (it.phoneNormalized || '').includes(qDigits)))
      .sort((a, b) => (tab === 'later' ? order(a) - order(b) : 0) || byBest(a, b))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, tab, search, bucketOf])

  const openIndex = openId ? visible.findIndex((it) => it.leadId === openId) : -1
  const nextId = openIndex >= 0 && openIndex + 1 < visible.length ? visible[openIndex + 1].leadId : null
  const toDo = counts.reply + counts.missed + counts.today
  const doneToday = data?.doneToday ?? 0

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allOn = visible.length > 0 && visible.every((it) => selected.has(it.leadId))
  const toggleAll = () => setSelected((s) => { const n = new Set(s); visible.forEach((it) => (allOn ? n.delete(it.leadId) : n.add(it.leadId))); return n })
  const leaveSelect = () => { setSelecting(false); setSelected(new Set()) }

  const TABS: { key: Tab; label: string; count?: number; hint: string; alert?: boolean }[] = [
    { key: 'reply', label: 'Reply now', count: counts.reply, hint: 'They wrote in the last 24 hours — reply in the chat', alert: true },
    { key: 'missed', label: 'Missed', count: counts.missed, hint: 'They wrote over 24 hours ago and nobody answered — WhatsApp only allows a template now', alert: true },
    { key: 'today', label: 'Today', count: counts.today, hint: `Today's follow-ups — up to ${DAILY_TARGET} per rep, most promising first` },
    { key: 'later', label: 'Later', count: counts.later, hint: 'Over today\'s target, gone silent, or not due yet' },
    { key: 'sent', label: 'Sent', hint: 'Follow-ups sent, last 30 days' },
  ]

  return (
    <div className="px-1 py-3" style={{ fontFamily: FONT, color: TEXT }}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>Follow-Ups</h1>
          <p className="text-[14px] mt-1" style={{ color: SUB }}>
            {toDo === 0 ? 'All caught up for today.' : <><b style={{ color: TEXT }}>{toDo}</b> to do today</>}
            {doneToday > 0 && <> · {doneToday} done</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setHelpOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13px] font-medium cursor-pointer bg-white" style={{ borderColor: LINE, color: SUB }}>
            <HelpCircle size={15} /> How it works
          </button>
          {selecting ? (
            <button type="button" onClick={leaveSelect}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13px] font-semibold cursor-pointer bg-white" style={{ borderColor: LINE }}>
              <X size={14} /> Cancel
            </button>
          ) : tab !== 'sent' && visible.length > 0 && (
            <button type="button" onClick={() => setSelecting(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13px] font-semibold cursor-pointer bg-white" style={{ borderColor: LINE, color: BRAND }}>
              Send to several
            </button>
          )}
        </div>
      </div>

      {helpOpen && (
        <div className="mt-3 rounded-xl border p-4 text-[13.5px] leading-relaxed" style={{ borderColor: '#DDD6FE', background: '#F5F3FF' }}>
          <div className="font-bold mb-1.5">How follow-ups work</div>
          <ol className="list-decimal pl-5 space-y-1">
            <li><b>Reply now</b> — they wrote in the last 24 hours and are waiting for us. Reply in the chat.</li>
            <li><b>Missed</b> — they wrote more than 24 hours ago and nobody answered. WhatsApp now only allows an approved template, so send one. Keep this tab empty.</li>
            <li><b>Today</b> — follow-ups due today, up to {DAILY_TARGET} per rep, most promising first. Quiet leads get up to 3 follow-ups: by default 3 days after our last message, then 7 days after that, then 14. A follow-up date you set on a lead also lands here on that day.</li>
            <li><b>Later</b> — follow-ups over today&rsquo;s {DAILY_TARGET} (best first), leads silent {STALE_DAYS}+ days that need a decision (close or nurture), and follow-ups not due yet.</li>
            <li>After the last follow-up with no reply, the lead asks you to <b>decide</b>: keep chasing, nurture, or close it.</li>
          </ol>
          <p className="mt-2" style={{ color: SUB }}>
            <b style={{ color: TEXT }}>Hot / Warm / Cold</b> is the AI&rsquo;s read of the chat — hot leads are listed first.
            Tap any row to see the chat and send the follow-up. When they reply, the follow-ups stop by themselves.
          </p>
        </div>
      )}

      {/* Tabs + search */}
      <div className="flex flex-wrap items-end gap-3 mt-5 border-b" style={{ borderColor: LINE }}>
        <div className="flex gap-1 overflow-x-auto flex-1 min-w-0">
          {TABS.map((t) => {
            const on = tab === t.key
            return (
              <button key={t.key} type="button" onClick={() => { setTab(t.key); leaveSelect() }} title={t.hint}
                className="flex items-center gap-2 px-3 pb-3 pt-1 text-[14px] font-semibold cursor-pointer -mb-px whitespace-nowrap"
                style={{ color: on ? BRAND : SUB, borderBottom: `2px solid ${on ? BRAND : 'transparent'}` }}>
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-md text-[11.5px] font-bold"
                    style={{ background: t.alert ? '#FEE2E2' : '#EDE9FE', color: t.alert ? '#B91C1C' : BRAND }}>{t.count}</span>
                )}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 pb-2">
          {isAdmin && (
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className="h-9 border rounded-lg px-2 text-[13px] bg-white" style={{ borderColor: LINE }}>
              <option value="">Everyone</option>
              {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: SUB }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or phone"
              className="h-9 w-[170px] border rounded-lg pl-9 pr-3 text-[13px] bg-white" style={{ borderColor: LINE }} />
          </div>
        </div>
      </div>
      <p className="text-[12.5px] mt-2" style={{ color: SUB }}>{TABS.find((t) => t.key === tab)?.hint}</p>

      {/* List */}
      <div className="mt-2 rounded-xl border bg-white overflow-hidden" style={{ borderColor: LINE }}>
        {tab === 'sent' ? (
          sent.length === 0 ? (
            <div className="p-10 text-center text-[14px] font-semibold">No follow-ups sent in the last 30 days.</div>
          ) : sent.map((r) => (
            <button key={r.id} type="button" onClick={() => r.leadId && setOpenId(r.leadId)}
              className="w-full text-left flex items-center gap-3 px-4 py-3 border-t first:border-t-0 hover:bg-gray-50 cursor-pointer" style={{ borderColor: LINE }}>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-bold truncate">{r.leadName || r.phone}</div>
                <div className="text-[12.5px] truncate" style={{ color: SUB }}>{r.templateLabel} · sent {agoText(r.sentAt)}{r.sentByName ? ` by ${r.sentByName}` : ''}</div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap"
                style={r.repliedAt ? { background: '#DCFCE7', color: '#15803D' } : { background: '#F3F4F6', color: SUB }}>
                {r.repliedAt ? `Replied ${agoText(r.repliedAt)}` : 'No reply yet'}
              </span>
            </button>
          ))
        ) : isLoading ? (
          <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[56px]" />)}</div>
        ) : isError ? (
          <div className="p-8 text-center">
            <p className="text-[14px] font-semibold">Couldn&rsquo;t load follow-ups.</p>
            <button type="button" onClick={() => refetch()} className="mt-2 text-[13px] font-semibold cursor-pointer" style={{ color: BRAND }}>Try again</button>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-[14px] font-semibold">
            {search ? 'Nobody matches that search.' : tab === 'reply' ? 'Nobody is waiting for a reply. 👍' : tab === 'today' ? 'No follow-ups due today. 👍' : 'Nothing coming up.'}
          </div>
        ) : (
          <>
            {selecting && (
              <div className="flex items-center gap-2 px-4 py-2 border-b text-[13px]" style={{ borderColor: LINE, background: '#F9FAFB' }}>
                <button type="button" onClick={toggleAll} className="inline-flex items-center gap-1.5 cursor-pointer font-semibold" style={{ color: BRAND }}>
                  {allOn ? <CheckSquare size={16} /> : <Square size={16} />} Select all {visible.length}
                </button>
              </div>
            )}
            {visible.map((it, idx) => {
              const h = HEAT[heat(it)]
              const on = selected.has(it.leadId)
              const badge = customerBadge(it.customer)
              const b = bucketOf.get(it.leadId)
              // In Later, a small heading where each section starts.
              const section = tab === 'later' && (idx === 0 || bucketOf.get(visible[idx - 1].leadId) !== b)
                ? LATER_SECTIONS.find((x) => x.key === b)?.title : null
              return (
                <div key={it.leadId}>
                {section && (
                  <div className={`px-4 py-2 text-[11.5px] font-bold uppercase ${idx === 0 ? '' : 'border-t'}`} style={{ color: SUB, background: '#F9FAFB', borderColor: LINE, letterSpacing: '.05em' }}>
                    {section} · {visible.filter((x) => bucketOf.get(x.leadId) === b).length}
                  </div>
                )}
                <div
                  onClick={() => (selecting ? toggle(it.leadId) : setOpenId(it.leadId))}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer ${idx === 0 && !section ? '' : 'border-t'}`}
                  style={{ borderColor: LINE, background: on ? '#F5F3FF' : undefined }}>
                  {selecting && (
                    <span style={{ color: on ? BRAND : '#D1D5DB' }}>{on ? <CheckSquare size={17} /> : <Square size={17} />}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14.5px] font-bold">{it.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: h.bg, color: h.fg }}>{h.label}</span>
                      {badge && <span title={badge.title} className="px-1.5 py-0.5 rounded text-[10.5px] font-bold" style={{ background: badge.bg, color: badge.fg }}>{badge.label}</span>}
                    </div>
                    <div className="text-[13px] mt-0.5 truncate" style={{ color: SUB }} title={whyFor(it)}>
                      {whatToDo(it)}
                      {isAdmin && !owner && it.ownerName ? ` · ${it.ownerName}` : ''}
                    </div>
                  </div>
                  {!selecting && (
                    <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                      {b === 'reply' ? (
                        <Link to={`/whatsapp?phone=${it.phoneNormalized}`} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold text-white" style={{ background: WA_GREEN }}>
                          <MessageCircle size={14} /> Reply
                        </Link>
                      ) : b === 'coming' ? (
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: SUB }}>
                          <Clock size={13} /> {it.nextContactAt ? fmtDay(it.nextContactAt) : 'Later'}
                        </span>
                      ) : (
                        <button type="button" onClick={() => setOpenId(it.leadId)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold text-white cursor-pointer" style={{ background: WA_GREEN }}>
                          <MessageCircle size={14} /> {it.window === 'exhausted' || b === 'stale' ? 'Decide' : 'Follow up'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {selecting && (
        <div className="sticky bottom-0 mt-3 px-4 py-3 flex items-center justify-between gap-3 flex-wrap rounded-xl border bg-white/95 backdrop-blur" style={{ borderColor: LINE }}>
          <span className="text-[13px]" style={{ color: SUB }}>{selected.size === 0 ? 'Tap the leads to include.' : `${selected.size} selected`}</span>
          <button type="button" disabled={selected.size === 0} onClick={() => setBulkOpen(true)}
            className="h-10 px-5 rounded-lg text-[14px] font-semibold text-white cursor-pointer disabled:opacity-40" style={{ background: BRAND }}>
            Review {selected.size || ''} message{selected.size === 1 ? '' : 's'}
          </button>
        </div>
      )}

      {/* Reports, out of the way */}
      {isAdmin && (
        <div className="mt-6">
          <button type="button" onClick={() => setReportsOpen((v) => !v)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer" style={{ color: SUB }}>
            <ChevronDown size={15} style={{ transform: reportsOpen ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
            {reportsOpen ? 'Hide' : 'Show'} pipeline &amp; reports
          </button>
          {reportsOpen && (
            <div className="mt-2">
              <PipelineFunnel />
              <IntentReportCard />
              <LostReasonsCard />
              <SourceReportCard />
            </div>
          )}
        </div>
      )}

      {openId && (
        <FollowUpDrawer
          leadId={openId}
          nextLeadId={nextId}
          position={openIndex >= 0 ? { index: openIndex + 1, total: visible.length } : undefined}
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
          onDone={() => { setBulkOpen(false); leaveSelect(); refetch() }}
        />
      )}
    </div>
  )
}

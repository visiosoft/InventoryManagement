import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, AlarmClock, Check, ChevronsRight, MessageCircle, Plus, X } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import WhatsApp from './WhatsApp'

/**
 * A rep's morning, on one screen.
 *
 * Everything here already existed and was spread across four pages: reminders
 * set from a chat, tasks on the board, customers waiting for an answer, and
 * chats that had gone quiet. A rep opening the app landed on every lead they
 * own, sorted by nothing in particular, and assembled their own day out of it
 * — or, more often, did not.
 *
 * The screen answers three questions in the order they cost money: who am I
 * keeping waiting, what did I promise today, and how am I tracking. The two
 * hero cards are deliberately unequal — orange is used nowhere else on this
 * page, so the one card that means "somebody is hanging on you" is the only
 * thing shouting.
 *
 * Built to the handoff spec's tokens. Two departures from it, both deliberate:
 *
 *   The slide-over hosts the real WhatsApp console rather than a second
 *   composer. The spec drew a text box with three canned openers; the console
 *   already sends media and voice notes, carries the assistant's suggestions,
 *   and has the 24-hour window rules in it. A parallel composer would be a
 *   worse one that drifts.
 *
 *   Numbers are what the database says, not the spec's illustrative figures.
 *   Where a figure has no honest source — WhatsApp "unread" is per-browser,
 *   not a server fact — the card says something true instead of inventing it.
 */

/* ── Tokens, from the handoff ─────────────────────────────────────────────── */
const INK = '#14081F'
const INK2 = '#4A4357'
const INK3 = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_700 = '#4A1FA0'
const PURPLE_100 = '#EDE5FF'
const PURPLE_50 = '#F7F3FF'
const PURPLE_200 = '#DDD0FF'
const PAPER = '#FBF8F2'
const SURFACE2 = '#FDFCFA'
const ORANGE = '#F4511E'
const ORANGE_INK = '#9A2C06'
const ORANGE_INK2 = '#B4441A'
const ORANGE_50 = '#FFF4F0'
const GREEN = '#16A34A'
const GREEN_50 = '#E8FBEF'
const GREEN_700 = '#15803D'
const NEUTRAL_100 = '#F4F2F7'
const HAIRLINE = 'rgba(20,8,31,.09)'
const DISPLAY = "'Bricolage Grotesque', 'Plus Jakarta Sans', system-ui, sans-serif"

const CARD: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${HAIRLINE}`,
  borderRadius: 20,
  boxShadow: '0 1px 2px rgba(20,8,31,.05)',
}

type Person = { leadId: string; name: string; phone: string; phoneNormalized: string }
type Reminder = Person & { at: string; overdue: boolean }
type Waiting = Person & { since: string; lastText: string }
type Quiet = Person & { since: string; days: number }
type Fresh = Person & { assignedAt: string }
type Task = {
  _id: string; taskNo: string; title: string; dueDate: string
  priority: string; leadName: string; leadId: string | null; overdue: boolean
}
type Stage = { key: string; label: string }
type Counter = { leads: number; booked: number; value: number }
type Booking = {
  contractNo: string; unit: string; sizeSqf: number | null
  rate: number; tenant: string; status: string; startDate: string
}
type MyDayData = {
  reminders: Reminder[]
  tasks: Task[]
  waiting: Waiting[]
  quiet: Quiet[]
  fresh: Fresh[]
  stages: Stage[]
  pipeline: Record<'all' | 'hot' | 'warm' | 'cold', Record<string, number>>
  bookings: Booking[]
  counters: { today: Counter; week: Counter; month: Counter }
  target: { goal: number; booked: number; daysLeft: number }
  quietAfterDays: number
}

/** A wait, in the units somebody would say out loud. */
function waitLabel(since: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ${mins % 60}m`
  return `${h}h ${mins % 60}m`
}

function timeOfDay(at: string) {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function initialsOf(name: string) {
  const parts = String(name).replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'WA'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

function money(n: number) {
  return n.toLocaleString('en-AE', { maximumFractionDigits: 0 })
}

export default function MyDay() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [range, setRange] = useState<'today' | 'week' | 'month'>('today')
  const [temp, setTemp] = useState<'all' | 'hot' | 'warm' | 'cold'>('all')
  const [stage, setStage] = useState<string | null>(null)
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null)
  /* When they wrote, as a way of cutting the waiting list.
   *
   * The longest waits are over nine days old, so "everyone who is waiting" is
   * a list nobody finishes. Today and Yesterday are the ones still worth a
   * fast answer; the rest is a backlog to work through, not a morning. */
  const [waitWhen, setWaitWhen] = useState<'all' | 'today' | 'yesterday' | 'week'>('all')
  /** The chat open in the slide-over, by number. */
  const [chatPhone, setChatPhone] = useState<string | null>(null)

  const { data, isLoading } = useQuery<MyDayData>({
    queryKey: ['my-day'],
    queryFn: () => api.get('/my-day').then((r) => r.data),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  /* Snoozing and completing both write the lead's follow-up date, which is the
     same field the chat's "Remind me" button sets — one clock, three ways in. */
  const remind = useMutation({
    mutationFn: ({ phone, when }: { phone: string; when: string }) =>
      api.post(`/whatsapp/${phone}/remind`, { when }),
    onSuccess: () => { setSnoozeFor(null); qc.invalidateQueries({ queryKey: ['my-day'] }) },
  })

  // Escape closes the slide-over, which is what every drawer in the app does.
  useEffect(() => {
    if (!chatPhone) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setChatPhone(null) }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [chatPhone])

  const firstName = String(user?.name || '').trim().split(/\s+/)[0] || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const dateLine = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  const reminders = data?.reminders ?? []
  const waiting = data?.waiting ?? []
  const tasks = data?.tasks ?? []
  const overdueReminders = reminders.filter((r) => r.overdue).length

  const counts = data?.pipeline?.[temp] ?? {}
  const stages = data?.stages ?? []
  const maxCount = Math.max(1, ...stages.map((s) => counts[s.key] ?? 0))
  const openCount = stages.slice(0, 6).reduce((sum, s) => sum + (counts[s.key] ?? 0), 0)

  /* Local day boundaries, so "today" is the day the rep is having rather than
     whatever UTC thinks. */
  const dayStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }, [])
  const yesterdayStart = dayStart - 864e5
  const weekStart = useMemo(() => {
    const d = new Date(dayStart)
    // Monday first: a sales week is not a calendar accident.
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d.getTime()
  }, [dayStart])

  const inWindow = (since: string, window: typeof waitWhen) => {
    const at = new Date(since).getTime()
    if (window === 'today') return at >= dayStart
    if (window === 'yesterday') return at >= yesterdayStart && at < dayStart
    if (window === 'week') return at >= weekStart
    return true
  }

  const waitingShown = waiting.filter((w) => inWindow(w.since, waitWhen))
  const waitCounts = {
    all: waiting.length,
    today: waiting.filter((w) => inWindow(w.since, 'today')).length,
    yesterday: waiting.filter((w) => inWindow(w.since, 'yesterday')).length,
    week: waiting.filter((w) => inWindow(w.since, 'week')).length,
  }

  const counter = data?.counters?.[range]
  const kpis = useMemo(() => {
    if (!counter) return []
    const window = range === 'today' ? 'today' : range === 'week' ? 'this week' : 'this month'
    return [
      { label: `Leads given to you ${window}`, value: String(counter.leads), sub: `${data?.fresh.length ?? 0} not opened yet`, tone: 'neutral' as const },
      { label: `Units booked ${window}`, value: String(counter.booked), sub: counter.value ? `AED ${money(counter.value)} monthly value` : 'nothing signed yet', tone: 'good' as const },
      { label: 'Waiting on a reply', value: String(waiting.length), sub: waiting.length ? `longest ${waitLabel(waiting[0].since)}` : 'everyone has been answered', tone: waiting.length ? 'warn' as const : 'good' as const },
      { label: `Quiet ${data?.quietAfterDays ?? 3}+ days`, value: String(data?.quiet.length ?? 0), sub: 'we spoke last, nothing came back', tone: 'neutral' as const },
    ]
  }, [counter, range, waiting, data])

  if (isLoading) {
    return <div style={{ padding: 28, color: INK3, fontSize: 13 }}>Loading your day…</div>
  }

  const target = data?.target
  const targetPct = target?.goal ? Math.min(100, Math.round((target.booked / target.goal) * 100)) : 0

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK }}>
      <style>{`
        @keyframes pbPulse { 0%,100% { opacity:1 } 50% { opacity:.35 } }
        @keyframes pbSlide { from { transform:translateX(24px); opacity:0 } to { transform:translateX(0); opacity:1 } }
        .pb-wait-row:hover { border-color:${ORANGE} !important; transform:translateX(2px); }
        .pb-rm-row:hover { border-color:${PURPLE_200} !important; background:#FCFAFF !important; }
        .pb-stage:hover, .pb-task:hover { background:${PAPER}; }
        .pb-book:hover { border-color:${PURPLE_200} !important; background:#FCFAFF !important; }
        .pb-ico:hover { background:${PURPLE_100} !important; color:${PURPLE} !important; }
        .pb-ico-green:hover { background:${GREEN} !important; color:#fff !important; }
        .pb-ico-done:hover { background:${GREEN} !important; color:#fff !important; }
        @media (prefers-reduced-motion: reduce) {
          .pb-wait-row:hover { transform:none; }
          [data-pulse] { animation:none !important; }
        }
      `}</style>

      {/* ── Greeting + range ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-5" style={{ marginBottom: 20 }}>
        <div>
          <h1 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 34, letterSpacing: '-.03em', margin: 0, lineHeight: 1.05 }}>
            {greeting}, {firstName}
          </h1>
          <p style={{ margin: '7px 0 0', fontSize: 14, color: INK2 }}>{dateLine}</p>
        </div>
        <div
          className="flex items-center"
          style={{ marginLeft: 'auto', gap: 6, background: '#fff', border: '1px solid rgba(20,8,31,.10)', borderRadius: 20, padding: 4 }}
        >
          {([['today', 'Today'], ['week', 'This week'], ['month', 'This month']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className="cursor-pointer"
              style={{
                padding: '8px 18px', borderRadius: 20, fontSize: 13, fontWeight: 600, border: 'none',
                color: range === key ? '#fff' : INK2,
                background: range === key ? PURPLE : 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Hero split ───────────────────────────────────────────────────── */}
      <div className="grid gap-5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', marginBottom: 20 }}>

        {/* Reminders — what you promised */}
        <section style={{ ...CARD, padding: '22px 22px 12px', boxShadow: '0 1px 2px rgba(20,8,31,.05), 0 6px 20px rgba(20,8,31,.04)' }}>
          <div className="flex items-center gap-3">
            <div style={{ width: 34, height: 34, borderRadius: 10, background: PURPLE_50, color: PURPLE, display: 'grid', placeItems: 'center' }}>
              <AlarmClock size={17} />
            </div>
            <div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, letterSpacing: '-.02em' }}>Reminders due today</div>
              <div style={{ fontSize: 12.5, color: INK3, marginTop: 1 }}>
                {overdueReminders} overdue · {Math.max(0, reminders.length - overdueReminders)} later today
              </div>
            </div>
            <div style={{ marginLeft: 'auto', fontFamily: DISPLAY, fontSize: 32, fontWeight: 700, letterSpacing: '-.03em', color: PURPLE }}>
              {reminders.length}
            </div>
          </div>

          <div className="flex flex-col" style={{ gap: 8, marginTop: 18 }}>
            {reminders.length === 0 && (
              <div style={{ fontSize: 13, color: INK3, padding: '10px 2px 14px' }}>
                Nothing promised for today. Reminders you set from a chat land here.
              </div>
            )}
            {reminders.slice(0, 4).map((r) => (
              <div
                key={r.leadId}
                className="pb-rm-row"
                style={{ border: `1px solid ${HAIRLINE}`, borderRadius: 14, padding: '13px 14px', background: SURFACE2 }}
              >
                <div className="flex items-center gap-2.5">
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.overdue ? ORANGE : PURPLE, flex: '0 0 7px' }} />
                  <span className="truncate" style={{ fontSize: 13.5, fontWeight: 700 }}>{r.name}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap',
                    color: r.overdue ? ORANGE : PURPLE,
                    background: r.overdue ? 'rgba(244,81,30,.12)' : PURPLE_50,
                  }}>
                    {r.overdue ? `Overdue · ${timeOfDay(r.at)}` : `Due ${timeOfDay(r.at)}`}
                  </span>
                  <div className="flex" style={{ marginLeft: 'auto', gap: 6 }}>
                    <button type="button" title="Open WhatsApp" onClick={() => setChatPhone(r.phoneNormalized)}
                      className="pb-ico-green cursor-pointer"
                      style={{ width: 30, height: 30, borderRadius: 9, background: GREEN_50, color: GREEN, display: 'grid', placeItems: 'center', border: 'none' }}>
                      <MessageCircle size={15} />
                    </button>
                    <button type="button" title="Snooze" onClick={() => setSnoozeFor(snoozeFor === r.leadId ? null : r.leadId)}
                      className="pb-ico cursor-pointer"
                      style={{ width: 30, height: 30, borderRadius: 9, background: NEUTRAL_100, color: INK2, display: 'grid', placeItems: 'center', border: 'none' }}>
                      <ChevronsRight size={15} />
                    </button>
                    <button type="button" title="Mark done" disabled={remind.isPending}
                      onClick={() => remind.mutate({ phone: r.phoneNormalized, when: 'clear' })}
                      className="pb-ico-done cursor-pointer"
                      style={{ width: 30, height: 30, borderRadius: 9, background: NEUTRAL_100, color: INK2, display: 'grid', placeItems: 'center', border: 'none' }}>
                      <Check size={15} />
                    </button>
                  </div>
                </div>

                {snoozeFor === r.leadId && (
                  <div className="flex items-center" style={{ gap: 7, marginTop: 11, padding: '10px 0 2px 17px', borderTop: '1px dashed rgba(20,8,31,.12)' }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: INK3 }}>Snooze for</span>
                    {([['tomorrow', 'Tomorrow'], ['three_days', 'In 3 days'], ['next_week', 'Next week']] as const).map(([when, label]) => (
                      <button key={when} type="button" onClick={() => remind.mutate({ phone: r.phoneNormalized, when })}
                        className="cursor-pointer"
                        style={{ fontSize: 12, fontWeight: 600, color: PURPLE_700, background: PURPLE_50, border: `1px solid ${PURPLE_200}`, borderRadius: 20, padding: '5px 12px' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center', padding: '12px 0 8px', fontSize: 12.5, fontWeight: 600, color: PURPLE }}>
            <Link to="/tasks" style={{ color: PURPLE }}>
              {reminders.length > 4 ? `View all ${reminders.length} reminders` : 'View all reminders in Tasks'}
            </Link>
          </div>
        </section>

        {/* Waiting — the urgency hero. The only orange on the page. */}
        <section style={{
          background: ORANGE_50, border: '1px solid rgba(244,81,30,.28)', borderRadius: 20,
          padding: '22px 22px 14px', boxShadow: '0 1px 2px rgba(244,81,30,.06), 0 6px 20px rgba(244,81,30,.06)',
        }}>
          <div className="flex items-center gap-3">
            <div style={{ width: 34, height: 34, borderRadius: 10, background: ORANGE, color: '#fff', display: 'grid', placeItems: 'center' }}>
              <AlertTriangle size={17} />
            </div>
            <div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, letterSpacing: '-.02em', color: ORANGE_INK }}>
                Leads waiting on you
              </div>
              <div style={{ fontSize: 12.5, color: ORANGE_INK2, marginTop: 1 }}>
                {waitingShown.length
                  ? `Longest ${waitLabel(waitingShown[0].since)} with no reply`
                  : waiting.length ? 'Nothing in this window' : 'Nobody is waiting'}
              </div>
            </div>
            <div className="flex items-center" style={{ marginLeft: 'auto', gap: 7 }}>
              {waitingShown.length > 0 && (
                <span data-pulse style={{ width: 8, height: 8, borderRadius: '50%', background: ORANGE, animation: 'pbPulse 1.8s ease-in-out infinite' }} />
              )}
              <span style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 700, letterSpacing: '-.03em', color: ORANGE }}>
                {waitingShown.length}
              </span>
              {/* The headline follows the filter, so it can never disagree with
                  the list under it — but the whole number stays visible, or
                  narrowing the window would look like the backlog went away. */}
              {waitWhen !== 'all' && (
                <span style={{ fontSize: 12.5, color: ORANGE_INK2, fontWeight: 600 }}>of {waiting.length}</span>
              )}
            </div>
          </div>

          {/* When they wrote. Counts on the chips, so choosing one is an
              informed decision rather than a guess at what is behind it. */}
          <div className="flex flex-wrap" style={{ gap: 6, marginTop: 14 }}>
            {([['all', 'All'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week']] as const).map(([key, label]) => {
              const active = waitWhen === key
              const n = waitCounts[key]
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setWaitWhen(key)}
                  disabled={n === 0 && key !== 'all'}
                  className="cursor-pointer disabled:cursor-default"
                  style={{
                    fontSize: 11.5, fontWeight: 600, borderRadius: 20, padding: '5px 12px',
                    color: active ? '#fff' : n === 0 && key !== 'all' ? 'rgba(154,44,6,.38)' : ORANGE_INK,
                    background: active ? ORANGE : '#fff',
                    border: `1px solid ${active ? ORANGE : 'rgba(244,81,30,.28)'}`,
                    opacity: n === 0 && key !== 'all' ? 0.6 : 1,
                  }}
                >
                  {label}
                  <span style={{ marginLeft: 5, fontWeight: 800 }}>{n}</span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-col" style={{ gap: 8, marginTop: 18 }}>
            {waitingShown.length === 0 && (
              <div style={{ fontSize: 13, color: ORANGE_INK2, padding: '10px 2px 6px' }}>
                {waiting.length
                  ? 'Nobody wrote in this window. Try All to see the rest.'
                  : 'Every customer who wrote to you has had an answer. This is what finished looks like.'}
              </div>
            )}
            {waitingShown.slice(0, 5).map((w) => (
              <button
                key={w.leadId}
                type="button"
                onClick={() => setChatPhone(w.phoneNormalized)}
                className="pb-wait-row flex items-center text-left cursor-pointer"
                style={{
                  gap: 11, background: '#fff', border: '1px solid rgba(244,81,30,.18)',
                  borderRadius: 14, padding: '12px 14px', transition: 'transform .12s ease, border-color .12s ease',
                }}
              >
                <span style={{
                  width: 30, height: 30, borderRadius: '50%', background: PURPLE_100, color: PURPLE_700,
                  display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 700, flex: '0 0 30px',
                }}>
                  {initialsOf(w.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="truncate block" style={{ fontSize: 13.5, fontWeight: 700 }}>{w.name}</span>
                  <span className="truncate block" style={{ fontSize: 11.5, color: INK3, marginTop: 1 }}>
                    {w.lastText || 'No message text'}
                  </span>
                </span>
                <span style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 700, color: ORANGE, minWidth: 62, textAlign: 'right' }}>
                  {waitLabel(w.since)}
                </span>
              </button>
            ))}
          </div>

          <div className="flex items-center" style={{ gap: 8, padding: '14px 2px 6px' }}>
            <span style={{ fontSize: 12, color: ORANGE_INK2 }}>
              {waitingShown.length > 5 ? `${waitingShown.length - 5} more waiting` : 'They wrote to you, nobody has replied'}
            </span>
            {waitingShown.length > 0 && (
              <button
                type="button"
                onClick={() => setChatPhone(waitingShown[0].phoneNormalized)}
                className="flex items-center cursor-pointer"
                style={{ marginLeft: 'auto', gap: 8, background: ORANGE, color: '#fff', border: 'none', borderRadius: 20, padding: '9px 16px', fontSize: 12.5, fontWeight: 600 }}
              >
                <MessageCircle size={14} /> Start with the oldest
              </button>
            )}
          </div>
        </section>
      </div>

      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', marginBottom: 20 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ ...CARD, borderRadius: 18, padding: '18px 18px 20px' }}>
            <div className="flex items-center gap-2.5">
              <div style={{ fontSize: 12.5, fontWeight: 600, color: INK2 }}>{k.label}</div>
              <div style={{
                marginLeft: 'auto', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap',
                color: k.tone === 'warn' ? ORANGE : k.tone === 'good' ? GREEN_700 : INK2,
                background: k.tone === 'warn' ? 'rgba(244,81,30,.12)' : k.tone === 'good' ? 'rgba(22,163,74,.12)' : 'rgba(20,8,31,.06)',
              }}>
                {k.tone === 'warn' ? 'needs you' : k.tone === 'good' ? 'on top' : 'live'}
              </div>
            </div>
            <div style={{ fontFamily: DISPLAY, fontSize: 36, fontWeight: 700, letterSpacing: '-.03em', marginTop: 10, lineHeight: 1 }}>
              {k.value}
            </div>
            <div style={{ fontSize: 12, color: INK3, marginTop: 8 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Pipeline + tasks ─────────────────────────────────────────────── */}
      <div className="grid gap-5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', marginBottom: 20 }}>

        <section style={{ ...CARD, padding: 22 }}>
          <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 6 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, letterSpacing: '-.02em' }}>My pipeline</div>
            <div style={{ fontSize: 12.5, color: INK3 }}>
              {openCount} open · {counts.won ?? 0} won
            </div>
            <div className="flex" style={{ marginLeft: 'auto', gap: 5 }}>
              {(['all', 'hot', 'warm', 'cold'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTemp(t)} className="cursor-pointer"
                  style={{
                    fontSize: 11.5, fontWeight: 600, borderRadius: 20, padding: '5px 12px', textTransform: 'capitalize',
                    color: temp === t ? '#fff' : INK2,
                    background: temp === t ? INK : '#fff',
                    border: `1px solid ${temp === t ? INK : 'rgba(20,8,31,.14)'}`,
                  }}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col">
            {stages.map((st) => {
              const n = counts[st.key] ?? 0
              const selected = stage === st.key
              const fill = st.key === 'lost' ? 'rgba(20,8,31,.22)'
                : st.key === 'won' ? GREEN
                  : selected ? ORANGE : PURPLE
              return (
                <Link
                  key={st.key}
                  to={`/my-leads?status=${st.key}`}
                  onMouseEnter={() => setStage(st.key)}
                  onMouseLeave={() => setStage(null)}
                  className="pb-stage flex items-center"
                  style={{ gap: 14, padding: '9px 8px', borderRadius: 11, color: 'inherit', textDecoration: 'none' }}
                >
                  <span style={{ width: 150, flex: '0 0 150px', fontSize: 13, fontWeight: 600, color: selected ? ORANGE : INK }}>
                    {st.label}
                  </span>
                  <span style={{ flex: 1, height: 22, borderRadius: 7, background: NEUTRAL_100, overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', borderRadius: 7, background: fill, width: `${Math.round((n / maxCount) * 100)}%`, transition: 'width .2s ease' }} />
                  </span>
                  <span style={{ width: 34, textAlign: 'right', fontFamily: DISPLAY, fontSize: 16, fontWeight: 700 }}>{n}</span>
                </Link>
              )
            })}
          </div>
        </section>

        <section style={{ ...CARD, padding: 22 }}>
          <div className="flex items-center gap-3">
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, letterSpacing: '-.02em' }}>My tasks</div>
            <div style={{ fontSize: 12.5, color: INK3 }}>
              {tasks.filter((t) => t.overdue).length} overdue · {tasks.length} due
            </div>
            <Link to="/tasks" style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 600, color: PURPLE }}>The board</Link>
          </div>
          <div className="flex flex-col" style={{ gap: 2, marginTop: 14 }}>
            {tasks.length === 0 && (
              <div style={{ fontSize: 13, color: INK3, padding: '8px 2px' }}>Nothing due today.</div>
            )}
            {tasks.slice(0, 6).map((t) => (
              <Link key={t._id} to="/tasks" className="pb-task flex items-start"
                style={{ gap: 12, padding: '11px 10px', borderRadius: 12, color: 'inherit', textDecoration: 'none' }}>
                <span style={{
                  width: 19, height: 19, borderRadius: 6, border: '2px solid rgba(20,8,31,.22)',
                  display: 'grid', placeItems: 'center', flex: '0 0 19px', marginTop: 1,
                }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate" style={{ fontSize: 13.5, fontWeight: 600 }}>{t.title}</span>
                  {t.leadName && <span className="block truncate" style={{ fontSize: 11.5, color: INK3, marginTop: 3 }}>{t.leadName}</span>}
                </span>
                <span style={{
                  marginLeft: 'auto', fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '3px 9px', whiteSpace: 'nowrap',
                  color: t.overdue ? ORANGE : INK2,
                  background: t.overdue ? 'rgba(244,81,30,.12)' : 'rgba(20,8,31,.06)',
                }}>
                  {t.overdue ? 'Overdue' : 'Today'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* ── What you booked, and the target ──────────────────────────────── */}
      <section style={{ ...CARD, padding: 22 }}>
        <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 19, letterSpacing: '-.02em' }}>
            Units you booked · {new Date().toLocaleDateString('en-GB', { month: 'long' })}
          </div>
          <div style={{ fontSize: 12.5, color: INK3 }}>
            {data?.bookings.length ?? 0} units · AED {money(data?.counters.month.value ?? 0)} monthly value
            {target?.goal ? ` · ${target.booked} of ${target.goal} target, ${target.daysLeft} days left` : ''}
          </div>
          {/* Book Unit lives at /quotes — the wizard is the booking. */}
          <Link to="/quotes" className="flex items-center"
            style={{ marginLeft: 'auto', gap: 8, background: PURPLE, color: '#fff', borderRadius: 20, padding: '9px 16px', fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }}>
            <Plus size={14} /> Book a unit
          </Link>
        </div>

        {target?.goal ? (
          <div style={{ height: 7, borderRadius: 20, background: NEUTRAL_100, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ height: '100%', borderRadius: 20, background: PURPLE, width: `${targetPct}%` }} />
          </div>
        ) : null}

        {(data?.bookings.length ?? 0) === 0 ? (
          <div style={{ fontSize: 13, color: INK3 }}>
            Nothing booked this month yet. A contract credited to you shows up here.
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
            {data!.bookings.map((b) => (
              <div key={b.contractNo} className="pb-book"
                style={{ border: `1px solid ${HAIRLINE}`, borderRadius: 16, padding: 16, background: SURFACE2 }}>
                <div className="flex items-center gap-2">
                  <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, letterSpacing: '-.02em' }}>{b.unit}</div>
                  <div style={{
                    marginLeft: 'auto', fontSize: 10.5, fontWeight: 700, borderRadius: 20, padding: '3px 8px', whiteSpace: 'nowrap',
                    color: b.status === 'active' ? GREEN_700 : PURPLE_700,
                    background: b.status === 'active' ? 'rgba(22,163,74,.12)' : PURPLE_50,
                  }}>
                    {b.status === 'active' ? 'Active' : b.status.replace(/_/g, ' ')}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: INK3, marginTop: 6 }}>
                  {b.sizeSqf ? `${b.sizeSqf} sq ft` : '—'}
                </div>
                <div className="flex items-baseline" style={{ gap: 4, marginTop: 14 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: INK3 }}>AED</span>
                  <span style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, letterSpacing: '-.02em' }}>{money(b.rate)}</span>
                  <span style={{ fontSize: 11.5, color: INK3 }}>/mo</span>
                </div>
                <div className="truncate" style={{ fontSize: 11.5, color: INK2, marginTop: 12, paddingTop: 11, borderTop: '1px solid rgba(20,8,31,.08)' }}>
                  {b.tenant || '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── The chat, as a slide-over ────────────────────────────────────── */}
      {chatPhone && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={() => setChatPhone(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(20,8,31,.34)' }} />
          <div style={{
            position: 'relative', width: 'min(460px, 100vw)', height: '100%', background: PAPER,
            borderLeft: '1px solid rgba(20,8,31,.12)', display: 'flex', flexDirection: 'column',
            boxShadow: '-20px 0 60px rgba(20,8,31,.18)', animation: 'pbSlide .22s ease-out',
          }}>
            <div className="flex items-center" style={{ gap: 10, padding: '12px 16px', background: '#fff', borderBottom: `1px solid ${HAIRLINE}` }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>Conversation</div>
              <button type="button" onClick={() => setChatPhone(null)} className="pb-ico cursor-pointer"
                style={{ marginLeft: 'auto', width: 32, height: 32, borderRadius: 9, background: NEUTRAL_100, color: INK2, display: 'grid', placeItems: 'center', border: 'none' }}
                aria-label="Close">
                <X size={15} />
              </button>
            </div>
            {/* The real console, not a second composer: it already sends media
                and voice notes, carries the assistant's suggestions, and knows
                the 24-hour window rules. */}
            <div style={{ flex: 1, minHeight: 0 }}>
              <WhatsApp embeddedPhone={chatPhone} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

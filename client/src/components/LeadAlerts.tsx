import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bell, UserPlus, X } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'

/**
 * "You have a new lead", in the corner of the screen.
 *
 * A rep was told a lead was theirs by nothing at all: it appeared on a board
 * they had to think to open. Push notifications exist but reach only somebody
 * who has switched them on, and nobody has. This needs no permission and no
 * setup — if the page is open, the alert arrives.
 *
 * Deliberately quiet about repeats: each lead is announced once per browser,
 * ever. An alert that reappears every twenty seconds until somebody opens the
 * lead is an alert people learn to close without reading.
 */

type NewLead = {
  _id: string
  fullName: string
  phone: string
  source?: string
  assignedAt: string
  /** "the rota", or the name of whoever handed it over. */
  by: string
}

const SEEN_KEY = 'pb-lead-alerts-shown'
const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = 'rgba(20,8,31,.55)'

function readShown(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')) } catch { return new Set() }
}
function writeShown(ids: Set<string>) {
  // Capped: this is a "have I mentioned this one" list, not a history.
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-200))) } catch { /* private window */ }
}

/** "WhatsApp Contact 5521" is not a name worth putting in an alert. */
function label(lead: NewLead) {
  const name = String(lead.fullName || '').trim()
  return name && !/^whatsapp\s*contact/i.test(name) ? name : (lead.phone || 'a new enquiry')
}

type DayPerson = { leadId: string; name: string; phoneNormalized: string }
type MyDay = {
  reminders: (DayPerson & { at: string; overdue: boolean })[]
  waiting: DayPerson[]
  quiet: DayPerson[]
}

const DAY_KEY = 'pb-day-alert-shown'

/** The local day, as a key, so the nudge arrives once each morning. */
function todayKey() {
  return new Date().toLocaleDateString('en-CA')   // YYYY-MM-DD, local
}

/**
 * "These people need you today", once a day.
 *
 * The reminders a rep sets from a chat were only visible if they went looking
 * for them. This is the nudge: it names the first few, and each name opens
 * that conversation — the answer to nearly all of this is to say something to
 * somebody, so the shortest path to the chat is the whole design.
 *
 * Once per browser per day. A prompt that returns every twenty seconds until
 * the list is empty is one people learn to close without reading, and the list
 * is rarely empty.
 */
function DayCallList() {
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState(false)
  const [alreadyToday, setAlreadyToday] = useState(() => {
    try { return localStorage.getItem(DAY_KEY) === todayKey() } catch { return false }
  })

  const { data } = useQuery<MyDay>({
    queryKey: ['my-day-alert'],
    queryFn: () => api.get('/my-day').then((r) => r.data),
    enabled: user?.role === 'sales_rep' && !alreadyToday && !dismissed,
    refetchInterval: false,
    retry: false,
  })

  /* Reminders first, then anybody kept waiting. Deliberately not the quiet
     ones: this is a nudge, not the whole backlog — the page has that. */
  const people = [
    ...(data?.reminders ?? []).map((r) => ({ ...r, why: r.overdue ? 'reminder overdue' : 'reminder today' })),
    ...(data?.waiting ?? []).map((w) => ({ ...w, why: 'waiting on a reply' })),
  ]
  const shown = people.slice(0, 4)

  function close() {
    setDismissed(true)
    try { localStorage.setItem(DAY_KEY, todayKey()) } catch { /* private window */ }
    setAlreadyToday(true)
  }

  if (alreadyToday || dismissed || !shown.length) return null

  return (
    <div
      className="flex items-start gap-3 rounded-xl px-3.5 py-3"
      style={{
        width: 320, maxWidth: '100%', background: '#fff',
        border: '1px solid rgba(20,8,31,.10)',
        boxShadow: '0 12px 32px rgba(20,8,31,.18)',
        animation: 'pb-lead-alert-in .22s ease-out',
      }}
    >
      <span
        className="shrink-0 inline-flex items-center justify-center rounded-full"
        style={{ width: 32, height: 32, background: '#FEF3C7', color: '#92400E' }}
      >
        <Bell size={16} />
      </span>

      <div className="min-w-0 flex-1">
        <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>
          {people.length} to contact today
        </div>
        <div className="flex flex-col gap-1 mt-1.5">
          {shown.map((p) => (
            <Link
              key={p.leadId}
              to={`/whatsapp?phone=${encodeURIComponent(p.phoneNormalized)}`}
              onClick={close}
              className="truncate"
              style={{ fontSize: 12.5, color: PURPLE, fontWeight: 600, textDecoration: 'none' }}
            >
              {p.name} <span style={{ color: MUTED, fontWeight: 400 }}>— {p.why}</span>
            </Link>
          ))}
        </div>
        {people.length > shown.length && (
          <Link
            to="/my-day"
            onClick={close}
            style={{ fontSize: 12, fontWeight: 700, color: MUTED, textDecoration: 'none', display: 'inline-block', marginTop: 6 }}
          >
            and {people.length - shown.length} more — see the day
          </Link>
        )}
      </div>

      <button
        type="button"
        onClick={close}
        className="shrink-0 cursor-pointer"
        style={{ color: MUTED, background: 'none', border: 'none' }}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export default function LeadAlerts() {
  const { user } = useAuth()
  const [queue, setQueue] = useState<NewLead[]>([])

  const { data } = useQuery<NewLead[]>({
    queryKey: ['newly-assigned-leads'],
    queryFn: () => api.get('/leads/newly-assigned').then((r) => r.data),
    // Only for people who are given leads. An admin watching the whole board
    // does not want a popup for every one of them.
    enabled: user?.role === 'sales_rep',
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    retry: false,
  })

  useEffect(() => {
    if (!data?.length) return
    const shown = readShown()
    const fresh = data.filter((l) => !shown.has(l._id))
    if (!fresh.length) return
    fresh.forEach((l) => shown.add(l._id))
    writeShown(shown)
    // Newest at the bottom of the stack, nearest the corner.
    setQueue((prev) => [...prev, ...fresh].slice(-4))
  }, [data])

  // Each one clears itself; a stack that never empties is just clutter.
  useEffect(() => {
    if (!queue.length) return
    const t = setTimeout(() => setQueue((prev) => prev.slice(1)), 12_000)
    return () => clearTimeout(t)
  }, [queue])

  return (
    <div
      className="fixed z-50 flex flex-col gap-2"
      style={{ right: 16, bottom: 16, maxWidth: 'calc(100vw - 32px)' }}
      role="status"
      aria-live="polite"
    >
      {/* The morning's call list, above whatever has arrived since. */}
      <DayCallList />

      {queue.map((lead) => (
        <div
          key={lead._id}
          className="flex items-start gap-3 rounded-xl px-3.5 py-3"
          style={{
            width: 320, maxWidth: '100%', background: '#fff',
            border: '1px solid rgba(20,8,31,.10)',
            boxShadow: '0 12px 32px rgba(20,8,31,.18)',
            animation: 'pb-lead-alert-in .22s ease-out',
          }}
        >
          <span
            className="shrink-0 inline-flex items-center justify-center rounded-full"
            style={{ width: 32, height: 32, background: '#F3EDFF', color: PURPLE }}
          >
            <UserPlus size={16} />
          </span>

          <div className="min-w-0 flex-1">
            <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>New lead for you</div>
            <div className="truncate" style={{ fontSize: 13, color: INK, marginTop: 1 }}>{label(lead)}</div>
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
              {lead.by ? `Given to you by ${lead.by}` : 'Assigned to you'}
              {lead.source ? ` · ${lead.source}` : ''}
            </div>
            <div className="flex gap-3 mt-2">
              <Link
                to={`/leads/${lead._id}`}
                onClick={() => setQueue((prev) => prev.filter((l) => l._id !== lead._id))}
                style={{ fontSize: 12, fontWeight: 700, color: PURPLE, textDecoration: 'none' }}
              >
                Open it
              </Link>
              <Link
                to="/whatsapp"
                onClick={() => setQueue((prev) => prev.filter((l) => l._id !== lead._id))}
                style={{ fontSize: 12, fontWeight: 700, color: MUTED, textDecoration: 'none' }}
              >
                Go to the chat
              </Link>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setQueue((prev) => prev.filter((l) => l._id !== lead._id))}
            className="shrink-0 cursor-pointer"
            style={{ color: MUTED, background: 'none', border: 'none' }}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}

      <style>{`
        @keyframes pb-lead-alert-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes pb-lead-alert-in { from { opacity: 1; } to { opacity: 1; } }
        }
      `}</style>
    </div>
  )
}

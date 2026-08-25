import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronDown, MessageSquare, RefreshCw } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { PageHeader, Spinner } from '../components/ui'

const INK = '#14081F'
const MUTED = '#4A4357'
const FAINT = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,0.10)'
const DANGER = '#C22A2A'

type Chat = {
  phoneNormalized: string
  displayName: string
  isCustomer: boolean
  messages: number
  inbound: number
  outbound: number
  firstAt: string
  lastAt: string
  unanswered: boolean
  isNew: boolean
  headline: string
  wants: string
  nextAction: string
  temperature: '' | 'hot' | 'warm' | 'cold'
  openQuestions: string[]
}

type Stats = {
  chats: number
  inbound: number
  outbound: number
  newChats: number
  unanswered: number
  medianReply: string | null
  repliesCounted: number
  withoutSummary: number
}

type Digest = { day: string; built: boolean; builtAt?: string; stats: Stats | null; chats: Chat[] }
type DayList = { days: { day: string; builtAt: string; stats: Stats }[]; today: string; yesterday: string }

const TONE: Record<string, { bg: string; fg: string; label: string }> = {
  hot: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Hot' },
  warm: { bg: '#FFF7E6', fg: '#B45309', label: 'Warm' },
  cold: { bg: '#EEF2F7', fg: '#475569', label: 'Cold' },
}

/* Everything on this page is UAE time, whatever machine it is read on.
   The day itself is defined in Dubai on the server, so showing its message
   times in the viewer's own timezone would put them outside the day they
   belong to — a 00:30 conversation displayed as the previous evening. */
const TZ = 'Asia/Dubai'

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })

const longDate = (day: string) =>
  // Noon UTC is safely inside the Dubai day either way, so the label never
  // slips to the neighbouring date.
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ,
  })

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  })

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 18px', minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone ?? INK, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: FAINT, marginTop: 2 }}>{label}</div>
    </div>
  )
}

function ChatRow({ c }: { c: Chat }) {
  const [open, setOpen] = useState(false)
  const tone = TONE[c.temperature]

  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${LINE}`,
        // The status is the left edge, so a scan down the page finds the
        // unanswered ones without reading a word.
        borderLeft: `4px solid ${c.unanswered ? DANGER : c.temperature === 'hot' ? '#F59E0B' : c.isNew ? PURPLE : 'transparent'}`,
        borderRadius: 14,
        padding: '12px 16px',
      }}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 min-w-0 text-left cursor-pointer"
          style={{ background: 'none', border: 'none', padding: 0 }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontWeight: 700, fontSize: 14, color: INK }}>{c.displayName}</span>
            {c.unanswered && (
              <span className="rounded-full px-2 py-0.5" style={{ background: '#FEE2E2', color: '#B91C1C', fontSize: 10.5, fontWeight: 700 }}>
                No reply
              </span>
            )}
            {c.isNew && (
              <span className="rounded-full px-2 py-0.5" style={{ background: '#EDE5FF', color: '#4A1FA0', fontSize: 10.5, fontWeight: 700 }}>
                First time
              </span>
            )}
            {tone && (
              <span className="rounded-full px-2 py-0.5" style={{ background: tone.bg, color: tone.fg, fontSize: 10.5, fontWeight: 700 }}>
                {tone.label}
              </span>
            )}
            {c.isCustomer && (
              <span className="rounded-full px-2 py-0.5" style={{ background: '#DCFCE7', color: '#047857', fontSize: 10.5, fontWeight: 700 }}>
                Customer
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 3 }}>
            {c.headline || <span style={{ color: FAINT, fontStyle: 'italic' }}>Not summarised</span>}
          </p>
        </button>

        <div className="shrink-0 text-right" style={{ fontSize: 11.5, color: FAINT, fontVariantNumeric: 'tabular-nums' }}>
          <div>{clock(c.firstAt)} – {clock(c.lastAt)}</div>
          <div>{c.inbound} in · {c.outbound} out</div>
        </div>

        <button type="button" onClick={() => setOpen((v) => !v)} className="shrink-0 cursor-pointer" style={{ color: FAINT }} aria-label="Details">
          <ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${LINE}`, fontSize: 12.5, color: MUTED }} className="space-y-1.5">
          {c.wants && <p>{c.wants}</p>}
          {!!c.openQuestions?.length && (
            <div>
              <p style={{ fontWeight: 600, color: INK }}>Still unanswered:</p>
              <ul className="list-disc pl-5">{c.openQuestions.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
          {c.nextAction && <p style={{ color: INK }}><strong>Next:</strong> {c.nextAction}</p>}
          <Link to={`/whatsapp?phone=${c.phoneNormalized}`} style={{ color: PURPLE, fontWeight: 600 }}>
            Open the chat →
          </Link>
        </div>
      )}
    </div>
  )
}

export default function DailyDigest() {
  const qc = useQueryClient()

  const { data: list } = useQuery<DayList>({
    queryKey: ['digest-days'],
    queryFn: () => api.get('/whatsapp/digest/days').then((r) => r.data),
  })

  // Yesterday by default: that is the day the morning build covers.
  const [day, setDay] = useState<string>('')
  const chosen = day || list?.yesterday || ''

  const { data, isLoading } = useQuery<Digest>({
    queryKey: ['digest', chosen],
    queryFn: () => api.get(`/whatsapp/digest/${chosen}`).then((r) => r.data),
    enabled: Boolean(chosen),
  })

  const build = useMutation({
    mutationFn: () => api.post(`/whatsapp/digest/${chosen}/build?rebuild=1`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['digest', chosen] })
      qc.invalidateQueries({ queryKey: ['digest-days'] })
    },
  })

  const s = data?.stats

  return (
    <div className="space-y-4" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <PageHeader
        title="Daily conversations"
        subtitle="What was said with every client, ordered so the ones needing attention come first"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={chosen}
          max={list?.today}
          onChange={(e) => setDay(e.target.value)}
          style={{ height: 40, borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', padding: '0 14px', fontSize: 13, color: INK }}
        />
        <button
          type="button"
          onClick={() => build.mutate()}
          disabled={build.isPending || !chosen}
          className="inline-flex items-center gap-1.5 rounded-full px-4 cursor-pointer disabled:opacity-50"
          style={{ height: 40, background: '#fff', border: `1px solid ${LINE}`, fontSize: 13, fontWeight: 600, color: INK }}
        >
          <RefreshCw size={14} className={build.isPending ? 'animate-spin' : ''} />
          {build.isPending ? 'Reading…' : data?.built ? 'Read again' : 'Build this day'}
        </button>
        {data?.builtAt && (
          <span style={{ fontSize: 11.5, color: FAINT }}>Read {stamp(data.builtAt)} UAE</span>
        )}
        {build.isError && <span style={{ fontSize: 12, color: DANGER }}>{apiError(build.error)}</span>}
      </div>

      <h2 style={{ fontFamily: "'Bricolage Grotesque', serif", fontSize: 20, fontWeight: 700, color: INK }}>
        {chosen ? longDate(chosen) : ' '}
      </h2>

      {isLoading ? (
        <Spinner />
      ) : !data?.built ? (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 40, textAlign: 'center' }}>
          <MessageSquare size={26} style={{ opacity: 0.3, margin: '0 auto 10px' }} />
          {/* Not built and nothing happened are different facts, and the page
              should not present one as the other. */}
          <p style={{ fontSize: 13.5, color: MUTED }}>This day has not been read yet.</p>
          <p style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>
            Each morning the previous day is read automatically. Use “Build this day” to do it now.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2.5">
            <Stat label="Conversations" value={s?.chats ?? 0} />
            <Stat label="Nobody replied" value={s?.unanswered ?? 0} tone={s?.unanswered ? DANGER : undefined} />
            <Stat label="First-time contacts" value={s?.newChats ?? 0} />
            <Stat label="Messages in / out" value={`${s?.inbound ?? 0} / ${s?.outbound ?? 0}`} />
            <Stat label={`Median reply${s?.repliesCounted ? ` (${s.repliesCounted})` : ''}`} value={s?.medianReply ?? '—'} />
          </div>

          {/* A digest that quietly omitted what it could not read would look
              complete while being partial. */}
          {!!s?.withoutSummary && (
            <p style={{ fontSize: 11.5, color: '#B45309' }}>
              {s.withoutSummary} of these could not be summarised and show their timings only.
            </p>
          )}

          {data.chats.length === 0 ? (
            <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 40, textAlign: 'center' }}>
              <p style={{ fontSize: 13.5, color: MUTED }}>No conversations that day.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.chats.map((c) => <ChatRow key={c.phoneNormalized} c={c} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

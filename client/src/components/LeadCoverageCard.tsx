import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Skeleton } from './ui'
import TrafficLight, { type Signal } from './TrafficLight'
import LiveCounter, { LiveCounterStyles } from './LiveCounter'

/**
 * Admin dashboard: who takes new leads right now (by the roster), whether
 * they are actually answering, and who takes over when.
 */

type Rep = {
  id: string; name: string; color: string; on: boolean; why: string | null
  until: string | null; nextOn: string | null; leadsToday: number
  lastReplyAt: string | null; repliesToday: number; waiting: number
}
type Coverage = {
  enabled: boolean; outOfHours?: string[]; nobodyOn: boolean; reps: Rep[]
  live?: { waitingForReply: number; newLeadsToday: number; repliesToday: number }
  signal?: Signal; ai?: { enabled: boolean; mode: string; answering: boolean }
  handovers: { label: string; joins: string[]; leaves: string[]; onAfter: string[] }[]
}

const INK = '#14081F'
const MUTED = '#756E80'
const LINE = 'rgba(20,8,31,.08)'

function minsAgo(iso: string | null) {
  return iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : null
}
const agoLabel = (m: number) => (m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`)

/** Answering, or not — judged only for someone on shift. */
function replyState(r: Rep) {
  const m = minsAgo(r.lastReplyAt)
  if (m != null && m <= 30) return { label: 'Replying', bg: '#DCFCE7', fg: '#15803D' }
  if (r.waiting > 0 && (m == null || m > 60)) return { label: 'Not replying', bg: '#FEE2E2', fg: '#B91C1C' }
  return { label: m == null ? 'No replies yet' : 'Quiet', bg: '#FEF3C7', fg: '#B45309' }
}


export default function LeadCoverageCard() {
  const { data, isLoading } = useQuery<Coverage>({
    queryKey: ['lead-coverage-now'],
    queryFn: () => api.get('/lead-routing/now').then((r) => r.data),
    // Live: every 10 seconds while the page is open (paused in a background tab).
    refetchInterval: 10_000,
  })
  if (isLoading || !data) return <Skeleton className="h-[180px]" />

  const on = data.reps.filter((r) => r.on)
  const off = data.reps.filter((r) => !r.on)
  const dot = (c: string) => <span style={{ width: 10, height: 10, borderRadius: 3, background: c || '#5B2BC9', flex: '0 0 auto' }} />

  const signal: Signal = data.signal ?? (data.nobodyOn ? 'red' : 'green')
  const SIGNAL_TEXT: Record<Signal, { title: string; line: string; color: string; bg: string }> = {
    green: {
      title: `Sales team on — ${on.length} rep${on.length === 1 ? '' : 's'} taking leads`,
      line: on.map((r) => r.name).join(', ') + (on.some((r) => replyState(r).label === 'Not replying') ? ' · someone is not replying, see below' : ''),
      color: '#15803D', bg: '#F0FDF4',
    },
    amber: {
      title: 'Nobody on shift — the AI assistant is answering',
      line: 'Customers get replies from the assistant; new leads wait for the next rep on shift.',
      color: '#B45309', bg: '#FFFBEB',
    },
    red: {
      title: 'Nobody is on — customers are not being answered',
      line: data.ai?.enabled && data.ai.mode !== 'auto'
        ? 'The AI assistant is only drafting, not sending. Put a rep on the roster or switch the assistant to auto-send.'
        : 'No rep on the roster and the AI assistant is off. Put somebody on shift or switch the assistant on.',
      color: '#B91C1C', bg: '#FEF2F2',
    },
  }
  const sig = SIGNAL_TEXT[signal]
  const nextChange = data.handovers[0]

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* The signal */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, padding: '16px 24px', borderRadius: 18, background: sig.bg, border: `1px solid ${sig.color}22` }}>
        <TrafficLight signal={signal} size={130} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: sig.color }}>
            {signal === 'green' ? 'Green' : signal === 'amber' ? 'Amber' : 'Red'}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: INK, lineHeight: 1.25, marginTop: 2 }}>{sig.title}</div>
          <div style={{ fontSize: 13, color: '#4A4357', marginTop: 4 }}>{sig.line}</div>
          {nextChange && (
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8 }}>
              Next change <b style={{ color: INK }}>{nextChange.label}</b> — {nextChange.onAfter.length ? `${nextChange.onAfter.join(', ')} on` : 'nobody on'}
            </div>
          )}
        </div>
      </div>

      {/* Live counters */}
      {data.live && (
        <div>
          <LiveCounterStyles />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: '.08em', color: '#B91C1C', marginBottom: 6 }}>
            <span className="lc-live-dot" style={{ width: 8, height: 8, borderRadius: 99, background: '#EF4444' }} /> LIVE
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <LiveCounter label="Waiting for a reply" value={data.live.waitingForReply} upIsBad hint="customers whose last message is unanswered" />
            <LiveCounter label="New leads today" value={data.live.newLeadsToday} hint="came in since midnight" />
            <LiveCounter label="Replies sent today" value={data.live.repliesToday} hint="by the team, from the CRM" />
          </div>
        </div>
      )}

      {!data.enabled && (
        <div className="text-xs" style={{ background: '#FFF7E6', color: '#7A4B00', padding: '8px 10px', borderRadius: 10 }}>
          Distribution is switched off — new leads are not handed out by the roster. Turn it on in <Link to="/settings/lead-distribution" style={{ fontWeight: 700, textDecoration: 'underline' }}>Lead distribution</Link>.
        </div>
      )}
      {data.nobodyOn && (
        <div className="text-xs" style={{ color: MUTED }}>
          New leads now: {data.outOfHours?.length ? `go to ${data.outOfHours.join(', ')}${data.outOfHours.length > 1 ? ' (taking turns)' : ''}` : 'wait unassigned until the next shift starts'}.
        </div>
      )}

      {/* On now */}
      {on.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em' }}>Taking new leads now</div>
          {on.map((r) => {
            const st = replyState(r)
            const m = minsAgo(r.lastReplyAt)
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 12px' }}>
                {dot(r.color)}
                <div style={{ minWidth: 120 }}>
                  <div style={{ fontWeight: 700, color: INK }}>{r.name}</div>
                  <div style={{ fontSize: 11.5, color: MUTED }}>{r.until ? `on until ${r.until}` : 'on'}</div>
                </div>
                <span style={{ background: st.bg, color: st.fg, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>{st.label}</span>
                <span style={{ flex: 1 }} />
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: MUTED, textAlign: 'right' }}>
                  <div><b style={{ color: r.waiting ? '#B91C1C' : INK, fontSize: 15 }}>{r.waiting}</b><div>waiting</div></div>
                  <div><b style={{ color: INK, fontSize: 15 }}>{r.repliesToday}</b><div>replies today</div></div>
                  <div><b style={{ color: INK, fontSize: 15 }}>{r.leadsToday}</b><div>new leads</div></div>
                  <div style={{ minWidth: 70 }}><b style={{ color: INK, fontSize: 13 }}>{m == null ? '—' : agoLabel(m)}</b><div>last reply</div></div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Who takes over, and when */}
      {data.handovers.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Next changes</div>
          <div style={{ display: 'grid', gap: 4 }}>
            {data.handovers.map((h, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 700, color: INK, minWidth: 72, fontVariantNumeric: 'tabular-nums' }}>{h.label}</span>
                <span style={{ color: '#4A4357' }}>
                  {[...h.joins.map((n) => `${n} comes on`), ...h.leaves.map((n) => `${n} goes off`)].join(' · ')}
                  <span style={{ color: MUTED }}> → {h.onAfter.length ? `leads go to ${h.onAfter.join(', ')}` : 'nobody on (out-of-hours)'}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Off now */}
      {off.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {off.map((r) => (
            <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: MUTED, border: `1px solid ${LINE}`, borderRadius: 999, padding: '4px 10px' }}>
              {dot(r.color)} <b style={{ color: '#4A4357' }}>{r.name}</b>
              {r.why === 'off shift' ? (r.nextOn ? `back ${r.nextOn}` : 'no hours on the roster') : r.why}
              {r.waiting > 0 && <b style={{ color: '#B91C1C' }}> · {r.waiting} waiting</b>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

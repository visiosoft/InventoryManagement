import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

/**
 * A follow-up agent's week on one strip: the last six days of what it did,
 * today, and the next six days of who it would follow up. Tap a day for the
 * names. Projected from the schedule, so it reads the same while the agent
 * is off — the point is to see how it would handle things before it does.
 */

type Who = { leadId: string | null; name: string; at?: string }
type PastDay = { date: string; sent: (Who & { template: string; auto: boolean })[]; handed: (Who & { why: string })[]; replied: Who[]; closed: Who[] }
type DueItem = { leadId: string; name: string; step: number; total: number; label: string; overdue: boolean; bucket: string }
type UpDay = { date: string; isToday: boolean; count: number; overCap: number; items: DueItem[] }
type Week = { agent: { _id: string; name: string; mode: 'off' | 'shadow' | 'auto'; dailyTouchCap: number }; leadsInSchedule: number; past: PastDay[]; upcoming: UpDay[] }

const PURPLE = '#5B2BC9'
const MUTED = '#6B6478'
const LINE = '#E9E4F1'
const dayName = (iso: string, todayIso: string) => {
  if (iso === todayIso) return 'Today'
  const d = new Date(`${iso}T00:00:00Z`)
  const diff = Math.round((d.getTime() - new Date(`${todayIso}T00:00:00Z`).getTime()) / 86400000)
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
}
const MODE_LINE = {
  off: 'is off — nothing is sent. This is what he would do once switched on.',
  shadow: 'drafts each follow-up; a person presses Send in Needs you.',
  auto: 'sends these by himself, inside his limits.',
} as const

export default function FollowUpWeek({ agentId }: { agentId: string }) {
  const { data } = useQuery<Week>({ queryKey: ['agent-follow-up-week', agentId], queryFn: () => api.get(`/agents/${agentId}/follow-up-week`).then((r) => r.data), refetchInterval: 60_000 })
  const [pick, setPick] = useState<string>('')
  const strip = useRef<HTMLDivElement>(null)
  // Open on today, with a few past days still in view to its left.
  useEffect(() => {
    const el = strip.current?.querySelector('[data-today="1"]') as HTMLElement | null
    if (el && strip.current) strip.current.scrollLeft = Math.max(0, el.offsetLeft - strip.current.offsetLeft - 2 * 120)
  }, [data])
  if (!data) return <div style={{ height: 150, borderRadius: 16, background: '#F3F0FA', marginBottom: 14 }} />

  const todayIso = data.upcoming[0]?.date
  const pastDays = data.past.filter((d) => d.date !== todayIso)
  const todayDone = data.past.find((d) => d.date === todayIso)
  const chosen = pick || todayIso
  const chosenPast = data.past.find((d) => d.date === chosen)
  const chosenUp = data.upcoming.find((d) => d.date === chosen)

  const cell = (date: string, body: React.ReactNode, tone: 'past' | 'today' | 'future') => (
    <button key={date} type="button" onClick={() => setPick(date)} data-today={tone === 'today' ? '1' : undefined}
      style={{
        flex: '0 0 auto', width: 112, textAlign: 'left', padding: '10px 10px 12px', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
        border: `${chosen === date ? 2 : 1}px solid ${chosen === date ? PURPLE : LINE}`,
        background: tone === 'today' ? '#F5F1FC' : tone === 'past' ? '#FAFAFB' : '#fff',
      }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: tone === 'today' ? PURPLE : MUTED }}>{dayName(date, todayIso)}</div>
      <div style={{ marginTop: 6, display: 'grid', gap: 3, fontSize: 12 }}>{body}</div>
    </button>
  )
  const line = (n: number, label: string, color: string) => n ? <span style={{ color }}><b style={{ fontSize: 15 }}>{n}</b> {label}</span> : null

  return (
    <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{data.agent.name}'s follow-ups, day by day</div>
        <div style={{ fontSize: 12, color: MUTED }}>{data.leadsInSchedule.toLocaleString()} leads on his schedule · days 1, 3, 7, 14 then 30, 60, 90</div>
      </div>
      <div style={{ fontSize: 12.5, color: data.agent.mode === 'off' ? '#B45309' : MUTED, marginTop: 2 }}>{data.agent.name} {MODE_LINE[data.agent.mode]}</div>

      <div ref={strip} style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 12, paddingBottom: 4 }}>
        {pastDays.map((d) => cell(d.date, (d.sent.length + d.replied.length + d.handed.length + d.closed.length) ? <>
          {line(d.sent.length, 'sent', '#15803D')}{line(d.replied.length, 'replied', PURPLE)}{line(d.handed.length, 'to a person', '#B45309')}{line(d.closed.length, 'closed', '#6B7280')}
        </> : <span style={{ color: '#B7B1C0' }}>Nothing</span>, 'past'))}
        {data.upcoming.map((d) => cell(d.date, <>
          {d.isToday && todayDone && line(todayDone.sent.length, 'sent', '#15803D')}
          {d.isToday && todayDone && line(todayDone.replied.length, 'replied', PURPLE)}
          {d.count ? <span style={{ color: '#1F2937' }}><b style={{ fontSize: 15 }}>{d.count}</b> due</span> : <span style={{ color: '#B7B1C0' }}>None due</span>}
          {d.overCap > 0 && <span style={{ color: '#B45309' }}>{d.overCap} over the cap</span>}
        </>, d.isToday ? 'today' : 'future'))}
      </div>

      {/* The chosen day's names */}
      <div style={{ marginTop: 12, borderTop: `1px solid ${LINE}`, paddingTop: 12, display: 'grid', gap: 10 }}>
        {chosenUp && chosenUp.count > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 6 }}>{dayName(chosen, todayIso)} — would follow up {chosenUp.count}{chosenUp.count > chosenUp.items.length ? ` (first ${chosenUp.items.length} shown)` : ''}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {chosenUp.items.map((it, i) => (
                <Link key={`${it.leadId}-${i}`} to={`/leads/${it.leadId}`} title={it.label}
                  style={{ fontSize: 12.5, padding: '4px 10px', borderRadius: 999, textDecoration: 'none', color: '#1F2937', background: it.overdue ? '#FEF2F2' : '#F5F1FC', border: `1px solid ${it.overdue ? '#FECACA' : '#E4D9FF'}` }}>
                  <b>{it.name}</b> <span style={{ color: MUTED }}>· {it.label}{it.overdue ? ' · overdue' : ''}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
        {chosenPast && (['sent', 'replied', 'handed', 'closed'] as const).map((k) => {
          const list = chosenPast[k] as (Who & { template?: string; auto?: boolean; why?: string })[]
          if (!list.length) return null
          const title = { sent: 'Sent', replied: 'Replied — back to Aisha', handed: 'Handed to a person', closed: 'Closed as Lost' }[k]
          return (
            <div key={k}>
              <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 6 }}>{dayName(chosen, todayIso)} — {title} ({list.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {list.slice(0, 60).map((w, i) => (
                  <Link key={`${w.leadId}-${i}`} to={w.leadId ? `/leads/${w.leadId}` : '#'} title={w.why || w.template || ''}
                    style={{ fontSize: 12.5, padding: '4px 10px', borderRadius: 999, textDecoration: 'none', color: '#1F2937', background: '#F8F8FA', border: `1px solid ${LINE}` }}>
                    <b>{w.name}</b>{w.template ? <span style={{ color: MUTED }}> · {w.template}{w.auto ? ' · auto' : ''}</span> : null}{w.why ? <span style={{ color: MUTED }}> · {w.why.slice(0, 50)}</span> : null}
                  </Link>
                ))}
              </div>
            </div>
          )
        })}
        {!(chosenUp?.count) && !(chosenPast && (chosenPast.sent.length + chosenPast.replied.length + chosenPast.handed.length + chosenPast.closed.length)) && (
          <div style={{ fontSize: 13, color: MUTED }}>Nothing on {dayName(chosen, todayIso).toLowerCase()}.</div>
        )}
      </div>
    </section>
  )
}

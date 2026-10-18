import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { leadFollowUpApi, type FollowUpQueueItem } from '../lib/api'

/**
 * Admin only: who is behind, one line per rep. The waiting counts come from
 * the queue the page already holds; "sent today" and replies come from the
 * follow-up log. Click a rep to see just their list.
 */

const LINE = '#E5E7EB'
const SUB = '#6B7280'

type Row = { id: string; name: string; reply: number; missed: number; today: number; later: number; sentToday: number; sentWeek: number; repliedWeek: number }

export default function FollowUpTeamTable({ items, bucketOf, target, onPick }: {
  items: FollowUpQueueItem[]
  bucketOf: Map<string, string>
  target: number
  onPick: (ownerId: string) => void
}) {
  const { data } = useQuery({ queryKey: ['follow-up-team'], queryFn: leadFollowUpApi.team, staleTime: 60_000 })

  const rows = useMemo(() => {
    const m = new Map<string, Row>()
    const row = (id: string, name: string) => {
      let r = m.get(id)
      if (!r) { r = { id, name, reply: 0, missed: 0, today: 0, later: 0, sentToday: 0, sentWeek: 0, repliedWeek: 0 }; m.set(id, r) }
      if (!r.name && name) r.name = name
      return r
    }
    for (const it of items) {
      const r = row(it.ownerId || '', it.ownerName || '')
      const b = bucketOf.get(it.leadId)
      if (b === 'reply') r.reply++
      else if (b === 'missed') r.missed++
      else if (b === 'today') r.today++
      else r.later++
    }
    for (const t of data?.reps ?? []) {
      const r = row(t.ownerId, t.name)
      r.sentToday = t.sentToday; r.sentWeek = t.sentWeek; r.repliedWeek = t.repliedWeek
    }
    // Most urgent first: customers waiting, then missed, then today's list.
    return [...m.values()].sort((a, b) => (b.reply - a.reply) || (b.missed - a.missed) || (b.today - a.today) || a.name.localeCompare(b.name))
  }, [items, bucketOf, data])

  if (!rows.length) return null

  const num = (n: number, alert = false) => (
    <span style={{ fontWeight: 700, color: n === 0 ? '#C4C8CE' : alert ? '#B91C1C' : '#111827' }}>{n}</span>
  )
  const th = 'px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-right whitespace-nowrap'

  return (
    <div className="mt-4 rounded-xl border bg-white overflow-x-auto" style={{ borderColor: LINE }}>
      <table className="w-full text-[13.5px]" style={{ borderCollapse: 'collapse' }}>
        <thead style={{ background: '#F9FAFB', color: SUB }}>
          <tr>
            <th className={th} style={{ textAlign: 'left' }}>Team</th>
            <th className={th} title="Customers who wrote and are waiting for us">Reply now</th>
            <th className={th} title="They wrote, we did not answer within 24 hours">Missed</th>
            <th className={th} title={`Today's follow-ups, up to ${target} each`}>Today</th>
            <th className={th}>Later</th>
            <th className={th} title="Follow-up templates sent today">Sent today</th>
            <th className={th} title="Follow-ups sent in the last 7 days that got a reply">Replies · 7 days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id || 'none'} onClick={() => r.id && onPick(r.id)}
              className={r.id ? 'cursor-pointer hover:bg-gray-50' : ''} style={{ borderTop: `1px solid ${LINE}` }}>
              <td className="px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: r.id ? '#111827' : '#B45309' }}>{r.name || 'Not assigned'}</td>
              <td className="px-3 py-2.5 text-right">{num(r.reply, true)}</td>
              <td className="px-3 py-2.5 text-right">{num(r.missed, true)}</td>
              <td className="px-3 py-2.5 text-right">{num(r.today)}</td>
              <td className="px-3 py-2.5 text-right">{num(r.later)}</td>
              <td className="px-3 py-2.5 text-right">{num(r.sentToday)}</td>
              <td className="px-3 py-2.5 text-right whitespace-nowrap" style={{ color: SUB }}>
                {r.sentWeek ? <><b style={{ color: '#111827' }}>{r.repliedWeek}</b> of {r.sentWeek} ({Math.round((r.repliedWeek / r.sentWeek) * 100)}%)</> : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

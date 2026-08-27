import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { listenForPingPriming, playPing } from '../lib/ping'

type WaitingRow = {
  _id: string
  fullName: string
  phone: string
  ownerName: string
  waitedMs: number
}

type Waiting = {
  slaMinutes: number
  count: number
  longestMs: number
  rows: WaitingRow[]
}

const RED = '#DC2626'
const RED_BG = 'rgba(220,38,38,.09)'
const RED_LINE = 'rgba(220,38,38,.25)'
const MUTED = '#756E80'

/** "6 min", "1h 04m" — how long somebody has actually been waiting. */
function waited(ms: number): string {
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h${m ? ` ${String(m).padStart(2, '0')}m` : ''}`
}

/**
 * Leads assigned to somebody and still untouched past the response window.
 *
 * One strip, never one alert per lead. At today's response times a per-lead
 * notification would be dozens a day and muted inside a week, so this stays a
 * single line that counts up: what is waiting, and the worst of it.
 *
 * It makes a sound once, when the queue goes from empty to not — not per row,
 * and not again while it is already showing.
 *
 * Renders nothing at all when nobody is waiting. An empty panel saying
 * everything is fine is a panel people stop reading.
 */
export default function WaitingStrip({ compact = false }: { compact?: boolean }) {
  const { data } = useQuery<Waiting>({
    queryKey: ['leads-waiting'],
    // Fast enough that a two-minute window is seen at 2:00–2:20, and slow
    // enough to cost nothing beside the console's own polling.
    queryFn: () => api.get('/leads/waiting').then((r) => r.data),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
    retry: false,
  })

  // A sound can only play where somebody has already clicked.
  useEffect(() => listenForPingPriming(), [])

  const wasWaiting = useRef(false)
  useEffect(() => {
    const now = (data?.count ?? 0) > 0
    if (now && !wasWaiting.current) playPing()
    wasWaiting.current = now
  }, [data?.count])

  if (!data || data.count === 0) return null

  const { count, longestMs, rows, slaMinutes } = data

  return (
    <div
      role="alert"
      style={{
        background: RED_BG,
        border: `1px solid ${RED_LINE}`,
        borderRadius: compact ? 14 : 16,
        padding: compact ? 14 : '14px 18px',
        marginBottom: compact ? 10 : 20,
      }}
    >
      <div className="flex items-center" style={{ gap: 8 }}>
        <AlertTriangle size={16} style={{ color: RED, flex: '0 0 auto' }} />
        <span style={{ fontSize: compact ? 13.5 : 14, fontWeight: 700, color: RED }}>
          {count === 1 ? '1 lead waiting' : `${count} leads waiting`}
          {longestMs > 0 ? ` · longest ${waited(longestMs)}` : ''}
        </span>
      </div>

      <p style={{ fontSize: 12, color: MUTED, margin: '4px 0 0' }}>
        Assigned over {slaMinutes} min ago with nothing logged against them.
      </p>

      {/* Longest first, so this reads in the order to work it. Capped: past
          about five, the number in the heading says more than the list does. */}
      <div className="flex flex-col" style={{ gap: 6, marginTop: 10 }}>
        {rows.slice(0, 5).map((r) => (
          <Link
            key={r._id}
            to={`/leads/${r._id}`}
            className="flex items-center justify-between hover:opacity-80 transition-opacity"
            style={{
              gap: 10, padding: '8px 10px', borderRadius: 10,
              background: '#fff', border: `1px solid ${RED_LINE}`, textDecoration: 'none',
            }}
          >
            <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: '#14081F' }}>
              {r.fullName}
              {r.ownerName ? <span style={{ color: MUTED, fontWeight: 500 }}> · {r.ownerName}</span> : null}
            </span>
            <span className="shrink-0" style={{ fontSize: 12.5, fontWeight: 700, color: RED }}>
              {waited(r.waitedMs)}
            </span>
          </Link>
        ))}
        {rows.length > 5 && (
          <span style={{ fontSize: 12, color: MUTED }}>and {rows.length - 5} more</span>
        )}
      </div>
    </div>
  )
}

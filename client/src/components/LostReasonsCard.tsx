import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { LOST_REASONS } from '../lib/types'
import { INK, MUTED, HAIRLINE } from '../lib/followUpUi'

type Report = { days: number; total: number; reasons: { reason: string; count: number }[] }
const LABEL = new Map(LOST_REASONS)

/** Why leads are lost — the most useful thing to know before changing price or pitch. Admin only. */
export function LostReasonsCard() {
  const { data } = useQuery<Report>({
    queryKey: ['lost-reasons'],
    queryFn: () => api.get('/leads/lost-reasons', { params: { days: 90 } }).then((r) => r.data),
    staleTime: 10 * 60_000,
  })
  if (!data) return null
  return (
    <div className="rounded-2xl border p-4 mt-4" style={{ borderColor: HAIRLINE, color: INK }}>
      <div className="text-sm font-bold">Why we lose leads</div>
      <p className="text-xs mt-0.5" style={{ color: MUTED }}>{data.total} lost in the last {data.days} days.</p>
      <div className="space-y-1.5 mt-3">
        {data.reasons.length === 0 && <div className="text-xs" style={{ color: MUTED }}>Nothing lost yet.</div>}
        {data.reasons.map((r) => (
          <div key={r.reason} className="flex items-center gap-2 text-xs">
            <div className="w-44 shrink-0">{LABEL.get(r.reason) || 'Reason not recorded (older)'}</div>
            <div className="flex-1 h-2 rounded-full" style={{ background: '#F1ECF6' }}>
              <div className="h-2 rounded-full" style={{ width: `${Math.round((r.count / data.total) * 100)}%`, background: '#6B21A8' }} />
            </div>
            <div className="w-16 text-right font-semibold">{r.count} · {Math.round((r.count / data.total) * 100)}%</div>
          </div>
        ))}
      </div>
    </div>
  )
}

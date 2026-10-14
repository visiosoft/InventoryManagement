import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { INK, MUTED, HAIRLINE } from '../lib/followUpUi'

type Report = { days: number; enough: boolean; bands: { band: 'high' | 'medium' | 'low'; won: number; lost: number; total: number; winRate: number | null }[] }
const LABEL = { high: 'Hot', medium: 'Warm', low: 'Cold' } as const

/**
 * Does the priority mean anything? Closed leads grouped by how promising they
 * looked when they closed, with the share that were won. Hot should win more
 * often than cold; if it does not, the weights are wrong and this is how we
 * find out. Admin only, and it says so plainly while the sample is small.
 */
export function IntentReportCard() {
  const { data } = useQuery<Report>({
    queryKey: ['intent-report'],
    queryFn: () => api.get('/leads/intent-report', { params: { days: 180 } }).then((r) => r.data),
    staleTime: 10 * 60_000,
  })
  if (!data) return null
  return (
    <div className="rounded-2xl border p-4 mt-4" style={{ borderColor: HAIRLINE, color: INK }}>
      <div className="text-sm font-bold">Is the priority right?</div>
      <p className="text-xs mt-0.5" style={{ color: MUTED }}>
        Leads closed in the last {data.days} days, by how promising they looked when they closed.
        {!data.enough && ' Not enough closed leads yet to trust these numbers — scores are recorded from now on, so this fills in over the coming weeks.'}
      </p>
      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
        {data.bands.map((b) => (
          <div key={b.band} className="rounded-xl border px-2 py-2" style={{ borderColor: HAIRLINE }}>
            <div className="text-[10px] font-semibold uppercase" style={{ letterSpacing: '.06em', color: MUTED }}>{LABEL[b.band]} when closed</div>
            <div className="text-lg font-bold mt-0.5">{b.winRate == null ? '—' : `${b.winRate}%`}</div>
            <div className="text-[11px]" style={{ color: MUTED }}>{b.won} won · {b.lost} lost</div>
          </div>
        ))}
      </div>
    </div>
  )
}

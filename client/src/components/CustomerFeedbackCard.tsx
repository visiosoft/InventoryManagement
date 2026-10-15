import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Star } from 'lucide-react'
import { api } from '../lib/api'

type Survey = {
  _id: string; submittedAt: string; reasonLabel: string; rating: number | null; comeBack: string; comeBackLabel: string
  oneChange: string; whatWouldKeepYou: string; phoneNormalized: string
  customer?: { fullName: string }; unit?: { unitNumber: string }; contract?: { _id: string; contractNo: string }
}
type Data = {
  summary: { total: number; averageRating: number | null; comeBack: { yes: number; maybe: number; no: number }; byReason: { id: string; label: string; count: number }[] }
  rows: Survey[]
}

const INK = '#14081F'
const MUTED = '#756E80'
const day = (d: Date) => d.toISOString().slice(0, 10)
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`
}

function Stars({ n }: { n: number | null }) {
  return (
    <span className="inline-flex" aria-label={n ? `${n} out of 5` : 'no rating'}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={12} fill={n && i <= n ? (n <= 2 ? '#DC2626' : '#F59E0B') : 'none'} stroke={n && i <= n ? (n <= 2 ? '#DC2626' : '#F59E0B') : '#CBC5D3'} />
      ))}
    </span>
  )
}

/**
 * Exit-survey feedback from tenants who moved out, last 30 days.
 * scope "all" for admins; "mine" for a rep, limited to contracts they booked.
 */
export default function CustomerFeedbackCard({ scope }: { scope: 'all' | 'mine' }) {
  const from = day(new Date(Date.now() - 30 * 864e5))
  const { data, isLoading, isError } = useQuery<Data>({
    queryKey: ['exit-surveys', 'card', scope, from],
    queryFn: () => api.get('/exit-surveys', { params: { from, limit: 200, ...(scope === 'mine' ? { mine: '1' } : {}) } }).then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  const s = data?.summary
  const rows = data?.rows ?? []
  const low = rows.filter((r) => r.rating != null && r.rating <= 2).length
  const comeBackPct = s && s.total ? Math.round(((s.comeBack.yes + s.comeBack.maybe) / s.total) * 100) : null

  const tile = (label: string, value: string, tone?: string) => (
    <div style={{ border: '1px solid rgba(20,8,31,.08)', borderRadius: 14, padding: '10px 12px', background: '#fff' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 24, fontWeight: 800, color: tone || INK }}>{value}</div>
    </div>
  )

  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 22px 22px' }}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontWeight: 700, fontSize: 15 }}>Customer feedback</span>
        <span style={{ color: MUTED, fontSize: 12 }}>{scope === 'mine' ? 'Exit surveys from your tenants' : 'Exit surveys'} · last 30 days</span>
        <Link to="/exit-surveys" className="ml-auto text-xs font-semibold hover:underline" style={{ color: '#4A1FA0' }}>Full report →</Link>
      </div>

      {isLoading ? <div className="text-sm mt-3" style={{ color: MUTED }}>Loading…</div>
        : isError ? <div className="text-sm mt-3" style={{ color: '#B91C1C' }}>Could not load feedback.</div>
        : !s || s.total === 0 ? <div className="text-sm mt-3" style={{ color: MUTED }}>No feedback in the last 30 days.</div>
        : (
          <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
              {tile('Responses', String(s.total))}
              {tile('Avg. rating', s.averageRating == null ? '—' : `${s.averageRating}/5`, s.averageRating != null && s.averageRating < 3 ? '#B91C1C' : undefined)}
              {tile('Would return', comeBackPct == null ? '—' : `${comeBackPct}%`, '#047857')}
              {tile('Rated 1–2', String(low), low ? '#B91C1C' : undefined)}
            </div>
            {s.byReason[0] && (
              <div style={{ fontSize: 12, color: MUTED }}>
                Top reason for leaving: <b style={{ color: INK }}>{s.byReason[0].label}</b> ({s.byReason[0].count})
              </div>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              {rows.slice(0, 5).map((r) => (
                <div key={r._id} style={{
                  border: '1px solid rgba(20,8,31,.08)', borderRadius: 12, padding: '10px 12px',
                  background: r.rating != null && r.rating <= 2 ? '#FEF2F2' : '#fff',
                }}>
                  <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 13 }}>
                    {r.contract
                      ? <Link to={`/contracts/${r.contract._id}`} className="font-semibold hover:underline" style={{ color: INK }}>{r.customer?.fullName || 'Tenant'}</Link>
                      : <span className="font-semibold" style={{ color: INK }}>{r.phoneNormalized}</span>}
                    {r.unit?.unitNumber && <span style={{ fontSize: 11.5, color: MUTED }}>Unit {r.unit.unitNumber}</span>}
                    <Stars n={r.rating} />
                    <span className="ml-auto" style={{ fontSize: 11.5, color: MUTED }}>{ago(r.submittedAt)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
                    {r.reasonLabel || '—'} · would come back: {r.comeBackLabel || '—'}
                  </div>
                  {(r.oneChange || r.whatWouldKeepYou) && (
                    <div className="truncate" style={{ fontSize: 12, color: INK, marginTop: 3 }}>
                      “{r.oneChange || r.whatWouldKeepYou}”
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
    </div>
  )
}

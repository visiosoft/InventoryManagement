import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { INK, MUTED, HAIRLINE } from '../lib/followUpUi'

type Report = { days: number; sources: { source: string; leads: number; reached: number; quoted: number; won: number; lost: number; winRate: number }[] }
const NAME: Record<string, string> = { manual: 'Added by hand', whatsapp: 'WhatsApp', referral: 'Referral', walk_in: 'Walk-in', website: 'Website', other: 'Other' }

/** Which sources bring leads that turn into tenants — where to spend, where to stop. Admin only. */
export function SourceReportCard() {
  const { data } = useQuery<Report>({
    queryKey: ['source-report'],
    queryFn: () => api.get('/leads/source-report', { params: { days: 90 } }).then((r) => r.data),
    staleTime: 10 * 60_000,
  })
  if (!data) return null
  return (
    <div className="rounded-2xl border p-4 mt-4 overflow-x-auto" style={{ borderColor: HAIRLINE, color: INK }}>
      <div className="text-sm font-bold">Lead sources</div>
      <p className="text-xs mt-0.5" style={{ color: MUTED }}>Leads created in the last {data.days} days and where they stand now.</p>
      <table className="w-full text-xs mt-3 min-w-[420px]">
        <thead><tr style={{ color: MUTED }} className="text-left">
          <th className="py-1">Source</th><th>Leads</th><th>Reached</th><th>Quoted</th><th>Won</th><th>Lost</th><th>Win rate</th>
        </tr></thead>
        <tbody>
          {data.sources.map((s) => (
            <tr key={s.source} className="border-t" style={{ borderColor: HAIRLINE }}>
              <td className="py-1.5 font-semibold">{NAME[s.source] || s.source}</td>
              <td>{s.leads}</td><td>{s.reached}</td><td>{s.quoted}</td><td>{s.won}</td><td>{s.lost}</td>
              <td className="font-bold">{s.winRate}%</td>
            </tr>
          ))}
          {data.sources.length === 0 && <tr><td colSpan={7} className="py-2" style={{ color: MUTED }}>No leads in this period.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

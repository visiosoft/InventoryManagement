import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, apiError } from '../../lib/api'

/**
 * Stock against demand by size (WP-18), and tenants at risk of leaving
 * (WP-27). Both read-only; a task for an at-risk tenant is one click.
 */

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.08)'
const HEAD = "'Bricolage Grotesque', sans-serif"

type Row = { size: number; rentable: number; occupied: number; reserved: number; maintenance: number; available: number; avgDaysVacant: number | null; demand: number; demandPerAvailable: number | null; flags: string[] }
type Mix = { days: number; rows: Row[]; totals: Omit<Row, 'size' | 'avgDaysVacant' | 'demandPerAvailable' | 'flags'>; note: string }
type Risk = { atRisk: number; valueAtRisk: number; contracts: { contractId: string; contractNo: string; customer: string; unit: string; endDate: string; rate: number; owner: string; ownerId: string; score: number; reasons: string[] }[]; note: string }

const FLAG: Record<string, { text: string; bg: string; fg: string }> = {
  stockout: { text: 'Sold out, still asked for', bg: '#FEE2E2', fg: '#B91C1C' },
  stockout_maintenance: { text: 'Sold out — units in maintenance', bg: '#FEE2E2', fg: '#B91C1C' },
  oversupply: { text: 'Too much empty stock', bg: '#FEF3C7', fg: '#8A5A00' },
}

export default function StockRetention() {
  const [days, setDays] = useState(30)
  const [done, setDone] = useState<Record<string, string>>({})
  const mix = useQuery<Mix>({ queryKey: ['inventory-mix', days], queryFn: () => api.get('/reports/inventory-mix', { params: { days } }).then((r) => r.data) })
  const risk = useQuery<Risk>({ queryKey: ['at-risk'], queryFn: () => api.get('/reports/retention/at-risk').then((r) => r.data) })

  async function task(c: Risk['contracts'][number]) {
    try {
      await api.post('/tasks', {
        title: `Retention call: ${c.customer} (${c.unit})`, description: `At risk (score ${c.score}): ${c.reasons.join('; ')}. Contract ${c.contractNo}, ends ${c.endDate?.slice(0, 10)}.`,
        assignedTo: c.ownerId || undefined, leadId: c.contractId, leadType: 'contract', leadName: c.customer, priority: 'high',
      })
      setDone((d) => ({ ...d, [c.contractId]: 'Task created' }))
    } catch (e) { setDone((d) => ({ ...d, [c.contractId]: apiError(e) })) }
  }

  const th: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', color: MUTED, fontWeight: 600 }
  const td: React.CSSProperties = { padding: '6px 8px', borderTop: `1px solid ${LINE}` }
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }} className="space-y-6">
      <div>
        <h1 style={{ fontFamily: HEAD, fontSize: 24, fontWeight: 800, color: INK, margin: 0 }}>Stock & retention</h1>
        <div style={{ fontSize: 13, color: MUTED }}>Where demand has no stock, where stock sits empty, and who may leave.</div>
      </div>

      <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '16px 18px' }}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto" style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15 }}>Stock against demand, by size</div>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Demand period" style={{ height: 32, border: `1px solid ${LINE}`, borderRadius: 8, padding: '0 8px', fontSize: 13 }}>
            {[30, 60, 90].map((d) => <option key={d} value={d}>Leads, last {d} days</option>)}
          </select>
        </div>
        {mix.error && <div style={{ color: '#B91C1C', fontSize: 13 }}>{apiError(mix.error)}</div>}
        {mix.data && (
          <div className="overflow-x-auto" style={{ marginTop: 10 }}>
            <table className="w-full" style={{ fontSize: 13, borderCollapse: 'collapse', minWidth: 760 }}>
              <thead><tr><th style={th}>Size</th><th style={th}>Rentable</th><th style={th}>Occupied</th><th style={th}>Reserved</th><th style={th}>Maint.</th><th style={th}>Available</th><th style={th}>Days vacant</th><th style={th}>Asked for</th><th style={th} /></tr></thead>
              <tbody>
                {mix.data.rows.map((r) => (
                  <tr key={r.size}>
                    <td style={{ ...td, fontWeight: 700 }}>{r.size} sq ft</td><td style={td}>{r.rentable}</td><td style={td}>{r.occupied}</td><td style={td}>{r.reserved}</td>
                    <td style={td}>{r.maintenance ? <Link to="/maintenance" style={{ color: PURPLE }}>{r.maintenance}</Link> : 0}</td>
                    <td style={td}>{r.available}</td><td style={td}>{r.avgDaysVacant ?? '—'}</td><td style={td}>{r.demand}</td>
                    <td style={td}>{r.flags.map((f) => <span key={f} style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: FLAG[f]?.bg, color: FLAG[f]?.fg, marginRight: 4 }}>{FLAG[f]?.text || f}</span>)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}><td style={td}>Total</td><td style={td}>{mix.data.totals.rentable}</td><td style={td}>{mix.data.totals.occupied}</td><td style={td}>{mix.data.totals.reserved}</td><td style={td}>{mix.data.totals.maintenance}</td><td style={td}>{mix.data.totals.available}</td><td style={td} /><td style={td}>{mix.data.totals.demand}</td><td style={td} /></tr>
              </tbody>
            </table>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{mix.data.note}</div>
          </div>
        )}
      </section>

      <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '16px 18px' }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15 }}>Tenants at risk of leaving</div>
        {risk.error && <div style={{ color: '#B91C1C', fontSize: 13 }}>{apiError(risk.error)}</div>}
        {risk.data && (
          <>
            <div style={{ fontSize: 13, color: MUTED }}>{risk.data.atRisk} contracts · AED {risk.data.valueAtRisk.toLocaleString()} rent at risk per billing period</div>
            <div className="overflow-x-auto" style={{ marginTop: 10 }}>
              <table className="w-full" style={{ fontSize: 13, borderCollapse: 'collapse', minWidth: 760 }}>
                <thead><tr><th style={th}>Tenant</th><th style={th}>Unit</th><th style={th}>Ends</th><th style={th}>Score</th><th style={th}>Why</th><th style={th}>Owner</th><th style={th} /></tr></thead>
                <tbody>
                  {risk.data.contracts.map((c) => (
                    <tr key={c.contractId}>
                      <td style={td}><Link to={`/contracts/${c.contractId}`} style={{ color: PURPLE, fontWeight: 700 }}>{c.customer || c.contractNo}</Link></td>
                      <td style={td}>{c.unit}</td><td style={td}>{c.endDate?.slice(0, 10)}</td><td style={{ ...td, fontWeight: 800 }}>{c.score}</td>
                      <td style={{ ...td, color: '#4A4357' }}>{c.reasons.join(' · ')}</td><td style={td}>{c.owner || '—'}</td>
                      <td style={td}>{done[c.contractId] ? <span style={{ fontSize: 12, color: MUTED }}>{done[c.contractId]}</span> : <button type="button" onClick={() => task(c)} style={{ fontSize: 12, fontWeight: 700, color: PURPLE, background: 'none', border: 0, cursor: 'pointer' }}>Create task</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!risk.data.contracts.length && <div style={{ fontSize: 13, color: MUTED, padding: 8 }}>No contract scores 60 or more today.</div>}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{risk.data.note}</div>
          </>
        )}
      </section>
    </div>
  )
}

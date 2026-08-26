import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { api } from '../../lib/api'
import { Spinner } from '../../components/ui'

/* Tokens from the handoff. */
const PURPLE_700 = '#4A1FA0'
const PURPLE_600 = '#5B2BC9'
const PURPLE_500 = '#7C4DFF'
const PURPLE_200 = '#DDD0FF'
const PURPLE_50 = '#F7F3FF'
const INK = '#14081F'
const INK_2 = '#4A4357'
const INK_3 = '#756E80'
const PAPER = '#FBF8F2'
const LINE = 'rgba(20,8,31,0.10)'
const LINE_STRONG = 'rgba(20,8,31,0.16)'
const GOOD = '#1E8E5A'
const BAD = '#C0392B'
const DISPLAY = { fontFamily: "'Bricolage Grotesque', serif", letterSpacing: '-0.02em' } as const

type Row = {
  unitId: string; unitNumber: string; floor: string; sizeSqf: number | null
  actual: number; leased: number; occupied: boolean; priced: boolean
  contractNo: string; customer: string; sharedWith: number
  variance: number | null; discountPct: number | null
}
type Totals = {
  units: number; leasedUnits: number; vacantUnits: number; occupancyPct: number | null
  actualAll: number; actualLet: number; leased: number; variance: number
  discountPct: number | null; vacantValue: number; unpricedUnits: number
}
type Floor = Totals & { floor: string; rows: Row[] }
type Point = { monthISO: string; label: string; actual: number; leased: number; units: number; leasedUnits: number }
type Report = { month: string; label: string; cyclesPerYear: number; totals: Totals; floors: Floor[]; series: Point[]; rows: Row[] }

const aed = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })
const pct = (n: number | null) => (n == null ? '—' : `${n}%`)

function recentMonths() {
  const out: string[] = []
  const now = new Date()
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/**
 * Download the report as a formatted workbook.
 *
 * Built on the server: a CSV carries no design at all, and putting a
 * spreadsheet library in the browser bundle to fix that would cost every page
 * load. Fetched rather than linked because the endpoint needs the auth header,
 * which a plain link cannot send.
 */
async function downloadWorkbook(month: string) {
  const res = await api.get('/reports/rates/export', {
    params: { month },
    responseType: 'blob',
  })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `purplebox-actual-vs-leased-${month}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

function MetricCard({ label, value, sub, filled }: { label: string; value: string; sub: string; filled?: boolean }) {
  return (
    <div style={{
      background: filled ? PURPLE_600 : '#fff',
      border: `1px solid ${filled ? PURPLE_600 : LINE}`,
      borderRadius: 18, padding: 26, color: filled ? '#fff' : INK,
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: filled ? PURPLE_200 : INK_3 }}>
        {label}
      </span>
      <div style={{ ...DISPLAY, fontWeight: 700, fontSize: 34, marginTop: 10, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 13, color: filled ? 'rgba(255,255,255,.75)' : INK_3, marginTop: 6 }}>{sub}</div>
    </div>
  )
}

/** The 12-month trend, from the same figures as the table below it. */
function Trend({ series }: { series: Point[] }) {
  const max = Math.max(1, ...series.flatMap((p) => [p.actual, p.leased]))
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, padding: '30px 30px 24px', marginTop: 20 }}>
      <div className="flex justify-between items-baseline flex-wrap" style={{ gap: 10 }}>
        <div>
          <h3 style={{ ...DISPLAY, fontSize: 20, fontWeight: 700, margin: 0 }}>Monthly income, last 12 months</h3>
          {/* Said plainly rather than left to be assumed: prices are not
              versioned, so the asking line uses today's prices throughout. */}
          <p style={{ margin: '4px 0 0', fontSize: 13, color: INK_3 }}>
            Leased is what the contracts running each month were worth. Asking uses today&rsquo;s prices,
            counting only units that existed by then.
          </p>
        </div>
        <div className="flex" style={{ gap: 18, fontSize: 13, color: INK_2 }}>
          <span className="flex items-center" style={{ gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: PURPLE_600, display: 'inline-block' }} />Actual (asking)
          </span>
          <span className="flex items-center" style={{ gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: PURPLE_200, display: 'inline-block' }} />Leased
          </span>
        </div>
      </div>

      <div className="flex items-end" style={{ gap: 14, height: 200, marginTop: 28, paddingTop: 10, borderTop: `1px solid ${LINE}` }}>
        {series.map((p, i) => (
          <div key={p.monthISO} className="flex flex-col items-center justify-end" style={{ flex: 1, gap: 8, height: '100%' }}>
            <div className="flex items-end" style={{ gap: 3, height: '100%' }}>
              <div
                title={`Asking AED ${aed(p.actual)} · ${p.units} units`}
                style={{ width: 11, borderRadius: '4px 4px 0 0', background: i === series.length - 1 ? PURPLE_600 : PURPLE_500, height: `${Math.round((p.actual / max) * 100)}%` }}
              />
              <div
                title={`Leased AED ${aed(p.leased)} · ${p.leasedUnits} units`}
                style={{ width: 11, borderRadius: '4px 4px 0 0', background: PURPLE_200, height: `${Math.round((p.leased / max) * 100)}%` }}
              />
            </div>
            <span style={{ fontSize: 11, color: INK_3, fontWeight: 600 }}>{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const GRID = '2.1fr 1.1fr 1.6fr 1fr 1fr 1fr 0.8fr'

export default function RatesReport() {
  const months = recentMonths()
  const [month, setMonth] = useState(months[0])
  const [leasedOnly, setLeasedOnly] = useState(false)
  const [annual, setAnnual] = useState(false)
  const [exporting, setExporting] = useState(false)

  const { data, isLoading } = useQuery<Report>({
    queryKey: ['rates-report', month],
    queryFn: () => api.get('/reports/rates', { params: { month } }).then((r) => r.data),
  })

  const t = data?.totals
  const series = data?.series ?? []
  // Charging is per four weeks, so a year is 52 / 4 = 13 cycles. The server
  // sends the figure so the rule lives with the rest of the billing logic.
  const cycles = data?.cyclesPerYear ?? 13
  const cards = annual
    ? [
      // Annualised from the cycle, not summed from the trend. The trend only
      // goes back as far as the records do — three months at present — so
      // adding those up produced 765,700 and called it a year.
      { label: 'Annual asking', value: aed((t?.actualAll ?? 0) * cycles), sub: `${data?.label ?? ''} asking × ${cycles} cycles` },
      { label: 'Annual leased', value: aed((t?.leased ?? 0) * cycles), sub: `${data?.label ?? ''} leased × ${cycles} cycles` },
      {
        label: (t?.variance ?? 0) >= 0 ? 'Annual above asking' : 'Annual below asking',
        value: aed(Math.abs(t?.variance ?? 0) * cycles),
        sub: t?.discountPct != null ? `${t.discountPct}% on what is let, annualised` : 'Nothing let',
        filled: true,
      },
    ]
    : [
      // What the space would earn in a year at full occupancy and no discount:
      // a ceiling to measure against, not a forecast.
      { label: 'Annual run rate', value: aed((t?.actualAll ?? 0) * cycles), sub: `${data?.label ?? ''} asking × ${cycles} four-week cycles` },
      { label: 'Monthly asking', value: aed(t?.actualAll ?? 0), sub: `Across all ${t?.units ?? 0} units` },
      { label: 'Monthly leased', value: aed(t?.leased ?? 0), sub: `${t?.leasedUnits ?? 0} of ${t?.units ?? 0} units under lease`, filled: true },
    ]

  return (
    <div style={{ background: PAPER, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>

        <div className="flex justify-between items-end flex-wrap" style={{ gap: 20 }}>
          <div>
            <span style={{ textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 600, fontSize: 12, color: PURPLE_700 }}>Financials</span>
            <h1 style={{ ...DISPLAY, fontWeight: 700, letterSpacing: '-0.03em', fontSize: 'clamp(32px,4vw,44px)', margin: '10px 0 0' }}>Actual vs leased</h1>
            <p style={{ margin: '8px 0 0', color: INK_2, fontSize: 16, maxWidth: '52ch' }}>
              What each unit is priced at, against what it actually let for.
            </p>
          </div>

          <div className="flex items-center flex-wrap" style={{ gap: 12 }}>
            <div className="flex" style={{ background: '#fff', border: `1px solid ${LINE_STRONG}`, borderRadius: 999, padding: 4, gap: 2 }}>
              {([['Monthly', false], ['Annual (12mo)', true]] as const).map(([label, on]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setAnnual(on)}
                  style={{
                    height: 38, padding: '0 16px', borderRadius: 999, border: 'none', cursor: 'pointer',
                    fontWeight: 600, fontSize: 14, fontFamily: 'inherit',
                    background: annual === on ? PURPLE_600 : 'transparent',
                    color: annual === on ? '#fff' : INK_2,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <select
              value={month}
              disabled={annual}
              onChange={(e) => setMonth(e.target.value)}
              style={{
                height: 46, padding: '0 16px', borderRadius: 999, border: `1px solid ${LINE_STRONG}`,
                background: '#fff', fontFamily: 'inherit', fontWeight: 600, fontSize: 14, color: INK,
                cursor: annual ? 'not-allowed' : 'pointer', opacity: annual ? 0.5 : 1,
              }}
            >
              {months.map((m) => (
                <option key={m} value={m}>
                  {new Date(`${m}-01T12:00:00Z`).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
                </option>
              ))}
            </select>

            <label className="flex items-center select-none" style={{ gap: 8, height: 46, padding: '0 18px', borderRadius: 999, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              <input type="checkbox" checked={leasedOnly} onChange={(e) => setLeasedOnly(e.target.checked)} style={{ width: 16, height: 16, accentColor: PURPLE_600 }} />
              Leased only
            </label>

            <button
              type="button"
              onClick={() => { setExporting(true); downloadWorkbook(month).finally(() => setExporting(false)) }}
              disabled={!data?.rows.length || exporting}
              className="inline-flex items-center disabled:opacity-50"
              style={{ gap: 8, height: 46, padding: '0 20px', borderRadius: 999, border: 'none', background: PURPLE_600, color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', boxShadow: '0 8px 24px rgba(91,43,201,.24)' }}
            >
              <Download size={16} /> {exporting ? 'Preparing…' : 'Export to Excel'}
            </button>
          </div>
        </div>

        {!!t?.unpricedUnits && (
          <p style={{ margin: '22px 0 0', fontSize: 13, color: BAD, fontWeight: 500 }}>
            {t.unpricedUnits} unit{t.unpricedUnits === 1 ? '' : 's'} with no price set — left out of the percentages.
          </p>
        )}

        {isLoading ? (
          <div style={{ padding: 60 }}><Spinner /></div>
        ) : !data ? null : (
          <>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginTop: 24 }}>
              {cards.map((c) => <MetricCard key={c.label} {...c} />)}
            </div>

            {/* Two figures the cards above cannot show, and the ones that
                actually move the money. */}
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginTop: 16 }}>
              <MetricCard label="Occupancy" value={pct(t?.occupancyPct ?? null)} sub={`${t?.leasedUnits ?? 0} leased · ${t?.vacantUnits ?? 0} vacant`} />
              <MetricCard label="Sitting empty" value={`AED ${aed(t?.vacantValue ?? 0)}`} sub="Asking price not earning" />
              <MetricCard
                label={(t?.variance ?? 0) >= 0 ? 'Above asking' : 'Below asking'}
                value={`AED ${aed(Math.abs(t?.variance ?? 0))}`}
                sub={t?.discountPct != null ? `${t.discountPct}% on what is let` : 'Nothing let'}
              />
            </div>

            {series.length > 0 && <Trend series={series} />}

            <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, marginTop: 20, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 900 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: GRID, padding: '14px 26px', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: INK_3, borderBottom: `1px solid ${LINE}` }}>
                    <span>Unit</span><span>Contract</span><span>Customer</span>
                    <span style={{ textAlign: 'right' }}>Actual</span>
                    <span style={{ textAlign: 'right' }}>Leased</span>
                    <span style={{ textAlign: 'right' }}>Variance</span>
                    <span style={{ textAlign: 'right' }}>Discount</span>
                  </div>

                  {data.floors.map((f) => {
                    const rows = leasedOnly ? f.rows.filter((r) => r.occupied) : f.rows
                    if (!rows.length) return null
                    return (
                      <div key={f.floor}>
                        <div style={{ display: 'grid', gridTemplateColumns: GRID, padding: '15px 26px', background: PURPLE_50, fontWeight: 700, fontSize: 14, borderBottom: `1px solid ${LINE}` }}>
                          <span style={{ color: PURPLE_700 }}>{f.floor} · {f.units} units · {f.leasedUnits} leased ({pct(f.occupancyPct)})</span>
                          <span /><span />
                          <span style={{ textAlign: 'right' }}>AED {aed(f.actualAll)}</span>
                          <span style={{ textAlign: 'right' }}>AED {aed(f.leased)}</span>
                          <span style={{ textAlign: 'right', color: f.variance >= 0 ? GOOD : BAD }}>AED {aed(f.variance)}</span>
                          <span style={{ textAlign: 'right', color: (f.discountPct ?? 0) > 0 ? BAD : GOOD }}>{pct(f.discountPct)}</span>
                        </div>

                        {rows.map((r) => (
                          <div key={r.unitId} style={{ display: 'grid', gridTemplateColumns: GRID, padding: '15px 26px', fontSize: 14, borderBottom: `1px solid ${LINE}`, alignItems: 'center', background: r.occupied ? undefined : '#FCFBF9' }}>
                            <span style={{ fontWeight: 600 }}>
                              {r.unitNumber}
                              {r.sizeSqf ? <span style={{ color: INK_3, fontWeight: 500 }}> · {r.sizeSqf} sqft</span> : null}
                              {r.sharedWith > 1 && <span style={{ color: INK_3, fontWeight: 500 }}> · 1 of {r.sharedWith}</span>}
                            </span>
                            <span style={{ color: r.occupied ? INK : INK_3 }}>{r.contractNo || 'vacant'}</span>
                            <span style={{ color: r.occupied ? INK : INK_3 }}>{r.customer || '—'}</span>
                            <span style={{ textAlign: 'right', fontWeight: 600 }}>
                              {r.priced ? `AED ${aed(r.actual)}` : <span style={{ color: INK_3, fontWeight: 500 }}>not priced</span>}
                            </span>
                            <span style={{ textAlign: 'right', color: r.occupied ? INK : INK_3 }}>{r.occupied ? `AED ${aed(r.leased)}` : '—'}</span>
                            <span style={{ textAlign: 'right', fontWeight: 600, color: r.variance == null ? INK_3 : r.variance >= 0 ? GOOD : BAD }}>
                              {r.variance == null ? '—' : `AED ${aed(r.variance)}`}
                            </span>
                            <span style={{ textAlign: 'right', fontWeight: 600, color: r.discountPct == null ? INK_3 : r.discountPct > 0 ? BAD : GOOD }}>
                              {pct(r.discountPct)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
              {data.rows.length === 0 && (
                <p style={{ padding: 40, textAlign: 'center', fontSize: 13.5, color: INK_3 }}>No units to show.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

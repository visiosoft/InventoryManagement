import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { api } from '../../lib/api'
import { PageHeader, Spinner } from '../../components/ui'
import { StatCard } from './shared'

const INK = '#14081F'
const FAINT = '#756E80'
const LINE = 'rgba(20,8,31,0.10)'
const DANGER = '#C22A2A'
const GREEN = '#1D8A46'

type Row = {
  unitId: string
  unitNumber: string
  floor: string
  sizeSqf: number | null
  actual: number
  leased: number
  occupied: boolean
  priced: boolean
  contractNo: string
  customer: string
  billingPeriod: string
  sharedWith: number
  variance: number | null
  discountPct: number | null
}

type Totals = {
  units: number
  leasedUnits: number
  vacantUnits: number
  occupancyPct: number | null
  actualAll: number
  actualLet: number
  leased: number
  variance: number
  discountPct: number | null
  vacantValue: number
  unpricedUnits: number
}

type Floor = Totals & { floor: string; rows: Row[] }
type Report = { month: string; label: string; totals: Totals; floors: Floor[]; rows: Row[] }

const aed = (n: number) => `AED ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
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
 * A spreadsheet of the report.
 *
 * CSV rather than a real .xlsx: Excel opens it natively and it needs no
 * dependency. The BOM matters — without it Excel reads the accented and Arabic
 * names as mojibake.
 */
function downloadCsv(report: Report) {
  const cell = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [[
    'Floor', 'Unit', 'Size (sqf)', 'Status', 'Contract', 'Customer',
    'Actual (monthly)', 'Leased (monthly)', 'Variance', 'Discount %',
  ].join(',')]

  for (const r of report.rows) {
    lines.push([
      r.floor, r.unitNumber, r.sizeSqf ?? '',
      r.occupied ? 'Leased' : 'Vacant',
      r.contractNo, r.customer,
      r.priced ? r.actual : '',
      r.occupied ? r.leased : '',
      r.variance ?? '', r.discountPct ?? '',
    ].map(cell).join(','))
  }

  const t = report.totals
  lines.push('')
  lines.push(['TOTAL', `${t.units} units`, '', `${t.leasedUnits} leased / ${t.vacantUnits} vacant`, '', '', t.actualAll, t.leased, t.variance, t.discountPct ?? ''].map(cell).join(','))
  lines.push(['Asking price of vacant units', t.vacantValue].map(cell).join(','))

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `purplebox-actual-vs-leased-${report.month}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function Cell({ children, align = 'left', color, dim }: {
  children: React.ReactNode; align?: 'left' | 'right'; color?: string; dim?: boolean
}) {
  return (
    <td style={{
      padding: '9px 12px', fontSize: 13, textAlign: align,
      color: color ?? (dim ? FAINT : INK),
      fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${LINE}`,
    }}>
      {children}
    </td>
  )
}

export default function RatesReport() {
  const months = recentMonths()
  const [month, setMonth] = useState(months[0])
  const [onlyLeased, setOnlyLeased] = useState(false)

  const { data, isLoading } = useQuery<Report>({
    queryKey: ['rates-report', month],
    queryFn: () => api.get('/reports/rates', { params: { month } }).then((r) => r.data),
  })

  const t = data?.totals

  return (
    <div className="space-y-4">
      <PageHeader
        title="Actual vs leased"
        subtitle="What each unit is priced at, against what it is actually let for"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ height: 40, borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', padding: '0 14px', fontSize: 13, color: INK }}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {new Date(`${m}-01T12:00:00Z`).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 13, color: INK }}>
          <input type="checkbox" checked={onlyLeased} onChange={(e) => setOnlyLeased(e.target.checked)} />
          Leased only
        </label>
        <button
          type="button"
          onClick={() => data && downloadCsv(data)}
          disabled={!data?.rows.length}
          className="inline-flex items-center gap-1.5 rounded-full px-4 cursor-pointer disabled:opacity-50"
          style={{ height: 40, background: '#fff', border: `1px solid ${LINE}`, fontSize: 13, fontWeight: 600, color: INK }}
        >
          <Download size={14} /> Export to Excel
        </button>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !data ? null : (
        <>
          <div className="flex flex-wrap gap-2.5">
            <StatCard label="Units" value={String(t?.units ?? 0)} sub={`${t?.leasedUnits ?? 0} leased · ${t?.vacantUnits ?? 0} vacant`} />
            <StatCard label="Occupancy" value={pct(t?.occupancyPct ?? null)} />
            <StatCard label="Actual (all units)" value={aed(t?.actualAll ?? 0)} sub={`${aed(t?.actualLet ?? 0)} of it let`} />
            <StatCard label="Leased" value={aed(t?.leased ?? 0)} />
            <StatCard
              label={(t?.variance ?? 0) >= 0 ? 'Above asking' : 'Below asking'}
              value={aed(t?.variance ?? 0)}
              tone={(t?.variance ?? 0) >= 0 ? 'green' : 'red'}
              sub={t?.discountPct != null ? `${t.discountPct}% on what is let` : undefined}
            />
            {/* Usually the bigger number, and the one a discounting argument
                tends to leave out. */}
            <StatCard label="Sitting empty" value={aed(t?.vacantValue ?? 0)} tone="amber" sub="asking price not earning" />
          </div>

          {!!t?.unpricedUnits && (
            <p style={{ fontSize: 11.5, color: '#B45309' }}>
              {t.unpricedUnits} unit{t.unpricedUnits === 1 ? '' : 's'} with no price set — left out of the percentages.
            </p>
          )}

          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#FBF8F2' }}>
                    {['Unit', 'Contract', 'Customer', 'Actual', 'Leased', 'Variance', 'Discount'].map((h, i) => (
                      <th key={h} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: FAINT, textAlign: i >= 3 ? 'right' : 'left', borderBottom: `1px solid ${LINE}` }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.floors.map((f) => {
                    const rows = onlyLeased ? f.rows.filter((r) => r.occupied) : f.rows
                    if (!rows.length) return null
                    return (
                      <>
                        <tr key={f.floor} style={{ background: '#F7F3FF' }}>
                          <td colSpan={3} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, color: '#4A1FA0' }}>
                            {f.floor} · {f.units} units · {f.leasedUnits} leased ({pct(f.occupancyPct)})
                          </td>
                          <Cell align="right">{aed(f.actualAll)}</Cell>
                          <Cell align="right">{aed(f.leased)}</Cell>
                          <Cell align="right" color={f.variance >= 0 ? GREEN : DANGER}>{aed(f.variance)}</Cell>
                          <Cell align="right">{pct(f.discountPct)}</Cell>
                        </tr>
                        {rows.map((r) => (
                          <tr key={r.unitId} style={{ background: r.occupied ? undefined : '#FCFBF9' }}>
                            <Cell>
                              {r.unitNumber}
                              {r.sizeSqf ? <span style={{ color: FAINT, fontSize: 11 }}> · {r.sizeSqf} sqf</span> : null}
                              {r.sharedWith > 1 && <span style={{ color: FAINT, fontSize: 11 }}> · 1 of {r.sharedWith}</span>}
                            </Cell>
                            <Cell dim={!r.occupied}>{r.contractNo || 'vacant'}</Cell>
                            <Cell dim={!r.occupied}>{r.customer || '—'}</Cell>
                            <Cell align="right">{r.priced ? aed(r.actual) : <span style={{ color: FAINT }}>not priced</span>}</Cell>
                            <Cell align="right" dim={!r.occupied}>{r.occupied ? aed(r.leased) : '—'}</Cell>
                            <Cell align="right" color={r.variance == null ? FAINT : r.variance >= 0 ? GREEN : DANGER}>
                              {r.variance == null ? '—' : aed(r.variance)}
                            </Cell>
                            <Cell align="right" color={r.discountPct == null ? FAINT : r.discountPct > 0 ? DANGER : GREEN}>
                              {pct(r.discountPct)}
                            </Cell>
                          </tr>
                        ))}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {data.rows.length === 0 && (
              <p style={{ padding: 40, textAlign: 'center', fontSize: 13.5, color: FAINT }}>No units to show.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

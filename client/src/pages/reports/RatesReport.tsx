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
  contractId: string
  contractNo: string
  customer: string
  units: string[]
  unitCount: number
  floor: string
  sizeSqf: number | null
  billingPeriod: 'weekly' | 'monthly'
  billedRate: number
  actual: number
  leased: number
  variance: number | null
  discountPct: number | null
  priced: boolean
  status: string
}

type Totals = {
  contracts: number
  units: number
  actual: number
  leased: number
  leasedOnPriced: number
  variance: number
  discountPct: number | null
  unpriced: number
}

type Floor = Totals & { floor: string; rows: Row[] }
type Report = { month: string; label: string; totals: Totals; floors: Floor[]; rows: Row[] }

const money = (n: number) => `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (n: number | null) => (n == null ? '—' : `${n > 0 ? '' : ''}${n}%`)

/** The last 18 months, newest first. */
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
 * CSV rather than a real .xlsx: Excel opens it natively, it needs no dependency,
 * and it matches the CSV export already on the forecast report. A BOM is
 * prepended so Excel reads the Arabic and accented names as UTF-8 rather than
 * as mojibake, which it does by default without one.
 */
function downloadCsv(report: Report) {
  const cell = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = [
    'Floor', 'Units', 'Size (sqf)', 'Contract', 'Customer', 'Billing',
    'Billed rate', 'Actual (monthly)', 'Leased (monthly)', 'Variance', 'Discount %', 'Status',
  ]
  const lines = [header.join(',')]

  for (const r of report.rows) {
    lines.push([
      r.floor || 'No floor',
      r.units.join(' + '),
      r.sizeSqf ?? '',
      r.contractNo,
      r.customer,
      r.billingPeriod,
      r.billedRate,
      r.priced ? r.actual : '',
      r.leased,
      r.variance ?? '',
      r.discountPct ?? '',
      r.status,
    ].map(cell).join(','))
  }

  const t = report.totals
  lines.push('')
  lines.push(['TOTAL', t.units, '', `${t.contracts} contracts`, '', '', '', t.actual, t.leased, t.variance, t.discountPct ?? '', ''].map(cell).join(','))
  if (t.unpriced) lines.push([`${t.unpriced} contract(s) on units with no price set — excluded from the percentage`].map(cell).join(','))

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `purplebox-rates-${report.month}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function Cell({ children, align = 'left', color }: { children: React.ReactNode; align?: 'left' | 'right'; color?: string }) {
  return (
    <td style={{ padding: '10px 12px', fontSize: 13, textAlign: align, color: color ?? INK, fontVariantNumeric: 'tabular-nums', borderBottom: `1px solid ${LINE}` }}>
      {children}
    </td>
  )
}

export default function RatesReport() {
  const months = recentMonths()
  const [month, setMonth] = useState(months[0])

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
            <StatCard label="Contracts running" value={String(t?.contracts ?? 0)} />
            <StatCard label="Units leased" value={String(t?.units ?? 0)} />
            <StatCard label="Actual (asking)" value={money(t?.actual ?? 0)} />
            <StatCard label="Leased" value={money(t?.leased ?? 0)} />
            <StatCard
              label={(t?.variance ?? 0) >= 0 ? 'Above asking' : 'Below asking'}
              value={money(t?.variance ?? 0)}
              tone={(t?.variance ?? 0) >= 0 ? 'green' : 'red'}
              sub={t?.discountPct != null ? `${t.discountPct}% discount overall` : undefined}
            />
          </div>

          {/* Named rather than folded in: an unpriced unit would read as a
              100% discount and wreck the percentage. */}
          {!!t?.unpriced && (
            <p style={{ fontSize: 11.5, color: '#B45309' }}>
              {t.unpriced} contract{t.unpriced === 1 ? '' : 's'} on units with no price set — counted in the money, left out of the percentage.
            </p>
          )}

          <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 940, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#FBF8F2' }}>
                    {['Unit(s)', 'Contract', 'Customer', 'Billing', 'Actual', 'Leased', 'Variance', 'Discount'].map((h, i) => (
                      <th key={h} style={{ padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: FAINT, textAlign: i >= 4 ? 'right' : 'left', borderBottom: `1px solid ${LINE}` }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.floors.map((f) => (
                    <>
                      <tr key={f.floor} style={{ background: '#F7F3FF' }}>
                        <td colSpan={4} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, color: '#4A1FA0' }}>
                          {f.floor} · {f.units} units
                        </td>
                        <Cell align="right">{money(f.actual)}</Cell>
                        <Cell align="right">{money(f.leased)}</Cell>
                        <Cell align="right" color={f.variance >= 0 ? GREEN : DANGER}>{money(f.variance)}</Cell>
                        <Cell align="right">{pct(f.discountPct)}</Cell>
                      </tr>
                      {f.rows.map((r) => (
                        <tr key={r.contractId + r.units.join()}>
                          <Cell>{r.units.join(' + ') || '—'}{r.sizeSqf ? <span style={{ color: FAINT, fontSize: 11 }}> · {r.sizeSqf} sqf</span> : null}</Cell>
                          <Cell>{r.contractNo}</Cell>
                          <Cell>{r.customer || '—'}</Cell>
                          <Cell>
                            {r.billingPeriod === 'weekly'
                              ? <span title={`Billed AED ${r.billedRate} per week`} style={{ color: FAINT }}>weekly · {money(r.billedRate)}/wk</span>
                              : <span style={{ color: FAINT }}>monthly</span>}
                          </Cell>
                          <Cell align="right">{r.priced ? money(r.actual) : <span style={{ color: FAINT }}>not priced</span>}</Cell>
                          <Cell align="right">{money(r.leased)}</Cell>
                          <Cell align="right" color={r.variance == null ? FAINT : r.variance >= 0 ? GREEN : DANGER}>
                            {r.variance == null ? '—' : money(r.variance)}
                          </Cell>
                          <Cell align="right" color={r.discountPct == null ? FAINT : r.discountPct > 0 ? DANGER : GREEN}>
                            {pct(r.discountPct)}
                          </Cell>
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
            {data.rows.length === 0 && (
              <p style={{ padding: 40, textAlign: 'center', fontSize: 13.5, color: FAINT }}>
                No contracts were running in {data.label}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

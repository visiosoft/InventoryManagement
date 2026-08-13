import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { api } from '../../../lib/api'
import { Card, CardBody, CardHeader, EmptyState, Field, PageHeader, Select, Spinner, Table, Td, Th, Button } from '../../../components/ui'
import { CHART_STYLE, StatCard, downloadCsv } from './shared'

interface CostRow {
  month: string; labor: number; truck: number; materials: number
  packing: number; extras: number; externalHires: number; total: number
  clientTotal: number; jobCount: number; margin: number
}
interface CostsData { rows: CostRow[]; totals: CostRow }

const CATS: { key: keyof CostRow; label: string; color: string }[] = [
  { key: 'labor', label: 'Labor', color: '#06B6D4' },
  { key: 'truck', label: 'Truck', color: '#F97316' },
  { key: 'materials', label: 'Materials', color: '#8B5CF6' },
  { key: 'packing', label: 'Packing', color: '#10B981' },
  { key: 'extras', label: 'Extras', color: '#F59E0B' },
  { key: 'externalHires', label: 'External Hires', color: '#EF4444' },
]

const money = (n: number) => `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 0 })}`

function monthLabel(m: string) {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

export default function MovingCostsReport() {
  const [months, setMonths] = useState('12')

  const { data, isLoading } = useQuery<CostsData>({
    queryKey: ['moving-report-costs', months],
    queryFn: () => api.get('/moving-reports/costs', { params: { months } }).then(r => r.data),
  })

  const rows = (data?.rows ?? []).map(r => ({ ...r, label: monthLabel(r.month) }))
  const totals = data?.totals
  const marginPct = totals && totals.clientTotal > 0 ? Math.round((totals.margin / totals.clientTotal) * 1000) / 10 : 0

  return (
    <div className="space-y-6">
      <PageHeader title="Cost Breakdown vs Client Total" subtitle="What jobs cost to run — labor, truck, materials and more — against what clients were billed, by month" />

      <Field label="Range" className="max-w-xs">
        <Select value={months} onChange={e => setMonths(e.target.value)}>
          <option value="3">Last 3 months</option>
          <option value="6">Last 6 months</option>
          <option value="12">Last 12 months</option>
          <option value="24">Last 24 months</option>
        </Select>
      </Field>

      {totals && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Cost" value={money(totals.total)} tone="amber" />
          <StatCard label="Client Total" value={money(totals.clientTotal)} />
          <StatCard label="Margin" value={`${totals.margin >= 0 ? '+' : ''}${money(totals.margin)}`} tone={totals.margin >= 0 ? 'green' : 'red'} sub={`${marginPct}% of client total`} />
          <StatCard label="Jobs" value={String(totals.jobCount)} />
        </div>
      )}

      <Card>
        <CardHeader title="Monthly cost by category vs client total" subtitle="Stacked bars are cost by category; the line is what clients were billed" />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No completed jobs with costs in this range" /> : (
            <div style={{ height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={CHART_STYLE.axisStyle} />
                  <YAxis tick={CHART_STYLE.axisStyle} />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle} formatter={(v) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {CATS.map(c => <Bar key={c.key} dataKey={c.key} name={c.label} stackId="cost" fill={c.color} />)}
                  <Line type="monotone" dataKey="clientTotal" name="Client Total" stroke="#14081F" strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Monthly detail"
          action={rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => downloadCsv('moving-costs-vs-client-total.csv', [
              ['Month', ...CATS.map(c => c.label), 'Total Cost', 'Client Total', 'Margin', 'Jobs'],
              ...rows.map(r => [r.month, ...CATS.map(c => r[c.key]), r.total, r.clientTotal, r.margin, r.jobCount]),
            ])}>Export CSV</Button>
          )} />
        <CardBody>
          {rows.length === 0 ? null : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Month</Th>
                    {CATS.map(c => <Th key={c.key} className="text-right">{c.label}</Th>)}
                    <Th className="text-right">Total Cost</Th>
                    <Th className="text-right">Client Total</Th>
                    <Th className="text-right">Margin</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.month} className="hover:bg-muted/30">
                      <Td className="font-medium">{r.label}</Td>
                      {CATS.map(c => <Td key={c.key} className="text-right">{money(r[c.key] as number)}</Td>)}
                      <Td className="text-right font-bold">{money(r.total)}</Td>
                      <Td className="text-right font-bold">{money(r.clientTotal)}</Td>
                      <Td className={`text-right font-bold ${r.margin >= 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                        {r.margin >= 0 ? '+' : ''}{money(r.margin)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

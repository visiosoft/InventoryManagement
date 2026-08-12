import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { api } from '../../../lib/api'
import { Card, CardBody, CardHeader, EmptyState, Field, PageHeader, Select, Spinner, Table, Td, Th, Button } from '../../../components/ui'
import { CHART_STYLE, StatCard, downloadCsv } from './shared'

interface CostRow {
  month: string; labor: number; truck: number; materials: number
  packing: number; extras: number; externalHires: number; total: number
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

  return (
    <div className="space-y-6">
      <PageHeader title="Cost Breakdown" subtitle="Where job costs go — labor, truck, materials and more, by month" />

      <Field label="Range" className="max-w-xs">
        <Select value={months} onChange={e => setMonths(e.target.value)}>
          <option value="3">Last 3 months</option>
          <option value="6">Last 6 months</option>
          <option value="12">Last 12 months</option>
          <option value="24">Last 24 months</option>
        </Select>
      </Field>

      {totals && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CATS.map(c => <StatCard key={c.key} label={c.label} value={money(totals[c.key] as number)} />)}
        </div>
      )}

      <Card>
        <CardHeader title="Monthly cost by category" />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No completed jobs with costs in this range" /> : (
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={CHART_STYLE.axisStyle} />
                  <YAxis tick={CHART_STYLE.axisStyle} />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle} formatter={(v) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {CATS.map(c => <Bar key={c.key} dataKey={c.key} name={c.label} stackId="cost" fill={c.color} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Monthly detail"
          action={rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => downloadCsv('moving-costs.csv', [
              ['Month', ...CATS.map(c => c.label), 'Total'],
              ...rows.map(r => [r.month, ...CATS.map(c => r[c.key]), r.total]),
            ])}>Export CSV</Button>
          )} />
        <CardBody>
          {rows.length === 0 ? null : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr><Th>Month</Th>{CATS.map(c => <Th key={c.key} className="text-right">{c.label}</Th>)}<Th className="text-right">Total</Th></tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.month} className="hover:bg-muted/30">
                      <Td className="font-medium">{r.label}</Td>
                      {CATS.map(c => <Td key={c.key} className="text-right">{money(r[c.key] as number)}</Td>)}
                      <Td className="text-right font-bold">{money(r.total)}</Td>
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

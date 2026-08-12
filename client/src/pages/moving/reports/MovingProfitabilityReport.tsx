import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { api } from '../../../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Spinner, Table, Td, Th } from '../../../components/ui'
import { CHART_STYLE, StatCard, downloadCsv } from './shared'

interface ProfitRow {
  _id: string; jobNo: string; customer: string; scheduledDate: string; status: string
  invoiceNo?: string; invoiceStatus?: string
  revenue: number; cost: number; profit: number; margin: number
  costs: { labor?: number; truck?: number; materials?: number; packing?: number; extras?: number; externalHires?: number }
}
interface MonthlyRow { month: string; revenue: number; cost: number; profit: number; margin: number; jobCount: number }
interface Summary { totalRevenue: number; totalCost: number; totalProfit: number; avgMargin: number; jobCount: number }

const money = (n: number) => `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 0 })}`
function monthLabel(m: string) {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

export default function MovingProfitabilityReport() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data, isLoading } = useQuery<{ rows: ProfitRow[]; monthly: MonthlyRow[]; summary: Summary }>({
    queryKey: ['moving-report-profitability', from, to],
    queryFn: () => api.get('/moving-reports/profitability', { params: { from: from || undefined, to: to || undefined } }).then(r => r.data),
  })

  const rows = data?.rows ?? []
  const monthly = (data?.monthly ?? []).map(m => ({ ...m, label: monthLabel(m.month) }))
  const s = data?.summary

  return (
    <div className="space-y-6">
      <PageHeader title="Job Profitability" subtitle="Revenue vs cost per completed job" />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        {(from || to) && <Button variant="outline" size="sm" onClick={() => { setFrom(''); setTo('') }}>Clear</Button>}
      </div>

      {s && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Jobs" value={String(s.jobCount)} />
          <StatCard label="Revenue" value={money(s.totalRevenue)} />
          <StatCard label="Total Cost" value={money(s.totalCost)} tone="amber" />
          <StatCard label="Profit" value={money(s.totalProfit)} tone={s.totalProfit >= 0 ? 'green' : 'red'} />
          <StatCard label="Avg Margin" value={`${s.avgMargin}%`} tone={s.avgMargin >= 0 ? 'green' : 'red'} />
        </div>
      )}

      {monthly.length > 0 && (
        <Card>
          <CardHeader title="Monthly trend" subtitle="Revenue, cost and margin by month" />
          <CardBody>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={CHART_STYLE.axisStyle} />
                  <YAxis yAxisId="money" tick={CHART_STYLE.axisStyle} />
                  <YAxis yAxisId="pct" orientation="right" tick={CHART_STYLE.axisStyle} unit="%" />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle} formatter={(v, name) => name === 'Margin' ? `${v}%` : money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="money" dataKey="revenue" name="Revenue" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="money" dataKey="cost" name="Cost" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="pct" type="monotone" dataKey="margin" name="Margin" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={`${rows.length} jobs`}
          action={rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => downloadCsv('moving-profitability.csv', [
              ['Job', 'Customer', 'Date', 'Invoice', 'Revenue', 'Cost', 'Profit', 'Margin %'],
              ...rows.map(r => [r.jobNo, r.customer ?? '', r.scheduledDate ? new Date(r.scheduledDate).toLocaleDateString() : '', r.invoiceNo ?? '', r.revenue, r.cost, r.profit, r.margin]),
            ])}>Export CSV</Button>
          )} />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No completed/invoiced jobs found" /> : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Job</Th><Th>Customer</Th><Th>Date</Th><Th>Invoice</Th>
                    <Th className="text-right">Revenue</Th><Th className="text-right">Cost</Th>
                    <Th className="text-right">Profit</Th><Th className="text-right">Margin</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r._id} className="hover:bg-muted/30">
                      <Td><Link to={`/moving/jobs/${r._id}`} className="text-primary font-medium hover:underline">{r.jobNo}</Link></Td>
                      <Td>{r.customer || '—'}</Td>
                      <Td>{r.scheduledDate ? new Date(r.scheduledDate).toLocaleDateString() : '—'}</Td>
                      <Td>{r.invoiceNo ? <Badge tone={r.invoiceStatus === 'paid' ? 'green' : 'amber'}>{r.invoiceNo}</Badge> : <span className="text-muted-foreground">—</span>}</Td>
                      <Td className="text-right font-medium">AED {r.revenue.toLocaleString()}</Td>
                      <Td className="text-right">AED {r.cost.toLocaleString()}</Td>
                      <Td className={`text-right font-bold ${r.profit >= 0 ? 'text-green-600' : 'text-destructive'}`}>AED {r.profit.toLocaleString()}</Td>
                      <Td className="text-right">
                        <Badge tone={r.margin >= 30 ? 'green' : r.margin >= 10 ? 'amber' : 'red'}>{r.margin}%</Badge>
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

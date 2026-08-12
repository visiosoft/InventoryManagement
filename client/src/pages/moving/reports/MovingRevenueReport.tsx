import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '../../../lib/api'
import { Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, Select, Spinner, Table, Td, Th } from '../../../components/ui'
import { CHART_STYLE, downloadCsv } from './shared'

interface RevenueRow {
  _id: { year: number; month: number }
  revenue: number
  count: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = (n: number) => `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 0 })}`

export default function MovingRevenueReport() {
  const [months, setMonths] = useState('12')

  const { data: rows = [], isLoading } = useQuery<RevenueRow[]>({
    queryKey: ['moving-report-revenue', months],
    queryFn: () => api.get('/moving-reports/revenue', { params: { months } }).then(r => r.data),
  })

  const chartRows = rows.map(r => ({ label: `${MONTHS[r._id.month - 1]} ${r._id.year}`, revenue: r.revenue, count: r.count }))
  const total = rows.reduce((s, r) => s + r.revenue, 0)

  return (
    <div className="space-y-6">
      <PageHeader title="Revenue Report" subtitle={`Total paid invoices: ${money(total)}`} />

      <Field label="Range" className="max-w-xs">
        <Select value={months} onChange={e => setMonths(e.target.value)}>
          <option value="3">Last 3 months</option>
          <option value="6">Last 6 months</option>
          <option value="12">Last 12 months</option>
          <option value="24">Last 24 months</option>
        </Select>
      </Field>

      <Card>
        <CardHeader title="Monthly Revenue" />
        <CardBody>
          {isLoading ? <Spinner /> : chartRows.length === 0 ? <EmptyState message="No revenue data yet" /> : (
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartRows}>
                  <defs>
                    <linearGradient id="movingRevenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={CHART_STYLE.axisStyle} />
                  <YAxis tick={CHART_STYLE.axisStyle} />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle} formatter={(v) => money(Number(v))} />
                  <Area type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={2} fill="url(#movingRevenueFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Monthly detail"
          action={chartRows.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => downloadCsv('moving-revenue.csv', [
              ['Month', 'Revenue', 'Invoices'],
              ...chartRows.map(r => [r.label, r.revenue, r.count]),
            ])}>Export CSV</Button>
          )} />
        <CardBody>
          {chartRows.length === 0 ? null : (
            <Table>
              <thead><tr><Th>Month</Th><Th className="text-right">Revenue</Th><Th className="text-right">Invoices</Th></tr></thead>
              <tbody>
                {chartRows.map(r => (
                  <tr key={r.label} className="hover:bg-muted/30">
                    <Td className="font-medium">{r.label}</Td>
                    <Td className="text-right">{money(r.revenue)}</Td>
                    <Td className="text-right">{r.count}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

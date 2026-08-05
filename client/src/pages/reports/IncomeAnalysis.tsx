import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { api } from '../../lib/api'
import { Card, CardBody, CardHeader, PageHeader, Spinner, Table, Td, Th } from '../../components/ui'
import { formatMoney } from '../../lib/utils'

type MonthData = { month: number; label: string; expected: number; actual: number; discountLoss: number; extras: number; pending: number }
type UnitData = { unitNumber: string; floor: string; sizeSqf: number; listPrice: number; expected: number; actual: number; discountLoss: number }
type IncomeData = { year: number; months: MonthData[]; byUnit: UnitData[]; totals: { expected: number; actual: number; discountLoss: number; extras: number; pending: number } }

export default function IncomeAnalysis() {
  const [year, setYear] = useState(new Date().getFullYear())

  const { data, isLoading } = useQuery<IncomeData>({
    queryKey: ['income-analysis', year],
    queryFn: () => api.get('/reports/income-analysis', { params: { year } }).then(r => r.data),
  })

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  return (
    <div>
      <PageHeader
        title="Income Analysis"
        subtitle="Expected vs Actual revenue, discount losses, and extras"
        action={
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        }
      />

      {isLoading || !data ? <Spinner /> : (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <SummaryCard label="Expected" value={data.totals.expected} color="#4C8CE4" />
            <SummaryCard label="Actual Received" value={data.totals.actual} color="#10b981" />
            <SummaryCard label="Discount Loss" value={data.totals.discountLoss} color="#ef4444" />
            <SummaryCard label="Extras (Locks etc.)" value={data.totals.extras} color="#8b5cf6" />
            <SummaryCard label="Pending" value={data.totals.pending} color="#f59e0b" />
          </div>

          {/* Monthly chart */}
          <Card>
            <CardHeader title="Monthly Breakdown" subtitle={`${year} — Expected vs Actual`} />
            <CardBody>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.months} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={60} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v) => formatMoney(Number(v))} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Legend />
                  <Bar dataKey="expected" name="Expected" fill="#4C8CE4" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="actual" name="Received" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="discountLoss" name="Discount Loss" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="extras" name="Extras" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          {/* Monthly table */}
          <Card>
            <CardHeader title="Monthly Details" />
            <Table>
              <thead>
                <tr><Th>Month</Th><Th>Expected</Th><Th>Received</Th><Th>Discount Loss</Th><Th>Extras</Th><Th>Pending</Th></tr>
              </thead>
              <tbody>
                {data.months.filter(m => m.expected > 0 || m.actual > 0).map(m => (
                  <tr key={m.month} className="hover:bg-muted/50">
                    <Td className="font-medium">{m.label}</Td>
                    <Td>{formatMoney(m.expected)}</Td>
                    <Td className="text-emerald-600 font-medium">{formatMoney(m.actual)}</Td>
                    <Td className="text-red-600">{m.discountLoss > 0 ? `-${formatMoney(m.discountLoss)}` : '—'}</Td>
                    <Td className="text-violet-600">{m.extras > 0 ? formatMoney(m.extras) : '—'}</Td>
                    <Td className="text-amber-600">{m.pending > 0 ? formatMoney(m.pending) : '—'}</Td>
                  </tr>
                ))}
                <tr className="font-semibold border-t-2">
                  <Td>Total</Td>
                  <Td>{formatMoney(data.totals.expected)}</Td>
                  <Td className="text-emerald-600">{formatMoney(data.totals.actual)}</Td>
                  <Td className="text-red-600">{data.totals.discountLoss > 0 ? `-${formatMoney(data.totals.discountLoss)}` : '—'}</Td>
                  <Td className="text-violet-600">{data.totals.extras > 0 ? formatMoney(data.totals.extras) : '—'}</Td>
                  <Td className="text-amber-600">{data.totals.pending > 0 ? formatMoney(data.totals.pending) : '—'}</Td>
                </tr>
              </tbody>
            </Table>
          </Card>

          {/* Per-unit breakdown */}
          <Card>
            <CardHeader title="By Unit" subtitle="Units with highest discount losses" />
            <Table>
              <thead>
                <tr><Th>Unit</Th><Th>Floor</Th><Th>Size</Th><Th>List Price</Th><Th>Expected</Th><Th>Actual</Th><Th>Discount Loss</Th></tr>
              </thead>
              <tbody>
                {data.byUnit.slice(0, 30).map(u => (
                  <tr key={u.unitNumber} className="hover:bg-muted/50">
                    <Td className="font-medium">{u.unitNumber}</Td>
                    <Td>{u.floor || '—'}</Td>
                    <Td>{u.sizeSqf ? `${u.sizeSqf} sq ft` : '—'}</Td>
                    <Td>{formatMoney(u.listPrice)}/mo</Td>
                    <Td>{formatMoney(u.expected)}</Td>
                    <Td className="text-emerald-600 font-medium">{formatMoney(u.actual)}</Td>
                    <Td className={u.discountLoss > 0 ? 'text-red-600 font-medium' : ''}>{u.discountLoss > 0 ? `-${formatMoney(u.discountLoss)}` : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border bg-white dark:bg-neutral-900 px-5 py-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl font-bold" style={{ color }}>{formatMoney(value)}</div>
    </div>
  )
}

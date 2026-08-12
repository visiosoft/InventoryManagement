import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { api } from '../../../lib/api'
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, Select, Spinner } from '../../../components/ui'
import { CHART_STYLE, StatCard } from './shared'

interface ClaimRow { _id: { year: number; month: number }; claimed: number; approved: number; settled: number; count: number }
interface ClaimStatus { _id: string; count: number; claimedAmount: number }
interface ClaimsData { rows: ClaimRow[]; byStatus: ClaimStatus[] }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const money = (n: number) => `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 0 })}`
const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'default'> = {
  reported: 'amber', under_review: 'amber', approved: 'default', rejected: 'red', settled: 'green',
}

export default function MovingClaimsReport() {
  const [months, setMonths] = useState('12')

  const { data, isLoading } = useQuery<ClaimsData>({
    queryKey: ['moving-report-claims', months],
    queryFn: () => api.get('/moving-reports/claims', { params: { months } }).then(r => r.data),
  })

  const rows = (data?.rows ?? []).map(r => ({ ...r, label: `${MONTHS[r._id.month - 1]} ${r._id.year}` }))
  const totalClaimed = rows.reduce((s, r) => s + r.claimed, 0)
  const totalSettled = rows.reduce((s, r) => s + r.settled, 0)
  const totalCount = rows.reduce((s, r) => s + r.count, 0)

  return (
    <div className="space-y-6">
      <PageHeader title="Damage Claims" subtitle="Claimed vs approved vs settled amounts, by month" />

      <Field label="Range" className="max-w-xs">
        <Select value={months} onChange={e => setMonths(e.target.value)}>
          <option value="3">Last 3 months</option>
          <option value="6">Last 6 months</option>
          <option value="12">Last 12 months</option>
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Claims filed" value={String(totalCount)} />
        <StatCard label="Total claimed" value={money(totalClaimed)} tone={totalClaimed > 0 ? 'amber' : 'default'} />
        <StatCard label="Total settled" value={money(totalSettled)} tone="green" />
      </div>

      <Card>
        <CardHeader title="Claims by month" />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No claims filed in this range" /> : (
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={CHART_STYLE.axisStyle} />
                  <YAxis tick={CHART_STYLE.axisStyle} />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle} formatter={(v) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="claimed" name="Claimed" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="approved" name="Approved" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="settled" name="Settled" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      {data && data.byStatus.length > 0 && (
        <Card>
          <CardHeader title="By status" />
          <CardBody>
            <div className="flex flex-wrap gap-3">
              {data.byStatus.map(s => (
                <Badge key={s._id} tone={STATUS_TONE[s._id] ?? 'default'} className="text-xs px-3 py-1.5">
                  {s._id.replace('_', ' ')}: {s.count} ({money(s.claimedAmount)})
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

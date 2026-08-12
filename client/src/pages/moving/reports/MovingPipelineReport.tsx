import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { api } from '../../../lib/api'
import { Card, CardBody, CardHeader, Field, PageHeader, Select, Spinner } from '../../../components/ui'
import { CHART_STYLE, PIE_COLORS, StatCard } from './shared'

interface PipelineData {
  funnel: Array<{ stage: string; count: number }>
  leadCounts: Record<string, number>
  quoteCounts: Record<string, number>
  winRate: number
  quoteConversionRate: number
  totalLeads: number
}

const STAGE_LABEL: Record<string, string> = {
  new: 'New', contacted: 'Contacted', quoted: 'Quoted', client_approved: 'Approved', won: 'Won',
}

export default function MovingPipelineReport() {
  const [months, setMonths] = useState('6')

  const { data, isLoading } = useQuery<PipelineData>({
    queryKey: ['moving-report-pipeline', months],
    queryFn: () => api.get('/moving-reports/pipeline', { params: { months } }).then(r => r.data),
  })

  const funnel = (data?.funnel ?? []).map(f => ({ ...f, label: STAGE_LABEL[f.stage] ?? f.stage }))
  const lost = data?.leadCounts?.lost ?? 0

  return (
    <div className="space-y-6">
      <PageHeader title="Sales Pipeline" subtitle="Lead funnel, win rate, and quote-to-job conversion" />

      <Field label="Range" className="max-w-xs">
        <Select value={months} onChange={e => setMonths(e.target.value)}>
          <option value="1">Last month</option>
          <option value="3">Last 3 months</option>
          <option value="6">Last 6 months</option>
          <option value="12">Last 12 months</option>
        </Select>
      </Field>

      {data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Leads" value={String(data.totalLeads)} />
          <StatCard label="Won" value={String(data.leadCounts.won ?? 0)} tone="green" />
          <StatCard label="Lost" value={String(lost)} tone={lost > 0 ? 'red' : 'default'} />
          <StatCard label="Win Rate" value={`${data.winRate}%`} tone={data.winRate >= 40 ? 'green' : data.winRate >= 20 ? 'amber' : 'red'} />
        </div>
      )}

      <Card>
        <CardHeader title="Lead funnel" subtitle="Leads created in this range, by furthest stage reached" />
        <CardBody>
          {isLoading ? <Spinner /> : (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnel} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={CHART_STYLE.axisStyle} allowDecimals={false} />
                  <YAxis type="category" dataKey="label" tick={CHART_STYLE.axisStyle} width={90} />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {funnel.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      {data && (
        <Card>
          <CardHeader title="Quote conversion" subtitle="Of the quotes sent in this range, how many were accepted" />
          <CardBody>
            <div className="flex items-center gap-6 flex-wrap">
              <StatCard label="Quote Acceptance Rate" value={`${data.quoteConversionRate}%`} tone={data.quoteConversionRate >= 40 ? 'green' : data.quoteConversionRate >= 20 ? 'amber' : 'red'} />
              {Object.entries(data.quoteCounts).map(([status, count]) => (
                <div key={status} className="text-sm">
                  <span className="text-muted-foreground capitalize">{status}: </span>
                  <span className="font-semibold">{count}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

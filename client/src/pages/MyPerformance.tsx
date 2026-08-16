import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, TrendingUp, UserPlus } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { PageHeader, Card, CardHeader, Spinner } from '../components/ui'
import { CHART_STYLE, StatCard } from './reports/shared'

interface PerformanceData {
  newLeadsTotal: number
  wonDealsTotal: number
  conversionRatePct: number
  monthly: { month: string; newLeads: number }[]
}

export default function MyPerformance() {
  const { data, isLoading } = useQuery<PerformanceData>({
    queryKey: ['my-performance'],
    queryFn: () => api.get('/sales-goals/me/performance').then((r) => r.data),
  })

  return (
    <div>
      <PageHeader title="My Performance" subtitle="Your leads, conversions, and monthly activity" />

      {isLoading ? <Spinner /> : data && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard label="New Leads" value={String(data.newLeadsTotal)} sub="assigned to you, all time" icon={UserPlus} />
            <StatCard label="Won Deals" value={String(data.wonDealsTotal)} sub="converted successfully" tone="green" icon={CheckCircle2} />
            <StatCard label="Conversion Rate" value={`${data.conversionRatePct}%`} sub="won / assigned" icon={TrendingUp} />
          </div>

          <Card>
            <CardHeader title="Monthly new leads" subtitle="Last 6 months" />
            <div style={{ height: 260 }} className="px-4 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle} />
                  <Bar dataKey="newLeads" name="New leads" fill="#5B2BC9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

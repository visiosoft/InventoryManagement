import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Award, CheckCircle2, TrendingUp, UserPlus } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, CardHeader, Spinner } from '../components/ui'
import { CHART_STYLE, StatCard } from './reports/shared'

interface PerformanceData {
  newLeadsTotal: number
  wonDealsTotal: number
  conversionRatePct: number
  monthly: { month: string; newLeads: number }[]
}

/** 1st, 2nd, 3rd — a placing reads as a word, not a number. */
function ordinal(n: number): string {
  const rest = n % 100
  if (rest >= 11 && rest <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** This month's board, only as much of it as this page shows. */
type BoardRow = { userId: string; position: number; closed: number; awards: string[] }
type Board = { label: string; rows: BoardRow[]; awardTypes: Record<string, { label: string; hint: string }> }

export default function MyPerformance() {
  const { user } = useAuth()
  const { data, isLoading } = useQuery<PerformanceData>({
    queryKey: ['my-performance'],
    queryFn: () => api.get('/sales-goals/me/performance').then((r) => r.data),
  })

  /* Where they stand, on their own page.
   *
   * Recognition that only exists on a page somebody has to think to open is
   * recognition most people never see. The board is still the board; this is
   * the one line of it that is about them. */
  const { data: board } = useQuery<Board>({
    queryKey: ['my-performance-standing'],
    queryFn: () => api.get('/leaderboard', { params: { period: 'month' } }).then((r) => r.data),
  })
  const standing = board?.rows.find((r) => r.userId === String(user?.id))

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

          {standing && (
            <Card>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span
                  className="inline-flex items-center justify-center shrink-0"
                  style={{
                    width: 38, height: 38, borderRadius: 999, fontWeight: 800, fontSize: 15,
                    background: standing.position <= 3 ? '#FFF7E6' : '#F3EDFF',
                    color: standing.position <= 3 ? '#B45309' : '#4A1FA0',
                  }}
                >
                  {standing.position}
                </span>
                <div className="min-w-0 flex-1">
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#14081F', margin: 0 }}>
                    {standing.position === 1 ? 'Top of the board' : `${ordinal(standing.position)} on the board`}
                    <span style={{ fontWeight: 500, color: '#756E80' }}>
                      {' · '}{board?.label ?? 'This month'}{' · '}{standing.closed} closed
                    </span>
                  </p>
                  {standing.awards.length > 0 && (
                    <span className="inline-flex flex-wrap items-center gap-1 mt-1">
                      {standing.awards.map((k) => (
                        <span
                          key={k}
                          title={board?.awardTypes?.[k]?.hint ?? k}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 whitespace-nowrap"
                          style={{ background: '#FFF7E6', border: '1px solid #F5DFB8', color: '#B45309', fontSize: 11, fontWeight: 700 }}
                        >
                          <Award size={11} /> {board?.awardTypes?.[k]?.label ?? k}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <Link to="/leaderboard" style={{ fontSize: 12, fontWeight: 700, color: '#5B2BC9' }}>See the board</Link>
              </div>
            </Card>
          )}

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

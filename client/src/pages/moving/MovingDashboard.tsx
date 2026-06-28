import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  ClipboardList, Truck, Wallet, TrendingUp, Calendar, Users,
  BarChart3, Plus, ArrowRight, Clock, AlertCircle,
} from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingJob } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, Spinner, Table, Td, Th } from '../../components/ui'
import { cn } from '../../lib/utils'

interface MovingSummary {
  totalJobs: number
  jobsThisMonth: number
  activeJobs: number
  totalRevenue: number
  revenueThisMonth: number
  upcomingJobs: MovingJob[]
}

interface RevenueRow {
  _id: { year: number; month: number }
  revenue: number
  count: number
}

interface JobsBreakdown {
  byStatus: Array<{ _id: string; count: number }>
  byType: Array<{ _id: string; count: number }>
}

const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  confirmed: '#60a5fa',
  survey_done: '#c084fc',
  in_progress: '#fbbf24',
  completed: '#34d399',
  invoiced: '#2dd4bf',
  cancelled: '#f87171',
}

const TYPE_LABELS: Record<string, string> = {
  local: 'Local',
  inter_emirate: 'Inter-Emirate',
  international: 'International',
  office: 'Office',
  storage_to_home: 'Storage→Home',
  other: 'Other',
}

const CHART_COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#c084fc', '#2dd4bf', '#f87171', '#fb923c']

const statusTone: Record<string, string> = {
  draft: 'gray', confirmed: 'blue', survey_done: 'purple',
  in_progress: 'yellow', completed: 'green', invoiced: 'teal', cancelled: 'red',
}

function getLast6Months() {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
    return { year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleDateString('en-US', { month: 'short' }) }
  })
}

function isToday(dateStr?: string) {
  if (!dateStr) return false
  const d = new Date(dateStr), t = new Date()
  return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear()
}

function fmtAed(n: number) {
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `AED ${(n / 1_000).toFixed(0)}K`
  return `AED ${n.toLocaleString()}`
}

const EMPTY: MovingSummary = {
  totalJobs: 0, jobsThisMonth: 0, activeJobs: 0, totalRevenue: 0, revenueThisMonth: 0, upcomingJobs: [],
}

function KPICard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub: string; icon: React.ElementType; color: 'blue' | 'amber' | 'green' | 'purple'
}) {
  const p = {
    blue:   { bg: 'bg-blue-500/10',    text: 'text-blue-600'    },
    amber:  { bg: 'bg-amber-500/10',   text: 'text-amber-600'   },
    green:  { bg: 'bg-emerald-500/10', text: 'text-emerald-600' },
    purple: { bg: 'bg-purple-500/10',  text: 'text-purple-600'  },
  }[color]
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardBody className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
            <p className="text-2xl font-bold text-foreground leading-none mb-1">{value}</p>
            <p className="text-xs text-muted-foreground truncate">{sub}</p>
          </div>
          <div className={cn('p-2.5 rounded-lg shrink-0', p.bg)}>
            <Icon size={20} className={p.text} />
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

const RevenueTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="font-semibold mb-1">{label}</p>
      <p className="text-muted-foreground">Revenue: <span className="text-foreground font-medium">AED {Number(payload[0]?.value ?? 0).toLocaleString()}</span></p>
      <p className="text-muted-foreground">Jobs: <span className="text-foreground font-medium">{payload[1]?.value ?? 0}</span></p>
    </div>
  )
}

export default function MovingDashboard() {
  const todayStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const { data: summary = EMPTY, isLoading } = useQuery<MovingSummary>({
    queryKey: ['moving-summary'],
    queryFn: () => api.get('/moving-reports/summary').then(r => r.data),
    retry: 1,
  })

  const { data: revenueRows = [] } = useQuery<RevenueRow[]>({
    queryKey: ['moving-revenue-chart'],
    queryFn: () => api.get('/moving-reports/revenue', { params: { months: 6 } }).then(r => r.data),
    retry: 1,
  })

  const { data: jobsBreakdown } = useQuery<JobsBreakdown>({
    queryKey: ['moving-jobs-breakdown'],
    queryFn: () => api.get('/moving-reports/jobs').then(r => r.data),
    retry: 1,
  })

  const revenueChart = getLast6Months().map(m => {
    const found = revenueRows.find(r => r._id.year === m.year && r._id.month === m.month)
    return { month: m.label, revenue: found?.revenue ?? 0, count: found?.count ?? 0 }
  })

  const statusPie = (jobsBreakdown?.byStatus ?? [])
    .filter(s => s._id && s.count > 0)
    .map(s => ({ name: s._id.replace(/_/g, ' '), value: s.count, color: STATUS_COLORS[s._id] ?? '#94a3b8' }))

  const typeBars = (jobsBreakdown?.byType ?? [])
    .filter(t => t._id)
    .sort((a, b) => b.count - a.count)
    .map((t, i) => ({ name: TYPE_LABELS[t._id] ?? t._id, count: t.count, fill: CHART_COLORS[i % CHART_COLORS.length] }))

  const todayJobs = summary.upcomingJobs.filter(j => isToday(j.scheduledDate))
  const nextJobs = summary.upcomingJobs.filter(j => !isToday(j.scheduledDate)).slice(0, 6)

  if (isLoading) return <div className="flex justify-center py-24"><Spinner /></div>

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Moving Operations</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{todayStr}</p>
        </div>
        <div className="flex gap-2">
          <Link to="/moving/dispatch">
            <Button variant="outline" size="sm" className="gap-1.5">
              <Truck size={14} /> Dispatch
            </Button>
          </Link>
          <Link to="/moving/jobs/new">
            <Button size="sm" className="gap-1.5">
              <Plus size={14} /> New Job
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Jobs This Month" value={String(summary.jobsThisMonth)} sub={`${summary.totalJobs} total all time`} icon={ClipboardList} color="blue" />
        <KPICard label="Active Jobs" value={String(summary.activeJobs)} sub="confirmed + in progress" icon={Truck} color="amber" />
        <KPICard label="Revenue This Month" value={fmtAed(summary.revenueThisMonth)} sub="from paid invoices" icon={TrendingUp} color="green" />
        <KPICard label="Total Revenue" value={fmtAed(summary.totalRevenue)} sub="all time, paid invoices" icon={Wallet} color="purple" />
      </div>

      {/* Charts Row 1: Revenue trend + Status donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue trend" subtitle="Last 6 months · paid invoices only" />
          <CardBody className="pt-0">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={revenueChart} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                  width={40}
                />
                <Tooltip content={<RevenueTooltip />} />
                <Area type="monotone" dataKey="revenue" stroke="#60a5fa" strokeWidth={2} fill="url(#revGrad)" dot={{ fill: '#60a5fa', r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="By status" subtitle="All jobs across stages" />
          <CardBody className="pt-0">
            {statusPie.length === 0 ? (
              <div className="h-[220px] flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <AlertCircle size={24} className="opacity-30" />
                No job data yet
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={statusPie} cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={2} dataKey="value">
                      {statusPie.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: number, name: string) => [v + ' jobs', name]} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 justify-center">
                  {statusPie.map(s => (
                    <div key={s.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                      {s.name} <span className="font-medium text-foreground">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Charts Row 2: Job type + Today's jobs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Jobs by type" subtitle="Distribution across move categories" />
          <CardBody className="pt-0">
            {typeBars.length === 0 ? (
              <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, typeBars.length * 36 + 32)}>
                <BarChart data={typeBars} layout="vertical" margin={{ left: 0, right: 24, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,0,0,0.06)" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={100} />
                  <Tooltip formatter={(v: number) => [v + ' jobs', 'Count']} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {typeBars.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Today's jobs"
            subtitle={todayJobs.length > 0 ? `${todayJobs.length} job${todayJobs.length !== 1 ? 's' : ''} scheduled` : 'No jobs today'}
            action={<Link to="/moving/dispatch" className="text-xs font-medium text-primary hover:underline flex items-center gap-1">Dispatch sheet <ArrowRight size={12} /></Link>}
          />
          <CardBody className="pt-0">
            {todayJobs.length === 0 ? (
              <div className="py-8 flex flex-col items-center gap-2 text-muted-foreground">
                <Clock size={28} className="opacity-25" />
                <p className="text-sm">No jobs scheduled for today</p>
              </div>
            ) : (
              <div className="space-y-2">
                {todayJobs.map(j => {
                  const trucks = (j.trucks ?? []) as Array<{ truck: { name: string } }>
                  return (
                    <Link key={j._id} to={`/moving/jobs/${j._id}`}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 hover:bg-muted transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-mono font-bold text-primary">{j.jobNo}</span>
                          <Badge tone={statusTone[j.status]} className="text-xs py-0 h-4">{j.status.replace(/_/g, ' ')}</Badge>
                        </div>
                        <p className="text-sm font-medium truncate">{j.customer?.fullName}</p>
                        <p className="text-xs text-muted-foreground">
                          {j.scheduledTimeSlot || ''}
                          {trucks[0]?.truck?.name && ` · ${trucks[0].truck.name}`}
                        </p>
                      </div>
                      <ArrowRight size={14} className="text-muted-foreground group-hover:text-foreground shrink-0 transition-colors" />
                    </Link>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          { label: 'Schedule', icon: Calendar, to: '/moving/schedule', variant: 'outline' },
          { label: 'Workers', icon: Users, to: '/moving/workers', variant: 'outline' },
          { label: 'Fleet', icon: Truck, to: '/moving/fleet', variant: 'outline' },
          { label: 'Reports', icon: BarChart3, to: '/moving/reports', variant: 'outline' },
        ] as const).map(({ label, icon: Icon, to, variant }) => (
          <Link key={to} to={to}>
            <Button className="w-full h-10 gap-2 text-sm" variant={variant as any}>
              <Icon size={15} />
              {label}
            </Button>
          </Link>
        ))}
      </div>

      {/* Upcoming jobs */}
      {nextJobs.length > 0 && (
        <Card>
          <CardHeader
            title="Upcoming jobs"
            subtitle={`Next ${nextJobs.length} scheduled`}
            action={<Link to="/moving/jobs" className="text-xs font-medium text-primary hover:underline flex items-center gap-1">All jobs <ArrowRight size={12} /></Link>}
          />
          <CardBody className="pt-0">
            {/* Mobile cards */}
            <div className="space-y-2 md:hidden">
              {nextJobs.map(j => (
                <Link key={j._id} to={`/moving/jobs/${j._id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/40 hover:bg-muted transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono font-bold text-primary">{j.jobNo}</span>
                      <Badge tone={statusTone[j.status]} className="text-xs py-0 h-4">{j.status.replace(/_/g, ' ')}</Badge>
                    </div>
                    <p className="text-sm font-medium truncate">{j.customer?.fullName}</p>
                    {j.scheduledDate && <p className="text-xs text-muted-foreground">{new Date(j.scheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</p>}
                  </div>
                  <ArrowRight size={14} className="text-muted-foreground shrink-0 ml-2" />
                </Link>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <thead>
                  <tr className="border-b border-muted">
                    <Th>Job No</Th>
                    <Th>Customer</Th>
                    <Th>Date</Th>
                    <Th>Time Slot</Th>
                    <Th>Truck</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {nextJobs.map(j => {
                    const trucks = (j.trucks ?? []) as Array<{ truck: { name: string } }>
                    return (
                      <tr key={j._id} className="hover:bg-muted/50 transition-colors">
                        <Td>
                          <Link to={`/moving/jobs/${j._id}`} className="font-mono font-semibold text-primary hover:text-primary/80 text-sm">
                            {j.jobNo}
                          </Link>
                        </Td>
                        <Td className="font-medium text-sm">{j.customer?.fullName}</Td>
                        <Td className="text-sm text-muted-foreground">
                          {j.scheduledDate ? new Date(j.scheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        </Td>
                        <Td className="text-sm text-muted-foreground">{j.scheduledTimeSlot || '—'}</Td>
                        <Td className="text-sm text-muted-foreground">{trucks[0]?.truck?.name || '—'}</Td>
                        <Td><Badge tone={statusTone[j.status]} className="text-xs">{j.status.replace(/_/g, ' ')}</Badge></Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          </CardBody>
        </Card>
      )}

      {summary.totalJobs === 0 && (
        <Card>
          <CardBody className="py-12 text-center">
            <ClipboardList size={36} className="mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-sm font-medium text-foreground mb-1">No jobs yet</p>
            <p className="text-sm text-muted-foreground mb-4">Create your first moving job to get started</p>
            <Link to="/moving/jobs/new">
              <Button><Plus size={15} className="mr-1.5" />Create First Job</Button>
            </Link>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

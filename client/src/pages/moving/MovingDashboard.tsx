import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ClipboardList, Truck, Wallet, TrendingUp, Calendar, Users, FileText, BarChart3, CheckCircle2, AlertCircle } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingJob } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner, Table, Td, Th } from '../../components/ui'

interface MovingSummary {
  totalJobs: number
  jobsThisMonth: number
  activeJobs: number
  totalRevenue: number
  revenueThisMonth: number
  upcomingJobs: MovingJob[]
}

const statusTone: Record<string, string> = {
  draft: 'gray', confirmed: 'blue', survey_done: 'purple',
  in_progress: 'yellow', completed: 'green', invoiced: 'teal', cancelled: 'red',
}

function KPI({
  label,
  value,
  icon: Icon,
  sub,
  variant = 'default'
}: {
  label: string
  value: string
  icon: React.ElementType
  sub?: string
  variant?: 'default' | 'success' | 'warning'
}) {
  const bgColors = {
    default: 'bg-primary/10',
    success: 'bg-emerald-500/10',
    warning: 'bg-amber-500/10',
  }
  const iconColors = {
    default: 'text-primary',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardBody className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
            <p className="text-3xl font-bold text-foreground mb-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className={`p-3 rounded-lg ${bgColors[variant]} shrink-0`}>
            <Icon size={24} className={iconColors[variant]} />
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

const EMPTY: MovingSummary = {
  totalJobs: 0, jobsThisMonth: 0, activeJobs: 0,
  totalRevenue: 0, revenueThisMonth: 0, upcomingJobs: [],
}

export default function MovingDashboard() {
  const { data, isLoading, isError } = useQuery<MovingSummary>({
    queryKey: ['moving-summary'],
    queryFn: () => api.get('/moving-reports/summary').then(r => r.data),
    retry: 1,
  })

  if (isLoading) return <div className="flex justify-center py-16"><Spinner /></div>
  if (isError) return (
    <div className="space-y-8">
      <PageHeader title="Moving Business Dashboard" subtitle="Complete overview of your moving operations" />
      <Card><CardBody><div className="py-8 text-center text-sm text-muted-foreground">Could not load dashboard data. The reports endpoint may not be available yet.</div></CardBody></Card>
    </div>
  )

  const s = data ?? EMPTY

  return (
    <div className="space-y-8">
      <PageHeader
        title="Moving Business Dashboard"
        subtitle="Complete overview of your moving operations"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPI
          label="Jobs This Month"
          value={String(s.jobsThisMonth)}
          icon={ClipboardList}
          sub={`${s.totalJobs} total jobs`}
          variant="default"
        />
        <KPI
          label="Active Jobs"
          value={String(s.activeJobs)}
          icon={Truck}
          sub="confirmed + in progress"
          variant="warning"
        />
        <KPI
          label="Monthly Revenue"
          value={`AED ${(s.revenueThisMonth / 1000).toFixed(0)}K`}
          icon={TrendingUp}
          sub={`AED ${s.totalRevenue.toLocaleString()} total`}
          variant="success"
        />
        <KPI
          label="Paid Invoices"
          value={`AED ${s.totalRevenue.toLocaleString()}`}
          icon={Wallet}
          sub="received payments"
          variant="success"
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Link to="/moving/jobs/new">
          <Button className="w-full h-12 text-sm font-medium" size="lg">
            <ClipboardList size={18} className="mr-2" />
            New Job
          </Button>
        </Link>
        <Link to="/moving/schedule">
          <Button className="w-full h-12 text-sm font-medium" variant="outline" size="lg">
            <Calendar size={18} className="mr-2" />
            Schedule
          </Button>
        </Link>
        <Link to="/moving/workers">
          <Button className="w-full h-12 text-sm font-medium" variant="outline" size="lg">
            <Users size={18} className="mr-2" />
            Crew
          </Button>
        </Link>
        <Link to="/moving/dispatch">
          <Button className="w-full h-12 text-sm font-medium" variant="outline" size="lg">
            <FileText size={18} className="mr-2" />
            Dispatch
          </Button>
        </Link>
      </div>

      {/* Upcoming Jobs */}
      <Card>
        <CardHeader
          title="Upcoming Jobs"
          subtitle={`Next ${Math.min(5, s.upcomingJobs?.length ?? 0)} scheduled jobs`}
          action={<Link to="/moving/jobs" className="text-xs font-medium text-primary hover:underline">View all jobs →</Link>}
        />
        <CardBody>
          {(s.upcomingJobs ?? []).length === 0 ? (
            <div className="py-12 text-center">
              <div className="flex justify-center mb-3">
                <div className="p-3 rounded-full bg-muted">
                  <AlertCircle size={24} className="text-muted-foreground" />
                </div>
              </div>
              <EmptyState message="No upcoming jobs scheduled" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr className="border-b-2 border-muted">
                    <Th>Job No</Th>
                    <Th>Customer</Th>
                    <Th>Scheduled Date</Th>
                    <Th>Assigned Truck</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {(s.upcomingJobs ?? []).slice(0, 5).map(j => {
                    const trucks = (j.trucks ?? []) as Array<{ truck: { name: string } }>
                    return (
                      <tr key={j._id} className="hover:bg-muted/50 transition-colors">
                        <Td>
                          <Link to={`/moving/jobs/${j._id}`} className="font-mono font-semibold text-primary hover:text-primary/80 text-sm">
                            {j.jobNo}
                          </Link>
                        </Td>
                        <Td className="font-medium text-sm">{j.customer?.fullName}</Td>
                        <Td className="text-sm">
                          {j.scheduledDate
                            ? new Date(j.scheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                            : <span className="text-muted-foreground">—</span>}
                        </Td>
                        <Td className="text-sm">{trucks[0]?.truck?.name || <span className="text-muted-foreground">—</span>}</Td>
                        <Td><Badge tone={statusTone[j.status]}>{j.status.replace(/_/g, ' ')}</Badge></Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Status Reference & Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Legend */}
        <Card>
          <CardHeader title="Job Status Reference" subtitle="Color coding for job stages" />
          <CardBody>
            <div className="grid grid-cols-2 gap-4">
              {Object.entries(statusTone).map(([status, tone]) => (
                <div key={status} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                  <Badge tone={tone} className="shrink-0 text-xs px-2 py-1">
                    {status.replace(/_/g, ' ')}
                  </Badge>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        {/* Quick Links */}
        <Card>
          <CardHeader title="Quick Navigation" subtitle="Access key sections" />
          <CardBody>
            <div className="space-y-2">
              <Link to="/moving/jobs" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors group">
                <span className="text-sm font-medium group-hover:text-primary">All Moving Jobs</span>
                <ClipboardList size={16} className="text-muted-foreground group-hover:text-primary" />
              </Link>
              <Link to="/moving/leads" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors group">
                <span className="text-sm font-medium group-hover:text-primary">Moving Leads</span>
                <Users size={16} className="text-muted-foreground group-hover:text-primary" />
              </Link>
              <Link to="/moving/quotes" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors group">
                <span className="text-sm font-medium group-hover:text-primary">Quotes</span>
                <FileText size={16} className="text-muted-foreground group-hover:text-primary" />
              </Link>
              <Link to="/moving/invoices" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors group">
                <span className="text-sm font-medium group-hover:text-primary">Invoices</span>
                <Wallet size={16} className="text-muted-foreground group-hover:text-primary" />
              </Link>
              <Link to="/moving/fleet" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors group">
                <span className="text-sm font-medium group-hover:text-primary">Fleet Management</span>
                <Truck size={16} className="text-muted-foreground group-hover:text-primary" />
              </Link>
              <Link to="/moving/reports" className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors group">
                <span className="text-sm font-medium group-hover:text-primary">Reports & Analytics</span>
                <BarChart3 size={16} className="text-muted-foreground group-hover:text-primary" />
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

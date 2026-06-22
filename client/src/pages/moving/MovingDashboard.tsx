import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ClipboardList, Truck, Wallet, TrendingUp, Calendar, Users, FileText } from 'lucide-react'
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

function KPI({ label, value, icon: Icon, sub }: { label: string; value: string; icon: React.ElementType; sub?: string }) {
  return (
    <Card>
      <CardBody className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-3xl font-bold mt-2.5 truncate">{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground mt-2">{sub}</p>}
          </div>
          <div className="p-3 rounded-lg bg-primary/10 shrink-0">
            <Icon size={20} className="text-primary" />
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

export default function MovingDashboard() {
  const { data, isLoading } = useQuery<MovingSummary>({
    queryKey: ['moving-summary'],
    queryFn: () => api.get('/moving-reports/summary').then(r => r.data),
  })

  if (isLoading) return <div className="flex justify-center py-16"><Spinner /></div>

  const s = data!

  return (
    <div className="space-y-8">
      <PageHeader title="Moving Business" subtitle="Dashboard & overview" />

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-5">
        <KPI
          label="Jobs This Month"
          value={String(s.jobsThisMonth)}
          icon={ClipboardList}
          sub={`${s.totalJobs} total`}
        />
        <KPI
          label="Active Jobs"
          value={String(s.activeJobs)}
          icon={Truck}
          sub="confirmed + in progress"
        />
        <KPI
          label="Revenue (Month)"
          value={`AED ${(s.revenueThisMonth / 1000).toFixed(0)}K`}
          icon={TrendingUp}
          sub={`AED ${s.totalRevenue.toLocaleString()} total`}
        />
        <KPI
          label="Balance"
          value={`AED ${s.totalRevenue.toLocaleString()}`}
          icon={Wallet}
          sub="paid invoices"
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-4 gap-4">
        <Link to="/moving/jobs/new">
          <Button className="w-full h-11 text-sm font-medium" variant="outline">
            <ClipboardList size={16} className="mr-2" />
            New Job
          </Button>
        </Link>
        <Link to="/moving/schedule">
          <Button className="w-full h-11 text-sm font-medium" variant="outline">
            <Calendar size={16} className="mr-2" />
            Calendar
          </Button>
        </Link>
        <Link to="/moving/workers">
          <Button className="w-full h-11 text-sm font-medium" variant="outline">
            <Users size={16} className="mr-2" />
            Crew
          </Button>
        </Link>
        <Link to="/moving/dispatch">
          <Button className="w-full h-11 text-sm font-medium" variant="outline">
            <FileText size={16} className="mr-2" />
            Dispatch
          </Button>
        </Link>
      </div>

      {/* Upcoming Jobs */}
      <Card>
        <CardHeader
          title="Upcoming Jobs"
          action={<Link to="/moving/jobs" className="text-xs text-primary hover:underline font-medium">View all →</Link>}
        />
        <CardBody>
          {(s.upcomingJobs ?? []).length === 0 ? (
            <div className="p-6">
              <EmptyState message="No upcoming jobs scheduled" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Job No</Th>
                    <Th>Customer</Th>
                    <Th>Scheduled</Th>
                    <Th>Truck</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {(s.upcomingJobs ?? []).slice(0, 5).map(j => {
                    const trucks = (j.trucks ?? []) as Array<{ truck: { name: string } }>
                    return (
                      <tr key={j._id} className="hover:bg-muted/30">
                        <Td>
                          <Link to={`/moving/jobs/${j._id}`} className="font-mono text-primary hover:underline text-sm">
                            {j.jobNo}
                          </Link>
                        </Td>
                        <Td className="font-medium">{j.customer?.fullName}</Td>
                        <Td className="text-sm">
                          {j.scheduledDate
                            ? new Date(j.scheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                            : '—'}
                        </Td>
                        <Td className="text-sm">{trucks[0]?.truck?.name || '—'}</Td>
                        <Td><Badge tone={statusTone[j.status]}>{j.status.replace('_', ' ')}</Badge></Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Status Legend */}
      <Card>
        <CardHeader title="Job Status Colors" />
        <CardBody className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
            {Object.entries(statusTone).map(([status, tone]) => (
              <div key={status} className="flex items-center gap-2">
                <Badge tone={tone} className="shrink-0">{status.replace('_', ' ')}</Badge>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

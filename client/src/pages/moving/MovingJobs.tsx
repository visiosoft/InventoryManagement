import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Search, ArrowRight, MapPin } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingJob, MovingJobStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, Input, PageHeader, Select, Spinner, Table, Td, Th } from '../../components/ui'
import { cn } from '../../lib/utils'

interface JobsBreakdown {
  byStatus: Array<{ _id: string; count: number }>
}

const STATUSES: { value: MovingJobStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'survey_done', label: 'Survey Done' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'cancelled', label: 'Cancelled' },
]

const statusTone: Record<MovingJobStatus, string> = {
  draft: 'gray', confirmed: 'blue', survey_done: 'purple',
  in_progress: 'yellow', completed: 'green', invoiced: 'teal', cancelled: 'red',
}

const statusDot: Record<string, string> = {
  draft: 'bg-slate-400', confirmed: 'bg-blue-400', survey_done: 'bg-purple-400',
  in_progress: 'bg-amber-400', completed: 'bg-emerald-400', invoiced: 'bg-teal-400', cancelled: 'bg-red-400',
}

function fmtDate(s?: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function truncate(s?: string, max = 32) {
  if (!s) return '—'
  return s.length > max ? s.slice(0, max) + '…' : s
}

export default function MovingJobs() {
  const [status, setStatus] = useState<MovingJobStatus | ''>('')
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery<{ jobs: MovingJob[]; total: number }>({
    queryKey: ['moving-jobs', status],
    queryFn: () => api.get('/moving-jobs', { params: { status: status || undefined, limit: 200 } }).then(r => r.data),
  })

  const { data: breakdown } = useQuery<JobsBreakdown>({
    queryKey: ['moving-jobs-breakdown'],
    queryFn: () => api.get('/moving-reports/jobs').then(r => r.data),
    retry: 1,
  })

  const counts = Object.fromEntries((breakdown?.byStatus ?? []).map(s => [s._id, s.count]))
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0)

  const jobs = data?.jobs ?? []
  const filtered = jobs.filter(j =>
    !search ||
    j.jobNo.toLowerCase().includes(search.toLowerCase()) ||
    j.customer?.fullName?.toLowerCase().includes(search.toLowerCase()) ||
    (j.pickupAddress ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Moving Jobs"
        subtitle={`${data?.total ?? 0} jobs`}
        action={
          <Link to="/moving/jobs/new">
            <Button size="sm" className="gap-1.5"><Plus size={14} />New Job</Button>
          </Link>
        }
      />

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {STATUSES.map(s => {
          const count = s.value === '' ? allCount : (counts[s.value] ?? 0)
          const active = status === s.value
          return (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-muted hover:border-muted-foreground hover:text-foreground'
              )}
            >
              {s.value && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDot[s.value])} />}
              {s.label}
              <span className={cn('text-xs tabular-nums', active ? 'opacity-70' : 'text-muted-foreground')}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by job number, customer, or address…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody className="py-14 text-center">
            <p className="text-sm font-medium text-foreground mb-1">No jobs found</p>
            <p className="text-sm text-muted-foreground">
              {search ? 'Try a different search term' : 'No jobs match the selected filter'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="space-y-2 md:hidden">
            {filtered.map(j => (
              <Link key={j._id} to={`/moving/jobs/${j._id}`}
                className="flex items-start gap-3 p-4 bg-card rounded-xl border hover:border-muted-foreground transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-primary">{j.jobNo}</span>
                    <Badge tone={statusTone[j.status]} className="text-xs py-0 h-4">{j.status.replace(/_/g, ' ')}</Badge>
                  </div>
                  <p className="text-sm font-semibold text-foreground mb-1">{j.customer?.fullName}</p>
                  {j.scheduledDate && (
                    <p className="text-xs text-muted-foreground mb-1">{fmtDate(j.scheduledDate)}</p>
                  )}
                  {(j.pickupAddress || j.deliveryAddress) && (
                    <div className="flex items-start gap-1 text-xs text-muted-foreground">
                      <MapPin size={11} className="shrink-0 mt-0.5" />
                      <span className="truncate">{truncate(j.pickupAddress, 28)} → {truncate(j.deliveryAddress, 28)}</span>
                    </div>
                  )}
                </div>
                <ArrowRight size={14} className="text-muted-foreground shrink-0 mt-0.5" />
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <Card className="hidden md:block">
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr className="border-b border-muted">
                      <Th className="py-3 pl-4">Job No</Th>
                      <Th className="py-3">Customer</Th>
                      <Th className="py-3">Date</Th>
                      <Th className="py-3">Pickup</Th>
                      <Th className="py-3">Delivery</Th>
                      <Th className="py-3">Status</Th>
                      <Th className="py-3 pr-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(j => (
                      <tr key={j._id} className="hover:bg-muted/40 transition-colors border-b border-muted/50 last:border-0">
                        <Td className="py-3 pl-4">
                          <Link to={`/moving/jobs/${j._id}`} className="font-mono font-bold text-primary hover:text-primary/80 text-sm">
                            {j.jobNo}
                          </Link>
                        </Td>
                        <Td className="py-3 font-medium text-sm">{j.customer?.fullName}</Td>
                        <Td className="py-3 text-sm text-muted-foreground whitespace-nowrap">{fmtDate(j.scheduledDate)}</Td>
                        <Td className="py-3 text-sm text-muted-foreground max-w-[180px] truncate">{j.pickupAddress || '—'}</Td>
                        <Td className="py-3 text-sm text-muted-foreground max-w-[180px] truncate">{j.deliveryAddress || '—'}</Td>
                        <Td className="py-3">
                          <Badge tone={statusTone[j.status]} className="text-xs">{j.status.replace(/_/g, ' ')}</Badge>
                        </Td>
                        <Td className="py-3 pr-4 text-right">
                          <Link to={`/moving/jobs/${j._id}`} className="text-muted-foreground hover:text-foreground transition-colors">
                            <ArrowRight size={14} />
                          </Link>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </CardBody>
          </Card>

          <p className="text-xs text-muted-foreground text-right">{filtered.length} job{filtered.length !== 1 ? 's' : ''}</p>
        </>
      )}
    </div>
  )
}

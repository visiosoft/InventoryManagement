import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, ClipboardList, Search } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingJob, MovingJobStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Select, Spinner, Table, Td, Th, Input } from '../../components/ui'

const STATUSES: { value: MovingJobStatus | ''; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'survey_done', label: 'Survey Done' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'cancelled', label: 'Cancelled' },
]

const statusTone: Record<MovingJobStatus, string> = {
  draft: 'gray',
  confirmed: 'blue',
  survey_done: 'purple',
  in_progress: 'yellow',
  completed: 'green',
  invoiced: 'teal',
  cancelled: 'red',
}

export default function MovingJobs() {
  const [status, setStatus] = useState<MovingJobStatus | ''>('')
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery<{ jobs: MovingJob[]; total: number }>({
    queryKey: ['moving-jobs', status],
    queryFn: () => api.get('/moving-jobs', { params: { status: status || undefined, limit: 200 } }).then(r => r.data),
  })

  const jobs = data?.jobs ?? []
  const filteredJobs = jobs.filter(j =>
    search === '' ||
    j.jobNo.toLowerCase().includes(search.toLowerCase()) ||
    j.customer?.fullName?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-8">
      <PageHeader
        title="Moving Jobs"
        subtitle={`${data?.total ?? 0} jobs in the system`}
        action={
          <Link to="/moving/jobs/new">
            <Button><Plus size={16} className="mr-2" />New Job</Button>
          </Link>
        }
      />

      {/* Search and Filter Section */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by job number or customer name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={status}
              onChange={e => setStatus(e.target.value as MovingJobStatus | '')}
              className="w-48"
            >
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </div>
        </CardBody>
      </Card>

      {/* Jobs Table */}
      <Card>
        <CardBody>
          {isLoading ? (
            <Spinner />
          ) : filteredJobs.length === 0 ? (
            <div className="py-12">
              <div className="flex justify-center mb-3">
                <div className="p-3 rounded-full bg-muted">
                  <ClipboardList size={24} className="text-muted-foreground" />
                </div>
              </div>
              <EmptyState message={search ? "No jobs match your search" : "No jobs found"} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr className="border-b-2 border-muted">
                    <Th className="py-3">Job No</Th>
                    <Th className="py-3">Customer</Th>
                    <Th className="py-3">Scheduled Date</Th>
                    <Th className="py-3">Pickup Location</Th>
                    <Th className="py-3">Delivery Location</Th>
                    <Th className="py-3">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map(j => (
                    <tr key={j._id} className="hover:bg-muted/50 transition-colors cursor-pointer">
                      <Td className="py-3">
                        <Link to={`/moving/jobs/${j._id}`} className="font-mono font-semibold text-primary hover:text-primary/80 transition-colors">
                          {j.jobNo}
                        </Link>
                      </Td>
                      <Td className="py-3 font-medium text-foreground">{j.customer?.fullName}</Td>
                      <Td className="py-3 text-sm">
                        {j.scheduledDate
                          ? new Date(j.scheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                          : <span className="text-muted-foreground">—</span>}
                      </Td>
                      <Td className="py-3 max-w-[200px] truncate text-sm text-muted-foreground">{j.pickupAddress || '—'}</Td>
                      <Td className="py-3 max-w-[200px] truncate text-sm text-muted-foreground">{j.deliveryAddress || '—'}</Td>
                      <Td className="py-3">
                        <Badge tone={statusTone[j.status]}>{j.status.replace(/_/g, ' ')}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Status Reference */}
      <Card>
        <CardHeader title="Job Status Reference" subtitle="Understanding the job lifecycle" />
        <CardBody>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Object.entries(statusTone).map(([st, tone]) => (
              <div key={st} className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Badge tone={tone} className="shrink-0">{st.replace(/_/g, ' ')}</Badge>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

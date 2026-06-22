import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingJob, MovingJobStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Select, Spinner, Table, Td, Th } from '../../components/ui'

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

  const { data, isLoading } = useQuery<{ jobs: MovingJob[]; total: number }>({
    queryKey: ['moving-jobs', status],
    queryFn: () => api.get('/moving-jobs', { params: { status: status || undefined, limit: 200 } }).then(r => r.data),
  })

  const jobs = data?.jobs ?? []

  return (
    <div className="space-y-8">
      <PageHeader
        title="Moving Jobs"
        subtitle={`${data?.total ?? 0} jobs`}
        action={
          <Link to="/moving/jobs/new">
            <Button><Plus size={15} className="mr-1" />New Job</Button>
          </Link>
        }
      />

      {/* Status Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(statusTone).map(([st, tone]) => (
          <div key={st} className="flex items-center gap-2 text-xs">
            <Badge tone={tone}>{st.replace('_', ' ')}</Badge>
            <span className="text-muted-foreground">= {st.replace('_', ' ')}</span>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader title="Jobs" action={<Select value={status} onChange={e => setStatus(e.target.value as MovingJobStatus | '')}>{STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>} />
        <CardBody>
          {isLoading ? <Spinner /> : jobs.length === 0 ? <EmptyState message="No jobs found" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>Job No</Th>
                  <Th>Customer</Th>
                  <Th>Scheduled</Th>
                  <Th>Pickup</Th>
                  <Th>Delivery</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j._id} className="hover:bg-muted/30">
                    <Td>
                      <Link to={`/moving/jobs/${j._id}`} className="font-mono text-primary hover:underline">
                        {j.jobNo}
                      </Link>
                    </Td>
                    <Td className="font-medium">{j.customer?.fullName}</Td>
                    <Td>
                      {j.scheduledDate
                        ? new Date(j.scheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—'}
                    </Td>
                    <Td className="max-w-[180px] truncate text-sm text-muted-foreground">{j.pickupAddress || '—'}</Td>
                    <Td className="max-w-[180px] truncate text-sm text-muted-foreground">{j.deliveryAddress || '—'}</Td>
                    <Td>
                      <Badge tone={statusTone[j.status]}>{j.status.replace('_', ' ')}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

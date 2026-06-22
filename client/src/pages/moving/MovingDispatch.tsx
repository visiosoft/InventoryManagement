import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingJob } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, PageHeader, Spinner } from '../../components/ui'

export default function MovingDispatch() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  const from = new Date(date)
  from.setHours(0, 0, 0, 0)
  const to = new Date(date)
  to.setHours(23, 59, 59, 999)

  const { data: jobs = [], isLoading } = useQuery<MovingJob[]>({
    queryKey: ['moving-dispatch', date],
    queryFn: () => api.get('/moving-jobs/schedule', {
      params: { from: from.toISOString(), to: to.toISOString() },
    }).then(r => r.data),
  })

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  })

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <PageHeader title="Dispatch" subtitle={dateLabel} />
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="h-9 rounded-lg border bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          />
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer size={14} className="mr-1" />Print
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : jobs.length === 0 ? (
        <Card><CardBody><EmptyState message="No jobs scheduled for this date" /></CardBody></Card>
      ) : (
        <div className="space-y-4 print:space-y-8">
          {jobs.map((job, i) => {
            const crew = (job.crew ?? []) as Array<{ worker: { name: string; role: string; phone?: string }; role?: string }>
            const trucks = (job.trucks ?? []) as Array<{ truck: { name: string; plateNumber?: string } }>

            return (
              <Card key={job._id} className="print:break-inside-avoid">
                <CardHeader
                  title={
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground font-normal">#{i + 1}</span>
                      <Link to={`/moving/jobs/${job._id}`} className="hover:underline print:no-underline">
                        {job.jobNo}
                      </Link>
                      <Badge tone="blue">{job.status.replace('_', ' ')}</Badge>
                    </div>
                  }
                  subtitle={job.customer?.fullName}
                />
                <CardBody>
                  <div className="grid grid-cols-3 gap-6 text-sm">
                    {/* Addresses */}
                    <div className="col-span-1 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Pickup</p>
                        <p className="leading-snug">{job.pickupAddress || '—'}</p>
                        {job.pickupFloor && <p className="text-muted-foreground text-xs">Floor: {job.pickupFloor}</p>}
                        {job.pickupHasElevator && <p className="text-muted-foreground text-xs">Elevator ✓</p>}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Delivery</p>
                        <p className="leading-snug">{job.deliveryAddress || '—'}</p>
                        {job.deliveryFloor && <p className="text-muted-foreground text-xs">Floor: {job.deliveryFloor}</p>}
                        {job.deliveryHasElevator && <p className="text-muted-foreground text-xs">Elevator ✓</p>}
                      </div>
                    </div>

                    {/* Crew */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Crew ({crew.length})</p>
                      {crew.length === 0 ? (
                        <p className="text-muted-foreground">No crew assigned</p>
                      ) : (
                        <ul className="space-y-1">
                          {crew.map((c, ci) => (
                            <li key={ci}>
                              <span className="font-medium">{c.worker.name}</span>
                              <span className="text-muted-foreground ml-1 capitalize">({c.role || c.worker.role})</span>
                              {c.worker.phone && <span className="text-muted-foreground ml-1">· {c.worker.phone}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Trucks + Times */}
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Trucks ({trucks.length})</p>
                        {trucks.length === 0 ? (
                          <p className="text-muted-foreground">No trucks assigned</p>
                        ) : (
                          <ul className="space-y-1">
                            {trucks.map((t, ti) => (
                              <li key={ti}>
                                <span className="font-medium">{t.truck.name}</span>
                                {t.truck.plateNumber && <span className="text-muted-foreground ml-1">({t.truck.plateNumber})</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Time Slot</p>
                        <p>{job.scheduledTimeSlot || '—'}</p>
                        {job.estimatedDurationHours && (
                          <p className="text-muted-foreground text-xs">{job.estimatedDurationHours}h estimated</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {job.dispatchNotes && (
                    <div className="mt-3 pt-3 border-t text-sm">
                      <span className="font-medium text-muted-foreground">Dispatch Notes: </span>
                      {job.dispatchNotes}
                    </div>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

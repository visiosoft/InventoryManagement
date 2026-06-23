import { useQuery } from '@tanstack/react-query'
import { MapPin, Users, Truck, Clock } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingJob } from '../../lib/types'
import { Spinner } from '../../components/ui'

const statusTone: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  survey_done: 'bg-purple-100 text-purple-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  invoiced: 'bg-teal-100 text-teal-700',
  cancelled: 'bg-red-100 text-red-700',
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export default function FieldDispatch() {
  const today = todayIso()

  const { data: jobs = [], isLoading } = useQuery<MovingJob[]>({
    queryKey: ['field-jobs-today'],
    queryFn: () => api.get('/moving-jobs/schedule', { params: { from: today, to: today } }).then(r => r.data),
  })

  if (isLoading) return <div className="flex justify-center pt-16"><Spinner /></div>

  const activeJobs = jobs.filter(j => j.status !== 'cancelled')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-foreground">Dispatch</h1>
        <p className="text-sm text-muted-foreground">Today's crew and truck assignments</p>
      </div>

      {activeJobs.length === 0 ? (
        <div className="text-center pt-20 space-y-2">
          <p className="text-4xl">🚛</p>
          <p className="font-semibold text-lg text-foreground">No active jobs today</p>
        </div>
      ) : (
        <div className="space-y-4">
          {activeJobs.map(job => {
            const crew = (job.crew ?? []) as Array<{ worker: { name: string; role: string }; role?: string }>
            const trucks = (job.trucks ?? []) as Array<{ truck: { name: string; plateNumber?: string; type: string }; notes?: string }>

            return (
              <div key={job._id} className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
                {/* Header */}
                <div className="p-4 border-b border-border">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="font-bold text-base text-foreground">{job.jobNo}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusTone[job.status] ?? 'bg-gray-100 text-gray-700'}`}>
                          {job.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-foreground">{job.customer?.fullName}</p>
                    </div>
                    {job.scheduledTimeSlot && (
                      <div className="flex items-center gap-1 text-primary shrink-0">
                        <Clock size={14} />
                        <span className="text-sm font-semibold">{job.scheduledTimeSlot}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-3 text-sm">
                  {/* Addresses */}
                  <div className="space-y-1.5">
                    <div className="flex items-start gap-2">
                      <MapPin size={15} className="text-green-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium text-xs text-muted-foreground block">Pickup</span>
                        <span className="text-foreground">{job.pickupAddress || '—'}</span>
                        {job.pickupFloor && <span className="text-muted-foreground text-xs"> • Floor {job.pickupFloor}</span>}
                        {job.pickupHasElevator && <span className="text-muted-foreground text-xs"> • Elevator</span>}
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin size={15} className="text-red-500 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium text-xs text-muted-foreground block">Delivery</span>
                        <span className="text-foreground">{job.deliveryAddress || '—'}</span>
                        {job.deliveryFloor && <span className="text-muted-foreground text-xs"> • Floor {job.deliveryFloor}</span>}
                        {job.deliveryHasElevator && <span className="text-muted-foreground text-xs"> • Elevator</span>}
                      </div>
                    </div>
                  </div>

                  {/* Crew */}
                  {crew.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Users size={15} className="text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium text-xs text-muted-foreground block">Crew</span>
                        <div className="flex flex-wrap gap-1.5 mt-0.5">
                          {crew.map((c, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-full bg-muted text-xs font-medium text-foreground">
                              {c.worker?.name} {c.role ? `(${c.role})` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Trucks */}
                  {trucks.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Truck size={15} className="text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium text-xs text-muted-foreground block">Trucks</span>
                        <div className="flex flex-wrap gap-1.5 mt-0.5">
                          {trucks.map((t, i) => (
                            <span key={i} className="px-2 py-0.5 rounded-full bg-muted text-xs font-medium text-foreground">
                              {t.truck?.name} {t.truck?.plateNumber ? `(${t.truck.plateNumber})` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Dispatch notes */}
                  {job.dispatchNotes && (
                    <div className="p-3 rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-900">
                      <p className="font-semibold text-xs mb-0.5">Dispatcher Notes</p>
                      <p className="text-sm">{job.dispatchNotes}</p>
                    </div>
                  )}

                  {/* Duration */}
                  {job.estimatedDurationHours ? (
                    <p className="text-xs text-muted-foreground">
                      Estimated duration: <span className="font-medium text-foreground">{job.estimatedDurationHours}h</span>
                    </p>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

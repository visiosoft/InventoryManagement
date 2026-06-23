import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, MapPin, Users } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob, MovingJobStatus } from '../../lib/types'
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

export default function FieldJobs() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const today = todayIso()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [err, setErr] = useState<Record<string, string>>({})

  const { data: jobs = [], isLoading } = useQuery<MovingJob[]>({
    queryKey: ['field-jobs-today'],
    queryFn: () => api.get('/moving-jobs/schedule', { params: { from: today, to: today } }).then(r => r.data),
  })

  const statusMut = useMutation({
    mutationFn: ({ jobId, status }: { jobId: string; status: MovingJobStatus }) =>
      api.patch(`/moving-jobs/${jobId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['field-jobs-today'] })
    },
    onError: (e, vars) => {
      setErr(prev => ({ ...prev, [vars.jobId]: apiError(e) }))
    },
  })

  if (isLoading) return <div className="flex justify-center pt-16"><Spinner /></div>

  if (jobs.length === 0) {
    return (
      <div className="text-center pt-20 space-y-2">
        <p className="text-4xl">📦</p>
        <p className="font-semibold text-lg text-foreground">No jobs today</p>
        <p className="text-sm text-muted-foreground">Check back later or ask your dispatcher.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Today's Jobs</h1>
        <p className="text-sm text-muted-foreground">{jobs.length} job{jobs.length !== 1 ? 's' : ''} scheduled</p>
      </div>

      {jobs.map(job => {
        const isOpen = expanded === job._id
        const canStart = job.status === 'confirmed' || job.status === 'survey_done'
        const canComplete = job.status === 'in_progress'

        return (
          <div key={job._id} className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            {/* Card header */}
            <button
              className="w-full text-left p-4"
              onClick={() => setExpanded(isOpen ? null : job._id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-base text-foreground">{job.jobNo}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusTone[job.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {job.status.replace(/_/g, ' ')}
                    </span>
                    {job.scheduledTimeSlot && (
                      <span className="text-xs font-semibold text-primary">{job.scheduledTimeSlot}</span>
                    )}
                  </div>
                  <p className="font-medium text-foreground truncate">{job.customer?.fullName}</p>
                  <p className="text-sm text-muted-foreground truncate">{job.customer?.phone || '—'}</p>
                </div>
                <div className="shrink-0 text-muted-foreground mt-1">
                  {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </div>
              </div>
            </button>

            {/* Expanded details */}
            {isOpen && (
              <div className="border-t border-border px-4 pb-4 space-y-4">
                {err[job._id] && (
                  <div className="mt-3 p-2 rounded-lg bg-red-50 text-sm text-red-700">{err[job._id]}</div>
                )}

                <div className="mt-3 space-y-2.5 text-sm">
                  <div className="flex items-start gap-2">
                    <MapPin size={16} className="text-green-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground font-medium">Pickup</p>
                      <p className="text-foreground">{job.pickupAddress || '—'}</p>
                      {(job.pickupFloor || job.pickupHasElevator) && (
                        <p className="text-xs text-muted-foreground">
                          {job.pickupFloor && `Floor: ${job.pickupFloor}`}
                          {job.pickupHasElevator && ' • Elevator'}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <MapPin size={16} className="text-red-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground font-medium">Delivery</p>
                      <p className="text-foreground">{job.deliveryAddress || '—'}</p>
                      {(job.deliveryFloor || job.deliveryHasElevator) && (
                        <p className="text-xs text-muted-foreground">
                          {job.deliveryFloor && `Floor: ${job.deliveryFloor}`}
                          {job.deliveryHasElevator && ' • Elevator'}
                        </p>
                      )}
                    </div>
                  </div>

                  {job.crew && job.crew.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Users size={16} className="text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground font-medium">Crew</p>
                        <p className="text-foreground">
                          {(job.crew as any[]).map((c: any) => c.worker?.name || '').filter(Boolean).join(', ') || '—'}
                        </p>
                      </div>
                    </div>
                  )}

                  {job.dispatchNotes && (
                    <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-sm text-yellow-900">
                      <p className="font-semibold text-xs mb-0.5">Dispatch Notes</p>
                      {job.dispatchNotes}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-wrap">
                  {canStart && (
                    <button
                      onClick={() => statusMut.mutate({ jobId: job._id, status: 'in_progress' })}
                      disabled={statusMut.isPending}
                      className="flex-1 h-11 rounded-xl bg-yellow-500 text-white font-semibold text-sm hover:bg-yellow-600 disabled:opacity-60 transition-colors"
                    >
                      Start Job
                    </button>
                  )}
                  {canComplete && (
                    <button
                      onClick={() => statusMut.mutate({ jobId: job._id, status: 'completed' })}
                      disabled={statusMut.isPending}
                      className="flex-1 h-11 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-700 disabled:opacity-60 transition-colors"
                    >
                      Complete Job
                    </button>
                  )}
                  <button
                    onClick={() => navigate(`/moving/jobs/${job._id}/survey`)}
                    className="h-11 px-4 rounded-xl border border-border bg-muted text-foreground font-medium text-sm hover:bg-muted/70 transition-colors"
                  >
                    Survey
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

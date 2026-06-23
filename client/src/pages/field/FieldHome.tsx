import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Briefcase, ClipboardList, Truck } from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { MovingJob } from '../../lib/types'

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

export default function FieldHome() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const today = todayIso()

  const { data: jobs = [], isLoading } = useQuery<MovingJob[]>({
    queryKey: ['field-jobs-today'],
    queryFn: () =>
      api.get('/moving-jobs/schedule', { params: { from: today, to: today } }).then(r => r.data),
  })

  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Hi, {user?.name?.split(' ')[0] || 'there'}!
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{dateLabel}</p>
      </div>

      {/* Today's job count */}
      <div className="rounded-2xl bg-primary/10 border border-primary/20 p-5">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-primary/20 flex items-center justify-center">
            <Briefcase size={28} className="text-primary" />
          </div>
          <div>
            <p className="text-3xl font-bold text-foreground">{isLoading ? '…' : jobs.length}</p>
            <p className="text-sm text-muted-foreground">job{jobs.length !== 1 ? 's' : ''} scheduled today</p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Actions</p>
        <div className="grid grid-cols-1 gap-3">
          <button
            onClick={() => navigate('/field/jobs')}
            className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors text-left"
          >
            <div className="w-11 h-11 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
              <Briefcase size={22} />
            </div>
            <div>
              <p className="font-semibold text-base text-foreground">My Jobs Today</p>
              <p className="text-sm text-muted-foreground">View and manage today's moving jobs</p>
            </div>
          </button>

          <button
            onClick={() => navigate('/field/survey')}
            className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors text-left"
          >
            <div className="w-11 h-11 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
              <ClipboardList size={22} />
            </div>
            <div>
              <p className="font-semibold text-base text-foreground">Survey</p>
              <p className="text-sm text-muted-foreground">Complete a moving survey with photos</p>
            </div>
          </button>

          <button
            onClick={() => navigate('/field/dispatch')}
            className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors text-left"
          >
            <div className="w-11 h-11 rounded-lg bg-green-100 text-green-700 flex items-center justify-center shrink-0">
              <Truck size={22} />
            </div>
            <div>
              <p className="font-semibold text-base text-foreground">Dispatch</p>
              <p className="text-sm text-muted-foreground">View dispatch notes and crew assignments</p>
            </div>
          </button>
        </div>
      </div>

      {/* Today's jobs preview */}
      {!isLoading && jobs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Today's Jobs</p>
          <div className="space-y-2">
            {jobs.slice(0, 3).map(job => (
              <button
                key={job._id}
                onClick={() => navigate('/field/jobs')}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm text-foreground">{job.jobNo}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusTone[job.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {job.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-sm text-foreground truncate">{job.customer?.fullName}</p>
                  <p className="text-xs text-muted-foreground truncate">{job.pickupAddress || '—'}</p>
                </div>
                {job.scheduledTimeSlot && (
                  <span className="text-xs font-medium text-primary shrink-0">{job.scheduledTimeSlot}</span>
                )}
              </button>
            ))}
            {jobs.length > 3 && (
              <button
                onClick={() => navigate('/field/jobs')}
                className="w-full text-sm text-primary font-medium py-2"
              >
                View all {jobs.length} jobs →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

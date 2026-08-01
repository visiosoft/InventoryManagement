import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingJob } from '../../lib/types'
import { Spinner } from '../../components/ui'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'

const statusColors: Record<string, string> = {
  draft: '#94a3b8', confirmed: '#60a5fa', in_progress: '#fbbf24',
  completed: '#34d399', invoiced: '#2dd4bf', cancelled: '#f87171',
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function toIso(d: Date) { return d.toISOString().slice(0, 10) }

export default function FieldSchedule() {
  const navigate = useNavigate()
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    return d
  })

  const from = toIso(weekStart)
  const to = toIso(addDays(weekStart, 6))

  const { data: jobs = [], isLoading } = useQuery<MovingJob[]>({
    queryKey: ['field-schedule', from, to],
    queryFn: () => api.get('/moving-jobs/schedule', { params: { from, to } }).then(r => r.data),
  })

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = toIso(new Date())

  return (
    <div className="space-y-4">
      <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>Schedule</h1>

      {/* Week nav */}
      <div className="flex items-center justify-between">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="h-8 w-8 rounded-lg border border-border flex items-center justify-center">
          <ChevronLeft size={16} style={{ color: MUTED }} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>
          {weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — {addDays(weekStart, 6).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="h-8 w-8 rounded-lg border border-border flex items-center justify-center">
          <ChevronRight size={16} style={{ color: MUTED }} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center pt-8"><Spinner /></div>
      ) : (
        <div className="space-y-3">
          {days.map(day => {
            const iso = toIso(day)
            const isToday = iso === today
            const dayJobs = jobs.filter(j => j.scheduledDate?.slice(0, 10) === iso)

            return (
              <div key={iso}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: isToday ? '#fff' : INK,
                    background: isToday ? PURPLE : 'transparent',
                    padding: isToday ? '2px 8px' : 0, borderRadius: 6,
                  }}>
                    {day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <span style={{ fontSize: 11, color: MUTED }}>{dayJobs.length} job{dayJobs.length !== 1 ? 's' : ''}</span>
                </div>

                {dayJobs.length === 0 ? (
                  <div className="py-2 px-3 rounded-lg bg-muted/30" style={{ fontSize: 12, color: MUTED }}>No jobs</div>
                ) : (
                  <div className="space-y-1.5">
                    {dayJobs.map(job => (
                      <button
                        key={job._id}
                        onClick={() => navigate(`/field/jobs/${job._id}`)}
                        className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-left"
                      >
                        <div style={{ width: 4, height: 28, borderRadius: 2, background: statusColors[job.status] || '#94a3b8' }} className="shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span style={{ fontSize: 11, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{job.jobNo}</span>
                            {job.scheduledTimeSlot && <span style={{ fontSize: 10, color: MUTED }}>{job.scheduledTimeSlot}</span>}
                          </div>
                          <p style={{ fontSize: 12, color: INK }} className="truncate">{job.customer?.fullName}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

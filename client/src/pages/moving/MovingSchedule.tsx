import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingJob, MovingJobStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, EmptyState, PageHeader, Spinner } from '../../components/ui'

const statusTone: Record<MovingJobStatus, string> = {
  draft: 'gray', confirmed: 'blue', survey_done: 'purple',
  in_progress: 'yellow', completed: 'green', invoiced: 'teal', cancelled: 'red',
}

const statusBg: Record<MovingJobStatus, string> = {
  draft: 'bg-gray-100 dark:bg-gray-900',
  confirmed: 'bg-blue-100 dark:bg-blue-900',
  survey_done: 'bg-purple-100 dark:bg-purple-900',
  in_progress: 'bg-yellow-100 dark:bg-yellow-900',
  completed: 'bg-green-100 dark:bg-green-900',
  invoiced: 'bg-cyan-100 dark:bg-cyan-900',
  cancelled: 'bg-red-100 dark:bg-red-900',
}

function getDaysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

function getFirstDayOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

export default function MovingSchedule() {
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
  const endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0, 23, 59, 59)

  const { data: jobs = [], isLoading } = useQuery<MovingJob[]>({
    queryKey: ['moving-schedule', isoDate(currentMonth)],
    queryFn: () => api.get('/moving-jobs/schedule', {
      params: { from: startDate.toISOString(), to: endDate.toISOString() },
    }).then(r => r.data),
  })

  const byDate: Record<string, MovingJob[]> = {}
  for (const j of jobs) {
    if (!j.scheduledDate) continue
    const key = isoDate(new Date(j.scheduledDate))
    if (!byDate[key]) byDate[key] = []
    byDate[key].push(j)
  }

  const daysInMonth = getDaysInMonth(currentMonth)
  const firstDay = getFirstDayOfMonth(currentMonth)
  const days = Array.from({ length: firstDay }, () => null).concat(
    Array.from({ length: daysInMonth }, (_, i) => new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i + 1))
  )

  const monthLabel = currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const today = isoDate(new Date())

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))
  const goToday = () => setCurrentMonth(new Date())

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <PageHeader title="Schedule" subtitle="Month view" />
        <div className="flex items-center gap-3 shrink-0">
          <Button variant="outline" size="sm" onClick={prevMonth}>
            <ChevronLeft size={16} />
          </Button>
          <span className="text-sm font-medium min-w-[160px] text-center">{monthLabel}</span>
          <Button variant="outline" size="sm" onClick={nextMonth}>
            <ChevronRight size={16} />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            Today
          </Button>
          <Link to="/moving/jobs/new">
            <Button size="sm"><Plus size={14} className="mr-1" />New Job</Button>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <Card>
          <CardBody>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-xs font-semibold text-muted-foreground py-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1 auto-rows-[120px]">
              {days.map((day, idx) => {
                const dayKey = day ? isoDate(day) : null
                const dayJobs = dayKey ? (byDate[dayKey] ?? []) : []
                const isToday = dayKey === today
                const isCurrentMonth = day?.getMonth() === currentMonth.getMonth()

                return (
                  <Link
                    key={idx}
                    to={day && isCurrentMonth ? `/moving/jobs/new?date=${isoDate(day)}` : '#'}
                    onClick={e => {
                      if (!day || !isCurrentMonth) e.preventDefault()
                    }}
                    className={`border rounded-lg p-1.5 text-xs overflow-hidden transition-colors cursor-pointer block ${
                      !isCurrentMonth
                        ? 'bg-muted/30 opacity-50 cursor-default'
                        : isToday
                          ? 'bg-primary/5 border-primary/30 hover:bg-primary/10'
                          : 'bg-card hover:bg-muted/50'
                    }`}
                  >
                    {day && (
                      <>
                        <div className={`font-semibold ${isToday ? 'text-primary' : 'text-foreground'}`}>
                          {day.getDate()}
                        </div>
                        <div className="space-y-0.5 mt-1">
                          {dayJobs.slice(0, 2).map(job => (
                            <Link
                              key={job._id}
                              to={`/moving/jobs/${job._id}`}
                              onClick={e => e.stopPropagation()}
                              className={`block rounded px-1 py-0.5 text-[10px] font-medium truncate hover:underline ${statusBg[job.status]} text-foreground`}
                              title={`${job.jobNo} - ${job.customer?.fullName}`}
                            >
                              {job.jobNo}
                            </Link>
                          ))}
                          {dayJobs.length > 2 && (
                            <div className="text-[9px] text-muted-foreground px-1">
                              +{dayJobs.length - 2} more
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </Link>
                )
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Legend */}
      <Card>
        <CardBody>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {(Object.entries(statusTone) as [MovingJobStatus, string][]).map(([status, tone]) => (
              <div key={status} className="flex items-center gap-2">
                <Badge tone={tone}>{status.replace('_', ' ')}</Badge>
                <span className="text-muted-foreground">= {status.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Search, CalendarDays, CircleCheck, Clock, Truck } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingJob, MovingJobStatus } from '../../lib/types'
import { Spinner, movingJobStatusLabel } from '../../components/ui'

// ── Purple/cream design tokens (matches the dashboard mockup) ──────────────────
const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

// Soft event pill styles per status
const eventStyle: Record<MovingJobStatus, { bg: string; color: string }> = {
  draft: { bg: '#F3F0EA', color: '#756E80' },
  confirmed: { bg: '#F7F3FF', color: '#5B2BC9' },
  in_progress: { bg: '#FFF7ED', color: '#EA580C' },
  completed: { bg: '#ECFDF5', color: '#059669' },
  invoiced: { bg: '#EFF6FF', color: '#2563EB' },
  cancelled: { bg: '#FEF2F2', color: '#EF4444' },
}

function getDaysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

function getFirstDayOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
}

function isoDate(d: Date) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ── Small building blocks ──────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, iconBg, iconColor }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode; iconBg: string; iconColor: string
}) {
  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 20 }}>
      <div className="flex justify-between items-start">
        <div style={{ fontSize: 13, color: MUTED, fontWeight: 500 }}>{label}</div>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: iconBg, display: 'grid', placeItems: 'center', color: iconColor }}>
          {icon}
        </div>
      </div>
      <div style={{ ...HEADING, fontSize: 32, fontWeight: 700, color: INK, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

export default function MovingSchedule() {
  const navigate = useNavigate()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [search, setSearch] = useState('')

  const startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
  const endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0, 23, 59, 59)

  const { data: jobs = [], isLoading } = useQuery<MovingJob[]>({
    queryKey: ['moving-schedule', isoDate(currentMonth)],
    queryFn: () => api.get('/moving-jobs/schedule', {
      params: { from: startDate.toISOString(), to: endDate.toISOString() },
    }).then(r => r.data),
  })

  const q = search.trim().toLowerCase()
  const visibleJobs = q
    ? jobs.filter(j => (j.jobNo || '').toLowerCase().includes(q) || (j.customer?.fullName || '').toLowerCase().includes(q))
    : jobs

  const byDate: Record<string, MovingJob[]> = {}
  for (const j of visibleJobs) {
    if (!j.scheduledDate) continue
    const key = isoDate(new Date(j.scheduledDate))
    if (!byDate[key]) byDate[key] = []
    byDate[key].push(j)
  }

  const daysInMonth = getDaysInMonth(currentMonth)
  const firstDay = getFirstDayOfMonth(currentMonth)
  const days: (Date | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i + 1)),
  ]

  const monthLabel = currentMonth.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const today = isoDate(new Date())
  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))
  const goToday = () => setCurrentMonth(new Date())

  // Stats for the visible month
  const confirmedCount = jobs.filter(j => j.status === 'confirmed').length
  const completedCount = jobs.filter(j => j.status === 'completed').length
  const todayCount = (byDate[today] ?? []).length

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Schedule</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{todayLabel} · Dubai</div>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Search */}
          <div style={{ height: 40, borderRadius: 10, background: '#F3F0EA' }} className="flex items-center gap-2 px-3">
            <Search size={16} color={MUTED} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search jobs…"
              style={{ background: 'transparent', outline: 'none', border: 'none', fontSize: 13, color: INK, width: 130 }}
            />
          </div>
          {/* Month nav pill */}
          <div style={{ height: 40, borderRadius: 10, background: '#F3F0EA' }} className="flex items-center px-1">
            <button onClick={prevMonth} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-white/70 transition-colors" title="Previous month">
              <ChevronLeft size={16} color={MUTED} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, color: INK, minWidth: 108, textAlign: 'center' }}>{monthLabel}</span>
            <button onClick={nextMonth} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-white/70 transition-colors" title="Next month">
              <ChevronRight size={16} color={MUTED} />
            </button>
          </div>
          <button onClick={goToday} style={{ height: 40, borderRadius: 10, background: '#F3F0EA', fontSize: 13, fontWeight: 600, color: MUTED }} className="px-4 hover:brightness-95 transition">
            Today
          </button>
          <Link to="/moving/jobs/new" style={{ height: 40, borderRadius: 10, background: PURPLE, color: 'white', fontSize: 13, fontWeight: 600 }} className="px-4 flex items-center gap-1.5 hover:brightness-110 transition">
            <Plus size={15} />New Job
          </Link>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        <StatCard label={`Jobs in ${currentMonth.toLocaleDateString('en-GB', { month: 'long' })}`} value={jobs.length} sub="scheduled this month"
          icon={<CalendarDays size={18} />} iconBg="#F7F3FF" iconColor={PURPLE} />
        <StatCard label="Confirmed" value={confirmedCount} sub="ready to dispatch"
          icon={<CircleCheck size={18} />} iconBg="#ECFDF5" iconColor="#059669" />
        <StatCard label="Completed" value={completedCount} sub="finished this month"
          icon={<Truck size={18} />} iconBg="#EFF6FF" iconColor="#2563EB" />
        <StatCard label="Today" value={todayCount} sub={todayCount === 1 ? '1 job today' : `${todayCount} jobs today`}
          icon={<Clock size={18} />} iconBg="#FFF7ED" iconColor="#EA580C" />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <>
        {/* Month grid — desktop and tablets. Seven columns cannot fit a phone. */}
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 20 }} className="hidden sm:block">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1.5 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: MUTED }} className="text-center py-2">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1.5 auto-rows-[118px]">
            {days.map((day, idx) => {
              const dayKey = day ? isoDate(day) : null
              const dayJobs = dayKey ? (byDate[dayKey] ?? []) : []
              const isToday = dayKey === today
              const isCurrentMonth = day?.getMonth() === currentMonth.getMonth()

              return (
                <div
                  key={idx}
                  onClick={() => { if (day && isCurrentMonth) navigate(`/moving/jobs/new?date=${isoDate(day)}`) }}
                  style={{
                    borderRadius: 12,
                    border: isToday ? `1px solid ${PURPLE}40` : '1px solid rgba(20,8,31,0.06)',
                    background: !isCurrentMonth ? 'transparent' : isToday ? '#F7F3FF' : 'white',
                    opacity: !isCurrentMonth ? 0.4 : 1,
                  }}
                  className={`p-1.5 text-xs overflow-hidden transition-colors block ${isCurrentMonth ? 'cursor-pointer hover:brightness-[0.98]' : 'cursor-default'}`}
                >
                  {day && (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 12, color: isToday ? PURPLE : INK }}>
                        {day.getDate()}
                      </div>
                      <div className="space-y-1 mt-1">
                        {dayJobs.slice(0, 2).map(job => {
                          const st = eventStyle[job.status] ?? eventStyle.draft
                          return (
                            <Link
                              key={job._id}
                              to={`/moving/jobs/${job._id}`}
                              onClick={e => e.stopPropagation()}
                              style={{ background: st.bg, color: st.color, borderRadius: 6 }}
                              className="block px-1.5 py-0.5 text-[10px] font-semibold truncate hover:brightness-95"
                              title={`${job.jobNo} — ${job.customer?.fullName ?? ''} · ${movingJobStatusLabel(job.status)}`}
                            >
                              {job.jobNo}
                            </Link>
                          )
                        })}
                        {dayJobs.length > 2 && (
                          <div style={{ fontSize: 9, color: MUTED }} className="px-1">
                            +{dayJobs.length - 2} more
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Agenda list — phones. One card per job, grouped by day. */}
        <div className="sm:hidden space-y-3">
          {days.filter((d): d is Date => !!d && (byDate[isoDate(d)] ?? []).length > 0).map((day) => {
            const dayKey = isoDate(day)
            const dayJobs = byDate[dayKey] ?? []
            const isToday = dayKey === today
            return (
              <div key={dayKey} style={{ background: 'white', border: isToday ? `1px solid ${PURPLE}40` : '1px solid rgba(20,8,31,0.08)', borderRadius: 14 }}>
                <div className="flex items-center justify-between px-3.5 pt-3 pb-1.5">
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: isToday ? PURPLE : INK }}>
                    {day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {isToday && <span style={{ background: '#F7F3FF', color: PURPLE, borderRadius: 6, fontSize: 10, padding: '2px 6px', marginLeft: 8 }}>Today</span>}
                  </span>
                  <span style={{ fontSize: 11, color: MUTED }}>{dayJobs.length} job{dayJobs.length === 1 ? '' : 's'}</span>
                </div>
                <div className="px-2 pb-2 space-y-1.5">
                  {dayJobs.map(job => {
                    const st = eventStyle[job.status] ?? eventStyle.draft
                    return (
                      <Link key={job._id} to={`/moving/jobs/${job._id}`}
                        className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2.5 hover:brightness-[0.98]"
                        style={{ background: '#FBFAF7', border: '1px solid rgba(20,8,31,0.05)' }}>
                        <span className="min-w-0">
                          <span style={{ fontSize: 13, fontWeight: 700, color: INK }} className="block truncate">
                            {job.customer?.fullName || job.jobNo}
                          </span>
                          <span style={{ fontSize: 11, color: MUTED }}>{job.jobNo}</span>
                        </span>
                        <span style={{ background: st.bg, color: st.color, borderRadius: 6, fontSize: 10.5, fontWeight: 600 }}
                          className="px-2 py-1 capitalize shrink-0 whitespace-nowrap">
                          {movingJobStatusLabel(job.status)}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {visibleJobs.length === 0 && (
            <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, color: MUTED }} className="text-center text-sm py-8">
              No jobs scheduled in {monthLabel}.
            </div>
          )}
        </div>
        </>
      )}

      {/* Legend */}
      <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 20 }} className="mt-4">
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: MUTED }} className="mb-3">Status legend</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(Object.keys(eventStyle) as MovingJobStatus[]).map(status => {
            const st = eventStyle[status]
            return (
              <div key={status} className="flex items-center gap-2">
                <span style={{ background: st.bg, color: st.color, borderRadius: 6, fontSize: 11, fontWeight: 600 }} className="px-2 py-0.5 capitalize">
                  {movingJobStatusLabel(status)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, MapPin, Users, Search, Filter } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob, MovingJobStatus } from '../../lib/types'
import { Spinner } from '../../components/ui'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'

const statusColors: Record<string, string> = {
  draft: '#94a3b8', confirmed: '#60a5fa', in_progress: '#fbbf24',
  completed: '#34d399', invoiced: '#2dd4bf', cancelled: '#f87171',
}

const STATUS_FILTERS = ['all', 'confirmed', 'in_progress', 'completed', 'invoiced', 'draft', 'cancelled'] as const

export default function FieldJobs() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [err, setErr] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const { data: jobs = [], isLoading } = useQuery<MovingJob[]>({
    queryKey: ['field-all-jobs'],
    queryFn: () => api.get('/moving-jobs').then(r => r.data),
  })

  const statusMut = useMutation({
    mutationFn: ({ jobId, status }: { jobId: string; status: MovingJobStatus }) =>
      api.patch(`/moving-jobs/${jobId}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['field-all-jobs'] }),
    onError: (e, vars) => setErr(prev => ({ ...prev, [vars.jobId]: apiError(e) })),
  })

  const filtered = jobs.filter(j => {
    if (statusFilter !== 'all' && j.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (j.jobNo?.toLowerCase().includes(q) || j.customer?.fullName?.toLowerCase().includes(q) || j.pickupAddress?.toLowerCase().includes(q))
    }
    return true
  })

  if (isLoading) return <div className="flex justify-center pt-16"><Spinner /></div>

  return (
    <div className="space-y-4">
      <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>Jobs</h1>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search jobs..."
          className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Status filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
        {STATUS_FILTERS.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={{
              background: statusFilter === s ? PURPLE : 'transparent',
              color: statusFilter === s ? '#fff' : MUTED,
              border: `1px solid ${statusFilter === s ? PURPLE : '#e5e7eb'}`,
            }}
          >
            {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <p style={{ fontSize: 12, color: MUTED }}>{filtered.length} job{filtered.length !== 1 ? 's' : ''}</p>

      {filtered.length === 0 ? (
        <div className="text-center pt-12 space-y-2">
          <p className="text-4xl">📦</p>
          <p style={{ fontSize: 15, fontWeight: 600, color: INK }}>No jobs found</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(job => {
            const isOpen = expanded === job._id
            const canStart = job.status === 'confirmed'
            const canComplete = job.status === 'in_progress'

            return (
              <div key={job._id} className="rounded-xl border border-border bg-card overflow-hidden">
                <button className="w-full text-left p-3.5" onClick={() => setExpanded(isOpen ? null : job._id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span style={{ fontSize: 12, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{job.jobNo}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: statusColors[job.status], textTransform: 'capitalize' }}>
                          {job.status.replace(/_/g, ' ')}
                        </span>
                        {job.scheduledTimeSlot && (
                          <span style={{ fontSize: 10, color: MUTED }}>{job.scheduledTimeSlot}</span>
                        )}
                      </div>
                      <p style={{ fontSize: 13, fontWeight: 500, color: INK }} className="truncate">{job.customer?.fullName}</p>
                      <p style={{ fontSize: 11, color: MUTED }} className="truncate">{job.pickupAddress || '—'}</p>
                      {job.scheduledDate && (
                        <p style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                          {new Date(job.scheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 mt-1" style={{ color: MUTED }}>
                      {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border px-3.5 pb-3.5 space-y-3">
                    {err[job._id] && (
                      <div className="mt-2 p-2 rounded-lg bg-red-50 text-xs text-red-700">{err[job._id]}</div>
                    )}
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="flex items-start gap-2">
                        <MapPin size={14} className="text-green-600 mt-0.5 shrink-0" />
                        <div>
                          <p style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>Pickup</p>
                          <p style={{ fontSize: 12, color: INK }}>{job.pickupAddress || '—'}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <MapPin size={14} className="text-red-500 mt-0.5 shrink-0" />
                        <div>
                          <p style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>Delivery</p>
                          <p style={{ fontSize: 12, color: INK }}>{job.deliveryAddress || '—'}</p>
                        </div>
                      </div>
                      {job.crew && job.crew.length > 0 && (
                        <div className="flex items-start gap-2">
                          <Users size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                          <div>
                            <p style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>Crew</p>
                            <p style={{ fontSize: 12, color: INK }}>
                              {(job.crew as any[]).map((c: any) => c.worker?.name || '').filter(Boolean).join(', ') || '—'}
                            </p>
                          </div>
                        </div>
                      )}
                      {job.dispatchNotes && (
                        <div className="p-2.5 rounded-lg bg-yellow-50 border border-yellow-200" style={{ fontSize: 12, color: '#854d0e' }}>
                          <p style={{ fontSize: 10, fontWeight: 700, marginBottom: 2 }}>Dispatch Notes</p>
                          {job.dispatchNotes}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      {canStart && (
                        <button
                          onClick={() => statusMut.mutate({ jobId: job._id, status: 'in_progress' })}
                          disabled={statusMut.isPending}
                          className="flex-1 h-10 rounded-xl bg-yellow-500 text-white font-semibold text-xs disabled:opacity-60 transition-colors"
                        >
                          Start Job
                        </button>
                      )}
                      {canComplete && (
                        <button
                          onClick={() => statusMut.mutate({ jobId: job._id, status: 'completed' })}
                          disabled={statusMut.isPending}
                          className="flex-1 h-10 rounded-xl bg-green-600 text-white font-semibold text-xs disabled:opacity-60 transition-colors"
                        >
                          Complete Job
                        </button>
                      )}
                      <button
                        onClick={() => navigate(`/field/jobs/${job._id}`)}
                        className="h-10 px-4 rounded-xl border border-border text-xs font-medium hover:bg-muted/50 transition-colors"
                        style={{ color: PURPLE }}
                      >
                        View Details
                      </button>
                    </div>
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

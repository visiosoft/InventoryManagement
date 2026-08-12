import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Search, ArrowRight, MapPin, Trash2, Pencil, Briefcase, CheckCircle, Clock, Truck } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob, MovingJobStatus } from '../../lib/types'
import { Badge, Button, Modal, Spinner, movingJobStatusLabel } from '../../components/ui'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

interface JobsBreakdown {
  byStatus: Array<{ _id: string; count: number }>
}

const STATUSES: { value: MovingJobStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Coming Soon' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'cancelled', label: 'Cancelled' },
]

const statusTone: Record<MovingJobStatus, string> = {
  draft: 'gray', confirmed: 'blue',
  in_progress: 'yellow', completed: 'green', invoiced: 'teal', cancelled: 'red',
}

const statusDot: Record<string, string> = {
  draft: '#94A3B8', confirmed: '#3B82F6',
  in_progress: '#F59E0B', completed: '#10B981', invoiced: '#14B8A6', cancelled: '#EF4444',
}

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

function fmtDate(s?: string) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function truncate(s?: string, max = 32) {
  if (!s) return '—'
  return s.length > max ? s.slice(0, max) + '…' : s
}

export default function MovingJobs() {
  const [status, setStatus] = useState<MovingJobStatus | ''>('')
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<{ _id: string; jobNo: string } | null>(null)
  const [deleteErr, setDeleteErr] = useState('')
  const qc = useQueryClient()

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/moving-jobs/${id}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moving-jobs'] })
      qc.invalidateQueries({ queryKey: ['moving-jobs-breakdown'] })
      setDeleteTarget(null)
      setDeleteErr('')
    },
    onError: (e) => setDeleteErr(apiError(e)),
  })

  const { data, isLoading } = useQuery<{ jobs: MovingJob[]; total: number }>({
    queryKey: ['moving-jobs', status],
    queryFn: () => api.get('/moving-jobs', { params: { status: status || undefined, limit: 200 } }).then(r => r.data),
  })

  const { data: breakdown } = useQuery<JobsBreakdown>({
    queryKey: ['moving-jobs-breakdown'],
    queryFn: () => api.get('/moving-reports/jobs').then(r => r.data),
    retry: 1,
  })

  const counts = Object.fromEntries((breakdown?.byStatus ?? []).map(s => [s._id, s.count]))
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0)

  const jobs = data?.jobs ?? []
  const filtered = jobs.filter(j =>
    !search ||
    j.jobNo.toLowerCase().includes(search.toLowerCase()) ||
    (j.title ?? '').toLowerCase().includes(search.toLowerCase()) ||
    j.customer?.fullName?.toLowerCase().includes(search.toLowerCase()) ||
    (j.pickupAddress ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const confirmedCount = counts['confirmed'] ?? 0
  const inProgressCount = counts['in_progress'] ?? 0
  const completedCount = counts['completed'] ?? 0

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Jobs List</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{data?.total ?? 0} total jobs</div>
        </div>
        <Link to="/moving/jobs/new">
          <button
            style={{ height: 40, borderRadius: 10, background: PURPLE, color: 'white', fontSize: 14, fontWeight: 600, padding: '0 20px' }}
            className="flex items-center gap-2 hover:opacity-90 transition-opacity"
          >
            <Plus size={16} />New Job
          </button>
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        <StatCard label="Total Jobs" value={allCount} sub="all statuses" icon={<Briefcase size={18} />} iconBg="#F3F0EA" iconColor={MUTED} />
        <StatCard label="Confirmed" value={confirmedCount} sub="ready to go" icon={<CheckCircle size={18} />} iconBg="#EFF6FF" iconColor="#3B82F6" />
        <StatCard label="In Progress" value={inProgressCount} sub="currently active" icon={<Truck size={18} />} iconBg="#FFF7ED" iconColor="#EA580C" />
        <StatCard label="Completed" value={completedCount} sub="finished" icon={<Clock size={18} />} iconBg="#ECFDF5" iconColor="#059669" />
      </div>

      {/* Search + status pills */}
      <div className="flex flex-col gap-2.5 mb-5">
        <div style={{ height: 40, borderRadius: 10, background: '#F3F0EA' }} className="flex items-center gap-2 px-3">
          <Search size={16} color={MUTED} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by job number, customer, or address…"
            style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 14, color: INK }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map(s => {
            const count = s.value === '' ? allCount : (counts[s.value] ?? 0)
            const active = status === s.value
            return (
              <button
                key={s.value}
                onClick={() => setStatus(s.value)}
                style={{
                  height: 36,
                  borderRadius: 10,
                  background: active ? PURPLE : '#F3F0EA',
                  color: active ? 'white' : MUTED,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '0 12px',
                  border: 'none',
                }}
                className="flex items-center gap-1.5 hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                {s.value && <span style={{ width: 6, height: 6, borderRadius: 3, background: active ? 'white' : statusDot[s.value] }} />}
                {s.label}
                <span style={{ fontSize: 11, opacity: 0.7 }}>{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '60px 20px', textAlign: 'center' }}>
          <Briefcase size={32} style={{ margin: '0 auto 12px', color: MUTED, opacity: 0.3 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>No jobs found</div>
          <div style={{ fontSize: 13, color: MUTED }}>
            {search ? 'Try a different search term' : 'No jobs match the selected filter'}
          </div>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {filtered.map(j => (
              <div key={j._id}
                style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: 16 }}
                className="hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <Link to={`/moving/jobs/${j._id}`} className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span style={{ fontSize: 13, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{j.jobNo}</span>
                      <Badge tone={statusTone[j.status]} className="text-xs py-0 h-4">{movingJobStatusLabel(j.status)}</Badge>
                    </div>
                    {j.title && <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 2 }}>{j.title}</div>}
                    <div style={{ fontSize: 14, fontWeight: 600, color: j.title ? MUTED : INK, marginBottom: 4 }}>{j.customer?.fullName}</div>
                    {j.scheduledDate && (
                      <div className="text-xs" style={{ color: MUTED, marginBottom: 4 }}>{fmtDate(j.scheduledDate)}</div>
                    )}
                    {(j.pickupAddress || j.deliveryAddress) && (
                      <div className="flex items-start gap-1 text-xs" style={{ color: MUTED }}>
                        <MapPin size={11} className="shrink-0 mt-0.5" />
                        <span className="truncate">{truncate(j.pickupAddress, 28)} → {truncate(j.deliveryAddress, 28)}</span>
                      </div>
                    )}
                  </Link>
                  <div className="flex items-center gap-1 shrink-0">
                    {!['invoiced'].includes(j.status) && (
                      <Link to={`/moving/jobs/${j._id}?edit=1`} className="p-1.5 rounded-lg hover:bg-purple-500/10 transition-colors" style={{ color: MUTED }}>
                        <Pencil size={14} />
                      </Link>
                    )}
                    {!['in_progress', 'invoiced'].includes(j.status) && (
                      <button onClick={() => { setDeleteTarget({ _id: j._id, jobNo: j.jobNo }); setDeleteErr('') }}
                        className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: MUTED }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                    <Link to={`/moving/jobs/${j._id}`} className="p-1 transition-colors" style={{ color: MUTED }}>
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block" style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                    {['Job No', 'Customer', 'Date', 'Pickup', 'Delivery', 'Status', ''].map(h => (
                      <th key={h} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(j => (
                    <tr key={j._id} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                      <td style={{ padding: '14px 16px' }}>
                        <Link to={`/moving/jobs/${j._id}`} className="hover:opacity-80 transition-opacity">
                          <span style={{ fontSize: 13, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{j.jobNo}</span>
                          {j.title && <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginTop: 2, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.title}</div>}
                        </Link>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, color: INK }}>{j.customer?.fullName}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, whiteSpace: 'nowrap' }}>{fmtDate(j.scheduledDate)}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.pickupAddress || '—'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.deliveryAddress || '—'}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <Badge tone={statusTone[j.status]} className="text-xs">{movingJobStatusLabel(j.status)}</Badge>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-1">
                          {!['invoiced'].includes(j.status) && (
                            <Link to={`/moving/jobs/${j._id}?edit=1`} className="p-1.5 rounded-lg hover:bg-purple-500/10 transition-colors" style={{ color: MUTED }}>
                              <Pencil size={14} />
                            </Link>
                          )}
                          {!['in_progress', 'invoiced'].includes(j.status) && (
                            <button onClick={() => { setDeleteTarget({ _id: j._id, jobNo: j.jobNo }); setDeleteErr('') }}
                              className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: MUTED }}>
                              <Trash2 size={14} />
                            </button>
                          )}
                          <Link to={`/moving/jobs/${j._id}`} className="p-1 transition-colors hover:opacity-70" style={{ color: MUTED }}>
                            <ArrowRight size={14} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: 12, color: MUTED, textAlign: 'right', marginTop: 12 }}>{filtered.length} job{filtered.length !== 1 ? 's' : ''}</div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      <Modal open={!!deleteTarget} title="Delete Job" onClose={() => setDeleteTarget(null)}>
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Are you sure you want to delete job <strong>{deleteTarget.jobNo}</strong>? This action cannot be undone.
            </p>
            {deleteErr && <p className="text-sm text-red-600">{deleteErr}</p>}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button
                onClick={() => deleteMut.mutate(deleteTarget._id)}
                disabled={deleteMut.isPending}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleteMut.isPending ? 'Deleting…' : 'Delete Job'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Users, Truck, Phone, Mail, Calendar, Clock, Package, FileText, Receipt } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob, MovingJobStatus } from '../../lib/types'
import { Spinner } from '../../components/ui'
import { useState } from 'react'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'

const statusColors: Record<string, string> = {
  draft: '#94a3b8', confirmed: '#60a5fa', in_progress: '#fbbf24',
  completed: '#34d399', invoiced: '#2dd4bf', cancelled: '#f87171',
}

function dt(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function InfoRow({ label, value, icon: Icon }: { label: string; value?: string; icon?: any }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2.5 py-2" style={{ borderBottom: '1px solid rgba(20,8,31,0.05)' }}>
      {Icon && <Icon size={14} className="mt-0.5 shrink-0" style={{ color: MUTED }} />}
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: 10, color: MUTED, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</p>
        <p style={{ fontSize: 13, color: INK, marginTop: 1 }}>{value}</p>
      </div>
    </div>
  )
}

export default function FieldJobDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [err, setErr] = useState('')

  const { data: job, isLoading } = useQuery<MovingJob>({
    queryKey: ['field-job', id],
    queryFn: () => api.get(`/moving-jobs/${id}`).then(r => r.data),
  })

  const statusMut = useMutation({
    mutationFn: (status: MovingJobStatus) => api.patch(`/moving-jobs/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['field-job', id] }); qc.invalidateQueries({ queryKey: ['field-all-jobs'] }) },
    onError: (e) => setErr(apiError(e)),
  })

  if (isLoading) return <div className="flex justify-center pt-16"><Spinner /></div>
  if (!job) return <div className="pt-16 text-center" style={{ color: MUTED }}>Job not found</div>

  const canStart = job.status === 'confirmed'
  const canComplete = job.status === 'in_progress'
  const crew = (job.crew as any[] || []).map((c: any) => c.worker?.name).filter(Boolean)
  const trucks = (job.trucks as any[] || []).map((t: any) => t.truck?.name).filter(Boolean)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} style={{ color: MUTED }}><ArrowLeft size={20} /></button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 16, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{job.jobNo}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: statusColors[job.status], textTransform: 'capitalize' }}>
              {job.status.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* Customer */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Customer</p>
        <p style={{ fontSize: 15, fontWeight: 600, color: INK }}>{job.customer?.fullName}</p>
        {job.customer?.phone && (
          <a href={`tel:${job.customer.phone}`} className="flex items-center gap-2 mt-2" style={{ fontSize: 13, color: PURPLE }}>
            <Phone size={13} /> {job.customer.phone}
          </a>
        )}
        {job.customer?.email && (
          <div className="flex items-center gap-2 mt-1" style={{ fontSize: 12, color: MUTED }}>
            <Mail size={12} /> {job.customer.email}
          </div>
        )}
      </div>

      {/* Schedule */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Schedule</p>
        <InfoRow label="Date" value={dt(job.scheduledDate)} icon={Calendar} />
        <InfoRow label="Time Slot" value={job.scheduledTimeSlot} icon={Clock} />
        <InfoRow label="Move Type" value={job.jobType?.replace(/_/g, ' ')} icon={Package} />
      </div>

      {/* Addresses */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Addresses</p>
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <div style={{ width: 6, height: 6, borderRadius: 3, background: '#22c55e', marginTop: 5 }} className="shrink-0" />
            <div>
              <p style={{ fontSize: 10, color: '#22c55e', fontWeight: 700 }}>PICKUP</p>
              <p style={{ fontSize: 13, color: INK }}>{job.pickupAddress || '—'}</p>
              {(job.pickupFloor || job.pickupHasElevator) && (
                <p style={{ fontSize: 11, color: MUTED }}>
                  {job.pickupFloor && `Floor ${job.pickupFloor}`}{job.pickupHasElevator && ' · Elevator'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div style={{ width: 6, height: 6, borderRadius: 3, background: '#ef4444', marginTop: 5 }} className="shrink-0" />
            <div>
              <p style={{ fontSize: 10, color: '#ef4444', fontWeight: 700 }}>DELIVERY</p>
              <p style={{ fontSize: 13, color: INK }}>{job.deliveryAddress || '—'}</p>
              {(job.deliveryFloor || job.deliveryHasElevator) && (
                <p style={{ fontSize: 11, color: MUTED }}>
                  {job.deliveryFloor && `Floor ${job.deliveryFloor}`}{job.deliveryHasElevator && ' · Elevator'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Crew & Trucks */}
      {(crew.length > 0 || trucks.length > 0) && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Team</p>
          {crew.length > 0 && <InfoRow label="Crew" value={crew.join(', ')} icon={Users} />}
          {trucks.length > 0 && <InfoRow label="Trucks" value={trucks.join(', ')} icon={Truck} />}
        </div>
      )}

      {/* Notes */}
      {(job.notes || job.dispatchNotes) && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          {job.dispatchNotes && (
            <div className="p-2.5 rounded-lg bg-yellow-50 border border-yellow-200" style={{ fontSize: 12, color: '#854d0e' }}>
              <p style={{ fontSize: 10, fontWeight: 700, marginBottom: 2 }}>Dispatch Notes</p>
              {job.dispatchNotes}
            </div>
          )}
          {job.notes && (
            <div>
              <p style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>NOTES</p>
              <p style={{ fontSize: 12, color: INK, marginTop: 2, whiteSpace: 'pre-wrap' }}>{job.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Package info */}
      {job.packageType && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Package</p>
          <InfoRow label="Package" value={job.packageLabel || job.packageType} icon={Package} />
          {(job.agreedPrice ?? 0) > 0 && (
            <div className="flex justify-between items-center py-2">
              <span style={{ fontSize: 12, color: MUTED }}>Agreed Price</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: PURPLE }}>AED {Number(job.agreedPrice || 0).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {err && <p className="text-sm text-red-600 text-center">{err}</p>}

      {/* Actions */}
      <div className="flex gap-2 pb-4">
        {canStart && (
          <button
            onClick={() => statusMut.mutate('in_progress')}
            disabled={statusMut.isPending}
            className="flex-1 h-12 rounded-xl bg-yellow-500 text-white font-semibold text-sm disabled:opacity-60 transition-colors"
          >
            Start Job
          </button>
        )}
        {canComplete && (
          <button
            onClick={() => statusMut.mutate('completed')}
            disabled={statusMut.isPending}
            className="flex-1 h-12 rounded-xl bg-green-600 text-white font-semibold text-sm disabled:opacity-60 transition-colors"
          >
            Complete Job
          </button>
        )}
      </div>
    </div>
  )
}

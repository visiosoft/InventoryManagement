import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Calendar, ChevronRight, Truck } from 'lucide-react'
import { portalApi } from '../../lib/customerAuth'

type Job = {
  _id: string
  jobNo: string
  status: string
  pickupAddress: string
  deliveryAddress: string
  scheduledDate: string
  clientPackage?: { label?: string }
  clientVisits?: unknown[]
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  draft: { bg: '#F3F0FF', color: '#5B2BC9', label: 'Draft' },
  confirmed: { bg: '#E0F2FE', color: '#0369A1', label: 'Confirmed' },
  in_progress: { bg: '#FFF7ED', color: '#C2410C', label: 'In Progress' },
  completed: { bg: '#ECFDF5', color: '#059669', label: 'Completed' },
  invoiced: { bg: '#F0FDF4', color: '#15803D', label: 'Invoiced' },
  cancelled: { bg: '#FEF2F2', color: '#B91C1C', label: 'Cancelled' },
}

export default function PortalJobs() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    portalApi.get('/customer-portal/moves').then(r => {
      setJobs(r.data.jobs || [])
    }).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin h-8 w-8 border-2 rounded-full" style={{ borderColor: '#5B2BC9', borderTopColor: 'transparent' }} /></div>
  }

  if (!jobs.length) {
    return (
      <div className="text-center py-20">
        <Truck size={48} style={{ color: '#D4C0F0' }} className="mx-auto mb-4" />
        <h2 className="text-lg font-bold" style={{ color: '#14081F' }}>No jobs yet</h2>
        <p className="text-sm mt-1" style={{ color: '#756E80' }}>Your moving jobs will appear here.</p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-5" style={{ color: '#14081F' }}>My Moving Jobs</h1>
      <div className="space-y-3">
        {jobs.map(job => {
          const s = STATUS_STYLE[job.status] || STATUS_STYLE.draft
          return (
            <Link
              key={job._id}
              to={`/portal/jobs/${job._id}`}
              className="block rounded-2xl border p-4 transition-shadow hover:shadow-md"
              style={{ background: '#fff', borderColor: 'rgba(20,8,31,.08)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-bold text-sm" style={{ color: '#14081F' }}>{job.jobNo}</span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                    {job.clientPackage?.label && (
                      <span className="text-xs" style={{ color: '#756E80' }}>{job.clientPackage.label}</span>
                    )}
                  </div>
                  {job.pickupAddress && (
                    <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: '#756E80' }}>
                      <MapPin size={12} /> <span className="truncate">{job.pickupAddress}</span>
                    </div>
                  )}
                  {job.deliveryAddress && (
                    <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: '#756E80' }}>
                      <MapPin size={12} style={{ color: '#5B2BC9' }} /> <span className="truncate">{job.deliveryAddress}</span>
                    </div>
                  )}
                  {job.scheduledDate && (
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: '#756E80' }}>
                      <Calendar size={12} /> {new Date(job.scheduledDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  )}
                </div>
                <ChevronRight size={20} style={{ color: '#C4B8D8' }} className="mt-1 shrink-0" />
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Briefcase, ClipboardList, Truck, TrendingUp, Wallet,
  MapPin, FileText, Receipt, Calendar, ArrowRight,
} from 'lucide-react'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { MovingJob } from '../../lib/types'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'

interface MovingSummary {
  totalJobs: number
  jobsThisMonth: number
  activeJobs: number
  totalRevenue: number
  revenueThisMonth: number
  upcomingJobs: MovingJob[]
}

const statusColors: Record<string, string> = {
  draft: '#94a3b8', confirmed: '#60a5fa', in_progress: '#fbbf24',
  completed: '#34d399', invoiced: '#2dd4bf', cancelled: '#f87171',
}

function fmtAed(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString()
}

function isToday(dateStr?: string) {
  if (!dateStr) return false
  const d = new Date(dateStr), t = new Date()
  return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear()
}

export default function FieldHome() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const { data: summary, isLoading } = useQuery<MovingSummary>({
    queryKey: ['moving-summary'],
    queryFn: () => api.get('/moving-reports/summary').then(r => r.data),
    retry: 1,
  })

  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  const todayJobs = (summary?.upcomingJobs || []).filter(j => isToday(j.scheduledDate))
  const nextJobs = (summary?.upcomingJobs || []).filter(j => !isToday(j.scheduledDate)).slice(0, 5)

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>
          Hi, {user?.name?.split(' ')[0] || 'there'}!
        </h1>
        <p style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{dateLabel}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Jobs This Month', value: summary?.jobsThisMonth ?? '—', icon: ClipboardList, bg: 'rgba(96,165,250,0.1)', ic: '#2563eb' },
          { label: 'Active Jobs', value: summary?.activeJobs ?? '—', icon: Truck, bg: 'rgba(251,191,36,0.1)', ic: '#d97706' },
          { label: 'Revenue (Month)', value: summary ? `AED ${fmtAed(summary.revenueThisMonth)}` : '—', icon: TrendingUp, bg: 'rgba(52,211,153,0.1)', ic: '#059669' },
          { label: 'Total Revenue', value: summary ? `AED ${fmtAed(summary.totalRevenue)}` : '—', icon: Wallet, bg: 'rgba(91,43,201,0.1)', ic: PURPLE },
        ].map(({ label, value, icon: Icon, bg, ic }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span style={{ fontSize: 11, color: MUTED, fontWeight: 500 }}>{label}</span>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: bg, display: 'grid', placeItems: 'center', color: ic }}>
                <Icon size={14} />
              </div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>
              {isLoading ? '…' : value}
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="space-y-2">
        <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick Actions</p>
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: Briefcase, label: 'Jobs', to: '/field/jobs', color: '#2563eb' },
            { icon: MapPin, label: 'Visits', to: '/field/visits', color: '#7c3aed' },
            { icon: FileText, label: 'Quotes', to: '/field/quotes', color: '#059669' },
            { icon: Receipt, label: 'Invoices', to: '/field/invoices', color: '#d97706' },
            { icon: Calendar, label: 'Schedule', to: '/field/schedule', color: '#0891b2' },
            { icon: Truck, label: 'Dispatch', to: '/field/dispatch', color: '#dc2626' },
            { icon: ClipboardList, label: 'Survey', to: '/field/survey', color: '#7c3aed' },
            { icon: TrendingUp, label: 'Leads', to: '/field/leads', color: '#ea580c' },
          ].map(({ icon: Icon, label, to, color }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors"
            >
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}15`, display: 'grid', placeItems: 'center', color }}>
                <Icon size={16} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: INK }}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Today's Jobs */}
      {!isLoading && todayJobs.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Today's Jobs ({todayJobs.length})
            </p>
            <button onClick={() => navigate('/field/jobs')} style={{ fontSize: 12, color: PURPLE, fontWeight: 600 }} className="flex items-center gap-1">
              View all <ArrowRight size={12} />
            </button>
          </div>
          <div className="space-y-2">
            {todayJobs.slice(0, 4).map(job => (
              <button
                key={job._id}
                onClick={() => navigate(`/field/jobs/${job._id}`)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors text-left"
              >
                <div style={{ width: 6, height: 36, borderRadius: 3, background: statusColors[job.status] || '#94a3b8' }} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span style={{ fontSize: 12, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{job.jobNo}</span>
                    <span style={{ fontSize: 10, color: statusColors[job.status], fontWeight: 600, textTransform: 'capitalize' }}>
                      {job.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 500, color: INK }} className="truncate">{job.customer?.fullName}</p>
                  <p style={{ fontSize: 11, color: MUTED }} className="truncate">{job.pickupAddress || '—'}</p>
                </div>
                {job.scheduledTimeSlot && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: PURPLE }} className="shrink-0">{job.scheduledTimeSlot}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Jobs */}
      {!isLoading && nextJobs.length > 0 && (
        <div className="space-y-2">
          <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Upcoming</p>
          <div className="space-y-1.5">
            {nextJobs.map(job => (
              <button
                key={job._id}
                onClick={() => navigate(`/field/jobs/${job._id}`)}
                className="w-full flex items-center justify-between p-2.5 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span style={{ fontSize: 11, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{job.jobNo}</span>
                  <span style={{ fontSize: 12, color: INK, fontWeight: 500 }} className="truncate">{job.customer?.fullName}</span>
                </div>
                <span style={{ fontSize: 11, color: MUTED }} className="shrink-0 ml-2">
                  {job.scheduledDate ? new Date(job.scheduledDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

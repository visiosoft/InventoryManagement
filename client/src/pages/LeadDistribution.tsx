import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { PageHeader, Spinner } from '../components/ui'
import CoverageCalendar, { type HourSplit, type Shift } from '../components/CoverageCalendar'

/**
 * Who gets the next WhatsApp lead: whoever is on the weekly calendar at that
 * hour. Click an hour to choose who is on and how that hour's leads are split
 * — evenly (they take turns) or by percentage.
 *
 * The other settings (reminder after 15 minutes, what happens out of hours,
 * existing customers) keep the values they were last given.
 */

const MUTED = 'rgba(20,8,31,.55)'


type Person = { _id: string; name: string; email: string; role: string }
type Rule = {
  _id: string
  user: Person
  sharePct: number
  status: 'active' | 'absent' | 'paused'
  absentFrom?: string | null
  absentTo?: string | null
  dailyCap: number
  workingHours?: { days?: number[]; start?: string; end?: string }
  weeklyShifts?: Shift[]
  rosterManaged?: boolean
  color?: string
  fallbackMode: 'pool' | 'user'
  fallbackUser?: { _id: string; name: string } | null
  notes?: string
  todayCount: number
  effectivePct: number
  unavailableBecause: string | null
  pushEnabled: boolean
}
type Data = {
  config: {
    enabled: boolean
    timeZone: string
    outOfHoursMode: 'ai' | 'unassigned' | 'user'
    outOfHoursUser?: string | null
    randomize?: boolean
    existingCustomerUser?: string | null
    /* The clock on a lead nobody has answered, in minutes. 0 turns either
       half off. */
    slaNudgeMinutes?: number
    slaReassignMinutes?: number
    hourSplits?: HourSplit[]
  }
  people: Person[]
  rules: Rule[]
  totalSharePct: number
}

export default function LeadDistribution() {
  const qc = useQueryClient()
  const [err, setErr] = useState('')

  const { data, isLoading } = useQuery<Data>({
    queryKey: ['lead-routing'],
    queryFn: () => api.get('/lead-routing').then((r) => r.data),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['lead-routing'] })
  }

  const saveConfig = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put('/lead-routing/config', body),
    onSuccess: () => { setErr(''); invalidate() },
    onError: (e) => setErr(apiError(e)),
  })

  /* One change on the calendar: each rep whose hours moved, then the hour splits. */
  const [rosterErr, setRosterErr] = useState('')
  const applyRoster = useMutation({
    mutationFn: async (change: { rules: { userId: string; color: string; weeklyShifts: Shift[] }[]; hourSplits: HourSplit[] }) => {
      for (const c of change.rules) {
        await api.put(`/lead-routing/rules/${c.userId}`, { color: c.color, weeklyShifts: c.weeklyShifts, status: 'active' })
      }
      await api.put('/lead-routing/config', { hourSplits: change.hourSplits })
    },
    onSuccess: () => { setRosterErr(''); invalidate() },
    onError: (e) => { setRosterErr(apiError(e)); invalidate() },
  })

  const config = data?.config

  return (
    <div>
      <PageHeader
        title="Lead Distribution"
        action={config && (
          <button type="button" onClick={() => saveConfig.mutate({ enabled: !config.enabled })} disabled={saveConfig.isPending}
            aria-pressed={config.enabled} title={config.enabled ? 'Leads are shared out — click to turn off' : 'Off — click to turn on'}
            className="inline-flex items-center gap-2.5 cursor-pointer"
            style={{ padding: '6px 8px 6px 14px', borderRadius: 999, border: `1px solid ${config.enabled ? '#BBF7D0' : 'rgba(20,8,31,.12)'}`, background: config.enabled ? '#F0FDF4' : '#fff', fontSize: 13, fontWeight: 700, color: config.enabled ? '#047857' : MUTED }}>
            {config.enabled ? 'On' : 'Off'}
            <span style={{ width: 36, height: 20, borderRadius: 999, background: config.enabled ? '#10B981' : '#D1D5DB', position: 'relative', transition: 'background .15s' }}>
              <span style={{ position: 'absolute', top: 2, left: config.enabled ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: '#fff', transition: 'left .15s' }} />
            </span>
          </button>
        )}
      />

      {isLoading || !data || !config ? <Spinner /> : (
        <div className="space-y-4">
          {err && (
            <div className="rounded-lg px-3 py-2" style={{ background: '#FEE2E2', color: '#B91C1C', fontSize: 13 }}>{err}</div>
          )}

          {data.rules.length > 0 && data.rules.every((r) => !r.pushEnabled) && (
            <div className="rounded-lg px-3 py-2 flex items-center gap-2" style={{ background: '#FFFBEB', color: '#92400E', fontSize: 12.5 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              No rep has notifications on — turn them on under My Account.
            </div>
          )}

          <CoverageCalendar
            rules={data.rules}
            people={data.people.filter((p) => p.role === 'sales_rep' || data.rules.some((r) => r.user._id === p._id))}
            splits={config.hourSplits ?? []}
            saving={applyRoster.isPending}
            error={rosterErr}
            onApply={(change) => applyRoster.mutate(change)}
          />

        </div>
      )}
    </div>
  )
}

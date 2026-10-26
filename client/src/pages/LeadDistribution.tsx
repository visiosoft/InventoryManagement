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
 * Nobody on: the out-of-hours people take turns, or the lead waits for the
 * next shift. Nothing else decides — the roster is the whole rule.
 */

const MUTED = 'rgba(20,8,31,.55)'


type Person = { _id: string; name: string; email?: string; role: string }
type Rule = {
  _id: string
  user: Person
  weeklyShifts?: Shift[]
  rosterManaged?: boolean
  color?: string
  pushEnabled: boolean
}
type Data = {
  config: { enabled: boolean; hourSplits?: HourSplit[]; outOfHoursUsers?: string[] }
  people: Person[]
  /** Everyone active — anybody can be an out-of-hours person. */
  staff: Person[]
  rules: Rule[]
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

          <OutOfHours
            staff={data.staff}
            chosen={config.outOfHoursUsers ?? []}
            busy={saveConfig.isPending}
            onChange={(ids) => saveConfig.mutate({ outOfHoursUsers: ids })}
          />

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

/* Who takes leads when nobody is on the roster. They take turns; nobody
   chosen means the lead waits for the next shift. */
function OutOfHours({ staff, chosen, busy, onChange }: {
  staff: Person[]
  chosen: string[]
  busy: boolean
  onChange: (ids: string[]) => void
}) {
  const nameOf = (id: string) => staff.find((p) => p._id === id)?.name ?? 'Someone no longer active'
  const others = staff.filter((p) => !chosen.includes(p._id))
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5" style={{ background: '#fff', border: '1px solid rgba(20,8,31,.08)', fontSize: 13 }}>
      <span style={{ fontWeight: 700 }}>Out of hours</span>
      <span style={{ color: MUTED }}>→</span>
      {chosen.length === 0 && <span style={{ color: MUTED }}>waits for the next shift</span>}
      {chosen.map((id) => (
        <span key={id} className="inline-flex items-center gap-1.5" style={{ padding: '3px 6px 3px 10px', borderRadius: 999, background: '#F3F0FA', fontWeight: 600 }}>
          {nameOf(id)}
          <button type="button" disabled={busy} aria-label={`Remove ${nameOf(id)}`} onClick={() => onChange(chosen.filter((x) => x !== id))}
            style={{ width: 18, height: 18, borderRadius: 999, border: 'none', background: 'transparent', cursor: 'pointer', color: MUTED, lineHeight: 1 }}>×</button>
        </span>
      ))}
      {chosen.length > 1 && <span style={{ color: MUTED, fontSize: 12 }}>take turns</span>}
      {others.length > 0 && (
        <select value="" disabled={busy} onChange={(e) => e.target.value && onChange([...chosen, e.target.value])}
          aria-label="Add an out-of-hours person"
          style={{ marginLeft: 'auto', fontSize: 12.5, padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(20,8,31,.12)', background: '#fff', color: '#4A1FA0', fontWeight: 600 }}>
          <option value="">+ Add</option>
          {others.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
      )}
    </div>
  )
}

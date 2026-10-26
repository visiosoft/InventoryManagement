import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { PageHeader, Card, CardBody, Spinner, Button } from '../components/ui'
import CoverageCalendar, { type HourSplit, type Shift } from '../components/CoverageCalendar'

/**
 * Who gets the next WhatsApp lead: whoever is on the weekly calendar at that
 * hour. Click an hour to choose who is on and how that hour's leads are split
 * — evenly (they take turns) or by percentage.
 *
 * The other settings (reminder after 15 minutes, what happens out of hours,
 * existing customers) keep the values they were last given.
 */

const INK = '#14081F'
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
        subtitle="Who gets the next WhatsApp lead — whoever is on the calendar at that hour"
      />

      {isLoading || !data || !config ? <Spinner /> : (
        <div className="space-y-5">
          {err && (
            <div className="rounded-lg px-3 py-2" style={{ background: '#FEE2E2', color: '#B91C1C', fontSize: 13 }}>{err}</div>
          )}

          {/* On or off */}
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: INK }}>
                    Distribute new WhatsApp leads automatically
                  </div>
                  <div style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                    {config.enabled
                      ? 'On. New chats are shared out by the rules below.'
                      : 'Off. Every new chat goes to the first user on the system, as it always has.'}
                  </div>
                </div>
                <Button
                  variant={config.enabled ? 'outline' : 'default'}
                  onClick={() => saveConfig.mutate({ enabled: !config.enabled })}
                  disabled={saveConfig.isPending}
                >
                  {config.enabled ? 'Turn off' : 'Turn on'}
                </Button>
              </div>
            </CardBody>
          </Card>

          {data.rules.length > 0 && data.rules.every((r) => !r.pushEnabled) && (
            <div className="rounded-lg px-3 py-2.5 flex items-start gap-2" style={{ background: '#FEF3C7', color: '#92400E', fontSize: 12.5 }}>
              <AlertTriangle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>
                <strong>Nobody would be told.</strong> None of these reps has switched notifications on,
                so a lead would land on their board silently. Each of them needs to open
                <strong> My Account</strong> on the phone or laptop they actually use and turn notifications
                on — once, per device. They will still get an email if one is configured.
              </span>
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

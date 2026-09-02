import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bell, BellOff, Bot, CalendarOff, Check, Plus, Trash2, UserCheck } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { PageHeader, Card, CardHeader, CardBody, Spinner, Field, Input, Select, Button } from '../components/ui'

/**
 * Who gets the next WhatsApp lead.
 *
 * Every inbound chat used to go to whichever user was created first, which is
 * how one admin came to own 252 of them. This is where that is decided
 * instead: a share each, who is away, who is on shift, and a ceiling for
 * anyone who should not be given more than so many in a day.
 *
 * The preview at the bottom exists because a table of percentages is hard to
 * believe. A list of who would actually get the next twenty is not.
 */

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = 'rgba(20,8,31,.55)'
const LINE = 'rgba(20,8,31,.10)'

const DAYS = [['Sun', 0], ['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6]] as const

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
    existingCustomerUser?: string | null
  }
  people: Person[]
  rules: Rule[]
  totalSharePct: number
}

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  active: { bg: '#DCFCE7', fg: '#047857' },
  absent: { bg: '#FEF3C7', fg: '#B45309' },
  paused: { bg: '#F3F4F6', fg: '#4B5563' },
}

const asDate = (v?: string | null) => (v ? String(v).slice(0, 10) : '')

export default function LeadDistribution() {
  const qc = useQueryClient()
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState('')

  const { data, isLoading } = useQuery<Data>({
    queryKey: ['lead-routing'],
    queryFn: () => api.get('/lead-routing').then((r) => r.data),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['lead-routing'] })
    qc.invalidateQueries({ queryKey: ['lead-routing-preview'] })
  }

  const saveConfig = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put('/lead-routing/config', body),
    onSuccess: () => { setErr(''); invalidate() },
    onError: (e) => setErr(apiError(e)),
  })

  const saveRule = useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: Record<string, unknown> }) =>
      api.put(`/lead-routing/rules/${userId}`, body),
    onSuccess: () => { setErr(''); setAdding(''); invalidate() },
    onError: (e) => setErr(apiError(e)),
  })

  const removeRule = useMutation({
    mutationFn: (userId: string) => api.delete(`/lead-routing/rules/${userId}`),
    onSuccess: () => { setErr(''); invalidate() },
    onError: (e) => setErr(apiError(e)),
  })

  const { data: preview } = useQuery<{ order: { name: string | null; reason: string }[]; tallyAfter: { name: string; count: number }[] }>({
    queryKey: ['lead-routing-preview'],
    queryFn: () => api.get('/lead-routing/preview?n=20').then((r) => r.data),
    enabled: Boolean(data?.rules.length),
  })

  const config = data?.config
  const unassigned = (data?.people ?? []).filter((p) => !data?.rules.some((r) => r.user._id === p._id))

  return (
    <div>
      <PageHeader
        title="Lead Distribution"
        subtitle="Who gets the next WhatsApp lead — by share, by who is on shift, and by what has gone out today"
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

          {/* The reps */}
          <Card>
            <CardHeader
              title="Sales reps"
              subtitle={
                data.totalSharePct === 100
                  ? 'Shares add up to 100%'
                  : `Shares add up to ${data.totalSharePct}% — they are treated as proportions, so this still works, but round numbers are easier to reason about`
              }
            />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                    {['Rep', 'Status', 'Share', 'Now due', 'Today', 'Daily cap', 'Working hours', 'While away', 'Alerts', ''].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: MUTED }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rules.map((r) => (
                    <RuleRow
                      key={r._id}
                      rule={r}
                      people={data.people}
                      busy={saveRule.isPending}
                      onSave={(body) => saveRule.mutate({ userId: r.user._id, body })}
                      onRemove={() => removeRule.mutate(r.user._id)}
                    />
                  ))}
                  {!data.rules.length && (
                    <tr><td colSpan={10} style={{ padding: '28px 12px', textAlign: 'center', fontSize: 13, color: MUTED }}>
                      Nobody is in the rotation yet. Add a rep below.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {unassigned.length > 0 && (
              <CardBody>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Add somebody to the rotation">
                    <Select value={adding} onChange={(e) => setAdding(e.target.value)}>
                      <option value="">Choose a person…</option>
                      {unassigned.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.role})</option>)}
                    </Select>
                  </Field>
                  <Button
                    disabled={!adding || saveRule.isPending}
                    onClick={() => saveRule.mutate({ userId: adding, body: { sharePct: 0, status: 'active' } })}
                  >
                    <Plus size={14} /> Add
                  </Button>
                </div>
              </CardBody>
            )}
          </Card>

          {/* The rest */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <CardHeader title="Out of hours" subtitle="When nobody is on shift, or everybody has hit their cap" />
              <CardBody className="space-y-3">
                <Field label="What happens to the chat">
                  <Select
                    value={config.outOfHoursMode}
                    onChange={(e) => saveConfig.mutate({ outOfHoursMode: e.target.value })}
                  >
                    <option value="ai">The assistant answers, and the lead waits for the morning</option>
                    <option value="unassigned">Leave it unassigned</option>
                    <option value="user">Give it to one person</option>
                  </Select>
                </Field>
                {config.outOfHoursMode === 'user' && (
                  <Field label="Who">
                    <Select
                      value={config.outOfHoursUser ?? ''}
                      onChange={(e) => saveConfig.mutate({ outOfHoursUser: e.target.value })}
                    >
                      <option value="">Choose a person…</option>
                      {data.people.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
                    </Select>
                  </Field>
                )}
                <p className="flex items-start gap-2" style={{ fontSize: 12, color: MUTED }}>
                  <Bot size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                  A lead nobody owns is picked up by whoever is due it once shifts start, rather than
                  landing overnight on somebody asleep. The assistant only replies if it is switched on
                  under Settings → AI Assistant.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="People we already deal with" subtitle="A chat from an existing customer is not a new lead" />
              <CardBody className="space-y-3">
                <Field label="Send existing customers to">
                  <Select
                    value={config.existingCustomerUser ?? ''}
                    onChange={(e) => saveConfig.mutate({ existingCustomerUser: e.target.value })}
                  >
                    <option value="">Nobody — keep them in the rotation</option>
                    {data.people.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.role})</option>)}
                  </Select>
                </Field>
                <p className="flex items-start gap-2" style={{ fontSize: 12, color: MUTED }}>
                  <UserCheck size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                  Matched on the last nine digits of the number, the same way the inbox decides to show
                  the green <strong>Customer</strong> tag. They skip the rotation entirely, so a tenant
                  with a question does not count against anybody's share.
                </p>
              </CardBody>
            </Card>
          </div>

          {/* Proof */}
          {preview && (
            <Card>
              <CardHeader
                title="What would happen next"
                subtitle="The next twenty leads, from where today already stands. Nothing is saved."
              />
              <CardBody className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {preview.order.map((o, i) => (
                    <span
                      key={i}
                      title={o.reason}
                      className="rounded-full px-2.5 py-1"
                      style={{
                        fontSize: 11.5, fontWeight: 600,
                        background: o.name ? '#F3EDFF' : '#FEF3C7',
                        color: o.name ? PURPLE : '#B45309',
                      }}
                    >
                      {i + 1}. {o.name ?? 'nobody available'}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 12.5, color: MUTED }}>
                  Leaving today at: {preview.tallyAfter.map((t) => `${t.name} ${t.count}`).join(' · ')}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function RuleRow({ rule, people, busy, onSave, onRemove }: {
  rule: Rule
  people: Person[]
  busy: boolean
  onSave: (body: Record<string, unknown>) => void
  onRemove: () => void
}) {
  const [share, setShare] = useState(String(rule.sharePct))
  const [cap, setCap] = useState(String(rule.dailyCap || ''))
  const cell = { padding: '10px 12px', fontSize: 13, verticalAlign: 'top' as const }
  const tone = STATUS_TONE[rule.status] ?? STATUS_TONE.active
  const hours = rule.workingHours ?? {}

  return (
    <tr style={{ borderBottom: `1px solid ${LINE}` }}>
      <td style={cell}>
        <div style={{ fontWeight: 600, color: INK }}>{rule.user.name}</div>
        <div style={{ fontSize: 11.5, color: MUTED }}>{rule.user.role}</div>
      </td>

      <td style={cell}>
        <Select
          value={rule.status}
          onChange={(e) => onSave({ status: e.target.value })}
          style={{ background: tone.bg, color: tone.fg, fontWeight: 600 }}
        >
          <option value="active">Active</option>
          <option value="absent">Absent</option>
          <option value="paused">Paused</option>
        </Select>
        {rule.status === 'absent' && (
          <div className="flex items-center gap-1 mt-1.5">
            <Input type="date" value={asDate(rule.absentFrom)} onChange={(e) => onSave({ absentFrom: e.target.value || null })} style={{ fontSize: 11.5, padding: '3px 6px' }} />
            <span style={{ fontSize: 11, color: MUTED }}>→</span>
            <Input type="date" value={asDate(rule.absentTo)} onChange={(e) => onSave({ absentTo: e.target.value || null })} style={{ fontSize: 11.5, padding: '3px 6px' }} />
          </div>
        )}
      </td>

      <td style={cell}>
        <div className="flex items-center gap-1">
          <Input
            value={share}
            onChange={(e) => setShare(e.target.value)}
            onBlur={() => Number(share) !== rule.sharePct && onSave({ sharePct: Number(share) || 0 })}
            style={{ width: 62, fontVariantNumeric: 'tabular-nums' }}
            disabled={busy}
          />
          <span style={{ color: MUTED }}>%</span>
        </div>
      </td>

      <td style={{ ...cell, fontVariantNumeric: 'tabular-nums' }}>
        {rule.unavailableBecause ? (
          <span style={{ color: '#B45309', fontSize: 12 }}>—</span>
        ) : (
          <span style={{ fontWeight: 700, color: rule.effectivePct !== rule.sharePct ? PURPLE : INK }}>
            {rule.effectivePct}%
          </span>
        )}
        {rule.unavailableBecause && (
          <div className="flex items-center gap-1" style={{ fontSize: 11, color: '#B45309' }}>
            <CalendarOff size={11} /> {rule.unavailableBecause}
          </div>
        )}
      </td>

      <td style={{ ...cell, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{rule.todayCount}</td>

      <td style={cell}>
        <Input
          value={cap}
          placeholder="none"
          onChange={(e) => setCap(e.target.value)}
          onBlur={() => Number(cap || 0) !== rule.dailyCap && onSave({ dailyCap: Number(cap) || 0 })}
          style={{ width: 74, fontVariantNumeric: 'tabular-nums' }}
          disabled={busy}
        />
      </td>

      <td style={cell}>
        <div className="flex items-center gap-1">
          <Input type="time" value={hours.start ?? ''} onChange={(e) => onSave({ workingHours: { ...hours, start: e.target.value } })} style={{ fontSize: 12, padding: '3px 6px' }} />
          <span style={{ fontSize: 11, color: MUTED }}>–</span>
          <Input type="time" value={hours.end ?? ''} onChange={(e) => onSave({ workingHours: { ...hours, end: e.target.value } })} style={{ fontSize: 12, padding: '3px 6px' }} />
        </div>
        <div className="flex gap-0.5 mt-1">
          {DAYS.map(([label, n]) => {
            const on = !hours.days?.length || hours.days.includes(n)
            return (
              <button
                key={n}
                type="button"
                title={`${label}${on ? '' : ' — off'}`}
                onClick={() => {
                  const current = hours.days?.length ? hours.days : DAYS.map(([, d]) => d)
                  const next = current.includes(n) ? current.filter((d) => d !== n) : [...current, n]
                  onSave({ workingHours: { ...hours, days: next } })
                }}
                style={{
                  fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 4px', cursor: 'pointer',
                  border: `1px solid ${on ? PURPLE : LINE}`,
                  background: on ? '#F3EDFF' : 'transparent',
                  color: on ? PURPLE : MUTED,
                }}
              >
                {label[0]}
              </button>
            )
          })}
        </div>
      </td>

      <td style={cell}>
        <Select value={rule.fallbackMode} onChange={(e) => onSave({ fallbackMode: e.target.value })} style={{ fontSize: 12 }}>
          <option value="pool">Share it out</option>
          <option value="user">One stand-in</option>
        </Select>
        {rule.fallbackMode === 'user' && (
          <Select
            value={rule.fallbackUser?._id ?? ''}
            onChange={(e) => onSave({ fallbackUser: e.target.value || null })}
            style={{ fontSize: 12, marginTop: 4 }}
          >
            <option value="">Choose…</option>
            {people.filter((p) => p._id !== rule.user._id).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </Select>
        )}
      </td>

      <td style={cell}>
        {/* A lead they are never told about is a lead they find tomorrow. */}
        {rule.pushEnabled ? (
          <span className="inline-flex items-center gap-1" style={{ fontSize: 11.5, color: '#047857' }} title="Gets a notification the moment a lead lands">
            <Bell size={12} /> On
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1"
            style={{ fontSize: 11.5, color: '#B45309' }}
            title={`${rule.user.name} has not switched notifications on. They need to open My Account on the device they use and turn them on — until then a lead lands silently.`}
          >
            <BellOff size={12} /> Off
          </span>
        )}
      </td>

      <td style={{ ...cell, textAlign: 'right' }}>
        <button
          type="button"
          onClick={() => { if (confirm(`Take ${rule.user.name} out of the rotation?`)) onRemove() }}
          title="Take out of the rotation"
          style={{ color: '#DC2626', cursor: 'pointer', background: 'none', border: 'none' }}
        >
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  )
}

export { AlertTriangle, Check }

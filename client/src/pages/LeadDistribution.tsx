import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bell, BellOff, Bot, Clock, Plus, Trash2, UserCheck } from 'lucide-react'
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
    /* The clock on a lead nobody has answered, in minutes. 0 turns either
       half off. */
    slaNudgeMinutes?: number
    slaReassignMinutes?: number
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

  /* The customer chats already in the inbox, which the setting below does
     nothing about — it only decides where the next one goes. */
  const { data: customerChats } = useQuery<{
    chats: number; withLead: number; withoutLead: number
    byOwner: { name: string; count: number }[]
  }>({
    queryKey: ['lead-routing', 'customer-chats'],
    queryFn: () => api.get('/lead-routing/customer-chats').then((r) => r.data),
  })

  const [handTo, setHandTo] = useState('')
  const [handed, setHanded] = useState('')
  const handOver = useMutation({
    mutationFn: (userId: string) => api.post('/lead-routing/customer-chats/assign', { userId }).then((r) => r.data),
    onSuccess: (d: { moved: number; alreadyTheirs: number; owner: string }) => {
      setErr('')
      setHanded(d.moved
        ? `${d.moved} chat${d.moved === 1 ? '' : 's'} handed to ${d.owner}.`
        : `They already had all ${d.alreadyTheirs} of them.`)
      qc.invalidateQueries({ queryKey: ['lead-routing'] })
    },
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
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                    {['Rep', 'Status', 'Share', 'Working hours', ''].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: MUTED }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rules.map((r) => (
                    <RuleRow
                      key={r._id}
                      rule={r}
                      busy={saveRule.isPending}
                      onSave={(body) => saveRule.mutate({ userId: r.user._id, body })}
                      onRemove={() => removeRule.mutate(r.user._id)}
                    />
                  ))}
                  {!data.rules.length && (
                    <tr><td colSpan={5} style={{ padding: '28px 12px', textAlign: 'center', fontSize: 13, color: MUTED }}>
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
              <CardHeader title="When a lead is not answered" subtitle="Handing it over is not the same as somebody replying" />
              <CardBody className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Remind the owner after">
                    <Select
                      value={String(config.slaNudgeMinutes ?? 15)}
                      onChange={(e) => saveConfig.mutate({ slaNudgeMinutes: Number(e.target.value) })}
                    >
                      <option value="0">Never</option>
                      {[5, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                    </Select>
                  </Field>
                  <Field label="Give it to somebody else after">
                    <Select
                      value={String(config.slaReassignMinutes ?? 30)}
                      onChange={(e) => saveConfig.mutate({ slaReassignMinutes: Number(e.target.value) })}
                    >
                      <option value="0">Never — leave it with them</option>
                      {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
                    </Select>
                  </Field>
                </div>
                <p className="flex items-start gap-2" style={{ fontSize: 12, color: MUTED }}>
                  <Clock size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                  The clock stops when the rep logs an attempt or moves the stage — opening the lead does
                  not count. A lead is only ever moved once, and never moved at all when there is nobody
                  else on shift to take it; in that case the owner is reminded instead.
                </p>
              </CardBody>
            </Card>

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

                {/* The setting above is about the next chat. This is about the
                    ones already sitting in the inbox. */}
                {customerChats && customerChats.chats > 0 && (
                  <div className="rounded-lg p-3 space-y-2" style={{ background: '#FBF8F3', border: `1px solid ${LINE}` }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>
                      {customerChats.chats} chats are already from customers
                    </div>
                    <div style={{ fontSize: 12, color: MUTED }}>
                      Currently with {customerChats.byOwner.slice(0, 3).map((o) => `${o.name} (${o.count})`).join(', ')}
                      {customerChats.byOwner.length > 3 ? ` and ${customerChats.byOwner.length - 3} more` : ''}.
                      {customerChats.withoutLead > 0 && ` ${customerChats.withoutLead} have no lead behind them yet and cannot be handed over.`}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <Select value={handTo} onChange={(e) => { setHandTo(e.target.value); setHanded('') }} style={{ minWidth: 190 }}>
                        <option value="">Hand them all to…</option>
                        {data.people.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.role})</option>)}
                      </Select>
                      <Button
                        disabled={!handTo || handOver.isPending}
                        onClick={() => {
                          const who = data.people.find((p) => p._id === handTo)?.name ?? 'them'
                          if (confirm(`Hand all ${customerChats.withLead} customer chats to ${who}? Each becomes new to them and starts their response clock.`)) {
                            handOver.mutate(handTo)
                          }
                        }}
                      >
                        {handOver.isPending ? 'Handing over…' : `Hand over ${customerChats.withLead}`}
                      </Button>
                    </div>
                    {handed && <div style={{ fontSize: 12, color: '#047857', fontWeight: 600 }}>{handed}</div>}
                  </div>
                )}
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

/* Common shifts as one click each, because that is what people actually work.
   Custom is there for the exception rather than being the only way in — two
   time fields and seven day toggles on every row was a lot of furniture for
   "she works normal hours". */
const SHIFTS = [
  { key: 'any', label: 'Any time', start: '', end: '' },
  { key: 'day', label: '9am - 6pm', start: '09:00', end: '18:00' },
  { key: 'early', label: '8am - 5pm', start: '08:00', end: '17:00' },
  { key: 'late', label: '12pm - 9pm', start: '12:00', end: '21:00' },
] as const

function RuleRow({ rule, busy, onSave, onRemove }: {
  rule: Rule
  busy: boolean
  onSave: (body: Record<string, unknown>) => void
  onRemove: () => void
}) {
  const [share, setShare] = useState(String(rule.sharePct))
  const cell = { padding: '12px', fontSize: 13, verticalAlign: 'middle' as const }
  const tone = STATUS_TONE[rule.status] ?? STATUS_TONE.active
  const hours = rule.workingHours ?? {}

  const matched = SHIFTS.find((sh) => sh.start === (hours.start ?? '') && sh.end === (hours.end ?? ''))
  const [custom, setCustom] = useState(!matched)
  const days = hours.days?.length ? hours.days : DAYS.map(([, d]) => d)

  return (
    <tr style={{ borderBottom: `1px solid ${LINE}` }}>
      <td style={cell}>
        <div className="flex items-center gap-1.5">
          <span style={{ fontWeight: 600, color: INK }}>{rule.user.name}</span>
          {/* A lead nobody is told about is a lead found tomorrow, so this sits
              beside the name rather than taking a column of its own. */}
          {rule.pushEnabled
            ? <Bell size={12} style={{ color: '#047857' }} />
            : <BellOff size={12} style={{ color: '#B45309' }} />}
        </div>
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 1 }}>
          {rule.unavailableBecause
            ? <span style={{ color: '#B45309' }}>{rule.unavailableBecause}</span>
            : <>due {rule.effectivePct}% now, {rule.todayCount} today</>}
        </div>
      </td>

      <td style={cell}>
        <Select
          value={rule.status}
          onChange={(e) => onSave({ status: e.target.value })}
          style={{ background: tone.bg, color: tone.fg, fontWeight: 600, minWidth: 108 }}
        >
          <option value="active">Active</option>
          <option value="absent">Absent</option>
          <option value="paused">Paused</option>
        </Select>
        {rule.status === 'absent' && (
          <div className="flex items-center gap-1 mt-1.5">
            <Input type="date" value={asDate(rule.absentFrom)} onChange={(e) => onSave({ absentFrom: e.target.value || null })} style={{ fontSize: 11.5, padding: '3px 6px' }} />
            <span style={{ fontSize: 11, color: MUTED }}>to</span>
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
            style={{ width: 64, fontVariantNumeric: 'tabular-nums' }}
            disabled={busy}
          />
          <span style={{ color: MUTED }}>%</span>
        </div>
      </td>

      <td style={cell}>
        <Select
          value={custom ? 'custom' : (matched ? matched.key : 'any')}
          onChange={(e) => {
            if (e.target.value === 'custom') { setCustom(true); return }
            setCustom(false)
            const sh = SHIFTS.find((x) => x.key === e.target.value)
            if (sh) onSave({ workingHours: { days: [], start: sh.start, end: sh.end } })
          }}
          style={{ minWidth: 132 }}
        >
          {SHIFTS.map((sh) => <option key={sh.key} value={sh.key}>{sh.label}</option>)}
          <option value="custom">Custom...</option>
        </Select>

        {custom && (
          <div className="mt-1.5 space-y-1.5">
            <div className="flex items-center gap-1">
              <Input type="time" value={hours.start ?? ''} onChange={(e) => onSave({ workingHours: { ...hours, start: e.target.value } })} style={{ fontSize: 12, padding: '3px 6px' }} />
              <span style={{ fontSize: 11, color: MUTED }}>to</span>
              <Input type="time" value={hours.end ?? ''} onChange={(e) => onSave({ workingHours: { ...hours, end: e.target.value } })} style={{ fontSize: 12, padding: '3px 6px' }} />
            </div>
            <div className="flex gap-1">
              {DAYS.map(([label, n]) => {
                const on = days.includes(n)
                return (
                  <button
                    key={n}
                    type="button"
                    title={label}
                    onClick={() => {
                      const next = on ? days.filter((d) => d !== n) : [...days, n]
                      // All seven is the same as no restriction, and stores smaller.
                      onSave({ workingHours: { ...hours, days: next.length === 7 ? [] : next } })
                    }}
                    style={{
                      width: 26, height: 26, fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                      border: `1px solid ${on ? PURPLE : LINE}`,
                      background: on ? PURPLE : 'transparent',
                      color: on ? '#fff' : MUTED,
                    }}
                  >
                    {label[0]}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </td>

      <td style={{ ...cell, textAlign: 'right' }}>
        <button
          type="button"
          onClick={() => { if (confirm(`Take ${rule.user.name} out of the rotation?`)) onRemove() }}
          title="Take out of the rotation"
          style={{ color: '#DC2626', cursor: 'pointer', background: 'none', border: 'none' }}
        >
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  )
}


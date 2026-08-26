import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Calendar, Clock, FileText, Mail, MessageCircle, MessageSquare,
  PackageCheck, Pencil, Phone, Repeat, UserCheck, UserPlus,
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Spinner, statusLabel, LEAD_STATUS_FLOW, LEAD_TEMPERATURES, LEAD_TAGS } from '../components/ui'
import { formatDate } from '../lib/utils'

const INK = '#14081F'
const INK_2 = '#4A4357'
const FAINT = '#756E80'
const PURPLE = '#5B2BC9'
const DEEP = '#4A1FA0'
const PURPLE_50 = '#F7F3FF'
const PURPLE_100 = '#EDE5FF'
const PURPLE_200 = '#DDD0FF'
const CREAM_2 = '#EDE3CF'
const PAGE = '#FBF8F2'
const LINE = 'rgba(20,8,31,0.10)'
const LINE_STRONG = 'rgba(20,8,31,0.16)'
const HOT = '#DC2626'
const WARM = '#D97706'
const SHADOW_SM = '0 1px 2px rgba(20,8,31,.06), 0 2px 8px rgba(20,8,31,.04)'
const SHADOW_MD = '0 8px 24px rgba(20,8,31,.08), 0 2px 6px rgba(20,8,31,.04)'
const DISPLAY = { fontFamily: "'Bricolage Grotesque', serif", letterSpacing: '-0.02em' } as const

const FOLLOW_UP_KINDS = [
  { value: 'date' as const, label: 'On a date' },
  { value: 'week' as const, label: 'That week' },
  { value: 'month' as const, label: 'That month' },
]

/**
 * The day the reminder will actually be raised — mirrors notifyDayFor on the
 * server. Display only: the server decides, this just stops the choice being
 * a guess about what will happen.
 */
function reminderDay(followUpAt?: string | null, kind: 'date' | 'week' | 'month' = 'date'): string {
  if (!followUpAt) return ''
  const day = String(followUpAt).slice(0, 10)
  if (kind === 'month') return `${day.slice(0, 7)}-01`
  if (kind !== 'week') return day
  const midnight = new Date(`${day}T00:00:00.000Z`)
  const weekday = midnight.getUTCDay()
  // Sunday closes the week it belongs to rather than opening the next one.
  const back = weekday === 0 ? 6 : weekday - 1
  return new Date(midnight.getTime() - back * 86_400_000).toISOString().slice(0, 10)
}

type Urgency = {
  color: string; bg: string; border: string
  icon: typeof Clock
  label: string
}

/**
 * How loudly the follow-up should announce itself.
 *
 * A bare date makes the reader do the arithmetic. Overdue and due-today are
 * the two states worth interrupting somebody over, so they are the two that
 * change colour.
 */
function followUpUrgency(day: string): Urgency {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const at = new Date(`${day}T00:00:00`)
  const days = Math.round((at.getTime() - today.getTime()) / 86_400_000)
  const label = formatDate(day)

  if (days < 0) {
    return {
      color: HOT, bg: 'rgba(220,38,38,.09)', border: 'rgba(220,38,38,.25)',
      icon: AlertTriangle, label: `Overdue — follow up was due ${label}`,
    }
  }
  if (days === 0) {
    return {
      color: WARM, bg: 'rgba(217,119,6,.09)', border: 'rgba(217,119,6,.25)',
      icon: Clock, label: `Follow up today, ${label}`,
    }
  }
  if (days <= 3) {
    return {
      color: WARM, bg: 'rgba(217,119,6,.09)', border: 'rgba(217,119,6,.25)',
      icon: Clock, label: `Follow up on ${label} (in ${days} day${days === 1 ? '' : 's'})`,
    }
  }
  return {
    color: DEEP, bg: PURPLE_50, border: PURPLE_100,
    icon: Calendar, label: `Follow up on ${label}`,
  }
}

/** Icon and colour per kind of thing that happened. */
const EVENT_STYLE: Record<string, { icon: typeof Pencil; bg: string; color: string }> = {
  created: { icon: UserPlus, bg: PURPLE_50, color: DEEP },
  // Both real types in production: a thread that created the lead by itself,
  // and the messages on it.
  whatsapp_created: { icon: UserPlus, bg: 'rgba(22,163,74,.09)', color: '#047857' },
  whatsapp_message: { icon: MessageCircle, bg: 'rgba(22,163,74,.09)', color: '#047857' },
  status_changed: { icon: Repeat, bg: PURPLE_50, color: DEEP },
  note: { icon: MessageSquare, bg: 'rgba(217,119,6,.09)', color: WARM },
  comment: { icon: MessageSquare, bg: 'rgba(217,119,6,.09)', color: WARM },
  updated: { icon: Pencil, bg: CREAM_2, color: INK_2 },
}

type Owner = { _id: string; name: string; email: string }
type Lead = {
  _id: string; fullName: string; email: string; phone: string; whatsappNo: string
  phoneNormalized: string; status: string; owner: Owner | null; notes: string
  leadDateTime: string; source: string
  temperature?: '' | 'hot' | 'warm' | 'cold'
  tags?: string[]
  followUpAt?: string | null
  followUpKind?: 'date' | 'week' | 'month'
  followUpNotifiedAt?: string | null
  storageSizeValue?: number
  storageSizeUnit?: string
  unitsNeeded?: number
}
type Customer = {
  _id: string; fullName: string; email: string; phone: string; phones: string[]
  company: string; nationality: string; emergencyNumber: string; address: string
  emiratesId: string; eidExpiry: string | null; passportNumber: string; notes: string
}
type ContractRow = {
  _id: string; contractNo: string; status: string; startDate: string; endDate: string
  rate: number; unit: { unitNumber: string } | null; units: { unitNumber: string }[]
}
type TimelineEntry = { at: string; type: string; text: string; user?: { name: string } | null }

type Profile = {
  lead: (Lead & { timeline?: TimelineEntry[] }) | null
  customer: Customer | null
  contracts: ContractRow[]
  documents: { _id: string; name: string; type: string; url: string; createdAt: string }[]
  stage: 'lead' | 'customer' | 'unknown'
}

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  new: { bg: PURPLE_50, fg: DEEP },
  contact_attempted: { bg: '#FEF3C7', fg: '#92400E' },
  contacted: { bg: PURPLE_100, fg: DEEP },
  follow_up_scheduled: { bg: 'rgba(217,119,6,.09)', fg: WARM },
  quotation_sent: { bg: CREAM_2, fg: INK_2 },
  won: { bg: 'rgba(22,163,74,.09)', fg: '#16A34A' },
  lost: { bg: 'rgba(117,110,128,.09)', fg: FAINT },
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 22, boxShadow: SHADOW_SM, padding: 22 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
        <h3 style={{ ...DISPLAY, fontSize: 16, fontWeight: 700, margin: 0 }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span style={{ fontSize: 13, color: FAINT }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: value ? INK : FAINT, textAlign: 'right' }}>{value || '—'}</span>
    </div>
  )
}

/** "26 Aug 2026 · 09:12 · Sales" — when it happened, and who did it. */
function eventMeta(t: TimelineEntry): string {
  const d = new Date(t.at)
  const time = Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return [formatDate(t.at), time, t.user?.name].filter(Boolean).join(' · ')
}

export default function PersonProfile() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  // A stage picked but not yet committed, and the note going with it.
  const [pendingStage, setPendingStage] = useState('')
  const [stageNote, setStageNote] = useState('')

  const { data, isLoading } = useQuery<Profile>({
    queryKey: ['person', id],
    queryFn: () => api.get(`/leads/${id}/profile`).then((r) => r.data),
    enabled: Boolean(id),
  })

  // Only admins reassign. A rep seeing the dropdown would only meet a refusal.
  const { data: assignable = [] } = useQuery<Owner[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['person', id] })

  const setStatus = useMutation({
    mutationFn: ({ status, comment }: { status: string; comment?: string }) =>
      api.patch(`/leads/${data!.lead!._id}/status`, { status, comment }),
    onSuccess: () => { setErr(''); setPendingStage(''); setStageNote(''); refresh() },
    onError: (e) => setErr(apiError(e)),
  })

  // Temperature, tags and the follow-up date all go through the same update,
  // so one edit cannot half-apply.
  const patchLead = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/leads/${data!.lead!._id}`, body),
    onSuccess: () => { setErr(''); refresh() },
    onError: (e) => setErr(apiError(e)),
  })

  const addNote = useMutation({
    mutationFn: () => api.post(`/leads/${data!.lead!._id}/notes`, { text: note.trim() }),
    onSuccess: () => { setNote(''); setErr(''); refresh() },
    onError: (e) => setErr(apiError(e)),
  })

  const assign = useMutation({
    mutationFn: (owner: string) => api.put(`/leads/${data!.lead!._id}`, { owner }),
    onSuccess: () => { setErr(''); refresh() },
    onError: (e) => setErr(apiError(e)),
  })

  if (isLoading) return <div style={{ padding: 60 }}><Spinner /></div>
  if (!data) return <p style={{ padding: 40, color: FAINT }}>Nobody found with that id.</p>

  const { lead, customer, contracts, documents, stage } = data
  const name = customer?.fullName || lead?.fullName || 'Unnamed'
  const phone = customer?.phone || lead?.phone || ''
  const email = customer?.email || lead?.email || ''
  const waNumber = (lead?.phoneNormalized || phone).replace(/\D/g, '')
  const isCustomer = stage === 'customer'
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '—'

  // Book Unit already accepts either, so the wizard opens with them filled in.
  const bookHref = isCustomer ? `/quotes/new?customer=${customer!._id}` : `/quotes/new?lead=${lead?._id ?? ''}`

  const statusTone = isCustomer
    ? { bg: 'rgba(22,163,74,.09)', fg: '#16A34A' }
    : STATUS_TONE[lead?.status ?? 'new'] ?? { bg: PURPLE_50, fg: DEEP }
  const temp = LEAD_TEMPERATURES.find((t) => t.value === lead?.temperature)
  const pkg = lead?.storageSizeValue
    ? `${lead.storageSizeValue} ${lead.storageSizeUnit || 'sqft'}${(lead.unitsNeeded ?? 1) > 1 ? ` · ${lead.unitsNeeded} units` : ''}`
    : ''

  const dueDay = reminderDay(lead?.followUpAt, lead?.followUpKind)
  const urgency = dueDay ? followUpUrgency(dueDay) : null
  // Newest first: what happened last is what somebody picking this up reads.
  const timeline = [...(lead?.timeline ?? [])].reverse()

  return (
    <div style={{ background: PAGE, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK }}>
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center justify-center cursor-pointer"
        style={{ width: 34, height: 34, borderRadius: 999, border: `1px solid ${LINE_STRONG}`, background: '#fff', color: INK_2, marginBottom: 16 }}
        aria-label="Back"
      >
        <ArrowLeft size={16} />
      </button>

      {/* ── Header card ───────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 22, boxShadow: SHADOW_SM, padding: '26px 28px', marginBottom: 20 }}>
        <div className="flex items-start justify-between flex-wrap" style={{ gap: 20 }}>
          <div className="flex items-start" style={{ gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: 999, background: PURPLE_100, color: DEEP, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18, flex: '0 0 auto' }}>
              {initials}
            </div>
            <div>
              <h1 style={{ ...DISPLAY, fontSize: 24, fontWeight: 700, margin: 0 }}>{name}</h1>
              <div className="flex items-center flex-wrap" style={{ gap: 8, marginTop: 8 }}>
                <span className="inline-flex rounded-full" style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, background: statusTone.bg, color: statusTone.fg }}>
                  {isCustomer ? 'Customer' : statusLabel(lead?.status ?? 'new')}
                </span>
                {temp && (
                  <span className="inline-flex rounded-full" style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, background: temp.bg, color: temp.fg }}>
                    {temp.label}
                  </span>
                )}
                {pkg && (
                  <span className="inline-flex rounded-full" style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, background: PURPLE_50, color: DEEP }}>
                    {pkg}
                  </span>
                )}
              </div>
              {phone && (
                <div className="flex items-center" style={{ gap: 6, marginTop: 10, color: INK_2, fontSize: 14, fontWeight: 500 }}>
                  <Phone size={14} style={{ color: FAINT }} />
                  <span>{phone}</span>
                </div>
              )}
              {email && (
                <div className="flex items-center" style={{ gap: 6, marginTop: 4, color: INK_2, fontSize: 14, fontWeight: 500 }}>
                  <Mail size={14} style={{ color: FAINT }} />
                  <a href={`mailto:${email}`} style={{ color: INK_2 }}>{email}</a>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap" style={{ gap: 10 }}>
            {phone && (
              <a href={`tel:${phone}`} className="inline-flex items-center" style={{ gap: 8, height: 44, padding: '0 18px', borderRadius: 999, border: `1px solid ${LINE_STRONG}`, background: '#fff', color: INK, fontWeight: 600, fontSize: 14 }}>
                <Phone size={16} /> Call
              </a>
            )}
            {/* Our own inbox, not wa.me: the thread we already hold, with its
                history, rather than the phone's copy of it. */}
            {waNumber && (
              <Link to={`/whatsapp?phone=${waNumber}`} className="inline-flex items-center cursor-pointer" style={{ gap: 8, height: 44, padding: '0 18px', borderRadius: 999, border: `1px solid ${PURPLE_200}`, background: PURPLE_50, color: DEEP, fontWeight: 600, fontSize: 14 }}>
                <MessageCircle size={16} /> Chat
              </Link>
            )}
            {/* Available at both stages: the wizard creates the customer when a
                lead is booked, which is the point at which they become one. */}
            <Link to={bookHref} className="inline-flex items-center cursor-pointer" style={{ gap: 8, height: 44, padding: '0 20px', borderRadius: 999, border: 'none', background: PURPLE, color: '#fff', fontWeight: 700, fontSize: 14, boxShadow: SHADOW_MD, whiteSpace: 'nowrap' }}>
              <PackageCheck size={16} /> Book unit
            </Link>
          </div>
        </div>

        {/* The one time-critical fact, said in words rather than left as a date
            for the reader to work out. */}
        {urgency && (
          <div className="flex items-center" style={{ gap: 10, marginTop: 18, padding: '14px 18px', borderRadius: 16, background: urgency.bg, border: `1px solid ${urgency.border}` }}>
            <urgency.icon size={17} style={{ color: urgency.color, flex: '0 0 auto' }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: urgency.color }}>{urgency.label}</span>
          </div>
        )}

        {err && <p style={{ fontSize: 12.5, color: '#C0392B', marginTop: 12 }}>{err}</p>}
      </div>

      {/* ── Body: details and ownership beside the running account ────────── */}
      <div className="flex flex-wrap items-start" style={{ gap: 20 }}>

        <div className="flex flex-col" style={{ flex: '1 1 340px', maxWidth: 380, gap: 20 }}>
          <Card title="Contact details">
            <div className="flex flex-col" style={{ gap: 14 }}>
              <Detail label="Phone" value={phone} />
              <Detail label="WhatsApp" value={lead?.whatsappNo || phone} />
              <Detail label="Email" value={email} />
              {customer && <>
                <Detail label="Company" value={customer.company} />
                <Detail label="Nationality" value={customer.nationality} />
                <Detail label="Emergency contact" value={customer.emergencyNumber} />
                <Detail label="Emirates ID" value={customer.emiratesId} />
                <Detail label="ID expiry" value={customer.eidExpiry ? formatDate(customer.eidExpiry) : ''} />
                <Detail label="Address" value={customer.address} />
              </>}
              {lead && <>
                <Detail label="Source" value={lead.source} />
                <Detail label="First seen" value={formatDate(lead.leadDateTime)} />
              </>}
            </div>
          </Card>

          {lead && (
            <Card title="Ownership & status">
              <div className="flex flex-col" style={{ gap: 16 }}>
                <div>
                  <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Assigned to</span>
                  {isAdmin ? (
                    <select
                      value={lead.owner?._id ?? ''}
                      onChange={(e) => assign.mutate(e.target.value)}
                      disabled={assign.isPending}
                      className="cursor-pointer"
                      style={{ width: '100%', height: 42, padding: '0 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontWeight: 600, color: INK, fontFamily: 'inherit' }}
                    >
                      <option value="">Nobody</option>
                      {assignable.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
                    </select>
                  ) : (
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{lead.owner?.name || 'Nobody'}</div>
                  )}
                </div>

                <div>
                  <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Stage</span>
                  <select
                    value={pendingStage || lead.status}
                    onChange={(e) => {
                      const next = e.target.value
                      // Same stage again is not a change worth recording.
                      if (next === lead.status) { setPendingStage(''); setStageNote(''); return }
                      setPendingStage(next)
                    }}
                    disabled={setStatus.isPending}
                    className="cursor-pointer"
                    style={{ width: '100%', height: 42, padding: '0 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontWeight: 600, color: INK, fontFamily: 'inherit' }}
                  >
                    {LEAD_STATUS_FLOW.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>

                  {/* Moving a stage is the moment somebody knows why. Asking
                      here — rather than leaving them to write it separately —
                      is the difference between a timeline that reads as an
                      account and one that reads as a list of state changes.
                      The note goes with the change in one request, so a stage
                      cannot land without it. */}
                  {pendingStage ? (
                    <div style={{ marginTop: 10, borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: PAGE, padding: 12 }}>
                      <p style={{ fontSize: 12.5, color: FAINT, marginBottom: 8 }}>
                        Moving to <b style={{ color: INK }}>{LEAD_STATUS_FLOW.find((s) => s.value === pendingStage)?.label}</b> — what happened?
                      </p>
                      <textarea
                        value={stageNote}
                        onChange={(e) => setStageNote(e.target.value)}
                        rows={2}
                        autoFocus
                        placeholder={pendingStage === 'lost' ? 'Why did this one go? (worth recording)' : 'Optional — called, no answer…'}
                        style={{ width: '100%', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', color: INK, resize: 'vertical', boxSizing: 'border-box' }}
                      />
                      <div className="flex" style={{ gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          disabled={setStatus.isPending}
                          onClick={() => setStatus.mutate({ status: pendingStage, comment: stageNote.trim() || undefined })}
                          className="cursor-pointer disabled:opacity-50"
                          style={{ height: 36, padding: '0 16px', borderRadius: 999, border: 'none', background: PURPLE, color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}
                        >
                          {setStatus.isPending ? 'Saving…' : 'Save stage'}
                        </button>
                        <button
                          type="button"
                          disabled={setStatus.isPending}
                          onClick={() => { setPendingStage(''); setStageNote('') }}
                          className="cursor-pointer disabled:opacity-50"
                          style={{ height: 36, padding: '0 16px', borderRadius: 999, border: `1px solid ${LINE_STRONG}`, background: '#fff', color: FAINT, fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* What the stage means somebody should do next, so the
                       status is an instruction rather than a label. */
                    <p style={{ fontSize: 12.5, color: FAINT, marginTop: 6 }}>
                      {LEAD_STATUS_FLOW.find((s) => s.value === lead.status)?.next}
                    </p>
                  )}
                </div>

                {/* Temperature sits beside the stage, not inside it: a lead can
                    be Follow-Up Scheduled and hot, or Contacted and cold. */}
                <div>
                  <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Temperature</span>
                  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {LEAD_TEMPERATURES.map((t) => {
                      const on = lead.temperature === t.value
                      return (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => patchLead.mutate({ temperature: on ? '' : t.value })}
                          className="cursor-pointer"
                          style={{
                            height: 40, borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                            border: `1.5px solid ${on ? t.fg : LINE_STRONG}`,
                            background: on ? t.bg : '#fff',
                            color: on ? t.fg : FAINT,
                          }}
                        >
                          {t.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Shown for any open lead, not only Follow-Up Scheduled: a
                    date set while the lead was in that stage still fires after
                    it moves on, and hiding the control left a live reminder
                    nobody could see or change. */}
                {lead.status !== 'won' && lead.status !== 'lost' && (
                  <div>
                    <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Follow-up</span>

                    {/* "Call them in March" is a real answer, and pinning it to
                        an invented day in March fires early or late. The kind
                        says how precisely the date was meant: a week is raised
                        on its Monday, a month on its first. */}
                    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                      {FOLLOW_UP_KINDS.map((k) => {
                        const on = (lead.followUpKind || 'date') === k.value
                        return (
                          <button
                            key={k.value}
                            type="button"
                            onClick={() => patchLead.mutate({ followUpKind: k.value })}
                            className="cursor-pointer"
                            style={{
                              height: 38, borderRadius: 10, fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit',
                              border: `1.5px solid ${on ? PURPLE : LINE_STRONG}`,
                              background: on ? PURPLE_50 : '#fff',
                              color: on ? DEEP : INK_2,
                            }}
                          >
                            {k.label}
                          </button>
                        )
                      })}
                    </div>

                    <input
                      type="date"
                      value={lead.followUpAt ? String(lead.followUpAt).slice(0, 10) : ''}
                      onChange={(e) => patchLead.mutate({ followUpAt: e.target.value || null })}
                      style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontFamily: 'inherit', color: INK, boxSizing: 'border-box' }}
                    />

                    {/* Say exactly where the reminder lands, so a week or a
                        month is never a guess about what the system will do. */}
                    {lead.followUpAt && (
                      <p style={{ fontSize: 12.5, color: FAINT, marginTop: 6 }}>
                        {lead.owner
                          ? `Task on ${lead.owner.name}'s board, due ${formatDate(dueDay)}.`
                          : 'Assign this lead to somebody and a task will be raised for them.'}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Tags</span>
                  <div className="flex flex-wrap" style={{ gap: 6 }}>
                    {LEAD_TAGS.map((t) => {
                      const on = (lead.tags ?? []).includes(t.value)
                      return (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => {
                            const next = on
                              ? (lead.tags ?? []).filter((x) => x !== t.value)
                              : [...(lead.tags ?? []), t.value]
                            patchLead.mutate({ tags: next })
                          }}
                          className="cursor-pointer"
                          style={{
                            borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                            border: `1px solid ${on ? PURPLE : LINE_STRONG}`,
                            background: on ? PURPLE_100 : '#fff',
                            color: on ? DEEP : FAINT,
                          }}
                        >
                          {t.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {lead?.notes && (
            <Card title="Notes">
              <p style={{ fontSize: 14, color: INK_2, whiteSpace: 'pre-wrap' }}>{lead.notes}</p>
            </Card>
          )}
        </div>

        {/* ── The running account ─────────────────────────────────────────── */}
        <div className="flex flex-col" style={{ flex: '2 1 480px', gap: 20 }}>
          {lead && (
            <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 22, boxShadow: SHADOW_SM, padding: '22px 26px' }}>
              <h3 style={{ ...DISPLAY, fontSize: 16, fontWeight: 700, margin: '0 0 14px' }}>Activity</h3>

              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What was said, what was promised, why they have gone quiet"
                style={{ width: '100%', minHeight: 76, padding: '12px 14px', borderRadius: 16, border: `1px solid ${LINE_STRONG}`, fontFamily: 'inherit', fontSize: 14, color: INK, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
              />
              <div className="flex justify-end" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => addNote.mutate()}
                  disabled={!note.trim() || addNote.isPending}
                  className="cursor-pointer disabled:cursor-default"
                  style={{
                    height: 40, padding: '0 20px', borderRadius: 999, border: 'none', fontWeight: 700, fontSize: 14,
                    fontFamily: 'inherit', color: '#fff',
                    background: !note.trim() || addNote.isPending ? PURPLE_200 : PURPLE,
                  }}
                >
                  {addNote.isPending ? 'Saving…' : 'Add note'}
                </button>
              </div>

              <div style={{ height: 1, background: LINE, margin: '22px 0' }} />

              {timeline.length === 0 ? (
                <p style={{ fontSize: 14, color: FAINT }}>Nothing recorded yet.</p>
              ) : (
                <div className="flex flex-col">
                  {timeline.map((t, i) => {
                    const style = EVENT_STYLE[t.type] ?? EVENT_STYLE.updated
                    const Icon = style.icon
                    return (
                      <div key={`${t.at}-${i}`} className="flex" style={{ gap: 14, padding: '14px 0', borderBottom: `1px solid ${LINE}` }}>
                        <div style={{ width: 34, height: 34, borderRadius: 999, background: style.bg, color: style.color, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
                          <Icon size={15} />
                        </div>
                        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: INK, whiteSpace: 'pre-wrap' }}>{t.text}</div>
                          <div style={{ fontSize: 12.5, color: FAINT, marginTop: 3 }}>{eventMeta(t)}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Contracts and documents belong to a customer. On a lead they are
              two empty panels saying nothing, so they wait until there is one. */}
          {isCustomer && (
            <Card
              title={`Contracts (${contracts.length})`}
              action={<Link to={bookHref} style={{ fontSize: 13, fontWeight: 700, color: PURPLE }}>Book unit →</Link>}
            >
              {contracts.length === 0 ? (
                <p style={{ fontSize: 14, color: FAINT }}>No contracts yet.</p>
              ) : (
                <div className="flex flex-col" style={{ gap: 8 }}>
                  {contracts.map((c) => {
                    const units = (c.units?.length ? c.units : c.unit ? [c.unit] : []).map((u) => u?.unitNumber).filter(Boolean)
                    return (
                      <Link key={c._id} to={`/contracts/${c._id}`} className="flex items-center justify-between gap-3"
                        style={{ padding: '12px 14px', border: `1px solid ${LINE}`, borderRadius: 12, fontSize: 14, color: INK }}>
                        <span>
                          <span style={{ fontWeight: 700, color: PURPLE }}>{c.contractNo}</span>
                          <span style={{ color: FAINT }}> · {units.join(', ') || 'no unit'}</span>
                        </span>
                        <span style={{ color: FAINT, fontSize: 12.5 }}>
                          {statusLabel(c.status)} · {formatDate(c.startDate)}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </Card>
          )}

          {isCustomer && (
            <Card title={`Documents (${documents.length})`}>
              {documents.length === 0 ? (
                <p style={{ fontSize: 14, color: FAINT }}>Nothing uploaded.</p>
              ) : (
                <div className="flex flex-col">
                  {documents.map((d) => (
                    <a key={d._id} href={d.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2"
                      style={{ fontSize: 14, padding: '8px 0', borderBottom: `1px solid ${LINE}` }}>
                      <span className="inline-flex items-center gap-1.5"><FileText size={14} style={{ color: FAINT }} /> {d.name}</span>
                      <span style={{ color: FAINT, fontSize: 12 }}>{statusLabel(d.type)}</span>
                    </a>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Said rather than left implicit: which half of the record exists tells
          you what stage the person is at, and both halves rarely exist at once
          early on. */}
      <p className="inline-flex items-center" style={{ gap: 6, fontSize: 12.5, color: FAINT, marginTop: 20 }}>
        {isCustomer
          ? <><UserCheck size={13} /> Customer record{lead ? ' · still linked to the original lead' : ''}</>
          : <><UserPlus size={13} /> Lead only — no customer record yet</>}
      </p>
    </div>
  )
}

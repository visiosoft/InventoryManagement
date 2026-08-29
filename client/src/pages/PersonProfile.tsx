import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Calendar, Clock, FileText, Mail, MessageCircle, MessageSquare,
  ExternalLink, PackageCheck, Pencil, Phone, Plus, Repeat, UserCheck, UserPlus,
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Spinner, statusLabel, LEAD_STATUS_FLOW, LEAD_TEMPERATURES, LEAD_TAGS } from '../components/ui'
import { formatDate, formatDateTime } from '../lib/utils'
import { FOLLOW_UP_TONE, followUpState, reminderDay } from '../lib/followUp'
import { dubaiToday } from '../lib/timezone'
import {
  CHANNELS, OUTCOMES, channelOf, outcomeOf, sequenceState, suggestedNextDate,
  type Attempt, type AttemptChannel, type AttemptOutcome, type FollowUpPlan,
} from '../lib/attempts'

const LEAD_SOURCES = ['manual', 'whatsapp', 'referral', 'walk_in', 'other']

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
const WARM = '#D97706'
const SHADOW_SM = '0 1px 2px rgba(20,8,31,.06), 0 2px 8px rgba(20,8,31,.04)'
const SHADOW_MD = '0 8px 24px rgba(20,8,31,.08), 0 2px 6px rgba(20,8,31,.04)'
const DISPLAY = { fontFamily: "'Bricolage Grotesque', serif", letterSpacing: '-0.02em' } as const

/* The gaps people actually reach for. A follow-up is an instant now rather
   than a granularity — "that week" was always a guess about which day. */
const FOLLOW_UP_PRESETS = [1, 3, 7, 14, 30, 60, 90]

/** N days from today, at the chosen time, as an instant the server can store. */
function inDays(days: number, time: string): string {
  const base = new Date(`${dubaiToday()}T00:00:00.000Z`)
  base.setUTCDate(base.getUTCDate() + days)
  return `${base.toISOString().slice(0, 10)}T${time || '09:00'}:00.000Z`
}

/** The banner's words and icon, from the shared state the list also uses. */
function followUpUrgency(day: string) {
  const { tone, days } = followUpState(day)
  const tint = FOLLOW_UP_TONE[tone]
  const label = formatDate(day)
  const icon = tone === 'overdue' ? AlertTriangle : tone === 'later' ? Calendar : Clock
  const text = tone === 'overdue' ? `Overdue — follow up was due ${label}`
    : tone === 'today' ? `Follow up today, ${label}`
      : tone === 'soon' ? `Follow up on ${label} (in ${days} day${days === 1 ? '' : 's'})`
        : `Follow up on ${label}`
  return { ...tint, icon, label: text }
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
  followUpNote?: string
  siteVisitAt?: string | null
  attempts?: Attempt[]
  sequenceExhaustedAt?: string | null
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
  site_visit_scheduled: { bg: 'rgba(37,99,235,.08)', fg: '#2563EB' },
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

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontFamily: 'inherit', color: INK, boxSizing: 'border-box', outline: 'none' }}
      />
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
  // The follow-up being set: which preset, at what time, and what it is for.
  const [presetDays, setPresetDays] = useState(0)
  const [followUpTime, setFollowUpTime] = useState('09:00')
  const [followUpNote, setFollowUpNote] = useState('')
  // The standing note on the lead — what this person is about, not a dated
  // entry in the timeline below.
  const [notes, setNotes] = useState('')
  const [stageNote, setStageNote] = useState('')
  // The attempt being logged, if one is.
  const [logging, setLogging] = useState(false)
  const [attempt, setAttempt] = useState<{ channel: AttemptChannel; outcome: AttemptOutcome; note: string; nextAt: string }>(
    { channel: 'call', outcome: 'no_answer', note: '', nextAt: '' },
  )
  // Contact details, while they are being edited rather than read.
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    fullName: '', phone: '', whatsappNo: '', email: '', source: 'manual',
    company: '', nationality: '', emergencyNumber: '', emiratesId: '', address: '',
  })

  const { data, isLoading } = useQuery<Profile>({
    queryKey: ['person', id],
    queryFn: () => api.get(`/leads/${id}/profile`).then((r) => r.data),
    enabled: Boolean(id),
  })

  // Straight from the units, so every size that exists is offered and the
  // number is a number. The dashboard's summary was neither: seven hardcoded
  // buckets, formatted as "25 sq ft", which read back as NaN.
  // The chase everybody follows — what the next date is prefilled from.
  const { data: plan } = useQuery<FollowUpPlan>({
    queryKey: ['follow-up-plan'],
    queryFn: () => api.get('/leads/follow-up-plan').then((r) => r.data),
    staleTime: 10 * 60_000,
  })

  const { data: sizes = [] } = useQuery<{ sizeSqf: number; total: number; available: number }[]>({
    queryKey: ['unit-sizes'],
    queryFn: () => api.get('/units/sizes').then((r) => r.data),
    staleTime: 5 * 60_000,
  })

  // Only admins reassign. A rep seeing the dropdown would only meet a refusal.
  const hydrated = useRef('')
  useEffect(() => {
    const l = data?.lead
    if (!l || hydrated.current === l._id) return
    hydrated.current = l._id
    setFollowUpNote(l.followUpNote || '')
    setNotes(l.notes || '')
    if (l.followUpAt) setFollowUpTime(String(l.followUpAt).slice(11, 16) || '09:00')
  }, [data?.lead])

  const { data: assignable = [] } = useQuery<Owner[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  })

  const refresh = () => qc.invalidateQueries({ queryKey: ['person', id] })

  /**
   * Put a change on screen before the server has heard about it.
   *
   * Every one of these used to wait for the save and then for a refetch before
   * anything moved — two round trips to watch a tag turn purple. The click is
   * the decision; the request is bookkeeping, and bookkeeping is not something
   * anybody should sit and watch. If it fails, the previous state goes back
   * exactly as it was and the error says why.
   */
  const showNow = async (next: Partial<Lead>) => {
    await qc.cancelQueries({ queryKey: ['person', id] })
    const previous = qc.getQueryData<Profile>(['person', id])
    if (previous?.lead) {
      qc.setQueryData<Profile>(['person', id], { ...previous, lead: { ...previous.lead, ...next } })
    }
    return { previous }
  }

  const putBack = (e: unknown, ctx?: { previous?: Profile }) => {
    if (ctx?.previous) qc.setQueryData(['person', id], ctx.previous)
    setErr(apiError(e))
  }

  const setStatus = useMutation({
    mutationFn: ({ status, comment }: { status: string; comment?: string }) =>
      api.patch(`/leads/${data!.lead!._id}/status`, { status, comment }),
    onMutate: async (vars) => {
      setErr(''); setPendingStage(''); setStageNote('')
      return showNow({ status: vars.status })
    },
    onError: (e, _vars, ctx) => putBack(e, ctx),
    onSettled: () => refresh(),
  })

  // Temperature, tags and the follow-up date all go through the same update,
  // so one edit cannot half-apply.
  const patchLead = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/leads/${data!.lead!._id}`, body),
    onMutate: async (body: Record<string, unknown>) => {
      setErr('')
      // owner arrives as an id but is rendered as a record, so it is swapped
      // for the matching person rather than merged in raw.
      const { owner, ...rest } = body as { owner?: string }
      const next: Partial<Lead> = { ...(rest as Partial<Lead>) }
      if (owner !== undefined) next.owner = assignable.find((u) => u._id === owner) ?? null
      return showNow(next)
    },
    onError: (e, _body, ctx) => putBack(e, ctx),
    onSettled: () => refresh(),
  })

  const logAttempt = useMutation({
    mutationFn: () => api.post(`/leads/${data!.lead!._id}/attempts`, {
      channel: attempt.channel,
      outcome: attempt.outcome,
      note: attempt.note.trim(),
      nextAt: attempt.nextAt || undefined,
    }),
    onSuccess: (res) => {
      setErr('')
      setLogging(false)
      setAttempt({ channel: 'call', outcome: 'no_answer', note: '', nextAt: '' })
      // The server suggests where this leaves the lead; the rep confirms it in
      // the stage panel rather than having it moved under them.
      const suggest = res?.data?.suggestStatus
      if (suggest && suggest !== data?.lead?.status) setPendingStage(suggest)
      refresh()
    },
    onError: (e) => setErr(apiError(e)),
  })

  const addNote = useMutation({
    mutationFn: () => api.post(`/leads/${data!.lead!._id}/notes`, { text: note.trim() }),
    onSuccess: () => { setNote(''); setErr(''); refresh() },
    onError: (e) => setErr(apiError(e)),
  })

  // Reassigning is the same write, so it takes the same instant path.
  const assign = { mutate: (owner: string) => patchLead.mutate({ owner }), isPending: patchLead.isPending }

  /**
   * Save to whichever record the page is actually showing.
   *
   * The header prefers the customer's name over the lead's, so editing the
   * lead behind a customer changed nothing anybody could see — which is why
   * this used to be offered on leads only. It writes to the customer once
   * there is one, and both stay editable in the one place people look.
   *
   * firstName and lastName travel with the full name so the three do not
   * drift apart; the server keeps whichever it is not sent.
   */
  const saveDetails = useMutation({
    mutationFn: () => {
      const name = form.fullName.trim()
      const [firstName, ...rest] = name.split(/\s+/)

      if (data?.customer) {
        return api.put(`/customers/${data.customer._id}`, {
          fullName: name,
          phone: form.phone.trim(),
          email: form.email.trim(),
          company: form.company.trim(),
          nationality: form.nationality.trim(),
          emergencyNumber: form.emergencyNumber.trim(),
          emiratesId: form.emiratesId.trim(),
          address: form.address.trim(),
        })
      }

      return api.put(`/leads/${data!.lead!._id}`, {
        fullName: name,
        firstName: firstName || '',
        lastName: rest.join(' '),
        phone: form.phone.trim(),
        whatsappNo: form.whatsappNo.trim(),
        email: form.email.trim(),
        source: form.source,
      })
    },
    onSuccess: () => {
      setErr('')
      setEditing(false)
      refresh()
      // The customers list shows the same name, so it should not keep the old one.
      qc.invalidateQueries({ queryKey: ['customers'] })
    },
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
  const pkg = (lead?.storageSizeValue ?? 0) > 0
    ? `${lead!.storageSizeValue} ${lead!.storageSizeUnit || 'sqft'}${(lead!.unitsNeeded ?? 1) > 1 ? ` · ${lead!.unitsNeeded} units` : ''}`
    : lead?.storageSizeValue === -1
      ? 'Size undecided'
      : ''

  // The stage as chosen, not as stored: picking another one should take its
  // fields away immediately, rather than after the change is saved.
  const shownStage = pendingStage || lead?.status || ''
  const dueDay = reminderDay(lead?.followUpAt, lead?.followUpKind)
  const urgency = dueDay ? followUpUrgency(dueDay) : null
  // Newest first: what happened last is what somebody picking this up reads.
  const timeline = [...(lead?.timeline ?? [])].reverse()

  const attempts = lead?.attempts ?? []
  const seq = sequenceState(attempts, plan, Boolean(lead?.sequenceExhaustedAt))

  return (
    <div style={{ background: PAGE, fontFamily: "'Manrope', system-ui, sans-serif", color: INK }}>
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
            {/* Two different places, so both are offered rather than one
                standing in for the other: our inbox has the history and is
                where a reply gets recorded; wa.me is their actual WhatsApp,
                which is what you want for a voice note or an attachment. */}
            {waNumber && (
              <Link
                to={`/whatsapp?phone=${waNumber}`}
                title="Open the conversation in PurpleBox"
                className="inline-flex items-center cursor-pointer"
                style={{ gap: 8, height: 44, padding: '0 18px', borderRadius: 999, border: `1px solid ${PURPLE_200}`, background: PURPLE_50, color: DEEP, fontWeight: 600, fontSize: 14 }}
              >
                <MessageCircle size={16} /> Chat
              </Link>
            )}
            {waNumber && (
              <a
                href={`https://wa.me/${waNumber}`}
                target="_blank"
                rel="noreferrer"
                title="Open WhatsApp in a new tab"
                className="inline-flex items-center"
                style={{ gap: 8, height: 44, padding: '0 18px', borderRadius: 999, border: '1px solid rgba(22,163,74,.28)', background: 'rgba(22,163,74,.09)', color: '#047857', fontWeight: 600, fontSize: 14 }}
              >
                <MessageCircle size={16} /> WhatsApp <ExternalLink size={13} style={{ opacity: 0.7 }} />
              </a>
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
          {/* Editable only on a lead. A customer's name and number live on the
              customer record, and editing the lead behind them would change
              nothing anybody can see. */}
          <Card
            title="Contact details"
            action={(lead || customer) && !editing ? (
              <button
                type="button"
                onClick={() => {
                  setForm({
                    fullName: name === 'Unnamed' ? '' : name,
                    phone: phone || '',
                    whatsappNo: lead?.whatsappNo || '',
                    email: email || '',
                    source: lead?.source || 'manual',
                    company: customer?.company || '',
                    nationality: customer?.nationality || '',
                    emergencyNumber: customer?.emergencyNumber || '',
                    emiratesId: customer?.emiratesId || '',
                    address: customer?.address || '',
                  })
                  setErr('')
                  setEditing(true)
                }}
                className="inline-flex items-center gap-1.5 cursor-pointer"
                style={{ background: 'none', border: 'none', color: PURPLE, fontSize: 13, fontWeight: 700 }}
              >
                <Pencil size={13} /> Edit
              </button>
            ) : undefined}
          >
            {editing ? (
              <div className="flex flex-col" style={{ gap: 12 }}>
                <Field label="Name" value={form.fullName} onChange={(v) => setForm((f) => ({ ...f, fullName: v }))} />
                <Field label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
                {!isCustomer && (
                  <Field label="WhatsApp" value={form.whatsappNo} onChange={(v) => setForm((f) => ({ ...f, whatsappNo: v }))} />
                )}
                <Field label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} type="email" />

                {/* Only a customer has these — a lead is a name and a number. */}
                {customer && <>
                  <Field label="Company" value={form.company} onChange={(v) => setForm((f) => ({ ...f, company: v }))} />
                  <Field label="Nationality" value={form.nationality} onChange={(v) => setForm((f) => ({ ...f, nationality: v }))} />
                  <Field label="Emergency contact" value={form.emergencyNumber} onChange={(v) => setForm((f) => ({ ...f, emergencyNumber: v }))} />
                  <Field label="Emirates ID" value={form.emiratesId} onChange={(v) => setForm((f) => ({ ...f, emiratesId: v }))} />
                  <Field label="Address" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
                </>}

                {lead && !isCustomer && <div>
                  <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Source</span>
                  <select
                    value={form.source}
                    onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                    className="cursor-pointer"
                    style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontFamily: 'inherit', color: INK }}
                  >
                    {LEAD_SOURCES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                </div>}
                <div className="flex" style={{ gap: 8, marginTop: 2 }}>
                  <button
                    type="button"
                    onClick={() => saveDetails.mutate()}
                    disabled={!form.fullName.trim() || !form.phone.trim() || saveDetails.isPending}
                    className="cursor-pointer disabled:opacity-50"
                    style={{ height: 38, padding: '0 16px', borderRadius: 999, border: 'none', background: PURPLE, color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}
                  >
                    {saveDetails.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditing(false); setErr('') }}
                    disabled={saveDetails.isPending}
                    className="cursor-pointer disabled:opacity-50"
                    style={{ height: 38, padding: '0 16px', borderRadius: 999, border: `1px solid ${LINE_STRONG}`, background: '#fff', color: FAINT, fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}
                  >
                    Cancel
                  </button>
                </div>
                {/* Both are required by the server, so say it here rather than
                    letting the save come back refused. */}
                {(!form.fullName.trim() || !form.phone.trim()) && (
                  <p style={{ fontSize: 12, color: FAINT }}>A name and a phone number are needed.</p>
                )}
                {err && <p style={{ fontSize: 12.5, color: '#C0392B' }}>{err}</p>}
              </div>
            ) : (
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
                  <Detail label="Source" value={statusLabel(lead.source)} />
                  <Detail label="First seen" value={formatDate(lead.leadDateTime)} />
                </>}
              </div>
            )}
          </Card>

          {/* When we next deal with this person, kept beside who they are
              rather than buried among the pipeline controls. Only ever shows
              the date the stage in play is actually about. */}
          {lead && (attempts.length > 0 || (shownStage !== 'won' && shownStage !== 'lost')) && (
            <Card
              title="Follow-up"
              action={!logging && shownStage !== 'won' && shownStage !== 'lost' ? (
                <button
                  type="button"
                  onClick={() => {
                    setErr('')
                    setAttempt({
                      channel: seq.nextStep?.channel ?? 'call',
                      outcome: 'no_answer',
                      note: '',
                      nextAt: suggestedNextDate(plan, attempts.length + 1, dubaiToday()),
                    })
                    setLogging(true)
                  }}
                  className="inline-flex items-center gap-1.5 cursor-pointer"
                  style={{ background: 'none', border: 'none', color: PURPLE, fontSize: 13, fontWeight: 700 }}
                >
                  <Plus size={13} /> Log an attempt
                </button>
              ) : undefined}
            >
              <div className="flex flex-col" style={{ gap: 16 }}>

                {/* Where the chase has got to, in one line. The number is
                    counted from the attempts, so it cannot disagree with them. */}
                {shownStage !== 'won' && shownStage !== 'lost' && (
                  <div className="flex items-baseline justify-between" style={{ gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>
                      {seq.exhausted ? `All ${seq.total} attempts made` : seq.label}
                    </span>
                    {lead.followUpAt && !seq.exhausted && (
                      <span style={{ fontSize: 12.5, color: FAINT }}>next {formatDate(dueDay)}</span>
                    )}
                  </div>
                )}

                {/* The plan is spent and they never answered. Nothing is closed
                    here: a lead that went quiet and one that was on holiday
                    look identical from this side, so a person decides. */}
                {seq.exhausted && (
                  <div style={{ borderRadius: 12, border: '1px solid rgba(220,38,38,.25)', background: 'rgba(220,38,38,.09)', padding: 14 }}>
                    <p style={{ fontSize: 13.5, fontWeight: 600, color: '#DC2626' }}>
                      {seq.total} attempts, no response{attempts.length ? ` since ${formatDate(attempts[attempts.length - 1].at)}` : ''}.
                    </p>
                    <div className="flex flex-wrap" style={{ gap: 8, marginTop: 10 }}>
                      <button
                        type="button"
                        onClick={() => { setErr(''); setPendingStage('lost') }}
                        className="cursor-pointer"
                        style={{ height: 34, padding: '0 14px', borderRadius: 999, border: 'none', background: '#DC2626', color: '#fff', fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit' }}
                      >
                        Close as Lost
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setErr('')
                          setAttempt({ channel: 'call', outcome: 'no_answer', note: '', nextAt: '' })
                          setLogging(true)
                        }}
                        className="cursor-pointer"
                        style={{ height: 34, padding: '0 14px', borderRadius: 999, border: `1px solid ${LINE_STRONG}`, background: '#fff', color: INK, fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit' }}
                      >
                        Give it one more
                      </button>
                    </div>
                  </div>
                )}

                {/* Logging what was actually done. The next date comes from the
                    plan and stays editable — a rep who knows they are away
                    next week should be able to say so. */}
                {logging && (
                  <div style={{ borderRadius: 12, border: `1px solid ${PURPLE_200}`, background: PURPLE_50, padding: 14 }}>
                    <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>How did you try?</span>
                    <div className="flex flex-wrap" style={{ gap: 6, marginBottom: 12 }}>
                      {CHANNELS.map((c) => {
                        const on = attempt.channel === c.value
                        const Icon = c.icon
                        return (
                          <button
                            key={c.value}
                            type="button"
                            onClick={() => setAttempt((a) => ({ ...a, channel: c.value }))}
                            className="inline-flex items-center gap-1.5 cursor-pointer"
                            style={{
                              height: 32, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                              border: `1px solid ${on ? PURPLE : LINE_STRONG}`,
                              background: on ? '#fff' : 'transparent',
                              color: on ? DEEP : FAINT,
                            }}
                          >
                            <Icon size={12} /> {c.label}
                          </button>
                        )
                      })}
                    </div>

                    <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>What happened?</span>
                    <div className="flex flex-wrap" style={{ gap: 6, marginBottom: 12 }}>
                      {OUTCOMES.map((o) => {
                        const on = attempt.outcome === o.value
                        return (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => setAttempt((a) => ({ ...a, outcome: o.value }))}
                            className="cursor-pointer"
                            style={{
                              height: 32, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                              border: `1px solid ${on ? o.fg : LINE_STRONG}`,
                              background: on ? o.bg : 'transparent',
                              color: on ? o.fg : FAINT,
                            }}
                          >
                            {o.label}
                          </button>
                        )
                      })}
                    </div>

                    <textarea
                      value={attempt.note}
                      onChange={(e) => setAttempt((a) => ({ ...a, note: e.target.value }))}
                      rows={2}
                      placeholder="Left a voice note about the 35 sqft…"
                      style={{ width: '100%', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', color: INK, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
                    />

                    {/* Only when the chase continues: there is nothing to book
                        for somebody you have just spoken to or written off. */}
                    {!outcomeOf(attempt.outcome).ends && (
                      <div style={{ marginTop: 10 }}>
                        <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Next attempt on</span>
                        <input
                          type="date"
                          value={attempt.nextAt}
                          onChange={(e) => setAttempt((a) => ({ ...a, nextAt: e.target.value }))}
                          style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontFamily: 'inherit', color: INK, boxSizing: 'border-box' }}
                        />
                        {!attempt.nextAt && (
                          <p style={{ fontSize: 12.5, color: FAINT, marginTop: 6 }}>
                            Leave it blank and the chase ends here, for somebody to decide on.
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap" style={{ gap: 8, marginTop: 12 }}>
                      <button
                        type="button"
                        disabled={logAttempt.isPending}
                        onClick={() => logAttempt.mutate()}
                        className="cursor-pointer disabled:opacity-50"
                        style={{ height: 38, padding: '0 18px', borderRadius: 999, border: 'none', background: PURPLE, color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}
                      >
                        {logAttempt.isPending ? 'Saving…' : 'Save attempt'}
                      </button>
                      <button
                        type="button"
                        disabled={logAttempt.isPending}
                        onClick={() => setLogging(false)}
                        className="cursor-pointer disabled:opacity-50"
                        style={{ height: 38, padding: '0 18px', borderRadius: 999, border: `1px solid ${LINE_STRONG}`, background: '#fff', color: FAINT, fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* What was actually tried, oldest first — the chase reads
                    downwards the way it happened. */}
                {attempts.length > 0 && (
                  <div className="flex flex-col">
                    {attempts.map((a, i) => {
                      const ch = channelOf(a.channel)
                      const oc = outcomeOf(a.outcome)
                      const Icon = ch.icon
                      const last = i === attempts.length - 1
                      return (
                        <div key={`${a.no}-${a.at}`} className="flex" style={{ gap: 12 }}>
                          {/* The rail: a numbered dot, and a line down to the
                              next attempt so the sequence reads as one thing. */}
                          <div className="flex flex-col items-center" style={{ width: 28 }}>
                            <div style={{ width: 26, height: 26, borderRadius: 999, background: PURPLE_100, color: DEEP, display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 700, flex: '0 0 auto' }}>
                              {a.no}
                            </div>
                            {!last && <div style={{ width: 2, flex: 1, background: LINE, minHeight: 12 }} />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : 14 }}>
                            <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
                              <span className="inline-flex items-center" style={{ gap: 4, fontSize: 13, fontWeight: 600 }}>
                                <Icon size={12} style={{ color: FAINT }} /> {ch.label}
                              </span>
                              <span className="inline-flex rounded-full" style={{ padding: '2px 8px', fontSize: 11, fontWeight: 700, background: oc.bg, color: oc.fg }}>
                                {oc.label}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>
                              {formatDate(a.at)}{a.user?.name ? ` · ${a.user.name}` : ''}
                            </div>
                            {a.note && (
                              <p style={{ fontSize: 13, color: INK_2, marginTop: 4, whiteSpace: 'pre-wrap' }}>{a.note}</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* What is still planned, so the rest of the chase is not a
                    surprise. Greyed — these have not happened. */}
                {!seq.exhausted && seq.nextStep && shownStage !== 'won' && shownStage !== 'lost'
                  && (plan?.steps ?? []).slice(attempts.length).map((st, i) => (
                  <div key={`${st.label}-${i}`} className="flex items-center" style={{ gap: 12, opacity: 0.55 }}>
                    <div style={{ width: 26, height: 26, borderRadius: 999, border: `1px dashed ${LINE_STRONG}`, color: FAINT, display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 700, flex: '0 0 auto' }}>
                      {attempts.length + i + 1}
                    </div>
                    <span style={{ fontSize: 12.5, color: FAINT }}>
                      {st.label || channelOf(st.channel).label}
                      {i === 0 ? '' : ` · +${st.afterDays}d`} · {channelOf(st.channel).label}
                    </span>
                  </div>
                ))}

                  {/* The pickers belong to the stage that is about following
                      up; anywhere else they are a control nobody is looking for.

                      A lead that already has a date keeps a line saying so even
                      after it moves on, because the reminder is still live and
                      hiding it outright left a task on somebody's board that
                      could not be reached from here. */}
                  {shownStage !== 'follow_up_scheduled' && lead.followUpAt && shownStage !== 'won' && shownStage !== 'lost' && (
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Follow-up</span>
                      <div className="flex items-center justify-between" style={{ gap: 8, padding: '9px 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{formatDate(dueDay)}</span>
                        <button
                          type="button"
                          onClick={() => patchLead.mutate({ followUpAt: null })}
                          className="cursor-pointer disabled:opacity-50"
                          style={{ background: 'none', border: 'none', color: FAINT, fontSize: 12.5, fontWeight: 600 }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}

                  {/* A viewing is a fixed appointment: one date, no week or
                      month about it, and nobody arranges one for "some time in
                      March". Setting it puts a task on the owner's board for
                      that day. */}
                  {shownStage === 'site_visit_scheduled' && (
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Coming in on</span>
                      <input
                        type="date"
                        value={lead.siteVisitAt ? String(lead.siteVisitAt).slice(0, 10) : ''}
                        onChange={(e) => patchLead.mutate({ siteVisitAt: e.target.value || null })}
                        style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontFamily: 'inherit', color: INK, boxSizing: 'border-box' }}
                      />
                      <p style={{ fontSize: 12.5, color: FAINT, marginTop: 6 }}>
                        {!lead.siteVisitAt
                          ? 'Pick the day and it goes on the board.'
                          : lead.owner
                            ? `Site visit on ${lead.owner.name}'s board for ${formatDate(String(lead.siteVisitAt).slice(0, 10))}.`
                            : 'Assign this lead to somebody and the visit will be put on their board.'}
                      </p>
                    </div>
                  )}

                  {/* Still shown once the stage moves on, because the visit is
                      booked and its task is live — the same reason the follow-up
                      keeps a line of its own. */}
                  {shownStage !== 'site_visit_scheduled' && lead.siteVisitAt && shownStage !== 'won' && shownStage !== 'lost' && (
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Site visit</span>
                      <div className="flex items-center justify-between" style={{ gap: 8, padding: '9px 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{formatDate(String(lead.siteVisitAt).slice(0, 10))}</span>
                        <button
                          type="button"
                          onClick={() => patchLead.mutate({ siteVisitAt: null })}
                          className="cursor-pointer disabled:opacity-50"
                          style={{ background: 'none', border: 'none', color: FAINT, fontSize: 12.5, fontWeight: 600 }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}

                  {shownStage === 'follow_up_scheduled' && (
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Remind me in</span>

                      {/* The gaps people actually use, so the common case is one
                          click rather than counting days on a calendar. Custom
                          is there for the rest, because "when they get back from
                          Eid" is not a number of days. */}
                      <select
                        value={FOLLOW_UP_PRESETS.some((d) => d === presetDays) ? String(presetDays) : 'custom'}
                        onChange={(e) => {
                          if (e.target.value === 'custom') { setPresetDays(0); return }
                          const days = Number(e.target.value)
                          setPresetDays(days)
                          patchLead.mutate({ followUpAt: inDays(days, followUpTime) })
                        }}
                        className="cursor-pointer"
                        style={{ width: '100%', height: 40, padding: '0 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontFamily: 'inherit', color: INK }}
                      >
                        {FOLLOW_UP_PRESETS.map((d) => (
                          <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>
                        ))}
                        <option value="custom">Pick a date…</option>
                      </select>

                      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 8, marginTop: 8 }}>
                        <input
                          type="date"
                          value={lead.followUpAt ? String(lead.followUpAt).slice(0, 10) : ''}
                          min={dubaiToday()}
                          onChange={(e) => {
                            if (!e.target.value) { patchLead.mutate({ followUpAt: null }); return }
                            setPresetDays(0)
                            patchLead.mutate({ followUpAt: `${e.target.value}T${followUpTime}:00.000Z` })
                          }}
                          style={{ width: '100%', height: 40, padding: '0 10px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontFamily: 'inherit', color: INK, boxSizing: 'border-box' }}
                        />
                        {/* A time, because "call at 4" is a different
                            instruction from "call sometime on Thursday". */}
                        <input
                          type="time"
                          value={followUpTime}
                          onChange={(e) => {
                            const t = e.target.value || '09:00'
                            setFollowUpTime(t)
                            if (lead.followUpAt) {
                              patchLead.mutate({ followUpAt: `${String(lead.followUpAt).slice(0, 10)}T${t}:00.000Z` })
                            }
                          }}
                          style={{ width: '100%', height: 40, padding: '0 10px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontFamily: 'inherit', color: INK, boxSizing: 'border-box' }}
                        />
                      </div>

                      {/* What it is for. A date on its own tells whoever reads
                          it to ring somebody and nothing about why, which is
                          the half that matters three weeks later. */}
                      <textarea
                        value={followUpNote}
                        onChange={(e) => setFollowUpNote(e.target.value)}
                        onBlur={() => {
                          if (followUpNote !== (lead.followUpNote || '')) patchLead.mutate({ followUpNote })
                        }}
                        rows={2}
                        placeholder="What is this follow-up about?"
                        style={{ width: '100%', marginTop: 8, borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', padding: '9px 11px', fontSize: 13.5, fontFamily: 'inherit', color: INK, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
                      />

                      {lead.followUpAt && (
                        <p style={{ fontSize: 12.5, color: FAINT, marginTop: 6 }}>
                          {lead.owner
                            ? `On ${lead.owner.name}'s board for ${formatDateTime(lead.followUpAt)}.`
                            : 'Assign this lead to somebody and it will land on their board.'}
                        </p>
                      )}
                    </div>
                  )}
              </div>
            </Card>
          )}

          {/* Admins write this one; everybody else reads it.
              The server refuses the change either way — hiding a text box is
              not a permission — but showing a rep a field they cannot save
              would only waste their typing. Reps have the timeline below for
              their own running commentary.

              Shown to an admin even when empty, since a card that appears only
              once a note exists leaves no way to write the first one. Hidden
              from everyone else when empty, because an empty box they cannot
              fill in is just clutter. */}
          {lead && (isAdmin || lead.notes) && (
            <Card title="Notes">
              {isAdmin ? (
                <>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => { if (notes !== (lead.notes || '')) patchLead.mutate({ notes }) }}
                    rows={4}
                    placeholder="Anything worth knowing about this person — what they are storing, what was agreed, who referred them."
                    style={{
                      width: '100%', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff',
                      padding: '9px 11px', fontSize: 14, fontFamily: 'inherit', color: INK,
                      resize: 'vertical', boxSizing: 'border-box', outline: 'none', lineHeight: 1.5,
                    }}
                  />
                  <p style={{ fontSize: 12, color: FAINT, marginTop: 6 }}>
                    Saved when you click away. Clearing the box removes the note.
                  </p>
                </>
              ) : (
                <p style={{ fontSize: 14, color: INK_2, whiteSpace: 'pre-wrap' }}>{lead.notes}</p>
              )}
            </Card>
          )}
        </div>

        {/* ── The running account ─────────────────────────────────────────── */}
        <div className="flex flex-col" style={{ flex: '2 1 480px', gap: 20 }}>
          {lead && (
            <Card title="Ownership & status">
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16, alignItems: 'start' }}>
                <div>
                  <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Assigned to</span>
                  {isAdmin ? (
                    <select
                      value={lead.owner?._id ?? ''}
                      onChange={(e) => assign.mutate(e.target.value)}
                      className="cursor-pointer"
                      style={{ width: '100%', height: 42, padding: '0 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontWeight: 600, color: INK, fontFamily: 'inherit' }}
                    >
                      <option value="">Nobody</option>
                      {assignable.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
                    </select>
                  ) : (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{lead.owner?.name || 'Nobody'}</div>
                      {/* Reps work their own leads and do not hand them on, so
                          say who can rather than leaving a name that looks
                          editable and is not. */}
                      <p style={{ fontSize: 12.5, color: FAINT, marginTop: 4 }}>An admin can move this to somebody else.</p>
                    </>
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
                    className="cursor-pointer"
                    style={{ width: '100%', height: 42, padding: '0 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontWeight: 600, color: INK, fontFamily: 'inherit' }}
                  >
                    {LEAD_STATUS_FLOW.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>

                  {/* What the stage means somebody should do next, so the
                      status is an instruction rather than a label. */}
                  <p style={{ fontSize: 12.5, color: FAINT, marginTop: 6 }}>
                    {pendingStage
                      ? 'Unsaved — see below.'
                      : LEAD_STATUS_FLOW.find((s) => s.value === lead.status)?.next}
                  </p>
                </div>

                {/* Temperature sits beside the stage, not inside it: a lead can
                    be Follow-Up Scheduled and hot, or Contacted and cold. */}
                {/* A standing fact about the lead, not only something asked
                    once on the way to Contacted. Sizes come from the units
                    themselves, so every size that exists can be picked and
                    each says how many are free. */}
                <div>
                  <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Size they need</span>
                  <select
                    value={lead.storageSizeValue ? String(lead.storageSizeValue) : ''}
                    onChange={(e) => patchLead.mutate({
                      storageSizeValue: e.target.value ? Number(e.target.value) : 0,
                      storageSizeUnit: 'sqft',
                    })}
                    className="cursor-pointer"
                    style={{ width: '100%', height: 42, padding: '0 12px', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', fontSize: 14, fontWeight: 600, color: lead.storageSizeValue ? INK : FAINT, fontFamily: 'inherit' }}
                  >
                    <option value="">Not asked yet</option>
                    {/* Asked, and they genuinely do not know — which is a
                        different thing from nobody having asked, and the one
                        that tells the next person not to ask again. */}
                    <option value="-1">Not decided yet</option>
                    {sizes.map((b) => (
                      <option key={b.sizeSqf} value={String(b.sizeSqf)}>
                        {b.sizeSqf} sqft — {b.available} free of {b.total}
                      </option>
                    ))}
                    {/* A size somebody recorded before it existed as a unit
                        still has to be selectable, or opening the lead would
                        silently change it. */}
                    {(lead.storageSizeValue ?? 0) > 0 && !sizes.some((b) => b.sizeSqf === lead.storageSizeValue) && (
                      <option value={String(lead.storageSizeValue)}>{lead.storageSizeValue} sqft</option>
                    )}
                  </select>
                  {(lead.unitsNeeded ?? 1) > 1 && (
                    <p style={{ fontSize: 12.5, color: FAINT, marginTop: 6 }}>{lead.unitsNeeded} units</p>
                  )}
                </div>

                <div>
                  <span style={{ fontSize: 13, color: FAINT, display: 'block', marginBottom: 6 }}>Temperature</span>
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
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

                {/* Moving a stage is the moment somebody knows why. Asking
                    here — rather than leaving them to write it separately — is
                    the difference between a timeline that reads as an account
                    and one that reads as a list of state changes. The note
                    goes with the change in one request, so a stage cannot land
                    without it.

                    Full width rather than inside the Stage cell: squeezed into
                    a quarter of the card it was a textarea three words wide. */}
                {pendingStage && (
                  <div style={{ gridColumn: '1 / -1', borderRadius: 12, border: `1px solid ${PURPLE_200}`, background: PURPLE_50, padding: 14 }}>
                    <p style={{ fontSize: 13, color: INK_2, marginBottom: 8 }}>
                      Moving to <b style={{ color: INK }}>{LEAD_STATUS_FLOW.find((s) => s.value === pendingStage)?.label}</b> — what happened?
                    </p>
                    <textarea
                      value={stageNote}
                      onChange={(e) => setStageNote(e.target.value)}
                      rows={2}
                      autoFocus
                      placeholder={pendingStage === 'lost' ? 'Why did this one go? (worth recording)' : 'Optional — called, no answer…'}
                      style={{ width: '100%', borderRadius: 10, border: `1px solid ${LINE_STRONG}`, background: '#fff', padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', color: INK, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
                    />
                    <div className="flex flex-wrap" style={{ gap: 8, marginTop: 10 }}>
                      <button
                        type="button"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ status: pendingStage, comment: stageNote.trim() || undefined })}
                        className="cursor-pointer disabled:opacity-50"
                        style={{ height: 38, padding: '0 18px', borderRadius: 999, border: 'none', background: PURPLE, color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}
                      >
                        {setStatus.isPending ? 'Saving…' : 'Save stage'}
                      </button>
                      <button
                        type="button"
                        disabled={setStatus.isPending}
                        onClick={() => { setPendingStage(''); setStageNote('') }}
                        className="cursor-pointer disabled:opacity-50"
                        style={{ height: 38, padding: '0 18px', borderRadius: 999, border: `1px solid ${LINE_STRONG}`, background: '#fff', color: FAINT, fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ gridColumn: '1 / -1' }}>
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

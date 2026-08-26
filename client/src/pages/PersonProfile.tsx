import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Briefcase, FileText, MessageCircle, Phone, Mail, UserCheck, UserPlus } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Spinner, statusLabel, LEAD_STATUS_FLOW, LEAD_TEMPERATURES, LEAD_TAGS } from '../components/ui'
import { formatDate } from '../lib/utils'

const INK = '#14081F'
const INK_2 = '#4A4357'
const FAINT = '#756E80'
const PURPLE = '#5B2BC9'
const DEEP = '#4A1FA0'
const PAGE = '#FBF8F2'
const LINE = 'rgba(20,8,31,0.10)'
const DISPLAY = { fontFamily: "'Bricolage Grotesque', serif", letterSpacing: '-0.02em' } as const

type Owner = { _id: string; name: string; email: string }
type Lead = {
  _id: string; fullName: string; email: string; phone: string; whatsappNo: string
  phoneNormalized: string; status: string; owner: Owner | null; notes: string
  leadDateTime: string; source: string
  temperature?: '' | 'hot' | 'warm' | 'cold'
  tags?: string[]
  followUpAt?: string | null
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
type Profile = {
  lead: Lead | null
  customer: Customer | null
  contracts: ContractRow[]
  documents: { _id: string; name: string; type: string; url: string; createdAt: string }[]
  stage: 'lead' | 'customer' | 'unknown'
}

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  new: { bg: '#EDE5FF', fg: DEEP },
  contact_attempted: { bg: '#FEF3C7', fg: '#92400E' },
  contacted: { bg: '#E0F2FE', fg: '#075985' },
  follow_up_scheduled: { bg: '#FFEDD5', fg: '#C2410C' },
  quotation_sent: { bg: '#F3E8FF', fg: '#7C3AED' },
  won: { bg: '#DCFCE7', fg: '#047857' },
  lost: { bg: '#FEE2E2', fg: '#B91C1C' },
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 20 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <h3 style={{ ...DISPLAY, fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3" style={{ padding: '7px 0', borderBottom: `1px solid ${LINE}`, fontSize: 13 }}>
      <span style={{ color: FAINT }}>{label}</span>
      <span style={{ color: value ? INK : FAINT, textAlign: 'right', fontWeight: value ? 600 : 400 }}>{value || '—'}</span>
    </div>
  )
}

export default function PersonProfile() {
  const { id = '' } = useParams()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [err, setErr] = useState('')

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
    mutationFn: (status: string) => api.patch(`/leads/${data!.lead!._id}/status`, { status }),
    onSuccess: () => { setErr(''); refresh() },
    onError: (e) => setErr(apiError(e)),
  })

  // Temperature, tags and the follow-up date all go through the same update,
  // so one edit cannot half-apply.
  const patchLead = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/leads/${data!.lead!._id}`, body),
    onSuccess: () => { setErr(''); refresh() },
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

  // Book Unit already accepts either, so the wizard opens with them filled in.
  const bookHref = isCustomer ? `/quotes/new?customer=${customer!._id}` : `/quotes/new?lead=${lead?._id ?? ''}`

  return (
    <div style={{ background: PAGE, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", color: INK }}>
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 cursor-pointer" style={{ background: 'none', border: 'none', color: INK_2, fontSize: 13, marginBottom: 14 }}>
        <ArrowLeft size={15} /> Back
      </button>

      <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: '24px 26px', marginBottom: 16 }}>
        <div className="flex items-start justify-between flex-wrap" style={{ gap: 16 }}>
          <div className="flex items-center" style={{ gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: 999, background: '#EDE5FF', color: DEEP, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 20 }}>
              {name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '—'}
            </div>
            <div>
              <h1 style={{ ...DISPLAY, fontSize: 26, fontWeight: 700, margin: 0 }}>{name}</h1>
              <div className="flex items-center flex-wrap" style={{ gap: 8, marginTop: 6, fontSize: 13, color: FAINT }}>
                <span className="rounded-full px-2.5 py-0.5" style={{
                  background: isCustomer ? '#DCFCE7' : (STATUS_TONE[lead?.status ?? 'new']?.bg ?? '#EDE5FF'),
                  color: isCustomer ? '#047857' : (STATUS_TONE[lead?.status ?? 'new']?.fg ?? DEEP),
                  fontSize: 11, fontWeight: 700,
                }}>
                  {isCustomer ? 'Customer' : statusLabel(lead?.status ?? 'new')}
                </span>
                {lead?.temperature && (() => {
                  const t = LEAD_TEMPERATURES.find((x) => x.value === lead.temperature)
                  return t ? (
                    <span className="rounded-full px-2.5 py-0.5" style={{ background: t.bg, color: t.fg, fontSize: 11, fontWeight: 700 }}>
                      {t.label}
                    </span>
                  ) : null
                })()}
                {phone && <a href={`tel:${phone}`} className="inline-flex items-center gap-1" style={{ color: INK_2 }}><Phone size={12} /> {phone}</a>}
                {email && <a href={`mailto:${email}`} className="inline-flex items-center gap-1" style={{ color: INK_2 }}><Mail size={12} /> {email}</a>}
              </div>
            </div>
          </div>

          <div className="flex items-center flex-wrap" style={{ gap: 8 }}>
            {waNumber && (
              <Link to={`/whatsapp?phone=${waNumber}`} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 cursor-pointer"
                style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', color: DEEP, fontSize: 13, fontWeight: 700 }}>
                <MessageCircle size={14} /> Chat
              </Link>
            )}
            {/* Available at both stages: the wizard creates the customer when a
                lead is booked, which is the point at which they become one. */}
            <Link to={bookHref} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-white cursor-pointer"
              style={{ background: PURPLE, fontSize: 13, fontWeight: 700 }}>
              <Briefcase size={14} /> Book unit
            </Link>
          </div>
        </div>

        {!!lead?.tags?.length && (
          <div className="flex flex-wrap" style={{ gap: 6, marginTop: 12 }}>
            {lead.tags.map((t) => (
              <span key={t} className="rounded-full px-2.5 py-1" style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', color: DEEP, fontSize: 11, fontWeight: 600 }}>
                {LEAD_TAGS.find((x) => x.value === t)?.label ?? t}
              </span>
            ))}
          </div>
        )}
        {lead?.followUpAt && (
          <p style={{ fontSize: 12, color: '#C2410C', marginTop: 10, fontWeight: 600 }}>
            Follow up on {formatDate(lead.followUpAt)}
          </p>
        )}

        {err && <p style={{ fontSize: 12, color: '#C0392B', marginTop: 10 }}>{err}</p>}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div className="space-y-4">
          <Card title="Details">
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
            {lead && !customer && <>
              <Detail label="Source" value={lead.source} />
              <Detail label="First seen" value={formatDate(lead.leadDateTime)} />
            </>}
          </Card>

          {lead && (
            <Card title="Ownership">
              <div className="space-y-3">
                <div>
                  <p style={{ fontSize: 11.5, color: FAINT, marginBottom: 4 }}>Assigned to</p>
                  {isAdmin ? (
                    <select
                      value={lead.owner?._id ?? ''}
                      onChange={(e) => assign.mutate(e.target.value)}
                      disabled={assign.isPending}
                      style={{ width: '100%', height: 38, borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', padding: '0 10px', fontSize: 13, color: INK }}
                    >
                      <option value="">Nobody</option>
                      {assignable.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
                    </select>
                  ) : (
                    <p style={{ fontSize: 13, fontWeight: 600 }}>{lead.owner?.name || 'Nobody'}</p>
                  )}
                </div>

                <div>
                  <p style={{ fontSize: 11.5, color: FAINT, marginBottom: 4 }}>Stage</p>
                  <select
                    value={lead.status}
                    onChange={(e) => setStatus.mutate(e.target.value)}
                    disabled={setStatus.isPending}
                    style={{ width: '100%', height: 38, borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', padding: '0 10px', fontSize: 13, color: INK }}
                  >
                    {LEAD_STATUS_FLOW.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  {/* What the stage means somebody should do next, so the
                      status is an instruction rather than a label. */}
                  <p style={{ fontSize: 11.5, color: FAINT, marginTop: 4 }}>
                    {LEAD_STATUS_FLOW.find((s) => s.value === lead.status)?.next}
                  </p>
                </div>

                {/* Temperature sits beside the stage, not inside it: a lead can
                    be Follow-Up Scheduled and hot, or Contacted and cold. */}
                <div>
                  <p style={{ fontSize: 11.5, color: FAINT, marginBottom: 4 }}>Temperature</p>
                  <div className="flex" style={{ gap: 6 }}>
                    {LEAD_TEMPERATURES.map((t) => {
                      const on = lead.temperature === t.value
                      return (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => patchLead.mutate({ temperature: on ? '' : t.value })}
                          className="cursor-pointer"
                          style={{
                            flex: 1, height: 32, borderRadius: 999, fontSize: 12, fontWeight: 700,
                            border: `1px solid ${on ? t.fg : LINE}`,
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

                {lead.status === 'follow_up_scheduled' && (
                  <div>
                    <p style={{ fontSize: 11.5, color: FAINT, marginBottom: 4 }}>Follow up on</p>
                    <input
                      type="date"
                      value={lead.followUpAt ? String(lead.followUpAt).slice(0, 10) : ''}
                      onChange={(e) => patchLead.mutate({ followUpAt: e.target.value || null })}
                      style={{ width: '100%', height: 38, borderRadius: 10, border: `1px solid ${LINE}`, background: '#fff', padding: '0 10px', fontSize: 13, color: INK }}
                    />
                  </div>
                )}

                <div>
                  <p style={{ fontSize: 11.5, color: FAINT, marginBottom: 6 }}>Tags</p>
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
                            borderRadius: 999, padding: '4px 10px', fontSize: 11.5, fontWeight: 600,
                            border: `1px solid ${on ? PURPLE : LINE}`,
                            background: on ? '#EDE5FF' : '#fff',
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
        </div>

        <div className="space-y-4">
          <Card
            title={isCustomer ? `Contracts (${contracts.length})` : 'Contracts'}
            action={<Link to={bookHref} style={{ fontSize: 12, fontWeight: 700, color: PURPLE }}>Book unit →</Link>}
          >
            {contracts.length === 0 ? (
              <p style={{ fontSize: 13, color: FAINT }}>
                {isCustomer ? 'No contracts yet.' : 'Not a customer yet — booking a unit creates the record.'}
              </p>
            ) : (
              <div className="space-y-2">
                {contracts.map((c) => {
                  const units = (c.units?.length ? c.units : c.unit ? [c.unit] : []).map((u) => u?.unitNumber).filter(Boolean)
                  return (
                    <Link key={c._id} to={`/contracts/${c._id}`} className="flex items-center justify-between gap-3"
                      style={{ padding: '10px 12px', border: `1px solid ${LINE}`, borderRadius: 12, fontSize: 13, color: INK }}>
                      <span>
                        <span style={{ fontWeight: 700, color: PURPLE }}>{c.contractNo}</span>
                        <span style={{ color: FAINT }}> · {units.join(', ') || 'no unit'}</span>
                      </span>
                      <span style={{ color: FAINT, fontSize: 12 }}>
                        {statusLabel(c.status)} · {formatDate(c.startDate)}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </Card>

          <Card title={`Documents (${documents.length})`}>
            {documents.length === 0 ? (
              <p style={{ fontSize: 13, color: FAINT }}>Nothing uploaded.</p>
            ) : (
              <div className="space-y-1.5">
                {documents.map((d) => (
                  <a key={d._id} href={d.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2"
                    style={{ fontSize: 13, padding: '6px 0', borderBottom: `1px solid ${LINE}` }}>
                    <span className="inline-flex items-center gap-1.5"><FileText size={13} style={{ color: FAINT }} /> {d.name}</span>
                    <span style={{ color: FAINT, fontSize: 11.5 }}>{statusLabel(d.type)}</span>
                  </a>
                ))}
              </div>
            )}
          </Card>

          {lead?.notes && (
            <Card title="Notes">
              <p style={{ fontSize: 13, color: INK_2, whiteSpace: 'pre-wrap' }}>{lead.notes}</p>
            </Card>
          )}
        </div>
      </div>

      {/* Said rather than left implicit: which half of the record exists tells
          you what stage the person is at, and both halves rarely exist at once
          early on. */}
      <p style={{ fontSize: 11.5, color: FAINT, marginTop: 16 }}>
        {isCustomer
          ? <><UserCheck size={11} style={{ display: 'inline' }} /> Customer record{lead ? ' · still linked to the original lead' : ''}</>
          : <><UserPlus size={11} style={{ display: 'inline' }} /> Lead only — no customer record yet</>}
      </p>
    </div>
  )
}

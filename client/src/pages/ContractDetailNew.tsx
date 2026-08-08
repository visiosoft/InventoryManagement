import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { api, apiError, quoteApi } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { AppDocument, Contract, Invoice, Payment, Quote, Unit } from '../lib/types'
import { Spinner } from '../components/ui'
import { formatMoney } from '../lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────────
type ContractDetailData = {
  contract: Contract
  payments: Payment[]
  documents: AppDocument[]
  invoices?: Invoice[]
}

type FollowUp = { note: string; date: string; time: string; done?: boolean }

type Tab = 'activity' | 'units' | 'quotations' | 'contracts' | 'documents' | 'moving' | 'notices'

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmtShort = (d: string | Date | null | undefined) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const weeksOpts = Array.from({ length: 52 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}w` }))

const stopProp = (e: React.MouseEvent) => e.stopPropagation()

// ── Main component ─────────────────────────────────────────────────────────────
export default function ContractDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()

  // ── Data fetching ──
  const { data, isLoading } = useQuery<ContractDetailData>({
    queryKey: ['contract', id],
    queryFn: () => api.get(`/contracts/${id}`).then(r => r.data),
  })

  const { data: unitOptions = [] } = useQuery<Unit[]>({
    queryKey: ['units', 'contract-detail-all'],
    queryFn: async () => {
      const r = await api.get('/units', { params: { limit: 2000 } })
      return (Array.isArray(r.data) ? r.data : r.data?.data ?? []) as Unit[]
    },
    staleTime: 60_000,
  })

  const { data: quotes = [] } = useQuery<Quote[]>({
    queryKey: ['quotes', 'for-customer', data?.contract?.customer?._id],
    queryFn: () => quoteApi.list({ customer: data?.contract?.customer?._id }),
    enabled: !!data?.contract?.customer?._id,
  })

  // ── State ──
  const [activeTab, setActiveTab] = useState<Tab>('activity')
  const [noteText, setNoteText] = useState('')
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [showScheduleFollowUp, setShowScheduleFollowUp] = useState(false)
  const [followUpForm, setFollowUpForm] = useState({ note: '', date: '', time: '' })
  const [showAddBooking, setShowAddBooking] = useState(false)
  const [bookingSearch, setBookingSearch] = useState('')
  const [showFacilityMap, setShowFacilityMap] = useState(false)
  const [showCreateContract, setShowCreateContract] = useState(false)
  const [showReviewQuote, setShowReviewQuote] = useState(false)
  const [showReviewContract, setShowReviewContract] = useState(false)
  const [showContractPreview, setShowContractPreview] = useState(false)
  const [showNoticeEditor, setShowNoticeEditor] = useState(false)
  const [showAddService, setShowAddService] = useState(false)
  const [showAddNotice, setShowAddNotice] = useState(false)
  const [showAddMovingRequest, setShowAddMovingRequest] = useState(false)
  const [selectedUnits, setSelectedUnits] = useState<string[]>([])
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [error, setError] = useState('')

  // Service form
  const [serviceForm, setServiceForm] = useState({ label: '', amount: '' })

  // Notice state
  const [activeNoticeTitle, setActiveNoticeTitle] = useState('')
  const [noticeText, setNoticeText] = useState('')
  const [noticeSendEmail, setNoticeSendEmail] = useState(true)
  const [noticeSendWhatsapp, setNoticeSendWhatsapp] = useState(false)
  const [noticeTitleValue, setNoticeTitleValue] = useState('')
  const [noticeMessageValue, setNoticeMessageValue] = useState('')
  const [manualNotices, setManualNotices] = useState<{ title: string; message: string }[]>([])

  // Moving state
  const [movingForm, setMovingForm] = useState({ location: '', pkg: '', date: '', time: '', customerName: '', phone: '' })
  const [movingRequests, setMovingRequests] = useState<any[]>([])

  // Contract form state
  const [contractForm, setContractForm] = useState({
    fullName: '', contractNo: '', idType: 'Emirates ID', idNumber: '',
    email: '', contactNumber: '', whatsapp: '', emergencyName: '', emergencyNumber: '',
    moveIn: '', moveOut: '', accessType: 'Private', totalAmount: '',
    installments: '1',
  })
  const [paymentSchedule, setPaymentSchedule] = useState<{ dueDate: string; amount: string; primary: string; secondary: string }[]>([])
  const [authorizedPersons, setAuthorizedPersons] = useState<{ name: string; mobile: string; email: string; relationship: string }[]>([])

  // ── Mutations ──
  function invalidate() {
    qc.invalidateQueries({ queryKey: ['contract', id] })
    qc.invalidateQueries({ queryKey: ['contracts'] })
    qc.invalidateQueries({ queryKey: ['payments'] })
    qc.invalidateQueries({ queryKey: ['units'] })
  }

  const addNote = useMutation({
    mutationFn: (text: string) => api.post(`/contracts/${id}/notes`, { text, author: user?.name || '' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract', id] }); setNoteText('') },
    onError: (e) => setError(apiError(e)),
  })

  const deleteContract = useMutation({
    mutationFn: () => api.delete(`/contracts/${id}`),
    onSuccess: () => navigate('/contracts'),
    onError: (e) => setError(apiError(e)),
  })

  const actionMutation = useMutation({
    mutationFn: (path: string) => api.post(`/contracts/${id}/${path}`),
    onSuccess: () => { invalidate(); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  // ── Loading ──
  if (isLoading || !data) return <Spinner />

  const { contract: c, payments, documents } = data
  const allUnits = c.units?.length ? c.units : c.unit ? [c.unit] : []
  const customer = c.customer

  // Computed values
  const initials = (customer?.fullName ?? '').split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase()
  const paidTotal = payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
  const totalOwed = Math.max(Number(c.totalQuotation || 0), payments.reduce((s, p) => s + p.amount, 0))
  const remaining = Math.max(0, totalOwed - paidTotal)
  const nextDuePayment = payments.filter(p => p.status !== 'paid').sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0]

  // Unit chips
  const unitChips = allUnits.map(u => ({
    label: `${u.unitNumber}${u.sizeSqf ? ` · ${u.sizeSqf}sqft` : ''}`,
    style: { background: '#EDE5FF', color: '#4A1FA0', fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px' },
  }))

  // Activity timeline — sorted on the raw timestamp, displayed like the design:
  // "9 Aug 2026, 01:03 AM · You"
  const fmtWhen = (d: string | Date) => {
    const dt = new Date(d)
    const date = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    const time = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    return `${date}, ${time}`
  }
  type ActivityEvent = { id: string; at: number; when: string; author: string; text: string; type: string }
  const activityEvents: ActivityEvent[] = []
  for (const [i, note] of (c.timeline ?? []).entries()) {
    activityEvents.push({
      id: `note-${i}`,
      at: new Date(note.at).getTime() || 0,
      when: fmtWhen(note.at),
      author: note.author && note.author === user?.name ? 'You' : (note.author || ''),
      text: note.text,
      type: /^Updated |changed to |^Created from |generated from /i.test(note.text) ? 'edit' : 'note',
    })
  }
  for (const p of payments.filter(p => p.status === 'paid')) {
    activityEvents.push({
      id: `paid-${p._id}`,
      at: new Date(p.paidDate || p.dueDate).getTime() || 0,
      when: fmtWhen(p.paidDate || p.dueDate),
      author: '',
      text: `Payment received · ${formatMoney(p.amount)} AED`,
      type: 'payment',
    })
  }
  activityEvents.sort((a, b) => b.at - a.at)

  // Live alerts, computed the way the design shows them: outstanding balances
  // and contracts inside their last 30 days.
  const daysLeft = c.endDate ? Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000) : null
  const liveAlerts: { text: string; tag: string; bg: string; color: string }[] = []
  const overdueTotal = payments.filter(p => p.status === 'overdue').reduce((s, p) => s + p.amount, 0)
  if (overdueTotal > 0) {
    liveAlerts.push({
      text: `${allUnits[0]?.unitNumber || c.contractNo} has an outstanding balance of AED ${formatMoney(overdueTotal)}.`,
      tag: 'Payment overdue', bg: '#FEE2E2', color: '#DC2626',
    })
  }
  if (c.status === 'active' && daysLeft !== null && daysLeft >= 0 && daysLeft <= 30) {
    for (const u of allUnits) {
      liveAlerts.push({
        text: `${u.unitNumber} — ${daysLeft}d left on the current contract.`,
        tag: 'Contract expiring', bg: '#FEF3C7', color: '#92400E',
      })
    }
  }

  // Inline edit helpers
  const saveInlineField = async (field: string, val: string) => {
    const body: Record<string, unknown> = {}
    if (field === 'startDate' || field === 'endDate') body[field] = val
    else if (field === 'weeks') {
      const w = Number(val)
      if (w > 0 && c.startDate) {
        const d = new Date(c.startDate)
        d.setDate(d.getDate() + w * 7)
        body.endDate = d.toISOString().slice(0, 10)
      }
    } else body[field] = Number(val) || 0
    try { await api.put(`/contracts/${id}`, body); invalidate() } catch (e: any) { setError(apiError(e)) }
    setEditingField(null)
  }

  const weeks = c.startDate && c.endDate
    ? Math.ceil(Math.round((new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / 86400000) / 7)
    : null

  const askingPrice = Number(c.rate || 0)
  const discountPct = Number((c as any).firstMonthDiscountPct || 0)
  const leasedPrice = Number(c.leasedPrice) || Math.round(askingPrice * (1 - discountPct / 100) * 100) / 100

  // Tabs
  const tabs: { key: Tab; label: string }[] = [
    { key: 'activity', label: 'Activity' },
    { key: 'units', label: 'Units' },
    { key: 'quotations', label: 'Quotations' },
    { key: 'contracts', label: 'Contracts' },
    { key: 'documents', label: 'Documents' },
    { key: 'moving', label: 'Moving Service Request' },
    { key: 'notices', label: 'Notices & Alerts' },
  ]

  // Available units for booking
  const availableUnits = unitOptions.filter(u =>
    u.status === 'available' || u.shared || allUnits.some(au => au._id === u._id)
  )
  const filteredBookingUnits = bookingSearch
    ? availableUnits.filter(u => u.unitNumber.toLowerCase().includes(bookingSearch.toLowerCase()) || (u.floor || '').toLowerCase().includes(bookingSearch.toLowerCase()))
    : availableUnits

  // Facility map zones
  const zoneMap = new Map<string, Unit[]>()
  for (const u of unitOptions) {
    const zone = u.floor || 'Ground'
    if (!zoneMap.has(zone)) zoneMap.set(zone, [])
    zoneMap.get(zone)!.push(u)
  }

  // Notice library
  const noticeLibrary = [
    'Payment Reminder',
    '21-Day Termination / Non-Renewal Notice',
    'Notice of Entry by PurpleBox',
    'Move-Out Deficiency / Property Left Behind Notice',
    'Damage / Cleaning / Restoration Charge Notice',
    'Prohibited or Unauthorized Goods Notice',
    'Abandonment / Unresponsive Customer Notice',
    '24-Hour Overdue Notice',
    '7-Day Default Termination and Re-Entry Notice',
    'Notice of Intent to Dispose',
    'Final Disposal / Sale Accounting',
  ]

  // Moving packages
  const movingPackages = ['Studio', '1 Bedroom', '2 Bedroom', '3 Bedroom', 'Villa (Small)', 'Villa (Large)', 'Office', 'Custom']

  // Prefill contract form from customer
  const prefillContract = () => {
    setContractForm({
      fullName: customer?.fullName || '',
      contractNo: c.contractNo || '',
      idType: customer?.emiratesId ? 'Emirates ID' : 'Passport',
      idNumber: customer?.emiratesId || customer?.passportNumber || '',
      email: customer?.email || '',
      contactNumber: customer?.phone || '',
      whatsapp: customer?.phone || '',
      emergencyName: '',
      emergencyNumber: customer?.emergencyNumber || '',
      moveIn: c.startDate?.slice(0, 10) || '',
      moveOut: c.endDate?.slice(0, 10) || '',
      accessType: 'Private',
      totalAmount: String(c.totalQuotation || totalOwed || ''),
      installments: '1',
    })
    setPaymentSchedule([{ dueDate: c.startDate?.slice(0, 10) || '', amount: String(c.totalQuotation || totalOwed || ''), primary: '', secondary: '' }])
    setAuthorizedPersons((c.authorizedPersons || []).map(p => ({ name: p.name, mobile: p.phone || '', email: '', relationship: p.relation || '' })))
    setShowCreateContract(true)
  }

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)', padding: '20px 28px 28px' }}>
      {/* Back */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 mb-4 px-3 py-2 rounded-lg text-sm font-medium text-[#756E80] hover:text-[#14081F] hover:bg-[#F7F3FF] transition-colors cursor-pointer">
        <span className="text-lg leading-none">←</span> Back
      </button>

      {/* Title */}
      <div style={{ padding: '0 0 4px', fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: '#14081F' }}>
        Contract overview
      </div>

      {/* Main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 20, padding: '20px 0' }}>
        {/* ── LEFT PANEL ── */}
        <div style={{ background: '#FBF8F2', border: '1px solid rgba(20,8,31,.10)', borderRadius: 16, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, alignSelf: 'start' }}>
          {/* Customer avatar + name */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 999, background: '#5B2BC9', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14 }}>
              {initials}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{customer?.fullName || '—'}</div>
              <div style={{ fontSize: 11, color: '#756E80' }}>{customer?.email || ''}</div>
            </div>
          </div>

          {/* Contact info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#756E80' }}>Contact</span>
              <span style={{ fontWeight: 600 }}>{customer?.phone || '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#756E80' }}>WhatsApp</span>
              <span style={{ fontWeight: 600 }}>{customer?.phone || '—'}</span>
            </div>
          </div>

          {/* Unit chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {unitChips.map((chip, i) => (
              <div key={i} style={chip.style}>{chip.label}</div>
            ))}
            {unitChips.length === 0 && <span style={{ fontSize: 11, color: '#756E80' }}>No units</span>}
          </div>

          {/* Financials */}
          <div style={{ borderTop: '1px solid rgba(20,8,31,.10)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: '#4A4357' }}>Total Quotation</span>
              <span style={{ fontWeight: 700 }}>AED {formatMoney(c.totalQuotation || totalOwed)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: '#4A4357' }}>Received</span>
              <span style={{ fontWeight: 700 }}>AED {formatMoney(paidTotal)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: '#DC2626' }}>Remaining</span>
              <span style={{ fontWeight: 700, color: '#DC2626' }}>AED {formatMoney(remaining)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: '#4A4357' }}>Next due date</span>
              <span style={{ fontWeight: 700 }}>{nextDuePayment ? fmtShort(nextDuePayment.dueDate) : '—'}</span>
            </div>
          </div>

          {/* Follow-ups */}
          <div style={{ borderTop: '1px solid rgba(20,8,31,.10)', paddingTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em' }}>Follow-ups</div>
              <span onClick={() => setShowScheduleFollowUp(true)} style={{ fontSize: 11.5, fontWeight: 700, color: '#5B2BC9', cursor: 'pointer' }}>+ Schedule</span>
            </div>
            {followUps.map((fu, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, fontSize: 12, background: '#F7F3FF', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 700, textDecoration: fu.done ? 'line-through' : undefined }}>{fu.date} {fu.time}</div>
                  <div style={{ color: '#4A4357', textDecoration: fu.done ? 'line-through' : undefined }}>{fu.note}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  <svg onClick={() => setFollowUps(prev => prev.map((f, j) => j === i ? { ...f, done: true } : f))} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'pointer' }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span onClick={() => setFollowUps(prev => prev.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: '#DC2626', fontWeight: 700 }}>×</span>
                </div>
              </div>
            ))}
            {followUps.length === 0 && <div style={{ fontSize: 11, color: '#756E80' }}>No follow-ups scheduled.</div>}
          </div>
        </div>

        {/* ── RIGHT CONTENT ── */}
        <div style={{ minWidth: 0 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 22, borderBottom: '1px solid rgba(20,8,31,.10)', paddingBottom: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {tabs.map(t => (
              <div key={t.key} onClick={() => setActiveTab(t.key)} style={{
                fontSize: 13, fontWeight: activeTab === t.key ? 700 : 500, cursor: 'pointer',
                color: activeTab === t.key ? '#5B2BC9' : '#756E80',
                borderBottom: activeTab === t.key ? '2px solid #5B2BC9' : '2px solid transparent',
                paddingBottom: 8,
              }}>
                {t.label}
              </div>
            ))}
          </div>

          {/* ── ACTIVITY TAB ── */}
          {activeTab === 'activity' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Activity</div>
              </div>

              {/* Add note */}
              <div style={{ border: '1px solid rgba(20,8,31,.10)', borderRadius: 14, padding: '16px 18px', marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Add Note</div>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#756E80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                  </svg>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Type a note or follow-up…"
                    style={{ flex: 1, height: 56, borderRadius: 10, border: '1px solid rgba(20,8,31,.16)', padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
                  />
                  <div
                    onClick={() => { if (noteText.trim()) addNote.mutate(noteText.trim()) }}
                    style={{ height: 38, padding: '0 18px', borderRadius: 8, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    Add note
                  </div>
                </div>
              </div>

              {/* Live alerts */}
              {liveAlerts.length > 0 && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Live alerts</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                    {liveAlerts.map((a, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, border: '1px solid rgba(20,8,31,.10)', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
                        <span style={{ fontSize: 13, color: '#14081F' }}>{a.text}</span>
                        <span style={{ background: a.bg, color: a.color, fontSize: 10, padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 600 }}>{a.tag}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Timeline */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Timeline</div>
              {activityEvents.length > 0 ? (
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 3, top: 6, bottom: 6, width: 2, background: 'rgba(20,8,31,.10)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {activityEvents.map(ev => (
                      <div key={ev.id} style={{ display: 'flex', gap: 14 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 999, background: '#5B2BC9', marginTop: 5, flexShrink: 0, zIndex: 1 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11.5, color: '#756E80', fontWeight: 600, marginBottom: 2 }}>{ev.when} · {ev.author}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <span style={{ fontSize: 13 }}>{ev.text}</span>
                            <span style={{
                              background: ev.type === 'payment' ? '#DCFCE7' : ev.type === 'edit' ? '#DBEAFE' : '#EDE5FF',
                              color: ev.type === 'payment' ? '#15803D' : ev.type === 'edit' ? '#1D4ED8' : '#4A1FA0',
                              fontSize: 10, padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 600,
                            }}>
                              {ev.type === 'payment' ? 'Payment' : ev.type === 'edit' ? 'Edit' : 'Note'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#756E80' }}>No activity yet — edits, quotes, contracts, and notices will appear here.</div>
              )}
            </div>
          )}

          {/* ── UNITS TAB ── */}
          {activeTab === 'units' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                {selectedUnits.length > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                    <span style={{ fontWeight: 700 }}>{selectedUnits.length} selected</span>
                    <span onClick={prefillContract} style={{ fontWeight: 700, color: '#5B2BC9', cursor: 'pointer' }}>Create contract from selection</span>
                  </div>
                ) : <div />}
                <div style={{ display: 'flex', gap: 8 }}>
                  <div onClick={() => setShowReviewQuote(true)} style={{ height: 32, padding: '0 14px', borderRadius: 999, border: '1px solid #5B2BC9', color: '#5B2BC9', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Review quote</div>
                  <div onClick={() => setShowAddBooking(true)} style={{ height: 32, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(20,8,31,.16)', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Add new booking</div>
                </div>
              </div>

              {/* Add booking panel */}
              {showAddBooking && (
                <div style={{ border: '1px solid #DDD0FF', background: '#F7F3FF', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#4A1FA0', marginBottom: 10 }}>Search and select one or more units — each can have its own dates and price</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                    <input placeholder="Search available units…" value={bookingSearch} onChange={e => setBookingSearch(e.target.value)}
                      style={{ height: 36, maxWidth: 260, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13 }} />
                    <div onClick={() => setShowFacilityMap(true)} style={{ height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid #5B2BC9', color: '#5B2BC9', display: 'flex', alignItems: 'center', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>View facility map</div>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '20px 90px 140px 100px 100px 90px 100px 24px', gap: 8, padding: '0 0 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#756E80', minWidth: 700 }}>
                      <span /><span>Unit</span><span>Check In</span><span>Weeks</span><span>Check Out</span><span style={{ textAlign: 'right' }}>Price/4w</span><span style={{ textAlign: 'right' }}>Total</span><span />
                    </div>
                    {filteredBookingUnits.slice(0, 10).map(u => (
                      <div key={u._id} style={{ display: 'grid', gridTemplateColumns: '20px 90px 140px 100px 100px 90px 100px 24px', gap: 8, alignItems: 'center', padding: '6px 0', minWidth: 700 }}>
                        <input type="checkbox" style={{ width: 15, height: 15, cursor: 'pointer' }} />
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{u.unitNumber}</span>
                        <input type="date" defaultValue={c.startDate?.slice(0, 10)} style={{ height: 30, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 13 }} />
                        <select defaultValue="4" style={{ height: 30, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 6px', fontSize: 13 }}>
                          {weeksOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <span style={{ fontSize: 13, color: '#4A4357' }}>—</span>
                        <input defaultValue={String(u.price || '')} style={{ height: 30, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 13, textAlign: 'right' }} />
                        <span style={{ textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{u.price ? formatMoney(u.price) : '—'}</span>
                        <span />
                      </div>
                    ))}
                    {filteredBookingUnits.length === 0 && (
                      <div style={{ fontSize: 12, color: '#756E80', padding: '8px 0' }}>No units match that search.</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <div onClick={() => setShowAddBooking(false)} style={{ height: 32, padding: '0 14px', borderRadius: 8, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Confirm selection</div>
                    <div onClick={() => setShowAddBooking(false)} style={{ height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</div>
                  </div>
                </div>
              )}

              {/* Ledger table */}
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '22px 95px 72px 88px 88px 65px 85px 85px 95px 90px 90px 160px', gap: 14, padding: '0 6px 8px', borderBottom: '1px solid rgba(20,8,31,.16)', fontSize: 13, fontWeight: 700, minWidth: 1140 }}>
                  <span /><span /><span>Type</span><span>Check In</span><span>Check Out</span><span style={{ textAlign: 'right' }}>Asking</span><span style={{ textAlign: 'right' }}>Lease</span><span style={{ textAlign: 'right' }}>Weeks</span><span style={{ textAlign: 'right' }}>Total</span><span style={{ textAlign: 'right' }}>Received</span><span style={{ textAlign: 'right' }}>Pending</span><span>Next Booking</span>
                </div>
                {allUnits.map(u => {
                  const unitTotal = c.totalQuotation || totalOwed
                  const unitReceived = paidTotal
                  const unitPending = remaining
                  return (
                    <div key={u._id} style={{ marginTop: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '22px 95px 72px 88px 88px 65px 85px 85px 95px 90px 90px 160px', gap: 14, alignItems: 'center', padding: '7px 6px', fontSize: 13, minWidth: 1140 }}>
                        <input type="checkbox" checked={selectedUnits.includes(u._id)} onChange={() => setSelectedUnits(prev => prev.includes(u._id) ? prev.filter(x => x !== u._id) : [...prev, u._id])} style={{ width: 14, height: 14, cursor: 'pointer' }} />
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 700 }}>{u.unitNumber}</span>
                          {c.status === 'draft' && <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: 10, padding: '1px 6px', borderRadius: 6, fontWeight: 600 }}>Draft</span>}
                        </span>
                        <span style={{ background: u.shared ? '#DDD0FF' : '#EDE5FF', color: u.shared ? '#5B2BC9' : '#4A1FA0', fontSize: 10, padding: '2px 7px', borderRadius: 6, fontWeight: 600, justifySelf: 'start', textTransform: 'capitalize' }}>
                          {u.shared ? 'Shared' : 'Private'}
                        </span>

                        {/* Check In */}
                        {editingField === `checkIn-${u._id}` ? (
                          <input value={editingValue} onChange={e => setEditingValue(e.target.value)}
                            onBlur={() => { saveInlineField('startDate', editingValue); setEditingField(null) }}
                            autoFocus
                            style={{ width: 80, height: 24, border: '1px solid #5B2BC9', borderRadius: 6, padding: '0 6px', fontSize: 13 }} />
                        ) : (
                          <span onClick={() => { setEditingField(`checkIn-${u._id}`); setEditingValue(c.startDate?.slice(0, 10) || '') }} style={{ cursor: 'pointer', borderBottom: '1px dashed rgba(20,8,31,.3)', color: '#14081F' }}>
                            {c.startDate ? fmtShort(c.startDate) : '—'}
                          </span>
                        )}

                        {/* Check Out */}
                        {editingField === `checkOut-${u._id}` ? (
                          <input value={editingValue} onChange={e => setEditingValue(e.target.value)}
                            onBlur={() => { saveInlineField('endDate', editingValue); setEditingField(null) }}
                            autoFocus
                            style={{ width: 80, height: 24, border: '1px solid #5B2BC9', borderRadius: 6, padding: '0 6px', fontSize: 13 }} />
                        ) : (
                          <span onClick={() => { setEditingField(`checkOut-${u._id}`); setEditingValue(c.endDate?.slice(0, 10) || '') }} style={{ cursor: 'pointer', borderBottom: '1px dashed rgba(20,8,31,.3)', color: '#14081F' }}>
                            {c.endDate ? fmtShort(c.endDate) : '—'}
                          </span>
                        )}

                        <span style={{ textAlign: 'right', color: '#14081F' }}>{formatMoney(askingPrice)}</span>

                        {/* Lease rate */}
                        {editingField === `lease-${u._id}` ? (
                          <input value={editingValue} onChange={e => setEditingValue(e.target.value)}
                            onBlur={() => { saveInlineField('leasedPrice', editingValue); setEditingField(null) }}
                            autoFocus
                            style={{ width: 65, height: 24, textAlign: 'right', border: '1px solid #5B2BC9', borderRadius: 6, padding: '0 6px', fontSize: 13, justifySelf: 'end' }} />
                        ) : (
                          <span onClick={() => { setEditingField(`lease-${u._id}`); setEditingValue(String(leasedPrice)) }} style={{ textAlign: 'right', cursor: 'pointer', borderBottom: '1px dashed rgba(20,8,31,.3)', color: '#4A4357' }}>
                            {formatMoney(leasedPrice)}
                          </span>
                        )}

                        <span style={{ textAlign: 'right', fontSize: 12.5, color: '#4A4357' }}>{weeks ?? '—'}</span>
                        <span style={{ textAlign: 'right', fontWeight: 700 }}>{formatMoney(unitTotal)}</span>
                        <span style={{ textAlign: 'right', color: '#16A34A' }}>{formatMoney(unitReceived)}</span>
                        <span style={{ textAlign: 'right', color: '#DC2626' }}>{formatMoney(unitPending)}</span>

                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <span style={{ background: c.status === 'active' ? '#DCFCE7' : '#FEF3C7', color: c.status === 'active' ? '#15803D' : '#92400E', fontSize: 10, padding: '2px 7px', borderRadius: 6, fontWeight: 600 }}>
                            {c.status === 'active' ? 'Active' : c.status === 'ended' ? 'Ended' : 'Available'}
                          </span>
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Services / Add items */}
              <div style={{ marginTop: 16, borderTop: '1px solid rgba(20,8,31,.10)', paddingTop: 8 }}>
                <div onClick={() => setShowAddService(true)} style={{ fontSize: 12, fontWeight: 700, color: '#5B2BC9', cursor: 'pointer', padding: 4 }}>+ Add item</div>
                {showAddService && (
                  <div style={{ margin: '6px 4px', padding: 10, background: '#F7F3FF', border: '1px solid #DDD0FF', borderRadius: 10, display: 'flex', gap: 10, alignItems: 'flex-end', maxWidth: 400 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Item</div>
                      <input value={serviceForm.label} onChange={e => setServiceForm(f => ({ ...f, label: e.target.value }))} placeholder="e.g. Padlock"
                        style={{ height: 30, width: 130, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 13 }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Amount</div>
                      <input value={serviceForm.amount} onChange={e => setServiceForm(f => ({ ...f, amount: e.target.value }))}
                        style={{ height: 30, width: 90, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 13, textAlign: 'right' }} />
                    </div>
                    <div onClick={() => { setShowAddService(false); setServiceForm({ label: '', amount: '' }) }} style={{ height: 30, padding: '0 12px', borderRadius: 8, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Add</div>
                    <div onClick={() => setShowAddService(false)} style={{ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</div>
                  </div>
                )}
                {/* Total row */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '9px 4px 0', fontSize: 13, fontWeight: 700, borderTop: '2px solid rgba(20,8,31,.16)', marginTop: 6 }}>
                  <span style={{ marginRight: 16 }}>Total</span>
                  <span>AED {formatMoney(c.totalQuotation || totalOwed)}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── QUOTATIONS TAB ── */}
          {activeTab === 'quotations' && (
            <div>
              {quotes.length === 0 ? (
                <div style={{ fontSize: 13, color: '#756E80', padding: 16 }}>No quotations found for this customer.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {quotes.map(q => (
                    <div key={q._id} style={{ border: '1px solid rgba(20,8,31,.10)', borderRadius: 14, padding: '20px 22px', background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>{q.customer?.fullName}</div>
                          <div style={{ fontSize: 12, color: '#756E80', marginTop: 4 }}>{q.customer?.email}</div>
                          <div style={{ fontSize: 12, color: '#4A1FA0', fontWeight: 600, marginTop: 6 }}>{q.subject || 'Storage Quotation'}</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: '#756E80' }}>Quote</div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{q.quoteNo}</div>
                          <div style={{ fontSize: 11, color: '#756E80', marginTop: 6 }}>Date</div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtShort(q.quoteDate)}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 11, color: '#756E80', textTransform: 'uppercase', letterSpacing: '.06em' }}>Amount</div>
                          <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800, fontSize: 22, color: '#5B2BC9' }}>AED {formatMoney(q.total)}</div>
                        </div>
                      </div>

                      {/* Line items */}
                      <div style={{ marginTop: 18, borderTop: '2px solid #DDD0FF', borderBottom: '1px solid #DDD0FF', background: '#F7F3FF' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 70px 100px', padding: '8px 4px', fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                          <span>Product / Service</span><span style={{ textAlign: 'right' }}>Unit Cost</span><span style={{ textAlign: 'right' }}>Qty</span><span style={{ textAlign: 'right' }}>Price</span>
                        </div>
                      </div>
                      {(q.items || []).map((it, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 70px 100px', padding: '10px 4px', fontSize: 13, borderBottom: '1px solid rgba(20,8,31,.06)' }}>
                          <span>{it.itemDetails}</span>
                          <span style={{ textAlign: 'right', color: '#4A4357' }}>{formatMoney(it.rate)}</span>
                          <span style={{ textAlign: 'right', color: '#4A4357' }}>{it.quantity}</span>
                          <span style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(it.amount)}</span>
                        </div>
                      ))}

                      {/* Total */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                        <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800, color: '#5B2BC9', borderTop: '2px solid rgba(20,8,31,.12)', paddingTop: 8 }}>
                            <span>Total</span><span>AED {formatMoney(q.total)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(20,8,31,.10)' }}>
                        <div>
                          <span style={{ background: q.status === 'accepted' ? '#DCFCE7' : '#EDE5FF', color: q.status === 'accepted' ? '#15803D' : '#4A1FA0', fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 600, textTransform: 'capitalize' }}>{q.status}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <div onClick={() => navigate(`/quotes/${q._id}`)} style={{ height: 34, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', display: 'flex', alignItems: 'center', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>View</div>
                          {q.status !== 'accepted' && (
                            <div onClick={async () => { try { await quoteApi.updateStatus(q._id, 'accepted'); qc.invalidateQueries({ queryKey: ['quotes'] }) } catch {} }}
                              style={{ height: 34, padding: '0 16px', borderRadius: 8, background: '#16A34A', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Accept</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── CONTRACTS TAB ── */}
          {activeTab === 'contracts' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <div onClick={prefillContract} style={{ height: 32, padding: '0 14px', borderRadius: 999, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>+ Add contract</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 170px 150px 1fr', padding: '0 6px 8px', borderBottom: '1px solid rgba(20,8,31,.14)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase' }}>Units</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase' }}>Contract No.</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase' }}>Status</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', textAlign: 'right' }}>Actions</span>
              </div>
              {/* Current contract row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 170px 150px 1fr', alignItems: 'center', padding: '11px 6px', borderBottom: '1px solid rgba(20,8,31,.06)' }}>
                <span style={{ fontWeight: 700 }}>{allUnits.map(u => u.unitNumber).join(', ') || '—'}</span>
                <span style={{ color: '#4A4357' }}>{c.contractNo}</span>
                <span>
                  <span style={{
                    background: c.status === 'active' ? '#DCFCE7' : c.status === 'draft' ? '#FEF3C7' : c.status === 'ended' ? '#FEE2E2' : '#EDE5FF',
                    color: c.status === 'active' ? '#15803D' : c.status === 'draft' ? '#92400E' : c.status === 'ended' ? '#DC2626' : '#4A1FA0',
                    fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 600, textTransform: 'capitalize',
                  }}>{c.status?.replace('_', ' ')}</span>
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                  {c.status === 'draft' && (
                    <span onClick={() => actionMutation.mutate('activate')} style={{ fontSize: 12, fontWeight: 700, color: '#16A34A', cursor: 'pointer' }}>Activate</span>
                  )}
                  {c.status === 'pending_signature' && (
                    <span onClick={() => actionMutation.mutate('mark-signed')} style={{ fontSize: 12, fontWeight: 700, color: '#16A34A', cursor: 'pointer' }}>Mark as signed</span>
                  )}
                  {c.status === 'active' && (
                    <span onClick={() => { if (confirm('End this contract?')) actionMutation.mutate('end') }} style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', cursor: 'pointer' }}>End contract</span>
                  )}
                  {['ended', 'cancelled'].includes(c.status) && (
                    <span onClick={() => { if (confirm('Delete this contract permanently?')) deleteContract.mutate() }} style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', cursor: 'pointer' }}>Delete</span>
                  )}
                  <span onClick={() => setShowReviewContract(true)} style={{ fontSize: 12, fontWeight: 700, color: '#5B2BC9', cursor: 'pointer' }}>Review</span>
                </span>
              </div>
            </div>
          )}

          {/* ── DOCUMENTS TAB ── */}
          {activeTab === 'documents' && (
            <div>
              {/* Identity documents */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Identity documents</div>
              <div style={{ display: 'flex', gap: 12, marginBottom: 22 }}>
                {[
                  { label: 'Emirates ID', hasDoc: documents.some(d => d.type === 'id_proof' && d.name.toLowerCase().includes('emirates')) },
                  { label: 'Passport', hasDoc: documents.some(d => d.type === 'id_proof' && d.name.toLowerCase().includes('passport')) },
                ].map((item, i) => (
                  <div key={i} style={{ flex: 1, border: '1px solid rgba(20,8,31,.14)', borderRadius: 12, padding: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{item.label}</div>
                    {item.hasDoc ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: '#15803D', background: '#DCFCE7', borderRadius: 8, padding: '8px 10px' }}>
                        <span>Uploaded</span>
                      </div>
                    ) : (
                      <label style={{ display: 'inline-flex', alignItems: 'center', height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid #5B2BC9', color: '#5B2BC9', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', marginTop: 6, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        Upload {item.label}
                        <input type="file" onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          const form = new FormData()
                          form.append('file', file)
                          form.append('type', 'id_proof')
                          form.append('name', `${item.label} - ${customer?.fullName}`)
                          if (c._id) form.append('contract', c._id)
                          if (customer?._id) form.append('customer', customer._id)
                          try { await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } }); invalidate() } catch (e: any) { setError(apiError(e)) }
                        }} style={{ display: 'none' }} />
                      </label>
                    )}
                  </div>
                ))}
              </div>

              {/* Signed contracts */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Signed contracts</div>
              {c.signedDocUrl ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(20,8,31,.10)', borderRadius: 10, padding: '10px 12px', fontSize: 13, marginBottom: 22 }}>
                  <span><span style={{ fontWeight: 700 }}>{allUnits.map(u => u.unitNumber).join(', ')}</span> <span style={{ color: '#756E80' }}>— {c.contractNo}</span></span>
                  <span style={{ background: '#DCFCE7', color: '#15803D', fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 600 }}>Signed copy on file</span>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#756E80', marginBottom: 22 }}>No signed contracts yet — a copy lands here automatically once one is signed.</div>
              )}

              {/* Other documents */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Other documents</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14, flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', height: 34, padding: '0 14px', borderRadius: 8, background: '#5B2BC9', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                  Upload document
                  <input type="file" onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const form = new FormData()
                    form.append('file', file)
                    form.append('type', 'other')
                    form.append('name', file.name)
                    if (c._id) form.append('contract', c._id)
                    if (customer?._id) form.append('customer', customer._id)
                    try { await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } }); invalidate() } catch (e: any) { setError(apiError(e)) }
                  }} style={{ display: 'none' }} />
                </label>
              </div>
              {documents.length > 0 && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 24px', padding: '0 4px 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#756E80', borderBottom: '1px solid rgba(20,8,31,.14)' }}>
                    <span>Title</span><span>File</span><span />
                  </div>
                  {documents.map(d => (
                    <div key={d._id} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 24px', alignItems: 'center', padding: '8px 4px', fontSize: 13, borderBottom: '1px solid rgba(20,8,31,.06)' }}>
                      <span style={{ fontWeight: 600 }}>{d.type === 'id_proof' ? 'ID Proof' : d.type === 'contract' ? 'Contract' : 'Other'}</span>
                      <a href={d.url} target="_blank" rel="noreferrer" style={{ color: '#4A4357', textDecoration: 'underline' }}>{d.name}</a>
                      <span />
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ── MOVING TAB ── */}
          {activeTab === 'moving' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Moving Service Request</div>
                <div onClick={() => setShowAddMovingRequest(true)} style={{ height: 32, padding: '0 14px', borderRadius: 999, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>+ Add moving request</div>
              </div>
              {showAddMovingRequest && (
                <div style={{ marginBottom: 16, padding: 14, background: '#F7F3FF', border: '1px solid #DDD0FF', borderRadius: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#4A1FA0', marginBottom: 10 }}>New Moving Request</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Pick-up location</div>
                      <input value={movingForm.location} onChange={e => setMovingForm(f => ({ ...f, location: e.target.value }))} placeholder="Address"
                        style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Moving package</div>
                      <select value={movingForm.pkg} onChange={e => setMovingForm(f => ({ ...f, pkg: e.target.value }))}
                        style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 13 }}>
                        <option value="">Select…</option>
                        {movingPackages.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Date</div>
                      <input type="date" value={movingForm.date} onChange={e => setMovingForm(f => ({ ...f, date: e.target.value }))}
                        style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Time</div>
                      <input type="time" value={movingForm.time} onChange={e => setMovingForm(f => ({ ...f, time: e.target.value }))}
                        style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Customer name</div>
                      <input value={movingForm.customerName || customer?.fullName || ''} onChange={e => setMovingForm(f => ({ ...f, customerName: e.target.value }))}
                        style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Phone number</div>
                      <input value={movingForm.phone || customer?.phone || ''} onChange={e => setMovingForm(f => ({ ...f, phone: e.target.value }))}
                        style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div onClick={() => {
                      setMovingRequests(prev => [...prev, { ...movingForm, status: 'pending' }])
                      setShowAddMovingRequest(false)
                      setMovingForm({ location: '', pkg: '', date: '', time: '', customerName: '', phone: '' })
                    }} style={{ height: 32, padding: '0 14px', borderRadius: 8, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Submit request</div>
                    <div onClick={() => setShowAddMovingRequest(false)} style={{ height: 32, padding: '0 14px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</div>
                  </div>
                </div>
              )}

              {movingRequests.map((mr, i) => (
                <div key={i} style={{ border: '1px solid rgba(20,8,31,.10)', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{mr.pkg}</span>
                    <span style={{
                      background: mr.status === 'accepted' ? '#DCFCE7' : mr.status === 'denied' ? '#FEE2E2' : '#FEF3C7',
                      color: mr.status === 'accepted' ? '#15803D' : mr.status === 'denied' ? '#DC2626' : '#92400E',
                      fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 600, textTransform: 'capitalize',
                    }}>{mr.status}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px', fontSize: 12.5, color: '#4A4357', marginBottom: 8 }}>
                    <span>Pick-up: {mr.location}</span>
                    <span>Customer: {mr.customerName || customer?.fullName}</span>
                    <span>Date: {mr.date} {mr.time}</span>
                    <span>Phone: {mr.phone || customer?.phone}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span onClick={() => setMovingRequests(prev => prev.map((r, j) => j === i ? { ...r, status: 'accepted' } : r))} style={{ fontSize: 11.5, fontWeight: 700, color: '#15803D', cursor: 'pointer' }}>Mark accepted</span>
                    <span onClick={() => setMovingRequests(prev => prev.map((r, j) => j === i ? { ...r, status: 'denied' } : r))} style={{ fontSize: 11.5, fontWeight: 700, color: '#DC2626', cursor: 'pointer' }}>Mark denied</span>
                    <span onClick={() => setMovingRequests(prev => prev.map((r, j) => j === i ? { ...r, status: 'pending' } : r))} style={{ fontSize: 11.5, fontWeight: 700, color: '#92400E', cursor: 'pointer' }}>Mark pending</span>
                  </div>
                </div>
              ))}
              {movingRequests.length === 0 && !showAddMovingRequest && (
                <div style={{ fontSize: 12, color: '#756E80' }}>No moving requests yet.</div>
              )}
            </div>
          )}

          {/* ── NOTICES TAB ── */}
          {activeTab === 'notices' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10 }}>Notice library</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22 }}>
                {noticeLibrary.map(title => (
                  <div key={title} onClick={() => { setActiveNoticeTitle(title); setNoticeText(`Dear ${customer?.fullName || '{customer}'},\n\nThis is a ${title.toLowerCase()} regarding your storage unit ${allUnits.map(u => u.unitNumber).join(', ')}.\n\nPlease contact us at your earliest convenience.\n\nBest regards,\nPurpleBox Storage`); setShowNoticeEditor(true) }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(20,8,31,.10)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em' }}>Manual notices</div>
                <span onClick={() => setShowAddNotice(true)} style={{ fontSize: 12, fontWeight: 700, color: '#5B2BC9', cursor: 'pointer' }}>+ Add notice</span>
              </div>
              {showAddNotice && (
                <div style={{ marginBottom: 14, padding: 12, background: '#F7F3FF', border: '1px solid #DDD0FF', borderRadius: 10 }}>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                    <input value={noticeTitleValue} onChange={e => setNoticeTitleValue(e.target.value)} placeholder="Title"
                      style={{ height: 32, width: 200, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13 }} />
                    <input value={noticeMessageValue} onChange={e => setNoticeMessageValue(e.target.value)} placeholder="Message"
                      style={{ height: 32, flex: 1, minWidth: 200, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13 }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div onClick={() => { if (noticeTitleValue.trim()) { setManualNotices(prev => [...prev, { title: noticeTitleValue, message: noticeMessageValue }]); setNoticeTitleValue(''); setNoticeMessageValue(''); setShowAddNotice(false) } }}
                      style={{ height: 30, padding: '0 12px', borderRadius: 8, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Add</div>
                    <div onClick={() => setShowAddNotice(false)} style={{ height: 30, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', display: 'flex', alignItems: 'center', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</div>
                  </div>
                </div>
              )}
              {manualNotices.map((mn, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, border: '1px solid rgba(20,8,31,.10)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{mn.title}</div>
                    <div style={{ fontSize: 12.5, color: '#4A4357', marginTop: 2 }}>{mn.message}</div>
                  </div>
                  <span onClick={() => setManualNotices(prev => prev.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: '#DC2626', fontWeight: 700, flexShrink: 0 }}>×</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── MODALS ── */}

      {/* Schedule Follow-up */}
      {showScheduleFollowUp && (
        <div onClick={() => setShowScheduleFollowUp(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,8,31,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 65, padding: 24 }}>
          <div onClick={stopProp} style={{ background: '#fff', borderRadius: 16, padding: '22px 24px', width: 400 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Schedule follow-up</div>
              <span onClick={() => setShowScheduleFollowUp(false)} style={{ cursor: 'pointer', color: '#756E80', fontSize: 13 }}>Close</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Note</div>
                <textarea value={followUpForm.note} onChange={e => setFollowUpForm(f => ({ ...f, note: e.target.value }))} placeholder="What's this follow-up about?"
                  style={{ width: '100%', height: 60, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Date</div>
                  <input type="date" value={followUpForm.date} onChange={e => setFollowUpForm(f => ({ ...f, date: e.target.value }))}
                    style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Time</div>
                  <input type="time" value={followUpForm.time} onChange={e => setFollowUpForm(f => ({ ...f, time: e.target.value }))}
                    style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              </div>
            </div>
            <div onClick={() => {
              if (followUpForm.note.trim() && followUpForm.date) {
                setFollowUps(prev => [...prev, { note: followUpForm.note, date: followUpForm.date, time: followUpForm.time }])
                setFollowUpForm({ note: '', date: '', time: '' })
                setShowScheduleFollowUp(false)
              }
            }} style={{ height: 36, marginTop: 16, borderRadius: 8, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Schedule reminder</div>
          </div>
        </div>
      )}

      {/* Facility Map */}
      {showFacilityMap && (
        <div onClick={() => setShowFacilityMap(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,8,31,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24 }}>
          <div onClick={stopProp} style={{ background: '#fff', borderRadius: 16, padding: '22px 24px', width: 680, maxHeight: '82vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Facility map</div>
              <span onClick={() => setShowFacilityMap(false)} style={{ cursor: 'pointer', color: '#756E80', fontSize: 13 }}>Done</span>
            </div>
            <div style={{ fontSize: 12, color: '#756E80', marginBottom: 14 }}>Click a unit to select it by size and location — it'll be added to your booking list below.</div>
            {Array.from(zoneMap.entries()).map(([zone, units]) => (
              <div key={zone} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#4A1FA0', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{zone}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {units.map(u => {
                    const isOccupied = u.status === 'occupied'
                    const isOnContract = allUnits.some(au => au._id === u._id)
                    return (
                      <div key={u._id} style={{
                        width: 70, height: 56, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: isOccupied && !isOnContract ? 'not-allowed' : 'pointer',
                        border: isOnContract ? '2px solid #5B2BC9' : '1px solid rgba(20,8,31,.16)',
                        background: isOnContract ? '#EDE5FF' : isOccupied ? '#FEE2E2' : '#F0FDF4',
                      }}>
                        <span style={{ fontWeight: 700, fontSize: 12, color: isOnContract ? '#5B2BC9' : isOccupied ? '#DC2626' : '#15803D' }}>{u.unitNumber}</span>
                        <span style={{ fontSize: 10, color: '#756E80' }}>{u.sizeSqf ? `${u.sizeSqf}sqft` : ''}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notice Editor */}
      {showNoticeEditor && (
        <div onClick={() => setShowNoticeEditor(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,8,31,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24 }}>
          <div onClick={stopProp} style={{ background: '#fff', borderRadius: 16, padding: '22px 24px', width: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{activeNoticeTitle}</div>
              <span onClick={() => setShowNoticeEditor(false)} style={{ cursor: 'pointer', color: '#756E80', fontSize: 13 }}>Close</span>
            </div>
            <div style={{ fontSize: 11.5, color: '#756E80', marginBottom: 8 }}>Edit the text below before sending — customer name, unit, amount and date placeholders are shown in curly braces to fill in.</div>
            <textarea value={noticeText} onChange={e => setNoticeText(e.target.value)}
              style={{ width: '100%', height: 160, borderRadius: 10, border: '1px solid rgba(20,8,31,.16)', padding: 10, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={noticeSendEmail} onChange={e => setNoticeSendEmail(e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} /> Email
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={noticeSendWhatsapp} onChange={e => setNoticeSendWhatsapp(e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} /> WhatsApp
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <div onClick={() => { addNote.mutate(`[Notice: ${activeNoticeTitle}] ${noticeText.slice(0, 100)}...`); setShowNoticeEditor(false) }}
                style={{ height: 36, padding: '0 18px', borderRadius: 8, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Send notice</div>
            </div>
          </div>
        </div>
      )}

      {/* Review Contract Modal */}
      {showReviewContract && (
        <div onClick={() => setShowReviewContract(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,8,31,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 65, padding: 24 }}>
          <div onClick={stopProp} style={{ background: '#fff', borderRadius: 16, padding: '24px 26px', width: 620, maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 18 }}>PurpleBox Storage</div>
                <div style={{ fontSize: 11, color: '#756E80' }}>Storage License Agreement — Contract review</div>
              </div>
              <span onClick={() => setShowReviewContract(false)} style={{ cursor: 'pointer', color: '#756E80', fontSize: 13 }}>Close</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 18px', fontSize: 13, marginBottom: 18, borderBottom: '1px solid rgba(20,8,31,.10)', paddingBottom: 16 }}>
              <div><span style={{ color: '#756E80' }}>Full name:</span> <span style={{ fontWeight: 600 }}>{customer?.fullName}</span></div>
              <div><span style={{ color: '#756E80' }}>Contract no.:</span> <span style={{ fontWeight: 600 }}>{c.contractNo}</span></div>
              <div><span style={{ color: '#756E80' }}>Email:</span> <span style={{ fontWeight: 600 }}>{customer?.email || '—'}</span></div>
              <div><span style={{ color: '#756E80' }}>Phone:</span> <span style={{ fontWeight: 600 }}>{customer?.phone || '—'}</span></div>
              <div><span style={{ color: '#756E80' }}>Status:</span> <span style={{ background: c.status === 'active' ? '#DCFCE7' : '#EDE5FF', color: c.status === 'active' ? '#15803D' : '#4A1FA0', fontSize: 11, padding: '2px 7px', borderRadius: 6, fontWeight: 600, textTransform: 'capitalize' }}>{c.status?.replace('_', ' ')}</span></div>
              <div><span style={{ color: '#756E80' }}>Access type:</span> <span style={{ fontWeight: 600 }}>Private</span></div>
              <div><span style={{ color: '#756E80' }}>Move-in:</span> <span style={{ fontWeight: 600 }}>{fmtShort(c.startDate)}</span></div>
              <div><span style={{ color: '#756E80' }}>Move-out:</span> <span style={{ fontWeight: 600 }}>{fmtShort(c.endDate)}</span></div>
              <div><span style={{ color: '#756E80' }}>Unit(s):</span> <span style={{ fontWeight: 600 }}>{allUnits.map(u => u.unitNumber).join(', ')}</span></div>
              <div><span style={{ color: '#756E80' }}>Approx. size:</span> <span style={{ fontWeight: 600 }}>{allUnits.filter(u => u.sizeSqf).map(u => `${u.sizeSqf}sqft`).join(', ') || '—'}</span></div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em' }}>Payment schedule</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#5B2BC9' }}>AED {formatMoney(c.totalQuotation || totalOwed)}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 120px', padding: '0 4px 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#756E80', borderBottom: '1px solid rgba(20,8,31,.14)' }}>
              <span>#</span><span>Date</span><span style={{ textAlign: 'right' }}>Amount</span>
            </div>
            {payments.filter(p => p.status !== 'paid').slice(0, 6).map((p, i) => (
              <div key={p._id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 120px', padding: '7px 4px', fontSize: 13, borderBottom: '1px solid rgba(20,8,31,.06)' }}>
                <span>{i + 1}</span><span>{fmtShort(p.dueDate)}</span><span style={{ textAlign: 'right', fontWeight: 600 }}>AED {formatMoney(p.amount)}</span>
              </div>
            ))}

            <div style={{ fontSize: 11.5, color: '#756E80', marginTop: 16 }}>Full terms and conditions apply as set out in the signed Storage License Agreement.</div>
          </div>
        </div>
      )}

      {/* Review Quote Modal */}
      {showReviewQuote && (
        <div onClick={() => setShowReviewQuote(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,8,31,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 24 }}>
          <div onClick={stopProp} style={{ background: '#fff', borderRadius: 16, padding: '24px 26px', width: 600, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>Quotation</div>
              <span onClick={() => setShowReviewQuote(false)} style={{ cursor: 'pointer', color: '#756E80', fontSize: 13 }}>Close</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{customer?.fullName}</div>
                <div style={{ fontSize: 12, color: '#756E80', marginTop: 4 }}>{customer?.email}</div>
                <div style={{ fontSize: 12, color: '#756E80' }}>{customer?.phone}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#756E80', textTransform: 'uppercase', letterSpacing: '.06em' }}>Amount</div>
                <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 800, fontSize: 22, color: '#5B2BC9' }}>AED {formatMoney(c.totalQuotation || totalOwed)}</div>
              </div>
            </div>

            {/* Line items from units */}
            <div style={{ marginTop: 18, borderTop: '2px solid #DDD0FF', borderBottom: '1px solid #DDD0FF', background: '#F7F3FF' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 70px 100px', padding: '8px 4px', fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                <span>Product / Service</span><span style={{ textAlign: 'right' }}>Lease</span><span style={{ textAlign: 'right' }}>Weeks</span><span style={{ textAlign: 'right' }}>Price</span>
              </div>
            </div>
            {allUnits.map(u => (
              <div key={u._id} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 70px 100px', padding: '10px 4px', fontSize: 13, borderBottom: '1px solid rgba(20,8,31,.06)' }}>
                <span>
                  <span>Storage Unit {u.unitNumber}</span>
                  <div style={{ fontSize: 11.5, color: '#756E80', marginTop: 2 }}>{fmtShort(c.startDate)} – {fmtShort(c.endDate)}</div>
                </span>
                <span style={{ textAlign: 'right', color: '#4A4357' }}>{formatMoney(leasedPrice)}</span>
                <span style={{ textAlign: 'right', color: '#4A4357' }}>{weeks ?? '—'}</span>
                <span style={{ textAlign: 'right', fontWeight: 600 }}>{formatMoney(c.totalQuotation || totalOwed)}</span>
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <div style={{ width: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800, color: '#5B2BC9', borderTop: '2px solid rgba(20,8,31,.12)', paddingTop: 8 }}>
                  <span>Total</span><span>AED {formatMoney(c.totalQuotation || totalOwed)}</span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: '#756E80', margin: '16px 4px 10px' }}>Send this quote for client acceptance via:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ height: 36, padding: '0 16px', borderRadius: 8, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Send via Email</div>
              <div style={{ height: 36, padding: '0 16px', borderRadius: 8, background: '#16A34A', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Send via WhatsApp</div>
              <div style={{ height: 36, padding: '0 16px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Download PDF</div>
            </div>
          </div>
        </div>
      )}

      {/* Create Contract Modal */}
      {showCreateContract && (
        <div onClick={() => setShowCreateContract(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,8,31,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 24 }}>
          <div onClick={stopProp} style={{ background: '#fff', borderRadius: 16, padding: '24px 26px', width: 640, maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>New contract</div>
                <div style={{ fontSize: 11, color: '#756E80' }}>PurpleBox Storage — Storage License Agreement</div>
              </div>
              <span onClick={() => setShowCreateContract(false)} style={{ cursor: 'pointer', color: '#756E80', fontSize: 13 }}>Close</span>
            </div>
            <div style={{ fontSize: 12, color: '#756E80', marginBottom: 16 }}>Details from the customer and selected units are pre-filled — review and edit anything before sending for signature.</div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Units on this contract</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
              {allUnits.map(u => (
                <label key={u._id} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" defaultChecked style={{ width: 14, height: 14, cursor: 'pointer' }} />
                  <span style={{ fontWeight: 600 }}>{u.unitNumber}</span>
                  <span style={{ color: '#756E80' }}>{u.sizeSqf ? `${u.sizeSqf}sqft` : ''}</span>
                </label>
              ))}
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Contract details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginBottom: 18 }}>
              {[
                { label: 'Full name', key: 'fullName' },
                { label: 'Contract number', key: 'contractNo' },
                { label: 'Email', key: 'email' },
                { label: 'Contact number', key: 'contactNumber' },
                { label: 'WhatsApp', key: 'whatsapp' },
                { label: 'Emergency contact name', key: 'emergencyName' },
                { label: 'Emergency contact number', key: 'emergencyNumber' },
                { label: 'ID number', key: 'idNumber' },
              ].map(f => (
                <div key={f.key}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>{f.label}</div>
                  <input value={(contractForm as any)[f.key]} onChange={e => setContractForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Move-in</div>
                <input type="date" value={contractForm.moveIn} onChange={e => setContractForm(prev => ({ ...prev, moveIn: e.target.value }))}
                  style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Move-out</div>
                <input type="date" value={contractForm.moveOut} onChange={e => setContractForm(prev => ({ ...prev, moveOut: e.target.value }))}
                  style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Total quotation amount</div>
                <input value={contractForm.totalAmount} onChange={e => setContractForm(prev => ({ ...prev, totalAmount: e.target.value }))}
                  style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 10px', fontSize: 14, fontWeight: 800, color: '#5B2BC9', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#756E80', textTransform: 'uppercase', marginBottom: 4 }}>Access type</div>
                <select value={contractForm.accessType} onChange={e => setContractForm(prev => ({ ...prev, accessType: e.target.value }))}
                  style={{ height: 34, width: '100%', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 13 }}>
                  <option value="Private">Private</option>
                  <option value="Shared">Shared</option>
                </select>
              </div>
            </div>

            {/* Payment schedule */}
            <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Payment schedule</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, color: '#4A4357' }}>Number of payments</span>
              <select value={contractForm.installments} onChange={e => setContractForm(prev => ({ ...prev, installments: e.target.value }))}
                style={{ height: 32, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 13 }}>
                {['1', '2', '3', '4', '6', '12'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <span onClick={() => setPaymentSchedule(prev => [...prev, { dueDate: '', amount: '', primary: '', secondary: '' }])} style={{ fontSize: 12, fontWeight: 700, color: '#5B2BC9', cursor: 'pointer' }}>+ Add payment</span>
            </div>
            {paymentSchedule.map((ps, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px 110px 20px', alignItems: 'center', padding: '7px 4px', fontSize: 13, borderBottom: '1px solid rgba(20,8,31,.06)', gap: 6 }}>
                <input type="date" value={ps.dueDate} onChange={e => setPaymentSchedule(prev => prev.map((p, j) => j === i ? { ...p, dueDate: e.target.value } : p))}
                  style={{ height: 30, width: 150, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 13 }} />
                <input value={ps.amount} onChange={e => setPaymentSchedule(prev => prev.map((p, j) => j === i ? { ...p, amount: e.target.value } : p))}
                  style={{ height: 30, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 13, fontWeight: 700, textAlign: 'right' }} />
                <input value={ps.primary} onChange={e => setPaymentSchedule(prev => prev.map((p, j) => j === i ? { ...p, primary: e.target.value } : p))} placeholder="Card / bank"
                  style={{ height: 30, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 12.5 }} />
                <input value={ps.secondary} onChange={e => setPaymentSchedule(prev => prev.map((p, j) => j === i ? { ...p, secondary: e.target.value } : p))} placeholder="Optional"
                  style={{ height: 30, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 12.5 }} />
                <span onClick={() => setPaymentSchedule(prev => prev.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: '#DC2626', fontWeight: 700 }}>×</span>
              </div>
            ))}

            {/* Authorized access */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em' }}>Authorized access</div>
              <span onClick={() => setAuthorizedPersons(prev => [...prev, { name: '', mobile: '', email: '', relationship: '' }])} style={{ fontSize: 12, fontWeight: 700, color: '#5B2BC9', cursor: 'pointer' }}>+ Add person</span>
            </div>
            {authorizedPersons.map((ap, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 20px', gap: 8, alignItems: 'center', padding: '5px 4px' }}>
                <input value={ap.name} onChange={e => setAuthorizedPersons(prev => prev.map((p, j) => j === i ? { ...p, name: e.target.value } : p))} placeholder="Name"
                  style={{ height: 30, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 12.5 }} />
                <input value={ap.mobile} onChange={e => setAuthorizedPersons(prev => prev.map((p, j) => j === i ? { ...p, mobile: e.target.value } : p))} placeholder="Mobile"
                  style={{ height: 30, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 12.5 }} />
                <input value={ap.email} onChange={e => setAuthorizedPersons(prev => prev.map((p, j) => j === i ? { ...p, email: e.target.value } : p))} placeholder="Email"
                  style={{ height: 30, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 12.5 }} />
                <input value={ap.relationship} onChange={e => setAuthorizedPersons(prev => prev.map((p, j) => j === i ? { ...p, relationship: e.target.value } : p))} placeholder="Relationship"
                  style={{ height: 30, borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', padding: '0 8px', fontSize: 12.5 }} />
                <span onClick={() => setAuthorizedPersons(prev => prev.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: '#DC2626', fontWeight: 700 }}>×</span>
              </div>
            ))}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
              <div onClick={() => setShowContractPreview(true)} style={{ height: 38, padding: '0 18px', borderRadius: 8, border: '1px solid #5B2BC9', color: '#5B2BC9', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Preview contract</div>
              <div onClick={async () => {
                try {
                  await api.post(`/contracts/${id}/create-signing-link`)
                  invalidate()
                  setShowCreateContract(false)
                } catch (e: any) { setError(apiError(e)) }
              }} style={{ height: 38, padding: '0 18px', borderRadius: 8, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Send for signature</div>
              <div onClick={() => setShowCreateContract(false)} style={{ height: 38, padding: '0 18px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Save as draft</div>
            </div>
          </div>
        </div>
      )}

      {/* Contract Preview Modal */}
      {showContractPreview && (
        <div onClick={() => setShowContractPreview(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,8,31,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 24 }}>
          <div onClick={stopProp} style={{ background: '#fff', borderRadius: 16, padding: '28px 32px', width: 640, maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
              <div>
                <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 18 }}>PurpleBox Storage</div>
                <div style={{ fontSize: 11, color: '#756E80' }}>Storage License Agreement — Preview</div>
              </div>
              <span onClick={() => setShowContractPreview(false)} style={{ cursor: 'pointer', color: '#756E80', fontSize: 13 }}>Close</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 18px', fontSize: 13, marginBottom: 18, borderBottom: '1px solid rgba(20,8,31,.10)', paddingBottom: 16 }}>
              <div><span style={{ color: '#756E80' }}>Full name:</span> <span style={{ fontWeight: 600 }}>{contractForm.fullName}</span></div>
              <div><span style={{ color: '#756E80' }}>Contract no.:</span> <span style={{ fontWeight: 600 }}>{contractForm.contractNo}</span></div>
              <div><span style={{ color: '#756E80' }}>ID:</span> <span style={{ fontWeight: 600 }}>{contractForm.idType} — {contractForm.idNumber}</span></div>
              <div><span style={{ color: '#756E80' }}>Access type:</span> <span style={{ fontWeight: 600 }}>{contractForm.accessType}</span></div>
              <div><span style={{ color: '#756E80' }}>Email:</span> <span style={{ fontWeight: 600 }}>{contractForm.email}</span></div>
              <div><span style={{ color: '#756E80' }}>Contact:</span> <span style={{ fontWeight: 600 }}>{contractForm.contactNumber}</span></div>
              <div><span style={{ color: '#756E80' }}>WhatsApp:</span> <span style={{ fontWeight: 600 }}>{contractForm.whatsapp}</span></div>
              <div><span style={{ color: '#756E80' }}>Emergency:</span> <span style={{ fontWeight: 600 }}>{contractForm.emergencyName} · {contractForm.emergencyNumber}</span></div>
              <div><span style={{ color: '#756E80' }}>Move-in:</span> <span style={{ fontWeight: 600 }}>{contractForm.moveIn}</span></div>
              <div><span style={{ color: '#756E80' }}>Move-out:</span> <span style={{ fontWeight: 600 }}>{contractForm.moveOut}</span></div>
              <div><span style={{ color: '#756E80' }}>Unit(s):</span> <span style={{ fontWeight: 600 }}>{allUnits.map(u => u.unitNumber).join(', ')}</span></div>
              <div><span style={{ color: '#756E80' }}>Approx. size:</span> <span style={{ fontWeight: 600 }}>{allUnits.filter(u => u.sizeSqf).map(u => `${u.sizeSqf}sqft`).join(', ')}</span></div>
            </div>

            {/* Payment schedule preview */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em' }}>Payment schedule</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#5B2BC9' }}>AED {contractForm.totalAmount || '0.00'}</div>
            </div>
            {paymentSchedule.map((ps, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 100px 110px 110px', padding: '7px 4px', fontSize: 13, borderBottom: '1px solid rgba(20,8,31,.06)' }}>
                <span>{i + 1}</span><span>{ps.dueDate}</span><span style={{ textAlign: 'right', fontWeight: 600 }}>{ps.amount}</span><span style={{ color: '#4A4357' }}>{ps.primary}</span><span style={{ color: '#4A4357' }}>{ps.secondary}</span>
              </div>
            ))}

            {/* Authorized */}
            {authorizedPersons.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#5B2BC9', textTransform: 'uppercase', letterSpacing: '.04em', margin: '18px 0 8px' }}>Authorized access</div>
                {authorizedPersons.map((ap, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', padding: '7px 4px', fontSize: 13, borderBottom: '1px solid rgba(20,8,31,.06)' }}>
                    <span>{ap.name}</span><span>{ap.mobile}</span><span>{ap.email}</span><span>{ap.relationship}</span>
                  </div>
                ))}
              </>
            )}

            <div style={{ fontSize: 12, color: '#756E80', marginTop: 16, lineHeight: 1.5 }}>This preview reflects the details entered so far. Close to keep editing, or send for signature when ready.</div>

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <div onClick={async () => {
                try {
                  await api.post(`/contracts/${id}/create-signing-link`)
                  invalidate()
                  setShowContractPreview(false)
                  setShowCreateContract(false)
                } catch (e: any) { setError(apiError(e)) }
              }} style={{ height: 38, padding: '0 18px', borderRadius: 8, background: '#5B2BC9', color: '#fff', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Send for signature</div>
              <div onClick={() => setShowContractPreview(false)} style={{ height: 38, padding: '0 18px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Back to edit</div>
            </div>
          </div>
        </div>
      )}

      {error && <div style={{ position: 'fixed', bottom: 20, right: 20, background: '#FEE2E2', color: '#DC2626', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 100 }}>{error}</div>}
    </div>
  )
}

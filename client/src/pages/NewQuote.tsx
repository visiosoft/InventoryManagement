import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Plus, ChevronRight, ChevronLeft, Check, User, Box, FileText, Briefcase, Receipt as ReceiptIcon,
  ShieldCheck, Search, Trash2, CalendarRange, Loader2, CheckCircle2, Send, Mail, Download,
  Upload, X, Eye, ExternalLink, ClipboardList,
} from 'lucide-react'
import { api, apiError, invoiceApi, quoteApi, type AvailableUnit } from '../lib/api'
import type { AccessPerson, Customer, Invoice, Lead, Quote } from '../lib/types'
import { useAuth } from '../lib/auth'
import { Button, Field, Input, Select, Textarea, Modal, Spinner } from '../components/ui'
import { SignInPersonModal } from './ContractDetail'
import { formatDate, formatMoney } from '../lib/utils'

const STEPS = [
  { key: 'customer', label: 'Customer', icon: User },
  { key: 'units', label: 'Units', icon: Box },
  { key: 'quote', label: 'Quotation', icon: FileText },
  { key: 'contract', label: 'Contract', icon: Briefcase },
  { key: 'invoice', label: 'Invoice & Payment', icon: ReceiptIcon },
] as const

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const CREAM = '#FDFCFA'
const CHIP_BG = '#F3F0EA'
const GREEN = '#047857'

const DEFAULT_ADDONS = [
  { name: 'Lock', description: 'Padlock for storage unit', rate: 80 },
]

// Customer document types — ID_DOC_TYPES satisfy the "ID required" gate for contracts
const DOC_TYPE_LABELS: Record<string, string> = {
  emirates_id: 'Emirates ID', passport: 'Passport', visa: 'Visa',
  trade_license: 'Trade License', id_proof: 'ID Proof', contract: 'Contract', other: 'Other',
}
const ID_DOC_TYPES = ['emirates_id', 'passport', 'id_proof']

interface UnitBookingInfo { ref: string; customer: string; startDate?: string; endDate?: string; kind?: string }
interface UnitRow {
  unitId: string
  unitNumber: string
  sizeSqf: number
  floor: string
  startDate: string
  endDate: string
  rate: number
  discountPct: number
  existingBookings?: UnitBookingInfo[]
}

interface AddOnRow {
  name: string
  description: string
  quantity: number
  rate: number
}

interface ContractDetailData {
  contract: {
    _id: string
    contractNo: string
    status: string
    approvalStatus?: string
    approvalNote?: string
    approvedBy?: string
    startDate: string
    endDate: string
    rate: number
    paymentMethod?: string
    authorizedPersons?: AccessPerson[]
  }
  invoices: Invoice[]
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontSize: '1.125rem', fontWeight: 700 }}>
        {title}
      </h2>
      <p style={{ color: MUTED, fontSize: '0.8rem', marginTop: '0.125rem' }}>{subtitle}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span style={{ color: MUTED }}>{label}</span>
      <span className="font-semibold text-right" style={{ color: INK }}>{value}</span>
    </div>
  )
}

function DoneBanner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 p-3 rounded-xl" style={{ background: '#D1FAE5' }}>
      <CheckCircle2 size={16} style={{ color: GREEN }} />
      <p className="text-sm font-semibold" style={{ color: GREEN }}>{text}</p>
    </div>
  )
}

type EditItem = { sortOrder: number; itemDetails: string; quantity: number; rate: number; discountPct: number; amount: number }

function itemAmount(it: { quantity: number; rate: number; discountPct: number }) {
  const gross = it.quantity * it.rate
  return Math.round((gross - (gross * (it.discountPct || 0)) / 100) * 100) / 100
}

const dfmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

// Editable line-item table shared by the "edit invoice" and "add invoice" panels.
function ItemEditor({ items, onChange }: { items: EditItem[]; onChange: (items: EditItem[]) => void }) {
  function update(idx: number, field: keyof EditItem, value: string | number) {
    onChange(items.map((it, i) => {
      if (i !== idx) return it
      const next = { ...it, [field]: value }
      next.amount = itemAmount(next)
      return next
    }))
  }
  return (
    <div className="space-y-2">
      {items.map((it, idx) => (
        <div key={idx} className="rounded-xl border p-2.5" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
            <Field label="Description" className="sm:col-span-2">
              <Input value={it.itemDetails} onChange={(e) => update(idx, 'itemDetails', e.target.value)} className="h-8 text-xs" />
            </Field>
            <Field label="Wks">
              <Input type="number" min={0} value={it.quantity || ''} placeholder="0" onChange={(e) => update(idx, 'quantity', Number(e.target.value) || 0)} className="h-8 text-xs" />
            </Field>
            <Field label="Rate">
              <Input type="number" value={it.rate || ''} placeholder="0" onChange={(e) => update(idx, 'rate', Number(e.target.value) || 0)} className="h-8 text-xs" />
            </Field>
            <Field label="Disc 4 weeks %">
              <Input type="number" min={0} max={100} value={it.discountPct || ''} onChange={(e) => update(idx, 'discountPct', Number(e.target.value))} className="h-8 text-xs" placeholder="0" />
            </Field>
            <div className="flex items-center justify-between pb-1.5">
              <span className="text-xs font-bold" style={{ color: INK }}>{formatMoney(it.amount)}</span>
              <button type="button" onClick={() => onChange(items.filter((_, i) => i !== idx))} className="text-red-500 hover:text-red-600 ml-1">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { sortOrder: items.length, itemDetails: '', quantity: 1, rate: 0, discountPct: 0, amount: 0 }])}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
        style={{ background: `${PURPLE}10`, color: PURPLE }}
      >
        <Plus size={12} /> Add line
      </button>
    </div>
  )
}

/** GET /customers/:id/zoho-invoices — invoices found in Zoho Books for this
 *  tenant, matched on email/phone only. Names legitimately differ between the
 *  two systems, so a name match is deliberately not attempted. */
type ZohoInvoice = {
  id: string; number: string; date: string; dueDate: string
  total: number; balance: number; status: string; currency: string; customerName: string
}
type ZohoMatch = { id: string; name: string; email: string; phone: string; matchedBy: 'email' | 'phone' }
type ZohoInvoicesResponse = {
  configured: boolean
  matchedContacts: ZohoMatch[]
  invoices: ZohoInvoice[]
  totals: { count: number; total: number; balance: number }
  newInvoiceUrl?: string
}

// Invoice step: show the tenant's Zoho Books invoices (where invoices are now
// raised), plus any invoices still held locally in PurpleBox.
export interface InvoiceStepHandle {
  isEditing: boolean
  isSaving: boolean
  isSyncing: boolean
  saveEdit: () => void
  saveAndSync: () => void
}

function InvoiceStep({ contract, invoices, customerId, customerName, customerPhone, customerEmail, onChanged, handleRef }: {
  contract: { _id: string; contractNo: string; startDate: string; endDate: string; rate: number }
  invoices: Invoice[]
  customerId: string
  customerName: string
  customerPhone: string
  customerEmail: string
  onChanged: () => void
  handleRef?: React.MutableRefObject<InvoiceStepHandle | null>
}) {
  const navigate = useNavigate()
  const [editId, setEditId] = useState('')
  const [editItems, setEditItems] = useState<EditItem[]>([])
  const [editDue, setEditDue] = useState('')
  const [adding, setAdding] = useState(false)
  const [newItems, setNewItems] = useState<EditItem[]>([])
  const [newDue, setNewDue] = useState('')
  const [err, setErr] = useState('')
  const [emailModal, setEmailModal] = useState<{ invoiceId: string; to: string; subject: string; body: string; pdfUrl: string } | null>(null)
  const [emailSending, setEmailSending] = useState(false)
  const [emailSent, setEmailSent] = useState('')

  // Invoices are raised by the accounts team in Zoho Books, so booking hands
  // them a task carrying the contract and its numbers rather than trying to
  // create the invoice here.
  const [taskOpen, setTaskOpen] = useState(false)
  const [taskAssignee, setTaskAssignee] = useState('')
  const [taskPriority, setTaskPriority] = useState<'low' | 'medium' | 'high'>('high')
  const [taskDue, setTaskDue] = useState(new Date().toISOString().slice(0, 10))
  const [taskNote, setTaskNote] = useState('')
  const [taskDone, setTaskDone] = useState<{ id: string; to: string } | null>(null)

  // /users is admin-only; /users/assignable is readable by every role, which
  // matters because sales reps do the booking.
  const users = useQuery<{ _id: string; name: string; email: string; role: string }[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
    enabled: taskOpen,
  })

  const taskSummary = [
    `Contract: ${contract.contractNo}`,
    `Tenant: ${customerName}`,
    customerPhone ? `Phone: ${customerPhone}` : '',
    customerEmail ? `Email: ${customerEmail}` : '',
    `Period: ${dfmt(new Date(contract.startDate))} – ${dfmt(new Date(contract.endDate))}`,
    `Monthly rate: ${formatMoney(contract.rate)} AED`,
  ].filter(Boolean).join('\n')

  const createAccountsTask = useMutation({
    mutationFn: () => api.post('/tasks', {
      title: `Raise invoice in Zoho Books — ${contract.contractNo}`,
      description: [taskSummary, taskNote.trim() ? `\nNotes: ${taskNote.trim()}` : ''].join('\n'),
      assignedTo: taskAssignee,
      priority: taskPriority,
      dueDate: taskDue || null,
      leadType: 'contract',
      leadId: contract._id,
      leadName: contract.contractNo,
    }).then((r) => r.data),
    onSuccess: (t) => {
      const to = users.data?.find((u) => u._id === taskAssignee)
      setTaskDone({ id: t._id, to: to?.name || to?.email || 'the assignee' })
      setTaskOpen(false)
      setTaskNote('')
      setErr('')
    },
    onError: (e) => setErr(apiError(e)),
  })

  useEffect(() => { setErr('') }, [invoices.length])

  const sorted = [...invoices].sort((a, b) => new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime())

  // Auto-expand first editable invoice
  const autoEditRef = useRef(false)
  useEffect(() => {
    if (autoEditRef.current) return
    const editable = sorted.find((inv) => Number(inv.paymentMade || 0) === 0 && inv.status !== 'paid')
    if (editable) { startEdit(editable); autoEditRef.current = true }
  }, [sorted.length])

  const editingInvRef = useRef<Invoice | null>(null)

  const save = useMutation({
    mutationFn: (inv: Invoice) => invoiceApi.update(inv._id, {
      customer: customerId,
      dueDate: editDue || inv.dueDate,
      orderNumber: contract.contractNo,
      subject: inv.subject,
      items: editItems.map((it, i) => ({ ...it, sortOrder: i })),
    }),
    onSuccess: () => { setEditId(''); editingInvRef.current = null; onChanged(); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  const saveAndSync = useMutation({
    mutationFn: async (inv: Invoice) => {
      await invoiceApi.update(inv._id, {
        customer: customerId,
        dueDate: editDue || inv.dueDate,
        orderNumber: contract.contractNo,
        subject: inv.subject,
        items: editItems.map((it, i) => ({ ...it, sortOrder: i })),
      })
    },
    onSuccess: () => { setEditId(''); editingInvRef.current = null; onChanged(); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  useEffect(() => {
    if (handleRef) {
      handleRef.current = {
        isEditing: Boolean(editId),
        isSaving: save.isPending || saveAndSync.isPending,
        isSyncing: saveAndSync.isPending,
        saveEdit: () => { if (editingInvRef.current) save.mutate(editingInvRef.current) },
        saveAndSync: () => { if (editingInvRef.current) saveAndSync.mutate(editingInvRef.current) },
      }
    }
  })

  const create = useMutation({
    mutationFn: () => invoiceApi.create({
      customer: customerId,
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: newDue,
      orderNumber: contract.contractNo,
      terms: 'Due on receipt',
      subject: `Storage Rent · ${contract.contractNo}`,
      items: newItems.map((it, i) => ({ ...it, sortOrder: i })),
      status: 'draft',
    }),
    onSuccess: () => { setAdding(false); setNewItems([]); onChanged(); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  function startEdit(inv: Invoice) {
    setEditId(inv._id)
    editingInvRef.current = inv
    setEditDue(inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : '')
    setEditItems((inv.items || []).map((it, i) => ({
      sortOrder: i, itemDetails: it.itemDetails, quantity: it.quantity, rate: it.rate,
      discountPct: it.discountPct || 0, amount: it.amount,
    })))
  }

  // ── Zoho Books ─────────────────────────────────────────────────────────
  // Invoices are raised in Zoho Books — it is the accounting source of truth,
  // so this step only reads them. Matching is on email/phone only: the two
  // systems hold different names for the same person, so a name match is
  // deliberately not attempted.
  const zoho = useQuery<ZohoInvoicesResponse>({
    queryKey: ['customer-zoho-invoices', customerId],
    queryFn: () => api.get(`/customers/${customerId}/zoho-invoices`).then((r) => r.data),
    enabled: Boolean(customerId),
    retry: false,
    staleTime: 5 * 60_000,
  })

  // Opening a Zoho invoice needs the auth header, so a plain <a href> won't do
  // — fetch it as a blob and hand the browser an object URL instead.
  const [openingZohoPdf, setOpeningZohoPdf] = useState('')
  const [zohoPdfError, setZohoPdfError] = useState('')
  async function openZohoInvoicePdf(invoiceId: string) {
    if (!customerId) return
    setZohoPdfError('')
    setOpeningZohoPdf(invoiceId)
    try {
      const r = await api.get(`/customers/${customerId}/zoho-invoices/${invoiceId}/pdf`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }))
      window.open(url, '_blank', 'noopener')
      // Revoke late: revoking immediately can race the new tab's load.
      setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
    } catch {
      setZohoPdfError('Could not open that invoice PDF from Zoho Books.')
    } finally {
      setOpeningZohoPdf('')
    }
  }

  // Several Zoho contacts can share a phone number without being the same legal
  // entity — a company and its owner, say. When more than one matched, name who
  // each invoice was billed to so a mixed list reads as mixed.
  const multipleZohoContacts = (zoho.data?.matchedContacts?.length ?? 0) > 1
  const zohoCols = multipleZohoContacts
    ? '120px 95px 95px 90px 1fr 90px 90px'
    : '120px 95px 95px 1fr 90px 90px'
  const zohoStatus = (zoho.error as { response?: { status?: number } } | null)?.response?.status
  const zohoErrorMsg = (zoho.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error

  function startAddBlank() {
    setNewItems([{ sortOrder: 0, itemDetails: '', quantity: 1, rate: 0, discountPct: 0, amount: 0 }])
    setNewDue(new Date().toISOString().slice(0, 10))
    setAdding(true)
  }

  const newTotal = newItems.reduce((s, it) => s + it.amount, 0)
  const editTotal = editItems.reduce((s, it) => s + it.amount, 0)

  return (
    <div className="space-y-4">
      {/* ── Zoho Books — invoices are raised there, not here ── */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
        <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2" style={{ background: CHIP_BG }}>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: PURPLE }}>Zoho Books invoices</p>
            <p className="text-[11px]" style={{ color: MUTED }}>Matched to this tenant by email or phone number, not by name</p>
          </div>
          <button
            type="button"
            onClick={() => { setTaskOpen((v) => !v); setTaskDone(null) }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white hover:opacity-90 cursor-pointer"
            style={{ background: PURPLE }}
            title="Assign the accounts team a task to raise this invoice in Zoho Books"
          >
            <ClipboardList size={13} /> Create task for accounts
          </button>
        </div>

        {taskDone && (
          <div className="px-4 py-3 flex flex-wrap items-center gap-2 text-xs border-b"
            style={{ background: '#ECFDF5', borderColor: 'rgba(20,8,31,0.08)', color: '#047857' }}>
            <CheckCircle2 size={14} />
            <span>Task assigned to <strong>{taskDone.to}</strong>.</span>
            <button type="button" onClick={() => navigate('/tasks')}
              className="underline font-semibold cursor-pointer" style={{ color: '#047857' }}>
              Open tasks
            </button>
          </div>
        )}

        {taskOpen && (
          <div className="px-4 py-3 border-b space-y-3" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
            {/* What accounts will receive — shown so the sender can see the
                contract details are actually attached, not just promised. */}
            <div className="rounded-lg px-3 py-2 text-[11.5px] whitespace-pre-wrap"
              style={{ background: CHIP_BG, color: MUTED }}>
              <span className="font-bold" style={{ color: PURPLE }}>Raise invoice in Zoho Books — {contract.contractNo}</span>
              {'\n'}{taskSummary}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="text-[11px] font-semibold" style={{ color: MUTED }}>
                Assign to
                <select value={taskAssignee} onChange={(e) => setTaskAssignee(e.target.value)}
                  className="mt-1 w-full h-9 rounded-lg border px-2 text-xs"
                  style={{ borderColor: 'rgba(20,8,31,0.14)', color: INK }}>
                  <option value="">{users.isLoading ? 'Loading people…' : 'Choose a person'}</option>
                  {(users.data || []).map((u) => (
                    <option key={u._id} value={u._id}>{u.name || u.email} ({u.role.replace('_', ' ')})</option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] font-semibold" style={{ color: MUTED }}>
                Priority
                <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value as 'low' | 'medium' | 'high')}
                  className="mt-1 w-full h-9 rounded-lg border px-2 text-xs"
                  style={{ borderColor: 'rgba(20,8,31,0.14)', color: INK }}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className="text-[11px] font-semibold" style={{ color: MUTED }}>
                Due
                <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)}
                  className="mt-1 w-full h-9 rounded-lg border px-2 text-xs"
                  style={{ borderColor: 'rgba(20,8,31,0.14)', color: INK }} />
              </label>
            </div>

            <textarea rows={2} value={taskNote} onChange={(e) => setTaskNote(e.target.value)}
              placeholder="Anything else accounts should know (optional)"
              className="w-full rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'rgba(20,8,31,0.14)', color: INK }} />

            <div className="flex items-center gap-2">
              <button type="button"
                disabled={!taskAssignee || createAccountsTask.isPending}
                onClick={() => createAccountsTask.mutate()}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 cursor-pointer"
                style={{ background: PURPLE }}>
                {createAccountsTask.isPending ? 'Creating…' : 'Create task'}
              </button>
              <button type="button" onClick={() => setTaskOpen(false)}
                className="px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer"
                style={{ borderColor: 'rgba(20,8,31,0.14)', color: MUTED }}>
                Cancel
              </button>
              {!taskAssignee && (
                <span className="text-[11px]" style={{ color: MUTED }}>Pick who should do it</span>
              )}
            </div>
          </div>
        )}

        <div className="px-4 py-3">
          {zoho.isLoading ? (
            <p className="text-xs flex items-center gap-1.5" style={{ color: MUTED }}>
              <Loader2 size={13} className="animate-spin" /> Looking up Zoho Books…
            </p>
          ) : zoho.isError ? (
            <p className="text-xs" style={{ color: MUTED }}>
              {zohoStatus === 501
                ? 'Zoho Books is not connected — add its credentials in Settings to see invoices here.'
                : zohoStatus === 404
                  ? 'This lookup is not available on the API yet — the server needs to be redeployed.'
                  : `Could not reach Zoho Books${zohoStatus ? ` (HTTP ${zohoStatus})` : ''}: ${zohoErrorMsg || 'no error message returned'}`}
            </p>
          ) : !zoho.data?.matchedContacts?.length ? (
            <p className="text-xs" style={{ color: MUTED }}>
              No Zoho Books contact matches this tenant&apos;s email or phone number
              {customerEmail || customerPhone ? '' : ' — this tenant has neither on file'}.
            </p>
          ) : (
            <>
              {/* Which Zoho contact(s) matched, and how. The names differ by
                  design, so show what was matched instead of hiding it. */}
              <div className="flex flex-wrap items-center gap-1.5 pb-3">
                {zoho.data.matchedContacts.map((m) => (
                  <span key={m.id} className="text-[10px] rounded-full px-2 py-0.5 border"
                    style={{ borderColor: 'rgba(20,8,31,0.16)', color: MUTED }}
                    title={`Matched by ${m.matchedBy}: ${m.matchedBy === 'email' ? m.email : m.phone}`}>
                    {m.name || '(unnamed)'} · matched by {m.matchedBy}
                  </span>
                ))}
                {multipleZohoContacts && (
                  <span className="text-[10px] font-semibold" style={{ color: '#92400E' }}>
                    {zoho.data.matchedContacts.length} Zoho contacts share these details — invoices from all of them are shown
                  </span>
                )}
              </div>

              {zoho.data.invoices.length === 0 ? (
                <p className="text-xs" style={{ color: MUTED }}>This contact has no invoices in Zoho Books yet.</p>
              ) : (
                <>
                  {zohoPdfError && <p className="text-[11px] pb-2" style={{ color: '#B91C1C' }}>{zohoPdfError}</p>}
                  <div className="overflow-x-auto">
                    <div style={{ minWidth: multipleZohoContacts ? 720 : 560 }}>
                      <div className="grid gap-3 pb-2 text-[11px] font-bold uppercase tracking-wider"
                        style={{ gridTemplateColumns: zohoCols, color: MUTED, borderBottom: '1px solid rgba(20,8,31,0.12)' }}>
                        <span>Invoice</span><span>Date</span><span>Due</span><span>Status</span>
                        {multipleZohoContacts && <span>Billed to</span>}
                        <span className="text-right">Total</span><span className="text-right">Balance</span>
                      </div>
                      {zoho.data.invoices.map((inv) => (
                        <div key={inv.id} className="grid gap-3 items-center py-2 text-[12px]"
                          style={{ gridTemplateColumns: zohoCols, borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                          <button type="button"
                            onClick={() => openZohoInvoicePdf(inv.id)}
                            disabled={openingZohoPdf === inv.id}
                            className="font-bold text-left hover:underline cursor-pointer disabled:opacity-60"
                            style={{ color: PURPLE }}
                            title="Open this invoice's PDF from Zoho Books">
                            {openingZohoPdf === inv.id ? 'Opening…' : (inv.number || '—')}
                          </button>
                          <span style={{ color: MUTED }}>{inv.date ? dfmt(new Date(inv.date)) : '—'}</span>
                          <span style={{ color: MUTED }}>{inv.dueDate ? dfmt(new Date(inv.dueDate)) : '—'}</span>
                          <span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize whitespace-nowrap"
                              style={
                                inv.status === 'paid' ? { background: '#D1FAE5', color: GREEN }
                                  : inv.status === 'overdue' ? { background: '#FEE2E2', color: '#B91C1C' }
                                    : { background: CHIP_BG, color: MUTED }
                              }>
                              {inv.status || 'unknown'}
                            </span>
                          </span>
                          {multipleZohoContacts && (
                            <span className="truncate" style={{ color: MUTED }} title={inv.customerName}>
                              {inv.customerName || '—'}
                            </span>
                          )}
                          <span className="text-right" style={{ color: INK }}>{inv.currency || 'AED'} {formatMoney(inv.total)}</span>
                          <span className="text-right font-bold" style={{ color: inv.balance > 0 ? '#DC2626' : GREEN }}>
                            {formatMoney(inv.balance)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 pt-3 text-[12px]" style={{ color: INK }}>
                    <span style={{ color: MUTED }}>{zoho.data.totals.count} invoice{zoho.data.totals.count === 1 ? '' : 's'}</span>
                    <span>Total <strong>{formatMoney(zoho.data.totals.total)}</strong></span>
                    <span>Outstanding <strong style={{ color: zoho.data.totals.balance > 0 ? '#DC2626' : GREEN }}>
                      {formatMoney(zoho.data.totals.balance)}</strong></span>
                  </div>
                  <p className="text-[11px] pt-2" style={{ color: MUTED }}>
                    Click an invoice number to open its PDF. These are the tenant&apos;s Zoho Books invoices across all their
                    contracts, not only this one — Zoho is the source of truth, so edit them there.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {/* Invoices raised inside PurpleBox — kept for one-offs and older records */}
      {sorted.length > 0 && (
        <p className="text-xs font-bold uppercase tracking-wider pt-1" style={{ color: MUTED }}>PurpleBox invoices</p>
      )}
      {sorted.map((inv) => {
        const isEditing = editId === inv._id
        const canEdit = Number(inv.paymentMade || 0) === 0 && inv.status !== 'paid'
        return (
          <div key={inv._id} className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3" style={{ background: CHIP_BG }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold" style={{ color: INK }}>{inv.invoiceNo}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{
                  background: inv.status === 'paid' ? '#D1FAE5' : inv.status === 'draft' ? '#fff' : '#DBEAFE',
                  color: inv.status === 'paid' ? GREEN : inv.status === 'draft' ? MUTED : '#1D4ED8',
                }}>{inv.status}</span>
              </div>
              <div className="flex items-center gap-2">
                {inv.zohoBooksSyncId && (
                  <a
                    href={`https://books.zoho.com/app/908459713#/invoices/${inv.zohoBooksSyncId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] px-2 py-0.5 rounded-full font-semibold hover:opacity-80"
                    style={{ background: '#D1FAE5', color: GREEN }}
                    title={inv.zohoBooksSyncedAt ? `Synced ${new Date(inv.zohoBooksSyncedAt).toLocaleDateString()}` : 'Synced to Zoho'}
                  >
                    Zoho ↗
                  </a>
                )}
                <span className="text-sm font-bold" style={{ color: PURPLE }}>{formatMoney(inv.total)} AED</span>
              </div>
            </div>

            {/* Body */}
            <div className="px-4 py-3">
              {isEditing ? (
                <div className="space-y-3">
                  <ItemEditor items={editItems} onChange={setEditItems} />
                  <div className="flex items-center justify-between">
                    <Field label="Due date">
                      <Input type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} className="h-8 text-xs w-40" />
                    </Field>
                    <span className="text-sm font-bold" style={{ color: INK }}>Total {formatMoney(editTotal)} AED</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {(inv.items || []).map((it, i) => (
                    <InfoRow key={i} label={it.itemDetails} value={`${formatMoney(it.amount)} AED`} />
                  ))}
                </div>
              )}
            </div>

            {/* Action bar — hidden while editing */}
            {!isEditing && (
              <div className="flex items-center gap-px border-t" style={{ borderColor: 'rgba(20,8,31,0.06)' }}>
                {canEdit && (
                  <>
                    <button type="button" onClick={() => startEdit(inv)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors" style={{ color: PURPLE }}>
                      <FileText size={13} /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm(`Delete ${inv.invoiceNo}?`)) return
                        try {
                          await api.delete(`/invoices/${inv._id}`)
                          onChanged()
                        } catch (e: any) { setErr(apiError(e)) }
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors text-red-500"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const shareRes = await api.post(`/invoices/${inv._id}/share`)
                      const pdfUrl = shareRes.data.url
                      const phone = customerPhone.replace(/\D/g, '').replace(/^00/, '')
                      const msg = `Hello ${customerName},\n\nHere is your invoice ${inv.invoiceNo} for ${formatMoney(inv.total)} AED.\n\nView: ${pdfUrl}\n\nThank you — PurpleBox`
                      window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                    } catch (e: any) { setErr(apiError(e)) }
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors"
                  style={{ color: '#25D366' }}
                >
                  <Send size={13} /> WhatsApp
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const shareRes = await api.post(`/invoices/${inv._id}/share`)
                      const pdfUrl = shareRes.data.url
                      setEmailModal({
                        invoiceId: inv._id,
                        to: customerEmail,
                        subject: `Invoice ${inv.invoiceNo} — PurpleBox`,
                        body: [
                          `Hello ${customerName},`,
                          ``,
                          `Please find your invoice ${inv.invoiceNo} for ${formatMoney(inv.total)} AED.`,
                          ``,
                          `Thank you,`,
                          `PurpleBox`,
                        ].join('\n'),
                        pdfUrl,
                      })
                    } catch (e: any) { setErr(apiError(e)) }
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors"
                  style={{ color: '#3B82F6' }}
                >
                  <Mail size={13} /> Email
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await api.get(`/invoices/${inv._id}/pdf`, { responseType: 'blob' })
                    const url = URL.createObjectURL(res.data)
                    window.open(url, '_blank')
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors"
                  style={{ color: MUTED }}
                >
                  <Download size={13} /> PDF
                </button>
                {inv.zohoBooksSyncId ? (
                  <a
                    href={`https://books.zoho.com/app/908459713#/invoices/${inv.zohoBooksSyncId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors"
                    style={{ color: '#047857' }}
                  >
                    <ExternalLink size={13} /> Open in Zoho
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await api.post(`/invoices/${inv._id}/sync-zoho-books`)
                        onChanged()
                      } catch (e: any) { setErr(apiError(e)) }
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors"
                    style={{ color: '#047857' }}
                  >
                    <Upload size={13} /> Sync Zoho
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Add invoice */}
      {adding ? (
        <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: `${PURPLE}30`, background: `${PURPLE}05` }}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: PURPLE }}>New invoice</p>
          <ItemEditor items={newItems} onChange={setNewItems} />
          <div className="flex items-center justify-between">
            <Field label="Due date">
              <Input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} className="h-8 text-xs w-40" />
            </Field>
            <span className="text-sm font-bold" style={{ color: INK }}>Total {formatMoney(newTotal)} AED</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => create.mutate()} disabled={create.isPending || !newItems.length} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: PURPLE }}>
              {create.isPending ? 'Creating…' : 'Create Invoice'}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-xs font-medium hover:underline" style={{ color: MUTED }}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={startAddBlank} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border hover:bg-gray-50" style={{ color: INK, borderColor: 'rgba(20,8,31,0.15)' }}>
            <Plus size={14} /> Custom invoice
          </button>
        </div>
      )}

      {err && <p className="text-sm px-3 py-2 rounded-lg" style={{ color: '#b91c1c', background: '#fef2f2' }}>{err}</p>}
      {emailSent && <DoneBanner text={emailSent} />}

      {/* Email compose modal */}
      <Modal open={!!emailModal} onClose={() => setEmailModal(null)} title="Send Invoice Email" wide>
        {emailModal && (
          <div className="space-y-4">
            <Field label="To">
              <Input
                type="email"
                value={emailModal.to}
                onChange={(e) => setEmailModal({ ...emailModal, to: e.target.value })}
                placeholder="customer@email.com"
              />
            </Field>
            <Field label="Subject">
              <Input
                value={emailModal.subject}
                onChange={(e) => setEmailModal({ ...emailModal, subject: e.target.value })}
              />
            </Field>
            <Field label="Body">
              <Textarea
                value={emailModal.body}
                onChange={(e) => setEmailModal({ ...emailModal, body: e.target.value })}
                rows={8}
              />
            </Field>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: CHIP_BG }}>
              <FileText size={14} style={{ color: PURPLE }} />
              <span className="text-xs flex-1" style={{ color: INK }}>Invoice PDF will be attached automatically</span>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'rgba(20,8,31,0.06)' }}>
              <button
                type="button"
                onClick={() => setEmailModal(null)}
                disabled={emailSending}
                className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity disabled:opacity-50"
                style={{ color: INK, borderColor: 'rgba(20,8,31,0.15)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={emailSending || !emailModal.to}
                onClick={async () => {
                  setEmailSending(true)
                  try {
                    const toAddr = emailModal.to
                    await api.post(`/invoices/${emailModal.invoiceId}/send-email`, {
                      to: toAddr,
                      subject: emailModal.subject,
                      body: emailModal.body,
                    })
                    setEmailModal(null)
                    setEmailSent(`Email sent to ${toAddr}`)
                    setErr('')
                  } catch (e: any) {
                    setErr(apiError(e))
                  } finally {
                    setEmailSending(false)
                  }
                }}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ background: PURPLE }}
              >
                {emailSending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : <><Send size={14} /> Send Email</>}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default function NewQuote() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  useAuth()

  const [searchParams] = useSearchParams()
  const leadParam = searchParams.get('lead')
  const quoteParam = searchParams.get('quote')
  // Booking a further unit for an existing tenant arrives with the customer
  // already known, e.g. from the contract page's "Add contract".
  const customerParam = searchParams.get('customer')

  const [step, setStep] = useState(0)
  const [err, setErr] = useState('')
  const [showCustomerModal, setShowCustomerModal] = useState(false)

  // Flow anchors — created/loaded as the flow progresses
  const [quoteId, setQuoteId] = useState('')
  const [quoteNo, setQuoteNo] = useState('')
  const [showShareBar, setShowShareBar] = useState(false)
  const invoiceHandleRef = useRef<InvoiceStepHandle | null>(null)
  const [quoteEmailModal, setQuoteEmailModal] = useState<{ to: string; subject: string; body: string; quoteUrl: string } | null>(null)
  const [quoteEmailSending, setQuoteEmailSending] = useState(false)
  const [quoteEmailSent, setQuoteEmailSent] = useState('')
  const [contractId, setContractId] = useState('')
  const hydratedRef = useRef(false)
  const stepAutoSetRef = useRef(false)

  // Customer
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')

  // Preselect the tenant named in ?customer=, once and only once, so a later
  // manual change is not undone by this effect.
  const customerPreselectedRef = useRef(false)
  useEffect(() => {
    if (!customerParam || customerPreselectedRef.current) return
    customerPreselectedRef.current = true
    api.get(`/customers/${customerParam}`).then((r) => {
      const cu = r.data?.customer ?? r.data
      if (!cu?._id) return
      setCustomerId(cu._id)
      setCustomerName(cu.fullName || '')
      setCustomerPhone((cu.phones && cu.phones[0]) || cu.phone || '')
      setCustomerEmail(cu.email || '')
    }).catch(() => { /* fall back to picking the tenant by hand */ })
  }, [customerParam])

  // Quote
  const [dateRangeFrom, setDateRangeFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })
  const [dateRangeTo, setDateRangeTo] = useState('')
  const [customEnd, setCustomEnd] = useState(false)

  // Duration helpers — end date is picked as N weeks from the start date
  const addWeeksISO = (iso: string, weeks: number) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + weeks * 7)).toISOString().slice(0, 10)
  }
  const rangeDays = dateRangeFrom && dateRangeTo
    ? Math.round((new Date(dateRangeTo).getTime() - new Date(dateRangeFrom).getTime()) / 86400000)
    : 0
  const derivedWeeks = rangeDays > 0 && rangeDays % 7 === 0 ? rangeDays / 7 : null
  const WEEK_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 20, 24, 36, 52]
  const durationValue = customEnd
    ? 'custom'
    : derivedWeeks && WEEK_OPTIONS.includes(derivedWeeks) ? String(derivedWeeks) : (dateRangeTo ? 'custom' : '')
  const fmtLongDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).replace(/ /g, '-')
  const [deposit, setDeposit] = useState('')
  // Remembers the amount when the deposit is removed, so "+ Add back" can restore it
  const removedDepositRef = useRef('')
  const [holdAdvance, setHoldAdvance] = useState(true)
  const [notes, setNotes] = useState('')
  const [unitRows, setUnitRows] = useState<UnitRow[]>([])
  const [addOnRows, setAddOnRows] = useState<AddOnRow[]>([])
  const [adjustment, setAdjustment] = useState(0)
  const expiryDate = (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10) })()

  // Contract options
  const [authorizedPersons, setAuthorizedPersons] = useState<AccessPerson[]>([])
  const [paymentMethod, setPaymentMethod] = useState('')
  const [accessType, setAccessType] = useState('')
  const [agreementOpen, setAgreementOpen] = useState(false)
  const [agreementBusy, setAgreementBusy] = useState('')
  const agreementEditRef = useRef<HTMLDivElement>(null)
  const [customerDocs, setCustomerDocs] = useState<{ _id: string; name: string; type: string; url: string }[]>([])
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [docType, setDocType] = useState('emirates_id')
  const docInputRef = useRef<HTMLInputElement>(null)

  // Contract signing / actions
  const [signingOpen, setSigningOpen] = useState(false)
  const [signingLink, setSigningLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  // ── Lead + resume data ──────────────────────────────────────────────────────
  const { data: lead } = useQuery<Lead>({
    queryKey: ['lead-detail', leadParam],
    queryFn: () => api.get(`/leads/${leadParam}`).then((r) => r.data),
    enabled: Boolean(leadParam),
  })

  const { data: resumeQuotes, isLoading: resumeLoading } = useQuery<Quote[]>({
    queryKey: ['flow-resume', leadParam, quoteParam],
    queryFn: async () => {
      if (quoteParam) return [await quoteApi.get(quoteParam)]
      if (leadParam) return await quoteApi.list({ lead: leadParam })
      return []
    },
  })

  const { data: flowData } = useQuery<ContractDetailData>({
    queryKey: ['flow-contract', contractId],
    queryFn: () => api.get(`/contracts/${contractId}`).then((r) => r.data),
    enabled: Boolean(contractId),
  })

  const { data: customerDocsData } = useQuery({
    queryKey: ['customer-docs', customerId],
    queryFn: () => api.get(`/documents?customer=${customerId}`).then((r) => r.data),
    enabled: Boolean(customerId),
  })
  useEffect(() => {
    if (customerDocsData) setCustomerDocs(customerDocsData)
  }, [customerDocsData])

  const handleDocUpload = async (files: FileList | null, docType: string) => {
    if (!files || !customerId) return
    setUploadingDoc(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('customer', customerId)
        fd.append('type', docType)
        fd.append('name', file.name)
        const { data } = await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        setCustomerDocs((prev) => [...prev, data])
      }
    } catch (e: any) { setErr(apiError(e)) }
    setUploadingDoc(false)
  }

  const removeDoc = async (id: string) => {
    try {
      await api.delete(`/documents/${id}`)
      setCustomerDocs((prev) => prev.filter((d) => d._id !== id))
    } catch (e: any) { setErr(apiError(e)) }
  }

  const contract = flowData?.contract
  const invoice = flowData?.invoices?.[0]
  const paidTotal = (flowData?.invoices || []).reduce((s, i) => s + Number(i.paymentMade ?? 0), 0)
  const approvalStatus = contract?.approvalStatus ?? 'not_required'
  const quoteLocked = false

  // Hydrate the wizard from the latest quote for this lead (resume support)
  useEffect(() => {
    if (hydratedRef.current || resumeLoading) return
    const q = resumeQuotes?.[0]
    if (!q) { hydratedRef.current = true; return }
    hydratedRef.current = true

    setQuoteId(q._id)
    setQuoteNo(q.quoteNo || '')
    setShowShareBar(true)
    if (q.customer && typeof q.customer === 'object') {
      setCustomerId(q.customer._id)
      setCustomerName(q.customer.fullName)
      setCustomerPhone(q.customer.phone || '')
      setCustomerEmail(q.customer.email || '')
    }
    setDeposit(q.deposit ? String(q.deposit) : '')
    // Server default is true; only an explicit false (removed) should turn it off
    setHoldAdvance((q as { holdAdvance?: boolean }).holdAdvance !== false)
    setNotes(q.notes || '')
    setAdjustment(q.adjustment || 0)
    const units = (q.units || []).map((u) => ({
      unitId: typeof u.unit === 'object' ? u.unit._id : u.unit,
      unitNumber: u.unitNumber,
      sizeSqf: u.sizeSqf,
      floor: u.floor,
      startDate: u.startDate ? new Date(u.startDate).toISOString().slice(0, 10) : '',
      endDate: u.endDate ? new Date(u.endDate).toISOString().slice(0, 10) : '',
      rate: u.rate,
      discountPct: u.discountPct,
    }))
    setUnitRows(units)
    setDateRangeFrom(units[0]?.startDate || '')
    setDateRangeTo(units[0]?.endDate || '')
    setAddOnRows((q.addOns || []).map((a) => ({ name: a.name, description: a.description || '', quantity: a.quantity, rate: a.rate })))

    const linkedContract = typeof q.contract === 'object' && q.contract ? q.contract : null
    if (linkedContract) {
      setContractId(linkedContract._id)
    }
    if (typeof q.flowStep === 'number' && q.flowStep >= 0) {
      setStep(q.flowStep)
      stepAutoSetRef.current = true
    } else if (linkedContract) {
      // fallback for older quotes without flowStep — set once contract loads
    } else {
      setStep(2)
      stepAutoSetRef.current = true
    }
  }, [resumeQuotes, resumeLoading])

  // Fallback: once contract data loads on resume (for quotes without flowStep), jump to the pending step
  useEffect(() => {
    if (stepAutoSetRef.current || !contract) return
    stepAutoSetRef.current = true
    if (contract.status === 'active') setStep(5)
    else if (paidTotal > 0) setStep(5)
    else if (flowData?.invoices?.length) setStep(4)
    else setStep(3)
  }, [contract, paidTotal, flowData])

  // Load contract options (authorized persons etc.) whenever the contract data arrives
  const optionsHydratedRef = useRef('')
  useEffect(() => {
    if (!contract || optionsHydratedRef.current === contract._id) return
    optionsHydratedRef.current = contract._id
    setAuthorizedPersons(contract.authorizedPersons || [])
    setPaymentMethod(contract.paymentMethod || '')
  }, [contract])

  useEffect(() => { if (contract) setAccessType((contract as any).accessType || '') }, [contract?._id, (contract as any)?.accessType])

  // Persist flow step to server whenever step changes
  const prevStepRef = useRef(-1)
  useEffect(() => {
    if (!quoteId || !hydratedRef.current) return
    if (prevStepRef.current === step) return
    prevStepRef.current = step
    const done = [
      Boolean(customerId),
      unitRows.length > 0,
      Boolean(quoteId),
      Boolean(contractId),
      Boolean(invoice),
      paidTotal > 0,
    ]
    quoteApi.updateFlowStep(quoteId, step, done).catch(() => { })
  }, [quoteId, step])

  // Auto-match customer from lead phone (new flows only)
  const { data: leadCustomerMatch } = useQuery<{ data: Customer[] }>({
    queryKey: ['customer-by-lead-phone', lead?.phone],
    queryFn: () => api.get('/customers', { params: { search: lead?.phone, limit: 3 } }).then((r) => r.data),
    enabled: Boolean(lead?.phone) && !customerId && !quoteId,
  })

  useEffect(() => {
    if (customerId || !lead || quoteId) return
    const match = leadCustomerMatch?.data?.[0]
    if (match) {
      setCustomerId(match._id)
      setCustomerName(match.fullName)
      setCustomerPhone(match.phone || '')
      setCustomerEmail(match.email || '')
    }
  }, [leadCustomerMatch, lead, customerId, quoteId])

  const { data: customersPage } = useQuery<{ data: Customer[] }>({
    queryKey: ['customers-search', customerSearch],
    queryFn: () => api.get('/customers', { params: { search: customerSearch, limit: 20 } }).then((r) => r.data),
  })
  const customers = customersPage?.data ?? []

  const createCustomerMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/customers', body).then((r) => r.data),
    onSuccess: (customer: Customer) => {
      qc.invalidateQueries({ queryKey: ['customers-search'] })
      setCustomerId(customer._id)
      setCustomerName(customer.fullName)
      setCustomerPhone(customer.phone || '')
      setCustomerEmail(customer.email || '')
      setShowCustomerModal(false)
      setCustomerSearch('')
      setErr('')
    },
    onError: (e) => setErr(apiError(e)),
  })

  // ── Units ──────────────────────────────────────────────────────────────────
  const [unitStatusFilter, setUnitStatusFilter] = useState<'free' | 'all' | 'available' | 'rented' | 'reserved' | 'booked'>('available')
  const [unitSearch, setUnitSearch] = useState('')
  const [sizeFilter, setSizeFilter] = useState('')
  const [floorFilter, setFloorFilter] = useState('')
  const [hoverUnit, setHoverUnit] = useState<{ unit: AvailableUnit; x: number; y: number } | null>(null)

  const { data: allUnits, isLoading: unitsLoading } = useQuery<AvailableUnit[]>({
    queryKey: ['available-units-all', dateRangeFrom, dateRangeTo],
    queryFn: () => quoteApi.availableUnits(dateRangeFrom || undefined, dateRangeTo || undefined, true),
    enabled: step === 1 && !quoteLocked,
  })

  const sizeOptions = [...new Set((allUnits || []).map((u) => u.sizeSqf))].sort((a, b) => a - b)
  const floorOptions = [...new Set([...(allUnits || []).map((u) => u.floor).filter(Boolean), 'F1', 'F2', 'F3', 'Shed'])].sort()

  const filteredUnits = (allUnits || []).filter((u) => {
    if (unitSearch && !u.unitNumber.toLowerCase().includes(unitSearch.trim().toLowerCase())) return false
    if (sizeFilter && u.sizeSqf !== Number(sizeFilter)) return false
    if (floorFilter && u.floor !== floorFilter) return false
    switch (unitStatusFilter) {
      case 'free': return !u.bookedInPeriod && u.status !== 'maintenance'
      case 'available': return u.status === 'available'
      case 'rented': return u.status === 'occupied'
      case 'reserved': return u.status === 'reserved'
      case 'booked': return Boolean(u.bookedInPeriod)
      default: return true
    }
  })

  const UNIT_FILTERS: { key: typeof unitStatusFilter; label: string }[] = [
    { key: 'available', label: 'Available' },
    { key: 'free', label: 'Free in period' },
    { key: 'rented', label: 'Rented' },
    { key: 'reserved', label: 'Reserved' },
    { key: 'booked', label: 'Booked in period' },
    { key: 'all', label: 'All' },
  ]

  const selectedUnitIds = new Set(unitRows.map((u) => u.unitId))

  function addUnit(unit: AvailableUnit) {
    if (selectedUnitIds.has(unit._id)) return
    setUnitRows((prev) => [
      ...prev,
      {
        unitId: unit._id,
        unitNumber: unit.unitNumber,
        sizeSqf: unit.sizeSqf,
        floor: unit.floor,
        startDate: dateRangeFrom,
        endDate: dateRangeTo,
        rate: unit.price || 0,
        discountPct: unit.discountPct || 0,
        existingBookings: (unit.bookings || []).map((b) => ({
          ref: b.ref, customer: b.customer, startDate: b.startDate, endDate: b.endDate, kind: b.kind,
        })),
      },
    ])
  }

  function removeUnit(idx: number) {
    setUnitRows((prev) => prev.filter((_, i) => i !== idx))
  }

  // Preselect a unit passed via ?unit=<id or number> (e.g. from the Floor Map)
  const unitParam = searchParams.get('unit')
  const autoAddedUnitRef = useRef(false)
  useEffect(() => {
    if (autoAddedUnitRef.current || !unitParam || !allUnits) return
    const u = allUnits.find((x) => x._id === unitParam || x.unitNumber === unitParam)
    if (u) { addUnit(u); autoAddedUnitRef.current = true }
  }, [unitParam, allUnits])

  useEffect(() => {
    if (!dateRangeFrom && !dateRangeTo) return
    setUnitRows((prev) => prev.map((r) => ({
      ...r,
      ...(dateRangeFrom && { startDate: dateRangeFrom }),
      ...(dateRangeTo && { endDate: dateRangeTo }),
    })))
  }, [dateRangeFrom, dateRangeTo])

  function updateUnit(idx: number, field: keyof UnitRow, value: string | number) {
    setUnitRows((prev) => prev.map((u, i) => (i === idx ? { ...u, [field]: value } : u)))
  }

  function addAddOn(preset?: (typeof DEFAULT_ADDONS)[0]) {
    setAddOnRows((prev) => [
      ...prev,
      { name: preset?.name || '', description: preset?.description || '', quantity: 1, rate: preset?.rate || 0 },
    ])
  }

  function removeAddOn(idx: number) {
    setAddOnRows((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateAddOn(idx: number, field: keyof AddOnRow, value: string | number) {
    setAddOnRows((prev) => prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)))
  }

  function calcUnitPeriodTotal(rate: number, discountPct: number, start: string, end: string) {
    const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000)
    if (days <= 0) return 0
    const totalWeeks = Math.ceil(days / 7)
    const weeklyFull = rate / 4
    const weeklyDisc = weeklyFull - (weeklyFull * discountPct) / 100
    const discWeeks = Math.min(4, totalWeeks)
    const fullWeeks = Math.max(0, totalWeeks - 4)
    return Math.round((discWeeks * weeklyDisc + fullWeeks * weeklyFull) * 100) / 100
  }

  // Advance rent collected on the first invoice: one period (max 4 weeks).
  // For terms longer than 4 weeks it prepays the FINAL period, so it is already
  // part of the term rent. For terms of 4 weeks or less it is held refundable
  // on top, since there is no later period to adjust it against.
  // The advance covers the final rental period, so its length is what the term
  // leaves after the whole 4-week periods (6 weeks runs 4 + 2 → a 2-week advance).
  function calcUnitAdvance(rate: number, start: string, end: string) {
    const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000)
    if (days <= 0) return 0
    const weeks = Math.ceil(days / 7)
    const advWeeks = weeks % 4 === 0 ? 4 : weeks % 4
    return Math.round((rate / 4) * advWeeks * 100) / 100
  }
  function isShortTerm(start: string, end: string) {
    const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000)
    return days > 0 && Math.ceil(days / 7) <= 4
  }

  const unitsTotal = unitRows.reduce((s, u) => s + calcUnitPeriodTotal(u.rate, u.discountPct, u.startDate, u.endDate), 0)
  const advanceTotal = unitRows.reduce((s, u) => s + calcUnitAdvance(u.rate, u.startDate, u.endDate), 0)
  // Only short terms add the advance on top of the rent
  const advanceExtra = unitRows.reduce((s, u) => s + (isShortTerm(u.startDate, u.endDate) ? calcUnitAdvance(u.rate, u.startDate, u.endDate) : 0), 0)
  const addOnsTotal = addOnRows.reduce((s, a) => s + a.quantity * a.rate, 0)
  const subTotal = unitsTotal + addOnsTotal
  // Grand total = rent + add-ons + held advance (short terms) + security
  // deposit — identical to what the server stores for the quote.
  const total = subTotal + adjustment + (holdAdvance ? advanceExtra : 0) + (Number(deposit) || 0)

  useEffect(() => { setErr(''); setSentMsg('') }, [step])

  // ── Step actions ────────────────────────────────────────────────────────────
  function buildQuoteBody() {
    return {
      customer: customerId,
      lead: leadParam || undefined,
      billingPeriod: 'monthly',
      expiryDate,
      notes,
      deposit: Number(deposit) || 0,
      holdAdvance,
      adjustment,
      // No total sent — the server computes it from units/add-ons/deposit
      units: unitRows.map((u) => ({
        unit: u.unitId, unitNumber: u.unitNumber, sizeSqf: u.sizeSqf, floor: u.floor,
        startDate: u.startDate, endDate: u.endDate, rate: u.rate, discountPct: u.discountPct,
      })),
      addOns: addOnRows.filter((a) => a.name).map((a) => ({
        name: a.name, description: a.description, quantity: a.quantity, rate: a.rate,
      })),
      items: [],
    }
  }

  function validateUnits(): boolean {
    if (!dateRangeFrom || !dateRangeTo) { setErr('Please set the rental start and end dates'); return false }
    if (dateRangeTo <= dateRangeFrom) { setErr('End date must be after start date'); return false }
    if (!unitRows.length) { setErr('Please select at least one unit'); return false }
    if (unitRows.some((u) => !u.startDate || !u.endDate)) { setErr('Each selected unit needs start and end dates'); return false }
    return true
  }

  function validateQuote(): boolean {
    if (!customerId) { setErr('Please select a customer first'); setStep(0); return false }
    if (!validateUnits()) { setStep(1); return false }
    return true
  }

  const saveQuote = useMutation({
    mutationFn: async () => {
      const body = buildQuoteBody()
      return quoteId ? quoteApi.update(quoteId, body) : quoteApi.create(body)
    },
    onSuccess: (q) => {
      setQuoteId(q._id)
      setQuoteNo(q.quoteNo || '')
      qc.invalidateQueries({ queryKey: ['quotes'] })
      qc.invalidateQueries({ queryKey: ['flow-resume'] })
      qc.invalidateQueries({ queryKey: ['flow-contract'] })
      setErr('')
      setShowShareBar(true)
    },
    onError: (e) => setErr(apiError(e)),
  })

  // Persists a toggle (remove/add-back advance or deposit) the moment it's
  // clicked, instead of only updating local state — otherwise the change is
  // lost on reload/navigation until "Save Quote & Send" happens to be clicked.
  // `overrides` wins over buildQuoteBody()'s own reading of the (not-yet-
  // updated) React state for the field just toggled.
  const patchQuote = useMutation({
    mutationFn: (overrides: Record<string, unknown>) => {
      const body = { ...buildQuoteBody(), ...overrides }
      return quoteId ? quoteApi.update(quoteId, body) : quoteApi.create(body)
    },
    onSuccess: (q) => {
      setQuoteId(q._id)
      setQuoteNo(q.quoteNo || '')
      qc.invalidateQueries({ queryKey: ['quotes'] })
      qc.invalidateQueries({ queryKey: ['flow-resume'] })
      qc.invalidateQueries({ queryKey: ['flow-contract'] })
      setErr('')
    },
    onError: (e) => setErr(apiError(e)),
  })

  const [sentMsg, setSentMsg] = useState('')

  const sendQuote = useMutation({
    mutationFn: async (channel: 'whatsapp' | 'email') => {
      // Save first (unless locked)
      let q: Quote
      if (quoteLocked && quoteId) {
        q = await quoteApi.get(quoteId)
      } else {
        const body = buildQuoteBody()
        q = quoteId ? await quoteApi.update(quoteId, body) : await quoteApi.create(body)
        setQuoteId(q._id)
      }

      const { url } = await quoteApi.share(q._id, channel)
      return { q, url, channel }
    },
    onSuccess: ({ q, url, channel }) => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      qc.invalidateQueries({ queryKey: ['flow-resume'] })
      setErr('')
      setSentMsg('')
      const text =
        `Hello ${customerName},\n\n` +
        `Please find your storage quotation ${q.quoteNo} — ${formatMoney(q.total)} AED.\n` +
        `View the quote here: ${url}\n\n` +
        `Thank you — PurpleBox`
      if (channel === 'whatsapp') {
        const phone = customerPhone.replace(/\D/g, '').replace(/^00/, '')
        window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
      } else {
        setQuoteEmailModal({
          to: customerEmail,
          subject: `Storage Quotation ${q.quoteNo} — PurpleBox`,
          body: [
            `Hello ${customerName},`,
            ``,
            `Please find your storage quotation ${q.quoteNo} — ${formatMoney(q.total)} AED.`,
            ``,
            `Thank you,`,
            `PurpleBox`,
          ].join('\n'),
          quoteUrl: url,
        })
      }
    },
    onError: (e) => setErr(apiError(e)),
  })

  const downloadQuote = useMutation({
    mutationFn: async () => {
      let q: Quote
      if (quoteLocked && quoteId) {
        q = await quoteApi.get(quoteId)
      } else {
        const body = buildQuoteBody()
        q = quoteId ? await quoteApi.update(quoteId, body) : await quoteApi.create(body)
        setQuoteId(q._id)
      }
      const res = await api.get(`/quotes/${q._id}/pdf`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data as Blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${q.quoteNo}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      return q
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      qc.invalidateQueries({ queryKey: ['flow-resume'] })
      setErr('')
    },
    onError: (e) => setErr(apiError(e)),
  })

  const contractOptionsBody = () => ({
    authorizedPersons: authorizedPersons.filter((p) => p.name?.trim()),
    paymentMethod,
    accessType,
  })

  const createContract = useMutation({
    mutationFn: async () => {
      await quoteApi.updateStatus(quoteId, 'accepted')
      return api
        .post<{ contractId: string; contractNo: string }>(`/quotes/${quoteId}/convert-to-contract`, contractOptionsBody())
        .then((r) => r.data)
    },
    onSuccess: (r) => {
      setContractId(r.contractId)
      qc.invalidateQueries({ queryKey: ['quotes'] })
      qc.invalidateQueries({ queryKey: ['flow-resume'] })
      qc.invalidateQueries({ queryKey: ['flow-contract'] })
      qc.invalidateQueries({ queryKey: ['contracts'] })
      setErr('')
    },
    onError: (e) => setErr(apiError(e)),
  })

  const saveContractOptions = useMutation({
    mutationFn: () => api.put(`/contracts/${contractId}`, contractOptionsBody()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flow-contract'] })
      setErr('')
      setSentMsg('Contract options saved')
    },
    onError: (e) => setErr(apiError(e)),
  })

  const createSigningLink = useMutation({
    mutationFn: () => api.post<{ signingUrl: string }>(`/contracts/${contractId}/create-signing-link`).then((r) => r.data),
    onSuccess: (r) => {
      setSigningLink(r.signingUrl)
      setLinkCopied(false)
      qc.invalidateQueries({ queryKey: ['flow-contract'] })
      setErr('')
    },
    onError: (e) => setErr(apiError(e)),
  })

  const signInPerson = useMutation({
    mutationFn: (body: { signerName: string; signatureDataUrl: string | null; signMode: 'draw' | 'type' }) =>
      api.post(`/contracts/${contractId}/sign-inperson`, body),
    onSuccess: () => {
      setSigningOpen(false)
      qc.invalidateQueries({ queryKey: ['flow-contract'] })
      setErr('')
    },
    onError: (e) => setErr(apiError(e)),
  })

  const cancelContract = useMutation({
    mutationFn: () => api.post(`/contracts/${contractId}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['flow-contract'] })
      qc.invalidateQueries({ queryKey: ['flow-resume'] })
      setErr('')
    },
    onError: (e) => setErr(apiError(e)),
  })

  function updatePerson(idx: number, field: keyof AccessPerson, value: string) {
    setAuthorizedPersons((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)))
  }
  function addPerson() {
    setAuthorizedPersons((prev) => [...prev, { name: '', phone: '', relation: '', idType: '', idNumber: '' }])
  }
  function removePerson(idx: number) {
    setAuthorizedPersons((prev) => prev.filter((_, i) => i !== idx))
  }

  const sendForApproval = useMutation({
    mutationFn: () => api.post(`/contracts/${contractId}/send-for-approval`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['flow-contract'] }); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  // Which steps are complete (for the stepper)
  const stepDone = [
    Boolean(customerId),
    unitRows.length > 0,
    Boolean(quoteId),
    Boolean(contractId),
    Boolean(invoice),
    paidTotal > 0,
  ]

  function canOpenStep(i: number): boolean {
    if (i === step) return false
    return true
  }

  if (resumeLoading) {
    return (
      <div className="-m-3 p-3 sm:-m-4 sm:p-4" style={{ background: CREAM, minHeight: '100vh' }}>
        <div className="flex items-center justify-center py-24"><Spinner /></div>
      </div>
    )
  }

  return (
    <div className="-m-3 p-3 sm:-m-4 sm:p-4" style={{ background: CREAM, minHeight: '100vh' }}>
      <div style={{ borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
        {/* The unit picker needs the full width to show a useful number of
            units; the other steps are forms and stay narrow to read well. */}
        <div className={step === 1 ? '' : 'max-w-3xl'}>

          {/* Header */}
          <div className="mb-6">
            <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
              Book Unit
            </h1>
            <p style={{ color: MUTED, fontSize: '0.875rem', marginTop: '0.375rem' }}>
              {customerName || lead?.fullName
                ? <>For <span style={{ color: PURPLE, fontWeight: 600 }}>{customerName || lead?.fullName}</span> — complete every step in one place</>
                : 'Lead to booking — complete every step in one place'}
            </p>
          </div>

          {/* Stepper */}
          <div className="flex items-center mb-8 gap-1">
            {STEPS.map((s, i) => {
              const done = stepDone[i] && i !== step
              const active = i === step
              const Icon = s.icon
              const clickable = canOpenStep(i)
              return (
                <div key={s.key} className="flex items-center" style={{ flex: i < STEPS.length - 1 ? 1 : undefined }}>
                  <button
                    type="button"
                    onClick={() => { if (clickable) setStep(i) }}
                    className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2 shrink-0"
                    style={{ cursor: clickable ? 'pointer' : 'default' }}
                  >
                    <div
                      className="flex items-center justify-center rounded-full transition-all"
                      style={{
                        width: 36, height: 36,
                        background: done ? GREEN : active ? PURPLE : '#fff',
                        border: done || active ? 'none' : `2px solid ${CHIP_BG}`,
                        color: done || active ? '#fff' : MUTED,
                      }}
                    >
                      {done ? <Check size={15} /> : <Icon size={15} />}
                    </div>
                    <span
                      className="text-[10px] sm:text-xs font-medium"
                      style={{ color: active ? INK : done ? GREEN : MUTED, whiteSpace: 'nowrap' }}
                    >
                      {s.label}
                    </span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div
                      className="flex-1 mx-1 sm:mx-3 hidden sm:block"
                      style={{ height: 2, background: stepDone[i] ? GREEN : CHIP_BG, borderRadius: 1, transition: 'background 0.3s' }}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {/* Step Card */}
          <div
            style={{
              background: '#fff', borderRadius: 18, border: '1px solid rgba(20,8,31,0.06)',
              padding: '2rem 2.25rem', boxShadow: '0 1px 3px rgba(20,8,31,0.04)', minHeight: 320,
            }}
          >
            {/* ── Step 1: Customer ── */}
            {step === 0 && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <SectionTitle title="Customer" subtitle="Who is this rental for?" />
                  <button
                    type="button"
                    onClick={() => setShowCustomerModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
                    style={{ background: `${PURPLE}10`, color: PURPLE }}
                  >
                    <Plus size={14} /> New Customer
                  </button>
                </div>

                {!customerId ? (
                  <>
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
                      <Input
                        value={customerSearch}
                        onChange={(e) => setCustomerSearch(e.target.value)}
                        placeholder="Search by name, phone, or email…"
                        className="pl-9"
                        autoComplete="off"
                      />
                    </div>
                    {customerSearch && customers.length > 0 && (
                      <div className="border rounded-xl divide-y text-sm max-h-56 overflow-y-auto" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                        {customers.map((c) => (
                          <button
                            key={c._id}
                            type="button"
                            className="w-full text-left px-4 py-3 hover:bg-gray-50"
                            onClick={() => { setCustomerId(c._id); setCustomerName(c.fullName); setCustomerPhone(c.phone || ''); setCustomerEmail(c.email || ''); setCustomerSearch('') }}
                          >
                            <div className="font-medium" style={{ color: INK }}>{c.fullName}</div>
                            <div className="text-xs" style={{ color: MUTED }}>{c.phone || c.email || 'No contact'}</div>
                          </button>
                        ))}
                      </div>
                    )}
                    {lead && !customerSearch && (
                      <div className="flex items-center justify-between gap-3 p-4 rounded-xl" style={{ background: CHIP_BG }}>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold" style={{ color: INK }}>{lead.fullName}</p>
                          <p className="text-xs" style={{ color: MUTED }}>{lead.phone}{lead.email ? ` · ${lead.email}` : ''} — from lead</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => createCustomerMut.mutate({
                            fullName: lead.fullName, phone: lead.phone || '', email: lead.email || '',
                            tenantType: 'individual', notes: lead.notes || '',
                          })}
                          disabled={createCustomerMut.isPending}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
                          style={{ background: PURPLE }}
                        >
                          {createCustomerMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                          Create customer from lead
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-4 p-4 rounded-xl" style={{ background: CHIP_BG }}>
                    <div className="flex items-center justify-center rounded-full" style={{ width: 44, height: 44, background: `${PURPLE}15`, color: PURPLE }}>
                      <User size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold" style={{ color: INK }}>{customerName}</p>
                      {customerPhone && <p className="text-xs" style={{ color: MUTED }}>{customerPhone}</p>}
                    </div>
                    {!quoteLocked && (
                      <button
                        type="button"
                        onClick={() => { setCustomerId(''); setCustomerName(''); setCustomerPhone(''); setCustomerEmail(''); setCustomerSearch('') }}
                        className="text-xs font-medium px-3 py-1 rounded-lg"
                        style={{ color: PURPLE, background: '#fff' }}
                      >
                        Change
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Step 2: Select / search units ── */}
            {step === 1 && (
              <div className="space-y-5">
                <SectionTitle
                  title="Select Units"
                  subtitle={quoteLocked ? 'Locked — this contract is fully booked' : 'Set the rental period, then search and pick units'}
                />

                {quoteLocked ? (
                  <div className="p-4 rounded-xl" style={{ background: CHIP_BG }}>
                    {unitRows.map((u) => (
                      <InfoRow key={u.unitId} label={`${u.unitNumber} · ${u.startDate} → ${u.endDate}`} value={`${formatMoney(u.rate - (u.rate * u.discountPct) / 100)} AED/4wk`} />
                    ))}
                  </div>
                ) : (
                  <>
                    {/* Rental period */}
                    <div className="p-4 rounded-xl space-y-3" style={{ background: CHIP_BG }}>
                      <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: PURPLE }}>
                        <CalendarRange size={13} /> Rental Period
                      </p>
                      <div className="grid grid-cols-2 gap-3 max-w-xl">
                        <Field label="Start Date">
                          <Input type="date" value={dateRangeFrom} onChange={(e) => {
                            const v = e.target.value
                            setDateRangeFrom(v)
                            // Keep the chosen duration when the start date moves
                            if (v && !customEnd && derivedWeeks) setDateRangeTo(addWeeksISO(v, derivedWeeks))
                          }} />
                        </Field>
                        <Field label="Duration">
                          <select
                            value={durationValue}
                            onChange={(e) => {
                              const v = e.target.value
                              if (v === 'custom') { setCustomEnd(true); return }
                              setCustomEnd(false)
                              if (!v) return
                              const start = dateRangeFrom || new Date().toISOString().slice(0, 10)
                              if (!dateRangeFrom) setDateRangeFrom(start)
                              setDateRangeTo(addWeeksISO(start, parseInt(v)))
                            }}
                            className="w-full h-9 rounded-lg border bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring cursor-pointer"
                          >
                            <option value="">— Select —</option>
                            {WEEK_OPTIONS.map((w) => <option key={w} value={w}>{w} week{w !== 1 ? 's' : ''}</option>)}
                            <option value="custom">Custom end date</option>
                          </select>
                        </Field>
                      </div>
                      {durationValue === 'custom' && (
                        <Field label="End Date">
                          <Input
                            type="date"
                            value={dateRangeTo}
                            min={dateRangeFrom || undefined}
                            onChange={(e) => setDateRangeTo(e.target.value)}
                            style={dateRangeFrom && dateRangeTo && dateRangeTo <= dateRangeFrom ? { borderColor: '#EF4444' } : undefined}
                          />
                        </Field>
                      )}
                      {dateRangeFrom && dateRangeTo && (
                        rangeDays <= 0 ? (
                          <p className="text-xs font-medium" style={{ color: '#EF4444' }}>End date must be after start date</p>
                        ) : (
                          <p className="text-xs font-medium" style={{ color: MUTED }}>
                            Ends on <span className="font-bold" style={{ color: PURPLE }}>{fmtLongDate(dateRangeTo)}</span>
                            {' '}· {rangeDays} day{rangeDays !== 1 ? 's' : ''} · {Math.ceil(rangeDays / 7)} week{Math.ceil(rangeDays / 7) !== 1 ? 's' : ''}
                          </p>
                        )
                      )}
                    </div>

                    {/* Units — visible only after dates are set */}
                    {dateRangeFrom && dateRangeTo && dateRangeTo > dateRangeFrom && (unitsLoading ? (
                      <div className="py-8 flex justify-center"><Spinner /></div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-1.5">
                          {UNIT_FILTERS.map((f) => {
                            const active = unitStatusFilter === f.key
                            return (
                              <button
                                key={f.key}
                                type="button"
                                onClick={() => setUnitStatusFilter(f.key)}
                                className="px-3 py-1.5 rounded-full text-xs font-medium"
                                style={{ background: active ? PURPLE : CHIP_BG, color: active ? '#fff' : MUTED }}
                              >
                                {f.label}
                              </button>
                            )
                          })}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div style={{ height: 36, borderRadius: 10, background: CHIP_BG }} className="flex items-center gap-2 px-3">
                            <Search size={14} color={MUTED} />
                            <input
                              value={unitSearch}
                              onChange={(e) => setUnitSearch(e.target.value)}
                              placeholder="Search unit no…"
                              style={{ background: 'transparent', outline: 'none', border: 'none', fontSize: 13, color: INK, width: 120 }}
                            />
                          </div>
                          <div style={{ height: 36, borderRadius: 10, background: CHIP_BG }} className="px-1">
                            <select value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value)} style={{ height: 36, background: 'transparent', outline: 'none', border: 'none', fontSize: 13, color: INK, fontWeight: 500, paddingRight: 8, paddingLeft: 8 }}>
                              <option value="">All sizes</option>
                              {sizeOptions.map((s) => <option key={s} value={s}>{s} sqft</option>)}
                            </select>
                          </div>
                          <div style={{ height: 36, borderRadius: 10, background: CHIP_BG }} className="px-1">
                            <select value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)} style={{ height: 36, background: 'transparent', outline: 'none', border: 'none', fontSize: 13, color: INK, fontWeight: 500, paddingRight: 8, paddingLeft: 8 }}>
                              <option value="">All floors</option>
                              {floorOptions.map((f) => <option key={f} value={f}>Floor {f}</option>)}
                            </select>
                          </div>
                          <p className="text-xs font-semibold ml-auto" style={{ color: MUTED }}>
                            {filteredUnits.length} unit{filteredUnits.length !== 1 ? 's' : ''}
                            {!dateRangeFrom || !dateRangeTo ? ' (set dates to check the period)' : ''}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 max-h-[30rem] overflow-y-auto pr-1">
                          {filteredUnits.map((u) => {
                            const selected = selectedUnitIds.has(u._id)
                            const blocked = u.status === 'maintenance'
                            const badge = u.bookedInPeriod
                              ? { label: 'Booked', bg: '#FEE2E2', color: '#B91C1C' }
                              : u.status === 'occupied'
                                ? { label: 'Rented', bg: '#FEE2E2', color: '#B91C1C' }
                                : u.status === 'reserved'
                                  ? { label: 'Reserved', bg: '#FEF3C7', color: '#B45309' }
                                  : u.status === 'maintenance'
                                    ? { label: 'Maintenance', bg: CHIP_BG, color: MUTED }
                                    : { label: 'Available', bg: '#D1FAE5', color: '#047857' }
                            return (
                              <button
                                key={u._id}
                                type="button"
                                onClick={() => { if (!selected && !blocked) addUnit(u) }}
                                onMouseEnter={(e) => { if (u.bookings?.length) setHoverUnit({ unit: u, x: e.clientX, y: e.clientY }) }}
                                onMouseMove={(e) => { if (u.bookings?.length) setHoverUnit({ unit: u, x: e.clientX, y: e.clientY }) }}
                                onMouseLeave={() => setHoverUnit(null)}
                                className="relative rounded-xl border text-left transition-all hover:shadow-sm"
                                style={{
                                  padding: 14,
                                  borderColor: selected ? PURPLE : 'rgba(20,8,31,0.08)',
                                  background: selected ? `${PURPLE}08` : '#fff',
                                  opacity: blocked ? 0.6 : 1,
                                  cursor: selected || blocked ? 'not-allowed' : 'pointer',
                                }}
                                title={`${u.unitNumber} · ${u.sizeSqf} sqft · Floor ${u.floor || '—'} · ${badge.label}`}
                              >
                                {selected ? (
                                  <div style={{ position: 'absolute', top: 12, right: 12, width: 22, height: 22, borderRadius: 999, background: PURPLE, display: 'grid', placeItems: 'center' }}>
                                    <Check size={13} color="#fff" />
                                  </div>
                                ) : (
                                  <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: badge.bg, color: badge.color }}>
                                    {badge.label}
                                  </span>
                                )}
                                <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em', color: INK }}>
                                  {u.unitNumber}
                                </div>
                                <div style={{ fontSize: 13, color: '#756E80', marginTop: 4 }}>
                                  {u.sizeSqf} sqft · Floor {u.floor || '—'}
                                </div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: '#4A1FA0', marginTop: 12 }}>
                                  {formatMoney(u.price || 0)} AED/4wk
                                </div>
                              </button>
                            )
                          })}
                        </div>
                        {filteredUnits.length === 0 && (
                          <div className="text-sm text-center py-6 rounded-xl" style={{ background: CHIP_BG, color: MUTED }}>
                            No units match these filters.
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Selected units */}
                    {unitRows.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: PURPLE }}>
                          Selected Units ({unitRows.length})
                        </p>
                        {unitRows.map((u, idx) => {
                          const uDays = Math.round((new Date(u.endDate).getTime() - new Date(u.startDate).getTime()) / 86400000)
                          const uTw = Math.ceil(uDays / 7)
                          const uDurLabel = `${uTw} week${uTw !== 1 ? 's' : ''}`
                          const weeklyFull = u.rate / 4
                          const weeklyDisc = weeklyFull - (weeklyFull * (u.discountPct || 0)) / 100
                          const periodTotal = calcUnitPeriodTotal(u.rate, u.discountPct, u.startDate, u.endDate)
                          return (
                            <div key={u.unitId} className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="text-sm font-bold" style={{ color: INK }}>{u.unitNumber}</span>
                                  <span className="text-xs ml-2" style={{ color: MUTED }}>{u.sizeSqf} sqft</span>
                                </div>
                                <button type="button" onClick={() => removeUnit(idx)} className="text-red-500 hover:text-red-600">
                                  <Trash2 size={15} />
                                </button>
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <Field label="Start">
                                  <Input type="date" value={u.startDate} onChange={(e) => updateUnit(idx, 'startDate', e.target.value)} className="h-8 text-xs" />
                                </Field>
                                <Field label="End">
                                  <Input type="date" value={u.endDate} onChange={(e) => updateUnit(idx, 'endDate', e.target.value)} className="h-8 text-xs" />
                                </Field>
                                <Field label="Rate/4wk">
                                  <Input type="number" min={0} value={u.rate || ''} placeholder="0" onChange={(e) => updateUnit(idx, 'rate', Number(e.target.value) || 0)} className="h-8 text-xs" />
                                </Field>
                                <Field label="Disc 4 weeks %">
                                  <Input type="number" min={0} max={100} value={u.discountPct || ''} onChange={(e) => updateUnit(idx, 'discountPct', Number(e.target.value))} className="h-8 text-xs" placeholder="0" />
                                </Field>
                              </div>
                              {uDays > 0 && (
                                <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'rgba(20,8,31,0.06)' }}>
                                  <p className="text-[11px]" style={{ color: MUTED }}>
                                    {(u.discountPct || 0) > 0 && uTw > 0
                                      ? `4 wks × ${formatMoney(weeklyDisc)} AED/wk (${u.discountPct}% off)${uTw > 4 ? ` + ${uTw - 4} wk${uTw - 4 !== 1 ? 's' : ''} × ${formatMoney(weeklyFull)} AED/wk` : ''}`
                                      : `${uDurLabel} · ${formatMoney(weeklyFull)} AED/wk`}
                                  </p>
                                  <p className="text-xs font-bold" style={{ color: PURPLE }}>
                                    {formatMoney(periodTotal)} AED
                                  </p>
                                </div>
                              )}
                              {(u.existingBookings?.length ?? 0) > 0 && (
                                <div className="rounded-lg p-2.5 space-y-1.5" style={{ background: '#FEF3C7' }}>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#F59E0B', color: '#fff' }}>SHARED</span>
                                    <span className="text-[10px] font-semibold" style={{ color: '#92400E' }}>Existing bookings on this unit</span>
                                  </div>
                                  {u.existingBookings!.map((b, bi) => (
                                    <div key={bi} className="text-[10px]" style={{ color: '#78350F' }}>
                                      <span className="font-semibold">{b.customer || 'Unknown'}</span>
                                      {b.startDate && b.endDate && (
                                        <span> · {formatDate(b.startDate)} → {formatDate(b.endDate)}</span>
                                      )}
                                      <span className="opacity-60"> · {b.ref}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Step 3: Quotation (pricing, add-ons, totals) ── */}
            {step === 2 && (
              <div className="space-y-5">
                <SectionTitle
                  title="Quotation"
                  subtitle={quoteLocked ? 'Locked — this contract is fully booked' : 'Deposit, add-ons and final pricing'}
                />

                {quoteLocked ? (
                  <>
                    <DoneBanner text={`Quote saved · ${formatMoney(total)} AED total`} />
                    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-3" style={{ background: CHIP_BG }}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold" style={{ color: INK }}>{quoteNo || 'Quotation'}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: '#DBEAFE', color: '#1D4ED8' }}>sent</span>
                        </div>
                        <span className="text-sm font-bold" style={{ color: PURPLE }}>{formatMoney(total)} AED</span>
                      </div>
                      {/* Body */}
                      <div className="px-4 py-3 space-y-1">
                        {unitRows.map((u) => {
                          const d = Math.round((new Date(u.endDate).getTime() - new Date(u.startDate).getTime()) / 86400000)
                          const tw = Math.ceil(d / 7)
                          const durLabel = `${tw} week${tw !== 1 ? 's' : ''}`
                          const discounted = u.rate - (u.rate * u.discountPct) / 100
                          const weeklyRate = discounted / 4
                          const periodTotal = calcUnitPeriodTotal(u.rate, u.discountPct, u.startDate, u.endDate)
                          return (
                            <div key={u.unitId} className="py-1">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold" style={{ color: INK }}>{u.unitNumber}</span>
                                <span className="text-xs font-bold" style={{ color: PURPLE }}>{formatMoney(periodTotal)} AED</span>
                              </div>
                              <p className="text-[10px]" style={{ color: MUTED }}>
                                {formatMoney(weeklyRate)} AED/wk × {durLabel}
                              </p>
                            </div>
                          )
                        })}
                        {addOnRows.filter((a) => a.name).map((a, i) => (
                          <InfoRow key={i} label={`${a.name} ×${a.quantity}`} value={`${formatMoney(a.quantity * a.rate)} AED`} />
                        ))}
                        <div style={{ borderTop: `1px solid ${PURPLE}20` }} className="mt-1 pt-1">
                          <InfoRow label="Total" value={`${formatMoney(total)} AED`} />
                        </div>
                      </div>
                      {/* Action bar */}
                      <div className="flex items-center gap-px border-t" style={{ borderColor: 'rgba(20,8,31,0.06)' }}>
                        <button
                          type="button"
                          onClick={() => sendQuote.mutate('whatsapp')}
                          disabled={sendQuote.isPending}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                          style={{ color: '#25D366' }}
                        >
                          <Send size={13} /> WhatsApp
                        </button>
                        <button
                          type="button"
                          onClick={() => sendQuote.mutate('email')}
                          disabled={sendQuote.isPending}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                          style={{ color: '#3B82F6' }}
                        >
                          <Mail size={13} /> Email
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadQuote.mutate()}
                          disabled={downloadQuote.isPending}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                          style={{ color: MUTED }}
                        >
                          <Download size={13} /> PDF
                        </button>
                      </div>
                    </div>
                    {sentMsg && <DoneBanner text={sentMsg} />}
                    {quoteEmailSent && <DoneBanner text={quoteEmailSent} />}
                  </>
                ) : (
                  <>
                    {/* Selected units summary */}
                    <div className="p-4 rounded-xl" style={{ background: CHIP_BG }}>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: PURPLE }}>Units ({unitRows.length})</p>
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg"
                          style={{ color: PURPLE, background: '#fff' }}
                        >
                          Edit units
                        </button>
                      </div>
                      {unitRows.map((u) => {
                        const d = Math.round((new Date(u.endDate).getTime() - new Date(u.startDate).getTime()) / 86400000)
                        const tw = Math.ceil(d / 7)
                        const durLabel2 = `${tw} week${tw !== 1 ? 's' : ''}`
                        const discounted = u.rate - (u.rate * u.discountPct) / 100
                        const weeklyRate = discounted / 4
                        const periodTotal = calcUnitPeriodTotal(u.rate, u.discountPct, u.startDate, u.endDate)
                        return (
                          <div key={u.unitId} className="py-1.5" style={{ borderBottom: `1px solid rgba(20,8,31,0.06)` }}>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold" style={{ color: INK }}>{u.unitNumber}</span>
                              <span className="text-xs font-bold" style={{ color: PURPLE }}>{formatMoney(periodTotal)} AED</span>
                            </div>
                            <p className="text-[11px] mt-0.5" style={{ color: MUTED }}>
                              {u.startDate} → {u.endDate} · {d} days · {durLabel2}
                            </p>
                            <p className="text-[11px]" style={{ color: MUTED }}>
                              Rate: {formatMoney(weeklyRate)} AED/wk × {durLabel2}
                              {u.discountPct ? ` · ${u.discountPct}% off` : ''}
                            </p>
                          </div>
                        )
                      })}
                    </div>

                    {/* Add-ons */}
                    <div className="space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: PURPLE }}>Add-ons (optional)</p>
                      <div className="flex flex-wrap gap-2">
                        {DEFAULT_ADDONS.map((preset) => (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() => addAddOn(preset)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                            style={{ background: `${PURPLE}10`, color: PURPLE }}
                          >
                            <Plus size={12} /> {preset.name} ({formatMoney(preset.rate)} AED)
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => addAddOn()}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border"
                          style={{ color: MUTED, borderColor: 'rgba(20,8,31,0.12)' }}
                        >
                          <Plus size={12} /> Custom
                        </button>
                      </div>
                      {addOnRows.map((a, idx) => (
                        <div key={idx} className="rounded-xl border p-3" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                            <Field label="Name">
                              <Input value={a.name} onChange={(e) => updateAddOn(idx, 'name', e.target.value)} className="h-8 text-xs" />
                            </Field>
                            <Field label="Description">
                              <Input value={a.description} onChange={(e) => updateAddOn(idx, 'description', e.target.value)} className="h-8 text-xs" />
                            </Field>
                            <Field label="Qty">
                              <Input type="number" min={1} value={a.quantity || ''} placeholder="1" onChange={(e) => updateAddOn(idx, 'quantity', Number(e.target.value) || 0)} className="h-8 text-xs" />
                            </Field>
                            <Field label="Rate">
                              <Input type="number" min={0} value={a.rate || ''} placeholder="0" onChange={(e) => updateAddOn(idx, 'rate', Number(e.target.value) || 0)} className="h-8 text-xs" />
                            </Field>
                            <div className="flex items-center justify-between pb-1.5">
                              <span className="text-xs font-bold" style={{ color: INK }}>{formatMoney(a.quantity * a.rate)} AED</span>
                              <button type="button" onClick={() => removeAddOn(idx)} className="text-red-500 hover:text-red-600 ml-2">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Notes */}
                    <Field label="Notes">
                      <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes…" />
                    </Field>

                    <div className="p-4 rounded-xl border" style={{ borderColor: `${PURPLE}30`, background: `${PURPLE}05` }}>
                      <InfoRow label={`Units (${unitRows.length})`} value={`${formatMoney(unitsTotal)} AED`} />
                      <InfoRow label={`Add-ons (${addOnRows.length})`} value={`${formatMoney(addOnsTotal)} AED`} />
                      {holdAdvance ? (
                        <InfoRow
                          label={advanceExtra > 0 ? 'Refundable advance (held)' : 'Advance rent — adjusted against the final period'}
                          value={
                            <span className="inline-flex items-center gap-2">
                              {advanceExtra > 0 ? `${formatMoney(advanceExtra)} AED` : `${formatMoney(advanceTotal)} AED · included`}
                              <button type="button" title="Remove the held advance from this quote" disabled={patchQuote.isPending}
                                onClick={() => { setHoldAdvance(false); if (quoteId) patchQuote.mutate({ holdAdvance: false }) }}
                                className="text-destructive font-bold cursor-pointer leading-none disabled:opacity-50">×</button>
                            </span>
                          }
                        />
                      ) : (
                        <div className="flex items-center justify-between text-[12px] py-1" style={{ color: MUTED }}>
                          <span>Refundable advance removed for this quote</span>
                          <button type="button" disabled={patchQuote.isPending}
                            onClick={() => { setHoldAdvance(true); if (quoteId) patchQuote.mutate({ holdAdvance: true }) }}
                            className="font-bold cursor-pointer disabled:opacity-50" style={{ color: PURPLE }}>+ Add back</button>
                        </div>
                      )}
                      {Number(deposit) > 0 ? (
                        <InfoRow
                          label="Security deposit"
                          value={
                            <span className="inline-flex items-center gap-2">
                              {formatMoney(Number(deposit))} AED
                              <button type="button" title="Remove the security deposit from this quote" disabled={patchQuote.isPending}
                                onClick={() => { removedDepositRef.current = deposit; setDeposit(''); if (quoteId) patchQuote.mutate({ deposit: 0 }) }}
                                className="text-destructive font-bold cursor-pointer leading-none disabled:opacity-50">×</button>
                            </span>
                          }
                        />
                      ) : removedDepositRef.current && (
                        <div className="flex items-center justify-between text-[12px] py-1" style={{ color: MUTED }}>
                          <span>Security deposit removed for this quote</span>
                          <button type="button" disabled={patchQuote.isPending}
                            onClick={() => {
                              const restored = removedDepositRef.current
                              setDeposit(restored); removedDepositRef.current = ''
                              if (quoteId) patchQuote.mutate({ deposit: Number(restored) || 0 })
                            }}
                            className="font-bold cursor-pointer disabled:opacity-50" style={{ color: PURPLE }}>+ Add back</button>
                        </div>
                      )}
                      <div style={{ borderTop: `1px solid ${PURPLE}20` }} className="mt-1 pt-1">
                        <div className="flex items-center justify-between text-base py-1">
                          <span className="font-bold" style={{ color: INK }}>Total</span>
                          <span className="font-bold" style={{ color: PURPLE }}>{formatMoney(total)} AED</span>
                        </div>
                      </div>
                    </div>

                    {/* Share bar — visible after Save Quote & Send */}
                    {showShareBar && (
                      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                        <div className="px-4 py-3" style={{ background: CHIP_BG }}>
                          <p className="text-sm font-bold" style={{ color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>
                            Share quotation
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                            Delivers the PDF to {customerName || 'the customer'}.
                          </p>
                        </div>
                        <div className="flex items-center gap-px border-t" style={{ borderColor: 'rgba(20,8,31,0.06)' }}>
                          <button
                            type="button"
                            onClick={() => { if (validateQuote()) sendQuote.mutate('whatsapp') }}
                            disabled={sendQuote.isPending}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                            style={{ color: '#25D366' }}
                          >
                            {sendQuote.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} WhatsApp
                          </button>
                          <button
                            type="button"
                            onClick={() => { if (validateQuote()) sendQuote.mutate('email') }}
                            disabled={sendQuote.isPending}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                            style={{ color: '#3B82F6' }}
                          >
                            {sendQuote.isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Email
                          </button>
                          <button
                            type="button"
                            onClick={() => { if (validateQuote()) downloadQuote.mutate() }}
                            disabled={downloadQuote.isPending}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                            style={{ color: MUTED }}
                          >
                            {downloadQuote.isPending ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} PDF
                          </button>
                        </div>
                        {sentMsg && <DoneBanner text={sentMsg} />}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Step 4: Contract ── */}
            {step === 3 && (
              <div className="space-y-5">
                <SectionTitle title="Contract" subtitle="Create the contract from the quotation — terms are locked from the quote" />

                {!contract ? (
                  <>
                    <div className="p-4 rounded-xl" style={{ background: CHIP_BG }}>
                      <InfoRow label="Customer" value={customerName} />
                      <InfoRow label="Period" value={`${dateRangeFrom} → ${dateRangeTo}`} />
                      <InfoRow label="Units" value={unitRows.map((u) => u.unitNumber).join(', ')} />
                      <InfoRow label={`Total (${dateRangeFrom && dateRangeTo ? Math.ceil(Math.round((new Date(dateRangeTo).getTime() - new Date(dateRangeFrom).getTime()) / 86400000) / 7) : 0} weeks)`} value={`${formatMoney(total)} AED`} />
                      {Number(deposit) > 0 && <InfoRow label="Deposit" value={`${formatMoney(Number(deposit))} AED`} />}
                    </div>

                    {/* Customer documents upload */}
                    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: PURPLE }}>Customer Documents</p>
                        <div className="flex items-center gap-2">
                          <select
                            value={docType}
                            onChange={(e) => setDocType(e.target.value)}
                            className="h-7 rounded-lg border px-2 text-xs font-medium cursor-pointer"
                            style={{ borderColor: 'rgba(20,8,31,0.12)', color: INK, background: '#fff' }}
                            title="Upload type"
                          >
                            <option value="emirates_id">Emirates ID</option>
                            <option value="passport">Passport</option>
                            <option value="visa">Visa</option>
                            <option value="trade_license">Trade License</option>
                            <option value="other">Other</option>
                          </select>
                          <input
                            ref={docInputRef}
                            type="file"
                            multiple
                            accept=".pdf,.jpg,.jpeg,.png,.webp"
                            className="hidden"
                            onChange={(e) => handleDocUpload(e.target.files, docType)}
                          />
                          <button
                            type="button"
                            onClick={() => docInputRef.current?.click()}
                            disabled={uploadingDoc}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-60"
                            style={{ background: `${PURPLE}10`, color: PURPLE }}
                          >
                            {uploadingDoc ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Upload
                          </button>
                        </div>
                      </div>
                      <p className="text-xs" style={{ color: MUTED }}>
                        Upload customer Emirates ID, passport, or other documents. These are required before creating a contract.
                      </p>
                      {customerDocs.length > 0 ? (
                        <div className="space-y-1.5">
                          {customerDocs.map((doc) => (
                            <div key={doc._id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: CHIP_BG }}>
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText size={14} style={{ color: PURPLE, flexShrink: 0 }} />
                                <span className="text-xs font-medium truncate" style={{ color: INK }}>{doc.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{
                                  background: ID_DOC_TYPES.includes(doc.type) ? '#DBEAFE' : `${PURPLE}15`,
                                  color: ID_DOC_TYPES.includes(doc.type) ? '#1D4ED8' : PURPLE,
                                }}>{DOC_TYPE_LABELS[doc.type] ?? doc.type}</span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <a
                                  href={doc.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1 rounded hover:bg-white transition-colors"
                                  style={{ color: MUTED }}
                                >
                                  <Eye size={13} />
                                </a>
                                <button
                                  type="button"
                                  onClick={() => removeDoc(doc._id)}
                                  className="p-1 rounded hover:bg-white transition-colors text-red-400 hover:text-red-600"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div
                          onClick={() => docInputRef.current?.click()}
                          className="flex flex-col items-center justify-center py-6 rounded-xl border-2 border-dashed cursor-pointer hover:border-purple-300 transition-colors"
                          style={{ borderColor: 'rgba(20,8,31,0.12)' }}
                        >
                          <Upload size={20} style={{ color: MUTED }} />
                          <p className="text-xs mt-1.5 font-medium" style={{ color: MUTED }}>Click to upload Emirates ID / Passport</p>
                          <p className="text-[10px] mt-0.5" style={{ color: MUTED }}>PDF, JPG, PNG up to 15 MB</p>
                        </div>
                      )}
                    </div>

                    {/* Authorized persons */}
                    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: PURPLE }}>
                          Authorized persons ({authorizedPersons.length})
                        </p>
                        <button
                          type="button"
                          onClick={addPerson}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
                          style={{ background: `${PURPLE}10`, color: PURPLE }}
                        >
                          <Plus size={12} /> Add person
                        </button>
                      </div>
                      {authorizedPersons.length === 0 && (
                        <p className="text-xs" style={{ color: MUTED }}>
                          No authorized persons — only the customer can access the unit. Add family members or staff who may also access it.
                        </p>
                      )}
                      {authorizedPersons.map((p, idx) => (
                        <div key={idx} className="rounded-xl border p-3" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                            <Field label="Name">
                              <Input value={p.name} onChange={(e) => updatePerson(idx, 'name', e.target.value)} className="h-8 text-xs" placeholder="Full name" />
                            </Field>
                            <Field label="Phone">
                              <Input value={p.phone || ''} onChange={(e) => updatePerson(idx, 'phone', e.target.value)} className="h-8 text-xs" placeholder="+971…" />
                            </Field>
                            <Field label="Relation">
                              <Input value={p.relation || ''} onChange={(e) => updatePerson(idx, 'relation', e.target.value)} className="h-8 text-xs" placeholder="e.g. Spouse, Staff" />
                            </Field>
                            <Field label="ID Type">
                              <Select value={p.idType || ''} onChange={(e) => updatePerson(idx, 'idType', e.target.value)} className="h-8 text-xs">
                                <option value="">—</option>
                                <option value="Emirates ID">Emirates ID</option>
                                <option value="Passport">Passport</option>
                              </Select>
                            </Field>
                            <div className="flex items-end gap-1.5">
                              <Field label="ID Number" className="flex-1">
                                <Input value={p.idNumber || ''} onChange={(e) => updatePerson(idx, 'idNumber', e.target.value)} className="h-8 text-xs" />
                              </Field>
                              <button type="button" onClick={() => removePerson(idx)} className="text-red-500 hover:text-red-600 pb-2">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => createContract.mutate()}
                        disabled={createContract.isPending || !customerDocs.some((d) => ID_DOC_TYPES.includes(d.type))}
                        className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                        style={{ background: PURPLE, cursor: customerDocs.some((d) => ID_DOC_TYPES.includes(d.type)) && !createContract.isPending ? 'pointer' : 'not-allowed' }}
                      >
                        {createContract.isPending ? <Loader2 size={15} className="animate-spin" /> : <Briefcase size={15} />}
                        {createContract.isPending ? 'Creating…' : 'Create Contract'}
                      </button>
                    </div>
                    {!customerDocs.some((d) => ID_DOC_TYPES.includes(d.type)) && (
                      <p className="text-xs font-medium" style={{ color: '#B91C1C' }}>
                        Upload an Emirates ID or passport above before creating the contract.
                      </p>
                    )}
                    <p className="text-xs" style={{ color: MUTED }}>
                      Creates a draft contract with the options above and auto-generates the first invoice.
                    </p>
                  </>
                ) : (
                  <>
                    <DoneBanner text={`Contract ${contract.contractNo} created`} />
                    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-3" style={{ background: CHIP_BG }}>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold" style={{ color: INK }}>{contract.contractNo}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{
                            background: contract.status === 'active' ? '#D1FAE5' : contract.status === 'cancelled' ? '#FEE2E2' : '#DBEAFE',
                            color: contract.status === 'active' ? GREEN : contract.status === 'cancelled' ? '#B91C1C' : '#1D4ED8',
                          }}>{contract.status.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold" style={{ color: PURPLE }}>{formatMoney(total)} AED / {dateRangeFrom && dateRangeTo ? Math.ceil(Math.round((new Date(dateRangeTo).getTime() - new Date(dateRangeFrom).getTime()) / 86400000) / 7) : 0} weeks</span>
                          <button type="button" onClick={() => navigate(`/contracts/${contract._id}`)}
                            className="text-xs font-semibold hover:underline cursor-pointer" style={{ color: PURPLE }}>
                            Open contract →
                          </button>
                        </div>
                      </div>
                      {/* Body */}
                      <div className="px-4 py-3 space-y-1">
                        <InfoRow label="Term" value={`${formatDate(contract.startDate)} → ${formatDate(contract.endDate)}`} />
                        {paymentMethod && <InfoRow label="Payment" value={paymentMethod.replace(/_/g, ' ')} />}
                        {authorizedPersons.length > 0 && <InfoRow label="Authorized persons" value={authorizedPersons.map((p) => p.name).filter(Boolean).join(', ') || `${authorizedPersons.length}`} />}
                      </div>
                    </div>

                    {signingLink && (
                      <div className="p-3 rounded-xl space-y-2" style={{ background: CHIP_BG }}>
                        <p className="text-xs font-bold uppercase tracking-wider" style={{ color: PURPLE }}>Signing link (valid 7 days)</p>
                        <p className="text-xs break-all" style={{ color: INK }}>{signingLink}</p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard.writeText(signingLink); setLinkCopied(true) }}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium border hover:bg-gray-50"
                            style={{ color: INK, borderColor: 'rgba(20,8,31,0.15)' }}
                          >
                            {linkCopied ? 'Copied!' : 'Copy link'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const phone = customerPhone.replace(/\D/g, '').replace(/^00/, '')
                              const msg = `Hello ${customerName},\n\nPlease review and sign your storage contract ${contract.contractNo}:\n${signingLink}\n\nThank you — PurpleBox`
                              window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white"
                            style={{ background: '#25D366' }}
                          >
                            Send via WhatsApp
                          </button>
                        </div>
                      </div>
                    )}

                    {contract.status === 'cancelled' && (
                      <div className="p-3 rounded-xl text-sm" style={{ background: '#FEE2E2', color: '#B91C1C' }}>
                        This contract was cancelled. Edit the quotation and create a new contract if needed.
                      </div>
                    )}

                    {/* Contract options — authorized persons stay editable after booking
                        (the server allows only admins to change an active contract) */}
                    {(
                      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold" style={{ color: INK }}>
                            Authorized persons ({authorizedPersons.length})
                          </p>
                          <button
                            type="button"
                            onClick={addPerson}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium"
                            style={{ background: `${PURPLE}10`, color: PURPLE }}
                          >
                            <Plus size={12} /> Add person
                          </button>
                        </div>
                        {authorizedPersons.length === 0 && (
                          <p className="text-xs" style={{ color: MUTED }}>
                            No authorized persons — only the customer can access the unit.
                          </p>
                        )}
                        {authorizedPersons.map((p, idx) => (
                          <div key={idx} className="rounded-xl border p-3" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                              <Field label="Name">
                                <Input value={p.name} onChange={(e) => updatePerson(idx, 'name', e.target.value)} className="h-8 text-xs" placeholder="Full name" />
                              </Field>
                              <Field label="Phone">
                                <Input value={p.phone || ''} onChange={(e) => updatePerson(idx, 'phone', e.target.value)} className="h-8 text-xs" placeholder="+971…" />
                              </Field>
                              <Field label="Relation">
                                <Input value={p.relation || ''} onChange={(e) => updatePerson(idx, 'relation', e.target.value)} className="h-8 text-xs" placeholder="e.g. Spouse, Staff" />
                              </Field>
                              <Field label="ID Type">
                                <Select value={p.idType || ''} onChange={(e) => updatePerson(idx, 'idType', e.target.value)} className="h-8 text-xs">
                                  <option value="">—</option>
                                  <option value="Emirates ID">Emirates ID</option>
                                  <option value="Passport">Passport</option>
                                </Select>
                              </Field>
                              <div className="flex items-end gap-1.5">
                                <Field label="ID Number" className="flex-1">
                                  <Input value={p.idNumber || ''} onChange={(e) => updatePerson(idx, 'idNumber', e.target.value)} className="h-8 text-xs" />
                                </Field>
                                <button type="button" onClick={() => removePerson(idx)} className="text-red-500 hover:text-red-600 pb-2">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}

                        <div className="max-w-xs">
                          <Field label="Access Type">
                            <Select value={accessType} onChange={(e) => setAccessType(e.target.value)} className="h-8 text-xs">
                              <option value="">Auto (from units)</option>
                              <option value="private">Private</option>
                              <option value="shared">Shared</option>
                            </Select>
                          </Field>
                        </div>

                        <button
                          type="button"
                          onClick={() => saveContractOptions.mutate()}
                          disabled={saveContractOptions.isPending}
                          className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                          style={{ background: PURPLE }}
                        >
                          {saveContractOptions.isPending ? 'Saving…' : 'Save Contract Options'}
                        </button>
                        {sentMsg === 'Contract options saved' && <DoneBanner text={sentMsg} />}
                      </div>
                    )}

                    {/* Action bar — signing works for active contracts too (re-sign, admin) */}
                    {['draft', 'pending_signature', 'active'].includes(contract.status) && (
                      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                        <div className="flex items-center gap-px" style={{ background: '#fff' }}>
                          <button
                            type="button"
                            onClick={async () => {
                              setAgreementOpen(true)
                              setAgreementBusy('load')
                              try {
                                const r = await api.get(`/contracts/${contractId}/agreement`)
                                const text = r.data?.text || ''
                                requestAnimationFrame(() => {
                                  if (agreementEditRef.current) {
                                    agreementEditRef.current.innerHTML = /<\w+[^>]*>/.test(text)
                                      ? text
                                      : text.split('\n').map((l: string) => `<p>${l || '<br>'}</p>`).join('')
                                  }
                                })
                              } catch (e) { setErr(apiError(e)) } finally { setAgreementBusy('') }
                            }}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors"
                            style={{ color: PURPLE }}
                          >
                            <FileText size={13} /> Agreement
                          </button>
                          <button
                            type="button"
                            onClick={() => setSigningOpen(true)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors"
                            style={{ color: INK }}
                          >
                            <FileText size={13} /> Sign
                          </button>
                          <button
                            type="button"
                            onClick={() => createSigningLink.mutate()}
                            disabled={createSigningLink.isPending}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                            style={{ color: '#3B82F6' }}
                          >
                            {createSigningLink.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {contract.status === 'active' ? 'Re-send for signing' : 'Send link'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { if (confirm('Cancel this contract?')) cancelContract.mutate() }}
                            disabled={cancelContract.isPending}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold hover:bg-gray-50 transition-colors disabled:opacity-60"
                            style={{ color: '#DC2626' }}
                          >
                            <Trash2 size={13} /> Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Step 5: Invoice ── */}
            {step === 4 && (
              <div className="space-y-5">
                <SectionTitle title="Invoices" subtitle="Invoices are raised in Zoho Books — this shows what is already billed to this tenant" />

                {!contract ? (
                  <div className="text-sm text-center py-8 rounded-xl" style={{ background: CHIP_BG, color: MUTED }}>
                    Create the contract first, then raise its invoice in Zoho Books.
                  </div>
                ) : (
                  <InvoiceStep
                    contract={contract}
                    invoices={flowData?.invoices || []}
                    customerId={customerId}
                    customerName={customerName}
                    customerPhone={customerPhone}
                    customerEmail={customerEmail}
                    onChanged={() => qc.invalidateQueries({ queryKey: ['flow-contract'] })}
                    handleRef={invoiceHandleRef}
                  />
                )}

                {/* Approval status */}
                {approvalStatus === 'pending' && (
                  <div className="flex items-center gap-3 p-4 rounded-xl" style={{ background: '#EDE9FE' }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${PURPLE}20` }}>
                      <ShieldCheck size={18} style={{ color: PURPLE }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: INK }}>Sent for admin approval</p>
                      <p className="text-xs" style={{ color: MUTED }}>Waiting for an admin to review and approve this booking.</p>
                    </div>
                  </div>
                )}
                {approvalStatus === 'approved' && (
                  <div className="flex flex-col items-center py-8 gap-3">
                    <div style={{ width: 64, height: 64, borderRadius: 20, background: '#D1FAE5', display: 'grid', placeItems: 'center' }}>
                      <CheckCircle2 size={32} style={{ color: GREEN }} />
                    </div>
                    <p className="text-sm font-bold" style={{ color: GREEN }}>Approved — contract is ready for activation</p>
                  </div>
                )}
                {approvalStatus === 'rejected' && (
                  <div className="p-3 rounded-xl text-sm" style={{ background: '#FEE2E2', color: '#B91C1C' }}>
                    Rejected{contract?.approvalNote ? `: ${contract.approvalNote}` : ''}
                  </div>
                )}
              </div>
            )}

            {err && (
              <p className="mt-4 text-sm px-3 py-2 rounded-lg" style={{ color: '#b91c1c', background: '#fef2f2' }}>
                {err}
              </p>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 pt-5" style={{ borderTop: '1px solid rgba(20,8,31,0.06)' }}>
              <div>
                {step > 0 ? (
                  <button type="button" onClick={() => setStep((s) => s - 1)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ color: MUTED }}>
                    <ChevronLeft size={16} /> Back
                  </button>
                ) : (
                  <button type="button" onClick={() => navigate(-1)} className="px-4 py-2 rounded-xl text-sm font-medium hover:bg-gray-50" style={{ color: MUTED }}>
                    Cancel
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-medium hidden sm:block" style={{ color: MUTED }}>
                  Step {step + 1} of {STEPS.length}
                </span>

                {step === 0 && (
                  <button
                    type="button"
                    onClick={() => { if (!customerId) { setErr('Please select a customer'); return } setStep(1) }}
                    className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90"
                    style={{ background: PURPLE }}
                  >
                    Next <ChevronRight size={16} />
                  </button>
                )}
                {step === 1 && (
                  <button
                    type="button"
                    onClick={() => { if (quoteLocked || validateUnits()) setStep(2) }}
                    className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90"
                    style={{ background: PURPLE }}
                  >
                    Next <ChevronRight size={16} />
                  </button>
                )}
                {step === 2 && (
                  quoteLocked ? (
                    <button type="button" onClick={() => setStep(3)} className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90" style={{ background: PURPLE }}>
                      Next <ChevronRight size={16} />
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { if (validateQuote()) saveQuote.mutate() }}
                        disabled={saveQuote.isPending}
                        className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold border hover:opacity-90 disabled:opacity-60"
                        style={{ borderColor: PURPLE, color: PURPLE }}
                      >
                        {saveQuote.isPending ? 'Saving…' : 'Save Quote & Send'}
                      </button>
                      <button
                        type="button"
                        disabled={!quoteId}
                        onClick={() => setStep(3)}
                        className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40"
                        style={{ background: PURPLE, cursor: quoteId ? 'pointer' : 'not-allowed' }}
                      >
                        Continue <ChevronRight size={16} />
                      </button>
                    </div>
                  )
                )}
                {step >= 3 && step < STEPS.length - 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setStep((s) => s + 1)}
                      disabled={step === 3 && !contractId}
                      className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90"
                      style={{ background: PURPLE }}
                    >
                      Next <ChevronRight size={16} />
                    </button>
                  </div>
                )}
                {step === STEPS.length - 1 && (
                  approvalStatus === 'pending' || approvalStatus === 'approved' ? (
                    <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: approvalStatus === 'approved' ? GREEN : MUTED }}>
                      <ShieldCheck size={16} />
                      {approvalStatus === 'approved' ? 'Approved' : 'Sent for approval'}
                    </div>
                  ) : (
                    (() => {
                      const allInvoices = flowData?.invoices || []
                      const invoiceSent = allInvoices.some(i => i.status !== 'draft')
                      const hasPayment = paidTotal > 0
                      const hasReceipt = allInvoices.some(i => (i.attachments?.length || 0) > 0)
                      const canApprove = invoiceSent && hasPayment && hasReceipt
                      const reasons: string[] = []
                      if (!invoiceSent) reasons.push('Mark invoice as Sent')
                      if (!hasPayment) reasons.push('Record a payment')
                      if (!hasReceipt) reasons.push('Upload payment receipt')
                      return (
                        <div className="space-y-2">
                          {!canApprove && (
                            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                              <p className="font-semibold mb-1">Before sending for approval:</p>
                              <ul className="list-disc pl-4 space-y-0.5">
                                {reasons.map(r => <li key={r}>{r}</li>)}
                              </ul>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => sendForApproval.mutate()}
                            disabled={sendForApproval.isPending || !contractId || !canApprove}
                            className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90"
                            style={{ background: GREEN }}
                          >
                            {sendForApproval.isPending ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                            {sendForApproval.isPending ? 'Sending…' : 'Send for Approval'}
                          </button>
                        </div>
                      )
                    })()
                  )
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Booking details tooltip (hover on rented/booked units) */}
        {hoverUnit && (hoverUnit.unit.bookings?.length ?? 0) > 0 && (
          <div
            className="pointer-events-none"
            style={{
              position: 'fixed',
              left: Math.min(hoverUnit.x + 14, window.innerWidth - 300),
              top: Math.min(hoverUnit.y + 14, window.innerHeight - 160),
              zIndex: 60,
              width: 280,
              background: INK,
              color: '#fff',
              borderRadius: 12,
              padding: '0.75rem 0.875rem',
              boxShadow: '0 8px 24px rgba(20,8,31,0.35)',
            }}
          >
            <p className="text-xs font-bold mb-2" style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}>
              {hoverUnit.unit.unitNumber} — booking details
            </p>
            <div className="space-y-2">
              {(hoverUnit.unit.bookings || []).slice(0, 4).map((b, i) => (
                <div key={i} className="text-[11px] leading-snug">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide shrink-0"
                      style={{
                        background: b.kind === 'quote' ? '#3B82F6' : b.kind === 'current' ? '#6B7280' : '#EF4444',
                        color: '#fff',
                      }}
                    >
                      {b.kind === 'quote' ? 'Quote' : b.kind === 'current' ? 'Current' : 'Contract'}
                    </span>
                    <span className="font-semibold truncate">{b.ref}</span>
                  </div>
                  <p className="mt-0.5 opacity-90">{b.customer || 'Unknown customer'}</p>
                  {b.startDate && b.endDate && (
                    <p className="opacity-70">{formatDate(b.startDate)} → {formatDate(b.endDate)}</p>
                  )}
                </div>
              ))}
              {(hoverUnit.unit.bookings || []).length > 4 && (
                <p className="text-[10px] opacity-60">+{(hoverUnit.unit.bookings || []).length - 4} more</p>
              )}
            </div>
          </div>
        )}

          {/* Agreement view/edit — same document the tenant signs */}
      {agreementOpen && contract && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/25" onClick={() => setAgreementOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white shadow-xl overflow-y-auto flex flex-col">
            <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-base font-bold" style={{ color: INK }}>Agreement — {contract.contractNo}</h2>
                <p className="text-[11px]" style={{ color: MUTED }}>Prefilled from the template — edit freely; the tenant signs exactly this.</p>
              </div>
              <button onClick={() => setAgreementOpen(false)} className="p-1 rounded hover:bg-gray-100 cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-5 flex-1 flex flex-col gap-3">
              {agreementBusy === 'load' && <p className="text-xs" style={{ color: MUTED }}>Loading…</p>}
              <div
                ref={agreementEditRef}
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                className="agreement-editor w-full flex-1 rounded-lg border bg-white p-6 text-[13px] leading-relaxed outline-none"
                style={{ minHeight: 460, overflowY: 'auto', borderColor: 'rgba(20,8,31,0.12)' }}
              />
              <style>{`
                .agreement-editor table { border-collapse: collapse; width: 100%; margin: 8px 0; }
                .agreement-editor td, .agreement-editor th { border: 1px solid #bbb; padding: 5px 8px; font-size: 12.5px; }
                .agreement-editor h1 { font-size: 19px; font-weight: 700; margin: 12px 0 6px; }
                .agreement-editor h2 { font-size: 15px; font-weight: 700; margin: 10px 0 5px; }
                .agreement-editor h3 { font-size: 13.5px; font-weight: 700; margin: 8px 0 4px; }
                .agreement-editor p { margin: 6px 0; }
                .agreement-editor ul, .agreement-editor ol { padding-left: 22px; margin: 6px 0; }
              `}</style>
              <div className="flex justify-end gap-2 pt-2 border-t flex-wrap">
                <button type="button" disabled={agreementBusy === 'pdf'}
                  onClick={async () => {
                    setAgreementBusy('pdf')
                    try {
                      await api.put(`/contracts/${contractId}`, { agreementText: agreementEditRef.current?.innerHTML ?? '' })
                      const r = await api.get(`/contracts/${contractId}/pdf`, { responseType: 'blob' })
                      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }))
                      window.open(url, '_blank')
                      setTimeout(() => URL.revokeObjectURL(url), 60_000)
                    } catch (e) { setErr(apiError(e)) } finally { setAgreementBusy('') }
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border hover:bg-gray-50 disabled:opacity-60"
                  style={{ color: INK, borderColor: 'rgba(20,8,31,0.15)' }}>
                  {agreementBusy === 'pdf' ? 'Preparing…' : 'Save & preview PDF'}
                </button>
                <button type="button" disabled={agreementBusy === 'save'}
                  onClick={async () => {
                    setAgreementBusy('save')
                    try {
                      await api.put(`/contracts/${contractId}`, { agreementText: agreementEditRef.current?.innerHTML ?? '' })
                      qc.invalidateQueries({ queryKey: ['flow-contract'] })
                      setAgreementOpen(false)
                    } catch (e) { setErr(apiError(e)) } finally { setAgreementBusy('') }
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold border hover:bg-gray-50 disabled:opacity-60"
                  style={{ color: INK, borderColor: 'rgba(20,8,31,0.15)' }}>
                  {agreementBusy === 'save' ? 'Saving…' : 'Save'}
                </button>
                <button type="button" disabled={agreementBusy === 'sign'}
                  onClick={async () => {
                    setAgreementBusy('sign')
                    try {
                      await api.put(`/contracts/${contractId}`, { agreementText: agreementEditRef.current?.innerHTML ?? '' })
                      await createSigningLink.mutateAsync()
                      qc.invalidateQueries({ queryKey: ['flow-contract'] })
                      setAgreementOpen(false)
                    } catch (e) { setErr(apiError(e)) } finally { setAgreementBusy('') }
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-60"
                  style={{ background: PURPLE }}>
                  {agreementBusy === 'sign' ? 'Preparing…' : 'Save & send for signing'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

        {/* Sign in person */}
        <Modal open={signingOpen} onClose={() => setSigningOpen(false)} title="Sign contract in person" wide>
      {contract && (
            <SignInPersonModal
              contractNo={contract.contractNo}
              customerName={customerName}
              busy={signInPerson.isPending}
              error={err}
              onSign={(body) => signInPerson.mutate(body)}
              onClose={() => setSigningOpen(false)}
            />
          )}
        </Modal>

        {/* Create Customer Modal */}
        <Modal open={showCustomerModal} title="Create New Customer" onClose={() => setShowCustomerModal(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              createCustomerMut.mutate({
                fullName: String(f.get('fullName') || ''),
                phone: String(f.get('phone') || ''),
                email: String(f.get('email') || ''),
                tenantType: String(f.get('tenantType') || 'individual'),
                address: String(f.get('address') || ''),
                notes: String(f.get('notes') || ''),
              })
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Full Name"><Input name="fullName" defaultValue={lead?.fullName || ''} required /></Field>
              <Field label="Type">
                <Select name="tenantType" defaultValue="individual">
                  <option value="individual">Individual</option>
                  <option value="company">Company</option>
                </Select>
              </Field>
              <Field label="Phone"><Input name="phone" defaultValue={lead?.phone || ''} /></Field>
              <Field label="Email"><Input name="email" type="email" defaultValue={lead?.email || ''} /></Field>
              <Field label="Address" className="col-span-2"><Input name="address" /></Field>
              <Field label="Notes" className="col-span-2"><Textarea name="notes" rows={2} /></Field>
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={createCustomerMut.isPending}>
                {createCustomerMut.isPending ? 'Creating…' : 'Create & Select'}
              </Button>
            </div>
          </form>
        </Modal>

        {/* Quote email compose modal */}
        <Modal open={!!quoteEmailModal} onClose={() => setQuoteEmailModal(null)} title="Send Quote Email" wide>
          {quoteEmailModal && (
            <div className="space-y-4">
              <Field label="To">
                <Input
                  type="email"
                  value={quoteEmailModal.to}
                  onChange={(e) => setQuoteEmailModal({ ...quoteEmailModal, to: e.target.value })}
                  placeholder="customer@email.com"
                />
              </Field>
              <Field label="Subject">
                <Input
                  value={quoteEmailModal.subject}
                  onChange={(e) => setQuoteEmailModal({ ...quoteEmailModal, subject: e.target.value })}
                />
              </Field>
              <Field label="Body">
                <Textarea
                  value={quoteEmailModal.body}
                  onChange={(e) => setQuoteEmailModal({ ...quoteEmailModal, body: e.target.value })}
                  rows={8}
                />
              </Field>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: CHIP_BG }}>
                <FileText size={14} style={{ color: PURPLE }} />
                <span className="text-xs flex-1" style={{ color: INK }}>Quote PDF will be attached automatically</span>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'rgba(20,8,31,0.06)' }}>
                <button
                  type="button"
                  onClick={() => setQuoteEmailModal(null)}
                  disabled={quoteEmailSending}
                  className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity disabled:opacity-50"
                  style={{ color: INK, borderColor: 'rgba(20,8,31,0.15)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={quoteEmailSending || !quoteEmailModal.to}
                  onClick={async () => {
                    setQuoteEmailSending(true)
                    try {
                      const toAddr = quoteEmailModal.to
                      await api.post(`/quotes/${quoteId}/send-email`, {
                        to: toAddr,
                        subject: quoteEmailModal.subject,
                        body: quoteEmailModal.body,
                      })
                      setQuoteEmailModal(null)
                      setQuoteEmailSent(`Email sent to ${toAddr}`)
                      setErr('')
                    } catch (e: any) {
                      setErr(apiError(e))
                    } finally {
                      setQuoteEmailSending(false)
                    }
                  }}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  style={{ background: PURPLE }}
                >
                  {quoteEmailSending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : <><Send size={14} /> Send Email</>}
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  )
}

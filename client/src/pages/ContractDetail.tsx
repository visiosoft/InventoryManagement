import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, FileText, FilePlus, Mail, MessageSquare, PenLine, Pin, Plus, ShieldCheck, Trash2, Upload, X, XCircle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { AppDocument, Contract, Invoice, Payment, Unit, UnitLine } from '../lib/types'
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Field, Input, Modal, Select, Spinner,
  Textarea,
  contractStatusTone, statusLabel,
} from '../components/ui'
import { compareUnitNumbers, formatDate, formatMoney } from '../lib/utils'
import { UploadDocumentForm } from './Documents'
import { CustomerForm } from '../components/AddCustomerModal'

// ── Shared design tokens (match the rest of the CRM) ──────────────────────────
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const HAIRLINE = 'rgba(20,8,31,.10)'
const SECTION_LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: PURPLE,
  textTransform: 'uppercase', letterSpacing: '.04em',
}
const BOX: React.CSSProperties = { border: `1px solid ${HAIRLINE}`, borderRadius: 14 }
/** Titles offered for a free-form "other" document, mapped onto the server's type enum. */
const OTHER_DOC_TITLES: { label: string; type: AppDocument['type'] }[] = [
  { label: 'Tenancy Contract', type: 'other' },
  { label: 'Trade Licence', type: 'trade_license' },
  { label: 'Visa', type: 'visa' },
  { label: 'Cheque', type: 'other' },
  { label: 'Other', type: 'other' },
]

// ── Custom invoice generator modal ────────────────────────────────────────────
type ContractDetailData = {
  contract: Contract
  payments: Payment[]
  documents: AppDocument[]
  invoices?: Invoice[]
}

function GenerateInvoiceModal({ contract, payments, overrideStart, overrideEnd, blank, onDone }: {
  contract: Contract; payments: Payment[]
  overrideStart?: string; overrideEnd?: string
  /** Start with no line items — for a custom invoice rather than a period one */
  blank?: boolean
  onDone: () => void
}) {
  const weeklyRate = Math.round((Number(contract.rate || 0) / 4) * 100) / 100
  const unitNo = contract.unit?.unitNumber || (contract.units?.[0]?.unitNumber) || '—'

  const toISO = (d: Date) => d.toISOString().slice(0, 10)
  const today = new Date(); today.setHours(0, 0, 0, 0)

  const latestDueDate = payments.length > 0
    ? new Date(Math.max(...payments.map(p => new Date(p.dueDate).getTime())))
    : null
  const contractStart = new Date(contract.startDate)
  // Use contract start if the latest payment predates it (e.g. from a previous term)
  const nextStart = latestDueDate && latestDueDate >= contractStart
    ? new Date(latestDueDate.getTime() + 7 * 86400000)
    : contractStart
  const contractEnd = contract.endDate ? new Date(contract.endDate) : null
  const nextEnd28 = new Date(nextStart); nextEnd28.setDate(nextEnd28.getDate() + 28)
  const smartEnd = (() => {
    if (today > nextStart) return today
    if (contractEnd && contractEnd < nextEnd28) return contractEnd
    return nextEnd28
  })()

  const defaultStart = overrideStart ?? toISO(nextStart)
  const defaultEnd = overrideEnd ?? toISO(smartEnd)

  type LineItem = { id: number; description: string; qty: number; rate: number; amount: number; discountPct: number }
  const emptyItem = (): LineItem => ({ id: Date.now(), description: '', qty: 1, rate: 0, amount: 0, discountPct: 0 })

  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)
  const [dueDate, setDueDate] = useState(toISO(today))

  // Determine if first invoice — if so, include advance payment line
  const isFirstInvoice = payments.length === 0

  const buildDefaultItems = (): LineItem[] => {
    if (blank) return [{ id: 1, description: '', qty: 1, rate: 0, amount: 0, discountPct: 0 }]
    const monthlyAmount = Math.round(4 * weeklyRate * 100) / 100
    const items: LineItem[] = [{ id: 1, description: `Storage Rent · Unit ${unitNo}`, qty: 1, rate: monthlyAmount, amount: monthlyAmount, discountPct: 0 }]
    if (isFirstInvoice && contractEnd) {
      const advStart = new Date(contractEnd); advStart.setDate(advStart.getDate() - 28)
      const advEnd = new Date(contractEnd); advEnd.setDate(advEnd.getDate() - 1)
      const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      items.push({ id: 2, description: `Advance Rent ${fmt(advStart)} – ${fmt(advEnd)} · Unit ${unitNo}`, qty: 1, rate: monthlyAmount, amount: monthlyAmount, discountPct: 0 })
    }
    return items
  }

  const [lineItems, setLineItems] = useState<LineItem[]>(buildDefaultItems())
  const [includeVat, setIncludeVat] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function updateLine(idx: number, field: keyof LineItem, val: string) {
    setLineItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      const updated = { ...it, [field]: field === 'description' ? val : Number(val) }
      if (field === 'amount' || field === 'discountPct') { updated.qty = 1; updated.rate = updated.amount }
      return updated
    }))
  }

  function addLine() {
    setLineItems(prev => [...prev, emptyItem()])
  }

  function removeLine(idx: number) {
    setLineItems(prev => prev.filter((_, i) => i !== idx))
  }

  const subtotal = Math.round(lineItems.reduce((s, it) => s + it.amount, 0) * 100) / 100
  const totalDiscount = Math.round(lineItems.reduce((s, it) => s + it.amount * (it.discountPct / 100), 0) * 100) / 100
  const afterDiscount = Math.round((subtotal - totalDiscount) * 100) / 100
  const vatAmount = includeVat ? Math.round(afterDiscount * 0.05 * 100) / 100 : 0
  const total = Math.round((afterDiscount + vatAmount) * 100) / 100

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (lineItems.filter(it => it.description && it.amount > 0).length === 0) {
      setErr('Add at least one line item'); return
    }
    setBusy(true); setErr('')
    try {
      const validItems = lineItems.filter(it => it.description.trim() && it.amount > 0)
      await api.post(`/contracts/${contract._id}/generate-custom-invoice`, {
        startDate, endDate, dueDate, notes,
        // Send the lines as entered — the server bills these verbatim
        items: validItems.map(it => ({
          description: it.description.trim(), quantity: it.qty, rate: it.rate, amount: it.amount,
        })),
      })
      onDone()
    } catch (e) { setErr(apiError(e)) }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Dates */}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Period Start">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Period End">
          <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label="Due Date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>

      {/* Line items */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">Line Items</span>
          <button type="button" onClick={addLine} className="text-xs text-primary hover:underline cursor-pointer font-medium flex items-center gap-1">
            <Plus size={11} /> Add row
          </button>
        </div>
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-[1fr_100px_70px_32px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
            <span>Description</span><span className="text-right">Amount</span><span className="text-center">Disc %</span><span />
          </div>
          <div className="divide-y">
            {lineItems.map((it, i) => (
              <div key={it.id} className="grid grid-cols-[1fr_100px_70px_32px] gap-2 px-3 py-2 items-center">
                <Input value={it.description} onChange={(e) => updateLine(i, 'description', e.target.value)} placeholder="Service" className="text-sm" />
                <Input type="number" min={0} step="1" value={it.amount} onChange={(e) => updateLine(i, 'amount', e.target.value)} className="text-sm text-right" />
                <Input type="number" min={0} max={100} step="1" value={it.discountPct} onChange={(e) => updateLine(i, 'discountPct', e.target.value)} className="text-sm text-center" />
                {lineItems.length > 1 ? (
                  <button type="button" onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive cursor-pointer"><X size={14} /></button>
                ) : <span />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Notes */}
      <Field label="Notes (optional)">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes..." rows={2} />
      </Field>

      {/* Invoice Summary */}
      <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
        <p className="text-sm font-bold">Invoice Summary</p>
        <div className="space-y-1 text-sm">
          {lineItems.filter(it => it.amount > 0).map((it, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="truncate text-muted-foreground">{it.description || `Item ${i + 1}`}</span>
              <span className="shrink-0">{formatMoney(it.amount)}{it.discountPct > 0 ? <span className="text-destructive text-xs ml-1">-{it.discountPct}%</span> : ''}</span>
            </div>
          ))}
        </div>
        <div className="border-t pt-2 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{formatMoney(subtotal)}</span></div>
          {totalDiscount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Line discounts</span><span className="text-destructive">-{formatMoney(totalDiscount)}</span></div>}
          <div className="flex justify-between items-center">
            <label className="text-muted-foreground flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={includeVat} onChange={(e) => setIncludeVat(e.target.checked)} className="accent-primary" />
              VAT (5%)
            </label>
            <span>{includeVat ? formatMoney(vatAmount) : '—'}</span>
          </div>
          <div className="flex justify-between font-bold text-base border-t pt-1 mt-1">
            <span>Total</span><span>{formatMoney(total)} AED</span>
          </div>
        </div>
      </div>

      {err && <p className="text-xs text-destructive">{err}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={busy} className="px-6">
          {busy ? 'Creating…' : 'Create Invoice'}
        </Button>
      </div>
    </form>
  )
}

// ── Signature canvas (draw mode) ───────────────────────────────────────────────
function SignatureCanvas({ onCapture }: { onCapture: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasStroke = useRef(false)

  // Set up canvas resolution to match display DPR
  useEffect(() => {
    const canvas = ref.current!
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
  }, [])

  function pos(e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect()
    const src = 'touches' in e ? e.touches[0] : e
    return { x: src.clientX - rect.left, y: src.clientY - rect.top }
  }

  function start(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const { x, y } = pos(e.nativeEvent as MouseEvent | TouchEvent, canvas)
    ctx.beginPath(); ctx.moveTo(x, y)
    drawing.current = true
  }

  function move(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault()
    if (!drawing.current) return
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1a1a2e'
    const { x, y } = pos(e.nativeEvent as MouseEvent | TouchEvent, canvas)
    ctx.lineTo(x, y); ctx.stroke()
    hasStroke.current = true
  }

  function end() {
    drawing.current = false
    if (hasStroke.current) onCapture(ref.current!.toDataURL('image/png'))
  }

  function clear() {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasStroke.current = false
    onCapture(null)
  }

  return (
    <div className="space-y-1">
      <canvas
        ref={ref}
        className="w-full h-32 border-2 border-dashed border-border rounded-lg bg-white dark:bg-gray-50 cursor-crosshair touch-none"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
      />
      <button type="button" onClick={clear} className="text-xs text-muted-foreground hover:text-destructive">
        Clear
      </button>
    </div>
  )
}

// ── Sign-in-person modal ────────────────────────────────────────────────────────
export function SignInPersonModal({ contractNo, customerName, busy, error, onSign, onClose }: {
  contractNo: string
  customerName: string
  busy: boolean
  error: string
  onSign: (body: { signerName: string; signatureDataUrl: string | null; signMode: 'draw' | 'type' }) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [signerName, setName] = useState(customerName)
  const [sigDataUrl, setSigUrl] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)

  const canSubmit = agreed && signerName.trim() && (mode === 'type' || sigDataUrl)

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Contract <strong>{contractNo}</strong> — signing as <strong>{customerName}</strong>
      </p>

      {/* Tab toggle */}
      <div className="flex rounded-lg border overflow-hidden text-sm">
        {(['draw', 'type'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 py-1.5 font-medium transition-colors ${mode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
              }`}
          >
            {m === 'draw' ? 'Draw signature' : 'Type name'}
          </button>
        ))}
      </div>

      {mode === 'draw' ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Sign in the box below using your mouse or finger</p>
          <SignatureCanvas onCapture={setSigUrl} />
          {!sigDataUrl && <p className="text-xs text-amber-600">Draw your signature above</p>}
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Your typed name will be used as your electronic signature</p>
          <input
            type="text"
            value={signerName}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {signerName && (
            <p className="text-center text-2xl py-3 border rounded-lg bg-white dark:bg-gray-50 text-gray-800"
              style={{ fontFamily: 'cursive' }}>
              {signerName}
            </p>
          )}
        </div>
      )}

      {/* Signer name (for draw mode) */}
      {mode === 'draw' && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Full name (printed)</p>
          <input
            type="text"
            value={signerName}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      )}

      {/* Agreement checkbox */}
      <label className="flex items-start gap-2.5 text-sm cursor-pointer rounded-lg border bg-accent/40 px-3 py-2.5">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <span>
          I, <strong>{signerName || '…'}</strong>, confirm that I have read and agree to all terms and
          conditions of this contract. This electronic signature is legally binding.
        </span>
      </label>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-md border border-input px-4 text-sm hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSubmit || busy}
          onClick={() => onSign({ signerName: signerName.trim(), signatureDataUrl: sigDataUrl, signMode: mode })}
          className="h-9 rounded-md bg-primary text-primary-foreground px-4 text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors"
        >
          {busy ? 'Signing…' : 'Sign & activate contract'}
        </button>
      </div>
    </div>
  )
}

// ── Shared method selector ─────────────────────────────────────────────────────
function MethodSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="cash">Cash</option>
      <option value="bank_transfer">Bank transfer</option>
      <option value="card">Card</option>
      <option value="cheque">Cheque</option>
      <option value="other">Other</option>
    </Select>
  )
}

// ── Record single payment ──────────────────────────────────────────────────────
function RecordPaymentForm({ payment, busy, onSubmit }: {
  payment: Payment
  busy: boolean
  onSubmit: (body: { method: string; paidDate: string; notes: string; amount?: number }) => void
}) {
  const invoiceTotal = payment.amount
  const amountPaid = 0
  const balanceDue = invoiceTotal - amountPaid
  const invoiceNo = (payment.invoice as any)?.invoiceNo || ''

  const [amount, setAmount] = useState(String(balanceDue))
  const [method, setMethod] = useState(payment.method || 'cash')
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  return (
    <div className="space-y-4">
      {invoiceNo && <p className="text-sm font-medium text-muted-foreground">Record payment — {invoiceNo}</p>}
      <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 border px-3 py-2.5">
        <div>
          <div className="text-[10px] font-semibold text-primary uppercase">Quote total</div>
          <div className="text-base font-bold">{formatMoney(invoiceTotal)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-emerald-600 uppercase">Amount paid</div>
          <div className="text-base font-bold text-emerald-600">{formatMoney(amountPaid)}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold text-red-500 uppercase">Balance due</div>
          <div className="text-base font-bold text-red-500">{formatMoney(balanceDue)}</div>
        </div>
      </div>
      <p className="text-xs font-semibold text-muted-foreground">Record new payment</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (AED)">
          <Input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Date"><Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Method"><MethodSelect value={method} onChange={setMethod} /></Field>
        <Field label="Notes (optional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference / memo" />
        </Field>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={() => onSubmit({ method: '', paidDate: '', notes: '' })} type="button">Done</Button>
        <Button disabled={busy || !Number(amount)} onClick={() => onSubmit({ method, paidDate, notes, amount: Number(amount) })}>
          {busy ? 'Saving…' : 'Record payment'}
        </Button>
      </div>
    </div>
  )
}

// ── Edit payment ───────────────────────────────────────────────────────────────
function EditPaymentForm({ payment, busy, onSubmit }: {
  payment: Payment
  busy: boolean
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const toInput = (d?: string) => d ? new Date(d).toISOString().slice(0, 10) : ''
  const [amount, setAmount] = useState(String(payment.amount))
  const [dueDate, setDueDate] = useState(toInput(payment.dueDate))
  const [paidDate, setPaidDate] = useState(toInput(payment.paidDate))
  const [method, setMethod] = useState(payment.method || 'cash')
  const [notes, setNotes] = useState(payment.notes || '')
  function submit(e: FormEvent) {
    e.preventDefault()
    const body: Record<string, unknown> = { amount: Number(amount), dueDate, notes }
    if (payment.status === 'paid') { body.paidDate = paidDate; body.method = method }
    onSubmit(body)
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (AED)">
          <Input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Due date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </Field>
      </div>
      {payment.status === 'paid' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid on"><Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></Field>
          <Field label="Method"><MethodSelect value={method} onChange={setMethod} /></Field>
        </div>
      )}
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" />
      </Field>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
    </form>
  )
}

// ── Bulk pay modal (multiple periods OR all at once) ───────────────────────────
function BulkPayForm({ unpaid, billingPeriod, busy, onSubmit }: {
  unpaid: Payment[]       // overdue + pending sorted by due date
  billingPeriod: string
  busy: boolean
  onSubmit: (body: { paymentIds: string[]; method: string; paidDate: string; notes: string }) => void
}) {
  const periodLabel = billingPeriod === 'weekly' ? 'week' : 'month'
  const [count, setCount] = useState(unpaid.length)   // default: all
  const [method, setMethod] = useState('cash')
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  const selected = unpaid.slice(0, count)
  const total = selected.reduce((s, p) => s + p.amount, 0)
  const overdueIn = selected.filter((p) => p.status === 'overdue').length
  const pendingIn = selected.filter((p) => p.status === 'pending').length

  return (
    <div className="space-y-5">
      {/* Period picker */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">
          How many {periodLabel}s to pay?
        </div>
        <div className="flex flex-wrap gap-2">
          {unpaid.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setCount(i + 1)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors
                ${count === i + 1
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'hover:bg-muted'}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Preview of selected periods */}
      <div className="rounded-lg border divide-y text-sm max-h-48 overflow-y-auto">
        {selected.map((p, i) => (
          <div key={p._id} className="flex items-center justify-between px-3 py-2 gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
              <span>{formatDate(p.dueDate)}</span>
              {p.status === 'overdue' && <Badge tone="red">overdue</Badge>}
            </div>
            <span className="font-medium">{formatMoney(p.amount)}</span>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="rounded-lg bg-muted px-4 py-3 text-sm space-y-1">
        {overdueIn > 0 && <div className="flex justify-between"><span className="text-red-600">Overdue ({overdueIn})</span><span>{formatMoney(selected.filter(p => p.status === 'overdue').reduce((s, p) => s + p.amount, 0))}</span></div>}
        {pendingIn > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Upcoming ({pendingIn})</span><span>{formatMoney(selected.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0))}</span></div>}
        <div className="flex justify-between font-semibold border-t pt-1 mt-1">
          <span>Total to record</span>
          <span>{formatMoney(total)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Payment method"><MethodSelect value={method} onChange={setMethod} /></Field>
        <Field label="Paid on"><Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></Field>
      </div>
      <Field label="Notes (optional)">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference no., remarks…" />
      </Field>
      <Button
        className="w-full"
        disabled={busy || selected.length === 0}
        onClick={() => onSubmit({ paymentIds: selected.map((p) => p._id), method, paidDate, notes })}
      >
        {busy ? 'Recording…' : `Record ${count} ${periodLabel}${count !== 1 ? 's' : ''} — ${formatMoney(total)}`}
      </Button>
    </div>
  )
}

// ── Add manual payment ─────────────────────────────────────────────────────────
function AddPaymentForm({ contractId, rate, busy, onSubmit }: {
  contractId: string; rate: number; busy: boolean
  onSubmit: (body: object) => void
}) {
  const [amount, setAmount] = useState(String(rate))
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit({ contract: contractId, amount: Number(amount), dueDate, notes })
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (AED) *">
          <Input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Due date *">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Supplemental charge…" />
      </Field>
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Adding…' : 'Add payment'}</Button>
    </form>
  )
}

// ── Invoice group row (one row per invoice in the payment schedule) ───────────
type InvoiceGroup = {
  invoiceId: string; invoiceRef: { _id: string; invoiceNo: string }
  payments: Payment[]; unpaidInGroup: Payment[]; paidInGroup: Payment[]
  total: number; paidTotal: number; rentTotal: number; depositTotal: number
  earliestDue: Date; latestDue: Date; periodLabel: string
  /** The period this invoice actually bills, when its lines/notes state one */
  periodStart?: Date
  status: 'paid' | 'partial' | 'overdue' | 'pending'
}

// ── Main page ──────────────────────────────────────────────────────────────────

// ── Edit Contract form ────────────────────────────────────────────────────────
// Covers every field shown in the sidebar so an old-system contract can be
// keyed in fully here before its documents, invoices and receipts are uploaded.
function EditContractForm({ contract, unitOptions, busy, error, onSubmit, onCancel }: {
  contract: Contract
  unitOptions: Unit[]
  busy: boolean
  error: string
  onSubmit: (body: Record<string, unknown>) => void
  onCancel: () => void
}) {
  const c = contract
  const held = c.units?.length ? c.units : c.unit ? [c.unit] : []

  const [startDate, setStartDate] = useState(c.startDate?.slice(0, 10) || '')
  const [endDate, setEndDate] = useState(c.endDate?.slice(0, 10) || '')
  const [unitIds, setUnitIds] = useState<string[]>(held.map((u) => u._id))
  const [rate, setRate] = useState(String(c.rate ?? ''))
  const asking = Number(rate) || 0
  const [leased, setLeased] = useState(
    String(Number(c.leasedPrice) || Math.round(Number(c.rate || 0) * (1 - Number(c.firstMonthDiscountPct || 0) / 100) * 100) / 100),
  )
  const [totalQuotation, setTotalQuotation] = useState(String(c.totalQuotation ?? ''))
  const [notes, setNotes] = useState(c.notes || '')
  const [unitSearch, setUnitSearch] = useState('')
  const [showAllUnits, setShowAllUnits] = useState(false)

  const weeks = startDate && endDate
    ? Math.ceil(Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) / 7)
    : 0

  // Weeks and Check Out are two views of the same thing — typing weeks moves the
  // end date rather than being stored separately.
  const applyWeeks = (w: number) => {
    if (!startDate || !Number.isFinite(w) || w < 1) return
    const d = new Date(startDate)
    d.setDate(d.getDate() + w * 7)
    setEndDate(d.toISOString().slice(0, 10))
  }

  // Free units, plus the ones already on this contract and shared units. Taken
  // units are one toggle away — back-filling old records often means attaching a
  // unit the system currently shows as occupied.
  const selectable = showAllUnits
    ? unitOptions
    : unitOptions.filter((u) => unitIds.includes(u._id) || u.status === 'available' || u.shared)
  const hiddenCount = unitOptions.length - selectable.length
  const term = unitSearch.trim().toLowerCase()
  const visible = term
    ? selectable.filter((u) => u.unitNumber.toLowerCase().includes(term) || (u.floor || '').toLowerCase().includes(term))
    : selectable

  const toggleUnit = (u: Unit) => {
    setUnitIds((prev) => (prev.includes(u._id) ? prev.filter((x) => x !== u._id) : [...prev, u._id]))
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSubmit({
      startDate,
      endDate,
      units: unitIds,
      rate: Number(rate) || 0,
      leasedPrice: Number(leased) || 0,
      firstMonthDiscountPct: asking > 0
        ? Math.round(Math.max(0, 1 - (Number(leased) || 0) / asking) * 10000) / 100
        : 0,
      totalQuotation: Number(totalQuotation) || 0,
      notes,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Check In">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </Field>
        <Field label="Check Out">
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </Field>
        <Field label="Number of Weeks">
          <Input type="number" min="1" value={weeks || ''}
            onChange={(e) => applyWeeks(Number(e.target.value))}
            placeholder="e.g. 4" />
        </Field>
        <Field label="Asking Price (AED)">
          <Input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} required />
        </Field>
        <Field label="Leased Price (AED)">
          <Input type="number" min="0" step="0.01" value={leased} onChange={(e) => setLeased(e.target.value)} />
        </Field>
        <Field label="Total Quotation (AED)">
          <Input type="number" min="0" step="0.01" value={totalQuotation} onChange={(e) => setTotalQuotation(e.target.value)} />
        </Field>
      </div>

      <Field label={`Units (${unitIds.length} selected)`}>
        <Input value={unitSearch} onChange={(e) => setUnitSearch(e.target.value)} placeholder="Filter by unit number or floor…" />
        <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border divide-y">
          {visible.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No matching units</p>
          ) : visible.map((u) => (
            <label key={u._id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/50">
              <input type="checkbox" checked={unitIds.includes(u._id)} onChange={() => toggleUnit(u)} />
              <span className="font-medium">{u.unitNumber}</span>
              <span className="text-xs text-muted-foreground">
                {[u.floor, u.sizeSqf != null ? `${u.sizeSqf} sq ft` : null].filter(Boolean).join(' · ')}
              </span>
              {u.status !== 'available' && !unitIds.includes(u._id) && (
                <span className="ml-auto text-[10px] uppercase text-muted-foreground">{u.status}</span>
              )}
            </label>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={showAllUnits} onChange={(e) => setShowAllUnits(e.target.checked)} />
          Show all units{!showAllUnits && hiddenCount > 0 ? ` (${hiddenCount} taken hidden)` : ''}
        </label>
      </Field>

      <Field label="Notes">
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes about this contract" />
      </Field>

      <div className="rounded-lg bg-muted/50 border px-3 py-2 text-xs text-muted-foreground">
        <strong>Received</strong> and <strong>Remaining</strong> are totalled from this contract's
        payment records — add them from the Payments tab rather than here. The tenant cannot be
        changed on an existing contract.
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</Button>
      </div>
    </form>
  )
}

// ── Units tab ─────────────────────────────────────────────────────────────────
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

/** One entry of GET /contracts/:id/unit-bookings — the next contract on a unit. */
type UnitBooking = {
  contractId: string
  contractNo: string
  startDate: string
  customerName: string
  status: string
}

/**
 * Click-to-edit cell used by every editable column of the Units grid.
 * Resting state is a dashed-underline value; clicking swaps in an input that
 * saves on blur (Enter commits, Escape reverts).
 */
function UnitCellEdit({ value, display, type, color, right, title, onSave }: {
  /** Current raw value, in the input's own format (YYYY-MM-DD, or a number) */
  value: string
  display: React.ReactNode
  type: 'date' | 'number'
  color?: string
  right?: boolean
  title?: string
  onSave: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  if (editing) {
    return (
      <input
        type={type}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft !== value) onSave(draft) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        style={{
          height: 24, border: `1px solid ${PURPLE}`, borderRadius: 6, width: '100%',
          fontSize: 12, padding: '0 5px', textAlign: right ? 'right' : 'left', color: INK,
        }}
      />
    )
  }
  return (
    <div style={{ textAlign: right ? 'right' : 'left' }}>
      <span
        onClick={() => { setDraft(value); setEditing(true) }}
        title={title ?? 'Click to edit'}
        style={{ borderBottom: '1px dashed rgba(20,8,31,.3)', cursor: 'pointer', color }}
      >
        {display}
      </span>
    </div>
  )
}

export default function ContractDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [recordingPayment, setRecordingPayment] = useState<Payment | null>(null)
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [bulkTarget, setBulkTarget] = useState<Payment[] | null>(null)
  const [addingPayment, setAddingPayment] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [signingInPerson, setSigningInPerson] = useState(false)
  const [signError, setSignError] = useState('')
  const [signingLink, setSigningLink] = useState('')
  const [signingLinkExpiry, setSigningLinkExpiry] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [invoiceOverride, setInvoiceOverride] = useState<{ start: string; end: string } | null>(null)
  // Custom invoices open with no prefilled lines; period invoices keep theirs
  const [invoiceBlank, setInvoiceBlank] = useState(false)
  const [editModal, setEditModal] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState<{ id: string; name: string } | null>(null)
  const [noticeBusy, setNoticeBusy] = useState('')
  const [noticeSent, setNoticeSent] = useState('')
  const [noticeSignUrl, setNoticeSignUrl] = useState('')
  const noticeRef = useRef<HTMLDivElement>(null)
  // Editor content is injected on mount via a ref callback — rAF timing is unreliable
  const noticeInitial = useRef('')
  const [inlineField, setInlineField] = useState<string | null>(null)
  const [inlineValue, setInlineValue] = useState('')

  // Units to choose from in the edit panel or inline unit picker
  const { data: unitOptions = [] } = useQuery<Unit[]>({
    queryKey: ['units', 'contract-edit-picker'],
    queryFn: async () => {
      const r = await api.get('/units', { params: { limit: 2000 } })
      return (Array.isArray(r.data) ? r.data : r.data?.data ?? []) as Unit[]
    },
    enabled: editModal || inlineField === 'unitNumber',
    staleTime: 60_000,
  })
  const [editCustomerModal, setEditCustomerModal] = useState(false)
  const [customerError, setCustomerError] = useState('')
  const [editingNote, setEditingNote] = useState<{ idx: number; text: string } | null>(null)
  const [showAllActivity, setShowAllActivity] = useState(false)
  // Documents tab: which control is mid-flight, and the picked "other" title
  const [docBusy, setDocBusy] = useState('')
  const [otherTitle, setOtherTitle] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') as 'overview' | 'contracts' | 'units' | 'payments' | 'documents' | 'notices' | 'reminders') || 'overview'
  const setActiveTab = (tab: typeof activeTab) => setSearchParams({ tab }, { replace: true })

  // Units tab: which units are ticked for bulk removal, and the last save error
  const [selectedUnits, setSelectedUnits] = useState<string[]>([])
  const [unitsError, setUnitsError] = useState('')

  const { data: unitBookings = {} } = useQuery<Record<string, UnitBooking>>({
    queryKey: ['contract-unit-bookings', id],
    queryFn: () => api.get(`/contracts/${id}/unit-bookings`).then((r) => r.data?.bookings ?? {}),
    enabled: activeTab === 'units',
    staleTime: 60_000,
  })

  const { data: noticeTemplates = [] } = useQuery<{ _id: string; name: string; isDefault: boolean; updatedAt?: string }[]>({
    queryKey: ['agreement-templates'],
    queryFn: () => api.get('/agreement-template').then((r) => r.data?.templates ?? []),
    enabled: activeTab === 'notices',
    staleTime: 60_000,
  })

  type AutomationRuleRow = { _id: string; name: string; enabled: boolean; triggerLabel?: string; relativeLabel?: string; whatsappEnabled?: boolean; emailEnabled?: boolean; steps?: { value: number; direction: string; immediate?: boolean }[] }
  const { data: automationRules = [] } = useQuery<AutomationRuleRow[]>({
    queryKey: ['automation-rules'],
    queryFn: () => api.get('/automation-rules').then((r) => (Array.isArray(r.data) ? r.data : r.data?.rules ?? [])),
    enabled: activeTab === 'reminders',
    staleTime: 60_000,
  })


  const { data, isLoading } = useQuery<ContractDetailData>({
    queryKey: ['contract', id],
    queryFn: () => api.get(`/contracts/${id}`).then((r) => r.data),
  })

  // Step to the next/previous unit's contract without going back to the list.
  // Ordered by unit number the same way the Units page orders them, and only
  // units that actually have an active contract are stops — landing on a unit
  // with no contract would have nothing to show.
  const { data: unitsForNav = [] } = useQuery<{ _id: string; unitNumber: string; floor: string }[]>({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  const { data: activeByUnit = {} } = useQuery<Record<string, { contractId: string; contractNo: string; customerName: string }[]>>({
    queryKey: ['unit-active-contracts'],
    queryFn: () => api.get('/units/active-contracts').then((r) => r.data?.byUnit ?? {}),
    staleTime: 60_000,
  })

  const unitStops = useMemo(() => {
    // Unit numbers are stored inconsistently — "F1-36" and "F1 - 36" both
    // occur — so sort on the parsed prefix and trailing number rather than the
    // raw text. Sorting the text directly puts every spaced name first,
    // because a space sorts before a hyphen.
    const sorted = [...unitsForNav]
      .filter((u) => (activeByUnit[u._id] ?? []).length > 0)
      .sort(compareUnitNumbers)

    // A contract holding several units appears once, at its first unit in
    // order. Its later units are dropped from the sequence entirely, so
    // stepping never revisits a contract already passed.
    const seen = new Set<string>()
    const out: typeof sorted = []
    for (const u of sorted) {
      const fresh = (activeByUnit[u._id] ?? []).filter((c) => !seen.has(c.contractId))
      if (!fresh.length) continue
      fresh.forEach((c) => seen.add(c.contractId))
      out.push(u)
    }
    return out
  }, [unitsForNav, activeByUnit])

  // The same order over ALL units, used only to name the units an arrow jumps
  // over so the skip is visible rather than silent.
  const allUnitsSorted = useMemo(() => {
    return [...unitsForNav].sort(compareUnitNumbers)
  }, [unitsForNav])

  const navContract = data?.contract
  const navStop = useMemo(() => {
    if (!unitStops.length || !navContract) return { prev: null, next: null, position: '' }
    const hereId = navContract._id
    const contractsOn = (unitId: string) => activeByUnit[unitId] ?? []

    // Each contract has exactly one stop now, so this is a plain lookup.
    const here = unitStops.findIndex((u) => contractsOn(u._id).some((x) => x.contractId === hereId))
    if (here === -1) return { prev: null, next: null, position: '' }

    const stopIds = new Set(unitStops.map((u) => u._id))
    const hereUnit = unitStops[here]

    const at = (i: number) => {
      const u = unitStops[i]
      if (!u) return null
      const list = contractsOn(u._id)
      // A shared unit carries more than one contract; prefer one that isn't
      // the current contract so the arrow always moves you somewhere new.
      const pick = list.find((x) => x.contractId !== hereId) ?? list[0]
      if (!pick) return null

      // Units passed over that genuinely have no active contract. Other units
      // of this same contract are skipped too, but they are not vacant, so
      // listing them under "no active contract" would be a lie.
      const from = allUnitsSorted.findIndex((x) => x._id === hereUnit._id)
      const to = allUnitsSorted.findIndex((x) => x._id === u._id)
      const [lo, hi] = from < to ? [from, to] : [to, from]
      const skipped = lo >= 0 && hi >= 0
        ? allUnitsSorted.slice(lo + 1, hi)
            .filter((x) => !stopIds.has(x._id) && (contractsOn(x._id).length === 0))
            .map((x) => x.unitNumber)
        : []

      return { unitNumber: u.unitNumber, contractId: pick.contractId, customerName: pick.customerName, skipped }
    }

    return { prev: at(here - 1), next: at(here + 1), position: `${here + 1} of ${unitStops.length}` }
  }, [unitStops, allUnitsSorted, activeByUnit, navContract])

  // Zoho Books invoices for this tenant. A 501 means Zoho isn't connected,
  // which is a normal state to render rather than an error worth retrying.
  // Keyed on the customer, not the contract: the same person's Zoho invoices
  // are identical across all their contracts, so the cache is shared.
  const zohoCustomerId = data?.contract?.customer?._id

  // The Contracts tab acts on OTHER contracts, so these take an id rather
  // than closing over the one being viewed.
  const [rowError, setRowError] = useState('')
  const rowAction = useMutation({
    mutationFn: ({ contractId, path }: { contractId: string; path: string }) =>
      api.post(`/contracts/${contractId}/${path}`),
    onSuccess: () => {
      setRowError('')
      qc.invalidateQueries({ queryKey: ['tenant-contracts'] })
      qc.invalidateQueries({ queryKey: ['contract', id] })
      qc.invalidateQueries({ queryKey: ['unit-active-contracts'] })
    },
    onError: (e) => setRowError(apiError(e)),
  })
  const rowDelete = useMutation({
    mutationFn: (contractId: string) => api.delete(`/contracts/${contractId}`),
    onSuccess: () => {
      setRowError('')
      qc.invalidateQueries({ queryKey: ['tenant-contracts'] })
      qc.invalidateQueries({ queryKey: ['unit-active-contracts'] })
    },
    onError: (e) => setRowError(apiError(e)),
  })

  // Google Drive hands out /file/d/<id>/view links, which open its viewer.
  // Rewriting to the export form downloads the file instead. Anything else
  // (the older purplebox.ae uploads) is already a direct link.
  const downloadUrlFor = (url: string) => {
    const m = url.match(/drive\.google\.com\/file\/d\/([^/]+)/)
    return m ? `https://drive.google.com/uc?export=download&id=${m[1]}` : url
  }

  // Every contract this tenant has ever had. A tenant commonly renews into a
  // new contract or rents a second unit, and those are otherwise only
  // reachable by going back out to the tenant record.
  type TenantContractRow = {
    _id: string; contractNo: string; status: string; startDate: string; endDate: string
    unit?: { unitNumber?: string }; units?: { unitNumber?: string }[]
    contractAmount?: number; paidAmount?: number; overdueCount?: number; documentCount?: number
    signedDocUrl?: string
  }
  const tenantContracts = useQuery<TenantContractRow[]>({
    queryKey: ['tenant-contracts', zohoCustomerId],
    queryFn: () => api
      .get('/contracts', { params: { customer: zohoCustomerId, limit: 200, archived: 'all', sort: 'start_desc' } })
      .then((r) => r.data?.data ?? []),
    enabled: activeTab === 'contracts' && Boolean(zohoCustomerId),
  })

  const zohoInvoices = useQuery<ZohoInvoicesResponse>({
    queryKey: ['customer-zoho-invoices', zohoCustomerId],
    queryFn: () => api.get(`/customers/${zohoCustomerId}/zoho-invoices`).then((r) => r.data),
    enabled: activeTab === 'payments' && Boolean(zohoCustomerId),
    retry: false,
    staleTime: 5 * 60_000,
  })

  // Several Zoho contacts can share a phone number, and they are not always the
  // same legal entity — a company and its owner, say. When more than one
  // matched, name who each invoice was actually billed to so a mixed list reads
  // as mixed rather than as one person's account.
  // Opening a Zoho invoice needs the auth header, so a plain link won't do —
  // fetch it as a blob and hand the browser an object URL, same as the local
  // invoice PDFs elsewhere in the app.
  const [openingZohoPdf, setOpeningZohoPdf] = useState('')
  const [zohoPdfError, setZohoPdfError] = useState('')
  async function openZohoInvoicePdf(invoiceId: string) {
    if (!zohoCustomerId) return
    setZohoPdfError('')
    setOpeningZohoPdf(invoiceId)
    try {
      const r = await api.get(`/customers/${zohoCustomerId}/zoho-invoices/${invoiceId}/pdf`, { responseType: 'blob' })
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

  const multipleZohoContacts = (zohoInvoices.data?.matchedContacts?.length ?? 0) > 1
  const zohoCols = multipleZohoContacts
    ? '130px 95px 95px 90px 1fr 90px 90px'
    : '130px 95px 95px 1fr 90px 90px'


  function invalidate() {
    qc.invalidateQueries({ queryKey: ['contract', id] })
    qc.invalidateQueries({ queryKey: ['contracts'] })
    qc.invalidateQueries({ queryKey: ['payments'] })
    qc.invalidateQueries({ queryKey: ['payments-summary'] })
    qc.invalidateQueries({ queryKey: ['units'] })
    qc.invalidateQueries({ queryKey: ['summary'] })
  }

  const action = useMutation({
    mutationFn: (path: string) => api.post(`/contracts/${id}/${path}`),
    onSuccess: () => { invalidate(); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const deleteContract = useMutation({
    mutationFn: () => api.delete(`/contracts/${id}`),
    onSuccess: () => navigate('/contracts'),
    onError: (e) => setError(apiError(e)),
  })

  const recordPayment = useMutation({
    mutationFn: ({ paymentId, body }: { paymentId: string; body: object }) =>
      api.post(`/payments/${paymentId}/record`, body),
    onSuccess: () => { invalidate(); setRecordingPayment(null) },
    onError: (e) => setError(apiError(e)),
  })

  const bulkRecord = useMutation({
    mutationFn: (body: object) => api.post('/payments/bulk-record', body),
    onSuccess: () => { invalidate(); setBulkTarget(null) },
    onError: (e) => setError(apiError(e)),
  })

  const editPayment = useMutation({
    mutationFn: ({ paymentId, body }: { paymentId: string; body: Record<string, unknown> }) =>
      api.put(`/payments/${paymentId}`, body),
    onSuccess: () => { invalidate(); setEditingPayment(null) },
    onError: (e) => setError(apiError(e)),
  })


  const deleteInvoice = useMutation({
    mutationFn: (invoiceId: string) => api.delete(`/invoices/${invoiceId}`),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['invoices'] }); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const addPayment = useMutation({
    mutationFn: (body: object) => api.post('/payments', body),
    onSuccess: () => { invalidate(); setAddingPayment(false) },
    onError: (e) => setError(apiError(e)),
  })

  // Units tab — every edit resends the whole unitLines array; the server replaces it wholesale
  const saveUnitLines = useMutation({
    mutationFn: (unitLines: UnitLine[]) => api.put(`/contracts/${id}`, { unitLines }),
    onSuccess: () => { invalidate(); setUnitsError('') },
    onError: (e) => setUnitsError(apiError(e)),
  })

  const toggleUnitShared = useMutation({
    mutationFn: ({ unitId, shared }: { unitId: string; shared: boolean }) =>
      api.put(`/units/${unitId}`, { shared }),
    onSuccess: () => { invalidate(); setUnitsError('') },
    onError: (e) => setUnitsError(apiError(e)),
  })

  const setContractUnits = useMutation({
    mutationFn: (units: string[]) => api.put(`/contracts/${id}`, { units }),
    onSuccess: () => { invalidate(); setUnitsError(''); setSelectedUnits([]) },
    onError: (e) => setUnitsError(apiError(e)),
  })

  const updateContract = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/contracts/${id}`, body),
    onSuccess: () => { invalidate(); setEditModal(false); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const updateCustomer = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/customers/${(c?.customer as { _id?: string })?._id}`, body),
    onSuccess: () => { invalidate(); setEditCustomerModal(false); setCustomerError('') },
    onError: (e) => setCustomerError(apiError(e)),
  })

  const addNote = useMutation({
    mutationFn: (text: string) =>
      api.post(`/contracts/${id}/notes`, { text, author: user?.name || '' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contract', id] }),
    onError: (e) => setError(apiError(e)),
  })

  const editNote = useMutation({
    mutationFn: ({ idx, text }: { idx: number; text: string }) =>
      api.put(`/contracts/${id}/notes/${idx}`, { text }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['contract', id] }); setEditingNote(null) },
    onError: (e) => setError(apiError(e)),
  })

  const deleteNote = useMutation({
    mutationFn: (idx: number) => api.delete(`/contracts/${id}/notes/${idx}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contract', id] }),
    onError: (e) => setError(apiError(e)),
  })

  const pinNote = useMutation({
    mutationFn: ({ idx, pinned }: { idx: number; pinned: boolean }) =>
      api.put(`/contracts/${id}/notes/${idx}/pin`, { pinned }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contract', id] }),
    onError: (e) => setError(apiError(e)),
  })

  const createSigningLink = useMutation({
    mutationFn: () => api.post(`/contracts/${id}/create-signing-link`),
    onSuccess: (res) => {
      invalidate()
      setSigningLink(res.data.signingUrl)
      setSigningLinkExpiry(res.data.expiresAt)
    },
    onError: (e) => setError(apiError(e)),
  })

  const signInPerson = useMutation({
    mutationFn: (body: { signerName: string; signatureDataUrl: string | null; signMode: 'draw' | 'type' }) =>
      api.post(`/contracts/${id}/sign-inperson`, body),
    onSuccess: () => { invalidate(); setSigningInPerson(false); setSignError('') },
    onError: (e) => setSignError(apiError(e)),
  })

  if (isLoading || !data) return <Spinner />
  const { contract: c, payments, documents } = data

  // ── Document upload / delete (POST /documents, DELETE /documents/:id) ───────
  async function uploadDoc(file: File, type: AppDocument['type'], name?: string, busyKey: string = type) {
    setDocBusy(busyKey)
    setError('')
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('type', type)
      form.set('contract', c._id)
      if (c.customer?._id) form.set('customer', c.customer._id)
      if (name) form.set('name', name)
      await api.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      invalidate()
    } catch (e) { setError(apiError(e)) }
    finally { setDocBusy('') }
  }

  async function removeDoc(docId: string) {
    setDocBusy(docId)
    setError('')
    try {
      await api.delete(`/documents/${docId}`)
      invalidate()
    } catch (e) { setError(apiError(e)) }
    finally { setDocBusy('') }
  }

  const identitySlots = [
    { type: 'emirates_id' as const, label: 'Emirates ID' },
    { type: 'passport' as const, label: 'Passport' },
  ]
  const signedContractDocs = documents.filter((d) => d.type === 'contract')
  const otherDocs = documents.filter((d) => !['contract', 'emirates_id', 'passport'].includes(d.type))
  const fileLabel = (d: AppDocument) => {
    try {
      const last = decodeURIComponent(new URL(d.url, window.location.origin).pathname.split('/').pop() || '')
      return last || d.name
    } catch { return d.name }
  }

  // Sort and split
  const byDue = (a: Payment, b: Payment) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  const overdue = payments.filter((p) => p.status === 'overdue').sort(byDue)
  const pending = payments.filter((p) => p.status === 'pending').sort(byDue)
  const paid = payments.filter((p) => p.status === 'paid')
    .sort((a, b) => new Date(b.paidDate ?? b.dueDate).getTime() - new Date(a.paidDate ?? a.dueDate).getTime())
  // Exclude security deposit records from rent totals — deposit is a separate liability
  const isDepositPayment = (p: Payment) => /^security deposit/i.test(p.notes || '')
  // Group payments by invoice → one display row per invoice
  const groupMap = new Map<string, Payment[]>()
  const standalonePayments: Payment[] = []
  for (const p of payments) {
    const invId = (p.invoice as any)?._id
    if (invId) { if (!groupMap.has(invId)) groupMap.set(invId, []); groupMap.get(invId)!.push(p) }
    else standalonePayments.push(p)
  }
  const fmtShortDate = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const invoiceDocFor = (invId: string) => (data?.invoices ?? []).find((i) => String(i._id) === String(invId))

  // "17 Jul 2026 – 13 Aug 2026" out of a note or line description. "Sept" is
  // written by the PDF/invoice builders but Date only parses "Sep".
  const parseDateRange = (text: string): { start: Date; end: Date } | null => {
    const m = String(text || '').match(/(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\s*[–-]\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/)
    if (!m) return null
    const norm = (s: string) => s.replace(/Sept\b/i, 'Sep')
    const start = new Date(norm(m[1]))
    const end = new Date(norm(m[2]))
    return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? null : { start, end }
  }

  const invoiceGroups: InvoiceGroup[] = Array.from(groupMap.entries()).map(([invId, ps]) => {
    const sorted = [...ps].sort(byDue)
    const paidInGroup = ps.filter(p => p.status === 'paid')
    const unpaidInGroup = ps.filter(p => p.status !== 'paid').sort(byDue)
    const anyOverdue = ps.some(p => p.status === 'overdue')
    const depositTotal = Math.round(ps.filter(isDepositPayment).reduce((s, p) => s + p.amount, 0) * 100) / 100
    const total = Math.round(ps.reduce((s, p) => s + p.amount, 0) * 100) / 100
    const rentTotal = Math.round((total - depositTotal) * 100) / 100
    // Pull the service period out of any payment note or invoice line, e.g.
    // "... 17 Jul 2026 – 13 Aug 2026 ...". This is what the invoice actually
    // covers; the due date can be any day (often today) and must not be used
    // to decide which month an invoice belongs to.
    const periodText = [
      ...sorted.map(p => p.notes || ''),
      ...((invoiceDocFor(invId)?.items ?? []).map(it => it.itemDetails || '')),
    ].map(parseDateRange).find(Boolean) ?? null
    const periodLabel = periodText
      ? `${fmtShortDate(periodText.start)} – ${fmtShortDate(periodText.end)}`
      : fmtShortDate(new Date(sorted[0].dueDate))
    // Paid figure: payment records may lag behind money taken straight against
    // the invoice (recorded in its paymentHistory), so trust whichever is higher.
    const recordPaid = Math.round(paidInGroup.reduce((s, p) => s + p.amount, 0) * 100) / 100
    const invoiceDoc = (data?.invoices ?? []).find((i) => String(i._id) === String(invId))
    const invoicePaid = Math.round(Number(invoiceDoc?.paymentMade ?? 0) * 100) / 100
    const paidTotal = Math.min(Math.max(recordPaid, invoicePaid), total)

    const allPaid = unpaidInGroup.length === 0 || paidTotal >= total - 0.01
    const anyPaid = paidTotal > 0
    const status: InvoiceGroup['status'] = allPaid ? 'paid' : anyOverdue ? 'overdue' : anyPaid ? 'partial' : 'pending'

    return {
      invoiceId: invId,
      invoiceRef: ps[0].invoice as { _id: string; invoiceNo: string },
      payments: sorted, unpaidInGroup, paidInGroup,
      total, paidTotal,
      rentTotal, depositTotal, periodLabel,
      periodStart: periodText?.start,
      earliestDue: new Date(sorted[0].dueDate),
      latestDue: new Date(sorted[sorted.length - 1].dueDate),
      status,
    }
  }).sort((a, b) => a.earliestDue.getTime() - b.earliestDue.getTime())

  const unpaidGroups = invoiceGroups.filter(g => g.status !== 'paid')


  // Deposit-covered invoices: status 'paid', net 0, no payment records linked to them
  const allUnits = c.units?.length ? c.units : c.unit ? [c.unit] : []


  // allUnpaid for "Pay multiple" header button
  const allUnpaid = [...overdue, ...pending]

  // Sidebar computed values
  const initials = (c.customer?.fullName ?? '').split(' ').slice(0, 2).map((w: string) => w[0] ?? '').join('').toUpperCase()
  const today2 = new Date(); today2.setHours(0, 0, 0, 0)
  const daysLeft = c.endDate ? Math.ceil((new Date(c.endDate).getTime() - today2.getTime()) / 86400000) : null

  // Activity feed
  type ActivityEvent = { id: string; type: 'overdue' | 'paid' | 'note' | 'invoice' | 'document' | 'email'; at: Date; title: string; subtitle: string; noteIdx?: number; pinned?: boolean }
  const activityEvents: ActivityEvent[] = []
  // Group paid payments by invoice — show one activity row per invoice (month), not per week
  const paidByInvoice = new Map<string, typeof paid>()
  for (const p of paid) {
    const invId = (p.invoice as any)?._id ?? (p.invoice as any) ?? 'no-invoice'
    const key = String(invId)
    if (!paidByInvoice.has(key)) paidByInvoice.set(key, [])
    paidByInvoice.get(key)!.push(p)
  }
  for (const [, group] of paidByInvoice) {
    const inv = (group[0].invoice as any)
    const total = group.reduce((s, p) => s + Number(p.amount ?? 0), 0)
    const latestPaid = group.reduce((latest, p) => {
      const d = new Date(p.paidDate ?? p.dueDate)
      return d > latest ? d : latest
    }, new Date(0))
    const period = inv?.invoiceNo ? `\n · ${inv.invoiceNo} · ${formatMoney(total)}` : ` · ${formatMoney(total)}`
    activityEvents.push({ id: `paid-${group[0]._id}`, type: 'paid', at: latestPaid, title: 'Payment received', subtitle: period })
  }
  // Timeline notes (includes contract creation, approval, signing, etc.)
  for (const [noteIdx, note] of (c.timeline ?? []).entries()) {
    // Sent-email entries are written by the bulk mailer with this exact shape.
    // They aren't hand-written notes, so they get a mail icon and no edit/delete.
    const isEmail = /^(Email|Notice) "/.test(note.text ?? '')
    activityEvents.push({
      id: `note-${noteIdx}-${note.at}`,
      type: isEmail ? 'email' : 'note',
      at: new Date(note.at),
      title: note.text,
      subtitle: note.author ? `by ${note.author}` : '',
      pinned: Boolean(note.pinned),
      ...(isEmail ? {} : { noteIdx }),
    })
  }
  // Invoice creation events
  const allInvoices = data?.invoices ?? []
  for (const inv of allInvoices) {
    if (inv.createdAt) {
      activityEvents.push({ id: `inv-${inv._id}`, type: 'invoice', at: new Date(inv.createdAt), title: `Invoice ${inv.invoiceNo} created`, subtitle: `${formatMoney(inv.total)} AED` })
    }
  }
  // Document upload events
  for (const doc of documents) {
    if (doc.createdAt) {
      const typeLabel = doc.type && doc.type !== 'other' ? ` · ${statusLabel(doc.type)}` : ''
      activityEvents.push({ id: `doc-${doc._id}`, type: 'document', at: new Date(doc.createdAt), title: `Document uploaded${typeLabel}`, subtitle: doc.name })
    }
  }
  // Pinned notes float to the top; everything else stays newest-first. A pinned
  // note is also exempt from the collapse, so it can't hide behind "Show more".
  activityEvents.sort((a, b) =>
    (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.at.getTime() - a.at.getTime()
  )
  const pinnedCount = activityEvents.filter((e) => e.pinned).length

  // Live alerts — derived only from figures already computed on this page
  const liveAlerts: { id: string; text: string; tone: 'red' | 'amber' }[] = []
  if (overdue.length > 0) {
    liveAlerts.push({ id: 'overdue', text: `${overdue.length} payment${overdue.length !== 1 ? 's' : ''} overdue`, tone: 'red' })
  }
  if (daysLeft !== null) {
    if (daysLeft < 0) liveAlerts.push({ id: 'expiry', text: `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''} ago`, tone: 'red' })
    else if (daysLeft === 0) liveAlerts.push({ id: 'expiry', text: 'Expires today', tone: 'red' })
    else if (daysLeft <= 30) liveAlerts.push({ id: 'expiry', text: `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`, tone: 'amber' })
  }
  const activityBadgeTone: Record<ActivityEvent['type'], string> = {
    paid: 'green', invoice: 'blue', document: 'purple', email: 'amber', note: 'gray', overdue: 'red',
  }

  return (
    <div>
      {/* Back, plus unit-to-unit stepping so a walk-through doesn't need a
          round trip via the list for every unit. */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer">
          <span className="text-lg leading-none">←</span> Back
        </button>

        {navStop.position && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1 hidden sm:inline text-right">
              Unit {navStop.position}
              {navStop.next?.skipped.length ? (
                <span className="block text-[11px] opacity-80">
                  no active contract: {navStop.next.skipped.slice(0, 3).join(', ')}
                  {navStop.next.skipped.length > 3 ? ` +${navStop.next.skipped.length - 3}` : ''}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              disabled={!navStop.prev}
              onClick={() => navStop.prev && navigate(`/contracts/${navStop.prev.contractId}`)}
              title={navStop.prev
                ? `Previous unit · ${navStop.prev.unitNumber} — ${navStop.prev.customerName}`
                  + (navStop.prev.skipped.length ? `\n\nNo active contract: ${navStop.prev.skipped.join(', ')}` : '')
                : 'This is the first unit'}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronLeft size={15} />
              <span className="hidden sm:inline">{navStop.prev?.unitNumber ?? 'Prev'}</span>
            </button>
            <button
              type="button"
              disabled={!navStop.next}
              onClick={() => navStop.next && navigate(`/contracts/${navStop.next.contractId}`)}
              title={navStop.next
                ? `Next unit · ${navStop.next.unitNumber} — ${navStop.next.customerName}`
                  + (navStop.next.skipped.length ? `\n\nNo active contract: ${navStop.next.skipped.join(', ')}` : '')
                : 'This is the last unit'}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              <span className="hidden sm:inline">{navStop.next?.unitNumber ?? 'Next'}</span>
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>

      {/* The page body sits on one large white card against the cream page
          background. Navigation chrome (Back, unit arrows) stays outside it,
          and so do the modals, which are fixed overlays. */}
      <div className="bg-white dark:bg-gray-900 rounded-3xl p-5 sm:p-7 shadow-sm"
        style={{ border: '1px solid rgba(20,8,31,.06)' }}>

      {/* Title + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contract overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{c.contractNo}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { setError(''); setEditModal(true) }}>
            <PenLine size={14} /> Edit
          </Button>
          {['draft', 'pending_signature'].includes(c.status) && (
            <Button size="sm" variant="outline" onClick={() => { setSignError(''); setSigningInPerson(true) }}>
              <PenLine size={14} /> Sign in person
            </Button>
          )}
          {['draft', 'pending_signature'].includes(c.status) && (
            <Button size="sm" onClick={() => createSigningLink.mutate()} disabled={createSigningLink.isPending}>
              <PenLine size={14} /> {createSigningLink.isPending ? 'Generating…' : 'Send signing link'}
            </Button>
          )}
          {c.status === 'active' && isAdmin && (
            <Button size="sm" variant="outline" onClick={() => createSigningLink.mutate()} disabled={createSigningLink.isPending}>
              <PenLine size={14} /> {createSigningLink.isPending ? 'Generating…' : 'Allow re-sign'}
            </Button>
          )}
          {c.status === 'draft' && (
            <Button size="sm" variant="success" onClick={() => action.mutate('activate')} disabled={action.isPending}>
              <CheckCircle2 size={14} /> Activate
            </Button>
          )}
          {c.status === 'pending_signature' && (
            <Button size="sm" variant="success" onClick={() => action.mutate('mark-signed')} disabled={action.isPending}>
              <CheckCircle2 size={14} /> Mark as signed
            </Button>
          )}
          {['draft', 'pending_signature'].includes(c.status) && (
            <Button size="sm" variant="destructive"
              onClick={() => { if (confirm('Cancel this contract?')) action.mutate('cancel') }}
              disabled={action.isPending}>
              <XCircle size={14} /> Cancel
            </Button>
          )}
          {c.status === 'active' && (
            <Button size="sm" variant="destructive"
              onClick={() => { if (confirm('End this contract and free the unit?')) action.mutate('end') }}
              disabled={action.isPending}>
              End contract
            </Button>
          )}
          {['ended', 'cancelled'].includes(c.status) && (
            <Button size="sm" variant="destructive"
              onClick={() => { if (confirm('Permanently delete this contract and all its payments/invoices?')) deleteContract.mutate() }}
              disabled={deleteContract.isPending}>
              <Trash2 size={14} /> Delete
            </Button>
          )}
        </div>
      </div>

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

      {/* ── Main layout ── */}
      <div className="flex flex-col lg:flex-row gap-5 lg:items-start">
        {/* Left sidebar. Tinted, because a white card on the white page card
            would have no edge at all. */}
        <div className="w-full lg:w-80 lg:shrink-0 space-y-4">
          <Card className="bg-[#FBF8F3] dark:bg-gray-800/40">
            <CardBody className="space-y-4">
              {/* Avatar + name */}
              <div className="flex flex-col items-center text-center pt-2 pb-1">
                <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold mb-2 select-none">
                  {initials}
                </div>
                {c.customer?._id ? (
                  <button type="button"
                    onClick={() => { setCustomerError(''); setEditCustomerModal(true) }}
                    className="font-semibold text-base leading-tight hover:underline cursor-pointer"
                    title="View or edit tenant details">
                    {c.customer.fullName}
                  </button>
                ) : (
                  <span className="font-semibold text-base leading-tight">
                    {c.customer?.fullName}
                  </span>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">{c.contractNo}</p>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap justify-center">
                  <Badge tone={contractStatusTone[c.status]}>{statusLabel(c.status)}</Badge>
                  {daysLeft !== null && daysLeft >= 0 && (
                    <span className="text-xs text-muted-foreground">{daysLeft}d left</span>
                  )}
                </div>
              </div>

              {/* Contract detail rows — click a value to edit inline */}
              {(() => {
                // Asking Price now reflects the unit's actual (locked) price from
                // Settings → Unit Pricing, not a per-contract negotiated figure —
                // falls back to the stored contract rate for units priced before
                // that page existed.
                const unitsWithPrice = allUnits.filter((u) => u?.price != null)
                const askingPrice = unitsWithPrice.length
                  ? unitsWithPrice.reduce((s, u) => s + Number(u!.price ?? 0), 0)
                  : Number(c.rate || 0)
                const discountPct = Number((c as { firstMonthDiscountPct?: number }).firstMonthDiscountPct || 0)
                // null = derive from the asking rate; an explicit 0 shows as 0
                const leasedPrice = c.leasedPrice != null ? Number(c.leasedPrice) : Math.round(askingPrice * (1 - discountPct / 100) * 100) / 100
                const weeks = c.startDate && c.endDate
                  ? Math.ceil(Math.round((new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / 86400000) / 7)
                  : null
                const paidFromRecords = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
                // null = no override (derive from payments); any number, 0
                // included, is a deliberate manual figure and must display as-is
                const manualRcv = (c as any).manualReceived as number | null | undefined
                const collected = manualRcv != null ? Number(manualRcv) : paidFromRecords
                // The saved quotation is authoritative once set — a manual edit
                // must stick. Payments only stand in when no quotation exists.
                // Stored quotation is authoritative — 0 is a valid saved value;
                // only null (never set) falls back to the payments total
                const quotationShown = c.totalQuotation != null ? Number(c.totalQuotation) : paidFromRecords
                const remaining = Math.max(0, quotationShown - collected)

                const saveField = async (field: string, val: string) => {
                  const body: Record<string, unknown> = {}
                  if (field === 'weeks') {
                    const w = Number(val) || 0
                    if (w > 0 && c.startDate) {
                      const d = new Date(c.startDate)
                      d.setDate(d.getDate() + w * 7)
                      body.endDate = d.toISOString().slice(0, 10)
                    }
                  } else if (field === 'unitNumber') {
                    body.units = val.split(',').map(s => s.trim()).filter(Boolean)
                  } else if (field.includes('Date')) {
                    body[field] = val
                  } else {
                    body[field] = Number(val) || 0
                  }
                  try { await api.put(`/contracts/${id}`, body); invalidate() } catch (e) { setError(apiError(e)) }
                  setInlineField(null)
                }

                const startEdit = (field: string, raw: string) => { setInlineField(field); setInlineValue(raw) }

                const EditableRow = (label: string, field: string, display: string, raw: string, type = 'number', step = '0.01') => (
                  <div key={label} className="flex justify-between items-center py-2.5 gap-2 group">
                    <span className="text-muted-foreground shrink-0 text-sm">{label}</span>
                    {inlineField === field ? (
                      <input
                        autoFocus
                        type={type}
                        step={type === 'number' ? step : undefined}
                        className="w-36 text-right text-sm font-medium border-b border-primary bg-transparent outline-none px-1 py-0.5"
                        value={inlineValue}
                        onChange={(e) => setInlineValue(e.target.value)}
                        onBlur={() => saveField(field, inlineValue)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveField(field, inlineValue); if (e.key === 'Escape') setInlineField(null) }}
                      />
                    ) : (
                      <span
                        className="font-medium text-right text-sm flex items-center gap-1.5"
                        onDoubleClick={() => startEdit(field, raw)}
                        title="Double-click to edit"
                      >
                        {display}
                        <button type="button" onClick={() => startEdit(field, raw)} className="p-1 rounded hover:bg-muted text-muted-foreground/40 hover:text-primary transition-colors cursor-pointer">
                          <PenLine size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                )

                const Row = (label: string, value: React.ReactNode) => (
                  <div key={label} className="flex justify-between py-2 gap-3">
                    <span className="text-muted-foreground shrink-0 text-sm">{label}</span>
                    <span className="font-medium text-right text-sm">{value}</span>
                  </div>
                )

                return (
                  <div className="divide-y border-t text-[15px] pt-1">
                    {EditableRow('Check In', 'startDate', c.startDate ? formatDate(c.startDate) : '—', (c.startDate || '').slice(0, 10), 'date')}
                    {EditableRow('Check Out', 'endDate', c.endDate ? formatDate(c.endDate) : '—', (c.endDate || '').slice(0, 10), 'date')}
                    {EditableRow('Number of Weeks', 'weeks', String(weeks ?? '—'), String(weeks || ''), 'number', '1')}
                    {Row('Expiring In', daysLeft === null ? '—' : daysLeft < 0 ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`)}
                    {(() => {
                      const renewalIntent = c.renewalIntent || 'undecided'
                      const options: { value: string; label: string; activeClass: string }[] = [
                        { value: 'undecided', label: 'Undecided', activeClass: 'bg-white text-foreground shadow-sm dark:bg-white/10' },
                        { value: 'renewing', label: 'Renewing', activeClass: 'bg-emerald-500 text-white shadow-sm' },
                        { value: 'not_renewing', label: 'Not renewing', activeClass: 'bg-destructive text-white shadow-sm' },
                      ]
                      const cardCls =
                        renewalIntent === 'renewing'
                          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30'
                          : renewalIntent === 'not_renewing'
                          ? 'border-destructive/30 bg-destructive/5'
                          : 'border-border bg-muted/30'
                      return (
                        <div className={`my-2.5 rounded-xl border-2 px-3 py-2.5 ${cardCls}`}>
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <span className="shrink-0 text-sm font-bold">Renewal Status</span>
                            <div className="flex flex-wrap gap-1 rounded-full bg-black/5 dark:bg-white/5 p-1 self-start sm:self-auto">
                              {options.map((o) => (
                                <button
                                  key={o.value}
                                  type="button"
                                  disabled={updateContract.isPending}
                                  onClick={() => updateContract.mutate({ renewalIntent: o.value })}
                                  className={`h-7 px-2 sm:px-2.5 rounded-full text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors disabled:opacity-50 ${renewalIntent === o.value ? o.activeClass : 'bg-transparent text-muted-foreground hover:bg-muted'}`}
                                >
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {renewalIntent === 'renewing' && (
                            <div className="mt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg bg-emerald-100/70 dark:bg-emerald-900/40 px-2.5 py-1.5">
                              <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300">Tenant is renewing — update the new Check Out date</span>
                              <div className="flex items-center gap-3 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => createSigningLink.mutate()}
                                  disabled={createSigningLink.isPending}
                                  className="text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:underline cursor-pointer disabled:opacity-50"
                                >
                                  {createSigningLink.isPending ? 'Generating…' : 'Send agreement →'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => startEdit('endDate', (c.endDate || '').slice(0, 10))}
                                  className="text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:underline cursor-pointer"
                                >
                                  Extend →
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                    {/* Unit Number — custom dropdown picker */}
                    <div className="flex justify-between items-center py-2.5 gap-2 group">
                      <span className="text-muted-foreground shrink-0 text-sm">Unit Number</span>
                      {inlineField === 'unitNumber' ? (
                        <div className="relative">
                          <input
                            autoFocus
                            type="text"
                            placeholder="Search units…"
                            className="w-40 text-sm border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
                            value={inlineValue}
                            onChange={(e) => setInlineValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setInlineField(null) }}
                          />
                          <div className="absolute right-0 mt-1 w-56 max-h-48 overflow-y-auto bg-white dark:bg-gray-900 border rounded-lg shadow-lg z-50">
                            {unitOptions
                              .filter((u) => !inlineValue || u.unitNumber.toLowerCase().includes(inlineValue.toLowerCase()))
                              .slice(0, 30)
                              .map((u) => {
                                const selected = allUnits.some((au) => au._id === u._id)
                                return (
                                  <button
                                    key={u._id}
                                    type="button"
                                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center justify-between ${selected ? 'bg-primary/5 font-medium' : ''}`}
                                    onClick={async () => {
                                      const currentIds = allUnits.map((au) => au._id)
                                      const newIds = selected ? currentIds.filter((id) => id !== u._id) : [...currentIds, u._id]
                                      if (!newIds.length) return
                                      try { await api.put(`/contracts/${id}`, { units: newIds }); invalidate() } catch (e) { setError(apiError(e)) }
                                    }}
                                  >
                                    <span>{u.unitNumber} <span className="text-xs text-muted-foreground">{u.floor}{u.sizeSqf ? ` · ${u.sizeSqf}sqft` : ''}</span></span>
                                    {selected && <span className="text-primary text-xs">✓</span>}
                                  </button>
                                )
                              })}
                          </div>
                          <button type="button" onClick={() => setInlineField(null)} className="absolute -top-1 -right-6 p-0.5 text-muted-foreground hover:text-foreground">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <span
                          className="font-medium text-right text-sm flex items-center gap-1.5"
                          onDoubleClick={() => { setInlineField('unitNumber'); setInlineValue('') }}
                          title="Double-click to edit"
                        >
                          {allUnits.length ? allUnits.map((u) => u.unitNumber).join(', ') : '—'}
                          <button type="button" onClick={() => { setInlineField('unitNumber'); setInlineValue('') }} className="p-1 rounded hover:bg-muted text-muted-foreground/40 hover:text-primary transition-colors cursor-pointer">
                            <PenLine size={13} />
                          </button>
                        </span>
                      )}
                    </div>
                    {Row('Unit Size',
                      allUnits.some((u) => u?.sizeSqf != null)
                        ? `${allUnits.map((u) => (u?.sizeSqf != null ? u.sizeSqf : '—')).join(', ')} sq ft`
                        : '—')}
                    {Row('Asking Price', `AED ${formatMoney(askingPrice)}`)}
                    {EditableRow('Leased Price', 'leasedPrice', `AED ${formatMoney(leasedPrice)}`, String(leasedPrice), 'number', '1')}
                    {EditableRow('Total Quotation', 'totalQuotation', `AED ${formatMoney(quotationShown)}`, String(quotationShown), 'number', '1')}
                    {EditableRow('Received', 'manualReceived', `AED ${formatMoney(collected)}`, String(manualRcv ?? collected), 'number', '1')}
                    {Row('Remaining', <span className={remaining > 0 ? 'text-destructive' : 'text-emerald-600'}>AED {formatMoney(remaining)}</span>)}
                  </div>
                )
              })()}

              <div className="flex items-center gap-3 flex-wrap">
                <button type="button"
                  onClick={async () => {
                    setError('')
                    setActiveTab('notices')
                    try {
                      // Open the same agreement panel the Notices tab uses
                      const list = await api.get('/agreement-template')
                      const tpl = (list.data?.templates ?? []).find((t: { isDefault: boolean }) => t.isDefault)
                      const r = await api.get(`/contracts/${id}/agreement`)
                      const text = r.data?.text || ''
                      setNoticeOpen({ id: tpl?._id || 'agreement', name: tpl?.name || 'Agreement' })
                      setNoticeSent('')
                      setNoticeSignUrl('')
                      const html = /<\w+[^>]*>/.test(text)
                        ? text
                        : text.split('\n').map((l: string) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;') || '<br>'}</p>`).join('')
                      if (noticeRef.current) noticeRef.current.innerHTML = html
                      else noticeInitial.current = html
                    } catch (e) { setError(apiError(e)) }
                  }}
                  className="text-primary text-xs hover:underline flex items-center gap-1 cursor-pointer">
                  <PenLine size={12} /> Edit Agreement
                </button>
                {c.signedDocUrl && (
                  <a href={c.signedDocUrl} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline flex items-center gap-1">
                    <FileText size={12} /> View signed contract
                  </a>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Authorized persons */}
          {(c.authorizedPersons?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Authorized access" subtitle={`${c.authorizedPersons!.length} listed`} />
              <CardBody className="pt-0 space-y-2">
                {c.authorizedPersons!.map((p, i) => (
                  <div key={i} className="rounded-lg border px-3 py-2 space-y-0.5 text-sm">
                    <div className="font-medium">{p.name}</div>
                    {p.relation && <div className="text-xs text-muted-foreground">{p.relation}</div>}
                    {p.phone && <div className="text-xs text-muted-foreground">{p.phone}</div>}
                    {(p.idType || p.idNumber) && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <ShieldCheck size={10} /> {[p.idType, p.idNumber].filter(Boolean).join(': ')}
                      </div>
                    )}
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        {/* Right content */}
        <div className="flex-1 min-w-0">
          {/* Tabs */}
          <div className="flex gap-1 border-b mb-4 overflow-x-auto scrollbar-none">
            {([
              ['overview', 'Overview', 0],
              ['units', 'Units', 0],
              ['contracts', 'Contracts', 0],
              ['documents', 'Documents', 0],
              ['notices', 'Notices', 0],
              ['reminders', 'Reminders', 0],
              ['payments', 'Payments', unpaidGroups.length],
            ] as [typeof activeTab, string, number][]).map(([key, label, count]) => (
              <button key={key} onClick={() => setActiveTab(key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${activeTab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                  }`}
              >
                {label}
                {count > 0 && (
                  <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center ${activeTab === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* OVERVIEW */}
          {activeTab === 'overview' && (
            <div>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
                {/* Activity feed */}
                <Card>
                  <CardHeader title="Activity" subtitle="Most recent first" />
                  <CardBody className="pt-0 space-y-6">

                    {/* Add Note */}
                    <div style={BOX} className="p-3.5">
                      <div className="flex items-center justify-between mb-2.5">
                        <span style={SECTION_LABEL}>Add Note</span>
                        <MessageSquare size={14} style={{ color: MUTED }} />
                      </div>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          const input = e.currentTarget.elements.namedItem('noteText') as HTMLTextAreaElement
                          if (input.value.trim()) { addNote.mutate(input.value.trim()); input.value = '' }
                        }}
                        className="space-y-2"
                      >
                        <Textarea name="noteText" className="w-full resize-none" placeholder="Type a note or follow-up..." rows={2} />
                        <div className="flex justify-end">
                          <Button type="submit" disabled={addNote.isPending}>
                            {addNote.isPending ? 'Saving…' : 'Add note'}
                          </Button>
                        </div>
                      </form>
                    </div>

                    {/* Live alerts */}
                    {liveAlerts.length > 0 && (
                      <section>
                        <div style={SECTION_LABEL} className="mb-2.5">Live alerts</div>
                        <div className="space-y-2">
                          {liveAlerts.map((a) => (
                            <div key={a.id} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                              style={{
                                border: `1px solid ${a.tone === 'red' ? 'rgba(220,38,38,.22)' : 'rgba(217,119,6,.22)'}`,
                                background: a.tone === 'red' ? 'rgba(220,38,38,.05)' : 'rgba(217,119,6,.06)',
                              }}>
                              <AlertTriangle size={14} className="shrink-0"
                                style={{ color: a.tone === 'red' ? '#DC2626' : '#B45309' }} />
                              <span className="text-[12.5px] font-semibold flex-1 min-w-0" style={{ color: INK }}>{a.text}</span>
                              <Badge tone={a.tone === 'red' ? 'red' : 'amber'}>
                                {a.tone === 'red' ? 'Action needed' : 'Heads up'}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Timeline */}
                    <section>
                      <div style={SECTION_LABEL} className="mb-3">Timeline</div>
                      {activityEvents.length === 0 ? (
                        <EmptyState message="No activity yet — edits, quotes, contracts, and notices will appear here." />
                      ) : (
                        <div className="relative pl-6">
                          {/* rail */}
                          <div className="absolute top-1.5 bottom-1.5" style={{ left: 5, width: 2, background: HAIRLINE }} />
                          {(showAllActivity ? activityEvents : activityEvents.slice(0, Math.max(10, pinnedCount))).map((ev) => (
                            <div key={ev.id} className="relative pb-4 last:pb-0"
                              style={ev.pinned ? { background: '#FEF9C3', borderRadius: 10, padding: '8px 10px', marginBottom: 8 } : undefined}>
                              <span className="absolute rounded-full" style={{ left: ev.pinned ? -29 : -19, top: ev.pinned ? 13 : 5, width: 10, height: 10, background: ev.pinned ? '#CA8A04' : PURPLE }} />
                              <div className="text-[11.5px]" style={{ color: MUTED }}>
                                {ev.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                {ev.subtitle ? ` \u00b7 ${ev.subtitle.replace(/^[\s\u00b7]+/, '')}` : ''}
                              </div>
                              {ev.type === 'note' && editingNote?.idx === ev.noteIdx ? (
                                <div className="space-y-2 mt-1">
                                  <Textarea rows={2} value={editingNote!.text}
                                    onChange={(e) => setEditingNote({ idx: editingNote!.idx, text: e.target.value })} />
                                  <div className="flex gap-2">
                                    <Button size="sm" disabled={editNote.isPending || !editingNote!.text.trim()}
                                      onClick={() => editNote.mutate({ idx: editingNote!.idx, text: editingNote!.text.trim() })}>
                                      {editNote.isPending ? 'Saving…' : 'Save'}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setEditingNote(null)}>Cancel</Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-start justify-between gap-2 mt-0.5">
                                  <p className="text-[13px] font-medium leading-snug whitespace-pre-wrap break-words min-w-0"
                                    style={{ color: INK }}>
                                    {ev.type === 'email' && <Mail size={12} className="inline-block mr-1.5 -mt-0.5 text-amber-600" />}
                                    {ev.pinned && (
                                      <span className="text-[10px] font-bold uppercase tracking-wider mr-1.5" style={{ color: '#A16207' }}>Pinned</span>
                                    )}
                                    {ev.title}
                                  </p>
                                  <span className="flex items-center gap-1.5 shrink-0">
                                    {ev.type === 'note' && ev.noteIdx !== undefined && (
                                      <>
                                        <button type="button"
                                          title={ev.pinned ? 'Unpin this note' : 'Pin this note to the top'}
                                          onClick={() => pinNote.mutate({ idx: ev.noteIdx!, pinned: !ev.pinned })}
                                          className={`transition-colors cursor-pointer ${ev.pinned ? 'text-yellow-600' : 'text-muted-foreground/50 hover:text-foreground'}`}>
                                          <Pin size={12} fill={ev.pinned ? 'currentColor' : 'none'} />
                                        </button>
                                        <button type="button" title="Edit note"
                                          onClick={() => setEditingNote({ idx: ev.noteIdx!, text: ev.title })}
                                          className="text-muted-foreground/50 hover:text-foreground transition-colors cursor-pointer">
                                          <PenLine size={12} />
                                        </button>
                                        <button type="button" title="Delete note"
                                          onClick={() => { if (confirm('Delete this note?')) deleteNote.mutate(ev.noteIdx!) }}
                                          className="text-muted-foreground/50 hover:text-destructive transition-colors cursor-pointer">
                                          <Trash2 size={12} />
                                        </button>
                                      </>
                                    )}
                                    <Badge tone={activityBadgeTone[ev.type]}>{statusLabel(ev.type)}</Badge>
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                          {activityEvents.length > 10 && (
                            <button type="button" onClick={() => setShowAllActivity(!showAllActivity)}
                              className="w-full py-2.5 text-sm font-medium text-primary hover:underline cursor-pointer">
                              {showAllActivity ? 'Show less' : `Show more (${activityEvents.length - 10} older)`}
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                  </CardBody>
                </Card>

                {/* Right column */}
                <div className="space-y-4">
                  <Card>
                    <CardHeader title="Next payments" action={
                      allUnpaid.length > 1 ? <Button size="sm" variant="outline" onClick={() => setBulkTarget(allUnpaid)}><CalendarDays size={12} /> Pay multiple</Button> : null
                    } />
                    <CardBody className="pt-0 space-y-2">
                      {unpaidGroups.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-2">All paid</p>
                      ) : unpaidGroups.slice(0, 4).map((g) => {
                        const isOverdue = g.status === 'overdue'
                        const daysLateN = isOverdue ? Math.round((new Date().getTime() - g.earliestDue.getTime()) / 86400000) : 0
                        const isDueNow = !isOverdue && g.earliestDue <= new Date()
                        return (
                          <div key={g.invoiceId} className={`rounded-lg border px-3 py-2.5 ${isOverdue ? 'border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900/40' : 'border-border'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold">
                                  {g.earliestDue.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {g.latestDue.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">Due {g.earliestDue.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{isOverdue ? ` · ${daysLateN}d late` : ''}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-sm font-bold">{formatMoney(g.total - g.paidTotal)}</p>
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${isOverdue ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' : isDueNow ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' : 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                                  {isOverdue ? 'Overdue' : isDueNow ? 'Due now' : 'Upcoming'}
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader title="Documents" subtitle={documents.length > 0 ? `${documents.length} file${documents.length !== 1 ? 's' : ''}` : undefined}
                      action={<Button size="sm" variant="outline" onClick={() => setUploading(true)}><Upload size={12} /></Button>}
                    />
                    <CardBody className="pt-0 space-y-1">
                      {documents.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-2">No documents</p>
                      ) : documents.map((d) => (
                        <div key={d._id} className="flex items-center gap-2 py-1.5">
                          <FileText size={14} className="text-muted-foreground shrink-0" />
                          <span className="text-xs font-medium truncate flex-1">{d.name}</span>
                          {d.type && d.type !== 'other' && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{statusLabel(d.type)}</span>
                          )}
                          <a href={d.url} target="_blank" rel="noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                            <Download size={14} />
                          </a>
                        </div>
                      ))}
                    </CardBody>
                  </Card>
                </div>
              </div>
            </div>
          )}

          {/* UNITS */}
          {activeTab === 'units' && (() => {
            const GRID = '22px 95px 72px 88px 88px 65px 85px 85px 95px 90px 90px 160px'
            const iso = (v?: string | null) => (v ? String(v).slice(0, 10) : '')
            const num = (v: number | null | undefined) => (v == null ? '—' : formatMoney(v))
            const discountPct = Number(c.firstMonthDiscountPct || 0)
            const lines = (c.unitLines ?? []).map((l) => ({ ...l, unit: String(l.unit) }))
            const lineFor = (unitId: string) => lines.find((l) => l.unit === unitId)

            /** Merge one edit into the stored array, creating a line on first touch. */
            const saveLine = (unitId: string, patch: Partial<UnitLine>) => {
              const idx = lines.findIndex((l) => l.unit === unitId)
              const next: UnitLine[] = idx >= 0
                ? lines.map((l, i) => (i === idx ? { ...l, ...patch } : l))
                : [...lines, { unit: unitId, checkIn: null, checkOut: null, leaseRate: null, received: null, pending: null, ...patch }]
              saveUnitLines.mutate(next)
            }

            const rows = allUnits.map((u) => {
              const unitId = String(u._id)
              const line = lineFor(unitId)
              const checkIn = iso(line?.checkIn) || iso(c.startDate)
              const checkOut = iso(line?.checkOut) || iso(c.endDate)
              // No per-unit override: a single-unit contract uses the negotiated
              // leased price; a multi-unit one falls back to the unit's own
              // asking price with the contract's first-month discount applied.
              const leaseRate = line?.leaseRate != null
                ? Number(line.leaseRate)
                : allUnits.length === 1 && c.leasedPrice != null
                  ? Number(c.leasedPrice)
                  : u.price != null
                    ? Math.round(Number(u.price) * (1 - discountPct / 100) * 100) / 100
                    : null
              const weeks = checkIn && checkOut
                ? Math.max(1, Math.ceil(Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000) / 7))
                : 1
              // The lease figure is a MONTHLY rate billed weekly at rate ÷ 4
              const total = leaseRate == null ? 0 : Math.round((leaseRate / 4) * weeks * 100) / 100
              return { u, unitId, line, checkIn, checkOut, leaseRate, weeks, total }
            })

            const sumTotal = Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100
            const sumReceived = Math.round(rows.reduce((s, r) => s + Number(r.line?.received ?? 0), 0) * 100) / 100
            const sumPending = Math.round(rows.reduce((s, r) => s + Number(r.line?.pending ?? 0), 0) * 100) / 100
            // Same figure the Overview tab shows, so the two can be compared honestly
            const paidFromRecords = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
            const manualRcv = (c as { manualReceived?: number | null }).manualReceived
            const contractReceived = Math.round((manualRcv != null ? Number(manualRcv) : paidFromRecords) * 100) / 100
            const receivedMismatch = Math.abs(sumReceived - contractReceived) > 0.01

            const quoteRef = c.quote as { _id?: string; quoteNo?: string } | string | undefined
            const quoteNo = typeof quoteRef === 'object' && quoteRef ? quoteRef.quoteNo : undefined
            const hasQuote = Boolean(quoteRef)

            const allSelected = selectedUnits.length > 0 && selectedUnits.length === allUnits.length
            const removeUnitIds = (drop: string[]) => {
              const remaining = allUnits.map((u) => String(u._id)).filter((x) => !drop.includes(x))
              if (!remaining.length) { setUnitsError('A contract must keep at least one unit.'); return }
              setContractUnits.mutate(remaining)
            }

            return (
              <Card>
                <CardHeader
                  title="Units"
                  subtitle={`${allUnits.length} unit${allUnits.length === 1 ? '' : 's'} on this contract`}
                  action={selectedUnits.length > 0 ? (
                    <Button
                      size="sm" variant="outline"
                      disabled={allSelected || setContractUnits.isPending}
                      title={allSelected ? 'A contract must keep at least one unit' : 'Remove the selected units from this contract'}
                      onClick={() => {
                        if (!confirm(`Remove ${selectedUnits.length} unit(s) from this contract?`)) return
                        removeUnitIds(selectedUnits)
                      }}
                    >
                      <Trash2 size={13} /> Remove selected
                    </Button>
                  ) : undefined}
                />
                <CardBody className="pt-0">
                  {unitsError && (
                    <p className="text-xs text-destructive mb-2">{unitsError}</p>
                  )}
                  {allUnits.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No units on this contract.</p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <div style={{ minWidth: 1140 }}>
                        {/* Header */}
                        <div style={{
                          display: 'grid', gridTemplateColumns: GRID, gap: 14,
                          fontSize: 13, fontWeight: 700, color: INK,
                          borderBottom: '1px solid rgba(20,8,31,.16)', padding: '0 6px 8px',
                        }}>
                          <div />
                          <div />
                          <div>Type</div>
                          <div>Check In</div>
                          <div>Check Out</div>
                          <div style={{ textAlign: 'right' }}>Asking</div>
                          <div style={{ textAlign: 'right' }}>Lease</div>
                          <div style={{ textAlign: 'right' }}>Weeks</div>
                          <div style={{ textAlign: 'right' }}>Total</div>
                          <div style={{ textAlign: 'right' }}>Received</div>
                          <div style={{ textAlign: 'right' }}>Pending</div>
                          <div>Next Booking</div>
                        </div>

                        {/* Rows */}
                        {rows.map(({ u, unitId, line, checkIn, checkOut, leaseRate, weeks, total }) => {
                          const shared = Boolean(u.shared)
                          const booking = unitBookings[unitId]
                          const selected = selectedUnits.includes(unitId)
                          const weekOptions = Array.from({ length: 52 }, (_, i) => i + 1)
                          if (weeks > 52) weekOptions.push(weeks)
                          return (
                            <div key={unitId} style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                              <div style={{
                                display: 'grid', gridTemplateColumns: GRID, gap: 14,
                                padding: '7px 6px', fontSize: 13, alignItems: 'center', color: INK,
                              }}>
                                {/* 1 · select */}
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={(e) => setSelectedUnits((prev) => (
                                    e.target.checked ? [...prev, unitId] : prev.filter((x) => x !== unitId)
                                  ))}
                                  style={{ width: 14, height: 14, cursor: 'pointer' }}
                                />

                                {/* 2 · unit */}
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span style={{ fontWeight: 700 }}>{u.unitNumber}</span>
                                  {c.status === 'draft' && (
                                    <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: 10, padding: '1px 6px', borderRadius: 999, fontWeight: 700 }}>
                                      Draft
                                    </span>
                                  )}
                                </div>

                                {/* 3 · type — click to toggle shared/private */}
                                <span
                                  onClick={() => {
                                    if (toggleUnitShared.isPending) return
                                    toggleUnitShared.mutate({ unitId, shared: !shared })
                                  }}
                                  title={`Click to make this unit ${shared ? 'private' : 'shared'}`}
                                  style={{
                                    cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '2px 8px',
                                    borderRadius: 999, textTransform: 'capitalize', justifySelf: 'start',
                                    background: shared ? 'rgba(217,119,6,.12)' : 'rgba(91,43,201,.10)',
                                    color: shared ? '#B45309' : PURPLE,
                                  }}
                                >
                                  {shared ? 'shared' : 'private'}
                                </span>

                                {/* 4 · check in */}
                                <UnitCellEdit
                                  type="date" value={checkIn}
                                  display={checkIn ? formatDate(checkIn) : '—'}
                                  onSave={(v) => saveLine(unitId, { checkIn: v || null })}
                                />

                                {/* 5 · check out */}
                                <UnitCellEdit
                                  type="date" value={checkOut}
                                  display={checkOut ? formatDate(checkOut) : '—'}
                                  onSave={(v) => saveLine(unitId, { checkOut: v || null })}
                                />

                                {/* 6 · asking (read-only) */}
                                <div style={{ textAlign: 'right', color: MUTED }}>{num(u.price)}</div>

                                {/* 7 · lease */}
                                <UnitCellEdit
                                  type="number" right color="#4A4357"
                                  value={leaseRate == null ? '' : String(leaseRate)}
                                  display={num(leaseRate)}
                                  onSave={(v) => saveLine(unitId, { leaseRate: v === '' ? null : Number(v) })}
                                />

                                {/* 8 · weeks */}
                                <select
                                  value={weeks}
                                  onChange={(e) => {
                                    const w = Number(e.target.value)
                                    const base = checkIn || iso(c.startDate)
                                    if (!base) { setUnitsError('Set a check-in date before choosing a number of weeks.'); return }
                                    const end = new Date(base)
                                    end.setDate(end.getDate() + w * 7)
                                    saveLine(unitId, { checkIn: base, checkOut: end.toISOString().slice(0, 10) })
                                  }}
                                  style={{
                                    height: 26, width: '100%', textAlign: 'right', fontSize: 12,
                                    border: `1px solid ${HAIRLINE}`, borderRadius: 6, background: '#fff', color: INK,
                                  }}
                                >
                                  {weekOptions.map((w) => <option key={w} value={w}>{w}</option>)}
                                </select>

                                {/* 9 · total */}
                                <div style={{ textAlign: 'right', fontWeight: 700 }}>{formatMoney(total)}</div>

                                {/* 10 · received */}
                                <UnitCellEdit
                                  type="number" right color="#16A34A"
                                  value={line?.received == null ? '' : String(line.received)}
                                  display={num(line?.received)}
                                  onSave={(v) => saveLine(unitId, { received: v === '' ? null : Number(v) })}
                                />

                                {/* 11 · pending */}
                                <UnitCellEdit
                                  type="number" right color="#DC2626"
                                  value={line?.pending == null ? '' : String(line.pending)}
                                  display={num(line?.pending)}
                                  onSave={(v) => saveLine(unitId, { pending: v === '' ? null : Number(v) })}
                                />

                                {/* 12 · next booking */}
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {booking ? (
                                    <span
                                      title={booking.customerName || undefined}
                                      style={{ background: 'rgba(217,119,6,.12)', color: '#B45309', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                    >
                                      {booking.contractNo} · {new Date(booking.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                    </span>
                                  ) : (
                                    <span style={{ background: 'rgba(22,163,74,.12)', color: '#16A34A', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
                                      Available
                                    </span>
                                  )}
                                  {allUnits.length > 1 && (
                                    <svg
                                      width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#DC2626"
                                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                      style={{ cursor: 'pointer', flexShrink: 0 }}
                                      role="button"
                                      aria-label={`Remove unit ${u.unitNumber}`}
                                      onClick={() => {
                                        if (!confirm(`Remove unit ${u.unitNumber} from this contract?`)) return
                                        removeUnitIds([unitId])
                                      }}
                                    >
                                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                      <path d="M10 11v6M14 11v6" />
                                    </svg>
                                  )}
                                </div>
                              </div>

                              {/* Draft contracts: the mockup's per-unit "send quote" CTA has no
                                  equivalent action here, so link to the linked quote instead. */}
                              {c.status === 'draft' && hasQuote && (
                                <div
                                  onClick={() => navigate('/quotes')}
                                  style={{ color: PURPLE, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '0 6px 7px' }}
                                >
                                  View linked quote{quoteNo ? ` ${quoteNo}` : ''} →
                                </div>
                              )}
                            </div>
                          )
                        })}

                        {/* Totals */}
                        <div style={{
                          display: 'grid', gridTemplateColumns: GRID, gap: 14,
                          padding: '10px 6px 0', fontSize: 13, fontWeight: 700, color: INK,
                        }}>
                          <div /><div /><div /><div /><div /><div /><div />
                          <div style={{ textAlign: 'right', color: MUTED, fontWeight: 400 }}>Totals</div>
                          <div style={{ textAlign: 'right' }}>{formatMoney(sumTotal)}</div>
                          <div style={{ textAlign: 'right', color: '#16A34A' }}>{formatMoney(sumReceived)}</div>
                          <div style={{ textAlign: 'right', color: '#DC2626' }}>{formatMoney(sumPending)}</div>
                          <div />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* These rows are a per-unit breakdown only — they never write back
                      to the contract's own leasedPrice / manualReceived figures. */}
                  {receivedMismatch && allUnits.length > 0 && (
                    <p className="text-xs mt-3" style={{ color: MUTED }}>
                      Per-unit Received ({formatMoney(sumReceived)}) doesn’t match the contract total
                      ({formatMoney(contractReceived)}) shown on Overview. These rows are a breakdown
                      only — nothing here is synced back to the contract.
                    </p>
                  )}
                </CardBody>
              </Card>
            )
          })()}

          {/* PAYMENTS */}
          {activeTab === 'payments' && (
            <div className="space-y-4">
            <Card>
              <CardHeader title="Invoices"
                action={
                  <div className="flex items-center gap-2">
                    {/* Invoices are raised in Zoho Books — it is the accounting
                        source of truth. The local composer stays reachable
                        because this contract's payment schedule and reminders
                        are driven by local invoice records, not Zoho ones. */}
                    <Button size="sm" variant="outline"
                      onClick={() => {
                        const url = zohoInvoices.data?.newInvoiceUrl
                        if (url) window.open(url, '_blank', 'noopener')
                        else setShowInvoiceModal(true)
                      }}
                      title={zohoInvoices.data?.newInvoiceUrl
                        ? 'Opens Zoho Books to raise the invoice there'
                        : 'Zoho Books unavailable — opens the local invoice form'}>
                      <FilePlus size={13} /> Create Invoice
                    </Button>
                    <button type="button"
                      onClick={() => setShowInvoiceModal(true)}
                      className="text-[12px] underline cursor-pointer"
                      style={{ color: MUTED }}
                      title="Create an invoice inside PurpleBox — this is what drives the payment schedule and reminders below">
                      Local invoice
                    </button>
                  </div>
                }
              />
              {/* Invoice list */}
              {invoiceGroups.length === 0 ? (
                <CardBody><p className="text-sm text-muted-foreground text-center py-6">No invoices yet. Click <strong>Create Invoice</strong> to generate one.</p></CardBody>
              ) : (
                <div className="divide-y">
                  {invoiceGroups.map((g, i) => {
                    const isPaid = g.status === 'paid'
                    const balance = g.total - g.paidTotal
                    return (
                      <div key={g.invoiceId} className="mx-4 my-3 rounded-xl border cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => navigate(`/invoices/${g.invoiceId}`)}>
                        <div className="flex items-center justify-between gap-3 px-4 py-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-primary/10 text-primary'}`}>
                              {isPaid ? '✓' : i + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="text-base font-bold text-primary">{g.invoiceRef.invoiceNo}</p>
                              <p className="text-sm text-muted-foreground">{g.periodLabel}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className="text-base font-bold">{formatMoney(g.total)} AED</p>
                              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full inline-block mt-1 ${isPaid ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                                }`}>
                                {isPaid ? 'Paid' : `Pending · ${formatMoney(balance)}`}
                              </span>
                            </div>
                            <button type="button" title="Delete"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (confirm(`Delete invoice ${g.invoiceRef.invoiceNo}?`)) deleteInvoice.mutate(g.invoiceId)
                              }}
                              disabled={deleteInvoice.isPending}
                              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer disabled:opacity-50">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>

            {/* Zoho Books — everything billed to this person in the accounting
                system, matched on email/phone. Read-only: Zoho is the source of
                truth for these, so nothing here edits them. */}
            <Card>
              <CardHeader
                title="Zoho Books invoices"
                subtitle="Matched to this tenant by email or phone number, not by name"
              />
              <CardBody className="pt-0">
                {zohoInvoices.isLoading ? (
                  <p className="text-sm text-muted-foreground py-4">Looking up Zoho Books…</p>
                ) : zohoInvoices.isError ? (
                  (() => {
                    const status = (zohoInvoices.error as { response?: { status?: number } })?.response?.status
                    const msg = (zohoInvoices.error as { response?: { data?: { error?: string } } })?.response?.data?.error
                    return (
                      <p className="text-sm text-muted-foreground py-4">
                        {status === 501
                          ? 'Zoho Books is not connected — add its credentials in Settings to see invoices here.'
                          : status === 404
                            ? 'This lookup is not available on the API yet — the server needs to be redeployed.'
                            : `Could not reach Zoho Books${status ? ` (HTTP ${status})` : ''}: ${msg || 'no error message returned'}`}
                      </p>
                    )
                  })()
                ) : !zohoInvoices.data?.matchedContacts?.length ? (
                  <p className="text-sm text-muted-foreground py-4">
                    No Zoho Books contact matches this tenant&apos;s email or phone number
                    {c.customer.email || c.customer.phone ? '' : ' — this tenant has neither on file'}.
                  </p>
                ) : (
                  <>
                    {/* Which Zoho contact(s) matched, and how. The names differ
                        by design, so show what was matched instead of hiding it. */}
                    <div className="flex flex-wrap items-center gap-1.5 pb-3">
                      {zohoInvoices.data.matchedContacts.map((m) => (
                        <span key={m.id} className="text-[11px] rounded-full px-2 py-0.5 border"
                          style={{ borderColor: 'rgba(20,8,31,.16)', color: MUTED }}
                          title={`Matched by ${m.matchedBy}: ${m.matchedBy === 'email' ? m.email : m.phone}`}>
                          {m.name || '(unnamed)'} · matched by {m.matchedBy}
                        </span>
                      ))}
                      {zohoInvoices.data.matchedContacts.length > 1 && (
                        <span className="text-[11px] text-amber-700">
                          {zohoInvoices.data.matchedContacts.length} Zoho contacts share these details — invoices from all of them are shown
                        </span>
                      )}
                    </div>

                    {zohoInvoices.data.invoices.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-3">This contact has no invoices in Zoho Books.</p>
                    ) : (
                      <>
                        {zohoPdfError && (
                          <p className="text-[12px] text-destructive pb-2">{zohoPdfError}</p>
                        )}
                        <div className="overflow-x-auto">
                          <div style={{ minWidth: multipleZohoContacts ? 720 : 560 }}>
                            <div className="grid gap-3 pb-2 text-[13px] font-bold"
                              style={{ gridTemplateColumns: zohoCols, borderBottom: '1px solid rgba(20,8,31,.16)' }}>
                              <span>Invoice</span><span>Date</span><span>Due</span><span>Status</span>
                              {multipleZohoContacts && <span>Billed to</span>}
                              <span className="text-right">Total</span><span className="text-right">Balance</span>
                            </div>
                            {zohoInvoices.data.invoices.map((inv) => (
                              <div key={inv.id} className="grid gap-3 items-center py-2 text-[13px]"
                                style={{ gridTemplateColumns: zohoCols, borderBottom: '1px solid rgba(20,8,31,.06)' }}>
                                <button type="button"
                                  onClick={() => openZohoInvoicePdf(inv.id)}
                                  disabled={openingZohoPdf === inv.id}
                                  className="font-semibold text-left text-primary hover:underline cursor-pointer disabled:opacity-60"
                                  title="Open this invoice's PDF from Zoho Books">
                                  {openingZohoPdf === inv.id ? 'Opening…' : (inv.number || '—')}
                                </button>
                                <span style={{ color: MUTED }}>{inv.date ? formatDate(inv.date) : '—'}</span>
                                <span style={{ color: MUTED }}>{inv.dueDate ? formatDate(inv.dueDate) : '—'}</span>
                                <span>
                                  <span className="text-[10px] font-bold rounded-full px-2 py-0.5 capitalize"
                                    style={
                                      inv.status === 'paid' ? { background: '#DCFCE7', color: '#15803D' }
                                        : inv.status === 'overdue' ? { background: '#FEE2E2', color: '#B91C1C' }
                                          : { background: 'rgba(20,8,31,.06)', color: MUTED }
                                    }>
                                    {inv.status || 'unknown'}
                                  </span>
                                </span>
                                {multipleZohoContacts && (
                                  <span className="truncate" style={{ color: MUTED }} title={inv.customerName}>
                                    {inv.customerName || '—'}
                                  </span>
                                )}
                                <span className="text-right">{inv.currency || 'AED'} {formatMoney(inv.total)}</span>
                                <span className="text-right font-bold" style={{ color: inv.balance > 0 ? '#DC2626' : '#16A34A' }}>
                                  {formatMoney(inv.balance)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-5 pt-3 text-[13px]">
                          <span style={{ color: MUTED }}>{zohoInvoices.data.totals.count} invoice{zohoInvoices.data.totals.count === 1 ? '' : 's'}</span>
                          <span>Total <strong>{formatMoney(zohoInvoices.data.totals.total)}</strong></span>
                          <span>Outstanding <strong style={{ color: zohoInvoices.data.totals.balance > 0 ? '#DC2626' : '#16A34A' }}>
                            {formatMoney(zohoInvoices.data.totals.balance)}</strong></span>
                        </div>
                        <p className="text-[11.5px] pt-2" style={{ color: MUTED }}>
                          Click an invoice number to open its PDF. These are the tenant&apos;s Zoho Books invoices across all their contracts, not only this one — Zoho is the source of truth, so edit them there.
                        </p>
                      </>
                    )}
                  </>
                )}
              </CardBody>
            </Card>
            </div>
          )}

          {activeTab === 'contracts' && (
            <Card>
              <CardHeader
                title={`Contracts for ${c.customer.fullName}`}
                subtitle="Every contract this tenant has had, newest first"
              />
              <CardBody className="pt-0">
                {rowError && (
                  <p className="text-[12px] text-destructive pb-2">{rowError}</p>
                )}

                <div className="flex justify-end mb-2.5">
                  <button type="button"
                    onClick={() => navigate(`/contracts/new?customer=${c.customer._id}`)}
                    className="h-8 px-3.5 rounded-full text-white text-xs font-bold cursor-pointer hover:opacity-90"
                    style={{ background: PURPLE }}>
                    + Add contract
                  </button>
                </div>

                {tenantContracts.isLoading ? (
                  <p className="text-sm text-muted-foreground py-4">Loading…</p>
                ) : tenantContracts.isError ? (
                  <p className="text-sm text-muted-foreground py-4">Could not load this tenant&apos;s contracts.</p>
                ) : !tenantContracts.data?.length ? (
                  <p className="text-sm text-muted-foreground py-4">No contracts for this tenant yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <div style={{ minWidth: 720 }}>
                      <div className="grid items-center pb-2"
                        style={{ gridTemplateColumns: '1fr 170px 150px 1fr', padding: '0 6px 8px', borderBottom: '1px solid rgba(20,8,31,.14)' }}>
                        <span style={SECTION_LABEL}>Units</span>
                        <span style={SECTION_LABEL}>Contract No.</span>
                        <span style={SECTION_LABEL}>Status</span>
                        <span style={{ ...SECTION_LABEL, textAlign: 'right' }}>Actions</span>
                      </div>

                      {tenantContracts.data.map((t) => {
                        const isCurrent = t._id === c._id
                        const unitsLabel = (t.units?.length ? t.units : t.unit ? [t.unit] : [])
                          .map((u) => u?.unitNumber).filter(Boolean).join(', ') || '—'
                        // Which actions apply is decided by status, the same
                        // way the server gates them — offering "End contract"
                        // on a draft would just produce a 409.
                        const canCreate = t.status === 'draft'
                        const canMarkSigned = t.status === 'pending_signature'
                        const canEnd = t.status === 'active'
                        const busy = rowAction.isPending || rowDelete.isPending
                        const act = 'text-[12px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
                        return (
                          <div key={t._id} className="grid items-center"
                            style={{ gridTemplateColumns: '1fr 170px 150px 1fr', padding: '11px 6px', borderBottom: '1px solid rgba(20,8,31,.06)' }}>
                            <span className="font-bold text-[13px]">{unitsLabel}</span>
                            <span className="text-[13px] flex items-center gap-1.5" style={{ color: '#4A4357' }}>
                              {t.contractNo}
                              {isCurrent && (
                                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: PURPLE }}>viewing</span>
                              )}
                            </span>
                            <span>
                              <Badge tone={contractStatusTone[t.status] ?? 'gray'}>{statusLabel(t.status)}</Badge>
                            </span>
                            <span className="flex justify-end gap-3 flex-wrap items-center">
                              {t.signedDocUrl && (
                                <>
                                  <a href={t.signedDocUrl} target="_blank" rel="noopener noreferrer"
                                    title="Open the signed contract"
                                    className="text-[12px] font-bold hover:underline" style={{ color: PURPLE }}>
                                    Signed
                                  </a>
                                  <a href={downloadUrlFor(t.signedDocUrl)} target="_blank" rel="noopener noreferrer"
                                    title="Download the signed contract"
                                    className="text-muted-foreground/60 hover:text-foreground transition-colors">
                                    <Download size={13} />
                                  </a>
                                </>
                              )}
                              {canCreate && (
                                <button type="button" disabled={busy} className={act} style={{ color: PURPLE }}
                                  onClick={() => rowAction.mutate({ contractId: t._id, path: 'create-signing-link' })}>
                                  Create contract &amp; send to sign
                                </button>
                              )}
                              {canMarkSigned && (
                                <button type="button" disabled={busy} className={act} style={{ color: '#16A34A' }}
                                  onClick={() => rowAction.mutate({ contractId: t._id, path: 'mark-signed' })}>
                                  Mark as signed
                                </button>
                              )}
                              {canEnd && (
                                <button type="button" disabled={busy} className={act} style={{ color: '#DC2626' }}
                                  onClick={() => {
                                    if (confirm(`End contract ${t.contractNo}? This releases its unit.`)) {
                                      rowAction.mutate({ contractId: t._id, path: 'end' })
                                    }
                                  }}>
                                  End contract
                                </button>
                              )}
                              <button type="button" disabled={busy} className={act} style={{ color: '#DC2626' }}
                                onClick={() => {
                                  if (confirm(`Delete contract ${t.contractNo}? This cannot be undone.`)) {
                                    // Deleting the contract you are on leaves
                                    // nowhere to return to, so go to the list.
                                    if (isCurrent) { rowDelete.mutate(t._id, { onSuccess: () => navigate('/contracts') }) }
                                    else rowDelete.mutate(t._id)
                                  }
                                }}>
                                Delete
                              </button>
                              <button type="button" disabled={isCurrent} className={act} style={{ color: PURPLE }}
                                title={isCurrent ? 'You are on this contract' : 'Open this contract'}
                                onClick={() => navigate(`/contracts/${t._id}`)}>
                                Review
                              </button>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {/* Renewal history lives here rather than in the sidebar: it
                    is a record of this contract's term changing, which belongs
                    with the contract list, not beside the status toggle. */}
                {(c.renewalHistory?.length ?? 0) > 0 && (
                  <div className="mt-6">
                    <div style={SECTION_LABEL} className="mb-2">Renewal history</div>
                    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(20,8,31,.08)' }}>
                      {[...(c.renewalHistory ?? [])].reverse().map((h, i) => (
                        <div key={i}
                          className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-[13px]"
                          style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(20,8,31,.06)' }}>
                          <span>
                            <span style={{ color: MUTED }}>Check out</span>{' '}
                            <span className="font-semibold">{formatDate(h.previousEndDate)}</span>
                            <span style={{ color: MUTED }}> → </span>
                            <span className="font-semibold">{formatDate(h.newEndDate)}</span>
                          </span>
                          <span className="text-[11.5px]" style={{ color: MUTED }}>
                            {h.author || 'unknown'}{h.at ? ` · ${formatDate(h.at)}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* DOCUMENTS */}
          {/* REMINDERS — per-contract overrides on top of Settings → Automation */}
          {activeTab === 'reminders' && (
            <Card>
              <CardHeader title="Reminders" subtitle="Defaults come from Settings → Automation — override them for this tenant here" />
              <CardBody className="pt-0 space-y-4">
                {/* Master switch */}
                <div className="rounded-xl border p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm">All reminders for this contract</div>
                    <div className="text-[11.5px] text-muted-foreground mt-0.5">
                      {(c as any).remindersMuted
                        ? 'Muted — this tenant receives no automatic reminders.'
                        : 'Active — payment reminders and automations run as configured.'}
                    </div>
                  </div>
                  <button type="button"
                    onClick={() => updateContract.mutate({ remindersMuted: !(c as any).remindersMuted })}
                    className={`h-8 px-4 rounded-full text-xs font-bold cursor-pointer transition-colors ${(c as any).remindersMuted ? 'bg-destructive/10 text-destructive' : 'bg-emerald-100 text-emerald-700'}`}>
                    {(c as any).remindersMuted ? 'Muted — click to enable' : 'Active — click to mute'}
                  </button>
                </div>

                {/* Per-rule overrides */}
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Rules · defaults from <a href="/settings/automation" className="text-primary hover:underline">Settings → Automation</a>
                  </div>
                  {automationRules.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No automation rules configured yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {automationRules.map((rule) => {
                        const override = ((c as any).reminderOverrides as { rule: string; enabled: boolean }[] | undefined)
                          ?.find((o) => String(o.rule) === rule._id)
                        const mode = override ? (override.enabled ? 'on' : 'off') : 'default'
                        const setMode = (next: 'default' | 'on' | 'off') => {
                          const others = (((c as any).reminderOverrides as { rule: string; enabled: boolean }[] | undefined) ?? [])
                            .filter((o) => String(o.rule) !== rule._id)
                            .map((o) => ({ rule: String(o.rule), enabled: o.enabled }))
                          const nextOverrides = next === 'default' ? others : [...others, { rule: rule._id, enabled: next === 'on' }]
                          updateContract.mutate({ reminderOverrides: nextOverrides })
                        }
                        const stepsLabel = (rule.steps ?? [])
                          .map((st) => st.immediate ? 'immediately' : `${st.value}d ${st.direction} ${rule.relativeLabel || 'due date'}`)
                          .join(', ')
                        return (
                          <div key={rule._id} className="rounded-xl border p-3.5 flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                              <div className="font-semibold text-sm flex items-center gap-2">
                                {rule.name}
                                <span className={`text-[9.5px] font-bold uppercase rounded px-1.5 py-0.5 ${rule.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
                                  default {rule.enabled ? 'on' : 'off'}
                                </span>
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {rule.triggerLabel || ''}{stepsLabel ? ` · ${stepsLabel}` : ''}
                              </div>
                            </div>
                            <div className="flex rounded-lg border overflow-hidden shrink-0">
                              {([['default', 'Default'], ['on', 'On'], ['off', 'Off']] as const).map(([key, label]) => (
                                <button key={key} type="button" onClick={() => setMode(key)}
                                  className={`px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${mode === key
                                    ? key === 'off' ? 'bg-destructive text-white' : key === 'on' ? 'bg-emerald-600 text-white' : 'bg-primary text-primary-foreground'
                                    : 'bg-white text-muted-foreground hover:bg-muted/50'}`}>
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-3">
                    Default follows the global rule setting. On / Off pins the rule for this contract only.
                  </p>
                </div>
              </CardBody>
            </Card>
          )}

          {/* NOTICES — every saved template, prefilled for this tenant on click */}
          {activeTab === 'notices' && (
            <Card>
              <CardHeader title="Notices" subtitle="Click a template — it opens prefilled with this contract's details, ready to edit and send" />
              <CardBody className="pt-0">
                {noticeTemplates.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No templates yet — design them under Admin → Agreement Template.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {noticeTemplates.map((t) => (
                      <button key={t._id} type="button"
                        disabled={noticeBusy === `open-${t._id}`}
                        onClick={async () => {
                          setNoticeBusy(`open-${t._id}`)
                          setError('')
                          try {
                            const r = await api.get(`/contracts/${id}/notice/${t._id}`)
                            const text = r.data?.text || ''
                            setNoticeOpen({ id: t._id, name: r.data?.name || t.name })
                            setNoticeSent('')
                            setNoticeSignUrl('')
                            const html = /<\w+[^>]*>/.test(text)
                              ? text
                              : text.split('\n').map((l: string) => `<p>${l || '<br>'}</p>`).join('')
                            if (noticeRef.current) noticeRef.current.innerHTML = html
                            else noticeInitial.current = html
                          } catch (e) { setError(apiError(e)) } finally { setNoticeBusy('') }
                        }}
                        className="rounded-xl border p-4 text-left hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer disabled:opacity-60">
                        <div className="font-semibold text-sm flex items-center gap-2">
                          <FileText size={14} className="text-primary shrink-0" />
                          <span className="break-words">{t.name}</span>
                          {t.isDefault && <span className="text-[9.5px] font-bold uppercase bg-primary/10 text-primary rounded px-1.5 py-0.5 shrink-0">Agreement</span>}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1.5">
                          {noticeBusy === `open-${t._id}` ? 'Preparing…' : `Generate for ${c.customer?.fullName || 'tenant'}`}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {activeTab === 'documents' && (
            <Card>
              <CardHeader title="Documents"
                action={<Button size="sm" variant="outline" onClick={() => setUploading(true)}><Upload size={13} /> Upload</Button>} />
              <CardBody className="pt-0 space-y-6">

                {/* ── A. Identity documents ──────────────────────────────── */}
                <section>
                  <div style={SECTION_LABEL} className="mb-2.5">Identity documents</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {identitySlots.map((slot) => {
                      const doc = documents.find((d) => d.type === slot.type)
                      return (
                        <div key={slot.type} style={BOX} className="p-3.5 space-y-2.5">
                          <div className="text-[12.5px] font-semibold" style={{ color: INK }}>{slot.label}</div>
                          {doc && (
                            <div className="flex items-center gap-2 rounded-lg px-2.5 py-2"
                              style={{ background: '#DCFCE7', color: '#15803D' }}>
                              <CheckCircle2 size={13} className="shrink-0" />
                              <a href={doc.url} target="_blank" rel="noreferrer"
                                className="text-[12px] font-semibold truncate flex-1 hover:underline">
                                {doc.name}
                              </a>
                              <button type="button"
                                onClick={() => { if (confirm(`Remove ${doc.name}?`)) removeDoc(doc._id) }}
                                disabled={docBusy === doc._id}
                                className="text-[11px] font-bold shrink-0 cursor-pointer disabled:opacity-50"
                                style={{ color: '#DC2626' }}>
                                {docBusy === doc._id ? 'Removing…' : 'Remove'}
                              </button>
                            </div>
                          )}
                          <label
                            className="flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors hover:bg-[#5B2BC9]/5"
                            style={{ border: `1px solid ${PURPLE}`, color: PURPLE, opacity: docBusy === slot.type ? 0.55 : 1 }}>
                            <Upload size={12} />
                            {docBusy === slot.type ? 'Uploading…' : `Upload ${slot.label}`}
                            <input type="file" className="hidden" disabled={docBusy === slot.type}
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                e.target.value = ''
                                if (f) uploadDoc(f, slot.type, slot.label)
                              }} />
                          </label>
                        </div>
                      )
                    })}
                  </div>
                </section>

                {/* ── B. Signed contracts ────────────────────────────────── */}
                <section>
                  <div style={SECTION_LABEL} className="mb-2.5">Signed contracts</div>
                  {signedContractDocs.length === 0 ? (
                    <div className="px-3.5 py-4 text-[12px]" style={{ ...BOX, color: MUTED }}>
                      No signed contracts yet — a copy lands here automatically once one is signed.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {signedContractDocs.map((d) => (
                        <div key={d._id} style={BOX} className="flex items-center justify-between gap-3 px-3.5 py-3">
                          <div className="min-w-0">
                            <a href={d.url} target="_blank" rel="noreferrer"
                              className="text-[13px] font-bold truncate block hover:underline" style={{ color: INK }}>
                              {allUnits.length ? `Unit ${allUnits.map((u) => u.unitNumber).join(', ')}` : 'Storage unit'}
                            </a>
                            <div className="text-[11.5px]" style={{ color: MUTED }}>{c.contractNo}</div>
                          </div>
                          <span className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                            style={{ background: '#DCFCE7', color: '#15803D' }}>
                            Signed copy on file
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* ── C. Other documents ─────────────────────────────────── */}
                <section>
                  <div style={SECTION_LABEL} className="mb-2.5">Other documents</div>

                  <div style={BOX} className="p-3.5 flex flex-col sm:flex-row sm:items-end gap-3">
                    <Field label="Document title" className="flex-1 min-w-0">
                      <Select value={otherTitle} onChange={(e) => setOtherTitle(e.target.value)}>
                        <option value="">Select a title…</option>
                        {OTHER_DOC_TITLES.map((t) => <option key={t.label} value={t.label}>{t.label}</option>)}
                      </Select>
                    </Field>
                    <label
                      className={`flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-[12px] font-semibold shrink-0 transition-colors ${otherTitle && docBusy !== 'other-upload' ? 'cursor-pointer hover:bg-[#5B2BC9]/5' : 'cursor-not-allowed'}`}
                      style={{ border: `1px solid ${PURPLE}`, color: PURPLE, opacity: otherTitle && docBusy !== 'other-upload' ? 1 : 0.45 }}>
                      <Upload size={12} />
                      {docBusy === 'other-upload' ? 'Uploading…' : 'Choose file'}
                      <input type="file" className="hidden" disabled={!otherTitle || docBusy === 'other-upload'}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          e.target.value = ''
                          const chosen = OTHER_DOC_TITLES.find((t) => t.label === otherTitle)
                          if (f && chosen) {
                            uploadDoc(f, chosen.type, chosen.label, 'other-upload').then(() => setOtherTitle(''))
                          }
                        }} />
                    </label>
                  </div>

                  {otherDocs.length === 0 ? (
                    <p className="mt-3 text-[12px]" style={{ color: MUTED }}>No other documents yet.</p>
                  ) : (
                    <div style={BOX} className="mt-3 overflow-hidden">
                      <div className="grid grid-cols-[1fr_1fr_36px] gap-2 px-3.5 py-2 text-[10.5px] font-bold uppercase tracking-wide"
                        style={{ color: MUTED, borderBottom: `1px solid ${HAIRLINE}` }}>
                        <span>Title</span><span>File</span><span />
                      </div>
                      {otherDocs.map((d) => (
                        <div key={d._id} className="grid grid-cols-[1fr_1fr_36px] gap-2 px-3.5 py-2.5 items-center"
                          style={{ borderTop: `1px solid ${HAIRLINE}` }}>
                          <span className="text-[12.5px] font-semibold truncate" style={{ color: INK }}>{d.name}</span>
                          <a href={d.url} target="_blank" rel="noreferrer"
                            className="text-[12px] truncate hover:underline" style={{ color: PURPLE }} title={fileLabel(d)}>
                            {fileLabel(d)}
                          </a>
                          <button type="button" title="Delete document"
                            onClick={() => { if (confirm(`Delete ${d.name}?`)) removeDoc(d._id) }}
                            disabled={docBusy === d._id}
                            className="justify-self-end p-1.5 rounded-lg transition-colors hover:bg-red-50 cursor-pointer disabled:opacity-40"
                            style={{ color: '#DC2626' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      </div>

      {/* ── Modals ── */}
      {/* Record payment — right panel */}
      {recordingPayment && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20" onClick={() => setRecordingPayment(null)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-card shadow-xl overflow-y-auto animate-in slide-in-from-right border-l">
            <div className="sticky top-0 bg-card border-b px-5 py-4 flex items-center justify-between z-10">
              <h2 className="text-base font-bold">Record payment — {(recordingPayment.invoice as any)?.invoiceNo || ''}</h2>
              <button onClick={() => setRecordingPayment(null)} className="text-muted-foreground hover:text-foreground cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-5">
              <RecordPaymentForm
                payment={recordingPayment}
                busy={recordPayment.isPending}
                onSubmit={(body) => {
                  if (!body.paidDate) { setRecordingPayment(null); return }
                  recordPayment.mutate({ paymentId: recordingPayment._id, body })
                }}
              />
            </div>
          </div>
        </div>
      )}

      <Modal open={!!editingPayment} onClose={() => setEditingPayment(null)} title="Edit payment">
        {editingPayment && (
          <EditPaymentForm
            payment={editingPayment}
            busy={editPayment.isPending}
            onSubmit={(body) => editPayment.mutate({ paymentId: editingPayment._id, body })}
          />
        )}
      </Modal>

      <Modal
        open={bulkTarget !== null}
        onClose={() => setBulkTarget(null)}
        title="Record payments"
        wide
      >
        {bulkTarget !== null && bulkTarget.length > 0 && (
          <BulkPayForm
            unpaid={bulkTarget}
            billingPeriod={c.billingPeriod}
            busy={bulkRecord.isPending}
            onSubmit={(body) => bulkRecord.mutate(body)}
          />
        )}
      </Modal>

      <Modal open={addingPayment} onClose={() => setAddingPayment(false)} title="Add payment entry">
        <AddPaymentForm
          contractId={c._id}
          rate={Math.round(c.rate / 4 * 100) / 100}
          busy={addPayment.isPending}
          onSubmit={(body) => addPayment.mutate(body)}
        />
      </Modal>

      {/* Upload document — right panel */}
      {uploading && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20" onClick={() => setUploading(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-card shadow-xl overflow-y-auto animate-in slide-in-from-right border-l">
            <div className="sticky top-0 bg-card border-b px-5 py-4 flex items-center justify-between z-10">
              <h2 className="text-base font-bold">Upload document</h2>
              <button onClick={() => setUploading(false)} className="text-muted-foreground hover:text-foreground cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-5">
              <UploadDocumentForm
                contractId={c._id}
                customerId={c.customer?._id}
                onDone={() => { invalidate(); setUploading(false) }}
              />
            </div>
          </div>
        </div>
      )}

      <Modal open={signingInPerson} onClose={() => setSigningInPerson(false)} title="Sign contract in person" wide>
        <SignInPersonModal
          contractNo={c.contractNo}
          customerName={c.customer?.fullName ?? ''}
          busy={signInPerson.isPending}
          error={signError}
          onSign={(body) => signInPerson.mutate(body)}
          onClose={() => setSigningInPerson(false)}
        />
      </Modal>

      {/* Create Invoice — right panel */}
      {showInvoiceModal && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20" onClick={() => { setShowInvoiceModal(false); setInvoiceOverride(null) }} />
          <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-card shadow-xl overflow-y-auto animate-in slide-in-from-right border-l">
            <div className="sticky top-0 bg-card border-b px-5 py-4 flex items-center justify-between z-10">
              <h2 className="text-base font-bold">{invoiceOverride ? 'Generate invoice for remaining weeks' : 'Create Invoice'}</h2>
              <button onClick={() => { setShowInvoiceModal(false); setInvoiceOverride(null) }} className="text-muted-foreground hover:text-foreground cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-5">
              <GenerateInvoiceModal
                contract={c}
                payments={payments}
                overrideStart={invoiceOverride?.start}
                overrideEnd={invoiceOverride?.end}
                blank={invoiceBlank}
                onDone={() => { setShowInvoiceModal(false); setInvoiceOverride(null); setInvoiceBlank(false); invalidate(); qc.invalidateQueries({ queryKey: ['invoices'] }) }}
              />
            </div>
          </div>
        </div>
      )}

      <Modal open={!!signingLink} onClose={() => { setSigningLink(''); setLinkCopied(false) }} title="Signing link ready">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Share this link with <strong>{c.customer?.fullName}</strong> to sign the contract electronically.
            The link is valid for 7 days.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={signingLink}
              className="flex-1 rounded-md border border-input bg-muted px-3 py-2 text-xs font-mono truncate"
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(signingLink)
                setLinkCopied(true)
                setTimeout(() => setLinkCopied(false), 2500)
              }}
            >
              {linkCopied ? '✓ Copied' : 'Copy'}
            </Button>
          </div>
          {signingLinkExpiry && (
            <p className="text-xs text-muted-foreground">
              Expires: {new Date(signingLinkExpiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <div className="flex gap-2 pt-2">
            {c.customer?.phone && (
              <a
                href={`https://wa.me/${c.customer.phone.replace(/\D/g, '').replace(/^00/, '')}?text=${encodeURIComponent(`Hi ${c.customer.fullName}, please sign your storage contract (${c.contractNo}) using this link: ${signingLink}`)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-[#25D366] text-white text-sm font-medium px-3 py-1.5 hover:opacity-90 transition-opacity"
              >
                Share via WhatsApp
              </a>
            )}
            <Button variant="outline" size="sm" onClick={() => { setSigningLink(''); setLinkCopied(false) }}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Edit Tenant slide-over panel ── */}
      {editCustomerModal && c.customer && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20" onClick={() => setEditCustomerModal(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-xl overflow-y-auto animate-in slide-in-from-right">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b px-5 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em', color: '#14081F' }}>
                Edit {c.customer.fullName}
              </h2>
              <button onClick={() => setEditCustomerModal(false)} className="p-1 hover:bg-muted rounded cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-5">
              <CustomerForm
                initial={c.customer}
                busy={updateCustomer.isPending}
                error={customerError}
                submitLabel="Save changes"
                onSubmit={(b) => updateCustomer.mutate(b)}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Contract slide-over panel ── */}
      {editModal && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20" onClick={() => setEditModal(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-xl overflow-y-auto animate-in slide-in-from-right">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b px-5 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em', color: '#14081F' }}>
                Edit Contract
              </h2>
              <button onClick={() => setEditModal(false)} className="p-1 hover:bg-muted rounded cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-5">
              <EditContractForm
                contract={c}
                unitOptions={unitOptions}
                busy={updateContract.isPending}
                error={error}
                onSubmit={(body) => updateContract.mutate(body)}
                onCancel={() => setEditModal(false)}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Notice slide-over: edit, then send ── */}
      {noticeOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20" onClick={() => setNoticeOpen(null)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white dark:bg-gray-900 shadow-xl overflow-y-auto animate-in slide-in-from-right flex flex-col">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b px-5 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-bold" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em', color: '#14081F' }}>
                  {noticeOpen.name} — {c.contractNo}
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Prefilled for {c.customer?.fullName || 'the tenant'} — edit freely, then send.
                </p>
              </div>
              <button onClick={() => setNoticeOpen(null)} className="p-1 hover:bg-muted rounded cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-5 flex-1 flex flex-col gap-3">
              <div
                ref={(el) => {
                  noticeRef.current = el
                  if (el && noticeInitial.current) { el.innerHTML = noticeInitial.current; noticeInitial.current = '' }
                }}
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                className="agreement-editor w-full flex-1 rounded-lg border bg-white p-6 text-[13px] leading-relaxed outline-none focus:border-primary"
                style={{ minHeight: 440, overflowY: 'auto' }}
              />
              {noticeSent && <p className="text-xs text-emerald-600 font-medium">{noticeSent}</p>}
              {noticeSignUrl && <p className="text-[11px] break-all text-muted-foreground">Signing link: {noticeSignUrl}</p>}
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 pt-2 border-t flex-wrap">
                <Button type="button" variant="outline" onClick={async () => {
                  setNoticeBusy('pdf'); setError('')
                  try {
                    const r = await api.post(`/contracts/${id}/notice-pdf`,
                      { html: noticeRef.current?.innerHTML ?? '', title: noticeOpen.name }, { responseType: 'blob' })
                    const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }))
                    window.open(url, '_blank')
                    setTimeout(() => URL.revokeObjectURL(url), 60_000)
                  } catch (e) { setError(apiError(e)) } finally { setNoticeBusy('') }
                }} disabled={noticeBusy === 'pdf'}>
                  <Download size={14} /> {noticeBusy === 'pdf' ? 'Preparing…' : 'PDF'}
                </Button>
                <Button type="button" variant="outline" className="text-emerald-700 border-emerald-300" onClick={() => {
                  const plain = (noticeRef.current?.innerText || '').trim()
                  const phone = (c.customer?.phones?.[0] || c.customer?.phone || '').replace(/\D/g, '')
                  const text = encodeURIComponent(`*${noticeOpen.name} — ${c.contractNo}*\n\n${plain}\n\nPurpleBox Storage`)
                  window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank')
                }}>
                  <MessageSquare size={14} /> WhatsApp
                </Button>
                {noticeTemplates.find((t) => t._id === noticeOpen.id)?.isDefault && (
                  <Button type="button" disabled={noticeBusy === 'sign'} className="bg-emerald-600 hover:bg-emerald-700" onClick={async () => {
                    setNoticeBusy('sign'); setError(''); setNoticeSent('')
                    try {
                      // The tenant signs exactly what's on screen — keep this
                      // wording on the contract, then mint the signing link
                      await api.put(`/contracts/${id}`, { agreementText: noticeRef.current?.innerHTML ?? '' })
                      const r = await api.post(`/contracts/${id}/create-signing-link`)
                      const url = r.data?.signingUrl || ''
                      setNoticeSignUrl(url)
                      try { await navigator.clipboard.writeText(url) } catch { /* clipboard blocked */ }
                      const phone = (c.customer?.phones?.[0] || c.customer?.phone || '').replace(/\D/g, '')
                      const text = encodeURIComponent(`Hello ${c.customer?.fullName || ''},\n\nPlease review and sign your storage agreement ${c.contractNo}:\n${url}\n\nThe link is valid for 7 days.\n\nThank you,\nPurpleBox Storage`)
                      window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank')
                      setNoticeSent('Signing link created (copied to clipboard). Once signed, the copy files under Documents automatically.')
                      invalidate()
                    } catch (e) { setError(apiError(e)) } finally { setNoticeBusy('') }
                  }}>
                    {noticeBusy === 'sign' ? 'Preparing…' : 'Send for signing'}
                  </Button>
                )}
                <Button type="button" disabled={noticeBusy === 'email'} onClick={async () => {
                  setNoticeBusy('email'); setError(''); setNoticeSent('')
                  try {
                    const r = await api.post(`/contracts/${id}/notice-email`,
                      { html: noticeRef.current?.innerHTML ?? '', title: noticeOpen.name })
                    setNoticeSent(`Emailed to ${r.data?.to} with the PDF attached.`)
                    invalidate()
                  } catch (e) { setError(apiError(e)) } finally { setNoticeBusy('') }
                }}>
                  {noticeBusy === 'email' ? 'Sending…' : 'Send via Email'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Download, FileText, FilePlus, MessageSquare, PenLine, Plus, ShieldCheck, Trash2, Upload, X, XCircle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { AppDocument, Contract, Invoice, Payment, Unit } from '../lib/types'
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Field, Input, Modal, Select, Spinner,
  Table, Td, Th, Textarea,
  contractStatusTone, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'
import { UploadDocumentForm } from './Documents'
import { CustomerForm } from '../components/AddCustomerModal'

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
  const [agreementModal, setAgreementModal] = useState(false)
  const [agreementSource, setAgreementSource] = useState('')
  const [agreementBusy, setAgreementBusy] = useState(false)
  const agreementRef = useRef<HTMLDivElement>(null)
  const agreementInitial = useRef('')
  const [noticeOpen, setNoticeOpen] = useState<{ id: string; name: string } | null>(null)
  const [noticeBusy, setNoticeBusy] = useState('')
  const [noticeSent, setNoticeSent] = useState('')
  const [noticeSignUrl, setNoticeSignUrl] = useState('')
  const noticeRef = useRef<HTMLDivElement>(null)
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
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') as 'overview' | 'payments' | 'documents' | 'notices' | 'reminders') || 'overview'
  const setActiveTab = (tab: 'overview' | 'payments' | 'documents' | 'notices' | 'reminders') => setSearchParams({ tab }, { replace: true })

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
  type ActivityEvent = { id: string; type: 'overdue' | 'paid' | 'note' | 'invoice' | 'document'; at: Date; title: string; subtitle: string; noteIdx?: number }
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
    activityEvents.push({ id: `note-${noteIdx}-${note.at}`, type: 'note', at: new Date(note.at), title: note.text, subtitle: note.author ? `by ${note.author}` : '', noteIdx })
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
  activityEvents.sort((a, b) => b.at.getTime() - a.at.getTime())

  return (
    <div>
      {/* Back button */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 mb-4 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer">
        <span className="text-lg leading-none">←</span> Back
      </button>

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
        {/* Left sidebar */}
        <div className="w-full lg:w-80 lg:shrink-0 space-y-4">
          <Card>
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
                const askingPrice = Number(c.rate || 0)
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
                    {EditableRow('Asking Price', 'rate', `AED ${formatMoney(askingPrice)}`, String(askingPrice), 'number', '1')}
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
                    try {
                      const r = await api.get(`/contracts/${id}/agreement`)
                      const text = r.data?.text || ''
                      // Plain text becomes paragraphs; HTML loads as-is
                      agreementInitial.current = /<\w+[^>]*>/.test(text)
                        ? text
                        : text.split('\n').map((l: string) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;') || '<br>'}</p>`).join('')
                      setAgreementSource(r.data?.source || 'none')
                      setAgreementModal(true)
                      requestAnimationFrame(() => { if (agreementRef.current) agreementRef.current.innerHTML = agreementInitial.current })
                    } catch (e) { setError(apiError(e)) }
                  }}
                  className="text-primary text-xs hover:underline flex items-center gap-1 cursor-pointer">
                  <PenLine size={12} /> Edit Agreement
                </button>
                <button type="button"
                  onClick={async () => {
                    setError('')
                    try {
                      const r = await api.get(`/contracts/${id}/pdf`, { responseType: 'blob' })
                      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }))
                      window.open(url, '_blank')
                      setTimeout(() => URL.revokeObjectURL(url), 60_000)
                    } catch (e) { setError(apiError(e)) }
                  }}
                  className="text-primary text-xs hover:underline flex items-center gap-1 cursor-pointer">
                  <Download size={12} /> Agreement PDF
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
                  <CardBody className="pt-0">
                    {activityEvents.length === 0 ? (
                      <EmptyState message="No activity yet." />
                    ) : (
                      <div className="divide-y">
                        {(showAllActivity ? activityEvents : activityEvents.slice(0, 10)).map((ev) => (
                          <div key={ev.id} className="flex gap-3 py-3">
                            <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${ev.type === 'paid' ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600'
                              : ev.type === 'invoice' ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-600'
                                : ev.type === 'document' ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-600'
                                  : 'bg-muted text-muted-foreground'
                              }`}>
                              {ev.type === 'paid' && <CheckCircle2 size={15} />}
                              {ev.type === 'invoice' && <FileText size={15} />}
                              {ev.type === 'document' && <Upload size={15} />}
                              {ev.type === 'note' && <MessageSquare size={15} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              {ev.type === 'note' && editingNote?.idx === ev.noteIdx ? (
                                <div className="space-y-2">
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
                                <>
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm font-medium leading-tight whitespace-pre-wrap break-words">{ev.title}</p>
                                    <span className="flex items-center gap-1.5 shrink-0">
                                      {ev.type === 'note' && ev.noteIdx !== undefined && (
                                        <>
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
                                      <span className="text-xs text-muted-foreground">
                                        {ev.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                      </span>
                                    </span>
                                  </div>
                                  {ev.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{ev.subtitle}</p>}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                        {!showAllActivity && activityEvents.length > 10 && (
                          <button type="button" onClick={() => setShowAllActivity(true)}
                            className="w-full py-2.5 text-sm font-medium text-primary hover:underline cursor-pointer">
                            Show more ({activityEvents.length - 10} older)
                          </button>
                        )}
                      </div>
                    )}
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

          {/* PAYMENTS */}
          {activeTab === 'payments' && (
            <Card>
              <CardHeader title="Invoices"
                action={<Button size="sm" variant="outline" onClick={() => setShowInvoiceModal(true)}><FilePlus size={13} /> Create Invoice</Button>}
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
          )}

          {/* DOCUMENTS */}
          {/* REMINDERS — per-contract overrides on top of Settings → Automation */}
          {activeTab === 'reminders' && (
            <Card>
              <CardHeader title="Reminders" subtitle="Defaults come from Settings → Automation — override them for this tenant here" />
              <CardBody className="pt-0 space-y-4">
                {/* Master switch */}
                <div className="rounded-xl border p-4 flex items-center justify-between gap-4">
                  <div>
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
                            requestAnimationFrame(() => {
                              if (noticeRef.current) {
                                noticeRef.current.innerHTML = /<\w+[^>]*>/.test(text)
                                  ? text
                                  : text.split('\n').map((l: string) => `<p>${l || '<br>'}</p>`).join('')
                              }
                            })
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
              <CardHeader title="Documents" action={<Button size="sm" variant="outline" onClick={() => setUploading(true)}><Upload size={13} /> Upload</Button>} />
              {documents.length === 0 ? <EmptyState message="No documents attached to this contract." /> : (
                <Table>
                  <thead><tr><Th>Name</Th><Th>Type</Th><Th>Storage</Th><Th>Uploaded</Th><Th /></tr></thead>
                  <tbody>
                    {documents.map((d) => (
                      <tr key={d._id} className="hover:bg-muted/50">
                        <Td className="font-medium">{d.name}</Td>
                        <Td>{statusLabel(d.type)}</Td>
                        <Td><Badge tone={d.storage === 'drive' ? 'blue' : 'gray'}>{d.storage === 'drive' ? 'Google Drive' : 'Local'}</Badge></Td>
                        <Td>{formatDate(d.createdAt)}</Td>
                        <Td><a href={d.url} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline">Open</a></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          {/* Add note — always visible */}
          <Card className="mt-5">
            <CardHeader title="Add Note"
              action={<MessageSquare size={15} className="text-muted-foreground" />}
            />
            <CardBody className="pt-0">
              <form onSubmit={(e) => { e.preventDefault(); const input = (e.currentTarget.elements.namedItem('noteText') as HTMLTextAreaElement); if (input.value.trim()) { addNote.mutate(input.value.trim()); input.value = '' } }} className="flex gap-2 items-end">
                <Textarea name="noteText" className="flex-1 resize-none" placeholder="Type a note or follow-up..." rows={2} />
                <Button type="submit" disabled={addNote.isPending} className="shrink-0">
                  {addNote.isPending ? 'Saving…' : 'Add note'}
                </Button>
              </form>
            </CardBody>
          </Card>
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
                ref={noticeRef}
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

      {/* ── Edit Agreement slide-over ── */}
      {agreementModal && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20" onClick={() => setAgreementModal(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-white dark:bg-gray-900 shadow-xl overflow-y-auto animate-in slide-in-from-right flex flex-col">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b px-5 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-lg font-bold" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em', color: '#14081F' }}>
                  Agreement — {c.contractNo}
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {agreementSource === 'contract'
                    ? 'This contract has its own edited wording.'
                    : agreementSource === 'template'
                      ? 'Prefilled from the saved template with this contract’s details — edit freely, saving keeps a copy on this contract.'
                      : 'No template saved yet — write the agreement here, or design a template under Admin → Agreement Template.'}
                </p>
              </div>
              <button onClick={() => setAgreementModal(false)} className="p-1 hover:bg-muted rounded cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-5 flex-1 flex flex-col gap-3">
              <div
                ref={agreementRef}
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                className="agreement-editor w-full flex-1 rounded-lg border bg-white p-6 text-[13px] leading-relaxed outline-none focus:border-primary"
                style={{ minHeight: 480, overflowY: 'auto' }}
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
              <p className="text-[11px] text-muted-foreground">
                Rich text — pasting from Word keeps tables, bold and headings, and the PDF prints them.
              </p>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={() => setAgreementModal(false)}>Cancel</Button>
                <Button type="button" disabled={agreementBusy} onClick={async () => {
                  setAgreementBusy(true)
                  setError('')
                  try {
                    await api.put(`/contracts/${id}`, { agreementText: agreementRef.current?.innerHTML ?? '' })
                    setAgreementSource('contract')
                    invalidate()
                    setAgreementModal(false)
                  } catch (e) { setError(apiError(e)) } finally { setAgreementBusy(false) }
                }}>
                  {agreementBusy ? 'Saving…' : 'Save Agreement'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

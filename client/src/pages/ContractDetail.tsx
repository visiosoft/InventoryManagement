import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Download, FileText, FilePlus, MessageSquare, PenLine, Plus, ShieldCheck, Trash2, Upload, X, XCircle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { AppDocument, Contract, Invoice, Payment } from '../lib/types'
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

  type LineItem = { id: number; description: string; qty: number; rate: number; amount: number }
  const emptyItem = (): LineItem => ({ id: Date.now(), description: '', qty: 1, rate: weeklyRate, amount: weeklyRate })

  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)
  const [dueDate, setDueDate] = useState(toISO(today))

  // Determine if first invoice — if so, include advance payment line
  const isFirstInvoice = payments.length === 0

  const buildDefaultItems = (): LineItem[] => {
    if (blank) return [{ id: 1, description: '', qty: 1, rate: 0, amount: 0 }]
    const items: LineItem[] = [{ id: 1, description: `Storage Rent · Unit ${unitNo}`, qty: 4, rate: weeklyRate, amount: Math.round(4 * weeklyRate * 100) / 100 }]
    if (isFirstInvoice && contractEnd) {
      // Advance covers last 4 weeks of the contract
      const advStart = new Date(contractEnd); advStart.setDate(advStart.getDate() - 28)
      const advEnd = new Date(contractEnd); advEnd.setDate(advEnd.getDate() - 1)
      const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      items.push({ id: 2, description: `Advance Rent ${fmt(advStart)} – ${fmt(advEnd)} · Unit ${unitNo}`, qty: 4, rate: weeklyRate, amount: Math.round(4 * weeklyRate * 100) / 100 })
    }
    return items
  }

  const [lineItems, setLineItems] = useState<LineItem[]>(buildDefaultItems())
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Auto-calculate weeks when dates change (only updates the first rent line)
  useEffect(() => {
    const s = new Date(startDate), e = new Date(endDate)
    const days = Math.round((e.getTime() - s.getTime()) / 86400000)
    if (days > 0) {
      const weeks = Math.ceil(days / 7)
      setLineItems(prev => {
        const first = prev[0]
        if (first && first.description.startsWith('Storage Rent')) {
          return [{ ...first, qty: weeks, amount: Math.round(weeks * first.rate * 100) / 100 }, ...prev.slice(1)]
        }
        return prev
      })
    }
  }, [startDate, endDate])

  function updateLine(idx: number, field: keyof LineItem, val: string) {
    setLineItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      const updated = { ...it, [field]: field === 'description' ? val : Number(val) }
      if (field === 'qty' || field === 'rate') updated.amount = Math.round(updated.qty * updated.rate * 100) / 100
      return updated
    }))
  }

  function addLine() {
    setLineItems(prev => [...prev, emptyItem()])
  }

  function removeLine(idx: number) {
    setLineItems(prev => prev.filter((_, i) => i !== idx))
  }

  const total = Math.round(lineItems.reduce((s, it) => s + it.amount, 0) * 100) / 100

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
        discountPct: 0,
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
          <div className="grid grid-cols-[1fr_60px_90px_90px_32px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
            <span>Description</span><span>Wks</span><span>Rate</span><span>Amount</span><span />
          </div>
          <div className="divide-y">
            {lineItems.map((it, i) => (
              <div key={it.id} className="grid grid-cols-[1fr_60px_90px_90px_32px] gap-2 px-3 py-2 items-center">
                <Input value={it.description} onChange={(e) => updateLine(i, 'description', e.target.value)} placeholder="Service" className="text-sm" />
                <Input type="number" min={1} value={it.qty} onChange={(e) => updateLine(i, 'qty', e.target.value)} className="text-sm text-center" />
                <Input type="number" min={0} step="0.01" value={it.rate} onChange={(e) => updateLine(i, 'rate', e.target.value)} className="text-sm text-right" />
                <div className="text-sm font-medium text-right pr-1">{formatMoney(it.amount)}</div>
                {lineItems.length > 1 ? (
                  <button type="button" onClick={() => removeLine(i)} className="text-muted-foreground hover:text-destructive cursor-pointer"><X size={14} /></button>
                ) : <span />}
              </div>
            ))}
          </div>
          <div className="flex justify-end px-3 py-2 border-t bg-muted/30">
            <span className="text-sm font-semibold">Total: AED {formatMoney(total)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <Field label="Notes (optional)">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes..." rows={2} />
      </Field>

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
  // Which sidebar field is currently open for inline editing (null = none)
  const [inlineField, setInlineField] = useState<string | null>(null)
  const [editCustomerModal, setEditCustomerModal] = useState(false)
  const [customerError, setCustomerError] = useState('')
  const [editingNote, setEditingNote] = useState<{ idx: number; text: string } | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') as 'overview' | 'payments' | 'documents') || 'overview'
  const setActiveTab = (tab: 'overview' | 'payments' | 'documents') => setSearchParams({ tab }, { replace: true })

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


  const paymentsTotal = payments.reduce((s, p) => s + p.amount, 0)
  const totalOwed = Math.max(Number(c.totalQuotation || 0), paymentsTotal)
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
      activityEvents.push({ id: `doc-${doc._id}`, type: 'document', at: new Date(doc.createdAt), title: `Document uploaded`, subtitle: doc.name })
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
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Left sidebar */}
        <div className="w-full lg:w-72 lg:shrink-0 space-y-4">
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

              {/* Contract detail rows */}
              {(() => {
                // Asking is the rate before the agreed discount; leased is what
                // the tenant actually pays, and the weekly figure derives from it.
                const askingPrice = Number(c.rate || 0)
                const discountPct = Number((c as { firstMonthDiscountPct?: number }).firstMonthDiscountPct || 0)
                const leasedPrice = Math.round(askingPrice * (1 - discountPct / 100) * 100) / 100
                const weeks = c.startDate && c.endDate
                  ? Math.ceil(Math.round((new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / 86400000) / 7)
                  : null
                // Collected vs still owed, so the sidebar shows the money position
                // without needing the old balance bar.
                const collected = payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
                const stillDue = payments.filter((p) => p.status !== 'paid').reduce((s, p) => s + p.amount, 0)
                const remaining = Math.max(0, totalOwed - collected)

                /** Saves one field straight to the contract and closes the editor. */
                const saveInline = (key: string, raw: string) => {
                  setInlineField(null)
                  const val = raw.trim()
                  if (!val) return
                  setError('')
                  if (key === 'startDate' || key === 'endDate') {
                    if (val === (c[key] || '').slice(0, 10)) return
                    updateContract.mutate({ [key]: val })
                    return
                  }
                  // Leased price is stored as a discount off the asking rate
                  if (key === 'leasedPrice') {
                    const leased = Number(val)
                    if (!askingPrice || !Number.isFinite(leased) || leased === leasedPrice) return
                    const pct = Math.round(Math.max(0, (1 - leased / askingPrice)) * 10000) / 100
                    updateContract.mutate({ firstMonthDiscountPct: pct })
                    return
                  }
                  const num = Number(val)
                  if (!Number.isFinite(num) || num === Number((c as unknown as Record<string, unknown>)[key] || 0)) return
                  updateContract.mutate({ [key]: num })
                }

                // Plain functions, not components — a component declared here would
                // get a fresh type each render and remount the input mid-edit.
                const Row = (label: string, value: React.ReactNode) => (
                  <div key={label} className="flex justify-between py-2 gap-3">
                    <span className="text-muted-foreground shrink-0">{label}</span>
                    <span className="font-medium text-right">{value}</span>
                  </div>
                )

                /** Same row, but the value flips to an input when the pencil is clicked. */
                const EditRow = (
                  label: string,
                  key: string,
                  display: React.ReactNode,
                  type: 'date' | 'number',
                  initial: string,
                ) => (
                  <div key={label} className="flex justify-between py-2 gap-2 items-center min-h-[38px]">
                    <span className="text-muted-foreground shrink-0">{label}</span>
                    {inlineField === key ? (
                      <input
                        autoFocus
                        type={type}
                        step={type === 'number' ? '0.01' : undefined}
                        min={type === 'number' ? '0' : undefined}
                        defaultValue={initial}
                        className="h-7 w-32 rounded border px-1.5 text-right text-[13px] outline-none focus:border-primary"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveInline(key, e.currentTarget.value)
                          if (e.key === 'Escape') setInlineField(null)
                        }}
                        onBlur={(e) => saveInline(key, e.currentTarget.value)}
                      />
                    ) : (
                      <span className="font-medium text-right flex items-center gap-1.5 justify-end">
                        {display}
                        <button type="button" title={`Edit ${label}`}
                          className="text-primary hover:text-primary/80 cursor-pointer"
                          onClick={() => { setError(''); setInlineField(key) }}>
                          <PenLine size={11} />
                        </button>
                      </span>
                    )}
                  </div>
                )

                return (
                  <div className="divide-y border-t text-sm pt-1">
                    {EditRow('Check In', 'startDate', c.startDate ? formatDate(c.startDate) : '—', 'date', c.startDate?.slice(0, 10) || '')}
                    {EditRow('Check Out', 'endDate', c.endDate ? formatDate(c.endDate) : '—', 'date', c.endDate?.slice(0, 10) || '')}
                    {Row('Number of Weeks', weeks ?? '—')}
                    {Row('Expiring In', daysLeft === null ? '—' : daysLeft < 0 ? `Expired ${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`)}
                    {Row('Unit Number', allUnits.length ? allUnits.map((u) => u.unitNumber).join(', ') : '—')}
                    {Row('Unit Size',
                      allUnits.some((u) => u?.sizeSqf != null)
                        ? `${allUnits.map((u) => (u?.sizeSqf != null ? u.sizeSqf : '—')).join(', ')} sq ft`
                        : '—')}
                    {EditRow('Asking Price', 'rate', `AED ${formatMoney(askingPrice)}`, 'number', String(askingPrice))}
                    {EditRow('Leased Price', 'leasedPrice', `AED ${formatMoney(leasedPrice)}`, 'number', String(leasedPrice))}
                    {EditRow('Total Quotation', 'totalQuotation', `AED ${formatMoney(c.totalQuotation || 0)}`, 'number', String(c.totalQuotation || 0))}
                    {Row('Pending', <span className={stillDue > 0 ? 'text-amber-600' : ''}>AED {formatMoney(stillDue)}</span>)}
                    {Row('Remaining', <span className={remaining > 0 ? 'text-destructive' : 'text-emerald-600'}>AED {formatMoney(remaining)}</span>)}
                  </div>
                )
              })()}

              {c.signedDocUrl && (
                <a href={c.signedDocUrl} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline flex items-center gap-1">
                  <FileText size={12} /> View signed contract
                </a>
              )}
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
              ['payments', 'Payments', unpaidGroups.length],
              ['documents', 'Documents', 0],
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
                        {activityEvents.map((ev) => (
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
              {/* Summary bar */}
              <div className="grid grid-cols-4 gap-3 px-4 pb-4">
                <div className="rounded-lg border px-3 py-2.5 text-center">
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">Contract Total</div>
                  <div className="text-base font-bold mt-0.5">{formatMoney(totalOwed)}</div>
                </div>
                <div className="rounded-lg border px-3 py-2.5 text-center">
                  <div className="text-[10px] font-semibold text-blue-600 uppercase">Invoiced</div>
                  <div className="text-base font-bold text-blue-600 mt-0.5">{formatMoney(invoiceGroups.reduce((s, g) => s + g.total, 0))}</div>
                </div>
                <div className="rounded-lg border px-3 py-2.5 text-center">
                  <div className="text-[10px] font-semibold text-emerald-600 uppercase">Received</div>
                  <div className="text-base font-bold text-emerald-600 mt-0.5">{formatMoney((data?.invoices ?? []).reduce((s, inv) => s + Number(inv.paymentMade || 0), 0))}</div>
                </div>
                <div className="rounded-lg border px-3 py-2.5 text-center">
                  <div className="text-[10px] font-semibold text-amber-600 uppercase">Remaining</div>
                  <div className="text-base font-bold text-amber-600 mt-0.5">{formatMoney(Math.max(0, totalOwed - (data?.invoices ?? []).reduce((s, inv) => s + Number(inv.paymentMade || 0), 0)))}</div>
                </div>
              </div>

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

      <Modal
        open={showInvoiceModal}
        onClose={() => { setShowInvoiceModal(false); setInvoiceOverride(null) }}
        title={invoiceOverride ? 'Generate invoice for remaining weeks' : 'Generate invoice'}
        wide
      >
        {showInvoiceModal && (
          <GenerateInvoiceModal
            contract={c}
            payments={payments}
            overrideStart={invoiceOverride?.start}
            overrideEnd={invoiceOverride?.end}
            blank={invoiceBlank}
            onDone={() => { setShowInvoiceModal(false); setInvoiceOverride(null); setInvoiceBlank(false); invalidate(); qc.invalidateQueries({ queryKey: ['invoices'] }) }}
          />
        )}
      </Modal>

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
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  updateContract.mutate({
                    rate: Number(f.get('rate')),
                    totalQuotation: Number(f.get('totalQuotation')) || undefined,
                    startDate: String(f.get('startDate')),
                    endDate: String(f.get('endDate')),
                    notes: String(f.get('notes') || ''),
                  })
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Monthly Rate (AED)">
                    <Input name="rate" type="number" min="0" step="0.01" defaultValue={c.rate} required />
                  </Field>
                  <Field label="Total Quotation (AED)">
                    <Input name="totalQuotation" type="number" min="0" step="0.01" defaultValue={c.totalQuotation} />
                  </Field>
                  <Field label="Start Date">
                    <Input name="startDate" type="date" defaultValue={c.startDate?.slice(0, 10)} required />
                  </Field>
                  <Field label="End Date">
                    <Input name="endDate" type="date" defaultValue={c.endDate?.slice(0, 10)} required />
                  </Field>
                  <Field label="Notes" className="col-span-2">
                    <Textarea name="notes" rows={3} defaultValue={c.notes || ''} placeholder="Internal notes about this contract" />
                  </Field>
                </div>
                <div className="rounded-lg bg-muted/50 border px-3 py-2 text-xs text-muted-foreground">
                  <strong>Note:</strong> Customer and unit cannot be changed here. To change these, end this contract and create a new one.
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button type="button" variant="outline" onClick={() => setEditModal(false)}>Cancel</Button>
                  <Button type="submit" disabled={updateContract.isPending}>
                    {updateContract.isPending ? 'Saving…' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

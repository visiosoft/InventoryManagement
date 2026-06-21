import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Download, FileText, FilePlus, PenLine, Plus, ShieldCheck, Upload, X, XCircle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { AppDocument, Contract, Payment } from '../lib/types'
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Field, Input, Modal, PageHeader, Select, Spinner,
  Table, Td, Th, Textarea,
  contractStatusTone, paymentStatusTone, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'
import { UploadDocumentForm } from './Documents'

// ── Custom invoice generator modal ────────────────────────────────────────────
type Preset = 'month' | 'month2' | 'custom' | 'deposit'

function GenerateInvoiceModal({ contract, payments, overrideStart, overrideEnd, onDone }: {
  contract: Contract; payments: Payment[]
  overrideStart?: string; overrideEnd?: string
  onDone: () => void
}) {
  const monthlyRate = Number(contract.rate || 0)
  const weeklyRate  = Math.round((monthlyRate / 4) * 100) / 100
  const depositAmt  = Number(contract.deposit || 0)

  const toISO = (d: Date) => d.toISOString().slice(0, 10)

  // If caller provides specific dates (e.g. "generate for remaining weeks"), use those.
  // Otherwise default to the next uninvoiced period (day after the latest payment due date).
  const latestDueDate = payments.length > 0
    ? new Date(Math.max(...payments.map(p => new Date(p.dueDate).getTime())))
    : null
  const nextStart = latestDueDate
    ? new Date(latestDueDate.getTime() + 7 * 86400000)
    : new Date(contract.startDate)

  // Smart end date: if the next period has already started, default end to today (bill elapsed time).
  // If the contract has an end date sooner than +28 days, use that.
  // Otherwise fall back to nextStart + 28 days (one month).
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const contractEnd = contract.endDate ? new Date(contract.endDate) : null
  const nextEnd28 = new Date(nextStart); nextEnd28.setDate(nextEnd28.getDate() + 28)
  const smartEnd = (() => {
    if (today > nextStart) return today         // next period already started → invoice up to today
    if (contractEnd && contractEnd < nextEnd28) return contractEnd  // contract ends sooner
    return nextEnd28
  })()

  const defaultStart = overrideStart ?? toISO(nextStart)
  const defaultEnd   = overrideEnd   ?? toISO(smartEnd)

  const unitDiscountPct = Number(contract.unit?.discountPct ?? 0)

  type ExtraItem = { id: number; description: string; amount: string; type: 'charge' | 'credit' }

  const [preset, setPreset]           = useState<Preset>('month')
  const [startDate, setStartDate]     = useState(defaultStart)
  const [endDate, setEndDate]         = useState(defaultEnd)
  const [dueDate, setDueDate]         = useState(toISO(new Date()))
  const [discountPct, setDiscountPct] = useState(unitDiscountPct)
  const [extraItems, setExtraItems]   = useState<ExtraItem[]>([])
  const [notes, setNotes]             = useState('')
  const [busy, setBusy]               = useState(false)
  const [err, setErr]                 = useState('')
  const nextExtraId = useRef(0)

  function addExtraItem() {
    setExtraItems(prev => [...prev, { id: nextExtraId.current++, description: '', amount: '', type: 'charge' }])
  }
  function removeExtraItem(id: number) { setExtraItems(prev => prev.filter(x => x.id !== id)) }
  function updateExtraItem(id: number, patch: Partial<ExtraItem>) {
    setExtraItems(prev => prev.map(x => x.id === id ? { ...x, ...patch } : x))
  }

  const extrasTotal = extraItems.reduce((s, x) => {
    const v = Math.round(Number(x.amount || 0) * 100) / 100
    return s + (x.type === 'charge' ? v : -v)
  }, 0)

  const defaultEnd2 = toISO(new Date(new Date(defaultStart).setDate(new Date(defaultStart).getDate() + 56)))

  function applyPreset(p: Preset) {
    setPreset(p)
    if (p === 'month')  { setStartDate(defaultStart); setEndDate(defaultEnd) }
    if (p === 'month2') { setStartDate(defaultStart); setEndDate(defaultEnd2) }
  }

  // Live calculation — full-week billing, discount on first 4 weeks of the contract (not per-invoice)
  const calc = useMemo(() => {
    if (preset === 'deposit') return null
    const s = new Date(startDate), e = new Date(endDate)
    const totalDays  = Math.round((e.getTime() - s.getTime()) / 86400000)
    if (totalDays <= 0) return null
    const totalWeeks = Math.ceil(totalDays / 7)
    const contractStart   = new Date(contract.startDate)
    const daysSinceStart  = Math.round((s.getTime() - contractStart.getTime()) / 86400000)
    const globalWeekOffset = Math.max(0, Math.floor(daysSinceStart / 7))
    const weeks: { num: number; start: Date; amount: number; discounted: boolean }[] = []
    for (let i = 0; i < totalWeeks; i++) {
      const ws = new Date(s); ws.setDate(ws.getDate() + i * 7)
      const discounted = discountPct > 0 && (globalWeekOffset + i) < 4
      const amount = discounted
        ? Math.round(weeklyRate * (1 - discountPct / 100) * 100) / 100
        : weeklyRate
      weeks.push({ num: i + 1, start: ws, amount, discounted })
    }
    const total = Math.round(weeks.reduce((s, w) => s + w.amount, 0) * 100) / 100
    return { totalWeeks, weeks, total }
  }, [preset, startDate, endDate, weeklyRate, discountPct])

  const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

  async function submit() {
    setBusy(true); setErr('')
    try {
      const validExtras = extraItems
        .filter(x => x.description.trim() && Number(x.amount) > 0)
        .map(x => ({ description: x.description.trim(), amount: Number(x.amount), type: x.type }))
      await api.post(`/contracts/${contract._id}/generate-custom-invoice`, {
        isDeposit: preset === 'deposit',
        startDate: preset !== 'deposit' ? startDate : undefined,
        endDate:   preset !== 'deposit' ? endDate   : undefined,
        dueDate, notes,
        discountPct: preset !== 'deposit' ? discountPct : 0,
        extraItems: validExtras,
      })
      onDone()
    } catch (e) { setErr(apiError(e)) }
    finally { setBusy(false) }
  }

  // ── Past invoice history (group payments by invoice) ──────────────────────
  const pastInvoices = useMemo(() => {
    const map = new Map<string, Payment[]>()
    for (const p of payments) {
      const id = (p.invoice as any)?._id ?? (p.invoice as any)
      if (!id) continue
      if (!map.has(id)) map.set(id, [])
      map.get(id)!.push(p)
    }
    return Array.from(map.entries())
      .map(([id, ps]) => {
        const ref = (ps[0].invoice as any)
        const invoiceNo = typeof ref === 'object' ? ref.invoiceNo : '—'
        const dates = ps.map(p => new Date(p.dueDate).getTime())
        const earliest = new Date(Math.min(...dates))
        const latest   = new Date(Math.max(...dates))
        const paidAmt  = ps.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount ?? 0), 0)
        const totalAmt = ps.reduce((s, p) => s + Number(p.amount ?? 0), 0)
        const status   = paidAmt >= totalAmt ? 'paid' : paidAmt > 0 ? 'partial' : 'pending'
        return { id, invoiceNo, earliest, latest, totalAmt, paidAmt, status }
      })
      .sort((a, b) => a.earliest.getTime() - b.earliest.getTime())
  }, [payments])

  const fmtShort = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })

  return (
    <div className="space-y-4">
      {/* Past invoice history */}
      {pastInvoices.length > 0 && (
        <div className="rounded-lg border overflow-hidden text-xs">
          <div className="bg-muted/50 px-3 py-1.5 font-semibold uppercase tracking-wide text-muted-foreground text-[11px]">
            Invoice History
          </div>
          <div className="divide-y">
            {pastInvoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-3 py-2 gap-2">
                <span className="text-muted-foreground shrink-0">{inv.invoiceNo}</span>
                <span className="text-muted-foreground flex-1 text-center">
                  {fmtShort(inv.earliest)} → {fmtShort(inv.latest)}
                </span>
                <span className="font-medium shrink-0">{formatMoney(inv.totalAmt)}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold
                  ${inv.status === 'paid'    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                    inv.status === 'partial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                                               'bg-muted text-muted-foreground'}`}>
                  {inv.status === 'paid' ? 'Paid' : inv.status === 'partial' ? 'Partial' : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preset picker */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        {([
          ['month',   '1 Month (4 wks)'],
          ['month2',  '2 Months (8 wks)'],
          ['custom',  'Custom Period'],
          ['deposit', 'Security Deposit'],
        ] as [Preset, string][]).map(([p, label]) => (
          <button key={p} type="button" onClick={() => applyPreset(p)}
            className={`rounded-lg border py-2 font-medium transition-colors cursor-pointer
              ${preset === p ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Deposit preview */}
      {preset === 'deposit' && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 space-y-1">
          <div className="text-xs text-muted-foreground">Security deposit</div>
          <div className="text-2xl font-bold">{formatMoney(depositAmt)}</div>
          {!depositAmt && <p className="text-xs text-destructive">No deposit amount set on this contract.</p>}
        </div>
      )}

      {/* Date range */}
      {preset !== 'deposit' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Period start">
              <Input type="date" value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPreset('custom') }} />
            </Field>
            <Field label="Period end">
              <Input type="date" value={endDate} min={startDate}
                onChange={(e) => { setEndDate(e.target.value); setPreset('custom') }} />
            </Field>
          </div>

          {/* Live calculation breakdown */}
          {calc ? (
            <div className="rounded-lg border overflow-hidden text-sm">
              <div className="bg-muted/60 px-3 py-2 text-xs text-muted-foreground flex justify-between">
                <span>{calc.totalWeeks} wk{calc.totalWeeks !== 1 ? 's' : ''}</span>
                <span>{formatMoney(weeklyRate)}/wk &nbsp;({formatMoney(monthlyRate)}/mo ÷ 4)</span>
              </div>
              <div className="divide-y">
                {calc.weeks.map((w) => (
                  <div key={w.num} className={`flex items-center justify-between px-3 py-2 ${w.discounted ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium w-14">Week {w.num}</span>
                      <span className="text-muted-foreground text-xs">{fmtDay(w.start)}</span>
                      {w.discounted && <span className="text-xs text-amber-600 font-medium">{discountPct}% off</span>}
                    </div>
                    <div className="text-right">
                      <span className="font-medium">{formatMoney(w.amount)}</span>
                      {w.discounted && <span className="text-xs text-muted-foreground line-through ml-2">{formatMoney(weeklyRate)}</span>}
                    </div>
                  </div>
                ))}
                {extrasTotal !== 0 && (
                  <div className="flex justify-between px-3 py-2 text-sm text-muted-foreground">
                    <span>Rent subtotal</span>
                    <span>{formatMoney(calc.total)}</span>
                  </div>
                )}
                {extraItems.filter(x => x.description && Number(x.amount) > 0).map(x => (
                  <div key={x.id} className={`flex items-center justify-between px-3 py-2 text-sm ${x.type === 'credit' ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : 'bg-blue-50/40 dark:bg-blue-950/20'}`}>
                    <span className="text-muted-foreground">{x.description}</span>
                    <span className={x.type === 'credit' ? 'text-emerald-700 font-medium' : 'font-medium'}>
                      {x.type === 'credit' ? '−' : '+'} {formatMoney(Number(x.amount))}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between px-3 py-2.5 bg-accent/60 font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(Math.round((calc.total + extrasTotal) * 100) / 100)}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-destructive">End date must be after start date.</p>
          )}
        </>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field label="Due date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="1st month discount (%)">
          <Input type="number" min={0} max={100} value={discountPct}
            onChange={(e) => setDiscountPct(Number(e.target.value))} placeholder="0" />
        </Field>
        <Field label="Notes (optional)">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Month 1 rent" />
        </Field>
      </div>

      {/* Additional charges / credits */}
      <div className="rounded-lg border overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional items (optional)</span>
          <button type="button" onClick={addExtraItem}
            className="text-xs text-primary hover:underline cursor-pointer font-medium flex items-center gap-1">
            <Plus size={11} /> Add item
          </button>
        </div>
        {extraItems.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground text-center">
            No extra items. Click "Add item" to include locks, cleaning fees, credits, etc.
          </div>
        ) : (
          <div className="divide-y">
            {extraItems.map((x) => (
              <div key={x.id} className="flex items-center gap-2 px-3 py-2">
                <Input
                  value={x.description} placeholder="e.g. Lock deposit"
                  onChange={(e) => updateExtraItem(x.id, { description: e.target.value })}
                  className="flex-1 text-sm"
                />
                <select
                  value={x.type}
                  onChange={(e) => updateExtraItem(x.id, { type: e.target.value as 'charge' | 'credit' })}
                  className="rounded-md border bg-background px-2 py-1.5 text-sm w-24"
                >
                  <option value="charge">+ Charge</option>
                  <option value="credit">− Credit</option>
                </select>
                <Input
                  type="number" min={0} step="0.01" value={x.amount} placeholder="0.00"
                  onChange={(e) => updateExtraItem(x.id, { amount: e.target.value })}
                  className="w-24 text-right text-sm"
                />
                <button type="button" onClick={() => removeExtraItem(x.id)}
                  className="text-muted-foreground hover:text-destructive cursor-pointer shrink-0">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && <p className="text-xs text-destructive">{err}</p>}

      <Button className="w-full" disabled={busy || (preset === 'deposit' && !depositAmt) || (preset !== 'deposit' && !calc)}
        onClick={submit}>
        {busy ? 'Generating…' : 'Generate Invoice'}
      </Button>
    </div>
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
function SignInPersonModal({ contractNo, customerName, busy, error, onSign, onClose }: {
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
  onSubmit: (body: { method: string; paidDate: string; notes: string }) => void
}) {
  const [method, setMethod] = useState(payment.method || 'cash')
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Record <strong>{formatMoney(payment.amount)}</strong> due <strong>{formatDate(payment.dueDate)}</strong> as paid.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Payment method"><MethodSelect value={method} onChange={setMethod} /></Field>
        <Field label="Paid on"><Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} /></Field>
      </div>
      <Field label="Notes (optional)">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference no., remarks…" />
      </Field>
      <Button className="w-full" disabled={busy} onClick={() => onSubmit({ method, paidDate, notes })}>
        {busy ? 'Saving…' : 'Record payment'}
      </Button>
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
  total: number; paidTotal: number
  earliestDue: Date; latestDue: Date
  status: 'paid' | 'partial' | 'overdue' | 'pending'
}

const groupStatusTone: Record<string, string> = { paid: 'green', partial: 'amber', overdue: 'red', pending: 'amber' }
const groupStatusLabel: Record<string, string> = { paid: 'Paid', partial: 'Partial', overdue: 'Overdue', pending: 'Pending' }

function InvoiceGroupRow({ g, index, onRecord, onDelete, onSendWhatsApp, sendingInvoice, onGenerateForRemaining }: {
  g: InvoiceGroup; index: number
  onRecord: () => void; onDelete: () => void
  onSendWhatsApp: () => void; sendingInvoice: boolean
  onGenerateForRemaining?: () => void
}) {
  const fmtShort = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const rowBg = g.status === 'overdue' ? 'bg-red-50/60 dark:bg-red-950/20'
    : g.status === 'paid' ? 'bg-emerald-50/40 dark:bg-emerald-950/10' : ''

  return (
    <tr className={`${rowBg} hover:brightness-95`}>
      <Td className="text-muted-foreground text-xs tabular-nums">{index}</Td>
      <Td>
        <Link to={`/invoices/${g.invoiceRef._id}`} className="text-primary hover:underline font-medium text-sm">
          {g.invoiceRef.invoiceNo}
        </Link>
      </Td>
      <Td className="text-sm text-muted-foreground whitespace-nowrap">
        {fmtShort(g.earliestDue)}
        {g.payments.length > 1 && <> – {fmtShort(g.latestDue)}</>}
      </Td>
      <Td className="text-sm text-muted-foreground">{g.payments.length}</Td>
      <Td>
        <span className="font-medium">{formatMoney(g.total)}</span>
        {g.status === 'partial' && (
          <span className="text-xs text-muted-foreground ml-1.5">({formatMoney(g.paidTotal)} paid)</span>
        )}
      </Td>
      <Td><Badge tone={groupStatusTone[g.status]}>{groupStatusLabel[g.status]}</Badge></Td>
      <Td>
        <div className="flex items-center gap-2 text-xs whitespace-nowrap">
          <button className="text-emerald-700 hover:underline cursor-pointer" onClick={onSendWhatsApp} disabled={sendingInvoice}>
            {sendingInvoice ? 'Sending…' : 'WhatsApp'}
          </button>
          {g.paidInGroup.length > 0 && (
            <button
              className="inline-flex items-center gap-1 text-emerald-700 hover:underline cursor-pointer font-medium"
              onClick={() => downloadInvoiceReceipt(g.invoiceRef._id)}
              title="Download invoice PDF"
            >
              <FileText size={12} /> Receipt
            </button>
          )}
          {g.status === 'partial' && onGenerateForRemaining && (
            <button
              className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer font-medium"
              onClick={onGenerateForRemaining}
              title="Generate a new invoice for the remaining unpaid weeks"
            >
              <FilePlus size={12} /> Invoice remaining
            </button>
          )}
          {g.unpaidInGroup.length > 0 && (
            <Button size="sm" variant="outline" onClick={onRecord}>Record</Button>
          )}
          <button className="text-destructive hover:underline cursor-pointer" onClick={onDelete}>Delete</button>
        </div>
      </Td>
    </tr>
  )
}

// ── Payment row (standalone payments without invoice) ─────────────────────────
async function downloadInvoiceReceipt(invoiceId: string) {
  const res = await fetch(`/api/invoices/${invoiceId}/pdf`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('pb_token')}` },
  })
  if (!res.ok) { alert('Could not generate receipt'); return }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function PaymentRow({
  p,
  index,
  rate,
  isFirstForInvoice,
  onRecord,
  onEdit,
  onUnrecord,
  onDelete,
  onSendInvoiceWhatsApp,
  sendingInvoice,
}: {
  p: Payment; index: number; rate: number; isFirstForInvoice: boolean
  onRecord: () => void; onEdit: () => void; onUnrecord: () => void; onDelete: () => void
  onSendInvoiceWhatsApp: () => void
  sendingInvoice: boolean
}) {
  // rate is monthly; weekly payment = rate/4. First 4 payments may be discounted.
  const weeklyRate  = Math.round((rate / 4) * 100) / 100
  const isDiscounted = index < 4 && p.amount < weeklyRate
  const rowBg =
    p.status === 'overdue' ? 'bg-red-50/60 dark:bg-red-950/20' :
      p.status === 'paid' ? 'bg-emerald-50/40 dark:bg-emerald-950/10' : ''

  return (
    <tr className={`${rowBg} hover:brightness-95`}>
      <Td className="text-muted-foreground text-xs tabular-nums">{index + 1}</Td>
      <Td className={`text-sm ${p.status === 'overdue' ? 'text-red-600 font-medium' : ''}`}>
        {formatDate(p.dueDate)}
      </Td>
      <Td>
        <span className="font-medium">{formatMoney(p.amount)}</span>
        {isDiscounted && (
          <span className="ml-1.5 text-xs text-amber-600">(was {formatMoney(weeklyRate)})</span>
        )}
      </Td>
      <Td><Badge tone={paymentStatusTone[p.status]}>{statusLabel(p.status)}</Badge></Td>
      <Td className="text-sm">{formatDate(p.paidDate) || '—'}</Td>
      <Td className="text-sm capitalize">{p.method ? p.method.replace('_', ' ') : '—'}</Td>
      <Td className="text-xs text-muted-foreground max-w-[120px] truncate" title={p.notes}>{p.notes || '—'}</Td>
      <Td>
        <div className="flex items-center gap-2 text-xs whitespace-nowrap">
          {p.invoice && isFirstForInvoice && (
            <>
              <Link to={`/invoices/${p.invoice._id}`} className="text-primary hover:underline font-medium">
                {p.invoice.invoiceNo}
              </Link>
              <button
                className="text-emerald-700 hover:underline cursor-pointer"
                onClick={onSendInvoiceWhatsApp}
                disabled={sendingInvoice}
              >
                {sendingInvoice ? 'Sending…' : 'WhatsApp'}
              </button>
              {p.status === 'paid' && (
                <button
                  className="inline-flex items-center gap-1 text-emerald-700 hover:underline cursor-pointer font-medium"
                  onClick={() => downloadInvoiceReceipt(p.invoice!._id)}
                  title="Download invoice receipt PDF"
                >
                  <FileText size={12} /> Receipt
                </button>
              )}
            </>
          )}
          {p.status !== 'paid' && <Button size="sm" variant="outline" onClick={onRecord}>Record</Button>}
          {p.status === 'paid' && (
            <button className="text-amber-600 hover:underline cursor-pointer" onClick={onUnrecord}>Unrecord</button>
          )}
          <button className="text-primary hover:underline cursor-pointer" onClick={onEdit}>Edit</button>
          <button className="text-destructive hover:underline cursor-pointer" onClick={onDelete}>Delete</button>
        </div>
      </Td>
    </tr>
  )
}

// ── Section divider row ────────────────────────────────────────────────────────
function SectionRow({ label, count, total, tone, action }: {
  label: string; count: number; total: number; tone: string; action?: React.ReactNode
}) {
  const colors: Record<string, string> = {
    red: 'bg-red-100/80   text-red-800   dark:bg-red-950/40   dark:text-red-300',
    amber: 'bg-amber-100/80 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    green: 'bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  }
  return (
    <tr className={colors[tone]}>
      <td colSpan={action ? 7 : 8} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide">
        {label} — {count} payment{count !== 1 ? 's' : ''} · {formatMoney(total)}
      </td>
      {action && <td className="px-3 py-1 text-right">{action}</td>}
    </tr>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ContractDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const [recordingPayment, setRecordingPayment] = useState<Payment | null>(null)
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [bulkTarget, setBulkTarget] = useState<Payment[] | null>(null)
  const [addingPayment, setAddingPayment] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [signingInPerson, setSigningInPerson] = useState(false)
  const [signError, setSignError] = useState('')
  const [signingLink, setSigningLink] = useState('')
  const [signingLinkExpiry, setSigningLinkExpiry] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [sendingInvoiceId, setSendingInvoiceId] = useState<string | null>(null)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [invoiceOverride, setInvoiceOverride] = useState<{ start: string; end: string } | null>(null)

  const { data, isLoading } = useQuery<{ contract: Contract; payments: Payment[]; documents: AppDocument[] }>({
    queryKey: ['contract', id],
    queryFn: () => api.get(`/contracts/${id}`).then((r) => r.data),
  })

  const autoInvoice = useMutation({
    mutationFn: () => api.post(`/contracts/${id}/auto-invoices`, null, { params: { months: 3 } }),
    onSuccess: () => invalidate(),
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

  const unrecordPayment = useMutation({
    mutationFn: (paymentId: string) => api.post(`/payments/${paymentId}/unrecord`),
    onSuccess: () => invalidate(),
    onError: (e) => setError(apiError(e)),
  })

  const deletePayment = useMutation({
    mutationFn: (paymentId: string) => api.delete(`/payments/${paymentId}`),
    onSuccess: () => invalidate(),
    onError: (e) => setError(apiError(e)),
  })

  const addPayment = useMutation({
    mutationFn: (body: object) => api.post('/payments', body),
    onSuccess: () => { invalidate(); setAddingPayment(false) },
    onError: (e) => setError(apiError(e)),
  })

  const sendInvoiceWhatsApp = useMutation({
    mutationFn: (invoiceId: string) =>
      api.post(`/invoices/${invoiceId}/share`).then((r) => r.data as { url: string }),
    onSuccess: ({ url }) => {
      const c = data?.contract
      const phone = (c?.customer as any)?.phone?.replace(/\D/g, '') || ''
      const invoiceNo = data?.payments
        .find((p) => (p.invoice as any)?._id === sendingInvoiceId)
        ?.invoice?.invoiceNo ?? ''
      const text = [
        `Hello ${(c?.customer as any)?.fullName ?? 'there'},`,
        ``,
        `Your invoice${invoiceNo ? ` *${invoiceNo}*` : ''} from PurpleBox is ready.`,
        ``,
        `View & download:`,
        url,
        ``,
        `Thank you – PurpleBox`,
      ].join('\n')
      const waUrl = phone
        ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
        : `https://wa.me/?text=${encodeURIComponent(text)}`
      window.open(waUrl, '_blank', 'noopener,noreferrer')
      setSendingInvoiceId(null)
    },
    onError: (e) => {
      setSendingInvoiceId(null)
      setError(apiError(e))
    },
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

  const downloadContractPdf = async () => {
    if (!c?._id) return
    try {
      setDownloadingPdf(true); setError('')
      const response = await api.get(`/contracts/${c._id}/pdf`, { responseType: 'blob' })
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
    } catch (e) { setError(apiError(e)) }
    finally { setDownloadingPdf(false) }
  }

  if (isLoading || !data) return <Spinner />
  const { contract: c, payments, documents } = data

  // Sort and split
  const byDue = (a: Payment, b: Payment) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  const overdue = payments.filter((p) => p.status === 'overdue').sort(byDue)
  const pending = payments.filter((p) => p.status === 'pending').sort(byDue)
  const paid = payments.filter((p) => p.status === 'paid')
    .sort((a, b) => new Date(b.paidDate ?? b.dueDate).getTime() - new Date(a.paidDate ?? a.dueDate).getTime())


  const totalPaid = paid.reduce((s, p) => s + p.amount, 0)
  const totalPending = pending.reduce((s, p) => s + p.amount, 0)
  const totalOverdue = overdue.reduce((s, p) => s + p.amount, 0)
  // Group payments by invoice → one display row per invoice
  const groupMap = new Map<string, Payment[]>()
  const standalonePayments: Payment[] = []
  for (const p of payments) {
    const invId = (p.invoice as any)?._id
    if (invId) { if (!groupMap.has(invId)) groupMap.set(invId, []); groupMap.get(invId)!.push(p) }
    else standalonePayments.push(p)
  }
  const invoiceGroups: InvoiceGroup[] = Array.from(groupMap.entries()).map(([invId, ps]) => {
    const sorted = [...ps].sort(byDue)
    const paidInGroup = ps.filter(p => p.status === 'paid')
    const unpaidInGroup = ps.filter(p => p.status !== 'paid').sort(byDue)
    const anyOverdue = ps.some(p => p.status === 'overdue')
    const allPaid = unpaidInGroup.length === 0
    const anyPaid = paidInGroup.length > 0
    const status: InvoiceGroup['status'] = allPaid ? 'paid' : anyOverdue ? 'overdue' : anyPaid ? 'partial' : 'pending'
    return {
      invoiceId: invId,
      invoiceRef: ps[0].invoice as { _id: string; invoiceNo: string },
      payments: sorted, unpaidInGroup, paidInGroup,
      total: Math.round(ps.reduce((s, p) => s + p.amount, 0) * 100) / 100,
      paidTotal: Math.round(paidInGroup.reduce((s, p) => s + p.amount, 0) * 100) / 100,
      earliestDue: new Date(sorted[0].dueDate),
      latestDue: new Date(sorted[sorted.length - 1].dueDate),
      status,
    }
  }).sort((a, b) => a.earliestDue.getTime() - b.earliestDue.getTime())

  const unpaidGroups = invoiceGroups.filter(g => g.status !== 'paid')
  const paidGroups   = invoiceGroups.filter(g => g.status === 'paid')
  const totalUnpaidGroups = unpaidGroups.reduce((s, g) => s + g.total - g.paidTotal, 0)

  const allUnits = c.units?.length ? c.units : [c.unit]
  const unitLabel = allUnits.length > 1
    ? `Units: ${allUnits.map((u) => u.unitNumber).join(', ')}`
    : `Unit ${c.unit?.unitNumber}${c.unit?.sizeSqf != null ? ` · ${c.unit.sizeSqf} sq ft` : ''}`

  // allUnpaid for "Pay multiple" header button
  const allUnpaid = [...overdue, ...pending]

  return (
    <div>
      <PageHeader
        title={c.contractNo}
        subtitle={`${c.customer?.fullName} · ${unitLabel}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadContractPdf} disabled={downloadingPdf}>
              <Download size={14} /> {downloadingPdf ? 'Opening PDF...' : 'Contract PDF'}
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
          </div>
        }
      />

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

      {/* ── Contract details + stats ── */}
      <div className="grid gap-4 lg:grid-cols-[340px_1fr] mb-4">
        <Card>
          <CardHeader title="Contract details" action={<Badge tone={contractStatusTone[c.status]}>{statusLabel(c.status)}</Badge>} />
          <CardBody className="pt-0 divide-y text-sm">
            {([
              ['Customer', <Link key="c" to={`/customers/${c.customer?._id}`} className="text-primary hover:underline">{c.customer?.fullName}</Link>],
              ['Billing period', <span key="b" className="capitalize">{c.billingPeriod}</span>],
              ['Monthly rate', formatMoney(c.rate)],
              ['Weekly payment', formatMoney(Math.round(c.rate / 4 * 100) / 100)],
              ['Deposit', formatMoney(c.deposit)],
              ['Start date', formatDate(c.startDate)],
              ['End date', formatDate(c.endDate)],
              ['Auto-renew', c.autoRenew ? 'Yes' : 'No'],
              ['Payment method', c.paymentMethod || null],
              ['First payment', c.firstPaymentDate ? formatDate(c.firstPaymentDate) : null],
              ['Next payment', c.nextPaymentDate ? formatDate(c.nextPaymentDate) : null],
            ] as [string, React.ReactNode][]).map(([label, val]) =>
              val == null ? null : (
                <div key={label} className="grid grid-cols-[150px_1fr] gap-2 py-1.5">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <span>{val}</span>
                </div>
              )
            )}
            {/* Units — one row per unit so multi-unit contracts show clearly */}
            {allUnits.map((u, i) => (
              <div key={u._id} className="grid grid-cols-[150px_1fr] gap-2 py-1.5">
                <span className="text-xs text-muted-foreground">{i === 0 ? (allUnits.length > 1 ? 'Units' : 'Unit') : ''}</span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{u.unitNumber}</span>
                  {u.sizeSqf != null && <span className="text-xs text-muted-foreground">{u.sizeSqf} sq ft</span>}
                  {allUnits.length > 1 && i === 0 && (
                    <span className="rounded-full bg-primary/10 text-primary text-[10px] font-medium px-1.5 py-0.5">{allUnits.length} units</span>
                  )}
                </span>
              </div>
            ))}
            {c.signedDocUrl && (
              <div className="py-1.5">
                <a href={c.signedDocUrl} target="_blank" rel="noreferrer" className="text-primary text-xs hover:underline">View signed contract →</a>
              </div>
            )}
            {c.notes && (
              <div className="grid grid-cols-[150px_1fr] gap-2 py-1.5">
                <span className="text-xs text-muted-foreground">Notes</span>
                <span>{c.notes}</span>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          {/* Payment summary stats */}
          {(() => {
            // Theoretical contract total from dates + rate (regardless of what's been invoiced)
            const contractDays = c.startDate && c.endDate
              ? Math.round((new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / 86400000)
              : 0
            const contractWeeks = contractDays > 0 ? Math.ceil(contractDays / 7) : 0
            const wRate = Math.round((c.rate / 4) * 100) / 100
            const dPct = Number(c.unit?.discountPct ?? 0)
            const discountedRate = Math.round(wRate * (1 - dPct / 100) * 100) / 100
            const discountWeeks = Math.min(4, contractWeeks)
            const theoreticalTotal = dPct > 0
              ? Math.round((discountWeeks * discountedRate + (contractWeeks - discountWeeks) * wRate) * 100) / 100
              : Math.round(contractWeeks * wRate * 100) / 100

            // Next upcoming invoice group total (first unpaid invoice group)
            const nextGroup = unpaidGroups[0]
            const upcomingAmount = nextGroup ? (nextGroup.total - nextGroup.paidTotal) : totalPending

            const stats: { label: string; amount: number; sub: string; tone: string }[] = [
              {
                label: 'Contract Total',
                amount: theoreticalTotal,
                sub: `${contractWeeks} wk${contractWeeks !== 1 ? 's' : ''} · ${formatMoney(wRate)}/wk`,
                tone: 'gray',
              },
              {
                label: 'Collected',
                amount: totalPaid,
                sub: `${paidGroups.length} invoice${paidGroups.length !== 1 ? 's' : ''} paid`,
                tone: 'green',
              },
              {
                label: 'Upcoming',
                amount: upcomingAmount,
                sub: nextGroup ? nextGroup.invoiceRef.invoiceNo : (unpaidGroups.length === 0 ? 'all paid' : 'next due'),
                tone: 'blue',
              },
              {
                label: 'Overdue',
                amount: totalOverdue,
                sub: totalOverdue > 0 ? `${overdue.length} payment${overdue.length !== 1 ? 's' : ''}` : 'none',
                tone: 'red',
              },
            ]

            const bg: Record<string, string> = {
              gray: 'bg-muted/60 border',
              green: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/40 border',
              blue: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/40 border',
              red: 'border',
            }
            const text: Record<string, string> = {
              gray: 'text-foreground',
              green: 'text-emerald-700 dark:text-emerald-400',
              blue: 'text-blue-700 dark:text-blue-400',
              red: 'text-red-700 dark:text-red-400',
            }
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {stats.map(({ label, amount, sub, tone }) => (
                  <div key={label} className={`rounded-xl px-4 py-3 ${bg[tone]} ${tone === 'red' && amount === 0 ? 'bg-muted/60' : ''}`}>
                    <div className="text-xs text-muted-foreground mb-1">{label}</div>
                    <div className={`text-xl font-bold ${tone === 'red' && amount === 0 ? 'text-muted-foreground' : text[tone]}`}>
                      {formatMoney(amount)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>
                  </div>
                ))}
              </div>
            )
          })()}

          {/* Authorized persons */}
          {(c.authorizedPersons?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Authorized access persons" subtitle={`${c.authorizedPersons!.length} listed`} />
              <CardBody className="pt-0 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {c.authorizedPersons!.map((p, i) => (
                  <div key={i} className="rounded-lg border px-3 py-2 space-y-0.5">
                    <div className="font-medium text-sm">{p.name}</div>
                    {p.relation && <div className="text-xs text-muted-foreground">{p.relation}</div>}
                    {p.phone && <div className="text-xs text-muted-foreground">{p.phone}</div>}
                    {(p.idType || p.idNumber) && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <ShieldCheck size={10} className="shrink-0" />
                        {[p.idType, p.idNumber].filter(Boolean).join(': ')}
                      </div>
                    )}
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {/* ── Payment schedule ── */}
      <Card className="mb-4">
        <CardHeader
          title="Payment schedule"
          subtitle={
            payments.length === 0
              ? 'No invoices yet'
              : `${paidGroups.length} of ${invoiceGroups.length} invoice${invoiceGroups.length !== 1 ? 's' : ''} paid · ${formatMoney(totalPaid)} collected`
          }
          action={
            <div className="flex gap-2">
              {allUnpaid.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setBulkTarget(allUnpaid)}>
                  <CalendarDays size={13} /> Pay multiple
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setShowInvoiceModal(true)}>
                <FilePlus size={13} /> Invoice
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAddingPayment(true)}>
                <Plus size={13} /> Add
              </Button>
            </div>
          }
        />

        {payments.length === 0 ? (
          <CardBody>
            <div className="text-center py-6 space-y-2">
              <p className="text-sm text-muted-foreground">
                No payments yet. Use the <strong>Invoice</strong> button above to generate an invoice — each invoice line will automatically create a payment entry here.
              </p>
            </div>
          </CardBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Invoice</Th>
                <Th>Period</Th>
                <Th>Weeks</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {unpaidGroups.length > 0 && (
                <>
                  <SectionRow
                    label="Upcoming" count={unpaidGroups.length} total={totalUnpaidGroups} tone="amber"
                    action={
                      allUnpaid.length > 1 ? (
                        <button
                          className="text-xs text-amber-700 dark:text-amber-400 font-medium hover:underline cursor-pointer whitespace-nowrap"
                          onClick={() => setBulkTarget(allUnpaid)}
                        >
                          Pay multiple
                        </button>
                      ) : undefined
                    }
                  />
                  {unpaidGroups.map((g, i) => (
                    <InvoiceGroupRow key={g.invoiceId} g={g} index={i + 1}
                      onRecord={() => {
                        if (g.unpaidInGroup.length === 1) setRecordingPayment(g.unpaidInGroup[0])
                        else setBulkTarget(g.unpaidInGroup)
                      }}
                      onDelete={() => { if (confirm(`Delete all ${g.payments.length} payment entries for ${g.invoiceRef.invoiceNo}?`)) g.payments.forEach(p => deletePayment.mutate(p._id)) }}
                      onSendWhatsApp={() => { setSendingInvoiceId(g.invoiceId); sendInvoiceWhatsApp.mutate(g.invoiceId) }}
                      sendingInvoice={sendInvoiceWhatsApp.isPending && sendingInvoiceId === g.invoiceId}
                      onGenerateForRemaining={() => {
                        // Pre-fill modal with the unpaid weeks of this partial invoice
                        const unpaidDates = g.unpaidInGroup.map(p => new Date(p.dueDate).getTime())
                        const firstUnpaid = new Date(Math.min(...unpaidDates))
                        const lastUnpaid  = new Date(Math.max(...unpaidDates))
                        lastUnpaid.setDate(lastUnpaid.getDate() + 7)
                        const toISO = (d: Date) => d.toISOString().slice(0, 10)
                        setInvoiceOverride({ start: toISO(firstUnpaid), end: toISO(lastUnpaid) })
                        setShowInvoiceModal(true)
                      }}
                    />
                  ))}
                  {standalonePayments.filter(p => p.status !== 'paid').map((p) => (
                    <PaymentRow key={p._id} p={p} index={0} rate={c.rate} isFirstForInvoice={false}
                      onRecord={() => setRecordingPayment(p)}
                      onEdit={() => setEditingPayment(p)}
                      onUnrecord={() => { if (confirm('Unrecord this payment?')) unrecordPayment.mutate(p._id) }}
                      onDelete={() => { if (confirm('Delete this payment?')) deletePayment.mutate(p._id) }}
                      onSendInvoiceWhatsApp={() => {}}
                      sendingInvoice={false}
                    />
                  ))}
                </>
              )}

              {paidGroups.length > 0 && (
                <>
                  <SectionRow label="Paid" count={paidGroups.length} total={totalPaid} tone="green" />
                  {paidGroups.map((g, i) => (
                    <InvoiceGroupRow key={g.invoiceId} g={g} index={unpaidGroups.length + i + 1}
                      onRecord={() => {}}
                      onDelete={() => { if (confirm(`Delete all ${g.payments.length} payment entries for ${g.invoiceRef.invoiceNo}?`)) g.payments.forEach(p => deletePayment.mutate(p._id)) }}
                      onSendWhatsApp={() => { setSendingInvoiceId(g.invoiceId); sendInvoiceWhatsApp.mutate(g.invoiceId) }}
                      sendingInvoice={sendInvoiceWhatsApp.isPending && sendingInvoiceId === g.invoiceId}
                    />
                  ))}
                  {standalonePayments.filter(p => p.status === 'paid').map((p) => (
                    <PaymentRow key={p._id} p={p} index={0} rate={c.rate} isFirstForInvoice={false}
                      onRecord={() => setRecordingPayment(p)}
                      onEdit={() => setEditingPayment(p)}
                      onUnrecord={() => { if (confirm('Unrecord this payment?')) unrecordPayment.mutate(p._id) }}
                      onDelete={() => { if (confirm('Delete this payment?')) deletePayment.mutate(p._id) }}
                      onSendInvoiceWhatsApp={() => {}}
                      sendingInvoice={false}
                    />
                  ))}
                </>
              )}
            </tbody>
          </Table>
        )}

        {/* All-paid prompt — auto-generate or open manual modal */}
        {payments.length > 0 && unpaidGroups.length === 0 && standalonePayments.filter(p => p.status !== 'paid').length === 0 && c.status === 'active' && (
          <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 mx-4 mb-4">
            <div>
              <div className="text-sm font-medium">All invoices paid</div>
              <div className="text-xs text-muted-foreground">Auto-generate the next period, or create a custom invoice</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowInvoiceModal(true)}>
                <FilePlus size={13} /> Custom
              </Button>
              <Button size="sm" onClick={() => autoInvoice.mutate()} disabled={autoInvoice.isPending}>
                <FilePlus size={13} /> {autoInvoice.isPending ? 'Generating…' : 'Auto-generate'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Documents ── */}
      <Card>
        <CardHeader
          title="Documents"
          action={<Button size="sm" variant="outline" onClick={() => setUploading(true)}><Upload size={13} /> Upload</Button>}
        />
        {documents.length === 0 ? (
          <EmptyState message="No documents attached to this contract." />
        ) : (
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

      {/* ── Modals ── */}
      <Modal open={!!recordingPayment} onClose={() => setRecordingPayment(null)} title="Record payment">
        {recordingPayment && (
          <RecordPaymentForm
            payment={recordingPayment}
            busy={recordPayment.isPending}
            onSubmit={(body) => recordPayment.mutate({ paymentId: recordingPayment._id, body })}
          />
        )}
      </Modal>

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

      <Modal open={uploading} onClose={() => setUploading(false)} title="Upload document">
        <UploadDocumentForm
          contractId={c._id}
          customerId={c.customer?._id}
          onDone={() => { invalidate(); setUploading(false) }}
        />
      </Modal>

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
            onDone={() => { setShowInvoiceModal(false); setInvoiceOverride(null); invalidate(); qc.invalidateQueries({ queryKey: ['invoices'] }) }}
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
                href={`https://wa.me/${c.customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi ${c.customer.fullName}, please sign your storage contract (${c.contractNo}) using this link: ${signingLink}`)}`}
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
    </div>
  )
}

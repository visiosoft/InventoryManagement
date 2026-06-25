import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Download, FileText, FilePlus, MessageSquare, PenLine, Plus, ShieldCheck, Upload, X, XCircle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { AppDocument, Contract, ContractNote, Payment } from '../lib/types'
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Field, Input, Modal, Select, Spinner,
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

// ── Contract timeline (notes / follow-ups) ────────────────────────────────────
function ContractTimeline({ notes, onAdd, onDelete, addBusy }: {
  notes: ContractNote[]
  onAdd: (text: string) => void
  onDelete: (idx: number) => void
  addBusy: boolean
}) {
  const [text, setText] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    onAdd(text.trim())
    setText('')
  }

  const fmtAt = (d: string) => {
    const dt = new Date(d)
    return (
      dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' · ' +
      dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    )
  }

  const noteColors = [
    'bg-[#fef9c3] border-[#fde047] text-yellow-900',
    'bg-[#dcfce7] border-[#86efac] text-green-900',
    'bg-[#dbeafe] border-[#93c5fd] text-blue-900',
    'bg-[#fce7f3] border-[#f9a8d4] text-pink-900',
    'bg-[#ede9fe] border-[#c4b5fd] text-violet-900',
    'bg-[#ffedd5] border-[#fdba74] text-orange-900',
  ]

  const rotations = ['-rotate-1', 'rotate-1', '-rotate-[0.5deg]', 'rotate-[0.8deg]', '-rotate-[1.2deg]', 'rotate-[0.3deg]']

  return (
    <div className="space-y-4">
      {/* Add note form */}
      <form onSubmit={submit} className="flex gap-2 items-end">
        <Textarea
          className="flex-1 resize-none"
          placeholder="Type a note or follow-up — what did you discuss, what's the next step…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
        />
        <Button type="submit" disabled={addBusy || !text.trim()} className="shrink-0">
          {addBusy ? 'Saving…' : 'Add note'}
        </Button>
      </form>

      {notes.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">No notes yet. Add your first note above.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {[...notes].reverse().map((note, ri) => {
            const origIdx = notes.length - 1 - ri
            const color = noteColors[origIdx % noteColors.length]
            const rot = rotations[origIdx % rotations.length]
            return (
              <div
                key={ri}
                className={`relative rounded-sm border-l-4 px-4 pt-3 pb-4 shadow-md transition-transform hover:scale-[1.01] ${color} ${rot}`}
              >
                {/* Pin */}
                <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-white/60 border border-white/80 shadow-sm" />

                {/* Header */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold opacity-50 leading-none">#{notes.length - ri}</span>
                    <time className="text-[10px] opacity-60 leading-none">{fmtAt(note.at)}</time>
                    {note.author && (
                      <span className="text-[10px] font-semibold opacity-70">· {note.author}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    title="Delete note"
                    onClick={() => { if (confirm('Delete this note?')) onDelete(origIdx) }}
                    className="opacity-40 hover:opacity-80 transition-opacity cursor-pointer"
                  >
                    <X size={12} />
                  </button>
                </div>

                {/* Text */}
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words font-medium">{note.text}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
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
  const [editModal, setEditModal] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'payments' | 'documents' | 'activity'>('overview')

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

  const updateContract = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/contracts/${id}`, body),
    onSuccess: () => { invalidate(); setEditModal(false); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const addNote = useMutation({
    mutationFn: (text: string) =>
      api.post(`/contracts/${id}/notes`, { text, author: user?.name || '' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contract', id] }),
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

  const allUnits = c.units?.length ? c.units : c.unit ? [c.unit] : []
  const unitLabel = allUnits.length > 1
    ? `Units: ${allUnits.map((u) => u?.unitNumber ?? '—').join(', ')}`
    : allUnits.length === 1
      ? `Unit ${allUnits[0]?.unitNumber ?? '—'}${allUnits[0]?.sizeSqf != null ? ` · ${allUnits[0].sizeSqf} sq ft` : ''}`
      : 'No unit assigned'

  // allUnpaid for "Pay multiple" header button
  const allUnpaid = [...overdue, ...pending]

  // Sidebar computed values
  const initials = (c.customer?.fullName ?? '').split(' ').slice(0, 2).map((w: string) => w[0] ?? '').join('').toUpperCase()
  const today2 = new Date(); today2.setHours(0, 0, 0, 0)
  const daysLeft = c.endDate ? Math.ceil((new Date(c.endDate).getTime() - today2.getTime()) / 86400000) : null
  const contractWeeks2 = c.startDate && c.endDate ? Math.ceil(Math.round((new Date(c.endDate).getTime() - new Date(c.startDate).getTime()) / 86400000) / 7) : 0
  const wRate2 = Math.round((c.rate / 4) * 100) / 100
  const dPct2 = Number(c.unit?.discountPct ?? 0)
  const theoreticalTotal2 = dPct2 > 0
    ? Math.round((Math.min(4, contractWeeks2) * Math.round(wRate2 * (1 - dPct2 / 100) * 100) / 100 + Math.max(0, contractWeeks2 - 4) * wRate2) * 100) / 100
    : Math.round(contractWeeks2 * wRate2 * 100) / 100
  const customerPhone = c.customer?.phones?.[0] ?? c.customer?.phone ?? ''
  const waPhone = customerPhone.replace(/\D/g, '').replace(/^00/, '')
  const waText = [`Hello ${c.customer?.fullName ?? 'there'},`, ``, `This is a message regarding your storage contract *${c.contractNo}*.`, `${unitLabel}`, ``, `Thank you – PurpleBox`].join('\n')
  const waUrl = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}` : `https://wa.me/?text=${encodeURIComponent(waText)}`

  // Activity feed
  type ActivityEvent = { id: string; type: 'overdue' | 'paid' | 'note'; at: Date; title: string; subtitle: string }
  const activityEvents: ActivityEvent[] = []
  for (const p of overdue) {
    const daysLate = Math.round((today2.getTime() - new Date(p.dueDate).getTime()) / 86400000)
    activityEvents.push({ id: `ovd-${p._id}`, type: 'overdue', at: new Date(), title: 'Payment overdue', subtitle: `${(p.invoice as any)?.invoiceNo ?? ''} · ${formatDate(p.dueDate)} is ${daysLate}d late` })
  }
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
    const period = inv?.invoiceNo ? ` · ${inv.invoiceNo}` : ''
    activityEvents.push({ id: `paid-${group[0]._id}`, type: 'paid', at: latestPaid, title: 'Payment received', subtitle: `${c.paymentMethod ?? 'Cash'}${period} · ${formatMoney(total)}` })
  }
  for (const note of (c.timeline ?? [])) {
    activityEvents.push({ id: `note-${note.at}`, type: 'note', at: new Date(note.at), title: note.text, subtitle: note.author ? `by ${note.author}` : '' })
  }
  activityEvents.sort((a, b) => b.at.getTime() - a.at.getTime())

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
        <Link to="/contracts" className="hover:text-foreground transition-colors">Contracts</Link>
        <span>/</span>
        <span className="text-foreground font-medium">{c.contractNo}</span>
      </div>

      {/* Title + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-2xl font-bold tracking-tight">Contract overview</h1>
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
          </div>
        </div>

        {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

        {/* ── Main layout ── */}
        <div className="flex gap-5 items-start">
          {/* Left sidebar */}
          <div className="w-72 shrink-0 space-y-4">
            <Card>
              <CardBody className="space-y-4">
                {/* Avatar + name */}
                <div className="flex flex-col items-center text-center pt-2 pb-1">
                  <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold mb-2 select-none">
                    {initials}
                  </div>
                  <Link to={`/customers/${c.customer?._id}`} className="font-semibold text-base hover:underline leading-tight">
                    {c.customer?.fullName}
                  </Link>
                  <p className="text-xs text-muted-foreground mt-0.5">{c.contractNo}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap justify-center">
                    <Badge tone={contractStatusTone[c.status]}>{statusLabel(c.status)}</Badge>
                    {daysLeft !== null && daysLeft >= 0 && (
                      <span className="text-xs text-muted-foreground">{daysLeft}d left</span>
                    )}
                  </div>
                </div>

                {/* Record payment */}
                <Button className="w-full" onClick={() => allUnpaid.length > 0 ? (allUnpaid.length === 1 ? setRecordingPayment(allUnpaid[0]) : setBulkTarget(allUnpaid)) : setAddingPayment(true)}>
                  <CalendarDays size={15} /> Record payment
                </Button>

                {/* Message + PDF */}
                <div className="grid grid-cols-2 gap-2">
                  <a href={waUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors">
                    <MessageSquare size={14} /> Message
                  </a>
                  <Button variant="outline" className="w-full" onClick={downloadContractPdf} disabled={downloadingPdf}>
                    <Download size={14} /> PDF
                  </Button>
                </div>

                {/* Balance bar */}
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-xs text-muted-foreground font-medium">
                    <span>BALANCE</span>
                    <span>AED {formatMoney(totalPaid)} / {formatMoney(theoreticalTotal2)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${theoreticalTotal2 > 0 ? Math.min(100, (totalPaid / theoreticalTotal2) * 100) : 0}%` }} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 px-3 py-2">
                      <div className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide">Overdue</div>
                      <div className="text-lg font-bold text-red-700 dark:text-red-400">{formatMoney(totalOverdue)}</div>
                    </div>
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40 px-3 py-2">
                      <div className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Upcoming</div>
                      <div className="text-lg font-bold text-blue-700 dark:text-blue-400">{formatMoney(totalPending)}</div>
                    </div>
                  </div>
                </div>

                {/* Contract detail rows */}
                <div className="divide-y border-t text-sm pt-1">
                  {allUnits.map((u, i) => (
                    <div key={u._id} className="flex justify-between py-2">
                      <span className="text-muted-foreground">{i === 0 ? 'Unit' : ''}</span>
                      <span className="font-medium">{u.unitNumber}{u.sizeSqf != null ? ` · ${u.sizeSqf} sq ft` : ''}</span>
                    </div>
                  ))}
                  {c.startDate && c.endDate && (
                    <div className="flex justify-between py-2">
                      <span className="text-muted-foreground">Term</span>
                      <span className="font-medium text-right">
                        {new Date(c.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} → {new Date(c.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between py-2">
                    <span className="text-muted-foreground">Weekly</span>
                    <span className="font-medium">AED {formatMoney(wRate2)}</span>
                  </div>
                  {c.paymentMethod && (
                    <div className="flex justify-between py-2">
                      <span className="text-muted-foreground">Method</span>
                      <span className="font-medium">{c.paymentMethod}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-2 items-center">
                    <span className="text-muted-foreground">Auto-renew</span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.autoRenew ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                      {c.autoRenew ? 'On' : 'Off'}
                    </span>
                  </div>
                  {customerPhone && (
                    <div className="flex justify-between py-2 items-center gap-2">
                      <span className="text-muted-foreground shrink-0">Phone</span>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium truncate text-right">{customerPhone}</span>
                        <a href={waUrl} target="_blank" rel="noopener noreferrer"
                          className="shrink-0 inline-flex items-center gap-0.5 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400">
                          <MessageSquare size={9} /> WA
                        </a>
                      </div>
                    </div>
                  )}
                </div>

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
            <div className="flex gap-1 border-b mb-4">
              {([
                ['overview', 'Overview', 0],
                ['payments', 'Payments', unpaidGroups.length],
                ['documents', 'Documents', 0],
                ['activity', 'Activity', 0],
              ] as [typeof activeTab, string, number][]).map(([key, label, count]) => (
                <button key={key} onClick={() => setActiveTab(key)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px flex items-center gap-1.5 ${
                    activeTab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
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
                {totalOverdue > 0 && (
                  <div className="flex items-center gap-3 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-4 py-3 mb-4">
                    <XCircle size={20} className="text-red-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-red-700 dark:text-red-400">AED {formatMoney(totalOverdue)} overdue · {overdue.length} payment{overdue.length !== 1 ? 's' : ''}</span>
                      {overdue[0] && (
                        <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-0.5">
                          {(overdue[0].invoice as any)?.invoiceNo} is {Math.round((new Date().getTime() - new Date(overdue[0].dueDate).getTime()) / 86400000)}d late. Resolve before auto-renew on {c.endDate ? new Date(c.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}.
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => {
                        const text = [`Hello ${c.customer?.fullName ?? 'there'},`, ``, `This is a reminder that your payment for contract *${c.contractNo}* is overdue.`, ``, `Please get in touch with us at your earliest convenience.`, ``, `Thank you – PurpleBox`].join('\n')
                        window.open(waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
                      }}>
                        <MessageSquare size={13} /> Remind
                      </Button>
                      <Button size="sm" onClick={() => setBulkTarget(overdue)}>
                        <CalendarDays size={13} /> Collect
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-[1fr_300px] gap-4">
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
                              <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                                ev.type === 'overdue' ? 'bg-red-100 dark:bg-red-950/40 text-red-600' :
                                ev.type === 'paid' ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600' :
                                'bg-muted text-muted-foreground'
                              }`}>
                                {ev.type === 'overdue' && <XCircle size={15} />}
                                {ev.type === 'paid' && <CheckCircle2 size={15} />}
                                {ev.type === 'note' && <MessageSquare size={15} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-sm font-medium leading-tight">{ev.title}</p>
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    {ev.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                  </span>
                                </div>
                                {ev.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{ev.subtitle}</p>}
                                {ev.type === 'overdue' && (
                                  <button className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
                                    onClick={() => { const p = overdue.find(x => activityEvents.find(a => a.id === `ovd-${x._id}`)?.id === ev.id); if (p) setRecordingPayment(p) }}>
                                    <CalendarDays size={11} /> Collect now
                                  </button>
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
                <CardHeader title="Payment schedule"
                  subtitle={payments.length === 0 ? 'No invoices yet' : `${paidGroups.length} of ${invoiceGroups.length} invoice${invoiceGroups.length !== 1 ? 's' : ''} paid · ${formatMoney(totalPaid)} collected`}
                  action={
                    <div className="flex gap-2">
                      {allUnpaid.length > 0 && <Button size="sm" variant="outline" onClick={() => setBulkTarget(allUnpaid)}><CalendarDays size={13} /> Pay multiple</Button>}
                      <Button size="sm" variant="outline" onClick={() => setShowInvoiceModal(true)}><FilePlus size={13} /> Invoice</Button>
                      <Button size="sm" variant="outline" onClick={() => setAddingPayment(true)}><Plus size={13} /> Add</Button>
                    </div>
                  }
                />
                {payments.length === 0 ? (
                  <CardBody><p className="text-sm text-muted-foreground text-center py-6">No payments yet. Use the <strong>Invoice</strong> button to generate an invoice.</p></CardBody>
                ) : (
                  <Table>
                    <thead><tr><Th>#</Th><Th>Invoice</Th><Th>Period</Th><Th>Weeks</Th><Th>Amount</Th><Th>Status</Th><Th /></tr></thead>
                    <tbody>
                      {unpaidGroups.length > 0 && (
                        <>
                          <SectionRow label="Upcoming" count={unpaidGroups.length} total={totalUnpaidGroups} tone="amber"
                            action={allUnpaid.length > 1 ? <button className="text-xs text-amber-700 dark:text-amber-400 font-medium hover:underline cursor-pointer whitespace-nowrap" onClick={() => setBulkTarget(allUnpaid)}>Pay multiple</button> : undefined}
                          />
                          {unpaidGroups.map((g, i) => (
                            <InvoiceGroupRow key={g.invoiceId} g={g} index={i + 1}
                              onRecord={() => { if (g.unpaidInGroup.length === 1) setRecordingPayment(g.unpaidInGroup[0]); else setBulkTarget(g.unpaidInGroup) }}
                              onDelete={() => { if (confirm(`Delete all ${g.payments.length} payment entries for ${g.invoiceRef.invoiceNo}?`)) g.payments.forEach(p => deletePayment.mutate(p._id)) }}
                              onSendWhatsApp={() => { setSendingInvoiceId(g.invoiceId); sendInvoiceWhatsApp.mutate(g.invoiceId) }}
                              sendingInvoice={sendInvoiceWhatsApp.isPending && sendingInvoiceId === g.invoiceId}
                              onGenerateForRemaining={() => {
                                const unpaidDates = g.unpaidInGroup.map(p => new Date(p.dueDate).getTime())
                                const firstUnpaid = new Date(Math.min(...unpaidDates))
                                const lastUnpaid = new Date(Math.max(...unpaidDates))
                                lastUnpaid.setDate(lastUnpaid.getDate() + 7)
                                const toISO = (d: Date) => d.toISOString().slice(0, 10)
                                setInvoiceOverride({ start: toISO(firstUnpaid), end: toISO(lastUnpaid) })
                                setShowInvoiceModal(true)
                              }}
                            />
                          ))}
                          {standalonePayments.filter(p => p.status !== 'paid').map((p) => (
                            <PaymentRow key={p._id} p={p} index={0} rate={c.rate} isFirstForInvoice={false}
                              onRecord={() => setRecordingPayment(p)} onEdit={() => setEditingPayment(p)}
                              onUnrecord={() => { if (confirm('Unrecord this payment?')) unrecordPayment.mutate(p._id) }}
                              onDelete={() => { if (confirm('Delete this payment?')) deletePayment.mutate(p._id) }}
                              onSendInvoiceWhatsApp={() => {}} sendingInvoice={false}
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
                              onRecord={() => setRecordingPayment(p)} onEdit={() => setEditingPayment(p)}
                              onUnrecord={() => { if (confirm('Unrecord this payment?')) unrecordPayment.mutate(p._id) }}
                              onDelete={() => { if (confirm('Delete this payment?')) deletePayment.mutate(p._id) }}
                              onSendInvoiceWhatsApp={() => {}} sendingInvoice={false}
                            />
                          ))}
                        </>
                      )}
                    </tbody>
                  </Table>
                )}
                {payments.length > 0 && unpaidGroups.length === 0 && standalonePayments.filter(p => p.status !== 'paid').length === 0 && c.status === 'active' && (
                  <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 mx-4 mb-4">
                    <div>
                      <div className="text-sm font-medium">All invoices paid</div>
                      <div className="text-xs text-muted-foreground">Auto-generate the next period, or create a custom invoice</div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setShowInvoiceModal(true)}><FilePlus size={13} /> Custom</Button>
                      <Button size="sm" onClick={() => autoInvoice.mutate()} disabled={autoInvoice.isPending}><FilePlus size={13} /> {autoInvoice.isPending ? 'Generating…' : 'Auto-generate'}</Button>
                    </div>
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

            {/* ACTIVITY */}
            {activeTab === 'activity' && (
              <Card>
                <CardHeader title="Notes & Activity"
                  subtitle={c.timeline?.length ? `${c.timeline.length} note${c.timeline.length !== 1 ? 's' : ''}` : 'Track conversations and follow-ups'}
                  action={<MessageSquare size={15} className="text-muted-foreground" />}
                />
                <CardBody className="pt-0 space-y-4">
                  <ContractTimeline
                    notes={c.timeline || []}
                    onAdd={(text) => addNote.mutate(text)}
                    onDelete={(idx) => deleteNote.mutate(idx)}
                    addBusy={addNote.isPending}
                  />
                </CardBody>
              </Card>
            )}
          </div>
        </div>

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

      {/* ── Edit Contract Modal ── */}
      <Modal open={editModal} onClose={() => setEditModal(false)} title="Edit Contract" wide>
        {editModal && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              updateContract.mutate({
                rate: Number(f.get('rate')),
                deposit: Number(f.get('deposit')),
                billingPeriod: String(f.get('billingPeriod')),
                startDate: String(f.get('startDate')),
                endDate: String(f.get('endDate')),
                autoRenew: f.get('autoRenew') === 'true',
                paymentMethod: String(f.get('paymentMethod') || ''),
                firstPaymentDate: f.get('firstPaymentDate') ? String(f.get('firstPaymentDate')) : undefined,
                notes: String(f.get('notes') || ''),
              })
            }}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <Field label="Monthly Rate (AED)">
                <Input name="rate" type="number" min="0" step="0.01" defaultValue={c.rate} required />
              </Field>
              <Field label="Deposit (AED)">
                <Input name="deposit" type="number" min="0" step="0.01" defaultValue={c.deposit} />
              </Field>
              <Field label="Billing Period">
                <Select name="billingPeriod" defaultValue={c.billingPeriod}>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </Select>
              </Field>
              <Field label="Payment Method">
                <Select name="paymentMethod" defaultValue={c.paymentMethod || ''}>
                  <option value="">— Select —</option>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                  <option value="card">Card</option>
                </Select>
              </Field>
              <Field label="Start Date">
                <Input name="startDate" type="date" defaultValue={c.startDate?.slice(0, 10)} required />
              </Field>
              <Field label="End Date">
                <Input name="endDate" type="date" defaultValue={c.endDate?.slice(0, 10)} required />
              </Field>
              <Field label="First Payment Date">
                <Input name="firstPaymentDate" type="date" defaultValue={c.firstPaymentDate?.slice(0, 10)} />
              </Field>
              <Field label="Auto Renew">
                <Select name="autoRenew" defaultValue={c.autoRenew ? 'true' : 'false'}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
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
        )}
      </Modal>
    </div>
  )
}

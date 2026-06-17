import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Download, FileText, PenLine, Plus, RefreshCw, ShieldCheck, Upload, XCircle } from 'lucide-react'
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
    canvas.width  = rect.width  * dpr
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
  const [mode, setMode]         = useState<'draw' | 'type'>('draw')
  const [signerName, setName]   = useState(customerName)
  const [sigDataUrl, setSigUrl] = useState<string | null>(null)
  const [agreed, setAgreed]     = useState(false)

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
            className={`flex-1 py-1.5 font-medium transition-colors ${
              mode === m ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
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
  const [method,   setMethod]   = useState(payment.method || 'cash')
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes,    setNotes]    = useState('')
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
  const [amount,   setAmount]   = useState(String(payment.amount))
  const [dueDate,  setDueDate]  = useState(toInput(payment.dueDate))
  const [paidDate, setPaidDate] = useState(toInput(payment.paidDate))
  const [method,   setMethod]   = useState(payment.method || 'cash')
  const [notes,    setNotes]    = useState(payment.notes || '')
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
  const [count,    setCount]    = useState(unpaid.length)   // default: all
  const [method,   setMethod]   = useState('cash')
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes,    setNotes]    = useState('')

  const selected  = unpaid.slice(0, count)
  const total     = selected.reduce((s, p) => s + p.amount, 0)
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
        {overdueIn > 0 && <div className="flex justify-between"><span className="text-red-600">Overdue ({overdueIn})</span><span>{formatMoney(selected.filter(p=>p.status==='overdue').reduce((s,p)=>s+p.amount,0))}</span></div>}
        {pendingIn > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Upcoming ({pendingIn})</span><span>{formatMoney(selected.filter(p=>p.status==='pending').reduce((s,p)=>s+p.amount,0))}</span></div>}
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
  const [amount,  setAmount]  = useState(String(rate))
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes,   setNotes]   = useState('')
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

// ── Payment row ────────────────────────────────────────────────────────────────
async function downloadReceipt(paymentId: string) {
  const res = await fetch(`/api/payments/${paymentId}/receipt`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('pb_token')}` },
  })
  if (!res.ok) { alert('Could not generate receipt'); return }
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function PaymentRow({ p, index, rate, onRecord, onEdit, onUnrecord, onDelete }: {
  p: Payment; index: number; rate: number
  onRecord: () => void; onEdit: () => void; onUnrecord: () => void; onDelete: () => void
}) {
  const isDiscounted = index === 0 && p.amount < rate
  const rowBg =
    p.status === 'overdue' ? 'bg-red-50/60 dark:bg-red-950/20' :
    p.status === 'paid'    ? 'bg-emerald-50/40 dark:bg-emerald-950/10' : ''

  return (
    <tr className={`${rowBg} hover:brightness-95`}>
      <Td className="text-muted-foreground text-xs tabular-nums">{index + 1}</Td>
      <Td className={`text-sm ${p.status === 'overdue' ? 'text-red-600 font-medium' : ''}`}>
        {formatDate(p.dueDate)}
      </Td>
      <Td>
        <span className="font-medium">{formatMoney(p.amount)}</span>
        {isDiscounted && (
          <span className="ml-1.5 text-xs text-amber-600">(was {formatMoney(rate)})</span>
        )}
      </Td>
      <Td><Badge tone={paymentStatusTone[p.status]}>{statusLabel(p.status)}</Badge></Td>
      <Td className="text-sm">{formatDate(p.paidDate) || '—'}</Td>
      <Td className="text-sm capitalize">{p.method ? p.method.replace('_', ' ') : '—'}</Td>
      <Td className="text-xs text-muted-foreground max-w-[120px] truncate" title={p.notes}>{p.notes || '—'}</Td>
      <Td>
        <div className="flex items-center gap-2 text-xs whitespace-nowrap">
          {p.status !== 'paid' && <Button size="sm" variant="outline" onClick={onRecord}>Record</Button>}
          {p.status === 'paid' && (
            <>
              <button
                className="inline-flex items-center gap-1 text-emerald-700 hover:underline cursor-pointer font-medium"
                onClick={() => downloadReceipt(p._id)}
                title="Download receipt PDF"
              >
                <FileText size={12} /> Receipt
              </button>
              <button className="text-amber-600 hover:underline cursor-pointer" onClick={onUnrecord}>Unrecord</button>
            </>
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
    red:   'bg-red-100/80   text-red-800   dark:bg-red-950/40   dark:text-red-300',
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
  const [error,            setError]            = useState('')
  const [recordingPayment, setRecordingPayment] = useState<Payment | null>(null)
  const [editingPayment,   setEditingPayment]   = useState<Payment | null>(null)
  const [bulkTarget,       setBulkTarget]       = useState<'all' | 'overdue' | null>(null)
  const [addingPayment,    setAddingPayment]     = useState(false)
  const [uploading,        setUploading]         = useState(false)
  const [downloadingPdf,   setDownloadingPdf]    = useState(false)
  const [signingInPerson,  setSigningInPerson]   = useState(false)
  const [signError,        setSignError]         = useState('')
  const [signingLink,      setSigningLink]       = useState('')
  const [signingLinkExpiry, setSigningLinkExpiry] = useState('')
  const [linkCopied,       setLinkCopied]        = useState(false)

  const { data, isLoading } = useQuery<{ contract: Contract; payments: Payment[]; documents: AppDocument[] }>({
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
  const paid    = payments.filter((p) => p.status === 'paid')
    .sort((a, b) => new Date(b.paidDate ?? b.dueDate).getTime() - new Date(a.paidDate ?? a.dueDate).getTime())

  // unpaid list in chronological order (overdue first, then pending) for bulk pay
  const unpaid = [...overdue, ...pending]

  const totalPaid     = paid.reduce((s, p) => s + p.amount, 0)
  const totalPending  = pending.reduce((s, p) => s + p.amount, 0)
  const totalOverdue  = overdue.reduce((s, p) => s + p.amount, 0)
  const totalContract = payments.reduce((s, p) => s + p.amount, 0)

  // For index display (show position in full schedule)
  const allSorted = [...payments].sort(byDue)

  const allUnits = c.units?.length ? c.units : [c.unit]
  const unitLabel = allUnits.length > 1
    ? `Units: ${allUnits.map((u) => u.unitNumber).join(', ')}`
    : `Unit ${c.unit?.unitNumber}${c.unit?.sizeSqf != null ? ` · ${c.unit.sizeSqf} sq ft` : ''}`

  // Bulk modal target set
  const bulkPayments = bulkTarget === 'overdue' ? overdue : unpaid

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
              ['Customer',       <Link key="c" to={`/customers/${c.customer?._id}`} className="text-primary hover:underline">{c.customer?.fullName}</Link>],
              ['Billing period', <span key="b" className="capitalize">{c.billingPeriod}</span>],
              ['Rate per period',formatMoney(c.rate)],
              ['Deposit',        formatMoney(c.deposit)],
              ['Start date',     formatDate(c.startDate)],
              ['End date',       formatDate(c.endDate)],
              ['Auto-renew',     c.autoRenew ? 'Yes' : 'No'],
              ['Payment method', c.paymentMethod || null],
              ['First payment',  c.firstPaymentDate ? formatDate(c.firstPaymentDate) : null],
              ['Next payment',   c.nextPaymentDate  ? formatDate(c.nextPaymentDate)  : null],
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {([
              ['Total value',     totalContract, 'gray'],
              ['Collected',       totalPaid,     'green'],
              ['Upcoming',        totalPending,  'blue'],
              ['Overdue',         totalOverdue,  'red'],
            ] as [string, number, string][]).map(([label, amount, tone]) => {
              const bg: Record<string, string> = {
                gray:  'bg-muted/60 border',
                green: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/40 border',
                blue:  'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/40 border',
                red:   amount > 0 ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/40 border' : 'bg-muted/60 border',
              }
              const text: Record<string, string> = {
                gray:  'text-foreground',
                green: 'text-emerald-700 dark:text-emerald-400',
                blue:  'text-blue-700 dark:text-blue-400',
                red:   amount > 0 ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground',
              }
              return (
                <div key={label} className={`rounded-xl px-4 py-3 ${bg[tone]}`}>
                  <div className="text-xs text-muted-foreground mb-1">{label}</div>
                  <div className={`text-xl font-bold ${text[tone]}`}>{formatMoney(amount)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {tone === 'gray'  && `${payments.length} instalment${payments.length !== 1 ? 's' : ''}`}
                    {tone === 'green' && `${paid.length} paid`}
                    {tone === 'blue'  && `${pending.length} upcoming`}
                    {tone === 'red'   && (amount > 0 ? `${overdue.length} overdue` : 'none')}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Authorized persons */}
          {(c.authorizedPersons?.length ?? 0) > 0 && (
            <Card>
              <CardHeader title="Authorized access persons" subtitle={`${c.authorizedPersons!.length} listed`} />
              <CardBody className="pt-0 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {c.authorizedPersons!.map((p, i) => (
                  <div key={i} className="rounded-lg border px-3 py-2 space-y-0.5">
                    <div className="font-medium text-sm">{p.name}</div>
                    {p.relation && <div className="text-xs text-muted-foreground">{p.relation}</div>}
                    {p.phone    && <div className="text-xs text-muted-foreground">{p.phone}</div>}
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
              ? 'No payments generated yet'
              : `${paid.length} of ${payments.length} paid · ${formatMoney(totalPaid)} collected`
          }
          action={
            <div className="flex gap-2">
              {/* Generate / Regenerate schedule */}
              <Button
                size="sm" variant="outline"
                onClick={() => {
                  const msg = payments.length > 0
                    ? `This will delete all ${unpaid.length} unpaid entries and regenerate from the contract dates. Paid history is kept. Continue?`
                    : 'Generate the full payment schedule from contract dates?'
                  if (confirm(msg)) action.mutate('generate-schedule')
                }}
                disabled={action.isPending}
                title="Generate or regenerate payment schedule"
              >
                <RefreshCw size={13} /> {payments.length === 0 ? 'Generate schedule' : 'Regenerate'}
              </Button>
              {/* Pay multiple / all */}
              {unpaid.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setBulkTarget('all')}>
                  <CalendarDays size={13} /> Pay {unpaid.length > 1 ? 'multiple' : 'now'}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setAddingPayment(true)}>
                <Plus size={13} /> Add
              </Button>
            </div>
          }
        />

        {payments.length === 0 ? (
          <CardBody>
            <div className="text-center py-6 space-y-3">
              <p className="text-sm text-muted-foreground">
                No payment schedule yet. Click <strong>Generate schedule</strong> to create the full
                {' '}{c.billingPeriod} instalment plan from {formatDate(c.startDate)} to {formatDate(c.endDate)}.
              </p>
              <Button
                onClick={() => action.mutate('generate-schedule')}
                disabled={action.isPending}
              >
                <RefreshCw size={14} /> Generate schedule
              </Button>
            </div>
          </CardBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Due date</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Paid on</Th>
                <Th>Method</Th>
                <Th>Notes</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {overdue.length > 0 && (
                <>
                  <SectionRow
                    label="Overdue" count={overdue.length} total={totalOverdue} tone="red"
                    action={
                      <button
                        className="text-xs text-red-700 dark:text-red-400 font-medium hover:underline cursor-pointer whitespace-nowrap"
                        onClick={() => setBulkTarget('overdue')}
                      >
                        Record all overdue
                      </button>
                    }
                  />
                  {overdue.map((p) => (
                    <PaymentRow key={p._id} p={p} index={allSorted.indexOf(p)} rate={c.rate}
                      onRecord={() => setRecordingPayment(p)}
                      onEdit={() => setEditingPayment(p)}
                      onUnrecord={() => { if (confirm('Unrecord this payment?')) unrecordPayment.mutate(p._id) }}
                      onDelete={() => { if (confirm('Delete this payment?')) deletePayment.mutate(p._id) }}
                    />
                  ))}
                </>
              )}

              {pending.length > 0 && (
                <>
                  <SectionRow
                    label="Upcoming" count={pending.length} total={totalPending} tone="amber"
                    action={
                      pending.length > 1 ? (
                        <button
                          className="text-xs text-amber-700 dark:text-amber-400 font-medium hover:underline cursor-pointer whitespace-nowrap"
                          onClick={() => setBulkTarget('all')}
                        >
                          Pay multiple
                        </button>
                      ) : undefined
                    }
                  />
                  {pending.map((p) => (
                    <PaymentRow key={p._id} p={p} index={allSorted.indexOf(p)} rate={c.rate}
                      onRecord={() => setRecordingPayment(p)}
                      onEdit={() => setEditingPayment(p)}
                      onUnrecord={() => { if (confirm('Unrecord this payment?')) unrecordPayment.mutate(p._id) }}
                      onDelete={() => { if (confirm('Delete this payment?')) deletePayment.mutate(p._id) }}
                    />
                  ))}
                </>
              )}

              {paid.length > 0 && (
                <>
                  <SectionRow label="Paid history" count={paid.length} total={totalPaid} tone="green" />
                  {paid.map((p) => (
                    <PaymentRow key={p._id} p={p} index={allSorted.indexOf(p)} rate={c.rate}
                      onRecord={() => setRecordingPayment(p)}
                      onEdit={() => setEditingPayment(p)}
                      onUnrecord={() => { if (confirm('Unrecord this payment?')) unrecordPayment.mutate(p._id) }}
                      onDelete={() => { if (confirm('Delete this payment?')) deletePayment.mutate(p._id) }}
                    />
                  ))}
                </>
              )}
            </tbody>
          </Table>
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
        title={bulkTarget === 'overdue' ? 'Record all overdue payments' : 'Pay multiple periods'}
        wide
      >
        {bulkTarget !== null && bulkPayments.length > 0 && (
          <BulkPayForm
            unpaid={bulkPayments}
            billingPeriod={c.billingPeriod}
            busy={bulkRecord.isPending}
            onSubmit={(body) => bulkRecord.mutate(body)}
          />
        )}
      </Modal>

      <Modal open={addingPayment} onClose={() => setAddingPayment(false)} title="Add payment entry">
        <AddPaymentForm
          contractId={c._id}
          rate={c.rate}
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

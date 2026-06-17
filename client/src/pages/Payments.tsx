import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FileText, Plus, Search } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { Contract, Payment } from '../lib/types'
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th,
  Textarea, paymentStatusTone, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

interface PaymentSummary {
  overdue:       { count: number; total: number }
  pending:       { count: number; total: number }
  paidThisMonth: { count: number; total: number }
  dueThisMonth:  { count: number; total: number }
}

// ── Summary stat card ──────────────────────────────────────────────────────────
function StatCard({ label, count, total, tone }: { label: string; count: number; total: number; tone: string }) {
  const colors: Record<string, string> = {
    red:   'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30',
    amber: 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30',
    green: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/30',
    blue:  'border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/30',
  }
  const textColors: Record<string, string> = {
    red:   'text-red-700 dark:text-red-400',
    amber: 'text-amber-700 dark:text-amber-400',
    green: 'text-emerald-700 dark:text-emerald-400',
    blue:  'text-blue-700 dark:text-blue-400',
  }
  return (
    <div className={`rounded-xl border px-5 py-4 ${colors[tone]}`}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold ${textColors[tone]}`}>{formatMoney(total)}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{count} payment{count !== 1 ? 's' : ''}</div>
    </div>
  )
}

// ── Record / Add payment form ──────────────────────────────────────────────────
function RecordForm({
  payment,
  busy,
  error,
  onSubmit,
}: {
  payment: Payment
  busy: boolean
  error: string
  onSubmit: (body: { method: string; paidDate: string; notes: string }) => void
}) {
  const [method, setMethod]     = useState(payment.method || 'cash')
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes]       = useState('')

  return (
    <div className="space-y-4">
      <p className="text-sm">
        Recording <strong>{formatMoney(payment.amount)}</strong> due {formatDate(payment.dueDate)}
        {' '}for <strong>{payment.contract?.customer?.fullName}</strong> — Unit {payment.contract?.unit?.unitNumber}.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Payment method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="card">Card</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Paid on">
          <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference number, remarks…" />
      </Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button className="w-full" disabled={busy} onClick={() => onSubmit({ method, paidDate, notes })}>
        {busy ? 'Saving…' : 'Record payment'}
      </Button>
    </div>
  )
}

// ── Edit payment form ──────────────────────────────────────────────────────────
function EditForm({
  payment,
  busy,
  error,
  onSubmit,
}: {
  payment: Payment
  busy: boolean
  error: string
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
          <Input type="number" min={0.01} step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Due date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </Field>
      </div>
      {payment.status === 'paid' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid on">
            <Input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="card">Card</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </Select>
          </Field>
        </div>
      )}
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" />
      </Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
    </form>
  )
}

// ── Manual add payment form ────────────────────────────────────────────────────
function AddPaymentForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean
  error: string
  onSubmit: (body: { contract: string; amount: string; dueDate: string; notes: string }) => void
}) {
  const { data: contracts } = useQuery<Contract[]>({
    queryKey: ['contracts', ''],
    queryFn: () => api.get('/contracts', { params: { status: 'active' } }).then((r) => r.data),
  })
  const [contract, setContract] = useState('')
  const [amount, setAmount]     = useState('')
  const [dueDate, setDueDate]   = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes]       = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit({ contract, amount, dueDate, notes })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Contract *">
        <Select value={contract} onChange={(e) => setContract(e.target.value)} required>
          <option value="">— Select active contract —</option>
          {(contracts || []).map((c) => (
            <option key={c._id} value={c._id}>
              {c.contractNo} — {c.customer?.fullName} (Unit {c.unit?.unitNumber})
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount (AED) *">
          <Input type="number" min={0.01} step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Due date *">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes…" />
      </Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Adding…' : 'Add payment'}</Button>
    </form>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Payments() {
  const qc = useQueryClient()

  // Filters
  const [status,  setStatus]  = useState('')
  const [search,  setSearch]  = useState('')
  const [month,   setMonth]   = useState('')   // 'YYYY-MM' or ''

  // Modal state
  const [recording,  setRecording]  = useState<Payment | null>(null)
  const [editing,    setEditing]    = useState<Payment | null>(null)
  const [adding,     setAdding]     = useState(false)
  const [modalError, setModalError] = useState('')

  // Build date range from selected month
  const dateParams: Record<string, string> = {}
  if (month) {
    const [y, m] = month.split('-').map(Number)
    dateParams.from = `${month}-01`
    const last = new Date(y, m, 0).getDate()
    dateParams.to   = `${month}-${String(last).padStart(2, '0')}`
  }

  const queryParams = { ...(status ? { status } : {}), ...(search ? { search } : {}), ...dateParams }

  const { data: payments, isLoading } = useQuery<Payment[]>({
    queryKey: ['payments', status, search, month],
    queryFn: () => api.get('/payments', { params: queryParams }).then((r) => r.data),
  })

  const { data: summary } = useQuery<PaymentSummary>({
    queryKey: ['payments-summary'],
    queryFn: () => api.get('/payments/summary').then((r) => r.data),
    refetchInterval: 60_000,
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['payments'] })
    qc.invalidateQueries({ queryKey: ['payments-summary'] })
    qc.invalidateQueries({ queryKey: ['summary'] })
  }

  const record = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api.post(`/payments/${id}/record`, body),
    onSuccess: () => { invalidate(); setRecording(null); setModalError('') },
    onError: (e) => setModalError(apiError(e)),
  })

  const unrecord = useMutation({
    mutationFn: (id: string) => api.post(`/payments/${id}/unrecord`),
    onSuccess: () => invalidate(),
    onError: (e) => alert(apiError(e)),
  })

  const editMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api.put(`/payments/${id}`, body),
    onSuccess: () => { invalidate(); setEditing(null); setModalError('') },
    onError: (e) => setModalError(apiError(e)),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/payments/${id}`),
    onSuccess: () => invalidate(),
    onError: (e) => alert(apiError(e)),
  })

  const addMut = useMutation({
    mutationFn: (body: object) => api.post('/payments', body),
    onSuccess: () => { invalidate(); setAdding(false); setModalError('') },
    onError: (e) => setModalError(apiError(e)),
  })

  const now = new Date()
  const currentMonthLabel = now.toLocaleString('default', { month: 'long', year: 'numeric' })

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Track rent and storage payments across all units"
        action={
          <Button onClick={() => { setAdding(true); setModalError('') }}>
            <Plus size={15} /> Add payment
          </Button>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="Overdue"           count={summary?.overdue.count       ?? 0} total={summary?.overdue.total       ?? 0} tone="red"   />
        <StatCard label={`Due in ${currentMonthLabel}`} count={summary?.dueThisMonth.count ?? 0} total={summary?.dueThisMonth.total ?? 0} tone="amber" />
        <StatCard label={`Paid in ${currentMonthLabel}`} count={summary?.paidThisMonth.count ?? 0} total={summary?.paidThisMonth.total ?? 0} tone="green" />
        <StatCard label="All pending"       count={summary?.pending.count       ?? 0} total={summary?.pending.total       ?? 0} tone="blue"  />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 w-56"
            placeholder="Customer or unit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="">All statuses</option>
          <option value="overdue">Overdue</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
        </Select>
        <Input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-44"
          title="Filter by due date month"
        />
        {(status || search || month) && (
          <Button variant="outline" size="sm" onClick={() => { setStatus(''); setSearch(''); setMonth('') }}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Unit</Th>
                <Th>Contract</Th>
                <Th>Due date</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th>Method</Th>
                <Th>Paid on</Th>
                <Th>Notes</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(payments || []).map((p) => (
                <tr key={p._id} className="hover:bg-muted/50">
                  <Td>
                    <Link to={`/customers/${p.contract?.customer?._id}`} className="font-medium text-primary hover:underline">
                      {p.contract?.customer?.fullName}
                    </Link>
                  </Td>
                  <Td className="font-mono text-sm">{p.contract?.unit?.unitNumber}</Td>
                  <Td>
                    <Link to={`/contracts/${p.contract?._id}`} className="text-primary hover:underline text-xs">
                      {p.contract?.contractNo}
                    </Link>
                  </Td>
                  <Td className={`text-sm ${p.status === 'overdue' ? 'text-red-600 font-medium' : ''}`}>
                    {formatDate(p.dueDate)}
                  </Td>
                  <Td className="font-medium">{formatMoney(p.amount)}</Td>
                  <Td><Badge tone={paymentStatusTone[p.status]}>{statusLabel(p.status)}</Badge></Td>
                  <Td className="capitalize text-sm">{p.method ? p.method.replace('_', ' ') : '—'}</Td>
                  <Td className="text-sm">{formatDate(p.paidDate) || '—'}</Td>
                  <Td className="text-xs text-muted-foreground max-w-[140px] truncate">{p.notes || '—'}</Td>
                  <Td>
                    <div className="flex items-center gap-2 text-xs whitespace-nowrap">
                      {p.status !== 'paid' && (
                        <Button size="sm" variant="outline"
                          onClick={() => { setRecording(p); setModalError('') }}>
                          Record
                        </Button>
                      )}
                      {p.status === 'paid' && (
                        <>
                          <button
                            className="inline-flex items-center gap-1 text-emerald-700 hover:underline cursor-pointer font-medium"
                            onClick={async () => {
                              const res = await fetch(`/api/payments/${p._id}/receipt`, {
                                headers: { Authorization: `Bearer ${localStorage.getItem('pb_token')}` },
                              })
                              if (!res.ok) { alert('Could not generate receipt'); return }
                              const blob = await res.blob()
                              const url  = URL.createObjectURL(blob)
                              window.open(url, '_blank', 'noopener,noreferrer')
                              setTimeout(() => URL.revokeObjectURL(url), 60_000)
                            }}
                          >
                            <FileText size={12} /> Receipt
                          </button>
                          <button
                            className="text-amber-600 hover:underline cursor-pointer"
                            onClick={() => { if (confirm('Unrecord this payment?')) unrecord.mutate(p._id) }}
                          >
                            Unrecord
                          </button>
                        </>
                      )}
                      <button className="text-primary hover:underline cursor-pointer"
                        onClick={() => { setEditing(p); setModalError('') }}>
                        Edit
                      </button>
                      <button
                        className="text-destructive hover:underline cursor-pointer"
                        onClick={() => { if (confirm('Delete this payment entry?')) deleteMut.mutate(p._id) }}
                      >
                        Delete
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {(payments || []).length === 0 && (
            <EmptyState message={
              status || search || month
                ? 'No payments match the current filters.'
                : 'No payments yet. Payments are created automatically when a contract is activated.'
            } />
          )}
        </Card>
      )}

      {/* Record payment modal */}
      <Modal open={!!recording} onClose={() => { setRecording(null); setModalError('') }} title="Record payment">
        {recording && (
          <RecordForm
            payment={recording}
            busy={record.isPending}
            error={modalError}
            onSubmit={(body) => record.mutate({ id: recording._id, body })}
          />
        )}
      </Modal>

      {/* Edit payment modal */}
      <Modal open={!!editing} onClose={() => { setEditing(null); setModalError('') }} title="Edit payment">
        {editing && (
          <EditForm
            payment={editing}
            busy={editMut.isPending}
            error={modalError}
            onSubmit={(body) => editMut.mutate({ id: editing._id, body })}
          />
        )}
      </Modal>

      {/* Add manual payment modal */}
      <Modal open={adding} onClose={() => { setAdding(false); setModalError('') }} title="Add payment">
        <AddPaymentForm
          busy={addMut.isPending}
          error={modalError}
          onSubmit={(body) => addMut.mutate(body)}
        />
      </Modal>
    </div>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Search, Receipt, ArrowRight, AlertCircle, CheckCircle2, Clock, Trash2, Plus, X } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { Customer, MovingInvoice, MovingInvoiceStatus } from '../../lib/types'
import { Badge, Button, Field, Input, Modal, Spinner, Textarea } from '../../components/ui'
import { formatDate } from '../../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const STATUSES: { value: MovingInvoiceStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
]

const statusTone: Record<MovingInvoiceStatus, string> = {
  draft: 'gray', sent: 'blue', partial: 'yellow', paid: 'green', cancelled: 'red',
}

const statusDot: Record<string, string> = {
  draft: '#94A3B8', sent: '#3B82F6', partial: '#F59E0B', paid: '#10B981', cancelled: '#EF4444',
}

function StatCard({ label, value, sub, icon, iconBg, iconColor }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode; iconBg: string; iconColor: string
}) {
  return (
    <div className="p-3 sm:p-5" style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16 }}>
      <div className="flex justify-between items-start gap-1">
        <div className="text-xs sm:text-[13px]" style={{ color: MUTED, fontWeight: 500 }}>{label}</div>
        <div className="w-7 h-7 sm:w-9 sm:h-9 shrink-0" style={{ borderRadius: 10, background: iconBg, display: 'grid', placeItems: 'center', color: iconColor }}>
          {icon}
        </div>
      </div>
      <div className="text-xl sm:text-[32px] mt-1 sm:mt-2" style={{ ...HEADING, fontWeight: 700, color: INK }}>{value}</div>
      {sub && <div className="text-[11px] sm:text-xs mt-1" style={{ color: MUTED }}>{sub}</div>}
    </div>
  )
}

function fmtAed(n: number) {
  return `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtAedShort(n: number) {
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `AED ${(n / 1_000).toFixed(1)}K`
  return fmtAed(n)
}

type LineItem = { description: string; qty: number; rate: number; amount: number }
const emptyItem = (): LineItem => ({ description: '', qty: 1, rate: 0, amount: 0 })
const today = () => new Date().toISOString().slice(0, 10)
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) }

export default function MovingInvoices() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [filterStatus, setFilterStatus] = useState<MovingInvoiceStatus | ''>('')
  const [search, setSearch] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [err, setErr] = useState('')

  // New invoice modal state
  const [newModal, setNewModal] = useState(false)
  const [custSearch, setCustSearch] = useState('')
  const [custId, setCustId] = useState('')
  const [custName, setCustName] = useState('')
  const [invDate, setInvDate] = useState(today)
  const [dueDate, setDueDate] = useState(tomorrow)
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyItem()])
  const [deposit, setDeposit] = useState('')
  const [invNotes, setInvNotes] = useState('')
  const [newErr, setNewErr] = useState('')

  const { data: custPage } = useQuery<{ data: Customer[] }>({
    queryKey: ['customers-search', custSearch],
    queryFn: () => api.get('/customers', { params: { search: custSearch, limit: 20 } }).then(r => r.data),
    enabled: custSearch.length > 0,
  })
  const custResults = custPage?.data ?? []

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/moving-invoices', body).then(r => r.data),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ['moving-invoices'] })
      setNewModal(false)
      navigate(`/moving/invoices/${inv._id}`)
    },
    onError: (e) => setNewErr(apiError(e)),
  })

  function resetNewForm() {
    setCustSearch(''); setCustId(''); setCustName('')
    setInvDate(today()); setDueDate(tomorrow())
    setLineItems([emptyItem()]); setDeposit(''); setInvNotes(''); setNewErr('')
  }

  function updateLine(idx: number, field: keyof LineItem, val: string) {
    setLineItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      const updated = { ...it, [field]: field === 'description' ? val : Number(val) }
      if (field === 'qty' || field === 'rate') updated.amount = updated.qty * updated.rate
      return updated
    }))
  }

  function submitNewInvoice(e: React.FormEvent) {
    e.preventDefault()
    if (!custId) { setNewErr('Please select a customer'); return }
    const validItems = lineItems.filter(it => it.description && it.amount > 0)
    if (validItems.length === 0) { setNewErr('Add at least one line item'); return }
    const total = validItems.reduce((s, it) => s + it.amount, 0)
    createMut.mutate({
      customer: custId, invoiceDate: invDate, dueDate,
      items: validItems, total, depositPaid: Number(deposit) || 0,
      notes: invNotes,
    })
  }

  const { data: allInvoices = [], isLoading } = useQuery<MovingInvoice[]>({
    queryKey: ['moving-invoices'],
    queryFn: () => api.get('/moving-invoices').then(r => r.data),
  })

  const now = new Date()
  const outstanding = allInvoices
    .filter(inv => !['paid', 'cancelled'].includes(inv.status))
    .reduce((s, inv) => s + (inv.balanceDue ?? 0), 0)
  const paidThisMonth = allInvoices
    .filter(inv => {
      if (inv.status !== 'paid' && inv.status !== 'partial') return false
      if (!inv.invoiceDate) return false
      const d = new Date(inv.invoiceDate)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
    .reduce((s, inv) => s + inv.total - (inv.balanceDue ?? 0), 0)
  const totalRevenue = allInvoices
    .filter(inv => inv.status === 'paid')
    .reduce((s, inv) => s + inv.total, 0)

  const counts = STATUSES.slice(1).reduce((acc, s) => {
    acc[s.value as string] = allInvoices.filter(inv => inv.status === s.value).length
    return acc
  }, {} as Record<string, number>)

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/moving-invoices/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['moving-invoices'] }); setDeleteId(null) },
    onError: (e) => setErr(apiError(e)),
  })

  const filtered = allInvoices.filter(inv => {
    const matchStatus = !filterStatus || inv.status === filterStatus
    const matchSearch = !search ||
      inv.invoiceNo.toLowerCase().includes(search.toLowerCase()) ||
      inv.customer?.fullName?.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Moving Invoices</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{allInvoices.length} invoices total</div>
        </div>
        <Button onClick={() => { resetNewForm(); setNewModal(true) }}>
          <Plus size={15} className="mr-1" />New Invoice
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-7">
        <StatCard label="Outstanding" value={fmtAedShort(outstanding)} sub={`${allInvoices.filter(inv => !['paid', 'cancelled'].includes(inv.status)).length} unpaid`} icon={<AlertCircle size={18} />} iconBg="#FEF2F2" iconColor="#EF4444" />
        <StatCard label="Collected This Month" value={fmtAedShort(paidThisMonth)} sub={now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} icon={<Clock size={18} />} iconBg="#FFF7ED" iconColor="#EA580C" />
        <StatCard label="Total Revenue" value={fmtAedShort(totalRevenue)} sub={`${allInvoices.filter(inv => inv.status === 'paid').length} fully paid`} icon={<CheckCircle2 size={18} />} iconBg="#ECFDF5" iconColor="#059669" />
      </div>

      {/* Search + status pills */}
      <div className="flex flex-col gap-2.5 mb-5">
        <div style={{ height: 40, borderRadius: 10, background: '#F3F0EA' }} className="flex items-center gap-2 px-3">
          <Search size={16} color={MUTED} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by invoice number or customer…"
            style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 14, color: INK }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUSES.map(s => {
            const count = s.value === '' ? allInvoices.length : (counts[s.value as string] ?? 0)
            const active = filterStatus === s.value
            return (
              <button
                key={s.value}
                onClick={() => setFilterStatus(s.value)}
                style={{
                  height: 36,
                  borderRadius: 10,
                  background: active ? PURPLE : '#F3F0EA',
                  color: active ? 'white' : MUTED,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '0 12px',
                  border: 'none',
                }}
                className="flex items-center gap-1.5 hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                {s.value && <span style={{ width: 6, height: 6, borderRadius: 3, background: active ? 'white' : statusDot[s.value as string] }} />}
                {s.label}
                <span style={{ fontSize: 11, opacity: 0.7 }}>{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '60px 20px', textAlign: 'center' }}>
          <Receipt size={32} style={{ margin: '0 auto 12px', color: MUTED, opacity: 0.3 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>No invoices found</div>
          <div style={{ fontSize: 13, color: MUTED }}>
            {search ? 'Try a different search term' : 'No invoices match the selected filter'}
          </div>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {filtered.map(inv => (
              <Link key={inv._id} to={`/moving/invoices/${inv._id}`}
                style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: 16 }}
                className="block hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span style={{ fontSize: 13, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{inv.invoiceNo}</span>
                      <Badge tone={statusTone[inv.status]} className="text-xs py-0 h-4">{inv.status}</Badge>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>{inv.customer?.fullName}</div>
                    <div className="flex items-center justify-between gap-2">
                      <span style={{ fontSize: 12, color: MUTED }}>{formatDate(inv.invoiceDate)}</span>
                      <div className="text-right">
                        <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>AED {inv.total.toLocaleString()}</div>
                        {inv.balanceDue > 0 && (
                          <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 600 }}>Due: AED {inv.balanceDue.toLocaleString()}</div>
                        )}
                      </div>
                    </div>
                  </div>
                  <ArrowRight size={14} style={{ color: MUTED, flexShrink: 0, marginTop: 2 }} />
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block" style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                    {['Invoice No', 'Customer', 'Job', 'Date', 'Total', 'Balance Due', 'Status', 'Via Stripe', ''].map((h, i) => (
                      <th key={h || i} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: MUTED, textAlign: ['Total', 'Balance Due'].includes(h) ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(inv => (
                    <tr key={inv._id} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                      <td style={{ padding: '14px 16px' }}>
                        <Link to={`/moving/invoices/${inv._id}`} style={{ fontSize: 13, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }} className="hover:opacity-80 transition-opacity">
                          {inv.invoiceNo}
                        </Link>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, color: INK }}>{inv.customer?.fullName}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13 }}>
                        {inv.job
                          ? <Link to={`/moving/jobs/${inv.job._id}`} style={{ color: PURPLE, fontFamily: 'monospace' }} className="hover:opacity-80">{inv.job.jobNo}</Link>
                          : <span style={{ color: MUTED }}>—</span>}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, whiteSpace: 'nowrap' }}>{formatDate(inv.invoiceDate)}</td>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: INK, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtAed(inv.total)}</td>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: inv.balanceDue > 0 ? '#EF4444' : '#059669' }}>{fmtAed(inv.balanceDue)}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <Badge tone={statusTone[inv.status]} className="text-xs">{inv.status}</Badge>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        {inv.paymentHistory?.some(p => p.notes?.includes('Stripe Checkout')) ? (
                          <Badge tone="green" className="text-xs">Yes</Badge>
                        ) : (
                          <span style={{ fontSize: 12, color: MUTED }}>No</span>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-1">
                          <Link to={`/moving/invoices/${inv._id}`} className="p-1 transition-colors hover:opacity-70" style={{ color: MUTED }}>
                            <ArrowRight size={14} />
                          </Link>
                          {isAdmin && (
                            <button onClick={() => setDeleteId(inv._id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: MUTED }}>
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: 12, color: MUTED, textAlign: 'right', marginTop: 12 }}>{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</div>
        </>
      )}

      <Modal open={!!deleteId} title="Delete Invoice" onClose={() => setDeleteId(null)}>
        <div className="space-y-4">
          <p className="text-sm">Are you sure you want to delete this invoice? This action cannot be undone.</p>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteId && deleteMut.mutate(deleteId)} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? 'Deleting…' : 'Delete Invoice'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* New Invoice Modal */}
      <Modal open={newModal} title="New Invoice" onClose={() => setNewModal(false)} className="max-w-3xl w-[90vw]">
        <form onSubmit={submitNewInvoice} className="space-y-5">
          {/* Customer */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">Customer</label>
            {custId ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-muted/30">
                <span className="flex-1 text-sm font-medium">{custName}</span>
                <button type="button" onClick={() => { setCustId(''); setCustName(''); setCustSearch('') }}>
                  <X size={14} className="text-muted-foreground" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Search customer…" />
                {custSearch && custResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-card border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {custResults.map(c => (
                      <button key={c._id} type="button"
                        onClick={() => { setCustId(c._id); setCustName(c.fullName); setCustSearch('') }}
                        className="w-full text-left px-3 py-2 hover:bg-muted/60 text-sm transition-colors"
                      >
                        <span className="font-medium">{c.fullName}</span>
                        {c.phone && <span className="text-muted-foreground ml-2">{c.phone}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Invoice Date"><Input type="date" value={invDate} onChange={e => setInvDate(e.target.value)} required /></Field>
            <Field label="Due Date"><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} required /></Field>
            <Field label="Deposit Paid (AED)"><Input type="number" min="0" step="0.01" value={deposit} onChange={e => setDeposit(e.target.value)} placeholder="0" /></Field>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-foreground">Line Items</label>
              <button type="button" onClick={() => setLineItems(prev => [...prev, emptyItem()])}
                className="flex items-center gap-1 text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: PURPLE }}>
                <Plus size={13} />Add row
              </button>
            </div>
            <div className="space-y-2">
              {lineItems.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    {i === 0 && <span className="text-[11px] text-muted-foreground mb-1 block">Description</span>}
                    <Input value={it.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder="Service" />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <span className="text-[11px] text-muted-foreground mb-1 block">Qty</span>}
                    <Input type="number" min="1" value={it.qty} onChange={e => updateLine(i, 'qty', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <span className="text-[11px] text-muted-foreground mb-1 block">Rate</span>}
                    <Input type="number" min="0" step="0.01" value={it.rate || ''} onChange={e => updateLine(i, 'rate', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <span className="text-[11px] text-muted-foreground mb-1 block">Amount</span>}
                    <Input type="number" value={it.amount || ''} readOnly className="bg-muted/30" />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    {lineItems.length > 1 && (
                      <button type="button" onClick={() => setLineItems(prev => prev.filter((_, j) => j !== i))}
                        className="p-1 rounded hover:bg-red-50 transition-colors"><Trash2 size={13} className="text-red-500" /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-right mt-2 text-sm font-semibold" style={{ color: INK }}>
              Total: AED {lineItems.reduce((s, it) => s + it.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          {/* Notes */}
          <Field label="Notes (optional)">
            <Textarea value={invNotes} onChange={e => setInvNotes(e.target.value)} placeholder="Any notes…" rows={2} />
          </Field>

          {newErr && <p className="text-sm text-red-600">{newErr}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setNewModal(false)}>Cancel</Button>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? 'Creating…' : 'Create Invoice'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

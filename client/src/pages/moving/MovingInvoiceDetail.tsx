import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Download, Share2, Edit, Plus, Trash2, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingInvoice, MovingInvoiceStatus } from '../../lib/types'
import { Badge, Button, Field, Input, Modal, Select, Spinner, Textarea } from '../../components/ui'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const statusTone: Record<MovingInvoiceStatus, string> = {
  draft: 'gray', sent: 'blue', partial: 'yellow', paid: 'green', cancelled: 'red',
}

const statusDot: Record<string, string> = {
  draft: '#94A3B8', sent: '#3B82F6', partial: '#F59E0B', paid: '#10B981', cancelled: '#EF4444',
}

const STATUS_TRANSITIONS: Record<MovingInvoiceStatus, MovingInvoiceStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['cancelled'],
  partial: ['cancelled'],
  paid: [],
  cancelled: ['draft'],
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dt(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2" style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
      <span style={{ fontSize: 13, color: MUTED }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: INK }}>{children}</span>
    </div>
  )
}

export default function MovingInvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [err, setErr] = useState('')
  const [payModal, setPayModal] = useState(false)
  const [itemsModal, setItemsModal] = useState(false)
  const [reviseModal, setReviseModal] = useState(false)
  const [items, setItems] = useState<Array<{ description: string; subDescription?: string; qty: number; rate: number; amount: number }>>([])
  const [_editIdx, setEditIdx] = useState<number | null>(null)
  const [shareToken, setShareToken] = useState<string>('')
  const [notesEdit, setNotesEdit] = useState(false)
  const [notesVal, setNotesVal] = useState('')
  const [termsEdit, setTermsEdit] = useState(false)
  const [termsVal, setTermsVal] = useState('')
  const [saveAsDefault, setSaveAsDefault] = useState(false)

  const { data: invoice, isLoading } = useQuery<MovingInvoice>({
    queryKey: ['moving-invoice', id],
    queryFn: () => api.get(`/moving-invoices/${id}`).then(r => r.data),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['moving-invoice', id] })

  const statusMut = useMutation({
    mutationFn: (status: MovingInvoiceStatus) => api.patch(`/moving-invoices/${id}/status`, { status }),
    onSuccess: invalidate,
    onError: (e) => setErr(apiError(e)),
  })

  const updateItemsMut = useMutation({
    mutationFn: (newItems: typeof items) => {
      const total = newItems.reduce((s, i) => s + i.amount, 0)
      const paid = (invoice?.depositPaid ?? 0) + (invoice?.paymentHistory ?? []).reduce((s, p) => s + p.amount, 0)
      return api.put(`/moving-invoices/${id}`, { items: newItems, total, balanceDue: Math.max(0, total - paid) }).then(r => r.data)
    },
    onSuccess: () => { invalidate(); setItemsModal(false); setEditIdx(null) },
    onError: (e) => setErr(apiError(e)),
  })

  const updateFieldMut = useMutation({
    mutationFn: (fields: Record<string, any>) => api.put(`/moving-invoices/${id}`, fields).then(r => r.data),
    onSuccess: () => { invalidate(); setNotesEdit(false); setTermsEdit(false) },
    onError: (e) => setErr(apiError(e)),
  })

  const payMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/moving-invoices/${id}/record-payment`, body),
    onSuccess: () => { invalidate(); setPayModal(false) },
    onError: (e) => setErr(apiError(e)),
  })

  const reviseMut = useMutation({
    mutationFn: (body: { items: typeof items; supervisorNote: string }) =>
      api.post(`/moving-invoices/${id}/revise`, body).then(r => r.data),
    onSuccess: () => { invalidate(); setReviseModal(false); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  const createJobMut = useMutation({
    mutationFn: () => api.post('/moving-jobs', {
      customer: invoice?.customer?._id,
      invoice: id,
      jobType: 'other',
      status: 'confirmed',
      notes: `Created from invoice ${invoice?.invoiceNo}`,
    }).then(r => r.data),
    onSuccess: (job) => navigate(`/moving/jobs/${job._id}`),
    onError: (e) => setErr(apiError(e)),
  })

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/moving-invoices/${id}`),
    onSuccess: () => navigate('/moving/invoices'),
    onError: (e) => setErr(apiError(e)),
  })

  const syncZoho = useMutation({
    mutationFn: () => api.post(`/moving-invoices/${id}/sync-zoho-books`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['moving-invoice', id] })
      qc.invalidateQueries({ queryKey: ['moving-invoices'] })
    },
    onError: () => {},
  })

  const [deleteConfirm, setDeleteConfirm] = useState(false)

  useEffect(() => {
    if (invoice?.items && invoice.items.length > 0) {
      setItems(invoice.items as typeof items)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?._id])

  if (isLoading) return <div className="p-8"><Spinner /></div>
  if (!invoice) return <div className="p-8" style={{ color: MUTED }}>Invoice not found</div>

  const transitions = STATUS_TRANSITIONS[invoice.status] ?? []
  const total = items.reduce((s, i) => s + i.amount, 0)

  function handlePayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    payMut.mutate({
      amount: Number(f.get('amount')),
      method: f.get('method'),
      date: f.get('date') || undefined,
      notes: f.get('notes'),
    })
  }

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="hover:opacity-70 transition-opacity" style={{ color: MUTED }}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div style={{ ...HEADING, fontSize: 22, fontWeight: 700, color: INK }} className="font-mono">{invoice.invoiceNo}</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 2 }} className="truncate">{invoice.customer?.fullName}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ width: 7, height: 7, borderRadius: 4, background: statusDot[invoice.status] }} />
          <Badge tone={statusTone[invoice.status]}>{invoice.status}</Badge>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mb-7">
        {transitions.map(s => (
          <Button key={s} size="sm" variant="outline" onClick={() => statusMut.mutate(s)} disabled={statusMut.isPending}>
            → {s}
          </Button>
        ))}
        {!invoice.job && (
          <Button size="sm" onClick={() => createJobMut.mutate()} disabled={createJobMut.isPending}>
            <CheckCircle size={13} className="mr-1" />
            {createJobMut.isPending ? 'Creating…' : 'Create Job'}
          </Button>
        )}
        {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
          <Button size="sm" onClick={() => setPayModal(true)}>Record Payment</Button>
        )}
        {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setItems(invoice.items as typeof items); setReviseModal(true) }}
            title="Add extra charges or adjust items, then resend via WhatsApp"
          >
            <RefreshCw size={13} className="mr-1" /><span className="hidden sm:inline">Revise &amp; Resend</span><span className="sm:hidden">Revise</span>
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            if (!shareToken) {
              const res = await api.post(`/moving-invoices/${id}/share-token`, {})
              setShareToken(res.data.token)
              window.open(`/api/moving-invoices/${id}/pdf?token=${res.data.token}`, '_blank')
            } else {
              window.open(`/api/moving-invoices/${id}/pdf?token=${shareToken}`, '_blank')
            }
          }}
        >
          <Download size={13} className="mr-1" />PDF
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            if (!shareToken) {
              const res = await api.post(`/moving-invoices/${id}/share-token`, {})
              setShareToken(res.data.token)
              const pdfUrl = `${window.location.origin}/api/moving-invoices/${id}/pdf?token=${res.data.token}`
              const msg = `Hi ${invoice.customer?.fullName}, here's your invoice ${invoice.invoiceNo} for AED ${invoice.total}. Please review and let me know if you have any questions. ${pdfUrl}`
              window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
            } else {
              const pdfUrl = `${window.location.origin}/api/moving-invoices/${id}/pdf?token=${shareToken}`
              const msg = `Hi ${invoice.customer?.fullName}, here's your invoice ${invoice.invoiceNo} for AED ${invoice.total}. Please review and let me know if you have any questions. ${pdfUrl}`
              window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
            }
          }}
        >
          <Share2 size={13} className="mr-1" />
          <span className="hidden sm:inline">WhatsApp</span><span className="sm:hidden">WA</span>
        </Button>
        {invoice.balanceDue > 0 && (
          <Button
            size="sm"
            onClick={async () => {
              try {
                const res = await api.post(`/moving-invoices/${id}/payment-link`, {})
                setErr('')
                alert(`Payment link sent via WhatsApp!\n\nLink: ${res.data.payUrl}\nBalance: AED ${res.data.balanceDue}`)
              } catch (e) { setErr(apiError(e)) }
            }}
          >
            <span className="hidden sm:inline">Send Payment Link</span><span className="sm:hidden">Pay Link</span>
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => syncZoho.mutate()}
          disabled={syncZoho.isPending}
          className={invoice.zohoBooksSyncId ? 'text-emerald-600 border-emerald-300' : invoice.zohoBooksSyncError ? 'text-red-600 border-red-300' : ''}
          title={invoice.zohoBooksSyncId ? `Synced to Zoho Books on ${new Date(invoice.zohoBooksSyncedAt!).toLocaleDateString()}` : invoice.zohoBooksSyncError ? `Sync failed: ${invoice.zohoBooksSyncError}` : 'Sync to Zoho Books'}
        >
          <RefreshCw size={13} className={syncZoho.isPending ? 'animate-spin' : ''} />
          {syncZoho.isPending ? 'Syncing…' : invoice.zohoBooksSyncId ? 'Synced' : <><span className="hidden sm:inline">Sync to Zoho</span><span className="sm:hidden">Zoho</span></>}
        </Button>
        {invoice.zohoBooksSyncId && (
          <a
            href={`https://books.zoho.com/app/908459713#/invoices/${invoice.zohoBooksSyncId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
          >
            <span className="hidden sm:inline">Open in Zoho ↗</span><span className="sm:hidden">Zoho ↗</span>
          </a>
        )}
        {invoice.status !== 'paid' && (
          <Button size="sm" variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" onClick={() => setDeleteConfirm(true)}>
            <Trash2 size={13} className="mr-1" /><span className="hidden sm:inline">Delete</span>
          </Button>
        )}
      </div>

      {err && <p className="text-sm text-red-600 mb-4">{err}</p>}

      {(syncZoho.error || (invoice.zohoBooksSyncError && !invoice.zohoBooksSyncId)) && (
        <div className="flex items-start gap-2 mb-4" style={{ background: '#FEF2F2', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '12px 16px' }}>
          <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={15} />
          <div style={{ fontSize: 12, color: '#B91C1C' }}>
            <span className="font-semibold">Zoho Books sync failed: </span>
            {syncZoho.error ? apiError(syncZoho.error) : invoice.zohoBooksSyncError}
          </div>
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
          <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK, marginBottom: 12 }}>Invoice Info</div>
          <InfoRow label="Invoice Date">{dt(invoice.invoiceDate)}</InfoRow>
          <InfoRow label="Due Date">{dt(invoice.dueDate)}</InfoRow>
          {invoice.job && (
            <InfoRow label="Job">
              <Link to={`/moving/jobs/${invoice.job._id}`} style={{ color: PURPLE, fontFamily: 'monospace', fontWeight: 600 }} className="hover:opacity-80">{invoice.job.jobNo}</Link>
            </InfoRow>
          )}
        </div>

        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
          <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK, marginBottom: 12 }}>Payment Summary</div>
          <InfoRow label="Total"><span style={{ fontWeight: 600 }}>AED {fmt(invoice.total)}</span></InfoRow>
          {invoice.depositPaid > 0 && <InfoRow label="Deposit Paid">AED {fmt(invoice.depositPaid)}</InfoRow>}
          {(invoice.paymentHistory ?? []).length > 0 && (
            <InfoRow label="Payments">AED {fmt((invoice.paymentHistory ?? []).reduce((s, p) => s + p.amount, 0))}</InfoRow>
          )}
          <div className="flex justify-between py-2">
            <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>Balance Due</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: invoice.balanceDue > 0 ? '#EF4444' : '#059669' }}>AED {fmt(invoice.balanceDue)}</span>
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(20,8,31,0.06)' }} className="flex items-center justify-between">
          <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK }}>Line Items</div>
          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
            <Button size="sm" variant="outline" onClick={() => { setItems(invoice.items as typeof items); setItemsModal(true) }}>
              <Edit size={13} className="mr-1" />Edit Items
            </Button>
          )}
        </div>
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                {['#', 'Description', 'Qty', 'Rate', 'Amount'].map((h, i) => (
                  <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: MUTED, textAlign: i >= 2 ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                  <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED, verticalAlign: 'top' }}>{i + 1}</td>
                  <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: INK }}>{it.description}</div>
                    {it.subDescription && <div style={{ fontSize: 11, color: MUTED, marginTop: 2, lineHeight: 1.4 }}>{it.subDescription}</div>}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: INK, textAlign: 'right', verticalAlign: 'top' }}>{it.qty}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: INK, textAlign: 'right', fontVariantNumeric: 'tabular-nums', verticalAlign: 'top' }}>AED {fmt(it.rate)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: INK, textAlign: 'right', fontVariantNumeric: 'tabular-nums', verticalAlign: 'top' }}>AED {fmt(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden p-4 space-y-3">
          {items.map((it, i) => (
            <div key={i} style={{ background: '#FAF8F5', borderRadius: 12, padding: 12 }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span style={{ fontSize: 11, color: MUTED }}>#{i + 1}</span>
                  <p style={{ fontSize: 13, fontWeight: 500, color: INK }}>{it.description}</p>
                  {it.subDescription && <p style={{ fontSize: 11, color: MUTED, marginTop: 1, lineHeight: 1.4 }}>{it.subDescription}</p>}
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: PURPLE, whiteSpace: 'nowrap' }}>AED {fmt(it.amount)}</span>
              </div>
              <div className="flex gap-4 mt-1" style={{ fontSize: 12, color: MUTED }}>
                <span>Qty: {it.qty}</span>
                <span>Rate: AED {fmt(it.rate)}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(20,8,31,0.06)', background: '#FAF8F5' }}>
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-4 sm:gap-8" style={{ fontSize: 13, color: MUTED }}>
              <span>Sub Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: INK }}>AED {fmt(total)}</span>
            </div>
            <div className="flex gap-4 sm:gap-8" style={{ fontSize: 16, fontWeight: 700, color: PURPLE, ...HEADING }}>
              <span>Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>AED {fmt(total)}</span>
            </div>
            {(invoice.balanceDue ?? 0) > 0 && (
              <div className="flex gap-4 sm:gap-8 mt-1" style={{ fontSize: 13, fontWeight: 600, color: '#EF4444' }}>
                <span>Balance Due</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>AED {fmt(invoice.balanceDue!)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Payment History */}
      {(invoice.paymentHistory ?? []).length > 0 && (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
            <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK }}>Payment History</div>
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                  {['Date', 'Method', 'Notes', 'Amount'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: MUTED, textAlign: i === 3 ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(invoice.paymentHistory ?? []).map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                    <td style={{ padding: '12px 16px', fontSize: 13, color: INK }}>{dt(p.date)}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: INK, textTransform: 'capitalize' }}>{p.method}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED }}>{p.notes || '—'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#059669', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>AED {fmt(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden p-4 space-y-3">
            {(invoice.paymentHistory ?? []).map((p, i) => (
              <div key={i} style={{ background: '#FAF8F5', borderRadius: 12, padding: 12 }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p style={{ fontSize: 13, fontWeight: 500, color: INK, textTransform: 'capitalize' }}>{p.method}</p>
                    <p style={{ fontSize: 12, color: MUTED }}>{dt(p.date)}</p>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#059669', whiteSpace: 'nowrap' }}>AED {fmt(p.amount)}</span>
                </div>
                {p.notes && <p style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>{p.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      <Modal open={payModal} title="Record Payment" onClose={() => setPayModal(false)}>
        <form onSubmit={handlePayment} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Amount (AED)"><Input name="amount" type="number" min="0.01" step="0.01" defaultValue={invoice.balanceDue} required /></Field>
            <Field label="Method">
              <Select name="method" defaultValue="cash">
                {['cash', 'bank_transfer', 'cheque', 'card', 'other'].map(m => (
                  <option key={m} value={m}>{m.replace('_', ' ')}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date"><Input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
            <Field label="Notes"><Input name="notes" placeholder="Reference" /></Field>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 sticky bottom-0 bg-card pb-1 -mb-1">
            <Button type="submit" disabled={payMut.isPending}>{payMut.isPending ? 'Recording…' : 'Record'}</Button>
          </div>
        </form>
      </Modal>

      {/* Revise & Resend Modal */}
      <Modal open={reviseModal} title="Revise Invoice & Resend to Customer" onClose={() => { setReviseModal(false); setErr('') }} className="max-w-4xl w-[90vw]">
        <div className="space-y-4">
          <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '12px 16px' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>Supervisor Revision</p>
            <p style={{ fontSize: 12, color: '#92400E' }}>Update line items to reflect actual work done on site. The customer will receive a WhatsApp notification with the revised total and balance due.</p>
          </div>

          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end p-3 border rounded-xl">
              <Field label="Description" className="col-span-2">
                <input
                  className="w-full h-9 rounded-lg border bg-card px-3 text-sm"
                  value={item.description}
                  onChange={e => {
                    const updated = [...items]; updated[i] = { ...updated[i], description: e.target.value }; setItems(updated)
                  }}
                />
              </Field>
              <Field label="Qty">
                <input type="number" className="w-full h-9 rounded-lg border bg-card px-3 text-sm" value={item.qty}
                  onChange={e => {
                    const updated = [...items]; const qty = Number(e.target.value)
                    updated[i] = { ...updated[i], qty, amount: qty * updated[i].rate }; setItems(updated)
                  }}
                />
              </Field>
              <Field label="Rate (AED)">
                <input type="number" step="0.01" className="w-full h-9 rounded-lg border bg-card px-3 text-sm" value={item.rate}
                  onChange={e => {
                    const updated = [...items]; const rate = Number(e.target.value)
                    updated[i] = { ...updated[i], rate, amount: updated[i].qty * rate }; setItems(updated)
                  }}
                />
              </Field>
              <button onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                className="h-9 px-2 rounded-lg border text-red-500 hover:bg-red-500/10 transition-colors text-xs">
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <button onClick={() => setItems([...items, { description: '', qty: 1, rate: 0, amount: 0 }])}
            className="w-full py-2.5 border-2 border-dashed rounded-xl text-sm text-muted-foreground hover:bg-muted/30 transition-colors flex items-center justify-center gap-1.5">
            <Plus size={14} /> Add Line Item (Extra Work / Charge)
          </button>

          <div className="border-t pt-3">
            <div className="flex justify-end gap-8 text-sm">
              <span style={{ color: MUTED }}>New Total:</span>
              <span style={{ fontWeight: 700, color: PURPLE, fontSize: 16 }}>AED {fmt(items.reduce((s, i) => s + i.amount, 0))}</span>
            </div>
            {invoice.depositPaid > 0 && (
              <div className="flex justify-end gap-8 text-sm mt-1">
                <span style={{ color: MUTED }}>Less Deposit:</span>
                <span>AED {fmt(invoice.depositPaid)}</span>
              </div>
            )}
            <div className="flex justify-end gap-8 text-sm font-semibold mt-1">
              <span>New Balance Due:</span>
              <span style={{ color: '#EF4444' }}>AED {fmt(Math.max(0, items.reduce((s, i) => s + i.amount, 0) - (invoice.depositPaid || 0) - ((invoice.paymentHistory ?? []).reduce((s, p) => s + p.amount, 0))))}</span>
            </div>
          </div>

          <Field label="Revision Note (sent to customer via WhatsApp)">
            <textarea id="revise-note" rows={2} className="w-full rounded-lg border bg-card px-3 py-2 text-sm resize-none" placeholder="e.g. Additional floor carry charged, extra heavy items required additional manpower…" />
          </Field>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex justify-end gap-2 border-t pt-3 sticky bottom-0 bg-card pb-1 -mb-1">
            <Button variant="outline" onClick={() => { setReviseModal(false); setErr('') }}>Cancel</Button>
            <Button
              onClick={() => {
                const note = (document.getElementById('revise-note') as HTMLTextAreaElement)?.value ?? ''
                reviseMut.mutate({ items, supervisorNote: note })
              }}
              disabled={reviseMut.isPending}
            >
              {reviseMut.isPending ? 'Saving & Sending…' : 'Save & Resend to Customer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Items Modal */}
      <Modal open={itemsModal} title="Edit Line Items" onClose={() => setItemsModal(false)} className="max-w-6xl w-[90vw]">
        <div className="space-y-4">
          {items.map((item, i) => (
            <div key={i} className="p-3 border rounded space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                <Field label="Description">
                  <Input
                    value={item.description}
                    onChange={e => {
                      const updated = [...items]
                      updated[i].description = e.target.value
                      setItems(updated)
                    }}
                  />
                </Field>
                <Field label="Qty">
                  <Input
                    type="number"
                    value={item.qty}
                    onChange={e => {
                      const updated = [...items]
                      const qty = Number(e.target.value)
                      updated[i].qty = qty
                      updated[i].amount = qty * updated[i].rate
                      setItems(updated)
                    }}
                  />
                </Field>
                <Field label="Rate (AED)">
                  <Input
                    type="number"
                    step="0.01"
                    value={item.rate}
                    onChange={e => {
                      const updated = [...items]
                      const rate = Number(e.target.value)
                      updated[i].rate = rate
                      updated[i].amount = updated[i].qty * rate
                      setItems(updated)
                    }}
                  />
                </Field>
                <Field label="Amount">
                  <Input disabled value={`AED ${fmt(item.amount)}`} />
                </Field>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                  className="text-red-500 hover:text-red-700"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
              <div>
                <Input
                  value={item.subDescription || ''}
                  onChange={e => {
                    const updated = [...items]
                    updated[i].subDescription = e.target.value
                    setItems(updated)
                  }}
                  placeholder="Sub-description (optional) — additional details for this item"
                  className="text-xs"
                />
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            onClick={() => setItems([...items, { description: '', subDescription: '', qty: 1, rate: 0, amount: 0 }])}
            className="w-full"
          >
            <Plus size={14} className="mr-1" /> Add Item
          </Button>

          <div className="border-t pt-3">
            <div className="flex justify-end gap-8 text-sm font-semibold">
              <span>Total:</span>
              <span style={{ color: PURPLE }}>AED {fmt(total)}</span>
            </div>
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex justify-end gap-2 sticky bottom-0 bg-card pb-1 -mb-1">
            <Button variant="outline" onClick={() => setItemsModal(false)}>Cancel</Button>
            <Button onClick={() => updateItemsMut.mutate(items)} disabled={updateItemsMut.isPending}>
              {updateItemsMut.isPending ? 'Saving…' : 'Save Items'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Customer Notes & Terms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
          <div className="flex items-center justify-between mb-2">
            <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK }}>Customer Notes</div>
            {!notesEdit && (
              <Button size="sm" variant="outline" onClick={() => { setNotesVal(invoice.notes || ''); setNotesEdit(true) }}>
                <Edit size={13} className="mr-1" />Edit
              </Button>
            )}
          </div>
          {notesEdit ? (
            <div className="space-y-2">
              <Textarea value={notesVal} onChange={(e: any) => setNotesVal(e.target.value)} rows={4} placeholder="Add notes visible to the customer..." autoFocus />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setNotesEdit(false)}>Cancel</Button>
                <Button size="sm" onClick={() => updateFieldMut.mutate({ notes: notesVal })} disabled={updateFieldMut.isPending}>
                  {updateFieldMut.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: invoice.notes ? MUTED : '#C4BFD0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {invoice.notes || 'No notes added'}
            </p>
          )}
        </div>

        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
          <div className="flex items-center justify-between mb-2">
            <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK }}>Terms & Conditions</div>
            {!termsEdit && (
              <div className="flex gap-2">
                {!invoice.termsAndConditions && localStorage.getItem('pb_default_terms') && (
                  <Button size="sm" variant="outline" onClick={() => {
                    const def = localStorage.getItem('pb_default_terms') || ''
                    updateFieldMut.mutate({ termsAndConditions: def })
                  }}>Load Default</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => { setTermsVal(invoice.termsAndConditions || ''); setSaveAsDefault(false); setTermsEdit(true) }}>
                  <Edit size={13} className="mr-1" />Edit
                </Button>
              </div>
            )}
          </div>
          {termsEdit ? (
            <div className="space-y-2">
              <Textarea value={termsVal} onChange={(e: any) => setTermsVal(e.target.value)} rows={4} placeholder="Add terms and conditions..." autoFocus />
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: MUTED }}>
                <input type="checkbox" checked={saveAsDefault} onChange={e => setSaveAsDefault(e.target.checked)} />
                Save as default for future quotes
              </label>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setTermsEdit(false)}>Cancel</Button>
                <Button size="sm" onClick={() => {
                  if (saveAsDefault) localStorage.setItem('pb_default_terms', termsVal)
                  updateFieldMut.mutate({ termsAndConditions: termsVal })
                }} disabled={updateFieldMut.isPending}>
                  {updateFieldMut.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: invoice.termsAndConditions ? MUTED : '#C4BFD0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {invoice.termsAndConditions || 'No terms added'}
            </p>
          )}
        </div>
      </div>

      <Modal open={deleteConfirm} title="Delete Invoice" onClose={() => setDeleteConfirm(false)}>
        <div className="space-y-4">
          <p className="text-sm">Are you sure you want to delete invoice <strong>{invoice.invoiceNo}</strong>? This action cannot be undone.</p>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 sticky bottom-0 bg-card pb-1 -mb-1">
            <Button variant="outline" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? 'Deleting…' : 'Delete Invoice'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

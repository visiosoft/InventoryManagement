import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Download, Share2, Edit, Plus, Trash2, RefreshCw } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingInvoice, MovingInvoiceStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, Select, Spinner, Table, Td, Th } from '../../components/ui'

const statusTone: Record<MovingInvoiceStatus, string> = {
  draft: 'gray', sent: 'blue', partial: 'yellow', paid: 'green', cancelled: 'red',
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

export default function MovingInvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [err, setErr] = useState('')
  const [payModal, setPayModal] = useState(false)
  const [itemsModal, setItemsModal] = useState(false)
  const [reviseModal, setReviseModal] = useState(false)
  const [items, setItems] = useState<Array<{ description: string; qty: number; rate: number; amount: number }>>([])
  const [_editIdx, setEditIdx] = useState<number | null>(null)
  const [shareToken, setShareToken] = useState<string>('')

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

  useEffect(() => {
    if (invoice?.items && invoice.items.length > 0) {
      setItems(invoice.items as typeof items)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?._id])

  if (isLoading) return <div className="p-8"><Spinner /></div>
  if (!invoice) return <div className="p-8 text-muted-foreground">Invoice not found</div>

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
    <div className="space-y-8">
      <div className="flex items-center gap-4 flex-wrap">
        <button onClick={() => navigate('/moving/invoices')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold font-mono">{invoice.invoiceNo}</h1>
          <p className="text-sm text-muted-foreground">{invoice.customer?.fullName}</p>
        </div>
        <Badge tone={statusTone[invoice.status]}>{invoice.status}</Badge>
        {transitions.map(s => (
          <Button key={s} size="sm" variant="outline" onClick={() => statusMut.mutate(s)} disabled={statusMut.isPending}>
            → {s}
          </Button>
        ))}
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
            <RefreshCw size={13} className="mr-1" />Revise &amp; Resend
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            if (!shareToken) {
              const res = await api.post(`/moving-invoices/${id}/share-token`, {})
              setShareToken(res.data.shareToken)
              window.open(`/api/moving-invoices/${id}/pdf?token=${res.data.shareToken}`, '_blank')
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
              setShareToken(res.data.shareToken)
              const pdfUrl = `${window.location.origin}/api/moving-invoices/${id}/pdf?token=${res.data.shareToken}`
              const msg = `Hi ${invoice.customer?.fullName}, here's your invoice ${invoice.invoiceNo} for AED ${invoice.total}. Please review and let me know if you have any questions. ${pdfUrl}`
              const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`
              window.open(whatsappUrl, '_blank')
            } else {
              const pdfUrl = `${window.location.origin}/api/moving-invoices/${id}/pdf?token=${shareToken}`
              const msg = `Hi ${invoice.customer?.fullName}, here's your invoice ${invoice.invoiceNo} for AED ${invoice.total}. Please review and let me know if you have any questions. ${pdfUrl}`
              const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`
              window.open(whatsappUrl, '_blank')
            }
          }}
        >
          <Share2 size={13} className="mr-1" />
          WhatsApp
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
            💳 Send Payment Link
          </Button>
        )}
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Invoice Info" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Invoice Date</dt><dd>{dt(invoice.invoiceDate)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Due Date</dt><dd>{dt(invoice.dueDate)}</dd></div>
              {invoice.job && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Job</dt>
                  <dd><Link to={`/moving/jobs/${invoice.job._id}`} className="text-primary hover:underline">{invoice.job.jobNo}</Link></dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Payment Summary" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Total</dt><dd className="font-medium">AED {fmt(invoice.total)}</dd></div>
              {invoice.depositPaid > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">Deposit Paid</dt><dd>AED {fmt(invoice.depositPaid)}</dd></div>}
              {(invoice.paymentHistory ?? []).length > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Payments</dt>
                  <dd>AED {fmt((invoice.paymentHistory ?? []).reduce((s, p) => s + p.amount, 0))}</dd>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t pt-2">
                <dt>Balance Due</dt>
                <dd className={invoice.balanceDue > 0 ? 'text-red-600' : 'text-green-600'}>AED {fmt(invoice.balanceDue)}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      </div>

      {/* Items */}
      <Card>
        <CardHeader
          title="Line Items"
          action={invoice.status !== 'paid' && invoice.status !== 'cancelled' ? <Button size="sm" variant="outline" onClick={() => { setItems(invoice.items as typeof items); setItemsModal(true) }}><Edit size={13} className="mr-1" />Edit Items</Button> : undefined}
        />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Description</Th>
                <Th className="text-right">Qty</Th>
                <Th className="text-right">Rate</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="hover:bg-muted/30">
                  <Td>{i + 1}</Td>
                  <Td>{it.description}</Td>
                  <Td className="text-right">{it.qty}</Td>
                  <Td className="text-right">AED {fmt(it.rate)}</Td>
                  <Td className="text-right font-medium">AED {fmt(it.amount)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="mt-4 flex flex-col items-end gap-1 text-sm">
            <div className="flex gap-8">
              <span className="text-muted-foreground">Sub Total</span>
              <span>AED {fmt(total)}</span>
            </div>
            <div className="flex gap-8 font-semibold text-base border-t pt-2">
              <span>Total</span>
              <span className="text-primary">AED {fmt(total)}</span>
            </div>
            {(invoice.balanceDue ?? 0) > 0 && (
              <div className="flex gap-8 text-red-600 text-sm mt-1">
                <span>Balance Due</span>
                <span>AED {fmt(invoice.balanceDue!)}</span>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Payment History */}
      {(invoice.paymentHistory ?? []).length > 0 && (
        <Card>
          <CardHeader title="Payment History" />
          <CardBody>
            <Table>
              <thead><tr><Th>Date</Th><Th>Method</Th><Th>Notes</Th><Th className="text-right">Amount</Th></tr></thead>
              <tbody>
                {(invoice.paymentHistory ?? []).map((p, i) => (
                  <tr key={i} className="hover:bg-muted/30">
                    <Td>{dt(p.date)}</Td>
                    <Td className="capitalize">{p.method}</Td>
                    <Td className="text-muted-foreground text-sm">{p.notes || '—'}</Td>
                    <Td className="text-right font-medium text-green-600">AED {fmt(p.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* Record Payment Modal */}
      <Modal open={payModal} title="Record Payment" onClose={() => setPayModal(false)}>
        <form onSubmit={handlePayment} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
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
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={payMut.isPending}>{payMut.isPending ? 'Recording…' : 'Record'}</Button>
          </div>
        </form>
      </Modal>

      {/* Revise & Resend Modal */}
      <Modal open={reviseModal} title="Revise Invoice & Resend to Customer" onClose={() => { setReviseModal(false); setErr('') }} className="max-w-4xl w-[90vw]">
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-800">
            <p className="font-semibold mb-1">Supervisor Revision</p>
            <p className="text-xs">Update line items to reflect actual work done on site. The customer will receive a WhatsApp notification with the revised total and balance due.</p>
          </div>

          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-5 gap-2 items-end p-3 border rounded-xl">
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
              <span className="text-muted-foreground">New Total:</span>
              <span className="font-bold text-primary text-base">AED {fmt(items.reduce((s, i) => s + i.amount, 0))}</span>
            </div>
            {invoice.depositPaid > 0 && (
              <div className="flex justify-end gap-8 text-sm mt-1">
                <span className="text-muted-foreground">Less Deposit:</span>
                <span>AED {fmt(invoice.depositPaid)}</span>
              </div>
            )}
            <div className="flex justify-end gap-8 text-sm font-semibold mt-1">
              <span>New Balance Due:</span>
              <span className="text-red-600">AED {fmt(Math.max(0, items.reduce((s, i) => s + i.amount, 0) - (invoice.depositPaid || 0) - ((invoice.paymentHistory ?? []).reduce((s, p) => s + p.amount, 0))))}</span>
            </div>
          </div>

          <Field label="Revision Note (sent to customer via WhatsApp)">
            <textarea id="revise-note" rows={2} className="w-full rounded-lg border bg-card px-3 py-2 text-sm resize-none" placeholder="e.g. Additional floor carry charged, extra heavy items required additional manpower…" />
          </Field>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => { setReviseModal(false); setErr('') }}>Cancel</Button>
            <Button
              onClick={() => {
                const note = (document.getElementById('revise-note') as HTMLTextAreaElement)?.value ?? ''
                reviseMut.mutate({ items, supervisorNote: note })
              }}
              disabled={reviseMut.isPending}
            >
              {reviseMut.isPending ? 'Saving & Sending…' : '✓ Save & Resend to Customer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Items Modal */}
      <Modal open={itemsModal} title="Edit Line Items" onClose={() => setItemsModal(false)} className="max-w-6xl w-[90vw]">
        <div className="space-y-4">
          {items.map((item, i) => (
            <div key={i} className="grid grid-cols-5 gap-2 items-end p-3 border rounded">
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
          ))}

          <Button
            variant="outline"
            onClick={() => setItems([...items, { description: '', qty: 1, rate: 0, amount: 0 }])}
            className="w-full"
          >
            <Plus size={14} className="mr-1" /> Add Item
          </Button>

          <div className="border-t pt-3">
            <div className="flex justify-end gap-8 text-sm font-semibold">
              <span>Total:</span>
              <span className="text-primary">AED {fmt(total)}</span>
            </div>
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setItemsModal(false)}>Cancel</Button>
            <Button onClick={() => updateItemsMut.mutate(items)} disabled={updateItemsMut.isPending}>
              {updateItemsMut.isPending ? 'Saving…' : 'Save Items'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

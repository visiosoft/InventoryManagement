import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Download, CheckCircle, Plus, Trash2, Edit } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingQuote, MovingQuoteStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, Spinner, Table, Td, Th } from '../../components/ui'
import { useState } from 'react'

const statusTone: Record<MovingQuoteStatus, string> = {
  draft: 'gray', sent: 'blue', accepted: 'green', rejected: 'red', expired: 'yellow',
}

const STATUS_TRANSITIONS: Record<MovingQuoteStatus, MovingQuoteStatus[]> = {
  draft: ['sent'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: [],
  rejected: ['draft'],
  expired: ['draft'],
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dt(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function MovingQuoteDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [err, setErr] = useState('')
  const [itemsModal, setItemsModal] = useState(false)
  const [items, setItems] = useState<Array<{ description: string; qty: number; rate: number; amount: number }>>([])
  const [_editIdx, setEditIdx] = useState<number | null>(null)
  const [shareToken, setShareToken] = useState<string>('')

  const { data: quote, isLoading } = useQuery<MovingQuote>({
    queryKey: ['moving-quote', id],
    queryFn: () => api.get(`/moving-quotes/${id}`).then(r => r.data),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['moving-quote', id] })

  const statusMut = useMutation({
    mutationFn: (status: MovingQuoteStatus) => api.patch(`/moving-quotes/${id}/status`, { status }),
    onSuccess: invalidate,
    onError: (e) => setErr(apiError(e)),
  })

  const updateItemsMut = useMutation({
    mutationFn: (newItems: typeof items) => {
      const total = newItems.reduce((s, i) => s + i.amount, 0)
      return api.put(`/moving-quotes/${id}`, { items: newItems, total }).then(r => r.data)
    },
    onSuccess: () => { invalidate(); setItemsModal(false); setEditIdx(null) },
    onError: (e) => setErr(apiError(e)),
  })

  const createJobMut = useMutation({
    mutationFn: () => api.post('/moving-jobs', {
      customer: quote?.customer?._id,
      quote: id,
      jobType: 'other',
      status: 'confirmed',
      notes: `Created from quote ${quote?.quoteNo}`,
    }).then(r => r.data),
    onSuccess: (job) => navigate(`/moving/jobs/${job._id}`),
    onError: (e) => setErr(apiError(e)),
  })

  if (isLoading) return <div className="p-8"><Spinner /></div>
  if (!quote) return <div className="p-8 text-muted-foreground">Quote not found</div>

  // Initialize items from quote
  if (items.length === 0 && quote.items && quote.items.length > 0) {
    setItems(quote.items as typeof items)
  }

  const transitions = STATUS_TRANSITIONS[quote.status] ?? []
  const total = items.reduce((s, i) => s + i.amount, 0)

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/moving/quotes')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold font-mono">{quote.quoteNo}</h1>
          <p className="text-sm text-muted-foreground">{quote.customer?.fullName}</p>
        </div>
        <Badge tone={statusTone[quote.status]}>{quote.status}</Badge>
        {transitions.map(s => (
          <Button key={s} size="sm" variant="outline" onClick={() => statusMut.mutate(s)} disabled={statusMut.isPending}>
            → {s}
          </Button>
        ))}
        {quote.status === 'accepted' && !quote.job && (
          <Button size="sm" onClick={() => createJobMut.mutate()} disabled={createJobMut.isPending}>
            <CheckCircle size={13} className="mr-1" />
            {createJobMut.isPending ? 'Creating…' : 'Create Job'}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            if (!shareToken) {
              const res = await api.post(`/moving-quotes/${id}/share-token`, {})
              setShareToken(res.data.shareToken)
              window.open(`/api/moving-quotes/${id}/pdf?token=${res.data.shareToken}`, '_blank')
            } else {
              window.open(`/api/moving-quotes/${id}/pdf?token=${shareToken}`, '_blank')
            }
          }}
        >
          <Download size={13} className="mr-1" />PDF
        </Button>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Quote Info" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Quote Date</dt><dd>{dt(quote.quoteDate)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Expiry Date</dt><dd>{dt(quote.expiryDate)}</dd></div>
              {quote.salesperson && <div className="flex justify-between"><dt className="text-muted-foreground">Salesperson</dt><dd>{quote.salesperson}</dd></div>}
              {quote.job && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Job</dt>
                  <dd><Link to={`/moving/jobs/${quote.job._id}`} className="text-primary hover:underline">{quote.job.jobNo}</Link></dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Customer" />
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Name</dt><dd className="font-medium">{quote.customer?.fullName}</dd></div>
              {quote.customer?.phone && <div className="flex justify-between"><dt className="text-muted-foreground">Phone</dt><dd>{quote.customer.phone}</dd></div>}
              {quote.customer?.email && <div className="flex justify-between"><dt className="text-muted-foreground">Email</dt><dd>{quote.customer.email}</dd></div>}
            </dl>
          </CardBody>
        </Card>
      </div>

      {/* Move addresses */}
      {(quote.job?.pickupAddress || quote.job?.deliveryAddress) && (
        <Card>
          <CardHeader title="Move Details" />
          <CardBody>
            <div className="grid grid-cols-2 gap-6 text-sm">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Pickup</p>
                <p>{quote.job?.pickupAddress || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Delivery</p>
                <p>{quote.job?.deliveryAddress || '—'}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Items table */}
      <Card>
        <CardHeader
          title="Line Items"
          action={quote.status === 'draft' ? <Button size="sm" onClick={() => setItemsModal(true)}><Edit size={13} className="mr-1" />Edit</Button> : undefined}
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
          </div>
        </CardBody>
      </Card>

      {quote.notes && (
        <Card>
          <CardHeader title="Notes" />
          <CardBody><p className="text-sm">{quote.notes}</p></CardBody>
        </Card>
      )}

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

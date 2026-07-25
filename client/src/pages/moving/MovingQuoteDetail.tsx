import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Download, Plus, Trash2, Edit, Receipt } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingQuote, MovingQuoteStatus } from '../../lib/types'
import { Badge, Button, Field, Input, Modal, Spinner } from '../../components/ui'
import { useState } from 'react'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const statusTone: Record<MovingQuoteStatus, string> = {
  draft: 'gray', sent: 'blue', accepted: 'green', rejected: 'red', expired: 'yellow',
}

const statusDot: Record<string, string> = {
  draft: '#94A3B8', sent: '#3B82F6', accepted: '#10B981', rejected: '#EF4444', expired: '#F59E0B',
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

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2" style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
      <span style={{ fontSize: 13, color: MUTED }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: INK }}>{children}</span>
    </div>
  )
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

  const convertToInvoiceMut = useMutation({
    mutationFn: () => api.post(`/moving-quotes/${id}/convert-to-invoice`).then(r => r.data),
    onSuccess: (invoice) => navigate(`/moving/invoices/${invoice._id}`),
    onError: (e) => setErr(apiError(e)),
  })

  if (isLoading) return <div className="p-8"><Spinner /></div>
  if (!quote) return <div className="p-8" style={{ color: MUTED }}>Quote not found</div>

  if (items.length === 0 && quote.items && quote.items.length > 0) {
    setItems(quote.items as typeof items)
  }

  const transitions = STATUS_TRANSITIONS[quote.status] ?? []
  const total = items.reduce((s, i) => s + i.amount, 0)

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="hover:opacity-70 transition-opacity" style={{ color: MUTED }}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div style={{ ...HEADING, fontSize: 22, fontWeight: 700, color: INK }} className="font-mono">{quote.quoteNo}</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 2 }}>{quote.customer?.fullName}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ width: 7, height: 7, borderRadius: 4, background: statusDot[quote.status] }} />
          <Badge tone={statusTone[quote.status]}>{quote.status}</Badge>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mb-7">
        {transitions.map(s => (
          <Button key={s} size="sm" variant="outline" onClick={() => statusMut.mutate(s)} disabled={statusMut.isPending}>
            → {s}
          </Button>
        ))}
        {(quote.status === 'accepted' || quote.status === 'sent') && (
          <Button size="sm" onClick={() => convertToInvoiceMut.mutate()} disabled={convertToInvoiceMut.isPending}>
            <Receipt size={13} className="mr-1" />
            {convertToInvoiceMut.isPending ? 'Converting…' : 'Convert to Invoice'}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            if (!shareToken) {
              const res = await api.post(`/moving-quotes/${id}/share-token`, {})
              setShareToken(res.data.token)
              window.open(`/api/moving-quotes/${id}/pdf?token=${res.data.token}`, '_blank')
            } else {
              window.open(`/api/moving-quotes/${id}/pdf?token=${shareToken}`, '_blank')
            }
          }}
        >
          <Download size={13} className="mr-1" />PDF
        </Button>
      </div>

      {err && <p className="text-sm text-red-600 mb-4">{err}</p>}

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
          <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK, marginBottom: 12 }}>Quote Info</div>
          <InfoRow label="Quote Date">{dt(quote.quoteDate)}</InfoRow>
          <InfoRow label="Expiry Date">{dt(quote.expiryDate)}</InfoRow>
          {quote.salesperson && <InfoRow label="Salesperson">{quote.salesperson}</InfoRow>}
          {quote.job && (
            <InfoRow label="Job">
              <Link to={`/moving/jobs/${quote.job._id}`} style={{ color: PURPLE, fontFamily: 'monospace', fontWeight: 600 }} className="hover:opacity-80">{quote.job.jobNo}</Link>
            </InfoRow>
          )}
        </div>

        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
          <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK, marginBottom: 12 }}>Customer</div>
          <InfoRow label="Name">{quote.customer?.fullName}</InfoRow>
          {quote.customer?.phone && <InfoRow label="Phone">{quote.customer.phone}</InfoRow>}
          {quote.customer?.email && <InfoRow label="Email">{quote.customer.email}</InfoRow>}
        </div>
      </div>

      {/* Move addresses */}
      {(quote.job?.pickupAddress || quote.job?.deliveryAddress) && (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px', marginBottom: 24 }}>
          <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK, marginBottom: 12 }}>Move Details</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Pickup</div>
              <div style={{ fontSize: 13, color: INK }}>{quote.job?.pickupAddress || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Delivery</div>
              <div style={{ fontSize: 13, color: INK }}>{quote.job?.deliveryAddress || '—'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Line Items */}
      <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(20,8,31,0.06)' }} className="flex items-center justify-between">
          <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK }}>Line Items</div>
          {quote.status === 'draft' && (
            <Button size="sm" variant="outline" onClick={() => setItemsModal(true)}>
              <Edit size={13} className="mr-1" />Edit
            </Button>
          )}
        </div>
        <div className="overflow-x-auto">
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
                  <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED }}>{i + 1}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 500, color: INK }}>{it.description}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: INK, textAlign: 'right' }}>{it.qty}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, color: INK, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>AED {fmt(it.rate)}</td>
                  <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: INK, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>AED {fmt(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(20,8,31,0.06)', background: '#FAF8F5' }}>
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-8" style={{ fontSize: 13, color: MUTED }}>
              <span>Sub Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: INK }}>AED {fmt(total)}</span>
            </div>
            <div className="flex gap-8" style={{ fontSize: 16, fontWeight: 700, color: PURPLE, ...HEADING }}>
              <span>Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>AED {fmt(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {quote.notes && (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
          <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK, marginBottom: 8 }}>Notes</div>
          <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>{quote.notes}</p>
        </div>
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
              <span style={{ color: PURPLE }}>AED {fmt(total)}</span>
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

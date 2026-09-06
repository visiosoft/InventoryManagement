import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Download, Plus, Trash2, Edit, Receipt, Pencil, CreditCard, Mail, Link as LinkIcon, Share2 } from 'lucide-react'
import { api, apiError, apiUrl } from '../../lib/api'
import { movingTotals } from '../../lib/movingTotals'
import { EditCustomerModalLoader } from '../../components/AddCustomerModal'
import type { MovingQuote, MovingQuoteStatus } from '../../lib/types'
import { Badge, Button, Field, Input, Modal, Spinner, Textarea } from '../../components/ui'
import { useState, useRef } from 'react'

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
  const [editCustomerModal, setEditCustomerModal] = useState(false)
  const [err, setErr] = useState('')
  const [itemsModal, setItemsModal] = useState(false)
  const [items, setItems] = useState<Array<{ description: string; subDescription?: string; qty: number; rate: number; amount: number }>>([])
  const [_editIdx, setEditIdx] = useState<number | null>(null)
  const [shareToken, setShareToken] = useState<string>('')
  const [payLinkModal, setPayLinkModal] = useState(false)
  const [payLinkBusy, setPayLinkBusy] = useState<'' | 'whatsapp' | 'email' | 'link'>('')
  const [payLinkResult, setPayLinkResult] = useState<{ payUrl: string; total: number; channel: string; feePct: number; feeAmount: number; totalCharged: number } | null>(null)
  const [payLinkCopied, setPayLinkCopied] = useState(false)
  const payLinkInputRef = useRef<HTMLInputElement | null>(null)
  // Decided right here, per send — not a global switch. Off by default.
  const [addStripeFee, setAddStripeFee] = useState(false)
  const [stripeFeePct, setStripeFeePct] = useState('3')
  const [notesEdit, setNotesEdit] = useState(false)
  const [notesVal, setNotesVal] = useState('')
  const [termsEdit, setTermsEdit] = useState(false)
  const [termsVal, setTermsVal] = useState('')
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const [discountPct, setDiscountPct] = useState(0)

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
      /* The server recomputes all of this from the items — see
         services/movingTotals.js — so what matters here is that the page shows
         the same figures it will get back. */
      const t = movingTotals({ items: newItems, discount: discountPct, vatEnabled: quote?.vatEnabled, vatRate: quote?.vatRate, status: quote?.status })
      return api.put(`/moving-quotes/${id}`, {
        items: newItems, discount: discountPct,
        subTotal: t.subTotal, vatAmount: t.vatAmount, total: t.total,
      }).then(r => r.data)
    },
    onSuccess: () => { invalidate(); setItemsModal(false); setEditIdx(null) },
    onError: (e) => setErr(apiError(e)),
  })

  const updateFieldMut = useMutation({
    mutationFn: (fields: Record<string, any>) => api.put(`/moving-quotes/${id}`, fields).then(r => r.data),
    onSuccess: () => { invalidate(); setNotesEdit(false); setTermsEdit(false) },
    onError: (e) => setErr(apiError(e)),
  })

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/moving-quotes/${id}`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['moving-quotes'] }); navigate('/moving/quotes') },
    onError: (e) => setErr(apiError(e)),
  })

  const convertToInvoiceMut = useMutation({
    mutationFn: () => api.post(`/moving-quotes/${id}/convert-to-invoice`).then(r => r.data),
    onSuccess: (invoice) => navigate(`/moving/invoices/${invoice._id}`),
    onError: (e) => setErr(apiError(e)),
  })

  async function sendStripePaymentLink(channel: 'whatsapp' | 'email' | 'link') {
    setPayLinkBusy(channel)
    try {
      const feePct = addStripeFee ? Number(stripeFeePct) || 0 : 0
      const res = await api.post(`/moving-quotes/${id}/payment-link`, { channel, feePct })
      setErr('')
      setPayLinkModal(false)
      if (channel === 'link') {
        try { await navigator.clipboard.writeText(res.data.payUrl); setPayLinkCopied(true) } catch { setPayLinkCopied(false) }
      }
      setPayLinkResult({
        payUrl: res.data.payUrl, total: res.data.total, channel: res.data.channel,
        feePct: res.data.feePct, feeAmount: res.data.feeAmount, totalCharged: res.data.totalCharged,
      })
    } catch (e) { setErr(apiError(e)) } finally { setPayLinkBusy('') }
  }

  if (isLoading) return <div className="p-8"><Spinner /></div>
  if (!quote) return <div className="p-8" style={{ color: MUTED }}>Quote not found</div>

  if (items.length === 0 && quote.items && quote.items.length > 0) {
    setItems(quote.items as typeof items)
    setDiscountPct(quote.discount || 0)
  }

  const transitions = STATUS_TRANSITIONS[quote.status] ?? []
  const total = items.reduce((s, i) => s + i.amount, 0)
  // What the document comes to, by the one rule the server and the PDF use.
  const shown = movingTotals({ items, discount: quote?.discount, vatEnabled: quote?.vatEnabled, vatRate: quote?.vatRate, status: quote?.status })

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
              window.open(apiUrl(`/moving-quotes/${id}/pdf?token=${res.data.token}`), '_blank')
            } else {
              window.open(apiUrl(`/moving-quotes/${id}/pdf?token=${shareToken}`), '_blank')
            }
          }}
        >
          <Download size={13} className="mr-1" />PDF
        </Button>
        {!['rejected', 'expired'].includes(quote.status) && quote.total > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="text-purple-600 border-purple-300 hover:bg-purple-50"
            onClick={() => setPayLinkModal(true)}
          >
            <CreditCard size={13} className="mr-1" />Payment Link
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="text-red-600 border-red-200 hover:bg-red-50"
          disabled={deleteMut.isPending}
          onClick={() => {
            if (confirm(`Delete quote ${quote.quoteNo}? This cannot be undone.`)) deleteMut.mutate()
          }}
        >
          <Trash2 size={13} className="mr-1" />
          {deleteMut.isPending ? 'Deleting…' : 'Delete'}
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
          <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
            <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK }}>Customer</div>
            {quote.customer && (
              <button type="button" onClick={() => setEditCustomerModal(true)} title="Edit customer details"
                className="p-1 rounded hover:bg-muted text-muted-foreground/50 hover:text-primary transition-colors cursor-pointer">
                <Pencil size={13} />
              </button>
            )}
          </div>
          <InfoRow label="Name">{quote.customer?.fullName}</InfoRow>
          {quote.customer?.phone && <InfoRow label="Phone">{quote.customer.phone}</InfoRow>}
          {quote.customer?.email && <InfoRow label="Email">{quote.customer.email}</InfoRow>}
        </div>
      </div>

      {quote.customer && editCustomerModal && (
        <EditCustomerModalLoader
          customerId={quote.customer._id}
          onClose={() => setEditCustomerModal(false)}
          onSaved={invalidate}
        />
      )}

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
        <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(20,8,31,0.06)', background: '#FAF8F5' }}>
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-8" style={{ fontSize: 13, color: MUTED }}>
              <span>Sub Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: INK }}>AED {fmt(shown.subTotal)}</span>
            </div>
            {shown.discount > 0 && (
              <div className="flex gap-8" style={{ fontSize: 13, color: '#EF4444' }}>
                <span>Discount ({shown.discount}%)</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>-AED {fmt(shown.discountAmount)}</span>
              </div>
            )}
            {shown.vatRate > 0 && (
              <div className="flex gap-8" style={{ fontSize: 13, color: MUTED }}>
                <span>VAT ({shown.vatRate}%)</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: INK }}>AED {fmt(shown.vatAmount)}</span>
              </div>
            )}
            <div className="flex gap-8" style={{ fontSize: 16, fontWeight: 700, color: PURPLE, ...HEADING }}>
              <span>Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>AED {fmt(shown.total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Customer Notes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
          <div className="flex items-center justify-between mb-2">
            <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK }}>Customer Notes</div>
            {!notesEdit && (
              <Button size="sm" variant="outline" onClick={() => { setNotesVal(quote.notes || ''); setNotesEdit(true) }}>
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
            <p style={{ fontSize: 13, color: quote.notes ? MUTED : '#C4BFD0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {quote.notes || 'No notes added'}
            </p>
          )}
        </div>

        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
          <div className="flex items-center justify-between mb-2">
            <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK }}>Terms & Conditions</div>
            {!termsEdit && (
              <div className="flex gap-2">
                {!quote.termsAndConditions && localStorage.getItem('pb_default_terms') && (
                  <Button size="sm" variant="outline" onClick={() => {
                    const def = localStorage.getItem('pb_default_terms') || ''
                    updateFieldMut.mutate({ termsAndConditions: def })
                  }}>Load Default</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => { setTermsVal(quote.termsAndConditions || ''); setSaveAsDefault(false); setTermsEdit(true) }}>
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
            <p style={{ fontSize: 13, color: quote.termsAndConditions ? MUTED : '#C4BFD0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {quote.termsAndConditions || 'No terms added'}
            </p>
          )}
        </div>
      </div>

      {/* Edit Items Modal */}
      <Modal open={itemsModal} title="Edit Line Items" onClose={() => setItemsModal(false)} className="max-w-6xl w-[90vw]">
        <div className="space-y-4">
          {items.map((item, i) => (
            <div key={i} className="p-3 border rounded space-y-2">
              <div className="grid grid-cols-5 gap-2 items-end">
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

          <div className="border-t pt-3 space-y-2">
            <div className="flex justify-end items-center gap-3">
              <span className="text-sm text-muted-foreground">Sub Total:</span>
              <span className="text-sm font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>AED {fmt(total)}</span>
            </div>
            <div className="flex justify-end items-center gap-3">
              <span className="text-sm text-muted-foreground">Discount %:</span>
              <Input
                type="number"
                min={0}
                max={100}
                value={discountPct}
                onChange={e => setDiscountPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                className="w-20 text-right text-sm"
              />
            </div>
            {discountPct > 0 && (
              <div className="flex justify-end items-center gap-3">
                <span className="text-sm text-red-500">Discount:</span>
                <span className="text-sm font-semibold text-red-500" style={{ fontVariantNumeric: 'tabular-nums' }}>-AED {fmt(total * discountPct / 100)}</span>
              </div>
            )}
            <div className="flex justify-end gap-8 text-sm font-semibold">
              <span>Total:</span>
              <span style={{ color: PURPLE }}>AED {fmt(total - total * discountPct / 100)}</span>
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

      {/* Send Stripe Payment Link */}
      <Modal open={payLinkModal} title="Send Stripe Payment Link" onClose={() => setPayLinkModal(false)}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Quote total: <strong>AED {quote.total.toLocaleString()}</strong>
          </p>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={addStripeFee} onChange={(e) => setAddStripeFee(e.target.checked)} className="h-4 w-4 rounded" />
            <span className="text-sm">Add card processing fee — customer pays it, not you</span>
          </label>
          {addStripeFee && (
            <div className="flex items-center gap-3 pl-6">
              <Field label="Fee %">
                <Input type="number" min={0} max={15} step="0.1" value={stripeFeePct} onChange={(e) => setStripeFeePct(e.target.value)} className="w-24" />
              </Field>
              {Number(stripeFeePct) > 0 && (
                <p className="text-xs" style={{ color: MUTED }}>
                  +AED {(quote.total * (Number(stripeFeePct) / 100)).toFixed(2)} fee ·{' '}
                  customer pays <strong>AED {(quote.total * (1 + Number(stripeFeePct) / 100)).toFixed(2)}</strong> total
                </p>
              )}
            </div>
          )}
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex flex-wrap justify-end gap-2 pt-2 border-t">
            <Button variant="outline" disabled={!!payLinkBusy} onClick={() => sendStripePaymentLink('link')}>
              <LinkIcon size={14} className="mr-1.5" />{payLinkBusy === 'link' ? 'Creating…' : 'Copy Link'}
            </Button>
            <Button variant="outline" disabled={!!payLinkBusy} onClick={() => sendStripePaymentLink('whatsapp')}>
              <Share2 size={14} className="mr-1.5" />{payLinkBusy === 'whatsapp' ? 'Sending…' : 'Send via WhatsApp'}
            </Button>
            <Button disabled={!!payLinkBusy} onClick={() => sendStripePaymentLink('email')}>
              <Mail size={14} className="mr-1.5" />{payLinkBusy === 'email' ? 'Sending…' : 'Send via Email'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Stripe Payment Link result */}
      <Modal open={!!payLinkResult} title={payLinkResult?.channel === 'link' ? 'Link copied' : 'Payment link sent'} onClose={() => { setPayLinkResult(null); setPayLinkCopied(false) }}>
        {payLinkResult && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {payLinkResult.channel === 'link' ? (payLinkCopied ? 'Copied to clipboard.' : 'Tap Copy below to copy it.') : `Sent via ${payLinkResult.channel === 'whatsapp' ? 'WhatsApp' : 'email'}.`} Total: <strong>AED {payLinkResult.total.toLocaleString()}</strong>
              {payLinkResult.feePct > 0 && (
                <> · card fee <strong>AED {payLinkResult.feeAmount.toLocaleString()}</strong> ({payLinkResult.feePct}%) · customer pays <strong>AED {payLinkResult.totalCharged.toLocaleString()}</strong> total</>
              )}
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={payLinkResult.payUrl} onFocus={(e) => e.currentTarget.select()}
                ref={(el) => { payLinkInputRef.current = el }} />
              <Button
                variant="outline"
                onClick={async () => {
                  try { await navigator.clipboard.writeText(payLinkResult.payUrl); setPayLinkCopied(true) }
                  catch { payLinkInputRef.current?.select(); document.execCommand('copy'); setPayLinkCopied(true) }
                }}
              >
                {payLinkCopied ? 'Copied ✓' : 'Copy'}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => { setPayLinkResult(null); setPayLinkCopied(false) }}>Done</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

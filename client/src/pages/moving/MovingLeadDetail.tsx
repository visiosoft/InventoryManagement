import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Trash2, Plus, X, Pencil, Phone, Mail, MapPin, Package, Truck, Image, FileText, User, Hash } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { EditCustomerModalLoader } from '../../components/AddCustomerModal'
import type { MovingLead, MovingLeadStatus, MovingLeadSource } from '../../lib/types'
import { Badge, Breadcrumb, Button, Card, CardBody, CardHeader, Field, InfoGrid, InfoItem, Input, Modal, Select, Spinner, Textarea } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/utils'

const STATUSES: MovingLeadStatus[] = ['new', 'contacted', 'quoted', 'client_approved', 'won', 'lost']
const SOURCES: MovingLeadSource[] = ['phone', 'web_form', 'mobile_app', 'whatsapp', 'referral', 'walk_in', 'other']

const statusTone: Record<MovingLeadStatus, string> = {
  new: 'blue', contacted: 'amber', quoted: 'purple', client_approved: 'green', won: 'green', lost: 'red',
}

const statusLabel: Record<MovingLeadStatus, string> = {
  new: 'New Lead', contacted: 'Contacted', quoted: 'Quoted', client_approved: 'Client Approved', won: 'Won', lost: 'Lost',
}

const STATUS_TRANSITIONS: Record<MovingLeadStatus, MovingLeadStatus[]> = {
  new: ['contacted', 'lost'],
  contacted: ['quoted', 'lost'],
  quoted: ['won', 'lost'],
  client_approved: ['won', 'lost'],
  won: [],
  lost: ['new'],
}

export default function MovingLeadDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuth()
  const [noteText, setNoteText] = useState('')
  const [err, setErr] = useState('')
  const [editModal, setEditModal] = useState(false)
  const [editCustomerModal, setEditCustomerModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const { data: lead, isLoading } = useQuery<MovingLead>({
    queryKey: ['moving-lead', id],
    queryFn: () => api.get(`/moving-leads/${id}`).then(r => r.data),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['moving-lead', id] })

  const statusMut = useMutation({
    mutationFn: (status: MovingLeadStatus) => api.patch(`/moving-leads/${id}/status`, { status }),
    onSuccess: invalidate,
    onError: (e) => setErr(apiError(e)),
  })

  const addNoteMut = useMutation({
    mutationFn: () => api.post(`/moving-leads/${id}/notes`, { text: noteText, author: user?.name || 'User' }),
    onSuccess: () => { invalidate(); setNoteText('') },
  })

  const deleteNoteMut = useMutation({
    mutationFn: (idx: number) => api.delete(`/moving-leads/${id}/notes/${idx}`),
    onSuccess: invalidate,
  })

  const convertMut = useMutation({
    mutationFn: () => api.post(`/moving-leads/${id}/convert`, {}).then(r => r.data),
    onSuccess: (job) => navigate(`/moving/jobs/${job._id}`),
    onError: (e) => setErr(apiError(e)),
  })

  const updateMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/moving-leads/${id}`, body),
    onSuccess: () => { invalidate(); setEditModal(false) },
    onError: (e) => setErr(apiError(e)),
  })

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/moving-leads/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['moving-leads'] }); navigate('/moving/leads') },
    onError: (e) => setErr(apiError(e)),
  })

  if (isLoading) return <div className="p-8"><Spinner /></div>
  if (!lead) return <div className="p-8 text-muted-foreground">Lead not found</div>

  const transitions = STATUS_TRANSITIONS[lead.status] ?? []
  const name = lead.prospectName || lead.customer?.fullName || '—'
  const phone = lead.prospectPhone || lead.customer?.phone || '—'
  const email = lead.prospectEmail || lead.customer?.email || ''
  const linkedJob = (lead as any).linkedJob as { _id: string; jobNo: string } | undefined

  const photos = lead.images?.filter((img: any) => img.category !== 'Move Permit') ?? []
  const permits = lead.images?.filter((img: any) => img.category === 'Move Permit') ?? []

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb items={[
        { label: 'Moving', href: '/moving/leads' },
        { label: 'Leads', href: '/moving/leads' },
        { label: name },
      ]} />

      {/* Header */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <div className="px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            {/* Left: Name + contact */}
            <div className="flex items-start gap-4 min-w-0">
              <button onClick={() => navigate('/moving/leads')} className="mt-1 text-muted-foreground hover:text-foreground transition-colors shrink-0">
                <ArrowLeft size={20} />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-bold tracking-tight truncate">{name}</h1>
                  <Badge tone={statusTone[lead.status]} className="text-xs px-2.5 py-1">{statusLabel[lead.status]}</Badge>
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1.5"><Phone size={13} /> {phone}</span>
                  {email && <span className="flex items-center gap-1.5"><Mail size={13} /> {email}</span>}
                  {linkedJob && (
                    <Link to={`/moving/jobs/${linkedJob._id}`} className="flex items-center gap-1.5 text-primary hover:underline font-mono font-medium">
                      <Hash size={13} /> {linkedJob.jobNo}
                    </Link>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {transitions.map(s => (
                <Button key={s} size="sm" variant="outline" onClick={() => statusMut.mutate(s)} disabled={statusMut.isPending}>
                  {s === 'lost' ? '→ Lost' : `→ ${statusLabel[s]}`}
                </Button>
              ))}
              {lead.status !== 'won' && lead.status !== 'lost' && (
                <Button size="sm" onClick={() => convertMut.mutate()} disabled={convertMut.isPending}>
                  {convertMut.isPending ? 'Converting…' : 'Convert to Job →'}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setEditModal(true)} className="h-8 w-8 p-0">
                <Pencil size={15} />
              </Button>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => setDeleteConfirm(true)}>
                <Trash2 size={15} />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {err && <div className="text-sm text-red-600 bg-red-500/10 border border-red-500/20 p-3 rounded-lg">{err}</div>}

      {/* Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Main Info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Lead Details */}
          <Card>
            <CardHeader title="Lead Details" />
            <CardBody>
              <InfoGrid cols={3}>
                <InfoItem label="Source" value={<span className="capitalize">{lead.source.replace(/_/g, ' ')}</span>} />
                <InfoItem label="Service Type" value={lead.serviceType || '—'} />
                <InfoItem label="Property Type" value={lead.propertyType || '—'} />
                <InfoItem label="Move Date" value={lead.moveDate ? formatDate(lead.moveDate) : '—'} />
                <InfoItem label="Est. Volume" value={lead.estimatedVolumeCbm ? `${lead.estimatedVolumeCbm} CBM` : '—'} />
                <InfoItem label="Created" value={lead.createdAt ? formatDate(lead.createdAt) : '—'} />
              </InfoGrid>
            </CardBody>
          </Card>

          {/* Addresses */}
          <Card>
            <CardHeader title="Addresses" />
            <CardBody>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="flex gap-3">
                  <div className="shrink-0 mt-0.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <MapPin size={16} className="text-emerald-600" />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Pickup</p>
                    <p className="text-sm">{lead.pickupAddress || '—'}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="shrink-0 mt-0.5">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Truck size={16} className="text-blue-600" />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Delivery</p>
                    <p className="text-sm">{lead.deliveryAddress || '—'}</p>
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Notes */}
          {lead.notes && (
            <Card>
              <CardHeader title="Notes" />
              <CardBody>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{lead.notes}</p>
              </CardBody>
            </Card>
          )}

          {/* Customer Photos */}
          <Card>
            <CardHeader title={`Customer Photos${lead.images?.length ? ` (${lead.images.length})` : ''}`} />
            <CardBody>
              {lead.images?.length ? (
                <div className="space-y-4">
                  {photos.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {photos.map((img: any, i: number) => (
                        <a key={i} href={img.url} target="_blank" rel="noopener noreferrer" className="group block aspect-square rounded-lg overflow-hidden border border-border hover:ring-2 ring-primary transition-all hover:shadow-md">
                          <img src={img.url} alt={img.originalName || `Photo ${i + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                        </a>
                      ))}
                    </div>
                  )}
                  {permits.length > 0 && (
                    <div className={photos.length > 0 ? 'pt-4 border-t' : ''}>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <FileText size={13} /> Move Permit
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {permits.map((img: any, i: number) => (
                          <a key={i} href={img.url} target="_blank" rel="noopener noreferrer" className="group block aspect-square rounded-lg overflow-hidden border border-border hover:ring-2 ring-primary transition-all hover:shadow-md">
                            <img src={img.url} alt={img.originalName || `Permit ${i + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                    <Image size={20} className="text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">No photos uploaded by customer yet</p>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Quote Section */}
          <QuoteSection lead={lead} onUpdate={invalidate} userName={user?.name || 'User'} />
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Quick Info Card */}
          {lead.customer && (
            <Card>
              <CardHeader title="Customer"
                action={
                  <button type="button" onClick={() => setEditCustomerModal(true)} title="Edit customer details"
                    className="p-1 rounded hover:bg-muted text-muted-foreground/60 hover:text-primary transition-colors cursor-pointer">
                    <Pencil size={13} />
                  </button>
                } />
              <CardBody>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <User size={18} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{lead.customer.fullName}</p>
                      <p className="text-xs text-muted-foreground">{lead.customer.phone}</p>
                    </div>
                  </div>
                  {lead.customer.email && (
                    <p className="text-xs text-muted-foreground pl-[52px]">{lead.customer.email}</p>
                  )}
                </div>
              </CardBody>
            </Card>
          )}
          {lead.customer && editCustomerModal && (
            <EditCustomerModalLoader
              customerId={lead.customer._id}
              onClose={() => setEditCustomerModal(false)}
              onSaved={invalidate}
            />
          )}

          {/* Linked Job */}
          {linkedJob && (
            <Card>
              <CardHeader title="Linked Job" />
              <CardBody>
                <Link to={`/moving/jobs/${linkedJob._id}`} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors group">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Package size={18} className="text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-mono font-semibold group-hover:text-primary transition-colors">{linkedJob.jobNo}</p>
                    <p className="text-xs text-muted-foreground">View job details</p>
                  </div>
                </Link>
              </CardBody>
            </Card>
          )}

          {/* Timeline */}
          <Card>
            <CardHeader title="Activity Timeline" />
            <CardBody>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    rows={2}
                    placeholder="Add a note…"
                    className="flex-1"
                  />
                  <Button onClick={() => addNoteMut.mutate()} disabled={!noteText.trim() || addNoteMut.isPending} size="sm" className="self-end">
                    Add
                  </Button>
                </div>
                <div className="space-y-0">
                  {(lead.timeline?.length ?? 0) === 0
                    ? <p className="text-sm text-muted-foreground text-center py-4">No activity yet</p>
                    : [...(lead.timeline ?? [])].reverse().map((n, ri) => {
                        const idx = (lead.timeline?.length ?? 0) - 1 - ri
                        return (
                          <div key={idx} className="relative pl-6 pb-4 last:pb-0 group">
                            {/* Timeline line */}
                            <div className="absolute left-[9px] top-4 bottom-0 w-px bg-border group-last:hidden" />
                            {/* Timeline dot */}
                            <div className="absolute left-0 top-1.5 w-[18px] h-[18px] rounded-full border-2 border-border bg-card flex items-center justify-center">
                              <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                            </div>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm leading-relaxed">{n.text}</p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {new Date(n.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  {n.author ? ` · ${n.author}` : ''}
                                </p>
                              </div>
                              <button onClick={() => deleteNoteMut.mutate(idx)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 shrink-0 transition-opacity mt-0.5">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        )
                      })
                  }
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Edit Lead Modal */}
      <Modal open={editModal} title="Edit Lead" onClose={() => setEditModal(false)}>
        {editModal && <EditLeadForm lead={lead} busy={updateMut.isPending} error={err} onSubmit={body => { setErr(''); updateMut.mutate(body) }} onCancel={() => setEditModal(false)} />}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={deleteConfirm} title="Delete Lead" onClose={() => setDeleteConfirm(false)}>
        <div className="space-y-4">
          <p className="text-sm">Are you sure you want to delete <strong>{name}</strong>? This action cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? 'Deleting…' : 'Delete Lead'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function EditLeadForm({ lead, busy, error, onSubmit, onCancel }: {
  lead: MovingLead
  busy: boolean
  error: string
  onSubmit: (body: Record<string, unknown>) => void
  onCancel: () => void
}) {
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onSubmit({
      prospectName: String(f.get('prospectName') || ''),
      prospectPhone: String(f.get('prospectPhone') || ''),
      prospectEmail: String(f.get('prospectEmail') || ''),
      source: String(f.get('source') || 'phone'),
      status: String(f.get('status') || 'new'),
      serviceType: String(f.get('serviceType') || ''),
      propertyType: String(f.get('propertyType') || ''),
      moveDate: f.get('moveDate') || undefined,
      pickupAddress: String(f.get('pickupAddress') || ''),
      deliveryAddress: String(f.get('deliveryAddress') || ''),
      estimatedVolumeCbm: f.get('estimatedVolumeCbm') ? Number(f.get('estimatedVolumeCbm')) : 0,
      notes: String(f.get('notes') || ''),
    })
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name"><Input name="prospectName" defaultValue={lead.prospectName} required /></Field>
        <Field label="Phone"><Input name="prospectPhone" defaultValue={lead.prospectPhone} required /></Field>
        <Field label="Email"><Input name="prospectEmail" type="email" defaultValue={lead.prospectEmail} /></Field>
        <Field label="Source">
          <Select name="source" defaultValue={lead.source}>
            {SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={lead.status}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Move Date"><Input name="moveDate" type="date" defaultValue={lead.moveDate?.slice(0, 10)} /></Field>
        <Field label="Service Type"><Input name="serviceType" defaultValue={lead.serviceType} placeholder="e.g. Home Shifting" /></Field>
        <Field label="Property Type"><Input name="propertyType" defaultValue={lead.propertyType} placeholder="e.g. Studio, 2 BHK" /></Field>
        <Field label="Pickup Address" className="col-span-2"><Textarea name="pickupAddress" rows={2} defaultValue={lead.pickupAddress} /></Field>
        <Field label="Delivery Address" className="col-span-2"><Textarea name="deliveryAddress" rows={2} defaultValue={lead.deliveryAddress} /></Field>
        <Field label="Est. Volume (CBM)"><Input name="estimatedVolumeCbm" type="number" min="0" step="0.1" defaultValue={lead.estimatedVolumeCbm} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea name="notes" rows={2} defaultValue={lead.notes} /></Field>
      </div>
      {error && <p className="text-sm text-red-600 bg-red-500/10 border border-red-500/20 p-3 rounded-lg">{error}</p>}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Changes'}</Button>
      </div>
    </form>
  )
}

type QuoteItem = { description: string; qty: number; rate: number; amount: number }

function QuoteSection({ lead, onUpdate, userName }: { lead: MovingLead; onUpdate: () => void; userName: string }) {
  const [editing, setEditing] = useState(false)
  const [items, setItems] = useState<QuoteItem[]>(
    lead.quotation?.items?.length ? lead.quotation.items : [{ description: '', qty: 1, rate: 0, amount: 0 }]
  )
  const [discount, setDiscount] = useState(lead.quotation?.discount || 0)
  const [qNotes, setQNotes] = useState(lead.quotation?.notes || '')
  const [err, setErr] = useState('')

  const quoteMut = useMutation({
    mutationFn: (data: any) => api.patch(`/moving-leads/${lead._id}/quote`, data),
    onSuccess: () => { onUpdate(); setEditing(false) },
    onError: (e) => setErr(apiError(e)),
  })

  const updateItem = (i: number, field: keyof QuoteItem, val: string) => {
    const next = [...items]
    if (field === 'description') next[i] = { ...next[i], description: val }
    else {
      const num = parseFloat(val) || 0
      next[i] = { ...next[i], [field]: num }
      if (field === 'qty' || field === 'rate') next[i].amount = next[i].qty * next[i].rate
    }
    setItems(next)
  }

  const addItem = () => setItems([...items, { description: '', qty: 1, rate: 0, amount: 0 }])
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i))

  const subTotal = items.reduce((s, it) => s + it.amount, 0)
  const total = Math.max(0, subTotal - discount)

  if (lead.quotation?.total && !editing) {
    const q = lead.quotation
    return (
      <Card>
        <CardHeader title="Quotation" action={
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil size={13} className="mr-1" /> Edit
          </Button>
        } />
        <CardBody>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge tone="purple">Quoted</Badge>
              <span className="text-xs text-muted-foreground">
                {q.quotedAt ? formatDate(q.quotedAt) : ''} {q.quotedBy ? `by ${q.quotedBy}` : ''}
              </span>
            </div>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Description</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground w-16">Qty</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground w-28">Rate</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground w-28">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {q.items.map((it, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="px-4 py-2.5">{it.description}</td>
                      <td className="px-4 py-2.5 text-right">{it.qty}</td>
                      <td className="px-4 py-2.5 text-right">AED {it.rate.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right font-medium">AED {it.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-end gap-1.5 text-sm pt-1">
              <div className="flex gap-12"><span className="text-muted-foreground">Subtotal</span><span className="font-medium">AED {q.subTotal.toLocaleString()}</span></div>
              {q.discount > 0 && <div className="flex gap-12"><span className="text-muted-foreground">Discount</span><span className="text-emerald-600 font-medium">- AED {q.discount.toLocaleString()}</span></div>}
              <div className="flex gap-12 text-base font-bold border-t pt-2 mt-1"><span>Total</span><span className="text-primary">AED {q.total.toLocaleString()}</span></div>
            </div>
            {q.notes && <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">{q.notes}</p>}
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title={lead.quotation?.total ? 'Edit Quote' : 'Send Quote'} />
      <CardBody>
        {!editing && !lead.quotation?.total ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <FileText size={20} className="text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground mb-4">Review the customer's photos and details, then send a quote.</p>
            <Button size="sm" onClick={() => setEditing(true)}>Create Quote</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <Input placeholder="Description" value={it.description} onChange={e => updateItem(i, 'description', e.target.value)} className="flex-1" />
                  <Input type="number" placeholder="Qty" value={it.qty || ''} onChange={e => updateItem(i, 'qty', e.target.value)} className="w-16 text-right" />
                  <Input type="number" placeholder="Rate" value={it.rate || ''} onChange={e => updateItem(i, 'rate', e.target.value)} className="w-24 text-right" />
                  <div className="w-24 text-right text-sm font-medium pt-2.5">AED {it.amount.toLocaleString()}</div>
                  {items.length > 1 && (
                    <button onClick={() => removeItem(i)} className="pt-2.5 text-muted-foreground hover:text-red-500"><X size={14} /></button>
                  )}
                </div>
              ))}
              <button onClick={addItem} className="flex items-center gap-1 text-sm text-primary hover:underline"><Plus size={14} /> Add item</button>
            </div>

            <div className="flex flex-col items-end gap-1 text-sm">
              <div className="flex gap-8"><span className="text-muted-foreground">Subtotal</span><span>AED {subTotal.toLocaleString()}</span></div>
              <div className="flex gap-2 items-center">
                <span className="text-muted-foreground text-sm">Discount</span>
                <Input type="number" value={discount || ''} onChange={e => setDiscount(parseFloat(e.target.value) || 0)} className="w-24 text-right" placeholder="0" />
              </div>
              <div className="flex gap-8 text-base font-semibold border-t pt-2 mt-1"><span>Total</span><span>AED {total.toLocaleString()}</span></div>
            </div>

            <Textarea value={qNotes} onChange={e => setQNotes(e.target.value)} rows={2} placeholder="Quote notes (optional)…" />

            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={() => quoteMut.mutate({ items: items.filter(it => it.description), discount, notes: qNotes, quotedBy: userName })} disabled={!items.some(it => it.description) || quoteMut.isPending}>
                {quoteMut.isPending ? 'Sending…' : 'Send Quote to Customer'}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

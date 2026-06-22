import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, FileText } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob, MovingJobStatus, Worker, Truck } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Table, Td, Th, Textarea } from '../../components/ui'
import { useAuth } from '../../lib/auth'

const statusTone: Record<MovingJobStatus, string> = {
  draft: 'gray', confirmed: 'blue', survey_done: 'purple',
  in_progress: 'yellow', completed: 'green', invoiced: 'teal', cancelled: 'red',
}

const STATUS_TRANSITIONS: Record<MovingJobStatus, MovingJobStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['survey_done', 'in_progress', 'cancelled'],
  survey_done: ['confirmed', 'in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['invoiced'],
  invoiced: [],
  cancelled: [],
}

function dt(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function MovingJobDetail() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [noteText, setNoteText] = useState('')
  const [crewModal, setCrewModal] = useState(false)
  const [truckModal, setTruckModal] = useState(false)
  const [costsModal, setCostsModal] = useState(false)
  const [err, setErr] = useState('')

  const { data: job, isLoading } = useQuery<MovingJob>({
    queryKey: ['moving-job', id],
    queryFn: () => api.get(`/moving-jobs/${id}`).then(r => r.data),
  })

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ['workers'],
    queryFn: () => api.get('/workers').then(r => r.data),
    enabled: crewModal,
  })

  const { data: trucks = [] } = useQuery<Truck[]>({
    queryKey: ['trucks'],
    queryFn: () => api.get('/trucks').then(r => r.data),
    enabled: truckModal,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['moving-job', id] })

  const statusMut = useMutation({
    mutationFn: (status: MovingJobStatus) => api.patch(`/moving-jobs/${id}/status`, { status }),
    onSuccess: invalidate,
    onError: (e) => setErr(apiError(e)),
  })

  const addNoteMut = useMutation({
    mutationFn: () => api.post(`/moving-jobs/${id}/notes`, { text: noteText, author: user?.name || 'User' }),
    onSuccess: () => { invalidate(); setNoteText('') },
  })

  const deleteNoteMut = useMutation({
    mutationFn: (idx: number) => api.delete(`/moving-jobs/${id}/notes/${idx}`),
    onSuccess: invalidate,
  })

  const updateMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/moving-jobs/${id}`, body).then(r => r.data),
    onSuccess: () => { invalidate(); setCrewModal(false); setTruckModal(false); setCostsModal(false) },
    onError: (e) => setErr(apiError(e)),
  })

  const createQuoteMut = useMutation({
    mutationFn: () => api.post('/moving-quotes', {
      job: id,
      customer: job?.customer?._id,
      status: 'draft',
      items: [],
      total: 0,
      notes: `Quote for job ${job?.jobNo}`,
    }).then(r => r.data),
    onSuccess: (quote) => navigate(`/moving/quotes/${quote._id}`),
    onError: (e) => setErr(apiError(e)),
  })

  const createInvoiceMut = useMutation({
    mutationFn: () => api.post('/moving-invoices', {
      job: id,
      customer: job?.customer?._id,
      status: 'draft',
      items: [],
      total: 0,
      balanceDue: 0,
      notes: `Invoice for job ${job?.jobNo}`,
    }).then(r => r.data),
    onSuccess: (invoice) => navigate(`/moving/invoices/${invoice._id}`),
    onError: (e) => setErr(apiError(e)),
  })

  if (isLoading) return <div className="p-8"><Spinner /></div>
  if (!job) return <div className="p-8 text-muted-foreground">Job not found</div>

  const transitions = STATUS_TRANSITIONS[job.status] ?? []
  const crewList = (job.crew ?? []) as Array<{ worker: { _id: string; name: string; role: string }; role?: string; dailyRate?: number }>
  const truckList = (job.trucks ?? []) as Array<{ truck: { _id: string; name: string; plateNumber?: string }; notes?: string }>

  function handleAddCrew(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const workerId = String(f.get('worker'))
    const existing = crewList.map(c => ({ worker: c.worker._id, role: c.role, dailyRate: c.dailyRate }))
    updateMut.mutate({ crew: [...existing, { worker: workerId, role: f.get('role'), dailyRate: Number(f.get('dailyRate') || 0) }] })
  }

  function handleRemoveCrew(idx: number) {
    const updated = crewList.filter((_, i) => i !== idx).map(c => ({ worker: c.worker._id, role: c.role, dailyRate: c.dailyRate }))
    updateMut.mutate({ crew: updated })
  }

  function handleAddTruck(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const truckId = String(f.get('truck'))
    const existing = truckList.map(t => ({ truck: t.truck._id, notes: t.notes }))
    updateMut.mutate({ trucks: [...existing, { truck: truckId, notes: f.get('notes') }] })
  }

  function handleRemoveTruck(idx: number) {
    const updated = truckList.filter((_, i) => i !== idx).map(t => ({ truck: t.truck._id, notes: t.notes }))
    updateMut.mutate({ trucks: updated })
  }

  function handleUpdateCosts(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const labor = Number(f.get('labor') || 0)
    const truck = Number(f.get('truck') || 0)
    const materials = Number(f.get('materials') || 0)
    const packing = Number(f.get('packing') || 0)
    const extras = Number(f.get('extras') || 0)
    updateMut.mutate({ costs: { labor, truck, materials, packing, extras, total: labor + truck + materials + packing + extras } })
  }

  const addedWorkerIds = new Set(crewList.map(c => c.worker._id))
  const availableWorkers = workers.filter(w => !addedWorkerIds.has(w._id))
  const addedTruckIds = new Set(truckList.map(t => t.truck._id))
  const availableTrucks = trucks.filter(t => !addedTruckIds.has(t._id))

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/moving/jobs')} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{job.jobNo}</h1>
          <p className="text-sm text-muted-foreground">{job.customer?.fullName}</p>
        </div>
        <Badge tone={statusTone[job.status]}>{job.status.replace('_', ' ')}</Badge>
        {!job.quote && (
          <Button size="sm" variant="outline" onClick={() => createQuoteMut.mutate()} disabled={createQuoteMut.isPending}>
            <FileText size={13} className="mr-1" />
            {createQuoteMut.isPending ? 'Creating…' : 'Quote'}
          </Button>
        )}
        {!job.invoice && (
          <Button size="sm" onClick={() => createInvoiceMut.mutate()} disabled={createInvoiceMut.isPending}>
            <FileText size={13} className="mr-1" />
            {createInvoiceMut.isPending ? 'Creating…' : 'Invoice'}
          </Button>
        )}
        {transitions.length > 0 && (
          <div className="flex gap-2">
            {transitions.map(s => (
              <Button key={s} size="sm" variant="outline" onClick={() => statusMut.mutate(s)} disabled={statusMut.isPending}>
                → {s.replace('_', ' ')}
              </Button>
            ))}
          </div>
        )}
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-2 gap-6">
        {/* Job info */}
        <Card>
          <CardBody>
            <dl className="space-y-4 text-sm">
              <div className="flex justify-between gap-6"><dt className="text-muted-foreground min-w-[100px]">Type</dt><dd className="capitalize text-right font-medium">{job.jobType?.replace('_', ' ') || '—'}</dd></div>
              <div className="flex justify-between gap-6"><dt className="text-muted-foreground min-w-[100px]">Scheduled</dt><dd className="text-right font-medium">{dt(job.scheduledDate)}</dd></div>
              <div className="flex justify-between gap-6"><dt className="text-muted-foreground min-w-[100px]">Time Slot</dt><dd className="text-right font-medium">{job.scheduledTimeSlot || '—'}</dd></div>
              <div className="flex justify-between gap-6"><dt className="text-muted-foreground min-w-[100px]">Est. Duration</dt><dd className="text-right font-medium">{job.estimatedDurationHours ? `${job.estimatedDurationHours}h` : '—'}</dd></div>
              {job.quote && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Quote</dt>
                  <dd><Link to={`/moving/quotes/${job.quote._id}`} className="text-primary hover:underline">{job.quote.quoteNo}</Link></dd>
                </div>
              )}
              {job.invoice && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Invoice</dt>
                  <dd><Link to={`/moving/invoices/${job.invoice._id}`} className="text-primary hover:underline">{job.invoice.invoiceNo}</Link></dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        {/* Addresses */}
        <Card>
          <CardHeader title="Addresses" />
          <CardBody>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Pickup</p>
                <p>{job.pickupAddress || '—'}</p>
                {(job.pickupFloor || job.pickupHasElevator) && (
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {job.pickupFloor && `Floor: ${job.pickupFloor}`}
                    {job.pickupHasElevator && ' · Elevator'}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Delivery</p>
                <p>{job.deliveryAddress || '—'}</p>
                {(job.deliveryFloor || job.deliveryHasElevator) && (
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {job.deliveryFloor && `Floor: ${job.deliveryFloor}`}
                    {job.deliveryHasElevator && ' · Elevator'}
                  </p>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Crew */}
        <Card>
          <CardHeader title="Crew" action={<Button size="sm" variant="outline" onClick={() => setCrewModal(true)}><Plus size={13} /> Add</Button>} />
          <CardBody>
            {crewList.length === 0 ? <EmptyState message="No crew assigned" /> : (
              <Table>
                <thead><tr><Th>Name</Th><Th>Role</Th><Th>Daily Rate</Th><Th /></tr></thead>
                <tbody>
                  {crewList.map((c, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <Td className="font-medium">{c.worker.name}</Td>
                      <Td className="capitalize">{c.role || c.worker.role}</Td>
                      <Td>AED {c.dailyRate?.toLocaleString() ?? '—'}</Td>
                      <Td>
                        <button onClick={() => handleRemoveCrew(i)} className="text-red-500 hover:text-red-700"><Trash2 size={13} /></button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* Trucks */}
        <Card>
          <CardHeader title="Trucks" action={<Button size="sm" variant="outline" onClick={() => setTruckModal(true)}><Plus size={13} /> Add</Button>} />
          <CardBody>
            {truckList.length === 0 ? <EmptyState message="No trucks assigned" /> : (
              <Table>
                <thead><tr><Th>Truck</Th><Th>Plate</Th><Th>Notes</Th><Th /></tr></thead>
                <tbody>
                  {truckList.map((t, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <Td className="font-medium">{t.truck.name}</Td>
                      <Td>{t.truck.plateNumber || '—'}</Td>
                      <Td className="text-sm text-muted-foreground">{t.notes || '—'}</Td>
                      <Td>
                        <button onClick={() => handleRemoveTruck(i)} className="text-red-500 hover:text-red-700"><Trash2 size={13} /></button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* Costs */}
        <Card className="col-span-2">
          <CardHeader title="Costs" action={<Button size="sm" variant="outline" onClick={() => setCostsModal(true)}>Edit</Button>} />
          <CardBody>
            <div className="grid grid-cols-6 gap-4 text-sm">
              {(['labor', 'truck', 'materials', 'packing', 'extras'] as const).map(k => (
                <div key={k} className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{k}</p>
                  <p className="font-semibold text-base">AED {(job.costs?.[k] ?? 0).toLocaleString()}</p>
                </div>
              ))}
              <div className="space-y-1 border-l-2 border-primary pl-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</p>
                <p className="font-bold text-lg text-primary">AED {(job.costs?.total ?? 0).toLocaleString()}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Notes / Timeline */}
      <Card>
        <CardHeader title="Notes & Timeline" />
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
              <Button onClick={() => addNoteMut.mutate()} disabled={!noteText.trim() || addNoteMut.isPending} size="sm">
                Add
              </Button>
            </div>
            {(job.timeline?.length ?? 0) === 0
              ? <p className="text-sm text-muted-foreground">No notes yet</p>
              : [...(job.timeline ?? [])].reverse().map((n, ri) => {
                  const idx = (job.timeline?.length ?? 0) - 1 - ri
                  return (
                    <div key={idx} className="flex gap-3 text-sm border-l-2 border-muted pl-3">
                      <div className="flex-1">
                        <p className="text-muted-foreground text-xs mb-1">
                          {new Date(n.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {n.author}
                        </p>
                        <p>{n.text}</p>
                      </div>
                      <button onClick={() => deleteNoteMut.mutate(idx)} className="text-muted-foreground hover:text-red-500 shrink-0">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )
                })
            }
          </div>
        </CardBody>
      </Card>

      {/* Add Crew Modal */}
      <Modal open={crewModal} title="Add Crew Member" onClose={() => setCrewModal(false)}>
        <form onSubmit={handleAddCrew} className="space-y-4">
          <Field label="Worker">
            <Select name="worker" required>
              <option value="">Select worker…</option>
              {availableWorkers.map(w => (
                <option key={w._id} value={w._id}>{w.name} ({w.role})</option>
              ))}
            </Select>
          </Field>
          <Field label="Role (optional)"><Input name="role" placeholder="Leave blank for default" /></Field>
          <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" step="0.01" defaultValue={0} /></Field>
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending ? 'Adding…' : 'Add'}</Button>
          </div>
        </form>
      </Modal>

      {/* Add Truck Modal */}
      <Modal open={truckModal} title="Assign Truck" onClose={() => setTruckModal(false)}>
        <form onSubmit={handleAddTruck} className="space-y-4">
          <Field label="Truck">
            <Select name="truck" required>
              <option value="">Select truck…</option>
              {availableTrucks.map(t => (
                <option key={t._id} value={t._id}>{t.name} {t.plateNumber ? `(${t.plateNumber})` : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="Notes"><Input name="notes" placeholder="Optional" /></Field>
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending ? 'Assigning…' : 'Assign'}</Button>
          </div>
        </form>
      </Modal>

      {/* Costs Modal */}
      <Modal open={costsModal} title="Update Costs" onClose={() => setCostsModal(false)}>
        <form onSubmit={handleUpdateCosts} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {(['labor', 'truck', 'materials', 'packing', 'extras'] as const).map(k => (
              <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1)}>
                <Input name={k} type="number" min="0" step="0.01" defaultValue={job.costs?.[k] ?? 0} />
              </Field>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

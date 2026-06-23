import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, FileText, MapPin, Users, Truck as TruckIcon, AlertCircle, ClipboardList } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob, MovingJobStatus, Worker, Truck } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Table, Td, Th, Textarea, InfoGrid, InfoItem } from '../../components/ui'
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

  if (isLoading) return <div className="p-12"><Spinner /></div>
  if (!job) return <div className="p-8"><div className="flex items-center gap-2 text-muted-foreground"><AlertCircle size={20} /> Job not found</div></div>

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
      {/* Header with Back and Title */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 flex-1">
          <button
            onClick={() => navigate('/moving/jobs')}
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0"
            title="Back to jobs"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-foreground">{job.jobNo}</h1>
              <Badge tone={statusTone[job.status]} className="text-sm px-3 py-1.5">
                {job.status.replace(/_/g, ' ')}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {job.customer?.fullName} • Job ID: {job._id?.slice(-8)}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/moving/jobs/${id}/survey`)}
            title="View or edit the moving survey"
          >
            <ClipboardList size={16} className="mr-1" />
            Survey
          </Button>
          {!job.quote && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => createQuoteMut.mutate()}
              disabled={createQuoteMut.isPending}
              title="Create a quote for this job"
            >
              <FileText size={16} className="mr-1" />
              {createQuoteMut.isPending ? 'Creating…' : 'Quote'}
            </Button>
          )}
          {!job.invoice && (
            <Button
              size="sm"
              onClick={() => createInvoiceMut.mutate()}
              disabled={createInvoiceMut.isPending}
              title="Create an invoice for this job"
            >
              <FileText size={16} className="mr-1" />
              {createInvoiceMut.isPending ? 'Creating…' : 'Invoice'}
            </Button>
          )}
        </div>
      </div>

      {/* Status Transitions */}
      {transitions.length > 0 && (
        <Card className="bg-gradient-to-r from-primary/5 to-primary/0 border-primary/20">
          <CardBody className="py-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Next Steps:</span>
              <div className="flex gap-2">
                {transitions.map(s => (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    onClick={() => statusMut.mutate(s)}
                    disabled={statusMut.isPending}
                    className="text-xs"
                  >
                    {s.replace(/_/g, ' ')}
                  </Button>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {err && (
        <Card className="bg-red-500/10 border-red-500/20">
          <CardBody className="py-3">
            <div className="flex items-center gap-2 text-sm text-red-700">
              <AlertCircle size={16} />
              {err}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Job Details Grid */}
      <Card>
        <CardHeader title="Job Details" subtitle="Core information about this moving job" />
        <CardBody>
          <InfoGrid cols={4}>
            <InfoItem
              label="Type"
              value={<span className="capitalize">{job.jobType?.replace(/_/g, ' ') || '—'}</span>}
            />
            <InfoItem
              label="Scheduled Date"
              value={dt(job.scheduledDate)}
            />
            <InfoItem
              label="Time Slot"
              value={job.scheduledTimeSlot || '—'}
            />
            <InfoItem
              label="Estimated Duration"
              value={job.estimatedDurationHours ? `${job.estimatedDurationHours}h` : '—'}
            />
            {job.quote && (
              <InfoItem
                label="Quote"
                value={<Link to={`/moving/quotes/${job.quote._id}`} className="text-primary hover:underline font-medium">{job.quote.quoteNo}</Link>}
              />
            )}
            {job.invoice && (
              <InfoItem
                label="Invoice"
                value={<Link to={`/moving/invoices/${job.invoice._id}`} className="text-primary hover:underline font-medium">{job.invoice.invoiceNo}</Link>}
              />
            )}
          </InfoGrid>
        </CardBody>
      </Card>

      {/* Addresses Section */}
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><MapPin size={15} />Locations</span>} subtitle="Pickup and delivery addresses" />
        <CardBody>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <h3 className="font-semibold text-sm text-foreground">Pickup Location</h3>
              </div>
              <p className="text-sm text-foreground mb-2">{job.pickupAddress || '—'}</p>
              {(job.pickupFloor || job.pickupHasElevator) && (
                <div className="text-xs text-muted-foreground space-y-1">
                  {job.pickupFloor && <p>Floor: {job.pickupFloor}</p>}
                  {job.pickupHasElevator && <p className="font-medium">Has Elevator</p>}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <h3 className="font-semibold text-sm text-foreground">Delivery Location</h3>
              </div>
              <p className="text-sm text-foreground mb-2">{job.deliveryAddress || '—'}</p>
              {(job.deliveryFloor || job.deliveryHasElevator) && (
                <div className="text-xs text-muted-foreground space-y-1">
                  {job.deliveryFloor && <p>Floor: {job.deliveryFloor}</p>}
                  {job.deliveryHasElevator && <p className="font-medium">Has Elevator</p>}
                </div>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Crew and Trucks Grid */}
      <div className="grid grid-cols-2 gap-6">
        {/* Crew */}
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Users size={15} />Crew</span>}
            subtitle={`${crewList.length} member${crewList.length !== 1 ? 's' : ''}`}
            action={<Button size="sm" variant="outline" onClick={() => setCrewModal(true)}><Plus size={14} className="mr-1" /> Add</Button>}
          />
          <CardBody>
            {crewList.length === 0 ? (
              <EmptyState message="No crew members assigned to this job yet" />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr className="border-b-2 border-muted">
                      <Th>Name</Th>
                      <Th>Role</Th>
                      <Th>Daily Rate</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {crewList.map((c, i) => (
                      <tr key={i} className="hover:bg-muted/50 transition-colors">
                        <Td className="font-medium">{c.worker.name}</Td>
                        <Td className="capitalize text-sm">{c.role || c.worker.role}</Td>
                        <Td className="text-sm font-medium">AED {c.dailyRate?.toLocaleString() ?? '—'}</Td>
                        <Td className="text-right">
                          <button
                            onClick={() => handleRemoveCrew(i)}
                            className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-500/10 transition-colors"
                            title="Remove crew member"
                          >
                            <Trash2 size={16} />
                          </button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Trucks */}
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><TruckIcon size={15} />Trucks</span>}
            subtitle={`${truckList.length} truck${truckList.length !== 1 ? 's' : ''}`}
            action={<Button size="sm" variant="outline" onClick={() => setTruckModal(true)}><Plus size={14} className="mr-1" /> Add</Button>}
          />
          <CardBody>
            {truckList.length === 0 ? (
              <EmptyState message="No trucks assigned to this job yet" />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr className="border-b-2 border-muted">
                      <Th>Truck</Th>
                      <Th>Plate</Th>
                      <Th>Notes</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {truckList.map((t, i) => (
                      <tr key={i} className="hover:bg-muted/50 transition-colors">
                        <Td className="font-medium">{t.truck.name}</Td>
                        <Td className="font-mono text-sm">{t.truck.plateNumber || '—'}</Td>
                        <Td className="text-sm text-muted-foreground">{t.notes || '—'}</Td>
                        <Td className="text-right">
                          <button
                            onClick={() => handleRemoveTruck(i)}
                            className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-500/10 transition-colors"
                            title="Remove truck"
                          >
                            <Trash2 size={16} />
                          </button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Costs Section */}
      <Card>
        <CardHeader title="Cost Breakdown" action={<Button size="sm" variant="outline" onClick={() => setCostsModal(true)}>Edit Costs</Button>} />
        <CardBody>
          <div className="grid grid-cols-6 gap-4">
            {(['labor', 'truck', 'materials', 'packing', 'extras'] as const).map(k => (
              <div key={k} className="space-y-2 p-4 rounded-lg bg-muted/50">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{k}</p>
                <p className="text-lg font-bold text-foreground">AED {(job.costs?.[k] ?? 0).toLocaleString()}</p>
              </div>
            ))}
            <div className="space-y-2 p-4 rounded-lg bg-primary/10 border border-primary/20 col-span-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Cost</p>
              <p className="text-lg font-bold text-primary">AED {(job.costs?.total ?? 0).toLocaleString()}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Timeline & Notes */}
      <Card>
        <CardHeader title="Timeline & Notes" subtitle={`${(job.timeline?.length ?? 0)} note${(job.timeline?.length ?? 0) !== 1 ? 's' : ''}`} />
        <CardBody className="space-y-4">
          <div className="flex gap-3">
            <Textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={3}
              placeholder="Add a note or update about this job…"
              className="flex-1"
            />
            <Button
              onClick={() => addNoteMut.mutate()}
              disabled={!noteText.trim() || addNoteMut.isPending}
              size="sm"
              className="self-end"
            >
              {addNoteMut.isPending ? 'Saving…' : 'Add'}
            </Button>
          </div>

          {(job.timeline?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No notes yet. Add one to start documenting this job.</p>
          ) : (
            <div className="space-y-4 pt-4 border-t">
              {[...(job.timeline ?? [])].reverse().map((n, ri) => {
                const idx = (job.timeline?.length ?? 0) - 1 - ri
                return (
                  <div key={idx} className="flex gap-3 pb-4 border-b last:border-0">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <p className="text-xs font-semibold text-muted-foreground">
                          {new Date(n.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <p className="text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground font-medium">{n.author}</p>
                      </div>
                      <p className="text-sm text-foreground">{n.text}</p>
                    </div>
                    <button
                      onClick={() => deleteNoteMut.mutate(idx)}
                      className="text-muted-foreground hover:text-red-500 p-1 rounded hover:bg-red-500/10 transition-colors shrink-0"
                      title="Delete note"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Add Crew Modal */}
      <Modal open={crewModal} title="Add Crew Member" onClose={() => setCrewModal(false)}>
        <form onSubmit={handleAddCrew} className="space-y-4">
          <Field label="Worker">
            <Select name="worker" required>
              <option value="">Select a worker…</option>
              {availableWorkers.map(w => (
                <option key={w._id} value={w._id}>{w.name} ({w.role})</option>
              ))}
            </Select>
          </Field>
          <Field label="Role (optional)"><Input name="role" placeholder="Leave blank to use worker's default role" /></Field>
          <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" step="0.01" defaultValue={0} /></Field>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setCrewModal(false)}>Cancel</Button>
            <Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending ? 'Adding…' : 'Add Member'}</Button>
          </div>
        </form>
      </Modal>

      {/* Add Truck Modal */}
      <Modal open={truckModal} title="Assign Truck" onClose={() => setTruckModal(false)}>
        <form onSubmit={handleAddTruck} className="space-y-4">
          <Field label="Truck">
            <Select name="truck" required>
              <option value="">Select a truck…</option>
              {availableTrucks.map(t => (
                <option key={t._id} value={t._id}>{t.name} {t.plateNumber ? `(${t.plateNumber})` : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="Notes"><Input name="notes" placeholder="Optional notes about this truck assignment" /></Field>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setTruckModal(false)}>Cancel</Button>
            <Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending ? 'Assigning…' : 'Assign Truck'}</Button>
          </div>
        </form>
      </Modal>

      {/* Costs Modal */}
      <Modal open={costsModal} title="Update Job Costs" onClose={() => setCostsModal(false)}>
        <form onSubmit={handleUpdateCosts} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {(['labor', 'truck', 'materials', 'packing', 'extras'] as const).map(k => (
              <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1)}>
                <Input name={k} type="number" min="0" step="0.01" defaultValue={job.costs?.[k] ?? 0} />
              </Field>
            ))}
          </div>
          <div className="p-3 rounded-lg bg-muted">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Total Cost</p>
            <p className="text-lg font-bold text-foreground">
              AED {(
                (Number((document.querySelector('input[name="labor"]') as HTMLInputElement)?.value) || 0) +
                (Number((document.querySelector('input[name="truck"]') as HTMLInputElement)?.value) || 0) +
                (Number((document.querySelector('input[name="materials"]') as HTMLInputElement)?.value) || 0) +
                (Number((document.querySelector('input[name="packing"]') as HTMLInputElement)?.value) || 0) +
                (Number((document.querySelector('input[name="extras"]') as HTMLInputElement)?.value) || 0)
              ).toLocaleString()}
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setCostsModal(false)}>Cancel</Button>
            <Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending ? 'Saving…' : 'Save Costs'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

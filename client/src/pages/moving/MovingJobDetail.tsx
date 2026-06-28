import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, FileText, MapPin, Users, Truck as TruckIcon, AlertCircle, ClipboardList, Package, Star, Wrench, Camera, X, Upload, Tag, CheckCircle2, Pencil } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob, MovingJobStatus, Worker, Truck, MovingJobImage } from '../../lib/types'

type MovingItemOption = { _id: string; name: string; sku?: string; onHand: number; retailPrice: number }
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Table, Td, Th, Textarea, InfoGrid, InfoItem } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { cn } from '../../lib/utils'

// ── Package types ─────────────────────────────────────────────────────────────
const PACKAGES: Array<{ value: string; label: string; group: string }> = [
  { value: 'studio',    label: 'Studio',           group: 'Apartment' },
  { value: '1_bhk',    label: '1 BHK',             group: 'Apartment' },
  { value: '2_bhk',    label: '2 BHK',             group: 'Apartment' },
  { value: '3_bhk',    label: '3 BHK',             group: 'Apartment' },
  { value: '4_bhk',    label: '4 BHK',             group: 'Apartment' },
  { value: '5_bhk',    label: '5 BHK',             group: 'Apartment' },
  { value: 'villa_1r', label: 'Villa — 1 Room',    group: 'Villa' },
  { value: 'villa_2r', label: 'Villa — 2 Rooms',   group: 'Villa' },
  { value: 'villa_3r', label: 'Villa — 3 Rooms',   group: 'Villa' },
  { value: 'villa_4r', label: 'Villa — 4 Rooms',   group: 'Villa' },
  { value: 'villa_5r', label: 'Villa — 5 Rooms',   group: 'Villa' },
  { value: 'villa_full', label: 'Villa — Full',    group: 'Villa' },
  { value: 'office_sm', label: 'Office — Small',   group: 'Office' },
  { value: 'office_md', label: 'Office — Medium',  group: 'Office' },
  { value: 'office_lg', label: 'Office — Large',   group: 'Office' },
  { value: 'storage',   label: 'Storage to Home',  group: 'Other' },
  { value: 'international', label: 'International Move', group: 'Other' },
  { value: 'custom',    label: 'Custom',            group: 'Other' },
]

type PackageAddon = { description: string; amount: number }
type PackageData = { packageType: string; label: string; agreedPrice: number; additionalCharges: PackageAddon[]; notes: string }

function PackageModal({ open, initial, busy, err, onSave, onClose }: {
  open: boolean
  initial?: { packageType?: string; label?: string; agreedPrice?: number; additionalCharges?: PackageAddon[]; notes?: string }
  busy: boolean
  err: string
  onSave: (pkg: PackageData) => void
  onClose: () => void
}) {
  const [pkgType, setPkgType] = useState(initial?.packageType ?? '')
  const [price, setPrice] = useState(String(initial?.agreedPrice ?? ''))
  const [addons, setAddons] = useState<PackageAddon[]>(initial?.additionalCharges ?? [])
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const stableKey = open ? 'open' : 'closed'

  function handleSave() {
    const pkg = PACKAGES.find(p => p.value === pkgType)
    onSave({
      packageType: pkgType,
      label: pkg?.label ?? pkgType,
      agreedPrice: Number(price) || 0,
      additionalCharges: addons.filter(a => a.description && a.amount > 0),
      notes,
    })
  }

  const clientTotal = (Number(price) || 0) + addons.reduce((s, a) => s + (a.amount || 0), 0)

  // group options
  const groups = [...new Set(PACKAGES.map(p => p.group))]

  return (
    <Modal open={open} title="Set Client Package & Price" onClose={onClose} className="max-w-2xl w-[90vw]">
      <div key={stableKey} className="space-y-5">
        <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-800">
          This is what you charge the client — separate from your internal crew/truck costs. The invoice will use this price.
        </div>

        {/* Package selector */}
        <Field label="Package Type">
          <Select value={pkgType} onChange={e => {
            const p = PACKAGES.find(x => x.value === e.target.value)
            setPkgType(e.target.value)
            if (p && !price) setPrice('0')
          }}>
            <option value="">— Select package —</option>
            {groups.map(grp => (
              <optgroup key={grp} label={grp}>
                {PACKAGES.filter(p => p.group === grp).map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>

        {/* Quick-pick grid for common packages */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Quick select</p>
          <div className="flex flex-wrap gap-1.5">
            {PACKAGES.slice(0, 12).map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPkgType(p.value)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                  pkgType === p.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-muted hover:border-muted-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Agreed price */}
        <Field label="Agreed Price (AED) — what the client pays">
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={price}
            onChange={e => setPrice(e.target.value)}
          />
        </Field>

        {/* Additional charges / add-ons */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium">Additional Charges (add-ons)</p>
            <button
              type="button"
              onClick={() => setAddons(prev => [...prev, { description: '', amount: 0 }])}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <Plus size={12} /> Add line
            </button>
          </div>
          {addons.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No add-ons yet. Common examples: packing service, piano move, extra floor carry, storage.</p>
          ) : (
            <div className="space-y-2">
              {addons.map((a, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    placeholder="e.g. Piano move, extra floor, storage"
                    value={a.description}
                    onChange={e => { const next = [...addons]; next[i] = { ...next[i], description: e.target.value }; setAddons(next) }}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="AED"
                    value={a.amount || ''}
                    onChange={e => { const next = [...addons]; next[i] = { ...next[i], amount: Number(e.target.value) }; setAddons(next) }}
                    className="w-28"
                  />
                  <button
                    type="button"
                    onClick={() => setAddons(addons.filter((_, idx) => idx !== i))}
                    className="p-1.5 rounded text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <Field label="Notes (internal)">
          <Textarea rows={2} placeholder="Any special conditions agreed with client…" value={notes} onChange={e => setNotes(e.target.value)} />
        </Field>

        {/* Total preview */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-primary/10 border border-primary/20">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Client Invoice Total</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {PACKAGES.find(p => p.value === pkgType)?.label ?? 'Package'} + {addons.filter(a => a.amount > 0).length} add-on{addons.filter(a => a.amount > 0).length !== 1 ? 's' : ''}
            </p>
          </div>
          <p className="text-2xl font-bold text-primary">AED {clientTotal.toLocaleString()}</p>
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || !pkgType || !Number(price)}>
            {busy ? 'Saving…' : 'Save Package'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

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
  const [packageModal, setPackageModal] = useState(false)
  const [crewModal, setCrewModal] = useState(false)
  const [truckModal, setTruckModal] = useState(false)
  const [costsModal, setCostsModal] = useState(false)
  const [materialModal, setMaterialModal] = useState(false)
  const [hireModal, setHireModal] = useState(false)
  const [extrasModal, setExtrasModal] = useState(false)
  const [err, setErr] = useState('')
  const [lightboxImg, setLightboxImg] = useState<MovingJobImage | null>(null)
  const [uploadingImages, setUploadingImages] = useState(false)

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

  const { data: movingItems = [] } = useQuery<MovingItemOption[]>({
    queryKey: ['moving-items'],
    queryFn: () => api.get('/moving-inventory/items').then(r => r.data),
    enabled: materialModal,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['moving-job', id] })

  const addMaterialMut = useMutation({
    mutationFn: (body: { itemId: string; qty: number; notes?: string }) =>
      api.post(`/moving-jobs/${id}/materials`, body).then(r => r.data),
    onSuccess: () => { invalidate(); setMaterialModal(false) },
    onError: (e) => setErr(apiError(e)),
  })

  const removeMaterialMut = useMutation({
    mutationFn: (idx: number) => api.delete(`/moving-jobs/${id}/materials/${idx}`),
    onSuccess: invalidate,
    onError: (e) => setErr(apiError(e)),
  })

  const addHireMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post(`/moving-jobs/${id}/external-hires`, body).then(r => r.data),
    onSuccess: () => { invalidate(); setHireModal(false) },
    onError: (e) => setErr(apiError(e)),
  })

  const removeHireMut = useMutation({
    mutationFn: (idx: number) => api.delete(`/moving-jobs/${id}/external-hires/${idx}`),
    onSuccess: invalidate,
    onError: (e) => setErr(apiError(e)),
  })

  const addExtraMut = useMutation({
    mutationFn: (body: { description: string; amount: number; notes?: string }) =>
      api.post(`/moving-jobs/${id}/extras`, body).then(r => r.data),
    onSuccess: () => { invalidate(); setExtrasModal(false) },
    onError: (e) => setErr(apiError(e)),
  })

  const removeExtraMut = useMutation({
    mutationFn: (idx: number) => api.delete(`/moving-jobs/${id}/extras/${idx}`),
    onSuccess: invalidate,
    onError: (e) => setErr(apiError(e)),
  })

  const setSupervisorMut = useMutation({
    mutationFn: (workerIdx: number) => api.patch(`/moving-jobs/${id}/supervisor`, { workerIdx }),
    onSuccess: invalidate,
    onError: (e) => setErr(apiError(e)),
  })

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
    mutationFn: () => {
      const pkg = job?.clientPackage
      const lineItems: Array<{ description: string; qty: number; rate: number; amount: number }> = []

      if (pkg?.agreedPrice && pkg.agreedPrice > 0) {
        // Client-facing: use the package price we offered the client
        lineItems.push({
          description: `Moving Service${pkg.label ? ` — ${pkg.label}` : ''}`,
          qty: 1,
          rate: pkg.agreedPrice,
          amount: pkg.agreedPrice,
        })
        ;(pkg.additionalCharges ?? []).forEach(ac => {
          if (ac.amount > 0) lineItems.push({ description: ac.description, qty: 1, rate: ac.amount, amount: ac.amount })
        })
      } else {
        // Fallback: use internal cost breakdown
        if (job?.costs?.labor) lineItems.push({ description: 'Labor & Crew', qty: 1, rate: job.costs.labor, amount: job.costs.labor })
        if (job?.costs?.truck) lineItems.push({ description: 'Truck / Transportation', qty: 1, rate: job.costs.truck, amount: job.costs.truck })
        if (job?.costs?.materials) lineItems.push({ description: 'Packing Materials', qty: 1, rate: job.costs.materials, amount: job.costs.materials })
        if (job?.costs?.packing) lineItems.push({ description: 'Packing Service', qty: 1, rate: job.costs.packing, amount: job.costs.packing })
        if (job?.costs?.externalHires) lineItems.push({ description: 'External Hires', qty: 1, rate: job.costs.externalHires, amount: job.costs.externalHires })
        ;(job?.extraCharges ?? []).forEach(ex => {
          lineItems.push({ description: ex.description, qty: 1, rate: ex.amount, amount: ex.amount })
        })
      }

      const total = lineItems.reduce((s, i) => s + i.amount, 0)
      return api.post('/moving-invoices', {
        job: id,
        customer: job?.customer?._id,
        status: 'draft',
        items: lineItems,
        total,
        balanceDue: total,
        notes: `Invoice for job ${job?.jobNo}`,
      }).then(r => r.data)
    },
    onSuccess: (invoice) => navigate(`/moving/invoices/${invoice._id}`),
    onError: (e) => setErr(apiError(e)),
  })

  const deleteImageMut = useMutation({
    mutationFn: (idx: number) => api.delete(`/moving-jobs/${id}/images/${idx}`),
    onSuccess: invalidate,
    onError: (e) => setErr(apiError(e)),
  })

  const savePackageMut = useMutation({
    mutationFn: (pkg: Record<string, unknown>) => api.put(`/moving-jobs/${id}`, { clientPackage: pkg }).then(r => r.data),
    onSuccess: () => { invalidate(); setPackageModal(false) },
    onError: (e) => setErr(apiError(e)),
  })

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploadingImages(true)
    try {
      const form = new FormData()
      Array.from(files).forEach(f => form.append('images', f))
      await api.post(`/moving-jobs/${id}/images`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      invalidate()
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setUploadingImages(false)
      // Reset input so same files can be re-added
      e.target.value = ''
    }
  }

  if (isLoading) return <div className="p-12"><Spinner /></div>
  if (!job) return <div className="p-8"><div className="flex items-center gap-2 text-muted-foreground"><AlertCircle size={20} /> Job not found</div></div>

  const transitions = STATUS_TRANSITIONS[job.status] ?? []
  const crewList = (job.crew ?? []) as Array<{ worker: { _id: string; name: string; role: string }; role?: string; dailyRate?: number; days?: number; extraHours?: number; extraHourRate?: number; isSupervisor?: boolean }>
  const materialList = (job.materialUsage ?? []) as Array<{ item: { _id: string; name: string; sku?: string } | string; qty: number; unitCost: number; notes?: string }>
  const hireList = (job.externalHires ?? []) as Array<{ title: string; name?: string; duration: string; hours: number; rate: number; cost: number; notes?: string }>
  const truckList = (job.trucks ?? []) as Array<{ truck: { _id: string; name: string; plateNumber?: string; dailyRate?: number }; dailyRate?: number; days?: number; notes?: string }>
  const extrasList = (job.extraCharges ?? []) as Array<{ description: string; amount: number; notes?: string }>
  const imageList = (job.images ?? []) as MovingJobImage[]

  function handleAddCrew(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const workerId = String(f.get('worker'))
    const existing = crewList.map(c => ({ worker: c.worker._id, role: c.role, dailyRate: c.dailyRate, days: c.days ?? 1, extraHours: c.extraHours, extraHourRate: c.extraHourRate, isSupervisor: c.isSupervisor }))
    updateMut.mutate({ crew: [...existing, { worker: workerId, role: f.get('role'), dailyRate: Number(f.get('dailyRate') || 0), days: Number(f.get('days') || 1), extraHours: Number(f.get('extraHours') || 0), extraHourRate: Number(f.get('extraHourRate') || 0) }] })
  }

  function handleRemoveCrew(idx: number) {
    const updated = crewList.filter((_, i) => i !== idx).map(c => ({ worker: c.worker._id, role: c.role, dailyRate: c.dailyRate, days: c.days ?? 1, extraHours: c.extraHours, extraHourRate: c.extraHourRate, isSupervisor: c.isSupervisor }))
    updateMut.mutate({ crew: updated })
  }

  function handleAddTruck(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const truckId = String(f.get('truck'))
    const selectedTruck = trucks.find(t => t._id === truckId)
    const existing = truckList.map(t => ({ truck: t.truck._id, dailyRate: t.dailyRate, days: t.days ?? 1, notes: t.notes }))
    updateMut.mutate({ trucks: [...existing, { truck: truckId, dailyRate: Number(f.get('dailyRate') || selectedTruck?.dailyRate || 0), days: Number(f.get('days') || 1), notes: f.get('notes') }] })
  }

  function handleRemoveTruck(idx: number) {
    const updated = truckList.filter((_, i) => i !== idx).map(t => ({ truck: t.truck._id, dailyRate: t.dailyRate, days: t.days ?? 1, notes: t.notes }))
    updateMut.mutate({ trucks: updated })
  }

  function handleUpdateCosts(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const packing = Number(f.get('packing') || 0)
    updateMut.mutate({ costs: { ...job.costs, packing, total: (job.costs?.labor || 0) + (job.costs?.truck || 0) + (job.costs?.materials || 0) + packing + (job.costs?.extras || 0) + (job.costs?.externalHires || 0) } })
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

      {/* Client Offer / Package */}
      {(() => {
        const pkg = job.clientPackage
        const hasPackage = pkg?.agreedPrice && pkg.agreedPrice > 0
        const totalAddons = (pkg?.additionalCharges ?? []).reduce((s, a) => s + (a.amount || 0), 0)
        const clientTotal = (pkg?.agreedPrice ?? 0) + totalAddons

        return (
          <Card className={hasPackage ? 'border-emerald-500/30 bg-emerald-500/5' : ''}>
            <CardHeader
              title={<span className="flex items-center gap-2"><Tag size={15} />Client Offer / Package</span>}
              subtitle={hasPackage ? `${pkg!.label} — AED ${clientTotal.toLocaleString()} offered to client` : 'No package set — invoice will use internal cost breakdown'}
              action={
                <Button size="sm" variant="outline" onClick={() => setPackageModal(true)}>
                  <Pencil size={13} className="mr-1" />{hasPackage ? 'Edit' : 'Set Package'}
                </Button>
              }
            />
            <CardBody>
              {!hasPackage ? (
                <div className="flex items-center gap-3 py-4">
                  <div className="p-2 rounded-lg bg-amber-500/10"><Tag size={18} className="text-amber-600" /></div>
                  <div>
                    <p className="text-sm font-medium">Set what you're charging the client</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Choose a package (1 BHK, 2 BHK, Studio, Villa…) and enter the agreed price. The invoice will use this — not your internal crew/truck costs.</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-emerald-500/10">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Package</p>
                    <p className="text-lg font-bold text-emerald-700">{pkg!.label}</p>
                  </div>
                  <div className="p-4 rounded-xl bg-card border">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Base Price</p>
                    <p className="text-lg font-bold">AED {(pkg!.agreedPrice ?? 0).toLocaleString()}</p>
                  </div>
                  {totalAddons > 0 && (
                    <div className="p-4 rounded-xl bg-card border">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Add-ons</p>
                      <p className="text-lg font-bold">AED {totalAddons.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">{(pkg!.additionalCharges ?? []).length} item{(pkg!.additionalCharges ?? []).length !== 1 ? 's' : ''}</p>
                    </div>
                  )}
                  <div className="p-4 rounded-xl bg-primary/10 border border-primary/20">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Client Total</p>
                    <p className="text-lg font-bold text-primary">AED {clientTotal.toLocaleString()}</p>
                  </div>
                  {pkg!.notes && (
                    <div className="col-span-full text-xs text-muted-foreground italic border-t pt-2">{pkg!.notes}</div>
                  )}
                  {(pkg!.additionalCharges ?? []).length > 0 && (
                    <div className="col-span-full border-t pt-2 space-y-1">
                      {(pkg!.additionalCharges ?? []).map((ac, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">{ac.description}</span>
                          <span className="font-medium">AED {ac.amount.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!job.invoice && (
                    <div className="col-span-full flex items-center gap-2 text-xs text-emerald-700 bg-emerald-500/10 rounded-lg px-3 py-2">
                      <CheckCircle2 size={13} />
                      Creating the invoice will use this package price (AED {clientTotal.toLocaleString()})
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        )
      })()}

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
                      <Th>Days</Th>
                      <Th>Extra Hours</Th>
                      <Th className="text-right">Total</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {crewList.map((c, i) => (
                      <tr key={i} className="hover:bg-muted/50 transition-colors">
                        <Td className="font-medium">
                          <div className="flex items-center gap-1.5">
                            {c.isSupervisor && <Star size={13} className="text-amber-500 fill-amber-500" />}
                            {c.worker.name}
                          </div>
                        </Td>
                        <Td className="capitalize text-sm">{c.role || c.worker.role}</Td>
                        <Td className="text-sm font-medium">AED {c.dailyRate?.toLocaleString() ?? '—'}</Td>
                        <Td className="text-sm">{c.days ?? 1}</Td>
                        <Td className="text-sm">
                          {(c.extraHours ?? 0) > 0 ? (
                            <span className="text-amber-600">{c.extraHours}h × AED {c.extraHourRate}</span>
                          ) : '—'}
                        </Td>
                        <Td className="text-right text-sm font-bold">AED {(((c.dailyRate || 0) * (c.days || 1)) + ((c.extraHours || 0) * (c.extraHourRate || 0))).toLocaleString()}</Td>
                        <Td className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {!c.isSupervisor && (
                              <button
                                onClick={() => setSupervisorMut.mutate(i)}
                                className="text-muted-foreground hover:text-amber-500 p-1 rounded hover:bg-amber-500/10 transition-colors"
                                title="Set as supervisor"
                              >
                                <Star size={14} />
                              </button>
                            )}
                            <button
                              onClick={() => handleRemoveCrew(i)}
                              className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-500/10 transition-colors"
                              title="Remove crew member"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
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
                      <Th>Daily Rate</Th>
                      <Th>Days</Th>
                      <Th className="text-right">Cost</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {truckList.map((t, i) => (
                      <tr key={i} className="hover:bg-muted/50 transition-colors">
                        <Td className="font-medium">{t.truck.name}</Td>
                        <Td className="font-mono text-sm">{t.truck.plateNumber || '—'}</Td>
                        <Td className="text-sm">AED {(t.dailyRate ?? 0).toLocaleString()}</Td>
                        <Td className="text-sm">{t.days ?? 1}</Td>
                        <Td className="text-right text-sm font-bold">AED {((t.dailyRate || 0) * (t.days || 1)).toLocaleString()}</Td>
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

      {/* Materials Used */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Package size={15} />Materials Used</span>}
          subtitle={`${materialList.length} item${materialList.length !== 1 ? 's' : ''} · AED ${materialList.reduce((s, m) => s + m.qty * m.unitCost, 0).toLocaleString()}`}
          action={<Button size="sm" variant="outline" onClick={() => setMaterialModal(true)}><Plus size={14} className="mr-1" /> Add</Button>}
        />
        <CardBody>
          {materialList.length === 0 ? (
            <EmptyState message="No materials assigned to this job yet" />
          ) : (
            <Table>
              <thead>
                <tr className="border-b-2 border-muted">
                  <Th>Item</Th>
                  <Th>Qty</Th>
                  <Th>Unit Cost</Th>
                  <Th>Total</Th>
                  <Th>Notes</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {materialList.map((m, i) => {
                  const name = typeof m.item === 'string' ? m.item : m.item.name
                  return (
                    <tr key={i} className="hover:bg-muted/50 transition-colors">
                      <Td className="font-medium">{name}</Td>
                      <Td>{m.qty}</Td>
                      <Td>AED {m.unitCost.toLocaleString()}</Td>
                      <Td className="font-semibold">AED {(m.qty * m.unitCost).toLocaleString()}</Td>
                      <Td className="text-xs text-muted-foreground">{m.notes || '—'}</Td>
                      <Td className="text-right">
                        <button onClick={() => removeMaterialMut.mutate(i)}
                          className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-500/10 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* External Hires */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Wrench size={15} />External Hires</span>}
          subtitle={`${hireList.length} hire${hireList.length !== 1 ? 's' : ''} · AED ${hireList.reduce((s, h) => s + (h.cost || 0), 0).toLocaleString()}`}
          action={<Button size="sm" variant="outline" onClick={() => setHireModal(true)}><Plus size={14} className="mr-1" /> Add</Button>}
        />
        <CardBody>
          {hireList.length === 0 ? (
            <EmptyState message="No external hires for this job" />
          ) : (
            <Table>
              <thead>
                <tr className="border-b-2 border-muted">
                  <Th>Title</Th>
                  <Th>Name</Th>
                  <Th>Duration</Th>
                  <Th>Rate/hr</Th>
                  <Th>Cost</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {hireList.map((h, i) => (
                  <tr key={i} className="hover:bg-muted/50 transition-colors">
                    <Td className="font-medium">{h.title}</Td>
                    <Td>{h.name || '—'}</Td>
                    <Td>
                      <Badge tone="gray">{h.duration.replace(/_/g, ' ')} ({h.hours}h)</Badge>
                    </Td>
                    <Td>AED {h.rate.toLocaleString()}</Td>
                    <Td className="font-semibold">AED {h.cost.toLocaleString()}</Td>
                    <Td className="text-right">
                      <button onClick={() => removeHireMut.mutate(i)}
                        className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-500/10 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Extra Charges */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Package size={15} />Extra Charges</span>}
          subtitle={`${extrasList.length} item${extrasList.length !== 1 ? 's' : ''} · AED ${extrasList.reduce((s, e) => s + (e.amount || 0), 0).toLocaleString()}`}
          action={<Button size="sm" variant="outline" onClick={() => setExtrasModal(true)}><Plus size={14} className="mr-1" /> Add</Button>}
        />
        <CardBody>
          {extrasList.length === 0 ? (
            <EmptyState message="No extra charges added" />
          ) : (
            <Table>
              <thead>
                <tr className="border-b-2 border-muted">
                  <Th>Description</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Notes</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {extrasList.map((ex, i) => (
                  <tr key={i} className="hover:bg-muted/50 transition-colors">
                    <Td className="font-medium">{ex.description}</Td>
                    <Td className="text-right font-bold">AED {ex.amount.toLocaleString()}</Td>
                    <Td className="text-sm text-muted-foreground">{ex.notes || '—'}</Td>
                    <Td className="text-right">
                      <button
                        onClick={() => removeExtraMut.mutate(i)}
                        className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-500/10 transition-colors"
                        title="Remove extra charge"
                      >
                        <Trash2 size={14} />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Costs Section */}
      <Card>
        <CardHeader title="Cost Breakdown" action={<Button size="sm" variant="outline" onClick={() => setCostsModal(true)}>Edit Costs</Button>} />
        <CardBody>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-4">
            {(['labor', 'truck', 'materials', 'packing', 'extras', 'externalHires'] as const).map(k => (
              <div key={k} className="space-y-2 p-4 rounded-lg bg-muted/50">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{k === 'externalHires' ? 'Ext. Hires' : k}</p>
                <p className="text-lg font-bold text-foreground">AED {(job.costs?.[k] ?? 0).toLocaleString()}</p>
              </div>
            ))}
            <div className="space-y-2 p-4 rounded-lg bg-primary/10 border border-primary/20">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Cost</p>
              <p className="text-lg font-bold text-primary">AED {(job.costs?.total ?? 0).toLocaleString()}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Profitability */}
      {job.invoice && (
        <Card>
          <CardHeader title="Job Profitability" />
          <CardBody>
            {(() => {
              const revenue = (job.invoice as any)?.total ?? 0
              const cost = job.costs?.total ?? 0
              const profit = revenue - cost
              const margin = revenue > 0 ? Math.round(((profit / revenue) * 100) * 10) / 10 : 0
              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Revenue</p>
                    <p className="text-lg font-bold text-blue-600">AED {revenue.toLocaleString()}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Total Cost</p>
                    <p className="text-lg font-bold text-amber-600">AED {cost.toLocaleString()}</p>
                  </div>
                  <div className={`p-4 rounded-lg ${profit >= 0 ? 'bg-green-50 dark:bg-green-950/30' : 'bg-red-50 dark:bg-red-950/30'}`}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Profit</p>
                    <p className={`text-lg font-bold ${profit >= 0 ? 'text-green-600' : 'text-destructive'}`}>AED {profit.toLocaleString()}</p>
                  </div>
                  <div className={`p-4 rounded-lg ${margin >= 20 ? 'bg-green-50 dark:bg-green-950/30' : 'bg-amber-50 dark:bg-amber-950/30'}`}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Margin</p>
                    <p className={`text-lg font-bold ${margin >= 20 ? 'text-green-600' : 'text-amber-600'}`}>{margin}%</p>
                  </div>
                </div>
              )
            })()}
          </CardBody>
        </Card>
      )}

      {/* Estimation Photos */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Camera size={15} />Estimation Photos</span>}
          subtitle={`${imageList.length} photo${imageList.length !== 1 ? 's' : ''}`}
          action={
            <label className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors',
              'border-border bg-card hover:bg-muted text-foreground',
              uploadingImages && 'opacity-50 pointer-events-none'
            )}>
              <Upload size={13} />
              {uploadingImages ? 'Uploading…' : 'Upload Photos'}
              <input type="file" accept="image/*" multiple className="sr-only" onChange={handleImageUpload} disabled={uploadingImages} />
            </label>
          }
        />
        <CardBody>
          {imageList.length === 0 ? (
            <label className="flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-xl cursor-pointer hover:bg-muted/30 transition-colors">
              <Camera size={28} className="text-muted-foreground mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground">Upload photos of items to be moved for accurate estimation</p>
              <p className="text-xs text-muted-foreground mt-1">Click to select · Supports JPG, PNG, HEIC · Up to 15 MB each</p>
              <input type="file" accept="image/*" multiple className="sr-only" onChange={handleImageUpload} disabled={uploadingImages} />
            </label>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {imageList.map((img, i) => (
                <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border bg-muted">
                  <img
                    src={img.url}
                    alt={img.originalName || `Photo ${i + 1}`}
                    className="w-full h-full object-cover cursor-pointer"
                    onClick={() => setLightboxImg(img)}
                  />
                  <button
                    onClick={() => deleteImageMut.mutate(i)}
                    className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    title="Delete photo"
                  >
                    <X size={11} />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/60 to-transparent">
                    <p className="text-[10px] text-white truncate">{img.originalName || `Photo ${i + 1}`}</p>
                  </div>
                </div>
              ))}
              {/* Add more button */}
              <label className="aspect-square rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors">
                <Plus size={20} className="text-muted-foreground mb-1" />
                <span className="text-xs text-muted-foreground">Add more</span>
                <input type="file" accept="image/*" multiple className="sr-only" onChange={handleImageUpload} disabled={uploadingImages} />
              </label>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Lightbox */}
      {lightboxImg && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
            <X size={20} />
          </button>
          <img
            src={lightboxImg.url}
            alt={lightboxImg.originalName || 'Photo'}
            className="max-w-full max-h-full rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          {lightboxImg.originalName && (
            <p className="absolute bottom-4 text-xs text-white/70">{lightboxImg.originalName}</p>
          )}
        </div>
      )}

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
            <Select name="worker" required onChange={(e) => {
              const w = workers.find(w => w._id === e.target.value)
              if (w) {
                const form = e.target.form!
                ;(form.elements.namedItem('dailyRate') as HTMLInputElement).value = String(w.dailyRate || 0)
                ;(form.elements.namedItem('role') as HTMLInputElement).value = w.role || ''
              }
            }}>
              <option value="">Select a worker…</option>
              {availableWorkers.map(w => (
                <option key={w._id} value={w._id}>{w.name} ({w.role}) — AED {(w.dailyRate || 0).toLocaleString()}/day</option>
              ))}
            </Select>
          </Field>
          <Field label="Role"><Input name="role" placeholder="Auto-filled from worker" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" step="0.01" defaultValue={0} /></Field>
            <Field label="Days"><Input name="days" type="number" min="1" step="1" defaultValue={1} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Extra Hours"><Input name="extraHours" type="number" min="0" step="0.5" defaultValue={0} /></Field>
            <Field label="Extra Hour Rate (AED)"><Input name="extraHourRate" type="number" min="0" step="0.01" defaultValue={0} /></Field>
          </div>
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
            <Select name="truck" required onChange={(e) => {
              const t = trucks.find(t => t._id === e.target.value)
              if (t) {
                const form = e.target.form!
                ;(form.elements.namedItem('dailyRate') as HTMLInputElement).value = String(t.dailyRate || 0)
              }
            }}>
              <option value="">Select a truck…</option>
              {availableTrucks.map(t => (
                <option key={t._id} value={t._id}>{t.name} {t.plateNumber ? `(${t.plateNumber})` : ''} — AED {(t.dailyRate || 0).toLocaleString()}/day</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" step="0.01" defaultValue={0} /></Field>
            <Field label="Days"><Input name="days" type="number" min="1" step="1" defaultValue={1} /></Field>
          </div>
          <Field label="Notes"><Input name="notes" placeholder="Optional notes about this truck assignment" /></Field>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setTruckModal(false)}>Cancel</Button>
            <Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending ? 'Assigning…' : 'Assign Truck'}</Button>
          </div>
        </form>
      </Modal>

      {/* Add Material Modal */}
      <Modal open={materialModal} title="Add Material" onClose={() => setMaterialModal(false)}>
        <form onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          addMaterialMut.mutate({ itemId: String(f.get('item')), qty: Number(f.get('qty') || 1), notes: String(f.get('notes') || '') })
        }} className="space-y-4">
          <Field label="Item">
            <Select name="item" required>
              <option value="">Select an item…</option>
              {movingItems.filter(i => i.onHand > 0).map(i => (
                <option key={i._id} value={i._id}>{i.name} {i.sku ? `(${i.sku})` : ''} — {i.onHand} in stock — AED {(i.retailPrice || 0).toFixed(2)}/unit</option>
              ))}
            </Select>
          </Field>
          <Field label="Quantity"><Input name="qty" type="number" min="1" defaultValue={1} required /></Field>
          <Field label="Notes"><Input name="notes" placeholder="Optional" /></Field>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setMaterialModal(false)}>Cancel</Button>
            <Button type="submit" disabled={addMaterialMut.isPending}>{addMaterialMut.isPending ? 'Adding…' : 'Add Material'}</Button>
          </div>
        </form>
      </Modal>

      {/* Add External Hire Modal */}
      <Modal open={hireModal} title="Add External Hire" onClose={() => setHireModal(false)}>
        <form onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const dur = String(f.get('duration'))
          const defaultHours: Record<string, number> = { quarter_day: 2, half_day: 4, full_day: 8, custom: Number(f.get('hours') || 8) }
          const hours = defaultHours[dur] ?? 8
          addHireMut.mutate({ title: f.get('title'), name: f.get('name'), duration: dur, hours, rate: Number(f.get('rate') || 0), notes: f.get('notes') })
        }} className="space-y-4">
          <Field label="Title / Role">
            <Input name="title" required placeholder="e.g. Electrician, Plumber, Carpenter" />
          </Field>
          <Field label="Person Name (optional)">
            <Input name="name" placeholder="Name of the hired person" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Duration">
              <Select name="duration" required>
                <option value="quarter_day">Quarter Day (2h)</option>
                <option value="half_day">Half Day (4h)</option>
                <option value="full_day">Full Day (8h)</option>
                <option value="custom">Custom Hours</option>
              </Select>
            </Field>
            <Field label="Custom Hours (if custom)">
              <Input name="hours" type="number" min="0.5" step="0.5" placeholder="Hours" />
            </Field>
          </div>
          <Field label="Rate per Hour (AED)">
            <Input name="rate" type="number" min="0" step="0.01" required placeholder="0.00" />
          </Field>
          <Field label="Notes"><Input name="notes" placeholder="Optional" /></Field>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setHireModal(false)}>Cancel</Button>
            <Button type="submit" disabled={addHireMut.isPending}>{addHireMut.isPending ? 'Adding…' : 'Add Hire'}</Button>
          </div>
        </form>
      </Modal>

      {/* Add Extra Charge Modal */}
      <Modal open={extrasModal} title="Add Extra Charge" onClose={() => setExtrasModal(false)}>
        <form onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          addExtraMut.mutate({ description: String(f.get('description')), amount: Number(f.get('amount') || 0), notes: String(f.get('notes') || '') })
        }} className="space-y-4">
          <Field label="Description *">
            <Input name="description" required placeholder="e.g. Dismantling charges, Storage fee, Staircase carry" />
          </Field>
          <Field label="Amount (AED)">
            <Input name="amount" type="number" min="0" step="0.01" required placeholder="0.00" />
          </Field>
          <Field label="Notes"><Input name="notes" placeholder="Optional" /></Field>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setExtrasModal(false)}>Cancel</Button>
            <Button type="submit" disabled={addExtraMut.isPending}>{addExtraMut.isPending ? 'Adding…' : 'Add Charge'}</Button>
          </div>
        </form>
      </Modal>

      {/* Costs Modal */}
      <Modal open={costsModal} title="Update Job Costs" onClose={() => setCostsModal(false)}>
        <form onSubmit={handleUpdateCosts} className="space-y-4">
          <Field label="Packing (AED)">
            <Input name="packing" type="number" min="0" step="0.01" defaultValue={job.costs?.packing ?? 0} />
          </Field>
          <p className="text-xs text-muted-foreground">Labor, truck, materials, extras, and external hire costs are auto-calculated. Only packing cost is manual.</p>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setCostsModal(false)}>Cancel</Button>
            <Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending ? 'Saving…' : 'Save Costs'}</Button>
          </div>
        </form>
      </Modal>

      {/* Client Package Modal */}
      <PackageModal
        open={packageModal}
        initial={job.clientPackage}
        busy={savePackageMut.isPending}
        err={err}
        onSave={(pkg) => savePackageMut.mutate(pkg)}
        onClose={() => { setPackageModal(false); setErr('') }}
      />
    </div>
  )
}

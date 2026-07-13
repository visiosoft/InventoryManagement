import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, FileText, MapPin, Users, Truck as TruckIcon, AlertCircle, ClipboardList, Package, Star, Wrench, Camera, X, Tag, CheckCircle2, Pencil, Image as ImageIcon, Check, Share2, Copy, ExternalLink } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingJob, MovingJobStatus, Worker, Truck, MovingJobImage } from '../../lib/types'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED_COLOR = '#756E80'

type MovingItemOption = { _id: string; name: string; sku?: string; onHand: number; retailPrice: number }
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, Select, Spinner, Table, Td, Th, Textarea, InfoGrid, InfoItem, movingJobStatusLabel } from '../../components/ui'
import { useAuth } from '../../lib/auth'
import { cn } from '../../lib/utils'

// ── Job types ─────────────────────────────────────────────────────────────────
const JOB_TYPES: Array<{ value: string; label: string }> = [
  { value: 'local', label: 'Local (same emirate)' },
  { value: 'inter_emirate', label: 'Inter-Emirate' },
  { value: 'international', label: 'International' },
  { value: 'office', label: 'Office Move' },
  { value: 'storage_to_home', label: 'Storage to Home' },
  { value: 'other', label: 'Other' },
]

// ── Estimation photo categories (room-by-room, like the field completion grid) ──
const PHOTO_CATEGORIES = ['Living Room', 'Bedrooms', 'Kitchen', 'Bathrooms', 'Balcony', 'Storage / Boxes', 'Other'] as const

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
  cancelled: ['draft'],
}

function dt(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function MovingJobDetail() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
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
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null)
  const [editDetailsModal, setEditDetailsModal] = useState(false)
  const [editMaterialModal, setEditMaterialModal] = useState<{ idx: number; item: string; qty: number; notes: string } | null>(null)
  const [editCrewModal, setEditCrewModal] = useState<{ idx: number; name: string; role: string; dailyRate: number; days: number; extraHours: number; extraHourRate: number } | null>(null)
  const [editTruckModal, setEditTruckModal] = useState<{ idx: number; name: string; dailyRate: number; days: number; notes: string } | null>(null)
  const [editHireModal, setEditHireModal] = useState<{ idx: number; title: string; name: string; duration: string; hours: number; rate: number; notes: string } | null>(null)
  const [editExtraModal, setEditExtraModal] = useState<{ idx: number; description: string; amount: number; notes: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [removeConfirm, setRemoveConfirm] = useState<{ type: 'crew' | 'truck' | 'material' | 'hire' | 'extra'; idx: number; label: string } | null>(null)
  const [crewTab, setCrewTab] = useState<'existing' | 'new'>('existing')
  const [truckTab, setTruckTab] = useState<'existing' | 'new'>('existing')
  const [materialTab, setMaterialTab] = useState<'existing' | 'new'>('existing')
  const [shareModal, setShareModal] = useState(false)
  const [shareLink, setShareLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  const { data: job, isLoading } = useQuery<MovingJob>({
    queryKey: ['moving-job', id],
    queryFn: () => api.get(`/moving-jobs/${id}`).then(r => r.data),
  })

  // Auto-open the Edit Details modal when arriving from the jobs list with ?edit=1
  useEffect(() => {
    if (searchParams.get('edit') === '1') {
      setEditDetailsModal(true)
      searchParams.delete('edit')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

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

  const createMaterialMut = useMutation({
    mutationFn: async (body: { name: string; sku: string; category: string; retailPrice: number; qty: number }) => {
      const item = (await api.post('/moving-inventory/items', { name: body.name, sku: body.sku, category: body.category, retailPrice: body.retailPrice, onHand: body.qty })).data
      return api.post(`/moving-jobs/${id}/materials`, { itemId: item._id, qty: body.qty }).then(r => r.data)
    },
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['moving-items'] }); setMaterialModal(false); setMaterialTab('existing') },
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

  const editHireMut = useMutation({
    mutationFn: ({ idx, ...body }: { idx: number; title: string; name?: string; duration: string; hours: number; rate: number; notes?: string }) =>
      api.put(`/moving-jobs/${id}/external-hires/${idx}`, body).then(r => r.data),
    onSuccess: () => { invalidate(); setEditHireModal(null) },
    onError: (e) => setErr(apiError(e)),
  })

  const editExtraMut = useMutation({
    mutationFn: ({ idx, ...body }: { idx: number; description: string; amount: number; notes?: string }) =>
      api.put(`/moving-jobs/${id}/extras/${idx}`, body).then(r => r.data),
    onSuccess: () => { invalidate(); setEditExtraModal(null) },
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
    onSuccess: () => { invalidate(); setCrewModal(false); setTruckModal(false); setCostsModal(false); setEditDetailsModal(false); setEditCrewModal(null); setEditTruckModal(null); setCrewTab('existing'); setTruckTab('existing') },
    onError: (e) => setErr(apiError(e)),
  })

  const createWorkerMut = useMutation({
    mutationFn: async (body: { name: string; phone?: string; role: string; dailyRate: number }) => {
      const w = (await api.post('/workers', body)).data
      const existing = (job?.crew ?? []).map((c: any) => ({ worker: c.worker._id, role: c.role, dailyRate: c.dailyRate, days: c.days ?? 1, extraHours: c.extraHours, extraHourRate: c.extraHourRate, isSupervisor: c.isSupervisor }))
      return api.put(`/moving-jobs/${id}`, { crew: [...existing, { worker: w._id, role: body.role, dailyRate: body.dailyRate, days: 1 }] }).then(r => r.data)
    },
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['workers'] }); setCrewModal(false); setCrewTab('existing') },
    onError: (e) => setErr(apiError(e)),
  })

  const createTruckMut = useMutation({
    mutationFn: async (body: { name: string; plateNumber?: string; type: string; dailyRate: number }) => {
      const t = (await api.post('/trucks', body)).data
      const existing = (job?.trucks ?? []).map((t: any) => ({ truck: t.truck._id, dailyRate: t.dailyRate, days: t.days ?? 1, notes: t.notes }))
      return api.put(`/moving-jobs/${id}`, { trucks: [...existing, { truck: t._id, dailyRate: body.dailyRate, days: 1 }] }).then(r => r.data)
    },
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ['trucks'] }); setTruckModal(false); setTruckTab('existing') },
    onError: (e) => setErr(apiError(e)),
  })

  const shareUploadMut = useMutation({
    mutationFn: () => api.post(`/moving-jobs/${id}/upload-token`).then(r => r.data),
    onSuccess: (data) => {
      const base = window.location.origin
      setShareLink(`${base}/upload/moving/${data.uploadToken}`)
      setShareModal(true)
      setLinkCopied(false)
    },
    onError: (e) => setErr(apiError(e)),
  })

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/moving-jobs/${id}`).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['moving-jobs'] }); navigate('/moving/jobs') },
    onError: (e) => setErr(apiError(e)),
  })

  const editMaterialMut = useMutation({
    mutationFn: (body: { idx: number; qty: number; notes?: string }) =>
      api.put(`/moving-jobs/${id}/materials/${body.idx}`, { qty: body.qty, notes: body.notes }).then(r => r.data),
    onSuccess: () => { invalidate(); setEditMaterialModal(null) },
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

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>, category = '') {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploadingImages(true)
    setUploadingCategory(category)
    try {
      const form = new FormData()
      Array.from(files).forEach(f => form.append('images', f))
      if (category) form.append('category', category)
      await api.post(`/moving-jobs/${id}/images`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      invalidate()
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setUploadingImages(false)
      setUploadingCategory(null)
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

  function handleEditCrew(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editCrewModal) return
    const f = new FormData(e.currentTarget)
    const updated = crewList.map((c, i) => i === editCrewModal.idx
      ? { worker: c.worker._id, role: String(f.get('role') || c.role), dailyRate: Number(f.get('dailyRate') || 0), days: Number(f.get('days') || 1), extraHours: Number(f.get('extraHours') || 0), extraHourRate: Number(f.get('extraHourRate') || 0), isSupervisor: c.isSupervisor }
      : { worker: c.worker._id, role: c.role, dailyRate: c.dailyRate, days: c.days ?? 1, extraHours: c.extraHours, extraHourRate: c.extraHourRate, isSupervisor: c.isSupervisor })
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

  function handleConfirmedRemove() {
    if (!removeConfirm) return
    const { type, idx } = removeConfirm
    if (type === 'crew') handleRemoveCrew(idx)
    else if (type === 'truck') handleRemoveTruck(idx)
    else if (type === 'material') removeMaterialMut.mutate(idx)
    else if (type === 'hire') removeHireMut.mutate(idx)
    else if (type === 'extra') removeExtraMut.mutate(idx)
    setRemoveConfirm(null)
  }

  function handleEditTruck(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editTruckModal) return
    const f = new FormData(e.currentTarget)
    const updated = truckList.map((t, i) => i === editTruckModal.idx
      ? { truck: t.truck._id, dailyRate: Number(f.get('dailyRate') || 0), days: Number(f.get('days') || 1), notes: String(f.get('notes') || '') }
      : { truck: t.truck._id, dailyRate: t.dailyRate, days: t.days ?? 1, notes: t.notes })
    updateMut.mutate({ trucks: updated })
  }

  function handleUpdateCosts(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const packing = Number(f.get('packing') || 0)
    updateMut.mutate({ costs: { ...job!.costs, packing, total: (job!.costs?.labor || 0) + (job!.costs?.truck || 0) + (job!.costs?.materials || 0) + packing + (job!.costs?.extras || 0) + (job!.costs?.externalHires || 0) } })
  }

  const addedWorkerIds = new Set(crewList.map(c => c.worker._id))
  const availableWorkers = workers.filter(w => !addedWorkerIds.has(w._id))
  const addedTruckIds = new Set(truckList.map(t => t.truck._id))
  const availableTrucks = trucks.filter(t => !addedTruckIds.has(t._id))

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7 space-y-8">
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
              <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>{job.jobNo}</div>
              <Badge tone={statusTone[job.status]} className="text-sm px-3 py-1.5">
                {movingJobStatusLabel(job.status)}
              </Badge>
            </div>
            <p style={{ fontSize: 14, color: MUTED_COLOR }}>
              {job.customer?.fullName} • Job ID: {job._id?.slice(-8)}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 shrink-0">
          {!['invoiced'].includes(job.status) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditDetailsModal(true)}
              title="Edit job details"
            >
              <Pencil size={16} className="mr-1" />
              Edit
            </Button>
          )}
          {!['in_progress', 'invoiced'].includes(job.status) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeleteConfirm(true)}
              title="Delete this job"
              className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 hover:bg-red-50 dark:border-red-800 dark:hover:border-red-700 dark:hover:bg-red-950"
            >
              <Trash2 size={16} className="mr-1" />
              Delete
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/moving/jobs/${id}/survey`)}
            title="View or edit the moving survey"
          >
            <ClipboardList size={16} className="mr-1" />
            Survey
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => shareUploadMut.mutate()}
            disabled={shareUploadMut.isPending}
            title="Share upload link with client"
          >
            <Share2 size={16} className="mr-1" />
            {shareUploadMut.isPending ? 'Generating…' : 'Share'}
          </Button>
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
                    {movingJobStatusLabel(s)}
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
        <CardHeader
          title="Job Details"
          subtitle="Core information about this moving job"
          action={
            !['invoiced'].includes(job.status) ? (
              <Button size="sm" variant="outline" onClick={() => setEditDetailsModal(true)}>
                <Pencil size={13} className="mr-1" />Edit Details
              </Button>
            ) : undefined
          }
        />
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
            <InfoItem
              label="Move-out Permit"
              value={job.moveOutPermitRequired
                ? <Badge tone="amber">Required</Badge>
                : <span className="text-muted-foreground">Not required</span>}
            />
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
                              onClick={() => setEditCrewModal({ idx: i, name: c.worker.name, role: c.role || c.worker.role || '', dailyRate: c.dailyRate ?? 0, days: c.days ?? 1, extraHours: c.extraHours ?? 0, extraHourRate: c.extraHourRate ?? 0 })}
                              className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-primary/10 transition-colors"
                              title="Edit crew member"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => setRemoveConfirm({ type: 'crew', idx: i, label: c.worker.name })}
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
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setEditTruckModal({ idx: i, name: t.truck.name, dailyRate: t.dailyRate ?? 0, days: t.days ?? 1, notes: t.notes || '' })}
                              className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-primary/10 transition-colors"
                              title="Edit truck"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => setRemoveConfirm({ type: 'truck', idx: i, label: t.truck.name })}
                              className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-500/10 transition-colors"
                              title="Remove truck"
                            >
                              <Trash2 size={16} />
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
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setEditMaterialModal({ idx: i, item: name, qty: m.qty, notes: m.notes || '' })}
                            className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-primary/10 transition-colors"
                            title="Edit material">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setRemoveConfirm({ type: 'material', idx: i, label: name })}
                            className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-500/10 transition-colors"
                            title="Remove material">
                            <Trash2 size={14} />
                          </button>
                        </div>
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
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditHireModal({ idx: i, title: h.title, name: h.name || '', duration: h.duration, hours: h.hours, rate: h.rate, notes: h.notes || '' })}
                          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => setRemoveConfirm({ type: 'hire', idx: i, label: h.title })}
                          className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-500/10 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
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
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditExtraModal({ idx: i, description: ex.description, amount: ex.amount, notes: ex.notes || '' })}
                          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors"
                          title="Edit extra charge"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setRemoveConfirm({ type: 'extra', idx: i, label: ex.description })}
                          className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-500/10 transition-colors"
                          title="Remove extra charge"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
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

      {/* Estimation Photos — room-by-room tile grid */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Camera size={15} />Estimation Photos</span>}
          subtitle={`${imageList.length} photo${imageList.length !== 1 ? 's' : ''} · take photos of each area for an accurate estimate`}
        />
        <CardBody>
          {(() => {
            const catOf = (img: MovingJobImage) =>
              img.category && (PHOTO_CATEGORIES as readonly string[]).includes(img.category) ? img.category : 'Other'
            const grouped: Record<string, Array<{ img: MovingJobImage; idx: number }>> = {}
            imageList.forEach((img, idx) => {
              const c = catOf(img)
              ;(grouped[c] ??= []).push({ img, idx })
            })
            const firstEmpty = PHOTO_CATEGORIES.find(c => !(grouped[c]?.length))

            return (
              <div className="space-y-6">
                {/* Category tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {PHOTO_CATEGORIES.map(cat => {
                    const count = grouped[cat]?.length ?? 0
                    const done = count > 0
                    const isUploading = uploadingCategory === cat
                    const isNext = !done && cat === firstEmpty
                    return (
                      <label
                        key={cat}
                        className={cn(
                          'relative aspect-square rounded-2xl border-2 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors text-center px-2',
                          uploadingImages && 'pointer-events-none',
                          done
                            ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30'
                            : isNext
                              ? 'border-violet-400 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30'
                              : 'border-dashed border-border bg-muted/20 hover:bg-muted/40'
                        )}
                      >
                        {done && (
                          <span className="absolute top-2 right-2 h-5 w-5 rounded-full bg-emerald-500 text-white grid place-items-center">
                            <Check size={12} strokeWidth={3} />
                          </span>
                        )}
                        {isUploading ? (
                          <span className="h-7 w-7 rounded-full border-2 border-current border-t-transparent animate-spin text-emerald-600" />
                        ) : done ? (
                          <ImageIcon size={26} className="text-emerald-600" />
                        ) : (
                          <Camera size={26} className={isNext ? 'text-violet-600' : 'text-muted-foreground'} />
                        )}
                        <span className={cn(
                          'text-[13px] font-semibold',
                          done ? 'text-emerald-700 dark:text-emerald-400' : isNext ? 'text-violet-700 dark:text-violet-400' : 'text-muted-foreground'
                        )}>
                          {cat}{done && ` (${count})`}
                        </span>
                        <input type="file" accept="image/*" multiple className="sr-only" disabled={uploadingImages}
                          onChange={e => handleImageUpload(e, cat)} />
                      </label>
                    )
                  })}
                </div>

                {/* Photos grouped by category */}
                {imageList.length > 0 && (
                  <div className="space-y-5 border-t pt-5">
                    {PHOTO_CATEGORIES.filter(c => grouped[c]?.length).map(cat => (
                      <div key={cat}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</span>
                          <span className="text-xs text-muted-foreground">· {grouped[cat].length}</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                          {grouped[cat].map(({ img, idx }) => {
                            const thumbUrl = img.storage === 'drive' && img.driveFileId
                              ? `https://drive.google.com/thumbnail?id=${img.driveFileId}&sz=w400`
                              : img.url
                            return (
                              <div key={idx} className="relative group aspect-square rounded-xl overflow-hidden border bg-muted">
                                <img
                                  src={thumbUrl}
                                  alt={img.originalName || `Photo ${idx + 1}`}
                                  className="w-full h-full object-cover cursor-pointer"
                                  onClick={() => setLightboxImg(img)}
                                  onError={e => {
                                    const t = e.currentTarget
                                    t.style.display = 'none'
                                    t.parentElement!.querySelector('.img-fallback')?.classList.remove('hidden')
                                  }}
                                />
                                <div className="img-fallback hidden absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-1">
                                  <AlertCircle size={20} className="opacity-40" />
                                  <span className="text-[10px]">Image unavailable</span>
                                </div>
                                <button
                                  onClick={() => deleteImageMut.mutate(idx)}
                                  className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                                  title="Delete photo"
                                >
                                  <X size={11} />
                                </button>
                                <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/60 to-transparent">
                                  <p className="text-[10px] text-white truncate">{img.originalName || `Photo ${idx + 1}`}</p>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </CardBody>
      </Card>

      {/* Lightbox */}
      {lightboxImg && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightboxImg(null)}>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors">
            <X size={20} />
          </button>
          <img
            src={lightboxImg.storage === 'drive' && lightboxImg.driveFileId
              ? `https://drive.google.com/thumbnail?id=${lightboxImg.driveFileId}&sz=w1600`
              : lightboxImg.url}
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
      <Modal open={crewModal} title="Add Crew Member" onClose={() => { setCrewModal(false); setCrewTab('existing') }}>
        <div className="flex gap-1 p-1 rounded-lg bg-muted mb-4">
          <button type="button" onClick={() => setCrewTab('existing')} className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${crewTab === 'existing' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Existing Worker</button>
          <button type="button" onClick={() => setCrewTab('new')} className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${crewTab === 'new' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Create New</button>
        </div>
        {crewTab === 'existing' ? (
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
        ) : (
          <form onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            createWorkerMut.mutate({ name: String(f.get('name')), phone: String(f.get('phone') || ''), role: String(f.get('role')), dailyRate: Number(f.get('dailyRate') || 0) })
          }} className="space-y-4">
            <Field label="Name *"><Input name="name" required placeholder="Worker name" /></Field>
            <Field label="Phone"><Input name="phone" placeholder="Phone number" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Role">
                <Select name="role" required>
                  <option value="helper">Helper</option>
                  <option value="driver">Driver</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="packer">Packer</option>
                </Select>
              </Field>
              <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" step="0.01" defaultValue={0} /></Field>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setCrewModal(false)}>Cancel</Button>
              <Button type="submit" disabled={createWorkerMut.isPending}>{createWorkerMut.isPending ? 'Creating…' : 'Create & Add'}</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Add Truck Modal */}
      <Modal open={truckModal} title="Add Truck" onClose={() => { setTruckModal(false); setTruckTab('existing') }}>
        <div className="flex gap-1 p-1 rounded-lg bg-muted mb-4">
          <button type="button" onClick={() => setTruckTab('existing')} className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${truckTab === 'existing' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Existing Truck</button>
          <button type="button" onClick={() => setTruckTab('new')} className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${truckTab === 'new' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Create New</button>
        </div>
        {truckTab === 'existing' ? (
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
        ) : (
          <form onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            createTruckMut.mutate({ name: String(f.get('name')), plateNumber: String(f.get('plateNumber') || ''), type: String(f.get('type')), dailyRate: Number(f.get('dailyRate') || 0) })
          }} className="space-y-4">
            <Field label="Truck Name *"><Input name="name" required placeholder="e.g. Moving Truck 7 Ton" /></Field>
            <Field label="Plate Number"><Input name="plateNumber" placeholder="e.g. ABC-1234" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select name="type" required>
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                  <option value="extra_large">Extra Large</option>
                </Select>
              </Field>
              <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" step="0.01" defaultValue={0} /></Field>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setTruckModal(false)}>Cancel</Button>
              <Button type="submit" disabled={createTruckMut.isPending}>{createTruckMut.isPending ? 'Creating…' : 'Create & Assign'}</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Add Material Modal */}
      <Modal open={materialModal} title="Add Material" onClose={() => { setMaterialModal(false); setMaterialTab('existing') }}>
        <div className="flex gap-1 p-1 rounded-lg bg-muted mb-4">
          <button type="button" onClick={() => setMaterialTab('existing')} className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${materialTab === 'existing' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Existing Item</button>
          <button type="button" onClick={() => setMaterialTab('new')} className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${materialTab === 'new' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>Create New</button>
        </div>
        {materialTab === 'existing' ? (
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
        ) : (
          <form onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            createMaterialMut.mutate({ name: String(f.get('name')), sku: String(f.get('sku')), category: String(f.get('category')), retailPrice: Number(f.get('retailPrice') || 0), qty: Number(f.get('qty') || 1) })
          }} className="space-y-4">
            <Field label="Item Name *"><Input name="name" required placeholder="e.g. Bubble Wrap Roll" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU *"><Input name="sku" required placeholder="e.g. BW-001" /></Field>
              <Field label="Category">
                <Select name="category">
                  <option value="box">Box</option>
                  <option value="wrap">Wrap</option>
                  <option value="tape">Tape</option>
                  <option value="cover">Cover</option>
                  <option value="tool">Tool</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price per Unit (AED)"><Input name="retailPrice" type="number" min="0" step="0.01" defaultValue={0} /></Field>
              <Field label="Quantity"><Input name="qty" type="number" min="1" defaultValue={1} required /></Field>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setMaterialModal(false)}>Cancel</Button>
              <Button type="submit" disabled={createMaterialMut.isPending}>{createMaterialMut.isPending ? 'Creating…' : 'Create & Add'}</Button>
            </div>
          </form>
        )}
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

      {/* Edit External Hire Modal */}
      <Modal open={!!editHireModal} title="Edit External Hire" onClose={() => setEditHireModal(null)}>
        {editHireModal && (
          <form onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const dur = String(f.get('duration'))
            const defaultHours: Record<string, number> = { quarter_day: 2, half_day: 4, full_day: 8, custom: Number(f.get('hours') || 8) }
            const hours = defaultHours[dur] ?? 8
            editHireMut.mutate({ idx: editHireModal.idx, title: String(f.get('title')), name: String(f.get('name') || ''), duration: dur, hours, rate: Number(f.get('rate') || 0), notes: String(f.get('notes') || '') })
          }} className="space-y-4">
            <Field label="Title / Role">
              <Input name="title" required defaultValue={editHireModal.title} />
            </Field>
            <Field label="Person Name (optional)">
              <Input name="name" defaultValue={editHireModal.name} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Duration">
                <Select name="duration" required defaultValue={editHireModal.duration}>
                  <option value="quarter_day">Quarter Day (2h)</option>
                  <option value="half_day">Half Day (4h)</option>
                  <option value="full_day">Full Day (8h)</option>
                  <option value="custom">Custom Hours</option>
                </Select>
              </Field>
              <Field label="Custom Hours (if custom)">
                <Input name="hours" type="number" min="0.5" step="0.5" defaultValue={editHireModal.hours} />
              </Field>
            </div>
            <Field label="Rate per Hour (AED)">
              <Input name="rate" type="number" min="0" step="0.01" required defaultValue={editHireModal.rate} />
            </Field>
            <Field label="Notes"><Input name="notes" defaultValue={editHireModal.notes} /></Field>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setEditHireModal(null)}>Cancel</Button>
              <Button type="submit" disabled={editHireMut.isPending}>{editHireMut.isPending ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Edit Extra Charge Modal */}
      <Modal open={!!editExtraModal} title="Edit Extra Charge" onClose={() => setEditExtraModal(null)}>
        {editExtraModal && (
          <form onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            editExtraMut.mutate({ idx: editExtraModal.idx, description: String(f.get('description')), amount: Number(f.get('amount') || 0), notes: String(f.get('notes') || '') })
          }} className="space-y-4">
            <Field label="Description *">
              <Input name="description" required defaultValue={editExtraModal.description} />
            </Field>
            <Field label="Amount (AED)">
              <Input name="amount" type="number" min="0" step="0.01" required defaultValue={editExtraModal.amount} />
            </Field>
            <Field label="Notes"><Input name="notes" defaultValue={editExtraModal.notes} /></Field>
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setEditExtraModal(null)}>Cancel</Button>
              <Button type="submit" disabled={editExtraMut.isPending}>{editExtraMut.isPending ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        )}
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

      {/* Edit Job Details Modal */}
      <Modal open={editDetailsModal} title="Edit Job Details" onClose={() => setEditDetailsModal(false)} className="max-w-2xl w-[90vw]">
        <form onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          updateMut.mutate({
            jobType: f.get('jobType'),
            scheduledDate: f.get('scheduledDate') || undefined,
            scheduledTimeSlot: f.get('scheduledTimeSlot'),
            estimatedDurationHours: Number(f.get('estimatedDurationHours')) || undefined,
            moveOutPermitRequired: f.get('moveOutPermitRequired') === 'on',
            pickupAddress: f.get('pickupAddress'),
            pickupFloor: f.get('pickupFloor'),
            pickupHasElevator: f.get('pickupHasElevator') === 'on',
            deliveryAddress: f.get('deliveryAddress'),
            deliveryFloor: f.get('deliveryFloor'),
            deliveryHasElevator: f.get('deliveryHasElevator') === 'on',
            notes: f.get('notes'),
          })
        }} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Job Type">
              <Select name="jobType" defaultValue={job.jobType || 'local'}>
                {JOB_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Scheduled Date">
              <Input name="scheduledDate" type="date" defaultValue={job.scheduledDate ? new Date(job.scheduledDate).toISOString().split('T')[0] : ''} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Time Slot">
              <Input name="scheduledTimeSlot" placeholder="e.g. 08:00-12:00" defaultValue={job.scheduledTimeSlot || ''} />
            </Field>
            <Field label="Estimated Duration (hours)">
              <Input name="estimatedDurationHours" type="number" min="0.5" step="0.5" defaultValue={job.estimatedDurationHours || ''} />
            </Field>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" name="moveOutPermitRequired" defaultChecked={!!job.moveOutPermitRequired} className="rounded" />
            <span className="text-sm">Required Move-out Permit</span>
          </label>

          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Pickup Location</p>
            <Field label="Pickup Address">
              <Textarea name="pickupAddress" rows={2} defaultValue={job.pickupAddress || ''} placeholder="Full pickup address" />
            </Field>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <Field label="Floor">
                <Input name="pickupFloor" defaultValue={job.pickupFloor || ''} placeholder="e.g. Ground, 3rd" />
              </Field>
              <Field label="">
                <label className="flex items-center gap-2 mt-6 cursor-pointer">
                  <input type="checkbox" name="pickupHasElevator" defaultChecked={!!job.pickupHasElevator} className="rounded" />
                  <span className="text-sm">Has Elevator</span>
                </label>
              </Field>
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Delivery Location</p>
            <Field label="Delivery Address">
              <Textarea name="deliveryAddress" rows={2} defaultValue={job.deliveryAddress || ''} placeholder="Full delivery address" />
            </Field>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <Field label="Floor">
                <Input name="deliveryFloor" defaultValue={job.deliveryFloor || ''} placeholder="e.g. Ground, 3rd" />
              </Field>
              <Field label="">
                <label className="flex items-center gap-2 mt-6 cursor-pointer">
                  <input type="checkbox" name="deliveryHasElevator" defaultChecked={!!job.deliveryHasElevator} className="rounded" />
                  <span className="text-sm">Has Elevator</span>
                </label>
              </Field>
            </div>
          </div>

          <Field label="Notes">
            <Textarea name="notes" rows={2} defaultValue={job.notes || ''} placeholder="General notes about the job" />
          </Field>

          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => setEditDetailsModal(false)}>Cancel</Button>
            <Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending ? 'Saving…' : 'Save Changes'}</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Crew Modal */}
      <Modal open={!!editCrewModal} title={`Edit Crew — ${editCrewModal?.name ?? ''}`} onClose={() => setEditCrewModal(null)}>
        {editCrewModal && (
          <form onSubmit={handleEditCrew} className="space-y-4">
            <Field label="Role"><Input name="role" defaultValue={editCrewModal.role} placeholder="e.g. Driver, Helper" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" step="0.01" defaultValue={editCrewModal.dailyRate} /></Field>
              <Field label="Days"><Input name="days" type="number" min="1" step="1" defaultValue={editCrewModal.days} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Extra Hours"><Input name="extraHours" type="number" min="0" step="0.5" defaultValue={editCrewModal.extraHours} /></Field>
              <Field label="Extra Hour Rate (AED)"><Input name="extraHourRate" type="number" min="0" step="0.01" defaultValue={editCrewModal.extraHourRate} /></Field>
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setEditCrewModal(null)}>Cancel</Button>
              <Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending ? 'Saving…' : 'Save Changes'}</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Edit Truck Modal */}
      <Modal open={!!editTruckModal} title={`Edit Truck — ${editTruckModal?.name ?? ''}`} onClose={() => setEditTruckModal(null)}>
        {editTruckModal && (
          <form onSubmit={handleEditTruck} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" step="0.01" defaultValue={editTruckModal.dailyRate} /></Field>
              <Field label="Days"><Input name="days" type="number" min="1" step="1" defaultValue={editTruckModal.days} /></Field>
            </div>
            <Field label="Notes"><Input name="notes" defaultValue={editTruckModal.notes} placeholder="Optional notes about this truck assignment" /></Field>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setEditTruckModal(null)}>Cancel</Button>
              <Button type="submit" disabled={updateMut.isPending}>{updateMut.isPending ? 'Saving…' : 'Save Changes'}</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Edit Material Modal */}
      <Modal open={!!editMaterialModal} title={`Edit Material — ${editMaterialModal?.item ?? ''}`} onClose={() => setEditMaterialModal(null)}>
        {editMaterialModal && (
          <form onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            editMaterialMut.mutate({ idx: editMaterialModal.idx, qty: Number(f.get('qty') || 1), notes: String(f.get('notes') || '') })
          }} className="space-y-4">
            <Field label="Quantity">
              <Input name="qty" type="number" min="1" defaultValue={editMaterialModal.qty} required />
            </Field>
            <Field label="Notes">
              <Input name="notes" defaultValue={editMaterialModal.notes} placeholder="Optional" />
            </Field>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => setEditMaterialModal(null)}>Cancel</Button>
              <Button type="submit" disabled={editMaterialMut.isPending}>{editMaterialMut.isPending ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      {/* Share Upload Link Modal */}
      <Modal open={shareModal} title="Share Upload Link" onClose={() => setShareModal(false)}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Share this link with the client so they can upload photos and videos for this job.
          </p>
          <div className="flex items-center gap-2">
            <Input value={shareLink} readOnly className="text-xs font-mono" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => { navigator.clipboard.writeText(shareLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000) }}
              className="shrink-0"
            >
              {linkCopied ? <><Check size={14} className="mr-1" /> Copied</> : <><Copy size={14} className="mr-1" /> Copy</>}
            </Button>
          </div>
          <div className="flex justify-between items-center pt-4 border-t">
            <a href={shareLink} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
              <ExternalLink size={14} /> Preview link
            </a>
            <Button variant="outline" onClick={() => setShareModal(false)}>Close</Button>
          </div>
        </div>
      </Modal>

      {/* Remove Confirmation Modal */}
      <Modal open={!!removeConfirm} title="Confirm Remove" onClose={() => setRemoveConfirm(null)}>
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            Are you sure you want to remove <strong>{removeConfirm?.label}</strong> from this job?
          </p>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setRemoveConfirm(null)}>Cancel</Button>
            <Button onClick={handleConfirmedRemove} className="bg-red-600 hover:bg-red-700 text-white">Remove</Button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteConfirm} title="Delete Job" onClose={() => setDeleteConfirm(false)}>
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            Are you sure you want to delete job <strong>{job.jobNo}</strong>? This action cannot be undone.
          </p>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setDeleteConfirm(false)}>Cancel</Button>
            <Button
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteMut.isPending ? 'Deleting…' : 'Delete Job'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

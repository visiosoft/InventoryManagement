import { useState, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, ChevronRight, ChevronLeft, Check, User, Briefcase, MapPin, FileText, Search, Tag, Trash2, Camera, X, Image as ImageIcon } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { Customer, MovingJobType } from '../../lib/types'
import { Button, Field, Input, Select, Textarea, Modal } from '../../components/ui'
import { cn } from '../../lib/utils'

const JOB_TYPES: { value: MovingJobType; label: string }[] = [
  { value: 'local', label: 'Local (same emirate)' },
  { value: 'inter_emirate', label: 'Inter-Emirate' },
  { value: 'international', label: 'International' },
  { value: 'office', label: 'Office Move' },
  { value: 'storage_to_home', label: 'Storage to Home' },
  { value: 'other', label: 'Other' },
]

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

const PHOTO_CATEGORIES = ['Living Room', 'Bedrooms', 'Kitchen', 'Bathrooms', 'Balcony', 'Storage / Boxes', 'Other'] as const

const STEPS = [
  { key: 'customer', label: 'Customer', icon: User },
  { key: 'details', label: 'Job Details', icon: Briefcase },
  { key: 'address', label: 'Address', icon: MapPin },
  { key: 'package', label: 'Package', icon: Tag },
  { key: 'photos', label: 'Photos', icon: Camera },
  { key: 'notes', label: 'Notes', icon: FileText },
] as const

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const CREAM = '#FDFCFA'
const CHIP_BG = '#F3F0EA'

type Addon = { description: string; amount: number }
type StagedPhoto = { file: File; category: string; preview: string }

export default function NewMovingJob() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const leadId = searchParams.get('lead')
  const dateParam = searchParams.get('date')

  const [step, setStep] = useState(0)
  const [err, setErr] = useState('')
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Step 1 – Customer
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')

  // Step 2 – Job Details
  const [jobType, setJobType] = useState<MovingJobType>('local')
  const [scheduledDate, setScheduledDate] = useState(dateParam || '')
  const [scheduledTimeSlot, setScheduledTimeSlot] = useState('')
  const [estimatedDurationHours, setEstimatedDurationHours] = useState('')
  const [moveOutPermitRequired, setMoveOutPermitRequired] = useState(false)

  // Step 3 – Address
  const [pickupAddress, setPickupAddress] = useState('')
  const [pickupFloor, setPickupFloor] = useState('')
  const [pickupHasElevator, setPickupHasElevator] = useState(false)
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryFloor, setDeliveryFloor] = useState('')
  const [deliveryHasElevator, setDeliveryHasElevator] = useState(false)

  // Step 4 – Package
  const [pkgType, setPkgType] = useState('')
  const [pkgPrice, setPkgPrice] = useState('')
  const [pkgAddons, setPkgAddons] = useState<Addon[]>([])
  const [pkgNotes, setPkgNotes] = useState('')

  // Step 5 – Photos
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 6 – Notes
  const [notes, setNotes] = useState('')

  const { data: customersPage } = useQuery<{ data: Customer[] }>({
    queryKey: ['customers-search', customerSearch],
    queryFn: () => api.get('/customers', { params: { search: customerSearch, limit: 20 } }).then(r => r.data),
  })
  const customers = customersPage?.data ?? []

  const createCustomerMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/customers', body).then(r => r.data),
    onSuccess: (customer: Customer) => {
      qc.invalidateQueries({ queryKey: ['customers-search'] })
      setCustomerId(customer._id)
      setCustomerName(customer.fullName)
      setCustomerPhone(customer.phone || '')
      setShowCustomerModal(false)
      setCustomerSearch('')
      setErr('')
    },
    onError: (e) => setErr(apiError(e)),
  })

  useEffect(() => { setErr('') }, [step])

  useEffect(() => {
    return () => { stagedPhotos.forEach(p => URL.revokeObjectURL(p.preview)) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function validateStep(): boolean {
    if (step === 0 && !customerId) { setErr('Please select a customer'); return false }
    if (step === 1 && !scheduledDate) { setErr('Please select a scheduled date'); return false }
    return true
  }

  function next() {
    if (!validateStep()) return
    setStep(s => Math.min(s + 1, STEPS.length - 1))
  }

  function back() {
    setStep(s => Math.max(s - 1, 0))
  }

  function handlePhotoPick(category: string, files: FileList | null) {
    if (!files || files.length === 0) return
    const newPhotos = Array.from(files).map(file => ({
      file,
      category,
      preview: URL.createObjectURL(file),
    }))
    setStagedPhotos(prev => [...prev, ...newPhotos])
  }

  function removePhoto(idx: number) {
    setStagedPhotos(prev => {
      URL.revokeObjectURL(prev[idx].preview)
      return prev.filter((_, i) => i !== idx)
    })
  }

  function buildJobBody() {
    const body: Record<string, unknown> = {
      customer: customerId,
      lead: leadId || undefined,
      jobType,
      pickupAddress,
      pickupFloor,
      pickupHasElevator,
      deliveryAddress,
      deliveryFloor,
      deliveryHasElevator,
      scheduledDate: scheduledDate || undefined,
      scheduledTimeSlot,
      estimatedDurationHours: estimatedDurationHours ? Number(estimatedDurationHours) : undefined,
      moveOutPermitRequired,
      notes,
    }
    if (pkgType && Number(pkgPrice) > 0) {
      const pkg = PACKAGES.find(p => p.value === pkgType)
      body.clientPackage = {
        packageType: pkgType,
        label: pkg?.label ?? pkgType,
        agreedPrice: Number(pkgPrice) || 0,
        additionalCharges: pkgAddons.filter(a => a.description && a.amount > 0),
        notes: pkgNotes,
      }
    }
    return body
  }

  async function submit(action: 'save' | 'invoice') {
    setSubmitting(true)
    setErr('')
    try {
      const job = await api.post('/moving-jobs', buildJobBody()).then(r => r.data)

      // Upload staged photos by category
      if (stagedPhotos.length > 0) {
        const byCategory = new Map<string, File[]>()
        for (const p of stagedPhotos) {
          const arr = byCategory.get(p.category) || []
          arr.push(p.file)
          byCategory.set(p.category, arr)
        }
        for (const [category, files] of byCategory) {
          const form = new FormData()
          files.forEach(f => form.append('images', f))
          if (category) form.append('category', category)
          await api.post(`/moving-jobs/${job._id}/images`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
        }
      }

      if (action === 'invoice' && pkgType && Number(pkgPrice) > 0) {
        try {
          const pkg = job.clientPackage
          const lineItems: Array<{ description: string; qty: number; rate: number; amount: number }> = []
          if (pkg?.agreedPrice && pkg.agreedPrice > 0) {
            lineItems.push({ description: `Moving Service${pkg.label ? ` — ${pkg.label}` : ''}`, qty: 1, rate: pkg.agreedPrice, amount: pkg.agreedPrice })
            ;(pkg.additionalCharges ?? []).forEach((ac: Addon) => {
              if (ac.amount > 0) lineItems.push({ description: ac.description, qty: 1, rate: ac.amount, amount: ac.amount })
            })
          }
          const total = lineItems.reduce((s: number, i: { amount: number }) => s + i.amount, 0)
          const invoice = await api.post('/moving-invoices', {
            job: job._id,
            customer: job.customer?._id || customerId,
            status: 'draft',
            items: lineItems,
            total,
            balanceDue: total,
            notes: `Invoice for job ${job.jobNo}`,
          }).then(r => r.data)
          navigate(`/moving/invoices/${invoice._id}`)
          return
        } catch { /* fall through to job page */ }
      }
      navigate(`/moving/jobs/${job._id}`)
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setSubmitting(false)
    }
  }

  const pkgTotal = (Number(pkgPrice) || 0) + pkgAddons.reduce((s, a) => s + (a.amount || 0), 0)
  const groups = [...new Set(PACKAGES.map(p => p.group))]
  const photosForCategory = (cat: string) => stagedPhotos.filter(p => p.category === cat)
  const totalPhotos = stagedPhotos.length

  return (
    <div style={{ background: CREAM, minHeight: '100vh', margin: '-1.5rem', padding: '2.5rem 1.5rem' }}>
      <div className="max-w-3xl">

        {/* Header */}
        <div className="mb-6">
          <h1 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
            New Moving Job
          </h1>
          <p style={{ color: MUTED, fontSize: '0.875rem', marginTop: '0.375rem' }}>Fill in the details step by step</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center mb-8 gap-1">
          {STEPS.map((s, i) => {
            const done = i < step
            const active = i === step
            const future = i > step
            const Icon = s.icon
            return (
              <div key={s.key} className="flex items-center" style={{ flex: i < STEPS.length - 1 ? 1 : undefined }}>
                <button
                  type="button"
                  onClick={() => { if (i < step) setStep(i) }}
                  className="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2 shrink-0"
                  style={{ cursor: i < step ? 'pointer' : 'default' }}
                >
                  <div
                    className="flex items-center justify-center rounded-full transition-all"
                    style={{
                      width: 36, height: 36,
                      background: done ? PURPLE : active ? PURPLE : '#fff',
                      border: future ? `2px solid ${CHIP_BG}` : done || active ? 'none' : `2px solid ${CHIP_BG}`,
                      color: done || active ? '#fff' : MUTED,
                      fontSize: '0.75rem', fontWeight: 600,
                    }}
                  >
                    {done ? <Check size={15} /> : <Icon size={15} />}
                  </div>
                  <span
                    className="text-[10px] sm:text-xs font-medium"
                    style={{ color: active ? INK : done ? PURPLE : MUTED, whiteSpace: 'nowrap' }}
                  >
                    {s.label}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    className="flex-1 mx-1 sm:mx-3 hidden sm:block"
                    style={{ height: 2, background: done ? PURPLE : CHIP_BG, borderRadius: 1, transition: 'background 0.3s' }}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Step Card */}
        <div
          style={{
            background: '#fff',
            borderRadius: 18,
            border: '1px solid rgba(20,8,31,0.06)',
            padding: '2rem 2.25rem',
            boxShadow: '0 1px 3px rgba(20,8,31,0.04)',
            minHeight: 320,
          }}
        >
          {/* Step 1 – Customer */}
          {step === 0 && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontSize: '1.125rem', fontWeight: 700 }}>
                    Select Customer
                  </h2>
                  <p style={{ color: MUTED, fontSize: '0.8rem', marginTop: '0.125rem' }}>Choose an existing customer or create a new one</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCustomerModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                  style={{ background: `${PURPLE}10`, color: PURPLE }}
                >
                  <Plus size={14} /> New Customer
                </button>
              </div>

              {!customerId ? (
                <>
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
                    <Input
                      value={customerSearch}
                      onChange={e => setCustomerSearch(e.target.value)}
                      placeholder="Search by name, phone, or email…"
                      className="pl-9"
                      autoComplete="off"
                    />
                  </div>
                  {customerSearch && customers.length > 0 && (
                    <div className="border rounded-xl divide-y text-sm max-h-56 overflow-y-auto" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                      {customers.map(c => (
                        <button
                          key={c._id}
                          type="button"
                          className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                          onClick={() => { setCustomerId(c._id); setCustomerName(c.fullName); setCustomerPhone(c.phone || ''); setCustomerSearch('') }}
                        >
                          <div className="font-medium" style={{ color: INK }}>{c.fullName}</div>
                          <div className="text-xs" style={{ color: MUTED }}>{c.phone || c.email || 'No contact'}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {customerSearch && customers.length === 0 && (
                    <div className="text-sm text-center py-6 rounded-xl" style={{ background: CHIP_BG, color: MUTED }}>
                      No customers found. Create a new one above.
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center gap-4 p-4 rounded-xl" style={{ background: CHIP_BG }}>
                  <div className="flex items-center justify-center rounded-full" style={{ width: 44, height: 44, background: `${PURPLE}15`, color: PURPLE }}>
                    <User size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold" style={{ color: INK }}>{customerName}</p>
                    {customerPhone && <p className="text-xs" style={{ color: MUTED }}>{customerPhone}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setCustomerId(''); setCustomerName(''); setCustomerPhone(''); setCustomerSearch('') }}
                    className="text-xs font-medium px-3 py-1 rounded-lg transition-colors"
                    style={{ color: PURPLE, background: '#fff' }}
                  >
                    Change
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 2 – Job Details */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontSize: '1.125rem', fontWeight: 700 }}>
                  Job Details
                </h2>
                <p style={{ color: MUTED, fontSize: '0.8rem', marginTop: '0.125rem' }}>Configure the job type and schedule</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Job Type" className="col-span-2">
                  <Select value={jobType} onChange={e => setJobType(e.target.value as MovingJobType)}>
                    {JOB_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </Select>
                </Field>
                <Field label="Scheduled Date">
                  <Input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} required />
                </Field>
                <Field label="Time Slot">
                  <Input value={scheduledTimeSlot} onChange={e => setScheduledTimeSlot(e.target.value)} placeholder="e.g. 08:00–12:00" />
                </Field>
                <Field label="Est. Duration (hours)">
                  <Input type="number" min="0" step="0.5" value={estimatedDurationHours} onChange={e => setEstimatedDurationHours(e.target.value)} />
                </Field>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: INK }}>
                    <input
                      type="checkbox"
                      checked={moveOutPermitRequired}
                      onChange={e => setMoveOutPermitRequired(e.target.checked)}
                      className="accent-purple-600 w-4 h-4"
                    />
                    Move-out Permit Required
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Step 3 – Address */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontSize: '1.125rem', fontWeight: 700 }}>
                  Addresses
                </h2>
                <p style={{ color: MUTED, fontSize: '0.8rem', marginTop: '0.125rem' }}>Pickup and delivery locations</p>
              </div>

              <div className="p-4 rounded-xl space-y-3" style={{ background: CHIP_BG }}>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: PURPLE }}>Pickup</p>
                <Field label="Address">
                  <Textarea rows={2} value={pickupAddress} onChange={e => setPickupAddress(e.target.value)} placeholder="Full pickup address" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Floor">
                    <Input value={pickupFloor} onChange={e => setPickupFloor(e.target.value)} placeholder="e.g. 3rd floor" />
                  </Field>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: INK }}>
                      <input type="checkbox" checked={pickupHasElevator} onChange={e => setPickupHasElevator(e.target.checked)} className="accent-purple-600 w-4 h-4" />
                      Has Elevator
                    </label>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl space-y-3" style={{ background: CHIP_BG }}>
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: PURPLE }}>Delivery</p>
                <Field label="Address">
                  <Textarea rows={2} value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} placeholder="Full delivery address" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Floor">
                    <Input value={deliveryFloor} onChange={e => setDeliveryFloor(e.target.value)} placeholder="e.g. Ground floor" />
                  </Field>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: INK }}>
                      <input type="checkbox" checked={deliveryHasElevator} onChange={e => setDeliveryHasElevator(e.target.checked)} className="accent-purple-600 w-4 h-4" />
                      Has Elevator
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 4 – Package */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontSize: '1.125rem', fontWeight: 700 }}>
                  Client Offer / Package
                </h2>
                <p style={{ color: MUTED, fontSize: '0.8rem', marginTop: '0.125rem' }}>Set the package and price you'll charge the client</p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: MUTED }}>Quick select</p>
                <div className="flex flex-wrap gap-1.5">
                  {PACKAGES.slice(0, 12).map(p => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPkgType(p.value)}
                      className={cn(
                        'px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
                        pkgType === p.value
                          ? 'text-white border-transparent'
                          : 'border-gray-200 hover:border-gray-400'
                      )}
                      style={pkgType === p.value ? { background: PURPLE } : { color: INK }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Package Type">
                <Select value={pkgType} onChange={e => setPkgType(e.target.value)}>
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

              <Field label="Agreed Price (AED)">
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={pkgPrice} onChange={e => setPkgPrice(e.target.value)} />
              </Field>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium" style={{ color: INK }}>Additional Charges</p>
                  <button type="button" onClick={() => setPkgAddons(prev => [...prev, { description: '', amount: 0 }])} className="text-xs font-medium flex items-center gap-1" style={{ color: PURPLE }}>
                    <Plus size={12} /> Add line
                  </button>
                </div>
                {pkgAddons.length === 0 ? (
                  <p className="text-xs py-2" style={{ color: MUTED }}>No add-ons. Examples: packing service, piano move, extra floor carry.</p>
                ) : (
                  <div className="space-y-2">
                    {pkgAddons.map((a, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input placeholder="e.g. Piano move, storage" value={a.description} onChange={e => { const next = [...pkgAddons]; next[i] = { ...next[i], description: e.target.value }; setPkgAddons(next) }} className="flex-1" />
                        <Input type="number" min="0" step="0.01" placeholder="AED" value={a.amount || ''} onChange={e => { const next = [...pkgAddons]; next[i] = { ...next[i], amount: Number(e.target.value) }; setPkgAddons(next) }} className="w-28" />
                        <button type="button" onClick={() => setPkgAddons(pkgAddons.filter((_, idx) => idx !== i))} className="p-1.5 rounded transition-colors" style={{ color: '#dc2626' }}><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Field label="Package Notes (internal)">
                <Textarea rows={2} placeholder="Any special conditions agreed with client…" value={pkgNotes} onChange={e => setPkgNotes(e.target.value)} />
              </Field>

              {pkgType && Number(pkgPrice) > 0 && (
                <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: `${PURPLE}10`, border: `1px solid ${PURPLE}20` }}>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Client Total</p>
                    <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                      {PACKAGES.find(p => p.value === pkgType)?.label ?? 'Package'}
                      {pkgAddons.filter(a => a.amount > 0).length > 0 && ` + ${pkgAddons.filter(a => a.amount > 0).length} add-on${pkgAddons.filter(a => a.amount > 0).length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <p className="text-2xl font-bold" style={{ color: PURPLE }}>AED {pkgTotal.toLocaleString()}</p>
                </div>
              )}
            </div>
          )}

          {/* Step 5 – Photos */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontSize: '1.125rem', fontWeight: 700 }}>
                  Estimation Photos
                </h2>
                <p style={{ color: MUTED, fontSize: '0.8rem', marginTop: '0.125rem' }}>
                  Take photos of each area for an accurate estimate{totalPhotos > 0 && ` · ${totalPhotos} photo${totalPhotos !== 1 ? 's' : ''} added`}
                </p>
              </div>

              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => {
                const cat = fileInputRef.current?.dataset.category || 'Other'
                handlePhotoPick(cat, e.target.files)
                e.target.value = ''
              }} />

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {PHOTO_CATEGORIES.map(cat => {
                  const photos = photosForCategory(cat)
                  const count = photos.length
                  const done = count > 0
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.dataset.category = cat
                          fileInputRef.current.click()
                        }
                      }}
                      className={cn(
                        'relative aspect-square rounded-2xl border-2 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors text-center px-2',
                        done
                          ? 'border-emerald-300 bg-emerald-50'
                          : 'border-dashed hover:bg-gray-50'
                      )}
                      style={!done ? { borderColor: 'rgba(20,8,31,0.15)' } : undefined}
                    >
                      {done && (
                        <span className="absolute top-2 right-2 h-5 w-5 rounded-full bg-emerald-500 text-white grid place-items-center">
                          <Check size={12} strokeWidth={3} />
                        </span>
                      )}
                      {done ? (
                        <ImageIcon size={24} className="text-emerald-600" />
                      ) : (
                        <Camera size={24} style={{ color: MUTED }} />
                      )}
                      <span className={cn('text-[13px] font-semibold', done ? 'text-emerald-700' : '')} style={!done ? { color: MUTED } : undefined}>
                        {cat}{done && ` (${count})`}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Preview of staged photos */}
              {totalPhotos > 0 && (
                <div className="space-y-4 border-t pt-4" style={{ borderColor: 'rgba(20,8,31,0.06)' }}>
                  {PHOTO_CATEGORIES.filter(c => photosForCategory(c).length > 0).map(cat => (
                    <div key={cat}>
                      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: MUTED }}>{cat}</p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {stagedPhotos.map((p, i) => p.category !== cat ? null : (
                          <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border" style={{ borderColor: 'rgba(20,8,31,0.08)' }}>
                            <img src={p.preview} alt={p.file.name} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => removePhoto(i)}
                              className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                            >
                              <X size={11} />
                            </button>
                            <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/50 to-transparent">
                              <p className="text-[9px] text-white truncate">{p.file.name}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 6 – Notes */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h2 style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontSize: '1.125rem', fontWeight: 700 }}>
                  Notes
                </h2>
                <p style={{ color: MUTED, fontSize: '0.8rem', marginTop: '0.125rem' }}>Add any internal notes for this job</p>
              </div>
              <Textarea rows={5} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Special instructions, access codes, fragile items…" />
            </div>
          )}

          {/* Error */}
          {err && (
            <p className="mt-4 text-sm px-3 py-2 rounded-lg" style={{ color: '#b91c1c', background: '#fef2f2' }}>
              {err}
            </p>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-5" style={{ borderTop: '1px solid rgba(20,8,31,0.06)' }}>
            <div>
              {step > 0 ? (
                <button type="button" onClick={back} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-gray-50" style={{ color: MUTED }}>
                  <ChevronLeft size={16} /> Back
                </button>
              ) : (
                <button type="button" onClick={() => navigate(-1)} className="px-4 py-2 rounded-xl text-sm font-medium transition-colors hover:bg-gray-50" style={{ color: MUTED }}>
                  Cancel
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-medium hidden sm:block" style={{ color: MUTED }}>
                Step {step + 1} of {STEPS.length}
              </span>

              {step < STEPS.length - 1 ? (
                <button type="button" onClick={next} className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors hover:opacity-90" style={{ background: PURPLE }}>
                  Next <ChevronRight size={16} />
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => submit('save')}
                    disabled={submitting}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-60 border hover:bg-gray-50"
                    style={{ color: INK, borderColor: 'rgba(20,8,31,0.15)' }}
                  >
                    {submitting ? 'Creating…' : 'Save Job'}
                  </button>
                  {pkgType && Number(pkgPrice) > 0 && (
                    <button
                      type="button"
                      onClick={() => submit('invoice')}
                      disabled={submitting}
                      className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-60 hover:opacity-90"
                      style={{ background: PURPLE }}
                    >
                      {submitting ? 'Creating…' : 'Create & Invoice'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create Customer Modal */}
      <Modal open={showCustomerModal} title="Create New Customer" onClose={() => setShowCustomerModal(false)}>
        <form
          onSubmit={e => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            createCustomerMut.mutate({
              fullName: String(f.get('fullName') || ''),
              phone: String(f.get('phone') || ''),
              email: String(f.get('email') || ''),
              tenantType: String(f.get('tenantType') || 'individual'),
              address: String(f.get('address') || ''),
              notes: String(f.get('notes') || ''),
            })
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full Name"><Input name="fullName" required /></Field>
            <Field label="Type">
              <Select name="tenantType" defaultValue="individual">
                <option value="individual">Individual</option>
                <option value="company">Company</option>
              </Select>
            </Field>
            <Field label="Phone"><Input name="phone" /></Field>
            <Field label="Email"><Input name="email" type="email" /></Field>
            <Field label="Address" className="col-span-2"><Input name="address" /></Field>
            <Field label="Notes" className="col-span-2"><Textarea name="notes" rows={2} /></Field>
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="submit" disabled={createCustomerMut.isPending}>
              {createCustomerMut.isPending ? 'Creating…' : 'Create & Select'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

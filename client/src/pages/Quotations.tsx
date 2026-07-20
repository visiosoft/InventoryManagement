import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, FileSignature, Package, Plus, Search, Trash2 } from 'lucide-react'
import { api, apiError, quoteApi, type AvailableUnit } from '../lib/api'
import type { Quote, QuoteStatus, QuoteUnit, QuoteAddOn } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '../components/ui'
import { RentalFlowStepper, type FlowStep } from '../components/RentalFlowStepper'
import { formatDate, formatMoney } from '../lib/utils'

const QUOTE_STATUSES: QuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired']

const statusTone: Record<string, 'gray' | 'blue' | 'green' | 'yellow' | 'red'> = {
  draft: 'gray',
  sent: 'blue',
  accepted: 'green',
  rejected: 'red',
  expired: 'yellow',
}

function statusLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const FLOW_STEP_LABELS = ['Customer', 'Units', 'Quote', 'Contract', 'Invoice', 'Receipt'] as const

function FlowProgress({ stepsDone, currentStep }: { stepsDone?: boolean[]; currentStep?: number }) {
  const done = stepsDone || []
  const cur = currentStep ?? 0
  return (
    <div className="flex items-center gap-0.5">
      {FLOW_STEP_LABELS.map((label, i) => {
        const isDone = done[i]
        const isCurrent = i === cur
        return (
          <div
            key={label}
            title={`${label}${isDone ? ' (done)' : isCurrent ? ' (current)' : ''}`}
            className="rounded-full"
            style={{
              width: 8,
              height: 8,
              background: isDone ? '#047857' : isCurrent ? '#5B2BC9' : '#E5E3DE',
              transition: 'background 0.2s',
            }}
          />
        )
      })}
    </div>
  )
}

const DEFAULT_ADDONS = [
  { name: 'Lock', description: 'Padlock for storage unit', rate: 80 },
  { name: 'Insurance', description: 'Content insurance coverage', rate: 150 },
  { name: 'Shelving', description: 'Metal shelving rack', rate: 75 },
  { name: 'Climate Control', description: 'Temperature controlled environment', rate: 200 },
]

interface UnitRow {
  unitId: string
  unitNumber: string
  sizeSqf: number
  floor: string
  startDate: string
  endDate: string
  rate: number
  discountPct: number
}

interface AddOnRow {
  name: string
  description: string
  quantity: number
  rate: number
}

function QuoteWizard({
  initial,
  busy,
  error,
  customers,
  leads,
  onSubmit,
}: {
  initial?: Partial<Quote>
  busy: boolean
  error: string
  customers: { _id: string; fullName: string; email?: string; phone?: string }[]
  leads: { _id: string; fullName: string; phone?: string }[]
  onSubmit: (body: Record<string, unknown>) => void
}) {
  const [step, setStep] = useState(0)
  const [customerId, setCustomerId] = useState(
    typeof initial?.customer === 'object' ? initial.customer._id : ''
  )
  const [leadId, setLeadId] = useState(
    initial?.lead ? (typeof initial.lead === 'object' ? initial.lead._id : initial.lead) : ''
  )
  const [billingPeriod, setBillingPeriod] = useState<'weekly' | 'monthly'>(initial?.billingPeriod || 'monthly')
  const [expiryDate, setExpiryDate] = useState(
    initial?.expiryDate ? new Date(initial.expiryDate).toISOString().slice(0, 10) : ''
  )
  const [subject, setSubject] = useState(initial?.subject || '')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [deposit, setDeposit] = useState(initial?.deposit || 0)
  const [adjustment, setAdjustment] = useState(initial?.adjustment || 0)

  const [unitRows, setUnitRows] = useState<UnitRow[]>(() => {
    if (!initial?.units?.length) return []
    return initial.units.map((u: QuoteUnit) => ({
      unitId: typeof u.unit === 'object' ? u.unit._id : u.unit,
      unitNumber: u.unitNumber,
      sizeSqf: u.sizeSqf,
      floor: u.floor,
      startDate: u.startDate ? new Date(u.startDate).toISOString().slice(0, 10) : '',
      endDate: u.endDate ? new Date(u.endDate).toISOString().slice(0, 10) : '',
      rate: u.rate,
      discountPct: u.discountPct,
    }))
  })

  const [addOnRows, setAddOnRows] = useState<AddOnRow[]>(() => {
    if (!initial?.addOns?.length) return []
    return initial.addOns.map((a: QuoteAddOn) => ({
      name: a.name,
      description: a.description || '',
      quantity: a.quantity,
      rate: a.rate,
    }))
  })

  const [dateRangeFrom, setDateRangeFrom] = useState(unitRows[0]?.startDate || '')
  const [dateRangeTo, setDateRangeTo] = useState(unitRows[0]?.endDate || '')

  const { data: availableUnits, isLoading: unitsLoading } = useQuery<AvailableUnit[]>({
    queryKey: ['available-units', dateRangeFrom, dateRangeTo],
    queryFn: () => quoteApi.availableUnits(dateRangeFrom || undefined, dateRangeTo || undefined),
    enabled: step === 1,
  })

  const selectedUnitIds = new Set(unitRows.map((u) => u.unitId))

  function addUnit(unit: AvailableUnit) {
    if (selectedUnitIds.has(unit._id)) return
    const rate = billingPeriod === 'weekly' ? Math.ceil((unit.price || 0) / 4) : (unit.price || 0)
    setUnitRows((prev) => [
      ...prev,
      {
        unitId: unit._id,
        unitNumber: unit.unitNumber,
        sizeSqf: unit.sizeSqf,
        floor: unit.floor,
        startDate: dateRangeFrom,
        endDate: dateRangeTo,
        rate,
        discountPct: unit.discountPct || 0,
      },
    ])
  }

  function removeUnit(idx: number) {
    setUnitRows((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateUnit(idx: number, field: keyof UnitRow, value: string | number) {
    setUnitRows((prev) => prev.map((u, i) => (i === idx ? { ...u, [field]: value } : u)))
  }

  function addAddOn(preset?: (typeof DEFAULT_ADDONS)[0]) {
    setAddOnRows((prev) => [
      ...prev,
      {
        name: preset?.name || '',
        description: preset?.description || '',
        quantity: 1,
        rate: preset?.rate || 0,
      },
    ])
  }

  function removeAddOn(idx: number) {
    setAddOnRows((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateAddOn(idx: number, field: keyof AddOnRow, value: string | number) {
    setAddOnRows((prev) => prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)))
  }

  const unitsTotal = unitRows.reduce((s, u) => {
    const gross = u.rate
    return s + gross - (gross * u.discountPct) / 100
  }, 0)

  const addOnsTotal = addOnRows.reduce((s, a) => s + a.quantity * a.rate, 0)
  const subTotal = unitsTotal + addOnsTotal
  const total = subTotal + adjustment

  function handleSubmit() {
    onSubmit({
      customer: customerId,
      lead: leadId || undefined,
      billingPeriod,
      expiryDate,
      subject,
      notes,
      deposit,
      adjustment,
      units: unitRows.map((u) => ({
        unit: u.unitId,
        unitNumber: u.unitNumber,
        sizeSqf: u.sizeSqf,
        floor: u.floor,
        startDate: u.startDate,
        endDate: u.endDate,
        rate: u.rate,
        discountPct: u.discountPct,
      })),
      addOns: addOnRows.map((a) => ({
        name: a.name,
        description: a.description,
        quantity: a.quantity,
        rate: a.rate,
      })),
      items: [],
    })
  }

  const steps = ['Customer & Details', 'Select Units', 'Add-ons & Summary']

  return (
    <div className="space-y-5">
      {/* Stepper */}
      <div className="flex items-center gap-2 text-sm">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <ChevronRight size={14} className="text-muted-foreground" />}
            <button
              onClick={() => setStep(i)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                i === step
                  ? 'bg-primary text-primary-foreground'
                  : i < step
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {i + 1}. {label}
            </button>
          </div>
        ))}
      </div>

      {/* Step 0: Customer & Details */}
      {step === 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Customer">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                <option value="">Select customer</option>
                {customers.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.fullName} {c.phone ? `(${c.phone})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From lead (optional)">
              <Select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                <option value="">No lead</option>
                {leads.map((l) => (
                  <option key={l._id} value={l._id}>
                    {l.fullName} {l.phone ? `(${l.phone})` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Billing period">
              <Select value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value as 'weekly' | 'monthly')}>
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
              </Select>
            </Field>
            <Field label="Expiry date">
              <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} required />
            </Field>
            <Field label="Deposit (AED)">
              <Input type="number" min={0} value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} />
            </Field>
          </div>

          <Field label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Storage rental quotation" />
          </Field>

          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>

          <div className="flex justify-end">
            <Button onClick={() => setStep(1)} disabled={!customerId || !expiryDate}>
              Next: Select Units <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Step 1: Unit Selection */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rental start date">
              <Input type="date" value={dateRangeFrom} onChange={(e) => setDateRangeFrom(e.target.value)} />
            </Field>
            <Field label="Rental end date">
              <Input type="date" value={dateRangeTo} onChange={(e) => setDateRangeTo(e.target.value)} />
            </Field>
          </div>

          {/* Available units list */}
          <div>
            <p className="text-sm font-semibold mb-2">Available Units</p>
            {unitsLoading ? (
              <Spinner />
            ) : !availableUnits?.length ? (
              <p className="text-sm text-muted-foreground py-3">No available units found for this date range.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-auto">
                {availableUnits.map((u) => {
                  const selected = selectedUnitIds.has(u._id)
                  return (
                    <button
                      key={u._id}
                      onClick={() => addUnit(u)}
                      disabled={selected}
                      className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                        selected
                          ? 'border-primary bg-primary/5 opacity-60'
                          : 'hover:border-primary hover:bg-primary/5'
                      }`}
                    >
                      <div className="font-semibold">{u.unitNumber}</div>
                      <div className="text-xs text-muted-foreground">
                        {u.sizeSqf} sqft · Floor {u.floor || '—'}
                      </div>
                      <div className="text-xs font-medium mt-1">
                        {formatMoney(u.price || 0)} AED/mo
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Selected units */}
          {unitRows.length > 0 && (
            <div>
              <p className="text-sm font-semibold mb-2">Selected Units ({unitRows.length})</p>
              <div className="space-y-2">
                {unitRows.map((u, idx) => {
                  const gross = u.rate
                  const net = gross - (gross * u.discountPct) / 100
                  return (
                    <div key={idx} className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
                      <div className="flex-1 grid grid-cols-6 gap-2 items-center text-sm">
                        <div>
                          <span className="font-semibold">{u.unitNumber}</span>
                          <span className="text-xs text-muted-foreground ml-1">{u.sizeSqf} sqft</span>
                        </div>
                        <Input
                          type="date"
                          value={u.startDate}
                          onChange={(e) => updateUnit(idx, 'startDate', e.target.value)}
                          className="h-8 text-xs"
                        />
                        <Input
                          type="date"
                          value={u.endDate}
                          onChange={(e) => updateUnit(idx, 'endDate', e.target.value)}
                          className="h-8 text-xs"
                        />
                        <Input
                          type="number"
                          min={0}
                          value={u.rate}
                          onChange={(e) => updateUnit(idx, 'rate', Number(e.target.value))}
                          className="h-8 text-xs"
                        />
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={u.discountPct}
                          onChange={(e) => updateUnit(idx, 'discountPct', Number(e.target.value))}
                          className="h-8 text-xs"
                          placeholder="Disc %"
                        />
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-xs">{formatMoney(net)} AED</span>
                          <button onClick={() => removeUnit(idx)} className="text-destructive hover:text-destructive/80 ml-2">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center justify-between mt-2 text-sm font-semibold px-3">
                <span>Units subtotal</span>
                <span>{formatMoney(unitsTotal)} AED</span>
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button onClick={() => setStep(2)} disabled={!unitRows.length}>
              Next: Add-ons & Summary <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Add-ons & Summary */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Add-on presets */}
          <div>
            <p className="text-sm font-semibold mb-2">Add-ons</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {DEFAULT_ADDONS.map((preset) => (
                <Button
                  key={preset.name}
                  variant="outline"
                  className="text-xs"
                  onClick={() => addAddOn(preset)}
                >
                  <Plus size={12} /> {preset.name} ({formatMoney(preset.rate)} AED)
                </Button>
              ))}
              <Button variant="outline" className="text-xs" onClick={() => addAddOn()}>
                <Plus size={12} /> Custom
              </Button>
            </div>

            {addOnRows.length > 0 && (
              <div className="space-y-2">
                {addOnRows.map((a, idx) => (
                  <div key={idx} className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3">
                    <div className="flex-1 grid grid-cols-5 gap-2 items-center text-sm">
                      <Input
                        value={a.name}
                        onChange={(e) => updateAddOn(idx, 'name', e.target.value)}
                        placeholder="Name"
                        className="h-8 text-xs"
                      />
                      <Input
                        value={a.description}
                        onChange={(e) => updateAddOn(idx, 'description', e.target.value)}
                        placeholder="Description"
                        className="h-8 text-xs"
                      />
                      <Input
                        type="number"
                        min={1}
                        value={a.quantity}
                        onChange={(e) => updateAddOn(idx, 'quantity', Number(e.target.value))}
                        className="h-8 text-xs"
                        placeholder="Qty"
                      />
                      <Input
                        type="number"
                        min={0}
                        value={a.rate}
                        onChange={(e) => updateAddOn(idx, 'rate', Number(e.target.value))}
                        className="h-8 text-xs"
                        placeholder="Rate"
                      />
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs">{formatMoney(a.quantity * a.rate)} AED</span>
                        <button onClick={() => removeAddOn(idx)} className="text-destructive hover:text-destructive/80 ml-2">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
            <p className="text-sm font-semibold">Quote Summary</p>
            <div className="grid grid-cols-2 gap-1 text-sm">
              <span className="text-muted-foreground">Units ({unitRows.length})</span>
              <span className="text-right font-medium">{formatMoney(unitsTotal)} AED</span>
              <span className="text-muted-foreground">Add-ons ({addOnRows.length})</span>
              <span className="text-right font-medium">{formatMoney(addOnsTotal)} AED</span>
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-right font-medium">{formatMoney(subTotal)} AED</span>
              <span className="text-muted-foreground">Adjustment</span>
              <span className="text-right">
                <Input
                  type="number"
                  value={adjustment}
                  onChange={(e) => setAdjustment(Number(e.target.value))}
                  className="h-7 w-28 text-xs text-right inline-block"
                />
              </span>
              <span className="font-semibold border-t pt-1">Total</span>
              <span className="text-right font-bold border-t pt-1 text-primary">{formatMoney(total)} AED</span>
              {deposit > 0 && (
                <>
                  <span className="text-muted-foreground">Deposit</span>
                  <span className="text-right font-medium">{formatMoney(deposit)} AED</span>
                </>
              )}
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button onClick={handleSubmit} disabled={busy || !unitRows.length}>
              {busy ? 'Saving…' : initial?._id ? 'Update Quote' : 'Create Quote'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function QuoteDetailPanel({ quote }: { quote: Quote }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [convertError, setConvertError] = useState('')

  const { data: detail } = useQuery<Quote>({
    queryKey: ['quote-detail', quote._id],
    queryFn: () => quoteApi.get(quote._id),
  })

  const updateStatus = useMutation({
    mutationFn: (status: string) => quoteApi.updateStatus(quote._id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      qc.invalidateQueries({ queryKey: ['quote-detail', quote._id] })
    },
  })

  const convert = useMutation({
    mutationFn: () => quoteApi.convertToContract(quote._id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      qc.invalidateQueries({ queryKey: ['quote-detail', quote._id] })
      navigate(`/contracts/${r.contractId}`)
    },
    onError: (e) => setConvertError(apiError(e)),
  })

  const q = detail || quote
  const linkedContract = typeof q.contract === 'object' && q.contract ? q.contract : null
  const units = q.units || []
  const addOns = q.addOns || []
  const timeline = q.timeline || []

  const isBooked = linkedContract?.status === 'active'
  const flowSteps: FlowStep[] = [
    ...(q.lead ? ([{ key: 'lead', label: 'Lead', state: 'done' }] as FlowStep[]) : []),
    {
      key: 'quote', label: 'Quote', detail: q.quoteNo,
      state: q.status === 'rejected' ? 'blocked' : ['accepted', 'sent'].includes(q.status) || linkedContract ? 'done' : 'current',
    },
    {
      key: 'contract', label: 'Contract', detail: linkedContract?.contractNo,
      state: linkedContract ? 'done' : q.status === 'accepted' ? 'current' : 'upcoming',
    },
    { key: 'invoice', label: 'Invoice', state: linkedContract ? 'done' : 'upcoming' },
    { key: 'payment', label: 'Payment', state: isBooked ? 'done' : 'upcoming' },
    { key: 'approval', label: 'Approval', state: isBooked ? 'done' : linkedContract ? 'current' : 'upcoming' },
    { key: 'booked', label: 'Booked', state: isBooked ? 'done' : 'upcoming' },
  ]

  return (
    <div className="space-y-5">
      {/* Flow progress */}
      <RentalFlowStepper steps={flowSteps} />

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{q.quoteNo}</h3>
          <p className="text-sm text-muted-foreground">{q.subject || 'Storage rental quotation'}</p>
          <div className="flex gap-2 mt-2">
            <Badge tone={statusTone[q.status]}>{statusLabel(q.status)}</Badge>
            <Badge tone="gray">{q.billingPeriod === 'weekly' ? 'Weekly' : 'Monthly'}</Badge>
          </div>
        </div>
        <div className="text-right text-sm">
          <p className="font-bold text-xl text-primary">{formatMoney(q.total)} AED</p>
          {(q.deposit || 0) > 0 && (
            <p className="text-xs text-muted-foreground">Deposit: {formatMoney(q.deposit!)} AED</p>
          )}
        </div>
      </div>

      {/* Customer & Lead info */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Customer</p>
          <p className="font-semibold text-sm">{q.customer?.fullName}</p>
          {q.customer?.phone && <p className="text-xs text-muted-foreground">{q.customer.phone}</p>}
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Dates</p>
          <p className="text-sm">Created: {formatDate(q.quoteDate)}</p>
          <p className="text-sm">Expires: {formatDate(q.expiryDate)}</p>
        </div>
      </div>

      {/* Units */}
      {units.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-2">Units ({units.length})</p>
          <div className="space-y-1">
            {units.map((u, i) => {
              const unitObj = typeof u.unit === 'object' ? u.unit : null
              return (
                <div key={i} className="flex items-center justify-between rounded-lg border bg-muted/20 p-2.5 text-sm">
                  <div>
                    <span className="font-semibold">{unitObj?.unitNumber || u.unitNumber}</span>
                    <span className="text-xs text-muted-foreground ml-2">{u.sizeSqf} sqft · Floor {u.floor || '—'}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground mr-2">
                      {formatDate(u.startDate)} → {formatDate(u.endDate)}
                    </span>
                    <span className="font-semibold">{formatMoney(u.amount)} AED</span>
                    {u.discountPct > 0 && (
                      <span className="text-xs text-emerald-600 ml-1">-{u.discountPct}%</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Add-ons */}
      {addOns.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-2">Add-ons</p>
          <div className="space-y-1">
            {addOns.map((a, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border bg-muted/20 p-2.5 text-sm">
                <div>
                  <span className="font-semibold">{a.name}</span>
                  {a.description && <span className="text-xs text-muted-foreground ml-2">{a.description}</span>}
                </div>
                <div>
                  <span className="text-xs text-muted-foreground mr-2">{a.quantity} x {formatMoney(a.rate)}</span>
                  <span className="font-semibold">{formatMoney(a.amount)} AED</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Convert to contract */}
      {q.status === 'accepted' && !linkedContract && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <p className="text-sm font-semibold">Quote accepted — ready to book</p>
          <p className="text-xs text-muted-foreground">
            Creates a draft contract with the units, dates, rate and deposit from this quote.
          </p>
          <Button disabled={convert.isPending} onClick={() => convert.mutate()}>
            <FileSignature size={14} /> {convert.isPending ? 'Converting…' : 'Convert to Contract'}
          </Button>
          {convertError && <p className="text-xs text-destructive">{convertError}</p>}
        </div>
      )}
      {linkedContract && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
          <div>
            <p className="text-xs text-muted-foreground">Contract</p>
            <p className="text-sm font-semibold">{linkedContract.contractNo}</p>
          </div>
          <Button variant="outline" className="text-xs" onClick={() => navigate(`/contracts/${linkedContract._id}`)}>
            View Contract <ChevronRight size={14} />
          </Button>
        </div>
      )}

      {/* Status actions */}
      <div>
        <p className="text-sm font-semibold mb-2">Update Status</p>
        <div className="flex flex-wrap gap-2">
          {QUOTE_STATUSES.filter((s) => s !== q.status).map((s) => (
            <Button
              key={s}
              variant="outline"
              className="text-xs"
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate(s)}
            >
              Mark as {statusLabel(s)}
            </Button>
          ))}
        </div>
      </div>

      {/* Notes */}
      {q.notes && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
          <p className="text-sm whitespace-pre-wrap">{q.notes}</p>
        </div>
      )}

      {/* Timeline */}
      {timeline.length > 0 && (
        <div>
          <p className="text-sm font-semibold mb-2">Activity</p>
          <div className="space-y-1">
            {timeline.slice().reverse().map((t, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5 text-xs text-muted-foreground">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                <span>{t.text}</span>
                <span className="ml-auto shrink-0">{formatDate(t.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Quotations() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Quote | null>(null)
  const [viewing, setViewing] = useState<Quote | null>(null)
  const [error, setError] = useState('')

  const queryParams = useMemo(
    () => ({ search: search || undefined, status: statusFilter || undefined }),
    [search, statusFilter]
  )

  const { data: quotes, isLoading } = useQuery<Quote[]>({
    queryKey: ['quotes', queryParams],
    queryFn: () => quoteApi.list(queryParams),
  })

  const { data: customers } = useQuery<{ _id: string; fullName: string; email?: string; phone?: string }[]>({
    queryKey: ['customers-list'],
    queryFn: () => api.get('/customers', { params: { limit: 100 } }).then((r) => r.data.data),
  })

  const { data: leads } = useQuery<{ _id: string; fullName: string; phone?: string }[]>({
    queryKey: ['leads-for-quotes'],
    queryFn: () => api.get('/leads', { params: { status: 'qualified', limit: 200 } }).then((r) => r.data.data),
  })

  const createQuote = useMutation({
    mutationFn: (body: Record<string, unknown>) => quoteApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      setAdding(false)
      setError('')
    },
    onError: (e) => setError(apiError(e)),
  })

  const updateQuote = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => quoteApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] })
      setEditing(null)
      setError('')
    },
    onError: (e) => setError(apiError(e)),
  })

  const removeQuote = useMutation({
    mutationFn: (id: string) => quoteApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  })

  const stats = useMemo(() => {
    const all = quotes || []
    return {
      total: all.length,
      draft: all.filter((q) => q.status === 'draft').length,
      sent: all.filter((q) => q.status === 'sent').length,
      accepted: all.filter((q) => q.status === 'accepted').length,
      totalValue: all.reduce((s, q) => s + q.total, 0),
    }
  }, [quotes])

  return (
    <div>
      <PageHeader
        title="Book Unit"
        subtitle={`${stats.total} bookings · ${formatMoney(stats.totalValue)} AED total value`}
        action={
          <Button onClick={() => navigate('/quotes/new')}>
            <Plus size={15} /> New Booking
          </Button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Draft</p>
          <p className="text-2xl font-semibold">{stats.draft}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Sent</p>
          <p className="text-2xl font-semibold text-blue-600">{stats.sent}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Accepted</p>
          <p className="text-2xl font-semibold text-emerald-600">{stats.accepted}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Total Value</p>
          <p className="text-2xl font-semibold">{formatMoney(stats.totalValue)}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="relative md:col-span-2">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by quote number, subject"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {QUOTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Quote #</Th>
                <Th>Customer</Th>
                <Th>Progress</Th>
                <Th>Units</Th>
                <Th>Status</Th>
                <Th>Total</Th>
                <Th>Assigned</Th>
                <Th>Date</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(() => {
                const all = quotes || []
                const now = new Date()
                const todayStr = now.toISOString().slice(0, 10)
                const yd = new Date(now); yd.setDate(yd.getDate() - 1)
                const yesterdayStr = yd.toISOString().slice(0, 10)

                const groups: { label: string; items: Quote[] }[] = [
                  { label: 'Today', items: all.filter((q) => (q.createdAt || q.quoteDate)?.slice(0, 10) === todayStr) },
                  { label: 'Yesterday', items: all.filter((q) => (q.createdAt || q.quoteDate)?.slice(0, 10) === yesterdayStr) },
                  { label: 'Earlier', items: all.filter((q) => { const d = (q.createdAt || q.quoteDate)?.slice(0, 10); return d !== todayStr && d !== yesterdayStr }) },
                ]

                return groups.filter((g) => g.items.length > 0).map((g) => (
                  <>
                    <tr key={g.label}>
                      <td colSpan={9} className="px-3 pt-4 pb-1.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.label} ({g.items.length})</span>
                      </td>
                    </tr>
                    {g.items.map((q) => (
                      <tr
                        key={q._id}
                        className="hover:bg-muted/50 cursor-pointer"
                        onClick={() => navigate(`/quotes/new?quote=${q._id}`)}
                      >
                        <Td>
                          <span className="font-medium">{q.quoteNo}</span>
                        </Td>
                        <Td>
                          <div className="font-medium">{q.customer?.fullName}</div>
                          {q.customer?.phone && (
                            <div className="text-xs text-muted-foreground">{q.customer.phone}</div>
                          )}
                        </Td>
                        <Td>
                          <div className="flex flex-col gap-1">
                            <FlowProgress stepsDone={q.flowStepsDone} currentStep={q.flowStep} />
                            <span className="text-[10px] text-muted-foreground">
                              {FLOW_STEP_LABELS[q.flowStep ?? 0]}
                              {(() => {
                                const c = typeof q.contract === 'object' && q.contract ? q.contract : null
                                if (c?.approvalStatus === 'approved') return ' · Approved'
                                if (c?.approvalStatus === 'pending') return ' · Pending approval'
                                if (c?.approvalStatus === 'rejected') return ' · Rejected'
                                return ''
                              })()}
                            </span>
                          </div>
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1">
                            <Package size={13} className="text-muted-foreground" />
                            <span>{q.units?.length || 0}</span>
                          </div>
                        </Td>
                        <Td>
                          <Badge tone={statusTone[q.status]}>{statusLabel(q.status)}</Badge>
                        </Td>
                        <Td>
                          <span className="font-semibold">{formatMoney(q.total)}</span>
                        </Td>
                        <Td>
                          <span className="text-xs text-muted-foreground">
                            {typeof q.assignedTo === 'object' && q.assignedTo ? q.assignedTo.name : '—'}
                          </span>
                        </Td>
                        <Td>{formatDate(q.quoteDate)}</Td>
                        <Td>
                          <div className="flex gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => navigate(`/quotes/new?quote=${q._id}`)} className="text-primary hover:underline cursor-pointer">
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Delete this quote?')) removeQuote.mutate(q._id)
                              }}
                              className="text-destructive hover:underline cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </>
                ))
              })()}
            </tbody>
          </Table>
          {(quotes || []).length === 0 && <EmptyState message="No bookings found." />}
        </Card>
      )}

      {/* Create Modal */}
      <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="New Quotation" wide>
        <QuoteWizard
          customers={customers || []}
          leads={leads || []}
          busy={createQuote.isPending}
          error={error}
          onSubmit={(body) => createQuote.mutate(body)}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={!!editing}
        onClose={() => { setEditing(null); setError('') }}
        title={editing ? `Edit ${editing.quoteNo}` : 'Edit Quote'}
        wide
      >
        {editing && (
          <QuoteWizard
            initial={editing}
            customers={customers || []}
            leads={leads || []}
            busy={updateQuote.isPending}
            error={error}
            onSubmit={(body) => updateQuote.mutate({ id: editing._id, body })}
          />
        )}
      </Modal>

      {/* Detail Modal */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? viewing.quoteNo : 'Quote Details'} wide>
        {viewing && <QuoteDetailPanel quote={viewing} />}
      </Modal>
    </div>
  )
}

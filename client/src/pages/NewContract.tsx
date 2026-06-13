import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, apiError, unitTypeApi } from '../lib/api'
import type { Contract, Customer, Unit, UnitType } from '../lib/types'
import { Badge, Button, Card, CardBody, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui'
import { cn, formatMoney } from '../lib/utils'

function addToDate(date: string, billing: 'weekly' | 'monthly', n: number) {
  const d = new Date(date)
  if (billing === 'weekly') d.setDate(d.getDate() + 7 * n)
  else d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
}

function hasDateOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  const aS = new Date(aStart)
  const aE = new Date(aEnd)
  const bS = new Date(bStart)
  const bE = new Date(bEnd)
  if ([aS, aE, bS, bE].some((d) => Number.isNaN(d.getTime()))) return false
  return aS < bE && aE > bS
}

export default function NewContract() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')

  const [customerId, setCustomerId] = useState(params.get('customer') || '')
  const [unitId, setUnitId] = useState(params.get('unit') || '')
  const [billing, setBilling] = useState<'weekly' | 'monthly'>('monthly')
  const [periods, setPeriods] = useState(3)
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rate, setRate] = useState<number | ''>('')
  const [deposit, setDeposit] = useState<number | ''>('')
  const [autoRenew, setAutoRenew] = useState(false)
  const [firstMonthDiscount, setFirstMonthDiscount] = useState(false)
  const [notes, setNotes] = useState('')

  const { data: customers } = useQuery<Customer[]>({
    queryKey: ['customers', ''],
    queryFn: () => api.get('/customers').then((r) => r.data),
  })
  const { data: units, isLoading: unitsLoading } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
  })
  const { data: contracts } = useQuery<Contract[]>({
    queryKey: ['contracts'],
    queryFn: () => api.get('/contracts').then((r) => r.data),
  })
  const { data: unitTypes } = useQuery<UnitType[]>({
    queryKey: ['unit-types'],
    queryFn: () => unitTypeApi.list(),
  })

  const availableUnits = useMemo(
    () => (units || []).filter((u) => u.status !== 'maintenance' || u._id === unitId),
    [units, unitId]
  )
  const selectedUnit = useMemo(() => (units || []).find((u) => u._id === unitId), [units, unitId])
  const selectedCustomer = useMemo(() => (customers || []).find((c) => c._id === customerId), [customers, customerId])
  const endDate = useMemo(() => addToDate(startDate, billing, periods), [startDate, billing, periods])
  const overlappingContract = useMemo(() => {
    if (!unitId || !startDate || !endDate) return null
    return (contracts || []).find(
      (c) =>
        c.unit?._id === unitId &&
        ['draft', 'pending_signature', 'active'].includes(c.status) &&
        hasDateOverlap(startDate, endDate, c.startDate, c.endDate)
    )
  }, [contracts, unitId, startDate, endDate])

  // Rate: prefer pricing tier matched by unit size, fall back to unit.price
  const matchingTier = useMemo(
    () => (unitTypes ?? []).find((t) => t.sizeSqf === selectedUnit?.sizeSqf),
    [unitTypes, selectedUnit]
  )
  const tierMonthly = matchingTier?.monthlyRate ?? selectedUnit?.price ?? 0
  const tierWeekly = matchingTier?.weeklyRate ?? Math.round((tierMonthly / 4) * 100) / 100
  const defaultRate = billing === 'weekly' ? tierWeekly : tierMonthly
  const effectiveRate = rate === '' ? defaultRate : rate
  const discountPct = matchingTier?.discountPct ?? 20
  const firstPaymentAmount = (firstMonthDiscount && billing === 'monthly' && Number(effectiveRate) > 0)
    ? Math.round(Number(effectiveRate) * (1 - discountPct / 100) * 100) / 100
    : Number(effectiveRate)
  const totalValue = periods > 0
    ? firstPaymentAmount + Number(effectiveRate) * (periods - 1)
    : 0

  const create = useMutation({
    mutationFn: () =>
      api.post('/contracts', {
        customer: customerId,
        unit: unitId,
        billingPeriod: billing,
        rate: effectiveRate,
        deposit: deposit === '' ? 0 : deposit,
        startDate,
        endDate,
        autoRenew,
        notes,
        firstMonthDiscountPct: firstMonthDiscount && billing === 'monthly' ? discountPct : 0,
      }),
    onSuccess: (res) => navigate(`/contracts/${res.data._id}`),
    onError: (e) => {
      const message = apiError(e)
      setError(message)
      if (message.includes('already booked for this period')) setStep(2)
    },
  })

  const steps = ['Customer', 'Unit', 'Terms', 'Review']
  const canNext = [
    Boolean(customerId),
    Boolean(unitId),
    Boolean(startDate && periods > 0 && effectiveRate > 0 && !overlappingContract),
    true,
  ][step]

  if (unitsLoading) return <Spinner />

  return (
    <div className="max-w-2xl">
      <PageHeader title="New contract" subtitle="Create a rental contract in four steps" />

      <div className="mb-5 flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => i < step && setStep(i)}
              className={cn(
                'flex h-7 items-center gap-2 rounded-full px-3 text-xs font-medium cursor-pointer',
                i === step ? 'bg-primary text-primary-foreground' : i < step ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'
              )}
            >
              {i + 1}. {s}
            </button>
            {i < steps.length - 1 && <div className="h-px w-5 bg-border" />}
          </div>
        ))}
      </div>

      <Card>
        <CardBody className="pt-4 space-y-4">
          {step === 0 && (
            <>
              <Field label="Customer">
                <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Select a customer…</option>
                  {(customers || []).map((c) => <option key={c._id} value={c._id}>{c.fullName}{c.email ? ` — ${c.email}` : ''}</option>)}
                </Select>
              </Field>
              <p className="text-xs text-muted-foreground">
                Customer not listed? <Link to="/customers" className="text-primary hover:underline">Add them first</Link>, then come back.
              </p>
            </>
          )}

          {step === 1 && (
            <>
              <Field label={`Bookable unit (${availableUnits.length})`}>
                <Select value={unitId} onChange={(e) => { setUnitId(e.target.value); setRate(''); setFirstMonthDiscount(false) }}>
                  <option value="">Select a unit…</option>
                  {availableUnits.map((u) => (
                    <option key={u._id} value={u._id}>
                      {u.unitNumber} — {u.sizeSqf != null ? `${u.sizeSqf} sq ft` : 'size n/a'}{u.price != null ? ` (${formatMoney(u.price)}/mo)` : ''} [{u.status}]
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="text-xs text-muted-foreground">
                You can pre-book units that are currently occupied or reserved, as long as contract dates do not overlap.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Billing period">
                  <Select value={billing} onChange={(e) => { setBilling(e.target.value as 'weekly' | 'monthly'); setRate(''); setFirstMonthDiscount(false) }}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </Select>
                </Field>
                <Field label={billing === 'weekly' ? 'Number of weeks' : 'Number of months'}>
                  <Input type="number" min={1} value={periods} onChange={(e) => setPeriods(Number(e.target.value))} />
                </Field>
                <Field label="Start date">
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </Field>
                <Field label="End date (auto)">
                  <Input type="date" value={endDate} disabled />
                </Field>
                <Field label={`Rate per ${billing === 'weekly' ? 'week' : 'month'}`}>
                  <Input type="number" min={0} step="0.01" value={rate} placeholder={String(defaultRate)} onChange={(e) => setRate(e.target.value === '' ? '' : Number(e.target.value))} />
                  {matchingTier && (
                    <p className="mt-1 text-[11px] text-emerald-600">
                      Pricing tier: {formatMoney(billing === 'weekly' ? matchingTier.weeklyRate : matchingTier.monthlyRate)} / {billing === 'weekly' ? 'wk' : 'mo'} for {matchingTier.sizeSqf} Sq Ft
                    </p>
                  )}
                </Field>
                <Field label="Security deposit">
                  <Input type="number" min={0} step="0.01" value={deposit} placeholder="0.00" onChange={(e) => setDeposit(e.target.value === '' ? '' : Number(e.target.value))} />
                </Field>
              </div>
              {billing === 'monthly' && defaultRate > 0 && discountPct > 0 && (
                <label className="flex items-center gap-2 text-sm cursor-pointer rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/40 dark:bg-amber-900/20">
                  <input
                    type="checkbox"
                    checked={firstMonthDiscount}
                    onChange={(e) => setFirstMonthDiscount(e.target.checked)}
                    className="accent-amber-500"
                  />
                  <span>
                    Apply first-month {discountPct}% discount
                    <span className="ml-1.5 text-muted-foreground text-xs">
                      (1st payment: <strong className="text-amber-600">{formatMoney(firstPaymentAmount)}</strong> instead of {formatMoney(Number(effectiveRate))})
                    </span>
                  </span>
                </label>
              )}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} className="accent-(--primary)" />
                Auto-renew at end of term
              </label>
              <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
              {overlappingContract && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  This unit is already booked for the selected dates under {overlappingContract.contractNo} ({overlappingContract.startDate.slice(0, 10)} to {overlappingContract.endDate.slice(0, 10)}).
                  Choose a different date range or unit.
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-muted-foreground">Customer</div>{selectedCustomer?.fullName}</div>
                <div><div className="text-xs text-muted-foreground">Unit</div>{selectedUnit?.unitNumber} — {selectedUnit?.sizeSqf ?? '—'} sq ft</div>
                <div><div className="text-xs text-muted-foreground">Billing</div><span className="capitalize">{billing}</span> · {periods} {billing === 'weekly' ? 'weeks' : 'months'}</div>
                <div><div className="text-xs text-muted-foreground">Term</div>{startDate} → {endDate}</div>
                <div><div className="text-xs text-muted-foreground">Rate</div>{formatMoney(Number(effectiveRate))} / {billing === 'weekly' ? 'week' : 'month'}</div>
                <div><div className="text-xs text-muted-foreground">Deposit</div>{formatMoney(Number(deposit || 0))}</div>
              </div>
              <div className="rounded-lg bg-accent px-3 py-2 text-accent-foreground text-xs space-y-0.5">
                <div>
                  Total contract value: <strong>{formatMoney(totalValue)}</strong> · {periods} payments will be scheduled.
                  {autoRenew && <Badge tone="purple" className="ml-2">Auto-renew</Badge>}
                </div>
                {firstMonthDiscount && billing === 'monthly' && (
                  <div className="text-amber-600">
                    First payment: {formatMoney(firstPaymentAmount)} ({discountPct}% off) · Remaining {periods - 1} × {formatMoney(Number(effectiveRate))}
                  </div>
                )}
              </div>
              {overlappingContract && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Cannot create: selected term overlaps with {overlappingContract.contractNo} ({overlappingContract.startDate.slice(0, 10)} to {overlappingContract.endDate.slice(0, 10)}).
                </div>
              )}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-between pt-1">
            <Button variant="outline" onClick={() => (step === 0 ? navigate(-1) : setStep(step - 1))}>
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>
            {step < 3 ? (
              <Button disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</Button>
            ) : (
              <Button disabled={create.isPending || !!overlappingContract} onClick={() => create.mutate()}>
                {create.isPending ? 'Creating…' : 'Create contract'}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

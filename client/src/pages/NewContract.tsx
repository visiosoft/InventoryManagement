import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, apiError } from '../lib/api'
import type { Customer, Unit } from '../lib/types'
import { Badge, Button, Card, CardBody, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui'
import { cn, formatMoney } from '../lib/utils'

function addToDate(date: string, billing: 'weekly' | 'monthly', n: number) {
  const d = new Date(date)
  if (billing === 'weekly') d.setDate(d.getDate() + 7 * n)
  else d.setMonth(d.getMonth() + n)
  return d.toISOString().slice(0, 10)
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
  const [notes, setNotes] = useState('')

  const { data: customers } = useQuery<Customer[]>({
    queryKey: ['customers', ''],
    queryFn: () => api.get('/customers').then((r) => r.data),
  })
  const { data: units, isLoading: unitsLoading } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
  })

  const availableUnits = useMemo(() => (units || []).filter((u) => u.status === 'available' || u._id === unitId), [units, unitId])
  const selectedUnit = useMemo(() => (units || []).find((u) => u._id === unitId), [units, unitId])
  const selectedCustomer = useMemo(() => (customers || []).find((c) => c._id === customerId), [customers, customerId])
  const endDate = useMemo(() => addToDate(startDate, billing, periods), [startDate, billing, periods])

  const defaultRate = selectedUnit ? (billing === 'weekly' ? selectedUnit.unitType?.weeklyRate : selectedUnit.unitType?.monthlyRate) : 0
  const effectiveRate = rate === '' ? defaultRate : rate

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
      }),
    onSuccess: (res) => navigate(`/contracts/${res.data._id}`),
    onError: (e) => setError(apiError(e)),
  })

  const steps = ['Customer', 'Unit', 'Terms', 'Review']
  const canNext = [Boolean(customerId), Boolean(unitId), Boolean(startDate && periods > 0 && effectiveRate > 0), true][step]

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
            <Field label={`Available unit (${availableUnits.length})`}>
              <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                <option value="">Select a unit…</option>
                {availableUnits.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.unitNumber} — {u.unitType?.sizeSqf} sq ft ({formatMoney(u.unitType?.weeklyRate ?? 0)}/wk, {formatMoney(u.unitType?.monthlyRate ?? 0)}/mo)
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Billing period">
                  <Select value={billing} onChange={(e) => { setBilling(e.target.value as 'weekly' | 'monthly'); setRate('') }}>
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
                </Field>
                <Field label="Security deposit">
                  <Input type="number" min={0} step="0.01" value={deposit} placeholder="0.00" onChange={(e) => setDeposit(e.target.value === '' ? '' : Number(e.target.value))} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} className="accent-(--primary)" />
                Auto-renew at end of term
              </label>
              <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </>
          )}

          {step === 3 && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-xs text-muted-foreground">Customer</div>{selectedCustomer?.fullName}</div>
                <div><div className="text-xs text-muted-foreground">Unit</div>{selectedUnit?.unitNumber} — {selectedUnit?.unitType?.sizeSqf} sq ft</div>
                <div><div className="text-xs text-muted-foreground">Billing</div><span className="capitalize">{billing}</span> · {periods} {billing === 'weekly' ? 'weeks' : 'months'}</div>
                <div><div className="text-xs text-muted-foreground">Term</div>{startDate} → {endDate}</div>
                <div><div className="text-xs text-muted-foreground">Rate</div>{formatMoney(Number(effectiveRate))} / {billing === 'weekly' ? 'week' : 'month'}</div>
                <div><div className="text-xs text-muted-foreground">Deposit</div>{formatMoney(Number(deposit || 0))}</div>
              </div>
              <div className="rounded-lg bg-accent px-3 py-2 text-accent-foreground text-xs">
                Total contract value: <strong>{formatMoney(Number(effectiveRate) * periods)}</strong> · {periods} payments will be scheduled.
                {autoRenew && <Badge tone="purple" className="ml-2">Auto-renew</Badge>}
              </div>
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
              <Button disabled={create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Creating…' : 'Create contract'}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

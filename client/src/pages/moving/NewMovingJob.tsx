import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { Customer, MovingJobType } from '../../lib/types'
import { Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Textarea, Modal } from '../../components/ui'

const JOB_TYPES: { value: MovingJobType; label: string }[] = [
  { value: 'local', label: 'Local (same emirate)' },
  { value: 'inter_emirate', label: 'Inter-Emirate' },
  { value: 'international', label: 'International' },
  { value: 'office', label: 'Office Move' },
  { value: 'storage_to_home', label: 'Storage to Home' },
  { value: 'other', label: 'Other' },
]

export default function NewMovingJob() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const leadId = searchParams.get('lead')
  const dateParam = searchParams.get('date')
  const [err, setErr] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [scheduledDate, setScheduledDate] = useState(dateParam || '')
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers-search', customerSearch],
    queryFn: () => api.get('/customers', { params: { q: customerSearch, limit: 20 } }).then(r => r.data.customers ?? r.data),
  })

  const createCustomerMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/customers', body).then(r => r.data),
    onSuccess: (customer) => {
      qc.invalidateQueries({ queryKey: ['customers-search'] })
      setCustomerId(customer._id)
      setCustomerName(customer.fullName)
      setShowCustomerModal(false)
      setCustomerSearch('')
    },
    onError: (e) => setErr(apiError(e)),
  })

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/moving-jobs', body).then(r => r.data),
    onSuccess: (job) => navigate(`/moving/jobs/${job._id}`),
    onError: (e) => setErr(apiError(e)),
  })

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!customerId) { setErr('Please select a customer'); return }
    const f = new FormData(e.currentTarget)
    createMut.mutate({
      customer: customerId,
      lead: leadId || undefined,
      jobType: String(f.get('jobType') || 'local'),
      pickupAddress: String(f.get('pickupAddress') || ''),
      pickupFloor: String(f.get('pickupFloor') || ''),
      pickupHasElevator: f.get('pickupHasElevator') === 'on',
      deliveryAddress: String(f.get('deliveryAddress') || ''),
      deliveryFloor: String(f.get('deliveryFloor') || ''),
      deliveryHasElevator: f.get('deliveryHasElevator') === 'on',
      scheduledDate: scheduledDate || undefined,
      scheduledTimeSlot: String(f.get('scheduledTimeSlot') || ''),
      estimatedDurationHours: f.get('estimatedDurationHours') ? Number(f.get('estimatedDurationHours')) : undefined,
      notes: String(f.get('notes') || ''),
    })
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <PageHeader title="New Moving Job" subtitle="Create a new moving job" />

      <form onSubmit={submit} className="space-y-8">
        <Card>
          <CardHeader title="Customer" action={<Button size="sm" variant="outline" onClick={() => setShowCustomerModal(true)}><Plus size={14} className="mr-1" />New</Button>} />
          <CardBody>
            <div className="space-y-3">
              {!customerId ? (
                <>
                  <Field label="Search or Select Customer">
                    <Input
                      value={customerSearch}
                      onChange={e => setCustomerSearch(e.target.value)}
                      placeholder="Type name, phone, or email…"
                      autoComplete="off"
                    />
                  </Field>
                  {customerSearch && customers.length > 0 && (
                    <div className="border rounded-lg divide-y text-sm max-h-48 overflow-y-auto bg-card">
                      {customers.map(c => (
                        <button
                          key={c._id}
                          type="button"
                          className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                          onClick={() => { setCustomerId(c._id); setCustomerName(c.fullName); setCustomerSearch('') }}
                        >
                          <div className="font-medium">{c.fullName}</div>
                          <div className="text-xs text-muted-foreground">{c.phone || c.email || 'No contact'}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  {customerSearch && customers.length === 0 && (
                    <div className="text-sm text-muted-foreground px-3 py-2 text-center">
                      No customers found. Create a new one using the "New" button.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="px-3 py-2 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
                    <p className="text-sm font-medium text-green-800 dark:text-green-200">✓ Customer selected</p>
                    <p className="text-sm text-green-700 dark:text-green-300 mt-1">{customerName}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { setCustomerId(''); setCustomerName(''); setCustomerSearch('') }}
                  >
                    Change Customer
                  </Button>
                </>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Job Details" />
          <CardBody>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Job Type" className="col-span-2">
                <Select name="jobType" defaultValue="local">
                  {JOB_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
              <Field label="Scheduled Date">
                <Input name="scheduledDate" type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} required />
              </Field>
              <Field label="Time Slot (e.g. 08:00–12:00)">
                <Input name="scheduledTimeSlot" placeholder="08:00–12:00" />
              </Field>
              <Field label="Estimated Duration (hours)">
                <Input name="estimatedDurationHours" type="number" min="0" step="0.5" />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Addresses" />
          <CardBody>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pickup Address" className="col-span-2">
                <Textarea name="pickupAddress" rows={2} placeholder="Full pickup address" />
              </Field>
              <Field label="Pickup Floor">
                <Input name="pickupFloor" placeholder="e.g. 3rd floor" />
              </Field>
              <Field label="Pickup Elevator">
                <label className="flex items-center gap-2 mt-2 text-sm">
                  <input type="checkbox" name="pickupHasElevator" />
                  Has elevator
                </label>
              </Field>
              <Field label="Delivery Address" className="col-span-2">
                <Textarea name="deliveryAddress" rows={2} placeholder="Full delivery address" />
              </Field>
              <Field label="Delivery Floor">
                <Input name="deliveryFloor" placeholder="e.g. Ground floor" />
              </Field>
              <Field label="Delivery Elevator">
                <label className="flex items-center gap-2 mt-2 text-sm">
                  <input type="checkbox" name="deliveryHasElevator" />
                  Has elevator
                </label>
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Notes" />
          <CardBody>
            <Textarea name="notes" rows={3} placeholder="Internal notes…" />
          </CardBody>
        </Card>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-3">
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create Job'}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
        </div>
      </form>

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

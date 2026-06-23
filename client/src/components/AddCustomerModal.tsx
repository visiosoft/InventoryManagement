import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { AccessPerson, Customer } from '../lib/types'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'

const ID_TYPES = ['Emirates ID', 'Passport', 'Other']

function AccessPersonsEditor({ value, onChange }: { value: AccessPerson[]; onChange: (v: AccessPerson[]) => void }) {
  function update(i: number, field: keyof AccessPerson, val: string) {
    onChange(value.map((p, idx) => (idx === i ? { ...p, [field]: val } : p)))
  }
  return (
    <div className="space-y-3">
      {value.map((p, i) => (
        <div key={i} className="rounded-lg border p-3 space-y-2 relative">
          <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            className="absolute top-2 right-2 text-muted-foreground hover:text-destructive">
            <Trash2 size={13} />
          </button>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name"><Input value={p.name} onChange={(e) => update(i, 'name', e.target.value)} placeholder="Full name" required /></Field>
            <Field label="Relation"><Input value={p.relation ?? ''} onChange={(e) => update(i, 'relation', e.target.value)} placeholder="e.g. Spouse, Employee" /></Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="ID Type">
              <Select value={p.idType ?? ''} onChange={(e) => update(i, 'idType', e.target.value)}>
                <option value="">— Select —</option>
                {ID_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="ID Number"><Input value={p.idNumber ?? ''} onChange={(e) => update(i, 'idNumber', e.target.value)} placeholder="784-XXXX-…" /></Field>
            <Field label="Phone"><Input value={p.phone ?? ''} onChange={(e) => update(i, 'phone', e.target.value)} placeholder="+971…" /></Field>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { name: '', phone: '', relation: '', idType: '', idNumber: '' }])}>
        <Plus size={13} /> Add person
      </Button>
    </div>
  )
}

export function CustomerForm({
  initial,
  onSubmit,
  busy,
  error,
  submitLabel = 'Save customer',
}: {
  initial?: Partial<Customer>
  onSubmit: (b: Partial<Customer>) => void
  busy: boolean
  error: string
  submitLabel?: string
}) {
  const [accessPersons, setAccessPersons] = useState<AccessPerson[]>(initial?.accessPersons ?? [])
  const [phones, setPhones] = useState<string[]>(
    initial?.phones?.length ? initial.phones : [initial?.phone ?? '']
  )

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onSubmit({
      fullName: String(f.get('fullName') || ''),
      clientId: String(f.get('clientId') || ''),
      tenantType: (f.get('tenantType') as 'individual' | 'company') || 'individual',
      email: String(f.get('email') || ''),
      phone: phones[0] ?? '',
      phones: phones.filter(Boolean),
      nationality: String(f.get('nationality') || ''),
      emergencyNumber: String(f.get('emergencyNumber') || ''),
      company: String(f.get('company') || ''),
      address: String(f.get('address') || ''),
      emiratesId: String(f.get('emiratesId') || ''),
      eidExpiry: String(f.get('eidExpiry') || '') || undefined,
      passportNumber: String(f.get('passportNumber') || ''),
      passportExpiry: String(f.get('passportExpiry') || '') || undefined,
      accessPersons,
      notes: String(f.get('notes') || ''),
    })
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Full name *"><Input name="fullName" defaultValue={initial?.fullName} required /></Field>
        <Field label="Client ID"><Input name="clientId" defaultValue={initial?.clientId} placeholder="PB-XXXX" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tenant type">
          <Select name="tenantType" defaultValue={initial?.tenantType ?? 'individual'}>
            <option value="individual">Individual</option>
            <option value="company">Company</option>
          </Select>
        </Field>
        <Field label="Nationality"><Input name="nationality" defaultValue={initial?.nationality} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email"><Input name="email" type="email" defaultValue={initial?.email} /></Field>
        <Field label="Company"><Input name="company" defaultValue={initial?.company} /></Field>
      </div>

      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1.5">Phone number(s)</div>
        <div className="space-y-2">
          {phones.map((ph, i) => (
            <div key={i} className="flex gap-2">
              <Input value={ph} onChange={(e) => setPhones(phones.map((p, idx) => idx === i ? e.target.value : p))} placeholder="+971…" />
              {phones.length > 1 && (
                <button type="button" onClick={() => setPhones(phones.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 size={14} /></button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setPhones([...phones, ''])}>
            <Plus size={13} /> Add phone
          </Button>
        </div>
      </div>

      <Field label="Address"><Textarea name="address" defaultValue={initial?.address} /></Field>

      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Identity Documents</div>
        <div className="rounded-lg border p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emirates ID"><Input name="emiratesId" defaultValue={initial?.emiratesId} placeholder="784-XXXX-XXXXXXX-X" /></Field>
            <Field label="EID Expiry"><Input name="eidExpiry" type="date" defaultValue={initial?.eidExpiry?.slice(0, 10)} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Passport number"><Input name="passportNumber" defaultValue={initial?.passportNumber} placeholder="e.g. A12345678" /></Field>
            <Field label="Passport expiry"><Input name="passportExpiry" type="date" defaultValue={initial?.passportExpiry?.slice(0, 10)} /></Field>
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Authorized Access Persons</div>
        <AccessPersonsEditor value={accessPersons} onChange={setAccessPersons} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Emergency number"><Input name="emergencyNumber" defaultValue={initial?.emergencyNumber} /></Field>
      </div>

      <Field label="Notes"><Textarea name="notes" defaultValue={initial?.notes} /></Field>

      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{submitLabel}</Button>
    </form>
  )
}

/**
 * Reusable "Add Customer" modal.
 * Creates the customer, invalidates the cache, then calls onCreated(customer).
 * The modal closes itself on success.
 */
export function AddCustomerModal({
  open,
  onClose,
  onCreated,
  initial,
}: {
  open: boolean
  onClose: () => void
  onCreated: (customer: Customer) => void
  initial?: Partial<Customer>
}) {
  const qc = useQueryClient()
  const [error, setError] = useState('')

  const create = useMutation({
    mutationFn: (body: Partial<Customer>) => api.post<Customer>('/customers', body).then((r) => r.data),
    onSuccess: (customer) => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      setError('')
      onCreated(customer)
      onClose()
    },
    onError: (e) => setError(apiError(e)),
  })

  function handleClose() {
    setError('')
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add customer" wide>
      <CustomerForm
        initial={initial}
        onSubmit={(b) => create.mutate(b)}
        busy={create.isPending}
        error={error}
        submitLabel="Add customer"
      />
    </Modal>
  )
}

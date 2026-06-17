import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { FileText, FileBadge, Receipt, Plus, Search, Trash2, UserCheck } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { AccessPerson, Customer } from '../lib/types'
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '../components/ui'
import { formatDate } from '../lib/utils'

const ID_TYPES = ['Emirates ID', 'Passport', 'Other']

function AccessPersonsEditor({
  value,
  onChange,
}: {
  value: AccessPerson[]
  onChange: (v: AccessPerson[]) => void
}) {
  function update(i: number, field: keyof AccessPerson, val: string) {
    const next = value.map((p, idx) => (idx === i ? { ...p, [field]: val } : p))
    onChange(next)
  }
  function add() {
    onChange([...value, { name: '', phone: '', relation: '', idType: '', idNumber: '' }])
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }

  return (
    <div className="space-y-3">
      {value.map((p, i) => (
        <div key={i} className="rounded-lg border p-3 space-y-2 relative">
          <button
            type="button"
            onClick={() => remove(i)}
            className="absolute top-2 right-2 text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={13} />
          </button>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name">
              <Input value={p.name} onChange={(e) => update(i, 'name', e.target.value)} placeholder="Full name" required />
            </Field>
            <Field label="Relation">
              <Input value={p.relation ?? ''} onChange={(e) => update(i, 'relation', e.target.value)} placeholder="e.g. Spouse, Employee" />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="ID Type">
              <Select value={p.idType ?? ''} onChange={(e) => update(i, 'idType', e.target.value)}>
                <option value="">— Select —</option>
                {ID_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="ID Number">
              <Input value={p.idNumber ?? ''} onChange={(e) => update(i, 'idNumber', e.target.value)} placeholder="784-XXXX-…" />
            </Field>
            <Field label="Phone">
              <Input value={p.phone ?? ''} onChange={(e) => update(i, 'phone', e.target.value)} placeholder="+971…" />
            </Field>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
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
}: {
  initial?: Partial<Customer>
  onSubmit: (b: Partial<Customer>) => void
  busy: boolean
  error: string
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
      {/* Basic info */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Full name *">
          <Input name="fullName" defaultValue={initial?.fullName} required />
        </Field>
        <Field label="Client ID">
          <Input name="clientId" defaultValue={initial?.clientId} placeholder="PB-XXXX" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tenant type">
          <Select name="tenantType" defaultValue={initial?.tenantType ?? 'individual'}>
            <option value="individual">Individual</option>
            <option value="company">Company</option>
          </Select>
        </Field>
        <Field label="Nationality">
          <Input name="nationality" defaultValue={initial?.nationality} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email">
          <Input name="email" type="email" defaultValue={initial?.email} />
        </Field>
        <Field label="Company">
          <Input name="company" defaultValue={initial?.company} />
        </Field>
      </div>

      {/* Phones */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1.5">Phone number(s)</div>
        <div className="space-y-2">
          {phones.map((ph, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={ph}
                onChange={(e) => setPhones(phones.map((p, idx) => idx === i ? e.target.value : p))}
                placeholder="+971…"
              />
              {phones.length > 1 && (
                <button type="button" onClick={() => setPhones(phones.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive shrink-0">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setPhones([...phones, ''])}>
            <Plus size={13} /> Add phone
          </Button>
        </div>
      </div>

      <Field label="Address">
        <Textarea name="address" defaultValue={initial?.address} />
      </Field>

      {/* Identity documents */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Identity Documents</div>
        <div className="rounded-lg border p-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emirates ID">
              <Input name="emiratesId" defaultValue={initial?.emiratesId} placeholder="784-XXXX-XXXXXXX-X" />
            </Field>
            <Field label="EID Expiry">
              <Input name="eidExpiry" type="date" defaultValue={initial?.eidExpiry?.slice(0, 10)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Passport number">
              <Input name="passportNumber" defaultValue={initial?.passportNumber} placeholder="e.g. A12345678" />
            </Field>
            <Field label="Passport expiry">
              <Input name="passportExpiry" type="date" defaultValue={initial?.passportExpiry?.slice(0, 10)} />
            </Field>
          </div>
        </div>
      </div>

      {/* Authorized access persons */}
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Authorized Access Persons
        </div>
        <AccessPersonsEditor value={accessPersons} onChange={setAccessPersons} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Emergency number">
          <Input name="emergencyNumber" defaultValue={initial?.emergencyNumber} />
        </Field>
      </div>

      <Field label="Notes">
        <Textarea name="notes" defaultValue={initial?.notes} />
      </Field>

      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>Save customer</Button>
    </form>
  )
}

export default function Customers() {
  const qc = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [prefill, setPrefill] = useState<Partial<Customer> | null>(null)
  const [error, setError] = useState('')
  const [newCustomer, setNewCustomer] = useState<Customer | null>(null)
  const [actionError, setActionError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    const p = (location.state as { prefill?: Partial<Customer> } | null)?.prefill
    if (p) {
      setPrefill(p)
      setAdding(true)
      window.history.replaceState({}, '')
    }
  }, [location.state])

  const { data: customers, isLoading } = useQuery<Customer[]>({
    queryKey: ['customers', search],
    queryFn: () => api.get('/customers', { params: { search } }).then((r) => r.data),
  })

  const create = useMutation({
    mutationFn: (body: Partial<Customer>) => api.post<Customer>('/customers', body).then((r) => r.data),
    onSuccess: (customer) => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      setPrefill(null)
      setError('')
      setNewCustomer(customer)
    },
    onError: (e) => setError(apiError(e)),
  })

  const removeCustomer = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      setActionError('')
      setDeletingId(null)
    },
    onError: (e) => {
      setActionError(apiError(e))
      setDeletingId(null)
    },
  })

  function onDeleteCustomer(c: Customer) {
    const ok = window.confirm(`Delete customer ${c.fullName}? This cannot be undone.`)
    if (!ok) return
    setDeletingId(c._id)
    removeCustomer.mutate(c._id)
  }

  function closeModal() {
    setAdding(false)
    setNewCustomer(null)
    setPrefill(null)
    setError('')
  }

  function goTo(path: string) {
    closeModal()
    navigate(path)
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${customers?.length ?? 0} customers`}
        action={<Button onClick={() => setAdding(true)}><Plus size={15} /> Add customer</Button>}
      />

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <Card>
          {actionError && <p className="px-4 pt-4 text-xs text-destructive">{actionError}</p>}
          <Table>
            <thead><tr><Th>Name</Th><Th>Client ID</Th><Th>Email</Th><Th>Phone</Th><Th>Nationality</Th><Th>Since</Th><Th /></tr></thead>
            <tbody>
              {(customers || []).map((c) => (
                <tr key={c._id} className="hover:bg-muted/50">
                  <Td>
                    <Link to={`/customers/${c._id}`} className="font-medium text-primary hover:underline">{c.fullName}</Link>
                    {c.tenantType === 'company' && <span className="ml-1.5 text-[10px] text-muted-foreground">(Co.)</span>}
                  </Td>
                  <Td className="text-muted-foreground text-xs">{c.clientId || '—'}</Td>
                  <Td>{c.email || '—'}</Td>
                  <Td>{c.phones?.[0] ?? c.phone ?? '—'}</Td>
                  <Td>{c.nationality || '—'}</Td>
                  <Td>{formatDate(c.createdAt)}</Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      onClick={() => onDeleteCustomer(c)}
                      disabled={removeCustomer.isPending && deletingId === c._id}
                      className="inline-flex items-center gap-1 text-xs text-destructive hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {(customers || []).length === 0 && <EmptyState message="No customers yet. Add your first customer." />}
        </Card>
      )}

      <Modal open={adding} onClose={closeModal} title={newCustomer ? 'Customer added' : 'Add customer'} wide>
        {newCustomer ? (
          <div className="space-y-5">
            {/* Confirmation header */}
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-800/40 dark:bg-emerald-900/20">
              <UserCheck size={20} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="font-semibold text-sm">{newCustomer.fullName}</p>
                {newCustomer.clientId && <p className="text-xs text-muted-foreground">{newCustomer.clientId}</p>}
              </div>
            </div>

            <p className="text-sm text-muted-foreground">What would you like to do next?</p>

            {/* Action cards */}
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => goTo(`/contracts/new?customer=${newCustomer._id}`)}
                className="group rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-md cursor-pointer"
              >
                <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <FileText size={18} />
                </div>
                <p className="font-semibold text-sm">New contract</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Book a storage unit</p>
              </button>

              <button
                onClick={() => goTo(`/quotes/new?customer=${newCustomer._id}`)}
                className="group rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-md cursor-pointer"
              >
                <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <FileBadge size={18} />
                </div>
                <p className="font-semibold text-sm">New quote</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Send a price proposal</p>
              </button>

              <button
                onClick={() => goTo(`/invoices/new?customer=${newCustomer._id}`)}
                className="group rounded-xl border-2 border-border bg-card p-4 text-left transition-all hover:border-primary hover:shadow-md cursor-pointer"
              >
                <div className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Receipt size={18} />
                </div>
                <p className="font-semibold text-sm">New invoice</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Bill the customer</p>
              </button>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-1">
              <Link
                to={`/customers/${newCustomer._id}`}
                onClick={closeModal}
                className="text-xs text-primary hover:underline"
              >
                View customer profile
              </Link>
              <Button variant="outline" onClick={closeModal}>Done</Button>
            </div>
          </div>
        ) : (
          <CustomerForm initial={prefill ?? undefined} onSubmit={(b) => create.mutate(b)} busy={create.isPending} error={error} />
        )}
      </Modal>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { Customer } from '../lib/types'
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Table, Td, Th, Textarea } from '../components/ui'
import { formatDate } from '../lib/utils'

export function CustomerForm({ initial, onSubmit, busy, error }: { initial?: Partial<Customer>; onSubmit: (b: Partial<Customer>) => void; busy: boolean; error: string }) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onSubmit({
      fullName: String(f.get('fullName')),
      email: String(f.get('email') || ''),
      phone: String(f.get('phone') || ''),
      company: String(f.get('company') || ''),
      address: String(f.get('address') || ''),
      notes: String(f.get('notes') || ''),
    })
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Full name"><Input name="fullName" defaultValue={initial?.fullName} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Email"><Input name="email" type="email" defaultValue={initial?.email} /></Field>
        <Field label="Phone"><Input name="phone" defaultValue={initial?.phone} /></Field>
      </div>
      <Field label="Company (optional)"><Input name="company" defaultValue={initial?.company} /></Field>
      <Field label="Address"><Textarea name="address" defaultValue={initial?.address} /></Field>
      <Field label="Notes"><Textarea name="notes" defaultValue={initial?.notes} /></Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>Save customer</Button>
    </form>
  )
}

export default function Customers() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const { data: customers, isLoading } = useQuery<Customer[]>({
    queryKey: ['customers', search],
    queryFn: () => api.get('/customers', { params: { search } }).then((r) => r.data),
  })

  const create = useMutation({
    mutationFn: (body: Partial<Customer>) => api.post('/customers', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] })
      setAdding(false)
      setError('')
    },
    onError: (e) => setError(apiError(e)),
  })

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
          <Table>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Phone</Th><Th>Company</Th><Th>Since</Th></tr></thead>
            <tbody>
              {(customers || []).map((c) => (
                <tr key={c._id} className="hover:bg-muted/50">
                  <Td><Link to={`/customers/${c._id}`} className="font-medium text-primary hover:underline">{c.fullName}</Link></Td>
                  <Td>{c.email || '—'}</Td>
                  <Td>{c.phone || '—'}</Td>
                  <Td>{c.company || '—'}</Td>
                  <Td>{formatDate(c.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {(customers || []).length === 0 && <EmptyState message="No customers yet. Add your first customer." />}
        </Card>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add customer">
        <CustomerForm onSubmit={(b) => create.mutate(b)} busy={create.isPending} error={error} />
      </Modal>
    </div>
  )
}

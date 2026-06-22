import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Search, Users } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingLead, MovingLeadSource, MovingLeadStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '../../components/ui'
import { formatDate } from '../../lib/utils'

const STATUSES: MovingLeadStatus[] = ['new', 'contacted', 'quoted', 'won', 'lost']
const SOURCES: MovingLeadSource[] = ['phone', 'web_form', 'whatsapp', 'referral', 'walk_in', 'other']

const statusTone: Record<MovingLeadStatus, string> = {
  new: 'blue', contacted: 'yellow', quoted: 'purple', won: 'green', lost: 'red',
}

function LeadForm({ initial, busy, error, onSubmit }: {
  initial?: Partial<MovingLead>
  busy: boolean
  error: string
  onSubmit: (body: Record<string, unknown>) => void
}) {
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onSubmit({
      prospectName: String(f.get('prospectName') || ''),
      prospectPhone: String(f.get('prospectPhone') || ''),
      prospectEmail: String(f.get('prospectEmail') || ''),
      source: String(f.get('source') || 'phone'),
      status: String(f.get('status') || 'new'),
      moveDate: f.get('moveDate') || undefined,
      pickupAddress: String(f.get('pickupAddress') || ''),
      deliveryAddress: String(f.get('deliveryAddress') || ''),
      estimatedVolumeCbm: f.get('estimatedVolumeCbm') ? Number(f.get('estimatedVolumeCbm')) : undefined,
      notes: String(f.get('notes') || ''),
    })
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name"><Input name="prospectName" placeholder="Full name" defaultValue={initial?.prospectName} required /></Field>
        <Field label="Phone"><Input name="prospectPhone" placeholder="+971" defaultValue={initial?.prospectPhone} required /></Field>
        <Field label="Email"><Input name="prospectEmail" type="email" placeholder="name@example.com" defaultValue={initial?.prospectEmail} /></Field>
        <Field label="Source">
          <Select name="source" defaultValue={initial?.source ?? 'phone'}>
            {SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={initial?.status ?? 'new'}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Preferred Move Date"><Input name="moveDate" type="date" defaultValue={initial?.moveDate?.slice(0, 10)} /></Field>
        <Field label="Pickup Address" className="col-span-2"><Textarea name="pickupAddress" rows={2} placeholder="Full pickup address" defaultValue={initial?.pickupAddress} /></Field>
        <Field label="Delivery Address" className="col-span-2"><Textarea name="deliveryAddress" rows={2} placeholder="Full delivery address" defaultValue={initial?.deliveryAddress} /></Field>
        <Field label="Est. Volume (CBM)"><Input name="estimatedVolumeCbm" type="number" min="0" step="0.1" placeholder="e.g., 50" defaultValue={initial?.estimatedVolumeCbm} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea name="notes" rows={2} placeholder="Additional information about the lead" defaultValue={initial?.notes} /></Field>
      </div>
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={() => setModal(null)}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add Lead'}</Button>
      </div>
    </form>
  )
}

export default function MovingLeads() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create'>(null)
  const [filterStatus, setFilterStatus] = useState<MovingLeadStatus | ''>('')
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')

  const { data: leads = [], isLoading } = useQuery<MovingLead[]>({
    queryKey: ['moving-leads', filterStatus],
    queryFn: () => api.get('/moving-leads', { params: { status: filterStatus || undefined } }).then(r => r.data),
  })

  const filteredLeads = leads.filter(l =>
    search === '' ||
    (l.prospectName?.toLowerCase() || '').includes(search.toLowerCase()) ||
    (l.prospectPhone?.toLowerCase() || '').includes(search.toLowerCase()) ||
    (l.customer?.fullName?.toLowerCase() || '').includes(search.toLowerCase())
  )

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/moving-leads', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['moving-leads'] }); setModal(null); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  return (
    <div className="space-y-8">
      <PageHeader
        title="Moving Leads"
        subtitle={`${leads.length} total leads in the system`}
        action={
          <Button onClick={() => { setErr(''); setModal('create') }}>
            <Plus size={16} className="mr-2" />
            Add Lead
          </Button>
        }
      />

      {/* Search and Filter Section */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, phone, or email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value as MovingLeadStatus | '')}
              className="w-48"
            >
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        </CardBody>
      </Card>

      {/* Leads Table */}
      <Card>
        <CardBody>
          {isLoading ? (
            <Spinner />
          ) : filteredLeads.length === 0 ? (
            <div className="py-12">
              <div className="flex justify-center mb-3">
                <div className="p-3 rounded-full bg-muted">
                  <Users size={24} className="text-muted-foreground" />
                </div>
              </div>
              <EmptyState message={search ? "No leads match your search" : "No leads found"} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr className="border-b-2 border-muted">
                    <Th className="py-3">Name</Th>
                    <Th className="py-3">Phone</Th>
                    <Th className="py-3">Source</Th>
                    <Th className="py-3">Move Date</Th>
                    <Th className="py-3">Pickup Address</Th>
                    <Th className="py-3">Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map(l => (
                    <tr key={l._id} className="hover:bg-muted/50 transition-colors cursor-pointer">
                      <Td className="py-3">
                        <Link to={`/moving/leads/${l._id}`} className="font-medium text-primary hover:text-primary/80 transition-colors">
                          {l.prospectName || l.customer?.fullName || '—'}
                        </Link>
                      </Td>
                      <Td className="py-3 text-sm font-mono">{l.prospectPhone || l.customer?.phone || '—'}</Td>
                      <Td className="py-3 text-sm capitalize">{l.source.replace(/_/g, ' ')}</Td>
                      <Td className="py-3 text-sm">
                        {l.moveDate ? formatDate(l.moveDate) : <span className="text-muted-foreground">—</span>}
                      </Td>
                      <Td className="py-3 max-w-[200px] truncate text-sm text-muted-foreground">{l.pickupAddress || '—'}</Td>
                      <Td className="py-3">
                        <Badge tone={statusTone[l.status]}>{l.status}</Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Status Reference */}
      <Card>
        <CardHeader title="Lead Status Reference" subtitle="Understanding the lead lifecycle" />
        <CardBody>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {STATUSES.map(status => (
              <div key={status} className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Badge tone={statusTone[status]} className="shrink-0">{status}</Badge>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Modal open={modal !== null} title="Add Moving Lead" onClose={() => setModal(null)}>
        {modal !== null && (
          <LeadForm busy={createMut.isPending} error={err} onSubmit={body => { setErr(''); createMut.mutate(body) }} />
        )}
      </Modal>
    </div>
  )
}

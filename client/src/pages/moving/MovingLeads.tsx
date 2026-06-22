import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input name="prospectName" defaultValue={initial?.prospectName} required /></Field>
        <Field label="Phone"><Input name="prospectPhone" defaultValue={initial?.prospectPhone} required /></Field>
        <Field label="Email"><Input name="prospectEmail" type="email" defaultValue={initial?.prospectEmail} /></Field>
        <Field label="Source">
          <Select name="source" defaultValue={initial?.source ?? 'phone'}>
            {SOURCES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={initial?.status ?? 'new'}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Preferred Move Date"><Input name="moveDate" type="date" defaultValue={initial?.moveDate?.slice(0, 10)} /></Field>
        <Field label="Pickup Address" className="col-span-2"><Textarea name="pickupAddress" rows={2} defaultValue={initial?.pickupAddress} /></Field>
        <Field label="Delivery Address" className="col-span-2"><Textarea name="deliveryAddress" rows={2} defaultValue={initial?.deliveryAddress} /></Field>
        <Field label="Est. Volume (CBM)"><Input name="estimatedVolumeCbm" type="number" min="0" step="0.1" defaultValue={initial?.estimatedVolumeCbm} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea name="notes" rows={2} defaultValue={initial?.notes} /></Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )
}

export default function MovingLeads() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create'>(null)
  const [filterStatus, setFilterStatus] = useState<MovingLeadStatus | ''>('')
  const [err, setErr] = useState('')

  const { data: leads = [], isLoading } = useQuery<MovingLead[]>({
    queryKey: ['moving-leads', filterStatus],
    queryFn: () => api.get('/moving-leads', { params: { status: filterStatus || undefined } }).then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/moving-leads', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['moving-leads'] }); setModal(null); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  return (
    <div className="space-y-8">
      <PageHeader
        title="Moving Leads"
        subtitle={`${leads.length} leads`}
        action={<Button onClick={() => { setErr(''); setModal('create') }}><Plus size={15} className="mr-1" />Add Lead</Button>}
      />

      <Card>
        <CardHeader title="Leads" action={<Select value={filterStatus} onChange={e => setFilterStatus(e.target.value as MovingLeadStatus | '')}><option value="">All Statuses</option>{STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</Select>} />
        <CardBody>
          {isLoading ? <Spinner /> : leads.length === 0 ? <EmptyState message="No leads found" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Phone</Th>
                  <Th>Source</Th>
                  <Th>Move Date</Th>
                  <Th>Pickup</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {leads.map(l => (
                  <tr key={l._id} className="hover:bg-muted/30">
                    <Td>
                      <Link to={`/moving/leads/${l._id}`} className="font-medium hover:underline text-primary">
                        {l.prospectName || l.customer?.fullName || '—'}
                      </Link>
                    </Td>
                    <Td>{l.prospectPhone || l.customer?.phone || '—'}</Td>
                    <Td className="capitalize">{l.source.replace('_', ' ')}</Td>
                    <Td>{l.moveDate ? formatDate(l.moveDate) : '—'}</Td>
                    <Td className="max-w-[180px] truncate text-sm text-muted-foreground">{l.pickupAddress || '—'}</Td>
                    <Td><Badge tone={statusTone[l.status]}>{l.status}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
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

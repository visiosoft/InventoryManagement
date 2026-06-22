import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { Worker, WorkerRole, WorkerStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '../../components/ui'

const ROLES: WorkerRole[] = ['driver', 'helper', 'supervisor', 'packer']
const STATUSES: WorkerStatus[] = ['active', 'inactive', 'on_leave']

const statusTone: Record<WorkerStatus, string> = {
  active: 'green',
  inactive: 'gray',
  on_leave: 'yellow',
}

function WorkerForm({ initial, busy, error, onSubmit }: {
  initial?: Partial<Worker>
  busy: boolean
  error: string
  onSubmit: (body: Record<string, unknown>) => void
}) {
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onSubmit({
      name: String(f.get('name') || ''),
      phone: String(f.get('phone') || ''),
      email: String(f.get('email') || ''),
      role: String(f.get('role') || 'helper'),
      dailyRate: Number(f.get('dailyRate') || 0),
      status: String(f.get('status') || 'active'),
      emergencyContact: String(f.get('emergencyContact') || ''),
      notes: String(f.get('notes') || ''),
    })
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input name="name" defaultValue={initial?.name} required /></Field>
        <Field label="Role">
          <Select name="role" defaultValue={initial?.role ?? 'helper'}>
            {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label="Phone"><Input name="phone" defaultValue={initial?.phone} /></Field>
        <Field label="Email"><Input name="email" type="email" defaultValue={initial?.email} /></Field>
        <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" step="0.01" defaultValue={initial?.dailyRate ?? 0} /></Field>
        <Field label="Status">
          <Select name="status" defaultValue={initial?.status ?? 'active'}>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Emergency Contact" className="col-span-2"><Input name="emergencyContact" defaultValue={initial?.emergencyContact} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea name="notes" rows={2} defaultValue={initial?.notes} /></Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )
}

export default function Workers() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create' | Worker>(null)
  const [err, setErr] = useState('')

  const { data: workers = [], isLoading } = useQuery<Worker[]>({
    queryKey: ['workers'],
    queryFn: () => api.get('/workers').then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/workers', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workers'] }); setModal(null); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`/workers/${id}`, body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workers'] }); setModal(null); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  function handleSubmit(body: Record<string, unknown>) {
    setErr('')
    if (modal === 'create') createMut.mutate(body)
    else if (modal && typeof modal === 'object') updateMut.mutate({ id: modal._id, body })
  }

  const busy = createMut.isPending || updateMut.isPending

  return (
    <div className="space-y-8">
      <PageHeader
        title="Workers"
        subtitle="Moving crew members"
        action={<Button onClick={() => { setErr(''); setModal('create') }}><Plus size={15} className="mr-1" />Add Worker</Button>}
      />

      <Card>
        <CardBody>
          {isLoading ? <Spinner /> : workers.length === 0 ? <EmptyState message="No workers yet" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Phone</Th>
                  <Th>Daily Rate</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {workers.map(w => (
                  <tr key={w._id} className="hover:bg-muted/30">
                    <Td className="font-medium">{w.name}</Td>
                    <Td className="capitalize">{w.role}</Td>
                    <Td>{w.phone || '—'}</Td>
                    <Td>AED {w.dailyRate?.toLocaleString()}</Td>
                    <Td>
                      <Badge tone={statusTone[w.status]}>{w.status.replace('_', ' ')}</Badge>
                    </Td>
                    <Td>
                      <button onClick={() => { setErr(''); setModal(w) }} className="text-muted-foreground hover:text-foreground">
                        <Pencil size={14} />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={modal !== null}
        title={modal === 'create' ? 'Add Worker' : 'Edit Worker'}
        onClose={() => setModal(null)}
      >
        {modal !== null && (
          <WorkerForm
            initial={modal === 'create' ? undefined : modal}
            busy={busy}
            error={err}
            onSubmit={handleSubmit}
          />
        )}
      </Modal>
    </div>
  )
}

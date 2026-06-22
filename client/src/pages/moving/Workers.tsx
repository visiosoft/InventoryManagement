import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Users } from 'lucide-react'
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

const roleTone: Record<WorkerRole, string> = {
  driver: 'blue',
  helper: 'purple',
  supervisor: 'emerald',
  packer: 'amber',
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
      <div className="grid grid-cols-2 gap-4">
        <Field label="Full Name"><Input name="name" placeholder="Worker name" defaultValue={initial?.name} required /></Field>
        <Field label="Role">
          <Select name="role" defaultValue={initial?.role ?? 'helper'}>
            {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label="Phone"><Input name="phone" placeholder="+971" defaultValue={initial?.phone} /></Field>
        <Field label="Email"><Input name="email" type="email" placeholder="name@example.com" defaultValue={initial?.email} /></Field>
        <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" step="0.01" placeholder="0.00" defaultValue={initial?.dailyRate ?? 0} /></Field>
        <Field label="Status">
          <Select name="status" defaultValue={initial?.status ?? 'active'}>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Emergency Contact" className="col-span-2"><Input name="emergencyContact" placeholder="Contact number or name" defaultValue={initial?.emergencyContact} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea name="notes" rows={2} placeholder="Additional information about this worker" defaultValue={initial?.notes} /></Field>
      </div>
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={() => setModal(null)}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Update' : 'Add'} Worker</Button>
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

  const activeWorkers = workers.filter(w => w.status === 'active').length
  const totalPayroll = workers.reduce((sum, w) => sum + (w.dailyRate || 0), 0)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Crew Management"
        subtitle={`${workers.length} total workers • ${activeWorkers} active`}
        action={
          <Button onClick={() => { setErr(''); setModal('create') }}>
            <Plus size={16} className="mr-2" />
            Add Worker
          </Button>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-6">
        <Card>
          <CardBody className="p-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Total Workers</p>
            <p className="text-3xl font-bold text-foreground">{workers.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{activeWorkers} currently active</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Average Daily Rate</p>
            <p className="text-3xl font-bold text-foreground">AED {(workers.length > 0 ? (totalPayroll / workers.length).toFixed(0) : '0')}</p>
            <p className="text-xs text-muted-foreground mt-1">Per worker per day</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Total Payroll</p>
            <p className="text-3xl font-bold text-foreground">AED {totalPayroll.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Daily operational cost</p>
          </CardBody>
        </Card>
      </div>

      {/* Workers Table */}
      <Card>
        <CardBody>
          {isLoading ? (
            <Spinner />
          ) : workers.length === 0 ? (
            <div className="py-12">
              <div className="flex justify-center mb-3">
                <div className="p-3 rounded-full bg-muted">
                  <Users size={24} className="text-muted-foreground" />
                </div>
              </div>
              <EmptyState message="No workers yet. Add your first crew member." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr className="border-b-2 border-muted">
                    <Th className="py-3">Name</Th>
                    <Th className="py-3">Role</Th>
                    <Th className="py-3">Phone</Th>
                    <Th className="py-3">Daily Rate</Th>
                    <Th className="py-3">Status</Th>
                    <Th className="py-3">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map(w => (
                    <tr key={w._id} className="hover:bg-muted/50 transition-colors">
                      <Td className="py-3 font-medium">{w.name}</Td>
                      <Td className="py-3">
                        <Badge tone={roleTone[w.role as WorkerRole]} className="text-xs">
                          {w.role.charAt(0).toUpperCase() + w.role.slice(1)}
                        </Badge>
                      </Td>
                      <Td className="py-3 text-sm font-mono">{w.phone || '—'}</Td>
                      <Td className="py-3 font-semibold">AED {w.dailyRate?.toLocaleString()}</Td>
                      <Td className="py-3">
                        <Badge tone={statusTone[w.status]}>{w.status.replace(/_/g, ' ')}</Badge>
                      </Td>
                      <Td className="py-3 text-right">
                        <button
                          onClick={() => { setErr(''); setModal(w) }}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit worker"
                        >
                          <Pencil size={16} />
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Role Reference */}
      <Card>
        <CardHeader title="Worker Roles" subtitle="Different crew member roles and responsibilities" />
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {ROLES.map(role => (
              <div key={role} className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Badge tone={roleTone[role]} className="shrink-0 text-xs">
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </Badge>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Modal
        open={modal !== null}
        title={modal === 'create' ? 'Add New Worker' : 'Edit Worker'}
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

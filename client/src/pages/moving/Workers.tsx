import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Users, Search, Phone } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { Worker, WorkerRole, WorkerStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '../../components/ui'
import { cn } from '../../lib/utils'

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

function WorkerForm({ initial, busy, error, onSubmit, onCancel }: {
  initial?: Partial<Worker>
  busy: boolean
  error: string
  onSubmit: (body: Record<string, unknown>) => void
  onCancel: () => void
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
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Update' : 'Add'} Worker</Button>
      </div>
    </form>
  )
}

export default function Workers() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create' | Worker>(null)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState<WorkerRole | ''>('')
  const [filterStatus, setFilterStatus] = useState<WorkerStatus | ''>('')

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

  const activeWorkers = workers.filter(w => w.status === 'active')
  const avgRate = activeWorkers.length > 0 ? activeWorkers.reduce((s, w) => s + (w.dailyRate || 0), 0) / activeWorkers.length : 0
  const dailyCost = activeWorkers.reduce((s, w) => s + (w.dailyRate || 0), 0)

  const filtered = workers.filter(w => {
    const matchSearch = !search || w.name.toLowerCase().includes(search.toLowerCase()) || (w.phone ?? '').includes(search)
    const matchRole = !filterRole || w.role === filterRole
    const matchStatus = !filterStatus || w.status === filterStatus
    return matchSearch && matchRole && matchStatus
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Crew Management"
        subtitle={`${workers.length} workers · ${activeWorkers.length} active`}
        action={
          <Button size="sm" onClick={() => { setErr(''); setModal('create') }} className="gap-1.5">
            <Plus size={14} />Add Worker
          </Button>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Active Crew</p>
          <p className="text-2xl font-bold text-foreground">{activeWorkers.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{workers.filter(w => w.status === 'on_leave').length} on leave</p>
        </CardBody></Card>
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Avg Daily Rate</p>
          <p className="text-2xl font-bold text-foreground">AED {avgRate.toFixed(0)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">per active worker</p>
        </CardBody></Card>
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Daily Crew Cost</p>
          <p className="text-2xl font-bold text-foreground">AED {dailyCost.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-0.5">active workers only</p>
        </CardBody></Card>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search by name or phone…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterRole} onChange={e => setFilterRole(e.target.value as WorkerRole | '')} className="sm:w-36">
          <option value="">All Roles</option>
          {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
        </Select>
        <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value as WorkerStatus | '')} className="sm:w-36">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </Select>
      </div>

      {/* Workers list */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <Card><CardBody className="py-12 text-center">
          <Users size={32} className="mx-auto mb-3 text-muted-foreground opacity-30" />
          <p className="text-sm font-medium text-foreground mb-1">{workers.length === 0 ? 'No workers yet' : 'No matches'}</p>
          <p className="text-sm text-muted-foreground">{workers.length === 0 ? 'Add your first crew member to get started' : 'Try adjusting your search or filter'}</p>
        </CardBody></Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map(w => (
              <div key={w._id} className="flex items-center gap-3 p-4 bg-card rounded-xl border">
                <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                  w.status === 'active' ? 'bg-emerald-500/10 text-emerald-700' :
                  w.status === 'on_leave' ? 'bg-amber-500/10 text-amber-700' : 'bg-muted text-muted-foreground'
                )}>
                  {w.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-foreground truncate">{w.name}</p>
                    <Badge tone={statusTone[w.status]} className="text-xs py-0 h-4">{w.status.replace(/_/g, ' ')}</Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <Badge tone={roleTone[w.role as WorkerRole]} className="text-xs">{w.role}</Badge>
                    {w.phone && <span className="flex items-center gap-1"><Phone size={10} />{w.phone}</span>}
                    <span className="ml-auto font-semibold text-foreground">AED {w.dailyRate?.toLocaleString()}/day</span>
                  </div>
                </div>
                <button onClick={() => { setErr(''); setModal(w) }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  <Pencil size={15} />
                </button>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <Card className="hidden md:block">
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr className="border-b border-muted">
                      <Th className="py-3 pl-4">Name</Th>
                      <Th className="py-3">Role</Th>
                      <Th className="py-3">Phone</Th>
                      <Th className="py-3 text-right">Daily Rate</Th>
                      <Th className="py-3">Status</Th>
                      <Th className="py-3 pr-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(w => (
                      <tr key={w._id} className="hover:bg-muted/40 transition-colors border-b border-muted/50 last:border-0">
                        <Td className="py-3 pl-4">
                          <div className="flex items-center gap-2.5">
                            <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                              w.status === 'active' ? 'bg-emerald-500/10 text-emerald-700' :
                              w.status === 'on_leave' ? 'bg-amber-500/10 text-amber-700' : 'bg-muted text-muted-foreground'
                            )}>
                              {w.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium text-sm">{w.name}</span>
                          </div>
                        </Td>
                        <Td className="py-3">
                          <Badge tone={roleTone[w.role as WorkerRole]} className="text-xs">{w.role}</Badge>
                        </Td>
                        <Td className="py-3 text-sm font-mono text-muted-foreground">{w.phone || '—'}</Td>
                        <Td className="py-3 text-right font-semibold text-sm">AED {w.dailyRate?.toLocaleString()}</Td>
                        <Td className="py-3">
                          <Badge tone={statusTone[w.status]} className="text-xs">{w.status.replace(/_/g, ' ')}</Badge>
                        </Td>
                        <Td className="py-3 pr-4 text-right">
                          <button onClick={() => { setErr(''); setModal(w) }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                            <Pencil size={15} />
                          </button>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </CardBody>
          </Card>
        </>
      )}

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
            onCancel={() => setModal(null)}
          />
        )}
      </Modal>
    </div>
  )
}

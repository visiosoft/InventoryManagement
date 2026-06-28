import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Truck as TruckIcon, AlertTriangle, Search } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { Truck, TruckType, TruckStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '../../components/ui'
import { cn } from '../../lib/utils'

const TYPES: TruckType[] = ['small', 'medium', 'large', 'extra_large']
const STATUSES: TruckStatus[] = ['available', 'in_use', 'maintenance']

const statusTone: Record<TruckStatus, string> = {
  available: 'green',
  in_use: 'blue',
  maintenance: 'yellow',
}

const typeTone: Record<TruckType, string> = {
  small: 'blue',
  medium: 'purple',
  large: 'amber',
  extra_large: 'red',
}

function TruckForm({ initial, busy, error, onSubmit, onCancel }: {
  initial?: Partial<Truck>
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
      plateNumber: String(f.get('plateNumber') || ''),
      type: String(f.get('type') || 'medium'),
      capacityCbm: f.get('capacityCbm') ? Number(f.get('capacityCbm')) : undefined,
      dailyRate: Number(f.get('dailyRate') || 0),
      status: String(f.get('status') || 'available'),
      lastServiceDate: f.get('lastServiceDate') || undefined,
      nextServiceDate: f.get('nextServiceDate') || undefined,
      notes: String(f.get('notes') || ''),
    })
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Truck Name"><Input name="name" placeholder="e.g., Moving Truck 1" defaultValue={initial?.name} required /></Field>
        <Field label="License Plate"><Input name="plateNumber" placeholder="e.g., ABC 123" defaultValue={initial?.plateNumber} /></Field>
        <Field label="Truck Type">
          <Select name="type" defaultValue={initial?.type ?? 'medium'}>
            {TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').toUpperCase()}</option>)}
          </Select>
        </Field>
        <Field label="Capacity (CBM)"><Input name="capacityCbm" type="number" min="0" step="0.1" placeholder="e.g., 50" defaultValue={initial?.capacityCbm} /></Field>
        <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" step="0.01" placeholder="e.g., 200" defaultValue={initial?.dailyRate ?? 0} /></Field>
        <Field label="Current Status">
          <Select name="status" defaultValue={initial?.status ?? 'available'}>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Next Service Date"><Input name="nextServiceDate" type="date" defaultValue={initial?.nextServiceDate?.slice(0, 10)} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea name="notes" rows={2} placeholder="Additional notes about this truck" defaultValue={initial?.notes} /></Field>
      </div>
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Update' : 'Add'} Truck</Button>
      </div>
    </form>
  )
}

export default function Fleet() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create' | Truck>(null)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')

  const { data: trucks = [], isLoading } = useQuery<Truck[]>({
    queryKey: ['trucks'],
    queryFn: () => api.get('/trucks').then(r => r.data),
  })

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/trucks', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['trucks'] }); setModal(null); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.put(`/trucks/${id}`, body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['trucks'] }); setModal(null); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  function handleSubmit(body: Record<string, unknown>) {
    setErr('')
    if (modal === 'create') createMut.mutate(body)
    else if (modal && typeof modal === 'object') updateMut.mutate({ id: modal._id, body })
  }

  const busy = createMut.isPending || updateMut.isPending

  const availableTrucks = trucks.filter(t => t.status === 'available').length
  const inUseTrucks = trucks.filter(t => t.status === 'in_use').length
  const totalCapacity = trucks.reduce((sum, t) => sum + (t.capacityCbm || 0), 0)
  const today = new Date()
  const overdueService = trucks.filter(t => t.nextServiceDate && new Date(t.nextServiceDate) < today)

  const filtered = trucks.filter(t =>
    !search ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.plateNumber ?? '').toLowerCase().includes(search.toLowerCase())
  )

  function serviceLabel(dateStr?: string) {
    if (!dateStr) return null
    const d = new Date(dateStr)
    const overdue = d < today
    const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    return { label, overdue }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Fleet Management"
        subtitle={`${trucks.length} vehicles · ${availableTrucks} available`}
        action={
          <Button size="sm" onClick={() => { setErr(''); setModal('create') }} className="gap-1.5">
            <Plus size={14} />Add Truck
          </Button>
        }
      />

      {/* Overdue service alert */}
      {overdueService.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Service overdue for {overdueService.length} truck{overdueService.length > 1 ? 's' : ''}</p>
            <p className="text-xs text-amber-700 mt-0.5">{overdueService.map(t => t.name).join(', ')}</p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Total Fleet</p>
          <p className="text-2xl font-bold text-foreground">{trucks.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">vehicles</p>
        </CardBody></Card>
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Available</p>
          <p className="text-2xl font-bold text-emerald-600">{availableTrucks}</p>
          <p className="text-xs text-muted-foreground mt-0.5">ready to deploy</p>
        </CardBody></Card>
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">In Use</p>
          <p className="text-2xl font-bold text-blue-600">{inUseTrucks}</p>
          <p className="text-xs text-muted-foreground mt-0.5">on active jobs</p>
        </CardBody></Card>
        <Card><CardBody className="p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Total Capacity</p>
          <p className="text-2xl font-bold text-foreground">{totalCapacity}</p>
          <p className="text-xs text-muted-foreground mt-0.5">CBM combined</p>
        </CardBody></Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search by truck name or plate…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Fleet list */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <Card><CardBody className="py-12 text-center">
          <TruckIcon size={32} className="mx-auto mb-3 text-muted-foreground opacity-30" />
          <p className="text-sm font-medium">{trucks.length === 0 ? 'No trucks in fleet yet' : 'No trucks match your search'}</p>
        </CardBody></Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map(t => {
              const svc = serviceLabel(t.nextServiceDate)
              return (
                <div key={t._id} className="flex items-start gap-3 p-4 bg-card rounded-xl border">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-semibold">{t.name}</p>
                      {t.plateNumber && <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{t.plateNumber}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone={typeTone[t.type as TruckType]} className="text-xs">{t.type?.replace(/_/g, ' ')}</Badge>
                      <Badge tone={statusTone[t.status]} className="text-xs">{t.status.replace(/_/g, ' ')}</Badge>
                      {t.capacityCbm && <span className="text-muted-foreground">{t.capacityCbm} CBM</span>}
                      {(t.dailyRate ?? 0) > 0 && <span className="text-muted-foreground">AED {t.dailyRate?.toLocaleString()}/day</span>}
                    </div>
                    {svc && (
                      <p className={cn('text-xs mt-1 flex items-center gap-1', svc.overdue ? 'text-amber-600 font-medium' : 'text-muted-foreground')}>
                        {svc.overdue && <AlertTriangle size={11} />}
                        Service: {svc.label}
                      </p>
                    )}
                  </div>
                  <button onClick={() => { setErr(''); setModal(t) }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    <Pencil size={15} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <Card className="hidden md:block">
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr className="border-b border-muted">
                      <Th className="py-3 pl-4">Truck</Th>
                      <Th className="py-3">Plate</Th>
                      <Th className="py-3">Type</Th>
                      <Th className="py-3">Capacity</Th>
                      <Th className="py-3 text-right">Daily Rate</Th>
                      <Th className="py-3">Next Service</Th>
                      <Th className="py-3">Status</Th>
                      <Th className="py-3 pr-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(t => {
                      const svc = serviceLabel(t.nextServiceDate)
                      return (
                        <tr key={t._id} className={cn('hover:bg-muted/40 transition-colors border-b border-muted/50 last:border-0', svc?.overdue && 'bg-amber-500/5')}>
                          <Td className="py-3 pl-4 font-medium text-sm">{t.name}</Td>
                          <Td className="py-3 text-sm font-mono font-semibold text-muted-foreground">{t.plateNumber || '—'}</Td>
                          <Td className="py-3">
                            <Badge tone={typeTone[t.type as TruckType]} className="text-xs">{t.type?.replace(/_/g, ' ').toUpperCase()}</Badge>
                          </Td>
                          <Td className="py-3 text-sm">{t.capacityCbm ? `${t.capacityCbm} CBM` : '—'}</Td>
                          <Td className="py-3 text-right text-sm font-semibold">{(t.dailyRate ?? 0) > 0 ? `AED ${t.dailyRate?.toLocaleString()}` : '—'}</Td>
                          <Td className="py-3 text-sm">
                            {svc ? (
                              <span className={cn('flex items-center gap-1', svc.overdue && 'text-amber-600 font-medium')}>
                                {svc.overdue && <AlertTriangle size={12} />}
                                {svc.label}
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </Td>
                          <Td className="py-3">
                            <Badge tone={statusTone[t.status]} className="text-xs">{t.status.replace(/_/g, ' ')}</Badge>
                          </Td>
                          <Td className="py-3 pr-4 text-right">
                            <button onClick={() => { setErr(''); setModal(t) }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                              <Pencil size={15} />
                            </button>
                          </Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              </div>
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={modal !== null}
        title={modal === 'create' ? 'Add New Truck' : 'Edit Truck'}
        onClose={() => setModal(null)}
      >
        {modal !== null && (
          <TruckForm
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

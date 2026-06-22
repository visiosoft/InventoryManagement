import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Truck as TruckIcon } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { Truck, TruckType, TruckStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '../../components/ui'

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

function TruckForm({ initial, busy, error, onSubmit }: {
  initial?: Partial<Truck>
  busy: boolean
  error: string
  onSubmit: (body: Record<string, unknown>) => void
}) {
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onSubmit({
      name: String(f.get('name') || ''),
      plateNumber: String(f.get('plateNumber') || ''),
      type: String(f.get('type') || 'medium'),
      capacityCbm: f.get('capacityCbm') ? Number(f.get('capacityCbm')) : undefined,
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
        <Button type="button" variant="outline" onClick={() => setModal(null)}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Update' : 'Add'} Truck</Button>
      </div>
    </form>
  )
}

export default function Fleet() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create' | Truck>(null)
  const [err, setErr] = useState('')

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
  const maintenanceTrucks = trucks.filter(t => t.status === 'maintenance').length
  const totalCapacity = trucks.reduce((sum, t) => sum + (t.capacityCbm || 0), 0)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Fleet Management"
        subtitle={`${trucks.length} total vehicles • ${availableTrucks} available`}
        action={
          <Button onClick={() => { setErr(''); setModal('create') }}>
            <Plus size={16} className="mr-2" />
            Add Truck
          </Button>
        }
      />

      {/* Fleet Summary Cards */}
      <div className="grid grid-cols-4 gap-6">
        <Card>
          <CardBody className="p-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Total Fleet</p>
            <p className="text-3xl font-bold text-foreground">{trucks.length}</p>
            <p className="text-xs text-muted-foreground mt-1">vehicles in fleet</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Available</p>
            <p className="text-3xl font-bold text-emerald-600">{availableTrucks}</p>
            <p className="text-xs text-muted-foreground mt-1">ready to use</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">In Use</p>
            <p className="text-3xl font-bold text-blue-600">{inUseTrucks}</p>
            <p className="text-xs text-muted-foreground mt-1">on active jobs</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-6">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Total Capacity</p>
            <p className="text-3xl font-bold text-foreground">{totalCapacity}</p>
            <p className="text-xs text-muted-foreground mt-1">CBM combined</p>
          </CardBody>
        </Card>
      </div>

      {/* Fleet Table */}
      <Card>
        <CardBody>
          {isLoading ? (
            <Spinner />
          ) : trucks.length === 0 ? (
            <div className="py-12">
              <div className="flex justify-center mb-3">
                <div className="p-3 rounded-full bg-muted">
                  <TruckIcon size={24} className="text-muted-foreground" />
                </div>
              </div>
              <EmptyState message="No trucks in fleet. Add your first vehicle." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr className="border-b-2 border-muted">
                    <Th className="py-3">Truck Name</Th>
                    <Th className="py-3">License Plate</Th>
                    <Th className="py-3">Type</Th>
                    <Th className="py-3">Capacity</Th>
                    <Th className="py-3">Next Service</Th>
                    <Th className="py-3">Status</Th>
                    <Th className="py-3">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {trucks.map(t => (
                    <tr key={t._id} className="hover:bg-muted/50 transition-colors">
                      <Td className="py-3 font-medium">{t.name}</Td>
                      <Td className="py-3 text-sm font-mono font-semibold">{t.plateNumber || '—'}</Td>
                      <Td className="py-3">
                        <Badge tone={typeTone[t.type as TruckType]} className="text-xs">
                          {t.type?.replace(/_/g, ' ').toUpperCase()}
                        </Badge>
                      </Td>
                      <Td className="py-3 font-semibold">{t.capacityCbm ? `${t.capacityCbm} CBM` : '—'}</Td>
                      <Td className="py-3 text-sm">
                        {t.nextServiceDate
                          ? new Date(t.nextServiceDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                          : <span className="text-muted-foreground">—</span>}
                      </Td>
                      <Td className="py-3">
                        <Badge tone={statusTone[t.status]}>{t.status.replace(/_/g, ' ')}</Badge>
                      </Td>
                      <Td className="py-3 text-right">
                        <button
                          onClick={() => { setErr(''); setModal(t) }}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit truck"
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

      {/* Truck Type Reference */}
      <Card>
        <CardHeader title="Truck Types" subtitle="Available vehicle classes and capacity ranges" />
        <CardBody>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {TYPES.map(type => (
              <div key={type} className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Badge tone={typeTone[type]} className="shrink-0 text-xs">
                  {type.replace(/_/g, ' ').toUpperCase()}
                </Badge>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

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
          />
        )}
      </Modal>
    </div>
  )
}

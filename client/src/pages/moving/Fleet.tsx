import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { Truck, TruckType, TruckStatus } from '../../lib/types'
import { Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '../../components/ui'

const TYPES: TruckType[] = ['small', 'medium', 'large', 'extra_large']
const STATUSES: TruckStatus[] = ['available', 'in_use', 'maintenance']

const statusTone: Record<TruckStatus, string> = {
  available: 'green',
  in_use: 'blue',
  maintenance: 'yellow',
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><Input name="name" defaultValue={initial?.name} required /></Field>
        <Field label="Plate Number"><Input name="plateNumber" defaultValue={initial?.plateNumber} /></Field>
        <Field label="Type">
          <Select name="type" defaultValue={initial?.type ?? 'medium'}>
            {TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Capacity (CBM)"><Input name="capacityCbm" type="number" min="0" step="0.1" defaultValue={initial?.capacityCbm} /></Field>
        <Field label="Status">
          <Select name="status" defaultValue={initial?.status ?? 'available'}>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Next Service Date"><Input name="nextServiceDate" type="date" defaultValue={initial?.nextServiceDate?.slice(0, 10)} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea name="notes" rows={2} defaultValue={initial?.notes} /></Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
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

  return (
    <div className="space-y-8">
      <PageHeader
        title="Fleet"
        subtitle="Trucks and vehicles"
        action={<Button onClick={() => { setErr(''); setModal('create') }}><Plus size={15} className="mr-1" />Add Truck</Button>}
      />

      <Card>
        <CardBody>
          {isLoading ? <Spinner /> : trucks.length === 0 ? <EmptyState message="No trucks yet" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Plate</Th>
                  <Th>Type</Th>
                  <Th>Capacity</Th>
                  <Th>Next Service</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {trucks.map(t => (
                  <tr key={t._id} className="hover:bg-muted/30">
                    <Td className="font-medium">{t.name}</Td>
                    <Td>{t.plateNumber || '—'}</Td>
                    <Td className="capitalize">{t.type?.replace('_', ' ')}</Td>
                    <Td>{t.capacityCbm ? `${t.capacityCbm} CBM` : '—'}</Td>
                    <Td>{t.nextServiceDate ? new Date(t.nextServiceDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</Td>
                    <Td>
                      <Badge tone={statusTone[t.status]}>{t.status.replace('_', ' ')}</Badge>
                    </Td>
                    <Td>
                      <button onClick={() => { setErr(''); setModal(t) }} className="text-muted-foreground hover:text-foreground">
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
        title={modal === 'create' ? 'Add Truck' : 'Edit Truck'}
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

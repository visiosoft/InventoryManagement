import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { LayoutGrid, List, Plus } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { Unit, UnitType, Contract } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea, statusLabel, unitStatusTone } from '../components/ui'
import { cn, formatDate } from '../lib/utils'

const statusColor: Record<string, string> = {
  available: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25',
  occupied: 'bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-400 hover:bg-violet-500/25',
  reserved: 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25',
  maintenance: 'bg-muted border-border text-muted-foreground hover:bg-muted/70',
}

export default function Units() {
  const qc = useQueryClient()
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState<Unit | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const { data: units, isLoading } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
  })
  const { data: types } = useQuery<UnitType[]>({
    queryKey: ['unit-types'],
    queryFn: () => api.get('/unit-types').then((r) => r.data),
  })

  const filtered = useMemo(
    () =>
      (units || []).filter(
        (u) => (!statusFilter || u.status === statusFilter) && (!typeFilter || u.unitType?._id === typeFilter)
      ),
    [units, statusFilter, typeFilter]
  )

  const grouped = useMemo(() => {
    const map = new Map<number, Unit[]>()
    for (const u of filtered) {
      const k = u.unitType?.sizeSqf ?? 0
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(u)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [filtered])

  const createUnit = useMutation({
    mutationFn: (body: { unitNumber: string; unitType: string; status: string; notes: string }) => api.post('/units', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['units'] })
      setAdding(false)
      setError('')
    },
    onError: (e) => setError(apiError(e)),
  })

  const updateUnit = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; notes?: string }) => api.put(`/units/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['units'] })
      setSelected(null)
    },
    onError: (e) => setError(apiError(e)),
  })

  function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    createUnit.mutate({
      unitNumber: String(f.get('unitNumber')),
      unitType: String(f.get('unitType')),
      status: String(f.get('status')),
      notes: String(f.get('notes') || ''),
    })
  }

  if (isLoading) return <Spinner />

  return (
    <div>
      <PageHeader
        title="Units"
        subtitle={`${filtered.length} units · ${filtered.filter((u) => u.status === 'available').length} available`}
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border bg-card p-0.5">
              <button onClick={() => setView('grid')} className={cn('rounded-md p-1.5 cursor-pointer', view === 'grid' ? 'bg-muted' : 'text-muted-foreground')}><LayoutGrid size={15} /></button>
              <button onClick={() => setView('table')} className={cn('rounded-md p-1.5 cursor-pointer', view === 'table' ? 'bg-muted' : 'text-muted-foreground')}><List size={15} /></button>
            </div>
            <Button onClick={() => setAdding(true)}><Plus size={15} /> Add unit</Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          {['available', 'occupied', 'reserved', 'maintenance'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </Select>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-44">
          <option value="">All sizes</option>
          {(types || []).map((t) => <option key={t._id} value={t._id}>{t.sizeSqf} sq ft</option>)}
        </Select>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Available</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-violet-500" /> Occupied</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Reserved</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-gray-400" /> Maintenance</span>
        </div>
      </div>

      {view === 'grid' ? (
        <div className="space-y-6">
          {grouped.map(([size, list]) => (
            <div key={size}>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{size} sq ft — {list[0].unitType?.label || ''}</h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2">
                {list.map((u) => (
                  <button
                    key={u._id}
                    onClick={() => setSelected(u)}
                    className={cn('rounded-lg border px-2 py-3 text-center transition-colors cursor-pointer', statusColor[u.status])}
                  >
                    <div className="text-xs font-bold">{u.unitNumber}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{statusLabel(u.status)}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <EmptyState message="No units match the filters." />}
        </div>
      ) : (
        <Card>
          <Table>
            <thead><tr><Th>Unit</Th><Th>Size</Th><Th>Status</Th><Th>Weekly rate</Th><Th>Monthly rate</Th><Th>Notes</Th></tr></thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u._id} className="hover:bg-muted/50 cursor-pointer" onClick={() => setSelected(u)}>
                  <Td className="font-medium">{u.unitNumber}</Td>
                  <Td>{u.unitType?.sizeSqf} sq ft</Td>
                  <Td><Badge tone={unitStatusTone[u.status]}>{statusLabel(u.status)}</Badge></Td>
                  <Td>{u.unitType?.weeklyRate}</Td>
                  <Td>{u.unitType?.monthlyRate}</Td>
                  <Td className="text-muted-foreground max-w-60 truncate">{u.notes}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {filtered.length === 0 && <EmptyState message="No units match the filters." />}
        </Card>
      )}

      {/* Unit detail modal */}
      <Modal open={!!selected} onClose={() => { setSelected(null); setError('') }} title={selected ? `Unit ${selected.unitNumber}` : ''}>
        {selected && <UnitDetail unit={selected} onUpdate={(body) => updateUnit.mutate({ id: selected._id, ...body })} error={error} busy={updateUnit.isPending} />}
      </Modal>

      {/* Add unit modal */}
      <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="Add unit">
        <form onSubmit={onAdd} className="space-y-4">
          <Field label="Unit number"><Input name="unitNumber" placeholder="U50-11" required /></Field>
          <Field label="Size">
            <Select name="unitType" required>
              {(types || []).map((t) => <option key={t._id} value={t._id}>{t.sizeSqf} sq ft — {t.label}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue="available">
              {['available', 'maintenance'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </Select>
          </Field>
          <Field label="Notes"><Textarea name="notes" /></Field>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={createUnit.isPending}>Create unit</Button>
        </form>
      </Modal>
    </div>
  )
}

function UnitDetail({ unit, onUpdate, error, busy }: { unit: Unit; onUpdate: (b: { status?: string; notes?: string }) => void; error: string; busy: boolean }) {
  const [status, setStatus] = useState(unit.status)
  const [notes, setNotes] = useState(unit.notes || '')
  const { data } = useQuery<{ unit: Unit; contracts: Contract[] }>({
    queryKey: ['unit', unit._id],
    queryFn: () => api.get(`/units/${unit._id}`).then((r) => r.data),
  })
  const openContract = data?.contracts.find((c) => ['active', 'pending_signature', 'draft'].includes(c.status))
  const occupied = ['occupied', 'reserved'].includes(unit.status)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><div className="text-xs text-muted-foreground">Size</div>{unit.unitType?.sizeSqf} sq ft ({unit.unitType?.label})</div>
        <div><div className="text-xs text-muted-foreground">Rates</div>{unit.unitType?.weeklyRate}/wk · {unit.unitType?.monthlyRate}/mo</div>
      </div>

      {openContract && (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <div className="text-xs text-muted-foreground mb-0.5">Current contract</div>
          <Link to={`/contracts/${openContract._id}`} className="font-medium text-primary hover:underline">{openContract.contractNo}</Link>
          {' — '}{openContract.customer?.fullName} · until {formatDate(openContract.endDate)}
        </div>
      )}

      <Field label="Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value as Unit['status'])} disabled={occupied}>
          {['available', 'occupied', 'reserved', 'maintenance'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </Select>
        {occupied && <p className="text-[11px] text-muted-foreground mt-1">Status is managed by the contract lifecycle.</p>}
      </Field>
      <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button className="w-full" disabled={busy} onClick={() => onUpdate(occupied ? { notes } : { status, notes })}>Save changes</Button>
      {unit.status === 'available' && (
        <Link to={`/contracts/new?unit=${unit._id}`}>
          <Button variant="outline" className="w-full mt-1">New contract for this unit</Button>
        </Link>
      )}
    </div>
  )
}

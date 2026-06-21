import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { LayoutGrid, List, Plus } from 'lucide-react'
import { api, apiError } from '../lib/api'
import type { Unit, Contract } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea, statusLabel, unitStatusTone } from '../components/ui'
import { cn, formatDate, formatMoney } from '../lib/utils'

const statusColor: Record<string, string> = {
  available: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25',
  occupied: 'bg-violet-500/15 border-violet-500/40 text-violet-700 dark:text-violet-400 hover:bg-violet-500/25',
  reserved: 'bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25',
  maintenance: 'bg-muted border-border text-muted-foreground hover:bg-muted/70',
}

const num = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v))

type UnitBody = {
  unitNumber: string
  floor: string
  sizeSqf: number | null
  price: number | null
  lengthFt: number | null
  widthFt: number | null
  status: string
  discountPct: number | null
  notes: string
}

function UnitFormFields({ initial }: { initial?: Partial<Unit> }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unit number"><Input name="unitNumber" defaultValue={initial?.unitNumber} placeholder="F1-45" required /></Field>
        <Field label="Floor">
          <Select name="floor" defaultValue={initial?.floor || 'F1'}>
            <option value="F1">F1</option>
            <option value="F2">F2</option>
          </Select>
        </Field>
        <Field label="Size (sq ft)"><Input name="sizeSqf" type="number" step="1" defaultValue={initial?.sizeSqf ?? ''} /></Field>
        <Field label="Monthly price (AED)"><Input name="price" type="number" step="0.01" defaultValue={initial?.price ?? ''} /></Field>
        <Field label="Length (ft)"><Input name="lengthFt" type="number" step="0.1" defaultValue={initial?.lengthFt ?? ''} /></Field>
        <Field label="Width (ft)"><Input name="widthFt" type="number" step="0.1" defaultValue={initial?.widthFt ?? ''} /></Field>
        <Field label="First month discount (%) — 28 days">
          <Input name="discountPct" type="number" min={0} max={100} step="0.01"
            defaultValue={initial?.discountPct ?? ''} placeholder="0" />
        </Field>
      </div>
    </>
  )
}

function readUnitForm(f: FormData): UnitBody {
  return {
    unitNumber: String(f.get('unitNumber')),
    floor: String(f.get('floor')),
    sizeSqf: num(f.get('sizeSqf')),
    price: num(f.get('price')),
    lengthFt: num(f.get('lengthFt')),
    widthFt: num(f.get('widthFt')),
    status: String(f.get('status') || 'available'),
    discountPct: num(f.get('discountPct')),
    notes: String(f.get('notes') || ''),
  }
}

export default function Units() {
  const qc = useQueryClient()
  const [view, setView] = useState<'grid' | 'table'>('grid')
  const [statusFilter, setStatusFilter] = useState('')
  const [floorFilter, setFloorFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Unit | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  const { data: units, isLoading } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
  })

  const filtered = useMemo(
    () =>
      (units || [])
        .filter(
          (u) =>
            (!statusFilter || u.status === statusFilter) &&
            (!floorFilter || u.floor === floorFilter) &&
            (!search || u.unitNumber.toLowerCase().includes(search.toLowerCase()) || String(u.sizeSqf ?? '').includes(search))
        )
        .sort((a, b) => {
          const floorCmp = a.floor.localeCompare(b.floor)
          if (floorCmp !== 0) return floorCmp
          const norm = (s: string) => s.replace(/\s+/g, '')
          return norm(a.unitNumber).localeCompare(norm(b.unitNumber), undefined, { numeric: true })
        }),
    [units, statusFilter, floorFilter, search]
  )

  const grouped = useMemo(() => {
    const map = new Map<string, Unit[]>()
    for (const u of filtered) {
      if (!map.has(u.floor)) map.set(u.floor, [])
      map.get(u.floor)!.push(u)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['units'] })

  const createUnit = useMutation({
    mutationFn: (body: UnitBody) => api.post('/units', body),
    onSuccess: () => { invalidate(); setAdding(false); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const updateUnit = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<UnitBody>) => api.put(`/units/${id}`, body),
    onSuccess: () => { invalidate(); setSelected(null); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const deleteUnit = useMutation({
    mutationFn: (id: string) => api.delete(`/units/${id}`),
    onSuccess: () => { invalidate(); setSelected(null); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  if (isLoading) return <Spinner />

  return (
    <div>
      <PageHeader
        title="Units"
        subtitle={`${filtered.length} units · ${filtered.filter((u) => u.status === 'available').length} available · ${filtered.filter((u) => u.status === 'maintenance').length} under construction`}
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
        <Input className="w-44" placeholder="Search unit / size…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)} className="w-32">
          <option value="">All floors</option>
          <option value="F1">Floor F1</option>
          <option value="F2">Floor F2</option>
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          {['available', 'occupied', 'reserved', 'maintenance'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
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
          {grouped.map(([floor, list]) => (
            <div key={floor}>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Floor {floor} — {list.length} units
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2">
                {list.map((u) => (
                  <button
                    key={u._id}
                    onClick={() => setSelected(u)}
                    title={u.notes}
                    className={cn('rounded-lg border px-2 py-2.5 text-center transition-colors cursor-pointer', statusColor[u.status])}
                  >
                    <div className="text-xs font-bold">{u.unitNumber}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{u.sizeSqf != null ? `${u.sizeSqf} sqf` : '—'}</div>
                    {u.discountPct ? <div className="text-[9px] mt-0.5 font-medium text-amber-600">{u.discountPct}% 1st mo</div> : null}
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
            <thead><tr><Th>Unit</Th><Th>Floor</Th><Th>Size</Th><Th>L × W (ft)</Th><Th>Monthly (AED)</Th><Th>1st Month Discount</Th><Th>Status</Th><Th>Notes</Th></tr></thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u._id} className="hover:bg-muted/50 cursor-pointer" onClick={() => setSelected(u)}>
                  <Td className="font-medium">{u.unitNumber}</Td>
                  <Td>{u.floor}</Td>
                  <Td>{u.sizeSqf != null ? `${u.sizeSqf} sq ft` : '—'}</Td>
                  <Td>{u.lengthFt && u.widthFt ? `${u.lengthFt} × ${u.widthFt}` : '—'}</Td>
                  <Td>{u.price != null ? formatMoney(u.price) : '—'}</Td>
                  <Td>{u.discountPct ? <span className="text-amber-600 font-medium">{u.discountPct}%</span> : <span className="text-muted-foreground">—</span>}</Td>
                  <Td><Badge tone={unitStatusTone[u.status]}>{statusLabel(u.status)}</Badge></Td>
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
        {selected && (
          <UnitDetail
            unit={selected}
            onUpdate={(body) => updateUnit.mutate({ id: selected._id, ...body })}
            onDelete={() => deleteUnit.mutate(selected._id)}
            error={error}
            busy={updateUnit.isPending || deleteUnit.isPending}
          />
        )}
      </Modal>

      {/* Add unit modal */}
      <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="Add unit">
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); createUnit.mutate(readUnitForm(new FormData(e.currentTarget))) }}
          className="space-y-4"
        >
          <UnitFormFields />
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

function UnitDetail({ unit, onUpdate, onDelete, error, busy }: { unit: Unit; onUpdate: (b: Partial<UnitBody>) => void; onDelete: () => void; error: string; busy: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { data } = useQuery<{ unit: Unit; contracts: Contract[] }>({
    queryKey: ['unit', unit._id],
    queryFn: () => api.get(`/units/${unit._id}`).then((r) => r.data),
  })
  const openContract = data?.contracts.find((c) => ['active', 'pending_signature', 'draft'].includes(c.status))
  const statusLocked = ['occupied', 'reserved'].includes(unit.status) && !!openContract

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const body = readUnitForm(new FormData(e.currentTarget))
    if (statusLocked) delete (body as Partial<UnitBody>).status
    onUpdate(body)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {openContract && (
        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <div className="text-xs text-muted-foreground mb-0.5">Current contract</div>
          <Link to={`/contracts/${openContract._id}`} className="font-medium text-primary hover:underline">{openContract.contractNo}</Link>
          {' — '}{openContract.customer?.fullName} · until {formatDate(openContract.endDate)}
        </div>
      )}

      <UnitFormFields initial={unit} />

      <Field label="Status">
        <Select name="status" defaultValue={unit.status} disabled={statusLocked}>
          {['available', 'occupied', 'reserved', 'maintenance'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </Select>
        {statusLocked && <p className="text-[11px] text-muted-foreground mt-1">Status is managed by the contract lifecycle.</p>}
      </Field>
      <Field label="Notes"><Textarea name="notes" defaultValue={unit.notes} /></Field>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>Save changes</Button>
      {unit.status === 'available' && (
        <Link to={`/contracts/new?unit=${unit._id}`}>
          <Button type="button" variant="outline" className="w-full mt-1">New contract for this unit</Button>
        </Link>
      )}
      {!openContract && (
        confirmDelete ? (
          <div className="flex gap-2 mt-2">
            <Button type="button" className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onDelete} disabled={busy}>
              Yes, delete
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" className="w-full mt-2 text-destructive hover:bg-destructive/10 border-destructive/30" onClick={() => setConfirmDelete(true)}>
            Delete unit
          </Button>
        )
      )}
    </form>
  )
}

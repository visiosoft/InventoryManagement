import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Lock, Unlock, Check, Pencil, Plus, Upload } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Site } from '../lib/site'
import type { Unit } from '../lib/types'
import { Button, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, statusLabel } from '../components/ui'
import { StatCard } from './reports/shared'

export interface MatrixContract {
  _id: string
  contractNo: string
  customerName: string
  rate: number | null
  leasedPrice: number | null
  firstMonthDiscountPct: number
  status: string
}
export interface MatrixUnit {
  _id: string
  unitNumber: string
  floor: string
  sizeSqf: number | null
  status: string
  price: number | null
  contract: MatrixContract | null
}

const statusDot: Record<string, string> = {
  available: '#10B981',
  occupied: '#8B5CF6',
  reserved: '#F59E0B',
  maintenance: '#94A3B8',
}

export const money = (n: number) => `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 0 })}`

// Same derivation the contract sidebar uses when leasedPrice is unset
function derivedLeased(c: MatrixContract): number | null {
  if (c.leasedPrice != null) return c.leasedPrice
  if (c.rate == null) return null
  return Math.round(c.rate * (1 - (c.firstMonthDiscountPct || 0) / 100) * 100) / 100
}

/**
 * Bring a floor in from a spreadsheet.
 *
 * Preview first, always: a hundred and forty-five units written on a misread
 * column is not something anyone wants to undo by hand. The server skips
 * numbers that already exist, so a second run adds only what is missing rather
 * than duplicating a floor or repricing a unit somebody has since corrected.
 */
type ImportPreview = {
  summary: { total: number; priced: number; incomplete: number; monthlyTotal: number; bySize: { size: string; count: number }[] }
  problems: { line: number; text: string; reason: string }[]
  skipped: string[]
  units: { unitNumber: string; sizeSqf: number | null; price: number | null; notes: string; incomplete: boolean }[]
  created?: number
}

function ImportFloor({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [floor, setFloor] = useState('F3')
  const [text, setText] = useState('')
  const [done, setDone] = useState<{ created: number; skipped: string[] } | null>(null)

  const run = useMutation<ImportPreview, unknown, boolean>({
    mutationFn: (commit: boolean) => api.post('/units/bulk-import', { floor, text, commit }).then((r) => r.data),
    onSuccess: (d, commit) => {
      if (!commit) return
      setDone({ created: d.created ?? 0, skipped: d.skipped })
      qc.invalidateQueries({ queryKey: ['unit-pricing-matrix'] })
      qc.invalidateQueries({ queryKey: ['units'] })
    },
  })

  const preview = run.data && !done ? run.data : null

  return (
    <Modal open onClose={onClose} title={done ? 'Floor imported' : 'Import a floor'}>
      {done ? (
        <div className="space-y-4 text-sm">
          <p>Created <strong>{done.created}</strong> unit{done.created === 1 ? '' : 's'} on {floor}.</p>
          {!!done.skipped.length && (
            <p className="text-muted-foreground text-xs">
              {done.skipped.length} already existed and were left untouched: {done.skipped.slice(0, 8).join(', ')}
              {done.skipped.length > 8 ? '…' : ''}
            </p>
          )}
          <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Floor">
            <Input value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="F3" />
          </Field>
          <Field label="Paste the rows">
            <Textarea
              rows={8}
              value={text}
              onChange={(e) => { setText(e.target.value); run.reset() }}
              placeholder="1&#9;77.7&#9;2.724&#9;2.560&#9;8.937&#9;8.399&#9;75 sq ft&#9;AED 1,300"
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Number, measured area, length and width in metres, then in feet, size band, price —
              straight from the spreadsheet. The size band becomes the unit&rsquo;s size and the
              measured area is kept in its notes.
            </p>
          </Field>

          {run.isError && <p className="text-xs text-destructive">{apiError(run.error)}</p>}

          {preview && (
            <div className="rounded-lg border p-3 space-y-2 text-xs">
              <p className="font-semibold text-sm">
                {preview.summary.total} unit{preview.summary.total === 1 ? '' : 's'} would be created
                {preview.summary.monthlyTotal ? ` · AED ${preview.summary.monthlyTotal.toLocaleString()} a month` : ''}
              </p>
              <p className="text-muted-foreground">
                {preview.summary.bySize.map((b) => `${b.count} × ${b.size}`).join(' · ')}
              </p>
              {!!preview.summary.incomplete && (
                <p className="text-amber-700">
                  {preview.summary.incomplete} with no size or price — created so the space exists, to be priced later.
                </p>
              )}
              {!!preview.skipped.length && (
                <p className="text-amber-700">
                  {preview.skipped.length} already exist and will be skipped: {preview.skipped.slice(0, 6).join(', ')}
                  {preview.skipped.length > 6 ? '…' : ''}
                </p>
              )}
              {preview.problems.map((p) => (
                <p key={p.line} className="text-amber-700">Line {p.line}: {p.reason}</p>
              ))}
              <div className="max-h-40 overflow-y-auto rounded border divide-y">
                {preview.units.slice(0, 200).map((u) => (
                  <div key={u.unitNumber} className="flex justify-between px-2 py-1">
                    <span className="font-medium">{u.unitNumber}</span>
                    <span className="text-muted-foreground">
                      {u.sizeSqf != null ? `${u.sizeSqf} sq ft` : 'no size'} · {u.price != null ? `AED ${u.price}` : 'no price'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            {!preview ? (
              <Button disabled={!text.trim() || run.isPending} onClick={() => run.mutate(false)}>
                {run.isPending ? 'Reading…' : 'Preview'}
              </Button>
            ) : (
              <Button disabled={run.isPending || !preview.units.length} onClick={() => run.mutate(true)}>
                {run.isPending ? 'Creating…' : `Create ${preview.units.length} units`}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

/* ── Unit records ───────────────────────────────────────────────────────
   Creating and editing units lives here rather than on /units, which is now
   a read-only availability lookup used daily by reps and accounts. The form
   below is the one that used to sit in the /units slide-over. */

type UnitBody = {
  unitNumber: string
  floor: string
  sizeSqf: number | null
  price: number | null
  lengthFt: number | null
  widthFt: number | null
  status: string
  discountPct: number | null
  shared: boolean
  notes: string
  site: string | null
}

const num = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : Number(v))

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
    shared: f.get('shared') === 'on',
    notes: String(f.get('notes') || ''),
    site: (f.get('site') as string) || null,
  }
}

function UnitFormFields({ initial, statusLocked }: { initial?: Partial<Unit>; statusLocked?: boolean }) {
  const { data: sites = [] } = useQuery<Site[]>({
    queryKey: ['sites'],
    queryFn: () => api.get('/sites').then((r) => r.data),
  })
  const rawSite = (initial as { site?: string | { _id: string } | null } | undefined)?.site
  const initialSite = typeof rawSite === 'object' && rawSite ? rawSite._id : rawSite
  return (
    <>
      {sites.length > 1 && (
        <Field label="Site">
          <Select name="site" defaultValue={initialSite || sites.find((s) => s.isDefault)?._id || ''}>
            {sites.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unit number"><Input name="unitNumber" defaultValue={initial?.unitNumber} placeholder="F1-45" required /></Field>
        <Field label="Floor">
          <Select name="floor" defaultValue={initial?.floor || 'F1'}>
            <option value="F1">F1</option>
            <option value="F2">F2</option>
            <option value="F3">F3</option>
            <option value="Shed">Shed</option>
          </Select>
        </Field>
        <Field label="Size (sq ft)"><Input name="sizeSqf" type="number" step="1" defaultValue={initial?.sizeSqf ?? ''} /></Field>
        <Field label="4 Weeks price (AED)">
          {/* This page *is* where the price lock is administered, so the field
              is editable here. A changed price is sent with priceOverride, and
              the server still refuses it for anyone who is not an admin. */}
          <Input name="price" type="number" step="0.01" defaultValue={initial?.price ?? ''} />
          {initial?.price != null && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Already set — changing it is an admin correction.
            </p>
          )}
        </Field>
        <Field label="Length (ft)"><Input name="lengthFt" type="number" step="0.1" defaultValue={initial?.lengthFt ?? ''} /></Field>
        <Field label="Width (ft)"><Input name="widthFt" type="number" step="0.1" defaultValue={initial?.widthFt ?? ''} /></Field>
        <Field label="First month discount (%) — 28 days">
          <Input name="discountPct" type="number" min={0} max={100} step="0.01"
            defaultValue={initial?.discountPct ?? ''} placeholder="0" />
        </Field>
      </div>
      <label className="flex items-center gap-2.5 cursor-pointer mt-1">
        <input
          type="checkbox"
          name="shared"
          defaultChecked={initial?.shared ?? false}
          className="h-4 w-4 rounded"
        />
        <span className="text-sm text-foreground">Shared unit</span>
      </label>
      <Field label="Status">
        <Select name="status" defaultValue={initial?.status || 'available'} disabled={statusLocked}>
          {['available', 'reserved', 'occupied', 'maintenance'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </Select>
        {statusLocked && <p className="text-[11px] text-muted-foreground mt-1">Status is managed by the contract lifecycle.</p>}
      </Field>
      <Field label="Notes"><Textarea name="notes" defaultValue={initial?.notes} /></Field>
    </>
  )
}

function PriceCell({ unit, onSaved }: { unit: MatrixUnit; onSaved: () => void }) {
  const [value, setValue] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [err, setErr] = useState('')

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put(`/units/${unit._id}`, body),
    onSuccess: () => { setUnlocked(false); setValue(''); setErr(''); onSaved() },
    onError: (e) => setErr(apiError(e)),
  })

  const locked = unit.price != null && !unlocked

  if (locked) {
    return (
      <div className="flex items-center justify-between gap-1">
        <span className="text-[13px] font-bold">{money(unit.price!)}</span>
        <button
          type="button"
          title="Price is locked — admin unlock to correct a mistake"
          onClick={() => {
            if (confirm(`Unlock the price of ${unit.unitNumber}? The actual price should normally never change.`)) {
              setValue(String(unit.price ?? ''))
              setUnlocked(true)
            }
          }}
          className="p-0.5 rounded hover:bg-black/5 cursor-pointer text-muted-foreground">
          <Lock size={11} />
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        {unlocked && <Unlock size={11} className="text-amber-600 shrink-0" />}
        <input
          type="number"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Set price"
          className="w-full min-w-0 rounded border px-1.5 py-0.5 text-[12px] bg-white"
        />
        <button
          type="button"
          disabled={save.isPending || value === ''}
          onClick={() => save.mutate(unlocked ? { price: Number(value), priceOverride: true } : { price: Number(value) })}
          className="p-1 rounded bg-emerald-600 text-white disabled:opacity-40 cursor-pointer shrink-0">
          <Check size={11} />
        </button>
      </div>
      {err && <p className="text-[10px] text-destructive mt-0.5">{err}</p>}
    </div>
  )
}

function LeasedCell({ unit, onSaved }: { unit: MatrixUnit; onSaved: () => void }) {
  const c = unit.contract!
  const current = derivedLeased(c)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')

  const save = useMutation({
    mutationFn: (leasedPrice: number) => api.put(`/contracts/${c._id}`, { leasedPrice }),
    onSuccess: () => { setEditing(false); setErr(''); onSaved() },
    onError: (e) => setErr(apiError(e)),
  })

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setValue(current != null ? String(current) : ''); setEditing(true) }}
        className="text-[13px] font-bold text-left hover:underline cursor-pointer"
        title="Click to edit the leased amount">
        {current != null ? money(current) : 'Set'}
      </button>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min="0"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value !== '') save.mutate(Number(value)); if (e.key === 'Escape') setEditing(false) }}
          className="w-full min-w-0 rounded border px-1.5 py-0.5 text-[12px] bg-white"
        />
        <button
          type="button"
          disabled={save.isPending || value === ''}
          onClick={() => save.mutate(Number(value))}
          className="p-1 rounded bg-emerald-600 text-white disabled:opacity-40 cursor-pointer shrink-0">
          <Check size={11} />
        </button>
      </div>
      {err && <p className="text-[10px] text-destructive mt-0.5">{err}</p>}
    </div>
  )
}

export default function UnitPricing({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient()
  // Settings is reachable by other roles, but the inventory itself —
  // creating, editing, deleting — stays with admins.
  const { user } = useAuth()
  const canEditUnits = user?.role === 'admin'

  const { data, isLoading } = useQuery<{ units: MatrixUnit[] }>({
    queryKey: ['unit-pricing-matrix'],
    queryFn: () => api.get('/units/pricing-matrix').then((r) => r.data),
  })

  const units = data?.units ?? []
  // Every mutation touches all three screens that read units, so all three
  // caches are dropped: this matrix, the /units list and the tenant lookup.
  const invalidate = () => {
    for (const key of [['unit-pricing-matrix'], ['units'], ['unit-active-contracts']]) {
      qc.invalidateQueries({ queryKey: key })
    }
  }

  /* The matrix endpoint only carries the money fields, so the editor reads the
     full unit records from the same /units list the availability page uses. */
  const { data: fullUnits = [] } = useQuery<Unit[]>({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
    enabled: canEditUnits,
  })
  const fullById = useMemo(() => new Map(fullUnits.map((u) => [u._id, u])), [fullUnits])

  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const closeForms = () => { setAdding(false); setEditingId(null); setError(''); setConfirmDelete(false) }

  const createUnit = useMutation({
    mutationFn: (body: UnitBody) => api.post('/units', body),
    onSuccess: () => { invalidate(); closeForms() },
    onError: (e) => setError(apiError(e)),
  })

  const updateUnit = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<UnitBody> & { priceOverride?: boolean }) =>
      api.put(`/units/${id}`, body),
    onSuccess: () => { invalidate(); closeForms() },
    onError: (e) => setError(apiError(e)),
  })

  const deleteUnit = useMutation({
    mutationFn: (id: string) => api.delete(`/units/${id}`),
    onSuccess: () => { invalidate(); closeForms() },
    onError: (e) => setError(apiError(e)),
  })

  const editing = editingId ? fullById.get(editingId) ?? null : null
  const editingMatrix = editingId ? units.find((u) => u._id === editingId) ?? null : null
  // Same rule the /units form used: an occupied unit under a live contract has
  // its status driven by the contract lifecycle, not by hand.
  const statusLocked = editing?.status === 'occupied' && !!editingMatrix?.contract

  function submitEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editing) return
    const body: Partial<UnitBody> & { priceOverride?: boolean } = readUnitForm(new FormData(e.currentTarget))
    if (statusLocked) delete body.status
    // The server locks an already-set price and only accepts a change from an
    // admin who explicitly opts in. The field is never silently dropped: if
    // the server refuses, its message is shown below the form.
    const priceChanged = !(
      (body.price == null && editing.price == null) || Number(body.price) === Number(editing.price)
    )
    if (priceChanged) body.priceOverride = true
    updateUnit.mutate({ id: editing._id, ...body })
  }

  const busy = createUnit.isPending || updateUnit.isPending || deleteUnit.isPending

  const grouped = useMemo(() => {
    const map = new Map<string, MatrixUnit[]>()
    for (const u of units) {
      const key = u.floor || '—'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(u)
    }
    const norm = (s: string) => s.replace(/\s+/g, '')
    for (const list of map.values()) {
      list.sort((a, b) => norm(a.unitNumber).localeCompare(norm(b.unitNumber), undefined, { numeric: true }))
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [units])

  const leased = units.filter((u) => u.contract)
  const totalActualLeased = leased.reduce((s, u) => s + (u.price ?? 0), 0)
  const totalLeased = leased.reduce((s, u) => s + (derivedLeased(u.contract!) ?? 0), 0)
  const diff = totalLeased - totalActualLeased
  const unpriced = units.filter((u) => u.price == null).length

  const floorTotals = (list: MatrixUnit[]) => {
    const occ = list.filter((u) => u.contract)
    const actual = occ.reduce((s, u) => s + (u.price ?? 0), 0)
    const leasedSum = occ.reduce((s, u) => s + (derivedLeased(u.contract!) ?? 0), 0)
    return { occ: occ.length, actual, leasedSum, diff: leasedSum - actual }
  }

  if (isLoading) return <Spinner />

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          title="Unit Pricing"
          subtitle="The actual price of every unit — set once, locked after. Leased shows what each tenant actually pays." />
      )}

      {canEditUnits && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Units are created and edited here. <span className="whitespace-nowrap">/units</span> is a read-only availability lookup.
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setImporting(true)} className="gap-1.5">
              <Upload size={15} /> Import a floor
            </Button>
            <Button type="button" onClick={() => { setError(''); setAdding(true) }} className="gap-1.5">
              <Plus size={15} /> Add unit
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <StatCard label="Units" value={String(units.length)} sub={unpriced > 0 ? `${unpriced} without a price` : 'all priced'} tone={unpriced > 0 ? 'amber' : 'default'} />
        <StatCard label="Leased units" value={String(leased.length)} />
        <StatCard label="Actual (leased units)" value={money(totalActualLeased)} />
        <StatCard label="Leased total" value={money(totalLeased)} />
        <StatCard label="Difference" value={`${diff >= 0 ? '+' : ''}${money(diff)}`} tone={diff >= 0 ? 'green' : 'red'} sub={diff >= 0 ? 'leasing above actual' : 'leasing below actual'} />
      </div>

      {grouped.map(([floor, list]) => {
        const t = floorTotals(list)
        return (
          <div key={floor}>
            <div className="flex items-baseline justify-between flex-wrap gap-x-4 gap-y-1 mb-2">
              <h2 className="text-sm font-bold uppercase tracking-wide">{floor} <span className="text-muted-foreground font-medium">({list.length} units)</span></h2>
              {t.occ > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t.occ} leased · actual {money(t.actual)} · leased {money(t.leasedSum)} ·{' '}
                  <span className={t.diff >= 0 ? 'text-emerald-600 font-semibold' : 'text-destructive font-semibold'}>
                    {t.diff >= 0 ? '+' : ''}{money(t.diff)}
                  </span>
                </p>
              )}
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
              {list.map((u) => {
                const dl = u.contract ? derivedLeased(u.contract) : null
                const variance = u.contract && u.price != null && dl != null ? dl - u.price : null
                return (
                  <div key={u._id} className="rounded-xl border bg-card p-2.5 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-[13px] font-bold truncate">{u.unitNumber}</span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                        {u.sizeSqf != null && `${u.sizeSqf} sqf`}
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: statusDot[u.status] ?? '#94A3B8' }} title={u.status} />
                        {canEditUnits && (
                          <button
                            type="button"
                            title={`Edit unit ${u.unitNumber}`}
                            onClick={() => { setError(''); setConfirmDelete(false); setEditingId(u._id) }}
                            className="p-0.5 rounded hover:bg-black/5 cursor-pointer text-muted-foreground hover:text-foreground">
                            <Pencil size={11} />
                          </button>
                        )}
                      </span>
                    </div>

                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Actual</div>
                    <PriceCell unit={u} onSaved={invalidate} />

                    {u.contract && (
                      <div className="mt-1.5 pt-1.5 border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Leased</span>
                          {variance != null && variance !== 0 && (
                            <span className={`text-[10px] font-bold ${variance > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                              {variance > 0 ? '+' : ''}{variance.toLocaleString()}
                            </span>
                          )}
                        </div>
                        <LeasedCell unit={u} onSaved={invalidate} />
                        <Link to={`/contracts/${u.contract._id}`} className="block text-[10px] text-primary hover:underline truncate mt-0.5">
                          {u.contract.contractNo} · {u.contract.customerName}
                        </Link>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {importing && <ImportFloor onClose={() => setImporting(false)} />}

      {/* Add unit */}
      <Modal open={adding} onClose={closeForms} title="Add unit">
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); createUnit.mutate(readUnitForm(new FormData(e.currentTarget))) }}
          className="space-y-4"
        >
          <UnitFormFields />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>Create unit</Button>
        </form>
      </Modal>

      {/* Edit unit */}
      <Modal open={!!editingId} onClose={closeForms} title={editing ? `Unit ${editing.unitNumber}` : 'Unit'}>
        {!editing ? (
          <Spinner />
        ) : (
          <form onSubmit={submitEdit} className="space-y-4">
            {/* `key` remounts the fields when a different unit is opened, so the
                uncontrolled defaults are re-read instead of going stale. */}
            <UnitFormFields key={editing._id} initial={editing} statusLocked={statusLocked} />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>Save changes</Button>
            {editingMatrix?.contract ? (
              <p className="text-[11px] text-muted-foreground">
                This unit is on contract {editingMatrix.contract.contractNo} — it cannot be deleted.
              </p>
            ) : confirmDelete ? (
              <div className="flex gap-2">
                <Button type="button" className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => deleteUnit.mutate(editing._id)} disabled={busy}>
                  Yes, delete
                </Button>
                <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button type="button" variant="outline" className="w-full text-destructive hover:bg-destructive/10 border-destructive/30"
                onClick={() => setConfirmDelete(true)}>
                Delete unit
              </Button>
            )}
          </form>
        )}
      </Modal>
    </div>
  )
}

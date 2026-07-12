import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Truck as TruckIcon, AlertTriangle, Search, CheckCircle, Wrench, Box } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { Truck, TruckType, TruckStatus } from '../../lib/types'
import { Badge, Button, Field, Input, Modal, Select, Spinner, Textarea } from '../../components/ui'
import { cn } from '../../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const TYPES: TruckType[] = ['small', 'medium', 'large', 'extra_large']
const STATUSES: TruckStatus[] = ['available', 'in_use', 'maintenance']

const statusTone: Record<TruckStatus, string> = { available: 'green', in_use: 'blue', maintenance: 'yellow' }
const typeTone: Record<TruckType, string> = { small: 'blue', medium: 'purple', large: 'amber', extra_large: 'red' }

function StatCard({ label, value, sub, icon, iconBg, iconColor }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode; iconBg: string; iconColor: string
}) {
  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 20 }}>
      <div className="flex justify-between items-start">
        <div style={{ fontSize: 13, color: MUTED, fontWeight: 500 }}>{label}</div>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: iconBg, display: 'grid', placeItems: 'center', color: iconColor }}>
          {icon}
        </div>
      </div>
      <div style={{ ...HEADING, fontSize: 32, fontWeight: 700, color: INK, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{sub}</div>}
    </div>
  )
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
  const [deleteId, setDeleteId] = useState<string | null>(null)
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

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/trucks/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['trucks'] }); setDeleteId(null) },
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
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Fleet Management</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{trucks.length} vehicles · {availableTrucks} available</div>
        </div>
        <button
          onClick={() => { setErr(''); setModal('create') }}
          style={{ height: 40, borderRadius: 10, background: PURPLE, color: 'white', fontSize: 14, fontWeight: 600, padding: '0 20px' }}
          className="flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />Add Truck
        </button>
      </div>

      {/* Overdue service alert */}
      {overdueService.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl mb-5" style={{ background: '#FFF7ED', border: '1px solid rgba(234,88,12,0.15)' }}>
          <AlertTriangle size={18} style={{ color: '#EA580C', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#9A3412' }}>Service overdue for {overdueService.length} truck{overdueService.length > 1 ? 's' : ''}</div>
            <div style={{ fontSize: 12, color: '#C2410C', marginTop: 2 }}>{overdueService.map(t => t.name).join(', ')}</div>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        <StatCard label="Total Fleet" value={trucks.length} sub="vehicles" icon={<TruckIcon size={18} />} iconBg="#F3F0EA" iconColor={MUTED} />
        <StatCard label="Available" value={availableTrucks} sub="ready to deploy" icon={<CheckCircle size={18} />} iconBg="#ECFDF5" iconColor="#059669" />
        <StatCard label="In Use" value={inUseTrucks} sub="on active jobs" icon={<Wrench size={18} />} iconBg="#EFF6FF" iconColor="#3B82F6" />
        <StatCard label="Total Capacity" value={`${totalCapacity} CBM`} sub="combined" icon={<Box size={18} />} iconBg="#F7F3FF" iconColor={PURPLE} />
      </div>

      {/* Search */}
      <div className="mb-5">
        <div style={{ height: 40, borderRadius: 10, background: '#F3F0EA' }} className="flex items-center gap-2 px-3">
          <Search size={16} color={MUTED} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by truck name or plate…"
            style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 14, color: INK }}
          />
        </div>
      </div>

      {/* Fleet list */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '60px 20px', textAlign: 'center' }}>
          <TruckIcon size={32} style={{ margin: '0 auto 12px', color: MUTED, opacity: 0.3 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>
            {trucks.length === 0 ? 'No trucks in fleet yet' : 'No trucks match your search'}
          </div>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {filtered.map(t => {
              const svc = serviceLabel(t.nextServiceDate)
              return (
                <div key={t._id} style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: 16 }}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{t.name}</span>
                        {t.plateNumber && <span style={{ fontSize: 11, fontFamily: 'monospace', color: MUTED, background: '#F3F0EA', padding: '2px 6px', borderRadius: 4 }}>{t.plateNumber}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge tone={typeTone[t.type as TruckType]} className="text-xs">{t.type?.replace(/_/g, ' ')}</Badge>
                        <Badge tone={statusTone[t.status]} className="text-xs">{t.status.replace(/_/g, ' ')}</Badge>
                        {t.capacityCbm && <span style={{ color: MUTED }}>{t.capacityCbm} CBM</span>}
                        {(t.dailyRate ?? 0) > 0 && <span style={{ color: MUTED }}>AED {t.dailyRate?.toLocaleString()}/day</span>}
                      </div>
                      {svc && (
                        <div className={cn('flex items-center gap-1 mt-1.5 text-xs', svc.overdue ? 'font-medium' : '')} style={{ color: svc.overdue ? '#EA580C' : MUTED }}>
                          {svc.overdue && <AlertTriangle size={11} />}
                          Service: {svc.label}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button onClick={() => { setErr(''); setModal(t) }} className="p-1.5 rounded-lg hover:bg-purple-500/10 transition-colors" style={{ color: MUTED }}>
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => setDeleteId(t._id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: MUTED }}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block" style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                    {['Truck', 'Plate', 'Type', 'Capacity', 'Daily Rate', 'Next Service', 'Status', ''].map((h, i) => (
                      <th key={h || i} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: MUTED, textAlign: h === 'Daily Rate' ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => {
                    const svc = serviceLabel(t.nextServiceDate)
                    return (
                      <tr key={t._id} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)', background: svc?.overdue ? 'rgba(255,247,237,0.5)' : undefined }} className="hover:bg-[#FAF8F5] transition-colors">
                        <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, color: INK }}>{t.name}</td>
                        <td style={{ padding: '14px 16px', fontSize: 13, fontFamily: 'monospace', fontWeight: 600, color: MUTED }}>{t.plateNumber || '—'}</td>
                        <td style={{ padding: '14px 16px' }}>
                          <Badge tone={typeTone[t.type as TruckType]} className="text-xs">{t.type?.replace(/_/g, ' ').toUpperCase()}</Badge>
                        </td>
                        <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED }}>{t.capacityCbm ? `${t.capacityCbm} CBM` : '—'}</td>
                        <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: INK, textAlign: 'right' }}>{(t.dailyRate ?? 0) > 0 ? `AED ${t.dailyRate?.toLocaleString()}` : '—'}</td>
                        <td style={{ padding: '14px 16px', fontSize: 13 }}>
                          {svc ? (
                            <span className={cn('flex items-center gap-1')} style={{ color: svc.overdue ? '#EA580C' : MUTED, fontWeight: svc.overdue ? 600 : 400 }}>
                              {svc.overdue && <AlertTriangle size={12} />}
                              {svc.label}
                            </span>
                          ) : <span style={{ color: MUTED }}>—</span>}
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <Badge tone={statusTone[t.status]} className="text-xs">{t.status.replace(/_/g, ' ')}</Badge>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => { setErr(''); setModal(t) }} className="p-1.5 rounded-lg hover:bg-purple-500/10 transition-colors" style={{ color: MUTED }}>
                              <Pencil size={15} />
                            </button>
                            <button onClick={() => setDeleteId(t._id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: MUTED }}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Modal open={modal !== null} title={modal === 'create' ? 'Add New Truck' : 'Edit Truck'} onClose={() => setModal(null)}>
        {modal !== null && (
          <TruckForm initial={modal === 'create' ? undefined : modal} busy={busy} error={err} onSubmit={handleSubmit} onCancel={() => setModal(null)} />
        )}
      </Modal>

      <Modal open={!!deleteId} title="Delete Truck" onClose={() => setDeleteId(null)}>
        <div className="space-y-4">
          <p className="text-sm">Are you sure you want to delete this truck? This action cannot be undone.</p>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteId && deleteMut.mutate(deleteId)} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? 'Deleting…' : 'Delete Truck'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

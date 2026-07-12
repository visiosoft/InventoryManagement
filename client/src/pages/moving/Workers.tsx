import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Pencil, Trash2, Users, DollarSign, TrendingUp, Phone } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { Worker, WorkerRole, WorkerStatus } from '../../lib/types'
import { Badge, Button, Field, Input, Modal, Select, Spinner, Textarea } from '../../components/ui'
import { cn } from '../../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const ROLES: WorkerRole[] = ['driver', 'helper', 'supervisor', 'packer']
const STATUSES: WorkerStatus[] = ['active', 'inactive', 'on_leave']

const roleTone: Record<string, string> = { driver: 'blue', helper: 'yellow', supervisor: 'purple', packer: 'green' }
const statusTone: Record<string, string> = { active: 'green', inactive: 'gray', on_leave: 'yellow' }
const statusDot: Record<string, string> = { active: '#10B981', inactive: '#94A3B8', on_leave: '#F59E0B' }

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
      role: String(f.get('role') || 'helper'),
      phone: String(f.get('phone') || ''),
      email: String(f.get('email') || ''),
      dailyRate: Number(f.get('dailyRate') || 0),
      status: String(f.get('status') || 'active'),
      emergencyContact: String(f.get('emergencyContact') || ''),
      notes: String(f.get('notes') || ''),
    })
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name"><Input name="name" placeholder="Full name" defaultValue={initial?.name} required /></Field>
        <Field label="Role">
          <Select name="role" defaultValue={initial?.role ?? 'helper'}>
            {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label="Phone"><Input name="phone" placeholder="+971" defaultValue={initial?.phone} /></Field>
        <Field label="Email"><Input name="email" type="email" placeholder="name@example.com" defaultValue={initial?.email} /></Field>
        <Field label="Daily Rate (AED)"><Input name="dailyRate" type="number" min="0" placeholder="e.g., 150" defaultValue={initial?.dailyRate} required /></Field>
        <Field label="Status">
          <Select name="status" defaultValue={initial?.status ?? 'active'}>
            {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Emergency Contact" className="col-span-2"><Input name="emergencyContact" placeholder="Emergency contact number" defaultValue={initial?.emergencyContact} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea name="notes" rows={2} placeholder="Additional notes" defaultValue={initial?.notes} /></Field>
      </div>
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : initial ? 'Update Worker' : 'Add Worker'}</Button>
      </div>
    </form>
  )
}

export default function Workers() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create' | Worker>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
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

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/workers/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['workers'] }); setDeleteId(null) },
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
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Crew Management</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{workers.length} workers · {activeWorkers.length} active</div>
        </div>
        <button
          onClick={() => { setErr(''); setModal('create') }}
          style={{ height: 40, borderRadius: 10, background: PURPLE, color: 'white', fontSize: 14, fontWeight: 600, padding: '0 20px' }}
          className="flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />Add Worker
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-7">
        <StatCard label="Active Crew" value={activeWorkers.length} sub={`${workers.filter(w => w.status === 'on_leave').length} on leave`} icon={<Users size={18} />} iconBg="#ECFDF5" iconColor="#059669" />
        <StatCard label="Avg Daily Rate" value={`AED ${avgRate.toFixed(0)}`} sub="per active worker" icon={<TrendingUp size={18} />} iconBg="#FFF7ED" iconColor="#EA580C" />
        <StatCard label="Daily Crew Cost" value={`AED ${dailyCost.toLocaleString()}`} sub="active workers only" icon={<DollarSign size={18} />} iconBg="#F7F3FF" iconColor={PURPLE} />
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2.5 mb-5">
        <div style={{ height: 40, borderRadius: 10, background: '#F3F0EA' }} className="flex items-center gap-2 px-3 flex-1">
          <Search size={16} color={MUTED} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or phone…"
            style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 14, color: INK }}
          />
        </div>
        <div className="flex gap-2">
          {(['', ...ROLES] as (WorkerRole | '')[]).map(r => {
            const active = filterRole === r
            const label = r === '' ? 'All Roles' : r.charAt(0).toUpperCase() + r.slice(1)
            return (
              <button
                key={r}
                onClick={() => setFilterRole(r)}
                style={{
                  height: 40,
                  borderRadius: 10,
                  background: active ? PURPLE : '#F3F0EA',
                  color: active ? 'white' : MUTED,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '0 14px',
                  border: 'none',
                }}
                className="hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                {label}
              </button>
            )
          })}
        </div>
        <div className="flex gap-2">
          {(['', ...STATUSES] as (WorkerStatus | '')[]).map(s => {
            const active = filterStatus === s
            const label = s === '' ? 'All' : s.replace(/_/g, ' ')
            return (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  height: 40,
                  borderRadius: 10,
                  background: active ? PURPLE : '#F3F0EA',
                  color: active ? 'white' : MUTED,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '0 14px',
                  border: 'none',
                  textTransform: 'capitalize',
                }}
                className="hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                {s && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: active ? 'white' : statusDot[s], marginRight: 6, verticalAlign: 'middle' }} />}
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Workers list */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '60px 20px', textAlign: 'center' }}>
          <Users size={32} style={{ margin: '0 auto 12px', color: MUTED, opacity: 0.3 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>
            {workers.length === 0 ? 'No workers yet' : 'No matches'}
          </div>
          <div style={{ fontSize: 13, color: MUTED }}>
            {workers.length === 0 ? 'Add your first crew member to get started' : 'Try adjusting your search or filter'}
          </div>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {filtered.map(w => (
              <div key={w._id}
                style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: 16 }}
              >
                <div className="flex items-center gap-3">
                  <div style={{
                    width: 40, height: 40, borderRadius: 20,
                    background: w.status === 'active' ? '#ECFDF5' : w.status === 'on_leave' ? '#FFF7ED' : '#F3F0EA',
                    color: w.status === 'active' ? '#059669' : w.status === 'on_leave' ? '#EA580C' : MUTED,
                    display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0,
                  }}>
                    {w.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{w.name}</span>
                      <Badge tone={statusTone[w.status]} className="text-xs py-0 h-4">{w.status.replace(/_/g, ' ')}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
                      <Badge tone={roleTone[w.role as WorkerRole]} className="text-xs">{w.role}</Badge>
                      {w.phone && <span className="flex items-center gap-1"><Phone size={10} />{w.phone}</span>}
                      <span className="ml-auto" style={{ fontWeight: 600, color: INK }}>AED {w.dailyRate?.toLocaleString()}/day</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button onClick={() => { setErr(''); setModal(w) }} className="p-1.5 rounded-lg hover:bg-purple-500/10 transition-colors" style={{ color: MUTED }}>
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => setDeleteId(w._id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: MUTED }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block" style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                    {['Name', 'Role', 'Phone', 'Daily Rate', 'Status', ''].map(h => (
                      <th key={h} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: MUTED, textAlign: h === 'Daily Rate' ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(w => (
                    <tr key={w._id} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                      <td style={{ padding: '14px 16px' }}>
                        <div className="flex items-center gap-2.5">
                          <div style={{
                            width: 28, height: 28, borderRadius: 14,
                            background: w.status === 'active' ? '#ECFDF5' : w.status === 'on_leave' ? '#FFF7ED' : '#F3F0EA',
                            color: w.status === 'active' ? '#059669' : w.status === 'on_leave' ? '#EA580C' : MUTED,
                            display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0,
                          }}>
                            {w.name.charAt(0).toUpperCase()}
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 500, color: INK }}>{w.name}</span>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <Badge tone={roleTone[w.role as WorkerRole]} className="text-xs">{w.role}</Badge>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, fontFamily: 'monospace' }}>{w.phone || '—'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: INK, textAlign: 'right' }}>AED {w.dailyRate?.toLocaleString()}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <Badge tone={statusTone[w.status]} className="text-xs">{w.status.replace(/_/g, ' ')}</Badge>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => { setErr(''); setModal(w) }} className="p-1.5 rounded-lg hover:bg-purple-500/10 transition-colors" style={{ color: MUTED }}>
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => setDeleteId(w._id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: MUTED }}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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

      <Modal open={!!deleteId} title="Delete Worker" onClose={() => setDeleteId(null)}>
        <div className="space-y-4">
          <p className="text-sm">Are you sure you want to delete this worker? This action cannot be undone.</p>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteId && deleteMut.mutate(deleteId)} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? 'Deleting…' : 'Delete Worker'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

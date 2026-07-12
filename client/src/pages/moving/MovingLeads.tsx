import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation } from 'react-router-dom'
import { Plus, Search, Trash2, Users, Phone, Calendar, MapPin, UserPlus } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { MovingLead, MovingLeadSource, MovingLeadStatus } from '../../lib/types'
import { Badge, Button, Field, Input, Modal, Select, Spinner, Textarea } from '../../components/ui'
import { cn, formatDate } from '../../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const STATUSES: MovingLeadStatus[] = ['new', 'contacted', 'quoted', 'client_approved', 'won', 'lost']
const SOURCES: MovingLeadSource[] = ['phone', 'web_form', 'mobile_app', 'whatsapp', 'referral', 'walk_in', 'other']

const statusTone: Record<MovingLeadStatus, string> = {
  new: 'blue', contacted: 'yellow', quoted: 'purple', client_approved: 'green', won: 'green', lost: 'red',
}

const statusDot: Record<MovingLeadStatus, string> = {
  new: '#3B82F6', contacted: '#F59E0B', quoted: '#8B5CF6', client_approved: '#10B981', won: '#059669', lost: '#EF4444',
}

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

function LeadForm({ initial, busy, error, onSubmit, onCancel }: {
  initial?: Partial<MovingLead>
  busy: boolean
  error: string
  onSubmit: (body: Record<string, unknown>) => void
  onCancel: () => void
}) {
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    onSubmit({
      prospectName: String(f.get('prospectName') || ''),
      prospectPhone: String(f.get('prospectPhone') || ''),
      prospectEmail: String(f.get('prospectEmail') || ''),
      source: String(f.get('source') || 'phone'),
      status: String(f.get('status') || 'new'),
      moveDate: f.get('moveDate') || undefined,
      pickupAddress: String(f.get('pickupAddress') || ''),
      deliveryAddress: String(f.get('deliveryAddress') || ''),
      estimatedVolumeCbm: f.get('estimatedVolumeCbm') ? Number(f.get('estimatedVolumeCbm')) : undefined,
      notes: String(f.get('notes') || ''),
    })
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name"><Input name="prospectName" placeholder="Full name" defaultValue={initial?.prospectName} required /></Field>
        <Field label="Phone"><Input name="prospectPhone" placeholder="+971" defaultValue={initial?.prospectPhone} required /></Field>
        <Field label="Email"><Input name="prospectEmail" type="email" placeholder="name@example.com" defaultValue={initial?.prospectEmail} /></Field>
        <Field label="Source">
          <Select name="source" defaultValue={initial?.source ?? 'phone'}>
            {SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select name="status" defaultValue={initial?.status ?? 'new'}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Preferred Move Date"><Input name="moveDate" type="date" defaultValue={initial?.moveDate?.slice(0, 10)} /></Field>
        <Field label="Pickup Address" className="col-span-2"><Textarea name="pickupAddress" rows={2} placeholder="Full pickup address" defaultValue={initial?.pickupAddress} /></Field>
        <Field label="Delivery Address" className="col-span-2"><Textarea name="deliveryAddress" rows={2} placeholder="Full delivery address" defaultValue={initial?.deliveryAddress} /></Field>
        <Field label="Est. Volume (CBM)"><Input name="estimatedVolumeCbm" type="number" min="0" step="0.1" placeholder="e.g., 50" defaultValue={initial?.estimatedVolumeCbm} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea name="notes" rows={2} placeholder="Additional information about the lead" defaultValue={initial?.notes} /></Field>
      </div>
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add Lead'}</Button>
      </div>
    </form>
  )
}

export default function MovingLeads() {
  const qc = useQueryClient()
  const location = useLocation()
  const prefill = (location.state as any)?.prefill as Partial<MovingLead> | undefined
  const [modal, setModal] = useState<null | 'create'>(prefill ? 'create' : null)
  const [filterStatus, setFilterStatus] = useState<MovingLeadStatus | ''>('')
  const [search, setSearch] = useState('')
  const [err, setErr] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: leads = [], isLoading } = useQuery<MovingLead[]>({
    queryKey: ['moving-leads', filterStatus],
    queryFn: () => api.get('/moving-leads', { params: { status: filterStatus || undefined } }).then(r => r.data),
  })

  const filteredLeads = leads.filter(l =>
    search === '' ||
    (l.prospectName?.toLowerCase() || '').includes(search.toLowerCase()) ||
    (l.prospectPhone?.toLowerCase() || '').includes(search.toLowerCase()) ||
    (l.customer?.fullName?.toLowerCase() || '').includes(search.toLowerCase())
  )

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/moving-leads', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['moving-leads'] }); setModal(null); setErr('') },
    onError: (e) => setErr(apiError(e)),
  })

  const deleteMut = useMutation({
    mutationFn: (leadId: string) => api.delete(`/moving-leads/${leadId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['moving-leads'] }); setDeleteId(null) },
    onError: (e) => setErr(apiError(e)),
  })

  const newCount = leads.filter(l => l.status === 'new').length
  const contactedCount = leads.filter(l => l.status === 'contacted').length
  const wonCount = leads.filter(l => l.status === 'won').length

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Leads</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{leads.length} total leads in the pipeline</div>
        </div>
        <button
          onClick={() => { setErr(''); setModal('create') }}
          style={{ height: 40, borderRadius: 10, background: PURPLE, color: 'white', fontSize: 14, fontWeight: 600, padding: '0 20px' }}
          className="flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />Add Lead
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        <StatCard label="Total Leads" value={leads.length} sub="all time" icon={<Users size={18} />} iconBg="#F3F0EA" iconColor={MUTED} />
        <StatCard label="New" value={newCount} sub="awaiting contact" icon={<UserPlus size={18} />} iconBg="#EFF6FF" iconColor="#3B82F6" />
        <StatCard label="Contacted" value={contactedCount} sub="in progress" icon={<Phone size={18} />} iconBg="#FFF7ED" iconColor="#EA580C" />
        <StatCard label="Won" value={wonCount} sub="converted" icon={<Calendar size={18} />} iconBg="#ECFDF5" iconColor="#059669" />
      </div>

      {/* Search + filter */}
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
        <div className="flex gap-2 flex-wrap">
          {(['', ...STATUSES] as (MovingLeadStatus | '')[]).map(s => {
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
                  textTransform: 'capitalize',
                  border: 'none',
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

      {/* Leads list */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filteredLeads.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '60px 20px', textAlign: 'center' }}>
          <Users size={32} style={{ margin: '0 auto 12px', color: MUTED, opacity: 0.3 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>
            {search ? 'No leads match your search' : 'No leads found'}
          </div>
          <div style={{ fontSize: 13, color: MUTED }}>
            {search ? 'Try adjusting your search or filter' : 'Add your first lead to get started'}
          </div>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {filteredLeads.map(l => (
              <Link key={l._id} to={`/moving/leads/${l._id}`}
                style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: 16 }}
                className="block hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span style={{ fontSize: 15, fontWeight: 600, color: INK }}>{l.prospectName || l.customer?.fullName || '—'}</span>
                      <Badge tone={statusTone[l.status]} className="text-xs">{l.status.replace(/_/g, ' ')}</Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
                      {(l.prospectPhone || l.customer?.phone) && (
                        <span className="flex items-center gap-1"><Phone size={10} />{l.prospectPhone || l.customer?.phone}</span>
                      )}
                      <span className="capitalize">{l.source.replace(/_/g, ' ')}</span>
                    </div>
                    {l.moveDate && (
                      <div className="flex items-center gap-1 mt-1.5 text-xs" style={{ color: MUTED }}>
                        <Calendar size={10} />{formatDate(l.moveDate)}
                      </div>
                    )}
                    {l.pickupAddress && (
                      <div className="flex items-center gap-1 mt-1 text-xs" style={{ color: MUTED }}>
                        <MapPin size={10} /><span className="truncate">{l.pickupAddress}</span>
                      </div>
                    )}
                  </div>
                  <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteId(l._id) }}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors shrink-0" style={{ color: MUTED }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block" style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                    {['Name', 'Phone', 'Source', 'Move Date', 'Pickup', 'Status', ''].map(h => (
                      <th key={h} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map(l => (
                    <tr key={l._id} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                      <td style={{ padding: '14px 16px' }}>
                        <Link to={`/moving/leads/${l._id}`} style={{ fontSize: 14, fontWeight: 600, color: PURPLE }} className="hover:opacity-80 transition-opacity">
                          {l.prospectName || l.customer?.fullName || '—'}
                        </Link>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, fontFamily: 'monospace' }}>{l.prospectPhone || l.customer?.phone || '—'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, textTransform: 'capitalize' }}>{l.source.replace(/_/g, ' ')}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED }}>{l.moveDate ? formatDate(l.moveDate) : '—'}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.pickupAddress || '—'}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <Badge tone={statusTone[l.status]} className="text-xs">{l.status.replace(/_/g, ' ')}</Badge>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                        <button onClick={() => setDeleteId(l._id)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" style={{ color: MUTED }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: 12, color: MUTED, textAlign: 'right', marginTop: 12 }}>{filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''}</div>
        </>
      )}

      <Modal open={modal !== null} title="Add Moving Lead" onClose={() => setModal(null)}>
        {modal !== null && (
          <LeadForm initial={prefill} busy={createMut.isPending} error={err} onSubmit={body => { setErr(''); createMut.mutate(body) }} onCancel={() => setModal(null)} />
        )}
      </Modal>

      <Modal open={!!deleteId} title="Delete Lead" onClose={() => setDeleteId(null)}>
        <div className="space-y-4">
          <p className="text-sm">Are you sure you want to delete this lead? This action cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteId && deleteMut.mutate(deleteId)} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? 'Deleting…' : 'Delete Lead'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

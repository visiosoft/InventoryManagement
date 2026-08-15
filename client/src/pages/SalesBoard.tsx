import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Plus, UserPlus } from 'lucide-react'
import { api, apiError, leadApi } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Lead, MovingLead, MovingLeadStatus } from '../lib/types'
import { Modal, Spinner } from '../components/ui'
import { formatDate } from '../lib/utils'
import { LeadDetailPanel } from './Leads'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const SIZE_OPTIONS = [10, 25, 35, 50, 75, 100, 150, 200]
const LEAD_SOURCE_OPTIONS = ['manual', 'whatsapp', 'referral', 'walk_in', 'other']
const labelize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export type TaskItem = {
  _id: string
  title: string
  description?: string
  leadName?: string
  dueDate?: string
  priority: 'low' | 'medium' | 'high'
  status: 'todo' | 'in_progress' | 'done'
  assignedTo?: { _id: string; name: string; email: string }
}

const PRIORITY_COLOR: Record<string, string> = { low: '#756E80', medium: '#B45309', high: '#991B1B' }

// Buckets a task list into Overdue / Today / This Week / Later, each sorted
// by due date ascending — a flat list buries what actually needs attention
// today under whatever was added most recently.
export function groupTasksByDue(tasks: TaskItem[]) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(todayStart.getTime() + 86400000)
  const weekEnd = new Date(todayStart.getTime() + 7 * 86400000)

  const groups: { label: string; tone: 'overdue' | 'today' | 'normal'; items: TaskItem[] }[] = [
    { label: 'Overdue', tone: 'overdue', items: [] },
    { label: 'Due Today', tone: 'today', items: [] },
    { label: 'This Week', tone: 'normal', items: [] },
    { label: 'Later / No due date', tone: 'normal', items: [] },
  ]
  for (const t of tasks) {
    if (!t.dueDate) { groups[3].items.push(t); continue }
    const due = new Date(t.dueDate)
    if (due < todayStart) groups[0].items.push(t)
    else if (due < todayEnd) groups[1].items.push(t)
    else if (due < weekEnd) groups[2].items.push(t)
    else groups[3].items.push(t)
  }
  for (const g of groups) g.items.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
  return groups.filter((g) => g.items.length > 0)
}

function TasksCard() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState('medium')

  const { data: tasks = [], isLoading } = useQuery<TaskItem[]>({
    queryKey: ['my-tasks'],
    queryFn: () => api.get('/tasks', { params: { status: 'todo,in_progress' } }).then((r) => r.data),
  })
  const groups = useMemo(() => groupTasksByDue(tasks), [tasks])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['my-tasks'] })

  const createTask = useMutation({
    mutationFn: () => api.post('/tasks', { title, dueDate: dueDate || undefined, priority }),
    onSuccess: () => { invalidate(); setTitle(''); setDueDate(''); setPriority('medium'); setShowAdd(false) },
  })
  const updateTask = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/tasks/${id}`, body),
    onSuccess: invalidate,
  })

  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 20 }} className="mb-5">
      <div className="flex items-center justify-between mb-3">
        <div style={{ fontWeight: 700, fontSize: 15, color: INK }}>Follow-ups & Tasks</div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          style={{ height: 32, padding: '0 12px', borderRadius: 8, background: PURPLE, color: 'white', fontSize: 12.5, fontWeight: 600, border: 'none' }}
          className="flex items-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer"
        >
          <Plus size={13} /> Add task
        </button>
      </div>

      {showAdd && (
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task description"
            style={{ flex: 1, height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }}
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={{ height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }}
          />
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            style={{ height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <button
            type="button"
            disabled={!title.trim() || createTask.isPending}
            onClick={() => createTask.mutate()}
            style={{ height: 38, padding: '0 16px', borderRadius: 8, background: PURPLE, color: 'white', fontSize: 12.5, fontWeight: 600, border: 'none' }}
            className="disabled:opacity-50 cursor-pointer"
          >
            {createTask.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No open tasks. Nice and clear.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.label}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6,
                color: g.tone === 'overdue' ? '#991B1B' : g.tone === 'today' ? '#B45309' : MUTED,
              }}>
                {g.label} ({g.items.length})
              </div>
              <div className="space-y-2">
                {g.items.map((t) => (
                  <div
                    key={t._id}
                    className="flex items-center justify-between gap-3"
                    style={{
                      borderBottom: '1px solid rgba(20,8,31,.06)',
                      borderLeft: g.tone === 'overdue' ? '3px solid #991B1B' : g.tone === 'today' ? '3px solid #B45309' : '3px solid transparent',
                      paddingBottom: 10, paddingLeft: 8,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {t.leadName && <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>{t.leadName}</span>}
                        <span style={{ fontSize: 13, color: INK, fontWeight: g.tone !== 'normal' ? 700 : 400 }}>{t.title}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: PRIORITY_COLOR[t.priority], textTransform: 'uppercase' }}>{t.priority}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {t.dueDate && (
                        <span style={{ fontSize: 12, fontWeight: g.tone !== 'normal' ? 700 : 400, color: g.tone === 'overdue' ? '#991B1B' : g.tone === 'today' ? '#B45309' : MUTED }}>
                          Due {formatDate(t.dueDate)}
                        </span>
                      )}
                      <select
                        value={t.status}
                        onChange={(e) => updateTask.mutate({ id: t._id, body: { status: e.target.value } })}
                        style={{ height: 30, padding: '0 8px', borderRadius: 8, border: '1px solid rgba(20,8,31,.14)', fontSize: 12 }}
                      >
                        <option value="todo">To do</option>
                        <option value="in_progress">In progress</option>
                        <option value="done">Done</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type GoalsData = {
  targets: { weekly: { units: number; moving: number }; monthly: { units: number; moving: number } }
  actual: { weekly: { units: number; moving: number }; monthly: { units: number; moving: number } }
}

export function ProgressBar({ actual, target }: { actual: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1" style={{ color: MUTED }}>
        <span>{actual} / {target || '—'}</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: '#F6F0E4' }}>
        <div style={{ height: 8, borderRadius: 999, width: `${pct}%`, background: PURPLE, transition: 'width .3s' }} />
      </div>
    </div>
  )
}

function GoalsSection() {
  const { data, isLoading } = useQuery<GoalsData>({
    queryKey: ['my-sales-goals'],
    queryFn: () => api.get('/sales-goals/me').then((r) => r.data),
  })

  if (isLoading || !data) return null
  const hasAnyTarget = data.targets.weekly.units || data.targets.weekly.moving || data.targets.monthly.units || data.targets.monthly.moving
  if (!hasAnyTarget) return null

  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 20 }} className="mb-5">
      <div style={{ fontWeight: 700, fontSize: 15, color: INK, marginBottom: 16 }}>Goals</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <div style={{ fontSize: 12, color: MUTED, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>This Week</div>
          <div style={{ fontSize: 13, color: INK, marginBottom: 4 }}>Units leased</div>
          <ProgressBar actual={data.actual.weekly.units} target={data.targets.weekly.units} />
          <div style={{ fontSize: 13, color: INK, marginBottom: 4 }}>Moving booked</div>
          <ProgressBar actual={data.actual.weekly.moving} target={data.targets.weekly.moving} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: MUTED, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>This Month</div>
          <div style={{ fontSize: 13, color: INK, marginBottom: 4 }}>Units leased</div>
          <ProgressBar actual={data.actual.monthly.units} target={data.targets.monthly.units} />
          <div style={{ fontSize: 13, color: INK, marginBottom: 4 }}>Moving booked</div>
          <ProgressBar actual={data.actual.monthly.moving} target={data.targets.monthly.moving} />
        </div>
      </div>
    </div>
  )
}

type SizeBucket = { sizeSqf: number | string; total: number; available: number }

function UnitAvailabilityStrip() {
  const { data } = useQuery<{ bySize: SizeBucket[] }>({
    queryKey: ['reports-summary-availability'],
    queryFn: () => api.get('/reports/summary').then((r) => r.data),
  })
  const bySize = data?.bySize || []
  if (bySize.length === 0) return null

  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: '14px 18px' }} className="mb-5">
      <div className="flex items-center gap-3 flex-wrap">
        <span style={{ fontSize: 12, color: MUTED, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Unit Availability</span>
        {bySize.map((b) => (
          <span key={String(b.sizeSqf)} style={{ background: '#F7F3FF', color: '#4A1FA0', fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999 }}>
            {b.sizeSqf}: {b.available}
          </span>
        ))}
      </div>
    </div>
  )
}

function QuickAddLead() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [size, setSize] = useState(String(SIZE_OPTIONS[0]))
  const [source, setSource] = useState('manual')
  const [err, setErr] = useState('')

  const create = useMutation({
    mutationFn: () => leadApi.create({
      firstName: name.trim(),
      fullName: name.trim(),
      phone: phone.trim(),
      source: source as Lead['source'],
      storageSizeValue: Number(size),
      storageSizeUnit: 'sqft',
      durationValue: 1,
      durationUnit: 'month',
      unitsNeeded: 1,
      preferredContact: 'whatsapp',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-leads-storage'] })
      setName(''); setPhone(''); setErr(''); setOpen(false)
    },
    onError: (e) => setErr(apiError(e)),
  })

  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: '14px 18px' }} className="mb-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 cursor-pointer"
        style={{ fontSize: 13, fontWeight: 700, color: INK, background: 'none', border: 'none', padding: 0 }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Plus size={14} /> Add lead
      </button>
      {open && (
        <div className="flex flex-col sm:flex-row gap-2 mt-3 flex-wrap">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
            style={{ flex: 1, minWidth: 160, height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone"
            style={{ flex: 1, minWidth: 160, height: 38, padding: '0 12px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }} />
          <select value={size} onChange={(e) => setSize(e.target.value)}
            style={{ height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }}>
            {SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s} sqft</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)}
            style={{ height: 38, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 13 }}>
            {LEAD_SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
          </select>
          <button
            type="button"
            disabled={!name.trim() || !phone.trim() || create.isPending}
            onClick={() => create.mutate()}
            style={{ height: 38, padding: '0 16px', borderRadius: 8, background: PURPLE, color: 'white', fontSize: 12.5, fontWeight: 600, border: 'none' }}
            className="disabled:opacity-50 cursor-pointer"
          >
            {create.isPending ? 'Saving…' : 'Save lead'}
          </button>
        </div>
      )}
      {err && <p className="text-xs text-destructive mt-2">{err}</p>}
    </div>
  )
}

type Row = {
  key: string
  type: 'Storage Only' | 'Moving'
  name: string
  phone: string
  interested: string
  status: string
  statusColor: { bg: string; fg: string }
  addedAt?: string
  href?: string
  onOpen?: () => void
  canConvert: boolean
  convertLabel: string
  convert: () => void
  converting: boolean
}

const STORAGE_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  new: { bg: '#E8F9EE', fg: '#0F7A3D' },
  contacted: { bg: '#E0F2FE', fg: '#0369A1' },
  qualified: { bg: '#F3E8FF', fg: '#7C3AED' },
  proposal_sent: { bg: '#FEF3C7', fg: '#B45309' },
  won: { bg: '#D1FAE5', fg: '#065F46' },
  lost: { bg: '#FEE2E2', fg: '#991B1B' },
}
const MOVING_STATUS_COLORS: Record<MovingLeadStatus, { bg: string; fg: string }> = {
  new: { bg: '#E8F9EE', fg: '#0F7A3D' },
  contacted: { bg: '#E0F2FE', fg: '#0369A1' },
  quoted: { bg: '#F3E8FF', fg: '#7C3AED' },
  client_approved: { bg: '#FEF3C7', fg: '#B45309' },
  won: { bg: '#D1FAE5', fg: '#065F46' },
  lost: { bg: '#FEE2E2', fg: '#991B1B' },
}

export default function SalesBoard() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [viewingLead, setViewingLead] = useState<Lead | null>(null)

  const { data: storagePage, isLoading: storageLoading } = useQuery({
    queryKey: ['my-leads-storage'],
    queryFn: () => leadApi.list({ owner: user?.id, limit: 500 }),
    enabled: !!user?.id,
  })

  const { data: movingLeads = [], isLoading: movingLoading } = useQuery<MovingLead[]>({
    queryKey: ['my-leads-moving'],
    queryFn: () => api.get('/moving-leads', { params: { owner: user?.id } }).then((r) => r.data),
    enabled: !!user?.id,
  })

  const convertStorage = useMutation({
    mutationFn: (id: string) => leadApi.convertToCustomer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-leads-storage'] }),
  })
  const convertMoving = useMutation({
    mutationFn: (id: string) => api.post(`/moving-leads/${id}/convert`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-leads-moving'] }),
  })

  const rows: Row[] = useMemo(() => {
    const storageRows: Row[] = (storagePage?.data || []).map((l: Lead) => ({
      key: `s-${l._id}`,
      type: 'Storage Only',
      name: l.fullName,
      phone: l.phone,
      interested: l.storageSizeValue ? `${l.storageSizeValue} ${l.storageSizeUnit}` : '—',
      status: labelize(l.status),
      statusColor: STORAGE_STATUS_COLORS[l.status] || STORAGE_STATUS_COLORS.new,
      addedAt: l.leadDateTime,
      onOpen: () => setViewingLead(l),
      canConvert: l.status !== 'won' && l.status !== 'lost',
      convertLabel: 'Convert to Customer',
      convert: () => convertStorage.mutate(l._id),
      converting: convertStorage.isPending,
    }))
    const movingRows: Row[] = movingLeads.map((l) => ({
      key: `m-${l._id}`,
      type: 'Moving',
      name: l.prospectName || l.customer?.fullName || '—',
      phone: l.prospectPhone || l.customer?.phone || '—',
      interested: l.estimatedVolumeCbm ? `${l.estimatedVolumeCbm} cbm` : '—',
      status: labelize(l.status),
      statusColor: MOVING_STATUS_COLORS[l.status] || MOVING_STATUS_COLORS.new,
      addedAt: l.createdAt,
      href: `/moving/leads/${l._id}`,
      canConvert: l.status !== 'won' && l.status !== 'lost',
      convertLabel: 'Convert to Job',
      convert: () => convertMoving.mutate(l._id),
      converting: convertMoving.isPending,
    }))
    return [...storageRows, ...movingRows].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''))
  }, [storagePage, movingLeads, convertStorage, convertMoving])

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows])
  const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows
  const isLoading = storageLoading || movingLoading

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>My Leads</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{rows.length} lead{rows.length !== 1 ? 's' : ''} assigned to you</div>
        </div>
      </div>

      <UnitAvailabilityStrip />
      <GoalsSection />
      <TasksCard />
      <QuickAddLead />

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap mb-5">
        <button
          onClick={() => setStatusFilter('')}
          style={{ height: 36, borderRadius: 10, background: statusFilter === '' ? PURPLE : '#F3F0EA', color: statusFilter === '' ? 'white' : MUTED, fontSize: 13, fontWeight: 600, padding: '0 14px', border: 'none' }}
          className="hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          All ({rows.length})
        </button>
        {statuses.map((s) => {
          const active = statusFilter === s
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{ height: 36, borderRadius: 10, background: active ? PURPLE : '#F3F0EA', color: active ? 'white' : MUTED, fontSize: 13, fontWeight: 600, padding: '0 14px', border: 'none' }}
              className="hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              {s} ({rows.filter((r) => r.status === s).length})
            </button>
          )
        })}
      </div>

      {/* Recent leads table */}
      <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid rgba(20,8,31,.08)', fontWeight: 700, fontSize: 15, color: INK }}>Recent leads</div>
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <UserPlus size={32} style={{ margin: '0 auto 12px', color: MUTED, opacity: 0.3 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>No leads assigned to you yet</div>
            <div style={{ fontSize: 13, color: MUTED }}>New assignments will show up here.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                  {['Name', 'Phone', 'Interested Unit', 'Type', 'Date', 'Status', ''].map((h) => (
                    <th key={h} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.key} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                    <td style={{ padding: '14px 16px' }}>
                      {r.onOpen ? (
                        <button type="button" onClick={r.onOpen} style={{ fontSize: 14, fontWeight: 600, color: PURPLE, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }} className="hover:opacity-80 transition-opacity">{r.name}</button>
                      ) : (
                        <Link to={r.href!} style={{ fontSize: 14, fontWeight: 600, color: PURPLE }} className="hover:opacity-80 transition-opacity">{r.name}</Link>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{r.phone}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED }}>{r.interested}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED }}>{r.type}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED }}>{r.addedAt ? formatDate(r.addedAt) : '—'}</td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: r.statusColor.bg, color: r.statusColor.fg }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      {r.canConvert && (
                        <button
                          type="button"
                          disabled={r.converting}
                          onClick={r.convert}
                          style={{ height: 28, padding: '0 10px', borderRadius: 8, background: 'transparent', color: PURPLE, border: '1px solid #DDD0FF', fontWeight: 600, fontSize: 11.5, whiteSpace: 'nowrap' }}
                          className="hover:bg-[#F7F3FF] transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {r.converting ? 'Converting…' : r.convertLabel}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!viewingLead}
        title="Lead details"
        onClose={() => { setViewingLead(null); qc.invalidateQueries({ queryKey: ['my-leads-storage'] }) }}
      >
        {viewingLead && <LeadDetailPanel lead={viewingLead} />}
      </Modal>
    </div>
  )
}

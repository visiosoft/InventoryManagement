import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink, MessageCircle, Phone, Plus, Search, UserPlus } from 'lucide-react'
import { api, apiError, leadApi } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Lead, MovingLead, MovingLeadStatus } from '../lib/types'
import { Spinner } from '../components/ui'
import { formatDate } from '../lib/utils'
import { FOLLOW_UP_TONE, followUpState, reminderDay } from '../lib/followUp'
import {
  type TaskItem, type AssignableUser,
  KANBAN_COLUMNS, KanbanBoard, KanbanCard, KanbanColumn, TaskDetailModal, groupTasksByDue,
} from './tasks/shared'
export type { TaskItem, AssignableUser }
export { groupTasksByDue }

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const SIZE_OPTIONS = [10, 25, 35, 50, 75, 100, 150, 200]
const LEAD_SOURCE_OPTIONS = ['manual', 'whatsapp', 'referral', 'walk_in', 'other']
const labelize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

interface ExpiringContract {
  _id: string
  contractNo: string
  customer?: { _id: string; fullName: string; phone?: string; email?: string }
  unit?: { _id: string; unitNumber: string; floor?: string }
  endDate: string
  rate: number
  renewalIntent: 'undecided' | 'renewing' | 'not_renewing'
  daysLeft: number
}

const RENEWAL_OPTIONS: { value: ExpiringContract['renewalIntent']; label: string; activeClass: string }[] = [
  { value: 'undecided', label: 'Undecided', activeClass: 'bg-white text-foreground shadow-sm' },
  { value: 'renewing', label: 'Renewing', activeClass: 'bg-emerald-500 text-white shadow-sm' },
  { value: 'not_renewing', label: 'Not renewing', activeClass: 'bg-destructive text-white shadow-sm' },
]

interface ContractTimelineEntry { at: string; text: string; author?: string }

const RENEWAL_DOT: Record<ExpiringContract['renewalIntent'], string> = {
  undecided: '#A99FB5',
  renewing: '#10B981',
  not_renewing: '#DC2626',
}

// Red once a contract is nearly out of runway, amber mid-week, muted otherwise.
const urgencyColor = (daysLeft: number) => (daysLeft <= 2 ? '#991B1B' : daysLeft <= 4 ? '#B45309' : MUTED)

const sectionLabel = { fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.04em' } as const
const inputStyle = { height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 12.5, width: '100%' } as const
const purpleBtn = { height: 32, padding: '0 12px', borderRadius: 8, background: PURPLE, color: 'white', fontSize: 12, fontWeight: 600, border: 'none' } as const

/** One row in the left-hand master list. */
function RenewalListItem({
  contract, selected, onSelect, notePreview, openFollowUps,
}: {
  contract: ExpiringContract
  selected: boolean
  onSelect: () => void
  notePreview?: string
  openFollowUps?: number
}) {
  const option = RENEWAL_OPTIONS.find((o) => o.value === contract.renewalIntent)
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left cursor-pointer transition-colors"
      style={{
        padding: '10px 12px',
        borderRadius: 12,
        border: `1px solid ${selected ? 'rgba(91,43,201,.35)' : 'transparent'}`,
        background: selected ? '#F7F3FF' : 'transparent',
      }}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <span style={{ fontSize: 13, fontWeight: 700, color: INK }} className="truncate">
          {contract.customer?.fullName || '—'}
        </span>
        <span style={{ fontSize: 11.5, color: MUTED }} className="shrink-0">{contract.unit?.unitNumber}</span>
      </div>
      <div style={{ fontSize: 11.5, fontWeight: contract.daysLeft <= 2 ? 700 : 400, color: urgencyColor(contract.daysLeft), marginTop: 1 }}>
        Expires {formatDate(contract.endDate)} · {contract.daysLeft}d left
      </div>
      <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 6 }}>
        <span
          className="inline-flex items-center gap-1"
          style={{ fontSize: 10, fontWeight: 700, color: '#4A1FA0', background: '#F7F3FF', border: '1px solid rgba(20,8,31,.06)', borderRadius: 999, padding: '2px 8px' }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: RENEWAL_DOT[contract.renewalIntent], display: 'inline-block' }} />
          {option?.label || 'Undecided'}
        </span>
        {!!openFollowUps && openFollowUps > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: PURPLE, background: '#F0E9FF', borderRadius: 999, padding: '2px 8px' }}>
            {openFollowUps} open follow-up{openFollowUps > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {notePreview && (
        <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5 }} className="truncate">{notePreview}</div>
      )}
    </button>
  )
}

/** Right-hand detail pane for the selected contract. */
function RenewalDetail({ contract, onChanged, onBack }: { contract: ExpiringContract; onChanged: () => void; onBack: () => void }) {
  const qc = useQueryClient()
  const [noteText, setNoteText] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDue, setTaskDue] = useState('')
  const [err, setErr] = useState('')

  // GET /contracts/:id answers { contract, payments, documents, invoices } —
  // the timeline is nested under `contract`, so unwrap it here. Reading
  // r.data.timeline silently yielded undefined and History always looked empty.
  const { data: detail } = useQuery<{ timeline?: ContractTimelineEntry[] }>({
    queryKey: ['contract-timeline', contract._id],
    queryFn: () => api.get(`/contracts/${contract._id}`).then((r) => r.data?.contract ?? r.data),
  })
  const { data: linkedTasks = [] } = useQuery<TaskItem[]>({
    queryKey: ['contract-tasks', contract._id],
    queryFn: () => api.get('/tasks', { params: { leadId: contract._id } }).then((r) => r.data),
  })

  const invalidateDetail = () => {
    qc.invalidateQueries({ queryKey: ['contract-timeline', contract._id] })
    qc.invalidateQueries({ queryKey: ['contract-tasks', contract._id] })
    onChanged()
  }

  const setIntent = useMutation({
    mutationFn: (renewalIntent: string) => api.put(`/contracts/${contract._id}`, { renewalIntent }),
    onSuccess: () => { setErr(''); onChanged() },
    onError: (e) => setErr(apiError(e)),
  })
  const addNote = useMutation({
    mutationFn: () => api.post(`/contracts/${contract._id}/notes`, { text: noteText }),
    onSuccess: () => { setNoteText(''); setErr(''); invalidateDetail() },
    onError: (e) => setErr(apiError(e)),
  })
  const addTask = useMutation({
    mutationFn: () => api.post('/tasks', {
      title: taskTitle,
      dueDate: taskDue || undefined,
      leadId: contract._id,
      leadType: 'contract',
      leadName: `${contract.customer?.fullName || 'Tenant'} · ${contract.unit?.unitNumber || ''}`,
    }),
    onSuccess: () => { setTaskTitle(''); setTaskDue(''); setErr(''); invalidateDetail() },
    onError: (e) => setErr(apiError(e)),
  })
  const toggleTask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/tasks/${id}`, { status }),
    onSuccess: () => { setErr(''); invalidateDetail() },
    onError: (e) => setErr(apiError(e)),
  })

  const digits = (contract.customer?.phone || '').replace(/[^0-9]/g, '')
  const timeline = [...(detail?.timeline || [])].reverse()
  const openFollowUps = linkedTasks.filter((t) => t.status !== 'done')

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onBack}
        className="lg:hidden inline-flex items-center gap-1 cursor-pointer mb-2"
        style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 600, color: PURPLE }}
      >
        <ChevronLeft size={14} /> Back to list
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div style={{ fontSize: 16, fontWeight: 700, color: INK }} className="truncate">
            {contract.customer?.fullName || '—'}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {contract.unit?.unitNumber || '—'} · Expires {formatDate(contract.endDate)} · {contract.daysLeft}d left
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {contract.customer?.phone && (
            <a href={`tel:${contract.customer.phone}`} title="Call" className="p-1.5 rounded-lg hover:bg-blue-50 transition-colors">
              <Phone size={15} className="text-blue-600" />
            </a>
          )}
          {digits && (
            <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" title="WhatsApp" className="p-1.5 rounded-lg hover:bg-green-50 transition-colors">
              <MessageCircle size={15} className="text-green-600" />
            </a>
          )}
          {contract.customer?.phone && (
            <span style={{ fontSize: 12, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{contract.customer.phone}</span>
          )}
        </div>
      </div>

      {/* Renewal status */}
      <div className="mt-3 flex gap-1 rounded-full bg-black/5 p-1 w-fit">
        {RENEWAL_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={setIntent.isPending}
            onClick={() => setIntent.mutate(o.value)}
            className={`h-7 px-3 rounded-full text-[11.5px] font-semibold cursor-pointer transition-colors disabled:opacity-50 ${contract.renewalIntent === o.value ? o.activeClass : 'bg-transparent text-muted-foreground hover:bg-muted'}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {err && <p className="text-xs text-destructive mt-2">{err}</p>}

      {/* Forms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        <div style={{ background: '#FDFCFA', border: '1px solid rgba(20,8,31,.08)', borderRadius: 12, padding: 12 }}>
          <div style={sectionLabel}>Add a note</div>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Call outcome, tenant response…"
            rows={3}
            style={{ ...inputStyle, height: 'auto', padding: '8px 10px', marginTop: 6, resize: 'vertical' }}
          />
          <button
            type="button"
            disabled={!noteText.trim() || addNote.isPending}
            onClick={() => addNote.mutate()}
            style={{ ...purpleBtn, marginTop: 8 }}
            className="disabled:opacity-50 cursor-pointer"
          >
            {addNote.isPending ? 'Saving…' : 'Save note'}
          </button>
        </div>

        <div style={{ background: '#FDFCFA', border: '1px solid rgba(20,8,31,.08)', borderRadius: 12, padding: 12 }}>
          <div style={sectionLabel}>Add a follow-up task</div>
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Follow-up task title"
            style={{ ...inputStyle, marginTop: 6 }}
          />
          <input
            type="date"
            value={taskDue}
            onChange={(e) => setTaskDue(e.target.value)}
            style={{ ...inputStyle, marginTop: 8 }}
          />
          <button
            type="button"
            disabled={!taskTitle.trim() || addTask.isPending}
            onClick={() => addTask.mutate()}
            style={{ ...purpleBtn, marginTop: 8 }}
            className="disabled:opacity-50 cursor-pointer"
          >
            {addTask.isPending ? 'Saving…' : 'Add task'}
          </button>
        </div>
      </div>

      {/* Follow-ups */}
      <div className="mt-4">
        <div style={sectionLabel}>Follow-ups</div>
        {linkedTasks.length === 0 ? (
          <p style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>No open follow-ups for this unit.</p>
        ) : (
          <div className="space-y-1 mt-1.5">
            {linkedTasks.map((t) => (
              <div key={t._id} className="flex items-center justify-between gap-2" style={{ fontSize: 12.5 }}>
                <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={t.status === 'done'}
                    disabled={toggleTask.isPending}
                    onChange={() => toggleTask.mutate({ id: t._id, status: t.status === 'done' ? 'todo' : 'done' })}
                    className="cursor-pointer"
                  />
                  <span className="truncate" style={{ color: t.status === 'done' ? MUTED : INK, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                    {t.title}
                  </span>
                </label>
                <span style={{ color: MUTED, fontSize: 11, whiteSpace: 'nowrap' }}>{t.dueDate ? formatDate(t.dueDate) : ''}</span>
              </div>
            ))}
            {openFollowUps.length === 0 && (
              <p style={{ fontSize: 11.5, color: MUTED }}>No open follow-ups for this unit.</p>
            )}
          </div>
        )}
      </div>

      {/* History */}
      <div className="mt-4">
        <div style={sectionLabel}>History</div>
        {timeline.length === 0 ? (
          <p style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>No notes or activity yet.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-auto mt-1.5">
            {timeline.map((t, i) => (
              <div key={i} style={{ fontSize: 12.5, color: '#4A4357' }}>
                <div className="flex items-start justify-between gap-2">
                  <span>{t.text}</span>
                  <span style={{ color: MUTED, fontSize: 11, whiteSpace: 'nowrap' }}>{formatDate(t.at)}</span>
                </div>
                {t.author && (
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>by {t.author}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


function TasksCard() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState('medium')
  const [assignedTo, setAssignedTo] = useState('')
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)

  const { data: tasks = [], isLoading } = useQuery<TaskItem[]>({
    queryKey: ['my-tasks-all'],
    queryFn: () => api.get('/tasks', { params: { status: 'todo,in_progress,done' } }).then((r) => r.data),
  })
  const { data: assignableUsers = [] } = useQuery<AssignableUser[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
    enabled: showAdd || !!selectedTask,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['my-tasks-all'] })

  const createTask = useMutation({
    mutationFn: () => api.post('/tasks', { title, dueDate: dueDate || undefined, priority, assignedTo: assignedTo || undefined }),
    onSuccess: () => { invalidate(); setTitle(''); setDueDate(''); setPriority('medium'); setAssignedTo(''); setShowAdd(false) },
  })
  const updateTask = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/tasks/${id}`, body),
    onSuccess: invalidate,
  })

  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="flex items-center justify-between mb-3">
        <div style={{ fontWeight: 700, fontSize: 15, color: INK }}>Follow-ups & Tasks</div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          style={{ height: 30, padding: '0 10px', borderRadius: 8, background: PURPLE, color: 'white', fontSize: 12, fontWeight: 600, border: 'none' }}
          className="flex items-center gap-1.5 hover:opacity-90 transition-opacity cursor-pointer"
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {showAdd && (
        <div className="flex flex-col gap-2 mb-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task description"
            style={{ height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 12.5 }}
          />
          <div className="flex gap-2 flex-wrap">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={{ flex: 1, minWidth: 120, height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 12.5 }}
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              style={{ height: 34, padding: '0 8px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 12.5 }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              style={{ height: 34, padding: '0 8px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 12.5, minWidth: 110 }}
            >
              <option value="">Assign to me</option>
              {assignableUsers.map((u) => (
                <option key={u._id} value={u._id}>{u.name}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!title.trim() || createTask.isPending}
              onClick={() => createTask.mutate()}
              style={{ height: 34, padding: '0 14px', borderRadius: 8, background: PURPLE, color: 'white', fontSize: 12, fontWeight: 600, border: 'none' }}
              className="disabled:opacity-50 cursor-pointer shrink-0"
            >
              {createTask.isPending ? '…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">No tasks yet.</p>
      ) : (
        <KanbanBoard tasks={tasks} onMove={(id, status) => updateTask.mutate({ id, body: { status } })}>
          <div className="grid grid-cols-3 gap-2.5" style={{ flex: 1, minHeight: 0 }}>
            {KANBAN_COLUMNS.map((col) => {
              const items = tasks.filter((t) => t.status === col.status)
              return (
                <KanbanColumn key={col.status} col={col} count={items.length}>
                  {items.map((t) => (
                    <KanbanCard key={t._id} task={t} onOpen={setSelectedTask}
                      onToggleDone={(task) => updateTask.mutate({ id: task._id, body: { status: task.status === 'done' ? 'todo' : 'done' } })} />
                  ))}
                </KanbanColumn>
              )
            })}
          </div>
        </KanbanBoard>
      )}

      {selectedTask && (
        <TaskDetailModal
          task={tasks.find((t) => t._id === selectedTask._id) ?? selectedTask}
          onClose={() => setSelectedTask(null)}
          onStatusChange={(status) => updateTask.mutate({ id: selectedTask._id, body: { status } })}
          assignableUsers={assignableUsers}
          onDeleted={() => setSelectedTask(null)}
        />
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

// The expiring-soon payload carries no note text or task counts, and we don't
// want N extra requests just to decorate the list. These read react-query's
// cache only — a row shows the extras once its detail has been opened, and
// stays plain otherwise. Nothing is fetched or invented here.
function notePreviewFor(qc: QueryClient, id: string) {
  const detail = qc.getQueryData<{ timeline?: ContractTimelineEntry[] }>(['contract-timeline', id])
  return detail?.timeline?.length ? detail.timeline[detail.timeline.length - 1].text : undefined
}
function openFollowUpsFor(qc: QueryClient, id: string) {
  const tasks = qc.getQueryData<TaskItem[]>(['contract-tasks', id])
  return tasks ? tasks.filter((t) => t.status !== 'done').length : undefined
}

// Master–detail: the list stays put on the left while the right pane carries
// the work (status, notes, follow-ups, history), so opening one renewal no
// longer shoves every other row down the page.
function RenewalsCard() {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showDetailOnMobile, setShowDetailOnMobile] = useState(false)

  const { data: contracts = [], isLoading } = useQuery<ExpiringContract[]>({
    queryKey: ['expiring-contracts'],
    queryFn: () => api.get('/contracts/expiring-soon', { params: { days: 7 } }).then((r) => r.data),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['expiring-contracts'] })

  // Auto-select the first row so the detail pane isn't blank on desktop.
  useEffect(() => {
    if (contracts.length === 0) { setSelectedId(null); return }
    setSelectedId((cur) => (cur && contracts.some((c) => c._id === cur) ? cur : contracts[0]._id))
  }, [contracts])

  const selected = contracts.find((c) => c._id === selectedId) || null

  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: INK, marginBottom: 2 }}>Renewals — expiring in 7 days</div>
      <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 10 }}>Call to confirm, log notes, or set a follow-up task</div>

      {isLoading ? (
        <Spinner />
      ) : contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Nothing expiring in the next 7 days.</p>
      ) : (
        <div className="flex flex-col lg:flex-row gap-4" style={{ minHeight: 0 }}>
          {/* Left: master list */}
          <div
            className={`${showDetailOnMobile ? 'hidden lg:block' : 'block'} shrink-0 w-full lg:w-[290px] lg:border-r lg:border-[rgba(20,8,31,0.08)]`}
          >
            <div className="space-y-1 overflow-y-auto lg:pr-3" style={{ maxHeight: 520 }}>
              {contracts.map((c) => (
                <RenewalListItem
                  key={c._id}
                  contract={c}
                  selected={c._id === selectedId}
                  onSelect={() => { setSelectedId(c._id); setShowDetailOnMobile(true) }}
                  notePreview={notePreviewFor(qc, c._id)}
                  openFollowUps={openFollowUpsFor(qc, c._id)}
                />
              ))}
            </div>
          </div>

          {/* Right: detail */}
          <div
            className={`${showDetailOnMobile ? 'block' : 'hidden lg:block'} flex-1 min-w-0 lg:pl-1`}
          >
            {selected ? (
              <RenewalDetail
                key={selected._id}
                contract={selected}
                onChanged={invalidate}
                onBack={() => setShowDetailOnMobile(false)}
              />
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">Pick a renewal from the list.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Tasks and renewals used to sit side by side, which squeezed both. Tabbed
// instead, tasks first since that's the daily driver — the counts stay
// visible on the inactive tab so nothing gets forgotten.
function WorkTabs() {
  const [tab, setTab] = useState<'tasks' | 'renewals'>('tasks')
  const { user } = useAuth()
  // Accounts chase invoices, not renewals — that queue belongs to sales.
  const isAccounts = user?.role === 'accounts'

  const { data: integrations } = useQuery<{ zohoBooks?: { configured: boolean; newInvoiceUrl?: string } }>({
    queryKey: ['integration-status'],
    queryFn: () => api.get('/integrations/status').then((r) => r.data),
    enabled: isAccounts,
    staleTime: 10 * 60_000,
  })
  const zohoNewInvoiceUrl = integrations?.zohoBooks?.newInvoiceUrl

  // Same query keys the cards below use, so react-query serves these from
  // cache rather than issuing extra requests.
  const { data: tasks = [] } = useQuery<TaskItem[]>({
    queryKey: ['my-tasks-all'],
    queryFn: () => api.get('/tasks', { params: { status: 'todo,in_progress,done' } }).then((r) => r.data),
  })
  const { data: contracts = [] } = useQuery<ExpiringContract[]>({
    queryKey: ['expiring-contracts'],
    queryFn: () => api.get('/contracts/expiring-soon', { params: { days: 7 } }).then((r) => r.data),
    enabled: !isAccounts,
  })

  const TABS = [
    { key: 'tasks' as const, label: 'Follow-ups & Tasks', count: tasks.filter((t) => t.status !== 'done').length },
    ...(isAccounts ? [] : [{ key: 'renewals' as const, label: 'Renewals — 7 days', count: contracts.length }]),
  ]

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div className="flex gap-1 rounded-full p-1 w-fit" style={{ background: '#F6F0E4' }}>
        {TABS.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[13px] font-semibold cursor-pointer transition-colors"
              style={active
                ? { background: 'white', color: INK, boxShadow: '0 1px 2px rgba(20,8,31,.10)' }
                : { background: 'transparent', color: MUTED }}
            >
              {t.label}
              {t.count > 0 && (
                <span style={{
                  fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '1px 7px',
                  background: active ? PURPLE : 'rgba(20,8,31,.08)',
                  color: active ? 'white' : MUTED,
                }}>
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {isAccounts && (
        <a
          href={zohoNewInvoiceUrl || undefined}
          target="_blank"
          rel="noopener noreferrer"
          title={zohoNewInvoiceUrl
            ? 'Opens Zoho Books to raise a new invoice'
            : 'Zoho Books is not connected'}
          className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-[13px] font-bold text-white ${zohoNewInvoiceUrl ? 'cursor-pointer hover:opacity-90' : 'opacity-50 pointer-events-none'}`}
          style={{ background: PURPLE, textDecoration: 'none' }}
        >
          <ExternalLink size={14} /> Create invoice in Zoho Books
        </a>
      )}
      </div>
      {tab === 'tasks' || isAccounts ? <TasksCard /> : <RenewalsCard />}
    </div>
  )
}

type Row = {
  key: string
  type: 'Storage Only' | 'Moving'
  name: string
  initials: string
  phone: string
  // Digits only, for the tel: and inbox links.
  digits: string
  interested: string
  status: string
  statusColor: { bg: string; fg: string }
  addedAt?: string
  // Storage leads carry these; a moving lead has neither.
  temperature?: '' | 'hot' | 'warm' | 'cold'
  // How many attempts have been made to reach them.
  attempts?: number
  followUpAt?: string | null
  followUpKind?: 'date' | 'week' | 'month'
  // Landed on this person and not yet opened by them.
  unseen?: boolean
  href?: string
  onOpen?: () => void
  canConvert: boolean
  convertLabel: string
  convert: () => void
  converting: boolean
}

/** Two letters to stand in for a face. */
function initialsOf(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
}

const TEMP_TONE: Record<string, { bg: string; fg: string }> = {
  hot: { bg: 'rgba(220,38,38,.09)', fg: '#DC2626' },
  warm: { bg: 'rgba(217,119,6,.09)', fg: '#D97706' },
  cold: { bg: 'rgba(37,99,235,.08)', fg: '#2563EB' },
}

/**
 * One template for the header and every row, so the columns actually line up.
 *
 * Flex could not do this: a stage badge is as wide as its label, and a lead
 * with no temperature had no badge at all, so everything after it slid left by
 * a different amount on every row. A grid gives each column the same width
 * whatever is in it, including nothing.
 */
const LEAD_GRID = '38px minmax(110px, 1.5fr) 132px 66px minmax(70px, 0.8fr) minmax(104px, 1fr) 176px 16px'

/** The short form the list shows: state first, date second. */
function followUpLabel(row: Row): { text: string; color: string } | null {
  const day = reminderDay(row.followUpAt, row.followUpKind)
  if (!day) return null
  const { tone, days } = followUpState(day)
  const date = formatDate(day)
  const text = tone === 'overdue' ? `Overdue · ${date}`
    : tone === 'today' ? `Today · ${date}`
      : tone === 'soon' ? `In ${days}d · ${date}`
        : date
  return { text, color: FOLLOW_UP_TONE[tone].color }
}

const STORAGE_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  new: { bg: '#E8F9EE', fg: '#0F7A3D' },
  contacted: { bg: '#E0F2FE', fg: '#0369A1' },
  qualified: { bg: '#F3E8FF', fg: '#7C3AED' },
  contact_attempted: { bg: '#FEF3C7', fg: '#B45309' },
  site_visit_scheduled: { bg: '#DBEAFE', fg: '#1D4ED8' },
  follow_up_scheduled: { bg: '#FFEDD5', fg: '#C2410C' },
  quotation_sent: { bg: '#F3E8FF', fg: '#7C3AED' },
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
  const navigate = useNavigate()
  const [showAllLeads, setShowAllLeads] = useState(false)
  const [leadSearch, setLeadSearch] = useState('')
  const [tempFilter, setTempFilter] = useState('')

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

  /* Opening a lead clears its highlight.
   *
   * Fire-and-forget, and the list is refreshed rather than the row patched:
   * the server decides whether it counted (only the owner can mark their own
   * lead seen), so guessing here would let the highlight disappear for an
   * admin who merely looked. */
  const markSeen = useCallback((l: Lead) => {
    if (l.ownerSeenAt) return
    api.post(`/leads/${l._id}/seen`)
      .then(() => qc.invalidateQueries({ queryKey: ['my-leads-storage'] }))
      .catch(() => {})
  }, [qc])

  const rows: Row[] = useMemo(() => {
    const storageRows: Row[] = (storagePage?.data || []).map((l: Lead) => ({
      key: `s-${l._id}`,
      type: 'Storage Only',
      name: l.fullName,
      initials: initialsOf(l.fullName),
      phone: l.phone,
      digits: String(l.phoneNormalized || l.phone || '').replace(/\D/g, ''),
      temperature: l.temperature,
      attempts: (l.attempts || []).length,
      followUpAt: l.followUpAt,
      followUpKind: l.followUpKind,
      interested: l.storageSizeValue ? `${l.storageSizeValue} ${l.storageSizeUnit}` : '—',
      status: labelize(l.status),
      statusColor: STORAGE_STATUS_COLORS[l.status] || STORAGE_STATUS_COLORS.new,
      addedAt: l.leadDateTime,
      unseen: !l.ownerSeenAt,
      href: `/leads/${l._id}`,
      onOpen: () => markSeen(l),
      canConvert: l.status !== 'won' && l.status !== 'lost',
      convertLabel: 'Convert to Customer',
      convert: () => convertStorage.mutate(l._id),
      converting: convertStorage.isPending,
    }))
    const movingRows: Row[] = movingLeads.map((l) => ({
      key: `m-${l._id}`,
      type: 'Moving',
      name: l.prospectName || l.customer?.fullName || '—',
      initials: initialsOf(l.prospectName || l.customer?.fullName || ''),
      phone: l.prospectPhone || l.customer?.phone || '—',
      digits: String(l.prospectPhone || l.customer?.phone || '').replace(/\D/g, ''),
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
    // Anything not yet opened sits at the top, newest first within each group.
    // A rep should not have to hunt down the page for what has just been handed
    // to them.
    return [...storageRows, ...movingRows].sort((a, b) => {
      if (Boolean(a.unseen) !== Boolean(b.unseen)) return a.unseen ? -1 : 1
      return (b.addedAt || '').localeCompare(a.addedAt || '')
    })
  }, [storagePage, movingLeads, convertStorage, convertMoving, markSeen])

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows])

  // The three narrow together rather than replacing one another: a rep looking
  // for a hot lead called Ahmed in Quotation Sent is asking one question.
  const filtered = useMemo(() => {
    const q = leadSearch.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (tempFilter && r.temperature !== tempFilter) return false
      if (q && !r.name.toLowerCase().includes(q) && !r.phone.includes(q)) return false
      return true
    })
  }, [rows, statusFilter, tempFilter, leadSearch])

  // Twenty is about a screen's worth to scroll — enough that a rep can see the
  // whole of a normal day without the page running on for ever once the list
  // grows into the hundreds.
  const PAGE_SIZE = 20
  const visible = showAllLeads ? filtered : filtered.slice(0, PAGE_SIZE)
  const hidden = filtered.length - visible.length
  const isLoading = storageLoading || movingLoading

  // Accounts works invoices, not leads. The whole lead half of this board is
  // hidden for that role, leaving tasks and unit availability.
  const isAccounts = user?.role === 'accounts'

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      <style>{`
        @keyframes lead-new {
          0%, 100% { background: transparent; }
          50% { background: #F3EDFF; }
        }
        /* Anyone who has asked not to see motion gets the left bar and the dot
           instead, which carry the same information without the pulse. */
        @media (prefers-reduced-motion: reduce) {
          @keyframes lead-new { 0%, 100% { background: #F7F3FF; } }
        }
      `}</style>
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>
            {isAccounts ? 'My Work' : 'My Leads'}
          </div>
          {!isAccounts && (
            <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{rows.length} lead{rows.length !== 1 ? 's' : ''} assigned to you</div>
          )}
        </div>
      </div>

      {/* No separate follow-ups card: a follow-up now raises a task the moment
          it is scheduled, so it already appears under Follow-ups & Tasks. Two
          lists of the same thing meant ticking it off in one left it standing
          in the other. */}
      {!isAccounts && <QuickAddLead />}

      {!isAccounts && (
        <>
      {/* Your leads */}
      <div className="flex items-end justify-between flex-wrap" style={{ gap: 14, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontFamily: "'Bricolage Grotesque', serif", fontWeight: 700, fontSize: 28, letterSpacing: '-0.02em', margin: 0, color: INK }}>Your leads</h1>
          <p style={{ color: MUTED, fontSize: 14, margin: '4px 0 0' }}>
            {filtered.length} {filtered.length === 1 ? 'lead' : 'leads'}
            {filtered.length !== rows.length ? ` of ${rows.length}` : ''}
          </p>
        </div>
      </div>

      {/* Toolbar: name or number, then how warm, then where in the pipeline. */}
      <div className="flex items-center flex-wrap" style={{ gap: 12, marginBottom: 18 }}>
        <div className="flex items-center" style={{ gap: 8, background: 'white', border: '1px solid rgba(20,8,31,.16)', borderRadius: 999, padding: '0 14px', height: 42, flex: '1 1 260px', maxWidth: 340 }}>
          <Search size={15} style={{ color: MUTED, flex: '0 0 auto' }} />
          <input
            value={leadSearch}
            onChange={(e) => setLeadSearch(e.target.value)}
            placeholder="Search by name or phone"
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 14, width: '100%', fontFamily: 'inherit', color: INK }}
          />
        </div>

        <div className="flex" style={{ gap: 6 }}>
          {[{ v: '', label: 'All' }, { v: 'hot', label: 'Hot' }, { v: 'warm', label: 'Warm' }, { v: 'cold', label: 'Cold' }].map((o) => {
            const on = tempFilter === o.v
            const tone = o.v ? TEMP_TONE[o.v] : null
            return (
              <button
                key={o.v || 'all'}
                type="button"
                onClick={() => setTempFilter(o.v)}
                className="cursor-pointer whitespace-nowrap"
                style={{
                  height: 38, padding: '0 16px', borderRadius: 999, fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  background: on && tone ? tone.bg : 'white',
                  color: on ? (tone ? tone.fg : INK) : MUTED,
                  border: `1px solid ${on && tone ? tone.fg : 'rgba(20,8,31,.16)'}`,
                }}
              >
                {o.label}
              </button>
            )
          })}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="cursor-pointer"
          style={{ height: 42, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(20,8,31,.16)', background: 'white', fontSize: 13, fontWeight: 600, color: MUTED, fontFamily: 'inherit' }}
        >
          <option value="">All stages</option>
          {statuses.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
      </div>

      {/* The list itself */}
      <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.10)', borderRadius: 22, boxShadow: '0 1px 2px rgba(20,8,31,.06), 0 2px 8px rgba(20,8,31,.04)', overflow: 'hidden' }}>
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <UserPlus size={32} style={{ margin: '0 auto 12px', color: MUTED, opacity: 0.3 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>
              {rows.length === 0 ? 'No leads assigned to you yet' : 'No leads match your filters.'}
            </div>
            <div style={{ fontSize: 13, color: MUTED }}>
              {rows.length === 0 ? 'New assignments will show up here.' : 'Try a wider stage or temperature.'}
            </div>
          </div>
        ) : (
          /* Narrow screens scroll the list sideways rather than crushing the
             columns back out of alignment. */
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 940 }}>
              <div
                className="grid items-center"
                style={{
                  gridTemplateColumns: LEAD_GRID, gap: 10, padding: '12px 20px',
                  borderBottom: '1px solid rgba(20,8,31,.10)', background: '#FBF8F2',
                  fontSize: 11.5, fontWeight: 700, color: MUTED,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}
              >
                <span />
                <span>Name</span>
                <span>Stage</span>
                <span>Temp</span>
                <span>Wants</span>
                <span>Follow-up</span>
                <span />
                <span />
              </div>

              {visible.map((r) => {
                const follow = followUpLabel(r)
                const temp = r.temperature ? TEMP_TONE[r.temperature] : null
                return (
                  <div
                    key={r.key}
                    role="link"
                    tabIndex={0}
                    onClick={() => { r.onOpen?.(); if (r.href) navigate(r.href) }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      r.onOpen?.()
                      if (r.href) navigate(r.href)
                    }}
                    className="grid items-center hover:bg-[#FAF8F5] transition-colors"
                    style={{
                      gridTemplateColumns: LEAD_GRID, gap: 10, padding: '16px 20px',
                      borderBottom: '1px solid rgba(20,8,31,.10)',
                      cursor: 'pointer', color: INK,
                      // A soft pulse rather than a hard flash: it has to be
                      // noticeable across a room without being unbearable to
                      // sit in front of all day.
                      ...(r.unseen ? { animation: 'lead-new 1.6s ease-in-out infinite', borderLeft: `3px solid ${PURPLE}` } : null),
                    }}
                  >
                    <div style={{ width: 38, height: 38, borderRadius: 999, background: '#EDE5FF', color: '#4A1FA0', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13 }}>
                      {r.initials}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontWeight: 700, fontSize: 14 }}>
                        {r.unseen && (
                          <span
                            title="Assigned to you and not opened yet"
                            style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 999, background: PURPLE, marginRight: 7, verticalAlign: 'middle' }}
                          />
                        )}
                        {r.name}
                      </div>
                      <div className="truncate" style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{r.phone}</div>
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <span className="inline-flex truncate" style={{ maxWidth: '100%', padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: r.statusColor.bg, color: r.statusColor.fg }}>
                        {r.status}
                      </span>
                    </div>

                    {/* Rendered even when there is no temperature, so the
                        columns after it do not move. */}
                    <div style={{ minWidth: 0 }}>
                      {temp && (
                        <span className="inline-flex whitespace-nowrap" style={{ padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: temp.bg, color: temp.fg }}>
                          {String(r.temperature).charAt(0).toUpperCase() + String(r.temperature).slice(1)}
                        </span>
                      )}
                    </div>

                    <div className="truncate" style={{ minWidth: 0, fontSize: 12.5, color: '#4A4357' }}>{r.interested}</div>

                    {/* The follow-up if there is one, otherwise when they
                        arrived — the column is about when this lead next needs
                        attention. */}
                    <div style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600, color: follow ? follow.color : MUTED }}>
                        {follow ? follow.text : (r.addedAt ? formatDate(r.addedAt) : '—')}
                      </div>
                      {Boolean(r.attempts) && (
                        <div className="truncate" style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>
                          {r.attempts} attempt{r.attempts === 1 ? '' : 's'}
                        </div>
                      )}
                    </div>

                    {/* Inside a row that navigates on click, so each of these
                        stops the click from also opening the lead. */}
                    <div className="flex items-center justify-end" style={{ gap: 6, minWidth: 0 }}>
                      {r.digits && (
                        <a
                          href={`tel:+${r.digits}`}
                          title="Call"
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 30, height: 30, borderRadius: 999, background: '#F7F3FF', color: '#4A1FA0', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}
                        >
                          <Phone size={13} />
                        </a>
                      )}
                      {r.digits && r.type === 'Storage Only' && (
                        <Link
                          to={`/whatsapp?phone=${r.digits}`}
                          title="Open the chat"
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: 30, height: 30, borderRadius: 999, background: '#F7F3FF', color: '#4A1FA0', display: 'grid', placeItems: 'center', flex: '0 0 auto' }}
                        >
                          <MessageCircle size={13} />
                        </Link>
                      )}
                      {r.canConvert && (
                        <button
                          type="button"
                          disabled={r.converting}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); r.convert() }}
                          style={{ height: 30, padding: '0 10px', borderRadius: 999, background: 'transparent', color: PURPLE, border: '1px solid #DDD0FF', fontWeight: 600, fontSize: 11.5, whiteSpace: 'nowrap' }}
                          className="hover:bg-[#F7F3FF] transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {r.converting ? 'Converting…' : r.convertLabel}
                        </button>
                      )}
                    </div>

                    <ChevronRight size={16} style={{ color: MUTED }} />
                  </div>
                )
              })}
            </div>
          </div>
        )}

      {/* Say how much of the list this is. A table that silently stops at
            twenty reads as "that is all of them". */}
        {!isLoading && filtered.length > PAGE_SIZE && (
          <div style={{ padding: '14px 22px', borderTop: '1px solid rgba(20,8,31,.08)', background: '#FAF8F5', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: MUTED }}>
              Showing {visible.length} of {filtered.length} leads
              {hidden > 0 ? ` — ${hidden} more` : ''}
            </span>
            <button
              type="button"
              onClick={() => setShowAllLeads((v) => !v)}
              style={{ height: 34, borderRadius: 10, background: 'white', border: '1px solid rgba(20,8,31,.14)', color: INK, fontSize: 13, fontWeight: 600, padding: '0 14px' }}
              className="hover:bg-white/60 transition-colors cursor-pointer"
            >
              {showAllLeads ? 'Show fewer' : `Show all ${filtered.length}`}
            </button>
          </div>
        )}
      </div>
        </>
      )}

      <WorkTabs />

      <UnitAvailabilityStrip />

      <GoalsSection />
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, CardBody, Button, Field, Input, Select, Textarea, SlideOver, Spinner } from '../components/ui'
import { formatDate } from '../lib/utils'
import {
  type TaskItem, type AssignableUser,
  KANBAN_COLUMNS, KanbanBoard, KanbanCard, KanbanColumn, TaskDetailModal, TypePill,
  PRIORITY_DOT, PRIORITY_PILL, STATUS_PILL, isDueSoon, INK, MUTED, PURPLE,
} from './tasks/shared'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const

const LEAD_TYPE_OPTIONS = [
  { value: '', label: 'All follow-ups' },
  { value: 'storage', label: 'Storage leads' },
  { value: 'moving', label: 'Moving leads' },
  { value: 'contract', label: 'Contract renewals' },
]

type ViewMode = 'kanban' | 'list' | 'calendar'
const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'kanban', label: 'Board' },
  { value: 'list', label: 'List' },
  { value: 'calendar', label: 'Calendar' },
]

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Local-time YYYY-MM-DD key, matched against the first 10 chars of an ISO dueDate. */
function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Month grid of tasks by due date. Days outside the current month are dimmed,
// today is highlighted, and a day with more chips than fit collapses the rest
// behind a "+N more" toggle.
function CalendarView({ tasks, onOpenTask }: { tasks: TaskItem[]; onOpenTask: (t: TaskItem) => void }) {
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1) })
  const [expandedDay, setExpandedDay] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, TaskItem[]>()
    for (const t of tasks) {
      if (!t.dueDate) continue
      const key = t.dueDate.slice(0, 10)
      const bucket = map.get(key)
      if (bucket) bucket.push(t)
      else map.set(key, [t])
    }
    for (const list of map.values()) list.sort((a, b) => a.title.localeCompare(b.title))
    return map
  }, [tasks])

  const cells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const total = Math.ceil((first.getDay() + daysInMonth) / 7) * 7
    return Array.from({ length: total }, (_, i) => {
      const d = new Date(first)
      d.setDate(1 - first.getDay() + i)
      return d
    })
  }, [cursor])

  const shiftMonth = (delta: number) => {
    setExpandedDay(null)
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  }

  const todayKey = dayKey(new Date())
  const undated = tasks.filter((t) => !t.dueDate)

  const navBtn = 'flex items-center justify-center rounded-lg cursor-pointer hover:bg-black/5 transition-colors'
  const navStyle: React.CSSProperties = { width: 30, height: 30, border: '1px solid rgba(20,8,31,.10)', color: INK, background: 'white' }

  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,.10)', borderRadius: 18, padding: 16 }}>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => shiftMonth(-1)} className={navBtn} style={navStyle} title="Previous month">
            <ChevronLeft size={16} />
          </button>
          <div style={{ ...HEADING, fontSize: 18, fontWeight: 700, color: INK, minWidth: 160, textAlign: 'center' }}>
            {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
          </div>
          <button type="button" onClick={() => shiftMonth(1)} className={navBtn} style={navStyle} title="Next month">
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => { setExpandedDay(null); const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)) }}
          style={{ height: 30, padding: '0 12px', borderRadius: 999, border: '1px solid rgba(20,8,31,.10)', background: 'white', fontSize: 12, fontWeight: 600, color: MUTED }}
          className="cursor-pointer hover:bg-black/5 transition-colors"
        >
          Today
        </button>
      </div>

      <div className="grid grid-cols-7" style={{ gap: 6 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.06em', textAlign: 'center', paddingBottom: 4 }}>
            {w}
          </div>
        ))}
        {cells.map((d) => {
          const key = dayKey(d)
          const outside = d.getMonth() !== cursor.getMonth()
          const isToday = key === todayKey
          const dayTasks = byDay.get(key) || []
          const expanded = expandedDay === key
          const visible = expanded ? dayTasks : dayTasks.slice(0, 3)
          const hidden = dayTasks.length - visible.length
          return (
            <div
              key={key}
              style={{
                minHeight: 104,
                borderRadius: 12,
                padding: 6,
                background: isToday ? '#F7F3FF' : outside ? 'rgba(246,240,228,.45)' : '#FBF8F2',
                border: isToday ? `1px solid ${PURPLE}` : '1px solid rgba(20,8,31,.06)',
                opacity: outside ? 0.55 : 1,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 600, color: isToday ? PURPLE : MUTED, textAlign: 'right', marginBottom: 4, paddingRight: 2 }}>
                {d.getDate()}
              </div>
              <div className="space-y-1">
                {visible.map((t) => {
                  const done = t.status === 'done'
                  const pill = PRIORITY_PILL[t.priority] || PRIORITY_PILL.low
                  return (
                    <button
                      key={t._id}
                      type="button"
                      onClick={() => onOpenTask(t)}
                      title={t.title}
                      className="w-full flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
                      style={{
                        background: done ? '#EEF2F6' : pill.bg,
                        color: done ? MUTED : pill.fg,
                        borderRadius: 6, padding: '2px 5px', border: 'none', textAlign: 'left',
                        fontSize: 10, fontWeight: 600,
                        textDecoration: done ? 'line-through' : undefined,
                      }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: done ? MUTED : PRIORITY_DOT[t.priority] || PRIORITY_DOT.low }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                    </button>
                  )
                })}
                {(hidden > 0 || expanded) && (
                  <button
                    type="button"
                    onClick={() => setExpandedDay(expanded ? null : key)}
                    style={{ fontSize: 10, fontWeight: 700, color: PURPLE, background: 'none', border: 'none', padding: '0 5px' }}
                    className="cursor-pointer hover:underline"
                  >
                    {expanded ? 'Show less' : `+${hidden} more`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {undated.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(20,8,31,.08)' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
            No due date ({undated.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {undated.map((t) => (
              <button
                key={t._id}
                type="button"
                onClick={() => onOpenTask(t)}
                style={{ background: '#F6F0E4', color: INK, borderRadius: 999, padding: '3px 10px', border: 'none', fontSize: 11, fontWeight: 600 }}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              >
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CreateTaskPanel({ onClose, assignableUsers, defaultStatus }: { onClose: () => void; assignableUsers: AssignableUser[]; defaultStatus?: TaskItem['status'] }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState('medium')
  const [assignedTo, setAssignedTo] = useState('')
  const [leadName, setLeadName] = useState('')

  const createTask = useMutation({
    mutationFn: () => api.post('/tasks', {
      title, description, dueDate: dueDate || undefined, priority,
      assignedTo: assignedTo || undefined, leadName: leadName.trim() || undefined,
      status: defaultStatus || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['all-tasks'] }); onClose() },
  })

  const columnLabel = KANBAN_COLUMNS.find((c) => c.status === defaultStatus)?.label

  return (
    <SlideOver
      open
      onClose={onClose}
      title="New task"
      subtitle={columnLabel ? `Will be added to “${columnLabel}”` : undefined}
      width="max-w-lg"
    >
      <div className="space-y-3">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs to happen?" autoFocus />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Details, unit number, contract reference…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Assign to">
            <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Myself</option>
              {assignableUsers.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Reference (unit, contract…)">
            <Input value={leadName} onChange={(e) => setLeadName(e.target.value)} placeholder="e.g. F2-09 · PB-2026-0031" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => createTask.mutate()} disabled={!title.trim() || createTask.isPending}>
            {createTask.isPending ? 'Creating…' : 'Create task'}
          </Button>
        </div>
      </div>
    </SlideOver>
  )
}

export default function Tasks() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'admin' || user?.role === 'staff'
  const [view, setView] = useState<ViewMode>('kanban')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [leadTypeFilter, setLeadTypeFilter] = useState('')
  const [createOpen, setCreateOpen] = useState<TaskItem['status'] | 'new' | null>(null)
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)

  const { data: assignableUsers = [] } = useQuery<AssignableUser[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
  })

  const { data: tasks = [], isLoading } = useQuery<TaskItem[]>({
    queryKey: ['all-tasks', assigneeFilter, leadTypeFilter],
    queryFn: () => api.get('/tasks', {
      params: {
        status: 'todo,in_progress,done',
        ...(assigneeFilter ? { assignedTo: assigneeFilter } : {}),
        ...(leadTypeFilter ? { leadType: leadTypeFilter } : {}),
      },
    }).then((r) => r.data),
  })

  const updateTask = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/tasks/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['all-tasks'] }),
  })

  const sortedForList = useMemo(
    () => [...tasks].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')),
    [tasks]
  )

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={isAdmin ? 'All tasks across the team' : 'Tasks assigned to you, and tasks you handed off'}
        action={
          <div className="flex items-center gap-2">
            <div className="flex gap-1 p-1" style={{ background: '#F6F0E4', borderRadius: 999 }}>
              {VIEW_OPTIONS.map((o) => {
                const active = view === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setView(o.value)}
                    style={{
                      height: 28, padding: '0 14px', borderRadius: 999, border: 'none',
                      fontSize: 12, fontWeight: 700,
                      background: active ? 'white' : 'transparent',
                      color: active ? INK : MUTED,
                      boxShadow: active ? '0 1px 3px rgba(20,8,31,.10)' : undefined,
                    }}
                    className="cursor-pointer transition-colors"
                  >
                    {o.label}
                  </button>
                )
              })}
            </div>
            <Button onClick={() => setCreateOpen('new')}><Plus size={14} /> New task</Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {isAdmin && (
          <Select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="w-auto">
            <option value="">Everyone</option>
            {assignableUsers.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
          </Select>
        )}
        <Select value={leadTypeFilter} onChange={(e) => setLeadTypeFilter(e.target.value)} className="w-auto">
          {LEAD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <Spinner />
      ) : tasks.length === 0 ? (
        <Card><CardBody className="text-center py-10 text-sm text-muted-foreground">No tasks match these filters.</CardBody></Card>
      ) : view === 'kanban' ? (
        <KanbanBoard tasks={tasks} onMove={(id, status) => updateTask.mutate({ id, body: { status } })}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {KANBAN_COLUMNS.map((col) => {
              const items = tasks.filter((t) => t.status === col.status)
              return (
                <KanbanColumn key={col.status} col={col} count={items.length} onAddTask={() => setCreateOpen(col.status)}>
                  {items.map((t) => (
                    <KanbanCard key={t._id} task={t} onOpen={setSelectedTask}
                      onToggleDone={(task) => updateTask.mutate({ id: task._id, body: { status: task.status === 'done' ? 'todo' : 'done' } })} />
                  ))}
                </KanbanColumn>
              )
            })}
          </div>
        </KanbanBoard>
      ) : view === 'calendar' ? (
        <CalendarView tasks={tasks} onOpenTask={setSelectedTask} />
      ) : (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,.10)', borderRadius: 18, overflow: 'hidden' }}>
          <div className="overflow-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(20,8,31,.08)', background: '#FBF8F2' }}>
                  {['Task', 'Type', 'Assigned to', 'Created by', 'Status', 'Due'].map((h) => (
                    <th key={h} style={{ padding: '12px 16px', fontSize: 10.5, fontWeight: 700, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '.07em', whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedForList.map((t) => {
                  const tone = isDueSoon(t)
                  const done = t.status === 'done'
                  const status = STATUS_PILL[t.status]
                  return (
                    <tr key={t._id} onClick={() => setSelectedTask(t)}
                      style={{ borderBottom: '1px solid rgba(20,8,31,.05)' }}
                      className="cursor-pointer hover:bg-[#FBF8F2] transition-colors">
                      <td style={{ padding: '13px 16px' }}>
                        <div className="flex items-center gap-2">
                          <span title={`${t.priority} priority`}
                            style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: PRIORITY_DOT[t.priority] || PRIORITY_DOT.low }} />
                          <span style={{ fontSize: 13.5, fontWeight: 600, color: done ? MUTED : INK, textDecoration: done ? 'line-through' : undefined }}>
                            {t.title}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '13px 16px' }}>{t.leadName ? <TypePill label={t.leadName} /> : <span style={{ fontSize: 12.5, color: MUTED }}>—</span>}</td>
                      <td style={{ padding: '13px 16px', fontSize: 13, color: MUTED }}>{t.assignedTo?.name || '—'}</td>
                      <td style={{ padding: '13px 16px', fontSize: 13, color: MUTED }}>{t.createdByName || '—'}</td>
                      <td style={{ padding: '13px 16px' }}>
                        <span style={{ display: 'inline-block', background: status.bg, color: status.fg, borderRadius: 999, padding: '3px 10px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {KANBAN_COLUMNS.find((c) => c.status === t.status)?.label}
                        </span>
                      </td>
                      <td style={{ padding: '13px 16px', fontSize: 12.5, whiteSpace: 'nowrap', fontWeight: tone !== 'normal' ? 700 : 500, color: tone === 'overdue' ? '#991B1B' : tone === 'today' ? '#B45309' : MUTED }}>
                        {t.dueDate ? formatDate(t.dueDate) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateTaskPanel onClose={() => setCreateOpen(null)} assignableUsers={assignableUsers}
          defaultStatus={createOpen === 'new' ? undefined : createOpen} />
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

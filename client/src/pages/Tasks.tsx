import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, Flag, KanbanSquare, List, Plus, Search } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, Field, Input, Select, Textarea, SlideOver, Spinner } from '../components/ui'
import { RenewalsCard } from './SalesBoard'
import {
  type TaskItem, type AssignableUser,
  KANBAN_COLUMNS, KanbanBoard, KanbanCard, KanbanColumn, TaskDetailModal, TypePill, Avatar, taskLinkTo,
  PRIORITY_DOT, PRIORITY_PILL, INK, MUTED, PURPLE,
} from './tasks/shared'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const

const LEAD_TYPE_OPTIONS = [
  { value: '', label: 'All follow-ups' },
  { value: 'storage', label: 'Storage leads' },
  { value: 'moving', label: 'Moving leads' },
  { value: 'contract', label: 'Contract renewals' },
]

type ViewMode = 'kanban' | 'list' | 'calendar'
const VIEW_OPTIONS: { value: ViewMode; label: string; icon: typeof List }[] = [
  { value: 'list', label: 'List', icon: List },
  { value: 'kanban', label: 'Board', icon: KanbanSquare },
  { value: 'calendar', label: 'Calendar', icon: CalendarDays },
]
const VIEW_KEY = 'pb_tasks_view'
const LINE = 'rgba(20,8,31,.08)'

/* ── The list: grouped by when it is due, the way task apps read ─────────── */

type Group = { key: string; label: string; tone: 'overdue' | 'today' | 'normal'; items: TaskItem[] }

/** Open tasks by due date — Overdue, Today, Tomorrow, This week, Later, No date — each soonest first. */
function groupOpen(tasks: TaskItem[], now = new Date()): Group[] {
  const day = 86400000
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const groups: Group[] = [
    { key: 'overdue', label: 'Overdue', tone: 'overdue', items: [] },
    { key: 'today', label: 'Today', tone: 'today', items: [] },
    { key: 'tomorrow', label: 'Tomorrow', tone: 'normal', items: [] },
    { key: 'week', label: 'This week', tone: 'normal', items: [] },
    { key: 'later', label: 'Later', tone: 'normal', items: [] },
    { key: 'none', label: 'No due date', tone: 'normal', items: [] },
  ]
  const by = Object.fromEntries(groups.map((g) => [g.key, g]))
  for (const t of tasks) {
    if (!t.dueDate) { by.none.items.push(t); continue }
    const d = new Date(t.dueDate).getTime()
    if (d < today) by.overdue.items.push(t)
    else if (d < today + day) by.today.items.push(t)
    else if (d < today + 2 * day) by.tomorrow.items.push(t)
    else if (d < today + 7 * day) by.week.items.push(t)
    else by.later.items.push(t)
  }
  for (const g of groups) {
    g.items.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
  }
  return groups.filter((g) => g.items.length)
}

/** "Today 3:00 pm", "Tomorrow", "Mon 3 Nov", "12 Oct" — short, like a task app's due chip. */
function dueLabel(iso: string, now = new Date()) {
  const d = new Date(iso)
  const dateOnly = /T00:00:00(\.000)?Z$/.test(iso)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((that - today) / 86400000)
  const time = dateOnly ? '' : ` ${d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}`
  if (days === 0) return `Today${time}`
  if (days === 1) return `Tomorrow${time}`
  if (days === -1) return 'Yesterday'
  if (days > 1 && days < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })}${time}`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

function TaskRow({ task, tone, onOpen, onToggle }: { task: TaskItem; tone: Group['tone']; onOpen: () => void; onToggle: () => void }) {
  const done = task.status === 'done'
  const dueColor = done ? MUTED : tone === 'overdue' ? '#B91C1C' : tone === 'today' ? '#B45309' : MUTED
  return (
    <div onClick={onOpen}
      className="group flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-[#FBF8F2] transition-colors"
      style={{ borderTop: `1px solid ${LINE}` }}>
      <button type="button" aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        className="shrink-0 cursor-pointer" style={{ color: done ? '#16A34A' : task.priority === 'high' ? '#DC2626' : '#9AA3B2', background: 'none', border: 'none', padding: 0, display: 'grid' }}>
        {done ? <CheckCircle2 size={19} /> : <Circle size={19} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {/* The title is the row's button, so the row works from the keyboard too. */}
          <button type="button" onClick={(e) => { e.stopPropagation(); onOpen() }} className="truncate text-left cursor-pointer"
            style={{ fontSize: 14, fontWeight: 500, color: done ? MUTED : INK, textDecoration: done ? 'line-through' : undefined, background: 'none', border: 'none', padding: 0 }}>{task.title}</button>
          {task.status === 'in_progress' && <span style={{ fontSize: 10.5, fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' }}>In progress</span>}
        </div>
        {task.description && <div className="truncate" style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>{task.description}</div>}
      </div>
      {task.leadName && <span className="hidden sm:inline-flex shrink-0 max-w-[180px]"><TypePill label={task.leadName} to={taskLinkTo(task)} /></span>}
      {task.priority !== 'low' && !done && (
        <span className="shrink-0" title={`${task.priority} priority`} style={{ color: PRIORITY_DOT[task.priority], display: 'grid' }}><Flag size={13} fill={task.priority === 'high' ? PRIORITY_DOT.high : 'none'} /></span>
      )}
      {task.dueDate && <span className="shrink-0" style={{ fontSize: 12, fontWeight: tone !== 'normal' && !done ? 700 : 500, color: dueColor, minWidth: 70, textAlign: 'right' }}>{dueLabel(task.dueDate)}</span>}
      <span className="shrink-0" style={{ width: 22 }}>{task.assignedTo?.name && <Avatar name={task.assignedTo.name} size={22} />}</span>
    </div>
  )
}

function ListView({ tasks, onOpen, onToggle }: { tasks: TaskItem[]; onOpen: (t: TaskItem) => void; onToggle: (t: TaskItem) => void }) {
  const [showDone, setShowDone] = useState(false)
  const open = tasks.filter((t) => t.status !== 'done')
  const done = tasks.filter((t) => t.status === 'done').sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
  const groups = groupOpen(open)
  const section = (key: string, label: string, color: string, count: number, children: React.ReactNode, extra?: React.ReactNode) => (
    <section key={key} aria-label={label} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, overflow: 'hidden' }}>
      <div className="flex items-center gap-2 px-4 py-2.5" style={{ fontSize: 12.5, fontWeight: 700, color }}>
        {label}<span style={{ color: MUTED, fontWeight: 600 }}>{count}</span>{extra}
      </div>
      {children}
    </section>
  )
  return (
    <div className="space-y-3">
      {groups.length === 0 && (
        <div className="text-center py-12" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, fontSize: 14, color: MUTED }}>
          <CheckCircle2 size={22} style={{ margin: '0 auto 8px', color: '#16A34A' }} />
          All clear — nothing open.
        </div>
      )}
      {groups.map((g) => section(g.key, g.label, g.tone === 'overdue' ? '#B91C1C' : g.tone === 'today' ? '#B45309' : INK, g.items.length,
        g.items.map((t) => <TaskRow key={t._id} task={t} tone={g.tone} onOpen={() => onOpen(t)} onToggle={() => onToggle(t)} />)))}
      {done.length > 0 && section('done', 'Completed', MUTED, done.length,
        showDone ? done.slice(0, 50).map((t) => <TaskRow key={t._id} task={t} tone="normal" onOpen={() => onOpen(t)} onToggle={() => onToggle(t)} />) : null,
        <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}
          className="ml-auto inline-flex items-center gap-1 cursor-pointer" style={{ fontSize: 12, fontWeight: 600, color: PURPLE, background: 'none', border: 'none' }}>
          {showDone ? 'Hide' : 'Show'} <ChevronDown size={13} style={{ transform: showDone ? 'rotate(180deg)' : undefined }} />
        </button>)}
    </div>
  )
}

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
  const [dueTime, setDueTime] = useState('')
  const [priority, setPriority] = useState('medium')
  const [assignedTo, setAssignedTo] = useState('')
  const [leadName, setLeadName] = useState('')

  const createTask = useMutation({
    mutationFn: () => api.post('/tasks', {
      title, description, dueDate: dueDate ? (dueTime ? new Date(`${dueDate}T${dueTime}:00+04:00`).toISOString() : dueDate) : undefined, priority,
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
            <div className="flex gap-2">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!dueDate} />
            </div>
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

// `embedded` drops the page title when rendered inside another page's tab
// (the Dashboard), where a second "Tasks" heading under the Tasks tab just
// repeats itself. The controls still render.
export default function Tasks({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'admin' || user?.role === 'staff'
  // Accounts chase invoices, not renewals — that queue belongs to sales.
  const isAccounts = user?.role === 'accounts'
  const [view, setViewState] = useState<ViewMode>(() => {
    try { const v = localStorage.getItem(VIEW_KEY) as ViewMode | null; return v && VIEW_OPTIONS.some((o) => o.value === v) ? v : 'list' } catch { return 'list' }
  })
  const setView = (v: ViewMode) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* private window */ } }
  const [search, setSearch] = useState('')
  const [quick, setQuick] = useState('')
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

  const quickAdd = useMutation({
    mutationFn: (title: string) => api.post('/tasks', { title, priority: 'medium' }),
    onSuccess: () => { setQuick(''); qc.invalidateQueries({ queryKey: ['all-tasks'] }) },
  })

  const q = search.trim().toLowerCase()
  const shown = q ? tasks.filter((t) => [t.title, t.description, t.leadName, t.assignedTo?.name].some((v) => String(v || '').toLowerCase().includes(q))) : tasks
  const openTasks = tasks.filter((t) => t.status !== 'done')
  const overdueCount = openTasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString())).length
  const todayCount = openTasks.filter((t) => {
    if (!t.dueDate) return false
    const start = new Date(new Date().toDateString()).getTime()
    const d = new Date(t.dueDate).getTime()
    return d >= start && d < start + 86400000
  }).length
  const toggle = (t: TaskItem) => updateTask.mutate({ id: t._id, body: { status: t.status === 'done' ? 'todo' : 'done' } })

  return (
    // Standalone, this sits on a white card like Contracts and Units. Embedded
    // in another page's tab it stays bare, so it does not nest card in card.
    <div
      className={embedded ? undefined : 'p-5 sm:p-7'}
      style={embedded ? undefined : { background: '#fff', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          {!embedded && <h1 style={{ ...HEADING, fontSize: 28, fontWeight: 800, color: INK }}>Tasks</h1>}
          <div className="flex items-center gap-3 mt-0.5" style={{ fontSize: 13, color: MUTED }}>
            <span>{openTasks.length} open</span>
            {overdueCount > 0 && <span style={{ color: '#B91C1C', fontWeight: 700 }}>{overdueCount} overdue</span>}
            {todayCount > 0 && <span style={{ color: '#B45309', fontWeight: 700 }}>{todayCount} due today</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex p-0.5" role="tablist" aria-label="View" style={{ background: '#F3F1EC', borderRadius: 10 }}>
            {VIEW_OPTIONS.map((o) => {
              const active = view === o.value
              const Icon = o.icon
              return (
                <button key={o.value} type="button" role="tab" aria-selected={active} onClick={() => setView(o.value)} title={o.label}
                  className="inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  style={{ height: 30, padding: '0 11px', borderRadius: 8, border: 'none', fontSize: 12.5, fontWeight: 600, background: active ? '#fff' : 'transparent', color: active ? INK : MUTED, boxShadow: active ? '0 1px 2px rgba(20,8,31,.10)' : undefined }}>
                  <Icon size={14} /><span className="hidden sm:inline">{o.label}</span>
                </button>
              )
            })}
          </div>
          <Button onClick={() => setCreateOpen('new')}><Plus size={14} /> New task</Button>
        </div>
      </div>

      {/* Quick add: type and press Enter; details later from the task itself. */}
      <form onSubmit={(e) => { e.preventDefault(); if (quick.trim() && !quickAdd.isPending) quickAdd.mutate(quick.trim()) }}
        className="flex items-center gap-2 px-4 mb-3" style={{ height: 46, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12 }}>
        <Plus size={16} style={{ color: PURPLE }} />
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Add a task — press Enter" aria-label="Add a task"
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, background: 'transparent' }} disabled={quickAdd.isPending} />
        {quick.trim() && <span style={{ fontSize: 11.5, color: MUTED }}>Enter ↵</span>}
      </form>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-2 px-3 flex-1 min-w-[200px] max-w-sm" style={{ height: 34, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10 }}>
          <Search size={14} style={{ color: MUTED }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks" aria-label="Search tasks"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, background: 'transparent' }} />
        </div>
        {isAdmin && (
          <Select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="w-auto" aria-label="Assignee">
            <option value="">Everyone</option>
            {user?.id && <option value={user.id}>Mine</option>}
            {assignableUsers.filter((u) => u._id !== user?.id).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
          </Select>
        )}
        <Select value={leadTypeFilter} onChange={(e) => setLeadTypeFilter(e.target.value)} className="w-auto" aria-label="Type">
          {LEAD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <Spinner />
      ) : view === 'kanban' ? (
        <KanbanBoard tasks={shown} onMove={(id, status) => updateTask.mutate({ id, body: { status } })}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {KANBAN_COLUMNS.map((col) => {
              const items = shown.filter((t) => t.status === col.status)
              return (
                <KanbanColumn key={col.status} col={col} count={items.length} onAddTask={() => setCreateOpen(col.status)}>
                  {items.map((t) => (
                    <KanbanCard key={t._id} task={t} onOpen={setSelectedTask}
                      onToggleDone={toggle} />
                  ))}
                </KanbanColumn>
              )
            })}
          </div>
        </KanbanBoard>
      ) : view === 'calendar' ? (
        <CalendarView tasks={shown} onOpenTask={setSelectedTask} />
      ) : (
        <ListView tasks={shown} onOpen={setSelectedTask} onToggle={toggle} />
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

      {/* Renewals sit with the tasks now rather than beside the leads. A
          contract coming up is work to do this week, which is what this page
          is; on the leads board it was a second list competing with the leads
          for the same attention.

          Not for accounts: they chase invoices, not renewals — that queue
          belongs to sales, and it was hidden from them before this moved. */}
      {!embedded && !isAccounts && (
        <div style={{ marginTop: 24 }}>
          <RenewalsCard />
        </div>
      )}
    </div>
  )
}

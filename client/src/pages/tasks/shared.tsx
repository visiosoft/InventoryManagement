import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Calendar, CheckCircle2, Circle, MessageSquare, Paperclip, Plus, Send } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { Modal, Spinner } from '../../components/ui'
import { formatDate } from '../../lib/utils'

export const INK = '#14081F'
export const MUTED = '#756E80'
export const PURPLE = '#5B2BC9'

export type TaskItem = {
  _id: string
  title: string
  description?: string
  leadId?: string
  leadType?: 'storage' | 'moving' | 'contract' | null
  leadName?: string
  dueDate?: string
  priority: 'low' | 'medium' | 'high'
  status: 'todo' | 'in_progress' | 'done'
  assignedTo?: { _id: string; name: string; email: string }
  createdByName?: string
  createdBy?: string
  createdAt?: string
  comments?: unknown[]
  attachments?: unknown[]
}

export type AssignableUser = { _id: string; name: string; email: string; role: string }

export const PRIORITY_COLOR: Record<string, string> = { low: '#756E80', medium: '#B45309', high: '#991B1B' }

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

export const KANBAN_COLUMNS: { status: TaskItem['status']; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'done', label: 'Done' },
]

export function isDueSoon(t: TaskItem): 'overdue' | 'today' | 'normal' {
  if (!t.dueDate || t.status === 'done') return 'normal'
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const due = new Date(t.dueDate)
  if (due < todayStart) return 'overdue'
  if (due < new Date(todayStart.getTime() + 86400000)) return 'today'
  return 'normal'
}

export const PRIORITY_PILL: Record<string, { bg: string; fg: string }> = {
  low: { bg: '#EEF2F6', fg: '#475569' },
  medium: { bg: '#DBEAFE', fg: '#1D4ED8' },
  high: { bg: '#FEF3C7', fg: '#92400E' },
}

const AVATAR_COLORS = ['#5B2BC9', '#0891B2', '#B45309', '#166534', '#9D174D', '#1D4ED8']
function avatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

export function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <div
      title={name}
      style={{
        width: size, height: size, borderRadius: '50%', background: avatarColor(name),
        color: 'white', fontSize: size * 0.42, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {initials(name)}
    </div>
  )
}

export function KanbanCard({
  task, onOpen, onToggleDone,
}: {
  task: TaskItem
  onOpen: (task: TaskItem) => void
  onToggleDone?: (task: TaskItem) => void
}) {
  const tone = isDueSoon(task)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task._id })
  const pill = PRIORITY_PILL[task.priority] || PRIORITY_PILL.low
  const commentCount = task.comments?.length ?? 0
  const attachmentCount = task.attachments?.length ?? 0
  const done = task.status === 'done'
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => !isDragging && onOpen(task)}
      style={{
        background: 'white', border: '1px solid rgba(20,8,31,.08)', borderRadius: 10, padding: 10,
        borderLeft: tone === 'overdue' ? '3px solid #991B1B' : tone === 'today' ? '3px solid #B45309' : '3px solid transparent',
        opacity: isDragging ? 0.4 : 1,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        touchAction: 'none',
      }}
      className="cursor-pointer select-none"
    >
      {task.leadName && <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, marginBottom: 2 }}>{task.leadName}</div>}
      <div className="flex items-start gap-2">
        {onToggleDone && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleDone(task) }}
            onPointerDown={(e) => e.stopPropagation()}
            className="shrink-0 mt-0.5 cursor-pointer"
            style={{ color: done ? '#16A34A' : MUTED }}
            title={done ? 'Mark as not done' : 'Mark as done'}
          >
            {done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
          </button>
        )}
        <div style={{ fontSize: 12.5, color: done ? MUTED : INK, fontWeight: tone !== 'normal' ? 700 : 500, textDecoration: done ? 'line-through' : undefined }}>
          {task.title}
        </div>
      </div>
      <div className="flex items-center justify-between mt-2">
        <span style={{ fontSize: 10, fontWeight: 700, color: pill.fg, background: pill.bg, borderRadius: 6, padding: '2px 7px', textTransform: 'capitalize' }}>{task.priority}</span>
        {task.dueDate && (
          <span className="flex items-center gap-1" style={{ fontSize: 10.5, fontWeight: tone !== 'normal' ? 700 : 400, color: tone === 'overdue' ? '#991B1B' : tone === 'today' ? '#B45309' : MUTED }}>
            <Calendar size={11} />
            {formatDate(task.dueDate)}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2.5" style={{ color: MUTED }}>
          {commentCount > 0 && (
            <span className="flex items-center gap-1" style={{ fontSize: 10.5 }}>
              <MessageSquare size={11} /> {commentCount}
            </span>
          )}
          {attachmentCount > 0 && (
            <span className="flex items-center gap-1" style={{ fontSize: 10.5 }}>
              <Paperclip size={11} /> {attachmentCount}
            </span>
          )}
        </div>
        {task.assignedTo?.name && <Avatar name={task.assignedTo.name} />}
      </div>
    </div>
  )
}

export function KanbanColumn({
  col, children, count, onAddTask,
}: {
  col: { status: TaskItem['status']; label: string }
  children: React.ReactNode
  count: number
  onAddTask?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.status })
  return (
    <div
      ref={setNodeRef}
      style={{ background: isOver ? '#EFEAFA' : '#F7F5F0', borderRadius: 10, padding: 8, display: 'flex', flexDirection: 'column', minHeight: 0, transition: 'background .15s' }}
    >
      <div className="flex items-center gap-1.5 mb-1.5" style={{ padding: '0 2px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.04em' }}>{col.label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: MUTED, background: 'rgba(20,8,31,.08)', borderRadius: 999, padding: '1px 6px' }}>{count}</span>
      </div>
      <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 260, minHeight: 40 }}>
        {children}
      </div>
      {onAddTask && (
        <button type="button" onClick={onAddTask}
          className="flex items-center gap-1 mt-1.5 px-1 py-1 rounded-lg text-left cursor-pointer hover:bg-black/5 transition-colors"
          style={{ fontSize: 11.5, color: MUTED, fontWeight: 600 }}>
          <Plus size={12} /> Add task
        </button>
      )}
    </div>
  )
}

type TaskComment = { _id: string; text: string; createdAt: string; user?: { _id?: string; name: string }; userName?: string }
type TaskAttachment = { _id: string; name: string; url: string; mimeType?: string; storage?: string; uploadedBy?: string; uploadedAt: string }
type TaskAssignmentEntry = { _id: string; at: string; fromName?: string; toName: string; byName: string; reason?: string }
type TaskDetail = Omit<TaskItem, 'comments' | 'attachments'> & {
  comments: TaskComment[]
  attachments: TaskAttachment[]
  assignmentHistory: TaskAssignmentEntry[]
  description?: string
}

const fieldCls = 'w-full rounded-lg border text-[12.5px]'
const fieldStyle: React.CSSProperties = { height: 34, padding: '0 10px', border: '1px solid rgba(20,8,31,.16)', borderRadius: 8 }

// Click a Kanban card (or a list row) to open this — Asana-style detail:
// checkbox + inline-editable assignee/due-date/priority/status, a
// description, link/file attachments, a comment thread (with delete), the
// reassignment history, and a delete-task action.
export function TaskDetailModal({
  task, onClose, onStatusChange, assignableUsers = [], onDeleted,
}: {
  task: TaskItem
  onClose: () => void
  onStatusChange: (status: TaskItem['status']) => void
  assignableUsers?: AssignableUser[]
  onDeleted?: () => void
}) {
  const qc = useQueryClient()
  const [commentText, setCommentText] = useState('')
  const [description, setDescription] = useState('')
  const [descLoaded, setDescLoaded] = useState(false)
  const [linkName, setLinkName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: detail, isLoading } = useQuery<TaskDetail>({
    queryKey: ['task-detail', task._id],
    queryFn: () => api.get(`/tasks/${task._id}`).then((r) => r.data),
  })
  if (detail && !descLoaded) { setDescription(detail.description || ''); setDescLoaded(true) }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task-detail', task._id] })
    qc.invalidateQueries({ queryKey: ['my-tasks-all'] })
    qc.invalidateQueries({ queryKey: ['all-tasks'] })
  }

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/tasks/${task._id}`, body),
    onSuccess: () => { setError(''); invalidate() },
    onError: (e) => setError(apiError(e)),
  })
  const addComment = useMutation({
    mutationFn: () => api.post(`/tasks/${task._id}/comments`, { text: commentText }),
    onSuccess: () => { setCommentText(''); invalidate() },
  })
  const deleteComment = useMutation({
    mutationFn: (commentId: string) => api.delete(`/tasks/${task._id}/comments/${commentId}`),
    onSuccess: invalidate,
  })
  const uploadFiles = useMutation({
    mutationFn: (files: FileList) => {
      const form = new FormData()
      Array.from(files).forEach((f) => form.append('files', f))
      return api.post(`/tasks/${task._id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: invalidate,
  })
  const addLink = useMutation({
    mutationFn: () => api.post(`/tasks/${task._id}/links`, { name: linkName, url: linkUrl }),
    onSuccess: () => { setLinkName(''); setLinkUrl(''); invalidate() },
    onError: (e) => setError(apiError(e)),
  })
  const deleteTask = useMutation({
    mutationFn: () => api.delete(`/tasks/${task._id}`),
    onSuccess: () => { invalidate(); onDeleted?.(); onClose() },
    onError: (e) => setError(apiError(e)),
  })

  const modalTitle = detail ? (
    <div className="flex items-center gap-2.5">
      <button type="button" onClick={() => onStatusChange(detail.status === 'done' ? 'todo' : 'done')}
        className="shrink-0 cursor-pointer" style={{ color: detail.status === 'done' ? '#16A34A' : MUTED }}>
        {detail.status === 'done' ? <CheckCircle2 size={17} /> : <Circle size={17} />}
      </button>
      <span className="text-[15px] font-bold" style={{ color: INK, textDecoration: detail.status === 'done' ? 'line-through' : undefined }}>
        {detail.title}
      </span>
    </div>
  ) : task.title

  return (
    <Modal open onClose={onClose} title={modalTitle} wide>
      {isLoading || !detail ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Assignee</div>
              <select className={fieldCls} style={fieldStyle} value={detail.assignedTo?._id || ''}
                onChange={(e) => patch.mutate({ assignedTo: e.target.value })}>
                {!assignableUsers.some((u) => u._id === detail.assignedTo?._id) && detail.assignedTo && (
                  <option value={detail.assignedTo._id}>{detail.assignedTo.name}</option>
                )}
                {assignableUsers.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Due date</div>
              <input type="date" className={fieldCls} style={fieldStyle}
                value={detail.dueDate ? detail.dueDate.slice(0, 10) : ''}
                onChange={(e) => patch.mutate({ dueDate: e.target.value || null })} />
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Priority</div>
              <select className={fieldCls} style={fieldStyle} value={detail.priority}
                onChange={(e) => patch.mutate({ priority: e.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Status</div>
              <select className={fieldCls} style={fieldStyle} value={detail.status}
                onChange={(e) => onStatusChange(e.target.value as TaskItem['status'])}>
                {KANBAN_COLUMNS.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
              </select>
            </div>
          </div>

          {(detail.leadName || detail.createdByName) && (
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
              {detail.createdByName && <span>Created by {detail.createdByName}</span>}
              {detail.leadName && <span>{detail.leadName}</span>}
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}

          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Description</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => { if (description !== (detail.description || '')) patch.mutate({ description }) }}
              rows={3}
              placeholder="Add a description…"
              className="w-full rounded-lg border text-[12.5px] resize-y"
              style={{ padding: '8px 10px', border: '1px solid rgba(20,8,31,.16)', borderRadius: 8 }}
            />
          </div>

          {/* Attachments */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Attachments</div>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadFiles.isPending}
                className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer disabled:opacity-50">
                <Paperclip size={12} /> {uploadFiles.isPending ? 'Uploading…' : 'Add file'}
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden"
                onChange={(e) => { if (e.target.files?.length) uploadFiles.mutate(e.target.files); e.target.value = '' }} />
            </div>
            <div className="flex gap-2 mb-2">
              <input value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="Label"
                className={fieldCls} style={{ ...fieldStyle, flex: 1 }} />
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…"
                className={fieldCls} style={{ ...fieldStyle, flex: 2 }} />
              <button type="button" disabled={!linkName.trim() || !linkUrl.trim() || addLink.isPending} onClick={() => addLink.mutate()}
                style={{ height: 34, padding: '0 12px', borderRadius: 8, background: PURPLE, color: 'white', fontSize: 12, fontWeight: 600, border: 'none' }}
                className="disabled:opacity-50 cursor-pointer shrink-0">
                Add
              </button>
            </div>
            {detail.attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No files attached.</p>
            ) : (
              <div className="space-y-1">
                {detail.attachments.map((a) => (
                  <a key={a._id} href={a.url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 text-xs text-primary hover:underline">
                    <Paperclip size={12} className="shrink-0" /> {a.name}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Comments */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Comments</div>
            {detail.comments.length === 0 ? (
              <p className="text-xs text-muted-foreground mb-2">No comments yet.</p>
            ) : (
              <div className="space-y-2.5 max-h-56 overflow-y-auto mb-2">
                {detail.comments.map((c) => (
                  <div key={c._id} className="text-sm rounded-lg bg-muted/30 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs">{c.user?.name || c.userName || 'User'}</span>
                      <span className="text-[10.5px] text-muted-foreground">{formatDate(c.createdAt)}</span>
                      <button type="button" onClick={() => deleteComment.mutate(c._id)}
                        className="ml-auto text-[10.5px] font-semibold text-destructive hover:underline cursor-pointer">
                        Delete
                      </button>
                    </div>
                    <p className="text-foreground">{c.text}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && commentText.trim()) addComment.mutate() }}
                placeholder="Write a comment…"
                style={{ flex: 1, height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 12.5 }}
              />
              <button type="button" disabled={!commentText.trim() || addComment.isPending} onClick={() => addComment.mutate()}
                style={{ height: 34, width: 34, borderRadius: 8, background: PURPLE, color: 'white', border: 'none' }}
                className="disabled:opacity-50 cursor-pointer flex items-center justify-center shrink-0">
                <Send size={14} />
              </button>
            </div>
          </div>

          {/* Assignment history */}
          {detail.assignmentHistory?.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Assignment history</div>
              <div className="space-y-1.5">
                {[...detail.assignmentHistory].reverse().map((h) => (
                  <div key={h._id} className="text-xs text-muted-foreground">
                    <span className="text-foreground">
                      {h.fromName ? `${h.fromName} → ${h.toName}` : `Assigned to ${h.toName}`}
                    </span>
                    {' '}by {h.byName} · {formatDate(h.at)}
                    {h.reason && h.reason !== 'Created' && h.reason !== 'Reassigned' && <> — “{h.reason}”</>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 border-t">
            <button type="button" onClick={() => { if (confirm('Delete this task?')) deleteTask.mutate() }}
              disabled={deleteTask.isPending}
              className="text-xs font-semibold text-destructive hover:underline cursor-pointer disabled:opacity-50">
              {deleteTask.isPending ? 'Deleting…' : 'Delete task'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

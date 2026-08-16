import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Paperclip, Send } from 'lucide-react'
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

export function KanbanCard({ task, onOpen }: { task: TaskItem; onOpen: (task: TaskItem) => void }) {
  const tone = isDueSoon(task)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task._id })
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
      <div style={{ fontSize: 12.5, color: INK, fontWeight: tone !== 'normal' ? 700 : 500 }}>{task.title}</div>
      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
        {task.assignedTo?.name && <>Assigned to <strong style={{ color: '#4A4357' }}>{task.assignedTo.name}</strong></>}
        {task.assignedTo?.name && task.createdByName && ' · '}
        {task.createdByName && <>by {task.createdByName}</>}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span style={{ fontSize: 9.5, fontWeight: 700, color: PRIORITY_COLOR[task.priority], textTransform: 'uppercase' }}>{task.priority}</span>
        {task.dueDate && (
          <span style={{ fontSize: 10.5, fontWeight: tone !== 'normal' ? 700 : 400, color: tone === 'overdue' ? '#991B1B' : tone === 'today' ? '#B45309' : MUTED }}>
            {formatDate(task.dueDate)}
          </span>
        )}
      </div>
    </div>
  )
}

export function KanbanColumn({ col, children, count }: { col: { status: TaskItem['status']; label: string }; children: React.ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.status })
  return (
    <div
      ref={setNodeRef}
      style={{ background: isOver ? '#EFEAFA' : '#F7F5F0', borderRadius: 10, padding: 8, display: 'flex', flexDirection: 'column', minHeight: 0, transition: 'background .15s' }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6, padding: '0 2px' }}>
        {col.label} ({count})
      </div>
      <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: 260, minHeight: 40 }}>
        {children}
      </div>
    </div>
  )
}

type TaskComment = { _id: string; text: string; createdAt: string; user?: { name: string }; userName?: string }
type TaskAttachment = { _id: string; name: string; url: string; mimeType?: string; uploadedBy?: string; uploadedAt: string }
type TaskAssignmentEntry = { _id: string; at: string; fromName?: string; toName: string; byName: string; reason?: string }
type TaskDetail = TaskItem & {
  comments: TaskComment[]
  attachments: TaskAttachment[]
  assignmentHistory: TaskAssignmentEntry[]
  description?: string
}

// Click a Kanban card (or a list row) to open this — Asana-style detail:
// status/priority, reassignment with a reason, a comment thread, file
// attachments, and the full history of who assigned this to whom and why.
export function TaskDetailModal({
  task, onClose, onStatusChange, assignableUsers = [],
}: {
  task: TaskItem
  onClose: () => void
  onStatusChange: (status: TaskItem['status']) => void
  assignableUsers?: AssignableUser[]
}) {
  const qc = useQueryClient()
  const [commentText, setCommentText] = useState('')
  const [reassignOpen, setReassignOpen] = useState(false)
  const [reassignTo, setReassignTo] = useState('')
  const [reassignReason, setReassignReason] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: detail, isLoading } = useQuery<TaskDetail>({
    queryKey: ['task-detail', task._id],
    queryFn: () => api.get(`/tasks/${task._id}`).then((r) => r.data),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task-detail', task._id] })
    qc.invalidateQueries({ queryKey: ['my-tasks-all'] })
    qc.invalidateQueries({ queryKey: ['all-tasks'] })
  }

  const addComment = useMutation({
    mutationFn: () => api.post(`/tasks/${task._id}/comments`, { text: commentText }),
    onSuccess: () => { setCommentText(''); invalidate() },
  })
  const uploadFiles = useMutation({
    mutationFn: (files: FileList) => {
      const form = new FormData()
      Array.from(files).forEach((f) => form.append('files', f))
      return api.post(`/tasks/${task._id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: invalidate,
  })
  const reassign = useMutation({
    mutationFn: () => api.patch(`/tasks/${task._id}`, { assignedTo: reassignTo, reassignReason }),
    onSuccess: () => { setReassignOpen(false); setReassignTo(''); setReassignReason(''); setError(''); invalidate() },
    onError: (e) => setError(apiError(e)),
  })

  return (
    <Modal open onClose={onClose} title={task.title} wide>
      {isLoading || !detail ? <Spinner /> : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            {KANBAN_COLUMNS.map((c) => (
              <button key={c.status} type="button" onClick={() => onStatusChange(c.status)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-colors ${detail.status === c.status ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>
                {c.label}
              </button>
            ))}
            <span className="ml-auto text-[10.5px] font-bold uppercase" style={{ color: PRIORITY_COLOR[detail.priority] }}>{detail.priority}</span>
          </div>

          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
            {detail.assignedTo?.name && <span>Assigned to <strong className="text-foreground">{detail.assignedTo.name}</strong></span>}
            {detail.createdByName && <span>Created by {detail.createdByName}</span>}
            {detail.dueDate && <span>Due {formatDate(detail.dueDate)}</span>}
            {detail.leadName && <span>{detail.leadName}</span>}
            {assignableUsers.length > 0 && (
              <button type="button" onClick={() => setReassignOpen((v) => !v)}
                className="text-primary font-semibold hover:underline cursor-pointer">
                {reassignOpen ? 'Cancel' : 'Reassign'}
              </button>
            )}
          </div>

          {reassignOpen && (
            <div className="flex flex-wrap gap-2 items-center rounded-lg bg-muted/30 p-2.5">
              <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}
                style={{ height: 32, padding: '0 8px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 12.5 }}>
                <option value="">Assign to…</option>
                {assignableUsers.filter((u) => u._id !== detail.assignedTo?._id).map((u) => (
                  <option key={u._id} value={u._id}>{u.name}</option>
                ))}
              </select>
              <input value={reassignReason} onChange={(e) => setReassignReason(e.target.value)} placeholder="Reason (optional)"
                style={{ flex: 1, minWidth: 140, height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(20,8,31,.16)', fontSize: 12.5 }} />
              <button type="button" disabled={!reassignTo || reassign.isPending} onClick={() => reassign.mutate()}
                style={{ height: 32, padding: '0 12px', borderRadius: 8, background: PURPLE, color: 'white', fontSize: 12, fontWeight: 600, border: 'none' }}
                className="disabled:opacity-50 cursor-pointer">
                {reassign.isPending ? 'Saving…' : 'Reassign'}
              </button>
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}

          {detail.description && <p className="text-sm text-foreground">{detail.description}</p>}

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
                  <div key={c._id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs">{c.user?.name || c.userName || 'User'}</span>
                      <span className="text-[10.5px] text-muted-foreground">{formatDate(c.createdAt)}</span>
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
        </div>
      )}
    </Modal>
  )
}

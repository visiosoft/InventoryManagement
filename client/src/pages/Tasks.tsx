import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { LayoutGrid, List, Plus } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, CardBody, Table, Th, Td, Button, Field, Input, Select, Textarea, Modal, Spinner, Badge } from '../components/ui'
import { formatDate } from '../lib/utils'
import {
  type TaskItem, type AssignableUser,
  KANBAN_COLUMNS, KanbanCard, KanbanColumn, TaskDetailModal,
  PRIORITY_COLOR, MUTED,
} from './tasks/shared'

const LEAD_TYPE_OPTIONS = [
  { value: '', label: 'All follow-ups' },
  { value: 'storage', label: 'Storage leads' },
  { value: 'moving', label: 'Moving leads' },
  { value: 'contract', label: 'Contract renewals' },
]

function CreateTaskModal({ onClose, assignableUsers }: { onClose: () => void; assignableUsers: AssignableUser[] }) {
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
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['all-tasks'] }); onClose() },
  })

  return (
    <Modal open onClose={onClose} title="New task">
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
        <div className="flex justify-end">
          <Button onClick={() => createTask.mutate()} disabled={!title.trim() || createTask.isPending}>
            {createTask.isPending ? 'Creating…' : 'Create task'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default function Tasks() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const isAdmin = user?.role === 'admin' || user?.role === 'staff'
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [leadTypeFilter, setLeadTypeFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

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

  function onDragEnd(e: DragEndEvent) {
    const newStatus = e.over?.id as TaskItem['status'] | undefined
    const task = tasks.find((t) => t._id === e.active.id)
    if (!newStatus || !task || task.status === newStatus) return
    updateTask.mutate({ id: task._id, body: { status: newStatus } })
  }

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
            <div className="flex gap-1 rounded-lg bg-muted/60 p-1">
              <button type="button" onClick={() => setView('kanban')} title="Board"
                className={`p-1.5 rounded-md cursor-pointer ${view === 'kanban' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground'}`}>
                <LayoutGrid size={15} />
              </button>
              <button type="button" onClick={() => setView('list')} title="List"
                className={`p-1.5 rounded-md cursor-pointer ${view === 'list' ? 'bg-white shadow-sm text-foreground' : 'text-muted-foreground'}`}>
                <List size={15} />
              </button>
            </div>
            <Button onClick={() => setCreateOpen(true)}><Plus size={14} /> New task</Button>
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
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {KANBAN_COLUMNS.map((col) => {
              const items = tasks.filter((t) => t.status === col.status)
              return (
                <KanbanColumn key={col.status} col={col} count={items.length}>
                  {items.map((t) => <KanbanCard key={t._id} task={t} onOpen={setSelectedTask} />)}
                </KanbanColumn>
              )
            })}
          </div>
        </DndContext>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <thead><tr><Th>Title</Th><Th>Assigned to</Th><Th>Created by</Th><Th>Priority</Th><Th>Status</Th><Th>Due</Th></tr></thead>
              <tbody>
                {sortedForList.map((t) => (
                  <tr key={t._id} onClick={() => setSelectedTask(t)} className="cursor-pointer hover:bg-muted/40">
                    <Td>
                      <div className="font-medium">{t.title}</div>
                      {t.leadName && <div className="text-xs" style={{ color: MUTED }}>{t.leadName}</div>}
                    </Td>
                    <Td>{t.assignedTo?.name || '—'}</Td>
                    <Td>{t.createdByName || '—'}</Td>
                    <Td><span style={{ color: PRIORITY_COLOR[t.priority], fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>{t.priority}</span></Td>
                    <Td><Badge tone={t.status === 'done' ? 'green' : t.status === 'in_progress' ? 'amber' : 'gray'}>{KANBAN_COLUMNS.find((c) => c.status === t.status)?.label}</Badge></Td>
                    <Td>{t.dueDate ? formatDate(t.dueDate) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      )}

      {createOpen && <CreateTaskModal onClose={() => setCreateOpen(false)} assignableUsers={assignableUsers} />}

      {selectedTask && (
        <TaskDetailModal
          task={tasks.find((t) => t._id === selectedTask._id) ?? selectedTask}
          onClose={() => setSelectedTask(null)}
          onStatusChange={(status) => updateTask.mutate({ id: selectedTask._id, body: { status } })}
          assignableUsers={assignableUsers}
        />
      )}
    </div>
  )
}

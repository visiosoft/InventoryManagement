import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, apiError } from '../lib/api'
import { Field, Input, Select, SlideOver, Textarea } from './ui'

/**
 * Raising a task about somebody, from wherever you are looking at them.
 *
 * This lived inside the WhatsApp inbox, which meant the only place you could
 * raise a task about a lead was their chat — from the lead's own profile, the
 * page that shows their stage, their chases and their notes, there was no way
 * to do it at all.
 *
 * Lifted out whole rather than copied: two panels posting the same task with
 * slightly different fields is how the two drift apart.
 */

type AssignableUser = { _id: string; name: string; role: string }

export function TaskComposer({
  open,
  onOpenChange,
  subjectName,
  leadId,
  leadType = 'storage',
  prefillDescription = '',
  subtitle,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Who the task is about — shown in the panel and stored on the task. */
  subjectName: string
  /** Links the task to them, so it shows against the person and not just a name. */
  leadId?: string | null
  leadType?: 'storage' | 'moving'
  prefillDescription?: string
  subtitle?: string
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState('medium')
  const [assignedTo, setAssignedTo] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const { data: assignableUsers } = useQuery<AssignableUser[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data ?? []),
    staleTime: 30 * 60_000,
  })

  // Reopening starts clean, but carries the prefill across again.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription(prefillDescription)
    setDueDate('')
    setPriority('medium')
    setAssignedTo('')
    setErr('')
    setDone(false)
  }, [open, prefillDescription])

  const createTask = useMutation({
    mutationFn: () => api.post('/tasks', {
      title: title.trim(),
      description: description.trim(),
      dueDate: dueDate || undefined,
      priority,
      assignedTo: assignedTo || undefined,
      ...(leadId ? { leadId, leadType } : {}),
      leadName: subjectName,
    }),
    onSuccess: () => { setErr(''); setDone(true) },
    onError: (e) => setErr(apiError(e)),
  })

  return (
    <SlideOver
      open={open}
      onClose={() => onOpenChange(false)}
      title="New task"
      subtitle={subtitle ?? `About ${subjectName}`}
      width="max-w-lg"
    >
      {done ? (
        <div className="space-y-4">
          <div className="rounded-lg px-3 py-3" style={{ background: '#DCFCE7', color: '#047857', fontSize: 13, fontWeight: 600 }}>
            Task created for {subjectName}.
          </div>
          <div className="flex gap-2">
            <Link
              to="/tasks"
              className="rounded-full px-4 py-2 text-white cursor-pointer"
              style={{ background: '#5B2BC9', fontSize: 13, fontWeight: 700 }}
            >
              Open Tasks
            </Link>
            <button
              type="button"
              onClick={() => setDone(false)}
              className="rounded-full px-4 py-2 cursor-pointer"
              style={{ border: '1px solid rgba(20,8,31,.16)', fontSize: 13, fontWeight: 700 }}
            >
              Add another
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Clean unit F2-80 before Friday"
              autoFocus
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What was asked for, and anything needed to do it"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Assign to">
              <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                <option value="">Myself</option>
                {(assignableUsers ?? []).map((u) => (
                  <option key={u._id} value={u._id}>{u.name} ({u.role})</option>
                ))}
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
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>

          <p style={{ fontSize: 11.5, color: 'rgba(20,8,31,.55)' }}>
            {leadId
              ? `Linked to ${subjectName}, so it shows against them in Tasks.`
              : 'Not saved as a lead yet, so the task carries their name and number only.'}
          </p>

          {err && <p style={{ fontSize: 12, color: '#C0392B' }}>{err}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-full px-4 py-2 cursor-pointer"
              style={{ border: '1px solid rgba(20,8,31,.16)', fontSize: 13, fontWeight: 700 }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => createTask.mutate()}
              disabled={!title.trim() || createTask.isPending}
              className="rounded-full px-5 py-2 text-white cursor-pointer disabled:opacity-40"
              style={{ background: '#5B2BC9', fontSize: 13, fontWeight: 700 }}
            >
              {createTask.isPending ? 'Creating…' : 'Create task'}
            </button>
          </div>
        </div>
      )}
    </SlideOver>
  )
}

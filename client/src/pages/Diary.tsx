import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ListPlus, MessageSquare, StickyNote, UserPlus, Truck, FileText } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, CardBody, Select, Spinner } from '../components/ui'

const INK = '#14081F'
const MUTED = '#756E80'

type AssignableUser = { _id: string; name: string; email: string; role: string }
type DiaryEntry = { at: string; type: string; text: string; refTitle?: string }

const TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  task_created: { label: 'Task created', icon: ListPlus, color: '#5B2BC9' },
  task_done: { label: 'Task completed', icon: CheckCircle2, color: '#1B7A4B' },
  task_comment: { label: 'Task comment', icon: MessageSquare, color: '#5B2BC9' },
  task_assigned: { label: 'Task assignment', icon: UserPlus, color: '#B45309' },
  lead_comment: { label: 'Lead comment', icon: MessageSquare, color: '#2563EB' },
  lead_note: { label: 'Lead note', icon: StickyNote, color: '#2563EB' },
  moving_note: { label: 'Moving lead note', icon: Truck, color: '#0891B2' },
  contract_note: { label: 'Contract note', icon: FileText, color: '#991B1B' },
}

// Collapses the fine-grained entry types into the handful of things a rep
// actually wants to filter by.
const TYPE_GROUP: Record<string, string> = {
  task_created: 'tasks', task_done: 'tasks', task_assigned: 'tasks',
  task_comment: 'comments', lead_comment: 'comments',
  lead_note: 'notes', moving_note: 'notes', contract_note: 'notes',
}

const TYPE_FILTERS = [
  { value: '', label: 'Everything' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'notes', label: 'Notes' },
  { value: 'comments', label: 'Comments' },
]

const RANGE_OPTIONS = [
  { value: 1, label: 'Today' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
]

function dayLabel(d: Date) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yest = new Date(today.getTime() - 86400000)
  const target = new Date(d); target.setHours(0, 0, 0, 0)
  if (target.getTime() === today.getTime()) return 'Today'
  if (target.getTime() === yest.getTime()) return 'Yesterday'
  return target.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export default function Diary() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'staff'
  const [selectedUserId, setSelectedUserId] = useState('')
  const [days, setDays] = useState(30)
  const [typeFilter, setTypeFilter] = useState('')

  const { data: assignableUsers = [] } = useQuery<AssignableUser[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
    enabled: isAdmin,
  })

  const targetUserId = isAdmin ? (selectedUserId || user?.id) : user?.id

  const { data, isLoading } = useQuery<{ user: { name: string }; entries: DiaryEntry[] }>({
    queryKey: ['diary', targetUserId, days],
    queryFn: () => api.get('/activity', { params: { userId: targetUserId, days } }).then((r) => r.data),
    enabled: !!targetUserId,
  })

  const filtered = useMemo(() => {
    const entries = data?.entries ?? []
    if (!typeFilter) return entries
    return entries.filter((e) => TYPE_GROUP[e.type] === typeFilter)
  }, [data, typeFilter])

  const groups = useMemo(() => {
    const map = new Map<string, DiaryEntry[]>()
    for (const e of filtered) {
      const key = new Date(e.at).toDateString()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return [...map.entries()].map(([key, items]) => ({ date: new Date(key), items }))
  }, [filtered])

  return (
    <div>
      <PageHeader
        title="Daily Diary"
        subtitle={isAdmin ? `Day-by-day activity log for ${data?.user?.name || 'a rep'}` : 'Everything you logged, day by day — notes, comments, tasks and follow-ups'}
        action={isAdmin ? (
          <Select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className="w-auto">
            <option value="">Myself</option>
            {assignableUsers.filter((u) => u._id !== user?.id).map((u) => (
              <option key={u._id} value={u._id}>{u.name} ({u.role})</option>
            ))}
          </Select>
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="w-auto">
          {RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <div className="flex gap-1 rounded-full p-1" style={{ background: '#F6F0E4' }}>
          {TYPE_FILTERS.map((f) => (
            <button key={f.value} type="button" onClick={() => setTypeFilter(f.value)}
              className="px-3 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors"
              style={typeFilter === f.value
                ? { background: 'white', color: INK, boxShadow: '0 1px 2px rgba(20,8,31,.10)' }
                : { background: 'transparent', color: MUTED }}>
              {f.label}
            </button>
          ))}
        </div>
        {!isLoading && (
          <span className="text-xs text-muted-foreground ml-auto">
            {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
          </span>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <Card>
          <CardBody className="text-center py-12">
            <p className="text-sm font-medium">Nothing logged yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              {typeFilter
                ? 'No entries of this type in this period — try “Everything”.'
                : 'Notes, comments, tasks and follow-ups will appear here as you work.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-5" style={{ maxWidth: 820 }}>
          {groups.map((g) => (
            <div key={g.date.toDateString()}>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{dayLabel(g.date)}</span>
                <span className="text-[11px] text-muted-foreground">
                  {g.items.length} {g.items.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>
              <Card>
                <CardBody className="divide-y divide-border">
                  {g.items.map((e, i) => {
                    const meta = TYPE_META[e.type] || { label: e.type, icon: StickyNote, color: '#756E80' }
                    const Icon = meta.icon
                    // The server writes the reference into the sentence for
                    // some types ("Created task \"X\""), so only show the
                    // reference chip when it adds something new.
                    const showRef = e.refTitle && !e.text.includes(e.refTitle)
                    return (
                      <div key={i} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                        <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0" style={{ background: `${meta.color}1A` }}>
                          <Icon size={14} style={{ color: meta.color }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: meta.color }}>{meta.label}</span>
                            {showRef && <span className="text-xs text-muted-foreground truncate">{e.refTitle}</span>}
                            <span className="text-xs text-muted-foreground ml-auto shrink-0">
                              {new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-sm text-foreground mt-0.5 break-words">{e.text}</p>
                        </div>
                      </div>
                    )
                  })}
                </CardBody>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

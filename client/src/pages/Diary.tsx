import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ListPlus, MessageSquare, StickyNote, UserPlus, Truck, FileText } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, CardBody, Select, Spinner } from '../components/ui'

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

  const { data: assignableUsers = [] } = useQuery<AssignableUser[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
    enabled: isAdmin,
  })

  const targetUserId = isAdmin ? (selectedUserId || user?.id) : user?.id

  const { data, isLoading } = useQuery<{ user: { name: string }; entries: DiaryEntry[] }>({
    queryKey: ['diary', targetUserId],
    queryFn: () => api.get('/activity', { params: { userId: targetUserId, days: 30 } }).then((r) => r.data),
    enabled: !!targetUserId,
  })

  const groups = useMemo(() => {
    const entries = data?.entries ?? []
    const map = new Map<string, DiaryEntry[]>()
    for (const e of entries) {
      const key = new Date(e.at).toDateString()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(e)
    }
    return [...map.entries()].map(([key, items]) => ({ date: new Date(key), items }))
  }, [data])

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

      {isLoading ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <Card><CardBody className="text-center py-10 text-sm text-muted-foreground">No activity logged in the last 30 days.</CardBody></Card>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.date.toDateString()}>
              <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{dayLabel(g.date)}</div>
              <Card>
                <CardBody className="divide-y divide-border">
                  {g.items.map((e, i) => {
                    const meta = TYPE_META[e.type] || { label: e.type, icon: StickyNote, color: '#756E80' }
                    const Icon = meta.icon
                    return (
                      <div key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                        <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0" style={{ background: `${meta.color}1A` }}>
                          <Icon size={14} style={{ color: meta.color }} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: meta.color }}>{meta.label}</span>
                            {e.refTitle && <span className="text-xs text-muted-foreground">{e.refTitle}</span>}
                            <span className="text-xs text-muted-foreground ml-auto">{new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <p className="text-sm text-foreground mt-0.5">{e.text}</p>
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

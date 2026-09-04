import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, Bell, CheckCircle2, Clock, MessageSquare, UserPlus } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Card, CardHeader, PageHeader, Spinner } from '../components/ui'
import { Avatar } from '../lib/whatsappDisplay'

/**
 * A rep's morning, on one page.
 *
 * Everything here already existed and was spread across four screens:
 * reminders set from a chat, tasks on the board, customers waiting for an
 * answer in the inbox, and chats that had gone quiet. A rep opening the app
 * landed on a list of every lead they own, sorted by nothing in particular,
 * and assembled their own day out of it — or, more often, did not.
 *
 * The page is built around one question: who am I speaking to today? So the
 * four sources are merged into a single ordered list of people, each with the
 * reason it is on the list and a button that opens their chat. Tasks that are
 * not about a person come after it, because they are the smaller half.
 *
 * It is capped on purpose. One rep has 52 reminders and 58 quiet chats
 * outstanding; printing all 190 would produce the same wall of work the task
 * board already is, and be closed just as quickly. The top of the list is what
 * a morning can actually hold, and every section says how much is behind it.
 */

const INK = '#14081F'
const MUTED = 'rgba(20,8,31,.55)'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.10)'

/** How many people to put in front of somebody at once. */
const SHOWN = 12

type Person = {
  leadId: string
  name: string
  phone: string
  phoneNormalized: string
}
type Reminder = Person & { at: string; overdue: boolean }
type Waiting = Person & { since: string; lastText: string }
type Quiet = Person & { since: string; days: number }
type Fresh = Person & { assignedAt: string }
type Task = {
  _id: string
  taskNo: string
  title: string
  dueDate: string
  priority: string
  leadName: string
  leadId: string | null
  overdue: boolean
}
type MyDayData = {
  reminders: Reminder[]
  tasks: Task[]
  waiting: Waiting[]
  quiet: Quiet[]
  fresh: Fresh[]
  quietAfterDays: number
}

/** A wait, said the way somebody would say it. */
function ago(since: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function dayLabel(at: string): string {
  const d = new Date(at)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return 'today'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/* Why somebody is on the list, and how loudly. The order of these is the order
   the list is worked: a person who has been kept waiting outranks a reminder
   somebody set for themselves, and both outrank a chat that merely went cold. */
type Reason = { key: string; label: string; tone: { bg: string; fg: string }; rank: number }
const REASONS: Record<string, Reason> = {
  waiting: { key: 'waiting', label: 'Waiting on a reply', tone: { bg: '#FEE2E2', fg: '#B91C1C' }, rank: 0 },
  overdueReminder: { key: 'overdueReminder', label: 'Reminder overdue', tone: { bg: '#FEF3C7', fg: '#92400E' }, rank: 1 },
  reminder: { key: 'reminder', label: 'Reminder today', tone: { bg: '#EDE5FF', fg: '#4A1FA0' }, rank: 2 },
  fresh: { key: 'fresh', label: 'New lead', tone: { bg: '#DBEAFE', fg: '#1D4ED8' }, rank: 3 },
  quiet: { key: 'quiet', label: 'Gone quiet', tone: { bg: '#F1F5F9', fg: '#475569' }, rank: 4 },
}

type Row = Person & { reason: Reason; detail: string; sortAt: number }

export default function MyDay() {
  const { user } = useAuth()
  const { data, isLoading } = useQuery<MyDayData>({
    queryKey: ['my-day'],
    queryFn: () => api.get('/my-day').then((r) => r.data),
    // The inbox moves while this is open; a stale morning is worse than none.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })

  /* One list of people, from four sources, ordered by how much each is
     costing. Somebody who appears twice — waiting and overdue on a reminder —
     is listed once, under the more urgent of the two. */
  const people = useMemo<Row[]>(() => {
    if (!data) return []
    const rows: Row[] = []
    const add = (p: Person, reason: Reason, detail: string, sortAt: number) => {
      rows.push({ ...p, reason, detail, sortAt })
    }

    for (const w of data.waiting) add(w, REASONS.waiting, `${ago(w.since)} · "${w.lastText}"`, new Date(w.since).getTime())
    for (const r of data.reminders) {
      add(r, r.overdue ? REASONS.overdueReminder : REASONS.reminder, `Set for ${dayLabel(r.at)}`, new Date(r.at).getTime())
    }
    for (const f of data.fresh) add(f, REASONS.fresh, `Given to you ${ago(f.assignedAt)} ago, not opened`, new Date(f.assignedAt).getTime())
    for (const q of data.quiet) add(q, REASONS.quiet, `No reply for ${q.days} days`, new Date(q.since).getTime())

    const best = new Map<string, Row>()
    for (const row of rows) {
      const held = best.get(row.leadId)
      if (!held || row.reason.rank < held.reason.rank) best.set(row.leadId, row)
    }
    return [...best.values()].sort((a, b) => a.reason.rank - b.reason.rank || a.sortAt - b.sortAt)
  }, [data])

  const tasks = data?.tasks ?? []
  const firstName = String(user?.name || '').trim().split(/\s+/)[0] || 'there'

  if (isLoading) return <Spinner />

  const shown = people.slice(0, SHOWN)
  const more = people.length - shown.length

  return (
    <div>
      <PageHeader
        title={`Morning, ${firstName}`}
        subtitle={
          people.length || tasks.length
            ? `${people.length} ${people.length === 1 ? 'person' : 'people'} to speak to${tasks.length ? `, ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} due` : ''}`
            : 'Nothing outstanding. Every chat has been answered.'
        }
      />

      <div className="space-y-5">
        {/* The whole point of the page. Everything else on it is secondary. */}
        <Card>
          <CardHeader
            title="Speak to these people today"
            subtitle="Longest wait first. Opening the chat is usually the whole job."
            action={<Link to="/whatsapp" style={{ fontSize: 12, fontWeight: 700, color: PURPLE }}>Open the inbox</Link>}
          />
          {shown.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6" style={{ color: MUTED, fontSize: 13 }}>
              <CheckCircle2 size={16} style={{ color: '#047857' }} />
              Nobody is waiting on you, and nothing has gone quiet. This is what finished looks like.
            </div>
          ) : (
            <div>
              {shown.map((p) => (
                <div
                  key={p.leadId}
                  className="flex items-center gap-3 px-4 py-2.5"
                  style={{ borderTop: `1px solid ${LINE}` }}
                >
                  <Avatar seed={p.phoneNormalized || p.leadId} label={p.name} size={34} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate" style={{ fontSize: 14, fontWeight: 600, color: INK }}>{p.name}</span>
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5"
                        style={{ fontSize: 10, fontWeight: 700, ...{ background: p.reason.tone.bg, color: p.reason.tone.fg } }}
                      >
                        {p.reason.label}
                      </span>
                    </div>
                    <div className="truncate" style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>{p.detail}</div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Link
                      to={`/whatsapp?phone=${encodeURIComponent(p.phoneNormalized)}`}
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5"
                      style={{ fontSize: 12, fontWeight: 700, background: PURPLE, color: '#fff', textDecoration: 'none' }}
                    >
                      <MessageSquare size={12} /> Chat
                    </Link>
                    <Link
                      to={`/leads/${p.leadId}`}
                      className="rounded-full px-2.5 py-1.5"
                      style={{ fontSize: 12, fontWeight: 600, color: MUTED, textDecoration: 'none', border: `1px solid ${LINE}` }}
                    >
                      Lead
                    </Link>
                  </div>
                </div>
              ))}
              {more > 0 && (
                <div className="px-4 py-2.5" style={{ borderTop: `1px solid ${LINE}`, fontSize: 12, color: MUTED }}>
                  and {more} more behind these — clear the top of the list first, then{' '}
                  <Link to="/my-leads" style={{ color: PURPLE, fontWeight: 700 }}>see them all</Link>.
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Work that is not a conversation. */}
        <Card>
          <CardHeader
            title="Your tasks"
            subtitle={tasks.length ? `${tasks.filter((t) => t.overdue).length} overdue, ${tasks.length - tasks.filter((t) => t.overdue).length} due today` : 'Nothing due'}
            action={<Link to="/tasks" style={{ fontSize: 12, fontWeight: 700, color: PURPLE }}>The board</Link>}
          />
          {tasks.length === 0 ? (
            <div className="px-4 py-5" style={{ color: MUTED, fontSize: 13 }}>Nothing due today.</div>
          ) : (
            <div>
              {tasks.slice(0, 8).map((t) => (
                <div key={t._id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
                  {t.overdue
                    ? <AlertTriangle size={15} style={{ color: '#B91C1C', flex: '0 0 auto' }} />
                    : <Clock size={15} style={{ color: MUTED, flex: '0 0 auto' }} />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate" style={{ fontSize: 13.5, color: INK }}>
                      {t.taskNo ? <span style={{ color: MUTED }}>{t.taskNo} · </span> : null}
                      {t.title}
                    </div>
                    {t.leadName && <div className="truncate" style={{ fontSize: 12, color: MUTED }}>{t.leadName}</div>}
                  </div>
                  <span className="shrink-0" style={{ fontSize: 11.5, fontWeight: 700, color: t.overdue ? '#B91C1C' : MUTED }}>
                    {t.overdue ? `${dayLabel(t.dueDate)}` : 'today'}
                  </span>
                </div>
              ))}
              {tasks.length > 8 && (
                <div className="px-4 py-2.5" style={{ borderTop: `1px solid ${LINE}`, fontSize: 12, color: MUTED }}>
                  and {tasks.length - 8} more on <Link to="/tasks" style={{ color: PURPLE, fontWeight: 700 }}>the board</Link>.
                </div>
              )}
            </div>
          )}
        </Card>

        {/* A quiet count of what is behind the list, so the top of it is not
            mistaken for all of it. */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            ['Waiting on a reply', data?.waiting.length ?? 0, MessageSquare, '#B91C1C'],
            ['Reminders due', data?.reminders.length ?? 0, Bell, '#92400E'],
            ['New, not opened', data?.fresh.length ?? 0, UserPlus, '#1D4ED8'],
            [`Quiet ${data?.quietAfterDays ?? 3}+ days`, data?.quiet.length ?? 0, Clock, '#475569'],
          ] as const).map(([label, value, Icon, colour]) => (
            <div key={label} className="rounded-xl px-3.5 py-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
              <div className="flex items-center gap-1.5" style={{ fontSize: 11.5, color: MUTED }}>
                <Icon size={13} style={{ color: colour }} /> {label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: INK, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

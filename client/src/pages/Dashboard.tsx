import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { GripVertical, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Summary } from '../lib/types'
import { Spinner, EmptyState, Table, Th, Td, Button, Badge } from '../components/ui'
import { formatDate } from '../lib/utils'
import TasksPage from './Tasks'
import WhatsAppPage from './WhatsApp'
import { isSalesRepRole } from '../lib/roles'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED_CLR = '#756E80'
const PURPLE_LIGHT = '#F7F3FF'

type WidgetId =
  | 'stats'
  | 'units-by-size'
  | 'floor-occupancy'
  | 'overdue-aging'
  | 'expiring-contracts'
  | 'team-tasks'
  | 'latest-notes'

const DASHBOARD_LAYOUT_KEY = 'pb_dashboard_layout_v2'

const DEFAULT_LAYOUT: WidgetId[] = [
  'stats',
  'units-by-size',
  'floor-occupancy',
  'overdue-aging',
  'expiring-contracts',
  'team-tasks',
  'latest-notes',
]

function safeLoadLayout() {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_LAYOUT
    const filtered = parsed.filter((x): x is WidgetId => DEFAULT_LAYOUT.includes(x as WidgetId))
    const missing = DEFAULT_LAYOUT.filter((x) => !filtered.includes(x))
    return [...filtered, ...missing]
  } catch {
    return DEFAULT_LAYOUT
  }
}

type DashTab = 'overview' | 'tasks' | 'whatsapp'

function DashboardTabs({ tab, setTab }: { tab: DashTab; setTab: (t: DashTab) => void }) {
  const TABS: { value: DashTab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'tasks', label: 'Tasks' },
    { value: 'whatsapp', label: 'WhatsApp' },
  ]
  return (
    <div className="flex gap-1 rounded-full p-1 mb-5 w-fit" style={{ background: '#F6F0E4' }}>
      {TABS.map((t) => {
        const active = tab === t.value
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className="px-4 py-1.5 rounded-full text-[13px] font-semibold cursor-pointer transition-colors"
            style={active
              ? { background: 'white', color: INK, boxShadow: '0 1px 2px rgba(20,8,31,.10)' }
              : { background: 'transparent', color: MUTED_CLR }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

function WidgetShell({
  title,
  subtitle,
  id,
  onDragStart,
  onDragOver,
  onDrop,
  children,
}: {
  title: string
  subtitle?: string
  id: WidgetId
  onDragStart: (id: WidgetId) => void
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void
  onDrop: (id: WidgetId) => void
  children: React.ReactNode
}) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(id)}
      onDragOver={onDragOver}
      onDrop={() => onDrop(id)}
      className="min-w-0"
    >
      <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px 0' }}>
          <span className="flex items-center gap-2">
            <GripVertical size={14} style={{ color: MUTED_CLR }} />
            <span style={{ color: INK, fontWeight: 600, fontSize: 14 }}>{title}</span>
          </span>
          {subtitle && <div style={{ color: MUTED_CLR, fontSize: 12, marginTop: 2, paddingLeft: 22 }}>{subtitle}</div>}
        </div>
        <div style={{ padding: '12px 20px 20px' }}>{children}</div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  // Tasks is an admin/sales-rep tool and the server blocks staff outright, so
  // don't offer a tab that would only 403.
  const showTasksTab = user?.role === 'admin' || isSalesRepRole(user?.role)
  const [tab, setTab] = useState<DashTab>('overview')
  const [layout, setLayout] = useState<WidgetId[]>(() => safeLoadLayout())
  const [dragged, setDragged] = useState<WidgetId | null>(null)
  const [movePanel, setMovePanel] = useState<'in' | 'out' | 'available' | null>(null)
  const [sizeFilter, setSizeFilter] = useState<number | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery<Summary>({
    queryKey: ['summary'],
    queryFn: () => api.get('/reports/summary').then((r) => r.data),
    staleTime: 5 * 60_000,
  })

  type LatestNote = { contractId: string; contractNo: string; customerName: string; at: string; text: string; author: string }
  const { data: latestNotes = [] } = useQuery<LatestNote[]>({
    queryKey: ['latest-notes'],
    queryFn: () => api.get('/contracts/latest-notes?limit=30').then((r) => r.data),
    staleTime: 5 * 60_000,
  })

  // Latest tasks across everyone. Admins get the whole team from this
  // endpoint; a rep would only ever see their own, so this card is for the
  // admin dashboard.
  type TeamTask = {
    _id: string; title: string; status: string; dueDate?: string | null
    leadName?: string; leadType?: string | null; leadId?: string
    assignedTo?: { name?: string; email?: string } | null
    createdAt?: string
  }
  const { data: allTeamTasks = [] } = useQuery<TeamTask[]>({
    queryKey: ['team-tasks-latest'],
    queryFn: () => api.get('/tasks').then((r) => r.data),
    staleTime: 60_000,
  })
  // The endpoint sorts by due date; this card is about what was raised most
  // recently, so re-sort on createdAt.
  const teamTasks = [...allTeamTasks]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 6)

  // ── All derived values must be computed before any early return so hooks
  //    (useMemo below) are always called in the same order every render. ──────

  const totalUnits = data
    ? data.byStatus.available + data.byStatus.occupied + data.byStatus.reserved + data.byStatus.maintenance
    : 0

  const now = Date.now()
  const overdueAging = [
    { bucket: '1-7d', count: 0, amount: 0 },
    { bucket: '8-30d', count: 0, amount: 0 },
    { bucket: '30+d', count: 0, amount: 0 },
  ]
  for (const p of data?.overduePayments ?? []) {
    const days = Math.max(1, Math.floor((now - new Date(p.dueDate).getTime()) / 86400000))
    if (days <= 7) {
      overdueAging[0].count += 1; overdueAging[0].amount += p.amount || 0
    } else if (days <= 30) {
      overdueAging[1].count += 1; overdueAging[1].amount += p.amount || 0
    } else {
      overdueAging[2].count += 1; overdueAging[2].amount += p.amount || 0
    }
  }


  const onDragStart = (id: WidgetId) => setDragged(id)
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault()
  const onDrop = (targetId: WidgetId) => {
    if (!dragged || dragged === targetId) return
    const next = [...layout]
    const from = next.indexOf(dragged)
    const to = next.indexOf(targetId)
    if (from < 0 || to < 0) return
    next.splice(from, 1)
    next.splice(to, 0, dragged)
    setLayout(next)
    setDragged(null)
    localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(next))
  }

  const widgets = useMemo<Record<WidgetId, React.ReactNode>>(
    () => {
      if (!data) return {} as Record<WidgetId, React.ReactNode>
      return ({
        stats: (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-[18px]">
            {/* Occupancy - dark card */}
            <div style={{ padding: 24, borderRadius: 22, background: '#1A0B33', color: '#FFF', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 8px 24px rgba(20,8,31,.10)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A78BFA' }}>Occupancy</div>
              <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.04em' }}>{data.occupancyPct}%</div>
              <div style={{ fontSize: 11, color: '#DDD0FF' }}>{data.byStatus.occupied + data.byStatus.reserved} of {data.byStatus.available + data.byStatus.occupied + data.byStatus.reserved} units</div>
              <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,.14)', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${data.occupancyPct}%`, background: 'linear-gradient(90deg, #7C4DFF, #A78BFA)' }} />
              </div>
            </div>

            {/* Available units */}
            <div onClick={() => { setSizeFilter(null); setMovePanel('available') }} style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 1px 2px rgba(20,8,31,.05)', cursor: 'pointer' }} className="hover:shadow-md transition-shadow">
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>Available</div>
              <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{data.byStatus.available}</div>
              <div className="flex flex-wrap gap-1 mt-auto" onClick={e => e.stopPropagation()}>
                {data.bySize.filter(s => s.available > 0).slice(0, 3).map(s => (
                  <button key={s.sizeSqf} onClick={() => { setSizeFilter(parseInt(s.sizeSqf)); setMovePanel('available') }} style={{ fontSize: 10, fontWeight: 600, padding: '3px 6px', borderRadius: 6, background: PURPLE_LIGHT, color: '#4A1FA0', cursor: 'pointer', border: 'none' }} className="hover:opacity-80">{s.available}×{s.sizeSqf.replace(' sq ft', '')}</button>
                ))}
              </div>
            </div>

            {/* Active contracts */}
            <div style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 1px 2px rgba(20,8,31,.05)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>Active</div>
              <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{data.activeContracts}</div>
              <div style={{ fontSize: 11, color: '#4A4357', marginTop: 'auto' }}>{data.expiringContracts.length} expiring soon</div>
            </div>

            {/* Move-ins */}
            <div onClick={() => setMovePanel('in')} style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 1px 2px rgba(20,8,31,.05)', cursor: 'pointer' }} className="hover:shadow-md transition-shadow">
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>Move-ins</div>
              <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{data.moveInsThisMonth}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: (data.moveInsThisMonth - data.moveInsLastMonth) < 0 ? '#B3261E' : '#1B7A4B', marginTop: 'auto' }}>{(data.moveInsThisMonth - data.moveInsLastMonth) > 0 ? '+' : ''}{data.moveInsThisMonth - data.moveInsLastMonth} vs {data.moveInsLastMonth}</div>
            </div>

            {/* Move-outs */}
            <div onClick={() => setMovePanel('out')} style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 1px 2px rgba(20,8,31,.05)', cursor: 'pointer' }} className="hover:shadow-md transition-shadow">
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>Move-outs</div>
              <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{data.moveOutsThisMonth}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: (data.moveOutsThisMonth - data.moveOutsLastMonth) < 0 ? '#B3261E' : '#1B7A4B', marginTop: 'auto' }}>{(data.moveOutsThisMonth - data.moveOutsLastMonth) > 0 ? '+' : ''}{data.moveOutsThisMonth - data.moveOutsLastMonth} vs {data.moveOutsLastMonth}</div>
            </div>
          </div>
        ),
        'units-by-size': (
          <WidgetShell
            id="units-by-size"
            title="Units by size"
            subtitle="Available vs occupied per size"
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.bySize} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="sizeSqf" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="available" name="Available" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="occupied" name="Occupied" fill="#4C8CE4" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </WidgetShell>
        ),
        'floor-occupancy': (
          <WidgetShell
            id="floor-occupancy"
            title="Floor occupancy"
            subtitle="Available vs occupied by floor"
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.byFloor} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="floor" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="available" name="Available" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="occupied" name="Occupied" fill="#4C8CE4" radius={[3, 3, 0, 0]} />
                <Bar dataKey="maintenance" name="Maintenance" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </WidgetShell>
        ),
        'overdue-aging': (
          <WidgetShell
            id="overdue-aging"
            title="Overdue aging"
            subtitle="How old current overdues are"
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={overdueAging} barGap={6}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                />
                <Bar dataKey="count" name="count" fill="#ef4444" radius={[3, 3, 0, 0]} />
                <Bar dataKey="amount" name="amount" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </WidgetShell>
        ),
        'expiring-contracts': (
          <WidgetShell
            id="expiring-contracts"
            title="Contracts expiring soon"
            subtitle="Next 15 days"
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            {data.expiringContracts.length === 0 ? (
              <EmptyState message="No contracts expiring in the next 15 days." />
            ) : (
              <ul className="divide-y divide-border">
                {data.expiringContracts.slice(0, 10).map((c) => {
                  const daysLeft = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000)
                  const endFmt = new Date(c.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
                  const urgency = daysLeft <= 3 ? 'text-destructive' : daysLeft <= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                  const renewalIntent = c.renewalIntent || 'undecided'
                  const renewalBadge = {
                    undecided: { label: 'Undecided', cls: 'bg-muted text-muted-foreground' },
                    renewing: { label: 'Renewing', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400' },
                    not_renewing: { label: 'Not renewing', cls: 'bg-destructive/10 text-destructive' },
                  }[renewalIntent] || { label: 'Undecided', cls: 'bg-muted text-muted-foreground' }
                  return (
                    <li key={c._id} className="hover:bg-muted/40">
                      {/* Whole row is the link — two lines so it fits any width */}
                      <Link to={`/contracts/${c._id}`} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="text-sm truncate flex items-center gap-2">
                            <span className="font-medium">{c.customer?.fullName}</span>
                            {c.unit?.unitNumber && <span className="text-muted-foreground"> · {c.unit.unitNumber}</span>}
                            <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${renewalBadge.cls}`}>{renewalBadge.label}</span>
                          </div>
                          <div className={`text-xs mt-0.5 ${urgency}`}>expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''} ({endFmt})</div>
                        </div>
                        <span className="shrink-0 text-xs font-medium text-primary hover:underline whitespace-nowrap hidden sm:inline">View Contract</span>
                        <span className="shrink-0 text-muted-foreground sm:hidden">›</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </WidgetShell>
        ),
        'team-tasks': (
          <WidgetShell
            id="team-tasks"
            title="Latest tasks from the team"
            subtitle="Newest first, across everyone"
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            {teamTasks.length === 0 ? (
              <EmptyState message="No tasks yet." />
            ) : (
              <Table>
                <thead><tr><Th>Task</Th><Th>Assigned to</Th><Th>Due</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {teamTasks.map((t) => (
                    <tr key={t._id} className="hover:bg-muted/50">
                      <Td>
                        <div className="font-medium">{t.title}</div>
                        {t.leadName && (
                          t.leadType === 'contract' && t.leadId
                            ? <Link to={`/contracts/${t.leadId}`} className="text-xs text-primary hover:underline">{t.leadName}</Link>
                            : <span className="text-xs text-muted-foreground">{t.leadName}</span>
                        )}
                      </Td>
                      <Td className="text-sm">{t.assignedTo?.name || t.assignedTo?.email || '—'}</Td>
                      <Td className="text-sm">
                        {t.dueDate ? (
                          (() => {
                            const days = Math.ceil((new Date(t.dueDate).getTime() - Date.now()) / 86400000)
                            const late = days < 0 && t.status !== 'done'
                            return (
                              <span className={late ? 'text-destructive font-medium' : ''}>
                                {formatDate(t.dueDate)}{late ? ` · ${Math.abs(days)}d late` : ''}
                              </span>
                            )
                          })()
                        ) : '—'}
                      </Td>
                      <Td>
                        <Badge tone={t.status === 'done' ? 'green' : t.status === 'in_progress' ? 'blue' : 'gray'}>
                          {t.status === 'in_progress' ? 'In progress' : t.status === 'done' ? 'Done' : 'To do'}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </WidgetShell>
        ),
        'latest-notes': (
          <WidgetShell
            id="latest-notes"
            title="Latest notes & follow-ups"
            subtitle="30 most recent notes across all contracts"
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            {latestNotes.length === 0 ? (
              <EmptyState message="No notes yet. Add follow-up notes from any contract page." />
            ) : (
              <div className="divide-y divide-border">
                {latestNotes.map((n, i) => {
                  const fmtAt = (d: string) => {
                    const dt = new Date(d)
                    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                      + ' · ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                  }
                  return (
                    <div key={i} className="flex gap-3 py-3 hover:bg-muted/40 px-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <Link to={`/contracts/${n.contractId}`} className="text-xs font-semibold text-primary hover:underline shrink-0">
                            {n.contractNo}
                          </Link>
                          {n.customerName && (
                            <span className="text-xs text-muted-foreground truncate">{n.customerName}</span>
                          )}
                          {n.author && (
                            <span className="text-[10px] text-muted-foreground/70">· {n.author}</span>
                          )}
                        </div>
                        <p className="text-sm leading-snug line-clamp-2">{n.text}</p>
                      </div>
                      <time className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">{fmtAt(n.at)}</time>
                    </div>
                  )
                })}
              </div>
            )}
          </WidgetShell>
        ),
      })
    },
    [data, latestNotes, overdueAging, onDrop, teamTasks, totalUnits]
  )

  // Early returns come AFTER all hooks so hook call order is always stable

  // Tasks lives above the data guards: a failing /reports/summary shouldn't
  // take the task board down with it.
  if (showTasksTab && tab === 'whatsapp') {
    // The console sizes itself to the viewport, so it gets a plain wrapper
    // rather than the padded card the other tabs use.
    return (
      <div style={{ background: '#FBF8F2', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
        <DashboardTabs tab={tab} setTab={setTab} />
        <WhatsAppPage />
      </div>
    )
  }

  if (showTasksTab && tab === 'tasks') {
    return (
      <div style={{ background: '#FBF8F2', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
        <DashboardTabs tab={tab} setTab={setTab} />
        <TasksPage embedded />
      </div>
    )
  }

  if (isLoading) return <Spinner />
  if (isError || !data) {
    return (
      <div style={{ background: '#FBF8F2', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
        <div className="mb-7">
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Dashboard</div>
          <div style={{ fontSize: 14, color: MUTED_CLR, marginTop: 4 }}>Facility overview at a glance</div>
        </div>
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 0' }}>
            <span style={{ color: INK, fontWeight: 600, fontSize: 14 }}>Unable to load dashboard</span>
            <div style={{ color: MUTED_CLR, fontSize: 12, marginTop: 2 }}>{apiError(error)}</div>
          </div>
          <div style={{ padding: '12px 20px 20px' }} className="flex flex-wrap items-center gap-3">
            <Button onClick={() => refetch()}>Retry</Button>
            <span className="text-xs" style={{ color: MUTED_CLR }}>If this keeps happening, verify the backend API and login session.</span>
          </div>
          <EmptyState message="Dashboard data is temporarily unavailable." />
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#FBF8F2', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">

      {showTasksTab && <DashboardTabs tab={tab} setTab={setTab} />}

      <div className="space-y-5">
        {layout.map((id) => {
          if (id === 'stats') {
            return (
              <div key={id} draggable onDragStart={() => onDragStart(id)} onDragOver={onDragOver} onDrop={() => onDrop(id)}>
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><GripVertical size={14} /> KPI Cards</div>
                {widgets[id]}
              </div>
            )
          }

          if (id === 'units-by-size' || id === 'floor-occupancy' || id === 'overdue-aging') {
            const peerIds: WidgetId[] = ['units-by-size', 'floor-occupancy', 'overdue-aging']
            const first = peerIds.find((x) => layout.includes(x))
            if (id !== first) return null
            return (
              <div key="charts-grid" className="grid gap-4 lg:grid-cols-3">
                {peerIds.filter((x) => layout.includes(x)).map((x) => (
                  <div key={x}>{widgets[x]}</div>
                ))}
              </div>
            )
          }

          if (id === 'expiring-contracts' || id === 'team-tasks') {
            const peerIds: WidgetId[] = ['expiring-contracts', 'team-tasks']
            const first = peerIds.find((x) => layout.includes(x))
            if (id !== first) return null
            return (
              <div key="middle-grid" className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
                {peerIds.filter((x) => layout.includes(x)).map((x) => (
                  <div key={x}>{widgets[x]}</div>
                ))}
              </div>
            )
          }

          if (id === 'latest-notes') {
            return <div key={id}>{widgets[id]}</div>
          }

          return null
        })}
      </div>

      {/* Detail panel */}
      {movePanel && data && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setMovePanel(null)} />
          <div className="relative w-full max-w-md bg-white dark:bg-gray-900 shadow-xl overflow-y-auto animate-in slide-in-from-right">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b px-5 py-4 flex items-center justify-between z-10">
              <h2 style={{ ...HEADING, fontSize: 18, fontWeight: 700, color: INK }}>
                {movePanel === 'in' ? 'Move-ins this month' : movePanel === 'out' ? 'Move-outs this month' : sizeFilter ? `Available Units · ${sizeFilter} sq ft` : 'Available Units'}
              </h2>
              <button onClick={() => setMovePanel(null)} className="p-1 hover:bg-muted rounded cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-2">
              {movePanel === 'available' ? (() => {
                const filtered = (data.availableUnitsList ?? []).filter((u: any) => sizeFilter ? u.sizeSqf === sizeFilter : true)
                return filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No available units{sizeFilter ? ` for ${sizeFilter} sq ft` : ''}.</p>
                ) : filtered.map((u: any) => (
                  <Link key={u._id} to={`/units`} onClick={() => setMovePanel(null)}
                    className="block rounded-lg border px-4 py-3 hover:bg-muted/50 transition-colors">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-sm">Unit {u.unitNumber}</p>
                        <p className="text-xs text-muted-foreground">{u.floor} · {u.sizeSqf} sq ft</p>
                      </div>
                      <div className="text-right shrink-0">
                        {u.monthlyRent ? (
                          <>
                            <span className="text-sm font-semibold" style={{ color: INK }}>AED {u.monthlyRent.toLocaleString()}</span>
                            <span className="text-[10px] text-muted-foreground block">/ month</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">No price set</span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))
              })() : (() => {
                const list = (movePanel === 'in' ? data.moveInsList : data.moveOutsList) ?? []
                return list.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No {movePanel === 'in' ? 'move-ins' : 'move-outs'} this month.</p>
                ) : list.map((c: any) => (
                  <Link key={c._id} to={`/contracts/${c._id}`} onClick={() => setMovePanel(null)}
                    className="block rounded-lg border px-4 py-3 hover:bg-muted/50 transition-colors">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-sm">{c.customer?.fullName || '—'}</p>
                        <p className="text-xs text-muted-foreground">{c.contractNo} · Unit {c.unit?.unitNumber || '—'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs text-muted-foreground block">
                          {new Date(movePanel === 'in' ? c.startDate : c.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${c.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                          c.paymentStatus === 'pending' ? 'bg-amber-100 text-amber-700' :
                            'bg-muted text-muted-foreground'
                          }`}>
                          {c.paymentStatus === 'paid' ? 'Paid' : c.paymentStatus === 'pending' ? 'Pending' : 'No invoice'}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


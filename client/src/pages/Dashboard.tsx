import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { GripVertical, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api, apiError, leadFollowUpApi } from '../lib/api'
import type { Contract, DashboardStats, FloorOccupancy } from '../lib/types'
import { EmptyState, Skeleton, Table, Th, Td, Button, Badge } from '../components/ui'
import { formatDate } from '../lib/utils'
import DashboardAsk from '../components/DashboardAsk'
import QuietLeadsModal from '../components/QuietLeadsModal'
import { useAuth } from '../lib/auth'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED_CLR = '#756E80'
const PURPLE_LIGHT = '#F7F3FF'

type WidgetId =
  | 'stats'
  | 'units-by-size'
  | 'floor-occupancy'
  | 'quiet-leads'
  | 'expiring-contracts'
  | 'team-tasks'

const DASHBOARD_LAYOUT_KEY = 'pb_dashboard_layout_v2'

const DEFAULT_LAYOUT: WidgetId[] = [
  'stats',
  'units-by-size',
  'floor-occupancy',
  'quiet-leads',
  'expiring-contracts',
  'team-tasks',
]

function safeLoadLayout() {
  try {
    const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_LAYOUT
    const result = parsed.filter((x): x is WidgetId => DEFAULT_LAYOUT.includes(x as WidgetId))

    /* A widget added to DEFAULT_LAYOUT after somebody already saved a custom
       order used to be appended at the very end, past everything else on the
       page — which for a widget added last (quiet-leads) meant the bottom of
       a long dashboard, easy to miss and easy to mistake for "not there".
       Placed instead right after whichever of its default-order neighbours
       the person still has, so a new widget lands near where it was designed
       to sit rather than always at the tail. */
    for (const id of DEFAULT_LAYOUT) {
      if (result.includes(id)) continue
      const defaultIdx = DEFAULT_LAYOUT.indexOf(id)
      let insertAt = result.length
      for (let i = defaultIdx - 1; i >= 0; i--) {
        const afterIdx = result.indexOf(DEFAULT_LAYOUT[i])
        if (afterIdx !== -1) { insertAt = afterIdx + 1; break }
      }
      result.splice(insertAt, 0, id)
    }
    return result
  } catch {
    return DEFAULT_LAYOUT
  }
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
  const isAdmin = user?.role === 'admin'

  // Tasks is an admin/sales-rep tool and the server blocks staff outright, so
  // don't offer a tab that would only 403.
  const [layout, setLayout] = useState<WidgetId[]>(() => safeLoadLayout())
  const [dragged, setDragged] = useState<WidgetId | null>(null)
  const [movePanel, setMovePanel] = useState<'in' | 'out' | 'available' | null>(null)
  const [sizeFilter, setSizeFilter] = useState<number | null>(null)
  const [showQuiet, setShowQuiet] = useState(false)
  const [quietOwner, setQuietOwner] = useState<string | undefined>(undefined)

  // Every card below fetches its own slice, independently, so whichever
  // answers first shows first instead of the whole page waiting on the
  // slowest one. That used to be a single /reports/summary call; split into
  // /stats, /floor-occupancy and the existing /expiring so a card is never
  // blocked on data another card needs.
  const { data: stats, isLoading: statsLoading, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/reports/stats').then((r) => r.data),
    staleTime: 5 * 60_000,
  })

  const { data: floor, isLoading: floorLoading, isError: floorIsError, refetch: refetchFloor } = useQuery<FloorOccupancy>({
    queryKey: ['dashboard-floor-occupancy'],
    queryFn: () => api.get('/reports/floor-occupancy').then((r) => r.data),
    staleTime: 5 * 60_000,
  })

  const { data: expiringContracts, isLoading: expiringLoading, isError: expiringIsError, refetch: refetchExpiring } = useQuery<Contract[]>({
    queryKey: ['dashboard-expiring'],
    queryFn: () => api.get('/reports/expiring', { params: { days: 15 } }).then((r) => r.data),
    staleTime: 5 * 60_000,
  })

  /* Every rep's quiet-lead backlog, rolled up — the count and the chart. It
   * is the heaviest thing this page asks for (every open lead in the
   * company, not one rep's few dozen). Its own card, its own load — no
   * reason left to hold it back behind anything else on the page. */
  const { data: quiet, isLoading: quietLoading } = useQuery({
    queryKey: ['lead-follow-up-summary'],
    queryFn: () => leadFollowUpApi.summary(),
    staleTime: 60_000,
  })

  // Contract-expiry reminders waiting on approval — admin-only.
  type PendingExpiryGroup = { step: number; stepLabel: string; rows: unknown[] }
  const { data: pendingExpiry } = useQuery<{ groups: PendingExpiryGroup[]; total: number }>({
    queryKey: ['automation-rules-pending'],
    queryFn: () => api.get('/automation-rules/pending').then((r) => r.data),
    enabled: isAdmin,
    staleTime: 60_000,
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
  // Newest-first, capped server-side — this used to fetch every task in the
  // system (no limit) just to re-sort and keep 6 of them client-side, which
  // was most of a 4s dashboard load on its own.
  const { data: teamTasks, isLoading: tasksLoading } = useQuery<TeamTask[]>({
    queryKey: ['team-tasks-latest'],
    queryFn: () => api.get('/tasks', { params: { limit: 5, sort: 'createdAt' } }).then((r) => r.data),
    staleTime: 60_000,
  })



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

  const kpiSkeleton = (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-[18px]">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[150px] rounded-[22px]" />)}
    </div>
  )

  const widgets = useMemo<Record<WidgetId, React.ReactNode>>(
    () => {
      return ({
        stats: statsLoading ? kpiSkeleton : statsIsError || !stats ? (
          <div className="rounded-[22px] border p-6 flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: 'rgba(20,8,31,.10)' }}>
            <div>
              <div style={{ color: INK, fontWeight: 600, fontSize: 14 }}>Couldn&rsquo;t load the KPI numbers</div>
              <div style={{ color: MUTED_CLR, fontSize: 12, marginTop: 2 }}>{apiError(statsError)}</div>
            </div>
            <Button onClick={() => refetchStats()}>Retry</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-[18px]">
            {/* Occupancy - dark card */}
            <div style={{ padding: 24, borderRadius: 22, background: '#1A0B33', color: '#FFF', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 8px 24px rgba(20,8,31,.10)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A78BFA' }}>Occupancy</div>
              <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.04em' }}>{stats.occupancyPct}%</div>
              {/* Spell out what is being counted.
                  It read "145 of 304 units", which looks wrong against a
                  facility of 305: the 145 quietly includes reserved units as
                  well as occupied ones, and the 304 quietly leaves out
                  anything under maintenance, which cannot be let. Both are the
                  right way to measure occupancy — they just were not said. */}
              <div style={{ fontSize: 11, color: '#DDD0FF' }}>
                {stats.byStatus.occupied + stats.byStatus.reserved} taken
                {stats.byStatus.reserved > 0 && ` (${stats.byStatus.occupied} in, ${stats.byStatus.reserved} reserved)`}
                {' of '}
                {stats.byStatus.available + stats.byStatus.occupied + stats.byStatus.reserved} lettable
                {stats.byStatus.maintenance > 0 && ` · ${stats.byStatus.maintenance} under maintenance`}
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,.14)', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${stats.occupancyPct}%`, background: 'linear-gradient(90deg, #7C4DFF, #A78BFA)' }} />
              </div>
            </div>

            {/* Booked — units with somebody in them. */}
            <div style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 1px 2px rgba(20,8,31,.05)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>Booked</div>
              <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{stats.byStatus.occupied}</div>
              <div style={{ fontSize: 11, color: '#4A4357', marginTop: 'auto' }}>{stats.activeContracts} active contracts</div>
            </div>

            {/* Reserved — held, not yet moved in. */}
            <div style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 1px 2px rgba(20,8,31,.05)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>Reserved</div>
              <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{stats.byStatus.reserved}</div>
              <div style={{ fontSize: 11, color: '#4A4357', marginTop: 'auto' }}>held, not moved in yet</div>
            </div>

            {/* Vacant — the same units the old Available card counted, named
                the way the team asks for them. */}
            <div onClick={() => { setSizeFilter(null); setMovePanel('available') }} style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 1px 2px rgba(20,8,31,.05)', cursor: 'pointer' }} className="hover:shadow-md transition-shadow">
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>Vacant</div>
              <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{stats.byStatus.available}</div>
              <div className="flex flex-wrap gap-1 mt-auto" onClick={e => e.stopPropagation()}>
                {stats.bySize.filter(s => s.available > 0).slice(0, 3).map(s => (
                  <button key={s.sizeSqf} onClick={() => { setSizeFilter(parseInt(s.sizeSqf)); setMovePanel('available') }} style={{ fontSize: 10, fontWeight: 600, padding: '3px 6px', borderRadius: 6, background: PURPLE_LIGHT, color: '#4A1FA0', cursor: 'pointer', border: 'none' }} className="hover:opacity-80">{s.available}×{s.sizeSqf.replace(' sq ft', '')}</button>
                ))}
              </div>
            </div>

            {/* Moving out this month.
                Deliberately not the old Move-outs figure, which counted
                contracts that had already ended — those units are vacant and
                already counted as such. This is who is still in the building
                with an end date before the month is out, which is the list
                worth acting on. */}
            <div onClick={() => setMovePanel('out')} style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 1px 2px rgba(20,8,31,.05)', cursor: 'pointer' }} className="hover:shadow-md transition-shadow">
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>Moving out</div>
              <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{stats.movingOutThisMonth ?? 0}</div>
              <div style={{ fontSize: 11, color: '#4A4357', marginTop: 'auto' }}>
                still in, leaving in {stats.monthLabel ?? 'this month'}
                {stats.moveOutsThisMonth > 0 && ` · ${stats.moveOutsThisMonth} already out`}
              </div>
            </div>

            {/* Leads gone quiet — pinned here rather than left as a
                draggable/removable widget. That system reads its order from
                a layout array saved in each browser's own localStorage, and
                for an admin who already had a saved dashboard layout before
                this existed, a widget added later could end up anywhere in
                it, or effectively invisible without scrolling past
                everything else. A KPI tile in this fixed row has no such
                array to be missing from — it is exactly as visible as
                Occupancy or Vacant, every time, for every admin. */}
            <div
              onClick={() => { setQuietOwner(undefined); setShowQuiet(true) }}
              style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 1px 2px rgba(20,8,31,.05)', cursor: 'pointer' }}
              className="hover:shadow-md transition-shadow"
            >
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>Leads gone quiet</div>
              <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{quiet?.total ?? '—'}</div>
              <div style={{ fontSize: 11, color: '#4A4357', marginTop: 'auto' }}>
                {quiet === undefined ? 'loading…' : quiet.total > 0 ? 'we spoke last, nothing came back — review & send →' : 'nobody, good sign'}
              </div>
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
            {statsLoading ? <Skeleton className="h-[240px]" /> : statsIsError || !stats ? (
              <EmptyState message="Couldn't load this chart." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stats.bySize} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="sizeSqf" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="available" name="Available" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="occupied" name="Occupied" fill="#4C8CE4" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
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
            {floorLoading ? <Skeleton className="h-[240px]" /> : floorIsError || !floor ? (
              <div className="flex items-center justify-between gap-3 flex-wrap py-4">
                <span className="text-sm text-muted-foreground">Couldn&rsquo;t load this chart.</span>
                <Button onClick={() => refetchFloor()}>Retry</Button>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={floor.byFloor} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="floor" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="available" name="Available" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="occupied" name="Occupied" fill="#4C8CE4" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="maintenance" name="Maintenance" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </WidgetShell>
        ),
        'quiet-leads': (
          <WidgetShell
            id="quiet-leads"
            title="Leads gone quiet"
            subtitle="We spoke last, nothing came back"
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            {quietLoading ? <Skeleton className="h-[160px]" /> : !quiet || quiet.total === 0 ? (
              <p style={{ fontSize: 12.5, color: MUTED_CLR, padding: '8px 0' }}>Nobody&rsquo;s been quiet. Good sign.</p>
            ) : (
              <>
                <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                  <div style={{ ...HEADING, fontWeight: 700, fontSize: 28, letterSpacing: '-0.02em' }}>{quiet.total}</div>
                  <button
                    type="button"
                    onClick={() => { setQuietOwner(undefined); setShowQuiet(true) }}
                    className="cursor-pointer"
                    style={{ fontSize: 12, fontWeight: 600, color: '#4A1FA0', background: PURPLE_LIGHT, border: 'none', borderRadius: 8, padding: '6px 12px' }}
                  >
                    Review & send
                  </button>
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={quiet.buckets} barGap={6}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="count" name="quiet leads" fill="#A78BFA" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                {/* Per rep, so it is visible when the backlog is really one
                    person's — the number that started this whole feature. */}
                <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
                  {quiet.byOwner.slice(0, 5).map((o) => (
                    <button
                      key={o.ownerId ?? 'unassigned'}
                      type="button"
                      onClick={() => { setQuietOwner(o.ownerId ?? undefined); setShowQuiet(true) }}
                      className="flex items-center justify-between cursor-pointer hover:opacity-80"
                      style={{ fontSize: 12, padding: '3px 0', background: 'none', border: 'none', textAlign: 'left' }}
                    >
                      <span style={{ color: INK }}>{o.ownerName}</span>
                      <span style={{ color: MUTED_CLR, fontWeight: 600 }}>{o.count}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
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
            {expiringLoading ? <Skeleton className="h-[240px]" /> : expiringIsError ? (
              <div className="flex items-center justify-between gap-3 flex-wrap py-4">
                <span className="text-sm text-muted-foreground">Couldn&rsquo;t load this list.</span>
                <Button onClick={() => refetchExpiring()}>Retry</Button>
              </div>
            ) : !expiringContracts || expiringContracts.length === 0 ? (
              <EmptyState message="No contracts expiring in the next 15 days." />
            ) : (
              <ul className="divide-y divide-border">
                {expiringContracts.slice(0, 10).map((c) => {
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
            {tasksLoading ? <Skeleton className="h-[240px]" /> : !teamTasks || teamTasks.length === 0 ? (
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
      })
    },
    [statsLoading, statsIsError, stats, statsError, refetchStats, floorLoading, floorIsError, floor, refetchFloor,
      expiringLoading, expiringIsError, expiringContracts, refetchExpiring, tasksLoading, teamTasks, quietLoading, quiet,
      onDrop, onDragStart, onDragOver]
  )

  // No page-level loading/error gate any more — each card above already
  // shows its own skeleton or its own retry button from its own query, so
  // the page frame renders immediately and cards fill in independently as
  // their own data arrives, instead of every card waiting on the slowest
  // one (or one failing request taking the whole page down with it).

  return (
    <div style={{ background: '#fff', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">

      <div className="mb-5"><DashboardAsk /></div>

      {isAdmin && Boolean(pendingExpiry?.total) && (
        <Link
          to="/settings/automation?tab=pending"
          className="mb-5 flex items-center gap-3 flex-wrap rounded-2xl border px-5 py-3.5 hover:bg-amber-100/60 transition-colors"
          style={{ background: '#FFF7E6', borderColor: '#F5D896' }}
        >
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div className="flex-1 min-w-[220px]">
            <div style={{ ...HEADING, fontWeight: 700, fontSize: 14.5, color: '#8A5A00' }}>Contracts Expiring Soon</div>
            <div className="text-xs mt-0.5" style={{ color: '#8A5A00', opacity: 0.85 }}>
              {pendingExpiry!.groups.map((g) => `${g.rows.length} · ${g.stepLabel}`).join('  ·  ')}
              {' — reminders waiting on your approval'}
            </div>
          </div>
          <span className="text-xs font-bold shrink-0" style={{ color: '#8A5A00' }}>Review &amp; Approve →</span>
        </Link>
      )}

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

          if (id === 'units-by-size' || id === 'floor-occupancy') {
            const peerIds: WidgetId[] = ['units-by-size', 'floor-occupancy']
            const first = peerIds.find((x) => layout.includes(x))
            if (id !== first) return null
            return (
              <div key="charts-grid" className="grid gap-4 lg:grid-cols-2">
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

          return null
        })}
      </div>

      {/* Detail panel */}
      {movePanel && stats && (
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
                const filtered = (stats.availableUnitsList ?? []).filter((u: any) => sizeFilter ? u.sizeSqf === sizeFilter : true)
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
                const list = (movePanel === 'in' ? stats.moveInsList : stats.moveOutsList) ?? []
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

      {showQuiet && <QuietLeadsModal onClose={() => setShowQuiet(false)} scope="all" ownerId={quietOwner} />}
    </div>
  )
}


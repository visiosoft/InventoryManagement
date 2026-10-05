import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, GripVertical, ChevronDown } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api, apiError, leadApi, type HighIntentLead, type WebsiteLead, type WebsiteAnalytics, type MonthFunnelStage } from '../lib/api'
import type { Contract, DashboardStats, FloorOccupancy } from '../lib/types'
import { EmptyState, Skeleton, Table, Th, Td, Button, Badge, SlideOver, Pagination, statusLabel } from '../components/ui'
import { CHART_STYLE } from './reports/shared'
import { formatDate, formatMoney } from '../lib/utils'
import DashboardAsk from '../components/DashboardAsk'
import { useAuth } from '../lib/auth'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED_CLR = '#756E80'
const PURPLE_LIGHT = '#F7F3FF'

type WidgetId =
  | 'stats'
  | 'high-intent-leads'
  | 'website-leads-today'
  | 'lead-funnel'
  | 'website-analytics'
  | 'units-by-size'
  | 'floor-occupancy'
  | 'expiring-contracts'
  | 'team-tasks'

const DASHBOARD_LAYOUT_KEY = 'pb_dashboard_layout_v2'

const DEFAULT_LAYOUT: WidgetId[] = [
  'stats',
  'lead-funnel',
  'high-intent-leads',
  'website-leads-today',
  'website-analytics',
  'units-by-size',
  'floor-occupancy',
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
       order is placed right after whichever of its default-order neighbours
       the person still has, so it lands near where it was designed to sit
       rather than always at the tail. That still has one gap: if none of
       its earlier neighbours survive in the saved order either — every one
       of them since removed or renamed — the search finds nothing and used
       to fall back to appending at the very end, past everything else on
       a long dashboard. That is exactly how the last widget added this way
       (quiet-leads) went unnoticed for a while, and precisely what
       happened again with the one added right after it (high-intent-leads)
       reusing the same fallback. The front of the list is the safer
       default for a fallback nobody chose: a widget arriving one row later
       than expected is a shrug, arriving at the bottom of a page people
       stop scrolling before reaching is invisible. */
    for (const id of DEFAULT_LAYOUT) {
      if (result.includes(id)) continue
      const defaultIdx = DEFAULT_LAYOUT.indexOf(id)
      let insertAt = 0
      let foundNeighbour = false
      for (let i = defaultIdx - 1; i >= 0; i--) {
        const afterIdx = result.indexOf(DEFAULT_LAYOUT[i])
        if (afterIdx !== -1) { insertAt = afterIdx + 1; foundNeighbour = true; break }
      }
      if (!foundNeighbour) insertAt = 0
      result.splice(insertAt, 0, id)
    }
    return result
  } catch {
    return DEFAULT_LAYOUT
  }
}

const KPI_SKELETON = (
  <div className="grid grid-cols-2 lg:grid-cols-6 gap-[18px]">
    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[150px] rounded-[22px]" />)}
  </div>
)

const RENEWAL_BADGE: Record<string, { label: string; tone: string }> = {
  undecided: { label: 'Undecided', tone: 'gray' },
  renewing: { label: 'Renewing', tone: 'green' },
  not_renewing: { label: 'Not renewing', tone: 'red' },
}

const PAYMENT_BADGE: Record<string, { label: string; tone: string }> = {
  paid: { label: 'Paid', tone: 'green' },
  pending: { label: 'Pending', tone: 'amber' },
}

function KpiTile({
  label, value, footer, onClick, extra,
}: {
  label: string
  value: React.ReactNode
  footer: React.ReactNode
  onClick?: () => void
  extra?: React.ReactNode
}) {
  return (
    <div
      onClick={onClick}
      style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 1px 2px rgba(20,8,31,.05)', cursor: onClick ? 'pointer' : undefined }}
      className={onClick ? 'hover:shadow-md transition-shadow' : undefined}
    >
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>{label}</div>
      <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#4A4357', marginTop: 'auto' }}>{footer}</div>
      {extra}
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
        <div style={{ padding: '20px 22px 0' }}>
          <span className="flex items-center gap-2">
            <GripVertical size={14} style={{ color: MUTED_CLR }} />
            <span style={{ ...HEADING, color: INK, fontWeight: 700, fontSize: 15 }}>{title}</span>
          </span>
          {subtitle && <div style={{ color: MUTED_CLR, fontSize: 12, marginTop: 3, paddingLeft: 22 }}>{subtitle}</div>}
        </div>
        <div style={{ padding: '14px 22px 22px' }}>{children}</div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [layout, setLayout] = useState<WidgetId[]>(() => safeLoadLayout())
  const [, setDragged] = useState<WidgetId | null>(null)
  const [movePanel, setMovePanel] = useState<'in' | 'out' | 'available' | null>(null)
  const [sizeFilter, setSizeFilter] = useState<number | null>(null)
  const [funnelStage, setFunnelStage] = useState<{ stage: MonthFunnelStage; label: string } | null>(null)
  const ROWS_PER_PAGE = 8
  const [highIntentPage, setHighIntentPage] = useState(1)
  const [websiteLeadsPage, setWebsiteLeadsPage] = useState(1)

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

  // Who to actually follow up with — every other lead widget on this page
  // is about volume or backlog; this is the one that says who's worth the
  // time, today or yesterday only. Own card, own load, same as quiet-leads
  // beside it — the heaviest reads on this page never block the rest of it.
  const { data: highIntent, isLoading: highIntentLoading } = useQuery({
    queryKey: ['high-intent-leads'],
    queryFn: () => leadApi.highIntentToday(),
    staleTime: 60_000,
  })

  // Everyone who filled in a landing-page form today — a straight list, no
  // AI scoring, so a lead shows up here the instant it lands rather than
  // waiting on the next conversation-summary pass high-intent-leads needs.
  const { data: websiteLeads, isLoading: websiteLeadsLoading } = useQuery({
    queryKey: ['website-leads-today'],
    queryFn: () => leadApi.newFromWebsiteToday(),
    staleTime: 60_000,
  })

  // How this month's leads are doing, and how many follow-ups are already
  // past due — own card, own load like the two lead cards above it.
  const { data: monthFunnel, isLoading: monthFunnelLoading, isError: monthFunnelIsError, refetch: refetchMonthFunnel } = useQuery({
    queryKey: ['lead-month-funnel'],
    queryFn: () => leadApi.monthFunnel(),
    staleTime: 60_000,
  })

  // The leads behind whichever funnel row was clicked — fetched only once a
  // row is open, so the card itself stays as light as it was.
  const { data: funnelLeads, isLoading: funnelLeadsLoading, isError: funnelLeadsIsError, refetch: refetchFunnelLeads } = useQuery({
    queryKey: ['lead-month-funnel-leads', funnelStage?.stage],
    queryFn: () => leadApi.monthFunnelLeads(funnelStage!.stage),
    enabled: !!funnelStage,
    staleTime: 30_000,
  })

  // Own card, own load — a slow or failing GA4 call must never hold up the
  // rest of the dashboard. Reports { configured: false } instead of an
  // error until the service account key and property ID are set, which the
  // widget below turns into a "connect Google Analytics" message.
  const { data: websiteAnalytics, isLoading: websiteAnalyticsLoading, error: websiteAnalyticsError } = useQuery<WebsiteAnalytics>({
    queryKey: ['website-analytics'],
    queryFn: () => api.get('/reports/website-analytics', { params: { days: 30 } }).then((r) => r.data),
    staleTime: 5 * 60_000,
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
  }
  // Newest-first, capped server-side — this used to fetch every task in the
  // system (no limit) just to re-sort and keep 6 of them client-side, which
  // was most of a 4s dashboard load on its own.
  const { data: teamTasks, isLoading: tasksLoading } = useQuery<TeamTask[]>({
    queryKey: ['team-tasks-latest'],
    queryFn: () => api.get('/tasks', { params: { limit: 5, sort: 'createdAt' } }).then((r) => r.data),
    staleTime: 60_000,
  })

  const onDragStart = useCallback((id: WidgetId) => setDragged(id), [])
  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => e.preventDefault(), [])
  const onDrop = useCallback((targetId: WidgetId) => {
    setDragged((dragged) => {
      if (!dragged || dragged === targetId) return dragged
      setLayout((prev) => {
        const next = [...prev]
        const from = next.indexOf(dragged)
        const to = next.indexOf(targetId)
        if (from < 0 || to < 0) return prev
        next.splice(from, 1)
        next.splice(to, 0, dragged)
        localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(next))
        return next
      })
      return null
    })
  }, [])
  const dragHandlers = { onDragStart, onDragOver, onDrop }

  const widgets = useMemo<Record<WidgetId, React.ReactNode>>(
    () => {
      return ({
        stats: statsLoading ? KPI_SKELETON : statsIsError || !stats ? (
          <div className="rounded-[22px] border p-6 flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: 'rgba(20,8,31,.10)' }}>
            <div>
              <div style={{ color: INK, fontWeight: 600, fontSize: 14 }}>Couldn&rsquo;t load the KPI numbers</div>
              <div style={{ color: MUTED_CLR, fontSize: 12, marginTop: 2 }}>{apiError(statsError)}</div>
            </div>
            <Button onClick={() => refetchStats()}>Retry</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-[18px]">
            {/* Occupancy — redesigned look (chevron + label, "X% of Y"
                header, big %, bar), Booked/Reserved/Vacant kept as their
                own separate cards right after it, same as before. */}
            {(() => {
              const lettable = stats.byStatus.available + stats.byStatus.occupied + stats.byStatus.reserved
              return (
                <div className="col-span-2" style={{ padding: 24, borderRadius: 22, background: '#1A0B33', color: '#FFF', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 8px 24px rgba(20,8,31,.10)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A78BFA' }}>
                      <ChevronDown size={13} aria-hidden="true" /> Occupancy
                    </div>
                    <div style={{ fontSize: 11, color: '#B9A8E8' }}>{stats.occupancyPct}% of {lettable}</div>
                  </div>
                  <div style={{ ...HEADING, fontWeight: 700, fontSize: 48, lineHeight: 0.9, letterSpacing: '-0.04em' }}>{stats.occupancyPct}%</div>
                  <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,.14)', overflow: 'hidden' }}>
                    <div style={{ width: `${stats.occupancyPct}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #7C4DFF, #A78BFA)' }} />
                  </div>
                  <div className="grid grid-cols-3 gap-2" style={{ borderTop: '1px solid rgba(255,255,255,.14)', paddingTop: 14 }}>
                    <div>
                      <div style={{ ...HEADING, fontWeight: 700, fontSize: 21 }}>{stats.byStatus.occupied}</div>
                      <div style={{ fontSize: 10.5, color: '#B9A8E8', marginTop: 2 }}>Booked</div>
                    </div>
                    <div>
                      <div style={{ ...HEADING, fontWeight: 700, fontSize: 21 }}>{stats.byStatus.reserved}</div>
                      <div style={{ fontSize: 10.5, color: '#B9A8E8', marginTop: 2 }}>Reserved</div>
                    </div>
                    <div>
                      <div style={{ ...HEADING, fontWeight: 700, fontSize: 21 }}>{stats.byStatus.available}</div>
                      <div style={{ fontSize: 10.5, color: '#B9A8E8', marginTop: 2 }}>Vacant</div>
                    </div>
                  </div>
                </div>
              )
            })()}

            <KpiTile label="Booked" value={stats.byStatus.occupied} footer={`${stats.activeContracts} active contracts`} />

            <KpiTile label="Reserved" value={stats.byStatus.reserved} footer="held, not moved in yet" />

            {/* Vacant — the same units the old Available card counted, named
                the way the team asks for them. */}
            <KpiTile
              label="Vacant"
              value={stats.byStatus.available}
              onClick={() => { setSizeFilter(null); setMovePanel('available') }}
              footer={
                <div className="flex flex-wrap gap-1" onClick={e => e.stopPropagation()}>
                  {stats.bySize.filter(s => s.available > 0).slice(0, 3).map(s => (
                    <button key={s.sizeSqf} onClick={() => { setSizeFilter(parseInt(s.sizeSqf)); setMovePanel('available') }} style={{ fontSize: 10, fontWeight: 600, padding: '3px 6px', borderRadius: 6, background: PURPLE_LIGHT, color: '#4A1FA0', cursor: 'pointer', border: 'none' }} className="hover:opacity-80">{s.available}×{s.sizeSqf.replace(' sq ft', '')}</button>
                  ))}
                </div>
              }
            />

            {/* Moving out this month.
                Deliberately not the old Move-outs figure, which counted
                contracts that had already ended — those units are vacant and
                already counted as such. This is who is still in the building
                with an end date before the month is out, which is the list
                worth acting on. */}
            <KpiTile
              label="Moving out"
              value={stats.movingOutThisMonth ?? 0}
              onClick={() => setMovePanel('out')}
              footer={
                <>
                  still in, leaving in {stats.monthLabel ?? 'this month'}
                  {stats.moveOutsThisMonth > 0 && ` · ${stats.moveOutsThisMonth} already out`}
                </>
              }
            />

          </div>
        ),
        'high-intent-leads': (
          <WidgetShell id="high-intent-leads" title="High intent — today & yesterday" subtitle="Scored by the AI's read of the conversation — these are the ones to follow up" {...dragHandlers}>
            {highIntentLoading ? <Skeleton className="h-[160px]" /> : !highIntent || highIntent.items.length === 0 ? (
              <p style={{ fontSize: 12.5, color: MUTED_CLR, padding: '8px 0' }}>
                Nobody's scored high yet today or yesterday. Open a chat in WhatsApp to have one read.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {highIntent.items.slice((highIntentPage - 1) * ROWS_PER_PAGE, highIntentPage * ROWS_PER_PAGE).map((l: HighIntentLead) => (
                  <Link
                    key={l.leadId}
                    to={`/whatsapp?phone=${l.phone}`}
                    className="flex items-start gap-3 hover:opacity-80 transition-opacity"
                    style={{ padding: '8px 10px', borderRadius: 10, background: '#FAF8F5', textDecoration: 'none' }}
                  >
                    <span
                      className="shrink-0 rounded-full flex items-center justify-center"
                      style={{ width: 34, height: 34, background: '#DCFCE7', color: '#15803D', fontSize: 12, fontWeight: 800 }}
                    >
                      {l.score}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate" style={{ fontSize: 13, fontWeight: 700, color: INK }}>{l.name}</span>
                        <span style={{ fontSize: 10.5, color: MUTED_CLR, whiteSpace: 'nowrap' }}>{l.ownerName}</span>
                      </div>
                      <div className="truncate" style={{ fontSize: 11.5, color: MUTED_CLR }}>{l.reason}</div>
                      {l.nextAction && <div className="truncate" style={{ fontSize: 11, color: '#4A1FA0', marginTop: 1 }}>Next: {l.nextAction}</div>}
                    </div>
                  </Link>
                ))}
                {highIntent.items.length > ROWS_PER_PAGE && (
                  <Pagination
                    page={highIntentPage}
                    pages={Math.ceil(highIntent.items.length / ROWS_PER_PAGE)}
                    total={highIntent.items.length}
                    limit={ROWS_PER_PAGE}
                    onPage={setHighIntentPage}
                  />
                )}
              </div>
            )}
          </WidgetShell>
        ),
        'website-leads-today': (
          <WidgetShell id="website-leads-today" title="New leads from the website — today" subtitle="Submitted through a purplebox.ae landing page" {...dragHandlers}>
            {websiteLeadsLoading ? <Skeleton className="h-[160px]" /> : !websiteLeads || websiteLeads.items.length === 0 ? (
              <p style={{ fontSize: 12.5, color: MUTED_CLR, padding: '8px 0' }}>
                Nothing from the website yet today.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {websiteLeads.items.slice((websiteLeadsPage - 1) * ROWS_PER_PAGE, websiteLeadsPage * ROWS_PER_PAGE).map((l: WebsiteLead) => (
                  <Link
                    key={l.leadId}
                    to={`/leads/${l.leadId}`}
                    className="flex items-start gap-3 hover:opacity-80 transition-opacity"
                    style={{ padding: '8px 10px', borderRadius: 10, background: '#FAF8F5', textDecoration: 'none' }}
                  >
                    <span
                      className="shrink-0 rounded-full flex items-center justify-center"
                      style={{ width: 34, height: 34, background: '#DCEBF7', color: '#1B5C8A', fontSize: 15, fontWeight: 800 }}
                    >
                      {l.name.charAt(0).toUpperCase() || '?'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate" style={{ fontSize: 13, fontWeight: 700, color: INK }}>{l.name}</span>
                        <span style={{ fontSize: 10.5, color: MUTED_CLR, whiteSpace: 'nowrap' }}>{l.phone}</span>
                      </div>
                      <div className="truncate" style={{ fontSize: 11.5, color: MUTED_CLR }}>{l.notes.split('\n')[0] || 'No further details'}</div>
                    </div>
                    <span style={{ fontSize: 10.5, color: MUTED_CLR, whiteSpace: 'nowrap' }}>{new Date(l.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  </Link>
                ))}
                {websiteLeads.items.length > ROWS_PER_PAGE && (
                  <Pagination
                    page={websiteLeadsPage}
                    pages={Math.ceil(websiteLeads.items.length / ROWS_PER_PAGE)}
                    total={websiteLeads.items.length}
                    limit={ROWS_PER_PAGE}
                    onPage={setWebsiteLeadsPage}
                  />
                )}
              </div>
            )}
          </WidgetShell>
        ),
        'lead-funnel': (
          <WidgetShell id="lead-funnel" title="Lead funnel" subtitle={monthFunnel ? `Leads that came in during ${monthFunnel.monthLabel}, by where they are now` : 'This month'} {...dragHandlers}>
            {monthFunnelLoading ? <Skeleton className="h-[200px]" /> : monthFunnelIsError || !monthFunnel ? (
              <div className="flex items-center justify-between gap-3 flex-wrap py-4">
                <span className="text-sm text-muted-foreground">Couldn&rsquo;t load the funnel.</span>
                <Button onClick={() => refetchMonthFunnel()}>Retry</Button>
              </div>
            ) : (() => {
              const f = monthFunnel
              const rows: { stage: MonthFunnelStage; label: string; value: number; color: string }[] = [
                { stage: 'total', label: 'New leads', value: f.total, color: '#5B2BC9' },
                { stage: 'untouched', label: 'Untouched', value: f.untouched, color: '#A78BFA' },
                { stage: 'inProgress', label: 'Being worked', value: f.inProgress, color: '#4C8CE4' },
                { stage: 'quotationSent', label: 'Quotation sent', value: f.quotationSent, color: '#F59E0B' },
                { stage: 'won', label: 'Won', value: f.won, color: '#10b981' },
                { stage: 'lost', label: 'Lost', value: f.lost, color: '#94a3b8' },
              ]
              const max = Math.max(1, f.total)
              return (
                <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 20 }} className="max-[900px]:grid-cols-1">
                  <div style={{ display: 'grid', gap: 9 }}>
                    {rows.map((r) => (
                      <div
                        key={r.label}
                        role="button"
                        tabIndex={0}
                        title={`Show the ${r.value} lead${r.value !== 1 ? 's' : ''}`}
                        onClick={() => setFunnelStage({ stage: r.stage, label: r.label })}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFunnelStage({ stage: r.stage, label: r.label }) } }}
                        className="hover:bg-muted/40 rounded-lg cursor-pointer -mx-2 px-2 py-0.5"
                        style={{ display: 'grid', gridTemplateColumns: '110px 1fr 36px', alignItems: 'center', gap: 10 }}
                      >
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{r.label}</span>
                        <div style={{ height: 10, borderRadius: 999, background: '#F1EFE8' }}>
                          <div style={{ width: `${r.value > 0 ? Math.max(3, (r.value / max) * 100) : 0}%`, height: '100%', borderRadius: 999, background: r.color }} />
                        </div>
                        <span style={{ fontSize: 12.5, color: MUTED_CLR, textAlign: 'right' }}>{r.value}</span>
                      </div>
                    ))}
                    {f.alreadyCustomer > 0 && (
                      <button
                        type="button"
                        onClick={() => setFunnelStage({ stage: 'alreadyCustomer', label: 'Already customers' })}
                        className="hover:underline text-left"
                        style={{ fontSize: 11, color: MUTED_CLR }}
                      >
                        {f.alreadyCustomer} more were already customers.
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
                    <div style={{ background: PURPLE_LIGHT, borderRadius: 18, padding: 18 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED_CLR }}>Win rate this month</div>
                      <div style={{ ...HEADING, fontWeight: 800, fontSize: 32, lineHeight: 1.1, color: INK, marginTop: 6 }}>{f.winRatePct}%</div>
                      <div style={{ fontSize: 11.5, color: '#4A4357', marginTop: 2 }}>{f.won} won of {f.total - f.alreadyCustomer}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFunnelStage({ stage: 'overdue', label: 'Overdue follow-ups' })}
                      className="hover:shadow-md transition-shadow text-left w-full"
                      style={{ background: f.overdueFollowUps > 0 ? '#FFF1F0' : PURPLE_LIGHT, borderRadius: 18, padding: 18, display: 'block', border: f.overdueFollowUps > 0 ? '1px solid #F5C2BE' : '1px solid transparent' }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED_CLR }}>Overdue follow-ups</div>
                      <div style={{ ...HEADING, fontWeight: 800, fontSize: 32, lineHeight: 1.1, color: f.overdueFollowUps > 0 ? '#B91C1C' : INK, marginTop: 6 }}>{f.overdueFollowUps}</div>
                      <div style={{ fontSize: 11.5, color: '#4A4357', marginTop: 2 }}>open leads past their follow-up date &middot; view →</div>
                    </button>
                  </div>
                </div>
              )
            })()}
          </WidgetShell>
        ),
        'website-analytics': (
          <WidgetShell id="website-analytics" title="Website analytics" subtitle="purplebox.ae · From Google Analytics" {...dragHandlers}>
            {websiteAnalyticsLoading ? <Skeleton className="h-[220px]" /> : websiteAnalyticsError ? (
              <p style={{ fontSize: 12.5, color: '#B91C1C', padding: '8px 0' }}>
                Couldn't load Google Analytics: {apiError(websiteAnalyticsError)}
              </p>
            ) : !websiteAnalytics || !websiteAnalytics.configured ? (
              <p style={{ fontSize: 12.5, color: MUTED_CLR, padding: '8px 0' }}>
                Google Analytics isn't connected yet — add a GA4 service account key and property ID on the server to see visits and countries here.
              </p>
            ) : (() => {
              const today = websiteAnalytics.today!
              const byCountry = websiteAnalytics.byCountry || []
              const trend = websiteAnalytics.trend || []
              const topPages = websiteAnalytics.topPages || []
              const maxPage = Math.max(1, ...topPages.map((p) => p.views))
              const maxCountry = Math.max(1, ...byCountry.map((c) => c.sessions))
              const maxTrend = Math.max(1, ...trend.map((t) => t.sessions))
              const points = trend.map((t, i) => {
                const x = trend.length > 1 ? (i / (trend.length - 1)) * 640 : 0
                const y = 130 - (t.sessions / maxTrend) * 120
                return `${x.toFixed(1)},${y.toFixed(1)}`
              }).join(' ')
              return (
                <div style={{ display: 'grid', gap: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 16 }} className="max-[900px]:grid-cols-1">
                    <div style={{ background: '#1A0B33', borderRadius: 18, padding: 20, display: 'flex', flexDirection: 'column', gap: 10, color: '#fff' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A78BFA' }}>Website visits today</div>
                      <div style={{ ...HEADING, fontWeight: 800, fontSize: 40, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{today.sessions}</div>
                      <div style={{ fontSize: 11.5, color: '#D8CCF5' }}>{today.users} users &middot; {today.newVisitorPct}% new visitors</div>
                      {today.vsYesterdayPct !== null && (
                        <span style={{ fontSize: 10.5, background: 'rgba(255,255,255,.12)', color: today.vsYesterdayPct >= 0 ? '#DCFCE7' : '#FED7D7', padding: '3px 9px', borderRadius: 999, fontWeight: 700, alignSelf: 'flex-start' }}>
                          {today.vsYesterdayPct >= 0 ? '▲' : '▼'} {Math.abs(today.vsYesterdayPct)}% vs yesterday
                        </span>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 11.5, color: MUTED_CLR, marginBottom: 10 }}>Visits by country &middot; last {websiteAnalytics.days} days &middot; {websiteAnalytics.totalSessionsInRange} total</div>
                      {byCountry.length === 0 ? (
                        <p style={{ fontSize: 12.5, color: MUTED_CLR }}>No visits recorded in this range yet.</p>
                      ) : (
                        <div style={{ display: 'grid', gap: 8 }}>
                          {byCountry.slice(0, 6).map((c) => (
                            <div key={c.country} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 44px', alignItems: 'center', gap: 10 }}>
                              <span className="truncate" style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{c.country}</span>
                              <div style={{ height: 8, borderRadius: 999, background: '#F1EFE8' }}><div style={{ width: `${Math.max(4, (c.sessions / maxCountry) * 100)}%`, height: '100%', borderRadius: 999, background: '#5B2BC9' }} /></div>
                              <span style={{ fontSize: 11.5, color: MUTED_CLR, textAlign: 'right' }}>{c.sessions}</span>
                            </div>
                          ))}
                          {byCountry.length > 6 && <div style={{ fontSize: 11, color: MUTED_CLR }}>and {byCountry.length - 6} more countries</div>}
                        </div>
                      )}
                    </div>
                  </div>
                  {topPages.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11.5, color: MUTED_CLR, marginBottom: 10 }}>Top pages &middot; last {websiteAnalytics.days} days &middot; page views</div>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {topPages.slice(0, 8).map((p) => (
                          <div key={p.path} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 220px) 1fr 44px', alignItems: 'center', gap: 10 }}>
                            <span className="truncate" title={p.path} style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{p.path}</span>
                            <div style={{ height: 8, borderRadius: 999, background: '#F1EFE8' }}><div style={{ width: `${Math.max(4, (p.views / maxPage) * 100)}%`, height: '100%', borderRadius: 999, background: '#5B2BC9' }} /></div>
                            <span style={{ fontSize: 11.5, color: MUTED_CLR, textAlign: 'right' }}>{p.views}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {trend.length > 1 && (
                    <div>
                      <div style={{ fontSize: 11.5, color: MUTED_CLR, marginBottom: 6 }}>Sessions per day</div>
                      <svg viewBox="0 0 640 140" style={{ width: '100%', height: 120, display: 'block' }}>
                        <polyline points={points} fill="none" stroke="#5B2BC9" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                        <line x1={0} y1={130} x2={640} y2={130} stroke="#F1EFE8" strokeWidth={1} />
                      </svg>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: MUTED_CLR, marginTop: 2 }}>
                        <span>{trend[0].date}</span><span>{trend[trend.length - 1].date}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </WidgetShell>
        ),
        'units-by-size': (
          <WidgetShell id="units-by-size" title="Units by size" subtitle="Available vs occupied per size" {...dragHandlers}>
            {statsLoading ? <Skeleton className="h-[240px]" /> : statsIsError || !stats ? (
              <EmptyState message="Couldn't load this chart." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stats.bySize} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="sizeSqf" tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle} />
                  <Bar dataKey="available" name="Available" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="occupied" name="Occupied" fill="#4C8CE4" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </WidgetShell>
        ),
        'floor-occupancy': (
          <WidgetShell id="floor-occupancy" title="Floor occupancy" subtitle="Available vs occupied by floor" {...dragHandlers}>
            {floorLoading ? <Skeleton className="h-[240px]" /> : floorIsError || !floor ? (
              <div className="flex items-center justify-between gap-3 flex-wrap py-4">
                <span className="text-sm text-muted-foreground">Couldn&rsquo;t load this chart.</span>
                <Button onClick={() => refetchFloor()}>Retry</Button>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={floor.byFloor} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="floor" tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} width={28} />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle} />
                  <Bar dataKey="available" name="Available" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="occupied" name="Occupied" fill="#4C8CE4" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="maintenance" name="Maintenance" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </WidgetShell>
        ),
        'expiring-contracts': (
          <WidgetShell id="expiring-contracts" title="Contracts expiring soon" subtitle="Next 15 days" {...dragHandlers}>
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
                  const renewal = RENEWAL_BADGE[c.renewalIntent || 'undecided'] ?? RENEWAL_BADGE.undecided
                  return (
                    <li key={c._id} className="hover:bg-muted/40">
                      {/* Whole row is the link — two lines so it fits any width */}
                      <Link to={`/contracts/${c._id}`} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <div className="text-sm truncate flex items-center gap-2">
                            <span className="font-medium">{c.customer?.fullName}</span>
                            {c.unit?.unitNumber && <span className="text-muted-foreground"> · {c.unit.unitNumber}</span>}
                            <Badge tone={renewal.tone}>{renewal.label}</Badge>
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
          <WidgetShell id="team-tasks" title="Latest tasks from the team" subtitle="Newest first, across everyone" {...dragHandlers}>
            {tasksLoading ? <Skeleton className="h-[240px]" /> : !teamTasks || teamTasks.length === 0 ? (
              <EmptyState message="No tasks yet." />
            ) : (
              <Table>
                <thead><tr><Th>Task</Th><Th>Assigned to</Th><Th>Due</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {teamTasks.map((t) => {
                    const daysLeft = t.dueDate ? Math.ceil((new Date(t.dueDate).getTime() - Date.now()) / 86400000) : null
                    const late = daysLeft !== null && daysLeft < 0 && t.status !== 'done'
                    return (
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
                            <span className={late ? 'text-destructive font-medium' : ''}>
                              {formatDate(t.dueDate)}{late ? ` · ${Math.abs(daysLeft!)}d late` : ''}
                            </span>
                          ) : '—'}
                        </Td>
                        <Td>
                          <Badge tone={t.status === 'done' ? 'green' : t.status === 'in_progress' ? 'blue' : 'gray'}>
                            {t.status === 'in_progress' ? 'In progress' : t.status === 'done' ? 'Done' : 'To do'}
                          </Badge>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </WidgetShell>
        ),
      })
    },
    [statsLoading, statsIsError, stats, statsError, refetchStats, floorLoading, floorIsError, floor, refetchFloor,
      expiringLoading, expiringIsError, expiringContracts, refetchExpiring, tasksLoading, teamTasks,
      highIntentLoading, highIntent, highIntentPage, websiteLeadsLoading, websiteLeads, websiteLeadsPage,
      websiteAnalyticsLoading, websiteAnalytics, websiteAnalyticsError,
      monthFunnelLoading, monthFunnelIsError, monthFunnel, refetchMonthFunnel,
      onDrop, onDragStart, onDragOver]
  )

  // No page-level loading/error gate any more — each card above already
  // shows its own skeleton or its own retry button from its own query, so
  // the page frame renders immediately and cards fill in independently as
  // their own data arrives, instead of every card waiting on the slowest
  // one (or one failing request taking the whole page down with it).

  return (
    <div style={{ background: '#fff', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-6 sm:p-9">

      <div className="mb-6"><DashboardAsk /></div>

      {isAdmin && Boolean(pendingExpiry?.total) && (
        <Link
          to="/settings/automation?tab=pending"
          className="mb-6 flex items-center gap-3 flex-wrap rounded-2xl border px-5 py-3.5 hover:bg-amber-100/60 transition-colors"
          style={{ background: '#FFF7E6', borderColor: '#F5D896' }}
        >
          <AlertTriangle size={18} style={{ color: '#8A5A00', flexShrink: 0 }} />
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

      <div className="space-y-8">
        {layout.map((id) => {
          if (id === 'stats') {
            return (
              <div key={id} draggable onDragStart={() => onDragStart(id)} onDragOver={onDragOver} onDrop={() => onDrop(id)}>
                <div
                  className="mb-3 flex items-center gap-2"
                  style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}
                >
                  <GripVertical size={13} /> Overview
                </div>
                {widgets[id]}
              </div>
            )
          }

          if (id === 'high-intent-leads' || id === 'website-leads-today') {
            const peerIds: WidgetId[] = ['high-intent-leads', 'website-leads-today']
            const first = peerIds.find((x) => layout.includes(x))
            if (id !== first) return null
            return (
              <div key="leads-grid" className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
                {peerIds.filter((x) => layout.includes(x)).map((x) => (
                  <div key={x}>{widgets[x]}</div>
                ))}
              </div>
            )
          }

          if (id === 'units-by-size' || id === 'floor-occupancy') {
            const peerIds: WidgetId[] = ['units-by-size', 'floor-occupancy']
            const first = peerIds.find((x) => layout.includes(x))
            if (id !== first) return null
            return (
              <div key="charts-grid" className="grid gap-5 lg:grid-cols-2">
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
              <div key="middle-grid" className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
                {peerIds.filter((x) => layout.includes(x)).map((x) => (
                  <div key={x}>{widgets[x]}</div>
                ))}
              </div>
            )
          }

          /* Everything else — its own full-width row, nothing to pair it
             with. This used to be a bare `return null` covering every id
             above, which is exactly how high-intent-leads went missing:
             its entry in `widgets` was real, nothing in this loop ever
             rendered it — the whole layout-order investigation before this
             was chasing a symptom this line actually caused. Falling
             through to render `widgets[id]` here means a future widget
             added to DEFAULT_LAYOUT never needs its own branch wired in
             just to appear. */
          return (
            <div key={id} draggable onDragStart={() => onDragStart(id)} onDragOver={onDragOver} onDrop={() => onDrop(id)}>
              {widgets[id]}
            </div>
          )
        })}
      </div>

      {/* Leads behind a funnel row */}
      <SlideOver
        open={!!funnelStage}
        onClose={() => setFunnelStage(null)}
        title={funnelStage ? `${funnelStage.label}${funnelLeads ? ` · ${funnelLeads.total}` : ''}` : ''}
      >
        {funnelLeadsLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : funnelLeadsIsError || !funnelLeads ? (
          <div className="flex items-center justify-between gap-3 flex-wrap py-4">
            <span className="text-sm text-muted-foreground">Couldn&rsquo;t load these leads.</span>
            <Button onClick={() => refetchFunnelLeads()}>Retry</Button>
          </div>
        ) : funnelLeads.items.length === 0 ? (
          <EmptyState message="No leads here." />
        ) : (
          <div className="space-y-2">
            {funnelStage?.stage === 'overdue' && (
              <Link to="/follow-ups" className="block text-xs font-medium text-primary hover:underline pb-1">Open the Follow-Ups page →</Link>
            )}
            {funnelLeads.items.map((l) => {
              const overdueDays = funnelStage?.stage === 'overdue' && l.followUpAt
                ? Math.max(1, Math.floor((Date.now() - new Date(l.followUpAt).getTime()) / 86400000))
                : null
              return (
                <Link key={l._id} to={`/leads/${l._id}`} className="block rounded-lg border border-border px-3 py-2.5 hover:bg-muted/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{l.name}</span>
                    <Badge tone={l.status === 'won' ? 'green' : l.status === 'lost' ? 'gray' : l.status === 'quotation_sent' ? 'amber' : 'blue'}>{statusLabel(l.status)}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-2">
                    {l.phone && <span>{l.phone}</span>}
                    {l.owner && <span>· {l.owner}</span>}
                    {l.source && <span>· {l.source}</span>}
                    {overdueDays !== null
                      ? <span className="text-destructive font-medium">· follow-up {overdueDays}d overdue</span>
                      : l.at && <span>· {formatDate(l.at)}</span>}
                  </div>
                </Link>
              )
            })}
            {funnelLeads.total > funnelLeads.items.length && (
              <p className="text-xs text-muted-foreground pt-1">Showing the first {funnelLeads.items.length} of {funnelLeads.total}.</p>
            )}
          </div>
        )}
      </SlideOver>

      {/* Detail panel */}
      <SlideOver
        open={!!(movePanel && stats)}
        onClose={() => setMovePanel(null)}
        title={movePanel === 'in' ? 'Move-ins this month' : movePanel === 'out' ? 'Move-outs this month' : sizeFilter ? `Available Units · ${sizeFilter} sq ft` : 'Available Units'}
      >
        {movePanel && stats && (
          <div className="space-y-2">
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
                          <span className="text-sm font-semibold" style={{ color: INK }}>AED {formatMoney(u.monthlyRent)}</span>
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
              ) : list.map((c: any) => {
                const payment = PAYMENT_BADGE[c.paymentStatus] ?? { label: 'No invoice', tone: 'gray' }
                return (
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
                        <Badge tone={payment.tone}>{payment.label}</Badge>
                      </div>
                    </div>
                  </Link>
                )
              })
            })()}
          </div>
        )}
      </SlideOver>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { GripVertical } from 'lucide-react'
import { Box, FileText, TrendingUp } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api, apiError } from '../lib/api'
import type { Summary } from '../lib/types'
import { Card, CardHeader, CardBody, Spinner, PageHeader, EmptyState, Table, Th, Td, Button } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

type WidgetId =
  | 'stats'
  | 'units-by-size'
  | 'floor-occupancy'
  | 'overdue-aging'
  | 'expiring-contracts'
  | 'top-delinquents'
  | 'latest-notes'

const DASHBOARD_LAYOUT_KEY = 'pb_dashboard_layout_v2'

const DEFAULT_LAYOUT: WidgetId[] = [
  'stats',
  'units-by-size',
  'floor-occupancy',
  'overdue-aging',
  'expiring-contracts',
  'top-delinquents',
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
    >
      <Card className="overflow-hidden">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <GripVertical size={14} className="text-muted-foreground" />
              {title}
            </span>
          }
          subtitle={subtitle}
        />
        <CardBody>{children}</CardBody>
      </Card>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, tone }: { icon: typeof Box; label: string; value: string; sub?: string; tone: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}>
          <Icon size={19} />
        </div>
      </div>
    </Card>
  )
}

export default function Dashboard() {
  const [layout, setLayout] = useState<WidgetId[]>(() => safeLoadLayout())
  const [dragged, setDragged] = useState<WidgetId | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery<Summary>({
    queryKey: ['summary'],
    queryFn: () => api.get('/reports/summary').then((r) => r.data),
  })

  type LatestNote = { contractId: string; contractNo: string; customerName: string; at: string; text: string; author: string }
  const { data: latestNotes = [] } = useQuery<LatestNote[]>({
    queryKey: ['latest-notes'],
    queryFn: () => api.get('/contracts/latest-notes?limit=30').then((r) => r.data),
  })

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

  const delinquentMap = new Map<string, {
    customerId: string; customerName: string; count: number; total: number; oldestDue: number
  }>()
  for (const p of data?.overduePayments ?? []) {
    const pid = p.contract?.customer?._id || p.contract?._id || 'unknown'
    const dueTs = new Date(p.dueDate).getTime()
    const hit = delinquentMap.get(pid)
    if (hit) { hit.count += 1; hit.total += p.amount || 0; hit.oldestDue = Math.min(hit.oldestDue, dueTs); continue }
    delinquentMap.set(pid, {
      customerId: p.contract?.customer?._id || '',
      customerName: p.contract?.customer?.fullName || 'Unknown customer',
      count: 1, total: p.amount || 0, oldestDue: dueTs,
    })
  }
  const topDelinquents = [...delinquentMap.values()]
    .sort((a, b) => b.total - a.total || b.count - a.count)
    .slice(0, 5)

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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-8">
            <StatCard icon={TrendingUp} label="Occupancy" value={`${data.occupancyPct}%`} sub={`${data.byStatus.occupied + data.byStatus.reserved} of ${totalUnits} units`} tone="bg-[#111218]/10 text-[#111218] dark:text-[#8AAF82]" />
            <StatCard icon={Box} label="Available units" value={String(data.byStatus.available)} sub="Ready to rent" tone="bg-[#4C8CE4]/15 text-[#4C8CE4] dark:text-[#8AAF82]" />
            <StatCard icon={Box} label="Reserved units" value={String(data.byStatus.reserved)} sub="Booked, not occupied" tone="bg-[#FFF799]/15 text-[#111218] dark:text-[#FFF799]" />
            <StatCard icon={Box} label="Maintenance" value={String(data.byStatus.maintenance)} sub="Unavailable stock" tone="bg-slate-500/15 text-slate-600 dark:text-slate-400" />
            <StatCard icon={FileText} label="Active contracts" value={String(data.activeContracts)} sub={`${data.expiringContracts.length} expiring in 15 days`} tone="bg-blue-500/15 text-blue-600 dark:text-blue-400" />
            <StatCard icon={TrendingUp} label="Revenue this month" value={formatMoney(data.revenueThisMonth)} sub={`${formatMoney(data.expectedThisMonth)} expected`} tone="bg-[#FFF799]/20 text-[#111218] dark:text-[#FFF799]" />
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
                {data.expiringContracts.map((c) => {
                  const daysLeft = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000)
                  const endFmt = new Date(c.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
                  const urgency = daysLeft <= 3 ? 'text-destructive' : daysLeft <= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                  return (
                    <li key={c._id} className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40">
                      <div className="min-w-0">
                        <span className="font-medium text-sm">{c.customer?.fullName}</span>
                        <span className="text-muted-foreground text-sm"> — {c.unit?.unitNumber} — </span>
                        <span className={`text-sm ${urgency}`}>expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''} ({endFmt})</span>
                      </div>
                      <Link to={`/contracts/${c._id}`} className="shrink-0 text-xs font-medium text-primary hover:underline whitespace-nowrap">View Contract</Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </WidgetShell>
        ),
        'top-delinquents': (
          <WidgetShell
            id="top-delinquents"
            title="Top delinquent customers"
            subtitle="Highest current overdue balances"
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
          >
            {topDelinquents.length === 0 ? (
              <EmptyState message="No customers with overdue balances." />
            ) : (
              <Table>
                <thead><tr><Th>Customer</Th><Th>Overdue items</Th><Th>Oldest due</Th><Th>Total overdue</Th></tr></thead>
                <tbody>
                  {topDelinquents.map((c) => (
                    <tr key={c.customerId || c.customerName} className="hover:bg-muted/50">
                      <Td>
                        {c.customerId ? (
                          <Link className="text-primary font-medium hover:underline" to={`/customers/${c.customerId}`}>{c.customerName}</Link>
                        ) : (
                          c.customerName
                        )}
                      </Td>
                      <Td>{c.count}</Td>
                      <Td>{formatDate(new Date(c.oldestDue).toISOString())}</Td>
                      <Td className="font-medium text-destructive">{formatMoney(c.total)}</Td>
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
    [data, latestNotes, overdueAging, onDrop, topDelinquents, totalUnits]
  )

  // Early returns come AFTER all hooks so hook call order is always stable
  if (isLoading) return <Spinner />
  if (isError || !data) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Facility overview at a glance" />
        <Card>
          <CardHeader title="Unable to load dashboard" subtitle={apiError(error)} />
          <CardBody className="flex flex-wrap items-center gap-3">
            <Button onClick={() => refetch()}>Retry</Button>
            <span className="text-xs text-muted-foreground">If this keeps happening, verify the backend API and login session.</span>
          </CardBody>
          <EmptyState message="Dashboard data is temporarily unavailable." />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Facility overview at a glance (drag cards to reorder)" />

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

          if (id === 'expiring-contracts' || id === 'top-delinquents') {
            const peerIds: WidgetId[] = ['expiring-contracts', 'top-delinquents']
            const first = peerIds.find((x) => layout.includes(x))
            if (id !== first) return null
            return (
              <div key="middle-grid" className="grid gap-4 lg:grid-cols-2">
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
    </div>
  )
}

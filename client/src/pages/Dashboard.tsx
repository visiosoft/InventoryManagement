import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { GripVertical, X } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api, apiError } from '../lib/api'
import type { Summary } from '../lib/types'
import { Spinner, EmptyState, Table, Th, Td, Button } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED_CLR = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_LIGHT = '#F7F3FF'

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
  const [layout, setLayout] = useState<WidgetId[]>(() => safeLoadLayout())
  const [dragged, setDragged] = useState<WidgetId | null>(null)
  const [movePanel, setMovePanel] = useState<'in' | 'out' | 'available' | null>(null)
  const [sizeFilter, setSizeFilter] = useState<number | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery<Summary>({
    queryKey: ['summary'],
    queryFn: () => api.get('/reports/summary').then((r) => r.data),
  })

  type LatestNote = { contractId: string; contractNo: string; customerName: string; at: string; text: string; author: string }
  const { data: latestNotes = [] } = useQuery<LatestNote[]>({
    queryKey: ['latest-notes'],
    queryFn: () => api.get('/contracts/latest-notes?limit=30').then((r) => r.data),
  })

  const { data: draftInvoicesPage } = useQuery<{ total: number }>({
    queryKey: ['invoices-draft-count'],
    queryFn: () => api.get('/invoices', { params: { status: 'draft', limit: 1 } }).then((r) => r.data),
  })
  const draftInvoices = draftInvoicesPage?.total ?? 0

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
          <div className="space-y-[18px]">
            <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr_1fr] gap-[18px]">
              {/* Occupancy - dark card */}
              <div style={{ padding: 24, borderRadius: 22, background: '#1A0B33', color: '#FFF', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 8px 24px rgba(20,8,31,.10)' }}>
                <div className="flex items-center justify-between">
                  <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A78BFA' }}>Occupancy</div>
                </div>
                <div className="flex items-end gap-3 flex-wrap">
                  <div style={{ ...HEADING, fontWeight: 700, fontSize: 56, lineHeight: 0.9, letterSpacing: '-0.04em' }} className="sm:!text-[76px]">{data.occupancyPct}%</div>
                  <div style={{ fontSize: 13, color: '#DDD0FF', paddingBottom: 10 }}>{data.byStatus.occupied + data.byStatus.reserved} of {data.byStatus.available + data.byStatus.occupied + data.byStatus.reserved}<br/>rentable units</div>
                </div>
                <div className="flex flex-col gap-[10px]">
                  <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,.14)', overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${data.occupancyPct}%`, background: 'linear-gradient(90deg, #7C4DFF, #A78BFA)' }} />
                  </div>
                  <div className="flex justify-between" style={{ fontSize: 12, color: 'rgba(221,208,255,.75)' }}>
                    <span>{data.byStatus.occupied + data.byStatus.reserved} occupied</span>
                    <span>{data.byStatus.available} available</span>
                  </div>
                </div>
              </div>

              {/* Available units */}
              <div onClick={() => { setSizeFilter(null); setMovePanel('available') }} style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 1px 2px rgba(20,8,31,.05)', cursor: 'pointer' }} className="hover:shadow-md transition-shadow">
                <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>Available units</div>
                <div style={{ ...HEADING, fontWeight: 700, fontSize: 56, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{data.byStatus.available}</div>
                <div style={{ fontSize: 13, color: '#4A4357' }}>Ready to rent</div>
                <div className="flex flex-wrap gap-[6px] mt-auto" onClick={e => e.stopPropagation()}>
                  {data.bySize.filter(s => s.available > 0).map(s => (
                    <button key={s.sizeSqf} onClick={() => { setSizeFilter(parseInt(s.sizeSqf)); setMovePanel('available') }} style={{ fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8, background: PURPLE_LIGHT, color: '#4A1FA0', cursor: 'pointer', border: 'none' }} className="hover:opacity-80 transition-opacity">{s.available} × {s.sizeSqf}</button>
                  ))}
                </div>
              </div>

              {/* Active contracts */}
              <div style={{ padding: 24, borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 1px 2px rgba(20,8,31,.05)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>Active contracts</div>
                <div style={{ ...HEADING, fontWeight: 700, fontSize: 56, lineHeight: 0.9, letterSpacing: '-0.03em' }}>{data.activeContracts}</div>
                <div style={{ fontSize: 13, color: '#4A4357' }}>{data.expiringContracts.length} expiring in 15 days</div>
              </div>
            </div>

            {/* Move-in / Move-out */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-[18px]">
              {(['in', 'out'] as const).map(type => {
                const val = type === 'in' ? data.moveInsThisMonth : data.moveOutsThisMonth
                const last = type === 'in' ? data.moveInsLastMonth : data.moveOutsLastMonth
                const diff = val - last
                const diffColor = diff < 0 ? '#B3261E' : '#1B7A4B'
                return (
                  <div key={type} onClick={() => setMovePanel(type)} style={{ padding: '22px 24px', borderRadius: 22, background: '#FFF', border: '1px solid rgba(20,8,31,0.10)', cursor: 'pointer' }} className="hover:shadow-md transition-shadow">
                    <div className="flex flex-col gap-2">
                      <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED_CLR }}>{type === 'in' ? 'Move-ins this month' : 'Move-outs this month'}</div>
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <div style={{ ...HEADING, fontWeight: 700, fontSize: 36, lineHeight: 0.9, letterSpacing: '-0.03em' }} className="sm:!text-[48px]">{val}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: diffColor }}>{diff > 0 ? '+' : ''}{diff} vs {last} last month</div>
                      </div>
                    </div>
                  </div>
                )
              })}
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

      {draftInvoices > 0 && (
        <Link
          to="/invoices?status=draft"
          className="mb-5 flex items-center gap-[18px] transition-colors hover:brightness-95"
          style={{ padding: '16px 20px', borderRadius: 18, background: '#F6F0E4', border: '1px solid #EDE3CF' }}
        >
          <div style={{ flex: 'none', width: 38, height: 38, borderRadius: 11, background: '#FFF', border: '1px solid #EDE3CF', display: 'grid', placeItems: 'center', ...HEADING, fontWeight: 700, fontSize: 16, color: '#4A1FA0' }}>{draftInvoices}</div>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 15, fontWeight: 600, color: INK }}>{draftInvoices} draft invoice{draftInvoices !== 1 ? 's' : ''} awaiting send</div>
          </div>
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', height: 40, padding: '0 20px', borderRadius: 999, background: PURPLE, color: '#FFF', fontSize: 14, fontWeight: 600 }}>Review & send</div>
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


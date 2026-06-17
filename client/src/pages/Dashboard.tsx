import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Box, FileText, TrendingUp, AlertTriangle, Wallet } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { api } from '../lib/api'
import type { Summary } from '../lib/types'
import { Card, CardHeader, CardBody, Badge, Spinner, PageHeader, EmptyState, Table, Th, Td } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

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
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ['summary'],
    queryFn: () => api.get('/reports/summary').then((r) => r.data),
  })

  if (isLoading || !data) return <Spinner />

  const collectionRate = data.expectedThisMonth > 0
    ? Math.round((data.revenueThisMonth / data.expectedThisMonth) * 100)
    : 0
  const revenueGap = Math.max(0, data.expectedThisMonth - data.revenueThisMonth)

  const now = Date.now()
  const overdueAging = [
    { bucket: '1-7d', count: 0, amount: 0 },
    { bucket: '8-30d', count: 0, amount: 0 },
    { bucket: '30+d', count: 0, amount: 0 },
  ]
  for (const p of data.overduePayments) {
    const days = Math.max(1, Math.floor((now - new Date(p.dueDate).getTime()) / 86400000))
    if (days <= 7) {
      overdueAging[0].count += 1
      overdueAging[0].amount += p.amount || 0
    } else if (days <= 30) {
      overdueAging[1].count += 1
      overdueAging[1].amount += p.amount || 0
    } else {
      overdueAging[2].count += 1
      overdueAging[2].amount += p.amount || 0
    }
  }

  const delinquentMap = new Map<string, {
    customerId: string
    customerName: string
    count: number
    total: number
    oldestDue: number
  }>()
  for (const p of data.overduePayments) {
    const id = p.contract?.customer?._id || p.contract?._id || 'unknown'
    const dueTs = new Date(p.dueDate).getTime()
    const hit = delinquentMap.get(id)
    if (hit) {
      hit.count += 1
      hit.total += p.amount || 0
      hit.oldestDue = Math.min(hit.oldestDue, dueTs)
      continue
    }
    delinquentMap.set(id, {
      customerId: p.contract?.customer?._id || '',
      customerName: p.contract?.customer?.fullName || 'Unknown customer',
      count: 1,
      total: p.amount || 0,
      oldestDue: dueTs,
    })
  }
  const topDelinquents = [...delinquentMap.values()]
    .sort((a, b) => b.total - a.total || b.count - a.count)
    .slice(0, 5)

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Facility overview at a glance" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard icon={TrendingUp} label="Occupancy" value={`${data.occupancyPct}%`} sub={`${data.byStatus.occupied + data.byStatus.reserved} of ${data.byStatus.available + data.byStatus.occupied + data.byStatus.reserved} rentable units`} tone="bg-violet-500/15 text-violet-600 dark:text-violet-400" />
        <StatCard icon={Box} label="Available units" value={String(data.byStatus.available)} sub={`${data.byStatus.maintenance} under construction`} tone="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" />
        <StatCard icon={FileText} label="Active contracts" value={String(data.activeContracts)} sub={`${data.expiringContracts.length} expiring in 15 days`} tone="bg-blue-500/15 text-blue-600 dark:text-blue-400" />
        <StatCard icon={TrendingUp} label="Revenue this month" value={formatMoney(data.revenueThisMonth)} sub={`${formatMoney(data.expectedThisMonth)} expected`} tone="bg-amber-500/15 text-amber-600 dark:text-amber-400" />
        <StatCard icon={Wallet} label="Collection rate" value={`${collectionRate}%`} sub={`Gap: ${formatMoney(revenueGap)}`} tone="bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" />
        <StatCard icon={AlertTriangle} label="Revenue gap" value={formatMoney(revenueGap)} sub="Expected minus collected" tone="bg-rose-500/15 text-rose-600 dark:text-rose-400" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Units by size" subtitle="Available vs occupied per size" />
          <CardBody>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.bySize} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="sizeSqf" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="available" name="Available" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="occupied" name="Occupied" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Floor occupancy" subtitle="Available vs occupied by floor" />
          <CardBody>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.byFloor} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="floor" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="available" name="Available" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="occupied" name="Occupied" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="maintenance" name="Maintenance" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Overdue aging" subtitle="How old current overdues are" />
          <CardBody>
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
          </CardBody>
        </Card>

      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">

        <Card>
          <CardHeader title="Contracts expiring soon" subtitle="Next 15 days" />
          {data.expiringContracts.length === 0 ? (
            <EmptyState message="No contracts expiring in the next 15 days." />
          ) : (
            <ul className="divide-y divide-border">
              {data.expiringContracts.map((c) => {
                const daysLeft = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000)
                const endFmt = new Date(c.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
                const urgency = daysLeft <= 3 ? 'text-destructive' : daysLeft <= 7 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                return (
                  <li key={c._id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
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
        </Card>

        <Card>
          <CardHeader title="Top delinquent customers" subtitle="Highest current overdue balances" />
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
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          title={<span className="flex items-center gap-2"><AlertTriangle size={14} className="text-destructive" /> Overdue payments</span>}
          subtitle="Pending payments past their due date"
        />
        {data.overduePayments.length === 0 ? (
          <EmptyState message="No overdue payments. 🎉" />
        ) : (
          <Table>
            <thead><tr><Th>Customer</Th><Th>Contract</Th><Th>Unit</Th><Th>Due date</Th><Th>Amount</Th><Th /></tr></thead>
            <tbody>
              {data.overduePayments.map((p) => (
                <tr key={p._id} className="hover:bg-muted/50">
                  <Td>{p.contract?.customer?.fullName}</Td>
                  <Td><Link className="text-primary font-medium hover:underline" to={`/contracts/${p.contract?._id}`}>{p.contract?.contractNo}</Link></Td>
                  <Td>{p.contract?.unit?.unitNumber}</Td>
                  <Td>{formatDate(p.dueDate)}</Td>
                  <Td className="font-medium">{formatMoney(p.amount)}</Td>
                  <Td><Badge tone="red">Overdue</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}

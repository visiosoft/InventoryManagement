import { useQuery } from '@tanstack/react-query'
import { Building2, Download, TrendingUp, Wallet } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { api } from '../../lib/api'
import { Button, Card, CardBody, CardHeader, PageHeader, Spinner, Table, Td, Th } from '../../components/ui'
import { formatMoney } from '../../lib/utils'
import { CHART_STYLE, downloadCsv, StatCard, type UnitRevenueData } from './shared'

export default function UnitsReport() {
  const { data, isLoading } = useQuery<UnitRevenueData>({
    queryKey: ['unit-revenue'],
    queryFn: () => api.get('/reports/unit-revenue').then(r => r.data),
  })

  return (
    <div>
      <PageHeader title="Unit Revenue" subtitle="Occupancy, earnings per unit size, and empty unit analysis" />

      {isLoading ? <Spinner /> : data && (
        <div className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Monthly Run Rate" value={`AED ${formatMoney(data.currentMonthlyIncome)}`}
              sub="from active contracts" tone="green" icon={TrendingUp} />
            <StatCard label="Full Capacity" value={`AED ${formatMoney(data.totalMonthlyCapacity)}`}
              sub="if all units occupied" icon={Building2} />
            <StatCard label="Empty Units" value={String(data.emptyUnits.length)}
              sub="available for new tenants"
              tone={data.emptyUnits.length > 0 ? 'amber' : 'green'} icon={Building2} />
            <StatCard label="Revenue to Date" value={`AED ${formatMoney(data.totalRevenueEver)}`}
              sub="all-time collected" icon={Wallet} />
          </div>

          {/* By size */}
          <Card>
            <CardHeader
              title="Revenue by unit size"
              subtitle="Occupancy and earnings grouped by sq footage"
              action={
                <Button size="sm" variant="outline" onClick={() =>
                  downloadCsv('unit-size-revenue.csv', [
                    ['Size (sqf)', 'Total Units', 'Occupied', 'Available', 'Monthly Capacity (AED)', 'Revenue to Date (AED)', 'Occupancy %'],
                    ...data.bySizeGroup.map(g => [
                      g.sizeSqf ?? 'Unknown', g.unitCount, g.occupiedCount,
                      g.availableCount, g.monthlyCapacity, g.totalRevenue,
                      g.unitCount ? Math.round(g.occupiedCount / g.unitCount * 100) : 0,
                    ]),
                  ])}>
                  <Download size={13} /> CSV
                </Button>
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th>Size</Th><Th>Units</Th><Th>Occupied</Th><Th>Available</Th>
                  <Th>Monthly Capacity</Th><Th>Revenue to Date</Th><Th>Occupancy</Th>
                </tr>
              </thead>
              <tbody>
                {data.bySizeGroup.map((g) => {
                  const pct = g.unitCount ? Math.round(g.occupiedCount / g.unitCount * 100) : 0
                  return (
                    <tr key={g.sizeSqf ?? 'unknown'} className="hover:bg-muted/50">
                      <Td className="font-medium">{g.sizeSqf ? `${g.sizeSqf} sqf` : 'Unknown'}</Td>
                      <Td>{g.unitCount}</Td>
                      <Td className="text-emerald-700 dark:text-emerald-400 font-medium">{g.occupiedCount}</Td>
                      <Td className={g.availableCount > 0 ? 'text-amber-700 dark:text-amber-400 font-medium' : 'text-muted-foreground'}>
                        {g.availableCount}
                      </Td>
                      <Td>AED {formatMoney(g.monthlyCapacity)}</Td>
                      <Td className="font-semibold">AED {formatMoney(g.totalRevenue)}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{pct}%</span>
                        </div>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>

            <CardBody>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.bySizeGroup.map(g => ({
                  name: g.sizeSqf ? `${g.sizeSqf} sqf` : 'Unknown',
                  Occupied: g.occupiedCount,
                  Available: g.availableCount,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} />
                  <YAxis tick={CHART_STYLE.axisStyle} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={CHART_STYLE.contentStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Occupied" stackId="a" fill="#8b5cf6" />
                  <Bar dataKey="Available" stackId="a" fill="#ddd6fe" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          {/* Per-unit detail */}
          <Card>
            <CardHeader
              title="Per-unit detail"
              subtitle="Revenue and status for every unit"
              action={
                <Button size="sm" variant="outline" onClick={() =>
                  downloadCsv('per-unit-revenue.csv', [
                    ['Unit', 'Floor', 'Size (sqf)', 'Status', 'Monthly Rate (AED)', 'Revenue to Date (AED)', 'Payments'],
                    ...data.unitRows.map(u => [
                      u.unitNumber, u.floor, u.sizeSqf ?? '', u.status,
                      u.monthlyRate, u.totalRevenue, u.paymentCount,
                    ]),
                  ])}>
                  <Download size={13} /> CSV
                </Button>
              }
            />
            <Table>
              <thead>
                <tr>
                  <Th>Unit</Th><Th>Floor</Th><Th>Size</Th><Th>Status</Th>
                  <Th>Monthly Rate</Th><Th>Revenue to Date</Th><Th>Payments</Th>
                </tr>
              </thead>
              <tbody>
                {data.unitRows.map((u) => (
                  <tr key={String(u._id)} className="hover:bg-muted/50">
                    <Td className="font-medium">{u.unitNumber}</Td>
                    <Td className="text-muted-foreground">{u.floor || '—'}</Td>
                    <Td className="text-muted-foreground">{u.sizeSqf ? `${u.sizeSqf} sqf` : '—'}</Td>
                    <Td>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold
                        ${u.isOccupied
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : u.status === 'maintenance'
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                        {u.isOccupied ? 'Occupied' : u.status}
                      </span>
                    </Td>
                    <Td>AED {formatMoney(u.monthlyRate)}</Td>
                    <Td className={`font-semibold ${u.totalRevenue > 0 ? '' : 'text-muted-foreground'}`}>
                      {u.totalRevenue > 0 ? `AED ${formatMoney(u.totalRevenue)}` : '—'}
                    </Td>
                    <Td className="text-muted-foreground">{u.paymentCount || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {/* Empty units */}
          {data.emptyUnits.length > 0 && (
            <Card>
              <CardHeader
                title={`Empty units (${data.emptyUnits.length})`}
                subtitle="Not occupied — lost potential revenue highlighted"
              />
              <CardBody>
                <div className="mb-3 text-sm text-muted-foreground">
                  Potential monthly revenue if filled:{' '}
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    AED {formatMoney(data.emptyUnits.reduce((s, u) => s + u.listPrice, 0))}
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
                  {data.emptyUnits.map((u) => (
                    <div key={String(u._id)}
                      className="rounded-lg border border-amber-400/40 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2.5 text-center">
                      <div className="text-sm font-bold text-amber-700 dark:text-amber-400">{u.unitNumber}</div>
                      <div className="text-xs text-muted-foreground">{u.sizeSqf ?? '—'} sqf · {u.floor || '—'}</div>
                      {u.listPrice > 0 && (
                        <div className="text-xs font-medium mt-0.5">AED {formatMoney(u.listPrice)}/mo</div>
                      )}
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

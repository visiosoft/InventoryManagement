import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { Card, CardBody, CardHeader, PageHeader, Spinner } from '../../../components/ui'

interface RevenueRow {
  _id: { year: number; month: number }
  revenue: number
  count: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function MovingRevenueReport() {
  const { data: rows = [], isLoading } = useQuery<RevenueRow[]>({
    queryKey: ['moving-report-revenue'],
    queryFn: () => api.get('/moving-reports/revenue').then(r => r.data),
  })

  const maxRevenue = Math.max(...rows.map(r => r.revenue), 1)
  const total = rows.reduce((s, r) => s + r.revenue, 0)

  return (
    <div className="space-y-8">
      <PageHeader title="Revenue Report" subtitle={`Total paid invoices: AED ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} />

      <Card>
        <CardHeader title="Monthly Revenue" />
        <CardBody>
          {isLoading ? <Spinner /> : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No revenue data yet</p>
          ) : (
            <div className="space-y-3">
              {rows.map(r => {
                const pct = (r.revenue / maxRevenue) * 100
                const label = `${MONTHS[r._id.month - 1]} ${r._id.year}`
                return (
                  <div key={label} className="flex items-center gap-3 text-sm">
                    <div className="w-20 text-muted-foreground shrink-0">{label}</div>
                    <div className="flex-1 bg-muted rounded-full h-5 relative">
                      <div
                        className="bg-primary h-5 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="w-32 text-right font-medium">AED {r.revenue.toLocaleString(undefined, { minimumFractionDigits: 0 })}</div>
                    <div className="w-16 text-right text-muted-foreground">{r.count} inv.</div>
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

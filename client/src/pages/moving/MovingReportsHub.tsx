import { Link } from 'react-router-dom'
import {
  Wallet, TrendingUp, PieChart as PieChartIcon, Filter,
  Users2, Truck, ReceiptText, ShieldAlert,
} from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { PageHeader } from '../../components/ui'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'

const REPORTS = [
  { to: '/moving/reports/ar', label: 'Accounts Receivable', desc: 'Who owes what, and how overdue', icon: Wallet, perm: 'reports_moving_ar', color: '#EF4444' },
  { to: '/moving/reports/revenue', label: 'Revenue', desc: 'Monthly revenue trend', icon: TrendingUp, perm: 'reports_moving_revenue', color: '#3B82F6' },
  { to: '/moving/reports/profitability', label: 'Profitability', desc: 'Revenue vs cost, per job and per month', icon: PieChartIcon, perm: 'reports_moving_profitability', color: '#10B981' },
  { to: '/moving/reports/costs', label: 'Cost Breakdown', desc: 'Labor, truck, materials, external hires', icon: Filter, perm: 'reports_moving_costs', color: '#F59E0B' },
  { to: '/moving/reports/pipeline', label: 'Sales Pipeline', desc: 'Lead funnel, win rate, quote conversion', icon: TrendingUp, perm: 'reports_moving_pipeline', color: '#8B5CF6' },
  { to: '/moving/reports/crew', label: 'Crew', desc: 'Worker utilisation and earnings', icon: Users2, perm: 'reports_moving_crew', color: '#06B6D4' },
  { to: '/moving/reports/fleet', label: 'Fleet', desc: 'Truck utilisation', icon: Truck, perm: 'reports_moving_fleet', color: '#F97316' },
  { to: '/moving/reports/payroll', label: 'Payroll', desc: 'Crew pay for a date range', icon: ReceiptText, perm: 'reports_moving_payroll', color: '#6366F1' },
  { to: '/moving/reports/claims', label: 'Damage Claims', desc: 'Claimed vs approved vs settled', icon: ShieldAlert, perm: 'moving_dashboard', color: '#EC4899' },
]

export default function MovingReportsHub() {
  const { hasPermission } = useAuth()
  const visible = REPORTS.filter(r => hasPermission(r.perm))

  return (
    <div className="space-y-6">
      <PageHeader title="Moving Reports" subtitle="Accounts, revenue, costs, crew and fleet — one place to see how the business is doing" />

      {visible.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">No reports available for your account.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(r => (
            <Link key={r.to} to={r.to}
              style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 20 }}
              className="hover:shadow-sm hover:-translate-y-0.5 transition-all">
              <div style={{ width: 40, height: 40, borderRadius: 12, background: `${r.color}1A`, display: 'grid', placeItems: 'center', color: r.color, marginBottom: 12 }}>
                <r.icon size={20} />
              </div>
              <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK }}>{r.label}</div>
              <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>{r.desc}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

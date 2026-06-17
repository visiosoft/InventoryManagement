import type { ReactElement } from 'react'

// ── Shared chart/style constants ──────────────────────────────────────────────

export const CHART_STYLE = {
  contentStyle: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 },
  axisStyle: { fontSize: 11, fill: 'var(--muted-foreground)' },
}
export const PIE_COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#f97316', '#6366f1', '#ec4899']

// ── CSV download ──────────────────────────────────────────────────────────────

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href)
}

// ── Stat card ─────────────────────────────────────────────────────────────────

type Tone = 'green' | 'red' | 'amber' | 'default'

export function StatCard({ label, value, sub, tone = 'default', icon: Icon }: {
  label: string; value: string; sub?: string; tone?: Tone; icon?: React.ElementType
}) {
  const bg: Record<Tone, string> = {
    green:   'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
    red:     'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800',
    amber:   'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800',
    default: 'bg-card border-border',
  }
  const fg: Record<Tone, string> = {
    green:   'text-emerald-700 dark:text-emerald-400',
    red:     'text-red-700 dark:text-red-400',
    amber:   'text-amber-700 dark:text-amber-400',
    default: 'text-foreground',
  }
  return (
    <div className={`rounded-xl border p-4 ${bg[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
          <div className={`text-2xl font-bold ${fg[tone]}`}>{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
        </div>
        {Icon && <Icon size={20} className={`${fg[tone]} opacity-60 shrink-0 mt-0.5`} />}
      </div>
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TenantPayment {
  _id: string; amount: number; dueDate: string; paidDate?: string; status: string; method: string
}
export interface TenantRow {
  contractId: string; contractNo: string
  customer: { fullName: string; phone: string; email: string }
  unit: { unitNumber: string; sizeSqf: number; floor: string }
  payments: TenantPayment[]
  total: number; paidAmt: number; status: 'paid' | 'overdue' | 'pending'
  latestPaidDate: string | null; methods: string[]
}
export interface TenantPaymentsData {
  month: string; monthISO: string
  paid: TenantRow[]; pending: TenantRow[]
  totalPaid: number; totalPending: number
  countPaid: number; countPending: number
}
export interface SizeGroup {
  sizeSqf: number | null; unitCount: number; occupiedCount: number
  availableCount: number; totalRevenue: number; monthlyCapacity: number
}
export interface UnitRow {
  _id: string; unitNumber: string; floor: string; sizeSqf: number | null
  status: string; monthlyRate: number; listPrice: number
  totalRevenue: number; paymentCount: number; isOccupied: boolean
}
export interface UnitRevenueData {
  bySizeGroup: SizeGroup[]; unitRows: UnitRow[]; emptyUnits: UnitRow[]
  totalRevenueEver: number; totalMonthlyCapacity: number; currentMonthlyIncome: number
}
export interface ExpenseMonthly { month: string; monthIndex: number; total: number; count: number }
export interface ExpenseCat { category: string; total: number; count: number }
export interface ExpenseRecent { _id: string; date: string; description: string; category: string; vendor: string; total: number; status: string }
export interface ExpensesData {
  year: number; monthly: ExpenseMonthly[]; byCategory: ExpenseCat[]
  recent: ExpenseRecent[]; totalExpenses: number
}
export interface ForecastContract { _id: string; contractNo: string; customer: string; unit: string; monthlyRate: number; endDate: string }
export interface ForecastMonth {
  month: string; monthISO: string; isPast: boolean; isCurrent: boolean
  expected: number; actual: number | null; contractCount: number
  contracts: ForecastContract[]
}
export interface ForecastData {
  forecast: ForecastMonth[]; overdueBalance: number
  activeContracts: number; monthlyRunRate: number
}
export interface RevenueMonth { month: string; total: number; payments: number }

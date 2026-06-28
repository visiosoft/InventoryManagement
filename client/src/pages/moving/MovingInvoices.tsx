import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Search, Receipt, ArrowRight, AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingInvoice, MovingInvoiceStatus } from '../../lib/types'
import { Badge, Card, CardBody, Input, PageHeader, Spinner, Table, Td, Th } from '../../components/ui'
import { formatDate } from '../../lib/utils'
import { cn } from '../../lib/utils'

const STATUSES: { value: MovingInvoiceStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
]

const statusTone: Record<MovingInvoiceStatus, string> = {
  draft: 'gray', sent: 'blue', partial: 'yellow', paid: 'green', cancelled: 'red',
}

const statusDot: Record<string, string> = {
  draft: 'bg-slate-400', sent: 'bg-blue-400', partial: 'bg-amber-400',
  paid: 'bg-emerald-400', cancelled: 'bg-red-400',
}

function fmtAed(n: number) {
  return `AED ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtAedShort(n: number) {
  if (n >= 1_000_000) return `AED ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `AED ${(n / 1_000).toFixed(1)}K`
  return fmtAed(n)
}

export default function MovingInvoices() {
  const [filterStatus, setFilterStatus] = useState<MovingInvoiceStatus | ''>('')
  const [search, setSearch] = useState('')

  const { data: allInvoices = [], isLoading } = useQuery<MovingInvoice[]>({
    queryKey: ['moving-invoices'],
    queryFn: () => api.get('/moving-invoices').then(r => r.data),
  })

  // Summary stats always from the unfiltered list
  const now = new Date()
  const outstanding = allInvoices
    .filter(inv => !['paid', 'cancelled'].includes(inv.status))
    .reduce((s, inv) => s + (inv.balanceDue ?? 0), 0)
  const paidThisMonth = allInvoices
    .filter(inv => {
      if (inv.status !== 'paid' && inv.status !== 'partial') return false
      if (!inv.invoiceDate) return false
      const d = new Date(inv.invoiceDate)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
    .reduce((s, inv) => s + inv.total - (inv.balanceDue ?? 0), 0)
  const totalRevenue = allInvoices
    .filter(inv => inv.status === 'paid')
    .reduce((s, inv) => s + inv.total, 0)

  const counts = STATUSES.slice(1).reduce((acc, s) => {
    acc[s.value as string] = allInvoices.filter(inv => inv.status === s.value).length
    return acc
  }, {} as Record<string, number>)

  // Client-side filter
  const filtered = allInvoices.filter(inv => {
    const matchStatus = !filterStatus || inv.status === filterStatus
    const matchSearch = !search ||
      inv.invoiceNo.toLowerCase().includes(search.toLowerCase()) ||
      inv.customer?.fullName?.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  return (
    <div className="space-y-5">
      <PageHeader title="Moving Invoices" subtitle={`${allInvoices.length} invoices total`} />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardBody className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10 shrink-0">
              <AlertCircle size={18} className="text-red-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Outstanding</p>
              <p className="text-lg font-bold text-foreground truncate">{fmtAedShort(outstanding)}</p>
              <p className="text-xs text-muted-foreground">
                {allInvoices.filter(inv => !['paid', 'cancelled'].includes(inv.status)).length} unpaid invoices
              </p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
              <Clock size={18} className="text-amber-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Collected This Month</p>
              <p className="text-lg font-bold text-foreground truncate">{fmtAedShort(paidThisMonth)}</p>
              <p className="text-xs text-muted-foreground">
                {now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </p>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 shrink-0">
              <CheckCircle2 size={18} className="text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-0.5">Total Revenue</p>
              <p className="text-lg font-bold text-foreground truncate">{fmtAedShort(totalRevenue)}</p>
              <p className="text-xs text-muted-foreground">
                {allInvoices.filter(inv => inv.status === 'paid').length} fully paid
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterStatus('')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
            filterStatus === ''
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card text-muted-foreground border-muted hover:border-muted-foreground hover:text-foreground'
          )}
        >
          All <span className={cn('tabular-nums', filterStatus === '' ? 'opacity-70' : 'text-muted-foreground')}>{allInvoices.length}</span>
        </button>
        {STATUSES.slice(1).map(s => {
          const active = filterStatus === s.value
          return (
            <button
              key={s.value}
              onClick={() => setFilterStatus(s.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-muted hover:border-muted-foreground hover:text-foreground'
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDot[s.value as string])} />
              {s.label}
              <span className={cn('tabular-nums', active ? 'opacity-70' : 'text-muted-foreground')}>
                {counts[s.value as string] ?? 0}
              </span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by invoice number or customer…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody className="py-14 text-center">
            <Receipt size={32} className="mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="text-sm font-medium text-foreground mb-1">No invoices found</p>
            <p className="text-sm text-muted-foreground">
              {search ? 'Try a different search term' : 'No invoices match the selected filter'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map(inv => (
              <Link key={inv._id} to={`/moving/invoices/${inv._id}`}
                className="flex items-start gap-3 p-4 bg-card rounded-xl border hover:border-muted-foreground transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono font-bold text-primary">{inv.invoiceNo}</span>
                    <Badge tone={statusTone[inv.status]} className="text-xs py-0 h-4">{inv.status}</Badge>
                  </div>
                  <p className="text-sm font-semibold text-foreground mb-1">{inv.customer?.fullName}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{formatDate(inv.invoiceDate)}</p>
                    <div className="text-right">
                      <p className="text-sm font-bold text-foreground">AED {inv.total.toLocaleString()}</p>
                      {inv.balanceDue > 0 && (
                        <p className="text-xs text-red-600 font-medium">Due: AED {inv.balanceDue.toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                </div>
                <ArrowRight size={14} className="text-muted-foreground shrink-0 mt-0.5" />
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <Card className="hidden md:block">
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr className="border-b border-muted">
                      <Th className="py-3 pl-4">Invoice No</Th>
                      <Th className="py-3">Customer</Th>
                      <Th className="py-3">Job</Th>
                      <Th className="py-3">Date</Th>
                      <Th className="py-3 text-right">Total</Th>
                      <Th className="py-3 text-right">Balance Due</Th>
                      <Th className="py-3">Status</Th>
                      <Th className="py-3 pr-4" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(inv => (
                      <tr key={inv._id} className="hover:bg-muted/40 transition-colors border-b border-muted/50 last:border-0">
                        <Td className="py-3 pl-4">
                          <Link to={`/moving/invoices/${inv._id}`} className="font-mono font-bold text-primary hover:text-primary/80 text-sm">
                            {inv.invoiceNo}
                          </Link>
                        </Td>
                        <Td className="py-3 font-medium text-sm">{inv.customer?.fullName}</Td>
                        <Td className="py-3 text-sm">
                          {inv.job
                            ? <Link to={`/moving/jobs/${inv.job._id}`} className="text-primary hover:underline font-mono">{inv.job.jobNo}</Link>
                            : <span className="text-muted-foreground">—</span>}
                        </Td>
                        <Td className="py-3 text-sm text-muted-foreground whitespace-nowrap">{formatDate(inv.invoiceDate)}</Td>
                        <Td className="py-3 text-right">
                          <span className="text-sm font-semibold tabular-nums">{fmtAed(inv.total)}</span>
                        </Td>
                        <Td className="py-3 text-right">
                          <span className={cn('text-sm font-semibold tabular-nums', inv.balanceDue > 0 ? 'text-red-600' : 'text-emerald-600')}>
                            {fmtAed(inv.balanceDue)}
                          </span>
                        </Td>
                        <Td className="py-3">
                          <Badge tone={statusTone[inv.status]} className="text-xs">{inv.status}</Badge>
                        </Td>
                        <Td className="py-3 pr-4 text-right">
                          <Link to={`/moving/invoices/${inv._id}`} className="text-muted-foreground hover:text-foreground transition-colors">
                            <ArrowRight size={14} />
                          </Link>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </CardBody>
          </Card>

          <p className="text-xs text-muted-foreground text-right">{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</p>
        </>
      )}
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, ClipboardList, FileSignature, Loader2, ReceiptText, Wallet } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, CardHeader, Spinner } from '../components/ui'
import { formatMoney, formatDate } from '../lib/utils'
import { StatCard } from './reports/shared'

/**
 * The invoicing day, on one page.
 *
 * The company dashboard answers a manager's questions — occupancy, revenue,
 * how the month is going. Accounts have a different day: what have I been
 * asked to raise, which contracts have been signed and still need an invoice,
 * and who owes us money. Those three lived on three different screens, two of
 * which this role could not open.
 */

type Task = {
  _id: string; taskNo?: string; title: string; status: string
  priority?: string; dueDate?: string; createdAt?: string
  leadId?: string; leadType?: string; leadName?: string
}
type Awaiting = {
  _id: string; contractNo: string; status: string; customerName: string
  units: string; total: number; createdAt?: string; startDate?: string
}
type Data = {
  tasks: { open: number; overdue: number; list: Task[] }
  contracts: {
    awaitingInvoice: Awaiting[]
    activeCount: number
    endingThisMonth: { _id: string; contractNo: string; customerName: string; endDate?: string }[]
  }
}
type Zoho = {
  configured: boolean; reason?: string; error?: string
  total?: number; unmatched?: number; customersOwing?: number
  top?: { _id: string; name: string; amount: number }[]
}

const PURPLE = '#5B2BC9'
const MUTED = 'rgba(20,8,31,.55)'

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_signature: 'Awaiting signature',
}

export default function AccountsDashboard() {
  const { user } = useAuth()

  const { data, isLoading } = useQuery<Data>({
    queryKey: ['accounts-dashboard'],
    queryFn: () => api.get('/accounts-dashboard').then((r) => r.data),
  })

  /* Its own request. Zoho's contact list is a paged remote call and took 8.4
     of the 8.5 seconds this page spent loading; everything else is a handful
     of indexed reads. The page is up straight away and this fills in behind. */
  const { data: zoho, isLoading: zohoLoading } = useQuery<Zoho>({
    queryKey: ['accounts-dashboard', 'zoho'],
    queryFn: () => api.get('/accounts-dashboard/zoho').then((r) => r.data),
    staleTime: 5 * 60_000,
  })

  const firstName = (user?.name ?? '').split(' ')[0]

  return (
    <div>
      <PageHeader
        title={firstName ? `Good day, ${firstName}` : 'Accounts'}
        subtitle="What you have been asked to raise, what is waiting to be invoiced, and who owes us"
      />

      {isLoading || !data ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Tasks for you" value={String(data.tasks.open)} sub="still open" icon={ClipboardList} />
            <StatCard
              label="Overdue"
              value={String(data.tasks.overdue)}
              sub="past their due date"
              tone={data.tasks.overdue > 0 ? 'red' : 'default'}
              icon={AlertTriangle}
            />
            <StatCard label="Awaiting an invoice" value={String(data.contracts.awaitingInvoice.length)} sub="signed or drafted" tone="amber" icon={FileSignature} />
            <StatCard
              label="Outstanding in Zoho"
              value={zoho?.total != null ? `AED ${formatMoney(zoho.total)}` : zohoLoading ? '…' : '—'}
              sub={zoho?.customersOwing != null ? `across ${zoho.customersOwing} customers` : 'not available'}
              icon={Wallet}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* What you were asked to do */}
            <Card>
              <CardHeader title="Assigned to you" subtitle="Newest first" />
              <div className="divide-y" style={{ borderColor: 'rgba(20,8,31,.08)' }}>
                {data.tasks.list.map((t) => {
                  const overdue = t.dueDate && new Date(t.dueDate) < new Date()
                  return (
                    <div key={t._id} className="px-4 py-3 flex items-start gap-3">
                      <ReceiptText size={15} style={{ color: '#B45309', marginTop: 2 }} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {t.taskNo && (
                            <span className="rounded-full px-2 py-0.5" style={{ background: '#F3EDFF', color: PURPLE, fontSize: 11, fontWeight: 700 }}>
                              {t.taskNo}
                            </span>
                          )}
                          <span style={{ fontWeight: 600, fontSize: 13.5 }} className="truncate">{t.title}</span>
                        </div>
                        <div style={{ fontSize: 12, color: overdue ? '#B91C1C' : MUTED, marginTop: 2 }}>
                          {t.leadName ? `${t.leadName} · ` : ''}
                          {t.dueDate ? `due ${formatDate(t.dueDate)}` : 'no due date'}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {!data.tasks.list.length && (
                  <p className="px-4 py-6 text-center" style={{ fontSize: 13, color: MUTED }}>Nothing assigned to you.</p>
                )}
              </div>
              {data.tasks.open > data.tasks.list.length && (
                <div className="px-4 py-3">
                  <Link to="/tasks" style={{ color: PURPLE, fontSize: 13, fontWeight: 700 }}>
                    All {data.tasks.open} tasks
                  </Link>
                </div>
              )}
            </Card>

            {/* What is waiting on an invoice */}
            <Card>
              <CardHeader title="Waiting to be invoiced" subtitle="Contracts not yet active" />
              <div className="divide-y" style={{ borderColor: 'rgba(20,8,31,.08)' }}>
                {data.contracts.awaitingInvoice.map((c) => (
                  <Link
                    key={c._id}
                    to={`/contracts/${c._id}`}
                    className="px-4 py-3 flex items-center gap-3 hover:bg-[#FBF8F3]"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{c.contractNo}</span>
                        <span className="rounded-full px-2 py-0.5" style={{ background: '#FFF7E6', color: '#B45309', fontSize: 11, fontWeight: 700 }}>
                          {STATUS_LABEL[c.status] ?? c.status}
                        </span>
                      </div>
                      <div className="truncate" style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>
                        {c.customerName}{c.units ? ` · unit ${c.units}` : ''}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      AED {formatMoney(c.total)}
                    </div>
                  </Link>
                ))}
                {!data.contracts.awaitingInvoice.length && (
                  <p className="px-4 py-6 text-center" style={{ fontSize: 13, color: MUTED }}>Everything signed has been invoiced.</p>
                )}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Zoho */}
            <Card>
              <CardHeader title="Owed to us, in Zoho Books" subtitle="Largest balances first" />
              {zohoLoading ? (
                <p className="px-4 py-6 flex items-center justify-center gap-2" style={{ fontSize: 13, color: MUTED }}>
                  <Loader2 size={14} className="animate-spin" /> Asking Zoho…
                </p>
              ) : !zoho?.configured ? (
                <p className="px-4 py-6 text-center" style={{ fontSize: 13, color: MUTED }}>{zoho?.reason ?? 'Zoho Books is not connected.'}</p>
              ) : zoho.error ? (
                <p className="px-4 py-6 text-center" style={{ fontSize: 13, color: '#B91C1C' }}>Zoho did not answer: {zoho.error}</p>
              ) : (
                <>
                  <div className="divide-y" style={{ borderColor: 'rgba(20,8,31,.08)' }}>
                    {(zoho.top ?? []).map((o) => (
                      <Link
                        key={o._id}
                        to={`/customers/${o._id}`}
                        className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-[#FBF8F3]"
                        style={{ textDecoration: 'none', color: 'inherit' }}
                      >
                        <span className="truncate" style={{ fontSize: 13 }}>{o.name}</span>
                        <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                          AED {formatMoney(o.amount)}
                        </span>
                      </Link>
                    ))}
                    {!(zoho.top ?? []).length && (
                      <p className="px-4 py-6 text-center" style={{ fontSize: 13, color: MUTED }}>Nobody owes anything.</p>
                    )}
                  </div>
                  {!!zoho.unmatched && (
                    // Named rather than folded into the total, which would make
                    // the figure disagree with the list under it.
                    <p className="px-4 py-3" style={{ fontSize: 11.5, color: MUTED }}>
                      A further AED {formatMoney(zoho.unmatched)} is owed by Zoho contacts with no tenant record here.
                    </p>
                  )}
                </>
              )}
            </Card>

            {/* Ending this month */}
            <Card>
              <CardHeader
                title="Ending this month"
                subtitle={`${data.contracts.activeCount} contracts active in total`}
              />
              <div className="divide-y" style={{ borderColor: 'rgba(20,8,31,.08)' }}>
                {data.contracts.endingThisMonth.map((c) => (
                  <Link
                    key={c._id}
                    to={`/contracts/${c._id}`}
                    className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-[#FBF8F3]"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <span className="truncate" style={{ fontSize: 13 }}>
                      <span style={{ fontWeight: 700 }}>{c.contractNo}</span> · {c.customerName}
                    </span>
                    <span style={{ fontSize: 12.5, color: MUTED, whiteSpace: 'nowrap' }}>
                      {c.endDate ? formatDate(c.endDate) : '—'}
                    </span>
                  </Link>
                ))}
                {!data.contracts.endingThisMonth.length && (
                  <p className="px-4 py-6 text-center" style={{ fontSize: 13, color: MUTED }}>Nothing ends this month.</p>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

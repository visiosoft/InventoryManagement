import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Mail, Phone, Tag } from 'lucide-react'
import { apiError, vendorApi, purchaseApi, expenseApi, type VendorSummary } from '../lib/api'
import type { Purchase, Expense, PurchasePaymentEntry, PurchaseStatus } from '../lib/types'
import {
    Badge, Button, Card, CardBody, CardHeader, CornerRibbon,
    EmptyState, Field, Input, Modal, Select, Spinner,
    Table, Td, Th, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

// Status tone maps
const purchaseStatusTone: Record<PurchaseStatus, string> = {
    draft: 'gray', sent: 'blue', received: 'green', partial: 'amber', cancelled: 'red',
}

// ---- SVG Bar Chart ----
function MonthlyChart({ data }: { data: { month: string; bills: number; paid: number }[] }) {
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const maxVal = Math.max(...data.flatMap((d) => [d.bills, d.paid]), 1)
    const H = 90
    const COL_W = 52
    const BAR_W = 16
    const TOTAL_W = data.length * COL_W + 10

    return (
        <svg viewBox={`0 0 ${TOTAL_W} ${H + 28}`} className="w-full" preserveAspectRatio="xMidYMid meet">
            {data.map((d, i) => {
                const cx = 10 + i * COL_W + COL_W / 2
                const bH = maxVal > 0 ? Math.max((d.bills / maxVal) * H, d.bills > 0 ? 2 : 0) : 0
                const pH = maxVal > 0 ? Math.max((d.paid / maxVal) * H, d.paid > 0 ? 2 : 0) : 0
                const label = MONTH_NAMES[parseInt(d.month.slice(5)) - 1]
                return (
                    <g key={d.month}>
                        <rect x={cx - BAR_W - 1} y={H - bH} width={BAR_W} height={bH} fill="var(--color-border, #E5E7EB)" rx={2} />
                        <rect x={cx + 1} y={H - pH} width={BAR_W} height={pH} fill="#059669" rx={2} />
                        <text x={cx} y={H + 16} textAnchor="middle" fontSize={9} fill="#9CA3AF">{label}</text>
                    </g>
                )
            })}
            {/* legend */}
            <rect x={10} y={H + 22} width={8} height={5} fill="var(--color-border, #E5E7EB)" rx={1} />
            <text x={22} y={H + 27} fontSize={8} fill="#9CA3AF">Bills</text>
            <rect x={52} y={H + 22} width={8} height={5} fill="#059669" rx={1} />
            <text x={64} y={H + 27} fontSize={8} fill="#9CA3AF">Paid</text>
        </svg>
    )
}

// ---- KPI Card ----
function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
    return (
        <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className={`text-xl font-bold mt-1 ${color || ''}`}>{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
        </div>
    )
}

// ---- Record Payment Modal Content ----
function RecordPaymentModal({ purchaseId, onClose }: { purchaseId: string; onClose: () => void }) {
    const qc = useQueryClient()
    const [amount, setAmount] = useState('')
    const [method, setMethod] = useState('cash')
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
    const [notes, setNotes] = useState('')
    const [err, setErr] = useState('')

    const { data: purchase } = useQuery<Purchase>({
        queryKey: ['purchase', purchaseId],
        queryFn: () => purchaseApi.get(purchaseId),
    })

    const paid = purchase?.paymentMade ?? 0
    const total = purchase?.total ?? 0
    const balance = Math.max(0, total - paid)
    const history: PurchasePaymentEntry[] = purchase?.paymentHistory ?? []

    const record = useMutation({
        mutationFn: (body: { amount: number; method: string; date: string; notes?: string }) =>
            purchaseApi.recordPayment(purchaseId, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['purchase', purchaseId] })
            qc.invalidateQueries({ queryKey: ['purchases'] })
            qc.invalidateQueries({ queryKey: ['vendor-summary'] })
            setAmount(''); setNotes(''); setErr('')
        },
        onError: (e) => setErr(apiError(e)),
    })

    const deletePmt = useMutation({
        mutationFn: (idx: number) => purchaseApi.deletePayment(purchaseId, idx),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['purchase', purchaseId] })
            qc.invalidateQueries({ queryKey: ['purchases'] })
            qc.invalidateQueries({ queryKey: ['vendor-summary'] })
        },
        onError: (e) => setErr(apiError(e)),
    })

    function submit(e: FormEvent) {
        e.preventDefault()
        const n = Number(amount)
        if (!n || n <= 0) { setErr('Enter a valid amount'); return }
        record.mutate({ amount: n, method, date, notes: notes || undefined })
    }

    if (!purchase) return <Spinner />

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                <div><div className="text-xs text-muted-foreground">Bill total</div><div className="font-semibold">{formatMoney(total)}</div></div>
                <div><div className="text-xs text-muted-foreground">Amount paid</div><div className="font-semibold text-emerald-600">{formatMoney(paid)}</div></div>
                <div><div className="text-xs text-muted-foreground">Balance due</div><div className={`font-semibold ${balance > 0 ? 'text-destructive' : 'text-emerald-600'}`}>{formatMoney(balance)}</div></div>
            </div>

            {history.length > 0 && (
                <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-2">Payment history</div>
                    <div className="space-y-1.5">
                        {history.map((p, idx) => (
                            <div key={idx} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                                <div className="flex flex-wrap gap-3">
                                    <span className="font-medium">{formatMoney(p.amount)}</span>
                                    <span className="text-muted-foreground capitalize">{p.method.replace('_', ' ')}</span>
                                    <span className="text-muted-foreground">{formatDate(p.date)}</span>
                                    {p.notes && <span className="text-muted-foreground">{p.notes}</span>}
                                </div>
                                <button className="text-xs text-destructive hover:underline cursor-pointer" onClick={() => { if (confirm('Remove this payment?')) deletePmt.mutate(idx) }}>Remove</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {balance > 0 ? (
                <form onSubmit={submit} className="space-y-3">
                    <div className="text-xs font-semibold text-muted-foreground">Record new payment</div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Amount (AED)"><Input type="number" min={0.01} step="0.01" placeholder={String(balance)} value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
                        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Method">
                            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                                <option value="cash">Cash</option>
                                <option value="bank_transfer">Bank transfer</option>
                                <option value="card">Card</option>
                                <option value="cheque">Cheque</option>
                                <option value="other">Other</option>
                            </Select>
                        </Field>
                        <Field label="Notes (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference / memo" /></Field>
                    </div>
                    {err && <p className="text-xs text-destructive">{err}</p>}
                    <div className="flex gap-2 justify-end">
                        <Button type="button" variant="outline" onClick={onClose}>Done</Button>
                        <Button type="submit" variant="success" disabled={record.isPending}>{record.isPending ? 'Recording…' : 'Record payment'}</Button>
                    </div>
                </form>
            ) : (
                <div className="text-center py-3">
                    <p className="text-sm text-emerald-600 font-medium">Bill fully paid</p>
                    <Button variant="outline" className="mt-3" onClick={onClose}>Close</Button>
                </div>
            )}
        </div>
    )
}

// ---- Bills Tab ----
function BillsTab({ vendorId }: { vendorId: string }) {
    const [payingId, setPayingId] = useState<string | null>(null)

    const { data: purchases, isLoading } = useQuery<Purchase[]>({
        queryKey: ['purchases', '', '', vendorId],
        queryFn: () => purchaseApi.list({ vendor: vendorId }),
    })

    if (isLoading) return <Spinner />

    const now = new Date()
    const bills = purchases ?? []

    return (
        <>
            {bills.length === 0 ? (
                <EmptyState message="No bills for this vendor." />
            ) : (
                <Table>
                    <thead>
                        <tr>
                            <Th>Bill #</Th>
                            <Th>Date</Th>
                            <Th>Due Date</Th>
                            <Th>Total</Th>
                            <Th>Paid</Th>
                            <Th>Balance</Th>
                            <Th>Status</Th>
                            <Th />
                        </tr>
                    </thead>
                    <tbody>
                        {bills.map((p) => {
                            const paid = p.paymentMade ?? 0
                            const balance = Math.max(0, p.total - paid)
                            const isOverdue = !['received', 'cancelled'].includes(p.status) && p.dueDate && new Date(p.dueDate) < now && balance > 0
                            return (
                                <tr key={p._id} className="hover:bg-muted/50">
                                    <Td className="font-medium relative overflow-hidden">
                                        {isOverdue && <CornerRibbon label="Overdue" color="amber" size="sm" />}
                                        {p.status === 'received' && <CornerRibbon label="Paid" color="green" size="sm" />}
                                        {p.purchaseNo}
                                    </Td>
                                    <Td>{formatDate(p.purchaseDate)}</Td>
                                    <Td className={isOverdue ? 'text-destructive font-medium' : ''}>{formatDate(p.dueDate)}</Td>
                                    <Td>{formatMoney(p.total)}</Td>
                                    <Td className="text-emerald-600">{formatMoney(paid)}</Td>
                                    <Td className={balance > 0 ? 'text-destructive font-medium' : 'text-emerald-600'}>{formatMoney(balance)}</Td>
                                    <Td><Badge tone={purchaseStatusTone[p.status]}>{statusLabel(p.status)}</Badge></Td>
                                    <Td>
                                        {(!['received', 'cancelled'].includes(p.status) || balance > 0) ? (
                                            <Button size="sm" variant="success" onClick={() => setPayingId(p._id)}>Pay</Button>
                                        ) : null}
                                    </Td>
                                </tr>
                            )
                        })}
                    </tbody>
                </Table>
            )}

            <Modal open={!!payingId} onClose={() => setPayingId(null)} title="Record Payment" wide>
                {payingId && <RecordPaymentModal purchaseId={payingId} onClose={() => setPayingId(null)} />}
            </Modal>
        </>
    )
}

// ---- Expenses Tab ----
function ExpensesTab({ vendorId }: { vendorId: string }) {
    const { data: expenses, isLoading } = useQuery<Expense[]>({
        queryKey: ['expenses', '', '', vendorId],
        queryFn: () => expenseApi.list({ vendor: vendorId }),
    })

    if (isLoading) return <Spinner />

    const expenseStatusTone: Record<string, string> = {
        recorded: 'gray', approved: 'blue', paid: 'green', reimbursed: 'green', cancelled: 'red',
    }

    return (expenses ?? []).length === 0 ? (
        <EmptyState message="No expenses for this vendor." />
    ) : (
        <Table>
            <thead>
                <tr>
                    <Th>Date</Th>
                    <Th>Account</Th>
                    <Th>Description</Th>
                    <Th>Paid Through</Th>
                    <Th>Amount</Th>
                    <Th>Status</Th>
                </tr>
            </thead>
            <tbody>
                {(expenses ?? []).map((e) => (
                    <tr key={e._id} className="hover:bg-muted/50">
                        <Td>{formatDate(e.expenseDate)}</Td>
                        <Td className="font-medium">{e.expenseAccount || '—'}</Td>
                        <Td className="text-muted-foreground max-w-48 truncate">{e.description || '—'}</Td>
                        <Td className="text-muted-foreground">{e.paidThrough || '—'}</Td>
                        <Td className="font-medium">{formatMoney(e.total)}</Td>
                        <Td><Badge tone={expenseStatusTone[e.status] ?? 'gray'}>{statusLabel(e.status)}</Badge></Td>
                    </tr>
                ))}
            </tbody>
        </Table>
    )
}

// ---- Payments Tab ----
function PaymentsTab({ vendorId }: { vendorId: string }) {
    const { data: purchases, isLoading } = useQuery<Purchase[]>({
        queryKey: ['purchases', '', '', vendorId],
        queryFn: () => purchaseApi.list({ vendor: vendorId }),
    })

    if (isLoading) return <Spinner />

    const allPayments = (purchases ?? []).flatMap((p) =>
        (p.paymentHistory ?? []).map((h) => ({
            ...h,
            billNo: p.purchaseNo,
            billId: p._id,
        }))
    ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return allPayments.length === 0 ? (
        <EmptyState message="No payments recorded yet." />
    ) : (
        <Table>
            <thead>
                <tr>
                    <Th>Date</Th>
                    <Th>Bill #</Th>
                    <Th>Amount (AED)</Th>
                    <Th>Method</Th>
                    <Th>Notes</Th>
                </tr>
            </thead>
            <tbody>
                {allPayments.map((p, idx) => (
                    <tr key={idx} className="hover:bg-muted/50">
                        <Td>{formatDate(p.date)}</Td>
                        <Td className="font-medium">{p.billNo}</Td>
                        <Td className="font-medium text-emerald-600">{formatMoney(p.amount)}</Td>
                        <Td className="capitalize">{p.method.replace('_', ' ')}</Td>
                        <Td className="text-muted-foreground">{p.notes || '—'}</Td>
                    </tr>
                ))}
            </tbody>
        </Table>
    )
}

// ---- Main Page ----
type Tab = 'bills' | 'expenses' | 'payments'

export default function VendorDetail() {
    const { id } = useParams<{ id: string }>()
    const [tab, setTab] = useState<Tab>('bills')

    const { data: vendor, isLoading: vendorLoading } = useQuery({
        queryKey: ['vendor', id],
        queryFn: () => vendorApi.get(id!),
        enabled: !!id,
    })

    const { data: summary, isLoading: summaryLoading } = useQuery<VendorSummary>({
        queryKey: ['vendor-summary', id],
        queryFn: () => vendorApi.summary(id!),
        enabled: !!id,
    })

    if (vendorLoading) return <div className="flex justify-center pt-20"><Spinner /></div>
    if (!vendor) return <div className="p-6 text-sm text-muted-foreground">Vendor not found.</div>

    const stats = summary?.stats
    const monthlyData = summary?.monthlyData ?? []

    const TABS: { key: Tab; label: string; count?: number }[] = [
        { key: 'bills', label: 'Bills', count: stats?.billCount },
        { key: 'expenses', label: 'Expenses', count: stats?.expenseCount },
        { key: 'payments', label: 'Payments' },
    ]

    return (
        <div>
            {/* Back */}
            <Link to="/vendors" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
                <ArrowLeft size={13} /> Back to Vendors
            </Link>

            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold">{vendor.contactName}</h1>
                        <Badge tone={vendor.status === 'active' ? 'green' : 'gray'}>{vendor.status}</Badge>
                    </div>
                    {vendor.companyName && <p className="text-sm text-muted-foreground mt-0.5">{vendor.companyName}</p>}
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                        {vendor.email && <span className="flex items-center gap-1"><Mail size={12} />{vendor.email}</span>}
                        {(vendor.phone || vendor.mobilePhone) && <span className="flex items-center gap-1"><Phone size={12} />{vendor.phone || vendor.mobilePhone}</span>}
                        {(vendor.categories || []).length > 0 && (
                            <span className="flex items-center gap-1"><Tag size={12} />{vendor.categories!.join(', ')}</span>
                        )}
                    </div>
                </div>
                {vendor.paymentTermsLabel && (
                    <div className="text-right text-xs">
                        <div className="text-muted-foreground">Payment Terms</div>
                        <div className="font-medium">{vendor.paymentTermsLabel}</div>
                    </div>
                )}
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <KpiCard label="Total Bills" value={`AED ${formatMoney(stats?.totalBills ?? 0)}`} sub={`${stats?.billCount ?? 0} bills`} />
                <KpiCard label="Amount Paid" value={`AED ${formatMoney(stats?.totalPaid ?? 0)}`} color="text-emerald-600" />
                <KpiCard label="Outstanding" value={`AED ${formatMoney(stats?.outstanding ?? 0)}`} color={(stats?.outstanding ?? 0) > 0 ? 'text-destructive' : ''} />
                <KpiCard label="Overdue Bills" value={String(stats?.overdueBills ?? 0)} sub={`AED ${formatMoney(stats?.totalExpenses ?? 0)} expenses`} color={(stats?.overdueBills ?? 0) > 0 ? 'text-destructive' : ''} />
            </div>

            {/* Chart */}
            {monthlyData.length > 0 && (
                <Card className="mb-4">
                    <CardHeader title="Monthly Spending (last 6 months)" subtitle="Gray = billed · Green = paid" />
                    <CardBody>
                        {summaryLoading ? <Spinner /> : <MonthlyChart data={monthlyData} />}
                    </CardBody>
                </Card>
            )}

            {/* Tabs */}
            <Card>
                <div className="flex border-b">
                    {TABS.map(({ key, label, count }) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            className={`px-5 py-3 text-sm font-medium transition-colors cursor-pointer ${
                                tab === key
                                    ? 'border-b-2 border-primary text-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {label}
                            {count !== undefined && (
                                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">{count}</span>
                            )}
                        </button>
                    ))}
                </div>
                <div className="p-0">
                    {tab === 'bills' && id && <BillsTab vendorId={id} />}
                    {tab === 'expenses' && id && <ExpensesTab vendorId={id} />}
                    {tab === 'payments' && id && <PaymentsTab vendorId={id} />}
                </div>
            </Card>
        </div>
    )
}

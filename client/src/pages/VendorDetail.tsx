import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
    ArrowLeft, Building2, ChevronDown, DollarSign,
    FileText, Globe, Mail, Phone, Receipt, Trash2,
} from 'lucide-react'
import { apiError, vendorApi, purchaseApi, expenseApi, type VendorSummary } from '../lib/api'
import type { Purchase, Expense, PurchasePaymentEntry, PurchaseStatus, Vendor, VendorAddress } from '../lib/types'
import {
    Badge, Button, CornerRibbon,
    EmptyState, Field, Input, Modal, Select, Spinner,
    Table, Td, Th, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const purchaseStatusTone: Record<PurchaseStatus, string> = {
    draft: 'gray', sent: 'blue', received: 'green', partial: 'amber', cancelled: 'red',
}

const expenseStatusTone: Record<string, string> = {
    recorded: 'gray', approved: 'blue', paid: 'green', reimbursed: 'green', cancelled: 'red',
}

// ---- ACCORDION SECTION ----
function AccordionSection({
    title,
    children,
    defaultOpen = true,
}: {
    title: string
    children: React.ReactNode
    defaultOpen?: boolean
}) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <div className="border-b border-border last:border-b-0">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest hover:bg-muted/40 transition-colors cursor-pointer"
            >
                {title}
                <ChevronDown
                    size={12}
                    className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
                />
            </button>
            {open && <div className="px-4 pb-3 text-sm">{children}</div>}
        </div>
    )
}

// ---- LEFT SIDEBAR ----
function hasAddressContent(addr?: VendorAddress) {
    return addr && (addr.address || addr.city || addr.country || addr.state)
}

function renderAddress(addr: VendorAddress) {
    const parts = [addr.attention, addr.address, addr.street2, addr.city, addr.state, addr.country, addr.code].filter(Boolean)
    if (parts.length === 0) return <span className="text-xs text-muted-foreground">—</span>
    return <p className="text-sm leading-relaxed text-foreground">{parts.join(', ')}</p>
}

function LeftSidebar({ vendor }: { vendor: Vendor }) {
    return (
        <div className="rounded-xl border bg-card overflow-hidden self-start">
            {/* Primary contact */}
            <div className="px-4 py-3 border-b border-border">
                {vendor.email || vendor.phone || vendor.mobilePhone || vendor.website ? (
                    <div className="space-y-1.5">
                        {vendor.email && (
                            <div className="flex items-center gap-2 text-sm">
                                <Mail size={13} className="text-muted-foreground shrink-0" />
                                <a href={`mailto:${vendor.email}`} className="text-primary hover:underline truncate">{vendor.email}</a>
                            </div>
                        )}
                        {vendor.phone && (
                            <div className="flex items-center gap-2 text-sm">
                                <Phone size={13} className="text-muted-foreground shrink-0" />
                                <span>{vendor.phone}</span>
                            </div>
                        )}
                        {vendor.mobilePhone && vendor.mobilePhone !== vendor.phone && (
                            <div className="flex items-center gap-2 text-sm">
                                <Phone size={13} className="text-muted-foreground shrink-0" />
                                <span>{vendor.mobilePhone} <span className="text-muted-foreground">(mobile)</span></span>
                            </div>
                        )}
                        {vendor.website && (
                            <div className="flex items-center gap-2 text-sm">
                                <Globe size={13} className="text-muted-foreground shrink-0" />
                                <a href={vendor.website} target="_blank" rel="noreferrer" className="text-primary hover:underline truncate">{vendor.website}</a>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground italic">No primary contact information.</p>
                )}
            </div>

            {/* ADDRESS */}
            <AccordionSection title="Address">
                <div className="space-y-3">
                    <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Billing Address</p>
                        {hasAddressContent(vendor.billingAddress)
                            ? renderAddress(vendor.billingAddress!)
                            : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                    <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Shipping Address</p>
                        {hasAddressContent(vendor.shippingAddress)
                            ? renderAddress(vendor.shippingAddress!)
                            : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                </div>
            </AccordionSection>

            {/* OTHER DETAILS */}
            <AccordionSection title="Other Details">
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Default Currency</span>
                        <span className="text-sm font-medium">{vendor.currencyCode || 'AED'}</span>
                    </div>
                    {vendor.paymentTermsLabel && (
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Payment Terms</span>
                            <span className="text-sm font-medium">{vendor.paymentTermsLabel}</span>
                        </div>
                    )}
                    {!!vendor.openingBalance && (
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Opening Balance</span>
                            <span className="text-sm font-medium">{formatMoney(vendor.openingBalance)}</span>
                        </div>
                    )}
                </div>
            </AccordionSection>

            {/* CONTACT PERSONS */}
            <AccordionSection title="Contact Persons" defaultOpen={false}>
                {vendor.email || vendor.phone ? (
                    <div className="rounded-lg border border-border p-3 space-y-0.5">
                        <p className="font-medium text-sm">{vendor.displayName || vendor.contactName}</p>
                        {vendor.email && <p className="text-xs text-muted-foreground">{vendor.email}</p>}
                        {vendor.phone && <p className="text-xs text-muted-foreground">{vendor.phone}</p>}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">No contact persons found.</p>
                )}
            </AccordionSection>

            {/* ASSOCIATE TAGS */}
            <AccordionSection title="Associate Tags" defaultOpen={false}>
                {(vendor.categories || []).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {vendor.categories!.map((cat) => (
                            <span key={cat} className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
                                {cat}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">No tags assigned.</p>
                )}
            </AccordionSection>

            {/* RECORD INFO */}
            <AccordionSection title="Record Info" defaultOpen={false}>
                <div className="space-y-2">
                    {vendor.createdAt && (
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Created</span>
                            <span className="text-xs">{formatDate(vendor.createdAt)}</span>
                        </div>
                    )}
                    {vendor.ownerName && (
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Owner</span>
                            <span className="text-xs">{vendor.ownerName}</span>
                        </div>
                    )}
                    {vendor.source && (
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Source</span>
                            <span className="text-xs capitalize">{vendor.source}</span>
                        </div>
                    )}
                    {vendor.notes && (
                        <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Notes</p>
                            <p className="text-xs">{vendor.notes}</p>
                        </div>
                    )}
                </div>
            </AccordionSection>
        </div>
    )
}

// ---- SVG BAR CHART ----
function MonthlyChart({ data }: { data: { month: string; bills: number; paid: number }[] }) {
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
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
                        <rect x={cx - BAR_W - 1} y={H - bH} width={BAR_W} height={bH} fill="var(--color-border,#E5E7EB)" rx={2} />
                        <rect x={cx + 1} y={H - pH} width={BAR_W} height={pH} fill="#059669" rx={2} />
                        <text x={cx} y={H + 16} textAnchor="middle" fontSize={9} fill="#9CA3AF">{label}</text>
                    </g>
                )
            })}
        </svg>
    )
}

// ---- ACTIVITY FEED ----
type ActivityItem = {
    id: string
    type: 'bill' | 'payment' | 'expense' | 'contact'
    label: string
    detail: string
    date: string
}

function buildActivities(vendor: Vendor, purchases: Purchase[], expenses: Expense[]): ActivityItem[] {
    const items: ActivityItem[] = []

    if (vendor.createdAt) {
        items.push({
            id: 'contact-created',
            type: 'contact',
            label: 'Contact created',
            detail: `Vendor "${vendor.contactName}" was added`,
            date: vendor.createdAt,
        })
    }

    for (const p of purchases) {
        items.push({
            id: `bill-${p._id}`,
            type: 'bill',
            label: 'Bill added',
            detail: `${p.purchaseNo} · ${formatMoney(p.total)} (due ${formatDate(p.dueDate)})`,
            date: p.createdAt || p.purchaseDate,
        })
        for (const h of p.paymentHistory ?? []) {
            items.push({
                id: `payment-${p._id}-${h.date}`,
                type: 'payment',
                label: 'Payment recorded',
                detail: `${formatMoney(h.amount)} via ${h.method.replace('_', ' ')} applied to ${p.purchaseNo}`,
                date: h.date,
            })
        }
    }

    for (const e of expenses) {
        items.push({
            id: `expense-${e._id}`,
            type: 'expense',
            label: 'Expense recorded',
            detail: `${e.expenseAccount || 'Expense'} · ${formatMoney(e.total)}`,
            date: e.createdAt || e.expenseDate,
        })
    }

    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

function ActivityFeed({
    vendor,
    purchases,
    expenses,
}: {
    vendor: Vendor
    purchases: Purchase[]
    expenses: Expense[]
}) {
    const activities = buildActivities(vendor, purchases, expenses)

    if (activities.length === 0) {
        return <p className="py-4 text-center text-xs text-muted-foreground">No activity yet.</p>
    }

    const iconStyle: Record<ActivityItem['type'], string> = {
        bill: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
        payment: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
        expense: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
        contact: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    }

    const Icon = ({ type }: { type: ActivityItem['type'] }) => {
        if (type === 'bill') return <FileText size={11} />
        if (type === 'payment') return <DollarSign size={11} />
        if (type === 'expense') return <Receipt size={11} />
        return <Building2 size={11} />
    }

    return (
        <div>
            {activities.map((act, i) => (
                <div key={act.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${iconStyle[act.type]}`}>
                            <Icon type={act.type} />
                        </div>
                        {i < activities.length - 1 && <div className="w-px flex-1 bg-border my-1" />}
                    </div>
                    <div className="pb-4 flex-1 min-w-0">
                        <p className="font-medium text-sm leading-tight">{act.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{act.detail}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1">{formatDate(act.date)}</p>
                    </div>
                </div>
            ))}
        </div>
    )
}

// ---- RIGHT OVERVIEW PANEL ----
function RightOverview({
    vendor,
    summary,
    summaryLoading,
    purchases,
    expenses,
    purchasesLoading,
}: {
    vendor: Vendor
    summary: VendorSummary | undefined
    summaryLoading: boolean
    purchases: Purchase[]
    expenses: Expense[]
    purchasesLoading: boolean
}) {
    const currency = vendor.currencyCode || 'AED'

    return (
        <div className="space-y-4">
            {/* Payment terms chip */}
            {vendor.paymentTermsLabel && (
                <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Payment due period</span>
                    <span className="rounded-full bg-muted px-3 py-0.5 text-xs font-medium">{vendor.paymentTermsLabel}</span>
                </div>
            )}

            {/* Payables card */}
            <div className="rounded-xl border bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Payables</h3>
                </div>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b bg-muted/30">
                            <th className="px-4 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Currency</th>
                            <th className="px-4 py-2 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Outstanding Payables</th>
                            <th className="px-4 py-2 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Unused Credits</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td className="px-4 py-3 font-medium">{currency}</td>
                            <td className={`px-4 py-3 text-right font-semibold ${(summary?.stats.outstanding ?? 0) > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                                {currency} {formatMoney(summary?.stats.outstanding ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-muted-foreground">{currency} 0.00</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Expenses chart */}
            <div className="rounded-xl border bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Expenses (last 6 months)</h3>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-sm bg-border inline-block" /> Bills
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" /> Paid
                        </span>
                    </div>
                </div>
                <div className="p-4">
                    {summaryLoading ? <div className="flex justify-center py-6"><Spinner /></div> : (
                        <MonthlyChart data={summary?.monthlyData ?? []} />
                    )}
                </div>
            </div>

            {/* Activity timeline */}
            <div className="rounded-xl border bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Activity</h3>
                </div>
                <div className="p-4">
                    {purchasesLoading ? (
                        <div className="flex justify-center py-4"><Spinner /></div>
                    ) : (
                        <ActivityFeed vendor={vendor} purchases={purchases} expenses={expenses} />
                    )}
                </div>
            </div>
        </div>
    )
}

// ---- TRANSACTIONS TAB ----
type TxView = 'bills' | 'payments' | 'expenses'

function TransactionsTab({
    purchases,
    expenses,
    purchasesLoading,
    onPayBill,
}: {
    purchases: Purchase[]
    expenses: Expense[]
    purchasesLoading: boolean
    onPayBill: (id: string) => void
}) {
    const [view, setView] = useState<TxView>('bills')
    const now = new Date()

    const allPayments = purchases
        .flatMap((p) =>
            (p.paymentHistory ?? []).map((h) => ({
                ...h,
                billNo: p.purchaseNo,
                billId: p._id,
            }))
        )
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    const VIEWS: { key: TxView; label: string; count: number }[] = [
        { key: 'bills', label: 'Bills', count: purchases.length },
        { key: 'payments', label: 'Payments', count: allPayments.length },
        { key: 'expenses', label: 'Expenses', count: expenses.length },
    ]

    return (
        <>
            <div className="flex border-b border-border">
                {VIEWS.map(({ key, label, count }) => (
                    <button
                        key={key}
                        onClick={() => setView(key)}
                        className={`px-5 py-2.5 text-sm font-medium transition-colors cursor-pointer ${view === key
                                ? 'border-b-2 border-primary text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        {label}
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">{count}</span>
                    </button>
                ))}
            </div>

            {view === 'bills' && (
                purchasesLoading ? (
                    <div className="flex justify-center py-8"><Spinner /></div>
                ) : purchases.length === 0 ? (
                    <EmptyState message="No bills for this vendor." />
                ) : (
                    <Table>
                        <thead>
                            <tr>
                                <Th>Bill #</Th><Th>Date</Th><Th>Due Date</Th>
                                <Th>Total</Th><Th>Paid</Th><Th>Balance</Th>
                                <Th>Status</Th><Th />
                            </tr>
                        </thead>
                        <tbody>
                            {purchases.map((p) => {
                                const paid = p.paymentMade ?? 0
                                const balance = Math.max(0, p.total - paid)
                                const overdue = !['received', 'cancelled'].includes(p.status) && p.dueDate && new Date(p.dueDate) < now && balance > 0
                                return (
                                    <tr key={p._id} className="hover:bg-muted/50">
                                        <Td className="font-medium relative overflow-hidden">
                                            {overdue && <CornerRibbon label="Overdue" color="amber" size="sm" />}
                                            {p.status === 'received' && <CornerRibbon label="Paid" color="green" size="sm" />}
                                            {p.purchaseNo}
                                        </Td>
                                        <Td>{formatDate(p.purchaseDate)}</Td>
                                        <Td className={overdue ? 'text-destructive font-medium' : ''}>{formatDate(p.dueDate)}</Td>
                                        <Td>{formatMoney(p.total)}</Td>
                                        <Td className="text-emerald-600">{formatMoney(paid)}</Td>
                                        <Td className={balance > 0 ? 'text-destructive font-medium' : 'text-emerald-600'}>{formatMoney(balance)}</Td>
                                        <Td><Badge tone={purchaseStatusTone[p.status]}>{statusLabel(p.status)}</Badge></Td>
                                        <Td>
                                            {(!['received', 'cancelled'].includes(p.status) || balance > 0) && (
                                                <Button size="sm" variant="success" onClick={() => onPayBill(p._id)}>Pay</Button>
                                            )}
                                        </Td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </Table>
                )
            )}

            {view === 'payments' && (
                allPayments.length === 0 ? (
                    <EmptyState message="No payments recorded yet." />
                ) : (
                    <Table>
                        <thead>
                            <tr><Th>Date</Th><Th>Bill #</Th><Th>Amount</Th><Th>Method</Th><Th>Notes</Th></tr>
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
            )}

            {view === 'expenses' && (
                expenses.length === 0 ? (
                    <EmptyState message="No expenses for this vendor." />
                ) : (
                    <Table>
                        <thead>
                            <tr><Th>Date</Th><Th>Account</Th><Th>Description</Th><Th>Paid Through</Th><Th>Amount</Th><Th>Status</Th></tr>
                        </thead>
                        <tbody>
                            {expenses.map((e) => (
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
            )}
        </>
    )
}

// ---- STATEMENT TAB ----
function StatementTab({
    vendor,
    purchases,
}: {
    vendor: Vendor
    purchases: Purchase[]
}) {
    const currency = vendor.currencyCode || 'AED'

    type Row = { date: string; description: string; debit: number; credit: number; balance: number }

    const entries: { date: string; description: string; debit: number; credit: number }[] = []

    for (const p of purchases) {
        entries.push({ date: p.purchaseDate, description: `Bill ${p.purchaseNo}`, debit: p.total, credit: 0 })
        for (const h of p.paymentHistory ?? []) {
            entries.push({
                date: h.date,
                description: `Payment for ${p.purchaseNo} (${h.method.replace('_', ' ')})`,
                debit: 0,
                credit: h.amount,
            })
        }
    }

    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    let running = vendor.openingBalance ?? 0
    const rows: Row[] = []

    if (running !== 0) {
        rows.push({
            date: vendor.createdAt || '',
            description: 'Opening Balance',
            debit: running > 0 ? running : 0,
            credit: running < 0 ? -running : 0,
            balance: running,
        })
    }

    for (const e of entries) {
        running = running + e.debit - e.credit
        rows.push({ ...e, balance: running })
    }

    if (rows.length === 0) return <EmptyState message="No transactions for this vendor yet." />

    const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0)

    return (
        <Table>
            <thead>
                <tr>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th className="text-right">Debit</Th>
                    <Th className="text-right">Credit</Th>
                    <Th className="text-right">Balance ({currency})</Th>
                </tr>
            </thead>
            <tbody>
                {rows.map((r, idx) => (
                    <tr key={idx} className="hover:bg-muted/50">
                        <Td>{r.date ? formatDate(r.date) : '—'}</Td>
                        <Td>{r.description}</Td>
                        <Td className="text-right">{r.debit > 0 ? formatMoney(r.debit) : '—'}</Td>
                        <Td className="text-right text-emerald-600">{r.credit > 0 ? formatMoney(r.credit) : '—'}</Td>
                        <Td className={`text-right font-medium ${r.balance > 0 ? 'text-destructive' : r.balance < 0 ? 'text-emerald-600' : ''}`}>
                            {formatMoney(Math.abs(r.balance))}{r.balance < 0 ? ' Cr' : ''}
                        </Td>
                    </tr>
                ))}
                <tr className="bg-muted/40 font-semibold text-sm">
                    <Td colSpan={2} className="text-right text-xs uppercase tracking-wide text-muted-foreground">Closing Balance</Td>
                    <Td className="text-right">{formatMoney(totalDebit)}</Td>
                    <Td className="text-right text-emerald-600">{formatMoney(totalCredit)}</Td>
                    <Td className={`text-right font-bold ${running > 0 ? 'text-destructive' : running < 0 ? 'text-emerald-600' : ''}`}>
                        {formatMoney(Math.abs(running))}{running < 0 ? ' Cr' : ''}
                    </Td>
                </tr>
            </tbody>
        </Table>
    )
}

// ---- RECORD PAYMENT MODAL ----
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

    if (!purchase) return <div className="flex justify-center py-6"><Spinner /></div>

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
                                <button
                                    className="text-xs text-destructive hover:underline cursor-pointer"
                                    onClick={() => { if (confirm('Remove this payment?')) deletePmt.mutate(idx) }}
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {balance > 0 ? (
                <form onSubmit={submit} className="space-y-3">
                    <div className="text-xs font-semibold text-muted-foreground">Record new payment</div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Amount (AED)">
                            <Input type="number" min={0.01} step="0.01" placeholder={String(balance)} value={amount} onChange={(e) => setAmount(e.target.value)} required />
                        </Field>
                        <Field label="Date">
                            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                        </Field>
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
                        <Field label="Notes (optional)">
                            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reference / memo" />
                        </Field>
                    </div>
                    {err && <p className="text-xs text-destructive">{err}</p>}
                    <div className="flex gap-2 justify-end">
                        <Button type="button" variant="outline" onClick={onClose}>Done</Button>
                        <Button type="submit" variant="success" disabled={record.isPending}>
                            {record.isPending ? 'Recording…' : 'Record payment'}
                        </Button>
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

// ---- EDIT VENDOR FORM ----
function EditVendorForm({
    vendor,
    busy,
    onSave,
    onClose,
}: {
    vendor: Vendor
    busy: boolean
    onSave: (body: Record<string, unknown>) => void
    onClose: () => void
}) {
    const [contactName, setContactName] = useState(vendor.contactName)
    const [companyName, setCompanyName] = useState(vendor.companyName || '')
    const [email, setEmail] = useState(vendor.email || '')
    const [phone, setPhone] = useState(vendor.phone || '')
    const [mobilePhone, setMobilePhone] = useState(vendor.mobilePhone || '')
    const [website, setWebsite] = useState(vendor.website || '')
    const [currencyCode, setCurrencyCode] = useState(vendor.currencyCode || 'AED')
    const [paymentTermsLabel, setPaymentTermsLabel] = useState(vendor.paymentTermsLabel || '')
    const [notes, setNotes] = useState(vendor.notes || '')
    const [status, setStatus] = useState(vendor.status)

    function submit(e: FormEvent) {
        e.preventDefault()
        onSave({
            contactId: vendor.contactId,
            contactName, companyName,
            displayName: vendor.displayName || contactName,
            email, phone, mobilePhone, website, currencyCode,
            paymentTermsLabel, notes, status,
            ownerName: vendor.ownerName || '',
            source: vendor.source || '',
            paymentTerms: vendor.paymentTerms || 0,
            openingBalance: vendor.openingBalance || 0,
            categories: vendor.categories || [],
        })
    }

    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <Field label="Contact Name *">
                    <Input value={contactName} onChange={(e) => setContactName(e.target.value)} required />
                </Field>
                <Field label="Company Name">
                    <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Email">
                    <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field label="Phone">
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Mobile">
                    <Input value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} />
                </Field>
                <Field label="Website">
                    <Input value={website} onChange={(e) => setWebsite(e.target.value)} />
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Currency">
                    <Input value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} />
                </Field>
                <Field label="Payment Terms">
                    <Input value={paymentTermsLabel} onChange={(e) => setPaymentTermsLabel(e.target.value)} placeholder="e.g. Net 30" />
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                    <Select value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                    </Select>
                </Field>
                <Field label="Notes">
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" />
                </Field>
            </div>
            <div className="flex gap-2 justify-end pt-1">
                <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
            </div>
        </form>
    )
}

// ---- MAIN PAGE ----
type Tab = 'overview' | 'transactions' | 'statement'

export default function VendorDetail() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const qc = useQueryClient()

    const [tab, setTab] = useState<Tab>('overview')
    const [editing, setEditing] = useState(false)
    const [showTxMenu, setShowTxMenu] = useState(false)
    const [showMoreMenu, setShowMoreMenu] = useState(false)
    const [payingId, setPayingId] = useState<string | null>(null)
    const [editErr, setEditErr] = useState('')

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

    const { data: purchases, isLoading: purchasesLoading } = useQuery<Purchase[]>({
        queryKey: ['purchases', '', '', id],
        queryFn: () => purchaseApi.list({ vendor: id }),
        enabled: !!id,
    })

    const { data: expenses, isLoading: expensesLoading } = useQuery<Expense[]>({
        queryKey: ['expenses', 'vendor', id, vendor?.contactName],
        queryFn: () => expenseApi.list({ vendor: id, vendorName: vendor?.contactName }),
        enabled: !!id && !!vendor,
    })

    const invalidateVendor = () => {
        qc.invalidateQueries({ queryKey: ['vendor', id] })
        qc.invalidateQueries({ queryKey: ['vendor-summary', id] })
        qc.invalidateQueries({ queryKey: ['vendors'] })
    }

    const updateVendor = useMutation({
        mutationFn: (body: Record<string, unknown>) => vendorApi.update(id!, body),
        onSuccess: () => { invalidateVendor(); setEditing(false); setEditErr('') },
        onError: (e) => setEditErr(apiError(e)),
    })

    const deleteVendor = useMutation({
        mutationFn: () => vendorApi.remove(id!),
        onSuccess: () => navigate('/vendors'),
        onError: (e) => alert(apiError(e)),
    })

    if (vendorLoading) return <div className="flex justify-center pt-20"><Spinner /></div>
    if (!vendor) return <div className="p-6 text-sm text-muted-foreground">Vendor not found.</div>

    const TABS: { key: Tab; label: string }[] = [
        { key: 'overview', label: 'Overview' },
        { key: 'transactions', label: 'Transactions' },
        { key: 'statement', label: 'Statement' },
    ]

    return (
        <div>
            {/* Back */}
            <Link to="/vendors" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
                <ArrowLeft size={13} /> Back to Vendors
            </Link>

            {/* Header bar */}
            <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                <div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-2xl font-bold">{vendor.contactName}</h1>
                        {vendor.companyName && (
                            <span className="text-muted-foreground text-sm">{vendor.companyName}</span>
                        )}
                        <Badge tone={vendor.status === 'active' ? 'green' : 'gray'}>{vendor.status}</Badge>
                    </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                        Edit
                    </Button>

                    {/* New Transaction dropdown */}
                    <div
                        className="relative"
                        onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) setShowTxMenu(false)
                        }}
                    >
                        <Button
                            size="sm"
                            tabIndex={0}
                            onClick={() => { setShowTxMenu((v) => !v); setShowMoreMenu(false) }}
                        >
                            New Transaction <ChevronDown size={13} className="ml-0.5" />
                        </Button>
                        {showTxMenu && (
                            <div className="absolute right-0 mt-1.5 w-48 rounded-xl border bg-card shadow-lg z-30 overflow-hidden">
                                <Link
                                    to="/purchases"
                                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors"
                                    onClick={() => setShowTxMenu(false)}
                                >
                                    <FileText size={14} className="text-muted-foreground" /> New Bill
                                </Link>
                                <Link
                                    to="/expenses"
                                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors border-t border-border"
                                    onClick={() => setShowTxMenu(false)}
                                >
                                    <Receipt size={14} className="text-muted-foreground" /> Record Expense
                                </Link>
                            </div>
                        )}
                    </div>

                    {/* More dropdown */}
                    <div
                        className="relative"
                        onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) setShowMoreMenu(false)
                        }}
                    >
                        <Button
                            variant="outline"
                            size="sm"
                            tabIndex={0}
                            onClick={() => { setShowMoreMenu((v) => !v); setShowTxMenu(false) }}
                        >
                            More <ChevronDown size={13} className="ml-0.5" />
                        </Button>
                        {showMoreMenu && (
                            <div className="absolute right-0 mt-1.5 w-44 rounded-xl border bg-card shadow-lg z-30 overflow-hidden">
                                <button
                                    tabIndex={0}
                                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-destructive hover:bg-muted/60 transition-colors cursor-pointer"
                                    onClick={() => {
                                        setShowMoreMenu(false)
                                        if (confirm(`Delete vendor "${vendor.contactName}"? This cannot be undone.`)) {
                                            deleteVendor.mutate()
                                        }
                                    }}
                                >
                                    <Trash2 size={14} /> Delete vendor
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
                {TABS.map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`px-5 py-2.5 text-sm font-medium transition-colors cursor-pointer ${tab === key
                                ? 'border-b-2 border-primary text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="mt-4">
                {tab === 'overview' && (
                    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">
                        <LeftSidebar vendor={vendor} />
                        <RightOverview
                            vendor={vendor}
                            summary={summary}
                            summaryLoading={summaryLoading}
                            purchases={purchases ?? []}
                            expenses={expenses ?? []}
                            purchasesLoading={purchasesLoading || expensesLoading}
                        />
                    </div>
                )}

                {tab === 'transactions' && (
                    <div className="rounded-xl border bg-card overflow-hidden">
                        <TransactionsTab
                            purchases={purchases ?? []}
                            expenses={expenses ?? []}
                            purchasesLoading={purchasesLoading}
                            onPayBill={setPayingId}
                        />
                    </div>
                )}

                {tab === 'statement' && (
                    <div className="rounded-xl border bg-card overflow-hidden">
                        {purchasesLoading ? (
                            <div className="flex justify-center py-8"><Spinner /></div>
                        ) : (
                            <StatementTab vendor={vendor} purchases={purchases ?? []} />
                        )}
                    </div>
                )}
            </div>

            {/* Edit Vendor Modal */}
            <Modal
                open={editing}
                onClose={() => { setEditing(false); setEditErr('') }}
                title="Edit Vendor"
                wide
            >
                {editing && (
                    <>
                        {editErr && <p className="text-xs text-destructive mb-3">{editErr}</p>}
                        <EditVendorForm
                            vendor={vendor}
                            busy={updateVendor.isPending}
                            onSave={(body) => updateVendor.mutate(body)}
                            onClose={() => { setEditing(false); setEditErr('') }}
                        />
                    </>
                )}
            </Modal>

            {/* Record Payment Modal */}
            <Modal open={!!payingId} onClose={() => setPayingId(null)} title="Record Payment" wide>
                {payingId && (
                    <RecordPaymentModal purchaseId={payingId} onClose={() => setPayingId(null)} />
                )}
            </Modal>
        </div>
    )
}

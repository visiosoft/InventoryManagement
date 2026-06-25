import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Download, AlertCircle, CheckCircle2, Clock, Pencil, MessageCircle } from 'lucide-react'
import { api, apiError, invoiceApi } from '../lib/api'
import type { Invoice, InvoicePaymentEntry, InvoiceStatus } from '../lib/types'
import {
    Badge, Button, Card, CardBody, CardHeader, CornerRibbon,
    Field, Input, Modal, Select, Spinner, Table, Td, Th, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const invoiceStatusTone: Record<InvoiceStatus, string> = {
    draft: 'gray', sent: 'blue', paid: 'green', overdue: 'red', cancelled: 'amber',
}

// Merge legacy "Week N: DD Mon YYYY · Unit X" line items into one monthly line
function consolidateItems(items: Invoice['items']) {
    if (!items?.length) return items ?? []
    const weekRe = /^Week\s+\d+:\s+(.+?)\s+·\s+(.+)$/
    const weekItems = items.filter(it => weekRe.test(it.itemDetails ?? ''))
    const otherItems = items.filter(it => !weekRe.test(it.itemDetails ?? ''))
    if (weekItems.length < 2) return items

    const total = weekItems.reduce((s, it) => s + Number(it.amount ?? 0), 0)
    const singleWeekRate = Number(weekItems[0].rate ?? 0)
    const discountPct = weekItems.find(it => (it.discountPct ?? 0) > 0)?.discountPct ?? 0
    const firstMatch = weekRe.exec(weekItems[0].itemDetails ?? '')
    const lastMatch  = weekRe.exec(weekItems[weekItems.length - 1].itemDetails ?? '')
    const fromDate = firstMatch?.[1] ?? ''
    const unitNo   = firstMatch?.[2] ?? ''
    let toDate = lastMatch?.[1] ?? ''
    try {
        const d = new Date(toDate)
        d.setDate(d.getDate() + 6)
        toDate = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    } catch { /* keep raw */ }

    return [
        { ...weekItems[0], itemDetails: `Storage Rent ${fromDate} – ${toDate} · ${unitNo}`, quantity: weekItems.length, rate: singleWeekRate, discountPct, amount: total },
        ...otherItems,
    ]
}

function invoiceLabel(status: InvoiceStatus) {
    return status === 'draft' ? 'Quote' : statusLabel(status)
}

function docLabel(invoice: Invoice) {
    return invoice.status === 'draft' ? 'Quote' : 'Invoice'
}

function WhatNext({ invoice, onRecordPayment }: { invoice: Invoice; onRecordPayment: () => void }) {
    const balance = Math.max(0, invoice.total - (invoice.paymentMade ?? 0))
    const isOverdue =
        invoice.status === 'overdue' ||
        (invoice.status === 'sent' && !!invoice.dueDate && new Date(invoice.dueDate) < new Date())

    if (invoice.status === 'paid') {
        return (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 px-5 py-4">
                <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={18} />
                <div>
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Invoice Paid</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">
                        This invoice has been paid in full. No further action needed.
                    </p>
                </div>
            </div>
        )
    }

    if (invoice.status === 'cancelled') {
        return (
            <div className="mb-5 flex items-start gap-3 rounded-xl border bg-muted/50 px-5 py-4">
                <AlertCircle className="text-muted-foreground shrink-0 mt-0.5" size={18} />
                <div>
                    <p className="text-sm font-semibold">Cancelled</p>
                    <p className="text-xs text-muted-foreground mt-0.5">This invoice has been cancelled.</p>
                </div>
            </div>
        )
    }

    if (invoice.status === 'draft') {
        return (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900 px-5 py-4">
                <Clock className="text-blue-600 shrink-0 mt-0.5" size={18} />
                <div>
                    <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">Quote</p>
                    <p className="text-xs text-blue-600 dark:text-blue-500 mt-0.5">
                        This is a quote. Mark it as <strong>Sent</strong> once you've shared it with the customer to convert it to an invoice.
                    </p>
                </div>
            </div>
        )
    }

    if (isOverdue) {
        return (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 px-5 py-4">
                <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={18} />
                <div>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-400">What's Next?</p>
                    <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
                        Payment is overdue. Balance due: <strong>AED {formatMoney(balance)}</strong>.{' '}
                        <button className="underline hover:no-underline cursor-pointer" onClick={onRecordPayment}>
                            Record payment
                        </button>{' '}
                        or follow up with the customer.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 px-5 py-4">
            <Clock className="text-amber-600 shrink-0 mt-0.5" size={18} />
            <div>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">What's Next?</p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                    Waiting for payment. Balance due: <strong>AED {formatMoney(balance)}</strong>. Due on {formatDate(invoice.dueDate)}.{' '}
                    <button className="underline hover:no-underline cursor-pointer" onClick={onRecordPayment}>
                        Record payment
                    </button>{' '}
                    when received.
                </p>
            </div>
        </div>
    )
}

function RecordPaymentModalContent({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
    const qc = useQueryClient()
    const [amount, setAmount] = useState<string>('')
    const [method, setMethod] = useState('cash')
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
    const [notes, setNotes] = useState('')
    const [err, setErr] = useState('')

    const { data: inv } = useQuery<Invoice>({
        queryKey: ['invoice', invoiceId],
        queryFn: () => invoiceApi.get(invoiceId),
    })

    const history: InvoicePaymentEntry[] = inv?.paymentHistory ?? []
    const paid = inv?.paymentMade ?? 0
    const total = inv?.total ?? 0
    const balance = Math.max(0, total - paid)

    const record = useMutation({
        mutationFn: (body: { amount: number; method: string; date: string; notes?: string }) =>
            invoiceApi.recordPayment(invoiceId, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
            qc.invalidateQueries({ queryKey: ['invoices'] })
            setAmount('')
            setNotes('')
            setErr('')
        },
        onError: (e) => setErr(apiError(e)),
    })

    const deletePayment = useMutation({
        mutationFn: (idx: number) => invoiceApi.deletePayment(invoiceId, idx),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
            qc.invalidateQueries({ queryKey: ['invoices'] })
        },
        onError: (e) => setErr(apiError(e)),
    })

    function submit(e: FormEvent) {
        e.preventDefault()
        const n = Number(amount)
        if (!n || n <= 0) { setErr('Enter a valid amount'); return }
        record.mutate({ amount: n, method, date, notes: notes || undefined })
    }

    if (!inv) return <Spinner />

    return (
        <div className="space-y-5">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                <div>
                    <div className="text-xs text-muted-foreground">{docLabel(inv)} total</div>
                    <div className="font-semibold">{formatMoney(total)}</div>
                </div>
                <div>
                    <div className="text-xs text-muted-foreground">Amount paid</div>
                    <div className="font-semibold text-emerald-600">{formatMoney(paid)}</div>
                </div>
                <div>
                    <div className="text-xs text-muted-foreground">Balance due</div>
                    <div className={`font-semibold ${balance > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                        {formatMoney(balance)}
                    </div>
                </div>
            </div>

            {/* Payment history */}
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
                                    {p.notes && <span className="text-muted-foreground truncate max-w-32">{p.notes}</span>}
                                </div>
                                <button
                                    className="text-xs text-destructive hover:underline cursor-pointer"
                                    onClick={() => { if (confirm('Remove this payment entry?')) deletePayment.mutate(idx) }}
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Record payment form */}
            {balance > 0 ? (
                <form onSubmit={submit} className="space-y-3">
                    <div className="text-xs font-semibold text-muted-foreground">Record new payment</div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Amount (AED)">
                            <Input
                                type="number"
                                min={0.01}
                                step="0.01"
                                placeholder={String(balance)}
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                required
                            />
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
                    <p className="text-sm text-emerald-600 font-medium">Invoice fully paid</p>
                    <Button variant="outline" className="mt-3" onClick={onClose}>Close</Button>
                </div>
            )}
        </div>
    )
}

function EditInvoiceModal({ invoice, onClose, onSaved }: { invoice: Invoice; onClose: () => void; onSaved: () => void }) {
    const [dueDate, setDueDate] = useState(invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : '')
    const [subject, setSubject] = useState(invoice.subject || '')
    const [notes, setNotes] = useState(invoice.customerNotes || '')
    const [items, setItems] = useState(() =>
        consolidateItems(invoice.items).map((it, i) => ({ ...it, sortOrder: it.sortOrder ?? i, discountPct: it.discountPct ?? 0 }))
    )
    const [err, setErr] = useState('')

    function updateDiscount(idx: number, pct: number) {
        setItems(prev => prev.map((it, i) => {
            if (i !== idx) return it
            const gross = it.quantity * it.rate
            const amount = Math.round((gross - gross * pct / 100) * 100) / 100
            return { ...it, discountPct: pct, amount }
        }))
    }

    function updateAmount(idx: number, val: number) {
        setItems(prev => prev.map((it, i) => {
            if (i !== idx) return it
            const isWeekly = String(it.itemDetails).startsWith('Week ')
            // For extra items (non-weekly), mirror rate = amount so server computes correctly
            return isWeekly ? { ...it, amount: val } : { ...it, amount: val, rate: val }
        }))
    }

    function updateDesc(idx: number, desc: string) {
        setItems(prev => prev.map((it, i) => i !== idx ? it : { ...it, itemDetails: desc }))
    }

    function removeItem(idx: number) {
        setItems(prev => prev.filter((_, i) => i !== idx))
    }

    function addExtra() {
        setItems(prev => [...prev, { sortOrder: prev.length, itemDetails: '', quantity: 1, rate: 0, discountPct: 0, amount: 0 }])
    }

    const save = useMutation({
        mutationFn: () => api.put(`/invoices/${invoice._id}`, {
            customer: (invoice.customer as any)?._id ?? invoice.customer,
            invoiceDate: invoice.invoiceDate,
            dueDate,
            subject,
            customerNotes: notes,
            items: items.map((it, i) => ({ ...it, sortOrder: i })),
            orderNumber: invoice.orderNumber,
            terms: invoice.terms,
            bankInformation: invoice.bankInformation,
            salesperson: invoice.salesperson,
            paymentMade: invoice.paymentMade ?? 0,
            status: invoice.status,
            total: items.reduce((s, it) => s + Number(it.amount || 0), 0),
        }),
        onSuccess: () => onSaved(),
        onError: (e) => setErr(apiError(e)),
    })

    const subTotal = items.reduce((s, it) => s + Number(it.amount || 0), 0)

    return (
        <Modal open wide title={`Edit ${docLabel(invoice)} ${invoice.invoiceNo}`} onClose={onClose}>
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Due Date">
                        <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                    </Field>
                    <Field label="Subject">
                        <Input value={subject} onChange={e => setSubject(e.target.value)} />
                    </Field>
                </div>

                <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-2">Line items</div>
                    <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Description</th>
                                    <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-16">Qty</th>
                                    <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-24">Rate</th>
                                    <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-24">Discount %</th>
                                    <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground w-28">Amount (AED)</th>
                                    <th className="w-8" />
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((it, idx) => {
                                    const isWeekly = String(it.itemDetails).startsWith('Week ')
                                    return (
                                        <tr key={idx} className="border-t hover:bg-muted/30">
                                            <td className="px-3 py-2">
                                                {isWeekly
                                                    ? <span className="text-xs text-muted-foreground">{it.itemDetails}</span>
                                                    : <Input value={it.itemDetails} onChange={e => updateDesc(idx, e.target.value)}
                                                        placeholder="Description" className="h-7 text-xs" />
                                                }
                                            </td>
                                            <td className="px-3 py-2 text-right text-muted-foreground text-xs">
                                                {(it.quantity ?? 1) > 1 ? `${it.quantity} wk` : '—'}
                                            </td>
                                            <td className="px-3 py-2 text-right text-muted-foreground text-xs">
                                                {it.rate > 0 ? formatMoney(it.rate) : '—'}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                {isWeekly
                                                    ? <Input type="number" min={0} max={100} value={it.discountPct}
                                                        onChange={e => updateDiscount(idx, Number(e.target.value))}
                                                        className="h-7 text-xs w-20 ml-auto text-right" />
                                                    : <span className="text-muted-foreground text-xs">—</span>
                                                }
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                {isWeekly
                                                    ? <span className="font-medium text-xs">{formatMoney(it.amount)}</span>
                                                    : <Input type="number" min={0} step="0.01" value={it.amount}
                                                        onChange={e => updateAmount(idx, Number(e.target.value))}
                                                        className="h-7 text-xs w-24 ml-auto text-right" />
                                                }
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                {!isWeekly && (
                                                    <button onClick={() => removeItem(idx)}
                                                        className="text-destructive hover:opacity-70 text-xs cursor-pointer">✕</button>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="border-t bg-muted/30">
                                    <td colSpan={4} className="px-3 py-2">
                                        <button onClick={addExtra} className="text-xs text-primary hover:underline cursor-pointer">
                                            + Add extra charge / credit
                                        </button>
                                    </td>
                                    <td className="px-3 py-2 text-right font-semibold text-sm">AED {formatMoney(subTotal)}</td>
                                    <td />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

                <Field label="Notes">
                    <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Customer notes / memo" />
                </Field>

                <div className="flex items-center justify-between pt-3 border-t">
                    {err && <p className="text-xs text-destructive">{err}</p>}
                    <div className="flex gap-2 ml-auto">
                        <Button variant="outline" onClick={onClose}>Cancel</Button>
                        <Button onClick={() => save.mutate()} disabled={save.isPending}>
                            {save.isPending ? 'Saving…' : 'Save changes'}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    )
}

export default function InvoiceDetail() {
    const { id } = useParams<{ id: string }>()
    const qc = useQueryClient()
    const [paying, setPaying] = useState(false)
    const [editing, setEditing] = useState(false)

    const { data: invoice, isLoading } = useQuery<Invoice>({
        queryKey: ['invoice', id],
        queryFn: () => invoiceApi.get(id!),
        enabled: !!id,
    })

    const whatsapp = useMutation({
        mutationFn: () => api.post(`/invoices/${id}/share`).then((r) => r.data as { url: string }),
        onSuccess: ({ url }) => {
            const phone = (invoice!.customer as any)?.phone?.replace(/\D/g, '') || ''
            const due = invoice!.dueDate ? new Date(invoice!.dueDate).toLocaleDateString('en-GB') : ''
            const text = [
                `Hello ${(invoice!.customer as any)?.fullName ?? 'there'},`,
                ``,
                `Your invoice *${invoice!.invoiceNo}* is ready.`,
                `Amount: AED ${Number(invoice!.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                due ? `Due date: ${due}` : '',
                ``,
                `View & download your invoice:`,
                url,
                ``,
                `Thank you – PurpleBox`,
            ].filter(l => l !== null).join('\n')
            const waUrl = phone
                ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
                : `https://wa.me/?text=${encodeURIComponent(text)}`
            window.open(waUrl, '_blank', 'noopener,noreferrer')
        },
    })

    const updateStatus = useMutation({
        mutationFn: (status: string) => invoiceApi.updateStatus(id!, status),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invoice', id] })
            qc.invalidateQueries({ queryKey: ['invoices'] })
        },
    })

    const openPdf = async () => {
        try {
            const response = await api.get(`/invoices/${id}/pdf`, { responseType: 'blob' })
            const blob = new Blob([response.data], { type: 'application/pdf' })
            const url = window.URL.createObjectURL(blob)
            window.open(url, '_blank', 'noopener,noreferrer')
            window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
        } catch {
            // silently ignore
        }
    }

    if (isLoading) {
        return (
            <div className="flex justify-center pt-20">
                <Spinner />
            </div>
        )
    }

    if (!invoice) {
        return <div className="p-6 text-sm text-muted-foreground">Invoice not found.</div>
    }

    const paid = invoice.paymentMade ?? 0
    const balance = Math.max(0, invoice.total - paid)
    const canPay = !['paid', 'cancelled'].includes(invoice.status)

    return (
        <div>
            {/* Back link */}
            <Link
                to="/invoices"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4"
            >
                <ArrowLeft size={13} /> Back to Invoices
            </Link>

            {/* Page header */}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold">{invoice.invoiceNo}</h1>
                        <Badge tone={invoiceStatusTone[invoice.status]}>{invoiceLabel(invoice.status)}</Badge>
                    </div>
                    {invoice.customer?.fullName && (
                        <p className="text-sm text-muted-foreground mt-1">{invoice.customer.fullName}</p>
                    )}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2">
                    {invoice.status === 'draft' && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus.mutate('sent')}
                            disabled={updateStatus.isPending}
                        >
                            Mark as Sent
                        </Button>
                    )}
                    {invoice.status !== 'cancelled' && (
                        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                            <Pencil size={13} /> Edit
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => whatsapp.mutate()}
                        disabled={whatsapp.isPending}
                        className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                    >
                        <MessageCircle size={13} />
                        {whatsapp.isPending ? 'Generating…' : 'WhatsApp'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={openPdf}>
                        <Download size={14} /> PDF
                    </Button>
                    {canPay && (
                        <Button size="sm" variant="success" onClick={() => setPaying(true)}>
                            Record Payment
                        </Button>
                    )}
                </div>
            </div>

            {/* What's Next banner */}
            <WhatNext invoice={invoice} onRecordPayment={() => setPaying(true)} />

            {/* Details + Payment summary */}
            <div className="grid gap-4 lg:grid-cols-3 mb-4">
                {/* Invoice details */}
                <Card className="lg:col-span-2 relative overflow-hidden">
                    {invoice.status === 'overdue' && <CornerRibbon label="Overdue" color="amber" />}
                    {invoice.status === 'paid' && <CornerRibbon label="Paid" color="green" />}
                    <CardHeader title={`${docLabel(invoice)} Details`} />
                    <CardBody className="space-y-4 text-sm">
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                    Bill To
                                </p>
                                <p className="font-semibold">{invoice.customer?.fullName || '—'}</p>
                                {invoice.customer?.address && (
                                    <p className="text-muted-foreground text-xs mt-0.5">{invoice.customer.address}</p>
                                )}
                                {invoice.customer?.email && (
                                    <p className="text-muted-foreground text-xs">{invoice.customer.email}</p>
                                )}
                                {invoice.customer?.phone && (
                                    <p className="text-muted-foreground text-xs">{invoice.customer.phone}</p>
                                )}
                            </div>
                            <div className="space-y-2.5">
                                <div>
                                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                                        Invoice Date
                                    </p>
                                    <p>{formatDate(invoice.invoiceDate)}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                                        Due Date
                                    </p>
                                    <p>{formatDate(invoice.dueDate)}</p>
                                </div>
                                {invoice.terms && (
                                    <div>
                                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                                            Terms
                                        </p>
                                        <p>{invoice.terms}</p>
                                    </div>
                                )}
                                {invoice.orderNumber && (
                                    <div>
                                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                                            Order #
                                        </p>
                                        <p>{invoice.orderNumber}</p>
                                    </div>
                                )}
                                {invoice.salesperson && (
                                    <div>
                                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                                            Salesperson
                                        </p>
                                        <p>{invoice.salesperson}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {invoice.bankInformation && (
                            <div>
                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
                                    Bank Information
                                </p>
                                <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs whitespace-pre-line">
                                    {invoice.bankInformation}
                                </div>
                            </div>
                        )}

                        {invoice.subject && (
                            <div>
                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                                    Subject
                                </p>
                                <p>{invoice.subject}</p>
                            </div>
                        )}

                        {invoice.customerNotes && (
                            <div>
                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                                    Notes
                                </p>
                                <p className="text-muted-foreground">{invoice.customerNotes}</p>
                            </div>
                        )}
                    </CardBody>
                </Card>

                {/* Payment summary */}
                <Card>
                    <CardHeader title="Payment Summary" />
                    <CardBody className="space-y-4">
                        <div className="rounded-lg bg-muted/50 px-4 py-3 space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Invoice Total</span>
                                <span className="font-medium">AED {formatMoney(invoice.total)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Amount Paid</span>
                                <span className="font-medium text-emerald-600">AED {formatMoney(paid)}</span>
                            </div>
                            <div className="border-t pt-2 flex justify-between">
                                <span className="font-semibold">Balance Due</span>
                                <span className={`font-bold ${balance > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                                    AED {formatMoney(balance)}
                                </span>
                            </div>
                        </div>
                        {canPay && (
                            <Button variant="success" className="w-full" size="sm" onClick={() => setPaying(true)}>
                                Record Payment
                            </Button>
                        )}
                    </CardBody>
                </Card>
            </div>

            {/* Items table */}
            <Card className="mb-4">
                <CardHeader title="Items" />
                <Table>
                    <thead>
                        <tr>
                            <Th>#</Th>
                            <Th>Item & Description</Th>
                            <Th className="text-right">Qty</Th>
                            <Th className="text-right">Rate (AED)</Th>
                            {(invoice.items || []).some(it => (it.discountPct ?? 0) > 0) && (
                                <Th className="text-right">Discount</Th>
                            )}
                            <Th className="text-right">Amount (AED)</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {consolidateItems(invoice.items).map((it, idx) => {
                            const hasDiscount = consolidateItems(invoice.items).some(i => (i.discountPct ?? 0) > 0)
                            const discounted = (it.discountPct ?? 0) > 0
                            return (
                                <tr key={idx} className={`hover:bg-muted/50 ${discounted ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
                                    <Td className="text-muted-foreground">{idx + 1}</Td>
                                    <Td className="whitespace-pre-line">{it.itemDetails}</Td>
                                    <Td className="text-right text-muted-foreground">
                                        {(it.quantity ?? 1) > 1 ? `${it.quantity} wk` : '—'}
                                    </Td>
                                    <Td className="text-right">
                                        {discounted
                                            ? <span className="line-through text-muted-foreground">{formatMoney(it.rate)}</span>
                                            : formatMoney(it.rate)
                                        }
                                    </Td>
                                    {hasDiscount && (
                                        <Td className="text-right">
                                            {discounted
                                                ? <span className="text-amber-600 font-medium">{it.discountPct}% off</span>
                                                : <span className="text-muted-foreground">—</span>
                                            }
                                        </Td>
                                    )}
                                    <Td className="text-right font-medium">{formatMoney(it.amount)}</Td>
                                </tr>
                            )
                        })}
                    </tbody>
                </Table>
                <div className="border-t px-5 py-3 space-y-1.5 text-sm">
                    <div className="flex justify-end gap-8">
                        <span className="text-muted-foreground">Sub Total</span>
                        <span className="w-28 text-right">{formatMoney(invoice.subTotal)}</span>
                    </div>
                    {invoice.vatEnabled && (
                        <div className="flex justify-end gap-8 text-muted-foreground">
                            <span>VAT ({invoice.vatPct ?? 5}%)</span>
                            <span className="w-28 text-right">{formatMoney(invoice.vatAmount ?? 0)}</span>
                        </div>
                    )}
                    <div className="flex justify-end gap-8 font-bold text-base border-t pt-1.5">
                        <span>Total</span>
                        <span className="w-28 text-right">AED {formatMoney(invoice.total)}</span>
                    </div>
                    {paid > 0 && (
                        <>
                            <div className="flex justify-end gap-8 text-destructive">
                                <span>Payment Made</span>
                                <span className="w-28 text-right">(-) {formatMoney(paid)}</span>
                            </div>
                            <div className="flex justify-end gap-8 font-bold">
                                <span>Balance Due</span>
                                <span className={`w-28 text-right ${balance > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                                    {formatMoney(balance)}
                                </span>
                            </div>
                        </>
                    )}
                </div>
            </Card>

            {/* Payment history */}
            {(invoice.paymentHistory ?? []).length > 0 && (
                <Card>
                    <CardHeader title={`Payment History (${invoice.paymentHistory!.length})`} />
                    <Table>
                        <thead>
                            <tr>
                                <Th>Date</Th>
                                <Th>Amount (AED)</Th>
                                <Th>Method</Th>
                                <Th>Notes</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoice.paymentHistory!.map((p, idx) => (
                                <tr key={idx} className="hover:bg-muted/50">
                                    <Td>{formatDate(p.date)}</Td>
                                    <Td className="font-medium text-emerald-600">{formatMoney(p.amount)}</Td>
                                    <Td className="capitalize">{p.method.replace('_', ' ')}</Td>
                                    <Td className="text-muted-foreground">{p.notes || '—'}</Td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Card>
            )}

            {/* Record Payment modal */}
            <Modal
                open={paying}
                onClose={() => setPaying(false)}
                title={`Record payment — ${invoice.invoiceNo}`}
                wide
            >
                {id && <RecordPaymentModalContent invoiceId={id} onClose={() => setPaying(false)} />}
            </Modal>

            {/* Edit Invoice modal */}
            {editing && (
                <EditInvoiceModal
                    invoice={invoice}
                    onClose={() => setEditing(false)}
                    onSaved={() => {
                        setEditing(false)
                        qc.invalidateQueries({ queryKey: ['invoice', id] })
                        qc.invalidateQueries({ queryKey: ['invoices'] })
                    }}
                />
            )}
        </div>
    )
}

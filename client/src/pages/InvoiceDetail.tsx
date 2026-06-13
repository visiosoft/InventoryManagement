import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Download, AlertCircle, CheckCircle2, Clock } from 'lucide-react'
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
                    <p className="text-sm font-semibold text-blue-700 dark:text-blue-400">What's Next?</p>
                    <p className="text-xs text-blue-600 dark:text-blue-500 mt-0.5">
                        This invoice is in draft. Mark it as <strong>Sent</strong> once you've shared it with the customer.
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
                    <div className="text-xs text-muted-foreground">Invoice total</div>
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

export default function InvoiceDetail() {
    const { id } = useParams<{ id: string }>()
    const qc = useQueryClient()
    const [paying, setPaying] = useState(false)

    const { data: invoice, isLoading } = useQuery<Invoice>({
        queryKey: ['invoice', id],
        queryFn: () => invoiceApi.get(id!),
        enabled: !!id,
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
                        <Badge tone={invoiceStatusTone[invoice.status]}>{statusLabel(invoice.status)}</Badge>
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
                    <CardHeader title="Invoice Details" />
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
                            <Th className="text-right">Rate (AED)</Th>
                            <Th className="text-right">Amount (AED)</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {(invoice.items || []).map((it, idx) => (
                            <tr key={idx} className="hover:bg-muted/50">
                                <Td className="text-muted-foreground">{idx + 1}</Td>
                                <Td className="whitespace-pre-line">{it.itemDetails}</Td>
                                <Td className="text-right">{formatMoney(it.rate)}</Td>
                                <Td className="text-right font-medium">{formatMoney(it.amount)}</Td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
                <div className="border-t px-5 py-3 space-y-1.5 text-sm">
                    <div className="flex justify-end gap-8">
                        <span className="text-muted-foreground">Sub Total</span>
                        <span className="w-28 text-right">{formatMoney(invoice.subTotal)}</span>
                    </div>
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
        </div>
    )
}

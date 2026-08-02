import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, AlertCircle, CheckCircle2, Clock, Pencil, MessageCircle, RefreshCw, Trash2 } from 'lucide-react'
import { api, apiError, invoiceApi } from '../lib/api'
import type { Invoice, InvoicePaymentEntry, InvoiceStatus } from '../lib/types'
import {
    Badge, Button, CornerRibbon,
    Field, Input, Modal, Select, Spinner, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const invoiceStatusTone: Record<InvoiceStatus, string> = {
    draft: 'gray', sent: 'blue', paid: 'green', partial: 'amber', overdue: 'red', cancelled: 'amber',
}

const statusDot: Record<string, string> = {
    draft: '#94A3B8', sent: '#3B82F6', paid: '#10B981', partial: '#F59E0B', overdue: '#EF4444', cancelled: '#F59E0B',
}

// Merge legacy "Week N: DD Mon YYYY · Unit X" line items into one monthly line
function consolidateItems(items: Invoice['items']) {
    if (!items?.length) return items ?? []
    const weekRe = /^Week\s+\d+:\s+(.+?)\s+·\s+(.+)$/
    const weekItems = items.filter(it => weekRe.test(it.itemDetails ?? ''))
    const otherItems = items.filter(it => !weekRe.test(it.itemDetails ?? ''))
    if (weekItems.length < 2) return normaliseRentItems(items)

    const total = weekItems.reduce((s, it) => s + Number(it.amount ?? 0), 0)
    const singleWeekRate = Number(weekItems[0].rate ?? 0)
    const discountPct = weekItems.find(it => (it.discountPct ?? 0) > 0)?.discountPct ?? 0
    const firstMatch = weekRe.exec(weekItems[0].itemDetails ?? '')
    const lastMatch = weekRe.exec(weekItems[weekItems.length - 1].itemDetails ?? '')
    const fromDate = firstMatch?.[1] ?? ''
    const unitNo = firstMatch?.[2] ?? ''
    let toDate = lastMatch?.[1] ?? ''
    try {
        const d = new Date(toDate)
        d.setDate(d.getDate() + 6)
        toDate = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    } catch { /* keep raw */ }

    return normaliseRentItems([
        { ...weekItems[0], itemDetails: `Storage Rent ${fromDate} – ${toDate} · ${unitNo}`, quantity: 1, rate: Math.round(weekItems.length * singleWeekRate * 100) / 100, discountPct, amount: total },
        ...otherItems,
    ])
}

function normaliseRentItems(items: Invoice['items']): Invoice['items'] {
    return items.map(it => {
        let desc = it.itemDetails ?? ''
        // Rename legacy "Advance Rent" to new label
        if (/^Advance Rent/.test(desc)) {
            desc = desc.replace(/^Advance Rent/, 'Refundable / Adjustable Security Deposit')
            it = { ...it, itemDetails: desc }
        }
        // Convert weekly-quantity rent items to monthly rate (qty=1)
        if (/^(Storage Rent|Refundable \/ Adjustable Security Deposit)/.test(desc) && Number(it.quantity ?? 1) > 1) {
            const monthlyRate = Math.round(Number(it.quantity) * Number(it.rate || 0) * 100) / 100
            return { ...it, quantity: 1, rate: monthlyRate }
        }
        // Rename contract-generated "Security Deposit · Unit X"
        const depMatch = desc.match(/^Security Deposit\s+·\s+Unit\s+(.+)$/)
        if (depMatch) {
            return { ...it, itemDetails: `Refundable / Adjustable Security Deposit · Unit ${depMatch[1]}` }
        }
        return it
    })
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
    const [receipt, setReceipt] = useState<File | null>(null)
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
        mutationFn: async (body: { amount: number; method: string; date: string; notes?: string }) => {
            const inv = await invoiceApi.recordPayment(invoiceId, body)
            if (receipt) {
                const form = new FormData()
                const ext = receipt.name.includes('.') ? receipt.name.slice(receipt.name.lastIndexOf('.')) : ''
                const renamed = new File([receipt], `Receipt ${body.date} — ${receipt.name.replace(/\.[^.]*$/, '')}${ext}`, { type: receipt.type })
                form.append('files', renamed)
                await invoiceApi.uploadAttachments(invoiceId, form)
            }
            return inv
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invoice', invoiceId] })
            qc.invalidateQueries({ queryKey: ['invoices'] })
            setAmount('')
            setNotes('')
            setReceipt(null)
            setErr('')
            onClose()
            setTimeout(() => alert('Payment recorded successfully!'), 100)
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
                    <Field label="Payment receipt (optional)">
                        <Input
                            type="file"
                            accept="image/*,.pdf"
                            className="h-auto py-1.5"
                            onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
                        />
                    </Field>
                    {receipt && <p className="text-xs text-muted-foreground">Will attach: {receipt.name}</p>}
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
        setItems(prev => [...prev, { sortOrder: prev.length, itemDetails: '', description: '', quantity: 1, rate: 0, discountPct: 0, amount: 0 }])
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
                                                <Input value={it.description || ''} onChange={e => setItems(prev => prev.map((item, i) => i !== idx ? item : { ...item, description: e.target.value }))}
                                                    placeholder="Sub-detail / additional info" className="h-6 text-[11px] mt-1 text-muted-foreground" />
                                            </td>
                                            <td className="px-3 py-2 text-right text-muted-foreground text-xs">
                                                {/^(Storage Rent|Refundable \/ Adjustable Security Deposit)/.test(it.itemDetails ?? '') ? '1' : '—'}
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
    const navigate = useNavigate()
    const qc = useQueryClient()
    const [paying, setPaying] = useState(false)
    const [editing, setEditing] = useState(false)
    const [editingPayment, setEditingPayment] = useState<{ idx: number; amount: string; method: string; date: string; notes: string } | null>(null)
    const [deletingPaymentIdx, setDeletingPaymentIdx] = useState<number | null>(null)

    const { data: invoice, isLoading } = useQuery<Invoice>({
        queryKey: ['invoice', id],
        queryFn: () => invoiceApi.get(id!),
        enabled: !!id,
    })

    const invalidate = () => { qc.invalidateQueries({ queryKey: ['invoice', id] }); qc.invalidateQueries({ queryKey: ['invoices'] }) }

    const updatePayment = useMutation({
        mutationFn: (p: { idx: number; amount: string; method: string; date: string; notes: string }) =>
            api.put(`/invoices/${id}/payments/${p.idx}`, { amount: Number(p.amount), method: p.method, date: p.date, notes: p.notes }),
        onSuccess: () => { setEditingPayment(null); invalidate() },
    })

    const deletePayment = useMutation({
        mutationFn: (idx: number) => api.delete(`/invoices/${id}/payments/${idx}`),
        onSuccess: () => { setDeletingPaymentIdx(null); invalidate() },
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

    const syncZoho = useMutation({
        mutationFn: () => api.post(`/invoices/${id}/sync-zoho-books`).then(r => r.data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invoice', id] })
            qc.invalidateQueries({ queryKey: ['invoices'] })
        },
        onError: () => { /* error shown inline via syncZoho.error */ },
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

    const paid = Math.min(invoice.paymentMade ?? 0, invoice.total)
    const balance = Math.max(0, invoice.total - paid)
    const canPay = !['cancelled'].includes(invoice.status)

    return (
        <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
                <button onClick={() => navigate(-1)} className="hover:opacity-70 transition-opacity" style={{ color: MUTED }}>
                    <ArrowLeft size={18} />
                </button>
                <div className="flex-1 min-w-0">
                    <div style={{ ...HEADING, fontSize: 22, fontWeight: 700, color: INK }} className="font-mono">{invoice.invoiceNo}</div>
                    {invoice.customer?.fullName && (
                        <div style={{ fontSize: 14, color: MUTED, marginTop: 2 }}>{invoice.customer.fullName}</div>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    <span style={{ width: 7, height: 7, borderRadius: 4, background: statusDot[invoice.status] }} />
                    <Badge tone={invoiceStatusTone[invoice.status]}>{invoiceLabel(invoice.status)}</Badge>
                </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 mb-7">
                {invoice.status === 'draft' && (
                    <Button size="sm" variant="outline" onClick={() => updateStatus.mutate('sent')} disabled={updateStatus.isPending}>
                        Mark as Sent
                    </Button>
                )}
                {invoice.status !== 'cancelled' && (
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                        <Pencil size={13} /> Edit
                    </Button>
                )}
                <Button
                    size="sm" variant="outline"
                    onClick={() => whatsapp.mutate()} disabled={whatsapp.isPending}
                    className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                >
                    <MessageCircle size={13} />
                    {whatsapp.isPending ? 'Generating…' : 'WhatsApp'}
                </Button>
                <Button size="sm" variant="outline" onClick={openPdf}>
                    <Download size={14} /> PDF
                </Button>
                <Button
                    size="sm" variant="outline"
                    onClick={() => syncZoho.mutate()} disabled={syncZoho.isPending}
                    className={invoice.zohoBooksSyncId ? 'text-emerald-600 border-emerald-300' : invoice.zohoBooksSyncError ? 'text-red-600 border-red-300' : ''}
                    title={invoice.zohoBooksSyncId ? `Synced to Zoho Books on ${new Date(invoice.zohoBooksSyncedAt!).toLocaleDateString()}` : invoice.zohoBooksSyncError ? `Sync failed: ${invoice.zohoBooksSyncError}` : 'Sync to Zoho Books'}
                >
                    <RefreshCw size={13} className={syncZoho.isPending ? 'animate-spin' : ''} />
                    {syncZoho.isPending ? 'Syncing…' : invoice.zohoBooksSyncId ? 'Synced' : 'Sync to Zoho'}
                </Button>
                {invoice.zohoBooksSyncId && (
                    <a
                        href={`https://books.zoho.com/app/908459713#/invoices/${invoice.zohoBooksSyncId}`}
                        target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                    >
                        Open in Zoho ↗
                    </a>
                )}
                {canPay && (
                    <Button size="sm" variant="success" onClick={() => setPaying(true)}>
                        Record Payment
                    </Button>
                )}
            </div>

            {/* Zoho sync error */}
            {(syncZoho.error || (invoice.zohoBooksSyncError && !invoice.zohoBooksSyncId)) && (
                <div className="flex items-start gap-2 mb-4" style={{ background: '#FEF2F2', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '12px 16px' }}>
                    <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={15} />
                    <div style={{ fontSize: 12, color: '#B91C1C' }}>
                        <span className="font-semibold">Zoho Books sync failed: </span>
                        {syncZoho.error ? apiError(syncZoho.error) : invoice.zohoBooksSyncError}
                    </div>
                </div>
            )}

            {/* What's Next banner */}
            <WhatNext invoice={invoice} onRecordPayment={() => setPaying(true)} />

            {/* Details + Payment summary */}
            <div className="grid gap-4 lg:grid-cols-3 mb-6">
                {/* Invoice details */}
                <div className="lg:col-span-2 relative overflow-hidden" style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
                    {invoice.status === 'overdue' && <CornerRibbon label="Overdue" color="amber" />}
                    {invoice.status === 'paid' && <CornerRibbon label="Paid" color="green" />}
                    <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK, marginBottom: 16 }}>{docLabel(invoice)} Details</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Bill To</div>
                            <p style={{ fontWeight: 600, color: INK }}>{invoice.customer?.fullName || '—'}</p>
                            {invoice.customer?.address && <p style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{invoice.customer.address}</p>}
                            {invoice.customer?.email && <p style={{ fontSize: 12, color: MUTED }}>{invoice.customer.email}</p>}
                            {invoice.customer?.phone && <p style={{ fontSize: 12, color: MUTED }}>{invoice.customer.phone}</p>}
                        </div>
                        <div className="space-y-3">
                            <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{docLabel(invoice)} Date</div>
                                <div style={{ fontSize: 13, color: INK }}>{formatDate(invoice.invoiceDate)}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Due Date</div>
                                <div style={{ fontSize: 13, color: INK }}>{formatDate(invoice.dueDate)}</div>
                            </div>
                            {invoice.terms && (
                                <div>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Terms</div>
                                    <div style={{ fontSize: 13, color: INK }}>{invoice.terms}</div>
                                </div>
                            )}
                            {invoice.orderNumber && (
                                <div>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Order #</div>
                                    <div style={{ fontSize: 13, color: INK }}>{invoice.orderNumber}</div>
                                </div>
                            )}
                            {invoice.salesperson && (
                                <div>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Salesperson</div>
                                    <div style={{ fontSize: 13, color: INK }}>{invoice.salesperson}</div>
                                </div>
                            )}
                        </div>
                    </div>

                    {invoice.bankInformation && (
                        <div className="mt-4">
                            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Bank Information</div>
                            <div style={{ background: '#FAF8F5', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: INK, whiteSpace: 'pre-line' }}>{invoice.bankInformation}</div>
                        </div>
                    )}
                    {invoice.subject && (
                        <div className="mt-4">
                            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Subject</div>
                            <div style={{ fontSize: 13, color: INK }}>{invoice.subject}</div>
                        </div>
                    )}
                    {invoice.customerNotes && (
                        <div className="mt-4">
                            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notes</div>
                            <div style={{ fontSize: 13, color: MUTED }}>{invoice.customerNotes}</div>
                        </div>
                    )}
                </div>

                {/* Payment summary */}
                <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 24px' }}>
                    <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK, marginBottom: 16 }}>Payment Summary</div>
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between py-2" style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                            <span style={{ color: MUTED }}>{docLabel(invoice)} Total</span>
                            <span style={{ fontWeight: 500, color: INK }}>AED {formatMoney(invoice.total)}</span>
                        </div>
                        <div className="flex justify-between py-2" style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                            <span style={{ color: MUTED }}>Amount Paid</span>
                            <span style={{ fontWeight: 500, color: '#059669' }}>AED {formatMoney(paid)}</span>
                        </div>
                        <div className="flex justify-between py-2">
                            <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>Balance Due</span>
                            <span style={{ fontSize: 14, fontWeight: 700, color: balance > 0 ? '#EF4444' : '#059669' }}>AED {formatMoney(balance)}</span>
                        </div>
                    </div>
                    {canPay && (
                        <Button variant="success" className="w-full mt-4" size="sm" onClick={() => setPaying(true)}>
                            Record Payment
                        </Button>
                    )}
                </div>
            </div>

            {/* Items table */}
            <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden', marginBottom: 24 }}>
                <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                    <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK }}>Items</div>
                </div>
                <div className="overflow-x-auto">
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                                <th style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>#</th>
                                <th style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Item & Description</th>
                                <th style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: MUTED, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Qty</th>
                                <th style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: MUTED, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rate (AED)</th>
                                {(invoice.items || []).some(it => (it.discountPct ?? 0) > 0) && (
                                    <th style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: MUTED, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Discount</th>
                                )}
                                <th style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: MUTED, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Amount (AED)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {consolidateItems(invoice.items).map((it, idx) => {
                                const hasDiscount = consolidateItems(invoice.items).some(i => (i.discountPct ?? 0) > 0)
                                const discounted = (it.discountPct ?? 0) > 0
                                return (
                                    <tr key={idx} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)', background: discounted ? 'rgba(245,158,11,0.06)' : undefined }} className="hover:bg-[#FAF8F5] transition-colors">
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED }}>{idx + 1}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: INK, whiteSpace: 'pre-line' }}>
                                            {it.itemDetails}
                                            {it.description && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{it.description}</div>}
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED, textAlign: 'right' }}>
                                            {/^(Storage Rent|Refundable \/ Adjustable Security Deposit)/.test(it.itemDetails ?? '') ? '1' : '—'}
                                        </td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                            {discounted
                                                ? <span style={{ textDecoration: 'line-through', color: MUTED }}>{formatMoney(it.rate)}</span>
                                                : <span style={{ color: INK }}>{formatMoney(it.rate)}</span>
                                            }
                                        </td>
                                        {hasDiscount && (
                                            <td style={{ padding: '12px 16px', fontSize: 13, textAlign: 'right' }}>
                                                {discounted
                                                    ? <span style={{ color: '#D97706', fontWeight: 500 }}>{it.discountPct}% off</span>
                                                    : <span style={{ color: MUTED }}>—</span>
                                                }
                                            </td>
                                        )}
                                        <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: INK, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(it.amount)}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
                <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(20,8,31,0.06)', background: '#FAF8F5' }}>
                    <div className="flex flex-col items-end gap-1">
                        <div className="flex gap-8" style={{ fontSize: 13, color: MUTED }}>
                            <span>Sub Total</span>
                            <span style={{ width: 112, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: INK }}>{formatMoney(invoice.subTotal)}</span>
                        </div>
                        {invoice.vatEnabled && (
                            <div className="flex gap-8" style={{ fontSize: 13, color: MUTED }}>
                                <span>VAT ({invoice.vatPct ?? 5}%)</span>
                                <span style={{ width: 112, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(invoice.vatAmount ?? 0)}</span>
                            </div>
                        )}
                        <div className="flex gap-8 border-t pt-1.5" style={{ fontSize: 16, fontWeight: 700, color: PURPLE, ...HEADING }}>
                            <span>Total</span>
                            <span style={{ width: 112, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>AED {formatMoney(invoice.total)}</span>
                        </div>
                        {paid > 0 && (
                            <>
                                <div className="flex gap-8" style={{ fontSize: 13, color: '#EF4444' }}>
                                    <span>Payment Made</span>
                                    <span style={{ width: 112, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>(-) {formatMoney(paid)}</span>
                                </div>
                                <div className="flex gap-8" style={{ fontSize: 14, fontWeight: 700 }}>
                                    <span style={{ color: INK }}>Balance Due</span>
                                    <span style={{ width: 112, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: balance > 0 ? '#EF4444' : '#059669' }}>{formatMoney(balance)}</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Payment history */}
            {(invoice.paymentHistory ?? []).length > 0 && (
                <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden', marginBottom: 24 }}>
                    <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                        <div style={{ ...HEADING, fontSize: 15, fontWeight: 700, color: INK }}>Payment History ({invoice.paymentHistory!.length})</div>
                    </div>
                    <div className="overflow-x-auto">
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                                    {['#', 'Date', 'Amount (AED)', 'Method', 'Notes', ''].map((h, i) => (
                                        <th key={h || i} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 600, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {invoice.paymentHistory!.map((p, idx) => (
                                    <tr key={idx} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED }}>{idx + 1}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: INK }}>{formatDate(p.date)}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600, color: '#059669', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(p.amount)}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: INK, textTransform: 'capitalize' }}>{p.method.replace('_', ' ')}</td>
                                        <td style={{ padding: '12px 16px', fontSize: 13, color: MUTED }}>{p.notes || '—'}</td>
                                        <td style={{ padding: '12px 16px' }}>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingPayment({
                                                        idx,
                                                        amount: String(p.amount),
                                                        method: p.method,
                                                        date: p.date ? new Date(p.date).toISOString().slice(0, 10) : '',
                                                        notes: p.notes || '',
                                                    })}
                                                    className="p-1.5 rounded-md hover:bg-muted transition-colors"
                                                    title="Edit payment"
                                                >
                                                    <Pencil size={13} style={{ color: MUTED }} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setDeletingPaymentIdx(idx)}
                                                    className="p-1.5 rounded-md hover:bg-red-50 transition-colors"
                                                    title="Delete payment"
                                                >
                                                    <Trash2 size={13} className="text-red-500" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Edit payment modal */}
            <Modal open={!!editingPayment} onClose={() => setEditingPayment(null)} title="Edit Payment">
                {editingPayment && (
                    <form onSubmit={(e: FormEvent) => { e.preventDefault(); updatePayment.mutate(editingPayment) }} className="space-y-4">
                        <Field label="Date">
                            <Input type="date" value={editingPayment.date} onChange={(e) => setEditingPayment({ ...editingPayment, date: e.target.value })} />
                        </Field>
                        <Field label="Amount (AED)">
                            <Input type="number" step="0.01" min="0.01" value={editingPayment.amount} onChange={(e) => setEditingPayment({ ...editingPayment, amount: e.target.value })} />
                        </Field>
                        <Field label="Method">
                            <Select value={editingPayment.method} onChange={(e) => setEditingPayment({ ...editingPayment, method: e.target.value })}>
                                <option value="cash">Cash</option>
                                <option value="bank_transfer">Bank Transfer</option>
                                <option value="card">Card</option>
                                <option value="cheque">Cheque</option>
                                <option value="other">Other</option>
                            </Select>
                        </Field>
                        <Field label="Notes">
                            <Input value={editingPayment.notes} onChange={(e) => setEditingPayment({ ...editingPayment, notes: e.target.value })} placeholder="Optional" />
                        </Field>
                        {updatePayment.isError && <p className="text-sm text-destructive">{apiError(updatePayment.error)}</p>}
                        <div className="flex justify-end gap-2 pt-2">
                            <Button type="button" variant="outline" onClick={() => setEditingPayment(null)}>Cancel</Button>
                            <Button type="submit" disabled={updatePayment.isPending}>
                                {updatePayment.isPending ? 'Saving…' : 'Save'}
                            </Button>
                        </div>
                    </form>
                )}
            </Modal>

            {/* Delete payment confirmation */}
            <Modal open={deletingPaymentIdx !== null} onClose={() => setDeletingPaymentIdx(null)} title="Delete Payment">
                <p className="text-sm mb-4">Are you sure you want to delete this payment record? This will update the invoice balance.</p>
                {deletePayment.isError && <p className="text-sm text-destructive mb-4">{apiError(deletePayment.error)}</p>}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setDeletingPaymentIdx(null)}>Cancel</Button>
                    <Button variant="destructive" disabled={deletePayment.isPending} onClick={() => { if (deletingPaymentIdx !== null) deletePayment.mutate(deletingPaymentIdx) }}>
                        {deletePayment.isPending ? 'Deleting…' : 'Delete'}
                    </Button>
                </div>
            </Modal>

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

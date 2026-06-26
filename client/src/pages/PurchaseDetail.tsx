import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Paperclip, AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import { apiError, purchaseApi } from '../lib/api'
import type { Purchase, PurchaseAttachment, PurchasePaymentEntry, PurchaseStatus } from '../lib/types'
import {
    Badge, Button, Card, CardBody, CardHeader, CornerRibbon,
    Field, Input, Modal, Select, Spinner, Table, Td, Th, statusLabel,
} from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const CO = {
    name: 'PurpleBox',
    tagline: 'powered by short term storage',
    addr1: 'Al Quoz 2, Warehouse 12, ABA Avenue',
    addr2: 'Dubai 333759',
    country: 'U.A.E',
    phone: '0097143293924',
    email: 'contact@purplebox.ae',
}

const statusTone: Record<PurchaseStatus, string> = {
    draft: 'gray', sent: 'blue', received: 'green', partial: 'amber', cancelled: 'red',
}

function billStatusLabel(s: PurchaseStatus) {
    if (s === 'received') return 'Paid'
    return statusLabel(s)
}

function WhatNext({ purchase, onRecordPayment }: { purchase: Purchase; onRecordPayment: () => void }) {
    const paid = purchase.paymentMade ?? 0
    const balance = Math.max(0, purchase.total - paid)

    if (purchase.status === 'received') {
        return (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 px-5 py-4">
                <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={18} />
                <div>
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Bill Paid</p>
                    <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">This bill has been paid in full.</p>
                </div>
            </div>
        )
    }
    if (purchase.status === 'cancelled') {
        return (
            <div className="mb-5 flex items-start gap-3 rounded-xl border bg-muted/50 px-5 py-4">
                <AlertCircle className="text-muted-foreground shrink-0 mt-0.5" size={18} />
                <div>
                    <p className="text-sm font-semibold">Cancelled</p>
                    <p className="text-xs text-muted-foreground mt-0.5">This bill has been cancelled.</p>
                </div>
            </div>
        )
    }
    const isOverdue = purchase.dueDate && new Date(purchase.dueDate) < new Date() && purchase.status !== 'received'
    if (isOverdue) {
        return (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 px-5 py-4">
                <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={18} />
                <div>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-400">Payment Overdue</p>
                    <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">
                        Balance due: <strong>AED {formatMoney(balance)}</strong>.{' '}
                        <button className="underline hover:no-underline cursor-pointer" onClick={onRecordPayment}>Record payment</button>
                    </p>
                </div>
            </div>
        )
    }
    return (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 px-5 py-4">
            <Clock className="text-amber-600 shrink-0 mt-0.5" size={18} />
            <div>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Payment Pending</p>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                    Balance due: <strong>AED {formatMoney(balance)}</strong>
                    {purchase.dueDate ? `. Due on ${formatDate(purchase.dueDate)}.` : '.'}{' '}
                    <button className="underline hover:no-underline cursor-pointer" onClick={onRecordPayment}>Record payment</button>
                </p>
            </div>
        </div>
    )
}

function RecordPaymentModal({ purchaseId, onClose }: { purchaseId: string; onClose: () => void }) {
    const qc = useQueryClient()
    const [amount, setAmount] = useState('')
    const [method, setMethod] = useState('bank_transfer')
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
    const [notes, setNotes] = useState('')
    const [err, setErr] = useState('')

    const { data: p } = useQuery<Purchase>({
        queryKey: ['purchase', purchaseId],
        queryFn: () => purchaseApi.get(purchaseId),
    })

    const history: PurchasePaymentEntry[] = p?.paymentHistory ?? []
    const paid = p?.paymentMade ?? 0
    const total = p?.total ?? 0
    const balance = Math.max(0, total - paid)

    const record = useMutation({
        mutationFn: (body: { amount: number; method: string; date: string; notes?: string }) =>
            purchaseApi.recordPayment(purchaseId, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['purchase', purchaseId] })
            qc.invalidateQueries({ queryKey: ['purchases'] })
            setAmount(''); setNotes(''); setErr('')
        },
        onError: (e) => setErr(apiError(e)),
    })

    const deletePmt = useMutation({
        mutationFn: (idx: number) => purchaseApi.deletePayment(purchaseId, idx),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['purchase', purchaseId] })
            qc.invalidateQueries({ queryKey: ['purchases'] })
        },
    })

    function submit(e: FormEvent) {
        e.preventDefault()
        const n = Number(amount)
        if (!n || n <= 0) { setErr('Enter a valid amount'); return }
        record.mutate({ amount: n, method, date, notes: notes || undefined })
    }

    if (!p) return <Spinner />

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                <div>
                    <div className="text-xs text-muted-foreground">Bill total</div>
                    <div className="font-semibold">{formatMoney(total)}</div>
                </div>
                <div>
                    <div className="text-xs text-muted-foreground">Amount paid</div>
                    <div className="font-semibold text-emerald-600">{formatMoney(paid)}</div>
                </div>
                <div>
                    <div className="text-xs text-muted-foreground">Balance due</div>
                    <div className={`font-semibold ${balance > 0 ? 'text-destructive' : 'text-emerald-600'}`}>{formatMoney(balance)}</div>
                </div>
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
                                    {p.notes && <span className="text-muted-foreground truncate max-w-32">{p.notes}</span>}
                                </div>
                                <button className="text-xs text-destructive hover:underline cursor-pointer"
                                    onClick={() => { if (confirm('Remove this payment entry?')) deletePmt.mutate(idx) }}>
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
                            <Input type="number" min={0.01} step="0.01" placeholder={String(balance)}
                                value={amount} onChange={(e) => setAmount(e.target.value)} required />
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

function PdfView({ purchase }: { purchase: Purchase }) {
    const paid = purchase.paymentMade ?? 0
    const balance = Math.max(0, purchase.total - paid)
    const vendorDisplay = purchase.vendor?.contactName || purchase.vendorName || '—'

    return (
        <div className="bg-white text-gray-800 rounded-xl border shadow-sm p-8 max-w-3xl mx-auto text-sm print:shadow-none print:border-none">
            {/* Header */}
            <div className="flex justify-between items-start mb-6">
                {/* Company block */}
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        {/* Logo placeholder matching the squirrel logo color */}
                        <div className="w-10 h-10 rounded bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-lg">P</div>
                        <div>
                            <div className="font-bold text-purple-700 text-base leading-tight">PurpleBox</div>
                            <div className="text-xs text-gray-500">{CO.tagline}</div>
                        </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-3 space-y-0.5">
                        <div>{CO.addr1}</div>
                        <div>{CO.addr2}</div>
                        <div>{CO.country}</div>
                        <div>{CO.phone}</div>
                        <div>{CO.email}</div>
                    </div>
                </div>

                {/* Bill title block */}
                <div className="text-right">
                    <div className="text-3xl font-bold text-gray-700 mb-2">BILL</div>
                    <div className="text-xs text-gray-500">Bill# <span className="font-semibold text-gray-700">{purchase.purchaseNo}</span></div>
                    {purchase.orderNumber && (
                        <div className="text-xs text-gray-500 mt-0.5">Bill No: <span className="font-semibold text-gray-700">{purchase.orderNumber}</span></div>
                    )}
                    <div className="mt-3 text-xs text-gray-500">Balance Due</div>
                    <div className="text-xl font-bold text-gray-900">AED{formatMoney(balance)}</div>
                </div>
            </div>

            {/* Date / vendor row */}
            <div className="flex justify-between items-start mb-6 pt-4 border-t">
                <div>
                    <div className="text-xs text-gray-400 mb-0.5">Bill From</div>
                    {purchase.vendor?._id
                        ? <Link to={`/vendors/${purchase.vendor._id}`} className="text-blue-600 font-medium hover:underline">{vendorDisplay}</Link>
                        : <div className="text-blue-600 font-medium">{vendorDisplay}</div>
                    }
                    {purchase.vendor?.email && <div className="text-xs text-gray-500">{purchase.vendor.email}</div>}
                    {purchase.vendor?.phone && <div className="text-xs text-gray-500">{purchase.vendor.phone}</div>}
                    {purchase.projectName && <div className="text-xs text-gray-500 mt-1">Project: {purchase.projectName}</div>}
                    {purchase.customerName && <div className="text-xs text-gray-500">Customer: {purchase.customerName}</div>}
                </div>
                <div className="text-right space-y-1 text-xs">
                    <div className="flex gap-6 justify-end">
                        <span className="text-gray-400">Bill Date :</span>
                        <span className="font-medium w-28 text-right">{formatDate(purchase.purchaseDate)}</span>
                    </div>
                    {purchase.dueDate && (
                        <div className="flex gap-6 justify-end">
                            <span className="text-gray-400">Due Date :</span>
                            <span className="font-medium w-28 text-right">{formatDate(purchase.dueDate)}</span>
                        </div>
                    )}
                    {purchase.terms && (
                        <div className="flex gap-6 justify-end">
                            <span className="text-gray-400">Terms :</span>
                            <span className="font-medium w-28 text-right">{purchase.terms}</span>
                        </div>
                    )}
                    {purchase.currencyCode && purchase.currencyCode !== 'AED' && (
                        <div className="flex gap-6 justify-end">
                            <span className="text-gray-400">Currency :</span>
                            <span className="font-medium w-28 text-right">{purchase.currencyCode}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Items table */}
            <table className="w-full text-sm mb-4">
                <thead>
                    <tr className="bg-gray-800 text-white">
                        <th className="px-3 py-2 text-left w-8">#</th>
                        <th className="px-3 py-2 text-left">Item &amp; Description</th>
                        {purchase.items.some(it => it.account) && <th className="px-3 py-2 text-left">Account</th>}
                        <th className="px-3 py-2 text-right w-16">Qty</th>
                        <th className="px-3 py-2 text-right w-24">Rate</th>
                        <th className="px-3 py-2 text-right w-28">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {(purchase.items ?? []).map((it, idx) => (
                        <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                            <td className="px-3 py-2">
                                <div className="font-medium">{it.itemDetails}</div>
                                {it.sku && <div className="text-xs text-gray-400">SKU: {it.sku}</div>}
                            </td>
                            {purchase.items.some(i => i.account) && (
                                <td className="px-3 py-2 text-xs text-gray-500">{it.account || '—'}</td>
                            )}
                            <td className="px-3 py-2 text-right">{it.quantity.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right">{formatMoney(it.rate)}</td>
                            <td className="px-3 py-2 text-right font-medium">{formatMoney(it.amount)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Totals */}
            <div className="flex justify-end">
                <div className="w-64 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-500">Sub Total</span>
                        <span>{formatMoney(purchase.subTotal)}</span>
                    </div>
                    {(purchase.taxAmount ?? 0) > 0 && (
                        <div className="flex justify-between text-gray-500">
                            <span>{purchase.taxName || 'Tax'}{purchase.taxPercentage ? ` (${purchase.taxPercentage}%)` : ''}</span>
                            <span>{formatMoney(purchase.taxAmount ?? 0)}</span>
                        </div>
                    )}
                    {(purchase.adjustment ?? 0) !== 0 && (
                        <div className="flex justify-between text-gray-500">
                            <span>{purchase.adjustmentDescription || 'Adjustment'}</span>
                            <span>{formatMoney(purchase.adjustment ?? 0)}</span>
                        </div>
                    )}
                    <div className="flex justify-between font-bold text-base border-t pt-1.5">
                        <span>Total</span>
                        <span>AED{formatMoney(purchase.total)}</span>
                    </div>
                    {paid > 0 && (
                        <>
                            <div className="flex justify-between text-gray-500">
                                <span>Payment Made</span>
                                <span className="text-emerald-600">(-) {formatMoney(paid)}</span>
                            </div>
                            <div className="flex justify-between font-bold border-t pt-1.5">
                                <span>Balance Due</span>
                                <span className={balance > 0 ? 'text-red-600' : 'text-emerald-600'}>AED{formatMoney(balance)}</span>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Notes */}
            {purchase.vendorNotes && (
                <div className="mt-6 border-t pt-4">
                    <div className="text-xs text-gray-400 mb-1">Vendor Notes</div>
                    <div className="text-xs text-gray-600 whitespace-pre-line">{purchase.vendorNotes}</div>
                </div>
            )}
            {purchase.termsAndConditions && (
                <div className="mt-4">
                    <div className="text-xs text-gray-400 mb-1">Terms &amp; Conditions</div>
                    <div className="text-xs text-gray-600 whitespace-pre-line">{purchase.termsAndConditions}</div>
                </div>
            )}
        </div>
    )
}

function PurchaseAttachmentManager({ purchase }: { purchase: Purchase }) {
    const qc = useQueryClient()
    const [err, setErr] = useState('')

    const upload = useMutation({
        mutationFn: (form: FormData) => purchaseApi.uploadAttachments(purchase._id, form),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase', purchase._id] }); setErr('') },
        onError: (e) => setErr(apiError(e)),
    })

    const remove = useMutation({
        mutationFn: (idx: number) => purchaseApi.removeAttachment(purchase._id, idx),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase', purchase._id] }),
        onError: (e) => setErr(apiError(e)),
    })

    function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files
        if (!files?.length) return
        const form = new FormData()
        for (const file of files) {
            if (file.size > 10 * 1024 * 1024) { setErr(`${file.name} exceeds 10 MB`); return }
            form.append('files', file)
        }
        upload.mutate(form)
        e.currentTarget.value = ''
    }

    const attachments: PurchaseAttachment[] = purchase.attachments ?? []

    return (
        <Card className="mt-4">
            <CardHeader
                title={`Attachments${attachments.length ? ` (${attachments.length})` : ''}`}
                action={
                    <label className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer">
                        {upload.isPending ? 'Uploading…' : <><Paperclip size={13} /> Attach files</>}
                        <input type="file" className="hidden" multiple accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx" onChange={onPickFiles} disabled={upload.isPending} />
                    </label>
                }
            />
            <CardBody>
                {err && <p className="text-xs text-destructive mb-2">{err}</p>}
                {attachments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No attachments yet. Click "Attach files" to upload images or documents.</p>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                        {attachments.map((a, idx) => (
                            <div key={idx} className="group relative rounded-lg border overflow-hidden">
                                {a.mimeType?.startsWith('image/') ? (
                                    <a href={a.url} target="_blank" rel="noreferrer">
                                        <img src={a.url} alt={a.name} className="w-full h-28 object-cover" />
                                    </a>
                                ) : (
                                    <a href={a.url} target="_blank" rel="noreferrer" className="flex items-center justify-center h-28 bg-muted/40 hover:bg-muted/60 transition-colors">
                                        <Paperclip size={28} className="text-muted-foreground" />
                                    </a>
                                )}
                                <div className="px-2 py-1.5">
                                    <p className="text-xs font-medium truncate">{a.name}</p>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] text-muted-foreground">{((a.size || 0) / 1024).toFixed(1)} KB</span>
                                        <button className="text-[11px] text-destructive hover:underline cursor-pointer" onClick={() => { if (confirm('Remove this attachment?')) remove.mutate(idx) }}>Remove</button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardBody>
        </Card>
    )
}

export default function PurchaseDetail() {
    const { id } = useParams<{ id: string }>()
    const qc = useQueryClient()
    const [paying, setPaying] = useState(false)
    const [pdfView, setPdfView] = useState(true)

    const { data: purchase, isLoading } = useQuery<Purchase>({
        queryKey: ['purchase', id],
        queryFn: () => purchaseApi.get(id!),
        enabled: !!id,
    })

    const updateStatus = useMutation({
        mutationFn: (status: string) => purchaseApi.updateStatus(id!, status),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['purchase', id] })
            qc.invalidateQueries({ queryKey: ['purchases'] })
        },
    })

    if (isLoading) return <div className="flex justify-center pt-20"><Spinner /></div>
    if (!purchase) return <div className="p-6 text-sm text-muted-foreground">Bill not found.</div>

    const paid = purchase.paymentMade ?? 0
    const balance = Math.max(0, purchase.total - paid)
    const canPay = !['received', 'cancelled'].includes(purchase.status)
    const vendorDisplay = purchase.vendor?.contactName || purchase.vendorName || '—'

    return (
        <div>
            <Link to="/purchases" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
                <ArrowLeft size={13} /> Back to Purchases
            </Link>

            {/* Page header */}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold">{purchase.purchaseNo}</h1>
                        <Badge tone={statusTone[purchase.status]}>{billStatusLabel(purchase.status)}</Badge>
                    </div>
                    {purchase.vendor?._id
                        ? <Link to={`/vendors/${purchase.vendor._id}`} className="text-sm text-primary hover:underline mt-1 block">{vendorDisplay}</Link>
                        : <p className="text-sm text-muted-foreground mt-1">{vendorDisplay}</p>
                    }
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                    {/* Show PDF View toggle */}
                    <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <span className="text-muted-foreground">Show PDF View</span>
                        <button
                            role="switch"
                            aria-checked={pdfView}
                            onClick={() => setPdfView(v => !v)}
                            className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${pdfView ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                        >
                            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ${pdfView ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                    </label>

                    {purchase.status === 'draft' && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus.mutate('sent')} disabled={updateStatus.isPending}>
                            Mark as Sent
                        </Button>
                    )}
                    {purchase.status === 'sent' && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus.mutate('received')} disabled={updateStatus.isPending}>
                            Mark as Paid
                        </Button>
                    )}
                    {canPay && (
                        <Button size="sm" variant="success" onClick={() => setPaying(true)}>
                            Record Payment
                        </Button>
                    )}
                </div>
            </div>

            {/* What's Next */}
            <WhatNext purchase={purchase} onRecordPayment={() => setPaying(true)} />

            {pdfView ? (
                <PdfView purchase={purchase} />
            ) : (
                <div className="space-y-4">
                    {/* Details + summary */}
                    <div className="grid gap-4 lg:grid-cols-3">
                        <Card className="lg:col-span-2 relative overflow-hidden">
                            {purchase.status === 'received' && <CornerRibbon label="Paid" color="green" />}
                            {purchase.status === 'partial' && <CornerRibbon label="Partial" color="amber" />}
                            <CardHeader title="Bill Details" />
                            <CardBody className="space-y-4 text-sm">
                                <div className="grid grid-cols-2 gap-6">
                                    <div>
                                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Bill From</p>
                                        {purchase.vendor?._id
                                            ? <Link to={`/vendors/${purchase.vendor._id}`} className="font-semibold text-primary hover:underline">{vendorDisplay}</Link>
                                            : <p className="font-semibold">{vendorDisplay}</p>
                                        }
                                        {purchase.vendor?.email && <p className="text-muted-foreground text-xs mt-0.5">{purchase.vendor.email}</p>}
                                        {purchase.vendor?.phone && <p className="text-muted-foreground text-xs">{purchase.vendor.phone}</p>}
                                    </div>
                                    <div className="space-y-2.5">
                                        <div>
                                            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Bill Date</p>
                                            <p>{formatDate(purchase.purchaseDate)}</p>
                                        </div>
                                        {purchase.dueDate && (
                                            <div>
                                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Due Date</p>
                                                <p>{formatDate(purchase.dueDate)}</p>
                                            </div>
                                        )}
                                        {purchase.terms && (
                                            <div>
                                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Terms</p>
                                                <p>{purchase.terms}</p>
                                            </div>
                                        )}
                                        {purchase.orderNumber && (
                                            <div>
                                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Bill #</p>
                                                <p>{purchase.orderNumber}</p>
                                            </div>
                                        )}
                                        {purchase.purchaseOrderRef && (
                                            <div>
                                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">PO Ref</p>
                                                <p>{purchase.purchaseOrderRef}</p>
                                            </div>
                                        )}
                                        {purchase.projectName && (
                                            <div>
                                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Project</p>
                                                <p>{purchase.projectName}</p>
                                            </div>
                                        )}
                                        {purchase.customerName && (
                                            <div>
                                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Customer</p>
                                                <p>{purchase.customerName}</p>
                                            </div>
                                        )}
                                        {purchase.currencyCode && purchase.currencyCode !== 'AED' && (
                                            <div>
                                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Currency</p>
                                                <p>{purchase.currencyCode} {purchase.exchangeRate && purchase.exchangeRate !== 1 ? `(rate: ${purchase.exchangeRate})` : ''}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                {purchase.categories && purchase.categories.length > 0 && (
                                    <div>
                                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Categories</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {purchase.categories.map(c => (
                                                <span key={c} className="text-xs rounded bg-muted px-2 py-0.5">{c}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {purchase.vendorNotes && (
                                    <div>
                                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Vendor Notes</p>
                                        <p className="text-muted-foreground text-xs whitespace-pre-line">{purchase.vendorNotes}</p>
                                    </div>
                                )}
                            </CardBody>
                        </Card>

                        <Card>
                            <CardHeader title="Payment Summary" />
                            <CardBody className="space-y-4">
                                <div className="rounded-lg bg-muted/50 px-4 py-3 space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Bill Total</span>
                                        <span className="font-medium">AED {formatMoney(purchase.total)}</span>
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

                    {/* Items */}
                    <Card>
                        <CardHeader title="Items" />
                        <Table>
                            <thead>
                                <tr>
                                    <Th>#</Th>
                                    <Th>Item &amp; Description</Th>
                                    {purchase.items.some(it => it.account) && <Th>Account</Th>}
                                    <Th className="text-right">Qty</Th>
                                    <Th className="text-right">Rate</Th>
                                    <Th className="text-right">Amount (AED)</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {(purchase.items ?? []).map((it, idx) => (
                                    <tr key={idx} className="hover:bg-muted/50">
                                        <Td className="text-muted-foreground">{idx + 1}</Td>
                                        <Td>
                                            <div>{it.itemDetails}</div>
                                            {it.sku && <div className="text-xs text-muted-foreground">SKU: {it.sku}</div>}
                                        </Td>
                                        {purchase.items.some(i => i.account) && (
                                            <Td className="text-muted-foreground text-xs">{it.account || '—'}</Td>
                                        )}
                                        <Td className="text-right">{it.quantity.toFixed(2)}</Td>
                                        <Td className="text-right">{formatMoney(it.rate)}</Td>
                                        <Td className="text-right font-medium">{formatMoney(it.amount)}</Td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                        <div className="border-t px-5 py-3 space-y-1.5 text-sm">
                            <div className="flex justify-end gap-8">
                                <span className="text-muted-foreground">Sub Total</span>
                                <span className="w-28 text-right">{formatMoney(purchase.subTotal)}</span>
                            </div>
                            {(purchase.taxAmount ?? 0) > 0 && (
                                <div className="flex justify-end gap-8 text-muted-foreground">
                                    <span>{purchase.taxName || 'Tax'}{purchase.taxPercentage ? ` (${purchase.taxPercentage}%)` : ''}</span>
                                    <span className="w-28 text-right">{formatMoney(purchase.taxAmount ?? 0)}</span>
                                </div>
                            )}
                            {(purchase.adjustment ?? 0) !== 0 && (
                                <div className="flex justify-end gap-8 text-muted-foreground">
                                    <span>{purchase.adjustmentDescription || 'Adjustment'}</span>
                                    <span className="w-28 text-right">{formatMoney(purchase.adjustment ?? 0)}</span>
                                </div>
                            )}
                            <div className="flex justify-end gap-8 font-bold text-base border-t pt-1.5">
                                <span>Total</span>
                                <span className="w-28 text-right">AED {formatMoney(purchase.total)}</span>
                            </div>
                            {paid > 0 && (
                                <>
                                    <div className="flex justify-end gap-8 text-emerald-600">
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
                </div>
            )}

            {/* Payment history */}
            {(purchase.paymentHistory ?? []).length > 0 && (
                <Card className="mt-4">
                    <CardHeader title={`Payment History (${purchase.paymentHistory!.length})`} />
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
                            {purchase.paymentHistory!.map((p, idx) => (
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

            <PurchaseAttachmentManager purchase={purchase} />

            <Modal open={paying} onClose={() => setPaying(false)} title={`Record payment — ${purchase.purchaseNo}`} wide>
                {id && <RecordPaymentModal purchaseId={id} onClose={() => setPaying(false)} />}
            </Modal>
        </div>
    )
}

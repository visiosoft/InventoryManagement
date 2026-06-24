import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Download, Plus, Upload } from 'lucide-react'
import { api, apiError, invoiceApi, productApi } from '../lib/api'
import type { Customer, Invoice, InvoiceAttachment, InvoiceItem, InvoicePaymentEntry, InvoiceStatus, Product, Unit } from '../lib/types'
import { Badge, Button, Card, CornerRibbon, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th, statusLabel } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'cancelled']

const DEFAULT_BANK_INFORMATION =
    'Account Number: 019101745789\n' +
    'IBAN Number: AE500330000019101745789\n' +
    'Address: Unit 12, ABA Avenue Al Quoz 2, Dubai'

const invoiceStatusTone: Record<InvoiceStatus, string> = {
    draft: 'gray',
    sent: 'blue',
    paid: 'green',
    overdue: 'red',
    cancelled: 'amber',
}

function invoiceLabel(status: InvoiceStatus) {
    return status === 'draft' ? 'Quote' : statusLabel(status)
}

function isQuote(inv: Invoice) { return inv.status === 'draft' }

function calcAmount(item: Pick<InvoiceItem, 'quantity' | 'rate' | 'discountPct'>) {
    const gross = Number(item.quantity || 0) * Number(item.rate || 0)
    return Number((gross - (gross * Number(item.discountPct || 0)) / 100).toFixed(2))
}

function toLocalDateInput(d?: string) {
    if (!d) return ''
    const date = new Date(d)
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().slice(0, 10)
}

function InvoiceForm({
    customers,
    initial,
    busy,
    error,
    onSubmit,
}: {
    customers: Customer[]
    initial?: Invoice
    busy: boolean
    error: string
    onSubmit: (body: Record<string, unknown>) => void
}) {
    const todayISO = new Date().toISOString().slice(0, 10)
    const twoDaysISO = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    const VAT_PCT = 5
    const [vatEnabled, setVatEnabled] = useState(initial?.vatEnabled ?? false)
    const [invoiceDate, setInvoiceDate] = useState(toLocalDateInput(initial?.invoiceDate) || todayISO)
    const [dueDate, setDueDate] = useState(toLocalDateInput(initial?.dueDate) || twoDaysISO)

    const { data: products = [] } = useQuery<Product[]>({
      queryKey: ['products'],
      queryFn: () => productApi.list(),
    })

    const { data: units = [] } = useQuery<Unit[]>({
      queryKey: ['units'],
      queryFn: () => api.get<Unit[]>('/units').then(r => r.data),
    })

    function handleInvoiceDateChange(val: string) {
      setInvoiceDate(val)
      if (val) {
        const due = new Date(new Date(val).getTime() + 2 * 86400000).toISOString().slice(0, 10)
        setDueDate(due)
      }
    }

    const [items, setItems] = useState<InvoiceItem[]>(
        initial?.items?.length
            ? initial.items
            : [{ sortOrder: 0, itemDetails: '', quantity: 1, rate: 0, discountPct: 0, amount: 0 }]
    )

    const subTotal = useMemo(() => Number(items.reduce((s, i) => s + calcAmount(i), 0).toFixed(2)), [items])
    const vatAmount = vatEnabled ? Number((subTotal * VAT_PCT / 100).toFixed(2)) : 0
    const grossTotal = Number((subTotal + vatAmount).toFixed(2))

    function patchItem(index: number, patch: Partial<InvoiceItem>) {
        setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
    }
    function addItem() {
        setItems((prev) => [...prev, { sortOrder: prev.length, itemDetails: '', quantity: 1, rate: 0, discountPct: 0, amount: 0 }])
    }
    function removeItem(index: number) {
        setItems((prev) => prev.filter((_, i) => i !== index).map((it, i) => ({ ...it, sortOrder: i })))
    }

    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const normalizedItems = items.map((it, idx) => ({ ...it, sortOrder: idx, amount: calcAmount(it) }))
        onSubmit({
            customer: f.get('customer'),
            orderNumber: f.get('orderNumber'),
            invoiceDate: f.get('invoiceDate'),
            terms: f.get('terms'),
            dueDate: f.get('dueDate'),
            salesperson: f.get('salesperson'),
            bankInformation: f.get('bankInformation'),
            subject: f.get('subject'),
            items: normalizedItems,
            customerNotes: f.get('customerNotes'),
            subTotal,
            vatEnabled,
            vatPct: vatEnabled ? VAT_PCT : 0,
            vatAmount,
            total: grossTotal,
            paymentMade: Number(f.get('paymentMade') || 0),
            termsAndConditions: f.get('termsAndConditions'),
            status: f.get('status') || 'draft',
        })
    }

    const inputCls = 'w-full bg-transparent border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400'
    const metaInputCls = 'bg-transparent border-0 border-b border-border text-sm text-right focus:outline-none focus:border-orange-400 w-full'

    return (
        <form onSubmit={submit} className="space-y-0 text-sm">
            {/* ── Header: customer + invoice meta ── */}
            <div className="grid grid-cols-[1fr_280px] gap-6 pb-5 border-b mb-0">
                {/* Customer */}
                <div className="flex flex-col justify-center">
                    <Select name="customer" defaultValue={initial?.customer?._id || ''} required
                        className="border-dashed text-muted-foreground">
                        <option value="">Find or add a customer</option>
                        {customers.map((c) => (
                            <option key={c._id} value={c._id}>{c.fullName}</option>
                        ))}
                    </Select>
                </div>

                {/* Invoice meta */}
                <div className="space-y-1.5">
                    <div className="grid grid-cols-[130px_1fr] items-center gap-2">
                        <span className="text-orange-500 font-medium text-right text-xs">Invoice No.:</span>
                        <span className="text-right text-xs text-muted-foreground">{initial?.invoiceNo ?? 'Auto-assigned'}</span>
                    </div>
                    <div className="grid grid-cols-[130px_1fr] items-center gap-2">
                        <label className="text-orange-500 font-medium text-right text-xs">Invoice Date</label>
                        <input type="date" name="invoiceDate" value={invoiceDate} onChange={(e) => handleInvoiceDateChange(e.target.value)} required className={metaInputCls} />
                    </div>
                    <div className="grid grid-cols-[130px_1fr] items-center gap-2">
                        <label className="text-orange-500 font-medium text-right text-xs">Due Date:</label>
                        <input type="date" name="dueDate" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className={metaInputCls} />
                    </div>
                    <div className="grid grid-cols-[130px_1fr] items-center gap-2">
                        <label className="text-orange-500 font-medium text-right text-xs">Status:</label>
                        <select name="status" defaultValue={initial?.status || 'draft'}
                            className="bg-transparent border-0 border-b border-border text-sm text-right focus:outline-none focus:border-orange-400 w-full">
                            {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{invoiceLabel(s)}</option>)}
                        </select>
                    </div>
                    <div className="border-t border-border pt-1.5 grid grid-cols-[130px_1fr] items-center gap-2">
                        <span className="text-orange-500 font-medium text-right text-xs">Due:</span>
                        <span className="text-right font-semibold">{grossTotal.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            {/* ── Line items table ── */}
            <div className="mb-0">
                <table className="w-full">
                    <thead>
                        <tr className="border-y-2 border-orange-400 bg-orange-50 dark:bg-orange-950/20">
                            <th className="text-left py-2 px-3 text-orange-600 dark:text-orange-400 font-semibold uppercase text-[11px] tracking-wide">Product / Service</th>
                            <th className="text-left py-2 px-3 text-orange-600 dark:text-orange-400 font-semibold uppercase text-[11px] tracking-wide w-28">Unit Cost</th>
                            <th className="text-left py-2 px-3 text-orange-600 dark:text-orange-400 font-semibold uppercase text-[11px] tracking-wide w-24">Quantity</th>
                            <th className="text-left py-2 px-3 text-orange-600 dark:text-orange-400 font-semibold uppercase text-[11px] tracking-wide w-24">Discount %</th>
                            <th className="text-right py-2 px-3 text-orange-600 dark:text-orange-400 font-semibold uppercase text-[11px] tracking-wide w-28">Price (AED)</th>
                            <th className="w-8" />
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((it, idx) => {
                            const amount = calcAmount(it)
                            const [productName, ...descLines] = it.itemDetails.split('\n')
                            const description = descLines.join('\n')
                            return (
                                <tr key={idx} className="border-b border-border align-top group">
                                    <td className="px-3 py-2">
                                            <select
                                            value=""
                                            onChange={(e) => {
                                                const val = e.target.value
                                                if (val.startsWith('unit:')) {
                                                    const unit = units.find(u => u._id === val.slice(5))
                                                    if (unit) patchItem(idx, {
                                                        itemDetails: `Unit ${unit.unitNumber}${unit.sizeSqf ? ` · ${unit.sizeSqf} sq ft` : ''}`,
                                                        rate: unit.price ?? 0,
                                                        quantity: 1,
                                                    })
                                                } else if (val.startsWith('prod:')) {
                                                    const prod = products.find(p => p._id === val.slice(5))
                                                    if (prod) patchItem(idx, {
                                                        itemDetails: prod.name + (prod.description ? '\n' + prod.description : ''),
                                                        rate: prod.rate,
                                                        quantity: 1,
                                                    })
                                                }
                                            }}
                                            className="w-full bg-transparent border-b border-dashed border-border text-sm focus:outline-none focus:border-orange-400 pb-0.5 text-muted-foreground"
                                        >
                                            <option value="">— Select product, unit, or type below —</option>
                                            {units.length > 0 && (
                                                <optgroup label="Storage Units">
                                                    {units.map(u => (
                                                        <option key={u._id} value={`unit:${u._id}`}>
                                                            {u.unitNumber}{u.sizeSqf ? ` · ${u.sizeSqf} sq ft` : ''}{u.price ? ` — AED ${u.price}/mo` : ''} [{u.status}]
                                                        </option>
                                                    ))}
                                                </optgroup>
                                            )}
                                            {products.length > 0 && (
                                                <optgroup label="Products & Services">
                                                    {products.map(p => (
                                                        <option key={p._id} value={`prod:${p._id}`}>
                                                            {p.name} — AED {p.rate}
                                                        </option>
                                                    ))}
                                                </optgroup>
                                            )}
                                        </select>
                                        <input
                                            type="text"
                                            placeholder="Item name"
                                            value={productName}
                                            onChange={(e) => patchItem(idx, { itemDetails: e.target.value + (description ? '\n' + description : '') })}
                                            className="w-full mt-1 bg-transparent border-b border-dashed border-border/50 text-sm focus:outline-none focus:border-orange-400 pb-0.5"
                                        />
                                        <textarea
                                            placeholder="Description"
                                            value={description}
                                            onChange={(e) => patchItem(idx, { itemDetails: (productName || '') + (e.target.value ? '\n' + e.target.value : '') })}
                                            rows={1}
                                            className="w-full mt-1 text-xs text-muted-foreground bg-transparent focus:outline-none resize-none border border-dashed border-border/50 rounded px-1 py-0.5 placeholder:text-border"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <input type="number" min={0} step="0.01" value={it.rate}
                                            onChange={(e) => patchItem(idx, { rate: Number(e.target.value) })}
                                            placeholder="Unit Cost" className={inputCls} required />
                                    </td>
                                    <td className="px-3 py-2">
                                        <input type="number" min={0} step="1" value={it.quantity}
                                            onChange={(e) => patchItem(idx, { quantity: Number(e.target.value) })}
                                            placeholder="Quantity" className={inputCls} required />
                                    </td>
                                    <td className="px-3 py-2">
                                        <input type="number" min={0} max={100} step="0.01" value={it.discountPct}
                                            onChange={(e) => patchItem(idx, { discountPct: Number(e.target.value) })}
                                            placeholder="0%" className={inputCls} />
                                    </td>
                                    <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                                        AED {formatMoney(amount)}
                                    </td>
                                    <td className="px-1 py-2 text-center">
                                        {items.length > 1 && (
                                            <button type="button" onClick={() => removeItem(idx)}
                                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all text-base leading-none cursor-pointer">
                                                ×
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>

                {/* Add a line */}
                <button type="button" onClick={addItem}
                    className="w-full border border-dashed border-border py-2 text-sm text-muted-foreground hover:text-foreground hover:border-orange-400 hover:text-orange-500 transition-colors mt-0 cursor-pointer">
                    + Add A Line
                </button>
            </div>

            {/* ── Totals ── */}
            <div className="flex justify-end py-4 border-b">
                <div className="space-y-1.5 min-w-[260px]">
                    <div className="grid grid-cols-[1fr_auto] gap-8">
                        <span className="text-right text-muted-foreground">Subtotal:</span>
                        <span className="text-right w-24">AED {subTotal.toFixed(2)}</span>
                    </div>

                    {/* VAT toggle row */}
                    <div className="grid grid-cols-[1fr_auto] gap-8 items-center">
                        <label className="flex items-center justify-end gap-2 cursor-pointer select-none">
                            <span className={`text-right text-sm ${vatEnabled ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                                VAT ({VAT_PCT}%):
                            </span>
                            <button
                                type="button"
                                onClick={() => setVatEnabled(v => !v)}
                                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${vatEnabled ? 'bg-orange-500' : 'bg-muted-foreground/30'}`}
                            >
                                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${vatEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
                            </button>
                        </label>
                        <span className={`text-right w-24 ${vatEnabled ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                            AED {vatAmount.toFixed(2)}
                        </span>
                    </div>

                    <div className="grid grid-cols-[1fr_auto] gap-8 pt-1.5 border-t">
                        <span className="text-right text-orange-500 font-semibold">Gross Total:</span>
                        <span className="text-right w-24 font-semibold">AED {grossTotal.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            {/* ── Terms & Notes ── */}
            <div className="grid grid-cols-2 gap-4 py-4 border-b">
                <div>
                    <label className="text-xs font-semibold text-foreground block mb-1.5">*Terms &amp; Conditions:</label>
                    <textarea name="termsAndConditions" defaultValue={initial?.termsAndConditions || ''}
                        placeholder="Enter Terms &amp; Conditions" rows={4}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-orange-400 resize-none" />
                </div>
                <div>
                    <label className="text-xs font-semibold text-foreground block mb-1.5">*Invoice Note:</label>
                    <textarea name="customerNotes" defaultValue={initial?.customerNotes || ''}
                        placeholder="Enter Invoice Notes" rows={4}
                        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-orange-400 resize-none" />
                </div>
            </div>

            {/* ── Extra fields (hidden but kept for API) ── */}
            <input type="hidden" name="orderNumber" defaultValue={initial?.orderNumber || ''} />
            <input type="hidden" name="salesperson" defaultValue={initial?.salesperson || ''} />
            <input type="hidden" name="subject" defaultValue={initial?.subject || ''} />
            <input type="hidden" name="bankInformation" defaultValue={initial?.bankInformation || DEFAULT_BANK_INFORMATION} />
            <input type="hidden" name="paymentMade" value={initial?.paymentMade ?? 0} readOnly />

            {error && <p className="text-xs text-destructive pt-2">{error}</p>}

            {/* ── Actions ── */}
            <div className="flex justify-end gap-2 pt-4">
                <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save invoice'}</Button>
            </div>
        </form>
    )
}

function AttachmentManager({ invoice }: { invoice: Invoice }) {
    const qc = useQueryClient()
    const [uploadError, setUploadError] = useState('')
    const upload = useMutation({
        mutationFn: (form: FormData) => invoiceApi.uploadAttachments(invoice._id, form),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invoices'] })
            qc.invalidateQueries({ queryKey: ['invoice', invoice._id] })
            setUploadError('')
        },
        onError: (e) => setUploadError(apiError(e)),
    })
    const remove = useMutation({
        mutationFn: (index: number) => invoiceApi.removeAttachment(invoice._id, index),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invoices'] })
            qc.invalidateQueries({ queryKey: ['invoice', invoice._id] })
        },
    })

    function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files
        if (!files?.length) return
        if (files.length > 10) {
            setUploadError('You can upload a maximum of 10 files at once')
            return
        }
        const form = new FormData()
        for (const file of files) {
            if (file.size > 10 * 1024 * 1024) {
                setUploadError(`${file.name} exceeds 10MB limit`)
                return
            }
            form.append('files', file)
        }
        upload.mutate(form)
        e.currentTarget.value = ''
    }

    return (
        <div className="space-y-3">
            <label className="inline-flex items-center gap-2 text-xs text-primary hover:underline cursor-pointer">
                <Upload size={14} /> Attach file(s)
                <input type="file" className="hidden" multiple onChange={onPickFiles} />
            </label>
            <p className="text-[11px] text-muted-foreground">You can upload a maximum of 10 files, 10MB each.</p>
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            {(invoice.attachments || []).length === 0 ? (
                <EmptyState message="No files attached." />
            ) : (
                <div className="space-y-2">
                    {invoice.attachments.map((a: InvoiceAttachment, idx: number) => (
                        <div key={`${a.url}-${idx}`} className="rounded-lg border px-3 py-2 flex items-center justify-between">
                            <div>
                                <a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">{a.name}</a>
                                <div className="text-[11px] text-muted-foreground">{a.storage === 'drive' ? 'Google Drive' : 'Local'} · {((a.size || 0) / 1024).toFixed(1)} KB</div>
                            </div>
                            <button className="text-xs text-destructive hover:underline cursor-pointer" onClick={() => remove.mutate(idx)}>Remove</button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function RecordPaymentModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
    const qc = useQueryClient()
    const [amount, setAmount] = useState<string>('')
    const [method, setMethod] = useState('cash')
    const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
    const [notes, setNotes] = useState('')
    const [err, setErr] = useState('')

    const record = useMutation({
        mutationFn: (body: { amount: number; method: string; date: string; notes?: string }) =>
            invoiceApi.recordPayment(invoice._id, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invoices'] })
            setAmount('')
            setNotes('')
            setErr('')
        },
        onError: (e) => setErr(apiError(e)),
    })

    const deletePayment = useMutation({
        mutationFn: (idx: number) => invoiceApi.deletePayment(invoice._id, idx),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
        onError: (e) => setErr(apiError(e)),
    })

    // Use the freshest version of the invoice from the query cache
    const fresh = (qc.getQueryData<Invoice[]>(['invoices', '', '']) ?? []).find((i) => i._id === invoice._id) ?? invoice
    const history: InvoicePaymentEntry[] = fresh.paymentHistory ?? []
    const freshPaid = fresh.paymentMade ?? 0
    const freshBalance = Math.max(0, fresh.total - freshPaid)

    function submit(e: FormEvent) {
        e.preventDefault()
        const n = Number(amount)
        if (!n || n <= 0) { setErr('Enter a valid amount'); return }
        record.mutate({ amount: n, method, date, notes: notes || undefined })
    }

    return (
        <div className="space-y-5">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 px-4 py-3 text-sm">
                <div>
                    <div className="text-xs text-muted-foreground">Invoice total</div>
                    <div className="font-semibold">{formatMoney(fresh.total)}</div>
                </div>
                <div>
                    <div className="text-xs text-muted-foreground">Amount paid</div>
                    <div className="font-semibold text-emerald-600">{formatMoney(freshPaid)}</div>
                </div>
                <div>
                    <div className="text-xs text-muted-foreground">Balance due</div>
                    <div className={`font-semibold ${freshBalance > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                        {formatMoney(freshBalance)}
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
                                <div className="flex gap-4">
                                    <span className="font-medium">{formatMoney(p.amount)}</span>
                                    <span className="text-muted-foreground capitalize">{p.method.replace('_', ' ')}</span>
                                    <span className="text-muted-foreground">{formatDate(p.date)}</span>
                                    {p.notes && <span className="text-muted-foreground truncate max-w-32">{p.notes}</span>}
                                </div>
                                <button
                                    className="text-xs text-destructive hover:underline cursor-pointer"
                                    onClick={() => { if (confirm('Remove this payment?')) deletePayment.mutate(idx) }}
                                >
                                    Remove
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Add payment form */}
            {freshBalance > 0 || history.length === 0 ? (
                <form onSubmit={submit} className="space-y-3">
                    <div className="text-xs font-semibold text-muted-foreground">Record new payment</div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Amount (AED)">
                            <Input
                                type="number"
                                min={0.01}
                                step="0.01"
                                placeholder={freshBalance > 0 ? String(freshBalance) : ''}
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

export default function Invoices() {
    const qc = useQueryClient()
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('')
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<Invoice | null>(null)
    const [paying, setPaying] = useState<Invoice | null>(null)
    const [error, setError] = useState('')

    const { data: customers } = useQuery<Customer[]>({
        queryKey: ['customers', ''],
        queryFn: () => api.get('/customers').then((r) => r.data),
    })

    const { data: invoices, isLoading } = useQuery<Invoice[]>({
        queryKey: ['invoices', search, status],
        queryFn: () => invoiceApi.list({ search: search || undefined, status: status || undefined }),
    })

    const createInvoice = useMutation({
        mutationFn: (body: Record<string, unknown>) => invoiceApi.create(body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invoices'] })
            setAdding(false)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const updateInvoice = useMutation({
        mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => invoiceApi.update(id, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['invoices'] })
            setEditing(null)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const removeInvoice = useMutation({
        mutationFn: (id: string) => invoiceApi.remove(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['invoices'] }),
    })

    const openInvoicePdf = async (invoiceId: string) => {
        try {
            setError('')
            const response = await api.get(`/invoices/${invoiceId}/pdf`, { responseType: 'blob' })
            const blob = new Blob([response.data], { type: 'application/pdf' })
            const url = window.URL.createObjectURL(blob)
            window.open(url, '_blank', 'noopener,noreferrer')
            window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000)
        } catch (e) {
            setError(apiError(e))
        }
    }

    return (
        <div>
            <PageHeader
                title="Invoices & Quotes"
                subtitle={`${invoices?.length ?? 0} records`}
                action={<Button onClick={() => setAdding(true)}><Plus size={15} /> New</Button>}
            />

            <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                <Input placeholder="Search invoice #, order #, subject" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{invoiceLabel(s)}</option>)}
                </Select>
            </div>

            {isLoading ? (
                <Spinner />
            ) : (
                <Card>
                    <Table>
                        <thead>
                            <tr>
                                <Th>#</Th>
                                <Th>Customer</Th>
                                <Th>Invoice Date</Th>
                                <Th>Due Date</Th>
                                <Th>Total</Th>
                                <Th>Paid</Th>
                                <Th>Balance</Th>
                                <Th>Status</Th>
                                <Th />
                            </tr>
                        </thead>
                        <tbody>
                            {(invoices || []).map((inv) => (
                                <tr key={inv._id} className="hover:bg-muted/50">
                                    <Td className="font-medium relative overflow-hidden">
                                        {inv.status === 'overdue' && <CornerRibbon label="Overdue" color="amber" size="sm" />}
                                        {inv.status === 'paid' && <CornerRibbon label="Paid" color="green" size="sm" />}
                                        <Link to={`/invoices/${inv._id}`} className="text-primary hover:underline">
                                            {inv.invoiceNo}
                                        </Link>
                                    </Td>
                                    <Td>{inv.customer?.fullName || '—'}</Td>
                                    <Td>{formatDate(inv.invoiceDate)}</Td>
                                    <Td>{formatDate(inv.dueDate)}</Td>
                                    <Td>{formatMoney(inv.total)}</Td>
                                    <Td className="text-emerald-600">{formatMoney(inv.paymentMade ?? 0)}</Td>
                                    <Td className={Math.max(0, inv.total - (inv.paymentMade ?? 0)) > 0 ? 'text-destructive font-medium' : 'text-emerald-600'}>
                                        {formatMoney(Math.max(0, inv.total - (inv.paymentMade ?? 0)))}
                                    </Td>
                                    <Td><Badge tone={invoiceStatusTone[inv.status]}>{invoiceLabel(inv.status)}</Badge></Td>
                                    <Td>
                                        <div className="flex gap-2 text-xs">
                                            <button className="text-primary hover:underline cursor-pointer" onClick={() => setEditing(inv)}>Edit</button>
                                            <button className="text-emerald-600 hover:underline cursor-pointer" onClick={() => setPaying(inv)}>Pay</button>
                                            <button className="text-primary hover:underline cursor-pointer" onClick={() => openInvoicePdf(inv._id)}><Download size={12} className="inline mr-1" />PDF</button>
                                            <button className="text-destructive hover:underline cursor-pointer" onClick={() => { if (confirm('Delete this invoice?')) removeInvoice.mutate(inv._id) }}>Delete</button>
                                        </div>
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                    {(invoices || []).length === 0 && <EmptyState message="No invoices found." />}
                </Card>
            )}

            <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="Create invoice" wide>
                <InvoiceForm customers={customers || []} busy={createInvoice.isPending} error={error} onSubmit={(body) => createInvoice.mutate(body)} />
            </Modal>

            <Modal open={!!paying} onClose={() => setPaying(null)} title={paying ? `Record payment — ${paying.invoiceNo}` : 'Record payment'} wide>
                {paying && <RecordPaymentModal invoice={paying} onClose={() => setPaying(null)} />}
            </Modal>

            <Modal open={!!editing} onClose={() => { setEditing(null); setError('') }} title={editing ? `Edit ${editing.invoiceNo}` : 'Edit invoice'} wide>
                {editing && (
                    <div className="space-y-4">
                        <InvoiceForm
                            customers={customers || []}
                            initial={editing}
                            busy={updateInvoice.isPending}
                            error={error}
                            onSubmit={(body) => updateInvoice.mutate({ id: editing._id, body })}
                        />
                        <Card>
                            <div className="px-4 pt-3 pb-2">
                                <h3 className="text-sm font-semibold">Attach File(s) to Invoice</h3>
                            </div>
                            <div className="px-4 pb-4">
                                <AttachmentManager invoice={editing} />
                            </div>
                        </Card>
                    </div>
                )}
            </Modal>
        </div>
    )
}

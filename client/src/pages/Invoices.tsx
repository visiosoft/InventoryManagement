import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Download, Plus, Upload } from 'lucide-react'
import { api, apiError, invoiceApi } from '../lib/api'
import type { Customer, Invoice, InvoiceAttachment, InvoiceItem, InvoicePaymentEntry, InvoiceStatus } from '../lib/types'
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
    const [items, setItems] = useState<InvoiceItem[]>(
        initial?.items?.length
            ? initial.items
            : [{ sortOrder: 0, itemDetails: '', quantity: 1, rate: 0, discountPct: 0, amount: 0 }]
    )

    const subTotal = useMemo(() => Number(items.reduce((s, i) => s + calcAmount(i), 0).toFixed(2)), [items])

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
            total: subTotal,
            paymentMade: Number(f.get('paymentMade') || 0),
            termsAndConditions: f.get('termsAndConditions'),
            status: f.get('status') || 'draft',
        })
    }

    return (
        <form onSubmit={submit} className="space-y-4">
            <Field label="Customer Name">
                <Select name="customer" defaultValue={initial?.customer?._id || ''} required>
                    <option value="">Select customer</option>
                    {customers.map((c) => (
                        <option key={c._id} value={c._id}>{c.fullName}</option>
                    ))}
                </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Order Number"><Input name="orderNumber" defaultValue={initial?.orderNumber || ''} /></Field>
                <Field label="Invoice Date"><Input type="date" name="invoiceDate" defaultValue={toLocalDateInput(initial?.invoiceDate) || toLocalDateInput(new Date().toISOString())} required /></Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Terms"><Input name="terms" defaultValue={initial?.terms || ''} placeholder="Net 7 / Net 15" /></Field>
                <Field label="Due Date"><Input type="date" name="dueDate" defaultValue={toLocalDateInput(initial?.dueDate)} required /></Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Salesperson"><Input name="salesperson" defaultValue={initial?.salesperson || ''} /></Field>
                <Field label="Status">
                    <Select name="status" defaultValue={initial?.status || 'draft'}>
                        {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </Select>
                </Field>
            </div>

            <Field label="Bank Information"><Textarea name="bankInformation" defaultValue={initial?.bankInformation || DEFAULT_BANK_INFORMATION} /></Field>
            <Field label="Subject"><Input name="subject" defaultValue={initial?.subject || ''} /></Field>

            <Card>
                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Item Table</h3>
                    <Button type="button" variant="outline" size="sm" onClick={addItem}>Add item</Button>
                </div>
                <div className="px-4 pb-4 space-y-3">
                    {items.map((it, idx) => {
                        const amount = calcAmount(it)
                        return (
                            <div key={idx} className="rounded-lg border p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="text-xs font-medium">Item {idx + 1}</div>
                                    {items.length > 1 && (
                                        <button type="button" className="text-xs text-destructive hover:underline cursor-pointer" onClick={() => removeItem(idx)}>Remove</button>
                                    )}
                                </div>
                                <Field label="Item Details"><Textarea value={it.itemDetails} onChange={(e) => patchItem(idx, { itemDetails: e.target.value })} required /></Field>
                                <div className="grid grid-cols-4 gap-2">
                                    <Field label="Quantity"><Input type="number" min={0} step="1" value={it.quantity} onChange={(e) => patchItem(idx, { quantity: Number(e.target.value) })} required /></Field>
                                    <Field label="Rate"><Input type="number" min={0} step="0.01" value={it.rate} onChange={(e) => patchItem(idx, { rate: Number(e.target.value) })} required /></Field>
                                    <Field label="Discount"><Input type="number" min={0} max={100} step="0.01" value={it.discountPct} onChange={(e) => patchItem(idx, { discountPct: Number(e.target.value) })} /></Field>
                                    <Field label="Amount"><Input value={formatMoney(amount)} readOnly /></Field>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </Card>

            <div className="grid grid-cols-3 gap-3">
                <Field label="Sub Total"><Input value={subTotal.toFixed(2)} readOnly /></Field>
                <Field label="Total (AED)"><Input value={subTotal.toFixed(2)} readOnly /></Field>
                <Field label="Payment Made"><Input type="number" name="paymentMade" min={0} step="0.01" defaultValue={initial?.paymentMade ?? 0} /></Field>
            </div>

            <Field label="Customer Notes"><Textarea name="customerNotes" defaultValue={initial?.customerNotes || ''} placeholder="Will be displayed on the invoice" /></Field>
            <Field label="Terms & Conditions"><Textarea name="termsAndConditions" defaultValue={initial?.termsAndConditions || ''} /></Field>

            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save invoice'}</Button>
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
                title="Invoices"
                subtitle={`${invoices?.length ?? 0} invoices`}
                action={<Button onClick={() => setAdding(true)}><Plus size={15} /> New invoice</Button>}
            />

            <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                <Input placeholder="Search invoice #, order #, subject" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {INVOICE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
            </div>

            {isLoading ? (
                <Spinner />
            ) : (
                <Card>
                    <Table>
                        <thead>
                            <tr>
                                <Th>Invoice #</Th>
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
                                    <Td><Badge tone={invoiceStatusTone[inv.status]}>{statusLabel(inv.status)}</Badge></Td>
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

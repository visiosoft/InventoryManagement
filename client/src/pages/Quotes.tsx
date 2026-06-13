import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Plus } from 'lucide-react'
import { api, apiError, quoteApi } from '../lib/api'
import type { Customer, Quote, QuoteItem, QuoteStatus } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th, statusLabel } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const QUOTE_STATUSES: QuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired']

const quoteStatusTone: Record<QuoteStatus, string> = {
    draft: 'gray',
    sent: 'blue',
    accepted: 'green',
    rejected: 'red',
    expired: 'amber',
}

function calcAmount(item: Pick<QuoteItem, 'quantity' | 'rate' | 'discountPct'>) {
    const gross = Number(item.quantity || 0) * Number(item.rate || 0)
    return Number((gross - (gross * Number(item.discountPct || 0)) / 100).toFixed(2))
}

function toLocalDateInput(d?: string) {
    if (!d) return ''
    const date = new Date(d)
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().slice(0, 10)
}

function QuoteForm({
    customers,
    initial,
    busy,
    error,
    onSubmit,
}: {
    customers: Customer[]
    initial?: Quote
    busy: boolean
    error: string
    onSubmit: (body: Record<string, unknown>) => void
}) {
    const [items, setItems] = useState<QuoteItem[]>(
        initial?.items?.length
            ? initial.items
            : [
                {
                    sortOrder: 0,
                    itemDetails:
                        'Moving Services Including (Wrapping,packing,boxes,labour,trucks)\nPlease note that our service includes packing, wrapping, and dismantling of furniture. Our team will collect everything from your home, transport it safely, and place it securely in your storage unit. We take care of the entire process for you.',
                    quantity: 1,
                    rate: 3500,
                    discountPct: 7.14,
                    amount: 3250.1,
                },
            ]
    )

    const subTotal = useMemo(() => Number(items.reduce((s, i) => s + calcAmount(i), 0).toFixed(2)), [items])

    function patchItem(index: number, patch: Partial<QuoteItem>) {
        setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)))
    }

    function addItem() {
        setItems((prev) => [
            ...prev,
            { sortOrder: prev.length, itemDetails: '', quantity: 1, rate: 0, discountPct: 0, amount: 0 },
        ])
    }

    function removeItem(index: number) {
        setItems((prev) => prev.filter((_, i) => i !== index).map((it, i) => ({ ...it, sortOrder: i })))
    }

    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        const adjustment = Number(f.get('adjustment') || 0)
        const normalizedItems = items.map((it, idx) => ({ ...it, sortOrder: idx, amount: calcAmount(it) }))
        const total = Number((subTotal + adjustment).toFixed(2))

        onSubmit({
            quoteDate: f.get('quoteDate'),
            creationDate: f.get('creationDate'),
            salesperson: f.get('salesperson'),
            expiryDate: f.get('expiryDate'),
            pdfTemplate: f.get('pdfTemplate') || 'Standard Template',
            customer: f.get('customer'),
            billingAddress: f.get('billingAddress'),
            shippingAddress: f.get('shippingAddress'),
            subject: f.get('subject'),
            items: normalizedItems,
            subTotal,
            adjustment,
            total,
            notes: f.get('notes'),
            status: f.get('status') || 'draft',
        })
    }

    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <Field label="Quote Date">
                    <Input type="date" name="quoteDate" defaultValue={toLocalDateInput(initial?.quoteDate) || toLocalDateInput(new Date().toISOString())} required />
                </Field>
                <Field label="Creation Date">
                    <Input type="date" name="creationDate" defaultValue={toLocalDateInput(initial?.creationDate) || toLocalDateInput(new Date().toISOString())} required />
                </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Salesperson"><Input name="salesperson" defaultValue={initial?.salesperson || ''} /></Field>
                <Field label="Expiry Date"><Input type="date" name="expiryDate" defaultValue={toLocalDateInput(initial?.expiryDate)} required /></Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="PDF Template"><Input name="pdfTemplate" defaultValue={initial?.pdfTemplate || 'Standard Template'} /></Field>
                <Field label="Status">
                    <Select name="status" defaultValue={initial?.status || 'draft'}>
                        {QUOTE_STATUSES.map((s) => (
                            <option key={s} value={s}>{statusLabel(s)}</option>
                        ))}
                    </Select>
                </Field>
            </div>

            <Field label="Customer Details">
                <Select name="customer" defaultValue={initial?.customer?._id || ''} required>
                    <option value="">Select customer</option>
                    {customers.map((c) => (
                        <option key={c._id} value={c._id}>{c.fullName}</option>
                    ))}
                </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Billing Address"><Textarea name="billingAddress" defaultValue={initial?.billingAddress || ''} /></Field>
                <Field label="Shipping Address"><Textarea name="shippingAddress" defaultValue={initial?.shippingAddress || ''} /></Field>
            </div>

            <Field label="Subject"><Input name="subject" defaultValue={initial?.subject || ''} /></Field>

            <Card>
                <div className="px-4 pt-3 pb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Items</h3>
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
                                <Field label="Item details"><Textarea value={it.itemDetails} onChange={(e) => patchItem(idx, { itemDetails: e.target.value })} required /></Field>
                                <div className="grid grid-cols-4 gap-2">
                                    <Field label="Qty"><Input type="number" min={0} step="1" value={it.quantity} onChange={(e) => patchItem(idx, { quantity: Number(e.target.value) })} required /></Field>
                                    <Field label="Price"><Input type="number" min={0} step="0.01" value={it.rate} onChange={(e) => patchItem(idx, { rate: Number(e.target.value) })} required /></Field>
                                    <Field label="Discount %"><Input type="number" min={0} max={100} step="0.01" value={it.discountPct} onChange={(e) => patchItem(idx, { discountPct: Number(e.target.value) })} /></Field>
                                    <Field label="Amount"><Input value={formatMoney(amount)} readOnly /></Field>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </Card>

            <div className="grid grid-cols-3 gap-3">
                <Field label="Sub Total"><Input value={formatMoney(subTotal)} readOnly /></Field>
                <Field label="Adjustment"><Input name="adjustment" type="number" step="0.01" defaultValue={initial?.adjustment ?? 0} /></Field>
                <Field label="Total"><Input value={formatMoney(Number((subTotal + Number(initial?.adjustment || 0)).toFixed(2)))} readOnly /></Field>
            </div>

            <Field label="Notes"><Textarea name="notes" defaultValue={initial?.notes || `Bank: Mashreq\nSHORT TERM STORAGE LLC\nAccount Number: 019101745789\nIBAN Number: AE500330000019101745789\nAddress: Unit 12, ABA Avenue Al Quoz 2, Dubai`} /></Field>

            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save quote'}</Button>
        </form>
    )
}

export default function Quotes() {
    const qc = useQueryClient()
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('')
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<Quote | null>(null)
    const [error, setError] = useState('')

    const { data: customers } = useQuery<Customer[]>({
        queryKey: ['customers', ''],
        queryFn: () => api.get('/customers').then((r) => r.data),
    })

    const { data: quotes, isLoading } = useQuery<Quote[]>({
        queryKey: ['quotes', search, status],
        queryFn: () => quoteApi.list({ search: search || undefined, status: status || undefined }),
    })

    const createQuote = useMutation({
        mutationFn: (body: Record<string, unknown>) => quoteApi.create(body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['quotes'] })
            setAdding(false)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const updateQuote = useMutation({
        mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => quoteApi.update(id, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['quotes'] })
            setEditing(null)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const removeQuote = useMutation({
        mutationFn: (id: string) => quoteApi.remove(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
    })

    const openQuotePdf = async (quoteId: string) => {
        try {
            setError('')
            const response = await api.get(`/quotes/${quoteId}/pdf`, { responseType: 'blob' })
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
                title="Quotes"
                subtitle={`${quotes?.length ?? 0} quotes`}
                action={<Button onClick={() => setAdding(true)}><Plus size={15} /> New quote</Button>}
            />

            <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                <Input placeholder="Search quote no, subject, salesperson" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
            </div>

            {isLoading ? (
                <Spinner />
            ) : (
                <Card>
                    <Table>
                        <thead>
                            <tr>
                                <Th>Quote #</Th>
                                <Th>Customer</Th>
                                <Th>Quote Date</Th>
                                <Th>Expiry</Th>
                                <Th>Total</Th>
                                <Th>Status</Th>
                                <Th />
                            </tr>
                        </thead>
                        <tbody>
                            {(quotes || []).map((q) => (
                                <tr key={q._id} className="hover:bg-muted/50">
                                    <Td className="font-medium">{q.quoteNo}</Td>
                                    <Td>{q.customer?.fullName || '—'}</Td>
                                    <Td>{formatDate(q.quoteDate)}</Td>
                                    <Td>{formatDate(q.expiryDate)}</Td>
                                    <Td>{formatMoney(q.total)}</Td>
                                    <Td><Badge tone={quoteStatusTone[q.status]}>{statusLabel(q.status)}</Badge></Td>
                                    <Td>
                                        <div className="flex gap-2 text-xs">
                                            <button className="text-primary hover:underline cursor-pointer" onClick={() => setEditing(q)}>Edit</button>
                                            <button className="text-primary hover:underline cursor-pointer" onClick={() => openQuotePdf(q._id)}><Download size={12} className="inline mr-1" />PDF</button>
                                            <button className="text-destructive hover:underline cursor-pointer" onClick={() => { if (confirm('Delete this quote?')) removeQuote.mutate(q._id) }}>Delete</button>
                                        </div>
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                    {(quotes || []).length === 0 && <EmptyState message="No quotes found." />}
                </Card>
            )}

            <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="Create quote" wide>
                <QuoteForm customers={customers || []} busy={createQuote.isPending} error={error} onSubmit={(body) => createQuote.mutate(body)} />
            </Modal>

            <Modal open={!!editing} onClose={() => { setEditing(null); setError('') }} title={editing ? `Edit ${editing.quoteNo}` : 'Edit quote'} wide>
                {editing && (
                    <QuoteForm
                        customers={customers || []}
                        initial={editing}
                        busy={updateQuote.isPending}
                        error={error}
                        onSubmit={(body) => updateQuote.mutate({ id: editing._id, body })}
                    />
                )}
            </Modal>
        </div>
    )
}

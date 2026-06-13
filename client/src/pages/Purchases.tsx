import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Upload } from 'lucide-react'
import { apiError, purchaseApi, vendorApi } from '../lib/api'
import type { Purchase, PurchaseAttachment, PurchaseItem, PurchaseStatus, Vendor } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th, statusLabel } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const PURCHASE_STATUSES: PurchaseStatus[] = ['draft', 'sent', 'received', 'partial', 'cancelled']

const purchaseStatusTone: Record<PurchaseStatus, string> = {
    draft: 'gray',
    sent: 'blue',
    received: 'green',
    partial: 'amber',
    cancelled: 'red',
}

function calcAmount(item: Pick<PurchaseItem, 'quantity' | 'rate' | 'discountPct'>) {
    const gross = Number(item.quantity || 0) * Number(item.rate || 0)
    return Number((gross - (gross * Number(item.discountPct || 0)) / 100).toFixed(2))
}

function toLocalDateInput(d?: string) {
    if (!d) return ''
    const date = new Date(d)
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().slice(0, 10)
}

function PurchaseForm({
    vendors,
    initial,
    busy,
    error,
    onSubmit,
}: {
    vendors: Vendor[]
    initial?: Purchase
    busy: boolean
    error: string
    onSubmit: (body: Record<string, unknown>) => void
}) {
    const [items, setItems] = useState<PurchaseItem[]>(
        initial?.items?.length
            ? initial.items
            : [{ sortOrder: 0, itemDetails: '', quantity: 1, rate: 0, discountPct: 0, amount: 0 }]
    )

    const subTotal = useMemo(() => Number(items.reduce((s, i) => s + calcAmount(i), 0).toFixed(2)), [items])

    function patchItem(index: number, patch: Partial<PurchaseItem>) {
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
            vendor: f.get('vendor'),
            orderNumber: f.get('orderNumber'),
            purchaseDate: f.get('purchaseDate'),
            terms: f.get('terms'),
            dueDate: f.get('dueDate'),
            purchaser: f.get('purchaser'),
            bankInformation: f.get('bankInformation'),
            subject: f.get('subject'),
            items: normalizedItems,
            vendorNotes: f.get('vendorNotes'),
            subTotal,
            total: subTotal,
            termsAndConditions: f.get('termsAndConditions'),
            status: f.get('status') || 'draft',
        })
    }

    return (
        <form onSubmit={submit} className="space-y-4">
            <Field label="Vendor">
                <Select name="vendor" defaultValue={initial?.vendor?._id || ''} required>
                    <option value="">Select vendor</option>
                    {vendors.map((v) => (
                        <option key={v._id} value={v._id}>{v.contactName}</option>
                    ))}
                </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Order Number"><Input name="orderNumber" defaultValue={initial?.orderNumber || ''} /></Field>
                <Field label="Purchase Date"><Input type="date" name="purchaseDate" defaultValue={toLocalDateInput(initial?.purchaseDate) || toLocalDateInput(new Date().toISOString())} required /></Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Terms"><Input name="terms" defaultValue={initial?.terms || ''} /></Field>
                <Field label="Due Date"><Input type="date" name="dueDate" defaultValue={toLocalDateInput(initial?.dueDate)} required /></Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Purchaser"><Input name="purchaser" defaultValue={initial?.purchaser || ''} /></Field>
                <Field label="Status">
                    <Select name="status" defaultValue={initial?.status || 'draft'}>
                        {PURCHASE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </Select>
                </Field>
            </div>

            <Field label="Bank Information"><Textarea name="bankInformation" defaultValue={initial?.bankInformation || ''} /></Field>
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

            <div className="grid grid-cols-2 gap-3">
                <Field label="Sub Total"><Input value={subTotal.toFixed(2)} readOnly /></Field>
                <Field label="Total"><Input value={subTotal.toFixed(2)} readOnly /></Field>
            </div>

            <Field label="Vendor Notes"><Textarea name="vendorNotes" defaultValue={initial?.vendorNotes || ''} /></Field>
            <Field label="Terms & Conditions"><Textarea name="termsAndConditions" defaultValue={initial?.termsAndConditions || ''} /></Field>

            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save purchase'}</Button>
        </form>
    )
}

function AttachmentManager({ purchase }: { purchase: Purchase }) {
    const qc = useQueryClient()
    const [uploadError, setUploadError] = useState('')

    const upload = useMutation({
        mutationFn: (form: FormData) => purchaseApi.uploadAttachments(purchase._id, form),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['purchases'] })
            setUploadError('')
        },
        onError: (e) => setUploadError(apiError(e)),
    })

    const remove = useMutation({
        mutationFn: (index: number) => purchaseApi.removeAttachment(purchase._id, index),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['purchases'] }),
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
            {(purchase.attachments || []).length === 0 ? (
                <EmptyState message="No files attached." />
            ) : (
                <div className="space-y-2">
                    {purchase.attachments.map((a: PurchaseAttachment, idx: number) => (
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

export default function Purchases() {
    const qc = useQueryClient()
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('')
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<Purchase | null>(null)
    const [error, setError] = useState('')

    const { data: vendors } = useQuery<Vendor[]>({
        queryKey: ['vendors', '', '', ''],
        queryFn: () => vendorApi.list({}),
    })

    const { data: purchases, isLoading } = useQuery<Purchase[]>({
        queryKey: ['purchases', search, status],
        queryFn: () => purchaseApi.list({ search: search || undefined, status: status || undefined }),
    })

    const createPurchase = useMutation({
        mutationFn: (body: Record<string, unknown>) => purchaseApi.create(body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['purchases'] })
            setAdding(false)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const updatePurchase = useMutation({
        mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => purchaseApi.update(id, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['purchases'] })
            setEditing(null)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const removePurchase = useMutation({
        mutationFn: (id: string) => purchaseApi.remove(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['purchases'] }),
    })

    return (
        <div>
            <PageHeader
                title="Purchases"
                subtitle={`${purchases?.length ?? 0} purchase records`}
                action={<Button onClick={() => setAdding(true)}><Plus size={15} /> New purchase</Button>}
            />

            <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                <Input placeholder="Search PO #, order #, subject" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {PURCHASE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
            </div>

            {isLoading ? (
                <Spinner />
            ) : (
                <Card>
                    <Table>
                        <thead>
                            <tr>
                                <Th>Purchase #</Th>
                                <Th>Vendor</Th>
                                <Th>Purchase Date</Th>
                                <Th>Due Date</Th>
                                <Th>Total</Th>
                                <Th>Status</Th>
                                <Th />
                            </tr>
                        </thead>
                        <tbody>
                            {(purchases || []).map((p) => (
                                <tr key={p._id} className="hover:bg-muted/50">
                                    <Td className="font-medium">{p.purchaseNo}</Td>
                                    <Td>{p.vendor?.contactName || '—'}</Td>
                                    <Td>{formatDate(p.purchaseDate)}</Td>
                                    <Td>{formatDate(p.dueDate)}</Td>
                                    <Td>{formatMoney(p.total)}</Td>
                                    <Td><Badge tone={purchaseStatusTone[p.status]}>{statusLabel(p.status)}</Badge></Td>
                                    <Td>
                                        <div className="flex gap-2 text-xs">
                                            <button className="text-primary hover:underline cursor-pointer" onClick={() => setEditing(p)}>Edit</button>
                                            <button className="text-destructive hover:underline cursor-pointer" onClick={() => { if (confirm('Delete this purchase?')) removePurchase.mutate(p._id) }}>Delete</button>
                                        </div>
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                    {(purchases || []).length === 0 && <EmptyState message="No purchases found." />}
                </Card>
            )}

            <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="Create purchase" wide>
                <PurchaseForm vendors={vendors || []} busy={createPurchase.isPending} error={error} onSubmit={(body) => createPurchase.mutate(body)} />
            </Modal>

            <Modal open={!!editing} onClose={() => { setEditing(null); setError('') }} title={editing ? `Edit ${editing.purchaseNo}` : 'Edit purchase'} wide>
                {editing && (
                    <div className="space-y-4">
                        <PurchaseForm
                            vendors={vendors || []}
                            initial={editing}
                            busy={updatePurchase.isPending}
                            error={error}
                            onSubmit={(body) => updatePurchase.mutate({ id: editing._id, body })}
                        />
                        <Card>
                            <div className="px-4 pt-3 pb-2">
                                <h3 className="text-sm font-semibold">Attach File(s) to Purchase</h3>
                            </div>
                            <div className="px-4 pb-4">
                                <AttachmentManager purchase={editing} />
                            </div>
                        </Card>
                    </div>
                )}
            </Modal>
        </div>
    )
}

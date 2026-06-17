import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp, Plus } from 'lucide-react'
import { apiError, expenseApi, vendorApi } from '../lib/api'
import type { Expense, ExpenseStatus, Vendor } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th, statusLabel } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const EXPENSE_STATUSES: ExpenseStatus[] = ['recorded', 'approved', 'paid', 'reimbursed', 'cancelled']

const EXPENSE_TYPES = [
    'Office',
    'Transportation',
    'Personal',
    'Food & Meals',
    'Accommodation',
    'Utilities',
    'Entertainment',
    'Healthcare',
    'Education & Training',
    'Subscriptions',
    'Other',
]

const expenseStatusTone: Record<ExpenseStatus, string> = {
    recorded: 'blue',
    approved: 'purple',
    paid: 'green',
    reimbursed: 'amber',
    cancelled: 'red',
}

function toLocalDateInput(d?: string) {
    if (!d) return ''
    const date = new Date(d)
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().slice(0, 10)
}

function ExpenseForm({
    vendors,
    initial,
    busy,
    error,
    onSubmit,
}: {
    vendors: Vendor[]
    initial?: Expense
    busy: boolean
    error: string
    onSubmit: (body: Record<string, unknown>) => void
}) {
    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        onSubmit({
            expenseDate:    f.get('expenseDate'),
            expenseType:    f.get('expenseType'),
            expenseAccount: f.get('expenseAccount'),
            description:    f.get('description'),
            vendor:         f.get('vendor') || undefined,
            paidThrough:    f.get('paidThrough'),
            total:          Number(f.get('total') || 0),
            referenceNo:    f.get('referenceNo'),
            status:         f.get('status') || 'recorded',
        })
    }

    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <Field label="Date *">
                    <Input type="date" name="expenseDate"
                        defaultValue={toLocalDateInput(initial?.expenseDate) || toLocalDateInput(new Date().toISOString())}
                        required />
                </Field>
                <Field label="Type">
                    <Select name="expenseType" defaultValue={initial?.expenseType || ''}>
                        <option value="">— Select type —</option>
                        {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </Select>
                </Field>
            </div>

            <Field label="Expense account *">
                <Input name="expenseAccount" placeholder="e.g. Office Supplies" defaultValue={initial?.expenseAccount || ''} required />
            </Field>

            <Field label="Description">
                <Textarea name="description" placeholder="What was this expense for?" defaultValue={initial?.description || ''} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Vendor">
                    <Select name="vendor" defaultValue={initial?.vendor?._id || ''}>
                        <option value="">— None —</option>
                        {vendors.map((v) => (
                            <option key={v._id} value={v._id}>{v.contactName}</option>
                        ))}
                    </Select>
                </Field>
                <Field label="Paid through">
                    <Input name="paidThrough" placeholder="e.g. Cash, Bank, Card" defaultValue={initial?.paidThrough || ''} />
                </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Total (AED) *">
                    <Input type="number" step="0.01" min="0" name="total" defaultValue={initial?.total ?? ''} required />
                </Field>
                <Field label="Reference #">
                    <Input name="referenceNo" placeholder="Receipt or invoice number" defaultValue={initial?.referenceNo || ''} />
                </Field>
            </div>

            <Field label="Status">
                <Select name="status" defaultValue={initial?.status || 'recorded'}>
                    {EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
            </Field>

            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save expense'}</Button>
        </form>
    )
}

export default function Expenses() {
    const qc = useQueryClient()
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('')
    const [expenseAccount, setExpenseAccount] = useState('')
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<Expense | null>(null)
    const [error, setError] = useState('')
    const [importResult, setImportResult] = useState('')

    const { data: vendors } = useQuery<Vendor[]>({
        queryKey: ['vendors', '', '', ''],
        queryFn: () => vendorApi.list({}),
    })

    const { data: expenses, isLoading } = useQuery<Expense[]>({
        queryKey: ['expenses', search, status, expenseAccount],
        queryFn: () =>
            expenseApi.list({
                search: search || undefined,
                status: status || undefined,
                expenseAccount: expenseAccount || undefined,
            }),
    })

    const createExpense = useMutation({
        mutationFn: (body: Record<string, unknown>) => expenseApi.create(body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['expenses'] })
            setAdding(false)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const updateExpense = useMutation({
        mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => expenseApi.update(id, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['expenses'] })
            setEditing(null)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const removeExpense = useMutation({
        mutationFn: (id: string) => expenseApi.remove(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
    })

    const importCsv = useMutation({
        mutationFn: (form: FormData) => expenseApi.importCsv(form),
        onSuccess: (data) => {
            qc.invalidateQueries({ queryKey: ['expenses'] })
            setImportResult(
                `Imported: created ${data.summary.created}, updated ${data.summary.updated}, skipped ${data.summary.skipped}, errors ${data.summary.errors}, linked vendors ${data.summary.vendorLinked}`
            )
        },
        onError: (e) => setImportResult(apiError(e)),
    })

    function onCsvPick(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        const form = new FormData()
        form.append('file', file)
        importCsv.mutate(form)
        e.currentTarget.value = ''
    }

    return (
        <div>
            <PageHeader
                title="Expenses"
                subtitle={`${expenses?.length ?? 0} expense records`}
                action={
                    <div className="flex gap-2">
                        <label className="inline-flex">
                            <input type="file" accept=".csv" className="hidden" onChange={onCsvPick} />
                            <Button type="button" variant="outline"><FileUp size={15} /> Import CSV</Button>
                        </label>
                        <Button onClick={() => setAdding(true)}><Plus size={15} /> Add expense</Button>
                    </div>
                }
            />

            {importResult && <p className="mb-3 text-xs text-muted-foreground">{importResult}</p>}

            <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                <Input placeholder="Search description/reference/account" value={search} onChange={(e) => setSearch(e.target.value)} />
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
                <Input placeholder="Filter by expense account" value={expenseAccount} onChange={(e) => setExpenseAccount(e.target.value)} />
            </div>

            {isLoading ? (
                <Spinner />
            ) : (
                <Card>
                    <Table>
                        <thead>
                            <tr>
                                <Th>Date</Th>
                                <Th>Description</Th>
                                <Th>Account</Th>
                                <Th>Vendor</Th>
                                <Th>Total</Th>
                                <Th>Status</Th>
                                <Th />
                            </tr>
                        </thead>
                        <tbody>
                            {(expenses || []).map((e) => (
                                <tr key={e._id} className="hover:bg-muted/50">
                                    <Td>{formatDate(e.expenseDate)}</Td>
                                    <Td>
                                        <div className="font-medium">{e.description || '—'}</div>
                                        <div className="text-xs text-muted-foreground">{e.referenceNo || e.expenseReferenceId || 'No reference'}</div>
                                    </Td>
                                    <Td>{e.expenseAccount}</Td>
                                    <Td>{e.vendor?.contactName || e.vendorName || '—'}</Td>
                                    <Td>{formatMoney(e.total)}</Td>
                                    <Td><Badge tone={expenseStatusTone[e.status]}>{statusLabel(e.status)}</Badge></Td>
                                    <Td>
                                        <div className="flex gap-2 text-xs">
                                            <button className="text-primary hover:underline cursor-pointer" onClick={() => setEditing(e)}>Edit</button>
                                            <button className="text-destructive hover:underline cursor-pointer" onClick={() => { if (confirm('Delete this expense?')) removeExpense.mutate(e._id) }}>Delete</button>
                                        </div>
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                    {(expenses || []).length === 0 && <EmptyState message="No expenses found." />}
                </Card>
            )}

            <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="Add expense" wide>
                <ExpenseForm vendors={vendors || []} busy={createExpense.isPending} error={error} onSubmit={(body) => createExpense.mutate(body)} />
            </Modal>

            <Modal open={!!editing} onClose={() => { setEditing(null); setError('') }} title={editing ? `Edit expense #${editing.entryNumber || ''}` : 'Edit expense'} wide>
                {editing && (
                    <ExpenseForm
                        vendors={vendors || []}
                        initial={editing}
                        busy={updateExpense.isPending}
                        error={error}
                        onSubmit={(body) => updateExpense.mutate({ id: editing._id, body })}
                    />
                )}
            </Modal>
        </div>
    )
}

import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FileUp, Link2, Paperclip, Plus, Upload } from 'lucide-react'
import { apiError, expenseApi, vendorApi } from '../lib/api'
import type { PagedResponse } from '../lib/api'
import type { Expense, ExpenseStatus, PurchaseAttachment, Vendor } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th, statusLabel } from '../components/ui'
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
                    <Select name="paidThrough" defaultValue={initial?.paidThrough || ''}>
                        <option value="">— Select —</option>
                        <option value="Cash">Cash</option>
                        <option value="Bank">Bank</option>
                        <option value="Card">Card</option>
                        <option value="Cheque">Cheque</option>
                        <option value="Online Transfer">Online Transfer</option>
                        <option value="Petty Cash">Petty Cash</option>
                        <option value="Other">Other</option>
                    </Select>
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

function ExpenseAttachmentManager({ expense }: { expense: Expense }) {
    const qc = useQueryClient()
    const [err, setErr] = useState('')

    const upload = useMutation({
        mutationFn: (form: FormData) => expenseApi.uploadAttachments(expense._id, form),
        onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); setErr('') },
        onError: (e) => setErr(apiError(e)),
    })

    const remove = useMutation({
        mutationFn: (idx: number) => expenseApi.removeAttachment(expense._id, idx),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
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

    const attachments: PurchaseAttachment[] = expense.attachments ?? []

    return (
        <div className="space-y-3 pt-3 border-t">
            <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Attachments</p>
                <label className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer">
                    {upload.isPending ? 'Uploading…' : <><Paperclip size={13} /> Attach files</>}
                    <input type="file" className="hidden" multiple accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx" onChange={onPickFiles} disabled={upload.isPending} />
                </label>
            </div>
            {err && <p className="text-xs text-destructive">{err}</p>}
            {attachments.length === 0 ? (
                <p className="text-xs text-muted-foreground">No attachments yet.</p>
            ) : (
                <div className="space-y-2">
                    {attachments.map((a, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-lg border px-3 py-2">
                            <div>
                                {a.mimeType?.startsWith('image/') ? (
                                    <a href={a.url} target="_blank" rel="noreferrer">
                                        <img src={a.url} alt={a.name} className="max-h-20 rounded object-cover mb-1" />
                                    </a>
                                ) : null}
                                <a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">{a.name}</a>
                                <div className="text-[11px] text-muted-foreground">{a.storage === 'drive' ? 'Google Drive' : 'Local'} · {((a.size || 0) / 1024).toFixed(1)} KB</div>
                            </div>
                            <button className="text-xs text-destructive hover:underline cursor-pointer shrink-0 ml-3" onClick={() => { if (confirm('Remove this attachment?')) remove.mutate(idx) }}>Remove</button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

export default function Expenses() {
    const qc = useQueryClient()
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('')
    const [expenseAccount, setExpenseAccount] = useState('')
    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(50)
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<Expense | null>(null)
    const [error, setError] = useState('')

    type ImportSummary = { created: number; updated: number; skipped: number; errors: number; vendorLinked: number; total: number }
    const [importOpen, setImportOpen]     = useState(false)
    const [importMode, setImportMode]     = useState<'skip' | 'update'>('skip')
    const [importFile, setImportFile]     = useState<File | null>(null)
    const [importResult, setImportResult] = useState<ImportSummary | null>(null)

    const { data: vendors } = useQuery<Vendor[]>({
        queryKey: ['vendors-all'],
        queryFn: () => vendorApi.list({ limit: 500 }).then((r) => r.data),
    })

    const { data: expensesPage, isLoading } = useQuery<PagedResponse<Expense>>({
        queryKey: ['expenses', search, status, expenseAccount, page, limit],
        queryFn: () =>
            expenseApi.list({
                search: search || undefined,
                status: status || undefined,
                expenseAccount: expenseAccount || undefined,
                page,
                limit,
            }),
        placeholderData: (prev) => prev,
    })
    const expenses = expensesPage?.data ?? []

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
        mutationFn: ({ form, mode }: { form: FormData; mode: 'skip' | 'update' }) =>
            expenseApi.importCsv(form, mode),
        onSuccess: (data) => {
            qc.invalidateQueries({ queryKey: ['expenses'] })
            setImportResult(data.summary)
        },
        onError: (e) => setError(apiError(e)),
    })

    function openImportModal() {
        setImportFile(null)
        setImportResult(null)
        setImportMode('skip')
        setError('')
        setImportOpen(true)
    }

    function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
        setImportFile(e.target.files?.[0] ?? null)
        setImportResult(null)
    }

    const [relinkMsg, setRelinkMsg] = useState('')
    const relinkVendors = useMutation({
        mutationFn: () => expenseApi.relinkVendors(),
        onSuccess: (data) => {
            qc.invalidateQueries({ queryKey: ['expenses'] })
            setRelinkMsg(`Linked ${data.linked} of ${data.checked} unlinked expenses to vendors.`)
        },
        onError: (e) => setRelinkMsg(apiError(e)),
    })

    function runImport() {
        if (!importFile) return
        const form = new FormData()
        form.append('file', importFile)
        importCsv.mutate({ form, mode: importMode })
    }

    return (
        <div>
            <PageHeader
                title="Expenses"
                subtitle={`${expensesPage?.total ?? 0} expense records`}
                action={
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={() => { setRelinkMsg(''); relinkVendors.mutate() }}
                            disabled={relinkVendors.isPending}
                            title="Match expenses to vendors by vendor name"
                        >
                            <Link2 size={15} />
                            {relinkVendors.isPending ? 'Linking…' : 'Link vendors'}
                        </Button>
                        <Button variant="outline" onClick={openImportModal}><FileUp size={15} /> Import CSV</Button>
                        <Button onClick={() => setAdding(true)}><Plus size={15} /> Add expense</Button>
                    </div>
                }
            />
            {relinkMsg && (
                <p className="mb-3 text-xs text-muted-foreground">{relinkMsg}</p>
            )}

            <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                <Input placeholder="Search description/reference/account" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
                <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
                    <option value="">All statuses</option>
                    {EXPENSE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
                <Input placeholder="Filter by expense account" value={expenseAccount} onChange={(e) => { setExpenseAccount(e.target.value); setPage(1) }} />
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
                    {expenses.length === 0 && <EmptyState message="No expenses found." />}
                    {expensesPage && expensesPage.pages > 1 && (
                        <Pagination
                            page={expensesPage.page}
                            pages={expensesPage.pages}
                            total={expensesPage.total}
                            limit={expensesPage.limit}
                            onPage={setPage}
                            onLimit={(l) => { setLimit(l); setPage(1) }}
                        />
                    )}
                </Card>
            )}

            {/* ── Import CSV modal ───────────────────────────────────── */}
            <Modal
                open={importOpen}
                onClose={() => { if (!importCsv.isPending) { setImportOpen(false); setImportFile(null); setImportResult(null) } }}
                title="Import expenses from CSV"
                wide
            >
                <div className="space-y-5">
                    <label className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border py-8 cursor-pointer hover:bg-muted/40 transition-colors">
                        <Upload size={28} className="text-muted-foreground" />
                        <div className="text-center">
                            <p className="text-sm font-medium">{importFile ? importFile.name : 'Click to choose a CSV file'}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Zoho-format expense CSV</p>
                        </div>
                        <input type="file" accept=".csv" className="hidden" onChange={onFilePick} />
                    </label>

                    <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">If expense already exists (matched by Expense Reference ID)</p>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setImportMode('skip')}
                                className={`rounded-lg border px-4 py-3 text-left transition-colors ${importMode === 'skip' ? 'border-primary bg-primary/8 text-primary' : 'border-border hover:bg-muted/50'}`}
                            >
                                <p className="text-sm font-semibold">Skip</p>
                                <p className="text-xs text-muted-foreground mt-0.5">Leave existing expense unchanged</p>
                            </button>
                            <button
                                type="button"
                                onClick={() => setImportMode('update')}
                                className={`rounded-lg border px-4 py-3 text-left transition-colors ${importMode === 'update' ? 'border-primary bg-primary/8 text-primary' : 'border-border hover:bg-muted/50'}`}
                            >
                                <p className="text-sm font-semibold">Update</p>
                                <p className="text-xs text-muted-foreground mt-0.5">Overwrite existing expense data</p>
                            </button>
                        </div>
                    </div>

                    {importResult && (
                        <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600">
                                <CheckCircle2 size={16} /> Import complete
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                                <div className="rounded-lg bg-emerald-500/10 py-2">
                                    <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{importResult.created}</div>
                                    <div className="text-xs text-muted-foreground">Created</div>
                                </div>
                                <div className="rounded-lg bg-blue-500/10 py-2">
                                    <div className="text-xl font-bold text-blue-700 dark:text-blue-400">{importResult.updated}</div>
                                    <div className="text-xs text-muted-foreground">Updated</div>
                                </div>
                                <div className="rounded-lg bg-muted py-2">
                                    <div className="text-xl font-bold">{importResult.skipped}</div>
                                    <div className="text-xs text-muted-foreground">Skipped</div>
                                </div>
                                <div className="rounded-lg bg-violet-500/10 py-2">
                                    <div className="text-xl font-bold text-violet-700 dark:text-violet-400">{importResult.vendorLinked}</div>
                                    <div className="text-xs text-muted-foreground">Vendor linked</div>
                                </div>
                                <div className={`rounded-lg py-2 ${importResult.errors > 0 ? 'bg-red-500/10' : 'bg-muted'}`}>
                                    <div className={`text-xl font-bold ${importResult.errors > 0 ? 'text-destructive' : ''}`}>{importResult.errors}</div>
                                    <div className="text-xs text-muted-foreground">Errors</div>
                                </div>
                            </div>
                            <p className="text-xs text-center text-muted-foreground">{importResult.total} row{importResult.total !== 1 ? 's' : ''} processed</p>
                        </div>
                    )}

                    {error && <p className="text-xs text-destructive">{error}</p>}

                    <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => { setImportOpen(false); setImportFile(null); setImportResult(null) }} disabled={importCsv.isPending}>
                            {importResult ? 'Close' : 'Cancel'}
                        </Button>
                        {!importResult && (
                            <Button onClick={runImport} disabled={!importFile || importCsv.isPending}>
                                <FileUp size={14} />
                                {importCsv.isPending ? 'Importing…' : 'Import expenses'}
                            </Button>
                        )}
                    </div>
                </div>
            </Modal>

            <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="Add expense" wide>
                <ExpenseForm vendors={vendors || []} busy={createExpense.isPending} error={error} onSubmit={(body) => createExpense.mutate(body)} />
            </Modal>

            <Modal open={!!editing} onClose={() => { setEditing(null); setError('') }} title={editing ? `Edit expense #${editing.entryNumber || ''}` : 'Edit expense'} wide>
                {editing && (
                    <div className="space-y-4">
                        <ExpenseForm
                            vendors={vendors || []}
                            initial={editing}
                            busy={updateExpense.isPending}
                            error={error}
                            onSubmit={(body) => updateExpense.mutate({ id: editing._id, body })}
                        />
                        <ExpenseAttachmentManager expense={editing} />
                    </div>
                )}
            </Modal>
        </div>
    )
}

import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FileUp, Plus, Search, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiError, vendorApi } from '../lib/api'
import type { PagedResponse } from '../lib/api'
import type { Vendor } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '../components/ui'

function VendorForm({
    initial,
    busy,
    error,
    onSubmit,
}: {
    initial?: Partial<Vendor>
    busy: boolean
    error: string
    onSubmit: (body: Record<string, unknown>) => void
}) {
    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        onSubmit({
            contactId: String(f.get('contactId') || ''),
            contactName: String(f.get('contactName') || ''),
            companyName: String(f.get('companyName') || ''),
            displayName: String(f.get('displayName') || ''),
            email: String(f.get('email') || ''),
            phone: String(f.get('phone') || ''),
            mobilePhone: String(f.get('mobilePhone') || ''),
            currencyCode: String(f.get('currencyCode') || 'AED'),
            status: String(f.get('status') || 'active'),
            paymentTermsLabel: String(f.get('paymentTermsLabel') || ''),
            paymentTerms: Number(f.get('paymentTerms') || 0),
            openingBalance: Number(f.get('openingBalance') || 0),
            ownerName: String(f.get('ownerName') || ''),
            source: String(f.get('source') || ''),
            notes: String(f.get('notes') || ''),
            website: String(f.get('website') || ''),
            categories: String(f.get('categories') || '').split(',').map((x) => x.trim()).filter(Boolean),
        })
    }

    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <Field label="Contact ID"><Input name="contactId" defaultValue={initial?.contactId} required /></Field>
                <Field label="Contact Name"><Input name="contactName" defaultValue={initial?.contactName} required /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Company Name"><Input name="companyName" defaultValue={initial?.companyName} /></Field>
                <Field label="Display Name"><Input name="displayName" defaultValue={initial?.displayName} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Email"><Input name="email" type="email" defaultValue={initial?.email} /></Field>
                <Field label="Phone"><Input name="phone" defaultValue={initial?.phone} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Mobile"><Input name="mobilePhone" defaultValue={initial?.mobilePhone} /></Field>
                <Field label="Currency"><Input name="currencyCode" defaultValue={initial?.currencyCode || 'AED'} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                    <Select name="status" defaultValue={initial?.status || 'active'}>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                    </Select>
                </Field>
                <Field label="Owner Name"><Input name="ownerName" defaultValue={initial?.ownerName} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Payment Terms Label"><Input name="paymentTermsLabel" defaultValue={initial?.paymentTermsLabel} /></Field>
                <Field label="Payment Terms"><Input type="number" name="paymentTerms" defaultValue={initial?.paymentTerms ?? 0} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Opening Balance"><Input type="number" step="0.01" name="openingBalance" defaultValue={initial?.openingBalance ?? 0} /></Field>
                <Field label="Source"><Input name="source" defaultValue={initial?.source} /></Field>
            </div>
            <Field label="Categories (comma separated)"><Input name="categories" defaultValue={(initial?.categories || []).join(', ')} /></Field>
            <Field label="Website"><Input name="website" defaultValue={initial?.website} /></Field>
            <Field label="Notes"><Input name="notes" defaultValue={initial?.notes} /></Field>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save vendor'}</Button>
        </form>
    )
}

type ImportSummary = { created: number; updated: number; skipped: number; errors: number; total: number }

export default function Vendors() {
    const qc = useQueryClient()
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('')
    const [category, setCategory] = useState('')
    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(50)
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<Vendor | null>(null)
    const [error, setError] = useState('')

    // Import modal state
    const [importOpen, setImportOpen] = useState(false)
    const [importMode, setImportMode] = useState<'skip' | 'update'>('skip')
    const [importFile, setImportFile] = useState<File | null>(null)
    const [importResult, setImportResult] = useState<ImportSummary | null>(null)

    const { data: vendorsPage, isLoading } = useQuery<PagedResponse<Vendor>>({
        queryKey: ['vendors', search, status, category, page, limit],
        queryFn: () => vendorApi.list({ search: search || undefined, status: status || undefined, category: category || undefined, page, limit }),
        placeholderData: (prev) => prev,
    })
    const vendors = vendorsPage?.data ?? []

    const createVendor = useMutation({
        mutationFn: (body: Record<string, unknown>) => vendorApi.create(body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['vendors'] })
            setAdding(false)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const updateVendor = useMutation({
        mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => vendorApi.update(id, body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['vendors'] })
            setEditing(null)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const deleteVendor = useMutation({
        mutationFn: (id: string) => vendorApi.remove(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['vendors'] }),
    })

    const importCsv = useMutation({
        mutationFn: ({ form, mode }: { form: FormData; mode: 'skip' | 'update' }) =>
            vendorApi.importCsv(form, mode),
        onSuccess: (data) => {
            qc.invalidateQueries({ queryKey: ['vendors'] })
            setImportResult(data.summary)
        },
        onError: (e) => { setError(apiError(e)) },
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

    function runImport() {
        if (!importFile) return
        const form = new FormData()
        form.append('file', importFile)
        importCsv.mutate({ form, mode: importMode })
    }

    return (
        <div>
            <PageHeader
                title="Vendors"
                subtitle={`${vendorsPage?.total ?? 0} vendors`}
                action={
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={openImportModal}><FileUp size={15} /> Import CSV</Button>
                        <Button onClick={() => setAdding(true)}><Plus size={15} /> Add vendor</Button>
                    </div>
                }
            />

            <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Search vendor name/email/phone" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
                </div>
                <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                </Select>
                <Input placeholder="Filter by category (Steel, Fire Alarm...)" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }} />
            </div>

            {isLoading ? (
                <Spinner />
            ) : (
                <Card>
                    <Table>
                        <thead>
                            <tr>
                                <Th>Name</Th>
                                <Th>Company</Th>
                                <Th>Email</Th>
                                <Th>Phone</Th>
                                <Th>Status</Th>
                                <Th>Categories</Th>
                                <Th />
                            </tr>
                        </thead>
                        <tbody>
                            {(vendors || []).map((v) => (
                                <tr key={v._id} className="hover:bg-muted/50">
                                    <Td>
                                        <Link to={`/vendors/${v._id}`} className="font-medium text-primary hover:underline">{v.contactName}</Link>
                                        <div className="text-xs text-muted-foreground">{v.contactId}</div>
                                    </Td>
                                    <Td>{v.companyName || '—'}</Td>
                                    <Td>{v.email || '—'}</Td>
                                    <Td>{v.phone || v.mobilePhone || '—'}</Td>
                                    <Td><Badge tone={v.status === 'active' ? 'green' : 'gray'}>{v.status}</Badge></Td>
                                    <Td>{(v.categories || []).join(', ') || '—'}</Td>
                                    <Td>
                                        <div className="flex gap-2 text-xs">
                                            <button className="text-primary hover:underline cursor-pointer" onClick={() => setEditing(v)}>Edit</button>
                                            <button className="text-destructive hover:underline cursor-pointer" onClick={() => { if (confirm('Delete this vendor?')) deleteVendor.mutate(v._id) }}>Delete</button>
                                        </div>
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                    {vendors.length === 0 && <EmptyState message="No vendors found." />}
                    {vendorsPage && vendorsPage.pages > 1 && (
                        <Pagination
                            page={vendorsPage.page}
                            pages={vendorsPage.pages}
                            total={vendorsPage.total}
                            limit={vendorsPage.limit}
                            onPage={setPage}
                            onLimit={(l) => { setLimit(l); setPage(1) }}
                        />
                    )}
                </Card>
            )}

            <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="Add vendor" wide>
                <VendorForm busy={createVendor.isPending} error={error} onSubmit={(body) => createVendor.mutate(body)} />
            </Modal>

            <Modal open={!!editing} onClose={() => { setEditing(null); setError('') }} title={editing ? `Edit ${editing.contactName}` : 'Edit vendor'} wide>
                {editing && (
                    <VendorForm
                        initial={editing}
                        busy={updateVendor.isPending}
                        error={error}
                        onSubmit={(body) => updateVendor.mutate({ id: editing._id, body })}
                    />
                )}
            </Modal>

            {/* ── Import CSV modal ───────────────────────────────────── */}
            <Modal
                open={importOpen}
                onClose={() => { if (!importCsv.isPending) { setImportOpen(false); setImportFile(null); setImportResult(null) } }}
                title="Import vendors from CSV"
                wide
            >
                <div className="space-y-5">
                    {/* File picker */}
                    <label className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border py-8 cursor-pointer hover:bg-muted/40 transition-colors">
                        <Upload size={28} className="text-muted-foreground" />
                        <div className="text-center">
                            <p className="text-sm font-medium">{importFile ? importFile.name : 'Click to choose a CSV file'}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Zoho-format vendor CSV</p>
                        </div>
                        <input
                            type="file"
                            accept=".csv"
                            className="hidden"
                            onChange={onFilePick}
                        />
                    </label>

                    {/* Mode toggle */}
                    <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">If vendor already exists (matched by Contact ID)</p>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setImportMode('skip')}
                                className={`rounded-lg border px-4 py-3 text-left transition-colors ${importMode === 'skip' ? 'border-primary bg-primary/8 text-primary' : 'border-border hover:bg-muted/50'}`}
                            >
                                <p className="text-sm font-semibold">Skip</p>
                                <p className="text-xs text-muted-foreground mt-0.5">Leave existing vendor unchanged</p>
                            </button>
                            <button
                                type="button"
                                onClick={() => setImportMode('update')}
                                className={`rounded-lg border px-4 py-3 text-left transition-colors ${importMode === 'update' ? 'border-primary bg-primary/8 text-primary' : 'border-border hover:bg-muted/50'}`}
                            >
                                <p className="text-sm font-semibold">Update</p>
                                <p className="text-xs text-muted-foreground mt-0.5">Overwrite existing vendor data</p>
                            </button>
                        </div>
                    </div>

                    {/* Result summary */}
                    {importResult && (
                        <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
                            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600">
                                <CheckCircle2 size={16} /> Import complete
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
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
                                {importCsv.isPending ? 'Importing…' : 'Import vendors'}
                            </Button>
                        )}
                    </div>
                </div>
            </Modal>
        </div>
    )
}

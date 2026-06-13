import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp, Plus, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiError, vendorApi } from '../lib/api'
import type { Vendor } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th } from '../components/ui'

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

export default function Vendors() {
    const qc = useQueryClient()
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('')
    const [category, setCategory] = useState('')
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<Vendor | null>(null)
    const [error, setError] = useState('')
    const [importResult, setImportResult] = useState('')

    const { data: vendors, isLoading } = useQuery<Vendor[]>({
        queryKey: ['vendors', search, status, category],
        queryFn: () => vendorApi.list({ search: search || undefined, status: status || undefined, category: category || undefined }),
    })

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
        mutationFn: (form: FormData) => vendorApi.importCsv(form),
        onSuccess: (data) => {
            qc.invalidateQueries({ queryKey: ['vendors'] })
            setImportResult(`Imported: created ${data.summary.created}, updated ${data.summary.updated}, skipped ${data.summary.skipped}, errors ${data.summary.errors}`)
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
                title="Vendors"
                subtitle={`${vendors?.length ?? 0} vendors`}
                action={
                    <div className="flex gap-2">
                        <label className="inline-flex">
                            <input type="file" accept=".csv" className="hidden" onChange={onCsvPick} />
                            <Button type="button" variant="outline"><FileUp size={15} /> Import CSV</Button>
                        </label>
                        <Button onClick={() => setAdding(true)}><Plus size={15} /> Add vendor</Button>
                    </div>
                }
            />

            {importResult && <p className="mb-3 text-xs text-muted-foreground">{importResult}</p>}

            <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Search vendor name/email/phone" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                </Select>
                <Input placeholder="Filter by category (Steel, Fire Alarm...)" value={category} onChange={(e) => setCategory(e.target.value)} />
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
                    {(vendors || []).length === 0 && <EmptyState message="No vendors found." />}
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
        </div>
    )
}

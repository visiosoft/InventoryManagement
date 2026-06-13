import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { api, apiError, leadApi } from '../lib/api'
import type { Lead, LeadSource, LeadStatus } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea, leadStatusTone, statusLabel } from '../components/ui'
import { formatDate } from '../lib/utils'

const LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost']
const LEAD_SOURCES: LeadSource[] = ['manual', 'google_contacts', 'whatsapp', 'referral', 'walk_in', 'other']

function toDatetimeLocal(input?: string) {
    if (!input) return ''
    const d = new Date(input)
    if (Number.isNaN(d.getTime())) return ''
    const tzOffset = d.getTimezoneOffset() * 60000
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16)
}

function fromDatetimeLocal(input: FormDataEntryValue | null) {
    if (!input) return undefined
    const s = String(input)
    if (!s) return undefined
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function LeadForm({
    initial,
    busy,
    error,
    users,
    onSubmit,
}: {
    initial?: Partial<Lead>
    busy: boolean
    error: string
    users: { _id: string; name: string; email: string }[]
    onSubmit: (body: Record<string, unknown>) => void
}) {
    function submit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        onSubmit({
            fullName: String(f.get('fullName') || ''),
            phone: String(f.get('phone') || ''),
            email: String(f.get('email') || ''),
            status: String(f.get('status') || 'new'),
            source: String(f.get('source') || 'manual'),
            leadDateTime: fromDatetimeLocal(f.get('leadDateTime')),
            storageSizeValue: Number(f.get('storageSizeValue') || 0),
            storageSizeUnit: 'sqft',
            durationValue: Number(f.get('durationValue') || 1),
            durationUnit: String(f.get('durationUnit') || 'month'),
            owner: String(f.get('owner') || ''),
            unitsNeeded: Number(f.get('unitsNeeded') || 1),
            notes: String(f.get('notes') || ''),
        })
    }

    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <Field label="Name">
                    <Input name="fullName" defaultValue={initial?.fullName} required />
                </Field>
                <Field label="Phone">
                    <Input name="phone" defaultValue={initial?.phone} required />
                </Field>
                <Field label="Email">
                    <Input name="email" type="email" defaultValue={initial?.email} />
                </Field>
                <Field label="Lead datetime">
                    <Input
                        name="leadDateTime"
                        type="datetime-local"
                        defaultValue={toDatetimeLocal(initial?.leadDateTime || new Date().toISOString())}
                        required
                    />
                </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                    <Select name="status" defaultValue={initial?.status || 'new'}>
                        {LEAD_STATUSES.map((s) => (
                            <option key={s} value={s}>
                                {statusLabel(s)}
                            </option>
                        ))}
                    </Select>
                </Field>
                <Field label="Source">
                    <Select name="source" defaultValue={initial?.source || 'manual'}>
                        {LEAD_SOURCES.map((s) => (
                            <option key={s} value={s}>
                                {statusLabel(s)}
                            </option>
                        ))}
                    </Select>
                </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <Field label="Storage size needed">
                    <Input name="storageSizeValue" type="number" min={0} step="1" defaultValue={initial?.storageSizeValue ?? 25} required />
                </Field>
                <Field label="Duration needed">
                    <Input name="durationValue" type="number" min={1} step="1" defaultValue={initial?.durationValue ?? 1} required />
                </Field>
                <Field label="No. of units needed">
                    <Input name="unitsNeeded" type="number" min={1} step="1" defaultValue={initial?.unitsNeeded ?? 1} required />
                </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Duration unit">
                    <Select name="durationUnit" defaultValue={initial?.durationUnit || 'month'}>
                        <option value="week">Week(s)</option>
                        <option value="month">Month(s)</option>
                    </Select>
                </Field>
                <Field label="Lead owner">
                    <Select name="owner" defaultValue={typeof initial?.owner === 'object' ? initial?.owner?._id : ''} required>
                        <option value="">Select owner</option>
                        {users.map((u) => (
                            <option key={u._id} value={u._id}>
                                {u.name} ({u.email})
                            </option>
                        ))}
                    </Select>
                </Field>
            </div>

            <Field label="Notes">
                <Textarea name="notes" defaultValue={initial?.notes} />
            </Field>

            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Saving…' : 'Save lead'}
            </Button>
        </form>
    )
}

export default function Leads() {
    const qc = useQueryClient()

    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('')
    const [source, setSource] = useState('')
    const [owner, setOwner] = useState('')
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')

    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<Lead | null>(null)
    const [error, setError] = useState('')

    const { data: users } = useQuery<{ _id: string; name: string; email: string }[]>({
        queryKey: ['lead-owners'],
        queryFn: () => api.get('/auth/me').then((r) => {
            const u = r.data?.user
            if (!u?.id) return []
            return [{ _id: u.id, name: u.name, email: u.email }]
        }),
    })

    const queryParams = useMemo(
        () => ({
            search: search || undefined,
            status: status || undefined,
            source: source || undefined,
            owner: owner || undefined,
            from: from || undefined,
            to: to || undefined,
        }),
        [search, status, source, owner, from, to]
    )

    const { data: leads, isLoading } = useQuery<Lead[]>({
        queryKey: ['leads', queryParams],
        queryFn: () => leadApi.list(queryParams),
    })

    const createLead = useMutation({
        mutationFn: (body: Record<string, unknown>) => leadApi.create(body as Partial<Lead>),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leads'] })
            setAdding(false)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const updateLead = useMutation({
        mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => leadApi.update(id, body as Partial<Lead>),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leads'] })
            setEditing(null)
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const updateStatus = useMutation({
        mutationFn: ({ id, nextStatus }: { id: string; nextStatus: LeadStatus }) => leadApi.updateStatus(id, nextStatus),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
    })

    const removeLead = useMutation({
        mutationFn: (id: string) => leadApi.remove(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
    })

    return (
        <div>
            <PageHeader
                title="Leads"
                subtitle={`${leads?.length ?? 0} leads in pipeline`}
                action={
                    <Button onClick={() => setAdding(true)}>
                        <Plus size={15} /> Add lead
                    </Button>
                }
            />

            <div className="mb-4 grid grid-cols-1 md:grid-cols-6 gap-2">
                <div className="relative md:col-span-2">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input className="pl-9" placeholder="Search name, phone, email" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                            {statusLabel(s)}
                        </option>
                    ))}
                </Select>
                <Select value={source} onChange={(e) => setSource(e.target.value)}>
                    <option value="">All sources</option>
                    {LEAD_SOURCES.map((s) => (
                        <option key={s} value={s}>
                            {statusLabel(s)}
                        </option>
                    ))}
                </Select>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>

            <div className="mb-4 max-w-sm">
                <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
                    <option value="">All owners</option>
                    {(users || []).map((u) => (
                        <option key={u._id} value={u._id}>
                            {u.name}
                        </option>
                    ))}
                </Select>
            </div>

            {isLoading ? (
                <Spinner />
            ) : (
                <Card>
                    <Table>
                        <thead>
                            <tr>
                                <Th>Name</Th>
                                <Th>Phone</Th>
                                <Th>Source</Th>
                                <Th>Status</Th>
                                <Th>Storage</Th>
                                <Th>Duration</Th>
                                <Th>Units</Th>
                                <Th>Owner</Th>
                                <Th>Date</Th>
                                <Th />
                            </tr>
                        </thead>
                        <tbody>
                            {(leads || []).map((lead) => (
                                <tr key={lead._id} className="hover:bg-muted/50">
                                    <Td>
                                        <div className="font-medium">{lead.fullName}</div>
                                        <div className="text-xs text-muted-foreground">{lead.email || '—'}</div>
                                    </Td>
                                    <Td>{lead.phone}</Td>
                                    <Td>
                                        <Badge tone="gray">{statusLabel(lead.source)}</Badge>
                                    </Td>
                                    <Td>
                                        <Select
                                            value={lead.status}
                                            onChange={(e) => updateStatus.mutate({ id: lead._id, nextStatus: e.target.value as LeadStatus })}
                                            className="h-8 text-xs"
                                        >
                                            {LEAD_STATUSES.map((s) => (
                                                <option key={s} value={s}>
                                                    {statusLabel(s)}
                                                </option>
                                            ))}
                                        </Select>
                                        <div className="mt-1">
                                            <Badge tone={leadStatusTone[lead.status]}>{statusLabel(lead.status)}</Badge>
                                        </div>
                                    </Td>
                                    <Td>{lead.storageSizeValue} {lead.storageSizeUnit}</Td>
                                    <Td>{lead.durationValue} {lead.durationUnit}(s)</Td>
                                    <Td>{lead.unitsNeeded}</Td>
                                    <Td>{lead.owner?.name || '—'}</Td>
                                    <Td>{formatDate(lead.leadDateTime)}</Td>
                                    <Td>
                                        <div className="flex gap-2 text-xs">
                                            <button onClick={() => setEditing(lead)} className="text-primary hover:underline cursor-pointer">Edit</button>
                                            <button
                                                onClick={() => {
                                                    if (confirm('Delete this lead?')) removeLead.mutate(lead._id)
                                                }}
                                                className="text-destructive hover:underline cursor-pointer"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                    {(leads || []).length === 0 && <EmptyState message="No leads found for current filters." />}
                </Card>
            )}

            <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="Add lead" wide>
                <LeadForm
                    users={users || []}
                    busy={createLead.isPending}
                    error={error}
                    onSubmit={(body) => createLead.mutate(body)}
                />
            </Modal>

            <Modal open={!!editing} onClose={() => { setEditing(null); setError('') }} title={editing ? `Edit ${editing.fullName}` : 'Edit lead'} wide>
                {editing && (
                    <LeadForm
                        users={users || []}
                        initial={editing}
                        busy={updateLead.isPending}
                        error={error}
                        onSubmit={(body) => updateLead.mutate({ id: editing._id, body })}
                    />
                )}
            </Modal>
        </div>
    )
}

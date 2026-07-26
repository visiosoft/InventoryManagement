import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, CheckSquare, FileText, Mail, MessageCircle, MoreHorizontal, Plus, RefreshCw, Search, Send, Upload, X } from 'lucide-react'
import { api, apiError, leadApi, type LeadPage } from '../lib/api'
import type { Lead, LeadComment, LeadSource, LeadStatus } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, leadStatusTone, statusLabel } from '../components/ui'
import { formatDate, formatDateTime } from '../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED_COLOR = '#756E80'
const PURPLE = '#5B2BC9'

const LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'proposal_sent', 'won', 'lost']
const LEAD_SOURCES: LeadSource[] = ['manual', 'whatsapp', 'referral', 'walk_in', 'other']

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
        const firstName = String(f.get('firstName') || '')
        const lastName = String(f.get('lastName') || '')
        onSubmit({
            firstName,
            lastName,
            fullName: [firstName, lastName].filter(Boolean).join(' '),
            phone: String(f.get('phone') || ''),
            whatsappNo: String(f.get('whatsappNo') || ''),
            email: String(f.get('email') || ''),
            preferredContact: String(f.get('preferredContact') || 'whatsapp'),
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
                <Field label="First name">
                    <Input name="firstName" defaultValue={initial?.firstName || initial?.fullName?.split(' ')[0]} required />
                </Field>
                <Field label="Last name">
                    <Input name="lastName" defaultValue={initial?.lastName || initial?.fullName?.split(' ').slice(1).join(' ')} />
                </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                    <Input name="phone" defaultValue={initial?.phone} required />
                </Field>
                <Field label="WhatsApp No.">
                    <Input name="whatsappNo" defaultValue={initial?.whatsappNo} placeholder="Same as phone if empty" />
                </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Email (optional)">
                    <Input name="email" type="email" defaultValue={initial?.email} />
                </Field>
                <Field label="Preferred contact">
                    <Select name="preferredContact" defaultValue={initial?.preferredContact || 'whatsapp'}>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="email">Email</option>
                    </Select>
                </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Lead datetime">
                    <Input
                        name="leadDateTime"
                        type="datetime-local"
                        defaultValue={toDatetimeLocal(initial?.leadDateTime || new Date().toISOString())}
                        required
                    />
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

            <div className="grid grid-cols-3 gap-3">
                <Field label="Storage size (sqft)">
                    <Input name="storageSizeValue" type="number" min={0} step="1" defaultValue={initial?.storageSizeValue ?? 25} required />
                </Field>
                <Field label="Duration needed">
                    <div className="flex gap-2">
                        <Input name="durationValue" type="number" min={1} step="1" defaultValue={initial?.durationValue ?? 1} required className="flex-1" />
                        <Select name="durationUnit" defaultValue={initial?.durationUnit || 'month'} className="w-28">
                            <option value="week">Week(s)</option>
                            <option value="month">Month(s)</option>
                        </Select>
                    </div>
                </Field>
                <Field label="Units needed">
                    <Input name="unitsNeeded" type="number" min={1} step="1" defaultValue={initial?.unitsNeeded ?? 1} required />
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

function LeadDetailPanel({ lead }: { lead: Lead }) {
    const qc = useQueryClient()
    const [commentText, setCommentText] = useState('')

    const { data: detail } = useQuery<Lead>({
        queryKey: ['lead-detail', lead._id],
        queryFn: () => api.get(`/leads/${lead._id}`).then(r => r.data),
    })

    const addComment = useMutation({
        mutationFn: (text: string) => api.post(`/leads/${lead._id}/comments`, { text }).then(r => r.data),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['lead-detail', lead._id] })
            qc.invalidateQueries({ queryKey: ['leads'] })
            setCommentText('')
        },
    })

    const comments = detail?.comments || []
    const timeline = detail?.timeline || []

    return (
        <div className="space-y-5">
            {/* Lead info header */}
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-lg font-semibold">{detail?.fullName || lead.fullName}</h3>
                    <div className="flex flex-wrap gap-3 mt-1 text-sm text-muted-foreground">
                        {lead.phone && <span>Phone: {lead.phone}</span>}
                        {lead.whatsappNo && <span>WA: {lead.whatsappNo}</span>}
                        {lead.email && <span>{lead.email}</span>}
                    </div>
                    <div className="flex gap-2 mt-2">
                        <Badge tone={leadStatusTone[lead.status]}>{statusLabel(lead.status)}</Badge>
                        <Badge tone="gray">{statusLabel(lead.source)}</Badge>
                        {lead.preferredContact && (
                            <Badge tone={lead.preferredContact === 'whatsapp' ? 'green' : 'blue'}>
                                {lead.preferredContact === 'whatsapp' ? 'WhatsApp' : 'Email'} preferred
                            </Badge>
                        )}
                    </div>
                </div>
            </div>

            {/* Quick info */}
            <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Storage</p>
                    <p className="font-semibold text-sm">{lead.storageSizeValue} sqft</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Duration</p>
                    <p className="font-semibold text-sm">{lead.durationValue} {lead.durationUnit}(s)</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Units</p>
                    <p className="font-semibold text-sm">{lead.unitsNeeded}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Owner</p>
                    <p className="font-semibold text-sm">{lead.owner?.name || '—'}</p>
                </div>
            </div>

            {/* Notes */}
            {lead.notes && (
                <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
                </div>
            )}

            {/* Comments section */}
            <div>
                <h4 className="text-sm font-semibold mb-3">Comments & Activity</h4>

                {/* Add comment */}
                <div className="flex gap-2 mb-4">
                    <Textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Write a comment..."
                        rows={2}
                        className="flex-1"
                    />
                    <Button
                        onClick={() => { if (commentText.trim()) addComment.mutate(commentText.trim()) }}
                        disabled={!commentText.trim() || addComment.isPending}
                        className="self-end"
                    >
                        <Send size={14} />
                    </Button>
                </div>

                {/* Comments list */}
                <div className="space-y-3 max-h-80 overflow-auto">
                    {comments.length === 0 && timeline.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">No comments or activity yet.</p>
                    )}
                    {comments.slice().reverse().map((c: LeadComment) => (
                        <div key={c._id} className="rounded-lg border bg-background p-3">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-xs font-semibold">{c.user?.name || c.userName || 'User'}</span>
                                <span className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{c.text}</p>
                        </div>
                    ))}

                    {/* Timeline/Activity log */}
                    {timeline.length > 0 && (
                        <div className="border-t pt-3 mt-3">
                            <p className="text-xs font-semibold text-muted-foreground mb-2">Activity Log</p>
                            {timeline.slice().reverse().map((t, i) => (
                                <div key={i} className="flex items-start gap-2 py-1.5 text-xs text-muted-foreground">
                                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                                    <span>{t.text}</span>
                                    <span className="ml-auto shrink-0">{formatDate(t.at)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

type ImportResult = { created: number; skipped: number; errors: number; total: number }
type ContactRow = { firstName: string; lastName: string; phone: string; email: string; organization: string }
type WhatsAppLeadRow = {
    lead: {
        _id: string
        fullName: string
        phone: string
        status?: string
        source?: string
        notes?: string
        updatedAt?: string
        createdAt?: string
    }
    labels: string[]
    mappedStatus?: string
    totalMessages: number
    lastFiveMessages: Array<{
        messageId: string
        text: string
        direction: 'inbound' | 'outbound'
        occurredAt?: string
    }>
    whatsappWebLink?: string
}

function parseCsvLine(line: string): string[] {
    const result: string[] = []
    let field = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { field += '"'; i++ }
            else inQuotes = !inQuotes
        } else if (ch === ',' && !inQuotes) {
            result.push(field); field = ''
        } else {
            field += ch
        }
    }
    result.push(field)
    return result
}

function parseGoogleContactsCsv(text: string): ContactRow[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return []
    const header = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim())
    const firstNameIdx = header.findIndex(h => h === 'first name')
    const lastNameIdx = header.findIndex(h => h === 'last name')
    const orgIdx = header.findIndex(h => h === 'organization name')
    const phoneIdxs = header.reduce<number[]>((acc, h, i) => { if (h.includes('phone') && h.includes('value')) acc.push(i); return acc }, [])
    const emailIdxs = header.reduce<number[]>((acc, h, i) => { if ((h.includes('e-mail') || h.includes('email')) && h.includes('value')) acc.push(i); return acc }, [])
    const contacts: ContactRow[] = []
    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i])
        const phone = phoneIdxs.map(idx => row[idx]?.trim()).find(p => p) || ''
        if (!phone) continue
        contacts.push({
            firstName: firstNameIdx >= 0 ? (row[firstNameIdx]?.trim() || '') : '',
            lastName: lastNameIdx >= 0 ? (row[lastNameIdx]?.trim() || '') : '',
            phone,
            email: emailIdxs.map(idx => row[idx]?.trim()).find(e => e) || '',
            organization: orgIdx >= 0 ? (row[orgIdx]?.trim() || '') : '',
        })
    }
    return contacts
}

type ActionType = 'note' | 'email' | 'whatsapp' | 'task' | 'meeting' | 'more' | null

function ActionButton({ icon, label, active, onClick }: { icon: ReactNode; label: string; active?: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground hover:text-foreground'}`}
        >
            <span className={`flex h-8 w-8 items-center justify-center rounded-full border ${active ? 'border-primary-foreground/30 bg-white/20' : 'border-border bg-background'}`}>
                {icon}
            </span>
            {label}
        </button>
    )
}

function ContactDetailPanel({ row, onUpdateLead }: { row: WhatsAppLeadRow; onUpdateLead: (id: string, body: Record<string, unknown>) => void }) {
    const navigate = useNavigate()
    const [action, setAction] = useState<ActionType>(null)
    const [noteText, setNoteText] = useState('')
    const [taskTitle, setTaskTitle] = useState('')
    const [taskDue, setTaskDue] = useState('')
    const [savedNote, setSavedNote] = useState('')
    const [showMore, setShowMore] = useState(false)

    const lead = row.lead
    const phone = lead.phone || ''
    const email = (lead as any).email || ''
    const name = lead.fullName || 'Unknown'

    function toggleAction(a: ActionType) {
        setAction(prev => prev === a ? null : a)
        setShowMore(false)
    }

    function saveNote() {
        if (!noteText.trim()) return
        const existing = lead.notes ? lead.notes + '\n' : ''
        onUpdateLead(lead._id, { notes: existing + `[Note ${new Date().toLocaleDateString()}] ${noteText.trim()}` })
        setSavedNote(noteText.trim())
        setNoteText('')
        setAction(null)
    }

    function saveTask() {
        if (!taskTitle.trim()) return
        const existing = lead.notes ? lead.notes + '\n' : ''
        const dueStr = taskDue ? ` (due ${taskDue})` : ''
        onUpdateLead(lead._id, { notes: existing + `[Task${dueStr}] ${taskTitle.trim()}` })
        setTaskTitle('')
        setTaskDue('')
        setAction(null)
    }

    function googleCalendarUrl() {
        const title = encodeURIComponent(`Meeting with ${name}`)
        const details = encodeURIComponent(`Lead from PurpleBox\nPhone: ${phone}${email ? `\nEmail: ${email}` : ''}`)
        const now = new Date()
        const start = new Date(now.getTime() + 24 * 60 * 60 * 1000)
        start.setMinutes(0, 0, 0)
        const end = new Date(start.getTime() + 60 * 60 * 1000)
        const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
        return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&dates=${fmt(start)}/${fmt(end)}`
    }

    function outlookCalendarUrl() {
        const title = encodeURIComponent(`Meeting with ${name}`)
        const body = encodeURIComponent(`Lead from PurpleBox\nPhone: ${phone}`)
        return `https://outlook.office.com/calendar/0/deeplink/compose?subject=${title}&body=${body}&path=%2Fcalendar%2Faction%2Fcompose`
    }

    return (
        <div>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5 pb-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">
                        {name.split(' ').slice(0, 2).map((w: string) => w[0] ?? '').join('').toUpperCase() || '?'}
                    </div>
                    <div>
                        <h3 className="text-xl font-semibold leading-tight">{name}</h3>
                        <p className="text-sm text-muted-foreground">{phone || 'No phone'}</p>
                    </div>
                </div>
                <button
                    onClick={() => navigate('/moving/leads', { state: { prefill: { prospectName: name, prospectPhone: phone, source: 'phone' } } })}
                    className="rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/20 dark:text-purple-400"
                >
                    Move Lead →
                </button>
            </div>

            {/* Action bar */}
            <div className="flex items-center justify-around border-b bg-muted/30 px-4 py-2">
                <ActionButton icon={<FileText size={15} />} label="Note" active={action === 'note'} onClick={() => toggleAction('note')} />
                <ActionButton icon={<Mail size={15} />} label="Email" active={action === 'email'} onClick={() => toggleAction('email')} />
                <ActionButton icon={<MessageCircle size={15} />} label="WhatsApp" active={action === 'whatsapp'} onClick={() => toggleAction('whatsapp')} />
                <ActionButton icon={<CheckSquare size={15} />} label="Task" active={action === 'task'} onClick={() => toggleAction('task')} />
                <ActionButton icon={<CalendarPlus size={15} />} label="Meeting" active={action === 'meeting'} onClick={() => toggleAction('meeting')} />
                <div className="relative">
                    <ActionButton icon={<MoreHorizontal size={15} />} label="More" active={showMore} onClick={() => { setShowMore(v => !v); setAction(null) }} />
                    {showMore && (
                        <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border bg-popover shadow-lg py-1">
                            <button onClick={() => { window.open(`https://wa.me/${phone.replace(/\D/g, '').replace(/^00/, '')}`, '_blank'); setShowMore(false) }}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-muted">WhatsApp</button>
                            <button onClick={() => { navigator.clipboard.writeText(phone); setShowMore(false) }}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-muted">Copy phone</button>
                            {email && <button onClick={() => { navigator.clipboard.writeText(email); setShowMore(false) }}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-muted">Copy email</button>}
                            <hr className="my-1" />
                            <button onClick={() => { window.open(googleCalendarUrl(), '_blank'); setShowMore(false) }}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-muted">Google Calendar</button>
                            <button onClick={() => { window.open(outlookCalendarUrl(), '_blank'); setShowMore(false) }}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-muted">Outlook Calendar</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Action panels */}
            {action === 'note' && (
                <div className="border-b bg-muted/20 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">Add a note</p>
                        <button onClick={() => setAction(null)}><X size={14} className="text-muted-foreground" /></button>
                    </div>
                    <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={3}
                        placeholder="Type your note here…"
                        className="w-full rounded-lg border bg-background p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setAction(null)} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted">Cancel</button>
                        <button onClick={saveNote} className="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">Save note</button>
                    </div>
                    {savedNote && <p className="text-xs text-emerald-600">✓ Note saved</p>}
                </div>
            )}

            {action === 'email' && (
                <div className="border-b bg-muted/20 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">Send email</p>
                        <button onClick={() => setAction(null)}><X size={14} className="text-muted-foreground" /></button>
                    </div>
                    {email ? (
                        <a href={`mailto:${email}?subject=Regarding your storage inquiry&body=Hello ${encodeURIComponent(name)},%0D%0A%0D%0A`}
                            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
                            <Mail size={14} /> Open email to {email}
                        </a>
                    ) : (
                        <p className="text-sm text-muted-foreground">No email address on file for this contact.</p>
                    )}
                </div>
            )}

            {action === 'whatsapp' && (
                <div className="border-b bg-muted/20 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">Send WhatsApp message</p>
                        <button onClick={() => setAction(null)}><X size={14} className="text-muted-foreground" /></button>
                    </div>
                    {phone ? (
                        <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">Phone: <span className="font-mono font-semibold text-foreground">{phone}</span></p>
                            <div className="flex flex-wrap gap-2">
                                <a href={`https://wa.me/${phone.replace(/\D/g, '').replace(/^00/, '')}?text=${encodeURIComponent(`Hello ${name},\n\nThank you for your interest in PurpleBox Storage.\n\nHow can we help you today?`)}`}
                                    target="_blank" rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500">
                                    <MessageCircle size={14} /> Open WhatsApp
                                </a>
                                <a href={row.whatsappWebLink || `https://web.whatsapp.com/send?phone=${phone.replace(/\D/g, '')}`}
                                    target="_blank" rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-muted">
                                    WhatsApp Web
                                </a>
                            </div>
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">No phone number on file.</p>
                    )}
                </div>
            )}

            {action === 'task' && (
                <div className="border-b bg-muted/20 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">Create task</p>
                        <button onClick={() => setAction(null)}><X size={14} className="text-muted-foreground" /></button>
                    </div>
                    <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Task title…"
                        className="w-full rounded-lg border bg-background p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                    <input type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)}
                        className="w-full rounded-lg border bg-background p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setAction(null)} className="rounded-lg border px-3 py-1.5 text-xs hover:bg-muted">Cancel</button>
                        <button onClick={saveTask} className="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90">Save task</button>
                    </div>
                </div>
            )}

            {action === 'meeting' && (
                <div className="border-b bg-muted/20 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold">Schedule a meeting</p>
                        <button onClick={() => setAction(null)}><X size={14} className="text-muted-foreground" /></button>
                    </div>
                    <p className="text-xs text-muted-foreground">Choose your calendar app to create a meeting with <strong>{name}</strong>:</p>
                    <div className="grid grid-cols-2 gap-2">
                        <a href={googleCalendarUrl()} target="_blank" rel="noreferrer"
                            className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-400">
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M19.5 3h-2V1.5A.5.5 0 0 0 17 1h-1a.5.5 0 0 0-.5.5V3h-7V1.5A.5.5 0 0 0 8 1H7a.5.5 0 0 0-.5.5V3h-2A2.5 2.5 0 0 0 2 5.5v15A2.5 2.5 0 0 0 4.5 23h15a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 19.5 3zM21 20.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20.5V10h18v10.5zM21 9H3V5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5V9z" /></svg>
                            Google Calendar
                        </a>
                        <a href={outlookCalendarUrl()} target="_blank" rel="noreferrer"
                            className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400">
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M24 7.387v13.227A1.39 1.39 0 0 1 22.613 22H7.5l-.024-.003L7.47 22H1.387A1.39 1.39 0 0 1 0 20.613V7.387A1.39 1.39 0 0 1 1.387 6H6V3.387A1.39 1.39 0 0 1 7.387 2h9.226A1.39 1.39 0 0 1 18 3.387V6h4.613A1.39 1.39 0 0 1 24 7.387zm-6-4H7.5v2.625h10.5V3.387zM12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25z" /></svg>
                            Outlook Calendar
                        </a>
                    </div>
                    <p className="text-xs text-muted-foreground">Meeting will be pre-filled with contact name and phone.</p>
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 p-4 border-b">
                <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Source</p>
                    <p className="font-semibold capitalize text-sm">{lead.source || 'WhatsApp'}</p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Messages</p>
                    <p className="font-semibold text-sm">{row.totalMessages || 0}</p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Last seen</p>
                    <p className="font-semibold text-sm">{formatDate(lead.updatedAt || lead.createdAt)}</p>
                </div>
            </div>

            {/* Labels */}
            {(row.labels || []).length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 py-3 border-b">
                    {row.labels.map((l) => (
                        <span key={l} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">{l}</span>
                    ))}
                </div>
            )}

            {/* Recent messages */}
            <div className="p-4 space-y-2 max-h-64 overflow-auto">
                {(row.lastFiveMessages || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">No messages saved yet.</p>
                ) : (
                    row.lastFiveMessages.map((msg) => (
                        <div key={msg.messageId} className={`rounded-xl border bg-background p-3 ${msg.direction === 'outbound' ? 'border-l-4 border-l-emerald-600' : 'border-l-4 border-l-[#FFF799]'}`}>
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span className="capitalize">{msg.direction || 'inbound'}</span>
                                <span>{formatDate(msg.occurredAt)}</span>
                            </div>
                            <p className="mt-1 text-sm whitespace-pre-wrap">{msg.text || '(non-text message)'}</p>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default function Leads() {
    const qc = useQueryClient()
    const navigate = useNavigate()

    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('')
    const [source, setSource] = useState('')
    const [owner, setOwner] = useState('')
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')

    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<Lead | null>(null)
    const [viewing, setViewing] = useState<Lead | null>(null)
    const [error, setError] = useState('')
    const [importResult, setImportResult] = useState<ImportResult | null>(null)
    const [pendingChange, setPendingChange] = useState<{ lead: Lead; newStatus: LeadStatus } | null>(null)
    const [changeComment, setChangeComment] = useState('')
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [waSearch, setWaSearch] = useState('')
    const [waLabel, setWaLabel] = useState('')
    const [selectedWhatsAppLeadId, setSelectedWhatsAppLeadId] = useState('')
    const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null)

    const { data: expandedMessages, isLoading: messagesLoading } = useQuery<{ ok: boolean; messages: { _id: string; text: string; direction: string; occurredAt: string; type: string }[] }>({
        queryKey: ['lead-messages', expandedLeadId],
        queryFn: () => api.get(`/leads/${expandedLeadId}/messages?limit=20`).then(r => r.data),
        enabled: !!expandedLeadId,
    })

    const useWhatsAppLeadView = false

    const whatsAppContacts = useQuery<{ contacts: WhatsAppLeadRow[]; total: number }>({
        queryKey: ['whatsapp-leads-table'],
        queryFn: async () => {
            const rows = (await leadApi.list({ source: 'whatsapp', limit: 500 })).data
            const contacts: WhatsAppLeadRow[] = rows.map((lead) => ({
                lead: {
                    _id: lead._id,
                    fullName: lead.fullName,
                    phone: lead.phone,
                    status: lead.status,
                    source: lead.source,
                    notes: lead.notes,
                    createdAt: lead.createdAt,
                },
                labels: [],
                mappedStatus: lead.status,
                totalMessages: 0,
                lastFiveMessages: [],
            }))

            return {
                contacts,
                total: contacts.length,
            }
        },
        enabled: useWhatsAppLeadView,
    })

    const whatsAppLabelOptions = useMemo(() => {
        const labels = (whatsAppContacts.data?.contacts || [])
            .flatMap((row) => row.labels || [])
            .map((v) => String(v || '').trim())
            .filter(Boolean)
        return Array.from(new Set(labels)).sort((a, b) => a.localeCompare(b))
    }, [whatsAppContacts.data?.contacts])

    const filteredWhatsAppContacts = useMemo(() => {
        const rows = whatsAppContacts.data?.contacts || []
        const q = waSearch.trim().toLowerCase()
        return rows.filter((row) => {
            if (waLabel && !(row.labels || []).includes(waLabel)) return false
            if (!q) return true
            const lead = row.lead || { fullName: '', phone: '', notes: '' }
            const labels = (row.labels || []).join(' ')
            const blob = `${lead.fullName || ''} ${lead.phone || ''} ${lead.notes || ''} ${labels}`.toLowerCase()
            return blob.includes(q)
        })
    }, [whatsAppContacts.data?.contacts, waSearch, waLabel])

    const selectedWhatsAppRow = useMemo(
        () => filteredWhatsAppContacts.find((row) => row.lead?._id === selectedWhatsAppLeadId) || filteredWhatsAppContacts[0],
        [filteredWhatsAppContacts, selectedWhatsAppLeadId]
    )

    const { data: users } = useQuery<{ _id: string; name: string; email: string }[]>({
        queryKey: ['lead-owners'],
        queryFn: () => api.get('/auth/me').then((r) => {
            const u = r.data?.user
            if (!u?.id) return []
            return [{ _id: u.id, name: u.name, email: u.email }]
        }),
    })

    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(25)

    const queryParams = useMemo(
        () => ({
            search: search || undefined,
            status: status || undefined,
            source: source || undefined,
            owner: owner || undefined,
            from: from || undefined,
            to: to || undefined,
            page,
            limit,
        }),
        [search, status, source, owner, from, to, page, limit]
    )

    // Back to page 1 whenever a filter changes
    useEffect(() => { setPage(1) }, [search, status, source, owner, from, to, limit])

    const { data: leadsPage, isLoading } = useQuery<LeadPage>({
        queryKey: ['leads', queryParams],
        queryFn: () => leadApi.list(queryParams),
        placeholderData: (prev) => prev,
    })
    const leads = leadsPage?.data

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
        mutationFn: ({ id, nextStatus, comment }: { id: string; nextStatus: LeadStatus; comment?: string }) =>
            leadApi.updateStatus(id, nextStatus, comment),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leads'] })
            setPendingChange(null)
            setChangeComment('')
        },
    })

    const removeLead = useMutation({
        mutationFn: (id: string) => leadApi.remove(id),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
    })

    const importContacts = useMutation({
        mutationFn: (contacts: ContactRow[]) =>
            api.post<ImportResult>('/leads/import/bulk', { contacts }).then(r => r.data),
        onSuccess: (data) => {
            qc.invalidateQueries({ queryKey: ['leads'] })
            setImportResult(data)
        },
        onError: (e) => setError(apiError(e)),
    })

    function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
            const contacts = parseGoogleContactsCsv(ev.target?.result as string)
            importContacts.mutate(contacts)
        }
        reader.readAsText(file)
        e.target.value = ''
    }

    if (useWhatsAppLeadView) {
        return (
            <div className="relative space-y-4">
                <div className="pointer-events-none absolute -top-16 -left-10 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-20 -right-10 h-64 w-64 rounded-full bg-[#4C8CE4]/15 blur-3xl" />

                <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 p-6 text-emerald-50 shadow-2xl">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-xs uppercase tracking-[0.16em] text-emerald-200/90">Unified Pipeline</p>
                            <h1 className="mt-1 text-3xl font-semibold">WhatsAppLead Contacts</h1>
                            <p className="mt-2 text-sm text-emerald-100/85">Loaded from your leads table (source: whatsapp).</p>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setAdding(true)} className="border-emerald-200/30 bg-white/10 text-emerald-50 hover:bg-white/20">
                                <Plus size={15} /> Add manual lead
                            </Button>
                            <Button onClick={() => whatsAppContacts.refetch()} disabled={whatsAppContacts.isFetching} className="bg-[#FFF799] text-[#111218] hover:opacity-90">
                                <RefreshCw size={15} className={whatsAppContacts.isFetching ? 'animate-spin' : ''} />
                                {whatsAppContacts.isFetching ? 'Refreshing…' : 'Refresh'}
                            </Button>
                        </div>
                    </div>
                </section>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-2xl border bg-card/95 p-4 shadow-sm">
                        <p className="text-xs text-muted-foreground">WhatsApp Leads</p>
                        <p className="text-3xl font-semibold tracking-tight">{whatsAppContacts.data?.contacts?.length || 0}</p>
                    </div>
                    <div className="rounded-2xl border bg-card/95 p-4 shadow-sm">
                        <p className="text-xs text-muted-foreground">Labelled Contacts</p>
                        <p className="text-3xl font-semibold tracking-tight">{(whatsAppContacts.data?.contacts || []).filter((x) => (x.labels || []).length > 0).length}</p>
                    </div>
                    <div className="rounded-2xl border bg-card/95 p-4 shadow-sm">
                        <p className="text-xs text-muted-foreground">Stored Messages</p>
                        <p className="text-3xl font-semibold tracking-tight">{(whatsAppContacts.data?.contacts || []).reduce((sum, row) => sum + Number(row.totalMessages || 0), 0)}</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-2 max-w-3xl">
                    <Input placeholder="Search name, phone, label" value={waSearch} onChange={(e) => setWaSearch(e.target.value)} className="bg-card/95" />
                    <Select value={waLabel} onChange={(e) => setWaLabel(e.target.value)}>
                        <option value="">All labels</option>
                        {whatsAppLabelOptions.map((label) => (
                            <option key={label} value={label}>{label}</option>
                        ))}
                    </Select>
                </div>

                {whatsAppContacts.isLoading ? (
                    <Spinner />
                ) : whatsAppContacts.error ? (
                    <Card className="p-6">
                        <p className="text-sm text-destructive">{apiError(whatsAppContacts.error)}</p>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
                        <div className="overflow-hidden rounded-2xl border bg-card/95 shadow-sm">
                            <div className="max-h-[70vh] overflow-auto">
                                {filteredWhatsAppContacts.length === 0 ? (
                                    <EmptyState message="No WhatsApp leads found." />
                                ) : (
                                    filteredWhatsAppContacts.map((row) => {
                                        const active = (selectedWhatsAppRow?.lead?._id || '') === row.lead?._id
                                        return (
                                            <button
                                                key={row.lead._id}
                                                className={`w-full border-b px-4 py-3 text-left transition-colors ${active ? 'bg-emerald-50/80 dark:bg-emerald-900/20' : 'hover:bg-muted/50'}`}
                                                onClick={() => setSelectedWhatsAppLeadId(row.lead._id)}
                                            >
                                                <div className="font-semibold">{row.lead.fullName || 'Unknown'}</div>
                                                <div className="mt-1 text-xs text-muted-foreground">
                                                    {row.lead.phone || 'No phone'}
                                                    {(row.labels || []).length > 0 ? ` • ${row.labels.slice(0, 2).join(', ')}` : ' • No labels'}
                                                </div>
                                            </button>
                                        )
                                    })
                                )}
                            </div>
                        </div>

                        <div className="rounded-2xl border bg-card/95 shadow-sm overflow-hidden">
                            {!selectedWhatsAppRow ? (
                                <div className="p-5"><EmptyState message="Select a contact to see details." /></div>
                            ) : (
                                <ContactDetailPanel
                                    row={selectedWhatsAppRow}
                                    onUpdateLead={(id, body) => updateLead.mutate({ id, body })}
                                />
                            )}
                        </div>
                    </div>
                )}

                <Modal open={adding} onClose={() => { setAdding(false); setError('') }} title="Add lead" wide>
                    <LeadForm
                        users={users || []}
                        busy={createLead.isPending}
                        error={error}
                        onSubmit={(body) => createLead.mutate(body)}
                    />
                </Modal>
            </div>
        )
    }

    const statusColors: Record<string, { bg: string; fg: string }> = {
        new: { bg: '#E8F9EE', fg: '#0F7A3D' },
        contacted: { bg: '#E0F2FE', fg: '#0369A1' },
        qualified: { bg: '#F3E8FF', fg: '#7C3AED' },
        proposal_sent: { bg: '#FEF3C7', fg: '#B45309' },
        won: { bg: '#D1FAE5', fg: '#065F46' },
        lost: { bg: '#FEE2E2', fg: '#991B1B' },
    }

    const sourceDotColor: Record<string, string> = {
        whatsapp: '#25D366',
        manual: '#756E80',
        referral: '#F59E0B',
        walk_in: '#3B82F6',
        other: '#9CA3AF',
    }

    function getInitials(name: string) {
        return name.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?'
    }

    function timeAgo(dateStr: string | undefined) {
        if (!dateStr) return ''
        const diff = Date.now() - new Date(dateStr).getTime()
        const mins = Math.floor(diff / 60000)
        if (mins < 60) return `${mins}m ago`
        const hrs = Math.floor(mins / 60)
        if (hrs < 24) return `${hrs}h ago`
        const days = Math.floor(hrs / 24)
        if (days < 30) return `${days}d ago`
        return `${Math.floor(days / 30)}mo ago`
    }

    const isFiltered = !!(search || status || source || owner || from || to)

    const newCount = (leads || []).filter(l => l.status === 'new').length

    const statusChips = LEAD_STATUSES.map(s => {
        const count = (leads || []).filter(l => l.status === s).length
        const active = status === s
        return {
            key: s,
            label: statusLabel(s),
            count,
            active,
            border: active ? '#5B2BC9' : 'rgba(20,8,31,0.12)',
            bg: active ? '#F7F3FF' : 'transparent',
            fg: active ? '#4A1FA0' : '#4A4357',
        }
    })

    return (
        <div style={{ minHeight: '100vh', padding: '36px 32px 64px', background: '#FBF8F2', fontFamily: "'Roboto', sans-serif" }}>
            <div style={{ maxWidth: 1240, margin: '0 auto' }}>

                {/* ── Card wrapper ── */}
                <div style={{ background: '#fff', border: '1px solid rgba(20,8,31,.10)', borderRadius: 22, boxShadow: '0 8px 24px rgba(20,8,31,.05)', padding: '24px 24px 0' }}>

                {/* ── Header ── */}
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 26 }}>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: PURPLE }}>Pipeline</div>
                        <h1 style={{ ...HEADING, fontWeight: 700, fontSize: 40, lineHeight: 1.05, margin: '10px 0 0', color: INK }}>Leads</h1>
                        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#4A4357' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 600, color: INK }}>
                                <span style={{ width: 7, height: 7, borderRadius: 99, background: '#22c55e', boxShadow: '0 0 0 3px rgba(34,197,94,.18)' }} />
                                {leadsPage?.total ?? 0} leads
                            </span>
                            <span style={{ color: '#B7B1C0' }}>·</span>
                            <span>{newCount} new</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvFile} />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={importContacts.isPending}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 9, height: 46, padding: '0 20px',
                                borderRadius: 999, border: '1px solid rgba(20,8,31,.16)', background: 'transparent',
                                color: INK, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                                opacity: importContacts.isPending ? 0.5 : 1,
                            }}
                        >
                            <Upload size={17} />
                            {importContacts.isPending ? 'Importing…' : 'Import CSV'}
                        </button>
                        <button
                            onClick={() => setAdding(true)}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 9, height: 46, padding: '0 22px',
                                borderRadius: 999, border: '1px solid transparent', background: PURPLE, color: '#fff',
                                fontSize: 14, fontWeight: 600, cursor: 'pointer', boxShadow: '0 8px 24px rgba(91,43,201,.24)',
                            }}
                        >
                            <Plus size={17} /> Add lead
                        </button>
                    </div>
                </div>

                {/* ── Status chips ── */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
                    <button
                        onClick={() => setStatus('')}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 9, height: 38, padding: '0 16px',
                            borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            border: `1px solid ${!status ? '#5B2BC9' : 'rgba(20,8,31,0.12)'}`,
                            background: !status ? '#F7F3FF' : 'transparent',
                            color: !status ? '#4A1FA0' : '#4A4357',
                        }}
                    >
                        All <span style={{ fontVariantNumeric: 'tabular-nums', opacity: .65, fontWeight: 700 }}>{leadsPage?.total ?? 0}</span>
                    </button>
                    {statusChips.map(chip => (
                        <button
                            key={chip.key}
                            onClick={() => setStatus(chip.active ? '' : chip.key)}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 9, height: 38, padding: '0 16px',
                                borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                border: `1px solid ${chip.border}`, background: chip.bg, color: chip.fg,
                            }}
                        >
                            {chip.label} <span style={{ fontVariantNumeric: 'tabular-nums', opacity: .65, fontWeight: 700 }}>{chip.count}</span>
                        </button>
                    ))}
                </div>

                {/* ── Filter bar ── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 14px', background: '#F6F0E4', border: '1px solid rgba(20,8,31,.08)', borderRadius: 18, marginBottom: 14 }}>
                    <div style={{ flex: '1 1 260px', minWidth: 220, display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 16px', background: '#fff', border: '1px solid rgba(20,8,31,.10)', borderRadius: 999 }}>
                        <Search size={16} style={{ color: MUTED_COLOR, flexShrink: 0 }} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search name, phone, email"
                            style={{ flex: 1, border: 0, background: 'transparent', fontSize: 14, color: INK, outline: 'none', minWidth: 0 }}
                        />
                    </div>
                    <select
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                        style={{ height: 44, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(20,8,31,.10)', background: '#fff', fontSize: 13, fontWeight: 600, color: '#4A4357', cursor: 'pointer' }}
                    >
                        <option value="">All sources</option>
                        {LEAD_SOURCES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </select>
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                        style={{ height: 44, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(20,8,31,.10)', background: '#fff', fontSize: 13, fontWeight: 600, color: '#4A4357' }} />
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                        style={{ height: 44, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(20,8,31,.10)', background: '#fff', fontSize: 13, fontWeight: 600, color: '#4A4357' }} />
                    {isFiltered && (
                        <button
                            onClick={() => { setSearch(''); setStatus(''); setSource(''); setOwner(''); setFrom(''); setTo('') }}
                            style={{ height: 44, padding: '0 16px', borderRadius: 999, border: '1px dashed rgba(20,8,31,.20)', background: 'transparent', fontSize: 13, fontWeight: 600, color: MUTED_COLOR, cursor: 'pointer' }}
                        >
                            Clear
                        </button>
                    )}
                </div>

                {/* ── Table ── */}
                {isLoading ? (
                    <Spinner />
                ) : (
                    <div style={{ margin: '0 -24px', overflow: 'hidden', borderBottomLeftRadius: 22, borderBottomRightRadius: 22 }}>
                        <div style={{ overflowX: 'auto' }}>

                            {/* Header row */}
                            <div style={{ minWidth: 1020, display: 'grid', gridTemplateColumns: '26px minmax(200px,1.5fr) minmax(160px,1.1fr) 120px 130px minmax(130px,.9fr) auto', alignItems: 'center', gap: 14, padding: '14px 22px', background: '#FBF8F2', borderBottom: '1px solid rgba(20,8,31,.10)', fontSize: 11.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase' as const, color: MUTED_COLOR }}>
                                <span />
                                <span>Name</span>
                                <span>Phone / WhatsApp</span>
                                <span>Source</span>
                                <span>Status</span>
                                <span>Added</span>
                                <span style={{ textAlign: 'right' }}>Actions</span>
                            </div>

                            {/* Lead rows */}
                            {(leads || []).map((lead) => {
                                const isOpen = expandedLeadId === lead._id
                                const sc = statusColors[lead.status] || statusColors.new
                                const sdot = sourceDotColor[lead.source] || sourceDotColor.other
                                return (
                                <Fragment key={lead._id}>
                                    <div style={{ minWidth: 1020, borderBottom: '1px solid rgba(20,8,31,.07)' }}>
                                        <div
                                            style={{
                                                display: 'grid', gridTemplateColumns: '26px minmax(200px,1.5fr) minmax(160px,1.1fr) 120px 130px minmax(130px,.9fr) auto',
                                                alignItems: 'center', gap: 14, padding: `${isOpen ? '16px' : '14px'} 22px`,
                                                cursor: lead.source === 'whatsapp' ? 'pointer' : 'default',
                                                background: isOpen ? '#FDFCFA' : 'transparent',
                                                transition: 'background .14s',
                                            }}
                                            onClick={() => { if (lead.source === 'whatsapp') setExpandedLeadId(isOpen ? null : lead._id) }}
                                            onMouseEnter={(e) => { if (!isOpen) e.currentTarget.style.background = '#F7F3FF' }}
                                            onMouseLeave={(e) => { if (!isOpen) e.currentTarget.style.background = 'transparent' }}
                                        >
                                            {/* Chevron */}
                                            <span style={{ display: 'inline-flex', color: '#A79FB2', transition: 'transform .18s ease', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                                                {lead.source === 'whatsapp' ? (
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                                                ) : <span style={{ width: 14 }} />}
                                            </span>

                                            {/* Name */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                                                <span style={{ width: 36, height: 36, flex: '0 0 auto', borderRadius: 12, background: '#EDE5FF', color: '#4A1FA0', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>
                                                    {getInitials(lead.fullName)}
                                                </span>
                                                <span style={{ minWidth: 0 }}>
                                                    <span style={{ display: 'block', fontSize: 15, fontWeight: 600, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.fullName}</span>
                                                    {lead.owner?.name && <span style={{ display: 'block', fontSize: 12.5, color: MUTED_COLOR, marginTop: 2 }}>{lead.owner.name}</span>}
                                                </span>
                                            </div>

                                            {/* Phone */}
                                            <div style={{ fontSize: 14, color: '#4A4357', fontVariantNumeric: 'tabular-nums' }}>{lead.phone}</div>

                                            {/* Source */}
                                            <div>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px 5px 8px', borderRadius: 999, background: '#F6F0E4', border: '1px solid rgba(20,8,31,.06)', fontSize: 12, fontWeight: 600, color: '#4A4357' }}>
                                                    <span style={{ width: 6, height: 6, borderRadius: 99, background: sdot }} />{statusLabel(lead.source)}
                                                </span>
                                            </div>

                                            {/* Status */}
                                            <div>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, letterSpacing: '-.01em', background: sc.bg, color: sc.fg }}>
                                                    <span style={{ width: 6, height: 6, borderRadius: 99, background: sc.fg }} />{statusLabel(lead.status)}
                                                </span>
                                            </div>

                                            {/* Added */}
                                            <div style={{ fontSize: 13.5, color: '#4A4357' }}>
                                                <span style={{ display: 'block', fontWeight: 600, color: INK }}>{timeAgo(lead.leadDateTime)}</span>
                                                <span style={{ display: 'block', fontSize: 12, color: MUTED_COLOR, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{formatDateTime(lead.leadDateTime)}</span>
                                            </div>

                                            {/* Actions */}
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    onClick={() => setViewing(lead)}
                                                    style={{ height: 30, padding: '0 8px', borderRadius: 999, border: 0, background: 'transparent', fontSize: 12, fontWeight: 600, color: '#4A4357', cursor: 'pointer' }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F3FF'; e.currentTarget.style.color = '#4A1FA0' }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#4A4357' }}
                                                >View</button>
                                                <button
                                                    onClick={() => setEditing(lead)}
                                                    style={{ height: 30, padding: '0 8px', borderRadius: 999, border: 0, background: 'transparent', fontSize: 12, fontWeight: 600, color: '#4A4357', cursor: 'pointer' }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.background = '#F7F3FF'; e.currentTarget.style.color = '#4A1FA0' }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#4A4357' }}
                                                >Edit</button>
                                                <button
                                                    onClick={() => navigate(`/quotes/new?lead=${lead._id}`)}
                                                    style={{ height: 30, padding: '0 10px', borderRadius: 999, border: 0, background: '#F7F3FF', fontSize: 12, fontWeight: 600, color: '#4A1FA0', cursor: 'pointer' }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.background = PURPLE; e.currentTarget.style.color = '#fff' }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.background = '#F7F3FF'; e.currentTarget.style.color = '#4A1FA0' }}
                                                >Book</button>
                                                <button
                                                    onClick={() => { if (confirm('Delete this lead?')) removeLead.mutate(lead._id) }}
                                                    style={{ height: 30, padding: '0 8px', borderRadius: 999, border: 0, background: 'transparent', fontSize: 12, fontWeight: 600, color: '#C0392B', cursor: 'pointer' }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FDECEA' }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                                                >Delete</button>
                                            </div>
                                        </div>

                                        {/* Expanded messages */}
                                        {isOpen && (
                                            <div style={{ padding: '4px 22px 26px 62px', borderTop: '1px solid rgba(20,8,31,.06)', background: '#FBF8F2' }}>
                                                <div style={{ ...HEADING, fontSize: 11.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase' as const, color: MUTED_COLOR, marginBottom: 14, paddingTop: 18, position: 'relative' as const }}>Messages</div>
                                                {messagesLoading ? (
                                                    <div style={{ fontSize: 13, color: MUTED_COLOR }}>Loading messages...</div>
                                                ) : !expandedMessages?.messages?.length ? (
                                                    <div style={{ fontSize: 13, color: MUTED_COLOR }}>No messages found for this lead.</div>
                                                ) : (
                                                    <div style={{
                                                        position: 'relative' as const, borderRadius: 14, width: '75%', overflow: 'hidden',
                                                    }}>
                                                        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'url(/chat-b.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.35 }} />
                                                    <div style={{
                                                        position: 'relative' as const,
                                                        display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 350, overflowY: 'auto', padding: '12px 16px',
                                                    }}>
                                                        {expandedMessages.messages.map((msg) => {
                                                            const isOut = msg.direction === 'outbound'
                                                            return (
                                                            <div key={msg._id} style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start' }}>
                                                                <div style={{
                                                                    padding: '8px 12px 6px',
                                                                    borderRadius: isOut ? '10px 10px 4px 10px' : '10px 10px 10px 4px',
                                                                    background: isOut ? '#DCF8C6' : 'white',
                                                                    maxWidth: '70%',
                                                                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                                                }}>
                                                                    <div style={{ fontSize: 13, color: INK, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{msg.text || '(media)'}</div>
                                                                    <div style={{ fontSize: 10, color: MUTED_COLOR, textAlign: 'right', marginTop: 3 }}>
                                                                        {formatDateTime(msg.occurredAt)}
                                                                        {isOut && <span style={{ marginLeft: 4, fontSize: 11, color: '#53BDEB' }}>✓✓</span>}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            )
                                                        })}
                                                    </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </Fragment>
                                )
                            })}

                            {/* Empty state */}
                            {(leads || []).length === 0 && (
                                <div style={{ padding: '72px 24px', textAlign: 'center' }}>
                                    <div style={{ width: 56, height: 56, margin: '0 auto', borderRadius: 16, background: '#F7F3FF', color: PURPLE, display: 'grid', placeItems: 'center' }}>
                                        <Search size={24} />
                                    </div>
                                    <div style={{ ...HEADING, fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', marginTop: 16 }}>No leads match these filters</div>
                                    <p style={{ margin: '8px 0 0', fontSize: 14, color: MUTED_COLOR }}>Try a different status, source or search term.</p>
                                    {isFiltered && (
                                        <button
                                            onClick={() => { setSearch(''); setStatus(''); setSource(''); setOwner(''); setFrom(''); setTo('') }}
                                            style={{ marginTop: 20, height: 44, padding: '0 22px', borderRadius: 999, border: '1px solid rgba(20,8,31,.16)', background: 'transparent', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                                        >Clear filters</button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Pagination */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '16px 22px', background: '#FBF8F2' }}>
                            <span style={{ fontSize: 13, color: MUTED_COLOR }}>
                                {leadsPage?.total ? `${((leadsPage.page - 1) * leadsPage.limit) + 1}–${Math.min(leadsPage.page * leadsPage.limit, leadsPage.total)} of ${leadsPage.total}` : '0 results'}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <select
                                    value={limit}
                                    onChange={(e) => setLimit(Number(e.target.value))}
                                    style={{ height: 38, padding: '0 12px', borderRadius: 999, border: '1px solid rgba(20,8,31,.12)', background: '#fff', fontSize: 13, fontWeight: 600, color: '#4A4357', cursor: 'pointer' }}
                                >
                                    <option value={25}>25 / page</option>
                                    <option value={50}>50 / page</option>
                                    <option value={100}>100 / page</option>
                                </select>
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page <= 1}
                                    style={{ width: 38, height: 38, borderRadius: 999, border: '1px solid rgba(20,8,31,.12)', background: '#fff', color: page <= 1 ? '#B7B1C0' : '#4A4357', cursor: page <= 1 ? 'not-allowed' : 'pointer', display: 'grid', placeItems: 'center' }}
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                                </button>
                                <span style={{ minWidth: 38, height: 38, borderRadius: 999, background: PURPLE, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>{page}</span>
                                <button
                                    onClick={() => setPage(p => Math.min(leadsPage?.pages ?? 1, p + 1))}
                                    disabled={page >= (leadsPage?.pages ?? 1)}
                                    style={{ width: 38, height: 38, borderRadius: 999, border: '1px solid rgba(20,8,31,.12)', background: '#fff', color: page >= (leadsPage?.pages ?? 1) ? '#B7B1C0' : '#4A4357', cursor: page >= (leadsPage?.pages ?? 1) ? 'not-allowed' : 'pointer', display: 'grid', placeItems: 'center' }}
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                </div>{/* ── end card wrapper ── */}

            </div>

            {/* ── Modals ── */}
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

            <Modal
                open={!!pendingChange}
                onClose={() => { setPendingChange(null); setChangeComment('') }}
                title="Update status"
            >
                {pendingChange && (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Moving <strong className="text-foreground">{pendingChange.lead.fullName}</strong> to{' '}
                            <Badge tone={leadStatusTone[pendingChange.newStatus]}>{statusLabel(pendingChange.newStatus)}</Badge>
                        </p>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Comment (optional)</label>
                            <Textarea
                                value={changeComment}
                                onChange={(e) => setChangeComment(e.target.value)}
                                placeholder="Add a note about this change…"
                                rows={3}
                            />
                        </div>
                        <div className="flex gap-2 justify-end">
                            <Button variant="outline" onClick={() => { setPendingChange(null); setChangeComment('') }}>
                                Cancel
                            </Button>
                            <Button
                                disabled={updateStatus.isPending}
                                onClick={() => updateStatus.mutate({
                                    id: pendingChange.lead._id,
                                    nextStatus: pendingChange.newStatus,
                                    comment: changeComment.trim() || undefined,
                                })}
                            >
                                {updateStatus.isPending ? 'Saving…' : 'Update status'}
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal open={!!importResult} onClose={() => setImportResult(null)} title="Import complete">
                {importResult && (
                    <div className="space-y-3 text-sm">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 px-4 py-3 text-center">
                                <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{importResult.created}</div>
                                <div className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">New leads added</div>
                            </div>
                            <div className="rounded-lg bg-muted px-4 py-3 text-center">
                                <div className="text-2xl font-bold">{importResult.skipped}</div>
                                <div className="text-xs text-muted-foreground mt-0.5">Already in system</div>
                            </div>
                        </div>
                        {importResult.errors > 0 && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                {importResult.errors} contact{importResult.errors !== 1 ? 's' : ''} skipped — invalid or missing phone number.
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground">{importResult.total} total rows processed from CSV.</p>
                        <Button className="w-full" onClick={() => setImportResult(null)}>Done</Button>
                    </div>
                )}
            </Modal>

            <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing ? viewing.fullName : 'Lead details'} wide>
                {viewing && <LeadDetailPanel lead={viewing} />}
            </Modal>
        </div>
    )
}

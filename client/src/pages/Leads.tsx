import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, CheckSquare, FileText, Mail, MessageCircle, MoreHorizontal, Plus, RefreshCw, Search, Upload, X } from 'lucide-react'
import { api, apiError, integrationApi, leadApi } from '../lib/api'
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
                {row.whatsappWebLink && (
                    <a href={row.whatsappWebLink} target="_blank" rel="noreferrer"
                        className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                        Open in WhatsApp
                    </a>
                )}
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
                            <button onClick={() => { window.open(`https://wa.me/${phone.replace(/\D/g,'').replace(/^00/,'')}`, '_blank'); setShowMore(false) }}
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
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M19.5 3h-2V1.5A.5.5 0 0 0 17 1h-1a.5.5 0 0 0-.5.5V3h-7V1.5A.5.5 0 0 0 8 1H7a.5.5 0 0 0-.5.5V3h-2A2.5 2.5 0 0 0 2 5.5v15A2.5 2.5 0 0 0 4.5 23h15a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 19.5 3zM21 20.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20.5V10h18v10.5zM21 9H3V5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5V9z"/></svg>
                            Google Calendar
                        </a>
                        <a href={outlookCalendarUrl()} target="_blank" rel="noreferrer"
                            className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400">
                            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M24 7.387v13.227A1.39 1.39 0 0 1 22.613 22H7.5l-.024-.003L7.47 22H1.387A1.39 1.39 0 0 1 0 20.613V7.387A1.39 1.39 0 0 1 1.387 6H6V3.387A1.39 1.39 0 0 1 7.387 2h9.226A1.39 1.39 0 0 1 18 3.387V6h4.613A1.39 1.39 0 0 1 24 7.387zm-6-4H7.5v2.625h10.5V3.387zM12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25z"/></svg>
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
                        <div key={msg.messageId} className={`rounded-xl border bg-background p-3 ${msg.direction === 'outbound' ? 'border-l-4 border-l-emerald-600' : 'border-l-4 border-l-orange-500'}`}>
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
    const [error, setError] = useState('')
    const [importResult, setImportResult] = useState<ImportResult | null>(null)
    const [pendingChange, setPendingChange] = useState<{ lead: Lead; newStatus: LeadStatus } | null>(null)
    const [changeComment, setChangeComment] = useState('')
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [waSearch, setWaSearch] = useState('')
    const [waLabel, setWaLabel] = useState('')
    const [selectedWhatsAppLeadId, setSelectedWhatsAppLeadId] = useState('')

    const whatsAppLeadBaseUrl = (import.meta.env.VITE_WHATSAPPLEAD_BASE_URL as string | undefined)?.trim() || 'http://localhost:5075'
    const useWhatsAppLeadView = true

    const whatsAppContacts = useQuery<{ contacts: WhatsAppLeadRow[]; total: number }>({
        queryKey: ['whatsapplead-contacts', whatsAppLeadBaseUrl],
        queryFn: async () => {
            const response = await fetch(`${whatsAppLeadBaseUrl}/api/contacts`)
            if (!response.ok) throw new Error(`WhatsAppLead unavailable (${response.status})`)
            return response.json()
        },
        enabled: useWhatsAppLeadView,
    })

    const syncWhatsAppLead = useMutation({
        mutationFn: async () => {
            const allowlistCsv = localStorage.getItem('whatsapplead.allowedLabels') || ''
            const allowedLabels = allowlistCsv
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
            const syncOnlyAllowedLabels = localStorage.getItem('whatsapplead.syncOnlyAllowedLabels') === 'true'

            const response = await fetch(`${whatsAppLeadBaseUrl}/api/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ allowedLabels, syncOnlyAllowedLabels }),
            })
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error((data as { error?: string })?.error || `Sync failed (${response.status})`)
            return data as { scrapedCount?: number }
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['whatsapplead-contacts'] })
        },
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

    const [syncMsg, setSyncMsg] = useState<string | null>(null)
    const syncContacts = useMutation({
        mutationFn: () => integrationApi.syncGoogleContacts(),
        onSuccess: (data) => {
            qc.invalidateQueries({ queryKey: ['leads'] })
            setSyncMsg(
                data.summary.created > 0
                    ? `${data.summary.created} new contact${data.summary.created > 1 ? 's' : ''} added from Google`
                    : `Sync done — no new contacts`
            )
            setTimeout(() => setSyncMsg(null), 5000)
        },
        onError: (e) => { setSyncMsg(`Sync failed: ${apiError(e)}`); setTimeout(() => setSyncMsg(null), 5000) },
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
                <div className="pointer-events-none absolute -bottom-20 -right-10 h-64 w-64 rounded-full bg-orange-400/20 blur-3xl" />

                <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 p-6 text-emerald-50 shadow-2xl">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-xs uppercase tracking-[0.16em] text-emerald-200/90">Unified Pipeline</p>
                            <h1 className="mt-1 text-3xl font-semibold">WhatsAppLead Contacts</h1>
                            <p className="mt-2 text-sm text-emerald-100/85">{`Synced from ${whatsAppLeadBaseUrl} into your lead workflow.`}</p>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setAdding(true)} className="border-emerald-200/30 bg-white/10 text-emerald-50 hover:bg-white/20">
                                <Plus size={15} /> Add manual lead
                            </Button>
                            <Button onClick={() => syncWhatsAppLead.mutate()} disabled={syncWhatsAppLead.isPending} className="bg-orange-500 text-white hover:bg-orange-400">
                                <RefreshCw size={15} className={syncWhatsAppLead.isPending ? 'animate-spin' : ''} />
                                {syncWhatsAppLead.isPending ? 'Syncing…' : 'Sync WhatsApp'}
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
                        <p className="text-xs text-muted-foreground mt-2">Start WhatsAppLead server on {whatsAppLeadBaseUrl} and refresh this page.</p>
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

    return (
        <div>
            <PageHeader
                title="Leads"
                subtitle={`${leads?.length ?? 0} leads in pipeline`}
                action={
                    <div className="flex gap-2">
                        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCsvFile} />
                        <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importContacts.isPending}>
                            <Upload size={15} />
                            {importContacts.isPending ? 'Importing…' : 'Import CSV'}
                        </Button>
                        <Button variant="outline" onClick={() => syncContacts.mutate()} disabled={syncContacts.isPending}>
                            <RefreshCw size={15} className={syncContacts.isPending ? 'animate-spin' : ''} />
                            {syncContacts.isPending ? 'Syncing…' : 'Sync Google Contacts'}
                        </Button>
                        <Button onClick={() => setAdding(true)}>
                            <Plus size={15} /> Add lead
                        </Button>
                    </div>
                }
            />

            {syncMsg && (
                <p className={`mb-3 text-xs font-medium ${syncMsg.startsWith('Sync failed') ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {syncMsg}
                </p>
            )}

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
                                            onChange={(e) => {
                                                const newStatus = e.target.value as LeadStatus
                                                if (newStatus !== lead.status) {
                                                    setPendingChange({ lead, newStatus })
                                                    setChangeComment('')
                                                }
                                            }}
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
                                                onClick={() => navigate('/customers', {
                                                    state: {
                                                        prefill: {
                                                            fullName: lead.fullName,
                                                            phone: lead.phone,
                                                            email: lead.email,
                                                            notes: lead.notes,
                                                        }
                                                    }
                                                })}
                                                className="text-emerald-600 hover:underline cursor-pointer"
                                            >
                                                Convert
                                            </button>
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
        </div>
    )
}

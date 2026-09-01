import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarPlus, CheckSquare, FileText, Mail, MessageCircle, MoreHorizontal, Plus, RefreshCw, Search, Upload, X } from 'lucide-react'
import { api, apiError, leadApi, type LeadPage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { fromDubaiDatetimeLocal, toDubaiDatetimeLocal } from '../lib/timezone'
import WaitingStrip from '../components/WaitingStrip'
import type { Lead, LeadSource, LeadStatus } from '../lib/types'
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Spinner, Textarea, leadStatusTone, statusLabel } from '../components/ui'
import { formatDate, formatDateTime } from '../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED_COLOR = '#756E80'
const PURPLE = '#5B2BC9'

/**
 * Making the pipeline usable on a phone.
 *
 * Two things stood in the way. The page is a flex row with a fixed 296px rail
 * beside the list, which on a narrow screen left the list a sliver; and the
 * list is a nine-column grid with a 980px floor, so it could only be read by
 * dragging it sideways — a column at a time, with the headings scrolled off.
 *
 * Below 1024px the rail drops underneath. Below 760px each row stops being a
 * table row and becomes a card: name and actions on top, then the details
 * underneath, labelled — because once the header row is gone, a bare date or
 * a lone number has nothing to say what it is.
 */
const LEADS_CSS = `
@media (max-width: 1024px) {
  .lead-shell { flex-direction: column !important; }
  .lead-rail {
    width: 100% !important; flex: 1 1 auto !important;
    border-left: 0 !important; border-top: 1px solid rgba(20,8,31,.10);
    position: static !important; max-height: none !important;
    border-radius: 18px;
  }
}

@media (max-width: 760px) {
  /* The horizontal scroll and the width floor under it both go, or the card
     layout would still be sitting on a 980px canvas. */
  .lead-table { overflow: visible !important; }
  .lead-table-inner { min-width: 0 !important; }
  .lead-head { display: none !important; }

  .lead-row {
    display: flex !important;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
    padding: 14px !important;
  }
  /* Order, not source order: the row's cells are laid out for a table, and on
     a card the name and its actions belong together at the top. */
  .lead-row > *:nth-child(1) { order: 1; flex: 0 0 auto; }   /* select      */
  .lead-row > *:nth-child(2) { order: 2; flex: 1 1 auto; min-width: 0; }  /* name */
  .lead-row > *:nth-child(9) { order: 3; flex: 0 0 auto; }   /* view/book/delete */
  .lead-row > *:nth-child(3) { order: 4; flex: 1 0 100%; }   /* phone       */
  .lead-row > *:nth-child(4) { order: 5; flex: 0 0 auto; }   /* source      */
  .lead-row > *:nth-child(6) { order: 6; flex: 0 0 auto; }   /* status      */
  .lead-row > *:nth-child(5) { order: 7; flex: 0 0 auto; }   /* assigned to */
  .lead-row > *:nth-child(7) { order: 8; flex: 1 1 44%; }    /* chase       */
  .lead-row > *:nth-child(8) { order: 9; flex: 1 1 44%; }    /* added       */

  /* Without the header row these two are just numbers on a card. The select
     and the pills say what they are already, so only these need telling. */
  .lead-row > *:nth-child(7)::before,
  .lead-row > *:nth-child(8)::before {
    display: block;
    font-size: 10.5px; font-weight: 700; letter-spacing: .08em;
    text-transform: uppercase; color: #756E80; margin-bottom: 2px;
  }
  .lead-row > *:nth-child(7)::before { content: 'Chase'; }
  .lead-row > *:nth-child(8)::before { content: 'Added'; }

  .lead-row > *:nth-child(3) { font-size: 14px !important; }
  /* A full-width select is easier to hit than one sized to a table column. */
  .lead-row > *:nth-child(5) { max-width: none !important; }
}
`

const LEAD_STATUSES: LeadStatus[] = ['new', 'contact_attempted', 'contacted', 'site_visit_scheduled', 'follow_up_scheduled', 'quotation_sent', 'won', 'lost']
const LEAD_SOURCES: LeadSource[] = ['manual', 'whatsapp', 'referral', 'walk_in', 'other']

type WorkloadRow = { _id: string; name: string; count: number }
type LeadStats = {
    total: number
    byStatus: Record<string, number>
    unassigned: number
    byOwner: WorkloadRow[]
    chase?: { none: number; active: number; exhausted: number }
    /* Who has logged an attempt, counted one lead per person rather than one
       per attempt — the question is who is working leads, not who clicks most. */
    byChaser?: WorkloadRow[]
}

// datetime-local inputs carry no timezone and show exactly what they are
// given, so they get Dubai time rather than the reader's.
const toDatetimeLocal = (input?: string) => toDubaiDatetimeLocal(input)

function fromDatetimeLocal(input: FormDataEntryValue | null) {
    if (!input) return undefined
    // What was typed is a Dubai reading, so it is read back as one — otherwise
    // a time entered here shifted by the reader's own offset on the way in.
    return fromDubaiDatetimeLocal(String(input)) || undefined
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
                {/* Blank rather than 25: a prefilled number gets saved as
                    though somebody chose it, and 25 is how every lead in the
                    system ended up claiming to want a 25 sqft unit. */}
                <Field label="Storage size (sqft)">
                    <Input name="storageSizeValue" type="number" min={0} step="1" defaultValue={initial?.storageSizeValue || ''} placeholder="Not asked yet" />
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
    // Where the chase has got to, and who did it.
    const [chase, setChase] = useState('')
    const [attemptBy, setAttemptBy] = useState('')
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')

    const [selected, setSelected] = useState<string[]>([])
    const [drawerId, setDrawerId] = useState<string | null>(null)
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

    const { user: me } = useAuth()
    const isAdmin = me?.role === 'admin'

    /* The team, for every owner dropdown on this page.
     *
     * This used to hit /users and cache under the same key the WhatsApp inbox
     * uses for /users/assignable — one key, two endpoints, so whichever page
     * loaded first decided what the other one saw. Both call the same endpoint
     * now, which is also the one that knows which roles can hold work.
     */
    const { data: assignableUsers } = useQuery<{ _id: string; name: string; email: string; role?: string }[]>({
        queryKey: ['assignable-users'],
        queryFn: () => api.get('/users/assignable').then((r) => r.data ?? []),
        staleTime: 30 * 60_000,
    })

    /* Who the forms may hand a lead to. An admin can choose anyone; everybody
       else can only own it themselves, so the list is just them.

       It used to be only-themselves for admins too - Add lead offered a single
       name, your own, so a lead could not be raised on behalf of the rep who
       took the call without saving it and reassigning it from the table. */
    const { data: me_ } = useQuery<{ _id: string; name: string; email: string }[]>({
        queryKey: ['lead-owners'],
        queryFn: () => api.get('/auth/me').then((r) => {
            const u = r.data?.user
            if (!u?.id) return []
            return [{ _id: u.id, name: u.name, email: u.email }]
        }),
    })
    const users = isAdmin ? assignableUsers : me_

    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(25)

    const queryParams = useMemo(
        () => ({
            search: search.trim() || undefined,
            status: status || undefined,
            source: source || undefined,
            owner: owner || undefined,
            chase: chase || undefined,
            attemptBy: attemptBy || undefined,
            from: from || undefined,
            to: to || undefined,
            page,
            limit,
        }),
        [search, status, source, owner, chase, attemptBy, from, to, page, limit]
    )

    // Back to page 1 whenever a filter changes
    useEffect(() => { setPage(1) }, [search, status, source, owner, chase, attemptBy, from, to, limit])

    const { data: leadsPage, isLoading } = useQuery<LeadPage>({
        queryKey: ['leads', queryParams],
        queryFn: () => leadApi.list(queryParams),
        placeholderData: (prev) => prev,
    })
    const leads = leadsPage?.data

    /* The tabs and the rail both count everything, not the twenty-five rows on
       screen: "New 3" meaning three on this page was worse than no number. */
    const { data: stats } = useQuery<LeadStats>({
        queryKey: ['lead-stats'],
        queryFn: () => api.get('/leads/stats').then((r) => r.data),
    })

    const bulkAssign = useMutation({
        mutationFn: async (ownerId: string) => {
            // One request each: PUT /leads/:id merges over the stored lead, so
            // this touches ownership and nothing else. Sequential rather than
            // parallel — the server validates every field on each save, and a
            // burst of them against one collection buys nothing.
            for (const id of selected) await leadApi.update(id, { owner: ownerId } as unknown as Partial<Lead>)
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leads'] })
            qc.invalidateQueries({ queryKey: ['lead-stats'] })
            setSelected([])
            setError('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const bulkRemove = useMutation({
        mutationFn: async () => {
            // Sequential, like the bulk assign: one failure then stops the rest
            // rather than half-deleting a selection nobody can now identify.
            for (const id of selected) await leadApi.remove(id)
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leads'] })
            qc.invalidateQueries({ queryKey: ['lead-stats'] })
            setSelected([])
            setError('')
        },
        onError: (e) => setError(apiError(e)),
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
            qc.invalidateQueries({ queryKey: ['lead-stats'] })
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
            qc.invalidateQueries({ queryKey: ['lead-stats'] })
            setPendingChange(null)
            setChangeComment('')
        },
    })

    const removeLead = useMutation({
        mutationFn: (id: string) => leadApi.remove(id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['leads'] })
            qc.invalidateQueries({ queryKey: ['lead-stats'] })
            setDrawerId(null)
        },
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
        contact_attempted: { bg: '#FEF3C7', fg: '#B45309' },
        site_visit_scheduled: { bg: '#DBEAFE', fg: '#1D4ED8' },
        follow_up_scheduled: { bg: '#FFEDD5', fg: '#C2410C' },
        quotation_sent: { bg: '#F3E8FF', fg: '#7C3AED' },
        won: { bg: '#D1FAE5', fg: '#065F46' },
        lost: { bg: '#FEE2E2', fg: '#991B1B' },
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

    const isFiltered = !!(search.trim() || status || source || owner || chase || attemptBy || from || to)

    const totalLeads = stats?.total ?? leadsPage?.total ?? 0
    const newCount = stats?.byStatus?.new ?? 0

    const statusChips = LEAD_STATUSES.map(s => {
        const count = stats?.byStatus?.[s] ?? 0
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

    /* Busiest rep sets the length of every bar: the rail is for comparing
       people with each other, not with a number nobody chose. */
    const workload: WorkloadRow[] = stats?.byOwner ?? []
    const busiest = Math.max(1, ...workload.map((w) => w.count))

    const pageIds = (leads || []).map((l) => l._id)
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id))
    const toggleRow = (id: string) =>
        setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

    const drawerLead = (leads || []).find((l) => l._id === drawerId) || null

    /* Source and status colours come from the handoff rather than the app's
       older palette: on this page they are read side by side and had to be
       told apart at a glance. */
    const sourceTone: Record<string, { bg: string; fg: string }> = {
        whatsapp: { bg: '#DCF3E3', fg: '#1F7A4C' },
        referral: { bg: '#EDE3CF', fg: '#4A4357' },
        walk_in: { bg: '#F6F0E4', fg: '#4A4357' },
        manual: { bg: '#F7F3FF', fg: '#5B2BC9' },
        other: { bg: '#F6F0E4', fg: '#4A4357' },
    }

    const GRID = '36px minmax(190px,1.3fr) 145px 112px 164px 172px 128px 104px 168px'

    // No outer padding or width cap here: the app layout already gutters every
    // page with p-3 sm:p-4, and 32px on top of a 1240px cap left most of a wide
    // screen empty.
    return (
        <div className="lead-shell" style={{ display: 'flex', alignItems: 'flex-start', gap: 20, minHeight: '100vh', paddingBottom: 24, background: '#FBF8F2', fontFamily: "'Manrope', system-ui, sans-serif" }}>
            <style>{LEADS_CSS}</style>
            <div style={{ flex: 1, minWidth: 0 }}>

                <div>

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

                {/* ── Status tabs ── */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                    <button
                        onClick={() => setStatus('')}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, padding: '0 14px',
                            borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                            border: `1px solid ${!status ? '#5B2BC9' : 'rgba(20,8,31,.14)'}`,
                            background: !status ? '#F7F3FF' : '#fff',
                            color: !status ? '#4A1FA0' : INK,
                        }}
                    >
                        All
                        <span style={{ background: !status ? '#5B2BC9' : '#F6F0E4', color: !status ? '#fff' : '#4A4357', borderRadius: 999, padding: '1px 7px', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{totalLeads}</span>
                    </button>
                    {statusChips.map(chip => (
                        <button
                            key={chip.key}
                            onClick={() => setStatus(chip.active ? '' : chip.key)}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, padding: '0 14px',
                                borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                border: `1px solid ${chip.active ? '#5B2BC9' : 'rgba(20,8,31,.14)'}`,
                                background: chip.active ? '#F7F3FF' : '#fff',
                                color: chip.active ? '#4A1FA0' : INK,
                            }}
                        >
                            {chip.label}
                            <span style={{ background: chip.active ? '#5B2BC9' : '#F6F0E4', color: chip.active ? '#fff' : '#4A4357', borderRadius: 999, padding: '1px 7px', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{chip.count}</span>
                        </button>
                    ))}
                </div>

                {/* ── Filter bar ── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: 12, background: '#F6F0E4', border: '1px solid rgba(20,8,31,.10)', borderRadius: 16, marginBottom: 18 }}>
                    <div style={{ flex: '1 1 220px', minWidth: 220, display: 'flex', alignItems: 'center', gap: 10, height: 44, padding: '0 16px', background: '#fff', border: '1px solid rgba(20,8,31,.12)', borderRadius: 999 }}>
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
                        style={{ height: 44, minWidth: 150, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(20,8,31,.12)', background: '#fff', fontSize: 14, color: INK, cursor: 'pointer' }}
                    >
                        <option value="">All sources</option>
                        {LEAD_SOURCES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </select>
                    {/* Where the chasing has got to. "Nobody has tried" is the
                        one worth looking at first — those are the leads that
                        rot without anybody noticing. */}
                    <select
                        value={chase}
                        onChange={(e) => setChase(e.target.value)}
                        style={{ height: 44, minWidth: 170, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(20,8,31,.12)', background: '#fff', fontSize: 14, color: INK, cursor: 'pointer' }}
                    >
                        <option value="">Any chase state</option>
                        <option value="none">Nobody has tried{stats?.chase ? ` (${stats.chase.none})` : ''}</option>
                        <option value="active">Being chased{stats?.chase ? ` (${stats.chase.active})` : ''}</option>
                        <option value="exhausted">Needs a decision{stats?.chase ? ` (${stats.chase.exhausted})` : ''}</option>
                    </select>

                    {/* Who did the chasing, which is not who owns it: leads get
                        reassigned, and the record of the work stays put. */}
                    {(stats?.byChaser?.length ?? 0) > 0 && (
                        <select
                            value={attemptBy}
                            onChange={(e) => setAttemptBy(e.target.value)}
                            style={{ height: 44, minWidth: 160, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(20,8,31,.12)', background: '#fff', fontSize: 14, color: INK, cursor: 'pointer' }}
                        >
                            <option value="">Chased by anyone</option>
                            {(stats?.byChaser ?? []).map((c) => (
                                <option key={c._id} value={c._id}>{c.name} ({c.count})</option>
                            ))}
                        </select>
                    )}

                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                        style={{ height: 44, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(20,8,31,.12)', background: '#fff', fontSize: 14, color: INK }} />
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                        style={{ height: 44, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(20,8,31,.12)', background: '#fff', fontSize: 14, color: INK }} />
                    {isFiltered && (
                        <button
                            onClick={() => { setSearch(''); setStatus(''); setSource(''); setOwner(''); setChase(''); setAttemptBy(''); setFrom(''); setTo('') }}
                            style={{ height: 44, padding: '0 16px', borderRadius: 999, border: '1px dashed rgba(20,8,31,.20)', background: 'transparent', fontSize: 13, fontWeight: 600, color: MUTED_COLOR, cursor: 'pointer' }}
                        >
                            Clear
                        </button>
                    )}
                </div>

                {/* ── Bulk bar ── only once something is picked, because until
                     then it is a row of controls with nothing to act on. */}
                {selected.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', background: INK, color: '#fff', borderRadius: 14, padding: '12px 18px', marginBottom: 14 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>
                            {selected.length} selected{bulkAssign.isPending ? ' · assigning…' : ''}{bulkRemove.isPending ? ' · deleting…' : ''}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {isAdmin && (
                                <select
                                    value=""
                                    disabled={bulkAssign.isPending}
                                    onChange={(e) => { if (e.target.value) bulkAssign.mutate(e.target.value) }}
                                    style={{ height: 38, borderRadius: 999, border: '1px solid rgba(255,255,255,.25)', padding: '0 14px', fontSize: 13, background: 'rgba(255,255,255,.08)', color: '#fff', cursor: 'pointer' }}
                                >
                                    <option value="" style={{ color: INK }}>Assign to…</option>
                                    {(assignableUsers || []).map((u) => (
                                        <option key={u._id} value={u._id} style={{ color: INK }}>{u.name}</option>
                                    ))}
                                </select>
                            )}
                            {/* Named and counted in the confirm, because a
                                selection made three filters ago is easy to
                                misremember and this cannot be undone. */}
                            <button
                                disabled={bulkRemove.isPending}
                                onClick={() => {
                                    const names = (leads || [])
                                        .filter((l) => selected.includes(l._id))
                                        .map((l) => l.fullName)
                                    const shown = names.slice(0, 5).join(', ')
                                    const rest = names.length > 5 ? ` and ${names.length - 5} more` : ''
                                    if (confirm(`Delete ${selected.length} lead${selected.length > 1 ? 's' : ''}?\n\n${shown}${rest}\n\nThis cannot be undone.`)) {
                                        bulkRemove.mutate()
                                    }
                                }}
                                style={{ height: 38, padding: '0 16px', borderRadius: 999, border: '1px solid rgba(255,255,255,.25)', background: 'rgba(220,38,38,.22)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: bulkRemove.isPending ? 0.5 : 1 }}
                            >
                                {bulkRemove.isPending ? 'Deleting…' : 'Delete'}
                            </button>
                            <button
                                onClick={() => setSelected([])}
                                style={{ height: 38, padding: '0 16px', borderRadius: 999, border: '1px solid rgba(255,255,255,.25)', background: 'transparent', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Table ── */}
                {isLoading ? (
                    <Spinner />
                ) : (
                    <div className="lead-table" style={{ background: '#fff', border: '1px solid rgba(20,8,31,.10)', borderRadius: 18, overflow: 'auto' }}>
                        <div className="lead-table-inner" style={{ minWidth: 980 }}>

                            {/* Header row */}
                            <div className="lead-head" style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', gap: 10, padding: '14px 18px', background: '#FBF8F2', borderBottom: '1px solid rgba(20,8,31,.10)' }}>
                                <input
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={() => setSelected(allSelected ? [] : pageIds)}
                                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                                    aria-label="Select every lead on this page"
                                />
                                {['Name', 'Phone', 'Source', 'Assigned to', 'Status', 'Chase', 'Added'].map((h) => (
                                    <span key={h} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: MUTED_COLOR, whiteSpace: 'nowrap' }}>{h}</span>
                                ))}
                                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: MUTED_COLOR, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</span>
                            </div>

                            {/* Lead rows */}
                            {(leads || []).map((lead) => {
                                const sc = statusColors[lead.status] || statusColors.new
                                const src = sourceTone[lead.source] || sourceTone.other
                                const checked = selected.includes(lead._id)
                                return (
                                    <div
                                        key={lead._id}
                                        className="lead-row"
                                        style={{
                                            display: 'grid', gridTemplateColumns: GRID, gap: 10, alignItems: 'center',
                                            padding: '14px 18px', borderBottom: '1px solid rgba(20,8,31,.08)',
                                            background: checked ? '#F7F3FF' : '#fff',
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleRow(lead._id)}
                                            style={{ width: 16, height: 16, cursor: 'pointer' }}
                                            aria-label={`Select ${lead.fullName}`}
                                        />

                                        {/* The name goes to the lead itself. View, beside the
                                            other actions, opens the drawer instead — enough to
                                            assign or move a stage without leaving the list. */}
                                        <Link
                                            to={`/leads/${lead._id}`}
                                            style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflow: 'hidden', color: INK, textDecoration: 'none' }}
                                        >
                                            <span style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 10, background: '#EDE5FF', color: '#4A1FA0', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700 }}>
                                                {getInitials(lead.fullName)}
                                            </span>
                                            <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lead.fullName}</span>
                                        </Link>

                                        <span style={{ fontSize: 13, color: '#4A4357', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden' }}>{lead.phone}</span>

                                        <span style={{ display: 'inline-flex', alignItems: 'center', background: src.bg, color: src.fg, borderRadius: 999, padding: '5px 10px', fontSize: 12, fontWeight: 600, width: 'fit-content' }}>
                                            {statusLabel(lead.source)}
                                        </span>

                                        {/* Unassigned reads amber, so a lead with nobody on it is
                                            visible without hunting down the column. */}
                                        {isAdmin ? (
                                            <select
                                                value={lead.owner?._id || ''}
                                                onChange={(e) => updateLead.mutate({ id: lead._id, body: { owner: e.target.value } })}
                                                style={{ height: 34, maxWidth: 160, borderRadius: 999, border: '1px solid rgba(20,8,31,.12)', padding: '0 10px', fontSize: 13, background: '#fff', color: lead.owner ? INK : '#B58A3A', cursor: 'pointer' }}
                                            >
                                                <option value="">Unassigned</option>
                                                {(assignableUsers || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
                                            </select>
                                        ) : (
                                            <span style={{ fontSize: 13, color: lead.owner ? INK : '#B58A3A', fontWeight: 600 }}>
                                                {lead.owner?.name || 'Unassigned'}
                                            </span>
                                        )}

                                        {/* Read-only here by request: assignment and stage are
                                            different decisions, and mixing both into one row made
                                            the list harder to scan. Stage is set in the drawer. */}
                                        <span style={{ display: 'inline-flex', alignItems: 'center', background: sc.bg, color: sc.fg, borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 600, width: 'fit-content' }}>
                                            {statusLabel(lead.status)}
                                        </span>

                                        {/* How far the chase has got, without opening the
                                            lead. "Not tried" is the state worth spotting from
                                            across a list. */}
                                        <div style={{ minWidth: 0 }}>{(() => {
                                            const made = lead.attempts?.length ?? 0
                                            const last = made ? lead.attempts![made - 1] : null
                                            if (lead.sequenceExhaustedAt) {
                                                return (
                                                    <>
                                                        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#DC2626', whiteSpace: 'nowrap' }}>Needs a decision</div>
                                                        <div style={{ fontSize: 12, color: MUTED_COLOR, whiteSpace: 'nowrap' }}>{made} attempt{made === 1 ? '' : 's'}</div>
                                                    </>
                                                )
                                            }
                                            if (!made) {
                                                return <div style={{ fontSize: 12.5, color: '#B58A3A', fontWeight: 600, whiteSpace: 'nowrap' }}>Not tried</div>
                                            }
                                            return (
                                                <>
                                                    <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                        {made} attempt{made === 1 ? '' : 's'}
                                                    </div>
                                                    <div className="truncate" style={{ fontSize: 12, color: MUTED_COLOR }}>
                                                        {formatDate(last!.at)}{last!.user?.name ? ` · ${last!.user.name}` : ''}
                                                    </div>
                                                </>
                                            )
                                        })()}</div>

                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{timeAgo(lead.leadDateTime)}</div>
                                            <div style={{ fontSize: 12, color: MUTED_COLOR, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatDateTime(lead.leadDateTime)}</div>
                                        </div>

                                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                                            <button onClick={() => setDrawerId(lead._id)} style={{ border: 0, background: 'none', color: PURPLE, fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 0 }}>View</button>
                                            <button onClick={() => navigate(`/quotes/new?lead=${lead._id}`)} style={{ border: 0, background: 'none', color: PURPLE, fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 0 }}>Book</button>
                                            <button
                                                onClick={() => { if (confirm(`Delete ${lead.fullName}? This cannot be undone.`)) removeLead.mutate(lead._id) }}
                                                style={{ border: 0, background: 'none', color: '#9B4141', fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 0 }}
                                            >Delete</button>
                                        </div>
                                    </div>
                                )
                            })}

                            {(leads || []).length === 0 && (
                                <div style={{ padding: '56px 20px', textAlign: 'center', color: MUTED_COLOR, fontSize: 14 }}>
                                    No leads match these filters.
                                </div>
                            )}
                        </div>

                        {/* Pagination */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '16px 18px', background: '#FBF8F2', borderTop: '1px solid rgba(20,8,31,.10)' }}>
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

                </div>

            </div>

            {/* ── Team workload ──
                 Only for admins: it exists to move leads between people, and a
                 rep sees only their own, so for them it would be one card
                 saying what the page already says. */}
            {isAdmin && (
                <aside className="lead-rail" style={{ width: 296, flex: '0 0 296px', borderLeft: '1px solid rgba(20,8,31,.10)', background: '#fff', padding: '24px 22px', position: 'sticky', top: 0, alignSelf: 'flex-start', maxHeight: '100vh', overflowY: 'auto' }}>
                    <div style={{ ...HEADING, fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Team workload</div>
                    <div style={{ fontSize: 13, color: MUTED_COLOR, marginBottom: 16 }}>Active leads by rep · click to filter</div>

                    {/* Above Unassigned, which is the other thing on this rail
                        that needs doing — but a lead already on somebody's desk
                        and still untouched needs doing sooner. */}
                    <WaitingStrip compact />

                    {/* Unassigned in amber: a lead nobody owns is the other
                        thing on this page that needs doing. */}
                    <div
                        onClick={() => setOwner(owner === 'unassigned' ? '' : 'unassigned')}
                        style={{ borderRadius: 14, padding: 14, marginBottom: 16, cursor: 'pointer', border: `1px solid ${owner === 'unassigned' ? '#B58A3A' : 'rgba(20,8,31,.10)'}`, background: '#FBEEDA' }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontWeight: 700, fontSize: 14, color: '#8A5A1F' }}>Unassigned</span>
                            <span style={{ ...HEADING, fontWeight: 700, fontSize: 20, color: '#8A5A1F' }}>{stats?.unassigned ?? 0}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#8A5A1F', opacity: .75, marginTop: 2 }}>needs an owner</div>
                    </div>

                    {workload.length === 0 && (
                        <p style={{ fontSize: 13, color: MUTED_COLOR }}>Nobody has any leads yet.</p>
                    )}

                    {workload.map((w) => {
                        const active = owner === w._id
                        return (
                            <div
                                key={w._id}
                                onClick={() => setOwner(active ? '' : w._id)}
                                style={{ borderRadius: 14, padding: 14, marginBottom: 10, cursor: 'pointer', border: `1px solid ${active ? PURPLE : 'rgba(20,8,31,.10)'}`, background: active ? '#F7F3FF' : '#FBF8F2' }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                    <span style={{ width: 32, height: 32, flex: '0 0 auto', borderRadius: 10, background: PURPLE, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>
                                        {getInitials(w.name)}
                                    </span>
                                    <span style={{ fontWeight: 600, fontSize: 14, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                                    <span style={{ ...HEADING, fontWeight: 700, fontSize: 18 }}>{w.count}</span>
                                </div>
                                {/* Measured against the busiest rep, because the
                                    rail is for comparing people with each other. */}
                                <div style={{ height: 6, borderRadius: 999, background: '#EDE5FF', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', borderRadius: 999, background: PURPLE, width: `${(w.count / busiest) * 100}%` }} />
                                </div>
                            </div>
                        )
                    })}
                </aside>
            )}

            {/* ── Lead drawer ──
                 Enough to decide whose lead this is and where it stands. The
                 whole record — notes, timeline, chat, follow-ups — is a click
                 further on, at the lead's own page. */}
            {drawerLead && (
                <>
                    <div
                        onClick={() => setDrawerId(null)}
                        style={{ position: 'fixed', inset: 0, background: 'rgba(20,8,31,.35)', zIndex: 80 }}
                    />
                    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 400, maxWidth: '100vw', background: '#fff', zIndex: 81, boxShadow: '-24px 0 60px rgba(20,8,31,.14)', padding: '28px 26px', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                            <button
                                onClick={() => setDrawerId(null)}
                                aria-label="Close"
                                style={{ border: 0, background: '#F7F3FF', color: '#4A1FA0', width: 32, height: 32, borderRadius: 999, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                            >×</button>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
                            <span style={{ width: 52, height: 52, flex: '0 0 auto', borderRadius: 14, background: '#EDE5FF', color: '#4A1FA0', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 18 }}>
                                {getInitials(drawerLead.fullName)}
                            </span>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ ...HEADING, fontWeight: 700, fontSize: 19 }}>{drawerLead.fullName}</div>
                                <span style={{ display: 'inline-flex', marginTop: 4, background: (sourceTone[drawerLead.source] || sourceTone.other).bg, color: (sourceTone[drawerLead.source] || sourceTone.other).fg, borderRadius: 999, padding: '5px 10px', fontSize: 12, fontWeight: 600 }}>
                                    {statusLabel(drawerLead.source)}
                                </span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 0', borderTop: '1px solid rgba(20,8,31,.10)' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: MUTED_COLOR }}>Phone / WhatsApp</span>
                            {/* Our own inbox rather than wa.me — the thread we
                                already hold, with its history. */}
                            <Link
                                to={`/whatsapp?phone=${(drawerLead.phoneNormalized || drawerLead.phone || '').replace(/\D/g, '')}`}
                                style={{ fontSize: 15, fontWeight: 600, color: PURPLE, fontVariantNumeric: 'tabular-nums' }}
                            >
                                {drawerLead.phone}
                            </Link>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 0', borderTop: '1px solid rgba(20,8,31,.10)' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: MUTED_COLOR }}>Added</span>
                            <span style={{ fontSize: 14 }}>{formatDateTime(drawerLead.leadDateTime)}</span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 0', borderTop: '1px solid rgba(20,8,31,.10)' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: MUTED_COLOR }}>Status</span>
                            {/* Through the same confirm as everywhere else, so a
                                stage change still records why it happened. */}
                            <select
                                value={drawerLead.status}
                                onChange={(e) => {
                                    const next = e.target.value as LeadStatus
                                    if (next !== drawerLead.status) setPendingChange({ lead: drawerLead, newStatus: next })
                                }}
                                style={{ height: 42, borderRadius: 12, border: '1px solid rgba(20,8,31,.14)', padding: '0 12px', fontSize: 14, background: '#fff', color: INK, cursor: 'pointer' }}
                            >
                                {LEAD_STATUSES.map((st) => <option key={st} value={st}>{statusLabel(st)}</option>)}
                            </select>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 0', borderTop: '1px solid rgba(20,8,31,.10)' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' as const, color: MUTED_COLOR }}>Assigned to</span>
                            {isAdmin ? (
                                <select
                                    value={drawerLead.owner?._id || ''}
                                    onChange={(e) => updateLead.mutate({ id: drawerLead._id, body: { owner: e.target.value } })}
                                    style={{ height: 42, borderRadius: 12, border: '1px solid rgba(20,8,31,.14)', padding: '0 12px', fontSize: 14, background: '#fff', color: drawerLead.owner ? INK : '#B58A3A', cursor: 'pointer' }}
                                >
                                    <option value="">Unassigned</option>
                                    {(assignableUsers || []).map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
                                </select>
                            ) : (
                                <span style={{ fontSize: 14, fontWeight: 600, color: drawerLead.owner ? INK : '#B58A3A' }}>
                                    {drawerLead.owner?.name || 'Unassigned'}
                                </span>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                            <button
                                onClick={() => navigate(`/quotes/new?lead=${drawerLead._id}`)}
                                style={{ flex: 1, height: 46, borderRadius: 999, border: 0, background: PURPLE, color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
                            >Book unit</button>
                            <Link
                                to={`/leads/${drawerLead._id}`}
                                style={{ flex: 1, height: 46, borderRadius: 999, border: '1px solid rgba(20,8,31,.16)', background: '#fff', color: INK, fontWeight: 600, fontSize: 14, display: 'grid', placeItems: 'center', textDecoration: 'none' }}
                            >Open full lead</Link>
                        </div>
                    </div>
                </>
            )}

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

        </div>
    )
}

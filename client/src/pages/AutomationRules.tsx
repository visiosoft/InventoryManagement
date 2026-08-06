import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
    AlertTriangle, Bell, CalendarClock, CreditCard, Mail, MessageCircle,
    Pencil, Plus, PlusCircle, Repeat, Search, Trash2, X,
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Spinner, Textarea } from '../components/ui'
import { formatDate } from '../lib/utils'

// ── Types ────────────────────────────────────────────────────────────────────
type AutomationStep = {
    value: number
    direction: 'before' | 'after'
    template: string
    emailSubject: string
    emailBody: string
    whatsappBody: string
    immediate?: boolean
}

type MessageTemplate = {
    _id: string
    key: string
    label: string
    subject: string
    emailBody: string
    whatsappBody: string
    variables: string[]
}

type AutomationRule = {
    _id: string
    name: string
    icon: string
    triggerEvent: string
    triggerLabel: string
    relativeLabel: string
    enabled: boolean
    emailEnabled: boolean
    whatsappEnabled: boolean
    steps: AutomationStep[]
    recurring: { enabled: boolean; everyDays: number }
    custom: boolean
    order: number
}

type AutomationLogEntry = {
    _id: string
    ruleName: string
    customer: string | { _id: string; fullName: string }
    unit: string
    event: string
    channel: string
    status: 'sent' | 'failed' | 'skipped'
    sentAt: string
    message: string
}

const ICON_MAP: Record<string, typeof Bell> = {
    'credit-card': CreditCard,
    'calendar-clock': CalendarClock,
    'alert-triangle': AlertTriangle,
    'bell': Bell,
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function AutomationRules() {
    const qc = useQueryClient()
    const [search, setSearch] = useState('')
    const [newGroupOpen, setNewGroupOpen] = useState(false)
    const [newGroupName, setNewGroupName] = useState('')
    const [error, setError] = useState('')
    const [editingTemplate, setEditingTemplate] = useState<{ ruleId: string; stepIdx: number } | null>(null)

    const { data: rules = [], isLoading } = useQuery<AutomationRule[]>({
        queryKey: ['automation-rules'],
        queryFn: () => api.get('/automation-rules').then(r => r.data),
    })

    const { data: templates = [] } = useQuery<MessageTemplate[]>({
        queryKey: ['message-templates'],
        queryFn: () => api.get('/message-templates').then(r => r.data),
    })

    const { data: logsData } = useQuery<{ logs: AutomationLogEntry[]; total: number }>({
        queryKey: ['automation-logs'],
        queryFn: () => api.get('/automation-rules/logs').then(r => r.data),
    })

    const updateRule = useMutation({
        mutationFn: ({ id, body }: { id: string; body: Partial<AutomationRule> }) =>
            api.put(`/automation-rules/${id}`, body),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-rules'] }),
        onError: (e) => setError(apiError(e)),
    })

    const createRule = useMutation({
        mutationFn: (body: Partial<AutomationRule>) =>
            api.post('/automation-rules', body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['automation-rules'] })
            setNewGroupOpen(false)
            setNewGroupName('')
        },
        onError: (e) => setError(apiError(e)),
    })

    const deleteRule = useMutation({
        mutationFn: (id: string) => api.delete(`/automation-rules/${id}`),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-rules'] }),
        onError: (e) => setError(apiError(e)),
    })

    function patchRule(id: string, patch: Partial<AutomationRule>) {
        updateRule.mutate({ id, body: patch })
    }

    function addStep(rule: AutomationRule) {
        const steps = [...rule.steps, { value: 7, direction: 'before' as const, template: 'Reminder', emailSubject: '', emailBody: '', whatsappBody: '' }]
        patchRule(rule._id, { steps })
    }

    function removeStep(rule: AutomationRule, stepIdx: number) {
        const steps = rule.steps.filter((_, i) => i !== stepIdx)
        patchRule(rule._id, { steps })
    }

    function updateStep(rule: AutomationRule, stepIdx: number, patch: Partial<AutomationStep>) {
        const steps = rule.steps.map((s, i) => i === stepIdx ? { ...s, ...patch } : s)
        patchRule(rule._id, { steps })
    }

    function handleAddGroup() {
        if (!newGroupName.trim()) return
        createRule.mutate({
            name: newGroupName.trim(),
            icon: 'bell',
            triggerEvent: 'custom',
            triggerLabel: 'Custom automation trigger',
            relativeLabel: 'trigger date',
            enabled: true,
            emailEnabled: false,
            whatsappEnabled: true,
            steps: [{ value: 7, direction: 'before', template: 'Reminder', emailSubject: '', emailBody: '', whatsappBody: '' }],
            recurring: { enabled: false, everyDays: 3 },
        })
    }

    const logs = logsData?.logs ?? []
    const filteredLog = search
        ? logs.filter(l => {
            const s = search.toLowerCase()
            const name = typeof l.customer === 'object' ? l.customer.fullName : ''
            return name.toLowerCase().includes(s) || l.unit.toLowerCase().includes(s)
        })
        : logs

    if (isLoading) return <Spinner />

    return (
        <div className="px-2 py-4">
            <h1 className="text-2xl font-bold tracking-tight">Automation Rules</h1>
            <p className="text-sm text-muted-foreground mt-1">
                Configure when automatic reminders are sent to clients, and how often.
            </p>

            {error && <p className="text-xs text-destructive mt-3">{error}</p>}

            {/* Tabs */}
            <div className="flex gap-1 mt-6 border-b">
                <Link to="/settings/templates"
                    className="px-1 pb-3 text-sm font-semibold text-muted-foreground hover:text-foreground mr-5">
                    Message Templates
                </Link>
                <span className="px-1 pb-3 text-sm font-bold text-primary border-b-2 border-primary -mb-px">
                    Automation Rules
                </span>
            </div>

            {/* Rules */}
            <div className="flex flex-col gap-4 mt-6">
                {rules.map(rule => (
                    <RuleCard
                        key={rule._id}
                        rule={rule}
                        templates={templates}
                        onToggleEnabled={() => patchRule(rule._id, { enabled: !rule.enabled })}
                        onToggleEmail={() => patchRule(rule._id, { emailEnabled: !rule.emailEnabled })}
                        onToggleWhatsApp={() => patchRule(rule._id, { whatsappEnabled: !rule.whatsappEnabled })}
                        onAddStep={() => addStep(rule)}
                        onRemoveStep={(i) => removeStep(rule, i)}
                        onUpdateStep={(i, p) => updateStep(rule, i, p)}
                        onEditTemplate={(stepIdx) => setEditingTemplate({ ruleId: rule._id, stepIdx })}
                        onChangeRecurringDays={(days) => patchRule(rule._id, { recurring: { ...rule.recurring, everyDays: days } })}
                        onDelete={() => { if (confirm(`Delete "${rule.name}" automation?`)) deleteRule.mutate(rule._id) }}
                    />
                ))}

                {/* New group form */}
                {newGroupOpen ? (
                    <div className="border border-dashed border-primary/40 rounded-xl p-4 flex items-center gap-3">
                        <input
                            type="text"
                            placeholder="Automation name, e.g. Insurance Expiring"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddGroup()}
                            className="flex-1 h-9 border rounded-lg px-3 text-sm bg-background"
                        />
                        <button
                            onClick={handleAddGroup}
                            disabled={createRule.isPending}
                            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold cursor-pointer disabled:opacity-50"
                        >
                            Add
                        </button>
                        <button
                            onClick={() => { setNewGroupOpen(false); setNewGroupName('') }}
                            className="h-9 px-3 rounded-lg text-muted-foreground text-sm font-semibold cursor-pointer"
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setNewGroupOpen(true)}
                        className="flex items-center justify-center gap-2 border border-dashed rounded-xl p-4 text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors cursor-pointer"
                    >
                        <PlusCircle size={15} /> New automation
                    </button>
                )}
            </div>

            {/* Recent Activity */}
            <div className="mt-11">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-bold tracking-tight">Recent Activity</h2>
                        <p className="text-sm text-muted-foreground mt-1">Log of automatic reminders sent to clients.</p>
                    </div>
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search client or unit"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-9 w-[220px] border rounded-full pl-9 pr-3 text-sm bg-background"
                        />
                    </div>
                </div>

                <div className="mt-4 border rounded-xl overflow-hidden bg-card">
                    <div className="grid grid-cols-[1.3fr_1fr_1.3fr_0.9fr_1.1fr_0.9fr] px-5 py-3 text-[11px] font-bold tracking-wider text-muted-foreground uppercase border-b bg-muted/30">
                        <div>Client</div><div>Unit</div><div>Event</div><div>Channel</div><div>Sent</div><div>Status</div>
                    </div>
                    {filteredLog.length === 0 ? (
                        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                            {search ? 'No activity matches your search.' : 'No automation activity yet.'}
                        </div>
                    ) : (
                        filteredLog.map(row => (
                            <div key={row._id} className="grid grid-cols-[1.3fr_1fr_1.3fr_0.9fr_1.1fr_0.9fr] px-5 py-3 text-sm border-b items-center">
                                <div className="font-semibold">{typeof row.customer === 'object' ? row.customer.fullName : '—'}</div>
                                <div className="text-muted-foreground">{row.unit || '—'}</div>
                                <div className="text-muted-foreground">{row.event || row.ruleName}</div>
                                <div className="text-muted-foreground capitalize">{row.channel}</div>
                                <div className="text-muted-foreground">{formatDate(row.sentAt)}</div>
                                <div>
                                    <Badge tone={row.status === 'sent' ? 'green' : row.status === 'failed' ? 'red' : 'gray'}>
                                        {row.status}
                                    </Badge>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Template Editor Modal */}
            {editingTemplate && (() => {
                const rule = rules.find(r => r._id === editingTemplate.ruleId)
                const step = rule?.steps[editingTemplate.stepIdx]
                if (!rule || !step) return null
                return (
                    <StepTemplateModal
                        step={step}
                        templates={templates}
                        onSave={(patch) => {
                            updateStep(rule, editingTemplate.stepIdx, patch)
                            setEditingTemplate(null)
                        }}
                        onClose={() => setEditingTemplate(null)}
                    />
                )
            })()}
        </div>
    )
}

// ── Rule Card ────────────────────────────────────────────────────────────────
function RuleCard({ rule, templates: _templates, onToggleEnabled, onToggleEmail, onToggleWhatsApp, onAddStep, onRemoveStep, onUpdateStep, onEditTemplate, onChangeRecurringDays, onDelete }: {
    rule: AutomationRule
    templates: MessageTemplate[]
    onToggleEnabled: () => void
    onToggleEmail: () => void
    onToggleWhatsApp: () => void
    onAddStep: () => void
    onRemoveStep: (i: number) => void
    onUpdateStep: (i: number, patch: Partial<AutomationStep>) => void
    onEditTemplate: (stepIdx: number) => void
    onChangeRecurringDays: (days: number) => void
    onDelete: () => void
}) {
    const Icon = ICON_MAP[rule.icon] || Bell

    return (
        <div className="border rounded-xl p-5 bg-card">
            {/* Header */}
            <div className="flex items-center gap-3.5">
                <div className="w-[38px] h-[38px] rounded-[10px] bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="font-bold text-[15px]">{rule.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{rule.triggerLabel}</div>
                </div>

                {/* Channel pills */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={onToggleEmail}
                        className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 border transition-colors cursor-pointer ${rule.emailEnabled
                            ? 'bg-primary/10 text-primary border-primary/20'
                            : 'bg-muted text-muted-foreground border-transparent'
                            }`}
                    >
                        <Mail size={12} /> Email
                    </button>
                    <button
                        onClick={onToggleWhatsApp}
                        className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 border transition-colors cursor-pointer ${rule.whatsappEnabled
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/40'
                            : 'bg-muted text-muted-foreground border-transparent'
                            }`}
                    >
                        <MessageCircle size={12} /> WhatsApp
                    </button>
                </div>

                {/* Enable toggle */}
                <button
                    onClick={onToggleEnabled}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${rule.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
                        }`}
                >
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${rule.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`} />
                </button>

                {/* Delete (custom only) */}
                {rule.custom && (
                    <button onClick={onDelete} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive cursor-pointer shrink-0">
                        <Trash2 size={15} />
                    </button>
                )}
            </div>

            {/* Steps */}
            <div className="flex flex-col gap-2 mt-4 pt-4 border-t">
                {rule.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2.5 bg-muted/30 border rounded-[10px] px-3 py-2.5">
                        <div className="w-[22px] h-[22px] rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">
                            {i + 1}
                        </div>

                        {step.immediate ? (
                            <span className="text-sm text-muted-foreground font-medium">Sent immediately when this event happens</span>
                        ) : (
                            <>
                                <input
                                    type="number"
                                    min={0}
                                    value={step.value}
                                    onChange={(e) => onUpdateStep(i, { value: Number(e.target.value) })}
                                    className="w-[52px] h-[30px] border rounded-lg px-2 text-sm font-semibold text-center bg-background"
                                />
                                <span className="text-sm text-muted-foreground">days</span>
                                <select
                                    value={step.direction}
                                    onChange={(e) => onUpdateStep(i, { direction: e.target.value as 'before' | 'after' })}
                                    className="h-[30px] border rounded-lg px-2 text-sm bg-background"
                                >
                                    <option value="before">before</option>
                                    <option value="after">after</option>
                                </select>
                                <span className="text-sm text-muted-foreground">{rule.relativeLabel}</span>
                            </>
                        )}

                        <div className="flex-1" />
                        <button
                            onClick={() => onEditTemplate(i)}
                            className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/10 rounded-full px-2.5 py-1 whitespace-nowrap hover:bg-primary/20 transition-colors cursor-pointer"
                        >
                            <Pencil size={10} /> {step.template}
                        </button>
                        {rule.steps.length > 1 && (
                            <button onClick={() => onRemoveStep(i)} className="w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive cursor-pointer shrink-0">
                                <X size={14} />
                            </button>
                        )}
                    </div>
                ))}

                {/* Recurring row */}
                {rule.recurring?.enabled && (
                    <div className="flex items-center gap-2.5 bg-primary/5 border border-primary/15 rounded-[10px] px-3 py-2.5 mt-0.5">
                        <Repeat size={14} className="text-primary shrink-0" />
                        <span className="text-sm text-primary/90">Then repeat every</span>
                        <input
                            type="number"
                            min={1}
                            value={rule.recurring.everyDays}
                            onChange={(e) => onChangeRecurringDays(Number(e.target.value))}
                            className="w-[46px] h-[28px] border border-primary/20 rounded-lg px-1.5 text-sm font-semibold text-center bg-background"
                        />
                        <span className="text-sm text-primary/90">days while unpaid</span>
                    </div>
                )}

                {/* Add step */}
                <button
                    onClick={onAddStep}
                    className="flex items-center gap-1.5 text-sm font-semibold text-primary pt-1.5 px-0.5 cursor-pointer hover:underline"
                >
                    <Plus size={14} /> Add step
                </button>
            </div>
        </div>
    )
}

// ── Step Template Editor Modal ───────────────────────────────────────────────
function StepTemplateModal({ step, templates, onSave, onClose }: {
    step: AutomationStep
    templates: MessageTemplate[]
    onSave: (patch: Partial<AutomationStep>) => void
    onClose: () => void
}) {
    const [tab, setTab] = useState<'email' | 'whatsapp'>('email')
    const [templateName, setTemplateName] = useState(step.template)
    const [emailSubject, setEmailSubject] = useState(step.emailSubject || '')
    const [emailBody, setEmailBody] = useState(step.emailBody || '')
    const [whatsappBody, setWhatsappBody] = useState(step.whatsappBody || '')

    function loadFromTemplate(key: string) {
        const t = templates.find(t => t.key === key)
        if (t) {
            setTemplateName(t.label)
            setEmailSubject(t.subject)
            setEmailBody(t.emailBody)
            setWhatsappBody(t.whatsappBody)
        }
    }

    function handleSave() {
        onSave({ template: templateName, emailSubject, emailBody, whatsappBody })
    }

    const VARIABLES = ['@name', '@amount', '@unit', '@dueDate', '@daysLeft', '@contractNo', '@startDate', '@endDate', '@invoiceNo']

    return (
        <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/20" onClick={onClose} />
            <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-xl overflow-y-auto animate-in slide-in-from-right">
                <div className="sticky top-0 bg-white dark:bg-gray-900 border-b px-5 py-4 flex items-center justify-between z-10">
                    <h2 className="text-lg font-bold" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em', color: '#14081F' }}>
                        Edit Template – {step.template}
                    </h2>
                    <button onClick={onClose} className="p-1 hover:bg-muted rounded cursor-pointer"><X size={18} /></button>
                </div>
                <div className="p-5 space-y-4">
                    {/* Template name */}
                    <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step Label</label>
                        <input
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            className="mt-1 w-full h-9 border rounded-lg px-3 text-sm bg-background"
                        />
                    </div>

                    {/* Load from existing template */}
                    <div>
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Load from Template</label>
                        <select
                            onChange={(e) => { if (e.target.value) loadFromTemplate(e.target.value) }}
                            defaultValue=""
                            className="mt-1 w-full h-9 border rounded-lg px-3 text-sm bg-background"
                        >
                            <option value="">— Select to pre-fill —</option>
                            {templates.map(t => <option key={t._id} value={t.key}>{t.label}</option>)}
                        </select>
                    </div>

                    {/* Channel tabs */}
                    <div className="flex gap-1 border-b">
                        <button
                            onClick={() => setTab('email')}
                            className={`flex items-center gap-1.5 px-3 pb-2 text-sm font-semibold cursor-pointer ${tab === 'email' ? 'text-primary border-b-2 border-primary -mb-px' : 'text-muted-foreground'}`}
                        >
                            <Mail size={13} /> Email
                        </button>
                        <button
                            onClick={() => setTab('whatsapp')}
                            className={`flex items-center gap-1.5 px-3 pb-2 text-sm font-semibold cursor-pointer ${tab === 'whatsapp' ? 'text-emerald-600 border-b-2 border-emerald-500 -mb-px' : 'text-muted-foreground'}`}
                        >
                            <MessageCircle size={13} /> WhatsApp
                        </button>
                    </div>

                    {tab === 'email' && (
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Subject</label>
                                <input
                                    value={emailSubject}
                                    onChange={(e) => setEmailSubject(e.target.value)}
                                    placeholder="e.g. Payment Reminder – @invoiceNo"
                                    className="mt-1 w-full h-9 border rounded-lg px-3 text-sm bg-background"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Body</label>
                                <Textarea
                                    value={emailBody}
                                    onChange={(e) => setEmailBody(e.target.value)}
                                    rows={6}
                                    placeholder="Dear @name, ..."
                                    className="mt-1"
                                />
                            </div>
                        </div>
                    )}

                    {tab === 'whatsapp' && (
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">WhatsApp Message</label>
                            <Textarea
                                value={whatsappBody}
                                onChange={(e) => setWhatsappBody(e.target.value)}
                                rows={6}
                                placeholder="Hello @name, ..."
                                className="mt-1"
                            />
                        </div>
                    )}

                    {/* Variables */}
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Available Variables</label>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {VARIABLES.map(v => (
                                <button
                                    key={v}
                                    type="button"
                                    onClick={() => {
                                        if (tab === 'email') setEmailBody(b => b + v)
                                        else setWhatsappBody(b => b + v)
                                    }}
                                    className="text-[11px] font-mono px-2 py-0.5 rounded bg-muted border text-muted-foreground hover:text-foreground cursor-pointer"
                                >
                                    {v}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={onClose}>Cancel</Button>
                        <Button onClick={handleSave}>Save Template</Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

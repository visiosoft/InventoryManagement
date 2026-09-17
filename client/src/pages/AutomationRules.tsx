import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import {
    AlertTriangle, Bell, CalendarClock, ChevronDown, ChevronRight, CreditCard, Eye, Mail, MessageCircle,
    Pencil, Plus, PlusCircle, Repeat, RotateCcw, Search, Trash2, X,
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { Badge, Button, Modal, Spinner, Textarea } from '../components/ui'
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
    remindersResetAt?: string | null
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

type PendingRow = {
    contractId: string
    ruleId: string
    contractNo: string
    customerName: string
    unit: string
    endDate: string
    daysLeft: number
    channels: ('email' | 'whatsapp')[]
    preview: { emailSubject: string; emailHtml: string; whatsapp: string }
}

type SendOutcome = {
    contractId: string
    ruleId: string
    contractNo: string
    customerName: string
    channel: 'email' | 'whatsapp' | null
    status: 'sent' | 'skipped' | 'failed'
    reason: string
}

type PendingGroup = {
    ruleId: string
    ruleName: string
    step: number
    stepLabel: string
    rows: PendingRow[]
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
    // Deep-linkable from the dashboard's "Contracts Expiring Soon" banner
    // (?tab=pending) — read once on load, same as any other tab default.
    const [searchParams] = useSearchParams()
    const [tab, setTab] = useState<'rules' | 'pending'>(searchParams.get('tab') === 'pending' ? 'pending' : 'rules')

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

    const { data: channels } = useQuery<{ whatsapp: boolean; email: boolean; autoSend: boolean; whatsappAutomation: boolean; whatsappApprovalRequired: boolean }>({
        queryKey: ['automation-channels'],
        queryFn: () => api.get('/automation-rules/channels').then(r => r.data),
    })

    const { data: pending, isLoading: pendingLoading } = useQuery<{ groups: PendingGroup[]; total: number; matched: number; alreadyHandled: number }>({
        queryKey: ['automation-rules-pending'],
        queryFn: () => api.get('/automation-rules/pending').then(r => r.data),
        enabled: tab === 'pending',
        refetchInterval: 60_000,
    })

    const toggleAutoSend = useMutation({
        mutationFn: (enabled: boolean) => api.put('/automation-rules/auto-send', { enabled }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-channels'] }),
        onError: (e) => setError(apiError(e)),
    })

    const toggleWhatsAppAutomation = useMutation({
        mutationFn: (enabled: boolean) => api.put('/automation-rules/whatsapp', { enabled }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-channels'] }),
        onError: (e) => setError(apiError(e)),
    })
    const toggleWhatsappApproval = useMutation({
        mutationFn: (enabled: boolean) => api.put('/automation-rules/whatsapp-approval', { enabled }),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-channels'] }),
    })

    const [runResult, setRunResult] = useState('')
    const runNow = useMutation({
        mutationFn: (dry: boolean) => api.post(`/automation-rules/run${dry ? '?dry=1' : ''}`).then(r => r.data),
        onSuccess: (d) => {
            setRunResult(d.dryRun
                ? `Preview: ${d.planned?.length ?? 0} message(s) would be sent now (${d.skipped} skipped as already sent or unreachable).`
                : `Done — sent ${d.sent}, skipped ${d.skipped}${d.errors ? `, ${d.errors} failed` : ''}.`)
            qc.invalidateQueries({ queryKey: ['automation-logs'] })
        },
        onError: (e) => setError(apiError(e)),
    })

    const updateRule = useMutation({
        mutationFn: ({ id, body }: { id: string; body: Partial<AutomationRule> }) =>
            api.put(`/automation-rules/${id}`, body),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-rules'] }),
        onError: (e) => setError(apiError(e)),
    })

    // A contract already messaged under a step keeps counting as "already
    // sent" for that step forever, even after its day count is edited —
    // steps are tracked by position, not by day number. This is the
    // deliberate escape hatch: it can put reminders straight back out to
    // people who already got one, so it asks for a name-typed confirmation
    // rather than a plain OK.
    const resetHistory = useMutation({
        mutationFn: (id: string) => api.post(`/automation-rules/${id}/reset-history`),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['automation-rules'] })
            qc.invalidateQueries({ queryKey: ['automation-rules-pending'] })
        },
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
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Automation Rules</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Configure when automatic reminders are sent to clients, and how often. The engine runs every 6 hours.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button type="button" disabled={runNow.isPending}
                        onClick={() => runNow.mutate(true)}
                        data-tour="automation-preview-run"
                        className="h-9 px-4 rounded-lg border text-xs font-semibold hover:bg-muted cursor-pointer disabled:opacity-60">
                        Preview run
                    </button>
                    <button type="button" disabled={runNow.isPending}
                        onClick={() => {
                            const msg = channels?.whatsappApprovalRequired
                                ? 'Send all due reminders now? WhatsApp still needs your approval — only email goes out from this button; approve WhatsApp from Pending Approvals.'
                                : 'Send all due reminders now, on every channel including WhatsApp?'
                            if (confirm(msg)) runNow.mutate(false)
                        }}
                        className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 cursor-pointer disabled:opacity-60">
                        {runNow.isPending ? 'Running…' : 'Run now'}
                    </button>
                </div>
            </div>

            {channels && (
                <div className="flex items-center gap-4 mt-3 text-xs flex-wrap">
                    <button type="button"
                        onClick={() => {
                            if (!channels.autoSend && !confirm('Turn on automatic sending? Due reminders will go out every 6 hours without further confirmation. Use "Preview run" first to see what would be sent.')) return
                            toggleAutoSend.mutate(!channels.autoSend)
                        }}
                        data-tour="automation-autosend"
                        className={`h-7 px-3 rounded-full font-bold cursor-pointer transition-colors ${channels.autoSend ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        Automatic sending: {channels.autoSend ? 'ON' : 'OFF — click to enable'}
                    </button>
                    {/* A rule can have WhatsApp switched on and still send
                        nothing while this is off. Deliberate: the built-in rules
                        ship with WhatsApp enabled, so turning a rule on for its
                        email would otherwise turn on WhatsApp with it. */}
                    <button type="button"
                        onClick={() => {
                            if (!channels.whatsappAutomation && !confirm('Allow automated WhatsApp? Rules with WhatsApp enabled will start messaging tenants on the next run. Email is unaffected either way.')) return
                            toggleWhatsAppAutomation.mutate(!channels.whatsappAutomation)
                        }}
                        data-tour="automation-whatsapp-gate"
                        className={`h-7 px-3 rounded-full font-bold cursor-pointer transition-colors ${channels.whatsappAutomation ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>
                        Automated WhatsApp: {channels.whatsappAutomation ? 'ON' : 'OFF'}
                    </button>
                    {/* Separate from the switch above: that one is "can
                        WhatsApp send at all"; this one is "can it send
                        unattended". On (the default) means the 6-hour cron
                        and "Run now" always skip WhatsApp and leave it for
                        Pending Approvals — nothing goes out on that channel
                        without somebody reading it first. */}
                    <button type="button"
                        onClick={() => {
                            if (channels.whatsappApprovalRequired && !confirm('Let WhatsApp reminders send automatically, without your approval? Email is unaffected either way.')) return
                            toggleWhatsappApproval.mutate(!channels.whatsappApprovalRequired)
                        }}
                        data-tour="automation-whatsapp-approval"
                        className={`h-7 px-3 rounded-full font-bold cursor-pointer transition-colors ${channels.whatsappApprovalRequired ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        WhatsApp: {channels.whatsappApprovalRequired ? 'needs your approval' : 'auto-sends — click to require approval'}
                    </button>
                    <span data-tour="automation-channels" className="flex items-center gap-4">
                      <span className={channels.whatsapp ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                          WhatsApp: {channels.whatsapp ? 'ready' : 'not configured'}
                      </span>
                      <span className={channels.email ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                          Email: {channels.email ? 'ready' : 'not connected'}
                      </span>
                    </span>
                    {!channels.email && (
                        <Link to="/settings" className="text-primary hover:underline">Connect Gmail in Settings →</Link>
                    )}
                </div>
            )}
            {runResult && <p className="text-xs text-emerald-700 mt-2 font-medium">{runResult}</p>}

            {error && <p className="text-xs text-destructive mt-3">{error}</p>}

            {/* Tabs */}
            <div className="flex gap-1 mt-6 border-b items-end">
                <Link to="/settings/templates"
                    className="px-1 pb-3 text-sm font-semibold text-muted-foreground hover:text-foreground mr-5">
                    Message Templates
                </Link>
                <button
                    type="button"
                    onClick={() => setTab('rules')}
                    className={`px-1 pb-3 text-sm font-bold cursor-pointer mr-5 -mb-px ${tab === 'rules' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent'}`}
                >
                    Automation Rules
                </button>
                <button
                    type="button"
                    onClick={() => setTab('pending')}
                    className={`flex items-center gap-1.5 px-1 pb-3 text-sm font-bold cursor-pointer -mb-px ${tab === 'pending' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground border-b-2 border-transparent'}`}
                >
                    Pending Approvals
                    {Boolean(pending?.total) && (
                        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-100 text-amber-700 text-[10.5px] font-bold">
                            {pending!.total}
                        </span>
                    )}
                </button>
            </div>

            {tab === 'pending' ? (
                <PendingApprovals
                    data={pending}
                    isLoading={pendingLoading}
                    onSent={() => {
                        qc.invalidateQueries({ queryKey: ['automation-rules-pending'] })
                        qc.invalidateQueries({ queryKey: ['automation-logs'] })
                    }}
                />
            ) : (
            <>
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
                        onResetHistory={() => {
                            if (confirm(`Reset "${rule.name}"'s send history?\n\nAnyone already messaged under one of its steps becomes eligible for that same step again — this can send a reminder to someone who already got one, if a step's day count changed since they were messaged.`)) {
                                resetHistory.mutate(rule._id)
                            }
                        }}
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
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <h2 className="text-lg font-bold tracking-tight">Recent Activity</h2>
                        <p className="text-sm text-muted-foreground mt-1">Log of automatic reminders sent to clients.</p>
                    </div>
                    <div className="relative w-full sm:w-auto">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search client or unit"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-9 w-full sm:w-[220px] border rounded-full pl-9 pr-3 text-sm bg-background"
                        />
                    </div>
                </div>

                <div className="mt-4 border rounded-xl bg-card overflow-x-auto">
                  <div className="min-w-[640px]">
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
            </div>
            </>
            )}

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

// ── Pending Approvals ────────────────────────────────────────────────────────
// Contract-expiry reminders that are due but have not gone out — nothing here
// sends on its own. An admin checks who to message and presses "Approve &
// Send Selected"; everything else waits for the next review. Payment
// reminders aren't part of this queue — this is scoped to the contract-expiry
// rule the spec was written against.
function PendingApprovals({ data, isLoading, onSent }: {
    data?: { groups: PendingGroup[]; total: number; matched: number; alreadyHandled: number }
    isLoading: boolean
    onSent: () => void
}) {
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const [preview, setPreview] = useState<PendingRow | null>(null)
    const [previewTab, setPreviewTab] = useState<'email' | 'whatsapp'>('email')
    const qc = useQueryClient()
    const [sendError, setSendError] = useState('')
    const [sendResult, setSendResult] = useState('')
    const [outcomes, setOutcomes] = useState<SendOutcome[]>([])
    const [outcomeNames, setOutcomeNames] = useState<Record<string, string>>({})

    const groups = data?.groups ?? []
    const rowKey = (r: PendingRow) => `${r.contractId}:${r.ruleId}`

    const send = useMutation({
        mutationFn: (selections: { contractId: string; ruleId: string }[]) => {
            // Remember who each row was, so an outcome for a contract that has
            // since left the list can still be named.
            const names: Record<string, string> = {}
            for (const g of groups) for (const r of g.rows) names[rowKey(r)] = `${r.customerName} (${r.contractNo})`
            setOutcomeNames(names)
            return api.post<{ sent: number; skipped: number; errors: number; outcomes?: SendOutcome[] }>('/automation-rules/pending/send', { selections }).then(r => r.data)
        },
        onSuccess: (d) => {
            setSendError('')
            setSendResult(`Sent ${d.sent}${d.skipped ? `, ${d.skipped} skipped` : ''}${d.errors ? `, ${d.errors} failed` : ''}.`)
            setOutcomes(d.outcomes ?? [])
            setSelected(new Set())
            // A row that has just gone out leaves the list now, not after the
            // server has rebuilt it — that rebuild takes a few seconds, and in
            // that gap three rows marked "sent" above sat there looking as if
            // they still needed approving.
            const sentKeys = new Set((d.outcomes ?? []).filter(o => o.status === 'sent').map(o => `${o.contractId}:${o.ruleId}`))
            if (sentKeys.size) {
                qc.setQueryData<{ groups: PendingGroup[]; total: number; matched: number; alreadyHandled: number } | undefined>(
                    ['automation-rules-pending'],
                    (prev) => prev ? {
                        ...prev,
                        groups: prev.groups
                            .map(g => ({ ...g, rows: g.rows.filter(r => !sentKeys.has(rowKey(r))) }))
                            .filter(g => g.rows.length > 0),
                        total: Math.max(0, prev.total - sentKeys.size),
                        alreadyHandled: prev.alreadyHandled + sentKeys.size,
                    } : prev,
                )
            }
            onSent()
        },
        onError: (e) => setSendError(apiError(e)),
    })

    function toggleRow(r: PendingRow) {
        setSelected(s => {
            const n = new Set(s)
            const k = rowKey(r)
            n.has(k) ? n.delete(k) : n.add(k)
            return n
        })
    }
    function toggleGroup(g: PendingGroup) {
        const keys = g.rows.map(rowKey)
        const allOn = keys.every(k => selected.has(k))
        setSelected(s => {
            const n = new Set(s)
            keys.forEach(k => allOn ? n.delete(k) : n.add(k))
            return n
        })
    }
    function toggleCollapsed(key: string) {
        setCollapsed(c => {
            const n = new Set(c)
            n.has(key) ? n.delete(key) : n.add(key)
            return n
        })
    }

    if (isLoading) return <div className="mt-10"><Spinner /></div>

    if (!groups.length) {
        const matched = data?.matched ?? 0
        return (
            <div className="mt-10 border border-dashed rounded-xl p-10 text-center">
                <p className="text-sm font-semibold">Nothing waiting on approval.</p>
                {matched === 0 ? (
                    <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                        No active contract currently falls inside one of your configured windows (the day counts on
                        each step, above). Check back as contracts get closer to their expiry date.
                    </p>
                ) : (
                    <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                        {matched} contract{matched === 1 ? '' : 's'} currently match{matched === 1 ? 'es' : ''} a step,
                        but each already has that exact reminder logged as sent. If you just changed a step&rsquo;s
                        day count, that&rsquo;s expected: a step is tracked by its position (1st, 2nd, 3rd…), not by
                        its day number, so retiming a step doesn&rsquo;t bring back contracts that step already
                        messaged under its old timing.
                    </p>
                )}
            </div>
        )
    }

    return (
        <div className="mt-6">
            <p className="text-sm text-muted-foreground">
                Contracts due a reminder, grouped by which step matched. Check who should get one, review the exact
                message, then approve — nothing sends until you do.
            </p>

            {sendError && <p className="text-xs text-destructive mt-3">{sendError}</p>}
            {sendResult && (
                <div className="mt-3 rounded-xl border bg-card p-3">
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-bold">{sendResult}</p>
                        <div className="flex items-center gap-3">
                            <Link to="/settings/sent-emails" className="text-xs font-semibold text-primary hover:underline">Open Sent Emails →</Link>
                            <button type="button" onClick={() => { setSendResult(''); setOutcomes([]) }} className="text-xs text-muted-foreground hover:underline cursor-pointer">Dismiss</button>
                        </div>
                    </div>
                    {outcomes.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-1">
                            {outcomes.map((o, i) => {
                                const who = o.customerName ? `${o.customerName} (${o.contractNo})` : (outcomeNames[`${o.contractId}:${o.ruleId}`] || o.contractId)
                                const tone = o.status === 'sent' ? 'text-emerald-700' : o.status === 'failed' ? 'text-destructive' : 'text-amber-700'
                                const mark = o.status === 'sent' ? '✓' : o.status === 'failed' ? '✕' : '–'
                                return (
                                    <li key={i} className="text-xs flex gap-2">
                                        <span className={`font-bold w-3 shrink-0 ${tone}`}>{mark}</span>
                                        <span><span className="font-semibold">{who}</span>{o.channel ? ` · ${o.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}` : ''} — <span className={tone}>{o.status === 'sent' ? '' : `${o.status}: `}{o.reason}</span></span>
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>
            )}

            <div className="flex flex-col gap-4 mt-4">
                {groups.map(g => {
                    const groupKey = `${g.ruleId}:${g.step}`
                    const isCollapsed = collapsed.has(groupKey)
                    const keys = g.rows.map(rowKey)
                    const allOn = keys.every(k => selected.has(k))
                    const someOn = keys.some(k => selected.has(k))
                    return (
                        <div key={groupKey} className="border rounded-xl bg-card overflow-hidden">
                            <button
                                type="button"
                                onClick={() => toggleCollapsed(groupKey)}
                                className="w-full flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-muted/40"
                            >
                                {isCollapsed ? <ChevronRight size={15} className="text-muted-foreground shrink-0" /> : <ChevronDown size={15} className="text-muted-foreground shrink-0" />}
                                <span className="text-sm font-bold">{g.rows.length} contract{g.rows.length === 1 ? '' : 's'} · {g.stepLabel}</span>
                                <span className="text-xs text-muted-foreground">({g.ruleName})</span>
                                <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => { e.stopPropagation(); toggleGroup(g) }}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); toggleGroup(g) } }}
                                    className="ml-auto text-xs font-semibold text-primary hover:underline cursor-pointer"
                                >
                                    {allOn ? 'Clear all' : someOn ? 'Select rest' : 'Select all'}
                                </span>
                            </button>

                            {!isCollapsed && (
                                <div className="border-t overflow-x-auto">
                                    <div className="min-w-[720px]">
                                        <div className="grid grid-cols-[28px_1.3fr_1fr_0.8fr_1fr_0.7fr_1.1fr_44px] px-4 py-2 text-[11px] font-bold tracking-wider text-muted-foreground uppercase border-b bg-muted/30">
                                            <div />
                                            <div>Client</div><div>Contract No</div><div>Unit</div><div>Expiry Date</div><div>Days Left</div><div>Channel</div><div />
                                        </div>
                                        {g.rows.map(r => {
                                            const on = selected.has(rowKey(r))
                                            return (
                                                <div key={rowKey(r)} className={`grid grid-cols-[28px_1.3fr_1fr_0.8fr_1fr_0.7fr_1.1fr_44px] px-4 py-2.5 text-sm border-b items-center last:border-b-0 ${on ? 'bg-primary/5' : ''}`}>
                                                    <input type="checkbox" checked={on} onChange={() => toggleRow(r)} className="cursor-pointer" />
                                                    <div className="font-semibold truncate pr-2">{r.customerName}</div>
                                                    <div className="text-muted-foreground">{r.contractNo}</div>
                                                    <div className="text-muted-foreground">{r.unit}</div>
                                                    <div className="text-muted-foreground">{formatDate(r.endDate)}</div>
                                                    <div className="text-muted-foreground">{r.daysLeft}</div>
                                                    <div className="text-muted-foreground capitalize">{r.channels.join(' + ')}</div>
                                                    <button
                                                        type="button"
                                                        onClick={() => { setPreview(r); setPreviewTab(r.channels[0] ?? 'email') }}
                                                        title="Preview the message"
                                                        className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer"
                                                    >
                                                        <Eye size={15} />
                                                    </button>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Sticky approve bar */}
            <div className="sticky bottom-0 mt-5 -mx-2 px-2 py-3 bg-background/95 backdrop-blur border-t flex items-center justify-between gap-3 flex-wrap">
                <span className="text-sm text-muted-foreground">
                    {selected.size === 0 ? 'Nothing selected.' : `${selected.size} of ${data?.total ?? 0} selected.`}
                </span>
                <button
                    type="button"
                    disabled={selected.size === 0 || send.isPending}
                    onClick={() => {
                        const selections = [...selected].map(k => {
                            const [contractId, ruleId] = k.split(':')
                            return { contractId, ruleId }
                        })
                        if (confirm(`Send ${selections.length} reminder${selections.length === 1 ? '' : 's'} now?`)) send.mutate(selections)
                    }}
                    className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 cursor-pointer disabled:opacity-50"
                >
                    {send.isPending ? 'Sending…' : `Approve & Send Selected${selected.size ? ` (${selected.size})` : ''}`}
                </button>
            </div>

            {/* Preview modal */}
            {preview && (
                <Modal open onClose={() => setPreview(null)} title={`${preview.customerName} — ${preview.contractNo}`} wide>
                    <div className="flex gap-1 border-b mb-3">
                        {(['email', 'whatsapp'] as const).filter(c => preview.channels.includes(c)).map(c => (
                            <button
                                key={c}
                                type="button"
                                onClick={() => setPreviewTab(c)}
                                className={`flex items-center gap-1.5 px-3 pb-2 text-sm font-semibold cursor-pointer ${previewTab === c ? 'text-primary border-b-2 border-primary -mb-px' : 'text-muted-foreground'}`}
                            >
                                {c === 'email' ? <Mail size={13} /> : <MessageCircle size={13} />}
                                {c === 'email' ? 'Email' : 'WhatsApp'}
                            </button>
                        ))}
                    </div>
                    {previewTab === 'email' ? (
                        <div>
                            <p className="text-xs text-muted-foreground mb-2"><b>Subject:</b> {preview.preview.emailSubject}</p>
                            <iframe
                                title="Email preview"
                                srcDoc={preview.preview.emailHtml}
                                sandbox=""
                                style={{ width: '100%', height: '55vh', minHeight: 380, border: '1px solid rgba(20,8,31,.12)', borderRadius: 10, background: '#fff' }}
                            />
                        </div>
                    ) : (
                        <div className="rounded-lg border p-4 bg-muted/20 text-sm whitespace-pre-wrap">
                            {preview.preview.whatsapp || 'This step has no WhatsApp message configured.'}
                        </div>
                    )}
                </Modal>
            )}
        </div>
    )
}

// ── Rule Card ────────────────────────────────────────────────────────────────
function RuleCard({ rule, templates: _templates, onToggleEnabled, onToggleEmail, onToggleWhatsApp, onAddStep, onRemoveStep, onUpdateStep, onEditTemplate, onChangeRecurringDays, onDelete, onResetHistory }: {
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
    onResetHistory: () => void
}) {
    const Icon = ICON_MAP[rule.icon] || Bell

    return (
        <div
            className="border rounded-xl p-5 bg-card"
            data-tour={rule.triggerEvent === 'contract_expiry' ? 'automation-rule-expiry' : undefined}
        >
            {/* Header — controls wrap below the title on narrow screens */}
            <div className="flex items-center gap-3.5 flex-wrap">
                <div className="w-[38px] h-[38px] rounded-[10px] bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Icon size={18} />
                </div>
                <div className="flex-1 min-w-[180px]">
                    <div className="font-bold text-[15px]">{rule.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                        {rule.triggerLabel}
                        {rule.remindersResetAt && (
                            <span> · history reset {formatDate(rule.remindersResetAt)}</span>
                        )}
                    </div>
                </div>

                {/* Retiming a step doesn't make someone eligible again on its own
                    — steps are tracked by position, not by day count. This is
                    the deliberate way to clear that. */}
                <button
                    type="button"
                    onClick={onResetHistory}
                    title="Let contracts already messaged under a step become eligible for it again"
                    className="flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 border transition-colors cursor-pointer bg-muted text-muted-foreground border-transparent hover:text-foreground"
                >
                    <RotateCcw size={12} /> Reset send history
                </button>

                {/* Channel pills */}
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        data-tour={rule.triggerEvent === 'contract_expiry' ? 'automation-rule-email' : undefined}
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
                    <div key={i} className="flex items-center gap-2.5 bg-muted/30 border rounded-[10px] px-3 py-2.5 flex-wrap">
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

                        <button
                            onClick={() => onEditTemplate(i)}
                            className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/10 rounded-full px-2.5 py-1 hover:bg-primary/20 transition-colors cursor-pointer max-w-full"
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
                    <div className="flex items-center gap-2.5 bg-primary/5 border border-primary/15 rounded-[10px] px-3 py-2.5 mt-0.5 flex-wrap">
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

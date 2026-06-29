import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Plus, Trash2, Play, Save, ChevronDown, ChevronUp } from 'lucide-react'
import { reminderConfigApi, apiError } from '../lib/api'
import type { ReminderConfig, ReminderStage } from '../lib/types'

const PLACEHOLDERS = ['{{name}}', '{{amount}}', '{{unit}}', '{{dueDate}}', '{{daysLeft}}']

const CHANNEL_OPTIONS = [
  { value: 'both', label: 'WhatsApp + Email' },
  { value: 'whatsapp', label: 'WhatsApp only' },
  { value: 'email', label: 'Email only' },
]

const defaultStage = (): ReminderStage => ({
  name: 'New Stage',
  daysBeforeDue: 7,
  frequencyDays: 3,
  channel: 'both',
  message: 'Dear {{name}}, your payment of AED {{amount}} for Unit {{unit}} is due on {{dueDate}}. Please arrange payment. Thank you, PurpleBox Storage.',
})

export default function ReminderSettings() {
  const qc = useQueryClient()
  const [runResult, setRunResult] = useState<{ sent: number; skipped: number; errors: number } | null>(null)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [saveError, setSaveError] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['reminder-config'],
    queryFn: reminderConfigApi.get,
  })

  const [draft, setDraft] = useState<ReminderConfig | null>(null)
  const config = draft ?? data ?? null

  // sync draft when data arrives (first load only)
  if (data && !draft) setDraft(structuredClone(data))

  const saveMutation = useMutation({
    mutationFn: (body: Partial<ReminderConfig>) => reminderConfigApi.save(body),
    onSuccess: (saved) => {
      qc.setQueryData(['reminder-config'], saved)
      setDraft(structuredClone(saved))
      setSaveError('')
    },
    onError: (e) => setSaveError(apiError(e)),
  })

  const runMutation = useMutation({
    mutationFn: reminderConfigApi.runNow,
    onSuccess: (res) => setRunResult(res),
    onError: () => setRunResult(null),
  })

  if (isLoading || !config) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading reminder settings…
      </div>
    )
  }

  function updateConfig(patch: Partial<ReminderConfig>) {
    setDraft((d) => d ? { ...d, ...patch } : d)
  }

  function updateStage(idx: number, patch: Partial<ReminderStage>) {
    setDraft((d) => {
      if (!d) return d
      const stages = [...d.stages]
      stages[idx] = { ...stages[idx], ...patch }
      return { ...d, stages }
    })
  }

  function addStage() {
    setDraft((d) => {
      if (!d) return d
      const stages = [...d.stages, defaultStage()]
      setExpandedIdx(stages.length - 1)
      return { ...d, stages }
    })
  }

  function removeStage(idx: number) {
    setDraft((d) => {
      if (!d) return d
      const stages = d.stages.filter((_, i) => i !== idx)
      return { ...d, stages }
    })
    if (expandedIdx === idx) setExpandedIdx(null)
  }

  function insertPlaceholder(idx: number, placeholder: string) {
    if (!config) return
    updateStage(idx, { message: (config.stages[idx]?.message ?? '') + placeholder })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <Bell size={18} className="text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Payment Reminders</h1>
          <p className="text-sm text-muted-foreground">Auto-send WhatsApp/email reminders for unpaid storage payments</p>
        </div>
      </div>

      {/* General settings */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-semibold text-sm text-foreground">General</h2>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => updateConfig({ enabled: e.target.checked })}
            className="h-4 w-4 rounded"
          />
          <span className="text-sm text-foreground">Enable automated reminders</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.whatsappEnabled}
            onChange={(e) => updateConfig({ whatsappEnabled: e.target.checked })}
            className="h-4 w-4 rounded"
          />
          <span className="text-sm text-foreground">WhatsApp reminders</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={config.emailEnabled}
            onChange={(e) => updateConfig({ emailEnabled: e.target.checked })}
            className="h-4 w-4 rounded"
          />
          <span className="text-sm text-muted-foreground">
            Email reminders
            <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(requires SMTP env vars on server)</span>
          </span>
        </label>

        <div className="flex items-center gap-3">
          <label className="text-sm text-foreground shrink-0">Start reminders on day</label>
          <input
            type="number"
            min={1}
            max={28}
            value={config.startDay}
            onChange={(e) => updateConfig({ startDay: Number(e.target.value) })}
            className="w-20 rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-sm text-muted-foreground">of each month</span>
        </div>
      </div>

      {/* Stages */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm text-foreground">Reminder Stages</h2>
          <button
            onClick={addStage}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
          >
            <Plus size={13} />Add Stage
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Stages are evaluated from most-advanced to least — the stage whose <strong>Days before due</strong> value is the smallest number ≥ days remaining is selected.
          Negative values = days overdue.
        </p>

        {config.stages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No stages — add one above.</p>
        )}

        {config.stages.map((stage, idx) => (
          <div key={idx} className="border border-border rounded-lg overflow-hidden">
            {/* Stage header */}
            <button
              onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer text-left"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                {idx + 1}
              </span>
              <span className="flex-1 font-medium text-sm text-foreground">{stage.name || `Stage ${idx + 1}`}</span>
              <span className="text-xs text-muted-foreground mr-2">
                {stage.daysBeforeDue >= 0
                  ? `${stage.daysBeforeDue}d before due`
                  : `${Math.abs(stage.daysBeforeDue)}d overdue`}
              </span>
              {expandedIdx === idx ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {/* Stage body */}
            {expandedIdx === idx && (
              <div className="px-4 py-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Stage name</label>
                    <input
                      value={stage.name}
                      onChange={(e) => updateStage(idx, { name: e.target.value })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Channel</label>
                    <select
                      value={stage.channel}
                      onChange={(e) => updateStage(idx, { channel: e.target.value as ReminderStage['channel'] })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {CHANNEL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Days before due (negative = overdue)
                    </label>
                    <input
                      type="number"
                      value={stage.daysBeforeDue}
                      onChange={(e) => updateStage(idx, { daysBeforeDue: Number(e.target.value) })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      Frequency (min days between sends)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={stage.frequencyDays}
                      onChange={(e) => updateStage(idx, { frequencyDays: Math.max(1, Number(e.target.value)) })}
                      className="w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Message</label>
                  <textarea
                    value={stage.message}
                    onChange={(e) => updateStage(idx, { message: e.target.value })}
                    rows={4}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {PLACEHOLDERS.map((p) => (
                      <button
                        key={p}
                        onClick={() => insertPlaceholder(idx, p)}
                        className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80 cursor-pointer font-mono transition-colors"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => removeStage(idx)}
                    className="flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 cursor-pointer transition-colors"
                  >
                    <Trash2 size={13} />Remove stage
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Action row */}
      {saveError && (
        <p className="text-sm text-destructive">{saveError}</p>
      )}

      {runResult && (
        <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-800 dark:text-green-300">
          Run complete — sent: <strong>{runResult.sent}</strong>, skipped: <strong>{runResult.skipped}</strong>, errors: <strong>{runResult.errors}</strong>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={() => saveMutation.mutate(config)}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm font-medium cursor-pointer transition-colors"
        >
          <Save size={15} />
          {saveMutation.isPending ? 'Saving…' : 'Save Settings'}
        </button>

        <button
          onClick={() => { setRunResult(null); runMutation.mutate(); }}
          disabled={runMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-foreground hover:bg-muted/50 disabled:opacity-50 text-sm font-medium cursor-pointer transition-colors"
        >
          <Play size={15} />
          {runMutation.isPending ? 'Running…' : 'Run Now'}
        </button>
      </div>
    </div>
  )
}

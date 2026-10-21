import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'
import type { IntegrationStatus } from '../lib/types'
import { Button, Field, Input, Select } from './ui'

type Msg = { ok: boolean; text: string } | null
const NAME = { openai: 'OpenAI', anthropic: 'Claude' } as const

/**
 * Which AI answers across the app (WhatsApp assistant, summaries, agents,
 * ID reading, the CRM assistant), plus the Claude key. The OpenAI key has its
 * own card below. Voice notes stay on OpenAI whichever is chosen.
 */
export default function AiProviderCard({ integrations }: { integrations?: IntegrationStatus }) {
  const qc = useQueryClient()
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const claude = integrations?.anthropic
  const ai = integrations?.ai
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations-status'] })

  const switchTo = async (provider: 'openai' | 'anthropic') => {
    setBusy(true); setMsg(null)
    try {
      await api.post('/integrations/ai/provider', { provider })
      setMsg({ ok: true, text: `${NAME[provider]} now answers everywhere in the app.` })
      refresh()
    } catch (e) { setMsg({ ok: false, text: apiError(e) }) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-lg border px-4 py-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-medium">AI provider</div>
          <div className="text-xs text-muted-foreground">
            Switch between OpenAI and Claude at any time. Voice notes (transcribing and spoken replies) always use OpenAI.
          </div>
        </div>
        <div className="inline-flex rounded-md border overflow-hidden text-sm">
          {(['openai', 'anthropic'] as const).map((p) => (
            <button key={p} type="button" disabled={busy || ai?.chosen === p}
              onClick={() => switchTo(p)}
              className={`px-3 py-1.5 ${ai?.chosen === p ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              {NAME[p]}
            </button>
          ))}
        </div>
      </div>
      {ai && ai.chosen !== ai.active && (
        <p className="text-xs text-amber-600">
          {NAME[ai.chosen]} is selected but has no key, so {NAME[ai.active]} is answering.
        </p>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t">
        <div className="font-medium text-sm">Claude (Anthropic) key</div>
        <span className={claude?.configured ? 'text-xs text-emerald-600 font-medium' : 'text-xs text-amber-600 font-medium'}>
          {claude?.configured ? `Connected — ${claude.keyHint}` : 'Not connected'}
        </span>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={claude?.configured ? 'Replace API key (leave blank to keep)' : 'API key'}>
          <Input type="password" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Field label="Model">
          <Select value={model || claude?.model || 'claude-opus-5-5'} onChange={(e) => setModel(e.target.value)}>
            <option value="claude-opus-5-5">Claude Opus 5.5 — most capable</option>
            <option value="claude-sonnet-5-5">Claude Sonnet 5.5 — faster, cheaper</option>
            <option value="claude-haiku-5-5">Claude Haiku 5.5 — cheapest</option>
          </Select>
        </Field>
        <Field label="Effort">
          <Select value={effort || claude?.effort || 'low'} onChange={(e) => setEffort(e.target.value)}>
            <option value="low">Low — quickest replies</option>
            <option value="medium">Medium</option>
            <option value="high">High — most careful, slower</option>
          </Select>
        </Field>
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" disabled={busy || (!key && !model && !effort)}
          onClick={async () => {
            setBusy(true); setMsg(null)
            try {
              const r = await api.post('/integrations/anthropic/connect', {
                apiKey: key || undefined, model: model || undefined, effort: effort || undefined,
              }).then((x: { data: { model: string; effort: string; keyHint: string; active: 'openai' | 'anthropic' } }) => x.data)
              setKey(''); setModel(''); setEffort('')
              const now = r.active === 'anthropic' ? ' Claude now answers everywhere in the app.' : ''
              setMsg({ ok: true, text: `Saved. Claude uses ${r.model} at ${r.effort} effort with key ${r.keyHint}.${now}` })
              refresh()
            } catch (e) { setMsg({ ok: false, text: apiError(e) }) } finally { setBusy(false) }
          }}>
          {busy ? 'Checking…' : claude?.configured ? 'Save' : 'Connect'}
        </Button>
        {claude?.configured && (
          <Button size="sm" variant="outline" disabled={busy}
            onClick={async () => {
              if (!confirm('Remove the Claude key? If Claude is selected, OpenAI will answer instead.')) return
              setBusy(true); setMsg(null)
              try {
                await api.post('/integrations/anthropic/disconnect')
                setMsg({ ok: true, text: 'Claude key removed.' })
                refresh()
              } catch (e) { setMsg({ ok: false, text: apiError(e) }) } finally { setBusy(false) }
            }}>
            Disconnect
          </Button>
        )}
        <span className="text-xs text-muted-foreground">The key is checked with Anthropic before it is saved. A new key also switches the app to Claude.</span>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}`}>{msg.text}</p>}
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'
import type { IntegrationStatus } from '../lib/types'

/**
 * Which AI answers the bots, agents and Ask box — one click, right where the
 * answers are, instead of a trip to Settings. The same switch as
 * Settings → Integrations; keys are still saved there.
 */

const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const NAME = { openai: 'OpenAI', anthropic: 'Claude' } as const

export default function AiSwitch() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const { data } = useQuery<IntegrationStatus>({ queryKey: ['integrations-status'], queryFn: () => api.get('/integrations/status').then((r) => r.data), staleTime: 60_000 })
  const ai = data?.ai
  if (!ai) return null
  const has = { openai: Boolean(data?.openai?.configured), anthropic: Boolean(data?.anthropic?.configured) }

  async function to(p: 'openai' | 'anthropic') {
    setBusy(true); setErr('')
    try {
      await api.post('/integrations/ai/provider', { provider: p })
      qc.invalidateQueries({ queryKey: ['integrations-status'] })
    } catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12.5, color: MUTED, marginBottom: 12 }}>
      <span>AI</span>
      <div className="inline-flex" role="group" aria-label="AI provider" style={{ border: '1px solid rgba(20,8,31,.12)', borderRadius: 999, padding: 2 }}>
        {(['openai', 'anthropic'] as const).map((p) => (
          <button key={p} type="button" disabled={busy || ai.active === p || !has[p]} onClick={() => to(p)}
            title={has[p] ? undefined : `Save the ${NAME[p]} key in Settings → Integrations first`}
            style={{ fontSize: 12, fontWeight: 700, border: 0, borderRadius: 999, padding: '4px 12px', cursor: has[p] ? 'pointer' : 'not-allowed', background: ai.active === p ? PURPLE : 'transparent', color: ai.active === p ? '#fff' : has[p] ? '#111' : '#B8B2C2' }}>
            {NAME[p]}
          </button>
        ))}
      </div>
      {err && <span style={{ color: '#B91C1C' }}>{err}</span>}
    </div>
  )
}

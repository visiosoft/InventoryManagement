import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'
import { PageHeader, Spinner } from '../components/ui'

const INK = '#14081F'
const MUTED = '#4A4357'
const FAINT = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.10)'
const LINE_2 = 'rgba(20,8,31,.16)'

type Config = {
  enabled: boolean
  systemPrompt: string
  model: string
  maxToolRounds: number
  roles: string[]
  actionsEnabled: boolean
  actionRoles: string[]
  defaultPrompt: string
  promptLimit: number
  serverModel: string
  tools: string[]
  openai: { configured: boolean }
}

const ROLES = ['admin', 'accounts', 'sales_rep']

/**
 * The corner assistant's settings.
 *
 * The prompt steers tone and priorities. It cannot make the assistant know
 * anything — every fact still comes from the fixed list of questions it may
 * ask the database, shown at the bottom so what it can and cannot see is
 * never a mystery.
 */
export default function AssistantSettings() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['assistant-config'],
    queryFn: () => api.get<Config>('/assistant/config').then((r) => r.data),
  })
  const [draft, setDraft] = useState<Partial<Config> | null>(null)
  useEffect(() => { if (data && !draft) setDraft(data) }, [data, draft])

  const save = useMutation({
    mutationFn: (body: Partial<Config>) => api.put('/assistant/config', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assistant-config'] })
      qc.invalidateQueries({ queryKey: ['assistant-capabilities'] })
    },
  })

  if (isLoading || !draft) return <Spinner />

  const field = { width: '100%', border: `1px solid ${LINE_2}`, borderRadius: 9, padding: '9px 11px', fontSize: 13.5, background: '#fff', color: INK }
  const label = { display: 'block', fontSize: 12.5, fontWeight: 600, color: MUTED, marginBottom: 5 }

  return (
    <div style={{ maxWidth: 900 }}>
      <PageHeader title="Ask the system" subtitle="The assistant in the corner of every page. It reads your data and never changes it." />

      {!data?.openai.configured && (
        <p className="mb-4 px-4 py-3" style={{ background: '#FFF7E6', border: '1px solid #E9D9B4', borderRadius: 10, fontSize: 13, color: '#6B4500' }}>
          OpenAI is not connected, so the assistant cannot answer. Connect it under Settings → Integrations.
        </p>
      )}

      <div className="flex flex-col gap-4">
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '20px 22px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
            <label style={{ display: 'block' }}>
              <span style={label}>Switched on</span>
              <select value={draft.enabled ? 'yes' : 'no'} onChange={(e) => setDraft({ ...draft, enabled: e.target.value === 'yes' })} style={field}>
                <option value="yes">Yes</option>
                <option value="no">No — hide it everywhere</option>
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={label}>Model</span>
              <select value={draft.model || ''} onChange={(e) => setDraft({ ...draft, model: e.target.value })} style={field}>
                <option value="">Same as the server ({data?.serverModel})</option>
                <option value="gpt-4o-mini">gpt-4o-mini — cheapest</option>
                <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                <option value="gpt-4.1">gpt-4.1 — best at reading questions</option>
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span style={label}>Look-ups per question</span>
              <select value={draft.maxToolRounds || 4} onChange={(e) => setDraft({ ...draft, maxToolRounds: Number(e.target.value) })} style={field}>
                {[2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span style={{ display: 'block', color: FAINT, fontSize: 11.5, marginTop: 4 }}>How many times it may ask the database before it must answer.</span>
            </label>
          </div>

          <div style={{ marginTop: 16 }}>
            <span style={label}>Who can use it</span>
            <div className="flex gap-2 flex-wrap">
              {ROLES.map((r) => {
                const on = (draft.roles || []).includes(r)
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setDraft({ ...draft, roles: on ? (draft.roles || []).filter((x) => x !== r) : [...(draft.roles || []), r] })}
                    className="cursor-pointer"
                    style={{ fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '6px 13px', border: `1px solid ${on ? PURPLE : LINE_2}`, background: on ? '#EDE5FF' : '#fff', color: on ? '#4A1FA0' : MUTED }}
                  >
                    {r.replace('_', ' ')}
                  </button>
                )
              })}
            </div>
            <span style={{ display: 'block', color: FAINT, fontSize: 11.5, marginTop: 6 }}>
              It answers with company-wide figures — occupancy, revenue, every contract — so think before giving it to reps.
            </span>
          </div>
        </div>

        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '20px 22px' }}>
          <span style={label}>Doing things, not only answering</span>
          <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 12px', maxWidth: '76ch' }}>
            With this on it can create a quotation for a named person and send it — which reserves a unit
            and messages a customer. It always proposes first; nothing happens until someone presses
            Confirm in the chat. This decides who may see that Confirm button at all.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
            <label style={{ display: 'block' }}>
              <span style={label}>Allowed to act</span>
              <select value={draft.actionsEnabled === false ? 'no' : 'yes'} onChange={(e) => setDraft({ ...draft, actionsEnabled: e.target.value === 'yes' })} style={field}>
                <option value="yes">Yes — propose, then confirm</option>
                <option value="no">No — answers only</option>
              </select>
            </label>
            <div>
              <span style={label}>Who may confirm an action</span>
              <div className="flex gap-2 flex-wrap">
                {ROLES.map((r) => {
                  const on = (draft.actionRoles || []).includes(r)
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setDraft({ ...draft, actionRoles: on ? (draft.actionRoles || []).filter((x) => x !== r) : [...(draft.actionRoles || []), r] })}
                      className="cursor-pointer"
                      style={{ fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '6px 13px', border: `1px solid ${on ? PURPLE : LINE_2}`, background: on ? '#EDE5FF' : '#fff', color: on ? '#4A1FA0' : MUTED }}
                    >
                      {r.replace('_', ' ')}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '20px 22px' }}>
          <div className="flex items-baseline gap-3 flex-wrap mb-2">
            <span style={label}>How it should talk</span>
            <span style={{ fontSize: 11.5, color: FAINT, marginLeft: 'auto' }}>
              {(draft.systemPrompt || '').length.toLocaleString()} / {data?.promptLimit.toLocaleString()}
            </span>
            <button type="button" onClick={() => setDraft({ ...draft, systemPrompt: data?.defaultPrompt || '' })} className="cursor-pointer" style={{ fontSize: 12, color: '#4A1FA0', fontWeight: 600, background: 'none', border: 0 }}>
              Reset to default
            </button>
          </div>
          <textarea
            rows={10}
            value={draft.systemPrompt || ''}
            onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
            style={{ ...field, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
          />
          <p style={{ fontSize: 12, color: FAINT, marginTop: 8, maxWidth: '80ch' }}>
            This steers tone and priorities. It cannot make the assistant know anything: every figure
            it states still comes from one of the questions below, and an answer whose numbers did not
            come from the database is refused rather than shown.
          </p>
        </div>

        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '20px 22px' }}>
          <span style={label}>What it can ask the database</span>
          <div className="flex flex-wrap gap-1.5">
            {(data?.tools || []).map((t) => (
              <span key={t} style={{ fontSize: 11.5, fontFamily: 'ui-monospace, Menlo, monospace', color: '#4A1FA0', background: '#F7F3FF', border: '1px solid #DDD0FF', borderRadius: 8, padding: '3px 9px' }}>
                {t}
              </span>
            ))}
          </div>
          <p style={{ fontSize: 12, color: FAINT, marginTop: 10 }}>
            Anything outside this list it will say it cannot see. Adding a question is a code change, on purpose.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => save.mutate({ enabled: draft.enabled, systemPrompt: draft.systemPrompt, model: draft.model, maxToolRounds: draft.maxToolRounds, roles: draft.roles, actionsEnabled: draft.actionsEnabled, actionRoles: draft.actionRoles })}
            disabled={save.isPending}
            className="cursor-pointer disabled:opacity-50"
            style={{ background: PURPLE, color: '#fff', border: 0, borderRadius: 10, padding: '11px 18px', fontWeight: 600, fontSize: 13.5 }}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          {save.isSuccess && <span style={{ fontSize: 12.5, color: '#0F6E56' }}>Saved</span>}
          {save.error && <span style={{ fontSize: 12.5, color: '#8A1C1C' }}>{apiError(save.error)}</span>}
        </div>
      </div>
    </div>
  )
}

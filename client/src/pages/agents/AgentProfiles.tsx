import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Save } from 'lucide-react'
import { apiError } from '../../lib/api'
import { agentsApi, type AgentProfile } from '../../lib/agentsApi'
import { Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Spinner, Textarea } from '../../components/ui'

const INK = '#14081F'
const MUTED = '#756E80'
const LINE = '#E6E0F0'
const PURPLE = '#5B2BC9'

const STARTER_PROMPT = `You are Aisha, the sales assistant for PurpleBox Storage in Dubai, replying to customers on WhatsApp.

Be brief and warm. WhatsApp messages are a few short lines, not paragraphs.
Your job: understand what the customer needs (size, when, how long, what they are storing), check what is available and what it costs, and offer the best fit. When they are ready, give a full written quotation.
Ask one question at a time. Never ask something the lead file already answers.
For anything about an existing contract, an invoice, a payment, a discount, or a complaint, hand over to a colleague.`

const MODELS = [
  { id: '', label: 'Same as the server' },
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini — cheapest' },
  { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
  { id: 'gpt-4.1', label: 'gpt-4.1' },
  { id: 'gpt-6-luna', label: 'gpt-6-luna — cheaper than gpt-4o-mini, untested here' },
  { id: 'gpt-6-sol', label: 'gpt-6-sol — newer, untested here' },
]

const TOOL_HELP: Record<string, string> = {
  units_available: 'See which units are free (read)',
  price_booking: 'Price a booking with real quote math (read)',
  update_lead_file: 'Write down what the customer needs',
  note_offer: 'Record a unit and price it offered',
  move_bucket: 'Move the lead along the follow-up lifecycle',
  propose_follow_up_template: 'Pick an approved template for a follow-up touch',
  escalate: 'Hand the conversation to a person',
}

type Draft = {
  name: string; mode: 'off' | 'shadow'; model: string; systemPrompt: string; enabledTools: string[]
  whatsappNumbers: string; cadence: Record<'quoted' | 'booking' | 'quiet' | 'dormant', string>; escalateTo: string; maxToolRounds: number
  syncLeadStatus: boolean
}

const toDraft = (p: AgentProfile | null): Draft => ({
  name: p?.name || '',
  mode: p?.mode || 'shadow',
  model: p?.model || '',
  systemPrompt: p?.systemPrompt || STARTER_PROMPT,
  enabledTools: p?.enabledTools || [],
  whatsappNumbers: (p?.whatsappNumbers || []).join(', '),
  cadence: {
    quoted: (p?.cadence?.quoted || []).join(', '),
    booking: (p?.cadence?.booking || []).join(', '),
    quiet: (p?.cadence?.quiet || []).join(', '),
    dormant: (p?.cadence?.dormant || []).join(', '),
  },
  escalateTo: typeof p?.escalateTo === 'object' && p?.escalateTo ? p.escalateTo._id : (p?.escalateTo as string) || '',
  maxToolRounds: p?.maxToolRounds || 4,
  syncLeadStatus: p?.syncLeadStatus ?? false,
})

const days = (s: string) => s.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0)

export default function AgentProfiles() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['agents', 'profiles'], queryFn: agentsApi.profiles })
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(toDraft(null))
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    if (editing === 'new') setDraft({ ...toDraft(null), enabledTools: data?.tools || [] })
    else if (editing) setDraft(toDraft(data?.profiles.find((p) => p._id === editing) || null))
  }, [editing, data])

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name, mode: draft.mode, model: draft.model, systemPrompt: draft.systemPrompt, enabledTools: draft.enabledTools,
        whatsappNumbers: draft.whatsappNumbers.split(',').map((s) => s.trim()).filter(Boolean),
        cadence: { quoted: days(draft.cadence.quoted), booking: days(draft.cadence.booking), quiet: days(draft.cadence.quiet), dormant: days(draft.cadence.dormant) },
        escalateTo: draft.escalateTo || null, maxToolRounds: draft.maxToolRounds, syncLeadStatus: draft.syncLeadStatus,
      }
      return editing === 'new' ? agentsApi.createProfile(body as Partial<AgentProfile>) : agentsApi.updateProfile(editing as string, body as Partial<AgentProfile>)
    },
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['agents'] }); setEditing(p._id); setErr(''); setOk('Saved'); setTimeout(() => setOk(''), 2000) },
    onError: (e) => setErr(apiError(e)),
  })

  const dc = data?.defaultCadence

  return (
    <div>
      <PageHeader title="Agents" subtitle="Onboarding an agent is filling in its employee record: a name, its instructions, what it may do, and who it hands to."
        action={<div className="flex gap-2"><Link to="/agents"><Button size="sm" variant="outline"><ArrowLeft size={13} /> Desk</Button></Link><Button size="sm" onClick={() => setEditing('new')}><Plus size={13} /> New agent</Button></div>} />

      {isLoading ? <Spinner /> : (
        <div style={{ display: 'grid', gridTemplateColumns: editing ? 'minmax(0,1fr) minmax(0,2fr)' : '1fr', gap: 16 }} className="agent-grid">
          <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
            {data?.profiles.length === 0 && <div style={{ color: MUTED, fontSize: 13 }}>No agents yet.</div>}
            {data?.profiles.map((p) => (
              <button key={p._id} onClick={() => setEditing(p._id)} style={{ textAlign: 'left', background: editing === p._id ? '#EFE7FB' : '#fff', border: `1px solid ${editing === p._id ? PURPLE : LINE}`, borderRadius: 12, padding: '12px 14px', cursor: 'pointer' }}>
                <div className="flex items-center justify-between">
                  <span style={{ fontWeight: 700, color: INK }}>{p.name}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '2px 8px', background: p.mode === 'shadow' ? '#FEF3C7' : '#F3F4F6', color: p.mode === 'shadow' ? '#B45309' : '#6B7280' }}>{p.mode}</span>
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>{p.model || 'server model'} · prompt v{p.promptVersion} · {p.enabledTools.length} tools</div>
              </button>
            ))}
          </div>

          {editing && (
            <Card>
              <CardHeader title={editing === 'new' ? 'New agent' : draft.name || 'Agent'} subtitle="Shadow mode only in this prototype: the agent drafts and proposes, nothing is sent to a customer."
                action={<Button size="sm" disabled={save.isPending || !draft.name.trim()} onClick={() => save.mutate()}><Save size={13} /> {save.isPending ? 'Saving…' : 'Save'}</Button>} />
              <CardBody className="space-y-4">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                  <Field label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Aisha" /></Field>
                  <Field label="Mode">
                    <Select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as Draft['mode'] })}>
                      <option value="shadow">Shadow — drafts, never sends</option>
                      <option value="off">Off</option>
                    </Select>
                  </Field>
                  <Field label="Model">
                    <Select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
                      {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Hands escalations to">
                    <Select value={draft.escalateTo} onChange={(e) => setDraft({ ...draft, escalateTo: e.target.value })}>
                      <option value="">— nobody yet —</option>
                      {data?.users.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
                    </Select>
                  </Field>
                </div>

                <Field label="Instructions (the job description)">
                  <Textarea rows={12} value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} className="font-mono text-sm" />
                </Field>
                <p style={{ fontSize: 12, color: MUTED, marginTop: -8 }}>Changing this bumps the prompt version, so every action can say which instructions produced it. The rules that stop the agent committing the business (no invented prices, no confirmed bookings, hand over on contracts and payments) are fixed and added by the system.</p>

                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: INK, marginBottom: 6 }}>What it may do</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 6 }}>
                    {data?.tools.map((t) => (
                      <label key={t} className="flex items-center gap-2" style={{ fontSize: 13, color: INK, cursor: 'pointer' }}>
                        <input type="checkbox" checked={draft.enabledTools.includes(t)} onChange={(e) => setDraft({ ...draft, enabledTools: e.target.checked ? [...draft.enabledTools, t] : draft.enabledTools.filter((x) => x !== t) })} />
                        <span><code style={{ fontSize: 12, color: PURPLE }}>{t}</code> <span style={{ color: MUTED }}>— {TOOL_HELP[t] || ''}</span></span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: INK, marginBottom: 6 }}>Follow-up cadence — days after entering the bucket, comma-separated (blank = default)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
                    {(['quoted', 'booking', 'quiet', 'dormant'] as const).map((k) => (
                      <Field key={k} label={`${k[0].toUpperCase()}${k.slice(1)} (default ${dc?.[k].join(', ')})`}>
                        <Input value={draft.cadence[k]} onChange={(e) => setDraft({ ...draft, cadence: { ...draft.cadence, [k]: e.target.value } })} placeholder={dc?.[k].join(', ')} />
                      </Field>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                  <Field label="Answers on these WhatsApp numbers (blank = any)"><Input value={draft.whatsappNumbers} onChange={(e) => setDraft({ ...draft, whatsappNumbers: e.target.value })} placeholder="9715xxxxxxx, 9714xxxxxxx" /></Field>
                  <Field label="Look-ups per turn"><Input type="number" min={1} max={8} value={draft.maxToolRounds} onChange={(e) => setDraft({ ...draft, maxToolRounds: Number(e.target.value) || 4 })} /></Field>
                </div>
                <label className="flex items-center gap-2" style={{ fontSize: 13, color: INK, cursor: 'pointer' }}>
                  <input type="checkbox" checked={draft.syncLeadStatus} onChange={(e) => setDraft({ ...draft, syncLeadStatus: e.target.checked })} />
                  <span>Let bucket moves update the lead's sales status <span style={{ color: MUTED }}>— off while shadowing, so the team's statuses stay theirs</span></span>
                </label>

                {err && <p style={{ color: '#B91C1C', fontSize: 12.5 }}>{err}</p>}
                {ok && <p style={{ color: '#15803D', fontSize: 12.5, fontWeight: 600 }}>{ok}</p>}
              </CardBody>
            </Card>
          )}
        </div>
      )}
      <style>{`@media (max-width: 860px) { .agent-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  )
}

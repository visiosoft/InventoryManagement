import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Save, Zap } from 'lucide-react'
import { apiError } from '../../lib/api'
import { agentsApi, AGENT_COLORS, type AgentProfile, type Decision, type OwnableBucket } from '../../lib/agentsApi'
import { Button, Field, Input, PageHeader, Select, Spinner, Textarea } from '../../components/ui'
import { AgentNav, Avatar, C, DecisionView, Eyebrow, Note, Panel, Pill, Tag } from './ui'

const STEPS = ['Identity', 'The job', 'Permissions', 'Training', 'On duty'] as const
const JOB: { key: 'who' | 'talk' | 'sell' | 'hand'; label: string; hint: string }[] = [
  { key: 'who', label: 'Who you are', hint: 'Name, company, the channel. One or two lines.' },
  { key: 'talk', label: 'How you talk', hint: 'Tone, length, one question at a time.' },
  { key: 'sell', label: 'What you sell', hint: 'Units, billing, the rule to always check with tools before quoting.' },
  { key: 'hand', label: 'When you hand over', hint: 'Contracts, invoices, payments, discounts, complaints, "can I speak to someone".' },
]
const STARTER = {
  who: 'Aisha, the sales assistant for PurpleBox Storage in Dubai, on WhatsApp.',
  talk: 'Brief and warm. A few short lines, one question at a time. Never ask what the lead file already answers, never re-introduce yourself mid-conversation.',
  sell: 'Self-storage units from 25 to 200 sqft, billed every 4 weeks. Always check availability and price with your tools before quoting. When they are ready, give a full written quotation.',
  hand: 'Existing contracts, invoices, payments, complaints, any discount request, or when they ask for a person.',
}
const compose = (p: typeof STARTER) => JOB.map((j) => `## ${j.label}\n${p[j.key].trim()}`).join('\n\n')
const parse = (prompt: string): typeof STARTER => {
  const out = { who: '', talk: '', sell: '', hand: '' }
  const parts = prompt.split(/^## (.+)$/m)
  if (parts.length < 3) return { ...out, who: prompt }
  for (let i = 1; i < parts.length; i += 2) {
    const j = JOB.find((x) => x.label === parts[i].trim())
    if (j) out[j.key] = (parts[i + 1] || '').trim()
  }
  return out
}

const CAPS: { tier: string; tone: 'ok' | 'amber' | 'danger'; hint: string; items: { tool: string; name: string; hint: string; shadow?: string }[] }[] = [
  { tier: 'Look up · no risk', tone: 'ok', hint: 'Reads only. The same code the screens use, so it cannot disagree with them.', items: [
    { tool: 'units_available', name: 'See which units are free', hint: 'Live availability by size, floor and dates' },
    { tool: 'price_booking', name: 'Price a booking', hint: 'The same quote math the screens use — it cannot misprice' },
  ] },
  { tier: 'Do · low risk, always revertible', tone: 'amber', hint: 'Changes the lead file or the follow-up schedule. Every one can be undone from the lead view.', items: [
    { tool: 'update_lead_file', name: 'Keep the lead file', hint: 'Writes down needs and open questions' },
    { tool: 'note_offer', name: 'Remember what it offered', hint: 'Units and prices it named, so it never contradicts itself' },
    { tool: 'move_bucket', name: 'Move a lead along the lifecycle', hint: 'Quoted, declined, asked not to be contacted' },
    { tool: 'propose_follow_up_template', name: 'Send approved follow-up templates', hint: 'Only Meta-approved wording, only the name filled in', shadow: 'shadow: proposes, you send' },
    { tool: 'escalate', name: 'Hand over to a person', hint: 'With a written summary of where things stand' },
  ] },
  { tier: 'Propose · money — a person confirms', tone: 'danger', hint: 'Not in this prototype. Quotation and contract proposals arrive with Phase 2.', items: [] },
]

type Draft = {
  name: string; role: string; avatarColor: string; model: string; job: typeof STARTER; enabledTools: string[]
  ownsBuckets: OwnableBucket[]; languages: string; whatsappNumbers: string; escalateTo: string; dailyBudgetAed: number; mode: 'off' | 'shadow'; syncLeadStatus: boolean; isDefault: boolean
}
const MODELS = [['', 'Same as the server'], ['gpt-4o-mini', 'gpt-4o-mini — cheapest'], ['gpt-4.1-mini', 'gpt-4.1-mini'], ['gpt-4.1', 'gpt-4.1'], ['gpt-6-luna', 'gpt-6-luna — cheaper than gpt-4o-mini, untested here'], ['gpt-6-sol', 'gpt-6-sol — newer, untested here']]
const BUCKET_OPTIONS: { key: OwnableBucket; label: string }[] = [['new', 'New'], ['engaged', 'Engaged'], ['quoted', 'Quoted'], ['booking', 'Booking'], ['quiet', 'Quiet'], ['dormant', 'Dormant'], ['tenant', 'Existing customers']].map(([key, label]) => ({ key: key as OwnableBucket, label }))

const toDraft = (p: AgentProfile | null, tools: string[]): Draft => ({
  name: p?.name || '', role: p?.role || '', avatarColor: p?.avatarColor || AGENT_COLORS[0], model: p?.model || '',
  job: p?.systemPrompt ? parse(p.systemPrompt) : STARTER, enabledTools: p ? p.enabledTools : tools.filter((t) => t !== 'propose_quotation'),
  ownsBuckets: p?.ownsBuckets || [], languages: (p?.languages || []).join(', '), whatsappNumbers: (p?.whatsappNumbers || []).join(', '),
  escalateTo: typeof p?.escalateTo === 'object' && p?.escalateTo ? p.escalateTo._id : (p?.escalateTo as string) || '', dailyBudgetAed: p?.dailyBudgetAed || 0,
  mode: p?.mode || 'shadow', syncLeadStatus: p?.syncLeadStatus ?? false, isDefault: p?.isDefault ?? false,
})
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

export default function AgentOnboarding() {
  const { id = 'new' } = useParams()
  const isNew = id === 'new'
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['agents', 'profiles'], queryFn: agentsApi.profiles })
  const existing = useMemo(() => data?.profiles.find((p) => p._id === id) || null, [data, id])
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [phone, setPhone] = useState('')
  const [msg, setMsg] = useState('')
  const [decision, setDecision] = useState<Decision | null>(null)
  useEffect(() => { if (data && !draft) setDraft(toDraft(existing, data.tools)) }, [data, existing, draft])

  const body = (d: Draft): Partial<AgentProfile> => ({
    name: d.name, role: d.role, avatarColor: d.avatarColor, model: d.model, systemPrompt: compose(d.job), enabledTools: d.enabledTools,
    ownsBuckets: d.ownsBuckets, languages: list(d.languages), whatsappNumbers: list(d.whatsappNumbers), escalateTo: d.escalateTo || null,
    dailyBudgetAed: d.dailyBudgetAed, mode: d.mode, syncLeadStatus: d.syncLeadStatus, isDefault: d.isDefault,
  })
  const save = useMutation({
    mutationFn: () => (isNew ? agentsApi.createProfile(body(draft!)) : agentsApi.updateProfile(id, body(draft!))),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['agents'] }); setErr(''); setOk('Saved'); setTimeout(() => setOk(''), 1500); if (isNew) nav(`/agents/profiles/${p._id}`, { replace: true }) },
    onError: (e) => setErr(apiError(e)),
  })
  const simulate = useMutation({
    mutationFn: () => agentsApi.simulate({ phone, text: msg, trigger: 'inbound', persist: false, agentId: isNew ? undefined : id }),
    onSuccess: (r) => { setDecision(r.decision); setErr('') }, onError: (e) => setErr(apiError(e)),
  })

  if (isLoading || !draft || !data) return <Spinner />
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const others = data.profiles.filter((p) => p._id !== id && p.isActive)
  const ownerOf = (b: OwnableBucket) => others.find((p) => p.mode !== 'off' && p.ownsBuckets.includes(b))
  const canSave = draft.name.trim().length > 0

  return (
    <div>
      <AgentNav />
      <PageHeader title={isNew ? 'Onboard an agent' : `${draft.name || 'Agent'} · edit`} subtitle="Like hiring: who they are, what the job is, what they may do, a trial run, then on duty."
        action={<div style={{ display: 'flex', gap: 8 }}><Link to="/agents/team"><Button size="sm" variant="outline"><ArrowLeft size={13} /> Team</Button></Link><Button size="sm" disabled={!canSave || save.isPending} onClick={() => save.mutate()}><Save size={13} /> {save.isPending ? 'Saving…' : isNew ? 'Save agent' : 'Save changes'}</Button></div>} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 16 }}>
        {STEPS.map((s, i) => (
          <button key={s} onClick={() => setStep(i)} style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${i === step ? C.purple : i < step ? C.ok : C.line}`, background: i === step ? C.purpleSoft : C.card, borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, letterSpacing: '.06em' }}>{i + 1}{i < step ? ' · DONE' : i === step ? ' · NOW' : ''}</div>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>{s}</div>
          </button>
        ))}
      </div>
      {(err || ok) && <p style={{ fontSize: 12.5, color: err ? C.danger : C.ok, margin: '0 0 10px' }}>{err || ok}</p>}

      {step === 0 && (
        <Panel>
          <Eyebrow>1 · Identity</Eyebrow>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Field label="Name"><Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Aisha" /></Field>
            <Field label="The job, in two words"><Input value={draft.role} onChange={(e) => set({ role: e.target.value })} placeholder="First response" /></Field>
            <Field label="Model"><Select value={draft.model} onChange={(e) => set({ model: e.target.value })}>{MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Eyebrow>Colour</Eyebrow>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {AGENT_COLORS.map((c) => <button key={c} onClick={() => set({ avatarColor: c })} aria-label={c} style={{ width: 26, height: 26, borderRadius: 999, background: c, border: `3px solid ${draft.avatarColor === c ? C.ink : 'transparent'}`, cursor: 'pointer' }} />)}
              <span style={{ marginLeft: 10 }}><Avatar name={draft.name || '?'} color={draft.avatarColor} size={40} /></span>
            </div>
          </div>
        </Panel>
      )}

      {step === 1 && (
        <Panel>
          <Eyebrow>2 · The job</Eyebrow>
          <div style={{ display: 'grid', gap: 12 }}>
            {JOB.map((j) => (
              <Field key={j.key} label={j.label}>
                <Textarea rows={j.key === 'who' ? 2 : 3} value={draft.job[j.key]} onChange={(e) => set({ job: { ...draft.job, [j.key]: e.target.value } })} placeholder={j.hint} />
              </Field>
            ))}
          </div>
          <Note>Saving a change bumps the instructions version, so every action can say which version produced it. The rules that stop an agent committing the business — no invented prices, no confirmed bookings, hand over on money and contracts — are fixed and added underneath; they are not editable here.</Note>
        </Panel>
      )}

      {step === 2 && (
        <Panel>
          <Eyebrow>3 · Permissions</Eyebrow>
          {CAPS.map((g) => (
            <div key={g.tier} style={{ marginBottom: 14 }}>
              <Eyebrow tone={g.tone === 'ok' ? C.ok : g.tone === 'amber' ? C.amber : C.danger}>{g.tier}</Eyebrow>
              <div style={{ display: 'grid', gap: 6 }}>
                {g.items.length === 0 && <Note>{g.hint}</Note>}
                {g.items.map((it) => {
                  const on = draft.enabledTools.includes(it.tool)
                  return (
                    <label key={it.tool} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', padding: '9px 12px', border: `1px solid ${C.line}`, borderRadius: 10, cursor: 'pointer' }}>
                      <div><b style={{ fontSize: 13 }}>{it.name}</b><span style={{ fontSize: 12, color: C.muted, display: 'block' }}>{it.hint}{it.shadow ? <> <Tag tone="grey">{it.shadow}</Tag></> : null}</span></div>
                      <input type="checkbox" checked={on} onChange={(e) => set({ enabledTools: e.target.checked ? [...draft.enabledTools, it.tool] : draft.enabledTools.filter((t) => t !== it.tool) })} />
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </Panel>
      )}

      {step === 3 && (
        <Panel>
          <Eyebrow>4 · Training</Eyebrow>
          <p style={{ fontSize: 13, color: C.second, margin: '0 0 10px' }}>Try a conversation: type a lead's phone and what they would say. {draft.name || 'The agent'} answers with the instructions {isNew ? 'above, once saved' : 'as saved'}, reading that lead's real history. Nothing is sent, nothing is written.</p>
          {isNew && <Note>Save the agent first, then come back here to try it.</Note>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input style={{ maxWidth: 200 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971 5x xxx xxxx" />
            <Input style={{ flex: '1 1 300px' }} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. Hi, how much is a small unit for 2 months from next week?" />
            <Button size="sm" disabled={isNew || simulate.isPending || !phone.trim() || !msg.trim()} onClick={() => simulate.mutate()}><Zap size={13} /> {simulate.isPending ? 'Thinking…' : 'Try it'}</Button>
          </div>
          {decision && <div style={{ marginTop: 12 }}><DecisionView d={decision} agentName={draft.name} /></div>}
          <Note>The trial against past conversations with a scorecard — prices matched, handed over when it should, tone — comes once the first recorded conversations are labelled. That labelling is the next piece of work.</Note>
        </Panel>
      )}

      {step === 4 && (
        <Panel>
          <Eyebrow>5 · On duty</Eyebrow>
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: C.second, marginBottom: 6 }}>Owns these buckets</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {BUCKET_OPTIONS.map((b) => {
                  const on = draft.ownsBuckets.includes(b.key)
                  const other = ownerOf(b.key)
                  return (
                    <label key={b.key} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '6px 10px', border: `1px solid ${on ? C.purple : C.line}`, background: on ? C.purpleSoft : C.card, borderRadius: 999, fontSize: 12.5, cursor: 'pointer' }}>
                      <input type="checkbox" checked={on} onChange={(e) => set({ ownsBuckets: e.target.checked ? [...draft.ownsBuckets, b.key] : draft.ownsBuckets.filter((x) => x !== b.key) })} />
                      {b.key === 'tenant' ? b.label : <Pill bucket={b.key} label={b.label} />}
                      {other && !on && <span style={{ color: C.muted }}>· {other.name}</span>}
                    </label>
                  )
                })}
              </div>
              <Note>A bucket has one owner. Taking one from another agent reassigns the leads in it as they next move — each move is logged as a handoff.</Note>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <Field label="Answers on these numbers (blank = any)"><Input value={draft.whatsappNumbers} onChange={(e) => set({ whatsappNumbers: e.target.value })} placeholder="9714329xxxx" /></Field>
              <Field label="Languages (blank = any)"><Input value={draft.languages} onChange={(e) => set({ languages: e.target.value })} placeholder="en, ar" /></Field>
              <Field label="Hands over to"><Select value={draft.escalateTo} onChange={(e) => set({ escalateTo: e.target.value })}><option value="">— nobody yet —</option>{data.users.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}</Select></Field>
              <Field label="Daily budget, AED (0 = no cap)"><Input type="number" min={0} value={draft.dailyBudgetAed} onChange={(e) => set({ dailyBudgetAed: Number(e.target.value) || 0 })} /></Field>
              <Field label="Mode"><Select value={draft.mode} onChange={(e) => set({ mode: e.target.value as Draft['mode'] })}><option value="shadow">Shadow — drafts, you send</option><option value="off">Off duty</option></Select></Field>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={draft.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} /> Default agent — takes any lead no rule matches</label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={draft.syncLeadStatus} onChange={(e) => set({ syncLeadStatus: e.target.checked })} /> Let bucket moves update the lead's sales status <span style={{ color: C.muted }}>— off while shadowing, so the team's statuses stay theirs</span></label>
            <Note>Live sending is not part of this prototype. Shadow means every reply and follow-up waits in Needs you until a person sends it.</Note>
          </div>
        </Panel>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
        <Button size="sm" variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={13} /> Back</Button>
        {step < STEPS.length - 1
          ? <Button size="sm" onClick={() => setStep(step + 1)}>Next <ArrowRight size={13} /></Button>
          : <Button size="sm" disabled={!canSave || save.isPending} onClick={() => save.mutate()}><Save size={13} /> {isNew ? 'Save and put on duty' : 'Save changes'}</Button>}
      </div>
    </div>
  )
}

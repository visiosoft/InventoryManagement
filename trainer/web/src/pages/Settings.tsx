import { useState, type ReactNode } from 'react'
import { useOutletContext, useSearchParams, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { api, apiError, BASE } from '../lib/api'
import { useSession } from '../lib/session'
import { type Me, INK, MUTED, ACCENT, LINE, btn, panel, caps, field, when } from './theme'
import { PageTitle } from './shared'
import PlaybookSettings from './PlaybookSettings'

/* One organisation's settings. Secrets (AI keys, tokens, app secrets) are
   written here and never shown back — only their last four characters. */

const TABS = [
  ['business', 'Business'], ['playbook', 'Playbook'], ['ai', 'AI provider'], ['connector', 'Connected system'], ['whatsapp', 'WhatsApp'],
  ['api', 'API'], ['team', 'Team'], ['usage', 'Usage'], ['feedback', 'Feedback'], ['data', 'Data'],
] as const

const Section = ({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) => (
  <div style={{ ...panel, padding: 20, marginBottom: 16 }}>
    <div style={{ fontWeight: 800, color: INK, fontSize: 15 }}>{title}</div>
    {sub && <div style={{ fontSize: 13, color: MUTED, margin: '4px 0 14px' }}>{sub}</div>}
    {children}
  </div>
)
const Row = ({ label, children }: { label: string; children: ReactNode }) => <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: MUTED, marginBottom: 12 }}>{label}<div style={{ marginTop: 5, fontWeight: 500 }}>{children}</div></label>
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <div style={{ fontSize: 13, color: m.ok ? '#166534' : '#B91C1C', marginTop: 8 }}>{m.text}</div> : null)
const Secret = ({ value }: { value: string }) => (
  <div style={{ background: '#FFF7E6', border: '1px solid #F5D896', borderRadius: 10, padding: 10, marginTop: 10, fontSize: 12.5 }}>
    Copy it now — it is not shown again.
    <div className="flex items-center gap-2" style={{ marginTop: 4 }}><code style={{ wordBreak: 'break-all', color: INK }}>{value}</code><button type="button" aria-label="Copy" onClick={() => navigator.clipboard?.writeText(value)}><Copy size={14} /></button></div>
  </div>
)

export default function Settings() {
  const { me } = useOutletContext<{ me: Me }>()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab')! : 'business'
  const manage = me.permissions.includes('manage')
  return (
    <div>
      <PageTitle title="Settings" sub={`${me.org.name} · your role: ${me.role}`} />
      <div className="flex flex-wrap gap-1" style={{ borderBottom: `1px solid ${LINE}`, marginBottom: 16 }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setParams({ tab: k }, { replace: true })}
            style={{ padding: '8px 12px', fontSize: 13.5, fontWeight: 700, color: tab === k ? ACCENT : MUTED, borderBottom: `2px solid ${tab === k ? ACCENT : 'transparent'}`, marginBottom: -1 }}>{label}</button>
        ))}
      </div>
      {!manage && !['team', 'usage', 'feedback'].includes(tab) ? <div style={{ ...panel, padding: 20, color: MUTED }}>Only owners and admins change settings.</div> : (
        <>
          {tab === 'business' && <Business me={me} />}
          {tab === 'playbook' && <PlaybookSettings me={me} />}
          {tab === 'ai' && <Ai me={me} />}
          {tab === 'connector' && <Connector me={me} />}
          {tab === 'whatsapp' && <WhatsApp me={me} />}
          {tab === 'api' && <ApiKeys />}
          {tab === 'team' && <Team me={me} />}
          {tab === 'usage' && <Usage />}
          {tab === 'feedback' && <Feedback />}
          {tab === 'data' && <Data me={me} />}
        </>
      )}
    </div>
  )
}

function useSaved() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['org'] })
}

function Business({ me }: { me: Me }) {
  const saved = useSaved()
  const o = me.org
  const [f, setF] = useState({ name: o.name, business: o.business, facts: o.facts, categories: o.categories.join('\n'), prohibited: o.prohibited.join('\n'), maxReplyLength: o.maxReplyLength, retentionDays: o.retentionDays })
  const [vars, setVars] = useState(o.variables.length ? o.variables : [{ name: '', value: '' }])
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null)
  const save = useMutation({
    mutationFn: () => api.patch('/org', { ...f, categories: f.categories.split('\n'), prohibited: f.prohibited.split('\n'), variables: vars.filter((v) => v.name.trim()) }),
    onSuccess: () => { setM({ ok: true, text: 'Saved.' }); saved() }, onError: (e) => setM({ ok: false, text: apiError(e) }),
  })
  return (
    <>
      <Section title="About the business" sub="What suggested answers and the hosted agent are written for.">
        <Row label="Organisation name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} style={field} /></Row>
        <Row label="What the business is (one line)"><input value={f.business} onChange={(e) => setF({ ...f, business: e.target.value })} placeholder="e.g. self-storage company in Dubai" style={field} /></Row>
        <Row label="Business facts — prices, hours, policies, anything an answer may state"><textarea rows={8} value={f.facts} onChange={(e) => setF({ ...f, facts: e.target.value })} style={{ ...field, lineHeight: 1.5 }} placeholder={'Opening hours: Mon–Sat 10–6\nDeposit: one month, refunded within 14 days\n…'} /></Row>
        <div style={{ fontSize: 12, color: MUTED, marginTop: -6, marginBottom: 12 }}>A connected system's live facts are added to these and win where they disagree.</div>
      </Section>
      <Section title="{Variables}" sub="Write {name} in an answer and today's value is filled in, so a change here (or in your connected system) updates every answer at once.">
        {vars.map((v, i) => (
          <div key={i} className="flex gap-2" style={{ marginBottom: 6 }}>
            <input value={v.name} onChange={(e) => setVars(vars.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') } : x)))} placeholder="price_small" aria-label="Variable name" style={{ ...field, width: 200 }} />
            <input value={v.value} onChange={(e) => setVars(vars.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="AED 650 per 4 weeks" aria-label="Value" style={field} />
          </div>
        ))}
        <button type="button" style={{ ...btn(), height: 30 }} onClick={() => setVars([...vars, { name: '', value: '' }])}>Add variable</button>
      </Section>
      <Section title="Rules">
        <div className="grid gap-4 md:grid-cols-2">
          <Row label="Categories (one per line)"><textarea rows={8} value={f.categories} onChange={(e) => setF({ ...f, categories: e.target.value })} style={field} /></Row>
          <Row label="Never say (one phrase per line)"><textarea rows={8} value={f.prohibited} onChange={(e) => setF({ ...f, prohibited: e.target.value })} style={field} placeholder={'guaranteed\n100% safe'} /></Row>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Row label="Longest reply (characters)"><input type="number" min={100} max={4000} value={f.maxReplyLength} onChange={(e) => setF({ ...f, maxReplyLength: Number(e.target.value) })} style={field} /></Row>
          <Row label="Keep imported conversations for (days, 0 = keep)"><input type="number" min={0} max={3650} value={f.retentionDays} onChange={(e) => setF({ ...f, retentionDays: Number(e.target.value) })} style={field} /></Row>
        </div>
      </Section>
      <button type="button" style={btn(true)} disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
      <Msg m={m} />
    </>
  )
}

function Ai({ me }: { me: Me }) {
  const saved = useSaved()
  const [provider, setProvider] = useState(me.org.ai.provider || 'anthropic')
  const [model, setModel] = useState(me.org.ai.model)
  const [key, setKey] = useState('')
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null)
  const save = useMutation({ mutationFn: () => api.put('/org/ai', { provider, model, key }), onSuccess: () => { setKey(''); setM({ ok: true, text: 'Key checked and saved.' }); saved() }, onError: (e) => setM({ ok: false, text: apiError(e) }) })
  const remove = useMutation({ mutationFn: () => api.delete('/org/ai'), onSuccess: () => { setM({ ok: true, text: 'Removed — the platform key is used.' }); saved() } })
  return (
    <Section title="AI provider" sub="Use your own Anthropic or OpenAI key, billed to your account. Without one, the platform key is used.">
      <div style={{ fontSize: 13, color: INK, marginBottom: 12 }}>Now: {me.org.ai.keyHint ? <b>{me.org.ai.provider} key {me.org.ai.keyHint}{me.org.ai.model ? ` · ${me.org.ai.model}` : ''}</b> : <b>platform key</b>}</div>
      <div className="grid gap-4 md:grid-cols-3">
        <Row label="Provider"><select value={provider} onChange={(e) => setProvider(e.target.value)} style={field}><option value="anthropic">Anthropic (Claude)</option><option value="openai">OpenAI</option></select></Row>
        <Row label={`Model (blank = ${me.org.ai.defaults[provider] ?? 'default'})`}><input value={model} onChange={(e) => setModel(e.target.value)} placeholder={me.org.ai.defaults[provider]} style={field} /></Row>
        <Row label="API key"><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'} autoComplete="off" style={field} /></Row>
      </div>
      <div className="flex gap-2"><button type="button" style={btn(true)} disabled={!key || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Checking…' : 'Check and save'}</button>
        {me.org.ai.keyHint && <button type="button" style={btn(false, true)} onClick={() => remove.mutate()}>Remove key</button>}</div>
      <Msg m={m} />
    </Section>
  )
}

function Connector({ me }: { me: Me }) {
  const saved = useSaved()
  const [url, setUrl] = useState(me.org.connector.url)
  const [token, setToken] = useState('')
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null)
  const save = useMutation({ mutationFn: () => api.put('/org/connector', { url, token: token || undefined, enabled: true }).then((r) => r.data), onSuccess: (d) => { setToken(''); setM({ ok: !/could not|no answer/.test(d.check), text: `Saved — ${d.check}.` }); saved() }, onError: (e) => setM({ ok: false, text: apiError(e) }) })
  const remove = useMutation({ mutationFn: () => api.delete('/org/connector'), onSuccess: () => { setUrl(''); saved() } })
  return (
    <Section title="Connected system" sub="Your CRM, helpdesk or chatbot platform, so the trainer can pull conversations, read live prices and test your own AI. Your system implements four endpoints (see below) and gives you a token.">
      {me.org.connector.enabled && <div style={{ fontSize: 13, marginBottom: 12 }}>Status: <b style={{ color: /could not|no answer/.test(me.org.connector.lastCheck) ? '#B91C1C' : '#166534' }}>{me.org.connector.lastCheck || 'saved'}</b>{me.org.connector.lastCheckAt ? ` · checked ${when(me.org.connector.lastCheckAt)}` : ''}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <Row label="Base address (https)"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/training-connector" style={field} /></Row>
        <Row label={me.org.connector.hasToken ? 'Token (leave blank to keep)' : 'Token'}><input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" style={field} /></Row>
      </div>
      <div className="flex gap-2"><button type="button" style={btn(true)} disabled={!url || save.isPending} onClick={() => save.mutate()}>Save and test</button>
        {me.org.connector.enabled && <button type="button" style={btn(false, true)} onClick={() => remove.mutate()}>Disconnect</button>}</div>
      <Msg m={m} />
      <pre style={{ fontSize: 11.5, background: '#14081F', color: '#E9E3FA', borderRadius: 10, padding: 12, marginTop: 16, overflowX: 'auto' }}>{`Authorization: Bearer <token>

GET  {base}/health                   → { "ok": true, "name": "Your CRM" }
GET  {base}/conversations?days&limit → { "threads": [{ "ref", "messages": [{ "from": "customer"|"agent", "text", "at", "byAi" }] }] }
GET  {base}/facts                    → { "text": "live facts…", "values": { "price_small": "AED 650" } }
POST {base}/agent-reply { "question", "ref", "at" } → { "reply", "needsHuman" }`}</pre>
    </Section>
  )
}

function WhatsApp({ me }: { me: Me }) {
  const saved = useSaved()
  const [secret, setSecret] = useState('')
  const [phone, setPhone] = useState(me.org.whatsapp.phoneNumberId)
  const [out, setOut] = useState<{ verifyToken: string; path: string } | null>(null)
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null)
  const info = useQuery<{ verifyToken: string; path: string }>({ queryKey: ['wa', me.org.id], queryFn: () => api.get('/org/whatsapp').then((r) => r.data), enabled: me.org.whatsapp.connected })
  const save = useMutation({ mutationFn: () => api.put('/org/whatsapp', { appSecret: secret, phoneNumberId: phone }).then((r) => r.data), onSuccess: (d) => { setSecret(''); setOut(d); saved() }, onError: (e) => setM({ ok: false, text: apiError(e) }) })
  const shown = out ?? info.data
  return (
    <Section title="WhatsApp Business" sub="Customer messages to your number are collected from the moment this is connected (Meta does not share older history). If another system already receives your WhatsApp webhooks, use the connector or the API instead — Meta sends each app's webhooks to one address.">
      <div className="grid gap-4 md:grid-cols-2">
        <Row label="Meta app secret (App settings → Basic)"><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" style={field} /></Row>
        <Row label="Phone number ID (optional)"><input value={phone} onChange={(e) => setPhone(e.target.value)} style={field} /></Row>
      </div>
      <button type="button" style={btn(true)} disabled={!secret || save.isPending} onClick={() => save.mutate()}>{me.org.whatsapp.connected ? 'Update' : 'Connect'}</button>
      <Msg m={m} />
      {shown && (
        <div style={{ fontSize: 13, marginTop: 14 }}>
          In Meta → WhatsApp → Configuration → Webhook, set:
          <div style={{ marginTop: 6 }}>Callback URL: <code>{window.location.origin}{BASE}api{shown.path.replace(/^\/webhooks/, '/webhooks')}</code></div>
          <div>Verify token: <code>{shown.verifyToken}</code></div>
          <div style={{ color: MUTED, marginTop: 4 }}>Then subscribe to the <b>messages</b> field.</div>
        </div>
      )}
    </Section>
  )
}

function ApiKeys() {
  const qc = useQueryClient()
  const [created, setCreated] = useState('')
  const keys = useQuery<{ keys: { id: string; label: string; last4: string; createdAt: string; revokedAt?: string }[] }>({ queryKey: ['keys'], queryFn: () => api.get('/org/keys').then((r) => r.data) })
  const mk = useMutation({ mutationFn: (label: string) => api.post('/org/keys', { label }).then((r) => r.data), onSuccess: (d) => { setCreated(d.key); qc.invalidateQueries({ queryKey: ['keys'] }) } })
  const revoke = useMutation({ mutationFn: (id: string) => api.delete(`/org/keys/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['keys'] }) })
  const base = `${window.location.origin}${BASE}api/v1`
  return (
    <Section title="API keys" sub="For your own chatbot or system: read the published answers, match a customer message to them, send conversations in, and report where a person corrected the AI. Keys are stored hashed and can be revoked any time.">
      {keys.data?.keys.map((k) => (
        <div key={k.id} className="flex items-center gap-2" style={{ padding: '6px 0', borderBottom: `1px solid ${LINE}`, fontSize: 13 }}>
          <span className="flex-1"><b>{k.label}</b> <span style={{ color: MUTED }}>…{k.last4} · {when(k.createdAt)}</span></span>
          {k.revokedAt ? <span style={{ color: MUTED }}>revoked</span> : <button type="button" style={{ ...btn(false, true), height: 28 }} onClick={() => { if (window.confirm('Revoke this key? Anything using it stops working.')) revoke.mutate(k.id) }}>Revoke</button>}
        </div>
      ))}
      <button type="button" style={{ ...btn(true), marginTop: 10 }} onClick={() => { const l = window.prompt('What will use this key?', 'Website chatbot'); if (l) mk.mutate(l) }}>New key</button>
      {created && <Secret value={created} />}
      <pre style={{ fontSize: 11.5, background: '#14081F', color: '#E9E3FA', borderRadius: 10, padding: 12, marginTop: 14, overflowX: 'auto' }}>{`Authorization: Bearer tq_…

GET  ${base}/knowledge
POST ${base}/match          { "message": "what are your prices?", "limit": 3 }
POST ${base}/conversations  { "conversations": [{ "conversation": "c1", "messages": [{ "from": "customer", "text": "…", "at": "…", "id": "…" }] }] }
POST ${base}/feedback       { "question": "…", "aiReply": "…", "humanReply": "…" }`}</pre>
    </Section>
  )
}

function Team({ me }: { me: Me }) {
  const qc = useQueryClient()
  const manage = me.permissions.includes('manage')
  const [link, setLink] = useState('')
  const [err, setErr] = useState('')
  const data = useQuery<{ members: { id: string; email: string; name: string; role: string; lastLoginAt?: string }[]; invites: { _id: string; email: string; role: string; expiresAt: string }[]; roles: string[] }>({ queryKey: ['members', me.org.id], queryFn: () => api.get('/org/members').then((r) => r.data) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['members', me.org.id] })
  const setRole = useMutation({ mutationFn: (b: { id: string; role: string }) => api.patch(`/org/members/${b.id}`, { role: b.role }), onSuccess: refresh, onError: (e) => setErr(apiError(e)) })
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/org/members/${id}`), onSuccess: refresh, onError: (e) => setErr(apiError(e)) })
  const invite = useMutation({ mutationFn: (b: { email: string; role: string }) => api.post('/org/invites', b).then((r) => r.data), onSuccess: (d) => { setLink(`${window.location.origin}${BASE}invite/${d.token}`); refresh() }, onError: (e) => setErr(apiError(e)) })
  const help: Record<string, string> = { owner: 'everything', admin: 'everything but deleting', trainer: 'import, review, test', reviewer: 'review and comment', approver: 'approve, publish, test', analyst: 'read only' }
  return (
    <Section title="Team" sub={Object.entries(help).map(([r, h]) => `${r}: ${h}`).join(' · ')}>
      {data.data?.members.map((m) => (
        <div key={m.id} className="flex flex-wrap items-center gap-2" style={{ padding: '8px 0', borderBottom: `1px solid ${LINE}`, fontSize: 13 }}>
          <span className="min-w-0 flex-1 truncate"><b style={{ color: INK }}>{m.name || m.email}</b> <span style={{ color: MUTED }}>{m.email}{m.lastLoginAt ? ` · last in ${when(m.lastLoginAt)}` : ''}</span></span>
          {manage ? <select value={m.role} onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value })} aria-label={`Role for ${m.email}`} style={{ ...field, width: 130, height: 32, padding: '0 6px' }}>{data.data!.roles.map((r) => <option key={r}>{r}</option>)}</select> : <span style={{ color: MUTED }}>{m.role}</span>}
          {manage && <button type="button" style={{ ...btn(false, true), height: 30 }} onClick={() => { if (window.confirm(`Remove ${m.email}?`)) remove.mutate(m.id) }}>Remove</button>}
        </div>
      ))}
      {(data.data?.invites.length ?? 0) > 0 && <div style={{ fontSize: 12.5, color: MUTED, marginTop: 10 }}>Invited: {data.data!.invites.map((i) => `${i.email} (${i.role})`).join(', ')}</div>}
      {manage && (
        <form className="flex flex-wrap gap-2" style={{ marginTop: 14 }} onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); invite.mutate({ email: String(f.get('email')), role: String(f.get('role')) }) }}>
          <input name="email" type="email" required placeholder="colleague@company.com" aria-label="Email to invite" style={{ ...field, width: 260 }} />
          <select name="role" defaultValue="reviewer" aria-label="Role" style={{ ...field, width: 140 }}>{(data.data?.roles ?? []).map((r) => <option key={r}>{r}</option>)}</select>
          <button type="submit" style={btn(true)}>Invite</button>
        </form>
      )}
      {link && <div style={{ fontSize: 12.5, marginTop: 10 }}>Send them this link (works once, for 14 days): <Secret value={link} /></div>}
      {err && <div style={{ color: '#B91C1C', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
    </Section>
  )
}

function Usage() {
  const { data } = useQuery<{ since: string; byFeature: { feature: string; calls: number; inputTokens: number; outputTokens: number }[]; byModel: { model: string; calls: number; inputTokens: number; outputTokens: number }[]; platformCalls: number }>({ queryKey: ['usage'], queryFn: () => api.get('/org/usage').then((r) => r.data) })
  const NAME: Record<string, string> = { cluster: 'Grouping questions', suggest: 'Suggested answers', judge: 'Grading tests', agent: 'Hosted agent replies' }
  const table = (rows: { calls: number; inputTokens: number; outputTokens: number; [k: string]: string | number }[], key: string) => (
    <table className="w-full" style={{ fontSize: 13 }}>
      <thead><tr style={{ color: MUTED, fontSize: 12 }}><th className="text-left font-medium">{key === 'feature' ? 'For' : 'Model'}</th><th className="text-right font-medium">Calls</th><th className="text-right font-medium">Input tokens</th><th className="text-right font-medium">Output tokens</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={String(r[key])} style={{ borderTop: `1px solid ${LINE}` }}><td style={{ padding: '6px 0' }}>{NAME[String(r[key])] ?? String(r[key])}</td><td className="text-right">{r.calls}</td><td className="text-right">{r.inputTokens.toLocaleString()}</td><td className="text-right">{r.outputTokens.toLocaleString()}</td></tr>)}</tbody>
    </table>
  )
  return (
    <Section title="AI usage · last 30 days" sub={data ? `${data.platformCalls} of these calls used the platform key.` : ''}>
      {data && (data.byFeature.length ? <div className="grid gap-6 md:grid-cols-2">{table(data.byFeature, 'feature')}{table(data.byModel, 'model')}</div> : <div style={{ color: MUTED, fontSize: 13 }}>No AI calls yet.</div>)}
    </Section>
  )
}

function Feedback() {
  const qc = useQueryClient()
  const { data } = useQuery<{ feedback: { _id: string; source: string; question: string; aiReply: string; humanReply: string; createdAt: string }[] }>({ queryKey: ['feedback'], queryFn: () => api.get('/training/feedback').then((r) => r.data) })
  const set = useMutation({ mutationFn: (b: { id: string; status: string }) => api.patch(`/training/feedback/${b.id}`, { status: b.status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback'] }) })
  return (
    <Section title="Feedback from your agents" sub="Where a person replied differently from the AI, sent by your system. A person's reply is not assumed right — if it should become the answer, approve it in Review.">
      {data?.feedback.map((f) => (
        <div key={f._id} className="grid gap-3 md:grid-cols-3" style={{ padding: '10px 0', borderTop: `1px solid ${LINE}`, fontSize: 13 }}>
          <div><div style={caps}>Customer</div>{f.question}</div>
          <div><div style={caps}>AI</div><span style={{ color: MUTED }}>{f.aiReply || '—'}</span></div>
          <div><div style={caps}>Person</div>{f.humanReply || '—'}
            <div className="flex gap-2" style={{ marginTop: 6 }}><button type="button" style={{ ...btn(), height: 28 }} onClick={() => set.mutate({ id: f._id, status: 'used' })}>Used</button><button type="button" style={{ ...btn(), height: 28, color: MUTED }} onClick={() => set.mutate({ id: f._id, status: 'dismissed' })}>Dismiss</button></div>
          </div>
        </div>
      ))}
      {!data?.feedback.length && <div style={{ fontSize: 13, color: MUTED }}>Nothing open.</div>}
    </Section>
  )
}

function Data({ me }: { me: Me }) {
  const { refresh } = useSession()
  const nav = useNavigate()
  const [err, setErr] = useState('')
  async function exportAll() {
    const r = await api.get('/org/export', { responseType: 'blob' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = `${me.org.slug}-ai-training-export.json`; a.click()
  }
  async function del() {
    const typed = window.prompt(`This deletes ${me.org.name} and everything stored for it — conversations, answers, tests, keys. It cannot be undone. Type the organisation name to confirm:`)
    if (typed == null) return
    try { await api.delete('/org', { data: { confirm: typed } }); await refresh(); nav('/') } catch (e) { setErr(apiError(e)) }
  }
  return (
    <>
      <Section title="Export" sub="Every approved answer with its versions, every common question, and every published version, as JSON.">
        <button type="button" style={btn()} onClick={exportAll}>Download export</button>
      </Section>
      {me.role === 'owner' && (
        <Section title="Delete organisation" sub="Removes the organisation and all of its data from the platform.">
          <button type="button" style={btn(false, true)} onClick={del}>Delete {me.org.name}</button>
          {err && <div style={{ color: '#B91C1C', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
        </Section>
      )}
    </>
  )
}

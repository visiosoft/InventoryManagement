import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { type Me, INK, MUTED, LINE, btn, panel, caps, field } from './theme'
import { type Playbook, type PlaybookResp } from './sales'

/* The sales playbook as configuration: what the agent is for, its behaviour
   contract, conversation states, next actions, the lead fields it learns,
   the scorecard and automatic fails, media, scenario groups and gates. */

type Col = { k: string; label: string; w?: number; num?: boolean }
type Row = Record<string, unknown>

const Card = ({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) => (
  <div style={{ ...panel, padding: 20, marginBottom: 16 }}>
    <div style={{ fontWeight: 800, color: INK, fontSize: 15 }}>{title}</div>
    {sub && <div style={{ fontSize: 13, color: MUTED, margin: '4px 0 12px' }}>{sub}</div>}
    {children}
  </div>
)

/** Rows of small inputs; the first column is the stable key. */
function Rows({ rows, cols, onChange, name }: { rows: Row[]; cols: Col[]; onChange: (r: Row[]) => void; name: string }) {
  const put = (i: number, k: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <div>
      <div className="hidden gap-1.5 sm:flex" style={{ ...caps, fontSize: 10.5, marginBottom: 4 }}>{cols.map((c) => <span key={c.k} style={{ width: c.w ?? undefined, flex: c.w ? '0 0 auto' : 1 }}>{c.label}</span>)}<span style={{ width: 20 }} /></div>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap gap-1.5 sm:flex-nowrap" style={{ marginBottom: 4 }}>
          {cols.map((c) => (
            <input key={c.k} aria-label={`${name} ${c.label} ${i + 1}`} type={c.num ? 'number' : 'text'} value={Array.isArray(r[c.k]) ? (r[c.k] as string[]).join(', ') : String(r[c.k] ?? '')}
              onChange={(e) => put(i, c.k, c.num ? Number(e.target.value) : c.k === 'tags' ? e.target.value.split(',').map((t) => t.trim()) : c.k === 'key' ? e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') : e.target.value)}
              style={{ ...field, padding: '6px 9px', fontSize: 12.5, width: c.w ?? undefined, flex: c.w ? '0 0 auto' : 1, minWidth: 0 }} />
          ))}
          <button type="button" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ color: MUTED, width: 20 }}><X size={14} /></button>
        </div>
      ))}
      <button type="button" style={{ ...btn(), height: 28, marginTop: 4 }} onClick={() => onChange([...rows, Object.fromEntries(cols.map((c) => [c.k, c.num ? 0 : '']))])}><Plus size={13} /> Add</button>
    </div>
  )
}

const GATES: [keyof Playbook['gates'], string][] = [
  ['corePass', 'Core scenarios pass (%)'], ['factual', 'Factual accuracy (%)'], ['autoFails', 'Automatic fails allowed'], ['avgScore', 'Average score'],
  ['blind', 'Blind review OK (%)'], ['blindSample', 'Blind ratings needed'], ['completion', 'Right outcome (%)'], ['escalation', 'Escalations handed over (%)'], ['maxDrop', 'Largest score drop'],
]

export default function PlaybookSettings({ me }: { me: Me }) {
  const pb = useQuery<PlaybookResp>({ queryKey: ['playbook', me.org.id], queryFn: () => api.get('/sales/playbook').then((r) => r.data) })
  return pb.data ? <Editor key={pb.data.promptVersion + pb.data.playbook.template} me={me} data={pb.data} /> : <div style={{ color: MUTED }}>Loading…</div>
}

function Editor({ me, data }: { me: Me; data: PlaybookResp }) {
  const qc = useQueryClient()
  const [p, setP] = useState<Playbook>(data.playbook)
  const [seed, setSeed] = useState(true)
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null)
  const done = () => qc.invalidateQueries({ queryKey: ['playbook', me.org.id] })
  const save = useMutation({ mutationFn: () => api.put('/sales/playbook', { playbook: p }), onSuccess: (r) => { setM({ ok: true, text: `Saved · playbook version ${r.data.promptVersion}` }); done() }, onError: (e) => setM({ ok: false, text: apiError(e) }) })
  const use = useMutation({
    mutationFn: (template: string) => api.post('/sales/playbook/template', { template, seed }),
    onSuccess: (r) => { setM({ ok: true, text: `Template applied${r.data.seeded ? ` · ${r.data.seeded} starter scenarios added as drafts` : ''}.` }); done(); qc.invalidateQueries({ queryKey: ['scenarios', me.org.id] }) },
    onError: (e) => setM({ ok: false, text: apiError(e) }),
  })
  const set = <K extends keyof Playbook>(k: K, v: Playbook[K]) => setP({ ...p, [k]: v })
  const weight = p.rubric.reduce((s, r) => s + (Number(r.weight) || 0), 0)

  return (
    <>
      <Card title="Start from a template" sub={data.custom ? `Using “${p.name}”. Applying a template replaces the playbook below.` : 'No playbook chosen yet; the general customer-service one is in use.'}>
        <div className="grid gap-3 md:grid-cols-2">
          {data.templates.map((t) => (
            <div key={t.key} style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: 14 }}>
              <div style={{ fontWeight: 700, color: INK }}>{t.name}</div>
              <div style={{ fontSize: 12.5, color: MUTED, margin: '4px 0 10px' }}>{t.goal}</div>
              {t.key === 'self_storage_sales' && <label className="flex items-center gap-1.5" style={{ fontSize: 12.5, color: INK, marginBottom: 8 }}><input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} /> Add 74 starter scenarios as drafts</label>}
              <button type="button" style={btn()} disabled={use.isPending} onClick={() => { if (!data.custom || window.confirm('Replace the current playbook with this template?')) use.mutate(t.key) }}>Use this</button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Purpose and behaviour" sub={<>Playbook version <code>{data.promptVersion}</code> — every sandbox reply and suite run records it.</>}>
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: MUTED, marginBottom: 10 }}>Name<input value={p.name} onChange={(e) => set('name', e.target.value)} style={{ ...field, marginTop: 4 }} /></label>
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: MUTED, marginBottom: 10 }}>Goal<input value={p.goal} onChange={(e) => set('goal', e.target.value)} style={{ ...field, marginTop: 4 }} /></label>
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: MUTED, marginBottom: 10 }}>Behaviour contract — always and never<textarea rows={10} value={p.contract} onChange={(e) => set('contract', e.target.value)} style={{ ...field, marginTop: 4, lineHeight: 1.5 }} /></label>
        <label className="flex items-start gap-2" style={{ fontSize: 13, color: INK }}><input type="checkbox" checked={p.shareContract} onChange={(e) => set('shareContract', e.target.checked)} style={{ marginTop: 3 }} />
          <span>Share this contract with my own agent<span style={{ display: 'block', fontSize: 12, color: MUTED }}>It is returned with every <code>/api/v1/match</code> answer, so a connected agent (like Aisha in the PurpleBox CRM) follows the same rules. Off by default.</span></span></label>
      </Card>

      <Card title="Conversation states"><Rows name="State" rows={p.states} cols={[{ k: 'key', label: 'Key', w: 150 }, { k: 'label', label: 'Label', w: 170 }, { k: 'objective', label: 'Objective' }]} onChange={(r) => set('states', r as Playbook['states'])} /></Card>
      <Card title="Next best actions" sub="The agent picks exactly one before it writes. Outcome links an action to visit, booking, follow_up or escalation for the completion gate. Keep “escalate”.">
        <Rows name="Action" rows={p.actions} cols={[{ k: 'key', label: 'Key', w: 150 }, { k: 'label', label: 'Label', w: 170 }, { k: 'when', label: 'Use when' }, { k: 'outcome', label: 'Outcome', w: 100 }]} onChange={(r) => set('actions', r as Playbook['actions'])} />
      </Card>
      <Card title="Lead fields" sub="What the agent learns about each customer and keeps up to date."><Rows name="Field" rows={p.fields} cols={[{ k: 'key', label: 'Key', w: 150 }, { k: 'label', label: 'Label', w: 170 }, { k: 'hint', label: 'Values' }]} onChange={(r) => set('fields', r as Playbook['fields'])} /></Card>
      <Card title="Scorecard" sub={<>Weights add up to <b style={{ color: weight === 100 ? '#166534' : '#B45309' }}>{weight}</b>{weight === 100 ? '' : ' (they are scaled, but 100 is easiest to read)'}. A reply passes at <input type="number" min={0} max={100} value={p.passMark} onChange={(e) => set('passMark', Number(e.target.value))} aria-label="Pass mark" style={{ ...field, width: 70, display: 'inline-block', padding: '2px 6px' }} /> with no automatic fail.</>}>
        <Rows name="Measure" rows={p.rubric} cols={[{ k: 'key', label: 'Key', w: 130 }, { k: 'label', label: 'Label', w: 150 }, { k: 'weight', label: 'Weight', w: 70, num: true }, { k: 'expect', label: 'What good looks like' }]} onChange={(r) => set('rubric', r as Playbook['rubric'])} />
        <div style={{ ...caps, margin: '14px 0 6px' }}>Automatic fails</div>
        <Rows name="Fail" rows={p.autoFails} cols={[{ k: 'key', label: 'Key', w: 180 }, { k: 'label', label: 'Label' }]} onChange={(r) => set('autoFails', r as Playbook['autoFails'])} />
        <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>invented_price, unauthorized_discount and no_escalation are also checked by code, not only by the AI reviewer.</div>
      </Card>
      <Card title="Media library" sub="What the agent may choose to send. In the sandbox it is only shown, never sent."><Rows name="Media" rows={p.media} cols={[{ k: 'key', label: 'Key', w: 150 }, { k: 'label', label: 'Label', w: 220 }, { k: 'tags', label: 'Tags (comma separated)' }]} onChange={(r) => set('media', r as Playbook['media'])} /></Card>
      <Card title="Scenario groups" sub="The test matrix and how many approved scenarios each group should have."><Rows name="Group" rows={p.groups} cols={[{ k: 'key', label: 'Key', w: 150 }, { k: 'label', label: 'Label' }, { k: 'min', label: 'Minimum', w: 90, num: true }]} onChange={(r) => set('groups', r as Playbook['groups'])} /></Card>
      <Card title="Graduation gates" sub="A run must meet all of them before the agent moves past Shadow.">
        <div className="grid gap-3 sm:grid-cols-3">
          {GATES.map(([k, l]) => <label key={k} style={{ fontSize: 12.5, color: MUTED, fontWeight: 700 }}>{l}<input type="number" min={0} value={p.gates[k]} onChange={(e) => set('gates', { ...p.gates, [k]: Number(e.target.value) })} style={{ ...field, marginTop: 4 }} /></label>)}
        </div>
      </Card>
      <div className="flex items-center gap-3">
        <button type="button" style={btn(true)} disabled={save.isPending} onClick={() => save.mutate()}>Save playbook</button>
        {m && <span style={{ fontSize: 13, color: m.ok ? '#166534' : '#B91C1C' }}>{m.text}</span>}
      </div>
    </>
  )
}

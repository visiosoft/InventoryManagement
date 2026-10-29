import { useState, type ReactNode } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload, Plug, Code2, MessageCircle } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { type Me, INK, MUTED, ACCENT, LINE, btn, panel, caps, field, when } from './theme'
import { Pill, PageTitle } from './shared'

/* Conversations come in four ways: the customer's connected system, a file,
   their own code by API, or WhatsApp Business. Each import picks the common
   questions out, groups them, and writes suggested answers. */

type Imp = {
  _id: string; source: string; label: string; status: string; stage: string; createdAt: string
  progress: { done: number; total: number }; problems?: string[]; startedBy?: { name: string }
  counts?: { messages?: number; turns?: number; skipped?: number; newIntents?: number; holdout?: number }
}
type Sources = { connector: boolean; stored: Record<string, { messages: number; last: string }> }
const STAGE: Record<string, string> = { reading: 'Reading conversations', clustering: 'Grouping questions', suggesting: 'Writing suggested answers', done: 'Done', failed: 'Failed' }

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div style={{ ...panel, padding: 18 }}><div className="flex items-center gap-2" style={{ fontWeight: 800, color: INK }}>{icon} {title}</div>{children}</div>
}

export default function Imports() {
  const { me } = useOutletContext<{ me: Me }>()
  const qc = useQueryClient()
  const [limit, setLimit] = useState(500)
  const [days, setDays] = useState(60)
  const [per, setPer] = useState(3)
  const [err, setErr] = useState('')
  const imports = useQuery<{ imports: Imp[] }>({
    queryKey: ['imports', me.org.id], queryFn: () => api.get('/training/imports').then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.imports.some((i) => i.status === 'running') ? 3000 : false),
  })
  const sources = useQuery<Sources>({ queryKey: ['sources', me.org.id], queryFn: () => api.get('/training/sources').then((r) => r.data) })
  const done = () => { setErr(''); qc.invalidateQueries({ queryKey: ['imports', me.org.id] }) }
  const start = useMutation({ mutationFn: (source: string) => api.post('/training/imports', { source, limit, days, perConversation: per }), onSuccess: done, onError: (e) => setErr(apiError(e)) })
  const upload = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append('file', f); fd.append('limit', String(limit)); return api.post('/training/imports/upload', fd) },
    onSuccess: done, onError: (e) => setErr(apiError(e)),
  })
  const running = imports.data?.imports.some((i) => i.status === 'running')
  const can = me.permissions.includes('import')
  const stored = sources.data?.stored ?? {}

  const sample = () => {
    const csv = 'conversation,from,text,at\nc1,customer,"Hi, what are your prices?",2026-10-01T10:00:00Z\nc1,agent,"Hello! Our prices start at…",2026-10-01T10:04:00Z\n'
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'conversations-template.csv'; a.click()
  }
  const importBtn = (source: string, label: string, ok = true) => <button type="button" style={{ ...btn(true), marginTop: 12 }} disabled={!can || running || start.isPending || !ok} onClick={() => start.mutate(source)}>{label}</button>

  return (
    <div className="space-y-4">
      <PageTitle title="Conversations" sub="Bring in real customer conversations. Phone numbers, emails, IDs and card numbers are masked before anything is stored." />
      <div style={{ ...panel, padding: 14 }} className="flex flex-wrap items-end gap-4">
        <label style={{ fontSize: 12, color: MUTED }}>Questions to take<input type="number" min={50} max={20000} step={50} value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ ...field, marginTop: 4, width: 120 }} /></label>
        <label style={{ fontSize: 12, color: MUTED }}>From the last … days<input type="number" min={1} max={730} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ ...field, marginTop: 4, width: 120 }} /></label>
        <label style={{ fontSize: 12, color: MUTED }}>Per conversation, at most<input type="number" min={1} max={20} value={per} onChange={(e) => setPer(Number(e.target.value))} style={{ ...field, marginTop: 4, width: 120 }} /></label>
        <span style={{ fontSize: 12, color: MUTED, maxWidth: 360 }}>A few questions per person means they come from many different people. One in five is kept aside to test the AI.</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card icon={<Plug size={16} style={{ color: ACCENT }} />} title="Connected system">
          <p style={{ fontSize: 13, color: MUTED, margin: '4px 0 0' }}>{sources.data?.connector ? 'Pull recent conversations straight from your system.' : <>Connect your CRM or helpdesk in <Link to="/settings?tab=connector" style={{ color: ACCENT, fontWeight: 700 }}>Settings</Link> to pull conversations, live prices and test your own AI.</>}</p>
          {importBtn('connector', `Import ${limit} questions`, Boolean(sources.data?.connector))}
        </Card>
        <Card icon={<Upload size={16} style={{ color: ACCENT }} />} title="From a file">
          <p style={{ fontSize: 13, color: MUTED, margin: '4px 0 12px' }}>CSV, Excel or JSON from any chat tool. Columns: <code>conversation</code>, <code>from</code> (customer or agent), <code>text</code>, <code>at</code>.</p>
          <div className="flex flex-wrap gap-2">
            <label style={{ ...btn(true), opacity: running || !can ? 0.5 : 1 }}>
              <Upload size={14} /> Choose file
              <input type="file" accept=".csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden disabled={running || !can} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = '' }} />
            </label>
            <button type="button" style={btn()} onClick={sample}><Download size={14} /> Template</button>
          </div>
        </Card>
        <Card icon={<Code2 size={16} style={{ color: ACCENT }} />} title="Sent by API">
          <p style={{ fontSize: 13, color: MUTED, margin: '4px 0 0' }}>Your developers send conversations to <code>POST /api/v1/conversations</code> with an API key (<Link to="/settings?tab=api" style={{ color: ACCENT, fontWeight: 700 }}>Settings → API</Link>). {stored.api ? <><b style={{ color: INK }}>{stored.api.messages.toLocaleString()}</b> messages received, latest {when(stored.api.last)}.</> : 'Nothing received yet.'}</p>
          {importBtn('api', 'Import what was sent', Boolean(stored.api))}
        </Card>
        <Card icon={<MessageCircle size={16} style={{ color: ACCENT }} />} title="WhatsApp Business">
          <p style={{ fontSize: 13, color: MUTED, margin: '4px 0 0' }}>{me.org.whatsapp.connected ? <>Customer messages arrive from the moment it was connected (Meta does not share older history). {stored.whatsapp ? <><b style={{ color: INK }}>{stored.whatsapp.messages.toLocaleString()}</b> so far.</> : 'None yet.'}</> : <>Connect your WhatsApp Business number in <Link to="/settings?tab=whatsapp" style={{ color: ACCENT, fontWeight: 700 }}>Settings</Link>. Customer messages collect from then on.</>}</p>
          {importBtn('whatsapp', 'Import WhatsApp questions', Boolean(stored.whatsapp))}
        </Card>
      </div>
      {err && <div style={{ color: '#B91C1C', fontSize: 13 }}>{err}</div>}

      <div style={panel}>
        <div style={{ ...caps, padding: '14px 18px', borderBottom: `1px solid ${LINE}` }}>Imports</div>
        {!imports.data?.imports.length && <div style={{ padding: 24, color: MUTED, fontSize: 13.5 }}>Nothing imported yet.</div>}
        {imports.data?.imports.map((i) => {
          const pct = i.progress.total ? Math.round((i.progress.done / i.progress.total) * 100) : 0
          return (
            <div key={i._id} style={{ padding: '14px 18px', borderBottom: `1px solid ${LINE}` }}>
              <div className="flex flex-wrap items-center gap-2">
                <span style={{ fontWeight: 700, color: INK }}>{i.label}</span><Pill status={i.status} />
                <span style={{ fontSize: 12, color: MUTED, marginLeft: 'auto' }}>{i.startedBy?.name} · {when(i.createdAt)}</span>
              </div>
              {i.status === 'running' && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12.5, color: MUTED }}>{STAGE[i.stage] ?? i.stage}{i.stage === 'clustering' ? ` · ${i.progress.done} of ${i.progress.total}` : ''}</div>
                  <div style={{ height: 6, borderRadius: 99, background: '#ECE8F5', marginTop: 5, overflow: 'hidden' }}><div style={{ width: `${i.stage === 'suggesting' ? 100 : pct}%`, height: '100%', background: ACCENT }} /></div>
                </div>
              )}
              {i.counts?.turns != null && (
                <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>
                  {i.counts.messages != null && <span><b style={{ color: INK }}>{i.counts.messages.toLocaleString()}</b> messages read</span>}
                  <span><b style={{ color: INK }}>{i.counts.turns}</b> questions</span>
                  {i.counts.skipped != null && <span><b style={{ color: INK }}>{i.counts.skipped}</b> not needing an answer</span>}
                  {i.counts.newIntents != null && <span><b style={{ color: INK }}>{i.counts.newIntents}</b> new common questions</span>}
                  {i.counts.holdout != null && <span><b style={{ color: INK }}>{i.counts.holdout}</b> kept aside for testing</span>}
                </div>
              )}
              {(i.problems?.length ?? 0) > 0 && <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 4 }}>{i.problems!.slice(0, 3).join(' · ')}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Upload, MessageCircle } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { type Me, INK, MUTED, PURPLE, LINE, btn, panel, caps, field, when } from './theme'
import { Pill } from './shared'

type Imp = {
  _id: string; source: string; label: string; status: string; stage: string; createdAt: string; finishedAt?: string
  progress: { done: number; total: number }; problems?: string[]; startedBy?: { name: string }
  counts?: { messages?: number; turns?: number; questions?: number; skipped?: number; intents?: number; newIntents?: number; holdout?: number }
}

const STAGE: Record<string, string> = { reading: 'Reading conversations', clustering: 'Grouping questions', suggesting: 'Writing suggested answers', done: 'Done', failed: 'Failed' }

export default function Imports({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [limit, setLimit] = useState(500)
  const [days, setDays] = useState(60)
  const [per, setPer] = useState(3)
  const [err, setErr] = useState('')
  const { data } = useQuery<{ imports: Imp[] }>({
    queryKey: ['training-imports'], queryFn: () => api.get('/training/imports').then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.imports.some((i) => i.status === 'running') ? 3000 : false),
  })
  const done = () => { setErr(''); qc.invalidateQueries({ queryKey: ['training-imports'] }) }
  const start = useMutation({ mutationFn: () => api.post('/training/imports', { source: 'whatsapp', limit, days, perConversation: per }), onSuccess: done, onError: (e) => setErr(apiError(e)) })
  const upload = useMutation({
    mutationFn: (f: File) => { const fd = new FormData(); fd.append('file', f); fd.append('limit', String(limit)); return api.post('/training/imports/upload', fd) },
    onSuccess: done, onError: (e) => setErr(apiError(e)),
  })
  const running = data?.imports.some((i) => i.status === 'running')
  const can = me.permissions.includes('import')

  const sample = () => {
    const csv = 'conversation,from,text,at\nc1,customer,"Hi, how much is a 50 sqft unit?",2026-10-01T10:00:00Z\nc1,agent,"Hello! A 50 sqft unit is...",2026-10-01T10:04:00Z\n'
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'conversations-template.csv'; a.click()
  }

  return (
    <div className="space-y-4">
      {can && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div style={{ ...panel, padding: 18 }}>
            <div className="flex items-center gap-2" style={{ fontWeight: 800, color: INK }}><MessageCircle size={16} style={{ color: PURPLE }} /> From WhatsApp</div>
            <p style={{ fontSize: 13, color: MUTED, margin: '4px 0 12px' }}>Recent customer chats from the CRM. A few questions per person, so they come from many different people. Phone numbers, emails and IDs are masked before anything is stored.</p>
            <div className="grid grid-cols-3 gap-3">
              <label style={{ fontSize: 12, color: MUTED }}>Questions<input type="number" min={50} max={5000} step={50} value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ ...field, marginTop: 4 }} /></label>
              <label style={{ fontSize: 12, color: MUTED }}>From the last … days<input type="number" min={7} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ ...field, marginTop: 4 }} /></label>
              <label style={{ fontSize: 12, color: MUTED }}>Per person, at most<input type="number" min={1} max={10} value={per} onChange={(e) => setPer(Number(e.target.value))} style={{ ...field, marginTop: 4 }} /></label>
            </div>
            <button type="button" style={{ ...btn(true), marginTop: 12 }} disabled={running || start.isPending} onClick={() => start.mutate()}>Import {limit} questions</button>
          </div>
          <div style={{ ...panel, padding: 18 }}>
            <div className="flex items-center gap-2" style={{ fontWeight: 800, color: INK }}><Upload size={16} style={{ color: PURPLE }} /> From a file</div>
            <p style={{ fontSize: 13, color: MUTED, margin: '4px 0 12px' }}>CSV or JSON from any chat tool, CRM or helpdesk. Columns: <code>conversation</code>, <code>from</code> (customer or agent), <code>text</code>, <code>at</code>.</p>
            <div className="flex flex-wrap gap-2">
              <label style={{ ...btn(true), opacity: running ? 0.5 : 1 }}>
                <Upload size={14} /> Choose file
                <input type="file" accept=".csv,.json,text/csv,application/json" hidden disabled={running} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = '' }} />
              </label>
              <button type="button" style={btn()} onClick={sample}><Download size={14} /> Template</button>
            </div>
          </div>
        </div>
      )}
      {err && <div style={{ color: '#B91C1C', fontSize: 13 }}>{err}</div>}

      <div style={panel}>
        <div style={{ ...caps, padding: '14px 18px', borderBottom: `1px solid ${LINE}` }}>Imports</div>
        {!data?.imports.length && <div style={{ padding: 24, color: MUTED, fontSize: 13.5 }}>Nothing imported yet.</div>}
        {data?.imports.map((i) => {
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
                  <div style={{ height: 6, borderRadius: 99, background: '#ECE8F5', marginTop: 5, overflow: 'hidden' }}><div style={{ width: `${i.stage === 'suggesting' ? 100 : pct}%`, height: '100%', background: PURPLE }} /></div>
                </div>
              )}
              {i.counts?.turns != null && (
                <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 12.5, color: MUTED, marginTop: 6 }}>
                  {i.counts.messages != null && <span><b style={{ color: INK }}>{i.counts.messages.toLocaleString()}</b> messages read</span>}
                  <span><b style={{ color: INK }}>{i.counts.turns}</b> questions</span>
                  {i.counts.skipped != null && <span><b style={{ color: INK }}>{i.counts.skipped}</b> not needing an answer</span>}
                  {i.counts.newIntents != null && <span><b style={{ color: INK }}>{i.counts.newIntents}</b> new intents</span>}
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

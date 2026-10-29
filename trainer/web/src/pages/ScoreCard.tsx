import { ShieldAlert } from 'lucide-react'
import { INK, MUTED, LINE } from './theme'
import { Pill } from './shared'
import { type Grade, type PlaybookResp, labelOf, scoreTone } from './sales'

/* One reply's scorecard: pass or fail, the weighted score, each measure, and
   every automatic fail. */

export function Score({ g, pb }: { g: Grade; pb?: PlaybookResp }) {
  const p = pb?.playbook
  return (
    <div style={{ background: '#F8FAFC', border: `1px solid ${LINE}`, borderRadius: 12, padding: 10, marginTop: 8, fontSize: 12 }}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill status={g.pass ? 'approved' : 'rejected'}>{g.pass ? 'Pass' : 'Fail'}</Pill>
        <Pill status={scoreTone(g.score, p?.passMark)}>{g.score ?? '—'}/100</Pill>
        {!g.nbaOk && <Pill status="suggested">Action not expected</Pill>}
        {!g.escalationOk && <Pill status="rejected">Should hand over</Pill>}
        {g.autoFails.map((k) => <span key={k} className="inline-flex items-center gap-1" style={{ color: '#B91C1C', fontWeight: 600 }}><ShieldAlert size={12} /> {labelOf(p?.autoFails, k)}</span>)}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4" style={{ marginTop: 6 }}>
        {p?.rubric.map((r) => <div key={r.key} className="flex justify-between" style={{ color: MUTED }}><span>{r.label} <span style={{ opacity: 0.6 }}>{r.weight}%</span></span><b style={{ color: (g.scores[r.key] ?? 0) >= 80 ? INK : '#B45309' }}>{g.scores[r.key] ?? '—'}</b></div>)}
      </div>
      {g.note && <div style={{ color: MUTED, marginTop: 5 }}>{g.note}</div>}
      <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 4 }}>Scores are a model's estimate; automatic fails for invented figures, discounts and missed hand-overs are checked by code.</div>
    </div>
  )
}


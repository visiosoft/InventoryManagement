import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, apiError } from '../lib/api'

/**
 * Changes waiting for a second person, and the rules that hold them. Rules
 * start switched off (thresholds to be confirmed by the owner); turning one
 * on is logged and versioned.
 */

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.08)'
const HEAD = "'Bricolage Grotesque', sans-serif"

type Req = { _id: string; entityId: string; entityLabel: string; requestedByName: string; ruleLabel: string; proposed: Record<string, unknown>; old: Record<string, unknown>; reason: string; createdAt: string }
type Rule = { _id: string; label: string; action: string; operator: string; threshold: number; active: boolean; provisional: boolean; version: number }

const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : String(v))

export default function ChangeApprovals() {
  const qc = useQueryClient()
  const [err, setErr] = useState('')
  const reqs = useQuery<{ requests: Req[] }>({ queryKey: ['approvals'], queryFn: () => api.get('/approvals').then((r) => r.data) })
  const rules = useQuery<{ rules: Rule[] }>({ queryKey: ['approval-rules'], queryFn: () => api.get('/approvals/rules').then((r) => r.data) })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['approvals'] }); qc.invalidateQueries({ queryKey: ['approval-rules'] }) }
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); refresh() } catch (e) { setErr(apiError(e)) } }

  return (
    <div style={{ maxWidth: 1000, margin: '32px auto 0' }} className="space-y-6">
      <div>
        <h2 style={{ fontFamily: HEAD, fontSize: 20, fontWeight: 800, color: INK, margin: 0 }}>Change approvals</h2>
        <div style={{ fontSize: 13, color: MUTED }}>Price, discount and date changes that need a second person. You cannot approve your own.</div>
      </div>
      {err && <div style={{ color: '#B91C1C', fontSize: 13 }}>{err}</div>}

      <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '14px 16px' }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15 }}>Waiting</div>
        {(reqs.data?.requests ?? []).map((r) => (
          <div key={r._id} style={{ borderTop: `1px solid ${LINE}`, padding: '10px 0' }}>
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/contracts/${r.entityId}`} style={{ fontWeight: 700, color: PURPLE }}>{r.entityLabel}</Link>
              <span style={{ fontSize: 12.5, color: MUTED }} className="mr-auto">{r.ruleLabel} · asked by {r.requestedByName} · {r.createdAt.slice(0, 10)}</span>
              <button type="button" onClick={() => act(() => api.post(`/approvals/${r._id}/approve`, { note: '' }))} style={{ fontSize: 12.5, fontWeight: 700, border: 0, borderRadius: 8, padding: '6px 12px', background: PURPLE, color: '#fff', cursor: 'pointer' }}>Approve</button>
              <button type="button" onClick={() => { const note = window.prompt('Why is it rejected?'); if (note?.trim()) act(() => api.post(`/approvals/${r._id}/reject`, { note })) }} style={{ fontSize: 12.5, fontWeight: 700, border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 12px', background: '#fff', color: '#B91C1C', cursor: 'pointer' }}>Reject</button>
            </div>
            <div style={{ fontSize: 12.5, color: '#4A4357', marginTop: 4 }}>
              {Object.keys(r.proposed).filter((k) => !['approvalReason', 'endDateReason'].includes(k)).map((k) => <span key={k} style={{ marginRight: 14 }}>{k}: {show(r.old[k])} → <b>{show(r.proposed[k])}</b></span>)}
              {r.reason && <div>Reason: {r.reason}</div>}
            </div>
          </div>
        ))}
        {!reqs.data?.requests.length && <div style={{ fontSize: 13, color: MUTED, paddingTop: 6 }}>Nothing waiting.</div>}
      </section>

      <section style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '14px 16px' }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15 }}>Rules</div>
        <div style={{ fontSize: 12.5, color: MUTED, marginBottom: 6 }}>Loaded from the spec as provisional and switched off. Confirm the thresholds, then switch on.</div>
        {(rules.data?.rules ?? []).map((r) => (
          <div key={r._id} className="flex flex-wrap items-center gap-3" style={{ borderTop: `1px solid ${LINE}`, padding: '8px 0' }}>
            <label className="inline-flex items-center gap-2 mr-auto" style={{ fontSize: 13.5, color: INK }}>
              <input type="checkbox" checked={r.active} onChange={() => act(() => api.put(`/approvals/rules/${r._id}`, { active: !r.active }))} />
              {r.label}{r.provisional && <span style={{ fontSize: 11, color: '#8A5A00' }}>provisional</span>}
            </label>
            {r.operator === 'gt' && (
              <label style={{ fontSize: 12.5, color: MUTED }}>Above <input type="number" defaultValue={r.threshold} onBlur={(e) => Number(e.target.value) !== r.threshold && act(() => api.put(`/approvals/rules/${r._id}`, { threshold: Number(e.target.value) }))} style={{ width: 64, height: 28, border: `1px solid ${LINE}`, borderRadius: 6, padding: '0 6px' }} /> {r.action === 'checkout_change' ? 'days' : '%'}</label>
            )}
            <span style={{ fontSize: 11.5, color: MUTED }}>v{r.version}</span>
          </div>
        ))}
      </section>
    </div>
  )
}

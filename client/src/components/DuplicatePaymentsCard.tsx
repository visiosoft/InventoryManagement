import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'

/**
 * Unpaid payment rows by age, and duplicate rows (same contract, amount and
 * due day) for finance to review. Nothing changes until finance ticks groups,
 * gives a reason and confirms; the extra rows are then marked voided, never
 * deleted, and the oldest row in each group is kept.
 */

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.08)'
const HEAD = "'Bricolage Grotesque', sans-serif"
const aed = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Group = { key: string; contract: string; contractNo: string; customer: string; amount: number; dueDay: string; rows: number; extraIds: string[]; extraTotal: number }
type Dups = { groups: Group[]; totals: { groups: number; extraRows: number; extraTotal: number } }
type Aging = { buckets: Record<string, { rows: number; total: number }>; duplicate: { rows: number; total: number }; overdueExcludingDuplicates: number; overdueMaximum: number }

const ORDER = ['current', '1-30', '31-60', '61-90', '91-120', 'over 120', 'upcoming']

export default function DuplicatePaymentsCard() {
  const qc = useQueryClient()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const aging = useQuery<Aging>({ queryKey: ['payments-aging'], queryFn: () => api.get('/payments/aging').then((r) => r.data), staleTime: 60_000 })
  const dups = useQuery<Dups>({ queryKey: ['payments-duplicates'], queryFn: () => api.get('/payments/duplicates').then((r) => r.data), staleTime: 60_000 })

  const groups = dups.data?.groups ?? []
  const chosen = groups.filter((g) => picked.has(g.key))
  const chosenRows = chosen.reduce((n, g) => n + g.extraIds.length, 0)
  const chosenTotal = chosen.reduce((n, g) => n + g.extraTotal, 0)
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  async function voidChosen() {
    if (!chosen.length || reason.trim().length < 3) return
    if (!window.confirm(`Void ${chosenRows} duplicate row${chosenRows === 1 ? '' : 's'} (${aed(chosenTotal)}) in ${chosen.length} group${chosen.length === 1 ? '' : 's'}? The oldest row in each group is kept; nothing is deleted.`)) return
    setBusy(true); setMsg(null)
    try {
      const { data } = await api.post('/payments/duplicates/void', { keys: chosen.map((g) => g.key), reason: reason.trim() })
      setMsg({ ok: true, text: `${data.voided} row${data.voided === 1 ? '' : 's'} voided in ${data.groups} group${data.groups === 1 ? '' : 's'}.` })
      setPicked(new Set()); setReason('')
      qc.invalidateQueries({ queryKey: ['payments-duplicates'] })
      qc.invalidateQueries({ queryKey: ['payments-aging'] })
    } catch (e) { setMsg({ ok: false, text: apiError(e) }) } finally { setBusy(false) }
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px' }} aria-label="Receivables check">
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: INK }}>Receivables — age and duplicates</div>
      <div style={{ fontSize: 12.5, color: MUTED }}>Unpaid rows in the CRM. Duplicates are rows with the same contract, amount and due day.</div>

      {aging.data && (
        <>
          <div className="flex flex-wrap gap-6" style={{ marginTop: 12 }}>
            <div><div style={{ fontSize: 11, color: MUTED, fontWeight: 700, textTransform: 'uppercase' }}>Overdue, duplicates removed</div><div style={{ fontFamily: HEAD, fontSize: 22, fontWeight: 800, color: INK }}>{aed(aging.data.overdueExcludingDuplicates)}</div></div>
            <div><div style={{ fontSize: 11, color: MUTED, fontWeight: 700, textTransform: 'uppercase' }}>Overdue, all rows</div><div style={{ fontFamily: HEAD, fontSize: 22, fontWeight: 800, color: MUTED }}>{aed(aging.data.overdueMaximum)}</div></div>
          </div>
          <div className="flex flex-wrap gap-1.5" style={{ marginTop: 10 }}>
            {ORDER.map((b) => aging.data!.buckets[b]?.rows ? (
              <span key={b} style={{ fontSize: 12, borderRadius: 999, padding: '3px 10px', background: b === 'over 120' ? '#FEE2E2' : '#F4F2F7', color: b === 'over 120' ? '#B91C1C' : INK }}>
                {b === 'upcoming' ? 'Not due yet' : b === 'current' ? 'Due today' : `${b} days`}: {aging.data!.buckets[b].rows} · {aed(aging.data!.buckets[b].total)}
              </span>
            ) : null)}
          </div>
        </>
      )}

      {dups.error && <div style={{ fontSize: 12.5, color: '#B91C1C', marginTop: 10 }}>{apiError(dups.error)}</div>}
      {dups.data && (
        <div style={{ marginTop: 14 }}>
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ fontSize: 13, fontWeight: 700, color: INK }} className="mr-auto">
              {dups.data.totals.groups ? `${dups.data.totals.extraRows} duplicate rows in ${dups.data.totals.groups} groups · ${aed(dups.data.totals.extraTotal)}` : 'No duplicate rows.'}
            </span>
            {groups.length > 0 && (
              <button type="button" onClick={() => setPicked(picked.size === groups.length ? new Set() : new Set(groups.map((g) => g.key)))}
                style={{ fontSize: 12, fontWeight: 700, color: PURPLE, background: 'none', border: 0, cursor: 'pointer' }}>
                {picked.size === groups.length ? 'Clear' : 'Select all'}
              </button>
            )}
          </div>
          {groups.length > 0 && (
            <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 8, border: `1px solid ${LINE}`, borderRadius: 10 }}>
              <table className="w-full" style={{ fontSize: 12.5, borderCollapse: 'collapse' }}>
                <thead><tr style={{ color: MUTED, textAlign: 'left' }}><th style={{ padding: '6px 8px', width: 28 }} /><th>Contract</th><th>Due</th><th>Amount</th><th>Rows</th><th>Extra</th></tr></thead>
                <tbody>
                  {groups.slice(0, 400).map((g) => (
                    <tr key={g.key} style={{ borderTop: `1px solid ${LINE}` }}>
                      <td style={{ padding: '5px 8px' }}><input type="checkbox" checked={picked.has(g.key)} onChange={() => toggle(g.key)} aria-label={`Select ${g.contractNo || g.contract} ${g.dueDay}`} /></td>
                      <td>{g.contractNo || '—'}<span style={{ color: MUTED }}>{g.customer ? ` · ${g.customer}` : ''}</span></td>
                      <td>{g.dueDay}</td>
                      <td>{aed(g.amount)}</td>
                      <td>{g.rows}</td>
                      <td style={{ color: '#B91C1C' }}>{aed(g.extraTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {chosen.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 10 }}>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. duplicate schedule rows from import" aria-label="Reason"
                style={{ flex: 1, minWidth: 220, height: 34, border: `1px solid ${LINE}`, borderRadius: 8, padding: '0 10px', fontSize: 13 }} />
              <button type="button" disabled={busy || reason.trim().length < 3} onClick={voidChosen}
                style={{ fontSize: 12.5, fontWeight: 700, border: 0, borderRadius: 8, padding: '8px 12px', background: PURPLE, color: '#fff', cursor: 'pointer', opacity: busy || reason.trim().length < 3 ? 0.5 : 1 }}>
                Void {chosenRows} row{chosenRows === 1 ? '' : 's'} · {aed(chosenTotal)}
              </button>
            </div>
          )}
          {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg.ok ? '#15803D' : '#B91C1C' }}>{msg.text}</div>}
        </div>
      )}
    </div>
  )
}

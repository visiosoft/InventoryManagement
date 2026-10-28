import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'

/**
 * Payments taken in Zoho Books, brought into the CRM. Preview first — it
 * only reads. Exact matches (same invoice) are applied; suggested matches
 * (same customer, amount and date) only when ticked; anything else is listed
 * for finance and left alone.
 */

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.08)'
const HEAD = "'Bricolage Grotesque', sans-serif"
const aed = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Item = { zohoPaymentId: string; date: string; amount: number; method: string; invoice?: string; invoiceNumbers: string; customer?: string; rowIds?: string[]; settles?: number; unallocated?: number; reason?: string }
type Preview = { configured: boolean; error?: string; apply: Item[]; suggestions: Item[]; exceptions: Item[]; totals: { payments: number; toApply: number; suggestions: number; rows: number; amount: number; exceptions: number; alreadyApplied: number } }

export default function ZohoPaymentSyncCard() {
  const qc = useQueryClient()
  const [since, setSince] = useState('2026-08-01')
  const [data, setData] = useState<Preview | null>(null)
  const [accept, setAccept] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [showEx, setShowEx] = useState(false)

  async function preview() {
    setBusy(true); setMsg(null); setData(null); setAccept(new Set())
    try { setData((await api.get('/payments/zoho-sync/preview', { params: { since } })).data) } catch (e) { setMsg({ ok: false, text: apiError(e) }) } finally { setBusy(false) }
  }
  async function apply() {
    if (!data) return
    const n = data.apply.length + accept.size
    if (!n || !window.confirm(`Record ${n} Zoho payment${n === 1 ? '' : 's'} against their CRM rows? Only the rows listed are marked paid.`)) return
    setBusy(true)
    try {
      const { data: out } = await api.post('/payments/zoho-sync/apply', { since, confirm: true, accept: [...accept] })
      setMsg({ ok: true, text: `${out.applied} payments recorded, ${out.rows} rows marked paid. ${out.exceptions.length} left for finance.` })
      setData(null)
      ;['payments-aging', 'payments-duplicates', 'data-quality'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
    } catch (e) { setMsg({ ok: false, text: apiError(e) }) } finally { setBusy(false) }
  }

  const row = (i: Item, tick?: boolean) => (
    <tr key={i.zohoPaymentId} style={{ borderTop: `1px solid ${LINE}` }}>
      {tick !== undefined && <td style={{ padding: '5px 8px' }}><input type="checkbox" checked={accept.has(i.zohoPaymentId)} aria-label={`Accept ${i.invoiceNumbers}`}
        onChange={() => setAccept((s) => { const n = new Set(s); if (n.has(i.zohoPaymentId)) n.delete(i.zohoPaymentId); else n.add(i.zohoPaymentId); return n })} /></td>}
      <td style={{ padding: '5px 8px' }}>{i.date}</td>
      <td>{i.invoiceNumbers || '—'}</td>
      <td>{i.invoice || '—'}{i.customer ? <span style={{ color: MUTED }}> · {i.customer}</span> : null}</td>
      <td>{aed(i.amount)}</td>
      <td style={{ color: MUTED }}>{i.reason || (i.unallocated ? `${aed(i.unallocated)} not allocated` : `${i.rowIds?.length} row${i.rowIds?.length === 1 ? '' : 's'}`)}</td>
    </tr>
  )
  const table = (items: Item[], tick?: boolean) => (
    <div style={{ maxHeight: 260, overflowY: 'auto', border: `1px solid ${LINE}`, borderRadius: 10, marginTop: 6 }}>
      <table className="w-full" style={{ fontSize: 12.5, borderCollapse: 'collapse' }}>
        <thead><tr style={{ color: MUTED, textAlign: 'left' }}>{tick !== undefined && <th style={{ width: 28 }} />}<th style={{ padding: '6px 8px' }}>Paid</th><th>Zoho invoice</th><th>CRM invoice</th><th>Amount</th><th /></tr></thead>
        <tbody>{items.slice(0, 300).map((i) => row(i, tick))}</tbody>
      </table>
    </div>
  )

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px' }} aria-label="Zoho payments">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: INK }}>Payments from Zoho Books</div>
          <div style={{ fontSize: 12.5, color: MUTED }}>Bring payments taken in Zoho into the CRM. Preview only reads; nothing changes until you apply.</div>
        </div>
        <label style={{ fontSize: 12.5, color: MUTED }}>Since <input type="date" value={since} onChange={(e) => setSince(e.target.value)} style={{ height: 32, border: `1px solid ${LINE}`, borderRadius: 8, padding: '0 8px' }} /></label>
        <button type="button" onClick={preview} disabled={busy} style={{ fontSize: 12.5, fontWeight: 700, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 9, padding: '7px 12px', cursor: 'pointer' }}>{busy && !data ? 'Reading Zoho…' : 'Preview'}</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, marginTop: 8, color: msg.ok ? '#15803D' : '#B91C1C' }}>{msg.text}</div>}
      {data && !data.configured && <div style={{ fontSize: 12.5, marginTop: 8, color: '#B91C1C' }}>{data.error}</div>}
      {data?.configured && (
        <div style={{ marginTop: 12, fontSize: 13, color: INK }}>
          <div>{data.totals.payments} Zoho payments since {since}: <b>{data.totals.toApply}</b> match exactly, <b>{data.totals.suggestions}</b> suggested, <b>{data.totals.exceptions}</b> need finance, {data.totals.alreadyApplied} already in the CRM.</div>
          {data.apply.length > 0 && <><div style={{ fontWeight: 700, marginTop: 10 }}>Exact matches — applied</div>{table(data.apply)}</>}
          {data.suggestions.length > 0 && <><div style={{ fontWeight: 700, marginTop: 10 }}>Suggested — same customer, amount and date. Tick the right ones.</div>{table(data.suggestions, true)}</>}
          {data.exceptions.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button type="button" onClick={() => setShowEx((v) => !v)} style={{ fontWeight: 700, color: PURPLE, background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>{showEx ? 'Hide' : 'Show'} {data.exceptions.length} for finance</button>
              {showEx && table(data.exceptions)}
            </div>
          )}
          <button type="button" onClick={apply} disabled={busy || !(data.apply.length + accept.size)}
            style={{ marginTop: 12, fontSize: 12.5, fontWeight: 700, border: 0, borderRadius: 8, padding: '8px 14px', background: PURPLE, color: '#fff', cursor: 'pointer', opacity: busy || !(data.apply.length + accept.size) ? 0.5 : 1 }}>
            Record {data.apply.length + accept.size} payment{data.apply.length + accept.size === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </div>
  )
}

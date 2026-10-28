import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, apiError } from '../lib/api'

/**
 * Collections: who owes, how late, at what stage, and what was agreed.
 * A promise to pay pauses reminders until its date, then is checked
 * automatically; a broken one escalates with a task for finance.
 */

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.08)'
const HEAD = "'Bricolage Grotesque', sans-serif"
const aed = (n: number) => `AED ${n.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type Account = {
  contractId: string; contractNo: string; customer: string; phone: string; unit: string; owed: number; rows: number; daysLate: number; stage: string; disputed: boolean
  promise: { amount: number; promisedDate: string } | null; lastContact: { at: string; channel: string; note: string; by: string } | null
}
const STAGE: Record<string, { text: string; bg: string; fg: string }> = {
  current: { text: 'Current', bg: '#F3F4F6', fg: '#4B5563' }, due: { text: 'Due today', bg: '#E8F0FC', fg: '#1E4E99' },
  reminder_1: { text: 'Reminder 1', bg: '#FEF3C7', fg: '#8A5A00' }, reminder_2: { text: 'Reminder 2', bg: '#FFEDD5', fg: '#C2410C' },
  promise_to_pay: { text: 'Promised', bg: '#DCFCE7', fg: '#15803D' }, payment_plan: { text: 'Payment plan', bg: '#DCFCE7', fg: '#15803D' },
  escalated: { text: 'Escalated', bg: '#FEE2E2', fg: '#B91C1C' }, written_off: { text: 'Written off', bg: '#F3F4F6', fg: '#4B5563' },
}

export default function Collections() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery<{ accounts: Account[]; byStage: Record<string, number>; totalOwed: number; note: string }>({ queryKey: ['collections'], queryFn: () => api.get('/collections').then((r) => r.data) })
  const list = (data?.accounts ?? []).filter((a) => !filter || a.stage === filter)
  const refresh = () => qc.invalidateQueries({ queryKey: ['collections'] })

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontFamily: HEAD, fontSize: 24, fontWeight: 800, color: INK, margin: 0 }}>Collections</h1>
      <div style={{ fontSize: 13, color: MUTED }}>{data ? `${data.accounts.length} accounts owe ${aed(data.totalOwed)}. ${data.note}` : 'Loading…'}</div>
      {error && <div style={{ color: '#B91C1C', fontSize: 13 }}>{apiError(error)}</div>}
      {data && (
        <div className="flex flex-wrap gap-1.5" style={{ margin: '12px 0' }}>
          <button type="button" onClick={() => setFilter('')} style={chip(filter === '')}>All</button>
          {Object.entries(data.byStage).map(([k, n]) => <button key={k} type="button" onClick={() => setFilter(k)} style={chip(filter === k)}>{STAGE[k]?.text || k} · {n}</button>)}
        </div>
      )}
      {isLoading ? null : (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden' }}>
          {list.map((a) => (
            <div key={a.contractId} style={{ borderTop: `1px solid ${LINE}`, padding: '10px 14px' }}>
              <div className="flex flex-wrap items-center gap-3">
                <Link to={`/contracts/${a.contractId}`} style={{ fontWeight: 700, color: INK, minWidth: 180 }}>{a.customer || a.contractNo}<span style={{ fontWeight: 400, color: MUTED }}> · {a.unit}</span></Link>
                <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '2px 9px', background: STAGE[a.stage]?.bg, color: STAGE[a.stage]?.fg }}>{STAGE[a.stage]?.text || a.stage}</span>
                {a.disputed && <span style={{ fontSize: 11.5, fontWeight: 700, borderRadius: 999, padding: '2px 9px', background: '#FEE2E2', color: '#B91C1C' }}>Disputed</span>}
                <span className="mr-auto" style={{ fontSize: 12.5, color: MUTED }}>{a.promise ? `Promised ${aed(a.promise.amount)} by ${a.promise.promisedDate.slice(0, 10)}` : a.lastContact ? `Last: ${a.lastContact.channel} ${a.lastContact.at.slice(0, 10)} — ${a.lastContact.note}` : ''}</span>
                <span style={{ fontWeight: 800, color: INK }}>{aed(a.owed)}</span>
                <span style={{ fontSize: 12.5, color: a.daysLate > 30 ? '#B91C1C' : MUTED, minWidth: 70, textAlign: 'right' }}>{a.daysLate ? `${a.daysLate} d late` : 'due'}</span>
                <button type="button" onClick={() => setOpen(open === a.contractId ? null : a.contractId)} style={{ fontSize: 12, fontWeight: 700, color: PURPLE, background: 'none', border: 0, cursor: 'pointer' }}>{open === a.contractId ? 'Close' : 'Act'}</button>
              </div>
              {open === a.contractId && <Actions a={a} onDone={() => { setOpen(null); refresh() }} />}
            </div>
          ))}
          {!list.length && <div style={{ padding: 16, fontSize: 13, color: MUTED }}>Nobody here.</div>}
        </div>
      )}
    </div>
  )
}

const chip = (on: boolean): React.CSSProperties => ({ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '4px 11px', cursor: 'pointer', border: `1px solid ${on ? PURPLE : LINE}`, background: on ? '#F3EEFF' : '#fff', color: on ? PURPLE : INK })
const field: React.CSSProperties = { height: 32, border: `1px solid ${LINE}`, borderRadius: 8, padding: '0 8px', fontSize: 13, background: '#fff' }
const btn: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, border: 0, borderRadius: 8, padding: '7px 12px', background: PURPLE, color: '#fff', cursor: 'pointer' }

function Actions({ a, onDone }: { a: Account; onDone: () => void }) {
  const [amount, setAmount] = useState(String(a.owed))
  const [date, setDate] = useState('')
  const [channel, setChannel] = useState('call')
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const run = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); onDone() } catch (e) { setErr(apiError(e)) } }
  const base = `/collections/${a.contractId}`
  return (
    <div className="space-y-2" style={{ marginTop: 10, background: '#FBFAFD', borderRadius: 12, padding: 12 }}>
      <div className="flex flex-wrap items-center gap-2">
        <select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel" style={field}>
          {['call', 'whatsapp', 'email', 'in_person'].map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was said" aria-label="Note" style={{ ...field, flex: 1, minWidth: 200 }} />
        <button type="button" style={{ ...btn, background: '#fff', color: PURPLE, border: `1px solid ${LINE}` }} onClick={() => run(() => api.post(`${base}/contact`, { channel, note }))}>Log contact</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span style={{ fontSize: 12.5, color: MUTED }}>Promise to pay</span>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" style={{ ...field, width: 120 }} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Promised date" style={field} />
        <button type="button" style={btn} disabled={!date} onClick={() => run(() => api.post(`${base}/promise`, { amount: Number(amount), promisedDate: date, channel, note }))}>Record promise</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" style={{ ...btn, background: '#fff', color: INK, border: `1px solid ${LINE}` }} onClick={() => run(() => api.post(`${base}/stage`, { state: 'payment_plan', note }))}>Payment plan</button>
        <button type="button" style={{ ...btn, background: '#fff', color: '#B91C1C', border: `1px solid ${LINE}` }} onClick={() => run(() => api.post(`${base}/stage`, { state: 'escalated', note }))}>Escalate</button>
        <button type="button" style={{ ...btn, background: '#fff', color: INK, border: `1px solid ${LINE}` }} onClick={() => run(() => api.post(`${base}/dispute`, { disputed: !a.disputed, note }))}>{a.disputed ? 'Dispute settled' : 'Mark disputed'}</button>
        <button type="button" style={{ ...btn, background: '#fff', color: MUTED, border: `1px solid ${LINE}` }} onClick={() => { if (window.confirm('Write this balance off? A reason in the note is required.')) run(() => api.post(`${base}/stage`, { state: 'written_off', note })) }}>Write off</button>
        <button type="button" style={{ ...btn, background: '#fff', color: MUTED, border: `1px solid ${LINE}` }} onClick={() => run(() => api.post(`${base}/stage`, { state: '', note: note || 'Back to automatic stage' }))}>Clear stage</button>
      </div>
      {err && <div style={{ color: '#B91C1C', fontSize: 12.5 }}>{err}</div>}
      <div style={{ fontSize: 11.5, color: MUTED }}>Reminders pause while a promise is open or the balance is disputed.</div>
    </div>
  )
}

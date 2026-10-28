import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'

/**
 * Maintenance tickets: why each unit is out of use, who is on it and by when.
 * A board by status; a new-ticket form that suggests a severity for the user
 * to confirm; for admins, a one-time backfill for units already in
 * maintenance with no ticket (previewed first, run only on confirm).
 */

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.08)'
const HEAD = "'Bricolage Grotesque', sans-serif"

type Ticket = {
  _id: string; ticketNo: string; status: string; severity: string; category: string; description: string
  units: { _id: string; unitNumber: string; sizeSqf: number }[]; owner?: { name: string } | null; vendor?: { name: string } | null
  resolveDueAt?: string; createdAt: string; sla: string; backfilled?: boolean
}
type Unit = { _id: string; unitNumber: string; sizeSqf: number; status: string }

const COLUMNS = [
  { key: 'open', label: 'Open' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'awaiting_parts', label: 'Awaiting parts' },
  { key: 'resolved', label: 'Resolved' },
]
const NEXT: Record<string, { to: string; label: string }[]> = {
  open: [{ to: 'in_progress', label: 'Start' }],
  assigned: [{ to: 'in_progress', label: 'Start' }],
  in_progress: [{ to: 'awaiting_parts', label: 'Awaiting parts' }, { to: 'resolved', label: 'Resolved' }],
  awaiting_parts: [{ to: 'in_progress', label: 'Parts in' }, { to: 'resolved', label: 'Resolved' }],
  resolved: [{ to: 'closed', label: 'Close' }],
}
const SEV: Record<string, { bg: string; fg: string; text: string }> = {
  S1: { bg: '#FEE2E2', fg: '#B91C1C', text: 'S1 · safety / access' },
  S2: { bg: '#FFEDD5', fg: '#C2410C', text: 'S2 · unusable' },
  S3: { bg: '#FEF3C7', fg: '#8A5A00', text: 'S3 · degraded' },
  S4: { bg: '#F3F4F6', fg: '#4B5563', text: 'S4 · cosmetic' },
}
const SLA: Record<string, { fg: string; text: string }> = {
  on_track: { fg: MUTED, text: 'On track' }, due_soon: { fg: '#B45309', text: 'Due soon' },
  overdue: { fg: '#B91C1C', text: 'Overdue' }, met: { fg: '#15803D', text: 'Met' }, missed: { fg: '#B91C1C', text: 'Missed' },
}
const CATEGORIES = ['general', 'ac', 'access', 'elevator', 'cctv', 'fire', 'cleaning', 'lighting', 'pest', 'inspection', 'incident']

function due(iso?: string) {
  if (!iso) return ''
  const h = Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000)
  if (h < 0) return `${Math.abs(h) < 48 ? `${Math.abs(h)} h` : `${Math.round(Math.abs(h) / 24)} d`} late`
  return `due in ${h < 48 ? `${h} h` : `${Math.round(h / 24)} d`}`
}

export default function Maintenance() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [err, setErr] = useState('')
  const { data, isLoading } = useQuery<{ tickets: Ticket[] }>({ queryKey: ['maintenance'], queryFn: () => api.get('/maintenance-tickets').then((r) => r.data) })
  const backfill = useQuery<{ count: number }>({ queryKey: ['maintenance-backfill'], queryFn: () => api.get('/maintenance-tickets/backfill').then((r) => r.data), enabled: isAdmin })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['maintenance'] }); qc.invalidateQueries({ queryKey: ['maintenance-backfill'] }) }

  async function move(t: Ticket, to: string) {
    const note = to === 'resolved' || to === 'closed' ? window.prompt('What was done? (optional)') ?? '' : ''
    try { await api.patch(`/maintenance-tickets/${t._id}/status`, { status: to, note }); refresh() } catch (e) { setErr(apiError(e)) }
  }
  async function takeIt(t: Ticket) {
    try { await api.post(`/maintenance-tickets/${t._id}/assign`, { owner: user?.id }); refresh() } catch (e) { setErr(apiError(e)) }
  }
  async function runBackfill() {
    if (!window.confirm(`Create one S3 "general" ticket for each of the ${backfill.data?.count} units in maintenance with no ticket? Nothing else changes.`)) return
    try { await api.post('/maintenance-tickets/backfill', { confirm: true }); refresh() } catch (e) { setErr(apiError(e)) }
  }

  const tickets = data?.tickets ?? []
  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div className="flex flex-wrap items-end gap-3" style={{ marginBottom: 16 }}>
        <div className="mr-auto">
          <h1 style={{ fontFamily: HEAD, fontSize: 24, fontWeight: 800, color: INK, margin: 0 }}>Maintenance</h1>
          <div style={{ fontSize: 13, color: MUTED }}>Every unit out of use has a ticket, an owner and a deadline.</div>
        </div>
      </div>
      {isAdmin && (backfill.data?.count ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-3" style={{ background: '#FFF7E6', color: '#7A4B00', borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
          <span className="mr-auto">{backfill.data!.count} units are in maintenance with no ticket, so nobody owns them.</span>
          <button type="button" onClick={runBackfill} style={{ fontSize: 12.5, fontWeight: 700, border: 0, borderRadius: 8, padding: '7px 12px', background: PURPLE, color: '#fff', cursor: 'pointer' }}>Create triage tickets</button>
        </div>
      )}
      <NewTicket onMade={refresh} />
      {err && <div style={{ fontSize: 12.5, color: '#B91C1C', margin: '8px 0' }}>{err}</div>}
      {isLoading ? <div style={{ color: MUTED, fontSize: 13 }}>Loading…</div> : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', marginTop: 14 }}>
          {COLUMNS.map((c) => {
            const list = tickets.filter((t) => t.status === c.key)
            return (
              <div key={c.key} style={{ background: '#F7F5FA', borderRadius: 14, padding: 10, minHeight: 120 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em', margin: '2px 4px 8px' }}>{c.label} · {list.length}</div>
                <div className="space-y-2">
                  {list.map((t) => (
                    <div key={t._id} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 12px' }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontWeight: 800, fontSize: 12.5, color: INK }}>{t.ticketNo}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '1px 8px', background: SEV[t.severity]?.bg, color: SEV[t.severity]?.fg }}>{t.severity}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: SLA[t.sla]?.fg }}>{t.sla === 'met' ? 'Met' : due(t.resolveDueAt)}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: INK, marginTop: 4 }}>{t.units.map((u) => u.unitNumber).join(', ')} <span style={{ fontWeight: 400, color: MUTED }}>· {t.category}</span></div>
                      <div style={{ fontSize: 12.5, color: '#4A4357', marginTop: 2 }}>{t.description}</div>
                      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>{t.owner?.name || t.vendor?.name || 'Nobody yet'}</div>
                      <div className="flex flex-wrap gap-1.5" style={{ marginTop: 6 }}>
                        {!t.owner && t.status === 'open' && <button type="button" onClick={() => takeIt(t)} style={chip}>Take it</button>}
                        {(NEXT[t.status] || []).map((n) => <button key={n.to} type="button" onClick={() => move(t, n.to)} style={chip}>{n.label}</button>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const chip: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 999, padding: '3px 10px', cursor: 'pointer', color: PURPLE }

function NewTicket({ onMade }: { onMade: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Unit[]>([])
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('general')
  const [severity, setSeverity] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const units = useQuery<Unit[]>({ queryKey: ['units-all'], queryFn: () => api.get('/units').then((r) => r.data), enabled: open, staleTime: 5 * 60_000 })
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return (units.data ?? []).filter((u) => u.unitNumber.toLowerCase().includes(s) && !picked.some((p) => p._id === u._id)).slice(0, 8)
  }, [q, units.data, picked])

  async function suggest() {
    if (description.trim().length < 3) return
    const { data } = await api.post('/maintenance-tickets/suggest-severity', { description }).catch(() => ({ data: null }))
    if (data?.severity && !severity) setSeverity(data.severity)
  }
  async function save() {
    setBusy(true); setErr('')
    try {
      await api.post('/maintenance-tickets', { unitIds: picked.map((u) => u._id), description, category, severity })
      setPicked([]); setDescription(''); setSeverity(''); setCategory('general'); setOpen(false); onMade()
    } catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} style={{ fontSize: 13, fontWeight: 700, border: 0, borderRadius: 10, padding: '9px 14px', background: PURPLE, color: '#fff', cursor: 'pointer' }}>New ticket</button>
  const field: React.CSSProperties = { height: 36, border: `1px solid ${LINE}`, borderRadius: 8, padding: '0 10px', fontSize: 13, background: '#fff' }
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14 }}>
      <div className="flex flex-wrap items-center gap-2">
        {picked.map((u) => <span key={u._id} style={{ ...chip, cursor: 'default' }}>{u.unitNumber} <button type="button" aria-label={`Remove ${u.unitNumber}`} onClick={() => setPicked(picked.filter((p) => p._id !== u._id))} style={{ border: 0, background: 'none', cursor: 'pointer', color: MUTED }}>×</button></span>)}
        <div style={{ position: 'relative' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Unit, e.g. F2-10" aria-label="Find unit" style={{ ...field, width: 160 }} />
          {matches.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 10, top: 38, left: 0, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, width: 200, boxShadow: '0 8px 20px rgba(20,8,31,.12)' }}>
              {matches.map((u) => <button key={u._id} type="button" onClick={() => { setPicked([...picked, u]); setQ('') }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 0, background: 'none', cursor: 'pointer', fontSize: 13 }}>{u.unitNumber} · {u.sizeSqf} sq ft · {u.status}</button>)}
            </div>
          )}
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" style={field}>{CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} onBlur={suggest} placeholder="What is wrong?" aria-label="Description"
        style={{ width: '100%', marginTop: 8, minHeight: 60, border: `1px solid ${LINE}`, borderRadius: 8, padding: 10, fontSize: 13 }} />
      <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 8 }}>
        <span style={{ fontSize: 12.5, color: MUTED }}>Severity</span>
        {Object.entries(SEV).map(([k, v]) => (
          <button key={k} type="button" onClick={() => setSeverity(k)} style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: '4px 10px', cursor: 'pointer', border: `1px solid ${severity === k ? v.fg : 'transparent'}`, background: v.bg, color: v.fg }}>{v.text}</button>
        ))}
        <span className="mr-auto" />
        <button type="button" onClick={() => setOpen(false)} style={{ ...chip, color: MUTED }}>Cancel</button>
        <button type="button" disabled={busy || !picked.length || !severity || description.trim().length < 3} onClick={save}
          style={{ fontSize: 12.5, fontWeight: 700, border: 0, borderRadius: 8, padding: '8px 14px', background: PURPLE, color: '#fff', cursor: 'pointer', opacity: busy || !picked.length || !severity || description.trim().length < 3 ? 0.5 : 1 }}>Create ticket</button>
      </div>
      {severity && <div style={{ fontSize: 11.5, color: MUTED, marginTop: 4 }}>S1 and S2 take a unit no one rents out of use until the ticket is resolved.</div>}
      {err && <div style={{ fontSize: 12.5, color: '#B91C1C', marginTop: 6 }}>{err}</div>}
    </div>
  )
}

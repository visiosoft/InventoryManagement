import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'

/**
 * An identity number as the API sends it — last four digits — with, for
 * admins, a way to see it in full: pick a reason, it shows for 30 seconds,
 * and the reveal is logged.
 */

type Props = { value?: string; kind: 'customer' | 'contract'; id: string; field: 'emiratesId' | 'passportNumber' | 'person'; index?: number }
const REASONS: [string, string][] = [['verification', 'Verifying the customer'], ['customer_request', 'Customer asked'], ['legal_request', 'Legal request']]

export default function RevealId({ value, kind, id, field, index }: Props) {
  const { user } = useAuth()
  const [full, setFull] = useState('')
  const [asking, setAsking] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!full) return
    const t = window.setTimeout(() => setFull(''), 30_000)
    return () => window.clearTimeout(t)
  }, [full])
  if (!value) return <span>—</span>
  async function reveal(reason: string) {
    setAsking(false); setErr('')
    try { setFull((await api.post('/pii/reveal', { kind, id, field, index, reason })).data.value) } catch (e) { setErr(apiError(e)) }
  }
  return (
    <span className="inline-flex items-center gap-1.5" style={{ position: 'relative' }}>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{full || value}</span>
      {user?.role === 'admin' && !full && (
        <button type="button" aria-label="Show full number" title="Show full number" onClick={() => setAsking((a) => !a)} style={{ border: 0, background: 'none', cursor: 'pointer', color: '#756E80', padding: 0, display: 'inline-flex' }}><Eye size={13} /></button>
      )}
      {asking && (
        <span role="menu" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 30, background: '#fff', border: '1px solid rgba(20,8,31,.12)', borderRadius: 10, boxShadow: '0 8px 20px rgba(20,8,31,.12)', padding: 4, minWidth: 190 }}>
          <span style={{ display: 'block', fontSize: 11, color: '#756E80', padding: '4px 8px' }}>Why? (logged)</span>
          {REASONS.map(([k, label]) => <button key={k} type="button" role="menuitem" onClick={() => reveal(k)} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'none', padding: '6px 8px', fontSize: 12.5, cursor: 'pointer' }}>{label}</button>)}
        </span>
      )}
      {err && <span style={{ color: '#B91C1C', fontSize: 11.5 }}>{err}</span>}
    </span>
  )
}

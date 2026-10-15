import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MapPin, Package, CheckCircle2 } from 'lucide-react'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'
const PAPER = '#FDFCFA'
const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const

interface PublicJob {
  type: 'PICKUP' | 'DELIVERY'
  status: 'REQUESTED' | 'ASSIGNED' | 'COMPLETED' | 'CANCELLED'
  address: string
  itemCount: number
  customerName?: string
}

const API = import.meta.env.VITE_API_URL || ''

export default function WarehouseJobConfirm() {
  const { token } = useParams<{ token: string }>()
  const [job, setJob] = useState<PublicJob | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmError, setConfirmError] = useState('')
  const [done, setDone] = useState(false)

  function load() {
    setLoading(true)
    fetch(`${API}/api/warehouse-jobs/public/${token}`)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json() })
      .then(setJob)
      .catch(() => setError('not found'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [token])

  async function confirm() {
    setBusy(true); setConfirmError('')
    try {
      const res = await fetch(`${API}/api/warehouse-jobs/public/${token}/confirm`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), notes }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not confirm')
      setDone(true)
    } catch (err) { setConfirmError(err instanceof Error ? err.message : 'Could not confirm') } finally { setBusy(false) }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: PAPER, display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 40, height: 40, border: `3px solid ${PURPLE}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
        <div style={{ color: MUTED, fontSize: 14 }}>Loading…</div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )

  if (error || !job) return (
    <div style={{ minHeight: '100vh', background: PAPER, display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
        <div style={{ ...HEADING, fontSize: 22, fontWeight: 700, color: INK, marginBottom: 8 }}>Link expired or invalid</div>
        <div style={{ fontSize: 14, color: MUTED }}>This confirmation link is no longer available.</div>
      </div>
    </div>
  )

  const closed = job.status === 'COMPLETED' || job.status === 'CANCELLED' || done
  const verb = job.type === 'PICKUP' ? 'pickup' : 'delivery'

  return (
    <div style={{ minHeight: '100vh', background: PAPER }}>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '24px 16px 48px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ ...HEADING, fontSize: 13, fontWeight: 700, color: PURPLE, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>PurpleBox Warehouse</div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>{job.type === 'PICKUP' ? 'Pickup' : 'Delivery'} confirmation</div>
          {job.customerName && <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>For {job.customerName}</div>}
        </div>

        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
            <MapPin size={18} color={PURPLE} />
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Address</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: INK, whiteSpace: 'pre-wrap' }}>{job.address}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Package size={18} color={PURPLE} />
            <div style={{ fontSize: 14, color: INK }}>{job.itemCount} item{job.itemCount === 1 ? '' : 's'}</div>
          </div>
        </div>

        {closed ? (
          <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: 24, textAlign: 'center' }}>
            <CheckCircle2 size={36} color="#059669" style={{ margin: '0 auto 12px' }} />
            <div style={{ ...HEADING, fontSize: 18, fontWeight: 700, color: INK }}>{job.status === 'CANCELLED' && !done ? 'This job was cancelled.' : `${job.type === 'PICKUP' ? 'Pickup' : 'Delivery'} confirmed.`}</div>
            <div style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>Thanks — the warehouse team has been updated.</div>
          </div>
        ) : (
          <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 10 }}>Confirm once this {verb} is done.</div>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional) — e.g. left at reception"
              style={{ width: '100%', minHeight: 70, borderRadius: 10, border: '1px solid rgba(20,8,31,0.15)', padding: 10, fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
            />
            {confirmError && <div style={{ color: '#DC2626', fontSize: 13, marginTop: 8 }}>{confirmError}</div>}
            <button
              onClick={confirm} disabled={busy}
              style={{ marginTop: 12, width: '100%', minHeight: 48, borderRadius: 10, border: 'none', background: PURPLE, color: 'white', fontSize: 15, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1 }}
            >{busy ? 'Confirming…' : `Confirm ${verb}`}</button>
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 32, fontSize: 12, color: MUTED }}>Shared via PurpleBox Warehouse</div>
      </div>
    </div>
  )
}

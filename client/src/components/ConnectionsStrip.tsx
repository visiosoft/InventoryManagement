import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, apiError } from '../lib/api'

/**
 * What the bots can read: every system the CRM connects to, at a glance,
 * with what bots read from it and a button to connect it — so a bot that
 * cannot read Gmail is fixed from here, not discovered from its answer.
 */

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.08)'

type Conn = { key: string; name: string; icon: string; connected: boolean; partly?: boolean; reads: string; note?: string; account?: string; connect: string }

export default function ConnectionsStrip() {
  const navigate = useNavigate()
  // Back from Google's screen: say how it went.
  const [params, setParams] = useSearchParams()
  const back = params.get('gmailConnected') ? { ok: true, text: 'Gmail is connected — bots can now read the inbox.' }
    : params.get('gmailError') ? { ok: false, text: params.get('gmailError') || '' } : null
  const dismiss = () => setParams((p) => { const n = new URLSearchParams(p); n.delete('gmailConnected'); n.delete('gmailError'); return n }, { replace: true })
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const { data } = useQuery<{ connections: Conn[] }>({ queryKey: ['bot-connections'], queryFn: () => api.get('/bots/connections').then((r) => r.data), staleTime: 60_000 })
  const list = Array.isArray(data?.connections) ? data!.connections : []
  if (!list.length) return null
  const ready = list.filter((c) => c.connected).length

  async function connect(c: Conn) {
    setErr('')
    if (c.connect.startsWith('oauth:')) {
      try {
        const { data: d } = await api.get<{ url: string }>(`/integrations/${c.connect.slice(6)}/connect`, { params: { from: 'bots' } })
        window.location.assign(d.url)
      } catch (e) { setErr(apiError(e)) }
      return
    }
    navigate('/settings')
  }

  const dot = (c: Conn) => (c.connected ? '#10B981' : c.partly ? '#F5B83D' : '#C4C8D2')

  return (
    <div style={{ marginBottom: 14 }}>
      {back && (
        <div role="status" className="flex items-center gap-3" style={{ marginBottom: 8, borderRadius: 10, padding: '9px 12px', fontSize: 13, background: back.ok ? '#F0FDF4' : '#FFF7E6', color: back.ok ? '#047857' : '#8A5A00', border: `1px solid ${back.ok ? '#BBF7D0' : '#F5D896'}` }}>
          <span className="flex-1">{back.text}</span>
          <button type="button" onClick={dismiss} style={{ background: 'none', border: 0, color: 'inherit', fontWeight: 700, cursor: 'pointer' }}>OK</button>
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Connections"
        className="flex w-full flex-wrap items-center gap-2 text-left"
        style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: '8px 12px', background: '#FBFAFD', cursor: 'pointer' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginRight: 4 }}>Bots can read · {ready} of {list.length}</span>
        {list.map((c) => (
          <span key={c.key} title={`${c.name}: ${c.connected ? 'connected' : c.partly ? 'partly' : 'not connected'}`}
            className="inline-flex items-center gap-1" style={{ fontSize: 12, color: c.connected ? INK : MUTED, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '2px 9px' }}>
            <span>{c.icon}</span>{c.name}<span style={{ width: 7, height: 7, borderRadius: 999, background: dot(c) }} />
          </span>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: PURPLE }}>{open ? 'Close' : 'Manage'}</span>
      </button>

      {open && (
        <div style={{ border: `1px solid ${LINE}`, borderTop: 0, borderRadius: '0 0 12px 12px', background: '#fff' }}>
          {list.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center gap-3" style={{ padding: '10px 14px', borderTop: `1px solid ${LINE}` }}>
              <span style={{ fontSize: 18 }}>{c.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2" style={{ fontWeight: 700, fontSize: 13.5, color: INK }}>
                  {c.name}
                  <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '1px 8px', background: c.connected ? '#DCFCE7' : c.partly ? '#FFF3D6' : '#F3F4F6', color: c.connected ? '#15803D' : c.partly ? '#8A5A00' : '#4B5563' }}>
                    {c.connected ? 'Bots can read' : c.partly ? 'Partly' : 'Not connected'}
                  </span>
                  {c.account && <span style={{ fontSize: 11.5, fontWeight: 400, color: MUTED }}>{c.account}</span>}
                </div>
                <div style={{ fontSize: 12.5, color: MUTED }}>{c.reads}</div>
                {c.note && <div style={{ fontSize: 12, color: '#8A5A00', marginTop: 2 }}>{c.note}</div>}
              </div>
              {(!c.connected || c.partly) && (
                <button type="button" onClick={() => connect(c)}
                  style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 8, padding: '7px 12px', border: 0, background: PURPLE, color: '#fff', cursor: 'pointer' }}>
                  {c.partly ? 'Reconnect' : 'Connect'}
                </button>
              )}
            </div>
          ))}
          {err && <div style={{ fontSize: 12.5, color: '#B91C1C', padding: '0 14px 10px' }}>{err}</div>}
        </div>
      )}
    </div>
  )
}

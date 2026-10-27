import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiError } from '../lib/api'

/**
 * Two connections made once: Twilio for SMS and Meta's ad account for ad
 * spend. Each form posts straight to the server, which checks the details
 * with Twilio or Meta before keeping them. Nothing typed here goes through
 * the assistant or into a chat.
 */

const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const FIELD = 'rgba(20,8,31,.14)'
const box: React.CSSProperties = { width: '100%', height: 36, border: `1px solid ${FIELD}`, borderRadius: 8, padding: '0 10px', fontSize: 13, background: '#fff' }
const lab: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: MUTED, marginBottom: 4 }
const btn = (primary: boolean): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 700, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', border: primary ? 0 : `1px solid ${FIELD}`, background: primary ? PURPLE : '#fff', color: primary ? '#fff' : '#111' })

type Status = { twilio?: { configured: boolean; from: string }; metaAds?: { configured: boolean; accountId: string; accountName: string } }
function useConnections() {
  return useQuery<Status>({ queryKey: ['integrations-status'], queryFn: () => api.get('/integrations/status').then((r) => r.data), staleTime: 60_000 })
}

export function TwilioConnectForm({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ accountSid: '', authToken: '', from: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok, setOk] = useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg('')
    try {
      const { data } = await api.post('/integrations/twilio/connect', f)
      setOk(true); setMsg(`Connected${data.accountName ? ` to ${data.accountName}` : ''} — texts come from ${data.from}. Ask again and it will prepare the SMS.`)
      qc.invalidateQueries({ queryKey: ['integrations-status'] })
      onDone?.()
    } catch (err) { setMsg(apiError(err)) } finally { setBusy(false) }
  }
  if (ok) return <div style={{ fontSize: 12.5, color: '#047857' }}>{msg}</div>
  return (
    <form onSubmit={save} aria-label="Connect Twilio" className="space-y-2" style={{ maxWidth: 520 }}>
      <div style={{ fontSize: 12.5, color: MUTED }}>Connect Twilio once to send SMS. From the Twilio console: the Account SID and Auth Token, and the number (or sender name) texts come from.</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label><span style={lab}>Account SID</span><input style={box} value={f.accountSid} onChange={(e) => setF({ ...f, accountSid: e.target.value })} placeholder="AC…" aria-label="Account SID" autoComplete="off" /></label>
        <label><span style={lab}>Auth token</span><input style={box} type="password" value={f.authToken} onChange={(e) => setF({ ...f, authToken: e.target.value })} aria-label="Auth token" autoComplete="off" /></label>
        <label className="sm:col-span-2"><span style={lab}>Send from</span><input style={box} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="+1… or PurpleBox" aria-label="Send from" /></label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" style={btn(true)} disabled={busy || !f.accountSid || !f.authToken || !f.from}>{busy ? 'Checking…' : 'Connect Twilio'}</button>
        {msg && <span style={{ fontSize: 12, color: '#B91C1C' }}>{msg}</span>}
      </div>
    </form>
  )
}

function MetaAdsForm() {
  const qc = useQueryClient()
  const [f, setF] = useState({ accountId: '', token: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg('')
    try {
      await api.post('/integrations/meta-ads/connect', f)
      qc.invalidateQueries({ queryKey: ['integrations-status'] })
    } catch (err) { setMsg(apiError(err)) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={save} aria-label="Connect Meta Ads" className="space-y-2" style={{ maxWidth: 520 }}>
      <div style={{ fontSize: 12.5, color: MUTED }}>
        Read-only: what each ad cost, for cost per chat and per customer. In Meta Business Settings, make a system user with <b>ads_read</b> on the ad account, generate its token, and paste it here with the ad account ID.
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label><span style={lab}>Ad account ID</span><input style={box} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })} placeholder="act_123… or 123…" aria-label="Ad account ID" /></label>
        <label><span style={lab}>Access token</span><input style={box} type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} aria-label="Access token" autoComplete="off" /></label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" style={btn(true)} disabled={busy || !f.accountId || !f.token}>{busy ? 'Checking…' : 'Connect Meta Ads'}</button>
        {msg && <span style={{ fontSize: 12, color: '#B91C1C' }}>{msg}</span>}
      </div>
    </form>
  )
}

/** The two rows for Settings → Integrations. */
export function ConnectionRows() {
  const qc = useQueryClient()
  const { data } = useConnections()
  const [open, setOpen] = useState<'' | 'twilio' | 'meta'>('')
  async function disconnect(which: 'twilio' | 'meta-ads') {
    if (!window.confirm('Disconnect? Saved details are removed.')) return
    await api.post(`/integrations/${which}/disconnect`).catch(() => null)
    qc.invalidateQueries({ queryKey: ['integrations-status'] })
  }
  const row = (key: 'meta' | 'twilio', title: string, on: boolean, detail: string, form: React.ReactNode, disc: () => void) => (
    <div className="rounded-lg border px-4 py-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{detail}</div>
        </div>
        {on
          ? <button type="button" style={btn(false)} onClick={disc}>Disconnect</button>
          : <button type="button" style={btn(open !== key)} onClick={() => setOpen(open === key ? '' : key)}>{open === key ? 'Close' : 'Connect'}</button>}
      </div>
      {!on && open === key && form}
    </div>
  )
  return (
    <>
      {row('meta', 'Meta Ads', Boolean(data?.metaAds?.configured),
        data?.metaAds?.configured ? `Connected — ${data.metaAds.accountName || `act_${data.metaAds.accountId}`}. Ad spend feeds the Meta ads bot.` : 'Not connected — the Meta ads bot shows chats and customers per ad, without cost.',
        <MetaAdsForm />, () => disconnect('meta-ads'))}
      {row('twilio', 'SMS (Twilio)', Boolean(data?.twilio?.configured),
        data?.twilio?.configured ? `Connected — texts come from ${data.twilio.from}.` : 'Not connected — bots and the Ask box can prepare texts once it is.',
        <TwilioConnectForm onDone={() => setOpen('')} />, () => disconnect('twilio'))}
    </>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, CreditCard, DoorOpen, Fingerprint, ScanFace, KeyRound, Settings2 } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { PageHeader, Spinner } from '../components/ui'

/**
 * The door terminal (Hikvision DS-K1T321MFWX): every face, card and
 * fingerprint check it reports, linked to the customer. Read-only — nothing
 * here opens or changes the door. The terminal pushes its events to the CRM
 * through its "HTTP Listening" setting.
 */

type DoorEvent = {
  _id: string; at: string; kind: 'granted' | 'denied' | 'door' | 'other'; method: string; label: string
  employeeNo: string; personName: string; customer: { _id: string; fullName: string } | null
}
type Person = { _id: string; employeeNo: string; name: string; customer: { _id: string; fullName: string } | null; matchedBy: string }
type Setup = { url: string; host: string; path: string; lastEventAt: string | null; lastDevice: { ip?: string; mac?: string; name?: string } | null }

const MUTED = 'rgba(20,8,31,.55)'
const LINE = 'rgba(20,8,31,.08)'
const KIND = {
  granted: { bg: '#DCFCE7', fg: '#15803D' },
  denied: { bg: '#FEE2E2', fg: '#B91C1C' },
  door: { bg: '#E8F0FC', fg: '#1E4E99' },
  other: { bg: '#F3F4F6', fg: '#4B5563' },
}
const METHOD_ICON: Record<string, typeof ScanFace> = { face: ScanFace, card: CreditCard, fingerprint: Fingerprint, pin: KeyRound }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })
function ago(iso: string | null) {
  if (!iso) return ''
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

export default function DoorAccess() {
  const qc = useQueryClient()
  const [days, setDays] = useState(1)
  const [showSetup, setShowSetup] = useState(false)
  const { data: setup } = useQuery<Setup>({ queryKey: ['door-setup'], queryFn: () => api.get('/door/setup').then((r) => r.data), refetchInterval: 30_000 })
  const { data, isLoading } = useQuery<{ events: DoorEvent[] }>({
    queryKey: ['door-events', days],
    queryFn: () => api.get('/door/events', { params: { days } }).then((r) => r.data),
    refetchInterval: 15_000,
  })
  const { data: peopleData } = useQuery<{ people: Person[] }>({ queryKey: ['door-people'], queryFn: () => api.get('/door/people').then((r) => r.data) })
  const unlinked = (peopleData?.people ?? []).filter((p) => !p.customer)
  const connected = Boolean(setup?.lastEventAt)

  const link = useMutation({
    mutationFn: ({ employeeNo, customerId }: { employeeNo: string; customerId: string | null }) => api.put(`/door/people/${encodeURIComponent(employeeNo)}`, { customerId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['door-people'] }); qc.invalidateQueries({ queryKey: ['door-events'] }) },
  })

  return (
    <div>
      <PageHeader
        title="Door Access"
        action={setup && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2" style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: connected ? '#F0FDF4' : '#F4F5F8', color: connected ? '#047857' : MUTED, border: `1px solid ${connected ? '#BBF7D0' : LINE}` }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: connected ? '#10B981' : '#C4C8D2' }} />
              {connected ? `Terminal connected · ${ago(setup.lastEventAt)}` : 'Waiting for the terminal'}
            </span>
            <button type="button" onClick={() => setShowSetup((v) => !v)} aria-label="Setup"
              style={{ width: 34, height: 34, borderRadius: 999, border: `1px solid ${LINE}`, background: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <Settings2 size={15} />
            </button>
          </div>
        )}
      />

      <div className="space-y-4">
        {setup && (showSetup || !connected) && <SetupCard setup={setup} />}

        {unlinked.length > 0 && (
          <div className="rounded-xl px-4 py-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Not linked to a customer yet</div>
            <div className="space-y-2">
              {unlinked.map((p) => (
                <div key={p.employeeNo} className="flex flex-wrap items-center gap-3" style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600, minWidth: 160 }}>{p.name || 'No name'} <span style={{ color: MUTED, fontWeight: 500 }}>· ID {p.employeeNo}</span></span>
                  <CustomerPicker busy={link.isPending} onPick={(customerId) => link.mutate({ employeeNo: p.employeeNo, customerId })} />
                </div>
              ))}
            </div>
            {link.isError && <div style={{ fontSize: 12.5, color: '#B91C1C', marginTop: 6 }}>{apiError(link.error)}</div>}
          </div>
        )}

        <div className="flex gap-2">
          {([[1, 'Today'], [7, '7 days'], [30, '30 days']] as const).map(([d, label]) => (
            <button key={d} type="button" onClick={() => setDays(d)}
              style={{ height: 34, padding: '0 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: `1px solid ${days === d ? '#4A1FA0' : LINE}`, background: days === d ? '#4A1FA0' : '#fff', color: days === d ? '#fff' : '#374151' }}>
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
          {isLoading ? <div className="p-6"><Spinner /></div> : !data?.events.length ? (
            <div className="text-center py-12" style={{ fontSize: 13.5, color: MUTED }}>
              <DoorOpen size={22} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
              No door activity {days === 1 ? 'today' : `in the last ${days} days`}.
            </div>
          ) : data.events.map((e) => {
            const Icon = METHOD_ICON[e.method] ?? DoorOpen
            const tone = KIND[e.kind] ?? KIND.other
            return (
              <div key={e._id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: `1px solid ${LINE}`, fontSize: 13.5 }}>
                <span style={{ width: 30, height: 30, borderRadius: 999, background: tone.bg, color: tone.fg, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}><Icon size={15} /></span>
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ fontWeight: 600 }}>
                    {e.customer
                      ? <Link to={`/customers/${e.customer._id}`} style={{ color: '#111827' }}>{e.customer.fullName}</Link>
                      : e.personName || (e.kind === 'door' ? 'Door' : 'Unknown person')}
                    {e.customer && e.personName && e.personName.toLowerCase() !== e.customer.fullName.toLowerCase() && <span style={{ color: MUTED, fontWeight: 500 }}> · {e.personName}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: MUTED }}>{when(e.at)}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: tone.bg, color: tone.fg, whiteSpace: 'nowrap' }}>{e.label}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* How to point the terminal at the CRM. Short: the terminal's own web page does the rest. */
function SetupCard({ setup }: { setup: Setup }) {
  const [copied, setCopied] = useState('')
  const copy = (text: string, what: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1500) }).catch(() => {}) }
  const row = (label: string, value: string, what: string) => (
    <div className="flex items-center gap-2" style={{ fontSize: 13 }}>
      <span style={{ width: 92, color: MUTED }}>{label}</span>
      <code style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: '#F6F7F9', padding: '5px 8px', borderRadius: 6, fontSize: 12.5 }}>{value}</code>
      <button type="button" onClick={() => copy(value, what)} aria-label={`Copy ${label}`}
        style={{ fontSize: 12, fontWeight: 600, color: '#4A1FA0', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Copy size={12} />{copied === what ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
  return (
    <div className="rounded-xl px-5 py-4 space-y-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>Connect the terminal</div>
      <ol className="space-y-1" style={{ fontSize: 13, color: '#374151', paddingLeft: 18, listStyle: 'decimal' }}>
        <li>Open the terminal's web page (its IP address in a browser) and sign in as admin.</li>
        <li>Go to <b>Configuration → Network → Advanced → HTTP Listening</b>.</li>
        <li>Enter the details below, with port <b>443</b> and protocol <b>HTTPS</b>, and save.</li>
        <li>Scan a face or card — it appears here within seconds.</li>
      </ol>
      <div className="space-y-1.5">
        {row('Address', setup.host, 'host')}
        {row('URL', setup.path, 'path')}
      </div>
      <div style={{ fontSize: 12, color: MUTED }}>Keep the URL private: it is the terminal's key to the CRM.</div>
    </div>
  )
}

/* Find a customer by name or phone and pick them. */
function CustomerPicker({ busy, onPick }: { busy: boolean; onPick: (customerId: string) => void }) {
  const [q, setQ] = useState('')
  const { data } = useQuery<{ data: { _id: string; fullName: string; phone?: string }[] }>({
    queryKey: ['door-customer-search', q],
    queryFn: () => api.get('/customers', { params: { search: q, limit: 6 } }).then((r) => r.data),
    enabled: q.trim().length >= 2,
  })
  return (
    <div className="relative" style={{ flex: 1, minWidth: 220, maxWidth: 360 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Link to customer — type a name or phone" disabled={busy}
        aria-label="Find a customer"
        style={{ width: '100%', height: 32, padding: '0 10px', borderRadius: 8, border: `1px solid ${LINE}`, fontSize: 13 }} />
      {q.trim().length >= 2 && (data?.data?.length ?? 0) > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 8px 24px rgba(20,8,31,.12)' }}>
          {data!.data.map((c) => (
            <button key={c._id} type="button" onClick={() => { onPick(c._id); setQ('') }}
              className="block w-full text-left px-3 py-2 hover:bg-gray-50" style={{ fontSize: 13, border: 'none', background: 'none', cursor: 'pointer' }}>
              {c.fullName}{c.phone ? <span style={{ color: MUTED }}> · {c.phone}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

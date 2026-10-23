import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, CardHeader, CardBody, Spinner } from '../components/ui'

/**
 * The team's phone calls, synced from the reps' Android phones by the staff
 * app: calls made, answered, talk time and leads called, per rep and per day,
 * and the latest calls. Only calls to leads and customers ever arrive here.
 */

type Rep = { userId: string; name: string; made: number; answered: number; talkSec: number; incoming: number; missed: number; leads: number }
type Day = { date: string; made: number; answered: number; talkSec: number }
type Recent = { _id: string; at: string; direction: 'outgoing' | 'incoming' | 'missed' | 'rejected'; durationSec: number; note: string; rep: string; leadId: string | null; name: string; phone: string }
type Summary = { days: number; reps: Rep[]; byDay: Day[]; recent: Recent[] }

const PURPLE = '#5B2BC9'
const MUTED = '#6B7280'
const LINE = '#E5E7EB'

export const talk = (sec: number) => {
  const s = Math.round(sec || 0)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })

export default function Calls() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'accounts_admin'
  const [days, setDays] = useState(7)
  const { data, isLoading } = useQuery<Summary>({ queryKey: ['calls-summary', days], queryFn: () => api.get('/calls/summary', { params: { days } }).then((r) => r.data), refetchInterval: 60_000 })

  const totals = (data?.reps ?? []).reduce((t, r) => ({ made: t.made + r.made, answered: t.answered + r.answered, talkSec: t.talkSec + r.talkSec, leads: t.leads + r.leads }), { made: 0, answered: 0, talkSec: 0, leads: 0 })
  const peak = Math.max(1, ...(data?.byDay ?? []).map((d) => d.made))

  return (
    <div>
      <PageHeader title="Calls" subtitle={isAdmin ? 'Calls the team made and took on their phones — to leads and customers only' : 'Your calls to leads and customers'} />
      <div className="flex gap-2 mb-4">
        {[[1, 'Today'], [7, '7 days'], [30, '30 days']].map(([d, label]) => (
          <button key={d} type="button" onClick={() => setDays(Number(d))}
            className="h-9 px-4 rounded-full text-[13px] font-semibold cursor-pointer"
            style={{ border: `1px solid ${days === d ? PURPLE : LINE}`, background: days === d ? PURPLE : '#fff', color: days === d ? '#fff' : '#374151' }}>{label}</button>
        ))}
      </div>

      {isLoading || !data ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            {([['Calls made', totals.made], ['Answered', `${totals.answered}${totals.made ? ` (${Math.round((totals.answered / totals.made) * 100)}%)` : ''}`], ['Talk time', talk(totals.talkSec)], ['Leads called', totals.leads]] as const).map(([label, v]) => (
              <div key={label} className="rounded-xl border bg-white p-3" style={{ borderColor: LINE }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 800 }}>{v}</div>
              </div>
            ))}
          </div>

          {data.recent.length === 0 && (
            <Card><CardBody>
              <div style={{ fontSize: 14, fontWeight: 600 }}>No calls synced yet.</div>
              <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>
                Calls appear here once the PurpleBox staff app is installed on a rep's Android phone and allowed to read the call log. Only calls to numbers that are leads or customers are sent — personal calls stay on the phone.
              </div>
            </CardBody></Card>
          )}

          {isAdmin && data.reps.length > 0 && (
            <Card>
              <CardHeader title="By rep" />
              <div style={{ overflowX: 'auto' }}>
                <table className="w-full text-[13.5px]" style={{ borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead style={{ background: '#F9FAFB', color: MUTED }}>
                    <tr>{['Rep', 'Calls made', 'Answered', 'Talk time', 'Leads called', 'Incoming', 'Missed'].map((h) => <th key={h} className="px-3 py-2 text-left text-[11px] font-bold uppercase">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {data.reps.map((r) => (
                      <tr key={r.userId} style={{ borderTop: `1px solid ${LINE}` }}>
                        <td className="px-3 py-2 font-semibold">{r.name}</td>
                        <td className="px-3 py-2">{r.made}</td>
                        <td className="px-3 py-2">{r.answered}{r.made ? <span style={{ color: MUTED }}> ({Math.round((r.answered / r.made) * 100)}%)</span> : null}</td>
                        <td className="px-3 py-2">{talk(r.talkSec)}</td>
                        <td className="px-3 py-2">{r.leads}</td>
                        <td className="px-3 py-2">{r.incoming}</td>
                        <td className="px-3 py-2" style={{ color: r.missed ? '#B91C1C' : undefined }}>{r.missed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {data.byDay.length > 1 && (
            <Card>
              <CardHeader title="Calls per day" subtitle="Made, with the answered part darker" />
              <CardBody>
                <div className="flex items-end gap-2" style={{ height: 140 }}>
                  {data.byDay.map((d) => (
                    <div key={d.date} className="flex-1 flex flex-col items-center justify-end" title={`${d.made} made · ${d.answered} answered · ${talk(d.talkSec)}`}>
                      <div style={{ fontSize: 11, fontWeight: 700 }}>{d.made}</div>
                      <div style={{ width: '70%', maxWidth: 36, height: `${(d.made / peak) * 100}px`, background: '#DDD6FE', borderRadius: 6, position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${d.made ? (d.answered / d.made) * 100 : 0}%`, background: PURPLE }} />
                      </div>
                      <div style={{ fontSize: 10.5, color: MUTED, marginTop: 4 }}>{new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {data.recent.length > 0 && (
            <Card>
              <CardHeader title="Latest calls" />
              <div>
                {data.recent.map((c) => {
                  const Icon = c.direction === 'outgoing' ? PhoneOutgoing : c.direction === 'incoming' ? PhoneIncoming : PhoneMissed
                  const answered = c.direction === 'outgoing' ? c.durationSec >= 10 : c.direction === 'incoming'
                  return (
                    <div key={c._id} className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: `1px solid ${LINE}` }}>
                      <Icon size={16} style={{ color: answered ? '#15803D' : '#B91C1C', flex: '0 0 auto' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold truncate">
                          {c.leadId ? <Link to={`/leads/${c.leadId}`} style={{ color: '#111827' }}>{c.name || c.phone}</Link> : (c.name || c.phone)}
                        </div>
                        <div className="text-[12px] truncate" style={{ color: MUTED }}>
                          {when(c.at)}{isAdmin && c.rep ? ` · ${c.rep}` : ''} · {c.direction === 'outgoing' ? (answered ? `answered, ${talk(c.durationSec)}` : 'no answer') : c.direction === 'incoming' ? `incoming, ${talk(c.durationSec)}` : 'missed'}
                          {c.note ? ` · “${c.note}”` : ''}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

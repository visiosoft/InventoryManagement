import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Award, Handshake, Trophy, Users } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { PageHeader, Card, CardHeader, Spinner } from '../components/ui'
import { formatMoney } from '../lib/utils'
import { StatCard } from './reports/shared'

/**
 * Who is closing what.
 *
 * Visible to everybody, not just managers: a board only the manager can see
 * recognises nobody. The figures are the same ones the sales reports use, so a
 * rep cannot be told two different numbers about themselves.
 */

type Row = {
  userId: string
  name: string
  role: string
  position: number
  received: number
  contacted: number
  closedFromLeads: number
  closed: number
  value: number
  conversionPct: number | null
  awards: string[]
}
type Board = {
  label: string
  rows: Row[]
  totals: { closed: number; value: number; received: number }
  awardTypes: Record<string, { label: string; hint: string }>
}

const PERIODS = [
  ['month', 'This month'],
  ['quarter', 'This quarter'],
  ['year', 'This year'],
  ['all', 'All time'],
] as const

const PURPLE = '#5B2BC9'
const MEDAL = ['#D4A017', '#9AA3AE', '#B87333']   // gold, silver, bronze

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('')
}

function Trophies({ keys, types }: { keys: string[]; types: Board['awardTypes'] }) {
  if (!keys.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {keys.map((k) => (
        <span
          key={k}
          title={types[k]?.hint ?? k}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 whitespace-nowrap"
          style={{ background: '#FFF7E6', border: '1px solid #F5DFB8', color: '#B45309', fontSize: 11, fontWeight: 700 }}
        >
          <Award size={11} /> {types[k]?.label ?? k}
        </span>
      ))}
    </span>
  )
}

export default function Leaderboard() {
  const { user: me } = useAuth()
  const [period, setPeriod] = useState<typeof PERIODS[number][0]>('month')

  const { data, isLoading } = useQuery<Board>({
    queryKey: ['leaderboard', period],
    queryFn: () => api.get('/leaderboard', { params: { period } }).then((r) => r.data),
  })

  const rows = data?.rows ?? []
  const podium = rows.filter((r) => r.closed > 0).slice(0, 3)

  return (
    <div>
      <PageHeader title="Leaderboard" subtitle="Leads received, deals closed, and who is closing them" />

      <div className="flex flex-wrap gap-2 mb-4">
        {PERIODS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPeriod(key)}
            className="rounded-full px-4 py-1.5 cursor-pointer"
            style={period === key
              ? { background: PURPLE, color: '#fff', fontSize: 13, fontWeight: 700, border: '1px solid transparent' }
              : { background: '#fff', color: '#2B2440', fontSize: 13, fontWeight: 600, border: '1px solid rgba(20,8,31,.14)' }}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading || !data ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard label="Deals closed" value={String(data.totals.closed)} sub={data.label.toLowerCase()} tone="green" icon={Handshake} />
            <StatCard label="Value closed" value={`AED ${formatMoney(data.totals.value)}`} sub="total on those deals" icon={Trophy} />
            <StatCard label="Leads handed out" value={String(data.totals.received)} sub="assigned to somebody" icon={Users} />
          </div>

          {/* The podium only appears once somebody has actually closed
              something — three empty plinths is not a celebration. */}
          {podium.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {podium.map((r, i) => (
                <Card key={r.userId}>
                  <div className="p-4 flex items-center gap-3">
                    <div
                      className="shrink-0 inline-flex items-center justify-center rounded-full"
                      style={{ width: 44, height: 44, background: `${MEDAL[i]}22`, color: MEDAL[i], fontWeight: 800, fontSize: 15 }}
                    >
                      {initials(r.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Trophy size={14} style={{ color: MEDAL[i] }} />
                        <span className="truncate" style={{ fontWeight: 700 }}>{r.name}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: 'rgba(20,8,31,.6)' }}>
                        {r.closed} {r.closed === 1 ? 'deal' : 'deals'} · AED {formatMoney(r.value)}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          <Card>
            <CardHeader title={`The team — ${data.label}`} subtitle="Received is leads somebody was given; closed is contracts signed" />
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'rgba(20,8,31,.5)' }}>
                    {['', 'Name', 'Received', 'Contacted', 'Won from leads', 'Deals', 'Conversion', 'Value'].map((h, i) => (
                      <th key={h + i} className="px-3 py-2" style={{ textAlign: i >= 2 ? 'right' : 'left', fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const isMe = String(me?.id ?? '') === r.userId
                    return (
                      <tr
                        key={r.userId}
                        style={{
                          borderTop: '1px solid rgba(20,8,31,.08)',
                          background: isMe ? 'rgba(91,43,201,.06)' : undefined,
                        }}
                      >
                        <td className="px-3 py-3" style={{ width: 44, fontWeight: 800, color: r.position <= 3 ? MEDAL[r.position - 1] : 'rgba(20,8,31,.45)' }}>
                          {r.position}
                        </td>
                        <td className="px-3 py-3">
                          <div style={{ fontWeight: 700 }}>
                            {r.name}{isMe && <span style={{ color: PURPLE, fontWeight: 600 }}> · you</span>}
                          </div>
                          <div className="mt-1"><Trophies keys={r.awards} types={data.awardTypes} /></div>
                        </td>
                        <td className="px-3 py-3" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.received}</td>
                        <td className="px-3 py-3" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.contacted}</td>
                        <td className="px-3 py-3" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.closedFromLeads}</td>
                        <td className="px-3 py-3" style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{r.closed}</td>
                        <td className="px-3 py-3" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {r.conversionPct === null ? '—' : `${r.conversionPct}%`}
                        </td>
                        <td className="px-3 py-3" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>AED {formatMoney(r.value)}</td>
                      </tr>
                    )
                  })}
                  {!rows.length && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6" style={{ textAlign: 'center', color: 'rgba(20,8,31,.5)' }}>
                        Nothing to show for this period yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <p style={{ fontSize: 12, color: 'rgba(20,8,31,.55)' }}>
            A deal counts when a contract is signed. Conversion is how many of the leads somebody was
            handed ended up won, which is why it is not simply deals divided by leads.
          </p>
        </div>
      )}
    </div>
  )
}

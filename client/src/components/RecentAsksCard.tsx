import { useQuery, useQueryClient } from '@tanstack/react-query'
import { History, ArrowUpRight } from 'lucide-react'
import { api } from '../lib/api'

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE_INK = '#4A1FA0'
const LINE = 'rgba(20,8,31,.08)'
const HEAD = "'Bricolage Grotesque', sans-serif"

type Recent = { q: string; at: string }

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

/**
 * The signed-in person's own last questions to the Ask box — everyone sees
 * their own. Clicking one asks it again, fresh, in the box at the top.
 */
export default function RecentAsksCard() {
  const qc = useQueryClient()
  const { data } = useQuery<{ recent: Recent[] }>({
    queryKey: ['assistant-recent'],
    queryFn: () => api.get('/assistant/recent').then((r) => r.data),
    staleTime: 30_000,
  })
  const { data: caps } = useQuery({
    queryKey: ['assistant-capabilities'],
    queryFn: () => api.get<{ enabled: boolean; allowed: boolean }>('/assistant/capabilities').then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  const recent = data?.recent ?? []

  function again(q: string) {
    window.dispatchEvent(new CustomEvent('pb-ask', { detail: q }))
    document.getElementById('dashboard-ask')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  async function clear() {
    await api.delete('/assistant/recent').catch(() => null)
    qc.setQueryData(['assistant-recent'], { recent: [] })
  }

  if (!caps?.enabled || !caps?.allowed) return null

  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
        <History size={15} style={{ color: MUTED }} />
        <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: INK }} className="mr-auto">Recent searches</span>
        {recent.length > 0 && (
          <button type="button" onClick={clear} aria-label="Clear recent searches" style={{ fontSize: 12, fontWeight: 600, color: MUTED, background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
        )}
      </div>
      {recent.length === 0 ? (
        <div style={{ fontSize: 13, color: MUTED, padding: '6px 0 4px' }}>What you ask above shows up here.</div>
      ) : (
        <div>
          {recent.slice(0, 8).map((r) => (
            <button key={r.q} type="button" onClick={() => again(r.q)} aria-label={`Ask again: ${r.q}`}
              className="group flex w-full items-center gap-3 text-left hover:bg-[#F7F3FF]"
              style={{ padding: '8px 8px', margin: '0 -8px', width: 'calc(100% + 16px)', borderRadius: 8, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13.5, color: INK }}>
              <span className="flex-1 truncate">{r.q}</span>
              <span style={{ fontSize: 11.5, color: MUTED }}>{ago(r.at)}</span>
              <ArrowUpRight size={14} style={{ color: PURPLE_INK }} className="opacity-0 group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

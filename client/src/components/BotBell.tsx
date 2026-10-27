import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bot as BotIcon, X } from 'lucide-react'
import { api } from '../lib/api'
import { enablePush, pushPermission } from '../lib/push'

/**
 * Bot results waiting for this person, on every page: a count in the top
 * bar, the list on a click, and a toast the moment a new one lands — so a
 * reply from a bot is seen while working on Leads or Contracts, not only on
 * the Bots tab. When the app is closed, the same result arrives as a browser
 * push (server side), on browsers where notifications are on.
 */

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const LINE = 'rgba(20,8,31,.08)'

type Item = { runId: string; botId: string; name: string; icon: string; at: string; line: string; replied: boolean; needsAction: boolean }

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

export default function BotBell() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [toasts, setToasts] = useState<Item[]>([])
  const [permission, setPermission] = useState(pushPermission())
  const known = useRef<Set<string> | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const { data } = useQuery<{ count: number; items: Item[] }>({
    queryKey: ['bot-inbox'],
    queryFn: () => api.get('/bots/inbox').then((r) => r.data),
    refetchInterval: 20_000,
    // Coming back to the tab looks again at once, not up to 20 s later.
    refetchOnWindowFocus: true,
  })
  const items = data?.items ?? []

  // A toast for each result that arrives while the page is open — not for
  // what was already waiting when it loaded.
  useEffect(() => {
    if (!data) return
    const ids = new Set(data.items.map((i) => i.runId))
    if (known.current) {
      const fresh = data.items.filter((i) => !known.current!.has(i.runId))
      if (fresh.length) {
        setToasts((t) => [...fresh.slice(0, 3), ...t].slice(0, 3))
        qc.invalidateQueries({ queryKey: ['bots'] })
      }
    }
    known.current = ids
  }, [data, qc])

  useEffect(() => {
    if (!toasts.length) return
    const t = window.setTimeout(() => setToasts((x) => x.slice(0, -1)), 9000)
    return () => window.clearTimeout(t)
  }, [toasts])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function go(i: Item) {
    setOpen(false)
    setToasts((t) => t.filter((x) => x.runId !== i.runId))
    navigate(`/?tab=bots&bot=${i.botId}`)
  }
  async function markAll() {
    await api.post('/bots/inbox/seen', {}).catch(() => null)
    qc.invalidateQueries({ queryKey: ['bot-inbox'] })
    qc.invalidateQueries({ queryKey: ['bots'] })
  }
  async function turnOnPush() {
    try { await enablePush() } catch { /* the browser said no */ }
    setPermission(pushPermission())
  }

  const label = (i: Item) => `${i.name}${i.replied ? ' replied' : ''}`

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Bot results${items.length ? ` (${items.length} new)` : ''}`}
        className="relative flex items-center justify-center rounded-lg hover:bg-muted/60 transition-colors cursor-pointer" style={{ width: 36, height: 36 }}>
        <BotIcon size={18} style={{ color: items.length ? PURPLE : MUTED }} />
        {items.length > 0 && (
          <span style={{ position: 'absolute', top: 3, right: 2, minWidth: 16, height: 16, borderRadius: 999, background: PURPLE, color: '#fff', fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', padding: '0 4px' }}>
            {items.length > 9 ? '9+' : items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2" role="dialog" aria-label="Bot results"
          style={{ width: 340, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, boxShadow: '0 12px 32px rgba(20,8,31,.14)', overflow: 'hidden' }}>
          <div className="flex items-center" style={{ padding: '10px 14px', borderBottom: `1px solid ${LINE}` }}>
            <span style={{ fontWeight: 700, fontSize: 13.5, color: INK }} className="mr-auto">Bots</span>
            {items.length > 0 && <button type="button" onClick={markAll} style={{ fontSize: 12, color: MUTED, background: 'none', border: 0, cursor: 'pointer' }}>Mark all read</button>}
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            {!items.length && <div style={{ fontSize: 13, color: MUTED, padding: '18px 14px' }}>Nothing new from your bots.</div>}
            {items.map((i) => (
              <button key={i.runId} type="button" onClick={() => go(i)} className="flex w-full items-start gap-3 text-left hover:bg-[#F7F3FF]"
                style={{ padding: '10px 14px', border: 0, borderBottom: `1px solid ${LINE}`, background: 'none', cursor: 'pointer' }}>
                <span style={{ fontSize: 18, lineHeight: '22px' }}>{i.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate" style={{ fontWeight: 700, fontSize: 13, color: INK }}>{label(i)}</span>
                    <span style={{ fontSize: 11, color: MUTED, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{ago(i.at)}</span>
                  </span>
                  <span className="block truncate" style={{ fontSize: 12.5, color: i.needsAction ? '#8A5A00' : MUTED, fontWeight: i.needsAction ? 600 : 400 }}>{i.line}</span>
                </span>
              </button>
            ))}
          </div>
          {permission === 'default' && (
            <div style={{ padding: '10px 14px', borderTop: `1px solid ${LINE}`, background: '#FBFAFD', fontSize: 12, color: MUTED }}>
              Get these when the app is closed.{' '}
              <button type="button" onClick={turnOnPush} style={{ color: PURPLE, fontWeight: 700, background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>Turn on notifications</button>
            </div>
          )}
        </div>
      )}

      {/* New results, wherever the person is in the app. */}
      <div className="fixed z-[60] space-y-2" style={{ right: 18, bottom: 18, width: 320 }} aria-live="polite">
        {toasts.map((i) => (
          <div key={i.runId} role="status" className="flex items-start gap-3" style={{ background: '#fff', border: `1px solid ${LINE}`, borderLeft: `4px solid ${i.needsAction ? '#F5B83D' : PURPLE}`, borderRadius: 12, padding: '10px 12px', boxShadow: '0 10px 28px rgba(20,8,31,.16)' }}>
            <span style={{ fontSize: 18 }}>{i.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate" style={{ fontWeight: 700, fontSize: 13, color: INK }}>{label(i)}</div>
              <div style={{ fontSize: 12.5, color: MUTED, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{i.line}</div>
              <button type="button" onClick={() => go(i)} style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: PURPLE, background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>Open</button>
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((t) => t.filter((x) => x.runId !== i.runId))} style={{ background: 'none', border: 0, color: MUTED, cursor: 'pointer' }}><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}

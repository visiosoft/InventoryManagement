import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { whatsappApi, type WhatsAppConversation, type WhatsAppMsg } from '../lib/api'
import { useSeen, markAllSeen, unreadFrom } from '../lib/whatsappSeen'
import { convDisplayName, formatListTime, Avatar } from '../lib/whatsappDisplay'

const INK = '#14081F'
const MUTED_INK = '#4A4357'
const FAINT_INK = '#756E80'
const LINE = 'rgba(20,8,31,.10)'

/**
 * Unread WhatsApp messages, in the top bar on every page.
 *
 * Shares its query keys with the console, so having both open costs no extra
 * requests, and reads the same seen store — opening a chat in the console
 * clears it here without a reload.
 */
export default function WhatsAppBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const { data: conversations } = useQuery<WhatsAppConversation[]>({
    // Its own cache entry: the console stores a paged result under this
    // prefix, and sharing a key would hand the bell the wrong shape. Still
    // prefix-matched, so invalidating 'wa-conversations' refreshes both.
    queryKey: ['wa-conversations', 'bell'],
    queryFn: () => whatsappApi.conversations().then((r) => r.list),
    // Slower than the console's own polling: this runs on every page, and a
    // message showing up half a minute later in the bell is no loss.
    refetchInterval: 30_000,
    retry: false,
  })

  const { data: allMessages } = useQuery<WhatsAppMsg[]>({
    queryKey: ['wa-messages', null],
    queryFn: () => whatsappApi.messages(),
    refetchInterval: 30_000,
    retry: false,
  })

  const seen = useSeen()
  const unreadByPhone = useMemo(() => unreadFrom(allMessages, seen), [allMessages, seen])
  const totalUnread = useMemo(
    () => Object.values(unreadByPhone).reduce((a, b) => a + b, 0),
    [unreadByPhone],
  )

  const previewByPhone = useMemo(() => {
    const out: Record<string, string> = {}
    for (const m of allMessages ?? []) {
      if (out[m.phoneNormalized] !== undefined) continue
      out[m.phoneNormalized] = m.text?.trim() || `[${m.type}]`
    }
    return out
  }, [allMessages])

  const unreadConvos = useMemo(
    () => (conversations ?? [])
      .filter((c) => (unreadByPhone[c.phoneNormalized] ?? 0) > 0)
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)),
    [conversations, unreadByPhone],
  )

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={totalUnread > 0 ? `${totalUnread} unread WhatsApp messages` : 'No unread WhatsApp messages'}
        aria-label={totalUnread > 0 ? `${totalUnread} unread WhatsApp messages` : 'WhatsApp notifications'}
        className="relative flex items-center justify-center rounded-lg h-8 w-8 hover:bg-muted/60 transition-colors cursor-pointer"
      >
        <Bell size={16} className="text-muted-foreground" />
        {totalUnread > 0 && (
          <span
            className="absolute pointer-events-none rounded-full text-white grid place-items-center"
            style={{ top: -2, right: -2, minWidth: 16, height: 16, padding: '0 4px', background: '#DC2626', fontSize: 9.5, fontWeight: 800 }}
            aria-hidden
          >
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 overflow-hidden"
          style={{ width: 340, background: '#fff', borderRadius: 14, border: `1px solid ${LINE}`, boxShadow: '0 20px 50px rgba(20,8,31,.20)' }}
        >
          <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: `1px solid ${LINE}` }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>
              Unread{totalUnread > 0 ? ` (${totalUnread})` : ''}
            </span>
            <button
              type="button"
              onClick={() => { markAllSeen(allMessages ?? []); setOpen(false) }}
              disabled={totalUnread === 0}
              className="cursor-pointer disabled:opacity-40"
              style={{ fontSize: 11.5, fontWeight: 600, color: '#4A1FA0' }}
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {unreadConvos.length === 0 ? (
              <p className="px-3.5 py-5 text-center" style={{ fontSize: 12, color: FAINT_INK }}>
                Nothing new. You are all caught up.
              </p>
            ) : unreadConvos.map((c) => (
              <button
                key={c.phoneNormalized}
                type="button"
                onClick={() => { setOpen(false); navigate(`/whatsapp?phone=${c.phoneNormalized}`) }}
                className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left cursor-pointer hover:bg-[#F7F3FF]"
                style={{ borderBottom: `1px solid ${LINE}` }}
              >
                <Avatar seed={c.phoneNormalized} label={convDisplayName(c)} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate flex-1" style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>
                      {convDisplayName(c)}
                    </span>
                    <span className="shrink-0" style={{ fontSize: 10.5, color: FAINT_INK }}>{formatListTime(c.lastAt)}</span>
                  </div>
                  <div className="truncate" style={{ fontSize: 11.5, color: MUTED_INK }}>
                    {previewByPhone[c.phoneNormalized] ?? `${c.count} messages`}
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-full text-white grid place-items-center"
                  style={{ minWidth: 17, height: 17, padding: '0 5px', background: '#5B2BC9', fontSize: 10, fontWeight: 800 }}
                >
                  {(unreadByPhone[c.phoneNormalized] ?? 0) > 99 ? '99+' : unreadByPhone[c.phoneNormalized]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

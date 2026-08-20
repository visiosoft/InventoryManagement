import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Send, MessageSquare, RefreshCw, UserPlus, UserCheck, Bell, BellOff, FileText,
  Search, X, Plus, ChevronDown, Zap, CheckCheck, Menu, Info, Paperclip,
  Bot,
} from 'lucide-react'
import { api, whatsappApi, leadApi, apiError, type WhatsAppConversation, type WhatsAppMsg } from '../lib/api'
import { cn } from '../lib/utils'

/* ── local types ──────────────────────────────────────────────────────────
   The API layer's WhatsAppMsg predates attachments; /whatsapp/messages now
   adds a `media` descriptor on messages that carry one. Widened here because
   this page is the only consumer. */
type WaMediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker'
type WaMedia = { kind: WaMediaKind; mimeType: string; filename: string; caption: string }
type WaMsg = WhatsAppMsg & { media?: WaMedia }

/** Settings → Message Templates. Reused verbatim as the quick-reply library. */
type MessageTemplate = {
  _id: string
  key: string
  label: string
  whatsappBody: string
  category?: string
  sortOrder?: number
}

const MUTE_KEY = 'wa_inbox_muted'
const SEEN_KEY = 'wa_inbox_last_seen'
const BLINK_MS = 4000
const PING_SRC = '/whatsappaduio.mp3'

const INK = '#14081F'
const MUTED_INK = '#4A4357'
const FAINT_INK = '#756E80'
const LINE = 'rgba(20,8,31,.10)'

const CSS = `
@keyframes wa-blink-bg {
  0%, 100% { background-color: transparent; }
  50%      { background-color: rgba(91, 43, 201, 0.16); }
}
.wa-blink { animation: wa-blink-bg 1s ease-in-out 4; }
.wa-thumb { cursor: zoom-in; }
.wa-thumb:hover { opacity: 0.92; }
.wa-doc:hover { text-decoration: underline; }
.wa-row:hover { background-color: #FAF7FF; }
.wa-grip { height: 12px; display: grid; place-items: center; cursor: ns-resize; touch-action: none; }
.wa-grip-bar { width: 44px; height: 4px; border-radius: 999px; background: rgba(20,8,31,.16); transition: background .15s ease; }
.wa-grip:hover .wa-grip-bar { background: rgba(91,43,201,.55); }
.wa-scroll { overflow-y: auto; }
.wa-scroll::-webkit-scrollbar { width: 8px; }
.wa-scroll::-webkit-scrollbar-thumb { background: rgba(20,8,31,.16); border-radius: 999px; }
.wa-scroll::-webkit-scrollbar-track { background: transparent; }
.wa-mobile-only { display: none !important; }
.wa-scrim { display: none; }

/* Below ~1100px the quick-replies panel floats over the chat instead of
   squeezing it. */
@media (max-width: 1100px) {
  .wa-qr {
    position: absolute; top: 0; right: 0; bottom: 0;
    width: 320px; z-index: 25;
    box-shadow: -10px 0 34px rgba(20,8,31,.18);
  }
}
@media (max-width: 440px) {
  .wa-qr { width: 100%; }
}

/* Below ~700px the chat list collapses to a drawer. */
@media (max-width: 700px) {
  .wa-sidebar {
    position: absolute; top: 0; left: 0; bottom: 0;
    width: 282px; z-index: 30; flex: none;
    transform: translateX(-102%); transition: transform .2s ease;
    box-shadow: 10px 0 34px rgba(20,8,31,.18);
  }
  .wa-sidebar.wa-sidebar-open { transform: translateX(0); }
  .wa-mobile-only { display: inline-flex !important; }
  .wa-scrim { display: block; position: absolute; inset: 0; z-index: 28; background: rgba(20,8,31,.34); }
}
`

/* ── formatting ───────────────────────────────────────────────────────── */
/** What to call a conversation.
 *
 *  The server resolves this against customers and leads and sends it as
 *  `displayName`. A lead created from a chat gets an auto-generated name like
 *  "WhatsApp Contact 4797", which is not a name — the number is more useful,
 *  so it is filtered here too in case an older payload arrives without the
 *  resolved field. */
function convDisplayName(c: {
  displayName?: string
  customer?: { fullName?: string } | null
  lead?: { fullName?: string } | null
  phone?: string
  phoneNormalized: string
}) {
  const placeholder = (n?: string) => !n || /^whatsapp\s*contact/i.test(n.trim())
  if (c.displayName && !placeholder(c.displayName)) return c.displayName
  if (c.customer?.fullName) return c.customer.fullName
  if (!placeholder(c.lead?.fullName)) return c.lead!.fullName!
  return c.phone || `+${c.phoneNormalized}`
}

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatListTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return formatClock(iso)
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

function initials(label: string) {
  const cleaned = label.replace(/^\+/, '').trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (/^\d/.test(words[0])) return cleaned.slice(-2)
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase()
}

const AVATAR_COLORS = ['#5B2BC9', '#7C3AED', '#9333EA', '#C026D3', '#DB2777', '#E11D48', '#EA580C', '#0891B2', '#0D9488', '#16A34A']

/** Stable per-contact colour, derived from the number so it never shifts. */
function avatarColor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function Avatar({ seed, label, size = 40 }: { seed: string; label: string; size?: number }) {
  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center text-white font-bold"
      style={{ width: size, height: size, background: avatarColor(seed), fontSize: size * 0.34 }}
      aria-hidden
    >
      {initials(label)}
    </div>
  )
}

/* ── attachment blobs ─────────────────────────────────────────────────────
   /whatsapp-media/:messageId is authenticated, so the bytes have to come
   through the axios client (which attaches the bearer token) rather than a
   bare <img src>. Object URLs are cached by WhatsApp message id so that
   polling, re-renders and scrolling never refetch the same file, and are
   revoked wholesale when the page unmounts. */
const mediaUrls = new Map<string, string>()
const mediaPending = new Map<string, Promise<string>>()

function loadMediaUrl(messageId: string): Promise<string> {
  const cached = mediaUrls.get(messageId)
  if (cached) return Promise.resolve(cached)
  let p = mediaPending.get(messageId)
  if (!p) {
    p = api
      .get(`/whatsapp-media/${encodeURIComponent(messageId)}`, { responseType: 'blob' })
      .then((r) => {
        const url = URL.createObjectURL(r.data as Blob)
        mediaUrls.set(messageId, url)
        return url
      })
      .finally(() => { mediaPending.delete(messageId) })
    mediaPending.set(messageId, p)
  }
  return p
}

function revokeAllMedia() {
  for (const url of mediaUrls.values()) URL.revokeObjectURL(url)
  mediaUrls.clear()
  mediaPending.clear()
}

/** Renders one attachment. Mounts only for messages actually on screen, and
 *  the fetch starts on mount — so loading is lazy per rendered message. */
function Attachment({ messageId, media }: { messageId: string; media: WaMedia }) {
  const [url, setUrl] = useState<string | null>(() => mediaUrls.get(messageId) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const cached = mediaUrls.get(messageId)
    if (cached) { setUrl(cached); setFailed(false); return }
    let alive = true
    setUrl(null)
    setFailed(false)
    loadMediaUrl(messageId)
      .then((u) => { if (alive) setUrl(u) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [messageId])

  const caption = media.caption ? (
    <p className="whitespace-pre-wrap break-words mt-1">{media.caption}</p>
  ) : null

  if (failed) {
    return (
      <p className="text-xs italic" style={{ color: FAINT_INK }}>
        Attachment unavailable
      </p>
    )
  }

  if (!url) {
    return (
      <div
        className="flex items-center justify-center rounded-lg text-[11px] h-16 w-40 animate-pulse"
        style={{
          background: 'rgba(20,8,31,.07)',
          color: FAINT_INK,
        }}
      >
        Loading {media.kind}…
      </div>
    )
  }

  if (media.kind === 'image' || media.kind === 'sticker') {
    return (
      <div>
        <img
          src={url}
          alt={media.filename || media.kind}
          onClick={() => window.open(url, '_blank', 'noopener')}
          className={cn('wa-thumb rounded-lg object-contain', media.kind === 'sticker' ? 'max-h-32' : 'max-h-64')}
        />
        {caption}
      </div>
    )
  }

  if (media.kind === 'video') {
    return (
      <div>
        <video src={url} controls className="rounded-lg max-h-64 max-w-full" />
        {caption}
      </div>
    )
  }

  if (media.kind === 'audio' || media.kind === 'voice') {
    return (
      <div>
        <audio src={url} controls className="max-w-[240px]" />
        {caption}
      </div>
    )
  }

  return (
    <div>
      <a
        href={url}
        download={media.filename || 'document'}
        className="wa-doc inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
        style={{ background: 'rgba(20,8,31,.05)' }}
      >
        <FileText size={16} />
        <span className="truncate max-w-[200px]">{media.filename || 'Document'}</span>
      </a>
      {caption}
    </div>
  )
}

/* ── notification sound ───────────────────────────────────────────────────
   A real asset (public/whatsappaduio.mp3) played through one shared
   HTMLAudioElement. Browsers refuse playback before a user gesture, so the
   element is primed with a muted play/pause on the first interaction, and
   every failure is swallowed — audio must never break the inbox. */
let pingEl: HTMLAudioElement | null = null
let pingPrimed = false

function getPingElement(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  if (!pingEl) {
    try {
      pingEl = new Audio(PING_SRC)
      pingEl.preload = 'auto'
    } catch {
      return null
    }
  }
  return pingEl
}

/** Muted play/pause on a gesture so later programmatic plays are allowed. */
function primePing() {
  if (pingPrimed) return
  const el = getPingElement()
  if (!el) return
  pingPrimed = true
  try {
    el.muted = true
    const p = el.play()
    const settle = () => { try { el.pause(); el.currentTime = 0 } catch { /* ignore */ } el.muted = false }
    if (p && typeof p.then === 'function') p.then(settle, () => { el.muted = false })
    else settle()
  } catch {
    el.muted = false
  }
}

function playPing() {
  const el = getPingElement()
  if (!el) return
  try {
    el.currentTime = 0 // otherwise a second message plays from the finished end
    const p = el.play()
    if (p && typeof p.catch === 'function') p.catch(() => { /* blocked — never mind */ })
  } catch {
    /* audio is a nicety — never let it break the inbox */
  }
}

function readSeen(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/* ── small presentational helpers ─────────────────────────────────────── */
function IconButton({
  title, onClick, children, tone = 'light', className,
}: {
  title: string
  onClick: () => void
  children: ReactNode
  tone?: 'light' | 'dark'
  className?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn('inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer h-8 w-8', className)}
      style={
        tone === 'dark'
          ? { background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)', color: '#fff' }
          : { background: '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0' }
      }
    >
      {children}
    </button>
  )
}

function MessageBubble({ msg }: { msg: WaMsg }) {
  const out = msg.direction === 'outbound'
  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className="max-w-[75%] rounded-2xl px-3.5 py-2 text-sm"
        style={
          out
            // WhatsApp's own outgoing green, with dark text — white on this
            // tint fails contrast badly.
            ? { background: '#D9FDD3', color: INK, borderBottomRightRadius: 6, boxShadow: '0 1px 2px rgba(20,8,31,.10)' }
            : { background: '#fff', color: INK, borderBottomLeftRadius: 6, border: `1px solid ${LINE}`, boxShadow: '0 1px 2px rgba(20,8,31,.06)' }
        }
      >
        {/* A deleted message keeps its place in the thread — the gap where it
            was is part of the conversation — but its content is gone. */}
        {msg.deletedAt ? (
          <p className="italic opacity-60">This message was deleted</p>
        ) : msg.media ? (
          <Attachment messageId={msg.messageId} media={msg.media} />
        ) : (
          <p className="whitespace-pre-wrap break-words">
            {msg.text || <span className="italic opacity-60">[{msg.type}]</span>}
          </p>
        )}
        {!msg.deletedAt && msg.media && msg.text && !msg.media.caption && (
          <p className="whitespace-pre-wrap break-words mt-1">{msg.text}</p>
        )}
        <div
          className="flex items-center justify-end gap-1 mt-1 text-[10px]"
          style={{ color: out ? 'rgba(20,8,31,.45)' : FAINT_INK }}
          title={out ? msg.status || 'sent' : undefined}
        >
          {msg.editedAt && !msg.deletedAt && <span className="italic">edited</span>}
          {/* Say when the assistant wrote it. Letting an AI reply pass as a
              colleague's is the kind of thing people mind afterwards. */}
          {msg.sentByAi && (
            <span className="inline-flex items-center gap-0.5" title="Written by the AI assistant">
              <Bot size={11} /> AI
            </span>
          )}
          <span>{formatClock(msg.occurredAt)}</span>
          {/* Grey until read, then WhatsApp's blue — the same signal people
              already read without being told. */}
          {out && <CheckCheck size={13} style={{ color: msg.status === 'read' ? '#53BDEB' : 'rgba(20,8,31,.35)' }} />}
        </div>
        {msg.reaction && (
          <div className={cn('flex -mb-1 mt-0.5', out ? 'justify-end' : 'justify-start')}>
            <span
              className="inline-flex items-center rounded-full px-1.5 py-0.5"
              style={{ background: '#fff', border: `1px solid ${LINE}`, fontSize: 12, lineHeight: 1.2, boxShadow: '0 1px 2px rgba(20,8,31,.08)' }}
              title="Reaction"
            >
              {msg.reaction}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// One button that walks a chat through the pipeline: no lead yet → create one;
// lead exists → convert it to a customer; already won → just link to the record.
function LeadAction({ convo, onChanged }: { convo: WhatsAppConversation; onChanged: () => void }) {
  const [err, setErr] = useState('')

  const createLead = useMutation({
    mutationFn: () => {
      const name = window.prompt('Name for this lead', convo.phone || `+${convo.phoneNormalized}`)
      if (name === null) return Promise.reject(new Error('cancelled'))
      return whatsappApi.createLead(convo.phoneNormalized, name.trim() || undefined)
    },
    onSuccess: () => { setErr(''); onChanged() },
    onError: (e) => { if ((e as Error).message !== 'cancelled') setErr(apiError(e)) },
  })

  const convert = useMutation({
    mutationFn: () => leadApi.convertToCustomer(convo.lead!._id),
    onSuccess: () => { setErr(''); onChanged() },
    onError: (e) => setErr(apiError(e)),
  })

  const pill = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed'

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {err && <span className="text-xs text-red-600 max-w-[220px] truncate" title={err}>{err}</span>}
      {!convo.lead ? (
        <button
          type="button"
          className={pill}
          style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0' }}
          disabled={createLead.isPending}
          onClick={() => createLead.mutate()}
        >
          <UserPlus size={13} /> {createLead.isPending ? 'Creating…' : 'Create lead'}
        </button>
      ) : convo.lead.status === 'won' ? (
        <Link
          to={`/leads?q=${encodeURIComponent(convo.lead.fullName)}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
          style={{ color: '#047857' }}
        >
          <UserCheck size={13} /> {convo.lead.fullName}
        </Link>
      ) : (
        <>
          <span className="text-xs hidden sm:inline" style={{ color: FAINT_INK }}>Lead: {convo.lead.fullName}</span>
          <button
            type="button"
            className={pill}
            style={{ background: '#5B2BC9', color: '#fff' }}
            disabled={convert.isPending}
            onClick={() => convert.mutate()}
          >
            <UserCheck size={13} /> {convert.isPending ? 'Saving…' : 'Save as customer'}
          </button>
        </>
      )}
    </div>
  )
}

export default function WhatsApp() {
  const qc = useQueryClient()
  // The last chat opened, so returning to the inbox lands where you left off
  // instead of on a combined feed of everyone.
  const LAST_CHAT_KEY = 'wa_last_chat'
  const [selectedPhone, setSelectedPhone] = useState<string | null>(
    () => localStorage.getItem(LAST_CHAT_KEY) || null
  )
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem(MUTE_KEY) === '1')
  const [lastSeen, setLastSeen] = useState<Record<string, string>>(readSeen)
  const [blinking, setBlinking] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  // Composer height, dragged from the bar above it. Persisted so it stays
  // where you left it; clamped so it can never swallow the whole chat.
  const COMPOSER_MIN = 44
  const COMPOSER_MAX = 420
  const [composerH, setComposerH] = useState(() => {
    const saved = Number(localStorage.getItem('wa_composer_h'))
    return Number.isFinite(saved) && saved >= COMPOSER_MIN ? Math.min(saved, COMPOSER_MAX) : COMPOSER_MIN
  })
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: composerH }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    // Dragging up (a smaller clientY) makes it taller.
    const next = Math.min(COMPOSER_MAX, Math.max(COMPOSER_MIN, d.startH + (d.startY - e.clientY)))
    setComposerH(next)
  }
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
    localStorage.setItem('wa_composer_h', String(composerH))
  }
  const [sendErr, setSendErr] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [catOpen, setCatOpen] = useState<Record<string, boolean>>({ templates: true })
  const [custom, setCustom] = useState('')
  // Numbers typed via "New chat" have no conversation record yet.
  const [adhocPhone, setAdhocPhone] = useState<string | null>(null)

  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const selectedRef = useRef(selectedPhone)
  selectedRef.current = selectedPhone

  const { data: conversations, isLoading: loadingConvos, refetch: refetchConvos } = useQuery<WhatsAppConversation[]>({
    queryKey: ['wa-conversations'],
    queryFn: () => whatsappApi.conversations(),
    refetchInterval: 15_000,
  })

  // Whole-inbox feed: drives unread counts, the blink and the ping. When no
  // conversation is selected this shares its cache entry with the chat query
  // below, so it costs no extra request in that case.
  const { data: allMessages } = useQuery<WaMsg[]>({
    queryKey: ['wa-messages', null],
    queryFn: () => whatsappApi.messages(),
    refetchInterval: 10_000,
  })

  const { data: messages, isLoading: loadingMsgs } = useQuery<WaMsg[]>({
    queryKey: ['wa-messages', selectedPhone],
    queryFn: () => whatsappApi.messages(selectedPhone ?? undefined),
    refetchInterval: 10_000,
    enabled: true,
  })

  // WhatsApp quick replies are their own kind of template, kept apart from
  // the contract ones the reminder engine sends — different audience,
  // different wording. Managed under Settings → Message Templates.
  const { data: templates } = useQuery<MessageTemplate[]>({
    queryKey: ['message-templates', 'quick_reply'],
    queryFn: () => api.get('/message-templates', { params: { kind: 'quick_reply' } }).then((r) => r.data ?? []),
    staleTime: 60_000,
  })

  const quickReplies = useMemo(
    () => (templates ?? []).filter((t) => (t.whatsappBody ?? '').trim().length > 0),
    [templates]
  )

  // Grouped for the panel, keeping the server's order inside each group.
  const quickReplyGroups = useMemo(() => {
    const groups = new Map<string, MessageTemplate[]>()
    for (const t of quickReplies) {
      const cat = (t.category || '').trim() || 'Other'
      if (!groups.has(cat)) groups.set(cat, [])
      groups.get(cat)!.push(t)
    }
    return [...groups.entries()]
  }, [quickReplies])

  // Free every attachment blob when the inbox is left.
  useEffect(() => revokeAllMedia, [])

  // Browsers only allow audio after a gesture — prime the element on the first one.
  useEffect(() => {
    const warm = () => { primePing() }
    window.addEventListener('pointerdown', warm)
    window.addEventListener('keydown', warm)
    return () => {
      window.removeEventListener('pointerdown', warm)
      window.removeEventListener('keydown', warm)
    }
  }, [])

  /* New-message detection: the ids present on the first successful load form
     the baseline, so nothing fires on mount/navigation. Every later poll that
     introduces an id we have not seen before, and whose direction is inbound,
     counts as new — outbound messages (including our own sends) never ping. */
  const seenIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!allMessages) return
    if (seenIds.current === null) {
      seenIds.current = new Set(allMessages.map((m) => m._id))
      return
    }
    const fresh = allMessages.filter((m) => !seenIds.current!.has(m._id))
    if (fresh.length === 0) return
    for (const m of fresh) seenIds.current!.add(m._id)
    const inbound = fresh.filter((m) => m.direction === 'inbound')
    if (inbound.length === 0) return
    if (!mutedRef.current) playPing()
    const until = Date.now() + BLINK_MS
    setBlinking((prev) => {
      const next = { ...prev }
      for (const m of inbound) if (m.phoneNormalized !== selectedRef.current) next[m.phoneNormalized] = until
      return next
    })
  }, [allMessages])

  // Retire blink markers once their window has elapsed.
  useEffect(() => {
    if (Object.keys(blinking).length === 0) return
    const t = window.setTimeout(() => {
      const now = Date.now()
      setBlinking((prev) => {
        const next: Record<string, number> = {}
        for (const [phone, until] of Object.entries(prev)) if (until > now) next[phone] = until
        return Object.keys(next).length === Object.keys(prev).length ? prev : next
      })
    }, BLINK_MS + 200)
    return () => window.clearTimeout(t)
  }, [blinking])

  const markSeen = useCallback((phone: string, iso: string) => {
    setLastSeen((prev) => {
      if (prev[phone] && new Date(prev[phone]).getTime() >= new Date(iso).getTime()) return prev
      const next = { ...prev, [phone]: iso }
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(next)) } catch { /* quota — ignore */ }
      return next
    })
  }, [])

  // Anything arriving in the open conversation is read on arrival.
  useEffect(() => {
    if (!selectedPhone || !messages || messages.length === 0) return
    const newest = messages.reduce((a, m) => (m.occurredAt > a ? m.occurredAt : a), messages[0].occurredAt)
    markSeen(selectedPhone, newest)
    setBlinking((prev) => (prev[selectedPhone] ? Object.fromEntries(Object.entries(prev).filter(([p]) => p !== selectedPhone)) : prev))
  }, [selectedPhone, messages, markSeen])

  const unreadByPhone = useMemo(() => {
    const out: Record<string, number> = {}
    for (const m of allMessages ?? []) {
      if (m.direction !== 'inbound') continue
      const seen = lastSeen[m.phoneNormalized]
      if (seen && new Date(m.occurredAt).getTime() <= new Date(seen).getTime()) continue
      out[m.phoneNormalized] = (out[m.phoneNormalized] ?? 0) + 1
    }
    return out
  }, [allMessages, lastSeen])

  const totalUnread = useMemo(
    () => Object.values(unreadByPhone).reduce((a, b) => a + b, 0),
    [unreadByPhone]
  )

  // Last inbound/outbound line per chat, for the list preview.
  const previewByPhone = useMemo(() => {
    const out: Record<string, string> = {}
    for (const m of allMessages ?? []) {
      const prev = out[m.phoneNormalized]
      if (prev !== undefined) continue
      out[m.phoneNormalized] = m.text?.trim() || (m.media ? `[${m.media.kind}]` : `[${m.type}]`)
    }
    return out
  }, [allMessages])

  function onSent() {
    qc.invalidateQueries({ queryKey: ['wa-messages'] })
    qc.invalidateQueries({ queryKey: ['wa-conversations'] })
  }

  function toggleMute() {
    setMuted((m) => {
      const next = !m
      try { localStorage.setItem(MUTE_KEY, next ? '1' : '0') } catch { /* ignore */ }
      if (!next) primePing()
      return next
    })
  }

  const sorted = useMemo(
    () => [...(messages ?? [])].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()),
    [messages]
  )

  // Newest activity first, so an incoming message floats its chat to the top.
  const convoList = useMemo(
    () => [...(conversations ?? [])].sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()),
    [conversations]
  )

  const filteredConvos = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return convoList
    return convoList.filter((c) => {
      const name = (convDisplayName(c) ?? '').toLowerCase()
      return name.includes(q) || c.phoneNormalized.includes(q) || (c.phone ?? '').toLowerCase().includes(q)
    })
  }, [convoList, search])

  const realConvo = convoList.find((c) => c.phoneNormalized === selectedPhone) ?? null
  // A number typed into "New chat" behaves like an empty conversation so the
  // composer and the lead action keep working before the first message lands.
  const selectedConvo: WhatsAppConversation | null =
    realConvo ??
    (selectedPhone && selectedPhone === adhocPhone
      ? { phoneNormalized: selectedPhone, phone: `+${selectedPhone}`, count: 0, lastAt: new Date().toISOString(), lead: null }
      : null)

  const convoTitle = selectedConvo
    ? convDisplayName(selectedConvo)
    : 'All messages'

  /* Auto-scroll: follow the newest message, unless the reader has scrolled up
     into history — then leave their position alone. */
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !stickToBottom.current) return
    el.scrollTop = el.scrollHeight
  }, [sorted, selectedPhone])

  // Auto-growing composer, capped at 110px.
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 110)}px`
  }, [draft])

  function openConversation(phone: string) {
    // Clicking the open chat used to deselect it, which dropped you back to
    // the all-messages feed. There is nowhere to fall back to now, so it
    // simply stays open.
    const next = phone
    stickToBottom.current = true
    setSelectedPhone(next)
    localStorage.setItem(LAST_CHAT_KEY, next)
    setSendErr('')
    setSidebarOpen(false)
    if (next) {
      const convo = convoList.find((c) => c.phoneNormalized === next)
      if (convo) markSeen(next, convo.lastAt)
      setBlinking((prev) => Object.fromEntries(Object.entries(prev).filter(([p]) => p !== next)))
    }
  }

  function startNewChat() {
    const raw = window.prompt('WhatsApp number with country code', '971')
    if (raw === null) return
    const digits = raw.replace(/\D/g, '')
    if (!digits) return
    setAdhocPhone(digits)
    stickToBottom.current = true
    setSelectedPhone(digits)
    setSendErr('')
    setSidebarOpen(false)
  }

  // Outbound attachment: picked here, uploaded to Meta by the server, which
  // returns once the message is actually sent.
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [pending, setPending] = useState<File | null>(null)
  const [preview, setPreview] = useState<string>('')

  useEffect(() => {
    if (!pending || !pending.type.startsWith('image/')) { setPreview(''); return }
    const url = URL.createObjectURL(pending)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [pending])

  const sendMedia = useMutation({
    mutationFn: async (payload: { to: string; file: File; caption: string }) => {
      const form = new FormData()
      form.append('to', payload.to)
      form.append('file', payload.file)
      if (payload.caption) form.append('caption', payload.caption)
      return api.post('/whatsapp/send-media', form).then((r) => r.data)
    },
    onSuccess: () => {
      setSendErr(''); setPending(null); setDraft('')
      if (fileRef.current) fileRef.current.value = ''
      stickToBottom.current = true
      onSent()
    },
    onError: (e) => setSendErr(apiError(e)),
  })

  const send = useMutation({
    mutationFn: (payload: { to: string; body: string }) => whatsappApi.send(payload.to, payload.body),
    onSuccess: () => { setSendErr(''); stickToBottom.current = true; onSent() },
    onError: (e) => setSendErr(apiError(e)),
  })

  // Clearing a suggestion is a server-side change: the draft lives on the
  // thread, so dismissing it locally would only have it reappear on the next
  // poll.
  const dismissDraft = useMutation({
    mutationFn: (phone: string) => api.post(`/ai-bot/threads/${phone}/dismiss-draft`).then((r) => r.data),
    onSuccess: () => onSent(),
  })

  function sendText(body: string) {
    const text = body.trim()
    if (!text) return
    if (!selectedPhone) { setSendErr('Pick a conversation first, or start a new chat.'); return }
    send.mutate({ to: selectedPhone, body: text })
  }

  function sendComposer() {
    if (send.isPending || sendMedia.isPending) return
    if (!selectedPhone) { setSendErr('Pick a conversation first, or start a new chat.'); return }
    // With a file attached the draft becomes its caption, so one press sends
    // both rather than the text going out as a separate message.
    if (pending) {
      sendMedia.mutate({ to: selectedPhone, file: pending, caption: draft.trim() })
      return
    }
    const text = draft.trim()
    if (!text) return
    setDraft('')
    send.mutate({ to: selectedPhone, body: text })
  }

  function insertText(text: string) {
    setDraft((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n${text}` : text))
    window.setTimeout(() => taRef.current?.focus(), 0)
  }

  return (
    <div
      className="flex flex-col rounded-2xl overflow-hidden h-[calc(100vh-5rem)] md:h-[calc(100vh-5.5rem)] min-h-[520px]"
      style={{ border: `1px solid ${LINE}`, background: '#fff', boxShadow: '0 6px 28px rgba(20,8,31,.07)' }}
    >
      <style>{CSS}</style>

      {/* ── 1. Top bar ─────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center justify-between gap-3 px-4"
        style={{ height: 60, background: '#1A0B33', color: '#fff' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            className="wa-mobile-only items-center justify-center h-8 w-8 rounded-lg cursor-pointer"
            style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)', color: '#fff' }}
            aria-label="Show chats"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Menu size={16} />
          </button>
          <div
            className="shrink-0 flex items-center justify-center"
            style={{ width: 30, height: 30, borderRadius: 9, background: '#5B2BC9' }}
            aria-hidden
          >
            <MessageSquare size={16} color="#fff" />
          </div>
          <div className="min-w-0 leading-tight">
            <div style={{ fontFamily: "'Bricolage Grotesque', serif", fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>
              PurpleBox
            </div>
            <div className="text-[11px] truncate" style={{ color: '#A78BFA' }}>
              WhatsApp Console{totalUnread > 0 ? ` · ${totalUnread} unread` : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <IconButton title={muted ? 'Notification sound is off' : 'Notification sound is on'} tone="dark" onClick={toggleMute}>
            {muted ? <BellOff size={15} /> : <Bell size={15} />}
          </IconButton>
          <IconButton
            title="Refresh"
            tone="dark"
            onClick={() => { refetchConvos(); qc.invalidateQueries({ queryKey: ['wa-messages'] }) }}
          >
            <RefreshCw size={15} />
          </IconButton>

          <div className="relative">
            <button
              type="button"
              onClick={() => setSetupOpen((v) => !v)}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
              style={{
                background: 'rgba(255,255,255,.08)',
                border: '1px solid rgba(255,255,255,.14)',
                borderRadius: 999,
                fontSize: 12,
              }}
              title="Setup checklist"
            >
              <span className="shrink-0 rounded-full" style={{ width: 7, height: 7, background: '#F5A524' }} aria-hidden />
              <span className="hidden sm:inline">Test mode — recipient must be added in Meta dashboard</span>
              <span className="sm:hidden">Test mode</span>
              <Info size={13} style={{ opacity: 0.7 }} />
            </button>

            {setupOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-[340px] max-w-[85vw] rounded-xl p-3.5 text-xs z-50 space-y-2"
                style={{ background: '#fff', color: MUTED_INK, border: `1px solid ${LINE}`, boxShadow: '0 12px 34px rgba(20,8,31,.2)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold" style={{ color: INK, fontSize: 13 }}>Setup checklist</span>
                  <button type="button" className="cursor-pointer" onClick={() => setSetupOpen(false)} aria-label="Close">
                    <X size={14} />
                  </button>
                </div>
                <p>1. Enter your phone number ID, access token, verify token and app secret under <strong>Settings → Integrations</strong>.</p>
                <p>2. In Meta Dashboard → WhatsApp → Configuration → Webhook, set the Callback URL to <code style={{ background: '#F7F3FF', padding: '1px 4px', borderRadius: 4 }}>https://api.purplebox.ae/api/integrations/whatsapp/webhook</code></p>
                <p>3. Set the Verify Token there to the same string you entered in Settings.</p>
                <p>4. Subscribe to the <strong>messages</strong> field under Webhook Fields.</p>
                <p style={{ color: '#B45309' }}>On a Meta test number you can only message 5 pre-registered recipients. A verified business number has no such limit.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── columns ────────────────────────────────────────────────── */}
      <div
        className="relative flex flex-1 min-h-0"
        style={{ flexDirection: 'row', flexWrap: 'nowrap' }}
      >

        {/* 2. Sidebar */}
        <aside
          className={cn('wa-sidebar flex flex-col min-h-0', sidebarOpen && 'wa-sidebar-open')}
          style={{ flex: '0 0 300px', width: 300, background: '#fff', borderRight: `1px solid ${LINE}` }}
        >
          <div className="shrink-0 px-4 pt-4 pb-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 style={{ fontFamily: "'Bricolage Grotesque', serif", fontWeight: 700, fontSize: 19, color: INK }}>Chats</h2>
              <IconButton title="New chat" onClick={startNewChat}><Plus size={15} /></IconButton>
            </div>
            <div className="relative">
              <Search size={14} style={{ color: FAINT_INK }} className="absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or number"
                className="w-full pl-8 pr-3 py-2 text-[13px] focus:outline-none"
                style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', borderRadius: 10, color: INK }}
              />
            </div>
          </div>

          <div className="wa-scroll flex-1 min-h-0">
            {loadingConvos ? (
              <p className="px-4 py-3 text-sm" style={{ color: FAINT_INK }}>Loading…</p>
            ) : filteredConvos.length === 0 ? (
              <p className="px-4 py-3 text-xs" style={{ color: FAINT_INK }}>
                {convoList.length === 0 ? 'No conversations yet. Start a new chat.' : 'No chats match that search.'}
              </p>
            ) : (
              filteredConvos.map((c) => {
                const unread = unreadByPhone[c.phoneNormalized] ?? 0
                const isSelected = c.phoneNormalized === selectedPhone
                const label = convDisplayName(c)
                const isUnread = unread > 0 && !isSelected
                return (
                  <button
                    key={c.phoneNormalized}
                    onClick={() => openConversation(c.phoneNormalized)}
                    className={cn(
                      'wa-row w-full text-left px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-colors',
                      blinking[c.phoneNormalized] ? 'wa-blink' : ''
                    )}
                    style={isSelected ? { background: '#F3EDFF' } : undefined}
                  >
                    <Avatar seed={c.phoneNormalized} label={label} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        {isUnread && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: '#5B2BC9' }} aria-hidden />}
                        <span
                          className="truncate flex-1"
                          style={{ fontSize: 14, fontWeight: isUnread ? 800 : 600, color: INK }}
                        >
                          {label}
                        </span>
                        <span className="shrink-0" style={{ fontSize: 11, color: FAINT_INK }}>{formatListTime(c.lastAt)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="truncate flex-1" style={{ fontSize: 12, color: MUTED_INK }}>
                          {previewByPhone[c.phoneNormalized] ?? `${c.count} messages`}
                        </span>
                        {/* The assistant is waiting on someone, or has one
                            ready to send — both need a person, so both are
                            visible without opening the thread. */}
                        {c.botStatus === 'escalated' ? (
                          <span className="shrink-0 rounded-full px-1.5 py-0.5"
                            style={{ fontSize: 10, fontWeight: 700, background: '#FFF1CC', color: '#8A5A00' }}
                            title={c.botEscalationReason || 'The assistant handed this over'}>
                            Needs you
                          </span>
                        ) : c.botDraft ? (
                          <span className="shrink-0 rounded-full px-1.5 py-0.5"
                            style={{ fontSize: 10, fontWeight: 700, background: '#EDE5FF', color: '#4A1FA0' }}
                            title="A suggested reply is waiting">
                            Reply ready
                          </span>
                        ) : null}
                        {c.lead && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5"
                            style={
                              c.lead.status === 'won'
                                ? { fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#047857' }
                                : { fontSize: 10, fontWeight: 700, background: '#F3EDFF', color: '#4A1FA0' }
                            }
                          >
                            {c.lead.status === 'won' ? 'Customer' : 'Lead'}
                          </span>
                        )}
                        {isUnread && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-white"
                            style={{ fontSize: 10, fontWeight: 700, background: '#5B2BC9' }}
                          >
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {sidebarOpen && <div className="wa-scrim" onClick={() => setSidebarOpen(false)} aria-hidden />}

        {/* 3. Chat pane */}
        <section className="flex flex-col flex-1 min-w-0 min-h-0" style={{ background: '#F6F0E4' }}>
          <header
            className="shrink-0 flex items-center gap-3 px-4"
            style={{ height: 64, background: '#fff', borderBottom: `1px solid ${LINE}` }}
          >
            {selectedConvo ? (
              <>
                <Avatar seed={selectedConvo.phoneNormalized} label={convoTitle} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate" style={{ fontSize: 15, fontWeight: 700, color: INK }}>{convoTitle}</span>
                    {selectedConvo.lead?.status === 'won' && (
                      <span className="shrink-0 rounded-full px-2 py-0.5" style={{ fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#047857' }}>
                        Customer
                      </span>
                    )}
                  </div>
                  <div className="truncate" style={{ fontSize: 12, color: FAINT_INK }}>+{selectedConvo.phoneNormalized}</div>
                </div>
                <LeadAction convo={selectedConvo} onChanged={onSent} />
              </>
            ) : (
              <div className="min-w-0 flex-1">
                <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>No chat open</div>
                <div style={{ fontSize: 12, color: FAINT_INK }}>Pick a conversation on the left</div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setQrOpen((v) => !v)}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 cursor-pointer"
              style={{ fontSize: 12, fontWeight: 600, background: '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0' }}
              title="Quick replies"
            >
              <Zap size={13} /> <span className="hidden sm:inline">Quick replies</span>
            </button>
          </header>

          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="wa-scroll flex-1 min-h-0 flex flex-col gap-[10px]"
            style={{
              padding: '22px 26px',
              // Tiled wallpaper behind the bubbles, over the cream base so the
              // tile's own edges never show as bands.
              backgroundColor: '#F6F0E4',
              // A cream wash over the tile knocks the pattern back so the
              // bubbles stay the thing you read.
              backgroundImage: 'linear-gradient(rgba(246,240,228,.82), rgba(246,240,228,.82)), url(/chat-bg.avif)',
              backgroundRepeat: 'repeat, repeat',
              backgroundSize: 'auto, 400px auto',
            }}
          >
            {!selectedPhone ? (
              /* One combined feed of every contact was never useful to reply
                 from — a chat is always chosen now, and the last one is
                 remembered between visits. */
              <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: FAINT_INK }}>
                <MessageSquare size={22} />
                <p className="text-sm">Pick a conversation on the left to read and reply.</p>
              </div>
            ) : loadingMsgs ? (
              <p className="text-sm" style={{ color: FAINT_INK }}>Loading…</p>
            ) : sorted.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: FAINT_INK }}>
                <MessageSquare size={22} />
                <p className="text-sm">No messages yet.</p>
              </div>
            ) : (
              sorted.map((m) => <MessageBubble key={m._id} msg={m} />)
            )}
          </div>

          {sendErr && (
            <p className="shrink-0 px-6 pb-1 text-xs" style={{ color: '#B91C1C' }}>{sendErr}</p>
          )}

          {/* The assistant handed this thread over. Shown rather than silently
              going quiet, so nobody wonders why it stopped replying. */}
          {selectedConvo?.botStatus === 'escalated' && (
            <div className="shrink-0 mx-6 mb-2 flex items-start gap-2 rounded-xl px-3.5 py-2.5"
              style={{ background: '#FFF7E6', border: '1px solid #F5D9A0' }}>
              <UserCheck size={15} style={{ color: '#8A5A00', flex: '0 0 auto', marginTop: 1 }} />
              <div className="min-w-0" style={{ fontSize: 12.5, color: '#6B4500' }}>
                <span style={{ fontWeight: 700 }}>Waiting for a person.</span>{' '}
                {selectedConvo.botEscalationReason || 'The assistant could not answer this one.'}
              </div>
            </div>
          )}

          {/* A suggested reply. It is never sent on its own — someone reads it
              and presses Send, or edits it in the composer first. */}
          {selectedConvo?.botDraft && (
            <div className="shrink-0 mx-6 mb-2 rounded-xl px-3.5 py-3"
              style={{ background: '#F3EEFF', border: '1px solid #D9CBFA' }}>
              <div className="flex items-center gap-1.5 mb-1.5" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#4A1FA0' }}>
                <Bot size={13} /> Suggested reply
              </div>
              <div className="whitespace-pre-wrap" style={{ fontSize: 13, color: MUTED_INK }}>
                {selectedConvo.botDraft}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <button type="button"
                  onClick={() => sendText(selectedConvo.botDraft!)}
                  disabled={send.isPending}
                  className="h-7 px-3 rounded-full text-white cursor-pointer disabled:opacity-50"
                  style={{ background: '#5B2BC9', fontSize: 12, fontWeight: 700 }}>
                  Send
                </button>
                <button type="button"
                  onClick={() => { insertText(selectedConvo.botDraft!); dismissDraft.mutate(selectedConvo.phoneNormalized) }}
                  className="h-7 px-3 rounded-full cursor-pointer"
                  style={{ border: `1px solid ${LINE}`, background: '#fff', fontSize: 12, fontWeight: 600, color: MUTED_INK }}>
                  Edit
                </button>
                <button type="button"
                  onClick={() => dismissDraft.mutate(selectedConvo.phoneNormalized)}
                  className="h-7 px-2.5 rounded-full cursor-pointer"
                  style={{ fontSize: 12, fontWeight: 600, color: FAINT_INK }}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Drag upward to make the message box taller — long replies are
              painful in a one-line field. Double-click resets it. */}
          <div
            className="wa-grip shrink-0"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            onDoubleClick={() => { setComposerH(COMPOSER_MIN); localStorage.setItem('wa_composer_h', String(COMPOSER_MIN)) }}
            title="Drag up to expand the message box · double-click to reset"
            role="separator"
            aria-orientation="horizontal"
            style={{ background: '#fff', borderTop: `1px solid ${LINE}` }}
          >
            <span className="wa-grip-bar" />
          </div>

          {pending && (
            <div
              className="shrink-0 flex items-center gap-3 px-4 py-2"
              style={{ background: '#fff', borderTop: `1px solid ${LINE}` }}
            >
              {preview ? (
                <img src={preview} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }} />
              ) : (
                <span
                  className="inline-flex items-center justify-center shrink-0"
                  style={{ width: 44, height: 44, borderRadius: 8, background: '#F7F3FF' }}
                >
                  <Paperclip size={18} style={{ color: '#5B2BC9' }} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 13, fontWeight: 600, color: INK }}>{pending.name}</div>
                <div style={{ fontSize: 11.5, color: FAINT_INK }}>
                  {(pending.size / 1024 / 1024).toFixed(2)} MB
                  {pending.size > 16 * 1024 * 1024 && ' · too large, WhatsApp allows 16 MB'}
                  {' · the message box becomes its caption'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setPending(null); if (fileRef.current) fileRef.current.value = '' }}
                className="shrink-0 cursor-pointer"
                style={{ color: FAINT_INK }}
                title="Remove attachment"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <div
            className="shrink-0 flex items-end gap-2 px-4 pb-3 pt-1"
            style={{ background: '#fff' }}
          >
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) { setPending(f); setSendErr('') }
              }}
            />
            <IconButton
              title="Attach a photo, video, audio or document"
              onClick={() => fileRef.current?.click()}
              className="!h-10 !w-10 shrink-0"
            >
              <Paperclip size={16} />
            </IconButton>
            <IconButton title="Quick replies" onClick={() => setQrOpen((v) => !v)} className="!h-10 !w-10 shrink-0">
              <Zap size={16} />
            </IconButton>
            <textarea
              ref={taRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComposer() }
              }}
              placeholder={pending ? 'Add a caption (optional)…' : selectedPhone ? 'Type a message…' : 'Pick a chat to start typing…'}
              className="flex-1 resize-none px-4 py-2.5 text-sm focus:outline-none"
              style={{
                background: '#F7F3FF',
                border: '1px solid #EDE5FF',
                borderRadius: composerH > 80 ? 14 : 20,
                height: composerH,
                color: INK,
                lineHeight: 1.4,
              }}
            />
            <button
              type="button"
              onClick={sendComposer}
              disabled={send.isPending || sendMedia.isPending || (!draft.trim() && !pending) || !selectedPhone}
              className="shrink-0 inline-flex items-center justify-center rounded-full cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              style={{ width: 44, height: 44, background: '#5B2BC9', color: '#fff' }}
              aria-label="Send"
              title="Send"
            >
              <Send size={18} />
            </button>
          </div>
        </section>

        {/* 4. Quick replies */}
        {qrOpen && (
          <aside
            className="wa-qr flex flex-col min-h-0"
            style={{ flex: '0 0 320px', background: '#fff', borderLeft: `1px solid ${LINE}` }}
          >
            <div className="shrink-0 flex items-start gap-2 px-4 py-3.5" style={{ borderBottom: `1px solid ${LINE}` }}>
              <div className="min-w-0 flex-1">
                <h2 style={{ fontFamily: "'Bricolage Grotesque', serif", fontWeight: 700, fontSize: 17, color: INK }}>Quick replies</h2>
                <p style={{ fontSize: 11.5, color: FAINT_INK }}>Click text to insert · tap send icon to send now</p>
              </div>
              <button type="button" onClick={() => setQrOpen(false)} className="cursor-pointer p-1" style={{ color: FAINT_INK }} aria-label="Close quick replies">
                <X size={16} />
              </button>
            </div>

            <div className="wa-scroll flex-1 min-h-0 px-3 py-3 space-y-3">
              {quickReplies.length === 0 ? (
                <p className="px-1 py-2" style={{ fontSize: 12, color: FAINT_INK }}>
                  No quick replies yet. Add them under{' '}
                  <Link to="/settings/templates" style={{ color: '#4A1FA0', fontWeight: 600 }}>
                    Settings → Message Templates
                  </Link>.
                </p>
              ) : (
                quickReplyGroups.map(([category, items]) => (
                  <div key={category} style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
                    <button
                      type="button"
                      onClick={() => setCatOpen((prev) => ({ ...prev, [category]: !prev[category] }))}
                      className="w-full flex items-center justify-between px-3 py-2.5 cursor-pointer"
                      style={{ background: '#F7F3FF' }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#4A1FA0' }}>
                        {category} ({items.length})
                      </span>
                      <ChevronDown
                        size={15}
                        style={{ color: '#4A1FA0', transform: catOpen[category] ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}
                      />
                    </button>
                    {catOpen[category] && (
                      <div className="divide-y" style={{ borderColor: LINE }}>
                        {items.map((t) => (
                          <div key={t._id} className="flex items-start gap-2 px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#4A1FA0' }}>{t.label}</div>
                              <button
                                type="button"
                                onClick={() => insertText(t.whatsappBody)}
                                className="text-left w-full cursor-pointer hover:opacity-75"
                                style={{ fontSize: 12.5, color: MUTED_INK, whiteSpace: 'pre-wrap' }}
                                title="Insert into composer"
                              >
                                {t.whatsappBody}
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => sendText(t.whatsappBody)}
                              disabled={!selectedPhone || send.isPending}
                              className="shrink-0 inline-flex items-center justify-center rounded-full cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              style={{ width: 26, height: 26, background: '#5B2BC9', color: '#fff' }}
                              title="Send now"
                              aria-label={`Send ${t.label} now`}
                            >
                              <Send size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Custom message */}
              <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
                <div className="px-3 py-2.5" style={{ background: '#F7F3FF', fontSize: 12.5, fontWeight: 700, color: '#4A1FA0' }}>
                  Custom message
                </div>
                <div className="p-3 space-y-2">
                  <textarea
                    rows={4}
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="Write a one-off message…"
                    className="w-full resize-none px-3 py-2 text-[12.5px] focus:outline-none"
                    style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', borderRadius: 10, color: INK }}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { if (custom.trim()) insertText(custom.trim()) }}
                      disabled={!custom.trim()}
                      className="flex-1 rounded-lg py-1.5 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                      style={{ fontSize: 12, fontWeight: 600, background: '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0' }}
                    >
                      Insert
                    </button>
                    <button
                      type="button"
                      onClick={() => { if (custom.trim()) { sendText(custom); setCustom('') } }}
                      disabled={!custom.trim() || !selectedPhone || send.isPending}
                      className="flex-1 rounded-lg py-1.5 text-white cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                      style={{ fontSize: 12, fontWeight: 600, background: '#5B2BC9' }}
                    >
                      {send.isPending ? 'Sending…' : 'Send now'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

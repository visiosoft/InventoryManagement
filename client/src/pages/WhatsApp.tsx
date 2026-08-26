import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Send, MessageSquare, RefreshCw, UserPlus, UserCheck, Bell, BellOff, FileText,
  Search, X, Plus, ChevronDown, Zap, CheckCheck, Menu, Info, Paperclip,
  Bot, Tag, Check, ClipboardList, Sparkles,
} from 'lucide-react'
import { api, whatsappApi, apiError, type WhatsAppConversation, type WhatsAppMsg, type WhatsAppLabel as WaLabel } from '../lib/api'
import { convDisplayName, formatListTime, isPlaceholderName, Avatar } from '../lib/whatsappDisplay'
import { SlideOver, Modal, Field, Input, Textarea, Select } from '../components/ui'
import { CustomerForm } from '../components/AddCustomerModal'
import { useSeen, markSeen as markSeenShared, unreadFrom } from '../lib/whatsappSeen'
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
  // A quick reply can carry a file — the facility tour video, a price list.
  mediaUrl?: string
  mediaKind?: '' | 'image' | 'video' | 'audio' | 'document'
}

const MUTE_KEY = 'wa_inbox_muted'
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
function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
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
      .catch(async (e) => {
        // The server says why it could not fetch the file, but because the
        // request asked for a blob the error body arrives as one too. Read it
        // back, or the reason is lost and every failure looks the same.
        const blob = e?.response?.data
        if (blob instanceof Blob) {
          try {
            const parsed = JSON.parse(await blob.text())
            if (parsed?.error) throw new Error(parsed.error)
          } catch (inner) {
            if (inner instanceof Error && inner.message) throw inner
          }
        }
        throw e
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
  // The reason the fetch failed, shown in place of the attachment.
  const [failed, setFailed] = useState('')

  useEffect(() => {
    const cached = mediaUrls.get(messageId)
    if (cached) { setUrl(cached); setFailed(''); return }
    let alive = true
    setUrl(null)
    setFailed('')
    loadMediaUrl(messageId)
      .then((u) => { if (alive) setUrl(u) })
      .catch((e) => { if (alive) setFailed(e?.message || 'Attachment unavailable') })
    return () => { alive = false }
  }, [messageId])

  const caption = media.caption ? (
    <p className="whitespace-pre-wrap break-words mt-1">{media.caption}</p>
  ) : null

  if (failed) {
    return (
      <p className="text-xs italic" style={{ color: FAINT_INK }} title={failed}>
        {failed}
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

// The chat panel's own type and width, from the ChatPanel design: Manrope for
// a rounder, friendlier list, and a little more room than the 300px it had.
const CHAT_PANEL_W = 360
const CHAT_PANEL_FONT = "'Manrope', ui-sans-serif, system-ui, sans-serif"

const LABEL_COLOURS = ['#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#0891B2', '#2563EB', '#5B2BC9', '#DB2777']

/** A label as it appears on a chat row or in the header — colour plus name. */
function LabelChip({ label, onRemove }: { label: WaLabel; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full shrink-0"
      style={{ padding: '1px 7px', fontSize: 10, fontWeight: 700, background: `${label.color}1A`, color: label.color }}
      title={label.name}
    >
      <span className="rounded-full" style={{ width: 5, height: 5, background: label.color }} aria-hidden />
      <span className="truncate" style={{ maxWidth: 90 }}>{label.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="cursor-pointer hover:opacity-60" aria-label={`Remove ${label.name}`}>
          <X size={9} />
        </button>
      )}
    </span>
  )
}

/**
 * Tick which labels are on this chat, and make new ones without leaving.
 *
 * The whole ticked set is sent on each change rather than a delta, so what is
 * stored is always exactly what is on screen.
 */
function LabelPicker({ convo, labels, onChanged }: {
  convo: WhatsAppConversation
  labels: WaLabel[]
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [colour, setColour] = useState(LABEL_COLOURS[6])
  const [err, setErr] = useState('')
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const on = new Set((convo.labels || []).map((l) => l._id))

  const setLabels = useMutation({
    mutationFn: (ids: string[]) => whatsappApi.setChatLabels(convo.phoneNormalized, ids),
    onSuccess: () => { setErr(''); onChanged() },
    onError: (e) => setErr(apiError(e)),
  })

  const create = useMutation({
    mutationFn: () => whatsappApi.createLabel({ name: newName.trim(), color: colour }),
    // A label made from here is meant for this chat, so it goes straight on it.
    onSuccess: (label) => {
      setNewName(''); setErr('')
      setLabels.mutate([...on, label._id])
    },
    onError: (e) => setErr(apiError(e)),
  })

  const toggle = (id: string) => {
    const next = new Set(on)
    if (next.has(id)) next.delete(id); else next.add(id)
    setLabels.mutate([...next])
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold cursor-pointer"
        style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0' }}
        title="Label this chat"
      >
        <Tag size={13} /> Labels{on.size > 0 ? ` (${on.size})` : ''}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-40 overflow-hidden"
          style={{ width: 260, background: '#fff', borderRadius: 14, border: `1px solid ${LINE}`, boxShadow: '0 18px 44px rgba(20,8,31,.16)' }}
        >
          <div className="max-h-56 overflow-y-auto py-1">
            {labels.length === 0 ? (
              <p className="px-3 py-2.5" style={{ fontSize: 12, color: FAINT_INK }}>No labels yet. Make one below.</p>
            ) : labels.map((l) => (
              <button
                key={l._id}
                type="button"
                onClick={() => toggle(l._id)}
                disabled={setLabels.isPending}
                className="w-full flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F7F3FF] disabled:opacity-60"
              >
                <span className="rounded-full shrink-0" style={{ width: 9, height: 9, background: l.color }} aria-hidden />
                <span className="flex-1 text-left truncate" style={{ fontSize: 12.5, color: INK }}>{l.name}</span>
                {on.has(l._id) && <Check size={13} style={{ color: '#4A1FA0' }} />}
              </button>
            ))}
          </div>

          <div className="px-3 py-2.5 space-y-2" style={{ borderTop: `1px solid ${LINE}`, background: '#FBF8F2' }}>
            <div className="flex items-center gap-1">
              {LABEL_COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColour(c)}
                  aria-label={`Colour ${c}`}
                  className="rounded-full cursor-pointer"
                  style={{ width: 15, height: 15, background: c, outline: colour === c ? '2px solid #14081F' : 'none', outlineOffset: 1 }}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) create.mutate() }}
                placeholder="New label name"
                className="flex-1 px-2 py-1.5 focus:outline-none"
                style={{ fontSize: 12, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, color: INK }}
              />
              <button
                type="button"
                onClick={() => create.mutate()}
                disabled={!newName.trim() || create.isPending}
                className="rounded-lg px-2.5 py-1.5 text-white cursor-pointer disabled:opacity-40"
                style={{ background: '#5B2BC9', fontSize: 12, fontWeight: 700 }}
              >
                Add
              </button>
            </div>
            {err && <p style={{ fontSize: 11, color: '#B91C1C' }}>{err}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// One button that walks a chat through the pipeline: no lead yet → create one;
// lead exists → convert it to a customer; already won → just link to the record.
type AskRow = {
  phoneNormalized: string
  displayName: string
  isCustomer: boolean
  leadStatus: string
  lastAt: string
  lastDirection: 'inbound' | 'outbound'
  preview: string
  reason: string
}

type AskStats = {
  human: { count: number; medianMs: number; meanMs: number; p90Ms: number; slowestMs: number } | null
  ai: { count: number; medianMs: number } | null
  stillWaiting: number
  threads: number
  humanLabel: string | null
  aiLabel: string | null
}

type AskResult = {
  intent?: string
  stats?: AskStats
  rows: AskRow[]
  total: number
  unread?: number
  days?: number
  needle?: string
  source?: string
  usedModel?: boolean
  unreadable?: string | null
}

/** Durations as a person would say them, matching the server's wording. */
function fmtMs(ms: number) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
  const d = Math.floor(h / 24)
  return `${d}d${h % 24 ? ` ${h % 24}h` : ''}`
}

/** The questions worth one tap, and the ones that cost nothing to answer. */
const ASK_SUGGESTIONS = ['What did we miss?', 'Who went quiet?', 'Hot leads', 'Average reply time']

/**
 * Ask a question of the whole inbox.
 *
 * The per-chat summary only helps once you know which chat to open. This is
 * the other half: which of two hundred threads needs you right now.
 *
 * Most of these are database questions, not language ones — "nobody replied to
 * them" is a fact about the newest message — so the common phrasings are
 * recognised on the server without any API call. The badge says which answers
 * were free.
 */
function InboxAsk({ onOpenChat }: { onOpenChat: (phone: string) => void }) {
  const [q, setQ] = useState('')
  const [asked, setAsked] = useState('')

  const { data, isFetching, error } = useQuery<AskResult>({
    queryKey: ['wa-ask', asked],
    queryFn: () => api.get('/whatsapp/ask', { params: { q: asked } }).then((r) => r.data),
    enabled: Boolean(asked),
    staleTime: 60_000,
    retry: false,
  })

  const qc = useQueryClient()
  const catchUp = useMutation<{ considered: number; generated: number; skipped: number; failed: number }>({
    mutationFn: () => api.post('/whatsapp/summarise-recent', { days: 2 }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-ask'] }),
  })

  const ask = (text: string) => { setQ(text); setAsked(text) }

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => { e.preventDefault(); if (q.trim()) setAsked(q.trim()) }}
        className="relative"
      >
        <Sparkles size={14} style={{ color: '#4A1FA0' }} className="absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask: what did we miss?"
          className="w-full pl-8 pr-8 py-2 text-[13px] focus:outline-none"
          style={{ background: '#FFF7E6', border: '1px solid #F5DFB8', borderRadius: 10, color: INK }}
        />
        {asked && (
          <button
            type="button"
            onClick={() => { setQ(''); setAsked('') }}
            title="Clear"
            className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
            style={{ color: FAINT_INK }}
          >
            <X size={13} />
          </button>
        )}
      </form>

      {!asked && (
        <div className="flex flex-wrap gap-1.5">
          {ASK_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="rounded-full px-2.5 py-1 cursor-pointer"
              style={{ fontSize: 11, fontWeight: 600, background: '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {asked && (
        <div style={{ fontSize: 12 }}>
          {isFetching ? (
            <p style={{ color: FAINT_INK }}>Looking…</p>
          ) : error ? (
            <p style={{ color: '#B91C1C' }}>{apiError(error)}</p>
          ) : data?.unreadable ? (
            <p style={{ color: FAINT_INK }}>{data.unreadable}</p>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap" style={{ color: FAINT_INK, fontSize: 11 }}>
                <span style={{ fontWeight: 700, color: INK, fontSize: 12 }}>
                  {data?.stats
                    ? (data.stats.humanLabel ? `${data.stats.humanLabel} typical reply` : 'No replies to measure')
                    : `${data?.total ?? 0} ${data?.total === 1 ? 'chat' : 'chats'}`}
                </span>
                {/* A question answered from the database should look free,
                    because it was. */}
                <span>{data?.usedModel ? 'read by the assistant' : 'answered from your data'}</span>
              </div>

              {/* Reply times are counted from the message timestamps, so the
                  median is exact rather than a model's impression. Median
                  leads because one message answered the next morning moves a
                  mean and tells you nothing about a normal day. */}
              {data?.stats && (
                <div style={{ marginTop: 6, fontSize: 12, color: MUTED_INK }}>
                  {data.stats.human ? (
                    <>
                      <p>
                        <strong style={{ color: INK }}>{data.stats.humanLabel}</strong> is the median wait
                        across {data.stats.human.count} {data.stats.human.count === 1 ? 'reply' : 'replies'}
                        {data.days ? ` in the last ${data.days} days` : ''}.
                      </p>
                      <p style={{ fontSize: 11.5, color: FAINT_INK, marginTop: 2 }}>
                        Average {fmtMs(data.stats.human.meanMs)} · 9 in 10 answered within{' '}
                        {fmtMs(data.stats.human.p90Ms)} · slowest {fmtMs(data.stats.human.slowestMs)}
                      </p>
                      {/* Kept apart deliberately: the assistant answers in
                          seconds, so folding it in would flatter the team and
                          describe nobody. */}
                      {data.stats.ai && (
                        <p style={{ fontSize: 11.5, color: FAINT_INK, marginTop: 2 }}>
                          The assistant answered {data.stats.ai.count} of these separately, median{' '}
                          {data.stats.aiLabel}. Not counted above.
                        </p>
                      )}
                      {!!data.stats.stillWaiting && (
                        <p style={{ fontSize: 11.5, color: '#B45309', marginTop: 2 }}>
                          {data.stats.stillWaiting} {data.stats.stillWaiting === 1 ? 'chat is' : 'chats are'} still
                          waiting and answered nowhere in that figure.
                        </p>
                      )}
                    </>
                  ) : (
                    <p style={{ color: FAINT_INK }}>
                      No customer message has been answered yet in that period, so there is nothing to average.
                    </p>
                  )}
                </div>
              )}

              {/* "Hot" is answered from summaries already made — never by
                  summarising the whole inbox behind one click. Saying how many
                  were not looked at keeps a partial answer visibly partial. */}
              {/* Rather than asking someone to open 262 chats one at a time,
                  offer to read the ones that actually moved. Bounded on the
                  server to the last two days and a fixed count per run. */}
              {!!data?.unread && (
                <div style={{ marginTop: 4 }}>
                  <p style={{ color: '#B45309', fontSize: 11 }}>
                    {data.unread} chats have never been summarised, so they are not in this answer.
                  </p>
                  <button
                    type="button"
                    onClick={() => catchUp.mutate()}
                    disabled={catchUp.isPending}
                    className="rounded-full px-2.5 py-1 mt-1 cursor-pointer disabled:opacity-50"
                    style={{ fontSize: 11, fontWeight: 700, background: '#4A1FA0', color: '#fff', border: 'none' }}
                  >
                    {catchUp.isPending ? 'Reading…' : 'Read today & yesterday'}
                  </button>
                  {catchUp.data && (
                    <p style={{ color: FAINT_INK, fontSize: 11, marginTop: 3 }}>
                      Read {catchUp.data.generated} of {catchUp.data.considered} active chats
                      {catchUp.data.skipped ? `, ${catchUp.data.skipped} already current` : ''}
                      {catchUp.data.failed ? `, ${catchUp.data.failed} could not be read` : ''}.
                    </p>
                  )}
                  {catchUp.isError && (
                    <p style={{ color: '#B91C1C', fontSize: 11, marginTop: 3 }}>{apiError(catchUp.error)}</p>
                  )}
                </div>
              )}

              <div className="mt-2 space-y-1">
                {(data?.rows ?? []).map((r) => (
                  <button
                    key={r.phoneNormalized}
                    type="button"
                    onClick={() => onOpenChat(r.phoneNormalized)}
                    className="w-full text-left rounded-lg px-2.5 py-2 cursor-pointer hover:opacity-80"
                    style={{ background: '#fff', border: `1px solid ${LINE}` }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate" style={{ fontWeight: 700, fontSize: 12.5, color: INK }}>{r.displayName}</span>
                      {r.isCustomer && (
                        <span className="shrink-0 rounded-full px-1.5" style={{ fontSize: 9.5, fontWeight: 700, background: '#DCFCE7', color: '#047857' }}>
                          Customer
                        </span>
                      )}
                    </div>
                    <p className="truncate" style={{ fontSize: 11.5, color: MUTED_INK }}>{r.reason}</p>
                    {r.preview && (
                      <p className="truncate" style={{ fontSize: 11, color: FAINT_INK }}>{r.preview}</p>
                    )}
                  </button>
                ))}
                {data && data.rows.length === 0 && (
                  <p style={{ color: FAINT_INK }}>Nothing matched that.</p>
                )}
                {data && data.total > data.rows.length && (
                  <p style={{ color: FAINT_INK, fontSize: 11 }}>
                    Showing {data.rows.length} of {data.total}.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

type Digest = {
  configured?: boolean
  empty?: boolean
  error?: string
  cached?: boolean
  headline?: string
  wants?: string
  budget?: string | null
  timing?: string | null
  nextAction?: string
  temperature?: 'hot' | 'warm' | 'cold'
  reason?: string
  openQuestions?: string[]
  model?: string
}

const TEMP_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  hot: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Hot' },
  warm: { bg: '#FFF7E6', fg: '#B45309', label: 'Warm' },
  cold: { bg: '#EEF2F7', fg: '#475569', label: 'Cold' },
}

/**
 * The short version of a long thread, above the chat.
 *
 * Collapsed by default: a rep who already knows the conversation should not
 * have a summary of it pushed in front of the messages. Opening it is what
 * asks for one, so nothing is generated for chats nobody wondered about.
 */
function ConversationDigest({ phoneNormalized }: { phoneNormalized: string }) {
  const [open, setOpen] = useState(false)

  // Collapse when moving to another chat — a summary left open would read as
  // belonging to the conversation now on screen.
  useEffect(() => { setOpen(false) }, [phoneNormalized])

  const { data, isFetching, refetch } = useQuery<Digest>({
    queryKey: ['wa-summary', phoneNormalized],
    queryFn: () => api.get(`/whatsapp/conversations/${phoneNormalized}/summary`).then((r) => r.data),
    enabled: open,
    staleTime: Infinity,
    retry: false,
  })

  const tone = TEMP_TONE[data?.temperature ?? 'warm']

  return (
    <div className="shrink-0" style={{ borderBottom: `1px solid ${LINE}`, background: '#FBF8F2' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-6 py-2 cursor-pointer"
        style={{ fontSize: 12, fontWeight: 600, color: '#4A1FA0' }}
      >
        <Sparkles size={13} />
        <span>{open ? 'Hide summary' : 'Summarise this conversation'}</span>
        {open && data?.headline && (
          <span className="rounded-full px-2 py-0.5 ml-1" style={{ background: tone.bg, color: tone.fg, fontSize: 10.5, fontWeight: 700 }}>
            {tone.label}
          </span>
        )}
        <ChevronDown
          size={13}
          style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
        />
      </button>

      {open && (
        <div className="px-6 pb-3" style={{ fontSize: 12.5, color: MUTED_INK }}>
          {isFetching ? (
            <p style={{ color: FAINT_INK }}>Reading the conversation…</p>
          ) : data?.configured === false ? (
            <p style={{ color: FAINT_INK }}>
              OpenAI is not configured. Add a key in Settings → Integrations.
            </p>
          ) : data?.empty ? (
            <p style={{ color: FAINT_INK }}>Nothing has been said in this chat yet.</p>
          ) : data?.error ? (
            <p style={{ color: '#B91C1C' }}>{data.error}</p>
          ) : data?.headline ? (
            <div className="space-y-1.5">
              <p style={{ fontWeight: 700, color: INK, fontSize: 13 }}>{data.headline}</p>
              {data.wants && <p>{data.wants}</p>}

              <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 12 }}>
                {/* Only shown when the customer actually said it — an empty
                    budget displayed as a blank reads as "they have none". */}
                {data.budget && <span><strong>Budget:</strong> {data.budget}</span>}
                {data.timing && <span><strong>When:</strong> {data.timing}</span>}
              </div>

              {!!data.openQuestions?.length && (
                <div>
                  <p style={{ fontWeight: 600, color: INK }}>Still unanswered:</p>
                  <ul className="list-disc pl-5">
                    {data.openQuestions.map((q) => <li key={q}>{q}</li>)}
                  </ul>
                </div>
              )}

              <p style={{ color: INK }}><strong>Next:</strong> {data.nextAction}</p>
              {data.reason && <p style={{ color: FAINT_INK, fontSize: 11.5 }}>{tone.label} — {data.reason}</p>}

              <div className="flex items-center gap-3 pt-1" style={{ fontSize: 11, color: FAINT_INK }}>
                <span>{data.cached ? 'Saved from earlier' : 'Just read'}{data.model ? ` · ${data.model}` : ''}</span>
                <button
                  type="button"
                  onClick={() => api.get(`/whatsapp/conversations/${phoneNormalized}/summary?force=1`).then(() => refetch())}
                  className="hover:underline cursor-pointer"
                >
                  Read again
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

type AssignableUser = { _id: string; name: string; role: string }

/**
 * Raise a task straight from a conversation.
 *
 * A tenant asking for cleaning, a repair, a callback — it arrives in the middle
 * of a chat and is gone by the next message. This turns it into a task without
 * leaving the page, and prefills what they actually said so it is not retyped
 * from memory a day later.
 */
function TaskFromChat({ convo, lastInbound }: { convo: WhatsAppConversation; lastInbound: string }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState('medium')
  const [assignedTo, setAssignedTo] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const who = convDisplayName(convo)

  const { data: assignableUsers } = useQuery<AssignableUser[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
    enabled: open,
    staleTime: 5 * 60_000,
  })

  // Reopening starts clean, but carries their last message across again.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription(lastInbound ? `They asked:\n"${lastInbound}"` : '')
    setDueDate('')
    setPriority('medium')
    setAssignedTo('')
    setErr('')
    setDone(false)
  }, [open, lastInbound])

  const createTask = useMutation({
    mutationFn: () => api.post('/tasks', {
      title: title.trim(),
      description: description.trim(),
      dueDate: dueDate || undefined,
      priority,
      assignedTo: assignedTo || undefined,
      // Linked to the lead when there is one, so the task shows up against the
      // same person rather than as a loose name.
      ...(convo.lead?._id ? { leadId: convo.lead._id, leadType: 'storage' } : {}),
      leadName: who,
    }),
    onSuccess: () => { setErr(''); setDone(true) },
    onError: (e) => setErr(apiError(e)),
  })

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 cursor-pointer"
        style={{ fontSize: 12, fontWeight: 600, background: '#FFF7E6', border: '1px solid #F5DFB8', color: '#B45309' }}
        title="Create a task from this chat"
      >
        <ClipboardList size={13} /> <span className="hidden sm:inline">Task</span>
      </button>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="New task"
        subtitle={`From the chat with ${who}`}
        width="max-w-lg"
      >
        {done ? (
          <div className="space-y-4">
            <div className="rounded-lg px-3 py-3" style={{ background: '#DCFCE7', color: '#047857', fontSize: 13, fontWeight: 600 }}>
              Task created for {who}.
            </div>
            <div className="flex gap-2">
              <Link
                to="/tasks"
                className="rounded-full px-4 py-2 text-white cursor-pointer"
                style={{ background: '#5B2BC9', fontSize: 13, fontWeight: 700 }}
              >
                Open Tasks
              </Link>
              <button
                type="button"
                onClick={() => setDone(false)}
                className="rounded-full px-4 py-2 cursor-pointer"
                style={{ border: '1px solid rgba(20,8,31,.16)', fontSize: 13, fontWeight: 700 }}
              >
                Add another
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Clean unit F2-80 before Friday"
                autoFocus
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="What was asked for, and anything needed to do it"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assign to">
                <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                  <option value="">Myself</option>
                  {(assignableUsers ?? []).map((u) => (
                    <option key={u._id} value={u._id}>{u.name} ({u.role})</option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority">
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </Select>
              </Field>
            </div>
            <Field label="Due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>

            <p style={{ fontSize: 11.5, color: FAINT_INK }}>
              {convo.lead?._id
                ? `Linked to ${who}, so it shows against them in Tasks.`
                : 'Not saved as a lead yet, so the task carries their name and number only.'}
            </p>

            {err && <p style={{ fontSize: 12, color: '#C0392B' }}>{err}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full px-4 py-2 cursor-pointer"
                style={{ border: '1px solid rgba(20,8,31,.16)', fontSize: 13, fontWeight: 700 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createTask.mutate()}
                disabled={!title.trim() || createTask.isPending}
                className="rounded-full px-5 py-2 text-white cursor-pointer disabled:opacity-40"
                style={{ background: '#5B2BC9', fontSize: 13, fontWeight: 700 }}
              >
                {createTask.isPending ? 'Creating…' : 'Create task'}
              </button>
            </div>
          </div>
        )}
      </SlideOver>
    </>
  )
}

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

  const [formOpen, setFormOpen] = useState(false)
  const [result, setResult] = useState<{ created: boolean; filled?: string[]; customer: { _id: string; fullName: string } } | null>(null)

  /**
   * Saving used to convert straight through, which put the lead's generated
   * name — "WhatsApp Contact 1368" — onto the customer record, where nobody
   * went back to fix it. The form opens instead, prefilled with the number and
   * with the name left blank when it is only a placeholder.
   */
  const convert = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post(`/leads/${convo.lead!._id}/convert`, body).then((r) => r.data),
    onSuccess: (d) => { setErr(''); setResult(d); onChanged() },
    onError: (e) => setErr(apiError(e)),
  })

  const dialled = convo.phone || `+${convo.phoneNormalized}`
  const leadName = convo.lead?.fullName
  const initialCustomer = {
    fullName: isPlaceholderName(leadName) ? '' : leadName,
    phone: dialled,
    phones: [dialled],
  }

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
      ) : convo.customer ? (
        // Already a customer: open their profile rather than offering to make
        // them one again.
        <Link
          to={`/customers/${convo.customer._id}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline"
          style={{ color: '#047857' }}
        >
          <UserCheck size={13} /> {convo.customer.fullName}
        </Link>
      ) : (
        <>
          <span className="text-xs hidden sm:inline" style={{ color: FAINT_INK }}>Lead: {convo.lead.fullName}</span>
          <button
            type="button"
            className={pill}
            style={{ background: '#5B2BC9', color: '#fff' }}
            onClick={() => { setResult(null); setErr(''); setFormOpen(true) }}
          >
            <UserCheck size={13} /> Save as customer
          </button>
        </>
      )}

      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setResult(null) }}
        title={result ? 'Saved' : 'New customer'}
      >
        {result ? (
          <div className="space-y-4 text-sm">
            <p>
              {result.created
                ? <>Created <strong>{result.customer.fullName}</strong>.</>
                : <>This number already belonged to <strong>{result.customer.fullName}</strong>, so the lead was linked to them instead of creating a second record.</>}
            </p>
            {/* Never silently discard what was just typed. */}
            {!result.created && !!result.filled?.length && (
              <p className="text-muted-foreground text-xs">
                Filled in the blanks on that record: {result.filled.join(', ')}. Details already
                there were left as they were.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Link
                to={`/customers/${result.customer._id}`}
                className="rounded-full px-4 py-2 text-white cursor-pointer"
                style={{ background: '#5B2BC9', fontSize: 13, fontWeight: 700 }}
              >
                Open customer
              </Link>
              <button
                type="button"
                onClick={() => { setFormOpen(false); setResult(null) }}
                className="rounded-full px-4 py-2 cursor-pointer"
                style={{ border: '1px solid rgba(20,8,31,.16)', fontSize: 13, fontWeight: 700 }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <CustomerForm
            initial={initialCustomer}
            busy={convert.isPending}
            error={err}
            submitLabel="Save customer"
            onSubmit={(body) => convert.mutate(body as Record<string, unknown>)}
          />
        )}
      </Modal>
    </div>
  )
}

export default function WhatsApp() {
  const qc = useQueryClient()
  // The last chat opened, so returning to the inbox lands where you left off
  // instead of on a combined feed of everyone.
  const LAST_CHAT_KEY = 'wa_last_chat'
  // ?phone= wins over the remembered chat, so a link from elsewhere in the app
  // — a contract's Chat tab, say — opens the conversation it names.
  const [selectedPhone, setSelectedPhone] = useState<string | null>(() => {
    const asked = new URLSearchParams(window.location.search).get('phone')
    const digits = String(asked || '').replace(/\D/g, '')
    return digits || localStorage.getItem(LAST_CHAT_KEY) || null
  })
  const [muted, setMuted] = useState<boolean>(() => localStorage.getItem(MUTE_KEY) === '1')
  const lastSeen = useSeen()
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

  // The label list, and which one the sidebar is filtered to.
  const { data: waLabels = [] } = useQuery<WaLabel[]>({
    queryKey: ['wa-labels'],
    queryFn: () => whatsappApi.labels(),
    staleTime: 60_000,
  })
  const [labelFilter, setLabelFilter] = useState<string>('')
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!notifOpen) return
    const away = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [notifOpen])
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

  /* Why these three carry their own refetch settings.
   *
   * React Query stops an interval while the tab is in the background, and this
   * app turns refetchOnWindowFocus off globally. Together that meant a console
   * left in another tab fetched nothing at all, and coming back to it still
   * waited for the next tick — so messages that reached the database in about
   * two seconds could sit unseen for as long as the tab was unfocused. That is
   * the whole of "messages are coming late".
   *
   * So: keep polling while hidden, because the unread count and the ping are
   * the point of leaving it open, and refetch the moment the tab is focused
   * rather than waiting out the interval.
   */
  const LIVE = { refetchIntervalInBackground: true, refetchOnWindowFocus: true } as const

  const { data: conversations, isLoading: loadingConvos, refetch: refetchConvos } = useQuery<WhatsAppConversation[]>({
    queryKey: ['wa-conversations'],
    queryFn: () => whatsappApi.conversations(),
    refetchInterval: 10_000,
    ...LIVE,
  })

  // Whole-inbox feed: drives unread counts, the blink and the ping. When no
  // conversation is selected this shares its cache entry with the chat query
  // below, so it costs no extra request in that case.
  const { data: allMessages } = useQuery<WaMsg[]>({
    queryKey: ['wa-messages', null],
    queryFn: () => whatsappApi.messages(),
    refetchInterval: 10_000,
    ...LIVE,
  })

  const { data: messages, isLoading: loadingMsgs } = useQuery<WaMsg[]>({
    queryKey: ['wa-messages', selectedPhone],
    queryFn: () => whatsappApi.messages(selectedPhone ?? undefined),
    // The open conversation is the one being watched, so it polls fastest.
    refetchInterval: 5_000,
    enabled: true,
    ...LIVE,
  })

  // The customer's most recent message, used to prefill a task raised from this
  // chat. Capped: a task description should not swallow an essay.
  const lastInboundText = useMemo(() => {
    const last = [...(messages ?? [])].reverse().find((m) => m.direction === 'inbound' && m.text?.trim())
    const body = last?.text?.trim() ?? ''
    return body.length > 500 ? `${body.slice(0, 500)}…` : body
  }, [messages])

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
    markSeenShared(phone, iso)
  }, [])

  // Anything arriving in the open conversation is read on arrival.
  useEffect(() => {
    if (!selectedPhone || !messages || messages.length === 0) return
    const newest = messages.reduce((a, m) => (m.occurredAt > a ? m.occurredAt : a), messages[0].occurredAt)
    markSeen(selectedPhone, newest)
    setBlinking((prev) => (prev[selectedPhone] ? Object.fromEntries(Object.entries(prev).filter(([p]) => p !== selectedPhone)) : prev))
  }, [selectedPhone, messages, markSeen])

  const unreadByPhone = useMemo(() => unreadFrom(allMessages, lastSeen), [allMessages, lastSeen])

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
    let list = convoList
    if (labelFilter) list = list.filter((c) => (c.labels || []).some((l) => l._id === labelFilter))
    if (!q) return list
    return list.filter((c) => {
      const name = (convDisplayName(c) ?? '').toLowerCase()
      return name.includes(q) || c.phoneNormalized.includes(q) || (c.phone ?? '').toLowerCase().includes(q)
    })
  }, [convoList, search, labelFilter])

  const realConvo = convoList.find((c) => c.phoneNormalized === selectedPhone) ?? null
  // A number typed into "New chat" behaves like an empty conversation so the
  // composer and the lead action keep working before the first message lands.
  const selectedConvo: WhatsAppConversation | null =
    realConvo ??
    (selectedPhone && selectedPhone === adhocPhone
      ? { phoneNormalized: selectedPhone, phone: `+${selectedPhone}`, count: 0, lastAt: new Date().toISOString(), lead: null, customer: null, labels: [] }
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

  // Handing a thread over mutes the assistant on it. Without a way back the
  // mute is permanent, and that customer never gets an automatic reply again.
  const resumeBot = useMutation({
    mutationFn: (phone: string) => api.post(`/ai-bot/threads/${phone}/resume`).then((r) => r.data),
    onSuccess: () => { setSendErr(''); onSent() },
    onError: (e) => setSendErr(apiError(e)),
  })

  // Sending a quick reply goes through the server so it can attach the file,
  // set it as the caption and record one message rather than two.
  const sendQuickReply = useMutation({
    mutationFn: (templateId: string) =>
      api.post('/whatsapp/send-quick-reply', { to: selectedPhone, templateId }).then((r) => r.data),
    onSuccess: () => { setSendErr(''); stickToBottom.current = true; onSent() },
    onError: (e) => setSendErr(apiError(e)),
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
              <span className="shrink-0 rounded-full" style={{ width: 7, height: 7, background: '#22c55e' }} aria-hidden />
              <span className="hidden sm:inline">Live — anyone can be messaged</span>
              <span className="sm:hidden">Live</span>
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
                <p style={{ color: MUTED_INK }}>This is a verified business number, so there is no recipient limit. A free-form reply is still only possible within 24 hours of the customer's last message; outside that, send an approved template.</p>
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
          style={{ flex: `0 0 ${CHAT_PANEL_W}px`, width: CHAT_PANEL_W, background: '#fff', borderRight: `1px solid ${LINE}`, fontFamily: CHAT_PANEL_FONT }}
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

            <InboxAsk onOpenChat={(phone) => { setSelectedPhone(phone); setSidebarOpen(false) }} />

            {/* Click a label to narrow the list to the chats carrying it. */}
            {waLabels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {waLabels.map((l) => {
                  const active = labelFilter === l._id
                  return (
                    <button
                      key={l._id}
                      type="button"
                      onClick={() => setLabelFilter(active ? '' : l._id)}
                      className="inline-flex items-center gap-1 rounded-full cursor-pointer transition-colors"
                      style={{
                        padding: '2px 8px', fontSize: 11, fontWeight: 700,
                        background: active ? l.color : `${l.color}14`,
                        color: active ? '#fff' : l.color,
                      }}
                      title={`${l.chatCount ?? 0} chats`}
                    >
                      <span className="rounded-full" style={{ width: 5, height: 5, background: active ? '#fff' : l.color }} aria-hidden />
                      {l.name}
                    </button>
                  )
                })}
                {labelFilter && (
                  <button
                    type="button"
                    onClick={() => setLabelFilter('')}
                    className="inline-flex items-center gap-1 rounded-full cursor-pointer"
                    style={{ padding: '2px 8px', fontSize: 11, fontWeight: 600, color: FAINT_INK }}
                  >
                    <X size={10} /> Clear
                  </button>
                )}
              </div>
            )}
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
                        {/* Customer is decided by whether a customer record
                            exists for this number, not by a lead's status.
                            Asking the lead marked 53 of 60 real customers as
                            leads, because converting is not the only way
                            somebody becomes one. */}
                        {(c.customer || c.lead) && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5"
                            style={
                              c.customer
                                ? { fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#047857' }
                                : { fontSize: 10, fontWeight: 700, background: '#F3EDFF', color: '#4A1FA0' }
                            }
                          >
                            {c.customer ? 'Customer' : 'Lead'}
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
                      {(c.labels || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.labels.map((l) => <LabelChip key={l._id} label={l} />)}
                        </div>
                      )}
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
                    {selectedConvo.customer && (
                      <span className="shrink-0 rounded-full px-2 py-0.5" style={{ fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#047857' }}>
                        Customer
                      </span>
                    )}
                  </div>
                  <div className="truncate" style={{ fontSize: 12, color: FAINT_INK }}>+{selectedConvo.phoneNormalized}</div>
                </div>
                <LabelPicker
                  convo={selectedConvo}
                  labels={waLabels}
                  onChanged={() => {
                    refetchConvos()
                    qc.invalidateQueries({ queryKey: ['wa-labels'] })
                  }}
                />
                <TaskFromChat convo={selectedConvo} lastInbound={lastInboundText} />
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

          {selectedConvo && <ConversationDigest phoneNormalized={selectedConvo.phoneNormalized} />}

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
              <div className="min-w-0 flex-1" style={{ fontSize: 12.5, color: '#6B4500' }}>
                <span style={{ fontWeight: 700 }}>Waiting for a person.</span>{' '}
                {selectedConvo.botEscalationReason || 'The assistant could not answer this one.'}
              </div>
              <button
                type="button"
                onClick={() => resumeBot.mutate(selectedConvo.phoneNormalized)}
                disabled={resumeBot.isPending}
                className="shrink-0 rounded-full px-3 py-1 cursor-pointer disabled:opacity-50"
                style={{ background: '#8A5A00', color: '#fff', fontSize: 11.5, fontWeight: 700 }}
                title="The assistant will answer this conversation again"
              >
                {resumeBot.isPending ? 'Handing back…' : 'Hand back to AI'}
              </button>
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
                              <div style={{ fontSize: 12, fontWeight: 600, color: '#4A1FA0' }}>
                                {t.label}
                                {t.mediaKind && (
                                  <span
                                    className="ml-1.5 inline-flex items-center gap-1 rounded-full px-1.5"
                                    style={{ background: '#EDE5FF', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase' }}
                                    title="Sends a file — use Send, not Insert"
                                  >
                                    <Paperclip size={9} />{t.mediaKind}
                                  </span>
                                )}
                              </div>
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
                              onClick={() => sendQuickReply.mutate(t._id)}
                              disabled={!selectedPhone || send.isPending || sendQuickReply.isPending}
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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Send, MessageSquare, RefreshCw, UserPlus, UserCheck, Bell, BellOff, FileText,
  Search, X, Plus, ChevronDown, Zap, CheckCheck, Menu, Paperclip, Pencil,
  Bot, Tag, Check, ClipboardList, Sparkles, Trash2, MapPin, Mic, Square, AlertTriangle, MoreVertical, UserCog, Loader2,
} from 'lucide-react'
import { useVoiceRecorder, recordingSupported, formatDuration } from '../lib/voiceRecorder'
import { api, whatsappApi, apiError, type WhatsAppConversation, type WhatsAppMsg, type WhatsAppLabel as WaLabel } from '../lib/api'
import { isSalesRepRole } from '../lib/roles'
import { useAuth } from '../lib/auth'
import { TaskComposer } from '../components/TaskComposer'
import { playPing, primePing } from '../lib/ping'
import { convDisplayName, formatListTime, isPlaceholderName, Avatar } from '../lib/whatsappDisplay'
import { Modal, Field, Input, Textarea, Select } from '../components/ui'
import { CustomerForm } from '../components/AddCustomerModal'
import { useSeen, markSeen as markSeenShared, unreadFrom } from '../lib/whatsappSeen'
import { cn } from '../lib/utils'

/** Which slice of the inbox is on screen. 'waiting' is not a slice by owner
 *  like the others — it is everybody who is owed an answer. */
type OwnerTab = 'all' | 'mine' | 'tenants' | 'unassigned' | 'waiting' | 'quiet'

/** How long somebody has been waiting, said the way a person would say it. */
function waitedFor(since: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(since).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/* Waiting an hour is a queue; waiting a day is a lost customer. The colour
   says which without anybody reading the number. */
function waitTone(since: string): { bg: string; fg: string } {
  const hours = (Date.now() - new Date(since).getTime()) / 36e5
  if (hours >= 24) return { bg: '#FEE2E2', fg: '#B91C1C' }
  if (hours >= 4) return { bg: '#FEF3C7', fg: '#92400E' }
  return { bg: '#F1F5F9', fg: '#475569' }
}

/* ── local types ──────────────────────────────────────────────────────────
   The API layer's WhatsAppMsg predates attachments; /whatsapp/messages now
   adds a `media` descriptor on messages that carry one. Widened here because
   this page is the only consumer. */
type WaMediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker'
type WaMedia = {
  kind: WaMediaKind; mimeType: string; filename: string; caption: string
  /** A file this app serves itself, rather than one to fetch back from Meta. */
  link?: string
}
type WaMsg = WhatsAppMsg & { media?: WaMedia }

/** Settings → Message Templates. Reused verbatim as the quick-reply library. */
type MessageTemplate = {
  _id: string
  key: string
  label: string
  whatsappBody: string
  category?: string
  sortOrder?: number
  // A quick reply can carry a file — the facility tour video, a price list —
  // or send WhatsApp's native location pin instead.
  mediaUrl?: string
  mediaKind?: '' | 'image' | 'video' | 'audio' | 'document' | 'location'
}

/* One of the templates Meta has approved for this WhatsApp account.
 *
 * Not the same thing as a quick reply above: a quick reply is free text we
 * compose, which Meta only delivers inside 24 hours of the customer's last
 * message. A template is wording Meta has vetted in advance, and it is the
 * only kind of message that reaches somebody who has gone quiet. */
type ApprovedTemplate = {
  name: string
  label: string
  language: string
  category: string
  bodyText: string
  // How many {{1}}, {{2}} … the body expects. Meta rejects the send outright
  // if the count is wrong, so the panel asks for them before sending.
  variableCount: number
}

const MUTE_KEY = 'wa_inbox_muted'
const BLINK_MS = 4000

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

  /* A phone's browser chrome is counted by vh but not actually visible, so a
     100vh panel puts its own last rows — here, the box you type into — below
     the fold. dvh measures what is really on screen. The 520px floor has to
     go with it: on a short screen, or once the keyboard is up, it is taller
     than the viewport and pushes the composer off again. */
  /* The vh line first as a fallback: a browser without dvh keeps the old
     behaviour rather than dropping both and collapsing the panel. */
  .wa-shell { height: calc(100vh - 5rem) !important; min-height: 0 !important; }
  .wa-shell { height: calc(100dvh - 5rem) !important; }

  /* Room for the message itself. The bubbles had 26px of side padding, which
     on a 375px screen is a seventh of the width spent on nothing. */
  .wa-thread { padding: 14px 12px !important; }
  .wa-bubble { max-width: 88% !important; }

  /* The header had a name and five controls competing for 360 pixels, and the
     name lost: "Save as customer" alone is a third of the screen, so you could
     not see who you were talking to. The buttons keep their icons and drop
     their words — each still carries a title and an aria-label — and the name
     gets the space back. */
  .wa-head { gap: 6px !important; padding-left: 8px !important; padding-right: 8px !important; }
  .wa-pill-label { display: none; }
  .wa-pill { padding: 0 !important; width: 32px; height: 32px; justify-content: center; gap: 0 !important; }

  /* "Lead (Mahmoud Gohar)" is a sentence at this width. The badge still says
     which it is; who owns it is on the lead itself. */
  .wa-badge-detail { display: none; }

  /* Small enough to leave room, large enough to still read as a person. */
  .wa-head .wa-avatar { width: 30px !important; height: 30px !important; font-size: 12px !important; }

  /* Comfortable thumb targets, and a composer that does not crowd them. */
  .wa-compose { gap: 6px !important; padding-left: 10px !important; padding-right: 10px !important; }
}

/* Anything genuinely small: drop to the essentials so nothing overflows. */
@media (max-width: 400px) {
  .wa-head-extra { display: none !important; }
  .wa-bubble { max-width: 92% !important; }
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
  /* A link is already a URL we serve, so there is nothing to fetch: the
     facility tour video is sent to WhatsApp as a link precisely so no upload
     or media id is involved, and the same link renders it here. */
  const [url, setUrl] = useState<string | null>(() => media.link || mediaUrls.get(messageId) || null)
  // The reason the fetch failed, shown in place of the attachment.
  const [failed, setFailed] = useState('')

  useEffect(() => {
    if (media.link) { setUrl(media.link); setFailed(''); return }
    const cached = mediaUrls.get(messageId)
    if (cached) { setUrl(cached); setFailed(''); return }
    let alive = true
    setUrl(null)
    setFailed('')
    loadMediaUrl(messageId)
      .then((u) => { if (alive) setUrl(u) })
      .catch((e) => { if (alive) setFailed(e?.message || 'Attachment unavailable') })
    return () => { alive = false }
  }, [messageId, media.link])

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

/* ── small presentational helpers ─────────────────────────────────────── */
/* A row in the chat's overflow menu.
 *
 * The header carried five circular icons and no words, which is fine on a
 * desktop where you can hover for a tooltip and hopeless on a phone. Behind
 * one button they can be what they always should have been: named actions. */
const MENU_ROW = 'w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm cursor-pointer hover:bg-[#F7F3FF]'

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
  const qc = useQueryClient()
  const [hovered, setHovered] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')

  /* Not an edit, because there is no such thing for a business message: Meta
     offers no way to change or unsend one. The corrected wording goes as a new
     message quoting the wrong one, so it lands threaded against it in the
     customer's chat — the same thing a person would do by hand. */
  const correct = useMutation({
    mutationFn: () => whatsappApi.correctMessage(msg._id, draft.trim()),
    onSuccess: () => {
      setCorrecting(false)
      setErr('')
      qc.invalidateQueries({ queryKey: ['wa-messages'] })
    },
    onError: (e) => setErr(apiError(e)),
  })

  // Meta has no unsend endpoint — this only removes it from our own record,
  // never from the customer's phone. Restricted to our own messages so a
  // colleague can correct a mistake without anyone erasing what a customer
  // actually said.
  const deleteMsg = useMutation({
    mutationFn: () => whatsappApi.deleteMessage(msg._id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-messages'] }),
  })

  return (
    <div
      className={cn('flex items-center gap-1.5', out ? 'justify-end' : 'justify-start')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {out && !msg.deletedAt && hovered && !correcting && (
        <>
          {msg.type === 'text' && (
            <button
              type="button"
              title="Send a correction quoting this message"
              aria-label="Correct this message"
              onClick={() => { setDraft(msg.text || ''); setErr(''); setCorrecting(true) }}
              className="shrink-0 inline-flex items-center justify-center rounded-full cursor-pointer"
              style={{ width: 22, height: 22, background: '#F7F3FF', color: '#4A1FA0' }}
            >
              <Pencil size={11} />
            </button>
          )}
          <button
            type="button"
            title="Delete for us (this does not remove it from their WhatsApp)"
            aria-label="Delete this message"
            disabled={deleteMsg.isPending}
            onClick={() => {
              if (!confirm('Delete this message from our side?\n\nWhatsApp gives businesses no way to unsend a message — the customer will still have it on their phone. This only removes it from our own record.')) return
              deleteMsg.mutate()
            }}
            className="shrink-0 inline-flex items-center justify-center rounded-full cursor-pointer disabled:opacity-40"
            style={{ width: 22, height: 22, background: '#FEE2E2', color: '#B91C1C' }}
          >
            <Trash2 size={11} />
          </button>
        </>
      )}
      <div
        className="wa-bubble max-w-[75%] rounded-2xl px-3.5 py-2 text-sm"
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
            {msg.text || (
              <span className="italic opacity-60">
                {/* Meta's own word for "we could not deliver this to you" —
                    a view-once photo, a poll, a newer message type. It is not
                    an empty message, and "[unsupported]" read like a fault of
                    ours rather than something to ask the customer to resend. */}
                {msg.type === 'unsupported'
                  ? 'They sent something WhatsApp could not pass on — ask them to resend it'
                  : `[${msg.type}]`}
              </span>
            )}
          </p>
        )}
        {!msg.deletedAt && msg.media && msg.text && !msg.media.caption && (
          <p className="whitespace-pre-wrap break-words mt-1">{msg.text}</p>
        )}

        {/* The customer still has this wording on their phone — nothing can
            take it back — so the thread says it has been superseded rather
            than leaving the mistake reading as current. */}
        {msg.correctedAt && !msg.deletedAt && (
          <p className="mt-1" style={{ fontSize: 10.5, fontWeight: 700, color: '#8A5A00' }}>
            Corrected below · they still have this one
          </p>
        )}

        {correcting && (
          <div className="mt-2" style={{ borderTop: '1px solid rgba(20,8,31,.12)', paddingTop: 8 }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              autoFocus
              className="w-full"
              style={{
                borderRadius: 8, border: '1px solid rgba(20,8,31,.18)', background: '#fff',
                padding: '7px 9px', fontSize: 13, fontFamily: 'inherit', color: INK,
                resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: 10.5, color: FAINT_INK, marginTop: 4, lineHeight: 1.45 }}>
              WhatsApp will not let a business change a message it has sent. This goes as a new
              message quoting the one above, so they see the correction attached to it.
            </p>
            {err && <p style={{ fontSize: 11, color: '#B91C1C', marginTop: 4 }}>{err}</p>}
            <div className="flex items-center gap-2 mt-1.5">
              <button
                type="button"
                onClick={() => correct.mutate()}
                disabled={correct.isPending || !draft.trim() || draft.trim() === (msg.text || '').trim()}
                className="rounded-full cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: '#5B2BC9', color: '#fff', border: 0, fontSize: 12, fontWeight: 700, padding: '5px 12px' }}
              >
                {correct.isPending ? 'Sending…' : 'Send correction'}
              </button>
              <button
                type="button"
                onClick={() => { setCorrecting(false); setErr('') }}
                className="cursor-pointer"
                style={{ background: 'none', border: 0, color: FAINT_INK, fontSize: 12, padding: 0 }}
              >
                Cancel
              </button>
            </div>
          </div>
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
          {out && (msg.status === 'failed'
            /* A failure used to look exactly like a success: the same grey
               ticks, no word anywhere. Somebody sent a voice note, watched it
               sit there looking fine, and only heard days later that it never
               arrived. */
            ? <AlertTriangle size={12} style={{ color: '#DC2626' }} />
            : <CheckCheck size={13} style={{ color: msg.status === 'read' ? '#53BDEB' : 'rgba(20,8,31,.35)' }} />)}
        </div>
        {out && msg.status === 'failed' && (
          <div
            className="mt-1 rounded-lg px-2 py-1"
            style={{ background: '#FEE2E2', color: '#B91C1C', fontSize: 11, lineHeight: 1.35 }}
          >
            <strong>Not delivered.</strong>{' '}
            {msg.errorDetail || msg.errorTitle
              || 'WhatsApp refused it and gave no reason. If they last wrote more than 24 hours ago, only an approved template gets through.'}
          </div>
        )}
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
function LabelPicker({ convo, labels, onChanged, menuItem }: {
  convo: WhatsAppConversation
  labels: WaLabel[]
  onChanged: () => void
  menuItem?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [colour, setColour] = useState(LABEL_COLOURS[6])
  const [err, setErr] = useState('')
  const [confirming, setConfirming] = useState('')
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

  // Deleting a label takes it off every chat carrying it, not just this one,
  // so it asks first rather than going on a single click.
  const remove = useMutation({
    mutationFn: (id: string) => whatsappApi.deleteLabel(id),
    onSuccess: () => { setErr(''); setConfirming(''); onChanged() },
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
      {menuItem ? (
        <button type="button" onClick={() => setOpen((v) => !v)} className={MENU_ROW} style={{ color: INK }}>
          <Tag size={15} style={{ color: '#4A1FA0' }} />
          <span className="flex-1">Labels</span>
          {on.size > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#4A1FA0' }}>{on.size}</span>}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center justify-center gap-1 rounded-full cursor-pointer shrink-0"
          style={{ minWidth: 32, height: 32, padding: on.size > 0 ? '0 9px' : 0, background: '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0' }}
          title="Label this chat"
          aria-label="Label this chat"
        >
          <Tag size={14} />{on.size > 0 ? <span style={{ fontSize: 11, fontWeight: 700 }}>{on.size}</span> : null}
        </button>
      )}

      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-40 overflow-hidden"
          style={{ width: 260, background: '#fff', borderRadius: 14, border: `1px solid ${LINE}`, boxShadow: '0 18px 44px rgba(20,8,31,.16)' }}
        >
          <div className="max-h-56 overflow-y-auto py-1">
            {labels.length === 0 ? (
              <p className="px-3 py-2.5" style={{ fontSize: 12, color: FAINT_INK }}>No labels yet. Make one below.</p>
            ) : labels.map((l) => (
              <div key={l._id} className="group w-full flex items-center gap-2 px-3 py-2 hover:bg-[#F7F3FF]">
                <button
                  type="button"
                  onClick={() => toggle(l._id)}
                  disabled={setLabels.isPending}
                  className="flex-1 min-w-0 flex items-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  <span className="rounded-full shrink-0" style={{ width: 9, height: 9, background: l.color }} aria-hidden />
                  <span className="flex-1 text-left truncate" style={{ fontSize: 12.5, color: INK }}>{l.name}</span>
                  {on.has(l._id) && <Check size={13} style={{ color: '#4A1FA0' }} />}
                </button>
                {confirming === l._id ? (
                  <span className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => remove.mutate(l._id)}
                      disabled={remove.isPending}
                      className="rounded px-1.5 py-0.5 cursor-pointer disabled:opacity-50"
                      style={{ fontSize: 11, fontWeight: 700, background: '#FEE2E2', color: '#B91C1C' }}
                    >
                      {remove.isPending ? '…' : 'Delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming('')}
                      className="rounded px-1 py-0.5 cursor-pointer"
                      style={{ fontSize: 11, color: FAINT_INK }}
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setErr(''); setConfirming(l._id) }}
                    title={`Delete "${l.name}" from every chat`}
                    aria-label={`Delete label ${l.name}`}
                    className="shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-50 cursor-pointer transition-opacity"
                  >
                    <Trash2 size={12} style={{ color: '#B91C1C' }} />
                  </button>
                )}
              </div>
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
/* The inbox assistant — an "ask the whole inbox" box and its suggested
 * questions — was taken off this page. The endpoints it called are still
 * there, so putting it back is a revert rather than a rebuild. */

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


/**
 * Raise a task straight from a conversation.
 *
 * A tenant asking for cleaning, a repair, a callback — it arrives in the middle
 * of a chat and is gone by the next message. This turns it into a task without
 * leaving the page, and prefills what they actually said so it is not retyped
 * from memory a day later.
 */
function TaskFromChat({ convo, lastInbound, menuItem, open: openProp, onOpenChange, trigger = true }: {
  convo: WhatsAppConversation
  lastInbound: string
  menuItem?: boolean
  /* The panel can be driven from outside.
   *
   * In the chat's menu it has to be: the row lived inside the dropdown, and
   * clicking it closed the dropdown, which unmounted this component and took
   * the half-opened panel with it, so nothing appeared. Quick replies never
   * had the problem because its state sits on the page, not in the menu. */
  open?: boolean
  onOpenChange?: (v: boolean) => void
  trigger?: boolean
}) {
  const [openSelf, setOpenSelf] = useState(false)
  const open = openProp ?? openSelf
  const setOpen = onOpenChange ?? setOpenSelf
  const who = convDisplayName(convo)

  return (
    <>
      {!trigger ? null : menuItem ? (
        <button type="button" onClick={() => setOpen(true)} className={MENU_ROW} style={{ color: INK }}>
          <ClipboardList size={15} style={{ color: '#B45309' }} />
          <span className="flex-1">Create a task</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 inline-flex items-center justify-center rounded-full cursor-pointer"
          style={{ width: 32, height: 32, background: '#FFF7E6', border: '1px solid #F5DFB8', color: '#B45309' }}
          title="Create a task from this chat"
          aria-label="Create a task from this chat"
        >
          <ClipboardList size={14} />
        </button>
      )}

      {/* The panel itself lives in components/TaskComposer, shared with the
          lead profile, so the two cannot ask for different things. */}
      <TaskComposer
        open={open}
        onOpenChange={setOpen}
        subjectName={who}
        leadId={convo.lead?._id ?? null}
        subtitle={`From the chat with ${who}`}
        prefillDescription={lastInbound ? `They asked:
"${lastInbound}"` : ''}
      />
    </>
  )
}

/**
 * Put a name on a chat nobody has picked up, straight from the list.
 *
 * A new enquiry arrives owned by nobody — out of hours, or before the rules
 * were switched on — and looked exactly like the two hundred beneath it. This
 * is the one tap that fixes that: the row shows a small assign icon, and the
 * list of reps drops out of it.
 *
 * It goes the same way the chat menu does, so the response clock starts and
 * the leads board sees it: PUT /leads/:id where a lead exists, and the
 * create-from-chat endpoint where it does not.
 */
function QuickAssign({ convo, onChanged }: { convo: WhatsAppConversation; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const boxRef = useRef<HTMLDivElement | null>(null)
  const leadId = convo.lead?._id

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const { data: people = [], isLoading: loadingPeople, error: peopleError } = useQuery<{ _id: string; name: string; email: string; role?: string }[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data ?? []),
    staleTime: 30 * 60_000,
  })
  /* Whoever can carry a lead. Asked through isSalesRepRole rather than
     `role === 'sales_rep'`, which is the rule lib/roles.ts states and this
     used to break: 'accounts' is the same role under another name, so a team
     set up that way got an empty menu and a button that looked dead. */
  const reps = people.filter((u) => isSalesRepRole(u.role))
  /* An empty menu is a dead end, so when there are no reps at all the list
     falls back to everyone the server will let hold a lead. Better to hand it
     to an admin than to leave the chat unowned because nobody fits. */
  const choices = reps.length > 0 ? reps : people

  const assign = useMutation({
    mutationFn: async (owner: string) => {
      if (leadId) { await api.put(`/leads/${leadId}`, { owner }); return }
      await whatsappApi.createLead(convo.phoneNormalized, {
        fullName: convo.customer?.fullName || '',
        owner,
      })
    },
    onSuccess: () => { setErr(''); setOpen(false); onChanged() },
    onError: (e) => setErr(apiError(e)),
  })

  return (
    <span ref={boxRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Nobody has this yet — assign it"
        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 cursor-pointer"
        style={{ fontSize: 10, fontWeight: 700, background: '#FFF7E6', color: '#B45309', border: 'none' }}
      >
        {assign.isPending
          ? <Loader2 size={11} className="animate-spin" />
          : <UserPlus size={11} />}
        {assign.isPending ? 'Assigning…' : 'Assign'}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 z-40 rounded-xl overflow-hidden"
          style={{ background: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 10px 30px rgba(20,8,31,.16)', minWidth: 170 }}
        >
          {err && <p className="px-3 py-1.5" style={{ fontSize: 11, color: '#B91C1C' }}>{err}</p>}
          {/* Say which of the three it is. This used to read "Loading…"
              whenever the list came back empty for ANY reason, including the
              request failing outright — so a broken menu and a slow one looked
              identical, and neither said anything worth acting on. */}
          {choices.length === 0 && (
            <p className="px-3 py-2" style={{ fontSize: 12, fontWeight: 600, color: peopleError ? '#B91C1C' : '#B45309' }}>
              {loadingPeople ? 'Loading…'
                : peopleError ? `Could not load the team: ${apiError(peopleError)}`
                  /* Says the count, not just "nobody". An empty menu that only
                     says it is empty leaves you unable to tell a failed request
                     from a team with no reps set up — which is exactly the loop
                     this got stuck in. */
                  : `/users/assignable returned ${people.length} — nobody can take this. Check Users.`}
            </p>
          )}
          {reps.length === 0 && people.length > 0 && (
            <p className="px-3 pt-2" style={{ fontSize: 10.5, color: FAINT_INK }}>
              No sales reps set up — showing everyone
            </p>
          )}
          {choices.map((u) => (
            <button
              key={u._id}
              type="button"
              disabled={assign.isPending}
              onClick={() => assign.mutate(u._id)}
              className="w-full text-left px-3 py-2 cursor-pointer hover:bg-[#F7F3FF]"
              style={{ fontSize: 12.5, color: INK, background: 'none', border: 'none' }}
            >
              {u.name || u.email}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

/**
 * Hand this chat to a sales rep, without leaving the inbox.
 *
 * Assigning used to mean opening the lead in another tab, which is why chats
 * sat unowned: the moment you know who should take it is while you are reading
 * it.
 *
 * Where the chat is already a lead this is an owner change, through
 * PUT /leads/:id — the same route the leads board uses, so the two-minute
 * response clock starts here exactly as it does there rather than this being a
 * quiet side door.
 *
 * Where it is not a lead yet (63 of 567 conversations), assigning makes it one
 * and hands it over in the same action. Those chats had no Assign option at
 * all, so the only way to put a name on them was to save the lead first and
 * then go and find it on the board — and until somebody did, they were invisible
 * to the pipeline.
 */
function AssignRep({ convo, onChanged }: { convo: WhatsAppConversation; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const leadId = convo.lead?._id
  const ownerId = convo.lead?.ownerId ?? null

  /* Fetched with the chat rather than on the click. It used to wait for the
     menu to open, so opening Assign showed "Loading…" every time — three names
     that change about never, fetched again at the worst possible moment. */
  const { data: people = [] } = useQuery<{ _id: string; name: string; email: string; role?: string }[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data ?? []),
    staleTime: 30 * 60_000,
  })

  /* Sales reps only. The endpoint is shared with task assignment, which wants
     ops too, so the narrowing belongs here — a lead goes to a rep. Whoever
     holds it now stays on the list even if they are not a rep, or an
     admin-owned lead would read as unassigned and get handed away by mistake.

     Asked through isSalesRepRole, per lib/roles.ts: 'accounts' is the same
     role under another name, and testing `role === 'sales_rep'` here left a
     team set up that way with nothing to pick. */
  const reps = people.filter((u) => isSalesRepRole(u.role) || u._id === ownerId)

  /* The click closes the menu and moves the tick straight away, and the list
     is put right from the server afterwards.
     *
     * It used to wait for the round trip and then refetch the whole inbox
     * twice - the conversations aggregate runs over 567 chats - so handing a
     * chat to somebody sat there for seconds looking like it had not worked. */
  const qc = useQueryClient()
  const assign = useMutation({
    onMutate: (owner: string | null) => {
      setOpen(false)
      const picked = people.find((u) => u._id === owner)
      const owned = (c: WhatsAppConversation) => (c.phoneNormalized === convo.phoneNormalized && c.lead
        ? { ...c, lead: { ...c.lead, ownerId: owner ?? undefined, ownerName: picked?.name ?? undefined } }
        : c)
      /* Two shapes live under this prefix: the inbox keeps a paged
         { list, total, matched } and the bell keeps a bare array. Patch
         whichever this is and leave anything else alone - assuming the paged
         one crashed the bell's entry on every assign. */
      qc.setQueriesData({ queryKey: ['wa-conversations'] }, (old: unknown) => {
        if (Array.isArray(old)) return old.map(owned)
        const paged = old as { list?: WhatsAppConversation[] } | undefined
        if (paged && Array.isArray(paged.list)) return { ...paged, list: paged.list.map(owned) }
        return old
      })
    },
    mutationFn: async (owner: string | null) => {
      if (leadId) { await api.put(`/leads/${leadId}`, { owner }); return }
      // No lead behind this chat yet. This endpoint creates one and sets the
      // owner in a single call, so the chat lands on the leads board owned.
      // The name is whatever we already know them by; blank is fine, the
      // server falls back to the number.
      await whatsappApi.createLead(convo.phoneNormalized, {
        fullName: convo.customer?.fullName || '',
        owner: owner || undefined,
      })
    },
    onSuccess: () => { setErr(''); onChanged() },
    onError: (e) => { setErr(apiError(e)); setOpen(true); onChanged() },
  })

  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} className={MENU_ROW} style={{ color: INK }}>
        <UserCog size={15} style={{ color: '#4A1FA0' }} />
        <span className="flex-1">
          Assign to
          {convo.lead?.ownerName && (
            <span style={{ color: FAINT_INK }}> · {convo.lead.ownerName}</span>
          )}
        </span>
        <ChevronDown size={13} style={{ color: FAINT_INK, transform: open ? 'rotate(180deg)' : undefined }} />
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${LINE}`, background: '#FBF8F2', maxHeight: 320, overflowY: 'auto' }}>
          {err && <p className="px-3 py-1.5 text-xs" style={{ color: '#B91C1C' }}>{err}</p>}
          {reps.length === 0 && (
            <p className="px-3 py-2 text-xs" style={{ color: FAINT_INK }}>
              {people.length === 0 ? 'Loading sales reps…' : 'No sales reps to assign to.'}
            </p>
          )}
          {reps.map((u) => (
            <button
              key={u._id}
              type="button"
              disabled={assign.isPending}
              onClick={() => assign.mutate(u._id)}
              className={`${MENU_ROW} py-3`}
              style={{ color: INK, fontWeight: u._id === ownerId ? 700 : 500 }}
            >
              <span className="flex-1 truncate">{u.name || u.email}</span>
              {u._id === ownerId && <Check size={14} style={{ color: '#4A1FA0' }} />}
            </button>
          ))}
          {/* Taking it off somebody is as real an action as giving it to them —
              an unassigned lead shows on the board as needing an owner. */}
          {ownerId && leadId && (
            <button
              type="button"
              disabled={assign.isPending}
              onClick={() => assign.mutate(null)}
              className={`${MENU_ROW} py-3`}
              style={{ color: '#B45309' }}
            >
              <span className="flex-1">Leave unassigned</span>
            </button>
          )}
        </div>
      )}
    </>
  )
}

function LeadAction({ convo, onChanged, menuItem }: { convo: WhatsAppConversation; onChanged: () => void; menuItem?: boolean }) {
  const [err, setErr] = useState('')

  /* Every chat already has a Lead behind it, carrying a generated name like
     "WhatsApp Contact 7425". That is bookkeeping, not a lead anyone chose to
     work — so it counts as no lead at all until somebody names it. */
  const named = convo.lead && !isPlaceholderName(convo.lead.fullName) ? convo.lead : null
  const [leadForm, setLeadForm] = useState<{ fullName: string; email: string; owner: string; notes: string } | null>(null)

  const { data: assignable = [] } = useQuery<{ _id: string; name: string; role: string }[]>({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
    enabled: leadForm !== null,
    staleTime: 5 * 60_000,
  })

  const saveLead = useMutation({
    mutationFn: () => whatsappApi.createLead(convo.phoneNormalized, {
      fullName: leadForm!.fullName.trim(),
      email: leadForm!.email.trim() || undefined,
      owner: leadForm!.owner || undefined,
      notes: leadForm!.notes.trim() || undefined,
    }),
    onSuccess: () => { setErr(''); setLeadForm(null); onChanged() },
    onError: (e) => setErr(apiError(e)),
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

  const pill = 'wa-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed'

  /* One copy of the dialogs, rendered by whichever variant is on screen.
     Two copies would mean two pieces of state pretending to be one. */
  const modals = (
    <>
      <Modal open={leadForm !== null} onClose={() => setLeadForm(null)} title="Save as lead">
        {leadForm && (
          <div className="space-y-3">
            <Field label="Name">
              <Input
                autoFocus
                value={leadForm.fullName}
                onChange={(e) => setLeadForm({ ...leadForm, fullName: e.target.value })}
                placeholder="Who is this?"
              />
            </Field>
            {/* Read-only: the number is what the conversation is, and typing a
                different one here would attach the lead to the wrong chat. */}
            <Field label="Phone">
              <Input value={convo.phone || `+${convo.phoneNormalized}`} readOnly style={{ background: '#F7F3FF' }} />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={leadForm.email}
                onChange={(e) => setLeadForm({ ...leadForm, email: e.target.value })}
                placeholder="Optional"
              />
            </Field>
            <Field label="Assign to">
              <Select value={leadForm.owner} onChange={(e) => setLeadForm({ ...leadForm, owner: e.target.value })}>
                <option value="">Myself</option>
                {assignable.map((u) => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
              </Select>
            </Field>
            <Field label="Notes">
              <Textarea
                rows={3}
                value={leadForm.notes}
                onChange={(e) => setLeadForm({ ...leadForm, notes: e.target.value })}
                placeholder="What they are after, sizes discussed, anything the rep should know"
              />
            </Field>
            {err && <p className="text-xs text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setLeadForm(null)}
                className="rounded-full px-4 py-2 cursor-pointer"
                style={{ border: '1px solid rgba(20,8,31,.16)', fontSize: 13, fontWeight: 700 }}>
                Cancel
              </button>
              <button type="button"
                onClick={() => saveLead.mutate()}
                disabled={!leadForm.fullName.trim() || saveLead.isPending}
                className="rounded-full px-5 py-2 text-white cursor-pointer disabled:opacity-40"
                style={{ background: '#5B2BC9', fontSize: 13, fontWeight: 700 }}>
                {saveLead.isPending ? 'Saving…' : 'Save lead'}
              </button>
            </div>
          </div>
        )}
      </Modal>
  
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
    </>
  )

  /* The same three states, as named rows. Which one shows is the whole point:
     an unnamed chat offers "Save as lead", a named one "Save details to
     quote", and somebody with a record already gets a way to open it.

     Deliberately not "Save as customer" any more. It made a tenant out of
     everybody who asked for a price, and nearly half the tenant list had never
     rented anything. The record it makes is a prospect until a contract is
     signed — see server/src/services/customerStage.js. */
  if (menuItem) {
    return (
      <>
        {err && <p className="px-3 py-1.5 text-xs text-red-600">{err}</p>}
        {!named && !convo.customer ? (
          <button
            type="button"
            className={MENU_ROW}
            style={{ color: INK }}
            onClick={() => { setErr(''); setLeadForm({ fullName: convo.lead?.profileName || '', email: '', owner: '', notes: '' }) }}
          >
            <UserPlus size={15} style={{ color: '#4A1FA0' }} />
            <span className="flex-1">Save as lead</span>
          </button>
        ) : convo.customer ? (
          <Link to={`/customers/${convo.customer._id}`} className={MENU_ROW} style={{ color: INK, textDecoration: 'none' }}>
            <UserCheck size={15} style={{ color: '#047857' }} />
            <span className="flex-1 truncate">Open {convo.customer.fullName}</span>
          </Link>
        ) : (
          <button
            type="button"
            className={MENU_ROW}
            style={{ color: INK }}
            onClick={() => { setResult(null); setErr(''); setFormOpen(true) }}
          >
            <UserCheck size={15} style={{ color: '#4A1FA0' }} />
            <span className="flex-1">Save details to quote</span>
          </button>
        )}
        {modals}
      </>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {err && <span className="text-xs text-red-600 max-w-[220px] truncate" title={err}>{err}</span>}
      {!named && !convo.customer ? (
        <button
          type="button"
          className={pill}
          style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0' }}
          // Prefilled with their WhatsApp profile name: it is almost always
          // right, and retyping a name we already have is busywork.
          title="Save as lead"
          aria-label="Save as lead"
          onClick={() => { setErr(''); setLeadForm({ fullName: convo.lead?.profileName || '', email: '', owner: '', notes: '' }) }}
        >
          <UserPlus size={13} /> <span className="wa-pill-label">Save as lead</span>
        </button>
      ) : convo.customer ? (
        /* A record already exists, so open it rather than offering to make a
           second one. Green only for somebody who has signed — amber says
           there is a record without claiming a tenancy. */
        <Link
          to={`/customers/${convo.customer._id}`}
          title={`Open ${convo.customer.fullName}${convo.customer.stage === 'prospect' ? ' — quoted, not signed' : ''}`}
          aria-label={`Open ${convo.customer.fullName}`}
          className="inline-flex items-center justify-center rounded-full shrink-0"
          style={convo.customer.stage === 'prospect'
            ? { width: 32, height: 32, background: '#FEF3C7', border: '1px solid #F5DFB8', color: '#92400E' }
            : { width: 32, height: 32, background: 'rgba(22,163,74,.09)', border: '1px solid rgba(22,163,74,.28)', color: '#047857' }}
        >
          <UserCheck size={14} />
        </Link>
      ) : (
        <>
          <button
            type="button"
            className={pill}
            style={{ background: '#5B2BC9', color: '#fff' }}
            title="Save their details so a quotation can be raised"
            aria-label="Save details to quote"
            onClick={() => { setResult(null); setErr(''); setFormOpen(true) }}
          >
            <UserCheck size={13} /> <span className="wa-pill-label">Save details to quote</span>
          </button>
        </>
      )}

      {modals}
    </div>
  )
}

/**
 * The WhatsApp console.
 *
 * Given `embeddedPhone` it becomes one conversation with no chat list — which
 * is what the WhatsApp tab on a lead or a tenant renders. Everything else is
 * unchanged, and that is the point: the history, the live updates, quick
 * replies, voice notes, attachments, editing, assigning and the rest are the
 * same code in both places, so the tab cannot quietly fall behind the console.
 */
export default function WhatsApp({ embeddedPhone }: { embeddedPhone?: string } = {}) {
  const embedded = Boolean(embeddedPhone)
  const qc = useQueryClient()
  // The last chat opened, so returning to the inbox lands where you left off
  // instead of on a combined feed of everyone.
  const LAST_CHAT_KEY = 'wa_last_chat'
  // ?phone= wins over the remembered chat, so a link from elsewhere in the app
  // — a contract's Chat tab, say — opens the conversation it names.
  const [selectedPhone, setSelectedPhone] = useState<string | null>(() => {
    if (embeddedPhone) return String(embeddedPhone).replace(/\D/g, '')
    const asked = new URLSearchParams(window.location.search).get('phone')
    const digits = String(asked || '').replace(/\D/g, '')
    return digits || localStorage.getItem(LAST_CHAT_KEY) || null
  })

  // Following the person the page is about, if it changes under us.
  useEffect(() => {
    if (embeddedPhone) setSelectedPhone(String(embeddedPhone).replace(/\D/g, ''))
  }, [embeddedPhone])
  /* Muting, with a middle setting between "on" and "off for ever".
   *
   * Stored as '1' for muted indefinitely, or the time it should come back on.
   * A snooze is what people actually want during a busy stretch — turning the
   * sound off permanently is the thing they do instead when snoozing is not
   * offered, and then nobody hears anything for weeks. */
  const [muteUntil, setMuteUntil] = useState<string>(() => localStorage.getItem(MUTE_KEY) || '0')
  const [now, setNow] = useState(() => Date.now())
  const muted = muteUntil === '1' || Number(muteUntil) > now

  // A snooze has to end on its own, or it is just a mute with extra steps.
  useEffect(() => {
    const until = Number(muteUntil)
    if (muteUntil === '1' || !until || until <= now) return
    const t = window.setTimeout(() => setNow(Date.now()), until - now + 500)
    return () => window.clearTimeout(t)
  }, [muteUntil, now])

  const [soundMenuOpen, setSoundMenuOpen] = useState(false)
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

  /* Whose chats to show.
   *
   * The inbox listed every conversation to everybody, so a rep scrolled past
   * forty of somebody else's to find their own. Remembered per person, and a
   * rep starts on their own — which is the list they came here for.
   */
  const { user: me } = useAuth()
  const OWNER_KEY = 'pb-wa-owner-filter'
  const [ownerFilter, setOwnerFilter] = useState<OwnerTab>(() => {
    try {
      const saved = localStorage.getItem(OWNER_KEY)
      /* 'waiting' and 'quiet' are deliberately not restored: the control that
         switched them off was taken off the sidebar, so somebody who had one
         saved would open a filtered inbox with no way back to the whole of it.
         Both states still show on the rows themselves, as chips. */
      if (saved === 'all' || saved === 'mine' || saved === 'tenants') return saved
      // 'unassigned' is not a rep's tab any more; an admin still has it.
      if (saved === 'unassigned' && me?.role !== 'sales_rep' && me?.role !== 'accounts') return saved
    } catch { /* a private window has no storage, and that is fine */ }
    // Only a rep: accounts share the rep-ish role but own no leads, and would
    // land on an empty tab wondering where the inbox went.
    return me?.role === 'sales_rep' ? 'mine' : 'all'
  })
  /* Who sees which.
   *
   * A rep works their own leads, the tenants who write in, and occasionally
   * the whole inbox; handing chats out is not their job, so Unassigned is not
   * on their screen at all. An admin is doing the handing out, so it is one of
   * their three, and Tenants moves behind the dots. */
  const ALL_TABS: [OwnerTab, string][] = [
    ['mine', 'My leads'],
    ['tenants', 'Tenants'],
    ['all', 'All'],
    ['unassigned', 'Unassigned'],
  ]
  const isRep = me?.role === 'sales_rep' || me?.role === 'accounts'
  const visibleKeys: OwnerTab[] = isRep ? ['mine', 'tenants', 'all'] : ['mine', 'all', 'unassigned']
  const ownerTabs = ALL_TABS.filter(([k]) => visibleKeys.includes(k))
  const overflowTabs = isRep ? [] : ALL_TABS.filter(([k]) => k === 'tenants')

  const [tabMenuOpen, setTabMenuOpen] = useState(false)
  const tabMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!tabMenuOpen) return
    const away = (e: MouseEvent) => {
      if (tabMenuRef.current && !tabMenuRef.current.contains(e.target as Node)) setTabMenuOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [tabMenuOpen])

  function chooseOwnerFilter(v: OwnerTab) {
    setOwnerFilter(v)
    // Back to the first page: 200 of everybody's chats and 200 of your own are
    // different lists, and carrying a deep window across is meaningless.
    setConvoLimit(200)
    try { localStorage.setItem(OWNER_KEY, v) } catch { /* ignore */ }
  }
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
  /* Which half of the side panel is showing.
   *
   * Quick replies are free text and templates are not, and which one a rep
   * needs is decided entirely by whether the 24-hour window is still open —
   * so they share one panel rather than competing for the same corner. */
  const [panelTab, setPanelTab] = useState<'quick' | 'templates'>('quick')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  // Renaming the person this thread belongs to, without leaving the console.
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [catOpen, setCatOpen] = useState<Record<string, boolean>>({ templates: true })
  const [custom, setCustom] = useState('')
  // Numbers typed via "New chat" have no conversation record yet.
  const [adhocPhone, setAdhocPhone] = useState<string | null>(null)

  const mutedRef = useRef(muted)
  mutedRef.current = muted
  // When this console was opened. Anything older than this is backlog, not news.
  const openedAt = useRef(Date.now())

  /* The chat's overflow menu. Closes on a click anywhere else, which is what
     every menu in this app does and what people expect from one. */
  const [chatMenuOpen, setChatMenuOpen] = useState(false)
  // Lives on the page, not in the dropdown: see TaskFromChat.
  const [taskOpen, setTaskOpen] = useState(false)
  const chatMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!chatMenuOpen) return
    const away = (e: MouseEvent) => {
      if (!chatMenuRef.current?.contains(e.target as Node)) setChatMenuOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setChatMenuOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [chatMenuOpen])
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

  /* How many threads to ask for. Raised by "Show older chats" rather than
     fetching everything up front, so a busy inbox stays quick to open. */
  const [convoLimit, setConvoLimit] = useState(200)

  /* The search runs on the server, so it reaches conversations that are not in
     the list yet. Debounced so typing does not fire a request per keystroke. */
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => window.clearTimeout(t)
  }, [search])

  const { data: convoPage, isLoading: loadingConvos, refetch: refetchConvos } = useQuery({
    queryKey: ['wa-conversations', debouncedSearch, selectedPhone, convoLimit, ownerFilter],
    queryFn: () => whatsappApi.conversations({
      q: debouncedSearch,
      phone: selectedPhone ?? undefined,
      limit: convoLimit,
      owner: ownerFilter,
    }),
    refetchInterval: 10_000,
    placeholderData: (prev) => prev,
    ...LIVE,
  })

  const conversations = convoPage?.list
  const convoTotal = convoPage?.total ?? 0
  const convoMatched = convoPage?.matched ?? 0

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

  /* The templates Meta has approved.
   *
   * Fetched only while the panel is open — it is a live call out to Meta on a
   * ten-minute cache, and most of the time nobody is looking at this list. */
  const { data: waTemplates, isLoading: waTemplatesLoading, error: waTemplatesError } = useQuery<{
    configured: boolean
    error: string
    templates: ApprovedTemplate[]
  }>({
    queryKey: ['whatsapp-templates'],
    queryFn: () => api.get('/whatsapp/templates').then((r) => r.data),
    enabled: qrOpen && panelTab === 'templates',
    staleTime: 10 * 60_000,
  })

  // Which template is expanded to fill its {{1}}, {{2}} … in, and with what.
  const [openTemplate, setOpenTemplate] = useState('')
  const [templateVars, setTemplateVars] = useState<Record<string, string[]>>({})

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

  /* Which conversations have already announced themselves.
   *
   * The sound used to fire on every poll that carried anything inbound, so
   * somebody sending five messages in a row rang five times — and a busy hour
   * was a metronome. It is announcing a person, not a message: one ring when
   * a chat has something new, then silence from that chat until it has been
   * read. Opening it clears the mark, so their next message is heard again.
   */
  const announced = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!allMessages) return
    if (seenIds.current === null) {
      seenIds.current = new Set(allMessages.map((m) => m._id))
      return
    }
    const fresh = allMessages.filter((m) => !seenIds.current!.has(m._id))
    if (fresh.length === 0) return
    for (const m of fresh) seenIds.current!.add(m._id)

    // Nothing from the chat already on screen: it is being read as it arrives,
    // and a sound for a message you are watching land is just noise.
    const inbound = fresh.filter((m) => m.direction === 'inbound' && m.phoneNormalized !== selectedRef.current)
    if (inbound.length === 0) return

    const unannounced = [...new Set(inbound.map((m) => m.phoneNormalized))]
      .filter((phone) => !announced.current.has(phone))

    if (unannounced.length > 0) {
      for (const phone of unannounced) announced.current.add(phone)

      /* Only ring for what has arrived since this page was opened.
       *
       * "New to this browser" and "new in the world" are not the same thing,
       * and conflating them is why opening the console after a while rang for
       * a backlog somebody had already dealt with on their phone. A message
       * from an hour ago is not news; it belongs in the unread count, which
       * still shows it either way.
       *
       * The grace allows for the clock on the message being a touch behind
       * ours — it comes from Meta, not from here. */
      const cutoff = openedAt.current - 30_000
      const reallyNew = inbound.some((m) => new Date(m.occurredAt).getTime() > cutoff)

      // One ring, however many chats woke up at once — a second one a
      // millisecond later says nothing the first did not.
      if (reallyNew && !mutedRef.current) playPing()
    }

    const until = Date.now() + BLINK_MS
    setBlinking((prev) => {
      const next = { ...prev }
      for (const m of inbound) next[m.phoneNormalized] = until
      return next
    })
  }, [allMessages])

  /* Reading a chat lets it speak again. Without this the first message from
     somebody would be the only one they ever get a sound for. */
  useEffect(() => {
    if (selectedPhone) announced.current.delete(selectedPhone)
  }, [selectedPhone])

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

  /** '0' on, '1' off, or a timestamp to come back on at. */
  function setSound(value: string) {
    setMuteUntil(value)
    setNow(Date.now())
    setSoundMenuOpen(false)
    try { localStorage.setItem(MUTE_KEY, value) } catch { /* ignore */ }
    if (value === '0') primePing()
  }

  const sorted = useMemo(
    () => [...(messages ?? [])].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()),
    [messages]
  )

  // Newest activity first, so an incoming message floats its chat to the top.
  /* Newest first, full stop.
   *
   * Unread chats were floated to the top for a while, which read as wrong the
   * moment a message arrived at 16:12 and sat below one from 13:08 that
   * happened to be unread. The most recent thing said is the thing at the
   * top; unread is shown by the dot and the bold, which is signal enough
   * without also moving the row. */
  const convoList = useMemo(
    () => [...(conversations ?? [])].sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime()),
    [conversations]
  )

  /* Mine means leads I am working, not every chat I happen to own. A tenant
     asking about a gate code is not a lead, and mixing them in buried the list
     this tab exists for. A prospect stays here: they are still being won. */
  const isMine = (c: WhatsAppConversation) => (
    Boolean(me?.id) && String(c.lead?.ownerId ?? '') === String(me?.id) && !isTenant(c)
  )
  /* A new enquiry nobody has picked up — not merely "no owner", which swept in
     every tenant who messages us. Somebody already on file is not a new chat. */
  const isUnowned = (c: WhatsAppConversation) => !c.lead?.ownerId && !c.customer
  /* Somebody who has actually signed, as opposed to somebody a record exists
     for. Quoting creates the record, so the two stopped being the same thing —
     see server/src/services/customerStage.js. Absent means tenant, which is
     what every record meant before the field existed. */
  const isTenant = (c: WhatsAppConversation) => Boolean(c.customer) && c.customer?.stage !== 'prospect'
  /* They wrote last and nobody has answered. Worked out here as well as on the
     server so the tab is honest against an API that has not been updated yet —
     the same reason the owner tabs do it. */
  const isWaiting = (c: WhatsAppConversation) => (
    c.waitingSince
      ? true
      : Boolean(c.lastInboundAt) && (!c.lastOutboundAt || String(c.lastInboundAt) > String(c.lastOutboundAt))
  )
  /* The other half: we spoke last and nothing came back. Trusted from the
     server, which knows the lead's stage and whether a reminder is already
     set — neither of which the row carries. */
  const isQuiet = (c: WhatsAppConversation) => Boolean(c.quietSince)

  /* Counted over every conversation on the server, not over what has been
     loaded — the tabs used to count the 200 most recent, so a rep with 275
     chats was told they had four.

     Where the API has not been updated yet there is no such header, and the
     page counts what it has rather than showing zeros next to a list that
     plainly is not empty. */
  const serverKnowsOwner = Boolean(convoPage?.serverFiltered)
  const ownerCounts = convoPage?.ownerCounts ?? {
    all: convoList.length,
    mine: convoList.filter(isMine).length,
    unassigned: convoList.filter(isUnowned).length,
    waiting: convoList.filter(isWaiting).length,
    quiet: convoList.filter(isQuiet).length,
    tenants: convoList.filter(isTenant).length,
  }

  /* The label filter always runs here. The owner runs here too when the server
     did not do it, so the tabs work against either version of the API. */
  const filteredConvos = useMemo(() => {
    let list = convoList
    if (!serverKnowsOwner) {
      if (ownerFilter === 'mine') list = list.filter(isMine)
      else if (ownerFilter === 'tenants') list = list.filter(isTenant)
      else if (ownerFilter === 'unassigned') {
        list = list.filter(isUnowned)
          .slice()
          .sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt))
      }
      else if (ownerFilter === 'waiting') {
        list = list.filter(isWaiting)
          .slice()
          .sort((a, b) => +new Date(a.waitingSince || a.lastInboundAt || 0) - +new Date(b.waitingSince || b.lastInboundAt || 0))
      } else if (ownerFilter === 'quiet') {
        list = list.filter(isQuiet)
          .slice()
          .sort((a, b) => +new Date(a.quietSince || 0) - +new Date(b.quietSince || 0))
      }
    }
    if (labelFilter) list = list.filter((c) => (c.labels || []).some((l) => l._id === labelFilter))
    return list
  }, [convoList, labelFilter, ownerFilter, serverKnowsOwner, me?.id])

  /* The open conversation, from the list where the filter kept it and from the
     server's `pinned` where it did not. It used to be pushed into the list
     itself, so a chat belonging to another rep appeared under "My leads" —
     the tab counted 3 and rendered 4. */
  const pinnedConvo = convoPage?.pinned ?? null
  const realConvo = convoList.find((c) => c.phoneNormalized === selectedPhone)
    ?? (pinnedConvo?.phoneNormalized === selectedPhone ? pinnedConvo : null)
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

  /**
   * Correct the name from here.
   *
   * A customer saved as "Lead" was only fixable by leaving for their profile
   * and coming back, which is a lot of walking for one field — and the sort of
   * errand nobody runs, so the wrong name stays.
   *
   * It writes to whichever record the badge is claiming: the customer if there
   * is one, otherwise the lead. Both merge over what is stored, so sending the
   * name alone leaves everything else untouched.
   */
  const renameParty = useMutation({
    mutationFn: (fullName: string) => {
      const customerId = selectedConvo?.customer?._id
      const leadId = selectedConvo?.lead?._id
      if (customerId) return api.put(`/customers/${customerId}`, { fullName })
      if (leadId) return api.put(`/leads/${leadId}`, { fullName })
      throw new Error('Save them as a lead first, then the name can be changed')
    },
    onSuccess: () => {
      setRenaming(false)
      refetchConvos()
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })

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
    // Opening somebody's tab is not "where I left off in the inbox".
    if (!embedded) localStorage.setItem(LAST_CHAT_KEY, next)
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

  /* A recorded voice note becomes an ordinary pending attachment, so it goes
     out through the same path as a picked file — and can be listened back to
     before it is sent, which is the whole reason not to send on release. */
  const voice = useVoiceRecorder()
  const [voicePreview, setVoicePreview] = useState('')
  const isVoicePending = Boolean(pending?.type.startsWith('audio/'))

  useEffect(() => {
    if (!pending || !pending.type.startsWith('audio/')) { setVoicePreview(''); return }
    const url = URL.createObjectURL(pending)
    setVoicePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [pending])

  /* Whether a typed message can still reach this person.
   *
   * WhatsApp allows free text only within 24 hours of their last message.
   * Outside it Meta rejects anything typed, so a rep could write a careful
   * reply and watch it bounce with a raw API error. Most chats sit outside the
   * window at any given moment, so this is the normal case, not the edge one. */
  const replyWindow = useMemo(() => {
    const last = selectedConvo?.lastInboundAt
    if (!last) return { open: false, known: false, hoursLeft: 0 }
    const msLeft = new Date(last).getTime() + 24 * 3600_000 - Date.now()
    return { open: msLeft > 0, known: true, hoursLeft: Math.max(0, Math.floor(msLeft / 3600_000)) }
  }, [selectedConvo?.lastInboundAt])

  async function stopRecording() {
    const file = await voice.stop()
    if (file) { setPending(file); setSendErr('') }
  }

  /* How far a file has got.
   *
   * A photo from a phone is a few megabytes and a video can be sixteen, so
   * without this the button simply sat there and people pressed it again. null
   * means nothing is uploading. */
  const [uploadPct, setUploadPct] = useState<number | null>(null)

  const sendMedia = useMutation({
    mutationFn: async (payload: { to: string; file: File; caption: string }) => {
      const form = new FormData()
      form.append('to', payload.to)
      form.append('file', payload.file)
      if (payload.caption) form.append('caption', payload.caption)
      setUploadPct(0)
      return api.post('/whatsapp/send-media', form, {
        onUploadProgress: (e) => {
          // Once the bytes are with us there is still Meta to wait for, so it
          // stops at 99 rather than sitting on a finished-looking 100.
          if (!e.total) return
          setUploadPct(Math.min(99, Math.round((e.loaded / e.total) * 100)))
        },
      }).then((r) => r.data)
    },
    onSuccess: () => {
      setSendErr(''); setPending(null); setDraft(''); setUploadPct(null)
      if (fileRef.current) fileRef.current.value = ''
      stickToBottom.current = true
      onSent()
    },
    onError: (e) => { setUploadPct(null); setSendErr(apiError(e)) },
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
  /* Hearing a suggestion before it goes anywhere.
   *
   * Spoken on demand rather than stored with the draft, so what you hear is
   * the wording as it stands. Nothing is sent by pressing play. */
  const [hearing, setHearing] = useState<'loading' | 'playing' | null>(null)
  // Held so it can be stopped: a fifteen-second reply you have already judged
  // is fifteen seconds you cannot get back.
  const playingRef = useRef<HTMLAudioElement | null>(null)

  function stopHearing() {
    const audio = playingRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      if (audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src)
      playingRef.current = null
    }
    setHearing(null)
  }

  async function hearDraft(text: string) {
    if (hearing) { stopHearing(); return }
    setHearing('loading')
    setSendErr('')
    try {
      const { data } = await api.post('/ai-bot/speak', { text }, { responseType: 'blob' })
      const url = URL.createObjectURL(data as Blob)
      const audio = new Audio(url)
      playingRef.current = audio
      const done = () => { URL.revokeObjectURL(url); playingRef.current = null; setHearing(null) }
      audio.onended = done
      audio.onerror = done
      await audio.play()
      setHearing('playing')
    } catch (e) {
      setSendErr(apiError(e))
      setHearing(null)
    }
  }

  // Leaving the chat should not leave a voice talking to an empty room.
  useEffect(() => stopHearing, [selectedPhone])

  /* A dismissed suggestion is gone, which is what dismissing means. This asks
     for another against the same conversation, for one dismissed by accident
     or a wording worth a second try. */
  const suggestAgain = useMutation({
    mutationFn: (phone: string) => api.post(`/ai-bot/threads/${phone}/suggest`),
    onSuccess: () => { setSendErr(''); refetchConvos() },
    onError: (e) => setSendErr(apiError(e)),
  })

  /* "Remind me about this."
   *
   * The rep is in the chat when they learn when to chase — that is the moment
   * the date is known, and it was the one place the follow-up could not be
   * set. Everything after this is machinery that already existed: a task on
   * the board that morning, a push at the hour. */
  /* Notices somebody has read and put away, by chat. Kept for the session
     only: a thread that escalates again tomorrow should say so again. */
  const [escalationHidden, setEscalationHidden] = useState<Set<string>>(new Set())
  const [remindOpen, setRemindOpen] = useState(false)
  const [remindDate, setRemindDate] = useState('')
  const remind = useMutation({
    mutationFn: ({ phone, when }: { phone: string; when: string }) =>
      api.post(`/whatsapp/${phone}/remind`, { when }),
    onSuccess: () => { setSendErr(''); setRemindOpen(false); setRemindDate(''); refetchConvos() },
    onError: (e) => setSendErr(apiError(e)),
  })

  const sendVoiceDraft = useMutation({
    mutationFn: ({ phone, text }: { phone: string; text: string }) =>
      api.post('/ai-bot/speak-and-send', { phone, text }),
    onSuccess: () => { setSendErr(''); stickToBottom.current = true; onSent() },
    onError: (e) => setSendErr(apiError(e)),
  })

  const sendQuickReply = useMutation({
    mutationFn: (templateId: string) =>
      api.post('/whatsapp/send-quick-reply', { to: selectedPhone, templateId }).then((r) => r.data),
    onSuccess: () => { setSendErr(''); stickToBottom.current = true; onSent() },
    onError: (e) => setSendErr(apiError(e)),
  })

  /* Send an approved template.
   *
   * The one send that still works after the window has closed. Recorded in the
   * thread by the server, so the next person to open the chat sees the wording
   * that actually went out rather than a gap. */
  const sendTemplate = useMutation({
    mutationFn: (t: { name: string; language: string; variables: string[] }) =>
      api.post('/whatsapp/send-template', { to: selectedPhone, ...t }).then((r) => r.data),
    onSuccess: () => {
      setSendErr('')
      setOpenTemplate('')
      stickToBottom.current = true
      onSent()
    },
    onError: (e) => setSendErr(apiError(e)),
  })

  /* What to put in {{1}} before anybody types.
   *
   * Every template that takes a variable opens with the person's first name,
   * and it is already on screen — asking a rep to retype it is the kind of
   * friction that gets a template sent as "Hi {{1}}". Only a real name is
   * used: the placeholder the sync invents would be worse than blank. */
  const templatePrefill = useMemo(() => {
    const full = (selectedConvo?.customer?.fullName || selectedConvo?.lead?.fullName || '').trim()
    if (!full || isPlaceholderName(full)) return ''
    return full.split(/\s+/)[0]
  }, [selectedConvo?.customer?.fullName, selectedConvo?.lead?.fullName])

  const varsFor = (t: ApprovedTemplate) => {
    const held = templateVars[t.name]
    if (held) return held
    return Array.from({ length: t.variableCount }, (_, i) => (i === 0 ? templatePrefill : ''))
  }

  const setVar = (name: string, i: number, value: string, count: number) =>
    setTemplateVars((prev) => {
      const next = [...(prev[name] ?? Array.from({ length: count }, (_, n) => (n === 0 ? templatePrefill : '')))]
      next[i] = value
      return { ...prev, [name]: next }
    })

  /** The wording as the customer will read it, placeholders filled in. */
  const previewOf = (t: ApprovedTemplate, values: string[]) =>
    values.reduce((text, v, i) => text.replaceAll(`{{${i + 1}}}`, v || `{{${i + 1}}}`), t.bodyText)

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
      className={cn(
        'wa-shell flex flex-col rounded-2xl overflow-hidden min-h-[520px]',
        embedded ? 'h-[70vh]' : 'h-[calc(100vh-5rem)] md:h-[calc(100vh-5.5rem)]',
      )}
      style={{ border: `1px solid ${LINE}`, background: '#fff', boxShadow: embedded ? 'none' : '0 6px 28px rgba(20,8,31,.07)' }}
    >
      <style>{CSS}</style>

      {/* ── columns ────────────────────────────────────────────────── */}
      <div
        className="relative flex flex-1 min-h-0"
        style={{ flexDirection: 'row', flexWrap: 'nowrap' }}
      >

        {/* 2. Sidebar — not when the page is about one person already. */}
        {!embedded && (
        <aside
          className={cn('wa-sidebar flex flex-col min-h-0', sidebarOpen && 'wa-sidebar-open')}
          style={{ flex: `0 0 ${CHAT_PANEL_W}px`, width: CHAT_PANEL_W, background: '#fff', borderRight: `1px solid ${LINE}`, fontFamily: CHAT_PANEL_FONT }}
        >
          <div className="shrink-0 px-4 pt-4 pb-3 space-y-3">
            {/* The console had a dark bar of its own above all this, carrying
                the PurpleBox name a second time — the page is already titled
                WhatsApp Inbox — and sixty pixels of height on a screen that is
                nothing but two scrolling lists. What was actually useful in it
                lives here, beside the list it belongs to. */}
            <div className="flex items-center justify-between gap-2">
              <h2 className="min-w-0 truncate" style={{ fontFamily: "'Bricolage Grotesque', serif", fontWeight: 700, fontSize: 19, color: INK }}>
                Chats{totalUnread > 0 ? <span style={{ fontSize: 12, fontWeight: 700, color: '#4A1FA0', marginLeft: 6 }}>{totalUnread} unread</span> : null}
              </h2>
              <div className="flex items-center shrink-0" style={{ gap: 4 }}>
                <div className="relative">
                  <IconButton
                    title={
                      muteUntil === '1' ? 'Notification sound is off'
                        : muted ? `Sound is snoozed until ${new Date(Number(muteUntil)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                          : 'Notification sound is on'
                    }
                    onClick={() => setSoundMenuOpen((v) => !v)}
                  >
                    {muted ? <BellOff size={15} /> : <Bell size={15} />}
                  </IconButton>
                  {soundMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setSoundMenuOpen(false)} aria-hidden />
                      <div
                        className="absolute right-0 mt-1 z-20 rounded-xl overflow-hidden"
                        style={{ background: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 8px 24px rgba(20,8,31,.14)', minWidth: 186 }}
                      >
                        {([
                          ['0', 'Sound on'],
                          [String(Date.now() + 3600_000), 'Mute for 1 hour'],
                          [String(Date.now() + 4 * 3600_000), 'Mute for 4 hours'],
                          ['1', 'Mute until I turn it back on'],
                        ] as const).map(([value, label]) => {
                          const active = value === '0' ? !muted : value === '1' ? muteUntil === '1' : false
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() => setSound(value)}
                              className="w-full text-left px-3 py-2.5 cursor-pointer hover:opacity-75"
                              style={{ fontSize: 12.5, color: INK, fontWeight: active ? 700 : 500, background: active ? '#F7F3FF' : '#fff' }}
                            >
                              {label}
                            </button>
                          )
                        })}
                        <p className="px-3 py-2" style={{ fontSize: 11, color: FAINT_INK, borderTop: `1px solid ${LINE}` }}>
                          Unread counts keep showing either way.
                        </p>
                      </div>
                    </>
                  )}
                </div>
                <IconButton
                  title="Refresh"
                  onClick={() => { refetchConvos(); qc.invalidateQueries({ queryKey: ['wa-messages'] }) }}
                >
                  <RefreshCw size={15} />
                </IconButton>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setSetupOpen((v) => !v)}
                    className="inline-flex items-center justify-center rounded-full cursor-pointer"
                    style={{ width: 30, height: 30, background: '#F7F3FF', border: '1px solid #EDE5FF' }}
                    title="Connected — anyone can be messaged. Open the setup checklist."
                    aria-label="Connection status and setup checklist"
                  >
                    <span className="rounded-full" style={{ width: 8, height: 8, background: '#22c55e' }} aria-hidden />
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
                <IconButton title="New chat" onClick={startNewChat}><Plus size={15} /></IconButton>
              </div>
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

            {/* Three, always.
                Four pills wrapped onto two lines and broke "My leads" across
                them. Three is what fits, so the fourth lives behind the dots —
                and which three depends on who is looking: a rep works their
                own leads and never hands anything out, so Unassigned is not
                theirs to see. */}
            <div className="flex items-center gap-1 p-1" style={{ background: '#F7F3FF', borderRadius: 999 }}>
              {ownerTabs.map(([key, label]) => {
                const active = ownerFilter === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => chooseOwnerFilter(key)}
                    className="flex-1 cursor-pointer truncate"
                    style={{
                      height: 28, borderRadius: 999, fontSize: 12, fontWeight: 600, border: 'none',
                      background: active ? '#fff' : 'transparent',
                      color: active ? INK : FAINT_INK,
                      boxShadow: active ? '0 1px 2px rgba(20,8,31,.10)' : 'none',
                    }}
                  >
                    {label}
                    <span style={{ marginLeft: 5, fontWeight: 700, color: active ? '#4A1FA0' : FAINT_INK }}>
                      {ownerCounts[key]}
                    </span>
                  </button>
                )
              })}

              {/* Whatever did not fit. Only rendered when there is something
                  in it, so a rep never sees an empty control. */}
              {overflowTabs.length > 0 && (
                <div className="relative shrink-0" ref={tabMenuRef}>
                  <button
                    type="button"
                    onClick={() => setTabMenuOpen((v) => !v)}
                    className="cursor-pointer flex items-center justify-center"
                    style={{
                      width: 26, height: 28, borderRadius: 999, border: 'none',
                      background: overflowTabs.some(([k]) => k === ownerFilter) ? '#fff' : 'transparent',
                      color: overflowTabs.some(([k]) => k === ownerFilter) ? INK : FAINT_INK,
                      boxShadow: overflowTabs.some(([k]) => k === ownerFilter) ? '0 1px 2px rgba(20,8,31,.10)' : 'none',
                    }}
                    title="More"
                    aria-label="More chat filters"
                  >
                    <MoreVertical size={14} />
                  </button>
                  {tabMenuOpen && (
                    <div
                      className="absolute right-0 z-20 rounded-xl overflow-hidden"
                      style={{ top: 32, minWidth: 170, background: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 8px 24px rgba(20,8,31,.12)' }}
                    >
                      {overflowTabs.map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => { chooseOwnerFilter(key); setTabMenuOpen(false) }}
                          className={MENU_ROW}
                          style={{ color: ownerFilter === key ? '#4A1FA0' : INK }}
                        >
                          <span className="flex-1">{label}</span>
                          <span style={{ fontWeight: 700, color: FAINT_INK }}>{ownerCounts[key]}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

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
                {convoList.length === 0
                  ? 'No conversations yet. Start a new chat.'
                  : ownerFilter === 'mine'
                    ? 'None of these chats are yours yet. Try All.'
                    : ownerFilter === 'tenants'
                      ? 'No chats from anybody who has signed.'
                      : ownerFilter === 'unassigned'
                        ? 'Every new enquiry has somebody on it.'
                      : ownerFilter === 'waiting'
                        ? 'Nobody is waiting on a reply. Everything has been answered.'
                        : ownerFilter === 'quiet'
                          ? 'Nothing has gone quiet. Every open chat has either come back or has a reminder on it.'
                          : 'No chats match that search.'}
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

                    {/* Three lines, in the order somebody reads them: who and
                        when, what was last said, then what state it is in.
                        The badges used to sit inline with the name and with
                        the preview, so a row carrying two of them pushed the
                        name out of view — the one thing being looked for. */}
                    <div className="min-w-0 flex-1 flex flex-col" style={{ gap: 2 }}>
                      <div className="flex items-baseline gap-2">
                        <span
                          className="truncate"
                          style={{ fontSize: 14, fontWeight: isUnread ? 800 : 600, color: INK }}
                        >
                          {label}
                        </span>
                        <span className="shrink-0" style={{ marginLeft: 'auto', fontSize: 11, color: '#A09AAA' }}>
                          {formatListTime(c.lastAt)}
                        </span>
                      </div>

                      <div className="truncate" style={{ fontSize: 12.5, color: '#756E80' }}>
                        {previewByPhone[c.phoneNormalized] ?? `${c.count} messages`}
                      </div>

                      {/* The state of the chat, on its own line. Only the owner
                          truncates: the chips are a fixed width and carry the
                          things worth noticing while scrolling past.

                          No overflow-hidden here. The owner name below clips
                          itself with `truncate min-w-0`, so it was never needed
                          for that — but this row is one line tall, and Assign
                          opens its menu underneath, so hiding the overflow made
                          that menu invisible and the button look broken. */}
                      <div
                        className="flex items-center gap-1.5 min-w-0"
                        style={{ fontSize: 11, color: '#A09AAA', whiteSpace: 'nowrap' }}
                      >
                        {(c.customer || (c.lead && (!isPlaceholderName(c.lead.fullName) || c.lead.assigned))) && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5"
                            title={
                              isTenant(c) ? 'A tenant — they have signed'
                                : c.customer ? 'Quoted, but they have not signed'
                                  : c.lead?.autoAssigned ? `Given to ${c.lead.ownerName} by the distribution rules`
                                    : c.lead?.assignedByName ? `Given to ${c.lead.ownerName} by ${c.lead.assignedByName}`
                                      : undefined
                            }
                            style={
                              isTenant(c)
                                ? { fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#047857' }
                                : c.customer
                                  ? { fontSize: 10, fontWeight: 700, background: '#FEF3C7', color: '#92400E' }
                                  : { fontSize: 10, fontWeight: 700, background: '#F3EDFF', color: '#4A1FA0' }
                            }
                          >
                            {isTenant(c) ? 'Customer' : c.customer ? 'Quoted' : 'Lead'}
                          </span>
                        )}

                        {/* The owner as a name beside the chip rather than
                            inside it, so it is not one long "Lead (mohammed
                            emad)" badge competing with everything else. */}
                        {!c.customer && c.lead?.ownerName && (
                          <span className="truncate min-w-0">
                            {c.lead.ownerName}
                            {/* How it came to be theirs. The rota hands out
                                most of these now, and "why is this mine?" is a
                                fair question to answer from the row. */}
                            {c.lead.autoAssigned && (
                              <Sparkles size={9} style={{ display: 'inline', marginLeft: 3, verticalAlign: 'middle' }} />
                            )}
                          </span>
                        )}

                        {/* How long they have been owed an answer. */}
                        {isWaiting(c) && (
                          <span
                            className="shrink-0 rounded-full px-1.5"
                            style={{ fontSize: 10, fontWeight: 700, ...(() => { const t = waitTone(c.waitingSince || c.lastInboundAt || ''); return { background: t.bg, color: t.fg } })() }}
                            title={`Waiting ${waitedFor(c.waitingSince || c.lastInboundAt || '')} for a reply`}
                          >
                            {waitedFor(c.waitingSince || c.lastInboundAt || '')}
                          </span>
                        )}

                        {/* Silent on us. Muted next to the waiting chip: both
                            need doing, one of them has somebody hanging. */}
                        {!isWaiting(c) && isQuiet(c) && (
                          <span
                            className="shrink-0 rounded-full px-1.5"
                            style={{ fontSize: 10, fontWeight: 700, background: '#F1F5F9', color: '#64748B' }}
                            title={`No reply from them for ${waitedFor(c.quietSince || '')}`}
                          >
                            {waitedFor(c.quietSince || '')} quiet
                          </span>
                        )}

                        {/* Somebody is on it, with a date. */}
                        {c.lead?.followUpAt && new Date(c.lead.followUpAt) > new Date() && (
                          <span
                            className="shrink-0 rounded-full px-1.5"
                            style={{ fontSize: 10, fontWeight: 700, background: '#EDE5FF', color: '#4A1FA0' }}
                            title={`Follow-up set for ${new Date(c.lead.followUpAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`}
                          >
                            <Bell size={9} style={{ display: 'inline', verticalAlign: 'middle' }} />
                          </span>
                        )}

                        {/* The assistant is waiting on someone, or has a reply
                            ready to send — both need a person. */}
                        {c.botStatus === 'escalated' ? (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5"
                            style={{ fontSize: 10, fontWeight: 700, background: '#FFF1CC', color: '#8A5A00' }}
                            title={c.botEscalationReason || 'The assistant handed this over'}
                          >
                            Needs you
                          </span>
                        ) : null}

                        {/* Nobody has picked this up. One tap puts a name on
                            it, rather than opening the chat to reach a menu. */}
                        {!c.customer && !c.lead?.ownerId && (
                          <QuickAssign convo={c} onChanged={() => refetchConvos()} />
                        )}
                      </div>

                      {(c.labels || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.labels.map((l) => <LabelChip key={l._id} label={l} />)}
                        </div>
                      )}
                    </div>

                    {/* Unread, at the edge. A count rather than a dot: one
                        message waiting and nine are different situations. */}
                    {isUnread && (
                      <span
                        className="shrink-0 rounded-full text-white flex items-center justify-center"
                        style={{ minWidth: 20, height: 20, padding: '0 6px', fontSize: 11, fontWeight: 700, background: '#5B2BC9' }}
                      >
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </button>
                )
              })
            )}

            {/* The list holds a window, not everything. Saying so — and
                offering the rest — beats an older chat simply not being
                there, which reads as lost rather than unlisted. */}
            {!loadingConvos && convoMatched > convoList.length && (
              <div className="px-3 py-3">
                <button
                  type="button"
                  onClick={() => setConvoLimit((n) => n + 300)}
                  className="w-full rounded-lg py-2 cursor-pointer"
                  style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0', fontSize: 12.5, fontWeight: 700 }}
                >
                  Show older chats
                </button>
                <p className="text-center mt-1.5" style={{ fontSize: 11, color: FAINT_INK }}>
                  Showing {convoList.length} of {convoMatched}
                  {debouncedSearch ? ' matching' : ''} · {convoTotal} in total
                </p>
              </div>
            )}

            {!loadingConvos && debouncedSearch && filteredConvos.length > 0 && convoMatched <= convoList.length && (
              <p className="px-4 py-2.5 text-center" style={{ fontSize: 11, color: FAINT_INK }}>
                {convoMatched} of {convoTotal} chats match “{debouncedSearch}”
              </p>
            )}
          </div>
        </aside>
        )}

        {sidebarOpen && <div className="wa-scrim" onClick={() => setSidebarOpen(false)} aria-hidden />}

        {/* 3. Chat pane */}
        <section className="flex flex-col flex-1 min-w-0 min-h-0" style={{ background: '#F6F0E4' }}>
          <header
            className="wa-head shrink-0 flex items-center gap-3 px-4"
            style={{ height: 64, background: '#fff', borderBottom: `1px solid ${LINE}` }}
          >
            <button
              type="button"
              className="wa-mobile-only items-center justify-center h-8 w-8 rounded-lg cursor-pointer shrink-0"
              // Nothing to go back to when the page is about one person.
              style={{ display: embedded ? 'none' : undefined, background: '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0' }}
              aria-label="Show chats"
              onClick={() => setSidebarOpen((v) => !v)}
            >
              <Menu size={16} />
            </button>

            {selectedConvo ? (
              <>
                <Avatar seed={selectedConvo.phoneNormalized} label={convoTitle} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    {renaming ? (
                      <form
                        className="flex items-center gap-1.5 min-w-0"
                        onSubmit={(e) => { e.preventDefault(); if (nameDraft.trim()) renameParty.mutate(nameDraft.trim()) }}
                      >
                        <input
                          autoFocus
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(false) }}
                          placeholder="Their name"
                          className="min-w-0"
                          style={{ width: 190, height: 30, borderRadius: 8, border: `1px solid ${LINE}`, padding: '0 9px', fontSize: 14, fontWeight: 600, color: INK, outline: 'none' }}
                        />
                        <button
                          type="submit"
                          disabled={!nameDraft.trim() || renameParty.isPending}
                          className="rounded-full px-2.5 py-1 cursor-pointer disabled:opacity-40 shrink-0"
                          style={{ fontSize: 11, fontWeight: 700, background: '#5B2BC9', color: '#fff', border: 'none' }}
                        >
                          {renameParty.isPending ? '…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenaming(false)}
                          className="cursor-pointer shrink-0"
                          style={{ fontSize: 11, color: FAINT_INK, background: 'none', border: 'none' }}
                        >
                          Cancel
                        </button>
                        {/* A refused save has to say so — the lead route turns
                            a duplicate number away, and silence would read as
                            success. */}
                        {renameParty.isError && (
                          <span className="truncate" style={{ fontSize: 11, color: '#B91C1C' }}>
                            {apiError(renameParty.error)}
                          </span>
                        )}
                      </form>
                    ) : (
                      <>
                        {selectedConvo.customer || selectedConvo.lead ? (
                          <Link
                            to={selectedConvo.customer
                              ? `/customers/${selectedConvo.customer._id}`
                              : `/leads/${selectedConvo.lead!._id}`}
                            title="Open their profile"
                            className="truncate hover:underline"
                            style={{ fontSize: 15, fontWeight: 700, color: INK }}
                          >
                            {convoTitle}
                          </Link>
                        ) : (
                          <span className="truncate" style={{ fontSize: 15, fontWeight: 700, color: INK }}>{convoTitle}</span>
                        )}
                        {(selectedConvo.customer || selectedConvo.lead) && (
                          <button
                            type="button"
                            title="Change this name"
                            aria-label="Change this name"
                            onClick={() => {
                              setNameDraft(selectedConvo.customer?.fullName || selectedConvo.lead?.fullName || '')
                              setRenaming(true)
                            }}
                            className="shrink-0 cursor-pointer"
                            style={{ background: 'none', border: 'none', color: FAINT_INK, padding: 2, lineHeight: 0 }}
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                      </>
                    )}
                    {selectedConvo.customer ? (
                      <span className="shrink-0 rounded-full px-2 py-0.5" style={{ fontSize: 10, fontWeight: 700, background: '#DCFCE7', color: '#047857' }}>
                        Customer
                      </span>
                    ) : selectedConvo.lead && !isPlaceholderName(selectedConvo.lead.fullName) ? (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5"
                        style={{ fontSize: 10, fontWeight: 700, background: '#F3EDFF', color: '#4A1FA0' }}
                        title={selectedConvo.lead.ownerName ? `Assigned to ${selectedConvo.lead.ownerName}` : 'Not assigned to anybody yet'}
                      >
                        Lead
                        <span className="wa-badge-detail">
                          {selectedConvo.lead.ownerName ? ` (${selectedConvo.lead.ownerName})` : ' — unassigned'}
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate" style={{ fontSize: 12, color: FAINT_INK }}>
                    +{selectedConvo.phoneNormalized}
                    {/* Said in words here, where there is room for it. */}
                    {selectedConvo.lead?.ownerName && (
                      selectedConvo.lead.autoAssigned
                        ? <span> · given to {selectedConvo.lead.ownerName} by the rota</span>
                        : selectedConvo.lead.assignedByName
                          ? <span> · given to {selectedConvo.lead.ownerName} by {selectedConvo.lead.assignedByName}</span>
                          : null
                    )}
                  </div>
                </div>

                {/* Everything this chat can do, behind one button.
                    Five unlabelled circles told you nothing and left no room
                    for the name; named rows say what they are and cost 32
                    pixels. */}
                <div className="relative shrink-0" ref={chatMenuRef}>
                  <button
                    type="button"
                    onClick={() => setChatMenuOpen((v) => !v)}
                    className="inline-flex items-center justify-center rounded-full cursor-pointer"
                    style={{ width: 32, height: 32, background: chatMenuOpen ? '#EDE5FF' : '#F7F3FF', border: '1px solid #EDE5FF', color: '#4A1FA0' }}
                    title="More"
                    aria-label="More actions for this chat"
                    aria-expanded={chatMenuOpen}
                  >
                    <MoreVertical size={16} />
                  </button>

                  {chatMenuOpen && (
                    <div
                      className="absolute right-0 mt-1 z-30 rounded-xl overflow-hidden"
                      style={{ background: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 10px 30px rgba(20,8,31,.16)', minWidth: 218 }}
                      onClick={(e) => {
                        // A row that opens a dialog should close the menu behind
                        // it; the label picker opens in place, so it must not.
                        const t = e.target as HTMLElement
                        if (!t.closest('[data-keep-open]')) setChatMenuOpen(false)
                      }}
                    >
                      <a
                        href={`https://wa.me/${selectedConvo.phoneNormalized}`}
                        target="_blank"
                        rel="noreferrer"
                        className={MENU_ROW}
                        style={{ color: INK, textDecoration: 'none' }}
                      >
                        <MessageSquare size={15} style={{ color: '#047857' }} />
                        <span className="flex-1">Open in WhatsApp</span>
                      </a>

                      <button type="button" onClick={() => setQrOpen(true)} className={MENU_ROW} style={{ color: INK }}>
                        <Zap size={15} style={{ color: '#4A1FA0' }} />
                        <span className="flex-1">Quick replies &amp; templates</span>
                      </button>

                      <div data-keep-open>
                        <LabelPicker
                          menuItem
                          convo={selectedConvo}
                          labels={waLabels}
                          onChanged={() => {
                            refetchConvos()
                            qc.invalidateQueries({ queryKey: ['wa-labels'] })
                          }}
                        />
                      </div>

                      <button type="button" onClick={() => setTaskOpen(true)} className={MENU_ROW} style={{ color: INK }}>
                        <ClipboardList size={15} style={{ color: '#B45309' }} />
                        <span className="flex-1">Create a task</span>
                      </button>

                      {/* Opens in place like the labels row, so picking a
                          person does not shut the menu before the list. */}
                      <div data-keep-open>
                        <AssignRep convo={selectedConvo} onChanged={() => refetchConvos()} />
                      </div>

                      {/* Its dialog holds the form you are filling in, so the
                          row must not close the menu out from under it. */}
                      <div data-keep-open>
                        <LeadAction menuItem convo={selectedConvo} onChanged={onSent} />
                      </div>
                    </div>
                  )}

                  {/* Mounted out here, not in the dropdown above, so closing
                      the menu does not take the panel with it. */}
                  <TaskFromChat
                    convo={selectedConvo}
                    lastInbound={lastInboundText}
                    trigger={false}
                    open={taskOpen}
                    onOpenChange={setTaskOpen}
                  />
                </div>
              </>
            ) : (
              <div className="min-w-0 flex-1">
                <div style={{ fontSize: 15, fontWeight: 700, color: INK }}>No chat open</div>
                <div style={{ fontSize: 12, color: FAINT_INK }}>Pick a conversation on the left</div>
              </div>
            )}
          </header>

          {selectedConvo && <ConversationDigest phoneNormalized={selectedConvo.phoneNormalized} />}

          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="wa-thread wa-scroll flex-1 min-h-0 flex flex-col gap-[10px]"
            style={{
              padding: '22px 26px',
              /* Tiled wallpaper behind the bubbles, over a near-white base so
                 the tile's own edges never show as bands.

                 The base was a full cream, which put a strong colour behind
                 every message and left the white bubbles looking like cut-outs
                 laid on top. This is the same warmth at a fraction of the
                 strength: enough that the thread is not a flat white page,
                 little enough that the bubbles are what carries the colour. */
              backgroundColor: '#FCFAF6',
              // The wash over the tile knocks the pattern back so the bubbles
              // stay the thing you read. Heavier than before, because a paler
              // ground shows the pattern more.
              backgroundImage: 'linear-gradient(rgba(252,250,246,.90), rgba(252,250,246,.90)), url(/chat-bg.avif)',
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
          {selectedConvo?.botStatus === 'escalated' && !escalationHidden.has(selectedConvo.phoneNormalized) && (
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
              {/* Out of the way without handing the thread back: reading the
                  reason is usually all somebody needs, and after that the
                  notice is just taking up the composer's space. It returns if
                  the assistant escalates again. */}
              <button
                type="button"
                onClick={() => setEscalationHidden((h) => new Set(h).add(selectedConvo.phoneNormalized))}
                className="shrink-0 cursor-pointer"
                style={{ background: 'none', border: 'none', color: '#8A5A00', lineHeight: 1, padding: 2 }}
                title="Hide this notice"
                aria-label="Hide this notice"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* When to come back to this.
              Its own strip above the composer, visible whether or not the
              assistant has anything to say — a reminder is about the chat, not
              about the reply. */}
          {selectedConvo?.lead && (
            <div className="shrink-0 mx-6 mb-2 flex flex-wrap items-center gap-2">
              {selectedConvo.lead.followUpAt && new Date(selectedConvo.lead.followUpAt) > new Date() ? (
                <>
                  <span
                    className="h-7 px-3 rounded-full inline-flex items-center gap-1.5"
                    style={{ background: '#EDE5FF', color: '#4A1FA0', fontSize: 12, fontWeight: 700 }}
                  >
                    <Bell size={12} />
                    Follow up {new Date(selectedConvo.lead.followUpAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <button
                    type="button"
                    onClick={() => remind.mutate({ phone: selectedConvo.phoneNormalized, when: 'clear' })}
                    disabled={remind.isPending}
                    className="cursor-pointer disabled:opacity-50"
                    style={{ fontSize: 11, fontWeight: 600, color: FAINT_INK, background: 'none', border: 'none' }}
                  >
                    Clear
                  </button>
                  {/* Said here as well as in the lead's timeline: somebody
                      setting a reminder should know it will not fire at them
                      while they are mid-conversation. */}
                  <span style={{ fontSize: 11, color: FAINT_INK }}>Cancels itself if they write back.</span>
                </>
              ) : remindOpen ? (
                <>
                  {([['tomorrow', 'Tomorrow'], ['three_days', 'In 3 days'], ['next_week', 'Next week']] as const).map(([when, label]) => (
                    <button
                      key={when}
                      type="button"
                      onClick={() => remind.mutate({ phone: selectedConvo.phoneNormalized, when })}
                      disabled={remind.isPending}
                      className="h-7 px-3 rounded-full cursor-pointer disabled:opacity-50"
                      style={{ border: `1px solid ${LINE}`, background: '#fff', fontSize: 12, fontWeight: 600, color: INK }}
                    >
                      {label}
                    </button>
                  ))}
                  <input
                    type="date"
                    value={remindDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => {
                      setRemindDate(e.target.value)
                      if (e.target.value) remind.mutate({ phone: selectedConvo.phoneNormalized, when: e.target.value })
                    }}
                    className="h-7 px-2 rounded-full cursor-pointer"
                    style={{ border: `1px solid ${LINE}`, background: '#fff', fontSize: 12, color: INK }}
                    aria-label="Pick a day to follow up"
                  />
                  <button
                    type="button"
                    onClick={() => setRemindOpen(false)}
                    className="cursor-pointer"
                    style={{ fontSize: 11, fontWeight: 600, color: FAINT_INK, background: 'none', border: 'none' }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setRemindOpen(true)}
                  className="h-7 px-3 rounded-full cursor-pointer inline-flex items-center gap-1.5"
                  style={{ border: `1px solid ${LINE}`, background: '#fff', fontSize: 12, fontWeight: 600, color: INK }}
                  title="Set a reminder to come back to this chat"
                >
                  <Bell size={12} /> Remind me
                </button>
              )}
            </div>
          )}

          {/* No suggestion, so offer to write one.
              Dismissing removes a suggestion for good, which is what it should
              do — but there was then no way to ask for another until the
              customer wrote again. */}
          {selectedConvo && !selectedConvo.botDraft && selectedConvo.botStatus !== 'escalated' && (
            <div className="shrink-0 mx-6 mb-2">
              <button
                type="button"
                onClick={() => suggestAgain.mutate(selectedConvo.phoneNormalized)}
                disabled={suggestAgain.isPending}
                className="h-7 px-3 rounded-full cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
                style={{ border: `1px solid ${LINE}`, background: '#fff', fontSize: 12, fontWeight: 600, color: '#4A1FA0' }}
                title="Ask the assistant for a reply to their last message"
              >
                {suggestAgain.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {suggestAgain.isPending ? 'Thinking…' : 'Suggest a reply'}
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
                {/* Hear it, and send the voice — so what the customer gets is
                    what was approved, and a spoken reply can be judged before
                    anybody turns automatic replies on. */}
                <button type="button"
                  onClick={() => hearDraft(selectedConvo.botDraft!)}
                  className="h-7 px-3 rounded-full cursor-pointer inline-flex items-center gap-1.5"
                  style={{ border: `1px solid ${LINE}`, background: '#fff', fontSize: 12, fontWeight: 600, color: MUTED_INK }}
                  title={hearing === 'playing' ? 'Stop' : 'Hear this read aloud. Nothing is sent.'}>
                  {hearing === 'loading' ? <Loader2 size={12} className="animate-spin" />
                    : hearing === 'playing' ? <Square size={11} />
                      : <Mic size={12} />}
                  {hearing === 'loading' ? 'Speaking…' : hearing === 'playing' ? 'Stop' : 'Hear it'}
                </button>
                <button type="button"
                  onClick={() => sendVoiceDraft.mutate({ phone: selectedConvo.phoneNormalized, text: selectedConvo.botDraft! })}
                  disabled={sendVoiceDraft.isPending}
                  className="h-7 px-3 rounded-full cursor-pointer disabled:opacity-50"
                  style={{ border: '1px solid #D9CBFA', background: '#fff', fontSize: 12, fontWeight: 700, color: '#4A1FA0' }}
                  title="Send this as a voice note">
                  {sendVoiceDraft.isPending ? 'Sending…' : 'Send as voice'}
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

          {/* Said before they type, not after Meta rejects it. */}
          {selectedPhone && replyWindow.known && !replyWindow.open && (
            <div
              className="shrink-0 flex items-start gap-2 px-4 py-2.5"
              style={{ background: '#FFF7E6', borderTop: `1px solid ${LINE}` }}
            >
              <AlertTriangle size={14} style={{ color: '#8A5A00', flex: '0 0 auto', marginTop: 2 }} />
              <div className="min-w-0 flex-1" style={{ fontSize: 12.5, color: '#6B4500' }}>
                <strong>They last wrote over 24 hours ago.</strong>{' '}
                WhatsApp will not deliver a typed message now — send an approved template instead,
                or ask them to message first.
                <button
                  type="button"
                  onClick={() => { setPanelTab('templates'); setQrOpen(true) }}
                  className="ml-1 underline cursor-pointer"
                  style={{ color: '#6B4500', background: 'none', border: 'none', font: 'inherit', padding: 0, fontWeight: 700 }}
                >
                  Open approved templates
                </button>
              </div>
            </div>
          )}

          {/* Recording in progress. Deliberately not push-to-talk: releasing a
              held button is easy to do by accident, and there is no way back
              from a voice note already sent. */}
          {voice.recording && (
            <div
              className="shrink-0 flex items-center gap-3 px-4 py-2.5"
              style={{ background: '#fff', borderTop: `1px solid ${LINE}` }}
            >
              <span
                className="inline-flex items-center justify-center shrink-0 animate-pulse"
                style={{ width: 34, height: 34, borderRadius: 999, background: '#FEE2E2' }}
              >
                <Mic size={16} style={{ color: '#B91C1C' }} />
              </span>
              <div className="min-w-0 flex-1">
                <div style={{ fontSize: 13, fontWeight: 700, color: '#B91C1C' }}>
                  Recording · {formatDuration(voice.seconds)}
                </div>
                <div style={{ fontSize: 11.5, color: FAINT_INK }}>
                  Stop to listen back before sending
                </div>
              </div>
              <button
                type="button"
                onClick={voice.cancel}
                className="shrink-0 cursor-pointer px-2"
                style={{ fontSize: 12.5, color: FAINT_INK }}
                title="Discard this recording"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={stopRecording}
                className="shrink-0 inline-flex items-center justify-center rounded-full cursor-pointer"
                style={{ width: 36, height: 36, background: '#B91C1C', color: '#fff' }}
                title="Stop recording"
                aria-label="Stop recording"
              >
                <Square size={13} fill="currentColor" />
              </button>
            </div>
          )}

          {voice.error && !voice.recording && (
            <p className="shrink-0 px-4 pb-1 text-xs" style={{ color: '#B91C1C' }}>{voice.error}</p>
          )}

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
                  {isVoicePending
                    ? <Mic size={18} style={{ color: '#5B2BC9' }} />
                    : <Paperclip size={18} style={{ color: '#5B2BC9' }} />}
                </span>
              )}
              <div className="min-w-0 flex-1">
                {/* A recording is worth hearing before it goes out; a picked
                    file just needs naming. */}
                {isVoicePending && voicePreview ? (
                  <>
                    <audio src={voicePreview} controls className="w-full max-w-[260px]" style={{ height: 32 }} />
                    <div style={{ fontSize: 11.5, color: FAINT_INK, marginTop: 2 }}>
                      Voice message · press send when you are happy with it
                    </div>
                  </>
                ) : (
                  <>
                    <div className="truncate" style={{ fontSize: 13, fontWeight: 600, color: INK }}>{pending.name}</div>
                    <div style={{ fontSize: 11.5, color: FAINT_INK }}>
                      {(pending.size / 1024 / 1024).toFixed(2)} MB
                      {' · the message box becomes its caption'}
                    </div>
                  </>
                )}
              </div>
              {/* While it is going up. Without this the send button just sat
                  there on a large file and people pressed it again. */}
              {uploadPct !== null ? (
                <div className="shrink-0 flex items-center gap-2" style={{ width: 108 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 999, background: '#EDE5FF', overflow: 'hidden' }}>
                    <div style={{ width: `${uploadPct}%`, height: '100%', background: '#5B2BC9', transition: 'width .2s' }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#4A1FA0', fontVariantNumeric: 'tabular-nums' }}>
                    {uploadPct}%
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setPending(null); if (fileRef.current) fileRef.current.value = '' }}
                  className="shrink-0 cursor-pointer"
                  style={{ color: FAINT_INK }}
                  title={isVoicePending ? 'Discard this recording' : 'Remove attachment'}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}

          <div
            className="wa-compose shrink-0 flex items-end gap-2 px-4 pb-3 pt-1"
            style={{ background: '#fff' }}
          >
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              /* Named types rather than anything at all: on a phone this is
                 what makes the picker offer the camera and the photo roll
                 instead of a file browser. Documents are still listed, so the
                 one button covers all of it. */
              accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                setSendErr('')
                /* Checked before it is uploaded. These are WhatsApp's limits,
                   and finding out after a 40 MB video has crawled up is a
                   waste of somebody's morning. */
                const MB = 1024 * 1024
                const cap = f.type.startsWith('image/') ? 5
                  : f.type.startsWith('video/') || f.type.startsWith('audio/') ? 16
                  : 100
                if (f.size > cap * MB) {
                  const kind = f.type.startsWith('image/') ? 'Images'
                    : f.type.startsWith('video/') ? 'Videos'
                    : f.type.startsWith('audio/') ? 'Audio files' : 'Files'
                  setSendErr(`${kind} can be up to ${cap} MB on WhatsApp. That one is ${(f.size / MB).toFixed(1)} MB.`)
                  e.target.value = ''
                  return
                }
                setPending(f)
              }}
            />
            <IconButton
              title="Attach a photo, video, audio or document"
              onClick={() => fileRef.current?.click()}
              className="!h-10 !w-10 shrink-0"
            >
              <Paperclip size={16} />
            </IconButton>
            <IconButton title="Quick replies and approved templates" onClick={() => setQrOpen((v) => !v)} className="!h-10 !w-10 shrink-0">
              <Zap size={16} />
            </IconButton>
            {/* Hidden while a recording is in progress — the strip above
                replaces the whole composer with the recorder's own controls. */}
            {recordingSupported() && !voice.recording && !isVoicePending && (
              <IconButton
                title="Record a voice message"
                onClick={() => { setSendErr(''); voice.start() }}
                className="!h-10 !w-10 shrink-0"
              >
                <Mic size={16} />
              </IconButton>
            )}
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
            <div className="shrink-0 px-4 py-3.5" style={{ borderBottom: `1px solid ${LINE}` }}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2 style={{ fontFamily: "'Bricolage Grotesque', serif", fontWeight: 700, fontSize: 17, color: INK }}>
                    {panelTab === 'quick' ? 'Quick replies' : 'Approved templates'}
                  </h2>
                  <p style={{ fontSize: 11.5, color: FAINT_INK }}>
                    {panelTab === 'quick'
                      ? 'Tap one to send it'
                      : replyWindow.open
                        ? 'For chats outside the 24-hour window'
                        : 'The only messages Meta will deliver now'}
                  </p>
                </div>
                <button type="button" onClick={() => setQrOpen(false)} className="cursor-pointer p-1" style={{ color: FAINT_INK }} aria-label="Close panel">
                  <X size={16} />
                </button>
              </div>

              {/* Which list is the right one is not a preference — the window
                  decides it, so the closed state is marked here rather than
                  left for a rep to remember. */}
              <div className="mt-2.5 flex gap-1 p-0.5" style={{ background: '#F3EEFB', borderRadius: 10 }}>
                {([['quick', 'Quick replies'], ['templates', 'Templates']] as const).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPanelTab(id)}
                    className="flex-1 cursor-pointer py-1.5"
                    style={{
                      fontSize: 12, fontWeight: 700, borderRadius: 8,
                      background: panelTab === id ? '#fff' : 'transparent',
                      color: panelTab === id ? '#4A1FA0' : FAINT_INK,
                      boxShadow: panelTab === id ? '0 1px 2px rgba(20,8,31,.12)' : undefined,
                    }}
                  >
                    {label}
                    {id === 'quick' && replyWindow.known && !replyWindow.open && (
                      <span title="Free text will not be delivered right now" style={{ marginLeft: 4, color: '#B45309' }}>!</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {panelTab === 'quick' && (
            <div className="wa-scroll flex-1 min-h-0 px-3 py-3 space-y-3">
              {replyWindow.known && !replyWindow.open && (
                <p
                  className="px-3 py-2"
                  style={{ background: '#FFF7E6', border: '1px solid #F3DFB0', borderRadius: 10, fontSize: 11.5, color: '#6B4500' }}
                >
                  They last wrote over 24 hours ago, so none of these will be delivered.{' '}
                  <button
                    type="button"
                    onClick={() => setPanelTab('templates')}
                    className="underline cursor-pointer"
                    style={{ color: '#6B4500', background: 'none', border: 'none', font: 'inherit', padding: 0, fontWeight: 700 }}
                  >
                    Use a template
                  </button>
                </p>
              )}
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
                                    title={t.mediaKind === 'location' ? 'Sends our location pin' : `Sends a ${t.mediaKind}`}
                                  >
                                    {t.mediaKind === 'location' ? <MapPin size={9} /> : <Paperclip size={9} />}{t.mediaKind}
                                  </span>
                                )}
                              </div>
                              {/* One tap sends it, whichever reply it is.
                                  Tapping the words used to drop them into the
                                  message box instead — which quietly left a
                                  video behind, and meant every canned reply
                                  took two actions to send when the whole point
                                  of them is that they are ready to go. */}
                              <button
                                type="button"
                                onClick={() => sendQuickReply.mutate(t._id)}
                                disabled={!selectedPhone || send.isPending || sendQuickReply.isPending}
                                className="text-left w-full cursor-pointer hover:opacity-75 disabled:opacity-40"
                                style={{ fontSize: 12.5, color: MUTED_INK, whiteSpace: 'pre-wrap' }}
                                title={t.mediaKind ? `Send this, with the ${t.mediaKind}` : 'Send this now'}
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
            )}

            {panelTab === 'templates' && (
              <div className="wa-scroll flex-1 min-h-0 px-3 py-3 space-y-2.5">
                {replyWindow.open && (
                  <p className="px-1" style={{ fontSize: 11.5, color: FAINT_INK }}>
                    They wrote within the last 24 hours, so an ordinary reply still reaches
                    them — a template is not needed yet.
                  </p>
                )}

                {/* Asked by every rep who opens this panel, so answered
                    before they ask. The wording is fixed at approval — that is
                    what buys a template the right to be delivered at all. */}
                {!waTemplatesLoading && (waTemplates?.templates.length ?? 0) > 0 && (
                  <p className="px-1" style={{ fontSize: 11, color: FAINT_INK, lineHeight: 1.5 }}>
                    Meta approves the wording, so it cannot be changed here — only the
                    highlighted blanks. Their reply reopens the 24-hour window and you can
                    type freely again.
                  </p>
                )}

                {waTemplatesLoading && (
                  <p className="px-1 py-2" style={{ fontSize: 12, color: FAINT_INK }}>Loading templates from Meta…</p>
                )}

                {/* Meta is the authority on this list, not us: if it cannot be
                    fetched, saying so beats an empty panel that reads like
                    "there are no templates". */}
                {!waTemplatesLoading && (waTemplatesError || waTemplates?.error) && (
                  <p className="px-3 py-2" style={{ background: '#FEF2F2', border: '1px solid #FBD5D5', borderRadius: 10, fontSize: 11.5, color: '#8A1C1C' }}>
                    Could not load templates: {waTemplatesError ? apiError(waTemplatesError) : waTemplates?.error}
                  </p>
                )}

                {!waTemplatesLoading && !waTemplatesError && !waTemplates?.error && (waTemplates?.templates.length ?? 0) === 0 && (
                  <p className="px-1 py-2" style={{ fontSize: 12, color: FAINT_INK }}>
                    No approved templates on this WhatsApp account yet. They are written and
                    approved in Meta Business Manager, then appear here.
                  </p>
                )}

                {(waTemplates?.templates ?? []).map((t) => {
                  const values = varsFor(t)
                  const ready = values.every((v) => v.trim().length > 0)
                  const expanded = openTemplate === t.name
                  return (
                    <div key={t.name} style={{ border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
                      <button
                        type="button"
                        onClick={() => setOpenTemplate(expanded ? '' : t.name)}
                        className="w-full flex items-start gap-2 px-3 py-2.5 text-left cursor-pointer"
                        style={{ background: expanded ? '#F7F3FF' : '#fff' }}
                      >
                        <div className="min-w-0 flex-1">
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#4A1FA0' }}>
                            {t.label}
                            {t.variableCount > 0 && (
                              <span
                                className="ml-1.5 inline-flex items-center rounded-full px-1.5"
                                style={{ background: '#EDE5FF', fontSize: 9.5, fontWeight: 800 }}
                                title={`Needs ${t.variableCount} value(s) before it can be sent`}
                              >
                                {t.variableCount} to fill
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5" style={{ fontSize: 12, color: MUTED_INK, whiteSpace: 'pre-wrap' }}>
                            {previewOf(t, values)}
                          </p>
                        </div>
                        <ChevronDown
                          size={15}
                          className="shrink-0 mt-0.5"
                          style={{ color: '#4A1FA0', transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }}
                        />
                      </button>

                      {expanded && (
                        <div className="px-3 pb-3 pt-2 space-y-2" style={{ borderTop: `1px solid ${LINE}` }}>
                          {values.map((v, i) => (
                            <label key={i} className="block">
                              <span style={{ fontSize: 11, fontWeight: 700, color: FAINT_INK }}>
                                {`{{${i + 1}}}`}{i === 0 ? ' · their name' : ''}
                              </span>
                              <input
                                value={v}
                                onChange={(e) => setVar(t.name, i, e.target.value, t.variableCount)}
                                className="mt-0.5 w-full px-3 py-1.5 text-[12.5px] focus:outline-none"
                                style={{ background: '#F7F3FF', border: '1px solid #EDE5FF', borderRadius: 10, color: INK }}
                                placeholder={i === 0 ? 'Ahmed' : 'Value'}
                              />
                            </label>
                          ))}
                          <button
                            type="button"
                            onClick={() => sendTemplate.mutate({ name: t.name, language: t.language, variables: values })}
                            disabled={!selectedPhone || !ready || sendTemplate.isPending}
                            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-white cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                            style={{ fontSize: 12, fontWeight: 700, background: '#5B2BC9' }}
                            title={ready ? 'Send this template now' : 'Fill every placeholder first — Meta rejects a blank one'}
                          >
                            <Send size={12} />
                            {sendTemplate.isPending ? 'Sending…' : 'Send template'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

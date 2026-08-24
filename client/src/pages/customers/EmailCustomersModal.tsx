import { useMemo, useRef, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Bold, Italic, Underline, List, Link2, Check, Search } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import type { Customer } from '../../lib/types'
import { Modal, Spinner } from '../../components/ui'

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_DEEP = '#4A1FA0'
const PURPLE_TINT = '#F7F3FF'
const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const

type Segment = 'all' | 'has_email' | 'active'

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'has_email', label: 'Has email' },
  { value: 'active', label: 'Active tenants' },
]

type SendResult = {
  sent: number; failed: number; total: number; error?: string
  // Recipients deliberately not sent to, named so nobody has to guess who.
  skipped?: { name: string; email: string; reason: string }[]
}

function initialsOf(name: string) {
  const parts = (name || '').trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

/** Plain-text template body into paragraphs, so the editor has real markup
 *  to work with rather than one run-on block. */
function textToHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br/>')}</p>`)
    .join('')
}

export default function EmailCustomersModal({
  onClose,
  defaultSegment = 'has_email',
}: {
  onClose: () => void
  defaultSegment?: Segment
}) {
  const [query, setQuery] = useState('')
  const [segment, setSegment] = useState<Segment>(defaultSegment)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState('')
  // Personalised sending is one message each, which is the only way @name can
  // be filled in — a BCC send shares one body between everybody.
  const [personalise, setPersonalise] = useState(false)
  const [templateId, setTemplateId] = useState('')

  // The email templates from Settings → Message Templates. Quick replies are
  // WhatsApp-only, so they are not offered here.
  type EmailTemplate = { _id: string; label: string; subject: string; emailBody: string; emailHtml?: string }
  const { data: templates = [] } = useQuery<EmailTemplate[]>({
    queryKey: ['message-templates', 'automation'],
    queryFn: () => api.get('/message-templates', { params: { kind: 'automation' } }).then((r) => r.data ?? []),
    staleTime: 60_000,
  })
  const [result, setResult] = useState<SendResult | null>(null)
  const [error, setError] = useState('')
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // The list owns its own fetch rather than reusing the page's selection: that
  // Set holds ids only and is cleared whenever the page/search/sort changes.
  const { data, isLoading } = useQuery<{ data: Customer[] }>({
    queryKey: ['customers-email-all'],
    queryFn: () => api.get('/customers', { params: { limit: 9999 } }).then((r) => r.data),
  })
  const customers = data?.data ?? []

  // Only fetched when the Active-tenants segment is actually used.
  const { data: activeContracts } = useQuery<{ data?: { customer?: { _id: string } }[] }>({
    queryKey: ['customers-email-active-contracts'],
    queryFn: () => api.get('/contracts', { params: { status: 'active', limit: 2000 } }).then((r) => r.data),
    enabled: segment === 'active',
  })
  const activeIds = useMemo(() => {
    const rows = activeContracts?.data ?? []
    return new Set(rows.map((c) => c.customer?._id).filter(Boolean) as string[])
  }, [activeContracts])

  const { data: status } = useQuery<{ email?: { configured: boolean; from: string } }>({
    queryKey: ['integrations-status'],
    queryFn: () => api.get('/integrations/status').then((r) => r.data),
  })
  const fromAddress = status?.email?.from || ''

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return customers.filter((c) => {
      if (segment === 'has_email' && !c.email) return false
      if (segment === 'active' && !activeIds.has(c._id)) return false
      if (!q) return true
      return (c.fullName || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q)
    })
  }, [customers, query, segment, activeIds])

  // Only customers with an email can ever be selected. `mailable` is scoped to
  // the current filter (that's what select-all acts on), while the counter uses
  // the unfiltered total so it doesn't read "165 of 0" mid-search.
  const mailable = useMemo(() => visible.filter((c) => !!c.email), [visible])
  const totalMailable = useMemo(() => customers.filter((c) => !!c.email).length, [customers])
  const allMailableSelected = mailable.length > 0 && mailable.every((c) => selected.has(c._id))
  const selectedCount = selected.size
  const filtering = query.trim() !== '' || segment !== 'has_email'
  const loadingSegment = segment === 'active' && !activeContracts

  function toggleAll() {
    setSelected((s) => {
      const n = new Set(s)
      if (allMailableSelected) mailable.forEach((c) => n.delete(c._id))
      else mailable.forEach((c) => n.add(c._id))
      return n
    })
  }
  function toggleOne(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // execCommand is deprecated but universally supported, and it's already the
  // idiom used by the agreement editor in this codebase.
  function exec(cmd: string) {
    bodyRef.current?.focus()
    if (cmd === 'createLink') {
      const url = window.prompt('Link URL')
      if (!url) return
      document.execCommand('createLink', false, url)
      return
    }
    document.execCommand(cmd)
  }

  const send = useMutation({
    mutationFn: () => api.post('/customers/send-email', {
      personalise,
      customerIds: [...selected],
      subject,
      html: bodyRef.current?.innerHTML ?? '',
    }).then((r) => r.data as SendResult),
    onSuccess: (r) => { setError(''); setResult(r) },
    onError: (e) => setError(apiError(e)),
  })

  // Which placeholders the chosen template actually uses, split by whether a
  // bulk send can resolve them. Recomputed when the template changes, not on
  // every keystroke — the editor is uncontrolled, so its content is only read
  // on send anyway.
  const FILLABLE = [
    '@name', '@email', '@company',
    '@contractNo', '@unit', '@startDate', '@endDate', '@dueDate',
    '@daysLeft', '@rate', '@lateFee', '@renewLink', '@moveOutLink',
  ]
  const { usedPlaceholders, unfillable } = useMemo(() => {
    const t = templates.find((x) => x._id === templateId)
    if (!t) return { usedPlaceholders: [] as string[], unfillable: [] as string[] }
    const source = `${t.subject || ''} ${t.emailHtml || t.emailBody || ''}`
    const found = [...new Set((source.match(/@\w+/g) || []))]
    return {
      usedPlaceholders: found,
      // Contract-level values — a bulk email is not tied to one contract, so
      // these have nothing to resolve against however it is sent.
      unfillable: found.filter((v) => !FILLABLE.includes(v)),
    }
  }, [templateId, templates])

  const sendDisabled = selectedCount === 0 || !subject.trim() || send.isPending

  const toolbarBtn = 'w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer hover:bg-black/5 transition-colors'
  const toolbarStyle = { border: '1px solid rgba(20,8,31,.12)', background: 'white', color: INK } as const

  return (
    <Modal
      open
      onClose={onClose}
      className="sm:max-w-5xl"
      title={
        <div>
          <div style={{ ...HEADING, fontSize: 17, fontWeight: 700, color: INK }}>Email customers</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 1 }}>Compose once, send to everyone who has an email on file.</div>
        </div>
      }
    >
      {result ? (
        <div className="flex flex-col items-center justify-center text-center gap-3 py-14">
          <div style={{ width: 56, height: 56, borderRadius: 999, background: result.failed ? '#B45309' : PURPLE, color: 'white' }} className="grid place-items-center">
            <Check size={26} />
          </div>
          <div style={{ ...HEADING, fontSize: 22, fontWeight: 700, color: INK }}>
            {result.failed
              ? `Sent to ${result.sent}, ${result.failed} failed`
              : `Sent to ${result.sent} customer${result.sent !== 1 ? 's' : ''}`}
          </div>
          <div style={{ fontSize: 13.5, color: MUTED, maxWidth: '44ch' }}>
            {result.failed
              ? `${result.error || 'Some recipients could not be reached.'} The ${result.sent} that went out are logged on their records.`
              : 'Your email has been handed to the mail server. Customers will receive it shortly.'}
          </div>

          {/* Skipped is not failed — these were held back on purpose, and the
              reason matters more than the count. */}
          {(result.skipped?.length ?? 0) > 0 && (
            <div
              style={{ maxWidth: '46ch', textAlign: 'left', background: '#FFF7E6', border: '1px solid #F5D9A0', borderRadius: 12, padding: '12px 14px' }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#6B4500', marginBottom: 6 }}>
                {result.skipped!.length} not sent
              </div>
              <div style={{ fontSize: 12, color: '#6B4500', lineHeight: 1.55 }}>
                {result.skipped!.slice(0, 6).map((sk) => (
                  <div key={sk.email}>{sk.name || sk.email} — {sk.reason}</div>
                ))}
                {result.skipped!.length > 6 && <div>…and {result.skipped!.length - 6} more</div>}
              </div>
            </div>
          )}
          <button
            onClick={onClose}
            style={{ marginTop: 6, height: 40, padding: '0 20px', borderRadius: 999, background: 'transparent', border: '1px solid rgba(20,8,31,.16)', color: INK, fontWeight: 600, fontSize: 13.5 }}
            className="cursor-pointer hover:bg-black/5 transition-colors"
          >
            Close
          </button>
        </div>
      ) : (
        // The Modal shell scrolls as one block, so the two panes get their own
        // fixed-height flex container to scroll independently.
        <div className="flex flex-col lg:flex-row" style={{ height: '66vh', minHeight: 0, margin: -4 }}>
          {/* ── Recipients ── */}
          <div
            className="flex flex-col shrink-0 w-full lg:w-[300px] min-h-0"
            style={{ background: PURPLE_TINT, borderRadius: 14, border: '1px solid rgba(20,8,31,.08)' }}
          >
            <div className="p-3.5 pb-3">
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: PURPLE_DEEP }}>Recipients</div>
              <div className="relative mt-2.5">
                <Search size={14} style={{ color: MUTED, position: 'absolute', left: 10, top: 11 }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search customers…"
                  style={{ width: '100%', height: 36, padding: '0 10px 0 30px', borderRadius: 10, border: '1px solid rgba(20,8,31,.14)', fontSize: 13.5, background: 'white' }}
                />
              </div>
              <div className="flex gap-1.5 mt-2.5 flex-wrap">
                {SEGMENTS.map((s) => {
                  const active = segment === s.value
                  return (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setSegment(s.value)}
                      style={{
                        fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: '4px 10px', cursor: 'pointer',
                        background: active ? PURPLE : 'white',
                        color: active ? 'white' : MUTED,
                        border: `1px solid ${active ? PURPLE : 'rgba(20,8,31,.12)'}`,
                      }}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div
              className="px-3.5 py-2 flex items-center justify-between"
              style={{ borderTop: '1px solid rgba(20,8,31,.08)', borderBottom: '1px solid rgba(20,8,31,.08)' }}
            >
              <label className="flex items-center gap-2 cursor-pointer" style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>
                <input type="checkbox" checked={allMailableSelected} onChange={toggleAll} disabled={mailable.length === 0} />
                Select all with email
              </label>
              <span style={{ fontSize: 11.5, color: MUTED }}>
                {selectedCount} of {totalMailable}
                {filtering && ` · ${mailable.length} shown`}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 min-h-0">
              {isLoading || loadingSegment ? (
                <Spinner />
              ) : visible.length === 0 ? (
                <div className="text-center py-8" style={{ fontSize: 12.5, color: MUTED }}>No customers match.</div>
              ) : (
                visible.map((c) => {
                  const hasEmail = !!c.email
                  return (
                    <label
                      key={c._id}
                      className="flex items-center gap-2.5 rounded-lg px-2 py-2"
                      style={{ cursor: hasEmail ? 'pointer' : 'not-allowed', opacity: hasEmail ? 1 : 0.5 }}
                      title={hasEmail ? undefined : 'No email address on file'}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c._id)}
                        onChange={() => toggleOne(c._id)}
                        disabled={!hasEmail}
                      />
                      <div
                        style={{ width: 30, height: 30, borderRadius: 999, background: '#DDD0FF', color: PURPLE_DEEP, fontSize: 11, fontWeight: 700, flex: '0 0 auto' }}
                        className="grid place-items-center"
                      >
                        {initialsOf(c.fullName)}
                      </div>
                      <div className="min-w-0">
                        <div style={{ fontSize: 13, fontWeight: 600, color: INK }} className="truncate">{c.fullName}</div>
                        <div style={{ fontSize: 11.5, color: MUTED }} className="truncate">{c.email || 'No email'}</div>
                      </div>
                    </label>
                  )
                })
              )}
            </div>
          </div>

          {/* ── Compose ── */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0 lg:pl-4 pt-4 lg:pt-0">
            <div className="flex items-center gap-2.5 pb-2.5" style={{ borderBottom: '1px solid rgba(20,8,31,.10)' }}>
              <span style={{ fontSize: 12.5, color: MUTED, width: 52 }}>To</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: selectedCount ? INK : MUTED }}>
                {selectedCount
                  ? `${selectedCount} customer${selectedCount !== 1 ? 's' : ''} (blind copied)`
                  : 'No recipients selected'}
              </span>
            </div>
            <div className="flex items-center gap-2.5 py-2.5" style={{ borderBottom: '1px solid rgba(20,8,31,.10)' }}>
              <span style={{ fontSize: 12.5, color: MUTED, width: 52 }}>Template</span>
              <select
                value={templateId}
                onChange={(e) => {
                  const t = templates.find((x) => x._id === e.target.value)
                  setTemplateId(e.target.value)
                  if (!t) return
                  setSubject(t.subject || '')
                  // The designed version if the template has one, otherwise the
                  // plain text turned into paragraphs so the editor has markup
                  // to work with rather than one run-on block.
                  if (bodyRef.current) {
                    bodyRef.current.innerHTML = t.emailHtml || textToHtml(t.emailBody || '')
                  }
                }}
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13.5, color: templateId ? INK : MUTED, background: 'transparent', cursor: 'pointer' }}
              >
                <option value="">Start from blank, or pick a template…</option>
                {templates.map((t) => <option key={t._id} value={t._id}>{t.label}</option>)}
              </select>
            </div>

            {/* Placeholders are per-tenant. Which of them can actually be
                filled depends on how this is sent, so say so rather than let
                someone mail 175 people a literal "@name". */}
            {usedPlaceholders.length > 0 && (
              <div className="py-2.5" style={{ borderBottom: '1px solid rgba(20,8,31,.10)' }}>
                <label className="flex items-start gap-2 cursor-pointer" style={{ fontSize: 12.5, color: MUTED }}>
                  <input
                    type="checkbox"
                    checked={personalise}
                    onChange={(e) => setPersonalise(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <strong style={{ color: INK }}>Send individually so the details are filled in.</strong>{' '}
                    This message uses {usedPlaceholders.join(', ')}.
                    {personalise
                      ? ' Each person gets their own copy with their own name, unit and dates — slower, and it uses more of the daily sending allowance. Anyone without an active contract is skipped rather than sent a half-filled email.'
                      : ' Without this, everyone shares one blind-copied message, so these cannot be filled in and the send will be refused.'}
                    {unfillable.length > 0 && (
                      <>
                        {' '}
                        <span style={{ color: '#B45309' }}>
                          {unfillable.join(', ')} {unfillable.length === 1 ? 'is' : 'are'} not something this dialog can
                          fill — edit {unfillable.length === 1 ? 'it' : 'them'} out, or the send will be refused.
                        </span>
                      </>
                    )}
                  </span>
                </label>
              </div>
            )}

            <div className="flex items-center gap-2.5 py-2.5" style={{ borderBottom: '1px solid rgba(20,8,31,.10)' }}>
              <span style={{ fontSize: 12.5, color: MUTED, width: 52 }}>Subject</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject line"
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, fontWeight: 600, color: INK, background: 'transparent' }}
              />
            </div>

            <div className="flex gap-1 py-2.5" style={{ borderBottom: '1px solid rgba(20,8,31,.10)' }}>
              {/* preventDefault keeps the text selection alive through the click */}
              <button type="button" title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} className={toolbarBtn} style={toolbarStyle}><Bold size={14} /></button>
              <button type="button" title="Italic" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} className={toolbarBtn} style={toolbarStyle}><Italic size={14} /></button>
              <button type="button" title="Underline" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} className={toolbarBtn} style={toolbarStyle}><Underline size={14} /></button>
              <span style={{ width: 1, background: 'rgba(20,8,31,.12)', margin: '4px 4px' }} />
              <button type="button" title="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} className={toolbarBtn} style={toolbarStyle}><List size={14} /></button>
              <button type="button" title="Insert link" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('createLink')} className={toolbarBtn} style={toolbarStyle}><Link2 size={14} /></button>
            </div>

            <div
              ref={bodyRef}
              contentEditable
              suppressContentEditableWarning
              className="agreement-editor flex-1 overflow-y-auto"
              style={{ padding: '14px 2px', fontSize: 14, lineHeight: 1.65, color: INK, outline: 'none', minHeight: 0 }}
              data-placeholder="Write your message…"
            />

            {error && <p style={{ fontSize: 12, color: '#DC2626', paddingTop: 6 }}>{error}</p>}

            <div className="flex items-center justify-between gap-3 pt-3 flex-wrap" style={{ borderTop: '1px solid rgba(20,8,31,.10)' }}>
              <span style={{ fontSize: 11.5, color: MUTED }}>
                {fromAddress ? `Sends as ${fromAddress}` : 'Email sender not configured'}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  style={{ height: 40, padding: '0 18px', borderRadius: 999, background: 'transparent', border: '1px solid rgba(20,8,31,.16)', color: INK, fontWeight: 600, fontSize: 13.5 }}
                  className="cursor-pointer hover:bg-black/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  // Read the editor on click, not during render: typing in a
                  // contentEditable doesn't re-render, so a render-time value
                  // would still say "empty" after you'd written the message.
                  onClick={() => {
                    if (!(bodyRef.current?.innerText || '').trim()) { setError('Email body is required'); return }
                    setError('')
                    send.mutate()
                  }}
                  disabled={sendDisabled}
                  style={{
                    height: 40, padding: '0 20px', borderRadius: 999, border: 'none', fontWeight: 600, fontSize: 13.5,
                    background: sendDisabled ? '#C7C7D6' : PURPLE, color: 'white',
                    cursor: sendDisabled ? 'not-allowed' : 'pointer',
                  }}
                  className="transition-opacity hover:opacity-90"
                >
                  {send.isPending ? 'Sending…' : `Send to ${selectedCount} customer${selectedCount !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

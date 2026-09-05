import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, X, Send, RotateCcw } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'

const INK = '#14081F'
const MUTED = '#4A4357'
const FAINT = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_INK = '#4A1FA0'
const TINT = '#F7F3FF'
const BADGE = '#EDE5FF'
const LINE = 'rgba(20,8,31,.10)'
const HEAD = "'Bricolage Grotesque', serif"

type Pending = { id: string; kind: string; summary: string[]; expiresAt: string }

type Turn = {
  role: 'user' | 'assistant'
  content: string
  tools?: { name: string; ok: boolean }[]
  grounded?: boolean
  /* An action it wants to take. Nothing happens until Confirm is pressed;
     the card is the whole safeguard between "create a quote for Ahmed" and a
     unit being held for the wrong Ahmed. */
  pending?: Pending | null
  done?: boolean
  pdfPath?: string
  quoteId?: string
  contractId?: string
}

const STORE = 'pb_assistant'

/* What a tool is, in words a person recognises — never the tool's name. */
const TOOL_LABEL: Record<string, string> = {
  units_available: 'checked unit availability',
  price_booking: 'priced it with the quote maths',
  find_customer: 'looked up the customer',
  find_contract: 'looked up the contract',
  documents_for: 'checked documents on file',
  tasks_due: 'read the task board',
  whatsapp_activity: 'read WhatsApp activity',
  leads_recent: 'counted leads',
}
const labelFor = (name: string) =>
  TOOL_LABEL[name] || `read the ${name.replace(/^report_/, '').replace(/_/g, ' ')} report`

/**
 * The assistant in the corner of every page.
 *
 * It only ever answers from the database, through questions the server runs
 * for it — and under each answer it says which ones it ran, so a figure can
 * always be traced. When it cannot see something it says so, rather than
 * guessing, and that is shown differently from a real answer.
 */
export default function AssistantWidget() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [turns, setTurns] = useState<Turn[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(STORE) || '[]') } catch { return [] }
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [acting, setActing] = useState('')

  /* Fetched with the login token and opened from memory, the way the quotes
     page does it. A plain link to the API sends no token, so the browser is
     told "Authentication required" — which is what happened the first time
     somebody clicked one of these on the live site. */
  async function openPdf(path: string) {
    try {
      const res = await api.get(path, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))
      window.open(url, '_blank', 'noopener')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setErr(apiError(e))
    }
  }

  async function decide(turnIndex: number, pending: Pending, go: boolean) {
    setActing(pending.id)
    setErr('')
    try {
      const { data } = await api.post<{ ok: boolean; message: string; pdfPath?: string; quoteId?: string; contractId?: string }>(
        `/assistant/${go ? 'confirm' : 'cancel'}`, { id: pending.id },
      )
      setTurns((t) => t.map((x, i) => (i === turnIndex ? { ...x, pending: null, done: true } : x))
        .concat([{ role: 'assistant', content: data.message, tools: [], grounded: true, pdfPath: data.pdfPath, quoteId: data.quoteId, contractId: data.contractId }]))
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setActing('')
    }
  }
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: caps } = useQuery({
    queryKey: ['assistant-capabilities'],
    queryFn: () => api.get<{ enabled: boolean; allowed: boolean }>('/assistant/capabilities').then((r) => r.data),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-20))) } catch { /* private mode */ }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [turns, open])

  useEffect(() => { if (open) window.setTimeout(() => inputRef.current?.focus(), 50) }, [open])

  if (!user || !caps?.enabled || !caps?.allowed) return null

  async function ask(text: string) {
    const q = text.trim()
    if (!q || busy) return
    setDraft('')
    setErr('')
    const history = turns.slice(-8).map((t) => ({ role: t.role, content: t.content }))
    setTurns((t) => [...t, { role: 'user', content: q }])
    setBusy(true)
    try {
      const { data } = await api.post<{ answer: string; tools: { name: string; ok: boolean }[]; grounded: boolean; pending?: Pending | null }>(
        '/assistant/ask', { question: q, history },
      )
      setTurns((t) => [...t, { role: 'assistant', content: data.answer, tools: data.tools, grounded: data.grounded, pending: data.pending || null }])
    } catch (e) {
      setErr(apiError(e))
      setTurns((t) => t.slice(0, -1))
      setDraft(q)
    } finally {
      setBusy(false)
    }
  }

  const starters = [
    'How many 10 sq ft units are free?',
    'Which contracts end this month?',
    'Who messaged us on WhatsApp today?',
    'Quote Ahmed Ali, 050 123 4567, a 50 sq ft unit from the 15th for 3 months, and send it on WhatsApp',
  ]

  return (
    <>
      {open && (
        <div
          className="fixed z-50 flex flex-col"
          style={{
            right: 16, bottom: 76, width: 'min(400px, calc(100vw - 32px))', height: 'min(600px, calc(100vh - 100px))',
            background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14,
            boxShadow: '0 12px 40px rgba(20,8,31,.16)', overflow: 'hidden',
          }}
          role="dialog"
          aria-label="Assistant"
        >
          <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: `1px solid ${LINE}`, background: TINT }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: PURPLE, display: 'grid', placeItems: 'center', color: '#fff' }}>
              <Sparkles size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: INK }}>Ask the system</div>
              <div style={{ fontSize: 11, color: FAINT }}>Answers only from your data. Reads, never changes.</div>
            </div>
            {turns.length > 0 && (
              <button type="button" onClick={() => setTurns([])} className="cursor-pointer p-1" style={{ color: FAINT }} title="Start over" aria-label="Start over">
                <RotateCcw size={15} />
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="cursor-pointer p-1" style={{ color: FAINT }} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          <div ref={listRef} className="flex-1 min-h-0 overflow-auto px-4 py-3 flex flex-col gap-3">
            {turns.length === 0 && (
              <div>
                <p style={{ fontSize: 12.5, color: MUTED, margin: '4px 0 10px' }}>
                  Units, prices, contracts, customers, leads, WhatsApp, documents, tasks — ask in plain words.
                </p>
                <div className="flex flex-col gap-1.5">
                  {starters.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="text-left cursor-pointer"
                      style={{ fontSize: 12.5, color: PURPLE_INK, background: TINT, border: `1px solid ${LINE}`, borderRadius: 9, padding: '7px 10px' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'self-end' : 'self-start'} style={{ maxWidth: '92%' }}>
                <div
                  style={{
                    fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', padding: '9px 12px', borderRadius: 12,
                    background: t.role === 'user' ? PURPLE : t.grounded === false ? '#FFF7E6' : '#F5F2FA',
                    color: t.role === 'user' ? '#fff' : t.grounded === false ? '#6B4500' : INK,
                    border: t.grounded === false ? '1px solid #E9D9B4' : 'none',
                  }}
                >
                  {t.content}
                </div>
                {t.pdfPath && (
                  <div className="flex gap-2 mt-1.5">
                    <button
                      type="button"
                      onClick={() => openPdf(t.pdfPath!)}
                      className="cursor-pointer"
                      style={{ fontSize: 12, fontWeight: 600, color: '#fff', background: PURPLE, border: 0, borderRadius: 8, padding: '5px 10px' }}
                    >
                      Open the PDF
                    </button>
                    {t.contractId ? (
                      <a href={`/contracts/${t.contractId}`} style={{ fontSize: 12, fontWeight: 600, color: PURPLE_INK, background: BADGE, borderRadius: 8, padding: '5px 10px' }}>
                        Open the contract
                      </a>
                    ) : t.quoteId && (
                      {/* The app has no /quotes/:id page — a quotation opens in the
                          wizard, which is how every other screen links to one. */}
                      <a href={`/quotes/new?quote=${t.quoteId}`} style={{ fontSize: 12, fontWeight: 600, color: PURPLE_INK, background: BADGE, borderRadius: 8, padding: '5px 10px' }}>
                        Open the quotation
                      </a>
                    )}
                  </div>
                )}
                {t.pending && (
                  <div style={{ marginTop: 8, background: '#fff', border: `1px solid ${PURPLE}`, borderRadius: 12, padding: '12px 14px', boxShadow: '0 2px 10px rgba(91,43,201,.10)' }}>
                    <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 13.5, color: INK, marginBottom: 6 }}>
                      Do this?
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
                      {t.pending.summary.map((line, n) => <li key={n}>{line}</li>)}
                    </ul>
                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => decide(i, t.pending!, true)}
                        disabled={acting === t.pending.id}
                        className="cursor-pointer disabled:opacity-50"
                        style={{ background: PURPLE, color: '#fff', border: 0, borderRadius: 9, padding: '8px 14px', fontWeight: 600, fontSize: 12.5 }}
                      >
                        {acting === t.pending.id ? 'Doing it…' : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(i, t.pending!, false)}
                        disabled={acting === t.pending.id}
                        className="cursor-pointer disabled:opacity-50"
                        style={{ background: '#fff', color: MUTED, border: `1px solid rgba(20,8,31,.16)`, borderRadius: 9, padding: '8px 14px', fontWeight: 600, fontSize: 12.5 }}
                      >
                        Cancel
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: FAINT, marginTop: 8 }}>
                      Nothing is created or sent until you confirm.
                    </div>
                  </div>
                )}
                {/* Where it looked. A figure nobody can trace is a figure
                    nobody should act on, so the trail is always on show. */}
                {t.role === 'assistant' && t.tools && t.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {[...new Set(t.tools.map((x) => labelFor(x.name)))].map((label) => (
                      <span key={label} style={{ fontSize: 10.5, color: PURPLE_INK, background: BADGE, borderRadius: 999, padding: '2px 8px' }}>
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="self-start" style={{ fontSize: 12.5, color: FAINT, padding: '6px 2px' }}>
                Checking the database…
              </div>
            )}
            {err && <div style={{ fontSize: 12, color: '#8A1C1C' }}>{err}</div>}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); ask(draft) }}
            className="flex items-end gap-2 px-3 py-3"
            style={{ borderTop: `1px solid ${LINE}` }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft) } }}
              placeholder="Ask anything about the system…"
              className="flex-1 resize-none focus:outline-none"
              style={{ fontSize: 13.5, padding: '9px 11px', border: `1px solid rgba(20,8,31,.16)`, borderRadius: 10, background: '#fff', color: INK, maxHeight: 96 }}
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ width: 38, height: 38, borderRadius: 10, background: PURPLE, color: '#fff', display: 'grid', placeItems: 'center', border: 0 }}
              aria-label="Send"
            >
              <Send size={15} />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed z-50 cursor-pointer flex items-center gap-2"
        style={{
          right: 16, bottom: 16, height: 46, padding: open ? '0 13px' : '0 16px 0 13px', borderRadius: 999,
          background: PURPLE, color: '#fff', border: 0, boxShadow: '0 6px 20px rgba(91,43,201,.35)',
          fontWeight: 600, fontSize: 13,
        }}
        aria-label={open ? 'Close the assistant' : 'Open the assistant'}
      >
        <Sparkles size={17} />
        {!open && 'Ask'}
      </button>
    </>
  )
}

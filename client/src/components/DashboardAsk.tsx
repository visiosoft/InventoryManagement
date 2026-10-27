import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight, Mail, MessageCircle, X, FileText, FileSpreadsheet, Globe } from 'lucide-react'
import AskForm, { type AskFormSpec } from './AskForm'
import { TwilioConnectForm } from './ConnectForms'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import EmailCustomersModal from '../pages/customers/EmailCustomersModal'
import WhatsAppContractsModal, { type WhatsAppContractRow } from '../pages/customers/WhatsAppContractsModal'

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'
const PURPLE_INK = '#4A1FA0'
const TINT = '#F7F3FF'
const BADGE = '#EDE5FF'
const PURPLE_LINE = '#DDD0FF'
const LINE = 'rgba(20,8,31,.08)'
const HEAD = "'Bricolage Grotesque', sans-serif"

type Pending = { id: string; kind: string; summary: string[]; expiresAt: string }
type Compose =
  | { kind: 'email_customers'; label: string; customerIds: string[]; template?: string; personalise?: boolean }
  | { kind: 'whatsapp_contracts'; label: string; template?: string; contracts: WhatsAppContractRow[] }
type Answer = {
  content: string
  tools: { name: string; ok: boolean }[]
  grounded: boolean
  pending: Pending | null
  links: { label: string; path: string }[]
  /** Files the answer made: PDF or Excel downloads. */
  files?: { label: string; path: string; format: 'pdf' | 'excel' }[]
  /** Short answers to the question it just asked, as buttons ("25 sq ft", "WhatsApp"). */
  options?: string[]
  /** Details it needs, as boxes to fill in, with what it knows filled. */
  form?: AskFormSpec | null
  /** Web pages the answer drew on, when the web was on. */
  sources?: { label: string; url: string }[]
  /** A connection to make once before it can do this (SMS: 'twilio'). */
  setup?: string | null
  pdfPath?: string
  quoteId?: string
  contractId?: string
}

/** **bold** as bold — the assistant writes it, and the raw stars read as noise. */
function withBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : part))
}

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
  contracts_expiring: 'checked which contracts are expiring',
  compose_email: 'worked out who to email',
  compose_whatsapp: 'worked out who to WhatsApp',
  export_file: 'made the file',
  ask_details: 'asked for the details',
  web_search: 'searched the web',
  past_checkout: 'checked who is past check-out',
  conversion_review: 'reviewed why leads convert or not',
  rep_scorecard: 'scored each sales rep',
  meta_ads_review: 'reviewed the Meta ads',
  email_inbox: 'read the inbox',
  read_email: 'read an email',
  propose_sms: 'prepared a text',
  propose_whatsapp_message: 'prepared a WhatsApp',
  leads_list: 'listed the leads',
  sales_summary: 'read sales from Zoho',
  receivables: 'read receivables from Zoho',
  calls_summary: 'counted the calls',
  follow_ups_due: 'checked follow-ups due',
  door_activity: 'read the door log',
  roster_now: 'checked the roster',
}
const labelFor = (name: string) => TOOL_LABEL[name] || `read the ${name.replace(/^report_/, '').replace(/_/g, ' ')} report`

/** Whichever shape a compose directive is, does it actually have someone to
 *  send to? An empty audience should not pop a composer with nothing in it. */
function composeCount(c: Compose): number {
  return c.kind === 'email_customers' ? c.customerIds.length : c.contracts.length
}

const STARTERS = [
  'Book a unit',
  'Make a quotation',
  'Raise an invoice',
  "Today's leads as a PDF",
  'Which contracts expire in the next 15 days?',
  'Who is on shift now?',
]

/**
 * The search-box entry point to the assistant, at the top of the dashboard.
 *
 * A one-shot question and one answer, the way a search box works — not the
 * running conversation the corner widget keeps. Somebody who wants to follow
 * up still has that: this is for "what do I need to know right now", asked
 * without first finding the chat bubble in the corner.
 *
 * Answers the same way the corner widget does, through the same server tools
 * — never a separate, looser path to the database — so a figure asked for
 * here is exactly as traceable as one asked for there.
 */
export default function DashboardAsk() {
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [acting, setActing] = useState(false)
  const [compose, setCompose] = useState<Compose | null>(null)
  /* The conversation so far, so it can ask what a booking needs and
     remember the answers. Cleared with the X. */
  const [thread, setThread] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const qc = useQueryClient()
  /* A question picked on the Recent searches card is asked here, fresh. */
  const askRef = useRef<(text: string, fresh?: boolean) => void>(() => {})
  useEffect(() => {
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<string>).detail
      if (typeof q === 'string') askRef.current(q, true)
    }
    window.addEventListener('pb-ask', onAsk)
    return () => window.removeEventListener('pb-ask', onAsk)
  }, [])

  /* Searching the internet, when the person wants it. Remembered per browser. */
  const [web, setWeb] = useState(() => { try { return localStorage.getItem('pb_ask_web') === '1' } catch { return false } })
  const toggleWeb = () => setWeb((w) => { try { localStorage.setItem('pb_ask_web', w ? '0' : '1') } catch { /* private window */ } return !w })
  const { data: caps } = useQuery({
    queryKey: ['assistant-capabilities'],
    queryFn: () => api.get<{ enabled: boolean; allowed: boolean; web?: boolean }>('/assistant/capabilities').then((r) => r.data),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })

  async function ask(text: string, fresh = false) {
    const question = text.trim()
    if (!question || busy) return
    const before = fresh ? [] : thread
    setBusy(true)
    setErr('')
    if (fresh) setQ(question)
    try {
      const { data } = await api.post<{ answer: string; tools: { name: string; ok: boolean }[]; grounded: boolean; pending?: Pending | null; links?: { label: string; path: string }[]; compose?: Compose | null; files?: Answer['files']; options?: string[]; form?: AskFormSpec | null; sources?: Answer['sources']; setup?: string | null }>(
        '/assistant/ask', { question, history: before.slice(-10), web: Boolean(caps?.web && web) },
      )
      if (!before.length) qc.invalidateQueries({ queryKey: ['assistant-recent'] })
      setAnswer({ content: data.answer, tools: data.tools, grounded: data.grounded, pending: data.pending || null, links: data.links || [], files: data.files || [], options: data.options || [], form: data.form || null, sources: data.sources || [], setup: data.setup || null })
      setThread([...before, { role: 'user' as const, content: question }, { role: 'assistant' as const, content: data.answer }].slice(-12))
      setQ('')
      // Asking to message a group IS asking for the composer, so it opens
      // rather than waiting for a second click — same rule the corner
      // widget follows for the same reason.
      if (data.compose && composeCount(data.compose) > 0) setCompose(data.compose)
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { askRef.current = ask })

  async function decide(go: boolean) {
    if (!answer?.pending) return
    setActing(true)
    setErr('')
    try {
      const { data } = await api.post<{ ok: boolean; message: string; pdfPath?: string; quoteId?: string; contractId?: string }>(
        `/assistant/${go ? 'confirm' : 'cancel'}`, { id: answer.pending.id },
      )
      setAnswer({ content: data.message, tools: [], grounded: true, pending: null, links: [], pdfPath: data.pdfPath, quoteId: data.quoteId, contractId: data.contractId })
      setThread((t) => [...t, { role: 'assistant' as const, content: data.message }].slice(-12))
    } catch (e) {
      setErr(apiError(e))
    } finally {
      setActing(false)
    }
  }

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

  /* A PDF opens in a new tab; a workbook is saved. Fetched with the person's
     own login, so the file holds what they are allowed to see. */
  async function download(file: { label: string; path: string; format: 'pdf' | 'excel' }) {
    try {
      const res = await api.get(file.path, { responseType: 'blob' })
      const type = file.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      const url = URL.createObjectURL(new Blob([res.data], { type }))
      if (file.format === 'pdf') window.open(url, '_blank', 'noopener')
      else {
        const a = document.createElement('a')
        a.href = url
        a.download = `${file.label.replace(/\s*\(.*\)$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.xlsx`
        a.click()
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setErr(apiError(e))
    }
  }

  function reset() {
    setAnswer(null)
    setQ('')
    setErr('')
    setThread([])
  }

  if (!user || !caps?.enabled || !caps?.allowed) return null

  return (
    <div id="dashboard-ask" style={{ marginBottom: 4 }}>
      <form
        onSubmit={(e) => { e.preventDefault(); ask(q) }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px',
          background: '#fff', border: `1px solid ${answer ? PURPLE : 'rgba(20,8,31,.12)'}`,
          borderRadius: answer ? '16px 16px 0 0' : 999,
          boxShadow: '0 1px 2px rgba(20,8,31,.04), 0 8px 24px rgba(20,8,31,.04)',
        }}
      >
        <span style={{ width: 30, height: 30, borderRadius: 999, background: TINT, display: 'grid', placeItems: 'center', flex: '0 0 auto', color: PURPLE }}>
          <Sparkles size={15} />
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={answer ? 'Reply, or ask something new…' : 'Ask anything, or book a unit, quote or invoice…'}
          style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', fontSize: 14.5, color: INK, background: 'transparent' }}
        />
        {answer && (
          <button type="button" onClick={reset} className="cursor-pointer" style={{ color: MUTED, background: 'none', border: 0, display: 'grid', placeItems: 'center', padding: 4 }} aria-label="Clear">
            <X size={16} />
          </button>
        )}
        {caps?.web && (
          <button type="button" onClick={toggleWeb} aria-pressed={web} aria-label="Search the web" title={web ? 'Searching the web too' : 'Search the web too'}
            className="cursor-pointer inline-flex items-center gap-1"
            style={{ height: 30, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, flex: '0 0 auto',
              border: `1px solid ${web ? PURPLE : LINE}`, background: web ? PURPLE : '#fff', color: web ? '#fff' : MUTED }}>
            <Globe size={13} /> Web
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !q.trim()}
          className="cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ width: 34, height: 34, borderRadius: 999, background: PURPLE, color: '#fff', display: 'grid', placeItems: 'center', border: 0, flex: '0 0 auto' }}
          aria-label="Ask"
        >
          <ArrowRight size={15} />
        </button>
      </form>

      {!answer && !busy && (
        <div className="flex flex-wrap gap-1.5" style={{ marginTop: 10 }} aria-label="Suggestions">
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="cursor-pointer"
              style={{ fontSize: 12, color: PURPLE_INK, background: TINT, border: `1px solid ${LINE}`, borderRadius: 999, padding: '5px 12px' }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {busy && (
        <div style={{
          padding: '14px 16px', background: '#fff', border: `1px solid ${PURPLE}`, borderTop: 'none',
          borderRadius: '0 0 16px 16px', fontSize: 13, color: MUTED,
        }}>
          {web && caps?.web ? 'Checking the system and the web…' : 'Checking the database…'}
        </div>
      )}

      {!busy && answer && (
        <div style={{
          padding: '16px 18px', background: '#fff', border: `1px solid ${PURPLE}`, borderTop: 'none',
          borderRadius: '0 0 16px 16px', boxShadow: '0 8px 24px rgba(20,8,31,.04)',
        }}>
          {thread.length > 2 && (
            <div className="space-y-1.5" style={{ marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${LINE}` }}>
              {thread.slice(0, -1).slice(-6).map((t, n) => (
                <div key={n} style={{ fontSize: 12.5, lineHeight: 1.5, color: t.role === 'user' ? PURPLE_INK : MUTED, fontWeight: t.role === 'user' ? 600 : 400, whiteSpace: 'pre-wrap' }}>
                  {t.role === 'user' ? `You: ${t.content}` : withBold(t.content)}
                </div>
              ))}
            </div>
          )}
          <p style={{
            fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0,
            color: answer.grounded === false ? '#6B4500' : INK,
          }}>
            {withBold(answer.content)}
          </p>

          {answer.setup === 'twilio' && (
            <div style={{ marginTop: 12, border: `1px solid ${LINE}`, borderRadius: 12, padding: '12px 14px' }}><TwilioConnectForm /></div>
          )}

          {answer.form && !answer.pending && (
            <AskForm key={answer.content + answer.form.fields.map((f) => f.key).join()} form={answer.form} busy={busy} onSubmit={(text) => ask(text)} />
          )}

          {(answer.sources?.length ?? 0) > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>From the web</div>
              <div className="flex flex-wrap gap-1.5">
                {answer.sources!.map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1"
                    style={{ fontSize: 12, fontWeight: 600, color: PURPLE_INK, background: '#fff', border: `1px solid ${PURPLE_LINE}`, borderRadius: 8, padding: '5px 10px', maxWidth: 260 }}>
                    <Globe size={12} /> <span className="truncate">{s.label}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {(answer.options?.length ?? 0) > 0 && !answer.pending && !answer.form && (
            <div className="flex flex-wrap gap-1.5" style={{ marginTop: 12 }} aria-label="Answers">
              {answer.options!.map((o) => (
                <button key={o} type="button" onClick={() => ask(o)} className="cursor-pointer"
                  style={{ fontSize: 13, fontWeight: 600, color: '#fff', background: PURPLE, border: 0, borderRadius: 999, padding: '6px 14px' }}>
                  {o}
                </button>
              ))}
            </div>
          )}

          {answer.pending && (
            <div style={{ marginTop: 12, background: TINT, border: `1px solid ${PURPLE_LINE}`, borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 13.5, color: INK, marginBottom: 6 }}>Do this?</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
                {answer.pending.summary.map((line, n) => <li key={n}>{line}</li>)}
              </ul>
              <div className="flex gap-2 mt-3">
                <button
                  type="button" onClick={() => decide(true)} disabled={acting}
                  className="cursor-pointer disabled:opacity-50"
                  style={{ background: PURPLE, color: '#fff', border: 0, borderRadius: 9, padding: '8px 14px', fontWeight: 600, fontSize: 12.5 }}
                >
                  {acting ? 'Doing it…' : 'Confirm'}
                </button>
                <button
                  type="button" onClick={() => decide(false)} disabled={acting}
                  className="cursor-pointer disabled:opacity-50"
                  style={{ background: '#fff', color: MUTED, border: '1px solid rgba(20,8,31,.16)', borderRadius: 9, padding: '8px 14px', fontWeight: 600, fontSize: 12.5 }}
                >
                  Cancel
                </button>
              </div>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>Nothing is created or sent until you confirm.</div>
            </div>
          )}

          {compose && composeCount(compose) > 0 && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button" onClick={() => setCompose(compose)}
                className="cursor-pointer inline-flex items-center gap-1.5"
                style={{ fontSize: 12.5, fontWeight: 600, color: PURPLE_INK, background: BADGE, border: `1px solid ${PURPLE_LINE}`, borderRadius: 8, padding: '6px 12px' }}
              >
                {compose.kind === 'email_customers' ? <Mail size={13} /> : <MessageCircle size={13} />}
                {compose.kind === 'email_customers' ? 'Email' : 'WhatsApp'} {composeCount(compose)} {composeCount(compose) === 1 ? 'person' : 'people'}
              </button>
            </div>
          )}

          {(answer.files?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2" style={{ marginTop: 12 }}>
              {answer.files!.map((f) => (
                <button key={f.path} type="button" onClick={() => download(f)} className="inline-flex items-center gap-1.5 cursor-pointer"
                  style={{ fontSize: 12.5, fontWeight: 700, color: '#fff', background: f.format === 'pdf' ? PURPLE : '#107C41', border: 0, borderRadius: 8, padding: '7px 13px' }}>
                  {f.format === 'pdf' ? <FileText size={14} /> : <FileSpreadsheet size={14} />} Download {f.label}
                </button>
              ))}
            </div>
          )}

          {answer.links.length > 0 && (
            <div className="flex flex-wrap gap-1.5" style={{ marginTop: 12 }}>
              {answer.links.map((l) => (
                <Link
                  key={l.path} to={l.path}
                  style={{ fontSize: 12.5, fontWeight: 600, color: PURPLE_INK, background: BADGE, border: `1px solid ${PURPLE_LINE}`, borderRadius: 8, padding: '6px 12px' }}
                >
                  {l.label} →
                </Link>
              ))}
            </div>
          )}

          {answer.pdfPath && (
            <div className="flex gap-2" style={{ marginTop: 12 }}>
              <button
                type="button" onClick={() => openPdf(answer.pdfPath!)}
                className="cursor-pointer"
                style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', background: PURPLE, border: 0, borderRadius: 8, padding: '6px 12px' }}
              >
                Open the PDF
              </button>
              {answer.contractId ? (
                <a href={`/contracts/${answer.contractId}`} style={{ fontSize: 12.5, fontWeight: 600, color: PURPLE_INK, background: BADGE, borderRadius: 8, padding: '6px 12px' }}>
                  Open the contract
                </a>
              ) : answer.quoteId && (
                <a href={`/quotes/new?quote=${answer.quoteId}`} style={{ fontSize: 12.5, fontWeight: 600, color: PURPLE_INK, background: BADGE, borderRadius: 8, padding: '6px 12px' }}>
                  Open the quotation
                </a>
              )}
            </div>
          )}

          {/* Where it looked. A figure nobody can trace is a figure nobody
              should act on, so the trail is always on show. */}
          {answer.tools.length > 0 && (
            <div className="flex flex-wrap gap-1" style={{ marginTop: 12 }}>
              {[...new Set(answer.tools.map((t) => labelFor(t.name)))].map((label) => (
                <span key={label} style={{ fontSize: 10.5, color: PURPLE_INK, background: BADGE, borderRadius: 999, padding: '2px 8px' }}>
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {err && <p style={{ fontSize: 12.5, color: '#8A1C1C', marginTop: 8 }}>{err}</p>}

      {compose?.kind === 'email_customers' && (
        <EmailCustomersModal
          onClose={() => setCompose(null)}
          preselectIds={compose.customerIds}
          preselectTemplateKey={compose.template}
          defaultPersonalise={compose.personalise !== false}
        />
      )}
      {compose?.kind === 'whatsapp_contracts' && (
        <WhatsAppContractsModal
          onClose={() => setCompose(null)}
          contracts={compose.contracts}
          preselectTemplateKey={compose.template}
        />
      )}
    </div>
  )
}

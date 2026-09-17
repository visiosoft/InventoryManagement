import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Sparkles, ArrowRight, Mail, MessageCircle, X } from 'lucide-react'
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
  pdfPath?: string
  quoteId?: string
  contractId?: string
}

/* What a tool is, in words a person recognises — never the tool's name.
   Kept in step with the same table in AssistantWidget.tsx by hand: the two
   surfaces answer through the same server tools, so the same name should
   read the same way wherever it shows up. */
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
}
const labelFor = (name: string) => TOOL_LABEL[name] || `read the ${name.replace(/^report_/, '').replace(/_/g, ' ')} report`

/** Whichever shape a compose directive is, does it actually have someone to
 *  send to? An empty audience should not pop a composer with nothing in it. */
function composeCount(c: Compose): number {
  return c.kind === 'email_customers' ? c.customerIds.length : c.contracts.length
}

const STARTERS = [
  'Which contracts expire in the next 15 days?',
  "Who's still waiting for a WhatsApp reply?",
  'How many 10 sq ft units are free?',
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

  const { data: caps } = useQuery({
    queryKey: ['assistant-capabilities'],
    queryFn: () => api.get<{ enabled: boolean; allowed: boolean }>('/assistant/capabilities').then((r) => r.data),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })

  if (!user || !caps?.enabled || !caps?.allowed) return null

  async function ask(text: string) {
    const question = text.trim()
    if (!question || busy) return
    setBusy(true)
    setErr('')
    try {
      const { data } = await api.post<{ answer: string; tools: { name: string; ok: boolean }[]; grounded: boolean; pending?: Pending | null; links?: { label: string; path: string }[]; compose?: Compose | null }>(
        '/assistant/ask', { question, history: [] },
      )
      setAnswer({ content: data.answer, tools: data.tools, grounded: data.grounded, pending: data.pending || null, links: data.links || [] })
      setQ(question)
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

  async function decide(go: boolean) {
    if (!answer?.pending) return
    setActing(true)
    setErr('')
    try {
      const { data } = await api.post<{ ok: boolean; message: string; pdfPath?: string; quoteId?: string; contractId?: string }>(
        `/assistant/${go ? 'confirm' : 'cancel'}`, { id: answer.pending.id },
      )
      setAnswer({ content: data.message, tools: [], grounded: true, pending: null, links: [], pdfPath: data.pdfPath, quoteId: data.quoteId, contractId: data.contractId })
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

  function reset() {
    setAnswer(null)
    setQ('')
    setErr('')
  }

  return (
    <div style={{ marginBottom: 4 }}>
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
          placeholder="Ask about occupancy, expiring contracts, WhatsApp activity…"
          style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', fontSize: 14.5, color: INK, background: 'transparent' }}
        />
        {answer && (
          <button type="button" onClick={reset} className="cursor-pointer" style={{ color: MUTED, background: 'none', border: 0, display: 'grid', placeItems: 'center', padding: 4 }} aria-label="Clear">
            <X size={16} />
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
        <div className="flex flex-wrap gap-1.5" style={{ marginTop: 10 }}>
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
          Checking the database…
        </div>
      )}

      {!busy && answer && (
        <div style={{
          padding: '16px 18px', background: '#fff', border: `1px solid ${PURPLE}`, borderTop: 'none',
          borderRadius: '0 0 16px 16px', boxShadow: '0 8px 24px rgba(20,8,31,.04)',
        }}>
          <p style={{
            fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0,
            color: answer.grounded === false ? '#6B4500' : INK,
          }}>
            {answer.content}
          </p>

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

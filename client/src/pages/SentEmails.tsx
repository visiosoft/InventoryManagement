import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Mail, Search, AlertTriangle, Paperclip, Users, ChevronDown } from 'lucide-react'
import { api } from '../lib/api'
import { Card, CardBody, PageHeader, Pagination, Spinner } from '../components/ui'

const INK = '#14081F'
const MUTED = '#756E80'
const LINE = 'rgba(20,8,31,.10)'
const CHIP_BG = '#F3F0EA'

type SentEmail = {
  _id: string
  to: string
  bcc: string
  recipientCount: number
  subject: string
  status: 'sent' | 'failed'
  error: string
  hasAttachments: boolean
  kind: string
  label: string
  sentBy: string
  at: string
  customer?: { _id: string; fullName: string } | null
  contract?: { _id: string; contractNo: string } | null
}

type Paged = {
  data: SentEmail[]
  total: number
  failed: number
  page: number
  pages: number
  kinds: string[]
}

const KIND_LABEL: Record<string, string> = {
  reminder: 'Reminder',
  bulk: 'Bulk email',
  campaign: 'Campaign',
  contract: 'Contract',
  invoice: 'Invoice',
  quote: 'Quote',
  notice: 'Notice',
  lead: 'Lead',
  auth: 'Account',
  other: 'Other',
}

export default function SentEmails() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [kind, setKind] = useState('')
  const [page, setPage] = useState(1)
  // Which row is open. Bodies are left out of the list payload, so opening one
  // fetches it — fifty email bodies would be megabytes nobody asked to read.
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading } = useQuery<Paged>({
    queryKey: ['sent-emails', search, status, kind, page],
    queryFn: () => api.get('/sent-emails', {
      params: { search, page, limit: 50, ...(status ? { status } : {}), ...(kind ? { kind } : {}) },
    }).then((r) => r.data),
    placeholderData: (prev) => prev,
  })

  const rows = data?.data ?? []

  const { data: openEmail } = useQuery<SentEmail & { html?: string; text?: string }>({
    queryKey: ['sent-email', openId],
    queryFn: () => api.get(`/sent-emails/${openId}`).then((r) => r.data),
    enabled: Boolean(openId),
  })

  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Sent emails"
        subtitle="Every email the system has sent, whether it went out or failed"
      />

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div
          style={{ background: CHIP_BG, borderRadius: 10, height: 36 }}
          className="relative flex items-center max-w-sm flex-1 px-3"
        >
          <Search size={15} style={{ color: MUTED }} className="shrink-0" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search customer, address, subject, or who sent it…"
            style={{ background: 'transparent', color: INK, fontSize: 13, outline: 'none', border: 'none' }}
            className="ml-2 w-full placeholder:text-[#756E80]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {([['', 'All'], ['sent', 'Sent'], ['failed', 'Failed']] as [string, string][]).map(([v, label]) => (
            <button
              key={v || 'all'}
              type="button"
              onClick={() => { setStatus(v); setPage(1) }}
              className="rounded-full cursor-pointer transition-colors"
              style={{
                padding: '5px 12px', fontSize: 12.5, fontWeight: 700,
                background: status === v ? (v === 'failed' ? '#B91C1C' : '#5B2BC9') : CHIP_BG,
                color: status === v ? '#fff' : MUTED,
              }}
            >
              {label}
              {v === 'failed' && (data?.failed ?? 0) > 0 && ` (${data!.failed})`}
            </button>
          ))}

          {(data?.kinds ?? []).length > 1 && (
            <select
              value={kind}
              onChange={(e) => { setKind(e.target.value); setPage(1) }}
              style={{ background: CHIP_BG, borderRadius: 10, height: 32, border: 'none', outline: 'none', fontSize: 12.5, color: INK, padding: '0 8px' }}
              className="cursor-pointer"
            >
              <option value="">All types</option>
              {data!.kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] || k}</option>)}
            </select>
          )}
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Card>
          <CardBody className="py-14 text-center">
            <Mail size={30} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm text-muted-foreground">
              {search || status || kind
                ? 'Nothing matches that.'
                : 'No emails have been sent yet.'}
            </p>
            {!search && !status && !kind && (
              <p className="text-xs mt-1.5" style={{ color: MUTED }}>
                Email is not connected yet — see{' '}
                <Link to="/settings" className="underline font-semibold">Settings → Integrations</Link>.
              </p>
            )}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <div className="divide-y" style={{ borderColor: LINE }}>
            {rows.map((r) => (
              <div key={r._id}>
              <button
                type="button"
                onClick={() => setOpenId(openId === r._id ? null : r._id)}
                className="w-full text-left px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <ChevronDown
                    size={13}
                    className="shrink-0 transition-transform"
                    style={{ color: MUTED, transform: openId === r._id ? 'rotate(180deg)' : undefined }}
                  />
                  <span className="font-semibold text-[13.5px] flex-1 min-w-0 truncate" style={{ color: INK }}>
                    {r.subject || '(no subject)'}
                  </span>
                  {r.status === 'failed' ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 shrink-0"
                      style={{ background: '#FEE2E2', color: '#B91C1C', fontSize: 11, fontWeight: 700 }}
                      title={r.error}
                    >
                      <AlertTriangle size={10} /> Failed
                    </span>
                  ) : (
                    <span
                      className="rounded-full px-2 py-0.5 shrink-0"
                      style={{ background: '#DCFCE7', color: '#047857', fontSize: 11, fontWeight: 700 }}
                    >
                      Sent
                    </span>
                  )}
                  <span className="shrink-0" style={{ fontSize: 11.5, color: MUTED }}>
                    {new Date(r.at).toLocaleString(undefined, {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1" style={{ fontSize: 12, color: MUTED }}>
                  {/* A blind-copied send has the sender in `to`, so the count is
                      what actually means anything on the row. */}
                  <span className="inline-flex items-center gap-1">
                    {r.recipientCount > 1 ? <><Users size={11} /> {r.recipientCount} recipients</> : r.to}
                  </span>
                  {r.label && <span>{r.label}</span>}
                  {r.kind && r.kind !== 'other' && (
                    <span
                      className="rounded-full px-1.5"
                      style={{ background: '#F3EDFF', color: '#4A1FA0', fontSize: 10.5, fontWeight: 700 }}
                    >
                      {KIND_LABEL[r.kind] || r.kind}
                    </span>
                  )}
                  {r.hasAttachments && <span className="inline-flex items-center gap-1"><Paperclip size={11} /> attached</span>}
                  {r.customer && (
                    <Link to={`/customers?q=${encodeURIComponent(r.customer.fullName)}`} className="hover:underline" style={{ color: '#4A1FA0' }}>
                      {r.customer.fullName}
                    </Link>
                  )}
                  {r.contract && (
                    <Link to={`/contracts/${r.contract._id}`} className="hover:underline" style={{ color: '#4A1FA0' }}>
                      {r.contract.contractNo}
                    </Link>
                  )}
                  {r.sentBy && <span>by {r.sentBy}</span>}
                </div>

                {r.status === 'failed' && r.error && (
                  <p className="mt-1.5" style={{ fontSize: 11.5, color: '#B91C1C' }}>{r.error}</p>
                )}
              </button>

              {openId === r._id && (
                <div className="px-4 pb-4" style={{ background: '#FBF8F2', borderTop: `1px solid ${LINE}` }}>
                  {!openEmail ? (
                    <p className="py-4 text-center" style={{ fontSize: 12, color: MUTED }}>Loading…</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 py-3" style={{ fontSize: 12, color: MUTED }}>
                        <span><strong style={{ color: INK }}>To:</strong> {openEmail.to || '—'}</span>
                        {openEmail.bcc && (
                          <span className="min-w-0 truncate" title={openEmail.bcc}>
                            <strong style={{ color: INK }}>Bcc:</strong> {openEmail.bcc}
                          </span>
                        )}
                        <span><strong style={{ color: INK }}>Sent:</strong> {new Date(openEmail.at).toLocaleString()}</span>
                      </div>
                      {openEmail.html ? (
                        // The message exactly as it was sent. Isolated in an
                        // iframe so its own styles cannot leak into the page.
                        <iframe
                          title="Email body"
                          srcDoc={openEmail.html}
                          sandbox=""
                          style={{ width: '100%', height: 460, border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff' }}
                        />
                      ) : openEmail.text ? (
                        <pre
                          className="whitespace-pre-wrap"
                          style={{ fontSize: 12.5, color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 14, margin: 0 }}
                        >{openEmail.text}</pre>
                      ) : (
                        <p className="py-3" style={{ fontSize: 12, color: MUTED }}>
                          The body was not recorded for this one. Emails sent from now on keep a copy.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {(data?.pages ?? 1) > 1 && (
        <Pagination page={data!.page} pages={data!.pages} total={data!.total} limit={50} onPage={setPage} />
      )}
    </div>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Circle, ExternalLink, FileText, Inbox,
  MessageCircle, Phone, RefreshCw, Send, StickyNote, UserCheck, XCircle,
} from 'lucide-react'
import { api, apiError } from '../lib/api'
import { cn, formatDate, formatDateTime, formatMoney } from '../lib/utils'
import {
  CR_COUNTS_KEY, CR_KEY, CR_OPEN_STATUSES, STATUS_LABEL, STATUS_TONE, TEAM_LABEL, TYPE_LABEL, TYPE_TONE,
  crApi, crDetailKey, dueLabel, isClosed,
  type BookingReviewContext, type CrAction, type CrDetail, type CrOpenStatus, type DepositRefundContext,
  type ExtendContext, type IdCheckContext, type IdCheckDoc, type MoveoutContext, type NewSignupContext, type ServiceContext,
} from '../lib/clientRequests'
import { Badge, Button, Card, CardBody, EmptyState, Field, Input, Modal, Select, SlideOver, Skeleton, Textarea } from './ui'

/* ---------- action dialogs ---------- */

type Dialog =
  | { kind: 'confirm'; action: CrAction; title: string; text: string; cta: string }
  | { kind: 'reason'; action: CrAction; title: string; text: string; cta: string }
  | { kind: 'refund'; deposit: number }
  | { kind: 'resolve' }
  | { kind: 'job' }

const REFUND_METHODS = [
  ['bank_transfer', 'Bank transfer'], ['card', 'Card'], ['cash', 'Cash'], ['cheque', 'Cheque'],
] as const

const aed = (n: number | null | undefined) => (n == null ? '—' : `AED ${formatMoney(n)}`)
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`

export default function ClientRequestDrawer({ id, onClose, prevId, nextId, position, onNavigate }: {
  id: string | null
  onClose: () => void
  prevId: string | null
  nextId: string | null
  position?: string
  onNavigate: (id: string) => void
}) {
  const qc = useQueryClient()
  const { data: d, isLoading, error } = useQuery({
    queryKey: crDetailKey(id ?? ''),
    queryFn: () => crApi.detail(id!),
    enabled: !!id,
    refetchInterval: 60_000,
  })

  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<{ key: string; msg: string } | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  // A different case starts with a clean slate (reset during render, not in an effect).
  const [seenId, setSeenId] = useState(id)
  if (seenId !== id) { setSeenId(id); setErr(null); setDialog(null); setBusy(null) }

  function apply(next: CrDetail) {
    qc.setQueryData(crDetailKey(next.id), next)
    qc.invalidateQueries({ queryKey: [CR_KEY, 'list'] })
    qc.invalidateQueries({ queryKey: CR_COUNTS_KEY })
  }

  /** Runs one POST; the returned detail replaces what's on screen. */
  async function run(key: string, fn: () => Promise<CrDetail>): Promise<boolean> {
    setBusy(key); setErr(null)
    try { apply(await fn()); return true } catch (e) { setErr({ key, msg: apiError(e) }); return false } finally { setBusy(null) }
  }
  const errFor = (key: string) => (err?.key === key ? <p className="text-xs text-destructive mt-1">{err.msg}</p> : null)
  const can = (a: CrAction) => !!d?.actions?.includes(a)

  const title = d ? (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono">{d.ref}</span>
      <Badge tone={TYPE_TONE[d.type] ?? 'gray'}>{TYPE_LABEL[d.type] ?? d.type}</Badge>
      <Badge tone={STATUS_TONE[d.status] ?? 'gray'}>{STATUS_LABEL[d.status] ?? d.status}</Badge>
      {d.priority === 'high' && <Badge tone="red">High</Badge>}
    </span>
  ) : 'Client request'

  const subtitle = d ? (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <span>{TEAM_LABEL[d.team] ?? d.team} team</span>
      <span>Opened {formatDateTime(d.createdAt)}</span>
      {!isClosed(d.status) && d.dueAt && (
        <span className={cn(d.overdue && 'text-destructive font-semibold')}>Due {dueLabel(d.dueAt, d.overdue)}</span>
      )}
      {d.escalatedAt && !isClosed(d.status) && <span className="text-destructive font-semibold">Escalated</span>}
    </span>
  ) : undefined

  return (
    <>
      <SlideOver open={!!id} onClose={onClose} title={title} subtitle={subtitle} width="max-w-[640px]">
        {(prevId || nextId || position) && (
          <div className="flex items-center justify-between -mt-2 mb-4">
            <Button size="sm" variant="ghost" disabled={!prevId} onClick={() => prevId && onNavigate(prevId)}>
              <ChevronLeft size={14} /> Previous
            </Button>
            {position && <span className="text-xs text-muted-foreground">{position}</span>}
            <Button size="sm" variant="ghost" disabled={!nextId} onClick={() => nextId && onNavigate(nextId)}>
              Next <ChevronRight size={14} />
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : error ? (
          <EmptyState message={apiError(error)} />
        ) : d ? (
          <div className="space-y-4">
            {d.resolution && (
              <div className={cn('rounded-lg border px-4 py-3 text-sm',
                d.status === 'resolved' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10')}>
                <div className="font-semibold">
                  {STATUS_LABEL[d.status] ?? d.status}{d.resolution.outcome ? ` — ${d.resolution.outcome.replace(/_/g, ' ')}` : ''}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{d.resolution.byName} · {formatDateTime(d.resolution.at)}</div>
                {d.resolution.reason && <p className="mt-1">{d.resolution.reason}</p>}
              </div>
            )}

            <div>
              <div className="font-semibold">{d.title}</div>
              {d.summary && <p className="text-sm text-muted-foreground mt-0.5">{d.summary}</p>}
            </div>

            <OwnerRow d={d} can={can} busy={busy} errFor={errFor} run={run} />

            <CustomerCard d={d} />

            <ContextPanel d={d} can={can} busy={busy} setDialog={setDialog} />

            {can('resolve') && (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'resolve' })}>
                  <CheckCircle2 size={14} /> Resolve
                </Button>
              </div>
            )}

            {can('message') && (
              <ComposeBox
                label="Message the customer"
                hint="Appears in their PurpleBox app and is sent as a push notification."
                cta="Send" icon={<Send size={14} />}
                busy={busy === 'message'} err={errFor('message')}
                onSend={text => run('message', () => crApi.message(d.id, text))}
              />
            )}
            {can('note') && (
              <ComposeBox
                label="Internal note"
                hint="Only staff see this."
                cta="Add note" icon={<StickyNote size={14} />}
                busy={busy === 'note'} err={errFor('note')}
                onSend={text => run('note', () => crApi.note(d.id, text))}
              />
            )}

            <Timeline items={d.activity} />
          </div>
        ) : null}
      </SlideOver>

      {d && dialog && (
        <ActionDialog
          d={d} dialog={dialog} onClose={() => setDialog(null)}
          busy={busy} errFor={errFor} run={run}
          onJobSaved={() => { setDialog(null); qc.invalidateQueries({ queryKey: crDetailKey(d.id) }); qc.invalidateQueries({ queryKey: [CR_KEY, 'list'] }) }}
        />
      )}
    </>
  )
}

/* ---------- owner: claim / assign / status ---------- */

type Runner = (key: string, fn: () => Promise<CrDetail>) => Promise<boolean>

function OwnerRow({ d, can, busy, errFor, run }: {
  d: CrDetail; can: (a: CrAction) => boolean; busy: string | null; errFor: (k: string) => ReactNode; run: Runner
}) {
  const { data: assignees } = useQuery({
    queryKey: [CR_KEY, 'assignees', d.team],
    queryFn: () => crApi.assignees(d.team),
    enabled: can('assign'),
    staleTime: 5 * 60_000,
  })
  const closed = isClosed(d.status)
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[10rem] flex-1">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Owner</div>
            {can('assign') ? (
              <Select value={d.assignee?.id ?? ''} disabled={busy === 'assign'}
                onChange={e => run('assign', () => crApi.assign(d.id, e.target.value || null))}>
                <option value="">Unassigned</option>
                {d.assignee && !assignees?.some(a => a.id === d.assignee!.id) && <option value={d.assignee.id}>{d.assignee.name}</option>}
                {assignees?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            ) : (
              <div className="text-sm font-medium h-9 flex items-center">
                {d.assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>}
              </div>
            )}
          </div>
          {can('status') && !closed && (
            <div className="min-w-[10rem] flex-1">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Status</div>
              <Select value={(CR_OPEN_STATUSES as readonly string[]).includes(d.status) ? d.status : ''} disabled={busy === 'status'}
                onChange={e => run('status', () => crApi.status(d.id, e.target.value as CrOpenStatus))}>
                {CR_OPEN_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </Select>
            </div>
          )}
          {can('claim') && (
            <Button variant="success" disabled={busy === 'claim'} onClick={() => run('claim', () => crApi.claim(d.id))}>
              <UserCheck size={14} /> {busy === 'claim' ? 'Claiming…' : 'Claim'}
            </Button>
          )}
        </div>
        {errFor('assign')}{errFor('status')}{errFor('claim')}
      </CardBody>
    </Card>
  )
}

/* ---------- customer ---------- */

function CustomerCard({ d }: { d: CrDetail }) {
  const c = d.customer
  const signup = d.type === 'new_signup' ? (d.context as unknown as NewSignupContext).customer : null
  const email = signup?.email
  if (!c) return null
  return (
    <Card>
      <CardBody className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Customer</div>
          <Link to={`/customers/${c.id}`} className="font-semibold hover:underline">{c.name}</Link>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {c.phone && (
              <>
                <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Phone size={13} />{c.phone}</a>
                <a href={waLink(c.phone)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline">
                  <MessageCircle size={13} />WhatsApp
                </a>
              </>
            )}
            {email && <a href={`mailto:${email}`} className="text-muted-foreground hover:text-foreground">{email}</a>}
          </div>
          {d.contract && (
            <div className="mt-1 text-xs text-muted-foreground">
              Contract <Link to={`/contracts/${d.contract.id}`} className="font-mono hover:underline">{d.contract.contractNo}</Link>
              {d.contract.units.length > 0 && ` · ${d.contract.units.join(', ')}`}
            </div>
          )}
        </div>
        <Link to={`/customers/${c.id}`} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
          Profile <ExternalLink size={12} />
        </Link>
      </CardBody>
    </Card>
  )
}

/* ---------- per-type context ---------- */

function ContextPanel({ d, can, busy, setDialog }: {
  d: CrDetail; can: (a: CrAction) => boolean; busy: string | null; setDialog: (x: Dialog) => void
}) {
  const ctx = d.context ?? {}
  let body: ReactNode = null
  let buttons: ReactNode = null

  if (d.type === 'service' && (ctx as Partial<ServiceContext>).serviceRequest) {
    const sr = (ctx as unknown as ServiceContext).serviceRequest
    const when = [formatDate(sr.date), sr.slotLabel || [sr.startTime, sr.endTime].filter(Boolean).join('–')].filter(Boolean).join(' · ')
    body = (
      <div className="space-y-3 text-sm">
        <Facts rows={[
          ['Job', <span key="j"><span className="font-mono">{sr.ref}</span> · {sr.type.replace(/_/g, ' ')} · <Badge tone="gray">{sr.status.replace(/_/g, ' ')}</Badge></span>],
          ['When', when || '—'],
          ['Address', <span key="a">{sr.address?.label}{sr.address?.line && <span className="text-muted-foreground"> — {sr.address.line}</span>}</span>],
          ['Driver', sr.driverName ? `${sr.driverName}${sr.driverPhone ? ` · ${sr.driverPhone}` : ''}` : '—'],
        ]} />
        {sr.items?.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-muted-foreground mb-1">Pick list</div>
            <ul className="space-y-0.5 text-xs">
              {sr.items.map(i => (
                <li key={i.id} className="flex flex-wrap gap-x-2">
                  <span className="font-mono">{i.label}</span>
                  <span className="text-muted-foreground">{i.name}</span>
                  <span className="text-muted-foreground">· {i.location || 'not on a shelf'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span>Estimate {aed(sr.estimate?.total)}</span>
          {sr.charged != null && <span className="text-muted-foreground">· charged {aed(sr.charged)}</span>}
          {sr.payment && (
            <Badge tone={sr.payment.state === 'paid' ? 'green' : sr.payment.state === 'pending' ? 'amber' : sr.payment.state === 'refunded' ? 'purple' : 'gray'}>
              {sr.payment.state === 'paid' ? `Paid ${aed(sr.payment.totalCharged)}` : sr.payment.state === 'pending' ? 'Awaiting payment' : sr.payment.state}
            </Badge>
          )}
        </div>
        {sr.estimate?.lines?.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {sr.estimate.lines.map((l, i) => <li key={i} className="flex justify-between gap-3"><span>{l.label}</span><span>{aed(l.amount)}</span></li>)}
          </ul>
        )}
        {sr.notes && <p className="text-xs"><span className="text-muted-foreground">Customer note:</span> {sr.notes}</p>}
        {sr.staffNote && <p className="text-xs"><span className="text-muted-foreground">Staff note:</span> {sr.staffNote}</p>}
      </div>
    )
    buttons = <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'job' })}>Update job</Button>
  }

  if ((d.type === 'extend' || d.type === 'moveout') && (ctx as Partial<ExtendContext>).contract) {
    const c = ctx as unknown as ExtendContext | MoveoutContext
    const newEnd = c.preview?.newEndDate || c.customerRequest?.payload?.requestedEndDate
    const amount = c.preview?.amount
    body = (
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-base">
          <span>{formatDate(c.contract.endDate)}</span><ArrowRight size={16} className="text-muted-foreground" />
          <span className="font-semibold">{formatDate(newEnd)}</span>
        </div>
        <Facts rows={[
          ['Contract', <Link key="c" to={`/contracts/${c.contract.id}`} className="font-mono hover:underline">{c.contract.contractNo}</Link>],
          ['Units', c.contract.units?.join(', ') || '—'],
          ...(d.type === 'extend' ? [
            ['Months', c.customerRequest?.payload?.months ?? '—'] as [string, ReactNode],
            ['Rate', aed(c.contract.rate)] as [string, ReactNode],
            ['Amount', amount != null ? aed(amount) : 'Worked out on approval'] as [string, ReactNode],
          ] : []),
          ['Asked', formatDateTime(c.customerRequest?.createdAt)],
        ]} />
        {c.customerRequest?.staffNote && <p className="text-xs text-muted-foreground">{c.customerRequest.staffNote}</p>}
      </div>
    )
    buttons = (
      <>
        {can('approve') && (
          <Button size="sm" variant="success" disabled={busy === 'dialog'} onClick={() => setDialog({
            kind: 'confirm', action: 'approve', cta: 'Approve',
            title: d.type === 'extend' ? 'Approve extension' : 'Approve move-out',
            text: d.type === 'extend'
              ? `Contract end moves to ${formatDate(newEnd)} and an invoice for ${amount != null ? aed(amount) : 'the extra months'} is raised. The customer is told in the app.`
              : `The contract is set to end on ${formatDate(newEnd)}. The customer is told in the app.`,
          })}>Approve</Button>
        )}
        {can('decline') && (
          <Button size="sm" variant="outline" disabled={busy === 'dialog'} onClick={() => setDialog({
            kind: 'reason', action: 'decline', cta: 'Decline',
            title: d.type === 'extend' ? 'Decline extension' : 'Decline move-out',
            text: 'The reason is sent to the customer.',
          })}>Decline</Button>
        )}
      </>
    )
  }

  if (d.type === 'deposit_refund' && (ctx as Partial<DepositRefundContext>).contract) {
    const c = ctx as unknown as DepositRefundContext
    body = (
      <Facts rows={[
        ['Deposit', <span key="d" className="font-semibold">{aed(c.contract.deposit)}</span>],
        ['Contract', <Link key="c" to={`/contracts/${c.contract.id}`} className="font-mono hover:underline">{c.contract.contractNo}</Link>],
        ['Contract status', c.contract.status?.replace(/_/g, ' ') || '—'],
        ['Contract end', formatDate(c.contract.endDate)],
        ['Asked', formatDateTime(c.customerRequest?.createdAt)],
      ]} />
    )
    buttons = (
      <>
        {can('mark_refunded') && (
          <Button size="sm" variant="success" disabled={busy === 'dialog'} onClick={() => setDialog({ kind: 'refund', deposit: c.contract.deposit })}>Mark refunded</Button>
        )}
        {can('decline') && (
          <Button size="sm" variant="outline" disabled={busy === 'dialog'} onClick={() => setDialog({
            kind: 'reason', action: 'decline', cta: 'Decline', title: 'Decline deposit refund', text: 'The reason is sent to the customer.',
          })}>Decline</Button>
        )}
      </>
    )
  }

  if (d.type === 'id_check') {
    const docs = (ctx as Partial<IdCheckContext>).documents ?? []
    body = docs.length ? (
      <div className="flex flex-wrap gap-3">{docs.map(doc => <DocThumb key={doc.id} doc={doc} />)}</div>
    ) : <p className="text-sm text-muted-foreground">No documents uploaded.</p>
    buttons = (
      <>
        {can('verify') && (
          <Button size="sm" variant="success" disabled={busy === 'dialog'} onClick={() => setDialog({
            kind: 'confirm', action: 'verify', cta: 'Verify', title: 'Verify ID', text: 'The documents are marked as checked and the customer can carry on.',
          })}>Verify</Button>
        )}
        {can('reject') && (
          <Button size="sm" variant="outline" disabled={busy === 'dialog'} onClick={() => setDialog({
            kind: 'reason', action: 'reject', cta: 'Reject', title: 'Reject ID', text: 'The customer is asked to upload again and sees this reason.',
          })}>Reject</Button>
        )}
      </>
    )
  }

  if (d.type === 'booking_review' && (ctx as Partial<BookingReviewContext>).quote) {
    const qt = (ctx as unknown as BookingReviewContext).quote
    body = (
      <Facts rows={[
        ['Quote', <Link key="q" to={`/quotes/new?quote=${qt.id}`} className="font-mono hover:underline inline-flex items-center gap-1">{qt.quoteNo}<ExternalLink size={12} /></Link>],
        ['Why it needs a look', qt.reviewReason || '—'],
        ['Paid', qt.stripePaidAt ? formatDateTime(qt.stripePaidAt) : 'Not paid'],
        ['Units', Array.isArray(qt.units) ? qt.units.map(u => (typeof u === 'string' ? u : (u as { unitNumber?: string })?.unitNumber ?? '')).filter(Boolean).join(', ') || '—' : String(qt.units ?? '—')],
        ['Total', aed(qt.total)],
      ]} />
    )
  }

  if (d.type === 'new_signup' && (ctx as Partial<NewSignupContext>).customer) {
    const c = ctx as unknown as NewSignupContext
    const owner = c.existingLead?.owner
    body = (
      <div className="space-y-3 text-sm">
        <Facts rows={[
          ['Signed up', formatDateTime(c.customer.createdAt)],
          ['Stage', c.customer.stage?.replace(/_/g, ' ') || '—'],
          ['Email', c.customer.email || '—'],
          ['Existing lead', c.existingLead ? (
            <Link key="l" to={`/leads/${c.existingLead.id}`} className="hover:underline">
              {c.existingLead.status?.replace(/_/g, ' ')}{owner ? ` · ${typeof owner === 'string' ? owner : owner.name}` : ''}
            </Link>
          ) : 'None'],
        ]} />
      </div>
    )
    buttons = (
      <>
        {can('create_lead') && (
          <Button size="sm" variant="success" disabled={busy === 'dialog'} onClick={() => setDialog({
            kind: 'confirm', action: 'create_lead', cta: 'Create lead', title: 'Create lead',
            text: c.existingLead ? 'A lead already exists for this person — a new one is only made if the server allows it.' : 'A sales lead is created for this person and assigned the usual way.',
          })}>Create lead</Button>
        )}
        {can('not_interested') && (
          <Button size="sm" variant="outline" disabled={busy === 'dialog'} onClick={() => setDialog({
            kind: 'reason', action: 'not_interested', cta: 'Save', title: 'Not interested', text: 'Why this sign-up is not being followed up. Staff only.',
          })}>Not interested</Button>
        )}
      </>
    )
  }

  if (!body && !buttons) return null
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{TYPE_LABEL[d.type] ?? 'Details'}</div>
        {body}
        {buttons && <div className="flex flex-wrap gap-2 pt-1">{buttons}</div>}
      </CardBody>
    </Card>
  )
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A document thumbnail. API-hosted files need the bearer token, so they are
 *  fetched as a blob; anything else is shown straight from its URL. */
function DocThumb({ doc }: { doc: IdCheckDoc }) {
  const viaApi = /^\/api\//.test(doc.url) || (!/^https?:/.test(doc.url) && !doc.url.startsWith('data:'))
  const [src, setSrc] = useState<string | null>(viaApi ? null : doc.url)
  const [isImage, setIsImage] = useState(true)
  useEffect(() => {
    if (!viaApi) return
    let url: string | null = null
    let alive = true
    api.get(doc.url.replace(/^\/api/, ''), { responseType: 'blob' })
      .then(r => {
        const blob = r.data as Blob
        url = URL.createObjectURL(blob)
        if (!alive) return
        setIsImage(blob.type.startsWith('image/'))
        setSrc(url)
      })
      .catch(() => alive && setIsImage(false))
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [doc.url, viaApi])

  const v = doc.verification
  const tone = v?.state === 'verified' ? 'green' : v?.state === 'rejected' ? 'red' : 'amber'
  return (
    <div className="w-36">
      <a href={src ?? undefined} target="_blank" rel="noreferrer"
        className="block h-24 w-36 overflow-hidden rounded-lg border bg-muted grid place-items-center">
        {src && isImage
          ? <img src={src} alt={doc.type} className="h-full w-full object-cover" onError={() => setIsImage(false)} />
          : src ? <FileText size={22} className="text-muted-foreground" />
          : <span className="text-[10px] text-muted-foreground">{isImage ? 'Loading…' : 'Unavailable'}</span>}
      </a>
      <div className="mt-1 text-xs font-medium truncate">{doc.type.replace(/_/g, ' ')}{doc.side ? ` · ${doc.side}` : ''}</div>
      <div className="text-[11px] text-muted-foreground">{formatDate(doc.uploadedAt)}</div>
      <Badge tone={tone} className="mt-0.5">{v?.state ? v.state.replace(/_/g, ' ') : 'Not checked'}</Badge>
      {v?.reason && <div className="text-[11px] text-muted-foreground mt-0.5">{v.reason}</div>}
    </div>
  )
}

/* ---------- compose ---------- */

function ComposeBox({ label, hint, cta, icon, busy, err, onSend }: {
  label: string; hint: string; cta: string; icon: ReactNode; busy: boolean; err: ReactNode; onSend: (text: string) => Promise<boolean>
}) {
  const [text, setText] = useState('')
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</div>
      <Textarea rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={hint} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{hint}</span>
        <Button size="sm" disabled={busy || !text.trim()} onClick={async () => { if (await onSend(text.trim())) setText('') }}>
          {icon} {busy ? 'Sending…' : cta}
        </Button>
      </div>
      {err}
    </div>
  )
}

/* ---------- activity ---------- */

function kindIcon(kind: string) {
  const k = kind.toLowerCase()
  if (k.includes('creat') || k.includes('open')) return Inbox
  if (k.includes('claim') || k.includes('assign')) return UserCheck
  if (k.includes('status')) return RefreshCw
  if (k.includes('note')) return StickyNote
  if (k.includes('message')) return MessageCircle
  if (k.includes('escalat') || k.includes('overdue')) return AlertTriangle
  if (k.includes('declin') || k.includes('reject') || k.includes('cancel') || k.includes('not_interested')) return XCircle
  if (k.includes('resolv') || k.includes('approv') || k.includes('verif') || k.includes('refund') || k.includes('lead')) return CheckCircle2
  return Circle
}

function Timeline({ items }: { items: CrDetail['activity'] }) {
  const sorted = [...(items ?? [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  if (!sorted.length) return null
  return (
    <div>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Activity</div>
      <ol className="space-y-3">
        {sorted.map((a, i) => {
          const Icon = kindIcon(a.kind || '')
          return (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-muted grid place-items-center text-muted-foreground"><Icon size={13} /></span>
              <div className="min-w-0 text-sm">
                <div className="whitespace-pre-wrap break-words">{a.text}</div>
                <div className="text-[11px] text-muted-foreground">{a.byName || 'System'} · {formatDateTime(a.at)}</div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/* ---------- dialogs ---------- */

function ActionDialog({ d, dialog, onClose, busy, errFor, run, onJobSaved }: {
  d: CrDetail; dialog: Dialog; onClose: () => void; busy: string | null; errFor: (k: string) => ReactNode; run: Runner; onJobSaved: () => void
}) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [amount, setAmount] = useState(dialog.kind === 'refund' ? String(dialog.deposit ?? '') : '')
  const [method, setMethod] = useState<string>('bank_transfer')
  const working = busy === 'dialog'

  if (dialog.kind === 'job') {
    const sr = (d.context as unknown as ServiceContext).serviceRequest
    return <ServiceJobModal sr={sr} onClose={onClose} onDone={onJobSaved} />
  }

  const submit = async (body: Parameters<typeof crApi.action>[1]) => {
    if (await run('dialog', () => crApi.action(d.id, body))) onClose()
  }

  const footer = (cta: string, onClick: () => void, disabled = false, destructive = false) => (
    <>
      {errFor('dialog')}
      <div className="flex justify-end gap-2 pt-3 border-t">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant={destructive ? 'destructive' : 'default'} onClick={onClick} disabled={working || disabled}>{working ? 'Saving…' : cta}</Button>
      </div>
    </>
  )

  if (dialog.kind === 'confirm') {
    return (
      <Modal open title={dialog.title} onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm">{dialog.text}</p>
          {footer(dialog.cta, () => submit({ action: dialog.action }))}
        </div>
      </Modal>
    )
  }

  if (dialog.kind === 'reason') {
    return (
      <Modal open title={dialog.title} onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{dialog.text}</p>
          <Field label="Reason (required)">
            <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} autoFocus />
          </Field>
          {footer(dialog.cta, () => submit({ action: dialog.action, reason: reason.trim() }), !reason.trim(), true)}
        </div>
      </Modal>
    )
  }

  if (dialog.kind === 'refund') {
    const n = Number(amount)
    return (
      <Modal open title="Mark deposit refunded" onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Record the refund once the money has gone out. The customer is told in the app.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount, AED"><Input type="number" min={0} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
            <Field label="Method">
              <Select value={method} onChange={e => setMethod(e.target.value)}>
                {REFUND_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Note (reference, bank, who sent it)"><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></Field>
          {footer('Mark refunded', () => submit({ action: 'mark_refunded', amount: n, method, note: note.trim() || undefined }), !(amount.trim() !== '' && n >= 0))}
        </div>
      </Modal>
    )
  }

  // resolve
  return (
    <Modal open title="Resolve request" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Closes the request. Use the specific buttons above when there is one — this is for anything handled another way.</p>
        <Field label="What was done"><Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} autoFocus /></Field>
        {footer('Resolve', () => submit({ action: 'resolve', note: note.trim() || undefined }))}
      </div>
    </Modal>
  )
}

/* ---------- the service job itself (same PATCH as Service requests) ---------- */

const JOB_STATUSES = ['awaiting_payment', 'requested', 'confirmed', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const
const JOB_FINAL = ['completed', 'cancelled']

function ServiceJobModal({ sr, onClose, onDone }: { sr: ServiceContext['serviceRequest']; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState(sr.status)
  const [driverName, setDriverName] = useState(sr.driverName || '')
  const [driverPhone, setDriverPhone] = useState(sr.driverPhone || '')
  const [charged, setCharged] = useState(sr.charged == null ? '' : String(sr.charged))
  const [staffNote, setStaffNote] = useState(sr.staffNote || '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = JOB_FINAL.includes(sr.status)
  // Only the customer app puts a job into awaiting payment.
  const options = JOB_STATUSES.filter(s => s !== 'awaiting_payment' || sr.status === 'awaiting_payment')

  async function submit() {
    setBusy(true); setErr('')
    try {
      await api.patch(`/service-requests/${sr.id}`, {
        ...(status !== sr.status ? { status } : {}),
        driverName, driverPhone, staffNote,
        charged: charged.trim() === '' ? null : Number(charged),
      })
      onDone()
    } catch (e) { setErr(apiError(e)) } finally { setBusy(false) }
  }

  return (
    <Modal open title={`Update job ${sr.ref}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Job status">
          <Select value={status} onChange={e => setStatus(e.target.value)} disabled={locked}>
            {options.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Driver name"><Input value={driverName} onChange={e => setDriverName(e.target.value)} /></Field>
          <Field label="Driver phone"><Input value={driverPhone} onChange={e => setDriverPhone(e.target.value)} /></Field>
        </div>
        <Field label={`Charged, AED (estimate ${sr.estimate?.total ?? '—'})`}>
          <Input type="number" min={0} value={charged} onChange={e => setCharged(e.target.value)} />
        </Field>
        <Field label="Staff note (not shown to the customer)">
          <Textarea value={staffNote} onChange={e => setStaffNote(e.target.value)} rows={3} />
        </Field>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  )
}

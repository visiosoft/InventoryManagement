import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { ClipboardList, MessageCircle, Phone } from 'lucide-react'
import { api, apiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Card, CardBody, CardHeader } from '../components/ui'

type Item = {
  _id: string; contractNo: string; endDate: string; daysLeft: number | null; rate: number; lastNote: string
  customer?: { fullName: string; phone?: string; email?: string }; unit?: { unitNumber: string }
}
type Data = { moveOut: Item[]; renewing: Item[]; silent: Item[] }

type Tpl = { _id: string; label: string; whatsappTemplate?: string }

/** Send an approved WhatsApp template to this tenant, filled from their contract (renewal and move-out links included). */
function WhatsAppSend({ contractId, name, phone }: { contractId: string; name: string; phone: string }) {
  const [open, setOpen] = useState(false)
  const [tplId, setTplId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const { data: all = [] } = useQuery<Tpl[]>({
    queryKey: ['message-templates'],
    queryFn: () => api.get('/message-templates').then((r) => r.data ?? []),
    enabled: open, staleTime: 5 * 60_000,
  })
  const templates = all.filter((t) => (t.whatsappTemplate || '').trim())
  async function send() {
    const chosen = templates.find((t) => t._id === tplId)
    if (!chosen || !confirm(`Send "${chosen.label}" to ${name} on ${phone}?`)) return
    setBusy(true); setMsg('')
    try {
      await api.post(`/contracts/${contractId}/whatsapp-template`, { templateId: tplId })
      setMsg(`Sent to ${phone}`)
    } catch (e) { setMsg(apiError(e)) } finally { setBusy(false) }
  }
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs font-semibold border rounded-full px-3 py-1.5 cursor-pointer" style={{ color: '#047857', borderColor: '#047857' }}>
        <MessageCircle size={12} /> WhatsApp
      </button>
      {open && (
        <div className="basis-full flex flex-wrap items-center gap-2 pt-2 border-t">
          <select value={tplId} onChange={(e) => { setTplId(e.target.value); setMsg('') }} className="flex-1 min-w-[200px] h-9 rounded-md border bg-background px-2 text-sm">
            <option value="">{all.length && !templates.length ? 'No approved WhatsApp templates yet' : 'Choose a template…'}</option>
            {templates.map((t) => <option key={t._id} value={t._id}>{t.label}</option>)}
          </select>
          <button type="button" disabled={!tplId || busy} onClick={send} className="h-9 px-4 rounded-md text-sm font-bold text-white disabled:opacity-40 cursor-pointer" style={{ background: '#047857' }}>{busy ? 'Sending…' : 'Send now'}</button>
          {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        </div>
      )}
    </>
  )
}

/** Send the EXIT_SURVEY WhatsApp Flow; the answers come back on their own and show in the Exit surveys card. */
function ExitSurveySend({ contractId, name, phone }: { contractId: string; name: string; phone: string }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  async function send() {
    if (!confirm(`Send the exit survey to ${name} on ${phone}?`)) return
    setBusy(true); setMsg('')
    try {
      const r = await api.post('/exit-surveys/send', { contractId })
      setMsg(r.data?.via === 'template' ? 'Sent (template)' : 'Sent')
    } catch (e) { setMsg(apiError(e)) } finally { setBusy(false) }
  }
  return (
    <>
      <button type="button" onClick={send} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold border rounded-full px-3 py-1.5 cursor-pointer disabled:opacity-40">
        <ClipboardList size={12} /> {busy ? 'Sending…' : 'Exit survey'}
      </button>
      {msg && <span className="basis-full text-xs text-muted-foreground">{msg}</span>}
    </>
  )
}

type Survey = {
  _id: string; submittedAt: string; reasonLabel: string; rating: number | null; comeBackLabel: string
  oneChange: string; whatWouldKeepYou: string
  customer?: { fullName: string }; unit?: { unitNumber: string }; contract?: { _id: string; contractNo: string }
}
type SurveyData = {
  summary: { total: number; averageRating: number | null; byReason: { id: string; label: string; count: number }[]; comeBack: { yes: number; maybe: number; no: number } }
  rows: Survey[]
}

/** Answers from the move-out exit survey. */
function ExitSurveys() {
  const { data } = useQuery<SurveyData>({ queryKey: ['exit-surveys'], queryFn: () => api.get('/exit-surveys', { params: { limit: 50 } }).then((r) => r.data) })
  const s = data?.summary
  return (
    <Card>
      <CardHeader
        title={`Exit surveys (${s?.total ?? 0})`}
        action={<Link to="/exit-surveys" className="text-xs font-semibold hover:underline">Full report →</Link>}
        subtitle={s && s.total ? `Average rating ${s.averageRating ?? '—'}/5 · would come back: ${s.comeBack.yes} yes, ${s.comeBack.maybe} maybe, ${s.comeBack.no} no` : 'Answers from tenants who were sent the exit survey.'}
      />
      <CardBody className="space-y-2">
        {s && s.byReason.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {s.byReason.map((r) => <span key={r.id} className="text-xs font-semibold rounded-full border px-2.5 py-1">{r.label}: {r.count}</span>)}
          </div>
        )}
        {data && data.rows.length === 0 && <div className="text-sm text-muted-foreground">No answers yet.</div>}
        {(data?.rows ?? []).map((r) => (
          <div key={r._id} className="rounded-xl border p-3 text-sm">
            <div className="flex flex-wrap gap-2 items-baseline">
              {r.contract ? <Link to={`/contracts/${r.contract._id}`} className="font-semibold hover:underline">{r.customer?.fullName || 'Tenant'}</Link> : <span className="font-semibold">{r.customer?.fullName || 'Unlinked number'}</span>}
              <span className="text-xs text-muted-foreground">Unit {r.unit?.unitNumber || '—'} · {new Date(r.submittedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            </div>
            <div className="text-xs mt-1">{r.reasonLabel || '—'} · {r.rating ?? '—'}/5 · come back: {r.comeBackLabel || '—'}</div>
            {r.oneChange && <div className="text-xs text-muted-foreground mt-1">Change: {r.oneChange}</div>}
            {r.whatWouldKeepYou && <div className="text-xs text-muted-foreground mt-0.5">Would keep them: {r.whatWouldKeepYou}</div>}
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

function Group({ title, hint, items, tone, exitSurvey }: { title: string; hint: string; items: Item[]; tone: string; exitSurvey?: boolean }) {
  return (
    <Card>
      <CardHeader title={`${title} (${items.length})`} subtitle={hint} />
      <CardBody className="space-y-2">
        {items.length === 0 && <div className="text-sm text-muted-foreground">Nobody here.</div>}
        {items.map((i) => (
          <div key={i._id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
            <div className="min-w-0 flex-1">
              <Link to={`/contracts/${i._id}`} className="font-semibold hover:underline">{i.customer?.fullName || 'Tenant'}</Link>
              <div className="text-xs text-muted-foreground">
                Unit {i.unit?.unitNumber || '—'} · {i.contractNo} · ends {new Date(i.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
              {i.lastNote && <div className="text-xs text-muted-foreground truncate mt-0.5">{i.lastNote}</div>}
            </div>
            <span className="text-xs font-semibold rounded-full px-2.5 py-1" style={{ background: tone, color: '#14081F' }}>
              {i.daysLeft == null ? '—' : i.daysLeft < 0 ? `${-i.daysLeft}d overdue` : `${i.daysLeft}d left`}
            </span>
            {i.customer?.phone && <WhatsAppSend contractId={i._id} name={i.customer.fullName || 'the tenant'} phone={i.customer.phone} />}
            {exitSurvey && i.customer?.phone && <ExitSurveySend contractId={i._id} name={i.customer.fullName || 'the tenant'} phone={i.customer.phone} />}
            {i.customer?.phone && (
              <a href={`tel:${i.customer.phone}`} className="inline-flex items-center gap-1 text-xs font-semibold border rounded-full px-3 py-1.5"><Phone size={12} /> Call</a>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

type Unpaid = { _id: string; contractNo: string; startDate: string; detail: string; customer?: { fullName: string }; unit?: { unitNumber: string } }

/** Signed contracts whose unit is held as Reserved because the first payment is not verified. */
function UnverifiedPayments() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const { data } = useQuery<Unpaid[]>({ queryKey: ['unverified-payments'], queryFn: () => api.get('/contracts/unverified-payments').then((r) => r.data) })
  const mark = useMutation({
    mutationFn: (id: string) => api.post(`/contracts/${id}/payment-verified`, { verified: true, note: window.prompt('Note (optional) — e.g. paid in cash') || '' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['unverified-payments'] }),
  })
  const canMark = user?.role === 'admin' || user?.role === 'accounts' || user?.role === 'sales_rep'
  return (
    <Card>
      <CardHeader title={`Signed, payment not verified (${data?.length ?? 0})`} subtitle="Zoho does not show the opening invoice as paid, so these units read Reserved, not Occupied. Checked every few minutes." />
      <CardBody className="space-y-2">
        {data && data.length === 0 && <div className="text-sm text-muted-foreground">All signed contracts are verified.</div>}
        {(data ?? []).map((i) => (
          <div key={i._id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
            <div className="min-w-0 flex-1">
              <Link to={`/contracts/${i._id}`} className="font-semibold hover:underline">{i.customer?.fullName || 'Tenant'}</Link>
              <div className="text-xs text-muted-foreground">Unit {i.unit?.unitNumber || '—'} · {i.contractNo} · {i.detail || 'not checked yet'}</div>
            </div>
            {canMark && <button type="button" onClick={() => mark.mutate(i._id)} disabled={mark.isPending} className="text-xs font-semibold border rounded-full px-3 py-1.5 cursor-pointer">Mark as paid</button>}
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

/** What tenants have told us about leaving or staying, and who has gone quiet near expiry. */
export default function RenewalRequests() {
  const { data, isLoading } = useQuery<Data>({ queryKey: ['renewal-requests'], queryFn: () => api.get('/contracts/renewal-requests').then((r) => r.data) })
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Renewals &amp; move-outs</h1>
        <p className="text-sm text-muted-foreground">Requests from tenants, and contracts ending within 60 days that nobody has answered.</p>
      </div>
      {isLoading || !data ? <div className="text-sm text-muted-foreground">Loading…</div> : (
        <>
          <Group title="Moving out" hint="Arrange the date and the key return; the unit frees up after." items={data.moveOut} tone="#FEE2E2" exitSurvey />
          <Group title="Renewing" hint="Confirm the new term and raise the next invoice." items={data.renewing} tone="#DCFCE7" />
          <UnverifiedPayments />
          <Group title="No answer yet" hint="Ending within 60 days with no reply — call these." items={data.silent} tone="#FEF3C7" />
          <ExitSurveys />
        </>
      )}
    </div>
  )
}

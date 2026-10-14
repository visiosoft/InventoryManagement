import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Phone } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Card, CardBody, CardHeader } from '../components/ui'

type Item = {
  _id: string; contractNo: string; endDate: string; daysLeft: number | null; rate: number; lastNote: string
  customer?: { fullName: string; phone?: string; email?: string }; unit?: { unitNumber: string }
}
type Data = { moveOut: Item[]; renewing: Item[]; silent: Item[] }

function Group({ title, hint, items, tone }: { title: string; hint: string; items: Item[]; tone: string }) {
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
          <Group title="Moving out" hint="Arrange the date and the key return; the unit frees up after." items={data.moveOut} tone="#FEE2E2" />
          <Group title="Renewing" hint="Confirm the new term and raise the next invoice." items={data.renewing} tone="#DCFCE7" />
          <UnverifiedPayments />
          <Group title="No answer yet" hint="Ending within 60 days with no reply — call these." items={data.silent} tone="#FEF3C7" />
        </>
      )}
    </div>
  )
}

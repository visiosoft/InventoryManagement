import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, Textarea } from '../../components/ui'
import { formatDate } from '../../lib/utils'
import { Link } from 'react-router-dom'

type ClaimStatus = 'reported' | 'under_review' | 'approved' | 'rejected' | 'settled'

interface Claim {
  _id: string; claimNo: string
  job: { _id: string; jobNo: string; pickupAddress?: string; deliveryAddress?: string; scheduledDate?: string }
  customer: { _id: string; fullName: string; phone?: string }
  status: ClaimStatus
  itemDescription: string; damageDescription: string
  claimedAmount: number; approvedAmount: number; settledAmount: number; settledDate?: string
  insuranceRef: string; resolution: string; reportedBy: string
  timeline: { at: string; text: string; author: string }[]
  notes: string; createdAt: string
}

const statusTone: Record<ClaimStatus, string> = {
  reported: 'amber', under_review: 'blue', approved: 'green', rejected: 'red', settled: 'teal',
}

const statusLabel: Record<ClaimStatus, string> = {
  reported: 'Reported', under_review: 'Under Review', approved: 'Approved', rejected: 'Rejected', settled: 'Settled',
}

export default function MovingClaims() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [detailClaim, setDetailClaim] = useState<Claim | null>(null)
  const [error, setError] = useState('')

  const { data: claims = [], isLoading } = useQuery<Claim[]>({
    queryKey: ['moving-claims', statusFilter, search],
    queryFn: () => api.get('/moving-claims', { params: { status: statusFilter || undefined, search: search || undefined } }).then(r => r.data),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['moving-claims'] })

  const createClaim = useMutation({
    mutationFn: (body: object) => api.post('/moving-claims', body),
    onSuccess: () => { invalidate(); setAddOpen(false); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const updateStatus = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api.patch(`/moving-claims/${id}/status`, body),
    onSuccess: (res) => { invalidate(); setDetailClaim(res.data); setError('') },
    onError: (e) => setError(apiError(e)),
  })

  const deleteClaim = useMutation({
    mutationFn: (id: string) => api.delete(`/moving-claims/${id}`),
    onSuccess: () => { invalidate(); setDetailClaim(null) },
    onError: (e) => setError(apiError(e)),
  })

  const totalClaimed = claims.reduce((s, c) => s + c.claimedAmount, 0)
  const totalSettled = claims.reduce((s, c) => s + c.settledAmount, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Damage Claims"
        subtitle="Track and resolve customer damage reports"
        action={<Button onClick={() => { setError(''); setAddOpen(true) }}><Plus size={14} /> New Claim</Button>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4"><div className="text-xs text-muted-foreground">Total Claims</div><div className="text-2xl font-bold">{claims.length}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Open</div><div className="text-2xl font-bold text-amber-600">{claims.filter(c => ['reported', 'under_review'].includes(c.status)).length}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Total Claimed</div><div className="text-2xl font-bold text-destructive">AED {totalClaimed.toLocaleString()}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">Total Settled</div><div className="text-2xl font-bold text-green-600">AED {totalSettled.toLocaleString()}</div></Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input className="w-72" placeholder="Search claims..." value={search} onChange={e => setSearch(e.target.value)} />
        <Select className="w-44" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>

      <Card>
        <CardHeader title="Claims" subtitle={`${claims.length} claims`} />
        <CardBody>
          {isLoading ? <Spinner /> : claims.length === 0 ? <EmptyState message="No claims found" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>Claim #</Th><Th>Job</Th><Th>Customer</Th><Th>Item</Th>
                  <Th className="text-right">Claimed</Th><Th>Status</Th><Th>Date</Th>
                </tr>
              </thead>
              <tbody>
                {claims.map(c => (
                  <tr key={c._id} className="hover:bg-muted/30 cursor-pointer" onClick={() => { setError(''); setDetailClaim(c) }}>
                    <Td className="font-mono font-medium">{c.claimNo}</Td>
                    <Td><Link to={`/moving/jobs/${c.job?._id}`} className="text-primary hover:underline" onClick={e => e.stopPropagation()}>{c.job?.jobNo}</Link></Td>
                    <Td>{c.customer?.fullName}</Td>
                    <Td className="max-w-48 truncate">{c.itemDescription}</Td>
                    <Td className="text-right font-medium">AED {c.claimedAmount.toLocaleString()}</Td>
                    <Td><Badge tone={statusTone[c.status]}>{statusLabel[c.status]}</Badge></Td>
                    <Td>{formatDate(c.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* New Claim Modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Report Damage Claim">
        <form onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          createClaim.mutate({
            job: f.get('job'), itemDescription: f.get('itemDescription'),
            damageDescription: f.get('damageDescription'), claimedAmount: Number(f.get('claimedAmount') || 0),
            reportedBy: f.get('reportedBy'), insuranceRef: f.get('insuranceRef'), notes: f.get('notes'),
          })
        }} className="space-y-3">
          <Field label="Job ID *"><Input name="job" required placeholder="Paste Job ID from job detail page" /></Field>
          <Field label="Damaged Item *"><Input name="itemDescription" required placeholder="e.g. Glass dining table, Samsung 55″ TV" /></Field>
          <Field label="Damage Description"><Textarea name="damageDescription" placeholder="Describe what happened and the extent of damage" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Claimed Amount (AED)"><Input name="claimedAmount" type="number" min="0" step="0.01" placeholder="0.00" /></Field>
            <Field label="Reported By"><Input name="reportedBy" placeholder="Staff or customer name" /></Field>
          </div>
          <Field label="Insurance Reference"><Input name="insuranceRef" placeholder="Policy # or ref" /></Field>
          <Field label="Notes"><Textarea name="notes" /></Field>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={createClaim.isPending}>
            {createClaim.isPending ? 'Creating...' : 'Submit Claim'}
          </Button>
        </form>
      </Modal>

      {/* Claim Detail Modal */}
      {detailClaim && (
        <Modal open={!!detailClaim} onClose={() => setDetailClaim(null)} title={`Claim ${detailClaim.claimNo}`}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Job:</span> <Link to={`/moving/jobs/${detailClaim.job?._id}`} className="text-primary hover:underline font-medium">{detailClaim.job?.jobNo}</Link></div>
              <div><span className="text-muted-foreground">Customer:</span> {detailClaim.customer?.fullName}</div>
              <div><span className="text-muted-foreground">Status:</span> <Badge tone={statusTone[detailClaim.status]}>{statusLabel[detailClaim.status]}</Badge></div>
              <div><span className="text-muted-foreground">Reported by:</span> {detailClaim.reportedBy || '—'}</div>
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
              <p className="font-medium">{detailClaim.itemDescription}</p>
              <p className="text-muted-foreground">{detailClaim.damageDescription || 'No description'}</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-center">
                <p className="text-xs text-muted-foreground">Claimed</p>
                <p className="text-lg font-bold text-destructive">AED {detailClaim.claimedAmount.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-center">
                <p className="text-xs text-muted-foreground">Approved</p>
                <p className="text-lg font-bold text-blue-600">AED {detailClaim.approvedAmount.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 text-center">
                <p className="text-xs text-muted-foreground">Settled</p>
                <p className="text-lg font-bold text-green-600">AED {detailClaim.settledAmount.toLocaleString()}</p>
              </div>
            </div>

            {detailClaim.insuranceRef && (
              <p className="text-sm"><span className="text-muted-foreground">Insurance Ref:</span> {detailClaim.insuranceRef}</p>
            )}
            {detailClaim.resolution && (
              <p className="text-sm"><span className="text-muted-foreground">Resolution:</span> {detailClaim.resolution}</p>
            )}

            {/* Status Actions */}
            {!['settled', 'rejected'].includes(detailClaim.status) && (
              <div className="border-t pt-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Update Status</p>
                <form onSubmit={(e: FormEvent<HTMLFormElement>) => {
                  e.preventDefault()
                  const f = new FormData(e.currentTarget)
                  updateStatus.mutate({
                    id: detailClaim._id,
                    body: {
                      status: f.get('newStatus'),
                      approvedAmount: f.get('approvedAmount') ? Number(f.get('approvedAmount')) : undefined,
                      settledAmount: f.get('settledAmount') ? Number(f.get('settledAmount')) : undefined,
                      resolution: f.get('resolution') || undefined,
                    },
                  })
                }} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="New Status">
                      <Select name="newStatus" defaultValue={detailClaim.status}>
                        <option value="reported">Reported</option>
                        <option value="under_review">Under Review</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                        <option value="settled">Settled</option>
                      </Select>
                    </Field>
                    <Field label="Approved Amount"><Input name="approvedAmount" type="number" min="0" step="0.01" defaultValue={detailClaim.approvedAmount || ''} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Settled Amount"><Input name="settledAmount" type="number" min="0" step="0.01" /></Field>
                    <Field label="Resolution"><Input name="resolution" placeholder="How it was resolved" defaultValue={detailClaim.resolution} /></Field>
                  </div>
                  {error && <p className="text-xs text-destructive">{error}</p>}
                  <Button type="submit" className="w-full" disabled={updateStatus.isPending}>
                    {updateStatus.isPending ? 'Updating...' : 'Update Claim'}
                  </Button>
                </form>
              </div>
            )}

            {/* Timeline */}
            {detailClaim.timeline?.length > 0 && (
              <div className="border-t pt-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Timeline</p>
                <div className="space-y-2">
                  {detailClaim.timeline.map((t, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground shrink-0">{formatDate(t.at)}</span>
                      <span>{t.text}</span>
                      {t.author && <span className="text-muted-foreground">— {t.author}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between border-t pt-4">
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => {
                if (confirm('Delete this claim?')) deleteClaim.mutate(detailClaim._id)
              }}><Trash2 size={14} /> Delete</Button>
              <Button variant="outline" onClick={() => setDetailClaim(null)}>Close</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

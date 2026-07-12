import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Search, ShieldAlert, AlertTriangle, CheckCircle, DollarSign } from 'lucide-react'
import { api, apiError } from '../../lib/api'
import { Badge, Button, Field, Input, Modal, Select, Spinner, Textarea } from '../../components/ui'
import { formatDate } from '../../lib/utils'
import { Link } from 'react-router-dom'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

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

const statusDot: Record<ClaimStatus, string> = {
  reported: '#F59E0B', under_review: '#3B82F6', approved: '#10B981', rejected: '#EF4444', settled: '#14B8A6',
}

function StatCard({ label, value, sub, icon, iconBg, iconColor }: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode; iconBg: string; iconColor: string
}) {
  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: 20 }}>
      <div className="flex justify-between items-start">
        <div style={{ fontSize: 13, color: MUTED, fontWeight: 500 }}>{label}</div>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: iconBg, display: 'grid', placeItems: 'center', color: iconColor }}>
          {icon}
        </div>
      </div>
      <div style={{ ...HEADING, fontSize: 32, fontWeight: 700, color: INK, marginTop: 8 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{sub}</div>}
    </div>
  )
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
  const openCount = claims.filter(c => ['reported', 'under_review'].includes(c.status)).length

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Damage Claims</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>Track and resolve customer damage reports</div>
        </div>
        <button
          onClick={() => { setError(''); setAddOpen(true) }}
          style={{ height: 40, borderRadius: 10, background: PURPLE, color: 'white', fontSize: 14, fontWeight: 600, padding: '0 20px' }}
          className="flex items-center gap-2 hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />New Claim
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        <StatCard label="Total Claims" value={claims.length} sub="all time" icon={<ShieldAlert size={18} />} iconBg="#F3F0EA" iconColor={MUTED} />
        <StatCard label="Open" value={openCount} sub="needs attention" icon={<AlertTriangle size={18} />} iconBg="#FFF7ED" iconColor="#EA580C" />
        <StatCard label="Total Claimed" value={`AED ${totalClaimed.toLocaleString()}`} sub="amount requested" icon={<DollarSign size={18} />} iconBg="#FEF2F2" iconColor="#EF4444" />
        <StatCard label="Total Settled" value={`AED ${totalSettled.toLocaleString()}`} sub="amount paid out" icon={<CheckCircle size={18} />} iconBg="#ECFDF5" iconColor="#059669" />
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-2.5 mb-5">
        <div style={{ height: 40, borderRadius: 10, background: '#F3F0EA' }} className="flex items-center gap-2 px-3 flex-1">
          <Search size={16} color={MUTED} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search claims…"
            style={{ background: 'transparent', border: 'none', outline: 'none', flex: 1, fontSize: 14, color: INK }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {[{ value: '', label: 'All' }, ...Object.entries(statusLabel).map(([k, v]) => ({ value: k, label: v }))].map(s => {
            const active = statusFilter === s.value
            return (
              <button
                key={s.value}
                onClick={() => setStatusFilter(s.value)}
                style={{
                  height: 40,
                  borderRadius: 10,
                  background: active ? PURPLE : '#F3F0EA',
                  color: active ? 'white' : MUTED,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '0 14px',
                  border: 'none',
                }}
                className="flex items-center gap-1.5 hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                {s.value && <span style={{ width: 6, height: 6, borderRadius: 3, background: active ? 'white' : statusDot[s.value as ClaimStatus], display: 'inline-block' }} />}
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Claims list */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : claims.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '60px 20px', textAlign: 'center' }}>
          <ShieldAlert size={32} style={{ margin: '0 auto 12px', color: MUTED, opacity: 0.3 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>No claims found</div>
          <div style={{ fontSize: 13, color: MUTED }}>No damage claims match the current filter</div>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {claims.map(c => (
              <button key={c._id} onClick={() => { setError(''); setDetailClaim(c) }}
                style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 14, padding: 16, width: '100%', textAlign: 'left' }}
                className="block hover:shadow-sm transition-shadow"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span style={{ fontSize: 13, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{c.claimNo}</span>
                  <Badge tone={statusTone[c.status]} className="text-xs">{statusLabel[c.status]}</Badge>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>{c.customer?.fullName}</div>
                <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }} className="truncate">{c.itemDescription}</div>
                <div className="flex justify-between">
                  <span style={{ fontSize: 12, color: MUTED }}>{formatDate(c.createdAt)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#EF4444' }}>AED {c.claimedAmount.toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block" style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
            <div className="overflow-x-auto">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                    {['Claim #', 'Job', 'Customer', 'Item', 'Claimed', 'Status', 'Date'].map(h => (
                      <th key={h} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: MUTED, textAlign: h === 'Claimed' ? 'right' : 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {claims.map(c => (
                    <tr key={c._id} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)', cursor: 'pointer' }} className="hover:bg-[#FAF8F5] transition-colors"
                      onClick={() => { setError(''); setDetailClaim(c) }}
                    >
                      <td style={{ padding: '14px 16px', fontSize: 13, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{c.claimNo}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13 }}>
                        <Link to={`/moving/jobs/${c.job?._id}`} style={{ color: PURPLE }} className="hover:opacity-80" onClick={e => e.stopPropagation()}>{c.job?.jobNo}</Link>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 500, color: INK }}>{c.customer?.fullName}</td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.itemDescription}</td>
                      <td style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: INK, textAlign: 'right' }}>AED {c.claimedAmount.toLocaleString()}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <Badge tone={statusTone[c.status]} className="text-xs">{statusLabel[c.status]}</Badge>
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED }}>{formatDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

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

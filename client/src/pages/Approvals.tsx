import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Eye, Loader2, X } from 'lucide-react'
import { api } from '../lib/api'
import { EmptyState, Spinner } from '../components/ui'
import { formatDate, formatMoney } from '../lib/utils'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const GREEN = '#047857'
const MUTED = '#756E80'
const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const CREAM = '#FDFCFA'

export default function Approvals() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: () => api.get('/contracts/pending-approvals').then((r) => r.data),
  })

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/contracts/${id}/approve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-approvals'] }),
  })

  const reject = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api.post(`/contracts/${id}/reject`, { note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-approvals'] }),
  })

  function handleReject(id: string) {
    const note = prompt('Reason for rejection (optional):') ?? ''
    reject.mutate({ id, note })
  }

  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>

  return (
    <div style={{ background: CREAM, borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      <div className="mb-7">
        <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>Approvals</div>
        <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>Contracts waiting for admin approval</div>
      </div>

      {contracts.length === 0 ? (
        <EmptyState message="No pending approvals. Contracts will appear here once a user sends them for approval from Book Unit." />
      ) : (
        <div className="space-y-3 mt-4">
          {contracts.map((c: any) => (
            <div
              key={c._id}
              className="rounded-xl border p-4"
              style={{ borderColor: 'rgba(20,8,31,0.08)', background: '#fff' }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold" style={{ color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>
                    {c.contractNo}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: MUTED }}>
                    {c.customer?.fullName || 'Unknown customer'}
                    {c.customer?.phone ? ` · ${c.customer.phone}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: MUTED }}>
                    <span>Unit: <strong style={{ color: INK }}>{c.unit?.unitNumber || (c.units?.length ? `${c.units.length} units` : '—')}</strong></span>
                    <span>Rate: <strong style={{ color: INK }}>{formatMoney(c.rate)} AED/4wk</strong></span>
                    <span>Period: <strong style={{ color: INK }}>{formatDate(c.startDate)} → {formatDate(c.endDate)}</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => navigate(`/contracts/${c._id}`)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border-2 hover:opacity-80 transition-opacity"
                    style={{ borderColor: PURPLE, color: PURPLE }}
                  >
                    <Eye size={14} /> View
                  </button>
                  <button
                    type="button"
                    onClick={() => approve.mutate(c._id)}
                    disabled={approve.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-60 hover:opacity-90 transition-opacity"
                    style={{ background: GREEN }}
                  >
                    {approve.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(c._id)}
                    disabled={reject.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-60 hover:opacity-90 transition-opacity"
                    style={{ background: '#DC2626' }}
                  >
                    {reject.isPending ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

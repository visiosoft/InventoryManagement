import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { describeSubmission, type ClientInfoSubmission } from './ClientInfoStatus'

const INK = '#14081F'
const MUTED = '#756E80'
const DOT = { green: '#059669', red: '#DC2626', grey: '#9CA3AF' }

type Data = { counts: { saved: number; partial: number; failed: number; processing: number; needsAction: number }; rows: ClientInfoSubmission[] }

/**
 * WhatsApp ID & details submissions, last 14 days: who sent their ID, whether
 * it reached Google Drive, and failures still waiting for somebody.
 * scope "all" for admins; "mine" for a rep — numbers whose lead they own.
 */
export default function ClientInfoSubmissionsCard({ scope }: { scope: 'all' | 'mine' }) {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery<Data>({
    queryKey: ['client-info-submissions', 'card', scope],
    queryFn: () => api.get('/client-info/submissions', { params: { days: 14, limit: 50, ...(scope === 'mine' ? { mine: '1' } : {}) } }).then((r) => r.data),
    refetchInterval: 60_000,
  })
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/client-info/submissions/${id}/resolve`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['client-info-submissions'] }),
  })
  const rows = data?.rows ?? []
  // Failures still open first, then everything else newest first.
  const open = rows.filter((r) => (r.status === 'failed' || r.status === 'partial') && !r.resolvedAt)
  const rest = rows.filter((r) => !open.includes(r))
  const shown = [...open, ...rest].slice(0, 8)

  return (
    <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, padding: '20px 22px 22px' }}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: INK, fontWeight: 700, fontSize: 15 }}>ID &amp; details from WhatsApp</span>
        <span style={{ color: MUTED, fontSize: 12 }}>last 14 days{scope === 'mine' ? ' · your leads' : ''}</span>
        {data && (
          <span className="ml-auto" style={{ fontSize: 12, color: MUTED }}>
            <b style={{ color: '#059669' }}>{data.counts.saved}</b> saved
            {' · '}<b style={{ color: data.counts.needsAction ? '#DC2626' : MUTED }}>{data.counts.needsAction}</b> need action
          </span>
        )}
      </div>

      {isLoading ? <div className="text-sm mt-3" style={{ color: MUTED }}>Loading…</div>
        : isError ? <div className="text-sm mt-3" style={{ color: '#B91C1C' }}>Could not load submissions.</div>
        : shown.length === 0 ? <div className="text-sm mt-3" style={{ color: MUTED }}>Nobody has sent their ID on WhatsApp in the last 14 days.</div>
        : (
          <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
            {shown.map((r) => {
              const d = describeSubmission(r)
              const needsAction = d.tone === 'red' && !r.resolvedAt
              return (
                <div key={r._id} style={{ border: '1px solid rgba(20,8,31,.08)', borderRadius: 12, padding: '10px 12px', background: needsAction ? '#FEF2F2' : '#fff' }}>
                  <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: 13 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 8, background: DOT[d.tone], flexShrink: 0 }} />
                    {r.customer
                      ? <Link to={`/customers/${r.customer._id}`} className="font-semibold hover:underline" style={{ color: INK }}>{r.customer.fullName || r.fullName}</Link>
                      : <span className="font-semibold" style={{ color: INK }}>{r.fullName || r.phoneNormalized}</span>}
                    <span className="ml-auto" style={{ fontSize: 11.5, color: MUTED }}>
                      {new Date(r.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: needsAction ? '#991B1B' : MUTED, marginTop: 3 }}>
                    {d.title}{d.detail ? ` — ${d.detail}` : ''}{r.resolvedAt ? ' · handled' : ''}
                  </div>
                  {needsAction && (
                    <button type="button" onClick={() => resolve.mutate(r._id)} disabled={resolve.isPending}
                      className="text-xs font-semibold mt-2 rounded-full px-3 py-1 cursor-pointer"
                      style={{ border: '1px solid #FECACA', color: '#991B1B', background: '#fff' }}>
                      Mark as handled
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
    </div>
  )
}

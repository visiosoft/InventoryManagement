import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { api } from '../../lib/api'
import { Spinner } from '../../components/ui'

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

const statusColors: Record<string, string> = {
  open: '#F59E0B', investigating: '#3B82F6', resolved: '#10B981', rejected: '#EF4444',
}

interface Claim { _id: string; claimNo: string; status: string; description: string; jobNo?: string; customerName?: string; createdAt: string; amount?: number }

export default function FieldClaims() {
  const { data: claims = [], isLoading } = useQuery<Claim[]>({
    queryKey: ['moving-claims'],
    queryFn: () => api.get('/moving-claims').then(r => r.data),
  })

  if (isLoading) return <div className="flex justify-center pt-16"><Spinner /></div>

  return (
    <div className="space-y-4">
      <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>Claims</h1>
      {claims.length === 0 ? (
        <div className="text-center pt-12 space-y-2">
          <AlertTriangle size={28} className="mx-auto" style={{ color: MUTED, opacity: 0.4 }} />
          <p style={{ color: MUTED, fontSize: 14 }}>No claims</p>
        </div>
      ) : (
        <div className="space-y-2">
          {claims.map(c => (
            <div key={c._id} className="p-3.5 rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 mb-1">
                <span style={{ fontSize: 12, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{c.claimNo}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: statusColors[c.status] || MUTED, textTransform: 'capitalize' }}>
                  {c.status}
                </span>
              </div>
              <p style={{ fontSize: 12, color: INK }} className="line-clamp-2">{c.description}</p>
              <div className="flex items-center gap-3 mt-1">
                {c.customerName && <span style={{ fontSize: 11, color: MUTED }}>{c.customerName}</span>}
                <span style={{ fontSize: 10, color: MUTED }}>
                  {new Date(c.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

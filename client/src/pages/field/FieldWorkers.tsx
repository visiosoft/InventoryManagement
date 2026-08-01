import { useQuery } from '@tanstack/react-query'
import { Phone, User } from 'lucide-react'
import { api } from '../../lib/api'
import { Spinner } from '../../components/ui'

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

interface Worker { _id: string; name: string; phone?: string; role?: string; status?: string; dailyRate?: number }

export default function FieldWorkers() {
  const { data: workers = [], isLoading } = useQuery<Worker[]>({
    queryKey: ['workers'],
    queryFn: () => api.get('/workers').then(r => r.data),
  })

  if (isLoading) return <div className="flex justify-center pt-16"><Spinner /></div>

  return (
    <div className="space-y-4">
      <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>Workers</h1>
      {workers.length === 0 ? (
        <div className="text-center pt-12" style={{ color: MUTED, fontSize: 14 }}>No workers</div>
      ) : (
        <div className="space-y-2">
          {workers.map(w => (
            <div key={w._id} className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card">
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${PURPLE}15`, display: 'grid', placeItems: 'center', color: PURPLE }} className="shrink-0">
                <User size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 13, fontWeight: 600, color: INK }}>{w.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  {w.role && <span style={{ fontSize: 11, color: MUTED, textTransform: 'capitalize' }}>{w.role}</span>}
                  {w.status && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: w.status === 'active' ? '#10B981' : '#EF4444' }}>
                      {w.status}
                    </span>
                  )}
                </div>
              </div>
              {w.phone && (
                <a href={`tel:${w.phone}`} style={{ color: PURPLE }}><Phone size={16} /></a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

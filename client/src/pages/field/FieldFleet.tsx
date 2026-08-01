import { useQuery } from '@tanstack/react-query'
import { Truck } from 'lucide-react'
import { api } from '../../lib/api'
import { Spinner } from '../../components/ui'

const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

interface FleetVehicle { _id: string; name: string; plateNo?: string; type?: string; status?: string; capacity?: string }

export default function FieldFleet() {
  const { data: fleet = [], isLoading } = useQuery<FleetVehicle[]>({
    queryKey: ['fleet'],
    queryFn: () => api.get('/fleet').then(r => r.data),
  })

  if (isLoading) return <div className="flex justify-center pt-16"><Spinner /></div>

  return (
    <div className="space-y-4">
      <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>Fleet</h1>
      {fleet.length === 0 ? (
        <div className="text-center pt-12" style={{ color: MUTED, fontSize: 14 }}>No vehicles</div>
      ) : (
        <div className="space-y-2">
          {fleet.map(v => (
            <div key={v._id} className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card">
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${PURPLE}15`, display: 'grid', placeItems: 'center', color: PURPLE }} className="shrink-0">
                <Truck size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 13, fontWeight: 600, color: INK }}>{v.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  {v.plateNo && <span style={{ fontSize: 11, color: MUTED }}>{v.plateNo}</span>}
                  {v.type && <span style={{ fontSize: 10, color: MUTED, textTransform: 'capitalize' }}>{v.type}</span>}
                  {v.status && (
                    <span style={{ fontSize: 10, fontWeight: 600, color: v.status === 'active' ? '#10B981' : '#EF4444' }}>
                      {v.status}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

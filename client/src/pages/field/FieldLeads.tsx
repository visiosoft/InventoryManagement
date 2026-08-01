import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Search, Phone, Plus } from 'lucide-react'
import { api } from '../../lib/api'
import { Spinner } from '../../components/ui'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'

const statusColors: Record<string, string> = {
  new: '#3B82F6', contacted: '#F59E0B', qualified: '#10B981', quoted: '#8B5CF6',
  won: '#059669', lost: '#EF4444', follow_up: '#F97316',
}

interface MovingLead {
  _id: string; leadNo: string; status: string
  customerName: string; phone?: string; email?: string
  source?: string; moveType?: string; notes?: string
  createdAt: string
}

export default function FieldLeads() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: leads = [], isLoading } = useQuery<MovingLead[]>({
    queryKey: ['moving-leads'],
    queryFn: () => api.get('/moving-leads').then(r => r.data),
  })

  const filtered = leads.filter(l => {
    if (!search) return true
    const s = search.toLowerCase()
    return l.leadNo?.toLowerCase().includes(s) || l.customerName?.toLowerCase().includes(s) || l.phone?.includes(s)
  })

  if (isLoading) return <div className="flex justify-center pt-16"><Spinner /></div>

  return (
    <div className="space-y-4">
      <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>Leads</h1>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search leads..."
          className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center pt-12" style={{ color: MUTED, fontSize: 14 }}>No leads found</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(l => (
            <button
              key={l._id}
              onClick={() => navigate(`/moving/leads/${l._id}`)}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span style={{ fontSize: 12, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{l.leadNo}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: statusColors[l.status] || MUTED, textTransform: 'capitalize' }}>
                    {l.status?.replace(/_/g, ' ')}
                  </span>
                </div>
                <p style={{ fontSize: 13, fontWeight: 500, color: INK }} className="truncate">{l.customerName}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  {l.phone && (
                    <span className="flex items-center gap-1" style={{ fontSize: 11, color: MUTED }}>
                      <Phone size={10} /> {l.phone}
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: MUTED }}>
                    {new Date(l.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                  </span>
                </div>
              </div>
              <ChevronRight size={16} style={{ color: MUTED }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingQuote } from '../../lib/types'
import { Spinner } from '../../components/ui'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'

const statusColors: Record<string, string> = {
  draft: '#94a3b8', sent: '#3B82F6', accepted: '#10B981', rejected: '#EF4444', expired: '#F59E0B',
}

function fmt(n: number) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function FieldQuotes() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: quotes = [], isLoading } = useQuery<MovingQuote[]>({
    queryKey: ['moving-quotes'],
    queryFn: () => api.get('/moving-quotes').then(r => r.data),
  })

  const filtered = quotes.filter(q => {
    if (!search) return true
    const s = search.toLowerCase()
    return q.quoteNo?.toLowerCase().includes(s) || q.customer?.fullName?.toLowerCase().includes(s)
  })

  if (isLoading) return <div className="flex justify-center pt-16"><Spinner /></div>

  return (
    <div className="space-y-4">
      <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>Quotes</h1>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search quotes..."
          className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center pt-12" style={{ color: MUTED, fontSize: 14 }}>No quotes found</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(q => (
            <button
              key={q._id}
              onClick={() => navigate(`/moving/quotes/${q._id}`)}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span style={{ fontSize: 12, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{q.quoteNo}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: statusColors[q.status], textTransform: 'capitalize' }}>{q.status}</span>
                </div>
                <p style={{ fontSize: 13, fontWeight: 500, color: INK }} className="truncate">{q.customer?.fullName}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span style={{ fontSize: 11, color: MUTED }}>
                    {q.quoteDate ? new Date(q.quoteDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: PURPLE }}>AED {fmt(q.total)}</span>
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

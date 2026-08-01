import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import { api } from '../../lib/api'
import type { MovingInvoice } from '../../lib/types'
import { Spinner } from '../../components/ui'

const PURPLE = '#5B2BC9'
const INK = '#14081F'
const MUTED = '#756E80'

const statusColors: Record<string, string> = {
  draft: '#94a3b8', sent: '#3B82F6', partially_paid: '#F59E0B', paid: '#10B981', overdue: '#EF4444', cancelled: '#6B7280',
}

function fmt(n: number) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function FieldInvoices() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: invoices = [], isLoading } = useQuery<MovingInvoice[]>({
    queryKey: ['moving-invoices'],
    queryFn: () => api.get('/moving-invoices').then(r => r.data),
  })

  const filtered = invoices.filter(inv => {
    if (!search) return true
    const s = search.toLowerCase()
    return inv.invoiceNo?.toLowerCase().includes(s) || inv.customer?.fullName?.toLowerCase().includes(s)
  })

  if (isLoading) return <div className="flex justify-center pt-16"><Spinner /></div>

  return (
    <div className="space-y-4">
      <h1 style={{ fontSize: 20, fontWeight: 700, color: INK, fontFamily: "'Bricolage Grotesque', sans-serif" }}>Invoices</h1>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoices..."
          className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center pt-12" style={{ color: MUTED, fontSize: 14 }}>No invoices found</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(inv => (
            <button
              key={inv._id}
              onClick={() => navigate(`/moving/invoices/${inv._id}`)}
              className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span style={{ fontSize: 12, fontWeight: 700, color: PURPLE, fontFamily: 'monospace' }}>{inv.invoiceNo}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: statusColors[inv.status], textTransform: 'capitalize' }}>
                    {inv.status?.replace(/_/g, ' ')}
                  </span>
                </div>
                <p style={{ fontSize: 13, fontWeight: 500, color: INK }} className="truncate">{inv.customer?.fullName}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span style={{ fontSize: 11, color: MUTED }}>
                    {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: PURPLE }}>AED {fmt(inv.total)}</span>
                  {(inv.balanceDue ?? 0) > 0 && (
                    <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 600 }}>Due: {fmt(inv.balanceDue)}</span>
                  )}
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

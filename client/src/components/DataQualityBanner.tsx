import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'

/**
 * What makes today's figures unreliable, with where to fix it. Not
 * dismissible: each line goes away only when its condition is fixed.
 */

type Condition = { key: string; severity: 'high' | 'medium' | 'low'; count: number | null; text: string; fix: string }

export default function DataQualityBanner() {
  const { data } = useQuery<{ conditions: Condition[]; checkedAt: string }>({
    queryKey: ['data-quality'],
    queryFn: () => api.get('/reports/data-quality').then((r) => r.data),
    staleTime: 5 * 60_000,
  })
  const list = Array.isArray(data?.conditions) ? data!.conditions : []
  if (!list.length) return null
  const high = list.some((c) => c.severity === 'high')
  return (
    <div role="status" aria-label="Data quality" style={{ background: high ? '#FEF2F2' : '#FFF7E6', border: `1px solid ${high ? '#FECACA' : '#FDE68A'}`, borderRadius: 14, padding: '10px 14px', marginBottom: 16 }}>
      <div className="flex items-center gap-2" style={{ fontSize: 12.5, fontWeight: 800, color: high ? '#B91C1C' : '#8A5A00' }}>
        <AlertTriangle size={14} /> Some figures below are not reliable yet
      </div>
      <ul style={{ margin: '6px 0 0', paddingLeft: 22, fontSize: 13, color: '#4A4357' }}>
        {list.map((c) => (
          <li key={c.key} style={{ marginTop: 2 }}>
            {c.text}{' '}
            <Link to={c.fix} style={{ color: '#5B2BC9', fontWeight: 700 }}>Fix</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

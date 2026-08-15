import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { UserPlus } from 'lucide-react'
import { api, leadApi } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Lead, MovingLead, MovingLeadStatus } from '../lib/types'
import { Spinner } from '../components/ui'
import { formatDate } from '../lib/utils'

const HEADING = { fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.02em' } as const
const INK = '#14081F'
const MUTED = '#756E80'
const PURPLE = '#5B2BC9'

type Row = {
  key: string
  type: 'Storage Only' | 'Moving'
  name: string
  phone: string
  interested: string
  status: string
  statusColor: { bg: string; fg: string }
  addedAt?: string
  href: string
  canConvert: boolean
  convertLabel: string
  convert: () => void
  converting: boolean
}

const STORAGE_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  new: { bg: '#E8F9EE', fg: '#0F7A3D' },
  contacted: { bg: '#E0F2FE', fg: '#0369A1' },
  qualified: { bg: '#F3E8FF', fg: '#7C3AED' },
  proposal_sent: { bg: '#FEF3C7', fg: '#B45309' },
  won: { bg: '#D1FAE5', fg: '#065F46' },
  lost: { bg: '#FEE2E2', fg: '#991B1B' },
}
const MOVING_STATUS_COLORS: Record<MovingLeadStatus, { bg: string; fg: string }> = {
  new: { bg: '#E8F9EE', fg: '#0F7A3D' },
  contacted: { bg: '#E0F2FE', fg: '#0369A1' },
  quoted: { bg: '#F3E8FF', fg: '#7C3AED' },
  client_approved: { bg: '#FEF3C7', fg: '#B45309' },
  won: { bg: '#D1FAE5', fg: '#065F46' },
  lost: { bg: '#FEE2E2', fg: '#991B1B' },
}
const labelize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export default function SalesBoard() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')

  const { data: storagePage, isLoading: storageLoading } = useQuery({
    queryKey: ['my-leads-storage'],
    queryFn: () => leadApi.list({ owner: user?.id, limit: 500 }),
    enabled: !!user?.id,
  })

  const { data: movingLeads = [], isLoading: movingLoading } = useQuery<MovingLead[]>({
    queryKey: ['my-leads-moving'],
    queryFn: () => api.get('/moving-leads', { params: { owner: user?.id } }).then((r) => r.data),
    enabled: !!user?.id,
  })

  const convertStorage = useMutation({
    mutationFn: (id: string) => leadApi.convertToCustomer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-leads-storage'] }),
  })
  const convertMoving = useMutation({
    mutationFn: (id: string) => api.post(`/moving-leads/${id}/convert`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-leads-moving'] }),
  })

  const rows: Row[] = useMemo(() => {
    const storageRows: Row[] = (storagePage?.data || []).map((l: Lead) => ({
      key: `s-${l._id}`,
      type: 'Storage Only',
      name: l.fullName,
      phone: l.phone,
      interested: l.storageSizeValue ? `${l.storageSizeValue} ${l.storageSizeUnit}` : '—',
      status: labelize(l.status),
      statusColor: STORAGE_STATUS_COLORS[l.status] || STORAGE_STATUS_COLORS.new,
      addedAt: l.leadDateTime,
      href: `/leads`,
      canConvert: l.status !== 'won' && l.status !== 'lost',
      convertLabel: 'Convert to Customer',
      convert: () => convertStorage.mutate(l._id),
      converting: convertStorage.isPending,
    }))
    const movingRows: Row[] = movingLeads.map((l) => ({
      key: `m-${l._id}`,
      type: 'Moving',
      name: l.prospectName || l.customer?.fullName || '—',
      phone: l.prospectPhone || l.customer?.phone || '—',
      interested: l.estimatedVolumeCbm ? `${l.estimatedVolumeCbm} cbm` : '—',
      status: labelize(l.status),
      statusColor: MOVING_STATUS_COLORS[l.status] || MOVING_STATUS_COLORS.new,
      addedAt: l.createdAt,
      href: `/moving/leads/${l._id}`,
      canConvert: l.status !== 'won' && l.status !== 'lost',
      convertLabel: 'Convert to Job',
      convert: () => convertMoving.mutate(l._id),
      converting: convertMoving.isPending,
    }))
    return [...storageRows, ...movingRows].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''))
  }, [storagePage, movingLeads, convertStorage, convertMoving])

  const statuses = useMemo(() => [...new Set(rows.map((r) => r.status))].sort(), [rows])
  const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows
  const isLoading = storageLoading || movingLoading

  return (
    <div style={{ background: '#FDFCFA', borderRadius: 20, border: '1px solid rgba(20,8,31,0.06)' }} className="p-5 sm:p-7">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-7">
        <div>
          <div style={{ ...HEADING, fontSize: 26, fontWeight: 700, color: INK }}>My Leads</div>
          <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>{rows.length} lead{rows.length !== 1 ? 's' : ''} assigned to you</div>
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap mb-5">
        <button
          onClick={() => setStatusFilter('')}
          style={{ height: 36, borderRadius: 10, background: statusFilter === '' ? PURPLE : '#F3F0EA', color: statusFilter === '' ? 'white' : MUTED, fontSize: 13, fontWeight: 600, padding: '0 14px', border: 'none' }}
          className="hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          All ({rows.length})
        </button>
        {statuses.map((s) => {
          const active = statusFilter === s
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{ height: 36, borderRadius: 10, background: active ? PURPLE : '#F3F0EA', color: active ? 'white' : MUTED, fontSize: 13, fontWeight: 600, padding: '0 14px', border: 'none' }}
              className="hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              {s} ({rows.filter((r) => r.status === s).length})
            </button>
          )
        })}
      </div>

      {/* Recent leads table */}
      <div style={{ background: 'white', border: '1px solid rgba(20,8,31,0.08)', borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid rgba(20,8,31,.08)', fontWeight: 700, fontSize: 15, color: INK }}>Recent leads</div>
        {isLoading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <UserPlus size={32} style={{ margin: '0 auto 12px', color: MUTED, opacity: 0.3 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 4 }}>No leads assigned to you yet</div>
            <div style={{ fontSize: 13, color: MUTED }}>New assignments will show up here.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(20,8,31,0.06)' }}>
                  {['Name', 'Phone', 'Interested Unit', 'Type', 'Date', 'Status', ''].map((h) => (
                    <th key={h} style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: MUTED, textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.key} style={{ borderBottom: '1px solid rgba(20,8,31,0.04)' }} className="hover:bg-[#FAF8F5] transition-colors">
                    <td style={{ padding: '14px 16px' }}>
                      <Link to={r.href} style={{ fontSize: 14, fontWeight: 600, color: PURPLE }} className="hover:opacity-80 transition-opacity">{r.name}</Link>
                    </td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{r.phone}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED }}>{r.interested}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED }}>{r.type}</td>
                    <td style={{ padding: '14px 16px', fontSize: 13, color: MUTED }}>{r.addedAt ? formatDate(r.addedAt) : '—'}</td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: r.statusColor.bg, color: r.statusColor.fg }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      {r.canConvert && (
                        <button
                          type="button"
                          disabled={r.converting}
                          onClick={r.convert}
                          style={{ height: 28, padding: '0 10px', borderRadius: 8, background: 'transparent', color: PURPLE, border: '1px solid #DDD0FF', fontWeight: 600, fontSize: 11.5, whiteSpace: 'nowrap' }}
                          className="hover:bg-[#F7F3FF] transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {r.converting ? 'Converting…' : r.convertLabel}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
